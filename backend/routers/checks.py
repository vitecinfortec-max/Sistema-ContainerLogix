from datetime import date, datetime, timedelta, timezone
from typing import Optional
import io
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from models import CHECK_STATUS_OPTIONS, CheckCreate, CheckStatusUpdate, CheckResponse
from reports import BRT_TZ, merge_company
from routers.movements import _parse_filter_day
from shared import db, get_current_admin_user, get_company_settings, load_logo_buffer

api_router = APIRouter(prefix="/api")

# ==================== FINANCEIRO - CONTROLE DE CHEQUE ====================
# Cheques emitidos pela empresa: data de emissão, vencimento ("bom para") e o
# que aconteceu com cada um (compensado, devolvido, cancelado). "Vencido" não é
# um status gravado: é o cheque ainda EMITIDO com vencimento antes de hoje.

STATUS_LABELS = {"EMITIDO": "Emitido", "COMPENSADO": "Compensado", "DEVOLVIDO": "Devolvido", "CANCELADO": "Cancelado"}

# Status atual -> para onde pode ir. Compensado não é cancelado (o dinheiro já
# saiu); se a compensação foi lançada por engano, volta para Emitido.
ALLOWED_TRANSITIONS = {
    "EMITIDO": {"COMPENSADO", "DEVOLVIDO", "CANCELADO"},
    "DEVOLVIDO": {"EMITIDO", "COMPENSADO", "CANCELADO"},
    "COMPENSADO": {"EMITIDO", "DEVOLVIDO"},
    "CANCELADO": {"EMITIDO"},
}

DUE_SOON_DAYS = 7


def _today() -> date:
    return datetime.now(BRT_TZ).date()


def _parse_day(value: Optional[str], label: str) -> date:
    if not value:
        raise HTTPException(status_code=400, detail=f"Informe a {label}")
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{label[0].upper() + label[1:]} inválida: use o formato AAAA-MM-DD")


def _clean(value: Optional[str]) -> Optional[str]:
    value = (value or "").strip()
    return value or None


def _validate_check(data: CheckCreate) -> dict:
    check_number = _clean(data.check_number)
    bank = _clean(data.bank)
    payee = _clean(data.payee)
    if not check_number:
        raise HTTPException(status_code=400, detail="Informe o número do cheque")
    if not bank:
        raise HTTPException(status_code=400, detail="Informe o banco")
    if not payee:
        raise HTTPException(status_code=400, detail="Informe o favorecido")
    if data.amount is None or data.amount <= 0:
        raise HTTPException(status_code=400, detail="O valor do cheque deve ser maior que zero")
    issue = _parse_day(data.issue_date, "data de emissão")
    due = _parse_day(data.due_date, "data de vencimento")
    if due < issue:
        raise HTTPException(status_code=400, detail="O vencimento não pode ser antes da data de emissão")
    return {
        "check_number": check_number,
        "bank": bank,
        "agency": _clean(data.agency),
        "account": _clean(data.account),
        "payee": payee,
        "amount": round(data.amount, 2),
        "issue_date": issue.isoformat(),
        "due_date": due.isoformat(),
        "description": _clean(data.description),
        "observations": _clean(data.observations),
    }


async def _ensure_not_duplicate(fields: dict, exclude_id: Optional[str] = None):
    """A mesma folha (banco + agência + conta + número) não entra duas vezes -
    nem cancelada, porque a folha física também não volta a existir."""
    query = {
        "check_number": fields["check_number"],
        "bank": {"$regex": f"^{re.escape(fields['bank'])}$", "$options": "i"},
        "agency": fields["agency"],
        "account": fields["account"],
    }
    if exclude_id:
        query["id"] = {"$ne": exclude_id}
    if await db.checks.find_one(query, {"_id": 1}):
        raise HTTPException(status_code=400, detail=f"O cheque nº {fields['check_number']} desse banco/conta já está cadastrado")


def _build_query(search, status, date_field, date_from, date_to) -> dict:
    query = {}
    if search:
        search_escaped = re.escape(search.strip())
        query["$or"] = [
            {field: {"$regex": search_escaped, "$options": "i"}}
            for field in ("check_number", "payee", "bank", "description")
        ]
    if status == "VENCIDO":
        query["status"] = "EMITIDO"
        query["due_date"] = {"$lt": _today().isoformat()}
    elif status:
        query["status"] = status
    period = {}
    if date_from:
        period["$gte"] = _parse_filter_day(date_from, "date_from").isoformat()
    if date_to:
        period["$lte"] = _parse_filter_day(date_to, "date_to").isoformat()
    if period:
        query.setdefault(date_field, {}).update(period)
    return query


STATUS_FILTER_PATTERN = "^(EMITIDO|COMPENSADO|DEVOLVIDO|CANCELADO|VENCIDO)$"
DATE_FIELD_PATTERN = "^(due_date|issue_date|compensation_date)$"


@api_router.get("/checks")
async def get_checks(
    search: Optional[str] = None,
    status: Optional[str] = Query(None, pattern=STATUS_FILTER_PATTERN),
    date_field: str = Query("due_date", pattern=DATE_FIELD_PATTERN),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=200),
    current_user: dict = Depends(get_current_admin_user)
):
    """Lista os cheques, do vencimento mais recente para o mais antigo"""
    query = _build_query(search, status, date_field, date_from, date_to)
    total = await db.checks.count_documents(query)
    cursor = db.checks.find(query, {"_id": 0}).sort([("due_date", -1), ("check_number", -1)]).skip((page - 1) * per_page).limit(per_page)
    items = await cursor.to_list(length=per_page)
    return {
        "items": items,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
    }


@api_router.get("/checks/summary")
async def get_checks_summary(current_user: dict = Depends(get_current_admin_user)):
    """Indicadores do topo da tela: em aberto, vencendo nos próximos dias,
    vencidos sem compensar e devolvidos."""
    today = _today()
    soon = (today + timedelta(days=DUE_SOON_DAYS)).isoformat()
    today_iso = today.isoformat()
    summary = {key: {"count": 0, "total": 0.0} for key in ("open", "due_soon", "overdue", "returned")}

    def add(key, doc):
        summary[key]["count"] += 1
        summary[key]["total"] += doc.get("amount") or 0

    cursor = db.checks.find({"status": {"$in": ["EMITIDO", "DEVOLVIDO"]}}, {"_id": 0, "status": 1, "amount": 1, "due_date": 1})
    async for doc in cursor:
        if doc["status"] == "DEVOLVIDO":
            add("returned", doc)
            continue
        add("open", doc)
        due = doc.get("due_date") or ""
        if due < today_iso:
            add("overdue", doc)
        elif due <= soon:
            add("due_soon", doc)
    for value in summary.values():
        value["total"] = round(value["total"], 2)
    summary["due_soon_days"] = DUE_SOON_DAYS
    # Talão em uso: o cadastro de um cheque novo já vem com banco/conta e a
    # folha seguinte a esta
    summary["last_check"] = await db.checks.find_one(
        {}, {"_id": 0, "check_number": 1, "bank": 1, "agency": 1, "account": 1}, sort=[("created_at", -1)],
    )
    return summary


@api_router.get("/checks/report/pdf")
async def get_checks_report_pdf(
    search: Optional[str] = None,
    status: Optional[str] = Query(None, pattern=STATUS_FILTER_PATTERN),
    date_field: str = Query("due_date", pattern=DATE_FIELD_PATTERN),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    """Relatório em PDF dos cheques com os mesmos filtros da tela"""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    from reports import (
        _build_pdf_header, _make_pdf_footer, format_currency, _fmt_int,
        _pdf_info_grid, _pdf_header_cells, _pdf_cell_factory, _pdf_table_style,
        _pdf_empty_state, _pdf_totals_box,
    )

    query = _build_query(search, status, date_field, date_from, date_to)
    checks = await db.checks.find(query, {"_id": 0}).sort([("due_date", 1), ("check_number", 1)]).to_list(length=None)

    company = merge_company(await get_company_settings())
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), rightMargin=12*mm, leftMargin=12*mm, topMargin=10*mm, bottomMargin=14*mm)
    width = doc.width
    styles = getSampleStyleSheet()

    def fmt_day(value):
        return date.fromisoformat(value).strftime("%d/%m/%Y") if value else "-"

    date_labels = {"due_date": "Vencimento", "issue_date": "Emissão", "compensation_date": "Compensação"}
    period = None
    if date_from or date_to:
        period = f"{date_labels[date_field]}: {fmt_day(date_from) if date_from else 'início'} a {fmt_day(date_to) if date_to else 'hoje'}"

    elements = list(_build_pdf_header(styles, load_logo_buffer(company), "Controle de Cheques", generation_info=period, company=company, content_width=width))

    status_text = "Vencidos" if status == "VENCIDO" else STATUS_LABELS.get(status, "Todos")
    elements.append(_pdf_info_grid([
        ("Gerado em", datetime.now(BRT_TZ).strftime("%d/%m/%Y %H:%M")),
        ("Gerado por", current_user.get("name", "Sistema")),
        ("Status", status_text),
        ("Cheques", _fmt_int(len(checks))),
    ], width, cols=4))
    elements.append(Spacer(1, 10))

    if not checks:
        elements.append(_pdf_empty_state("Nenhum cheque encontrado com esses filtros.", width))
    else:
        today_iso = _today().isoformat()
        cell = _pdf_cell_factory(styles, font_size=7.5)
        table_data = [_pdf_header_cells(["Nº", "Banco", "Ag./Conta", "Favorecido", "Finalidade", "Emissão", "Vencimento", "Compensação", "Status", "Valor"], font_size=7.5)]
        for check in checks:
            label = STATUS_LABELS.get(check["status"], check["status"])
            if check["status"] == "EMITIDO" and check["due_date"] < today_iso:
                label = "Vencido"
            agency_account = " / ".join(v for v in (check.get("agency"), check.get("account")) if v) or "-"
            table_data.append([
                cell(check["check_number"], "center", bold=True),
                cell(check["bank"]),
                cell(agency_account, "center"),
                cell(check["payee"]),
                cell(check.get("description")),
                cell(fmt_day(check["issue_date"]), "center"),
                cell(fmt_day(check["due_date"]), "center"),
                cell(fmt_day(check.get("compensation_date")), "center"),
                cell(label, "center"),
                cell(format_currency(check["amount"], "BRL"), "right", bold=True),
            ])
        base_widths = [45, 75, 65, 120, 110, 52, 58, 62, 55, 70]
        scale = width / sum(base_widths)
        table = Table(table_data, colWidths=[w * scale for w in base_widths], repeatRows=1)
        table.setStyle(TableStyle(_pdf_table_style()))
        elements.append(table)

        totals = {}
        for check in checks:
            totals[check["status"]] = totals.get(check["status"], 0) + check["amount"]
        rows = [(STATUS_LABELS[s], format_currency(totals[s], "BRL")) for s in CHECK_STATUS_OPTIONS if s in totals]
        rows.append(("Total geral", format_currency(sum(totals.values()), "BRL")))
        elements.append(Spacer(1, 10))
        elements.append(_pdf_totals_box(rows, width))

    footer = _make_pdf_footer(company["name"])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": "attachment; filename=controle_cheques.pdf"})


@api_router.get("/checks/{check_id}", response_model=CheckResponse)
async def get_check(check_id: str, current_user: dict = Depends(get_current_admin_user)):
    check = await db.checks.find_one({"id": check_id}, {"_id": 0})
    if not check:
        raise HTTPException(status_code=404, detail="Cheque não encontrado")
    return check


@api_router.post("/checks", response_model=CheckResponse)
async def create_check(data: CheckCreate, current_user: dict = Depends(get_current_admin_user)):
    fields = _validate_check(data)
    await _ensure_not_duplicate(fields)
    now = datetime.now(timezone.utc).isoformat()
    by_name = current_user.get("name", "Sistema")
    check = {
        "id": str(uuid.uuid4()),
        **fields,
        "status": "EMITIDO",
        "compensation_date": None,
        "return_reason": None,
        "history": [{"status": "EMITIDO", "at": now, "by_name": by_name, "note": None}],
        "created_by": current_user["sub"],
        "created_by_name": by_name,
        "created_at": now,
        "updated_at": None,
    }
    await db.checks.insert_one(check)
    check.pop("_id", None)
    return check


@api_router.put("/checks/{check_id}", response_model=CheckResponse)
async def update_check(check_id: str, data: CheckCreate, current_user: dict = Depends(get_current_admin_user)):
    check = await db.checks.find_one({"id": check_id}, {"_id": 0, "status": 1})
    if not check:
        raise HTTPException(status_code=404, detail="Cheque não encontrado")
    if check["status"] != "EMITIDO":
        raise HTTPException(status_code=400, detail="Só é possível editar cheque emitido. Volte o status para Emitido antes de editar.")
    fields = _validate_check(data)
    await _ensure_not_duplicate(fields, exclude_id=check_id)
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.checks.update_one({"id": check_id}, {"$set": fields})
    return await db.checks.find_one({"id": check_id}, {"_id": 0})


@api_router.put("/checks/{check_id}/status", response_model=CheckResponse)
async def update_check_status(check_id: str, data: CheckStatusUpdate, current_user: dict = Depends(get_current_admin_user)):
    if data.status not in CHECK_STATUS_OPTIONS:
        raise HTTPException(status_code=400, detail="Status inválido")
    check = await db.checks.find_one({"id": check_id}, {"_id": 0})
    if not check:
        raise HTTPException(status_code=404, detail="Cheque não encontrado")
    current = check["status"]
    if data.status == current:
        return check
    if data.status not in ALLOWED_TRANSITIONS[current]:
        raise HTTPException(
            status_code=400,
            detail=f"Cheque {STATUS_LABELS[current].lower()} não pode ser marcado como {STATUS_LABELS[data.status].lower()}. Volte para Emitido antes, se foi engano.",
        )

    update = {"status": data.status, "compensation_date": None, "return_reason": None}
    note = None
    if data.status == "COMPENSADO":
        compensated = _parse_day(data.compensation_date, "data de compensação")
        if compensated < date.fromisoformat(check["issue_date"]):
            raise HTTPException(status_code=400, detail="A compensação não pode ser antes da data de emissão")
        if compensated > _today():
            raise HTTPException(status_code=400, detail="A data de compensação não pode ser no futuro")
        update["compensation_date"] = compensated.isoformat()
        note = f"Compensado em {compensated.strftime('%d/%m/%Y')}"
    elif data.status == "DEVOLVIDO":
        reason = _clean(data.return_reason)
        if not reason:
            raise HTTPException(status_code=400, detail="Informe o motivo da devolução")
        update["return_reason"] = reason
        note = reason

    now = datetime.now(timezone.utc).isoformat()
    update["updated_at"] = now
    await db.checks.update_one(
        {"id": check_id},
        {"$set": update, "$push": {"history": {"status": data.status, "at": now, "by_name": current_user.get("name", "Sistema"), "note": note}}},
    )
    return await db.checks.find_one({"id": check_id}, {"_id": 0})


@api_router.delete("/checks/{check_id}")
async def delete_check(check_id: str, current_user: dict = Depends(get_current_admin_user)):
    check = await db.checks.find_one({"id": check_id}, {"_id": 0, "status": 1})
    if not check:
        raise HTTPException(status_code=404, detail="Cheque não encontrado")
    # Compensado/devolvido é movimento real na conta: fica como registro
    if check["status"] in ("COMPENSADO", "DEVOLVIDO"):
        raise HTTPException(status_code=400, detail=f"Cheque {STATUS_LABELS[check['status']].lower()} não pode ser excluído. Volte para Emitido antes, se foi engano.")
    await db.checks.delete_one({"id": check_id})
    return {"message": "Cheque excluído com sucesso"}
