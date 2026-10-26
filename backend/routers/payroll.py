"""RH - Folha de Pagamento: tabelas de cálculo (INSS/IRRF/FGTS editáveis),
folhas por competência (mensal, 13º 1ª e 2ª parcela), contracheques com os
lançamentos do mês e o contracheque em PDF.

Ciclo da folha: ABERTA (gera/recalcula/edita) -> FECHADA (travada) -> PAGA.
Os cálculos ficam em hr_payroll.py."""
import re
import uuid
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from hr_payroll import (
    CONTRACT_TYPES, EVENTS, MANUAL_EVENT_CODES, NOTICE_TYPES, PAYROLL_CONTRACT_TYPES, RUN_TYPES,
    TERMINATION_TYPES, commercial_days, commercial_overlap, competence_bounds, compute_13th_payslip, compute_monthly_payslip,
    months_by_fifteen, overlap_days, parse_day, r2,
)
from models import HRPayrollPay, HRPayrollRunCreate, HRPayrollSettings, HRPayslipInputs
from reports import merge_company
from routers.hr import (
    DOCUMENT_TYPES, LEAVE_TYPES, OCCURRENCE_TYPES, PAYROLL_ABSENCE_TYPES, contract_ctx, contract_snapshot, load_payroll_settings,
    occurrence_days_in, pdf_stream, _clean, _now_iso,
)
from routers.stock import _valid_iso_date
from shared import db, get_current_admin_user, get_company_settings

api_router = APIRouter(prefix="/api")

RUN_STATUS = {"ABERTA": "Aberta", "FECHADA": "Fechada", "PAGA": "Paga"}
COMPETENCE_RX = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


@api_router.get("/hr/meta")
async def hr_meta(current_user: dict = Depends(get_current_admin_user)):
    """Listas usadas nas telas do RH (tipos, eventos lançáveis...)."""
    return {
        "contract_types": [{"value": k, "label": v} for k, v in CONTRACT_TYPES.items()],
        "termination_types": [{"value": k, "label": v} for k, v in TERMINATION_TYPES.items()],
        "notice_types": [{"value": k, "label": v} for k, v in NOTICE_TYPES.items()],
        "occurrence_types": [{"value": k, "label": v} for k, v in OCCURRENCE_TYPES.items()],
        "document_types": [{"value": k, "label": v} for k, v in DOCUMENT_TYPES.items()],
        "run_types": [{"value": k, "label": v} for k, v in RUN_TYPES.items()],
        "events": [{"code": code, "number": EVENTS[code][0], "label": EVENTS[code][1], "kind": EVENTS[code][2], "input": EVENTS[code][3]}
                   for code in MANUAL_EVENT_CODES],
    }


# ---------------------------------------------------------------- Tabelas de cálculo

@api_router.get("/hr/payroll-settings")
async def get_payroll_settings(current_user: dict = Depends(get_current_admin_user)):
    stored = await db.hr_payroll_settings.find_one({"id": "default"}, {"_id": 0})
    return {"settings": await load_payroll_settings(), "is_default": not stored,
            "updated_at": (stored or {}).get("updated_at"), "updated_by_name": (stored or {}).get("updated_by_name")}


def _validate_brackets(rows, label, open_last=False, with_deduction=False):
    if not rows:
        raise HTTPException(status_code=400, detail=f"Informe as faixas do {label}")
    previous, clean = 0.0, []
    for i, row in enumerate(rows):
        up_to = row.get("up_to")
        last = i == len(rows) - 1
        if up_to in (None, "") and open_last and last:
            up_to = None
        else:
            try:
                up_to = float(up_to)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"{label}: limite da faixa {i + 1} inválido")
            if up_to <= previous:
                raise HTTPException(status_code=400, detail=f"{label}: as faixas precisam estar em ordem crescente")
            previous = up_to
        try:
            rate = float(row.get("rate"))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"{label}: alíquota da faixa {i + 1} inválida")
        if rate < 0 or rate > 100:
            raise HTTPException(status_code=400, detail=f"{label}: alíquota da faixa {i + 1} inválida")
        item = {"up_to": up_to, "rate": rate}
        if with_deduction:
            item["deduction"] = float(row.get("deduction") or 0)
        clean.append(item)
    if open_last and clean[-1]["up_to"] is not None:
        raise HTTPException(status_code=400, detail=f"{label}: a última faixa não tem limite (deixe em branco)")
    return clean


@api_router.put("/hr/payroll-settings")
async def update_payroll_settings(data: HRPayrollSettings, current_user: dict = Depends(get_current_admin_user)):
    values = data.model_dump()
    values["inss_brackets"] = _validate_brackets(values["inss_brackets"], "INSS")
    values["irrf_brackets"] = _validate_brackets(values["irrf_brackets"], "IRRF", open_last=True, with_deduction=True)
    for key, value in values.items():
        if isinstance(value, (int, float)) and value < 0:
            raise HTTPException(status_code=400, detail=f"Valor inválido em {key}")
    if not values.get("monthly_hours"):
        raise HTTPException(status_code=400, detail="Informe a jornada mensal (horas)")
    if values.get("valid_from"):
        values["valid_from"] = _valid_iso_date(values["valid_from"], "Vigência")
    doc = {"id": "default", **values, "updated_at": _now_iso(), "updated_by_name": current_user["name"]}
    await db.hr_payroll_settings.replace_one({"id": "default"}, doc, upsert=True)
    return await get_payroll_settings(current_user)


@api_router.post("/hr/payroll-settings/reset")
async def reset_payroll_settings(current_user: dict = Depends(get_current_admin_user)):
    await db.hr_payroll_settings.delete_one({"id": "default"})
    return await get_payroll_settings(current_user)


# ---------------------------------------------------------------- Montagem do contracheque

def _eligible(contract: dict, run: dict) -> bool:
    if contract.get("status") == "DESLIGADO" or contract.get("contract_type") not in PAYROLL_CONTRACT_TYPES:
        return False
    first, last = competence_bounds(run["competence"])
    admission = parse_day(contract.get("admission_date"))
    if run["run_type"] == "MENSAL":
        return admission <= last
    return admission <= date(first.year, 12, 31)


async def _month_days(contract: dict, first: date, last: date) -> dict:
    """Dias pagos no mês: do início (ou da admissão) ao fim do mês, menos os
    dias de férias (pagos no recibo de férias) e os dias de afastamento
    pelo INSS depois do 15º."""
    admission = parse_day(contract["admission_date"])
    days = commercial_days(max(admission, first), last, last)
    vacation_days = 0
    vacation_inss_base, vacation_inss = 0.0, 0.0
    for v in await db.hr_vacations.find({"contract_id": contract["id"], "status": {"$ne": "CANCELADA"},
                                         "start_date": {"$lte": last.isoformat()}, "end_date": {"$gte": first.isoformat()}},
                                        {"_id": 0, "start_date": 1, "end_date": 1, "days": 1, "calc": 1}).to_list(None):
        start, end = parse_day(v["start_date"]), parse_day(v["end_date"])
        vacation_days += commercial_overlap(start, end, first, last)
        # a parte das férias gozada neste mês soma na base do INSS da competência
        share = overlap_days(start, end, first, last) / (v.get("days") or 1)
        calc = v.get("calc") or {}
        vacation_inss_base += ((calc.get("vacation_pay") or 0) + (calc.get("one_third") or 0)) * share
        vacation_inss += (calc.get("inss") or 0) * share
    leave_days = 0
    absence_days = 0
    for o in await db.hr_occurrences.find({"contract_id": contract["id"],
                                           "occurrence_type": {"$in": list(LEAVE_TYPES) + list(PAYROLL_ABSENCE_TYPES)}},
                                          {"_id": 0}).to_list(None):
        if o["occurrence_type"] in LEAVE_TYPES:
            start = parse_day(o.get("start_date"))
            end = parse_day(o.get("end_date")) or last
            if start:
                leave_days += commercial_overlap(start + timedelta(days=15), end, first, last)
        else:
            absence_days += int(occurrence_days_in(o, first, last))
    paid = max(0, min(30, days - min(vacation_days, 30) - leave_days))
    return {"days": paid, "vacation_days": vacation_days, "leave_days": leave_days, "absence_days": absence_days,
            "vacation_inss_base": r2(vacation_inss_base), "vacation_inss": r2(vacation_inss)}


async def _first_13th_paid(contract_id: str, year: int) -> float:
    total = 0.0
    runs = [r["id"] for r in await db.hr_payroll_runs.find({"run_type": "DECIMO_1", "competence": {"$regex": f"^{year}-"},
                                                            "status": {"$ne": "ABERTA"}},
                                                           {"_id": 0, "id": 1}).to_list(None)]
    if runs:
        for p in await db.hr_payslips.find({"contract_id": contract_id, "run_id": {"$in": runs}}, {"_id": 0, "totals": 1}).to_list(None):
            total += (p.get("totals") or {}).get("gross") or 0
    for v in await db.hr_vacations.find({"contract_id": contract_id, "status": "PAGA", "advance_13th": True,
                                         "start_date": {"$regex": f"^{year}-"}}, {"_id": 0, "calc": 1}).to_list(None):
        total += (v.get("calc") or {}).get("advance_13th") or 0
    return r2(total)


async def _calc_payslip(run: dict, contract: dict, settings: dict, inputs: list, days_override: Optional[int]) -> dict:
    first, last = competence_bounds(run["competence"])
    ctx = contract_ctx(contract, settings, last)
    info = {"days": 30, "vacation_days": 0, "leave_days": 0, "absence_days": 0}
    if run["run_type"] == "MENSAL":
        info = await _month_days(contract, first, last)
        ctx["days_worked"] = info["days"] if days_override is None else days_override
        ctx["absence_days"] = info["absence_days"]
        ctx["other_inss_base"] = info["vacation_inss_base"]
        ctx["other_inss_withheld"] = info["vacation_inss"]
        result = compute_monthly_payslip(ctx, inputs, settings)
        months = None
    else:
        admission = parse_day(contract["admission_date"])
        months = months_by_fifteen(max(admission, date(first.year, 1, 1)), date(first.year, 12, 31))
        part = 1 if run["run_type"] == "DECIMO_1" else 2
        first_paid = await _first_13th_paid(contract["id"], first.year) if part == 2 else 0.0
        result = compute_13th_payslip(ctx, part, months, first_paid, inputs, settings)
    events = result.pop("events")
    return {
        "days_worked": ctx.get("days_worked", 30) if run["run_type"] == "MENSAL" else None,
        "days_override": days_override, "vacation_days": info["vacation_days"], "leave_days": info["leave_days"],
        "absence_days": info["absence_days"], "months_13th": months,
        "irrf_dependents": ctx["irrf_dependents"], "family_children": ctx["family_children"],
        "events": events, "totals": result,
    }


def _payslip_snapshot(contract: dict) -> dict:
    return {
        **contract_snapshot(contract),
        "cbo": contract.get("cbo"), "contract_type": contract.get("contract_type"), "admission_date": contract.get("admission_date"),
        "base_salary": contract.get("base_salary"), "pis": contract.get("pis"),
        "bank_name": contract.get("bank_name"), "bank_agency": contract.get("bank_agency"),
        "bank_account": contract.get("bank_account"), "pix_key": contract.get("pix_key"),
    }


def _initial_inputs(contract: dict, run: dict) -> list:
    """Lançamentos fixos do contrato entram na folha mensal (editáveis em cada contracheque)."""
    if run["run_type"] != "MENSAL":
        return []
    return [{**ev, "recurring": True} for ev in contract.get("recurring_events") or []]


async def _refresh_run_totals(run_id: str):
    slips = await db.hr_payslips.find({"run_id": run_id}, {"_id": 0, "totals": 1}).to_list(None)
    totals = {f: r2(sum((s.get("totals") or {}).get(f) or 0 for s in slips)) for f in ("gross", "deductions", "net", "inss", "irrf", "fgts")}
    totals["count"] = len(slips)
    await db.hr_payroll_runs.update_one({"id": run_id}, {"$set": {"totals": totals, "updated_at": _now_iso()}})


async def _get_run(run_id: str) -> dict:
    run = await db.hr_payroll_runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Folha não encontrada")
    return run


def _require_open(run: dict):
    if run["status"] != "ABERTA":
        raise HTTPException(status_code=400, detail="A folha está fechada: reabra para alterar")


async def _sync_run(run: dict):
    """Gera/recalcula os contracheques: inclui contratos novos, tira os que
    deixaram de entrar (desligados) e recalcula todos com o contrato e as
    tabelas atuais, mantendo os lançamentos de cada um."""
    settings = await load_payroll_settings()
    contracts = {c["id"]: c for c in await db.hr_contracts.find({}, {"_id": 0}).to_list(None)}
    existing = {p["contract_id"]: p for p in await db.hr_payslips.find({"run_id": run["id"]}, {"_id": 0}).to_list(None)}
    for contract_id, slip in existing.items():
        contract = contracts.get(contract_id)
        if not contract or not _eligible(contract, run):
            await db.hr_payslips.delete_one({"id": slip["id"]})
    for contract in contracts.values():
        if not _eligible(contract, run):
            continue
        slip = existing.get(contract["id"])
        inputs = slip.get("inputs", []) if slip else _initial_inputs(contract, run)
        override = slip.get("days_override") if slip else None
        calc = await _calc_payslip(run, contract, settings, inputs, override)
        fields = {**_payslip_snapshot(contract), **calc, "inputs": inputs, "updated_at": _now_iso()}
        if slip:
            await db.hr_payslips.update_one({"id": slip["id"]}, {"$set": fields})
        else:
            await db.hr_payslips.insert_one({"id": str(uuid.uuid4()), "run_id": run["id"], "competence": run["competence"],
                                             "run_type": run["run_type"], **fields, "observations": None, "created_at": _now_iso()})
    await _refresh_run_totals(run["id"])


# ---------------------------------------------------------------- Folhas

@api_router.get("/hr/payroll-runs")
async def list_runs(year: Optional[str] = None, status: Optional[str] = None, current_user: dict = Depends(get_current_admin_user)):
    query = {}
    if year:
        query["competence"] = {"$regex": f"^{re.escape(year)}-"}
    if status:
        query["status"] = status
    return await db.hr_payroll_runs.find(query, {"_id": 0}).sort([("competence", -1), ("run_type", 1)]).to_list(None)


@api_router.post("/hr/payroll-runs")
async def create_run(data: HRPayrollRunCreate, current_user: dict = Depends(get_current_admin_user)):
    if not COMPETENCE_RX.match(data.competence or ""):
        raise HTTPException(status_code=400, detail="Competência inválida (use AAAA-MM)")
    if data.run_type not in RUN_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de folha inválido")
    if await db.hr_payroll_runs.find_one({"competence": data.competence, "run_type": data.run_type}, {"_id": 1}):
        raise HTTPException(status_code=400, detail=f"Já existe {RUN_TYPES[data.run_type].lower()} para essa competência")
    if data.run_type == "DECIMO_2":
        year = data.competence[:4]
        first = await db.hr_payroll_runs.find_one({"run_type": "DECIMO_1", "competence": {"$regex": f"^{year}-"}}, {"_id": 0, "status": 1})
        if first and first["status"] == "ABERTA":
            raise HTTPException(status_code=400, detail="Feche a folha da 1ª parcela do 13º antes de gerar a 2ª")
    payment = _valid_iso_date(data.payment_date, "Data de pagamento") if _clean(data.payment_date) else None
    run = {"id": str(uuid.uuid4()), "competence": data.competence, "run_type": data.run_type, "status": "ABERTA",
           "payment_date": payment, "paid_at": None, "observations": _clean(data.observations), "totals": {},
           "created_by_name": current_user["name"], "created_at": _now_iso()}
    await db.hr_payroll_runs.insert_one(run)
    run.pop("_id", None)
    await _sync_run(run)
    return await _get_run(run["id"])


@api_router.get("/hr/payroll-runs/{run_id}")
async def read_run(run_id: str, current_user: dict = Depends(get_current_admin_user)):
    run = await _get_run(run_id)
    slips = await db.hr_payslips.find({"run_id": run_id}, {"_id": 0}).to_list(None)
    run["payslips"] = sorted(slips, key=lambda p: (p.get("person_name") or "").lower())
    return run


@api_router.delete("/hr/payroll-runs/{run_id}")
async def delete_run(run_id: str, current_user: dict = Depends(get_current_admin_user)):
    run = await _get_run(run_id)
    _require_open(run)
    await db.hr_payslips.delete_many({"run_id": run_id})
    await db.hr_payroll_runs.delete_one({"id": run_id})
    return {"message": "Folha excluída"}


@api_router.post("/hr/payroll-runs/{run_id}/recalculate")
async def recalculate_run(run_id: str, current_user: dict = Depends(get_current_admin_user)):
    run = await _get_run(run_id)
    _require_open(run)
    await _sync_run(run)
    return await read_run(run_id, current_user)


@api_router.post("/hr/payroll-runs/{run_id}/close")
async def close_run(run_id: str, current_user: dict = Depends(get_current_admin_user)):
    run = await _get_run(run_id)
    _require_open(run)
    if not await db.hr_payslips.count_documents({"run_id": run_id}):
        raise HTTPException(status_code=400, detail="A folha não tem contracheques")
    await db.hr_payroll_runs.update_one({"id": run_id}, {"$set": {"status": "FECHADA", "closed_by_name": current_user["name"],
                                                                 "closed_at": _now_iso(), "updated_at": _now_iso()}})
    return await _get_run(run_id)


@api_router.post("/hr/payroll-runs/{run_id}/reopen")
async def reopen_run(run_id: str, current_user: dict = Depends(get_current_admin_user)):
    run = await _get_run(run_id)
    if run["status"] != "FECHADA":
        raise HTTPException(status_code=400, detail="Só uma folha Fechada pode ser reaberta (estorne o pagamento antes)")
    if run["run_type"] == "DECIMO_1":
        year = run["competence"][:4]
        if await db.hr_payroll_runs.find_one({"run_type": "DECIMO_2", "competence": {"$regex": f"^{year}-"}}, {"_id": 1}):
            raise HTTPException(status_code=400, detail="A 2ª parcela do 13º já desconta esta folha: exclua-a antes de reabrir")
    await db.hr_payroll_runs.update_one({"id": run_id}, {"$set": {"status": "ABERTA", "updated_at": _now_iso()}})
    return await _get_run(run_id)


@api_router.post("/hr/payroll-runs/{run_id}/pay")
async def pay_run(run_id: str, data: HRPayrollPay, current_user: dict = Depends(get_current_admin_user)):
    run = await _get_run(run_id)
    if run["status"] != "FECHADA":
        raise HTTPException(status_code=400, detail="Feche a folha antes de registrar o pagamento")
    paid_at = _valid_iso_date(data.payment_date, "Data do pagamento")
    await db.hr_payroll_runs.update_one({"id": run_id}, {"$set": {"status": "PAGA", "paid_at": paid_at, "payment_date": paid_at,
                                                                 "paid_by_name": current_user["name"], "updated_at": _now_iso()}})
    return await _get_run(run_id)


@api_router.post("/hr/payroll-runs/{run_id}/unpay")
async def unpay_run(run_id: str, current_user: dict = Depends(get_current_admin_user)):
    run = await _get_run(run_id)
    if run["status"] != "PAGA":
        raise HTTPException(status_code=400, detail="A folha não está paga")
    await db.hr_payroll_runs.update_one({"id": run_id}, {"$set": {"status": "FECHADA", "paid_at": None, "paid_by_name": None,
                                                                 "updated_at": _now_iso()}})
    return await _get_run(run_id)


# ---------------------------------------------------------------- Contracheques

@api_router.put("/hr/payslips/{payslip_id}")
async def update_payslip(payslip_id: str, data: HRPayslipInputs, current_user: dict = Depends(get_current_admin_user)):
    slip = await db.hr_payslips.find_one({"id": payslip_id}, {"_id": 0})
    if not slip:
        raise HTTPException(status_code=404, detail="Contracheque não encontrado")
    run = await _get_run(slip["run_id"])
    _require_open(run)
    contract = await db.hr_contracts.find_one({"id": slip["contract_id"]}, {"_id": 0})
    if not contract:
        raise HTTPException(status_code=400, detail="Contrato do contracheque não existe mais")
    inputs = []
    for item in data.inputs:
        if item.code not in MANUAL_EVENT_CODES:
            raise HTTPException(status_code=400, detail=f"Lançamento inválido: {item.code}")
        entry = EVENTS[item.code][3]
        amount = item.value if entry == "VALUE" else item.quantity
        if amount is None or amount <= 0:
            raise HTTPException(status_code=400, detail=f"{EVENTS[item.code][1]}: informe {'o valor' if entry == 'VALUE' else 'a quantidade'}")
        inputs.append({"code": item.code, "quantity": item.quantity if entry != "VALUE" else None,
                       "value": r2(item.value) if entry == "VALUE" else None, "description": _clean(item.description)})
    if data.days_worked is not None and not 0 <= data.days_worked <= 30:
        raise HTTPException(status_code=400, detail="Dias trabalhados: de 0 a 30")
    calc = await _calc_payslip(run, contract, await load_payroll_settings(), inputs, data.days_worked)
    await db.hr_payslips.update_one({"id": payslip_id}, {"$set": {**_payslip_snapshot(contract), **calc, "inputs": inputs,
                                                                 "observations": _clean(data.observations), "updated_at": _now_iso()}})
    await _refresh_run_totals(run["id"])
    return await db.hr_payslips.find_one({"id": payslip_id}, {"_id": 0})


@api_router.get("/hr/payslips/pdf")
async def payslips_pdf(ids: Optional[str] = Query(None, description="IDs separados por vírgula"), run_id: Optional[str] = None,
                       current_user: dict = Depends(get_current_admin_user)):
    """Contracheques em PDF (2 vias por página): os selecionados ou a folha inteira."""
    from hr_reports import generate_payslips_pdf
    if ids:
        id_list = [i for i in ids.split(",") if i]
        slips = await db.hr_payslips.find({"id": {"$in": id_list}}, {"_id": 0}).to_list(None)
        if len(slips) != len(set(id_list)):
            raise HTTPException(status_code=404, detail="Um ou mais contracheques não foram encontrados")
    elif run_id:
        slips = await db.hr_payslips.find({"run_id": run_id}, {"_id": 0}).to_list(None)
    else:
        raise HTTPException(status_code=400, detail="Informe os contracheques ou a folha")
    if not slips:
        raise HTTPException(status_code=400, detail="Nenhum contracheque para imprimir")
    runs = {r["id"]: r for r in await db.hr_payroll_runs.find({"id": {"$in": list({s["run_id"] for s in slips})}}, {"_id": 0}).to_list(None)}
    slips.sort(key=lambda s: (s["competence"], (s.get("person_name") or "").lower()))
    company = merge_company(await get_company_settings())
    pdf = generate_payslips_pdf(slips, runs, company)
    first = slips[0]
    name = first.get("person_name") if len(slips) == 1 else f"{len(slips)}_funcionarios"
    return pdf_stream(pdf, f"Contracheque_{first['competence']}_{name}.pdf")
