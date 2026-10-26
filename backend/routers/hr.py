"""RH - Cargos e Salários, Admissão/Contratos (com desligamento e simulação
da rescisão), Férias, Ocorrências, Banco de Horas, Documentos/ASO, o Painel
do RH e os relatórios. A folha de pagamento fica em routers/payroll.py.

Todo registro do RH aponta para um contrato (hr_contracts), que liga a
pessoa (Funcionário ou Motorista do Cadastro) ao cargo, salário e dados
contratuais. Só administradores acessam: há salários em todas as telas."""
import io
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from hr_payroll import (
    CONTRACT_TYPES, MANUAL_EVENT_CODES, NOTICE_TYPES, TERMINATION_TYPES, VARIABLE_EVENT_CODES, add_months, age_on,
    compute_termination, compute_vacation, employer_charges, merge_settings, overlap_days, parse_day, r2, time_bank_status,
    vacation_periods,
)
from models import (
    HRContractCreate, HRDocumentCreate, HRExperienceExtension, HROccurrenceCreate, HRPositionCreate, HRSalaryAdvanceBulk, HRTermination,
    HRTimeBankCreate, HRVacationCreate, HRPayrollPay,
)
from period_reports import Column, Section, MONEY, DAY, INT, pdf_response, excel_response, period_text
from reports import format_currency, merge_company, today_brt
from routers.movements import _parse_filter_day
from routers.stock import _valid_iso_date
from shared import (
    ALLOWED_RECEIPT_EXTENSIONS, UPLOADS_DIR, db, get_current_admin_user, get_company_settings, validate_and_read_upload,
)

api_router = APIRouter(prefix="/api")

PERSON_COLLECTIONS = {"MOTORISTA": "drivers", "FUNCIONARIO": "employees"}
CONTRACT_STATUS = {"ATIVO": "Ativo", "AFASTADO": "Afastado", "DESLIGADO": "Desligado"}
OCCURRENCE_TYPES = {
    "ADVERTENCIA": "Advertência",
    "SUSPENSAO": "Suspensão",
    "ATESTADO": "Atestado médico",
    "FALTA_JUSTIFICADA": "Falta justificada",
    "FALTA_INJUSTIFICADA": "Falta injustificada",
    "AFASTAMENTO_INSS": "Afastamento (INSS)",
    "ACIDENTE_TRABALHO": "Acidente de trabalho",
    "LICENCA_MATERNIDADE": "Licença-maternidade",
    "LICENCA_PATERNIDADE": "Licença-paternidade",
    "ELOGIO": "Elogio / reconhecimento",
    "OUTRO": "Outro",
}
# Ocorrências que descontam dias na folha do mês
PAYROLL_ABSENCE_TYPES = ("FALTA_INJUSTIFICADA", "SUSPENSAO")
# Afastamentos em que a empresa paga só os 15 primeiros dias
LEAVE_TYPES = ("AFASTAMENTO_INSS", "ACIDENTE_TRABALHO")
DOCUMENT_TYPES = {
    "ASO_ADMISSIONAL": "ASO admissional",
    "ASO_PERIODICO": "ASO periódico",
    "ASO_RETORNO": "ASO de retorno ao trabalho",
    "ASO_MUDANCA_FUNCAO": "ASO de mudança de função",
    "ASO_DEMISSIONAL": "ASO demissional",
    "EXAME_COMPLEMENTAR": "Exame complementar",
    "TREINAMENTO_NR": "Treinamento / NR",
    "CNH": "CNH",
    "CERTIFICADO": "Certificado / curso",
    "CONTRATO": "Contrato / termo assinado",
    "OUTRO": "Outro",
}
VACATION_STATUS = {"PROGRAMADA": "Programada", "PAGA": "Paga", "CANCELADA": "Cancelada"}
DOC_ALERT_DAYS = 30


def _clean(value) -> Optional[str]:
    value = (value or "").strip() if isinstance(value, str) else value
    return value or None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> date:
    return today_brt().date()


async def next_number(name: str) -> int:
    result = await db.counters.find_one_and_update({"_id": name}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
    return result["seq"]


def _rx(text: str) -> dict:
    return {"$regex": re.escape(text.strip()), "$options": "i"}


def _period_query(field: str, date_from: Optional[str], date_to: Optional[str]) -> dict:
    period = {}
    if date_from:
        period["$gte"] = _parse_filter_day(date_from, "date_from").isoformat()
    if date_to:
        period["$lte"] = _parse_filter_day(date_to, "date_to").isoformat()
    return {field: period} if period else {}


def pdf_stream(pdf_bytes: bytes, filename: str) -> StreamingResponse:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", filename)
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={safe}"})


@api_router.post("/hr/uploads")
async def upload_hr_file(file: UploadFile = File(...), current_user: dict = Depends(get_current_admin_user)):
    """Anexos do RH (atestado, ASO, termo assinado): imagem ou PDF."""
    ext, content = await validate_and_read_upload(file, ALLOWED_RECEIPT_EXTENSIONS)
    name = f"rh_{uuid.uuid4()}{ext}"
    (UPLOADS_DIR / name).write_bytes(content)
    return {"filename": name, "url": f"/api/uploads/{name}"}


# ---------------------------------------------------------------- Tabelas de cálculo

async def load_payroll_settings() -> dict:
    stored = await db.hr_payroll_settings.find_one({"id": "default"}, {"_id": 0})
    return merge_settings(stored)


async def variable_average(contract_id: str, first_competence: str, last_competence: str) -> float:
    """Média mensal das variáveis (horas extras, adicional noturno, DSR,
    comissões) nos contracheques mensais de folhas fechadas/pagas entre as
    competências: o total dividido pelos meses que tiveram contracheque."""
    runs = {r["id"] for r in await db.hr_payroll_runs.find(
        {"run_type": "MENSAL", "status": {"$ne": "ABERTA"}, "competence": {"$gte": first_competence, "$lte": last_competence}},
        {"_id": 0, "id": 1}).to_list(None)}
    if not runs:
        return 0.0
    slips = await db.hr_payslips.find({"contract_id": contract_id, "run_id": {"$in": list(runs)}}, {"_id": 0, "events": 1}).to_list(None)
    if not slips:
        return 0.0
    total = sum(e["value"] for s in slips for e in s.get("events") or [] if e.get("code") in VARIABLE_EVENT_CODES)
    return r2(total / len(slips))


async def salary_advance_paid(contract_id: str, competence: str) -> float:
    """Adiantamento quinzenal da competência já pago (folha de adiantamento fechada ou paga)."""
    runs = [r["id"] for r in await db.hr_payroll_runs.find(
        {"run_type": "ADIANTAMENTO", "competence": competence, "status": {"$ne": "ABERTA"}}, {"_id": 0, "id": 1}).to_list(None)]
    if not runs:
        return 0.0
    slips = await db.hr_payslips.find({"contract_id": contract_id, "run_id": {"$in": runs}}, {"_id": 0, "totals": 1}).to_list(None)
    return r2(sum((p.get("totals") or {}).get("gross") or 0 for p in slips))


def competence_window(day: date, months: int) -> tuple:
    """As `months` competências fechadas antes do mês de `day` (AAAA-MM)."""
    last = add_months(date(day.year, day.month, 1), -1)
    first = add_months(last, -(months - 1))
    return first.strftime("%Y-%m"), last.strftime("%Y-%m")


async def leave_ranges(contract_id: str) -> list:
    """Afastamentos pelo INSS (doença/acidente): os dias depois do 15º, que o
    INSS paga - não contam para os avos do 13º. Sem data final, até hoje+5 anos."""
    out = []
    for o in await db.hr_occurrences.find({"contract_id": contract_id, "occurrence_type": {"$in": list(LEAVE_TYPES)}},
                                          {"_id": 0, "start_date": 1, "end_date": 1}).to_list(None):
        start = parse_day(o.get("start_date"))
        if not start:
            continue
        end = parse_day(o.get("end_date")) or date(_today().year + 5, 12, 31)
        if end >= start + timedelta(days=15):
            out.append(((start + timedelta(days=15)).isoformat(), end.isoformat()))
    return out


# ---------------------------------------------------------------- Cargos e Salários

def _validate_position(data: HRPositionCreate) -> dict:
    name = _clean(data.name)
    if not name:
        raise HTTPException(status_code=400, detail="Informe o nome do cargo")
    for label, value in (("mínimo", data.salary_min), ("máximo", data.salary_max)):
        if value is not None and value < 0:
            raise HTTPException(status_code=400, detail=f"Salário {label} inválido")
    if data.salary_min and data.salary_max and data.salary_min > data.salary_max:
        raise HTTPException(status_code=400, detail="O salário mínimo da faixa é maior que o máximo")
    if data.status not in ("ATIVO", "INATIVO"):
        raise HTTPException(status_code=400, detail="Status inválido")
    return {
        "name": name, "department": _clean(data.department), "cbo": _clean(data.cbo),
        "salary_min": r2(data.salary_min) if data.salary_min is not None else None,
        "salary_max": r2(data.salary_max) if data.salary_max is not None else None,
        "description": _clean(data.description), "status": data.status,
    }


async def _refuse_duplicate_position(name: str, current_id: Optional[str]):
    query = {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}
    if current_id:
        query["id"] = {"$ne": current_id}
    if await db.hr_positions.find_one(query, {"_id": 1}):
        raise HTTPException(status_code=400, detail=f"O cargo {name} já está cadastrado")


@api_router.get("/hr/positions")
async def list_positions(search: Optional[str] = None, status: Optional[str] = None,
                         current_user: dict = Depends(get_current_admin_user)):
    query = {}
    if search and search.strip():
        query["$or"] = [{"name": _rx(search)}, {"department": _rx(search)}, {"cbo": _rx(search)}]
    if status:
        query["status"] = status
    rows = await db.hr_positions.find(query, {"_id": 0}).to_list(None)
    counts = {}
    for c in await db.hr_contracts.find({"status": {"$ne": "DESLIGADO"}}, {"_id": 0, "position_id": 1}).to_list(None):
        counts[c.get("position_id")] = counts.get(c.get("position_id"), 0) + 1
    for row in rows:
        row["active_contracts"] = counts.get(row["id"], 0)
    return sorted(rows, key=lambda r: r["name"].lower())


@api_router.post("/hr/positions")
async def create_position(data: HRPositionCreate, current_user: dict = Depends(get_current_admin_user)):
    fields = _validate_position(data)
    await _refuse_duplicate_position(fields["name"], None)
    doc = {"id": str(uuid.uuid4()), **fields, "created_by_name": current_user["name"], "created_at": _now_iso()}
    await db.hr_positions.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/hr/positions/{position_id}")
async def update_position(position_id: str, data: HRPositionCreate, current_user: dict = Depends(get_current_admin_user)):
    current = await db.hr_positions.find_one({"id": position_id}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Cargo não encontrado")
    fields = _validate_position(data)
    await _refuse_duplicate_position(fields["name"], position_id)
    fields["updated_at"] = _now_iso()
    await db.hr_positions.update_one({"id": position_id}, {"$set": fields})
    if fields["name"] != current["name"]:
        await db.hr_contracts.update_many({"position_id": position_id}, {"$set": {"position_name": fields["name"]}})
    return await db.hr_positions.find_one({"id": position_id}, {"_id": 0})


@api_router.delete("/hr/positions/{position_id}")
async def delete_position(position_id: str, current_user: dict = Depends(get_current_admin_user)):
    if await db.hr_contracts.find_one({"position_id": position_id}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Cargo usado em contratos: em vez de excluir, mude o status para Inativo")
    result = await db.hr_positions.delete_one({"id": position_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Cargo não encontrado")
    return {"message": "Cargo excluído"}


# ---------------------------------------------------------------- Contratos (Admissão)

async def get_contract(contract_id: str) -> dict:
    contract = await db.hr_contracts.find_one({"id": contract_id}, {"_id": 0})
    if not contract:
        raise HTTPException(status_code=404, detail="Contrato não encontrado")
    return contract


async def get_person(person_type: str, person_id: str) -> Optional[dict]:
    collection = PERSON_COLLECTIONS.get(person_type)
    return await db[collection].find_one({"id": person_id}, {"_id": 0}) if collection else None


def contract_snapshot(contract: dict) -> dict:
    """Dados da pessoa/contrato copiados em cada lançamento do RH (o registro
    continua legível mesmo se o cadastro mudar)."""
    return {
        "contract_id": contract["id"], "contract_number": contract.get("contract_number"),
        "person_type": contract["person_type"], "person_id": contract["person_id"],
        "person_name": contract.get("person_name"), "person_cpf": contract.get("person_cpf"),
        "position_name": contract.get("position_name"), "department": contract.get("department"),
    }


def contract_ctx(contract: dict, settings: dict, on_day: date) -> dict:
    """Entrada dos cálculos de hr_payroll a partir do contrato."""
    deps = contract.get("dependents") or []
    children = 0
    for d in deps:
        age = age_on(d.get("birth_date"), on_day)
        if d.get("family_allowance") and (age is None or age < 14):
            children += 1
    return {
        "base_salary": contract.get("base_salary") or 0,
        "contract_type": contract.get("contract_type") or "CLT",
        "insalubridade_grade": contract.get("insalubridade_grade") or 0,
        "periculosidade": bool(contract.get("periculosidade")),
        "vt_opt_in": bool(contract.get("vt_opt_in")),
        "vt_monthly_cost": contract.get("vt_monthly_cost"),
        "irrf_dependents": sum(1 for d in deps if d.get("irrf")),
        "service_bonus_rate": sum(float(e.get("quantity") or 0) for e in contract.get("recurring_events") or []
                                  if e.get("code") == "PREMIO_TEMPO_SERVICO"),
        "family_children": children,
        "admission_date": contract.get("admission_date"),
    }


async def _validate_contract(data: HRContractCreate, current_id: Optional[str]) -> dict:
    person = await get_person(data.person_type, data.person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Funcionário/Motorista não encontrado")
    other = {"person_type": data.person_type, "person_id": data.person_id, "status": {"$ne": "DESLIGADO"}}
    if current_id:
        other["id"] = {"$ne": current_id}
    if await db.hr_contracts.find_one(other, {"_id": 1}):
        raise HTTPException(status_code=400, detail=f"{person.get('name')} já tem um contrato ativo: desligue-o antes de uma nova admissão")
    if data.contract_type not in CONTRACT_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de contrato inválido")
    if not data.base_salary or data.base_salary <= 0:
        raise HTTPException(status_code=400, detail="Informe o salário")
    if data.experience_days < 0 or data.experience_days > 90:
        raise HTTPException(status_code=400, detail="O contrato de experiência vai de 0 a 90 dias")
    if data.contract_type == "EXPERIENCIA" and not data.experience_days:
        raise HTTPException(status_code=400, detail="Informe os dias do contrato de experiência (até 90)")
    if data.insalubridade_grade not in (0, 10, 20, 40):
        raise HTTPException(status_code=400, detail="Insalubridade: grau 10, 20 ou 40%")
    if data.vt_monthly_cost is not None and data.vt_monthly_cost < 0:
        raise HTTPException(status_code=400, detail="Custo do vale-transporte inválido")
    position = None
    if data.position_id:
        position = await db.hr_positions.find_one({"id": data.position_id}, {"_id": 0})
        if not position:
            raise HTTPException(status_code=400, detail="Cargo não encontrado")
    admission = _valid_iso_date(data.admission_date, "Data de admissão")
    recurring = []
    for ev in data.recurring_events:
        if ev.code not in MANUAL_EVENT_CODES:
            raise HTTPException(status_code=400, detail=f"Lançamento fixo inválido: {ev.code}")
        if ev.code == "PREMIO_TEMPO_SERVICO" and not 0 < (ev.quantity or 0) <= 100:
            raise HTTPException(status_code=400, detail="Prêmio por tempo de serviço: informe o percentual (até 100%)")
        recurring.append({"code": ev.code, "quantity": ev.quantity, "value": ev.value, "description": _clean(ev.description)})
    dependents = []
    for d in data.dependents:
        if not _clean(d.name):
            raise HTTPException(status_code=400, detail="Informe o nome de cada dependente")
        birth = _valid_iso_date(d.birth_date, f"Nascimento de {d.name}") if _clean(d.birth_date) else None
        dependents.append({"name": d.name.strip(), "cpf": _clean(d.cpf), "birth_date": birth,
                           "relationship": _clean(d.relationship), "irrf": d.irrf, "family_allowance": d.family_allowance})
    settled = _valid_iso_date(data.vacation_settled_until, "Férias quitadas até") if _clean(data.vacation_settled_until) else None
    experience_end = None
    if data.experience_days:
        experience_end = (date.fromisoformat(admission) + timedelta(days=data.experience_days - 1)).isoformat()
    return {
        "person_type": data.person_type, "person_id": data.person_id,
        "person_name": person.get("name") or "", "person_cpf": person.get("cpf"),
        "position_id": position["id"] if position else None,
        "position_name": position["name"] if position else None,
        "cbo": position.get("cbo") if position else None,
        "department": _clean(data.department) or (position.get("department") if position else None),
        "contract_type": data.contract_type, "admission_date": admission,
        "experience_days": data.experience_days, "experience_end": experience_end,
        "base_salary": r2(data.base_salary), "weekly_hours": data.weekly_hours, "work_schedule": _clean(data.work_schedule),
        "insalubridade_grade": data.insalubridade_grade, "periculosidade": data.periculosidade,
        "vt_opt_in": data.vt_opt_in, "vt_monthly_cost": r2(data.vt_monthly_cost) if data.vt_monthly_cost else None,
        "salary_advance": data.salary_advance,
        "pis": _clean(data.pis), "ctps_number": _clean(data.ctps_number), "ctps_series": _clean(data.ctps_series),
        "bank_name": _clean(data.bank_name), "bank_agency": _clean(data.bank_agency), "bank_account": _clean(data.bank_account),
        "pix_key": _clean(data.pix_key), "dependents": dependents, "recurring_events": recurring,
        "vacation_settled_until": settled, "observations": _clean(data.observations),
    }


async def _sync_employee(contract: dict, status: str):
    """O cadastro acompanha o contrato: Funcionário (cargo, setor, admissão,
    status); Motorista afastado ou desligado fica Inativo (não é escalado) e
    volta a Ativo no retorno - um motorista Bloqueado continua bloqueado."""
    if contract["person_type"] == "MOTORISTA":
        if status == "ATIVO":
            await db.drivers.update_one({"id": contract["person_id"], "status": "INATIVO"}, {"$set": {"status": "ATIVO"}})
        else:
            await db.drivers.update_one({"id": contract["person_id"], "status": {"$ne": "BLOQUEADO"}}, {"$set": {"status": "INATIVO"}})
        return
    if contract["person_type"] != "FUNCIONARIO":
        return
    await db.employees.update_one({"id": contract["person_id"]}, {"$set": {
        "position": contract.get("position_name"), "department": contract.get("department"),
        "admission_date": contract.get("admission_date"), "status": status,
    }})


@api_router.get("/hr/contracts")
async def list_contracts(
    search: Optional[str] = None, status: Optional[str] = None, department: Optional[str] = None,
    contract_type: Optional[str] = None, position_id: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user),
):
    query = {}
    if search and search.strip():
        query["$or"] = [{"person_name": _rx(search)}, {"person_cpf": _rx(search)}, {"position_name": _rx(search)}]
    if status == "VIGENTE":
        query["status"] = {"$ne": "DESLIGADO"}
    elif status:
        query["status"] = status
    if department:
        query["department"] = {"$regex": f"^{re.escape(department.strip())}$", "$options": "i"}
    if contract_type:
        query["contract_type"] = contract_type
    if position_id:
        query["position_id"] = position_id
    rows = await db.hr_contracts.find(query, {"_id": 0}).to_list(None)
    return sorted(rows, key=lambda r: ((r.get("status") == "DESLIGADO"), (r.get("person_name") or "").lower()))


@api_router.get("/hr/contracts/{contract_id}")
async def read_contract(contract_id: str, current_user: dict = Depends(get_current_admin_user)):
    return await get_contract(contract_id)


@api_router.post("/hr/contracts")
async def create_contract(data: HRContractCreate, current_user: dict = Depends(get_current_admin_user)):
    fields = await _validate_contract(data, None)
    doc = {
        "id": str(uuid.uuid4()), "contract_number": await next_number("hr_contract_number"), **fields,
        "status": "ATIVO", "termination": None,
        "created_by": current_user["sub"], "created_by_name": current_user["name"], "created_at": _now_iso(),
    }
    await db.hr_contracts.insert_one(doc)
    doc.pop("_id", None)
    await _sync_employee(doc, "ATIVO")
    return doc


@api_router.put("/hr/contracts/{contract_id}")
async def update_contract(contract_id: str, data: HRContractCreate, current_user: dict = Depends(get_current_admin_user)):
    current = await get_contract(contract_id)
    if current["status"] == "DESLIGADO":
        raise HTTPException(status_code=400, detail="Contrato desligado não pode ser editado: desfaça o desligamento antes")
    if (data.person_type, data.person_id) != (current["person_type"], current["person_id"]):
        raise HTTPException(status_code=400, detail="A pessoa do contrato não pode ser trocada: faça uma nova admissão")
    fields = await _validate_contract(data, contract_id)
    if current.get("experience_initial_days") and fields["experience_days"] != current.get("experience_days"):
        raise HTTPException(status_code=400, detail="A experiência já foi prorrogada: o prazo não muda mais")
    fields["updated_at"] = _now_iso()
    await db.hr_contracts.update_one({"id": contract_id}, {"$set": fields})
    updated = await get_contract(contract_id)
    await _sync_employee(updated, updated["status"])
    # o nome/cargo exibidos nos lançamentos ainda abertos acompanham o contrato
    snapshot = {k: v for k, v in contract_snapshot(updated).items() if k in ("person_name", "person_cpf", "position_name", "department")}
    for collection in ("hr_occurrences", "hr_documents", "hr_time_bank"):
        await db[collection].update_many({"contract_id": contract_id}, {"$set": snapshot})
    await db.hr_vacations.update_many({"contract_id": contract_id, "status": "PROGRAMADA"}, {"$set": snapshot})
    await _recalc_programmed_vacations(updated)
    return updated


@api_router.delete("/hr/contracts/{contract_id}")
async def delete_contract(contract_id: str, current_user: dict = Depends(get_current_admin_user)):
    await get_contract(contract_id)
    used = []
    for collection, label in (("hr_payslips", "contracheque(s)"), ("hr_vacations", "férias"), ("hr_occurrences", "ocorrência(s)"),
                              ("hr_time_bank", "lançamento(s) de banco de horas"), ("hr_documents", "documento(s)")):
        count = await db[collection].count_documents({"contract_id": contract_id})
        if count:
            used.append(f"{count} {label}")
    if used:
        raise HTTPException(status_code=400, detail=f"Contrato com histórico ({', '.join(used)}): em vez de excluir, registre o desligamento")
    await db.hr_contracts.delete_one({"id": contract_id})
    return {"message": "Contrato excluído"}


@api_router.put("/hr/contracts-salary-advance")
async def set_salary_advance(data: HRSalaryAdvanceBulk, current_user: dict = Depends(get_current_admin_user)):
    """Liga/desliga o adiantamento quinzenal de vários contratos de uma vez."""
    if not data.contract_ids:
        raise HTTPException(status_code=400, detail="Selecione os contratos")
    result = await db.hr_contracts.update_many({"id": {"$in": data.contract_ids}, "status": {"$ne": "DESLIGADO"}},
                                               {"$set": {"salary_advance": data.enabled, "updated_at": _now_iso()}})
    return {"updated": result.modified_count, "matched": result.matched_count}


@api_router.post("/hr/contracts/{contract_id}/extend-experience")
async def extend_experience(contract_id: str, data: HRExperienceExtension, current_user: dict = Depends(get_current_admin_user)):
    """Prorroga a experiência uma única vez, antes do fim, até 90 dias no total
    (arts. 445 e 451 da CLT). O prazo inicial fica guardado para o contrato e o
    termo de prorrogação em PDF."""
    contract = await get_contract(contract_id)
    days = int(contract.get("experience_days") or 0)
    if contract["status"] == "DESLIGADO" or not days:
        raise HTTPException(status_code=400, detail="O contrato não está em experiência")
    if contract.get("experience_initial_days"):
        raise HTTPException(status_code=400, detail="A experiência só pode ser prorrogada uma vez")
    if _today() > date.fromisoformat(contract["experience_end"]):
        raise HTTPException(status_code=400, detail="A experiência já terminou: o contrato passou a prazo indeterminado")
    if data.total_days <= days or data.total_days > 90:
        raise HTTPException(status_code=400, detail=f"O novo prazo total vai de {days + 1} a 90 dias")
    end = (date.fromisoformat(contract["admission_date"]) + timedelta(days=data.total_days - 1)).isoformat()
    await db.hr_contracts.update_one({"id": contract_id}, {"$set": {
        "experience_initial_days": days, "experience_days": data.total_days, "experience_end": end,
        "experience_extended_at": _now_iso(), "experience_extended_by_name": current_user["name"], "updated_at": _now_iso()}})
    return await get_contract(contract_id)


@api_router.put("/hr/contracts/{contract_id}/status")
async def update_contract_status(contract_id: str, status: str = Query(..., pattern="^(ATIVO|AFASTADO)$"),
                                 current_user: dict = Depends(get_current_admin_user)):
    """Afastar / retornar ao trabalho. Desligar só pelo /terminate."""
    current = await get_contract(contract_id)
    if current["status"] == "DESLIGADO":
        raise HTTPException(status_code=400, detail="Contrato desligado: desfaça o desligamento antes")
    await db.hr_contracts.update_one({"id": contract_id}, {"$set": {"status": status, "updated_at": _now_iso()}})
    await _sync_employee(current, status)
    return {"message": "Situação atualizada"}


async def _fgts_estimate(contract_id: str) -> float:
    """Saldo do FGTS estimado: o FGTS dos contracheques de folhas pagas e das férias pagas."""
    total = 0.0
    paid_runs = {r["id"] for r in await db.hr_payroll_runs.find({"status": "PAGA"}, {"_id": 0, "id": 1}).to_list(None)}
    for p in await db.hr_payslips.find({"contract_id": contract_id}, {"_id": 0, "run_id": 1, "totals": 1}).to_list(None):
        if p.get("run_id") in paid_runs:
            total += (p.get("totals") or {}).get("fgts") or 0
    for v in await db.hr_vacations.find({"contract_id": contract_id, "status": "PAGA"}, {"_id": 0, "calc": 1}).to_list(None):
        total += (v.get("calc") or {}).get("fgts") or 0
    return r2(total)


async def _vacation_state(contract: dict, until: date) -> list:
    used, absences = {}, {}
    for v in await db.hr_vacations.find({"contract_id": contract["id"], "status": {"$ne": "CANCELADA"}}, {"_id": 0}).to_list(None):
        used[v["acquisition_start"]] = used.get(v["acquisition_start"], 0) + (v.get("days") or 0) + (v.get("sell_days") or 0)
    occurrences = await db.hr_occurrences.find({"contract_id": contract["id"], "occurrence_type": "FALTA_INJUSTIFICADA"}, {"_id": 0}).to_list(None)
    settled = contract.get("vacation_settled_until")
    periods = vacation_periods(contract.get("admission_date"), until, used, {}, settled)
    for p in periods:
        first, last = date.fromisoformat(p["start"]), date.fromisoformat(p["end"])
        absences[p["start"]] = int(sum(occurrence_days_in(o, first, last) for o in occurrences))
    periods = vacation_periods(contract.get("admission_date"), until, used, absences, settled)
    # Art. 133, IV: mais de 6 meses de benefício do INSS no período aquisitivo
    # tira o direito às férias (o novo período começa na volta) - fica o aviso
    leaves = await leave_ranges(contract["id"])
    for p in periods:
        first, last = date.fromisoformat(p["start"]), min(date.fromisoformat(p["end"]), until)
        p["inss_leave_days"] = sum(overlap_days(parse_day(lo), parse_day(hi), first, last) for lo, hi in leaves)
        p["inss_leave_warning"] = p["inss_leave_days"] > 180
    return periods


def occurrence_days_in(occ: dict, first: date, last: date) -> float:
    """Dias da ocorrência dentro de [first, last]: pelo intervalo de datas
    quando tem fim; senão a quantidade informada, no dia de início."""
    start = parse_day(occ.get("start_date"))
    end = parse_day(occ.get("end_date"))
    if not start:
        return 0
    if end:
        return overlap_days(start, end, first, last)
    return (occ.get("days") or 1) if first <= start <= last else 0


async def termination_preview(contract: dict, data: HRTermination, settings: dict) -> dict:
    if data.termination_type not in TERMINATION_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de desligamento inválido")
    if data.notice_type not in NOTICE_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de aviso prévio inválido")
    end_iso = _valid_iso_date(data.termination_date, "Data do desligamento")
    end = date.fromisoformat(end_iso)
    if end < date.fromisoformat(contract["admission_date"]):
        raise HTTPException(status_code=400, detail="O desligamento é anterior à admissão")
    periods = await _vacation_state(contract, end)
    overdue = sum(p["balance"] for p in periods if p["complete"] and p["status"] != "VENCIDO")
    double = sum(p["balance"] for p in periods if p["complete"] and p["status"] == "VENCIDO")
    current = next((p for p in periods if not p["complete"]), None)
    first_13th = 0.0
    year_runs = {r["id"] for r in await db.hr_payroll_runs.find(
        {"run_type": "DECIMO_1", "competence": {"$regex": f"^{end.year}-"}, "status": {"$ne": "ABERTA"}},
        {"_id": 0, "id": 1}).to_list(None)}
    if year_runs:
        for p in await db.hr_payslips.find({"contract_id": contract["id"], "run_id": {"$in": list(year_runs)}}, {"_id": 0, "totals": 1}).to_list(None):
            first_13th += (p.get("totals") or {}).get("gross") or 0
    for v in await db.hr_vacations.find({"contract_id": contract["id"], "status": "PAGA", "advance_13th": True,
                                         "start_date": {"$regex": f"^{end.year}-"}}, {"_id": 0, "calc": 1}).to_list(None):
        first_13th += (v.get("calc") or {}).get("advance_13th") or 0
    fgts_balance = data.fgts_balance if data.fgts_balance is not None else await _fgts_estimate(contract["id"])
    ctx = {
        **contract_ctx(contract, settings, end),
        "termination_date": end_iso, "termination_type": data.termination_type, "notice_type": data.notice_type,
        "vacation_balance_days": overdue, "vacation_double_days": double,
        "current_period_start": current["start"] if current else None,
        "current_period_absences": current["absences"] if current else 0,
        "first_13th_paid": r2(first_13th), "fgts_balance": fgts_balance,
        "experience_end": contract.get("experience_end"),
        "variable_average": await variable_average(contract["id"], *competence_window(end, 12)),
        "salary_advance_paid": await salary_advance_paid(contract["id"], end.strftime("%Y-%m")),
        "leave_ranges": await leave_ranges(contract["id"]),
    }
    calc = compute_termination(ctx, settings)
    return {
        "termination_date": end_iso, "termination_type": data.termination_type,
        "termination_label": TERMINATION_TYPES[data.termination_type],
        "notice_type": data.notice_type, "notice_label": NOTICE_TYPES[data.notice_type],
        "reason": _clean(data.reason), "fgts_balance_informed": data.fgts_balance is not None,
        "calc": calc,
    }


@api_router.post("/hr/contracts/{contract_id}/terminate")
async def terminate_contract(contract_id: str, data: HRTermination, current_user: dict = Depends(get_current_admin_user)):
    """Simula a rescisão; com confirm=true registra o desligamento."""
    contract = await get_contract(contract_id)
    if contract["status"] == "DESLIGADO":
        raise HTTPException(status_code=400, detail="Contrato já desligado")
    preview = await termination_preview(contract, data, await load_payroll_settings())
    if not data.confirm:
        return preview
    termination = {**preview, "registered_by_name": current_user["name"], "registered_at": _now_iso()}
    await db.hr_contracts.update_one({"id": contract_id}, {"$set": {"status": "DESLIGADO", "termination": termination, "updated_at": _now_iso()}})
    await _sync_employee(contract, "DESLIGADO")
    # férias ainda não pagas deixam de valer: entram na rescisão
    await db.hr_vacations.update_many({"contract_id": contract_id, "status": "PROGRAMADA"},
                                      {"$set": {"status": "CANCELADA", "cancelled_by_termination": True, "updated_at": _now_iso()}})
    return await get_contract(contract_id)


@api_router.post("/hr/contracts/{contract_id}/reinstate")
async def reinstate_contract(contract_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Desfaz um desligamento registrado por engano."""
    contract = await get_contract(contract_id)
    if contract["status"] != "DESLIGADO":
        raise HTTPException(status_code=400, detail="O contrato não está desligado")
    other = await db.hr_contracts.find_one({"person_type": contract["person_type"], "person_id": contract["person_id"],
                                            "status": {"$ne": "DESLIGADO"}, "id": {"$ne": contract_id}}, {"_id": 1})
    if other:
        raise HTTPException(status_code=400, detail="A pessoa já tem outro contrato ativo")
    await db.hr_contracts.update_one({"id": contract_id}, {"$set": {"status": "ATIVO", "termination": None, "updated_at": _now_iso()}})
    await _sync_employee(contract, "ATIVO")
    # as férias que o desligamento cancelou voltam a valer
    await db.hr_vacations.update_many({"contract_id": contract_id, "status": "CANCELADA", "cancelled_by_termination": True},
                                      {"$set": {"status": "PROGRAMADA", "cancelled_by_termination": False, "updated_at": _now_iso()}})
    return await get_contract(contract_id)


@api_router.get("/hr/contracts/{contract_id}/termination/pdf")
async def termination_pdf(contract_id: str, current_user: dict = Depends(get_current_admin_user)):
    from hr_reports import generate_termination_pdf
    contract = await get_contract(contract_id)
    if not contract.get("termination"):
        raise HTTPException(status_code=400, detail="O contrato não tem desligamento registrado")
    company = merge_company(await get_company_settings())
    pdf = generate_termination_pdf(contract, contract["termination"], company)
    return pdf_stream(pdf, f"Rescisao_{contract.get('person_name') or 'contrato'}.pdf")


@api_router.get("/hr/contracts/{contract_id}/sheet/pdf")
async def contract_sheet_pdf(contract_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Ficha de registro do empregado."""
    from hr_reports import generate_employee_sheet_pdf
    contract = await get_contract(contract_id)
    person = await get_person(contract["person_type"], contract["person_id"]) or {}
    company = merge_company(await get_company_settings())
    pdf = generate_employee_sheet_pdf(contract, person, company)
    return pdf_stream(pdf, f"Ficha_{contract.get('person_name') or 'funcionario'}.pdf")


@api_router.get("/hr/contracts/{contract_id}/contract/pdf")
async def work_contract_pdf(contract_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Contrato de trabalho para assinatura (CLT por prazo indeterminado ou de experiência)."""
    from hr_reports import WORK_CONTRACT_TYPES, generate_work_contract_pdf
    contract = await get_contract(contract_id)
    if contract.get("contract_type") not in WORK_CONTRACT_TYPES:
        label = CONTRACT_TYPES.get(contract.get("contract_type"), contract.get("contract_type"))
        raise HTTPException(status_code=400, detail=f"Ainda não há modelo de contrato para o tipo {label} - só para CLT e CLT - Experiência")
    if contract.get("contract_type") == "EXPERIENCIA" and not contract.get("experience_days"):
        raise HTTPException(status_code=400, detail="Informe no contrato os dias de experiência (até 90)")
    person = await get_person(contract["person_type"], contract["person_id"]) or {}
    company = merge_company(await get_company_settings())
    pdf = generate_work_contract_pdf(contract, person, company)
    return pdf_stream(pdf, f"Contrato_{contract.get('person_name') or 'funcionario'}.pdf")


# ---------------------------------------------------------------- Férias

@api_router.get("/hr/vacation-balances")
async def vacation_balances(include_terminated: bool = False, current_user: dict = Depends(get_current_admin_user)):
    """Períodos aquisitivos de cada contrato: saldo, prazo de concessão e
    situação (vencido = passou do prazo sem gozar: férias em dobro)."""
    query = {} if include_terminated else {"status": {"$ne": "DESLIGADO"}}
    today = _today()
    out = []
    for c in await db.hr_contracts.find(query, {"_id": 0}).to_list(None):
        if c.get("contract_type") == "PJ":
            continue
        periods = await _vacation_state(c, today)
        open_periods = [p for p in periods if p["complete"] and p["balance"] > 0]
        out.append({
            **contract_snapshot(c), "admission_date": c.get("admission_date"), "status": c.get("status"),
            "periods": periods,
            "overdue": sum(1 for p in open_periods if p["status"] == "VENCIDO"),
            "due_soon": sum(1 for p in open_periods if p["status"] == "A_VENCER"),
            "available_days": sum(p["balance"] for p in open_periods),
            "next_deadline": min((p["deadline"] for p in open_periods), default=None),
        })
    return sorted(out, key=lambda r: (-r["overdue"], -r["due_soon"], r["next_deadline"] or "9999", (r["person_name"] or "").lower()))


async def _validate_vacation(data: HRVacationCreate, current_id: Optional[str]) -> tuple:
    contract = await get_contract(data.contract_id)
    if contract["status"] == "DESLIGADO":
        raise HTTPException(status_code=400, detail="Contrato desligado: as férias entram na rescisão")
    if contract.get("contract_type") == "PJ":
        raise HTTPException(status_code=400, detail="Contrato PJ não tem férias CLT")
    start = date.fromisoformat(_valid_iso_date(data.start_date, "Início das férias"))
    acquisition = _valid_iso_date(data.acquisition_start, "Período aquisitivo")
    if data.days < 5 or data.days > 30:
        raise HTTPException(status_code=400, detail="Cada período de férias tem de 5 a 30 dias")
    if data.sell_days < 0 or data.sell_days > 10:
        raise HTTPException(status_code=400, detail="O abono pecuniário é de até 10 dias (1/3 das férias)")
    periods = await _vacation_state(contract, max(_today(), start))
    period = next((p for p in periods if p["start"] == acquisition), None)
    if not period:
        raise HTTPException(status_code=400, detail="Período aquisitivo não encontrado para esse contrato")
    if not period["complete"]:
        raise HTTPException(status_code=400, detail="O período aquisitivo ainda não terminou (férias antecipadas não são lançadas aqui)")
    if start <= date.fromisoformat(period["end"]):
        raise HTTPException(status_code=400, detail="As férias começam depois do fim do período aquisitivo")
    already = period["used"]
    if current_id:
        mine = await db.hr_vacations.find_one({"id": current_id}, {"_id": 0})
        if mine and mine.get("acquisition_start") == acquisition and mine.get("status") != "CANCELADA":
            already -= (mine.get("days") or 0) + (mine.get("sell_days") or 0)
    if already + data.days + data.sell_days > period["entitled"]:
        left = period["entitled"] - already
        raise HTTPException(status_code=400, detail=f"Saldo do período: {left} dia(s) (direito de {period['entitled']} dias)")
    # Art. 143: abono de até 1/3 do direito; art. 134, § 1º: até 3 períodos,
    # um deles com 14 dias ou mais
    if data.sell_days > period["entitled"] // 3:
        raise HTTPException(status_code=400, detail=f"O abono pecuniário é de até 1/3 do direito ({int(period['entitled'] // 3)} dias)")
    others = await db.hr_vacations.find({"contract_id": contract["id"], "acquisition_start": acquisition, "status": {"$ne": "CANCELADA"},
                                         **({"id": {"$ne": current_id}} if current_id else {})}, {"_id": 0, "days": 1}).to_list(None)
    if len(others) >= 3:
        raise HTTPException(status_code=400, detail="As férias de um período podem ser divididas em no máximo 3 partes")
    left_after = period["entitled"] - already - data.days - data.sell_days
    if data.days < 14 and not any((o.get("days") or 0) >= 14 for o in others) and left_after < 14:
        raise HTTPException(status_code=400, detail="Uma das partes das férias precisa ter 14 dias ou mais (art. 134, § 1º, da CLT)")
    end = start + timedelta(days=data.days - 1)
    clash = {"contract_id": contract["id"], "status": {"$ne": "CANCELADA"}, "start_date": {"$lte": end.isoformat()}, "end_date": {"$gte": start.isoformat()}}
    if current_id:
        clash["id"] = {"$ne": current_id}
    if await db.hr_vacations.find_one(clash, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Já existem férias nesse intervalo")
    payment_date = _valid_iso_date(data.payment_date, "Data do pagamento") if _clean(data.payment_date) else (start - timedelta(days=2)).isoformat()
    settings = await load_payroll_settings()
    calc = await _vacation_calc({"start_date": start.isoformat(), "days": data.days, "sell_days": data.sell_days,
                                 "advance_13th": data.advance_13th}, contract, settings)
    fields = {
        **contract_snapshot(contract),
        "acquisition_start": acquisition, "acquisition_end": period["end"], "concession_deadline": period["deadline"],
        "start_date": start.isoformat(), "end_date": end.isoformat(), "return_date": (end + timedelta(days=1)).isoformat(),
        "days": data.days, "sell_days": data.sell_days, "advance_13th": data.advance_13th,
        "payment_date": payment_date, "notice_date": (start - timedelta(days=30)).isoformat(),
        "late": period["status"] == "VENCIDO", "calc": calc, "observations": _clean(data.observations),
    }
    return contract, fields


@api_router.post("/hr/vacations/preview")
async def preview_vacation(data: HRVacationCreate, vacation_id: Optional[str] = None, current_user: dict = Depends(get_current_admin_user)):
    _, fields = await _validate_vacation(data, vacation_id)
    return fields


@api_router.get("/hr/vacations")
async def list_vacations(search: Optional[str] = None, status: Optional[str] = None, contract_id: Optional[str] = None,
                         date_from: Optional[str] = None, date_to: Optional[str] = None,
                         current_user: dict = Depends(get_current_admin_user)):
    query = {}
    if search and search.strip():
        query["$or"] = [{"person_name": _rx(search)}, {"person_cpf": _rx(search)}]
    if status:
        query["status"] = status
    if contract_id:
        query["contract_id"] = contract_id
    query.update(_period_query("start_date", date_from, date_to))
    return await db.hr_vacations.find(query, {"_id": 0}).sort([("start_date", -1)]).to_list(None)


@api_router.post("/hr/vacations")
async def create_vacation(data: HRVacationCreate, current_user: dict = Depends(get_current_admin_user)):
    _, fields = await _validate_vacation(data, None)
    doc = {"id": str(uuid.uuid4()), "vacation_number": await next_number("hr_vacation_number"), **fields,
           "status": "PROGRAMADA", "paid_at": None, "created_by_name": current_user["name"], "created_at": _now_iso()}
    await db.hr_vacations.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def _vacation_calc(vacation: dict, contract: dict, settings: dict) -> dict:
    """Recibo de férias com a média das variáveis dos 12 meses anteriores."""
    start = date.fromisoformat(vacation["start_date"])
    ctx = {**contract_ctx(contract, settings, start),
           "variable_average": await variable_average(contract["id"], *competence_window(start, 12))}
    return compute_vacation(ctx, vacation["days"], vacation.get("sell_days") or 0, bool(vacation.get("advance_13th")), settings)


async def _recalc_programmed_vacations(contract: dict):
    """Férias ainda não pagas recalculam com o salário e as tabelas atuais."""
    settings = await load_payroll_settings()
    for v in await db.hr_vacations.find({"contract_id": contract["id"], "status": "PROGRAMADA"}, {"_id": 0}).to_list(None):
        await db.hr_vacations.update_one({"id": v["id"]}, {"$set": {"calc": await _vacation_calc(v, contract, settings)}})


async def _get_vacation(vacation_id: str) -> dict:
    doc = await db.hr_vacations.find_one({"id": vacation_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Férias não encontradas")
    return doc


@api_router.put("/hr/vacations/{vacation_id}")
async def update_vacation(vacation_id: str, data: HRVacationCreate, current_user: dict = Depends(get_current_admin_user)):
    current = await _get_vacation(vacation_id)
    if current["status"] != "PROGRAMADA":
        raise HTTPException(status_code=400, detail="Só férias Programadas podem ser editadas")
    if data.contract_id != current["contract_id"]:
        raise HTTPException(status_code=400, detail="O funcionário das férias não pode ser trocado")
    _, fields = await _validate_vacation(data, vacation_id)
    fields["updated_at"] = _now_iso()
    await db.hr_vacations.update_one({"id": vacation_id}, {"$set": fields})
    return await _get_vacation(vacation_id)


@api_router.delete("/hr/vacations/{vacation_id}")
async def delete_vacation(vacation_id: str, current_user: dict = Depends(get_current_admin_user)):
    current = await _get_vacation(vacation_id)
    if current["status"] == "PAGA":
        raise HTTPException(status_code=400, detail="Férias pagas não podem ser excluídas: estorne o pagamento antes")
    await db.hr_vacations.delete_one({"id": vacation_id})
    return {"message": "Férias excluídas"}


@api_router.post("/hr/vacations/{vacation_id}/pay")
async def pay_vacation(vacation_id: str, data: HRPayrollPay, current_user: dict = Depends(get_current_admin_user)):
    current = await _get_vacation(vacation_id)
    if current["status"] != "PROGRAMADA":
        raise HTTPException(status_code=400, detail="Só férias Programadas podem ser pagas")
    paid_at = _valid_iso_date(data.payment_date, "Data do pagamento")
    # paga pelo valor de hoje (o salário ou as tabelas podem ter mudado desde o lançamento)
    calc = await _vacation_calc(current, await get_contract(current["contract_id"]), await load_payroll_settings())
    await db.hr_vacations.update_one({"id": vacation_id}, {"$set": {"status": "PAGA", "paid_at": paid_at, "payment_date": paid_at, "calc": calc,
                                                                  "paid_by_name": current_user["name"], "updated_at": _now_iso()}})
    return await _get_vacation(vacation_id)


@api_router.put("/hr/vacations/{vacation_id}/status")
async def update_vacation_status(vacation_id: str, status: str = Query(..., pattern="^(PROGRAMADA|CANCELADA)$"),
                                 current_user: dict = Depends(get_current_admin_user)):
    """Estorna o pagamento (volta a Programada) ou cancela férias não pagas."""
    current = await _get_vacation(vacation_id)
    if status == "CANCELADA" and current["status"] == "PAGA":
        raise HTTPException(status_code=400, detail="Férias pagas não podem ser canceladas: estorne o pagamento antes")
    if status == "PROGRAMADA" and current["status"] == "CANCELADA":
        contract = await get_contract(current["contract_id"])
        if contract["status"] == "DESLIGADO":
            raise HTTPException(status_code=400, detail="Contrato desligado")
    update = {"status": status, "updated_at": _now_iso()}
    if status == "PROGRAMADA":
        update.update({"paid_at": None, "paid_by_name": None})
    await db.hr_vacations.update_one({"id": vacation_id}, {"$set": update})
    return await _get_vacation(vacation_id)


@api_router.get("/hr/vacations/{vacation_id}/receipt/pdf")
async def vacation_receipt_pdf(vacation_id: str, current_user: dict = Depends(get_current_admin_user)):
    from hr_reports import generate_vacation_receipt_pdf
    vacation = await _get_vacation(vacation_id)
    company = merge_company(await get_company_settings())
    return pdf_stream(generate_vacation_receipt_pdf(vacation, company), f"Recibo_Ferias_{vacation.get('person_name')}.pdf")


@api_router.get("/hr/vacations/{vacation_id}/notice/pdf")
async def vacation_notice_pdf(vacation_id: str, current_user: dict = Depends(get_current_admin_user)):
    from hr_reports import generate_vacation_notice_pdf
    vacation = await _get_vacation(vacation_id)
    company = merge_company(await get_company_settings())
    return pdf_stream(generate_vacation_notice_pdf(vacation, company), f"Aviso_Ferias_{vacation.get('person_name')}.pdf")


# ---------------------------------------------------------------- Ocorrências

async def _validate_occurrence(data: HROccurrenceCreate) -> dict:
    contract = await get_contract(data.contract_id)
    if data.occurrence_type not in OCCURRENCE_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de ocorrência inválido")
    start = _valid_iso_date(data.start_date, "Data")
    end = _valid_iso_date(data.end_date, "Data final") if _clean(data.end_date) else None
    if end and end < start:
        raise HTTPException(status_code=400, detail="A data final é anterior à inicial")
    days = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1 if end else data.days
    if days is not None and days < 0:
        raise HTTPException(status_code=400, detail="Quantidade de dias inválida")
    return {
        **contract_snapshot(contract), "occurrence_type": data.occurrence_type,
        "start_date": start, "end_date": end, "days": days, "cid": _clean(data.cid),
        "description": _clean(data.description), "attachments": [a for a in data.attachments if _clean(a)],
    }


@api_router.get("/hr/occurrences")
async def list_occurrences(search: Optional[str] = None, occurrence_type: Optional[str] = None, contract_id: Optional[str] = None,
                           date_from: Optional[str] = None, date_to: Optional[str] = None,
                           current_user: dict = Depends(get_current_admin_user)):
    query = {}
    if search and search.strip():
        query["$or"] = [{"person_name": _rx(search)}, {"description": _rx(search)}, {"cid": _rx(search)}]
    if occurrence_type:
        query["occurrence_type"] = occurrence_type
    if contract_id:
        query["contract_id"] = contract_id
    query.update(_period_query("start_date", date_from, date_to))
    return await db.hr_occurrences.find(query, {"_id": 0}).sort([("start_date", -1), ("occurrence_number", -1)]).to_list(None)


@api_router.post("/hr/occurrences")
async def create_occurrence(data: HROccurrenceCreate, current_user: dict = Depends(get_current_admin_user)):
    fields = await _validate_occurrence(data)
    doc = {"id": str(uuid.uuid4()), "occurrence_number": await next_number("hr_occurrence_number"), **fields,
           "created_by_name": current_user["name"], "created_at": _now_iso()}
    await db.hr_occurrences.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/hr/occurrences/{occurrence_id}")
async def update_occurrence(occurrence_id: str, data: HROccurrenceCreate, current_user: dict = Depends(get_current_admin_user)):
    current = await db.hr_occurrences.find_one({"id": occurrence_id}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
    fields = await _validate_occurrence(data)
    fields["updated_at"] = _now_iso()
    await db.hr_occurrences.update_one({"id": occurrence_id}, {"$set": fields})
    return await db.hr_occurrences.find_one({"id": occurrence_id}, {"_id": 0})


@api_router.delete("/hr/occurrences/{occurrence_id}")
async def delete_occurrence(occurrence_id: str, current_user: dict = Depends(get_current_admin_user)):
    result = await db.hr_occurrences.delete_one({"id": occurrence_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
    return {"message": "Ocorrência excluída"}


@api_router.get("/hr/occurrences/{occurrence_id}/pdf")
async def occurrence_term_pdf(occurrence_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Termo de advertência / suspensão disciplinar, para assinatura."""
    from hr_reports import generate_occurrence_term_pdf
    occ = await db.hr_occurrences.find_one({"id": occurrence_id}, {"_id": 0})
    if not occ:
        raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
    if occ["occurrence_type"] not in ("ADVERTENCIA", "SUSPENSAO"):
        raise HTTPException(status_code=400, detail="O termo é emitido só para advertência e suspensão")
    company = merge_company(await get_company_settings())
    return pdf_stream(generate_occurrence_term_pdf(occ, company), f"{OCCURRENCE_TYPES[occ['occurrence_type']]}_{occ.get('person_name')}.pdf")


# ---------------------------------------------------------------- Banco de Horas

@api_router.get("/hr/time-bank")
async def list_time_bank(search: Optional[str] = None, contract_id: Optional[str] = None,
                         date_from: Optional[str] = None, date_to: Optional[str] = None,
                         current_user: dict = Depends(get_current_admin_user)):
    query = {}
    if search and search.strip():
        query["$or"] = [{"person_name": _rx(search)}, {"description": _rx(search)}]
    if contract_id:
        query["contract_id"] = contract_id
    query.update(_period_query("date", date_from, date_to))
    return await db.hr_time_bank.find(query, {"_id": 0}).sort([("date", -1), ("created_at", -1)]).to_list(None)


@api_router.get("/hr/time-bank/balances")
async def time_bank_balances(current_user: dict = Depends(get_current_admin_user)):
    """Saldo por pessoa, com as horas vencidas (passaram do prazo de
    compensação sem ser compensadas: pagar como hora extra) e as que vencem em 30 dias."""
    settings = await load_payroll_settings()
    months = int(settings.get("time_bank_months") or 6)
    today = _today()
    by_contract = {}
    for e in await db.hr_time_bank.find({}, {"_id": 0}).to_list(None):
        by_contract.setdefault(e["contract_id"], []).append(e)
    out = []
    for contract_id, entries in by_contract.items():
        status = time_bank_status(entries, today, months)
        out.append({"contract_id": contract_id, "person_name": entries[0].get("person_name"),
                    "last_date": max(e["date"] for e in entries), "months": months, **status})
    return sorted(out, key=lambda b: (b["person_name"] or "").lower())


@api_router.post("/hr/time-bank")
async def create_time_bank(data: HRTimeBankCreate, current_user: dict = Depends(get_current_admin_user)):
    contract = await get_contract(data.contract_id)
    if not data.minutes:
        raise HTTPException(status_code=400, detail="Informe as horas (crédito ou débito)")
    if abs(data.minutes) > 24 * 60 * 31:
        raise HTTPException(status_code=400, detail="Quantidade de horas inválida")
    doc = {"id": str(uuid.uuid4()), **contract_snapshot(contract), "date": _valid_iso_date(data.date, "Data"),
           "minutes": data.minutes, "description": _clean(data.description),
           "created_by_name": current_user["name"], "created_at": _now_iso()}
    await db.hr_time_bank.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.delete("/hr/time-bank/{entry_id}")
async def delete_time_bank(entry_id: str, current_user: dict = Depends(get_current_admin_user)):
    result = await db.hr_time_bank.delete_one({"id": entry_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    return {"message": "Lançamento excluído"}


# ---------------------------------------------------------------- Documentos e ASO

def document_status(doc: dict, today: date) -> str:
    expiry = parse_day(doc.get("expiry_date"))
    if not expiry:
        return "SEM_VALIDADE"
    if expiry < today:
        return "VENCIDO"
    if (expiry - today).days <= DOC_ALERT_DAYS:
        return "A_VENCER"
    return "VALIDO"


async def _validate_document(data: HRDocumentCreate) -> dict:
    contract = await get_contract(data.contract_id)
    if data.doc_type not in DOCUMENT_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de documento inválido")
    issue = _valid_iso_date(data.issue_date, "Data de emissão") if _clean(data.issue_date) else None
    expiry = _valid_iso_date(data.expiry_date, "Validade") if _clean(data.expiry_date) else None
    if issue and expiry and expiry < issue:
        raise HTTPException(status_code=400, detail="A validade é anterior à emissão")
    return {**contract_snapshot(contract), "doc_type": data.doc_type, "description": _clean(data.description),
            "issue_date": issue, "expiry_date": expiry, "file_url": _clean(data.file_url), "observations": _clean(data.observations)}


@api_router.get("/hr/documents")
async def list_documents(search: Optional[str] = None, doc_type: Optional[str] = None, contract_id: Optional[str] = None,
                         status: Optional[str] = None, current_user: dict = Depends(get_current_admin_user)):
    query = {}
    if search and search.strip():
        query["$or"] = [{"person_name": _rx(search)}, {"description": _rx(search)}]
    if doc_type:
        query["doc_type"] = doc_type
    if contract_id:
        query["contract_id"] = contract_id
    today = _today()
    rows = await db.hr_documents.find(query, {"_id": 0}).to_list(None)
    for row in rows:
        row["status"] = document_status(row, today)
    if status:
        rows = [r for r in rows if r["status"] == status]
    order = {"VENCIDO": 0, "A_VENCER": 1, "VALIDO": 2, "SEM_VALIDADE": 3}
    return sorted(rows, key=lambda r: (order[r["status"]], r.get("expiry_date") or "9999", (r.get("person_name") or "").lower()))


@api_router.post("/hr/documents")
async def create_document(data: HRDocumentCreate, current_user: dict = Depends(get_current_admin_user)):
    fields = await _validate_document(data)
    doc = {"id": str(uuid.uuid4()), **fields, "created_by_name": current_user["name"], "created_at": _now_iso()}
    await db.hr_documents.insert_one(doc)
    doc.pop("_id", None)
    doc["status"] = document_status(doc, _today())
    return doc


@api_router.put("/hr/documents/{document_id}")
async def update_document(document_id: str, data: HRDocumentCreate, current_user: dict = Depends(get_current_admin_user)):
    if not await db.hr_documents.find_one({"id": document_id}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Documento não encontrado")
    fields = await _validate_document(data)
    fields["updated_at"] = _now_iso()
    await db.hr_documents.update_one({"id": document_id}, {"$set": fields})
    doc = await db.hr_documents.find_one({"id": document_id}, {"_id": 0})
    doc["status"] = document_status(doc, _today())
    return doc


@api_router.delete("/hr/documents/{document_id}")
async def delete_document(document_id: str, current_user: dict = Depends(get_current_admin_user)):
    result = await db.hr_documents.delete_one({"id": document_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Documento não encontrado")
    return {"message": "Documento excluído"}


# ---------------------------------------------------------------- Painel do RH

async def _birthdays(contracts: list, month: int) -> list:
    out = []
    for c in contracts:
        person = await get_person(c["person_type"], c["person_id"]) or {}
        birth = parse_day(person.get("birth_date")) if person.get("birth_date") else None
        if birth and birth.month == month:
            out.append({**contract_snapshot(c), "birth_date": birth.isoformat(), "day": birth.day})
    return sorted(out, key=lambda b: b["day"])


@api_router.get("/hr/dashboard")
async def hr_dashboard(current_user: dict = Depends(get_current_admin_user)):
    today = _today()
    contracts = await db.hr_contracts.find({"status": {"$ne": "DESLIGADO"}}, {"_id": 0}).to_list(None)
    by_department, by_type = {}, {}
    payroll_base = 0.0
    for c in contracts:
        dep = c.get("department") or "Sem setor"
        by_department[dep] = by_department.get(dep, 0) + 1
        label = CONTRACT_TYPES.get(c.get("contract_type"), c.get("contract_type"))
        by_type[label] = by_type.get(label, 0) + 1
        payroll_base += c.get("base_salary") or 0

    experiences = []
    for c in contracts:
        end = parse_day(c.get("experience_end"))
        if end and c["status"] == "ATIVO" and 0 <= (end - today).days <= 15:
            experiences.append({**contract_snapshot(c), "experience_end": end.isoformat(), "days_left": (end - today).days})

    vacations = []
    for row in await vacation_balances(False, current_user):
        if row["overdue"] or row["due_soon"]:
            vacations.append({k: row[k] for k in ("contract_id", "person_name", "position_name", "overdue", "due_soon", "available_days", "next_deadline")})

    documents = [d for d in await list_documents(None, None, None, None, current_user) if d["status"] in ("VENCIDO", "A_VENCER")]
    time_bank = [b for b in await time_bank_balances(current_user) if b["expired"] or b["expiring"]]
    on_vacation = await db.hr_vacations.count_documents({"status": {"$ne": "CANCELADA"}, "start_date": {"$lte": today.isoformat()},
                                                         "end_date": {"$gte": today.isoformat()}})
    last_run = await db.hr_payroll_runs.find({"run_type": "MENSAL"}, {"_id": 0}).sort([("competence", -1)]).to_list(1)
    month_start = today.replace(day=1).isoformat()
    admitted = await db.hr_contracts.count_documents({"admission_date": {"$gte": month_start}})
    terminated = await db.hr_contracts.count_documents({"status": "DESLIGADO", "termination.termination_date": {"$gte": month_start}})
    return {
        "headcount": len(contracts),
        "active": sum(1 for c in contracts if c["status"] == "ATIVO"),
        "on_leave": sum(1 for c in contracts if c["status"] == "AFASTADO"),
        "on_vacation": on_vacation,
        "admitted_month": admitted, "terminated_month": terminated,
        "payroll_base": r2(payroll_base),
        "by_department": sorted(({"label": k, "value": v} for k, v in by_department.items()), key=lambda x: -x["value"]),
        "by_type": sorted(({"label": k, "value": v} for k, v in by_type.items()), key=lambda x: -x["value"]),
        "experiences": sorted(experiences, key=lambda e: e["days_left"]),
        "vacations": vacations,
        "documents": documents[:20],
        "documents_count": len(documents),
        "time_bank": time_bank,
        "birthdays": await _birthdays(contracts, today.month),
        "last_payroll": last_run[0] if last_run else None,
    }


# ---------------------------------------------------------------- Relatórios de RH

REPORT_TITLES = {
    "headcount": "Quadro de Funcionários",
    "payroll-cost": "Custo da Folha",
    "vacations": "Relatório de Férias",
    "occurrences": "Relatório de Ocorrências",
    "documents": "Documentos e ASO",
    "time-bank": "Banco de Horas",
    "birthdays": "Aniversariantes",
}


def _hours(minutes) -> str:
    minutes = int(minutes or 0)
    sign = "-" if minutes < 0 else ""
    minutes = abs(minutes)
    return f"{sign}{minutes // 60}:{minutes % 60:02d}"


async def build_hr_report(kind: str, date_from=None, date_to=None, department=None, status=None, month=None, user=None) -> dict:
    """Dados + seções (PDF/Excel) de cada relatório do RH."""
    today = _today()
    dep_rx = {"$regex": f"^{re.escape(department.strip())}$", "$options": "i"} if department and department.strip() else None

    if kind == "headcount":
        if not status or status == "VIGENTE":
            query = {"status": {"$ne": "DESLIGADO"}}
        elif status == "TODOS":
            query = {}
        else:
            query = {"status": status}
        if dep_rx:
            query["department"] = dep_rx
        rows = sorted(await db.hr_contracts.find(query, {"_id": 0}).to_list(None), key=lambda c: ((c.get("department") or "").lower(), (c.get("person_name") or "").lower()))
        deps = {}
        for c in rows:
            d = deps.setdefault(c.get("department") or "Sem setor", {"count": 0, "salary": 0.0})
            d["count"] += 1
            d["salary"] += c.get("base_salary") or 0
        total_salary = r2(sum(c.get("base_salary") or 0 for c in rows))
        sections = [
            Section("Por setor", [Column("Setor", width=40), Column("Funcionários", INT, 14), Column("Salários base", MONEY, 18)],
                    [[k, v["count"], r2(v["salary"])] for k, v in sorted(deps.items())],
                    total=["TOTAL", len(rows), total_salary] if rows else None, empty_text="Nenhum contrato.", sheet_name="Por setor"),
            Section("Funcionários", [Column("Nº", INT, 6), Column("Nome", width=28), Column("CPF", width=14), Column("Cargo", width=20),
                                     Column("Setor", width=16), Column("Tipo", width=14), Column("Admissão", DAY, 11),
                                     Column("Situação", width=10, align="center"), Column("Salário", MONEY, 13)],
                    [[c.get("contract_number"), c.get("person_name"), c.get("person_cpf"), c.get("position_name"), c.get("department"),
                      CONTRACT_TYPES.get(c.get("contract_type")), c.get("admission_date"), CONTRACT_STATUS.get(c.get("status")), c.get("base_salary")]
                     for c in rows],
                    total=["TOTAL", None, None, None, None, None, None, None, total_salary] if rows else None,
                    empty_text="Nenhum contrato.", sheet_name="Funcionários"),
        ]
        info = [("Funcionários", str(len(rows))), ("Salários base", format_currency(total_salary, "BRL")), ("Setor", department or "Todos")]
        return {"summary": {"count": len(rows), "salary": total_salary}, "sections": sections, "info": info, "subtitle": None}

    if kind == "payroll-cost":
        query = {}
        if date_from:
            query.setdefault("competence", {})["$gte"] = date_from[:7]
        if date_to:
            query.setdefault("competence", {})["$lte"] = date_to[:7]
        query["run_type"] = {"$ne": "ADIANTAMENTO"}  # o adiantamento já está dentro da folha mensal
        runs = {r["id"]: r for r in await db.hr_payroll_runs.find(query, {"_id": 0}).to_list(None)}
        slips = await db.hr_payslips.find({"run_id": {"$in": list(runs)}}, {"_id": 0}).to_list(None) if runs else []
        if dep_rx:
            rx = re.compile(dep_rx["$regex"], re.I)
            slips = [s for s in slips if rx.match(s.get("department") or "")]
        settings = await load_payroll_settings()
        # encargos da empresa (INSS patronal + RAT + terceiros) sobre a base do INSS
        for s in slips:
            s.setdefault("totals", {})["charges"] = employer_charges((s.get("totals") or {}).get("inss_base"), settings)
        by_month, by_dep = {}, {}
        for s in slips:
            run = runs[s["run_id"]]
            t = s.get("totals") or {}
            for key, bucket in ((f"{run['competence']} {run['run_type']}", by_month), (s.get("department") or "Sem setor", by_dep)):
                b = bucket.setdefault(key, {"label": key, "competence": run["competence"], "run_type": run["run_type"], "count": 0,
                                            "gross": 0.0, "deductions": 0.0, "net": 0.0, "inss": 0.0, "irrf": 0.0, "fgts": 0.0, "charges": 0.0})
                b["count"] += 1
                for f in ("gross", "deductions", "net", "inss", "irrf", "fgts", "charges"):
                    b[f] += t.get(f) or 0
        from hr_payroll import RUN_TYPES

        def row(b, label):
            return [label, b["count"], r2(b["gross"]), r2(b["deductions"]), r2(b["net"]), r2(b["inss"]), r2(b["irrf"]), r2(b["fgts"]),
                    r2(b["charges"]), r2(b["gross"] + b["fgts"] + b["charges"])]
        totals = {f: r2(sum((s.get("totals") or {}).get(f) or 0 for s in slips))
                  for f in ("gross", "deductions", "net", "inss", "irrf", "fgts", "charges")}
        cols = lambda first: [Column(first, width=24), Column("Contracheques", INT, 11), Column("Proventos", MONEY, 13), Column("Descontos", MONEY, 13),
                              Column("Líquido", MONEY, 13), Column("INSS", MONEY, 12), Column("IRRF", MONEY, 12), Column("FGTS", MONEY, 12),
                              Column("Encargos", MONEY, 12), Column("Custo", MONEY, 14)]
        total_row = ["TOTAL", len(slips), totals["gross"], totals["deductions"], totals["net"], totals["inss"], totals["irrf"], totals["fgts"],
                     totals["charges"], r2(totals["gross"] + totals["fgts"] + totals["charges"])]

        # férias pagas e rescisões no período também custam (fora da folha)
        vq = {"status": "PAGA", **_period_query("paid_at", date_from, date_to)}
        others = []
        for v in await db.hr_vacations.find(vq, {"_id": 0}).to_list(None):
            c = v.get("calc") or {}
            base = (c.get("vacation_pay") or 0) + (c.get("one_third") or 0)
            others.append(["Férias", v.get("person_name"), v.get("paid_at"), r2(c.get("gross")), r2(c.get("fgts")),
                           employer_charges(base, settings), v.get("department")])
        tq = {"status": "DESLIGADO", **_period_query("termination.termination_date", date_from, date_to)}
        for ct in await db.hr_contracts.find(tq, {"_id": 0}).to_list(None):
            c = (ct.get("termination") or {}).get("calc") or {}
            base = sum(i["value"] for i in c.get("items") or [] if i["label"] in ("Saldo de salário", "13º salário proporcional"))
            others.append(["Rescisão", ct.get("person_name"), ct["termination"].get("termination_date"), r2(c.get("gross")),
                           r2((c.get("fgts_month") or 0) + (c.get("fgts_fine") or 0)), employer_charges(base, settings), ct.get("department")])
        if dep_rx:
            rx = re.compile(dep_rx["$regex"], re.I)
            others = [o for o in others if rx.match(o[6] or "")]
        others = [o[:6] + [r2(o[3] + o[4] + o[5])] for o in sorted(others, key=lambda o: o[2] or "")]
        others_cost = r2(sum(o[6] for o in others))
        sections = [
            Section("Por competência", cols("Competência"),
                    [row(b, f"{b['competence'][5:]}/{b['competence'][:4]} - {RUN_TYPES.get(b['run_type'], b['run_type'])}")
                     for b in sorted(by_month.values(), key=lambda b: (b["competence"], b["run_type"]))],
                    total=total_row if slips else None, empty_text="Nenhuma folha no período.", sheet_name="Por competência"),
            Section("Por setor", cols("Setor"), [row(b, b["label"]) for b in sorted(by_dep.values(), key=lambda b: b["label"].lower())],
                    total=total_row if slips else None, empty_text="Nenhuma folha no período.", sheet_name="Por setor"),
            Section("Férias pagas e rescisões", [Column("Tipo", width=12), Column("Nome", width=28), Column("Data", DAY, 11),
                                                 Column("Bruto", MONEY, 13), Column("FGTS (+ multa)", MONEY, 14), Column("Encargos", MONEY, 12),
                                                 Column("Custo", MONEY, 14)],
                    others, total=["TOTAL", None, None, r2(sum(o[3] for o in others)), r2(sum(o[4] for o in others)),
                                   r2(sum(o[5] for o in others)), others_cost] if others else None,
                    empty_text="Nenhuma férias paga ou rescisão no período.", sheet_name="Férias e rescisões"),
        ]
        payroll_cost = r2(totals["gross"] + totals["fgts"] + totals["charges"])
        info = [("Proventos", format_currency(totals["gross"], "BRL")), ("Líquido", format_currency(totals["net"], "BRL")),
                ("FGTS", format_currency(totals["fgts"], "BRL")), ("Encargos", format_currency(totals["charges"], "BRL")),
                ("Custo total", format_currency(payroll_cost + others_cost, "BRL"))]
        months = lambda d: f"{d[5:7]}/{d[:4]}" if d else None
        subtitle = f"Competência: {months(date_from) or 'início'} a {months(date_to) or 'hoje'}" if (date_from or date_to) else None
        return {"summary": {**totals, "count": len(slips), "cost": payroll_cost, "others_cost": others_cost,
                            "total_cost": r2(payroll_cost + others_cost)}, "sections": sections, "info": info,
                "subtitle": subtitle}

    if kind == "vacations":
        balances = await vacation_balances(False, user)
        if dep_rx:
            rx = re.compile(dep_rx["$regex"], re.I)
            balances = [b for b in balances if rx.match(b.get("department") or "")]
        period_rows = []
        for b in balances:
            for p in b["periods"]:
                if p["complete"] and p["balance"] > 0:
                    period_rows.append([b["person_name"], b.get("position_name"), p["start"], p["end"], p["entitled"], p["used"], p["balance"],
                                        p["deadline"], {"VENCIDO": "Vencido", "A_VENCER": "A vencer", "DISPONIVEL": "Disponível"}.get(p["status"], p["status"])])
        vq = {"status": {"$ne": "CANCELADA"}, **_period_query("start_date", date_from, date_to)}
        programmed = await db.hr_vacations.find(vq, {"_id": 0}).sort([("start_date", 1)]).to_list(None)
        sections = [
            Section("Saldos de férias", [Column("Nome", width=26), Column("Cargo", width=18), Column("Aquisitivo de", DAY, 11), Column("até", DAY, 11),
                                         Column("Direito", INT, 8), Column("Usado", INT, 8), Column("Saldo", INT, 8), Column("Conceder até", DAY, 11),
                                         Column("Situação", width=10, align="center")],
                    period_rows, empty_text="Nenhum saldo de férias em aberto.", sheet_name="Saldos"),
            Section("Férias no período", [Column("Nº", INT, 6), Column("Nome", width=26), Column("Início", DAY, 11), Column("Retorno", DAY, 11),
                                          Column("Dias", INT, 7), Column("Abono", INT, 7), Column("Situação", width=10, align="center"),
                                          Column("Líquido", MONEY, 13)],
                    [[v.get("vacation_number"), v.get("person_name"), v.get("start_date"), v.get("return_date"), v.get("days"), v.get("sell_days"),
                      VACATION_STATUS.get(v.get("status")), (v.get("calc") or {}).get("net")] for v in programmed],
                    empty_text="Nenhuma férias no período.", sheet_name="Férias"),
        ]
        overdue = sum(1 for r in period_rows if r[-1] == "Vencido")
        info = [("Períodos em aberto", str(len(period_rows))), ("Vencidos", str(overdue)), ("Férias no período", str(len(programmed)))]
        return {"summary": {"open_periods": len(period_rows), "overdue": overdue, "programmed": len(programmed)}, "sections": sections,
                "info": info, "subtitle": period_text("Início das férias", date_from, date_to)}

    if kind == "occurrences":
        query = _period_query("start_date", date_from, date_to)
        if status:
            query["occurrence_type"] = status
        rows = await db.hr_occurrences.find(query, {"_id": 0}).sort([("start_date", 1)]).to_list(None)
        if dep_rx:
            rx = re.compile(dep_rx["$regex"], re.I)
            rows = [r for r in rows if rx.match(r.get("department") or "")]
        by_type = {}
        for o in rows:
            t = by_type.setdefault(o["occurrence_type"], {"count": 0, "days": 0})
            t["count"] += 1
            t["days"] += o.get("days") or 0
        sections = [
            Section("Por tipo", [Column("Tipo", width=40), Column("Ocorrências", INT, 14), Column("Dias", INT, 14)],
                    [[OCCURRENCE_TYPES.get(k, k), v["count"], v["days"]] for k, v in sorted(by_type.items())],
                    empty_text="Nenhuma ocorrência no período.", sheet_name="Por tipo"),
            Section("Ocorrências", [Column("Nº", INT, 6), Column("Data", DAY, 11), Column("Até", DAY, 11), Column("Nome", width=24),
                                    Column("Tipo", width=18), Column("Dias", INT, 7), Column("CID", width=8), Column("Descrição", width=34)],
                    [[o.get("occurrence_number"), o.get("start_date"), o.get("end_date"), o.get("person_name"),
                      OCCURRENCE_TYPES.get(o.get("occurrence_type")), o.get("days"), o.get("cid"), o.get("description")] for o in rows],
                    empty_text="Nenhuma ocorrência no período.", sheet_name="Ocorrências"),
        ]
        return {"summary": {"count": len(rows)}, "sections": sections, "info": [("Ocorrências", str(len(rows)))],
                "subtitle": period_text("Período", date_from, date_to)}

    if kind == "documents":
        rows = await list_documents(None, None, None, status or None, user)
        if dep_rx:
            rx = re.compile(dep_rx["$regex"], re.I)
            rows = [r for r in rows if rx.match(r.get("department") or "")]
        labels = {"VENCIDO": "Vencido", "A_VENCER": "A vencer", "VALIDO": "Válido", "SEM_VALIDADE": "Sem validade"}
        sections = [Section("Documentos", [Column("Nome", width=26), Column("Documento", width=22), Column("Descrição", width=24),
                                           Column("Emissão", DAY, 11), Column("Validade", DAY, 11), Column("Situação", width=11, align="center")],
                            [[d.get("person_name"), DOCUMENT_TYPES.get(d.get("doc_type")), d.get("description"), d.get("issue_date"),
                              d.get("expiry_date"), labels[d["status"]]] for d in rows],
                            empty_text="Nenhum documento.", sheet_name="Documentos")]
        expired = sum(1 for d in rows if d["status"] == "VENCIDO")
        soon = sum(1 for d in rows if d["status"] == "A_VENCER")
        return {"summary": {"count": len(rows), "expired": expired, "due_soon": soon}, "sections": sections,
                "info": [("Documentos", str(len(rows))), ("Vencidos", str(expired)), ("A vencer (30 dias)", str(soon))], "subtitle": None}

    if kind == "time-bank":
        entries = await list_time_bank(None, None, date_from, date_to, user)
        people = {}
        for e in entries:
            p = people.setdefault(e["contract_id"], {"name": e.get("person_name"), "credit": 0, "debit": 0})
            if e["minutes"] >= 0:
                p["credit"] += e["minutes"]
            else:
                p["debit"] += -e["minutes"]
        sections = [
            Section("Saldo por pessoa", [Column("Nome", width=40), Column("Créditos", width=14, align="center"),
                                         Column("Débitos", width=14, align="center"), Column("Saldo", width=14, align="center")],
                    [[p["name"], _hours(p["credit"]), _hours(p["debit"]), _hours(p["credit"] - p["debit"])]
                     for p in sorted(people.values(), key=lambda p: (p["name"] or "").lower())],
                    empty_text="Nenhum lançamento no período.", sheet_name="Saldos"),
            Section("Lançamentos", [Column("Data", DAY, 11), Column("Nome", width=30), Column("Horas", width=12, align="center"),
                                    Column("Descrição", width=40)],
                    [[e["date"], e.get("person_name"), _hours(e["minutes"]), e.get("description")] for e in sorted(entries, key=lambda e: e["date"])],
                    empty_text="Nenhum lançamento no período.", sheet_name="Lançamentos"),
        ]
        return {"summary": {"count": len(entries), "people": len(people)}, "sections": sections,
                "info": [("Lançamentos", str(len(entries))), ("Pessoas", str(len(people)))], "subtitle": period_text("Período", date_from, date_to)}

    if kind == "birthdays":
        month = month or today.month
        if month < 1 or month > 12:
            raise HTTPException(status_code=400, detail="Mês inválido")
        contracts = await db.hr_contracts.find({"status": {"$ne": "DESLIGADO"}}, {"_id": 0}).to_list(None)
        rows = await _birthdays(contracts, month)
        sections = [Section("Aniversariantes", [Column("Dia", INT, 6), Column("Nome", width=34), Column("Cargo", width=24), Column("Setor", width=20),
                                                Column("Nascimento", DAY, 12)],
                            [[b["day"], b["person_name"], b.get("position_name"), b.get("department"), b["birth_date"]] for b in rows],
                            empty_text="Nenhum aniversariante no mês.", sheet_name="Aniversariantes")]
        months = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
        return {"summary": {"count": len(rows)}, "sections": sections, "info": [("Mês", months[month - 1]), ("Aniversariantes", str(len(rows)))],
                "subtitle": f"Mês: {months[month - 1]}"}

    raise HTTPException(status_code=404, detail="Relatório não encontrado")


def _section_preview(section: Section) -> dict:
    return {"title": section.title, "columns": [{"label": c.label, "kind": c.kind} for c in section.columns],
            "rows": section.rows[:200], "total": section.total, "count": len(section.rows)}


@api_router.get("/reports/hr/{kind}")
async def get_hr_report(kind: str, date_from: Optional[str] = None, date_to: Optional[str] = None,
                        department: Optional[str] = None, status: Optional[str] = None, month: Optional[int] = None,
                        current_user: dict = Depends(get_current_admin_user)):
    if kind not in REPORT_TITLES:
        raise HTTPException(status_code=404, detail="Relatório não encontrado")
    data = await build_hr_report(kind, date_from, date_to, department, status, month, current_user)
    return {"title": REPORT_TITLES[kind], "summary": data["summary"], "info": data["info"],
            "sections": [_section_preview(s) for s in data["sections"]]}


@api_router.get("/reports/hr/{kind}/pdf")
async def get_hr_report_pdf(kind: str, date_from: Optional[str] = None, date_to: Optional[str] = None,
                            department: Optional[str] = None, status: Optional[str] = None, month: Optional[int] = None,
                            current_user: dict = Depends(get_current_admin_user)):
    if kind not in REPORT_TITLES:
        raise HTTPException(status_code=404, detail="Relatório não encontrado")
    data = await build_hr_report(kind, date_from, date_to, department, status, month, current_user)
    return await pdf_response(REPORT_TITLES[kind], data["subtitle"], data["info"], data["sections"],
                              f"rh_{kind.replace('-', '_')}", current_user.get("name", "Sistema"))


@api_router.get("/reports/hr/{kind}/excel")
async def get_hr_report_excel(kind: str, date_from: Optional[str] = None, date_to: Optional[str] = None,
                              department: Optional[str] = None, status: Optional[str] = None, month: Optional[int] = None,
                              current_user: dict = Depends(get_current_admin_user)):
    if kind not in REPORT_TITLES:
        raise HTTPException(status_code=404, detail="Relatório não encontrado")
    data = await build_hr_report(kind, date_from, date_to, department, status, month, current_user)
    return await excel_response(REPORT_TITLES[kind], data["subtitle"], data["sections"], f"rh_{kind.replace('-', '_')}")
