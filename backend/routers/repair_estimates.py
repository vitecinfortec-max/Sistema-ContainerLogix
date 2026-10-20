from datetime import datetime, timedelta, timezone
from typing import Optional
import io
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from list_filters import combine, period_query, text_query
from models import REPAIR_ESTIMATE_STATUS_OPTIONS, RepairEstimateCreate, RepairEstimateStatusUpdate, RepairEstimateResponse
from reports import BRT_TZ, merge_company
from shared import db, get_current_active_user, get_company_settings, load_logo_buffer

api_router = APIRouter(prefix="/api")

# ==================== TERMINAL - ORÇAMENTO DE REPARO ====================
# Orçamento dos reparos de um container que chegou com avarias, para o
# cliente/armador aprovar antes da execução. Os itens podem vir da Vistoria de
# Container (os "Tipo de Serviços" marcados nela) e o preço de cada serviço é
# sugerido pelo último orçamento que o usou. "Vencido" não é status gravado:
# é o orçamento ainda EM_ABERTO depois da validade.

STATUS_LABELS = {"EM_ABERTO": "Em aberto", "APROVADO": "Aprovado", "REPROVADO": "Reprovado", "CANCELADO": "Cancelado"}

# Respondido (aprovado/reprovado) ou cancelado só volta para Em aberto - se
# foi engano, reabre e responde de novo.
ALLOWED_TRANSITIONS = {
    "EM_ABERTO": {"APROVADO", "REPROVADO", "CANCELADO"},
    "APROVADO": {"EM_ABERTO"},
    "REPROVADO": {"EM_ABERTO"},
    "CANCELADO": {"EM_ABERTO"},
}

SEARCH_FIELDS = ("container_number", "client_name", "shipping_line", "items.description")
STATUS_FILTER_PATTERN = "^(EM_ABERTO|APROVADO|REPROVADO|CANCELADO|VENCIDO)$"


def estimate_code(number) -> str:
    return f"OR{int(number or 0):06d}"


def _clean(value: Optional[str]) -> Optional[str]:
    value = (value or "").strip()
    return value or None


def _created_day(estimate: dict):
    created = estimate["created_at"]
    if isinstance(created, str):
        created = datetime.fromisoformat(created)
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return created.astimezone(BRT_TZ).date()


def valid_until(estimate: dict):
    return _created_day(estimate) + timedelta(days=estimate.get("validity_days") or 0)


def is_expired(estimate: dict) -> bool:
    return estimate.get("status") == "EM_ABERTO" and valid_until(estimate) < datetime.now(BRT_TZ).date()


def _validate(data: RepairEstimateCreate) -> dict:
    container_number = (data.container_number or "").strip().upper()
    if not container_number:
        raise HTTPException(status_code=400, detail="Informe o número do container")
    items = []
    for idx, item in enumerate(data.items, start=1):
        description = _clean(item.description)
        if not description:
            raise HTTPException(status_code=400, detail=f"Informe o serviço do item {idx}")
        if item.quantity is None or item.quantity <= 0:
            raise HTTPException(status_code=400, detail=f"A quantidade do item {idx} deve ser maior que zero")
        if item.unit_price is None or item.unit_price < 0:
            raise HTTPException(status_code=400, detail=f"O valor unitário do item {idx} não pode ser negativo")
        quantity = round(item.quantity, 2)
        unit_price = round(item.unit_price, 2)
        items.append({"description": description, "quantity": quantity, "unit_price": unit_price, "total": round(quantity * unit_price, 2)})
    if not items:
        raise HTTPException(status_code=400, detail="Inclua ao menos um serviço no orçamento")
    subtotal = round(sum(i["total"] for i in items), 2)
    discount = round(data.discount or 0, 2)
    if discount < 0:
        raise HTTPException(status_code=400, detail="O desconto não pode ser negativo")
    if discount > subtotal:
        raise HTTPException(status_code=400, detail="O desconto não pode ser maior que o subtotal")
    if data.validity_days is None or data.validity_days < 1:
        raise HTTPException(status_code=400, detail="A validade deve ser de pelo menos 1 dia")
    if data.execution_days is not None and data.execution_days < 0:
        raise HTTPException(status_code=400, detail="O prazo de execução não pode ser negativo")
    return {
        "container_number": container_number,
        "client_name": _clean(data.client_name),
        "shipping_line": _clean(data.shipping_line),
        "size_type": _clean(data.size_type),
        "items": items,
        "subtotal": subtotal,
        "discount": discount,
        "total": round(subtotal - discount, 2),
        "validity_days": data.validity_days,
        "execution_days": data.execution_days,
        "observations": _clean(data.observations),
    }


async def _vistoria_link(vistoria_id: Optional[str]) -> dict:
    if not vistoria_id:
        return {"vistoria_id": None, "vistoria_number": None}
    vistoria = await db.container_vistorias.find_one({"id": vistoria_id}, {"_id": 0, "id": 1, "vistoria_number": 1})
    if not vistoria:
        raise HTTPException(status_code=400, detail="Vistoria de container de origem não encontrada")
    return {"vistoria_id": vistoria["id"], "vistoria_number": vistoria["vistoria_number"]}


def _search_query(search: Optional[str]) -> dict:
    query = text_query(SEARCH_FIELDS, search)
    # "OR000123" ou "123" também acham pelo número do orçamento
    match = re.fullmatch(r"(?i)\s*(?:OR)?0*(\d+)\s*", search or "")
    if query and match:
        query["$or"].append({"estimate_number": int(match.group(1))})
    return query


def _status_query(status: Optional[str]) -> dict:
    if status == "VENCIDO":
        return {"status": "EM_ABERTO"}  # a validade é conferida depois, em Python
    return {"status": status} if status else {}


def _build_query(search, status, date_from, date_to) -> dict:
    return combine(_search_query(search), _status_query(status), period_query("created_at", date_from, date_to))


@api_router.get("/repair-estimates")
async def list_repair_estimates(
    search: Optional[str] = None,
    status: Optional[str] = Query(None, pattern=STATUS_FILTER_PATTERN),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=200),
    current_user: dict = Depends(get_current_active_user)
):
    """Lista os orçamentos de reparo, do mais recente para o mais antigo"""
    query = _build_query(search, status, date_from, date_to)
    cursor = db.repair_estimates.find(query, {"_id": 0}).sort("estimate_number", -1)
    if status == "VENCIDO":
        # Vencido depende da validade de cada um: filtra tudo e pagina aqui
        rows = [e for e in await cursor.to_list(length=None) if is_expired(e)]
        total = len(rows)
        items = rows[(page - 1) * per_page: page * per_page]
    else:
        total = await db.repair_estimates.count_documents(query)
        items = await cursor.skip((page - 1) * per_page).limit(per_page).to_list(length=per_page)
    return {
        "items": items,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
    }


@api_router.get("/repair-estimates/summary")
async def get_repair_estimates_summary(current_user: dict = Depends(get_current_active_user)):
    """Indicadores do topo da tela: em aberto, vencidos sem resposta,
    aprovados e reprovados (aprovados/reprovados dos últimos 30 dias)."""
    summary = {key: {"count": 0, "total": 0.0} for key in ("open", "expired", "approved", "rejected")}
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    cursor = db.repair_estimates.find(
        {"status": {"$in": ["EM_ABERTO", "APROVADO", "REPROVADO"]}},
        {"_id": 0, "status": 1, "total": 1, "created_at": 1, "validity_days": 1, "responded_at": 1},
    )
    async for doc in cursor:
        key = None
        if doc["status"] == "EM_ABERTO":
            key = "expired" if is_expired(doc) else "open"
        elif (doc.get("responded_at") or "") >= since:
            key = "approved" if doc["status"] == "APROVADO" else "rejected"
        if key:
            summary[key]["count"] += 1
            summary[key]["total"] += doc.get("total") or 0
    for value in summary.values():
        value["total"] = round(value["total"], 2)
    return summary


@api_router.get("/repair-estimates/last-prices")
async def get_repair_estimates_last_prices(current_user: dict = Depends(get_current_active_user)):
    """Último valor unitário usado em cada serviço (nome sem diferença de
    maiúsculas) - a tela sugere esse preço ao incluir o serviço de novo."""
    prices = {}
    cursor = db.repair_estimates.find({"status": {"$ne": "CANCELADO"}}, {"_id": 0, "items": 1}).sort("estimate_number", -1).limit(500)
    async for doc in cursor:
        for item in doc.get("items") or []:
            key = (item.get("description") or "").strip().casefold()
            if key and key not in prices:
                prices[key] = item.get("unit_price") or 0
    return prices


@api_router.get("/repair-estimates/{estimate_id}", response_model=RepairEstimateResponse)
async def get_repair_estimate(estimate_id: str, current_user: dict = Depends(get_current_active_user)):
    estimate = await db.repair_estimates.find_one({"id": estimate_id}, {"_id": 0})
    if not estimate:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")
    return estimate


@api_router.post("/repair-estimates", response_model=RepairEstimateResponse)
async def create_repair_estimate(data: RepairEstimateCreate, current_user: dict = Depends(get_current_active_user)):
    fields = _validate(data)
    link = await _vistoria_link(data.vistoria_id)
    counter = await db.counters.find_one_and_update(
        {"_id": "repair_estimate_number"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    now = datetime.now(timezone.utc).isoformat()
    by_name = current_user.get("name", "Sistema")
    estimate = {
        "id": str(uuid.uuid4()),
        "estimate_number": counter["seq"],
        **fields,
        **link,
        "status": "EM_ABERTO",
        "responded_by": None,
        "responded_at": None,
        "response_note": None,
        "history": [{"status": "EM_ABERTO", "at": now, "by_name": by_name, "note": None}],
        "created_by": current_user["sub"],
        "created_by_name": by_name,
        "created_at": now,
        "updated_at": None,
    }
    await db.repair_estimates.insert_one(estimate)
    estimate.pop("_id", None)
    return estimate


@api_router.put("/repair-estimates/{estimate_id}", response_model=RepairEstimateResponse)
async def update_repair_estimate(estimate_id: str, data: RepairEstimateCreate, current_user: dict = Depends(get_current_active_user)):
    estimate = await db.repair_estimates.find_one({"id": estimate_id}, {"_id": 0, "status": 1})
    if not estimate:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")
    if estimate["status"] != "EM_ABERTO":
        raise HTTPException(status_code=400, detail="Só é possível editar orçamento em aberto. Reabra o orçamento antes de editar.")
    fields = _validate(data)
    fields.update(await _vistoria_link(data.vistoria_id))
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.repair_estimates.update_one({"id": estimate_id}, {"$set": fields})
    return await db.repair_estimates.find_one({"id": estimate_id}, {"_id": 0})


@api_router.put("/repair-estimates/{estimate_id}/status", response_model=RepairEstimateResponse)
async def update_repair_estimate_status(estimate_id: str, data: RepairEstimateStatusUpdate, current_user: dict = Depends(get_current_active_user)):
    if data.status not in REPAIR_ESTIMATE_STATUS_OPTIONS:
        raise HTTPException(status_code=400, detail="Status inválido")
    estimate = await db.repair_estimates.find_one({"id": estimate_id}, {"_id": 0})
    if not estimate:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")
    current = estimate["status"]
    if data.status == current:
        return estimate
    if data.status not in ALLOWED_TRANSITIONS[current]:
        raise HTTPException(
            status_code=400,
            detail=f"Orçamento {STATUS_LABELS[current].lower()} não pode ser marcado como {STATUS_LABELS[data.status].lower()}. Reabra o orçamento antes, se foi engano.",
        )

    now = datetime.now(timezone.utc).isoformat()
    note = _clean(data.note)
    update = {"status": data.status, "responded_by": None, "responded_at": None, "response_note": None, "updated_at": now}
    if data.status in ("APROVADO", "REPROVADO"):
        responded_by = _clean(data.responded_by)
        if not responded_by:
            raise HTTPException(status_code=400, detail="Informe quem respondeu pelo cliente")
        if data.status == "REPROVADO" and not note:
            raise HTTPException(status_code=400, detail="Informe o motivo da reprovação")
        update.update({"responded_by": responded_by, "responded_at": now, "response_note": note})
        note = f"{responded_by}" + (f" - {note}" if note else "")

    await db.repair_estimates.update_one(
        {"id": estimate_id},
        {"$set": update, "$push": {"history": {"status": data.status, "at": now, "by_name": current_user.get("name", "Sistema"), "note": note}}},
    )
    return await db.repair_estimates.find_one({"id": estimate_id}, {"_id": 0})


@api_router.delete("/repair-estimates/{estimate_id}")
async def delete_repair_estimate(estimate_id: str, current_user: dict = Depends(get_current_active_user)):
    estimate = await db.repair_estimates.find_one({"id": estimate_id}, {"_id": 0, "status": 1})
    if not estimate:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")
    # A resposta do cliente fica registrada: aprovado/reprovado não some
    if estimate["status"] in ("APROVADO", "REPROVADO"):
        raise HTTPException(status_code=400, detail=f"Orçamento {STATUS_LABELS[estimate['status']].lower()} não pode ser excluído. Reabra o orçamento antes, se foi engano.")
    await db.repair_estimates.delete_one({"id": estimate_id})
    return {"message": "Orçamento excluído com sucesso"}


@api_router.get("/repair-estimates/{estimate_id}/pdf")
async def get_repair_estimate_pdf(estimate_id: str, current_user: dict = Depends(get_current_active_user)):
    """Documento do orçamento para enviar ao cliente/armador"""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    from reports import (
        _build_pdf_header, _make_pdf_footer, format_currency, _pdf_info_grid, _pdf_header_cells,
        _pdf_cell_factory, _pdf_table_style, _pdf_totals_box, _pdf_note_box, _pdf_signatures,
    )

    estimate = await db.repair_estimates.find_one({"id": estimate_id}, {"_id": 0})
    if not estimate:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")

    company = merge_company(await get_company_settings())
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=12*mm, leftMargin=12*mm, topMargin=10*mm, bottomMargin=14*mm)
    width = doc.width
    styles = getSampleStyleSheet()
    code = estimate_code(estimate["estimate_number"])

    elements = list(_build_pdf_header(styles, load_logo_buffer(company), "Orçamento de Reparo", generation_info=f"Nº {code}", company=company, content_width=width))

    status_text = "Vencido" if is_expired(estimate) else STATUS_LABELS.get(estimate["status"], estimate["status"])
    execution = estimate.get("execution_days")
    pairs = [
        ("Container", estimate["container_number"]),
        ("Tamanho/Tipo", estimate.get("size_type")),
        ("Cliente", estimate.get("client_name"), 2),
        ("Armador", estimate.get("shipping_line")),
        ("Emissão", _created_day(estimate).strftime("%d/%m/%Y")),
        ("Válido até", valid_until(estimate).strftime("%d/%m/%Y")),
        ("Status", status_text),
        ("Vistoria de origem", f"VC{estimate['vistoria_number']:06d}" if estimate.get("vistoria_number") else None),
        ("Prazo de execução", f"{execution} dia(s) após a aprovação" if execution else None, 2),
        ("Elaborado por", estimate.get("created_by_name")),
    ]
    if estimate["status"] in ("APROVADO", "REPROVADO"):
        responded = estimate.get("responded_at")
        responded_day = datetime.fromisoformat(responded).astimezone(BRT_TZ).strftime("%d/%m/%Y") if isinstance(responded, str) else "-"
        pairs.append((f"{STATUS_LABELS[estimate['status']]} por", f"{estimate.get('responded_by') or '-'} em {responded_day}", 4))
    elements.append(_pdf_info_grid(pairs, width, cols=4))
    elements.append(Spacer(1, 10))

    cell = _pdf_cell_factory(styles, font_size=8)
    table_data = [_pdf_header_cells(["#", "Serviço", "Qtd.", "Valor unit.", "Total"], font_size=8)]
    for idx, item in enumerate(estimate.get("items") or [], start=1):
        quantity = item.get("quantity") or 0
        table_data.append([
            cell(idx, "center"),
            cell(item.get("description")),
            cell(f"{quantity:g}".replace(".", ","), "center"),
            cell(format_currency(item.get("unit_price") or 0, "BRL"), "right"),
            cell(format_currency(item.get("total") or 0, "BRL"), "right", bold=True),
        ])
    base_widths = [22, 300, 45, 80, 85]
    scale = width / sum(base_widths)
    table = Table(table_data, colWidths=[w * scale for w in base_widths], repeatRows=1)
    table.setStyle(TableStyle(_pdf_table_style()))
    elements.append(table)
    elements.append(Spacer(1, 10))

    totals = [("Subtotal", format_currency(estimate.get("subtotal") or 0, "BRL"))]
    if estimate.get("discount"):
        totals.append(("Desconto", "- " + format_currency(estimate["discount"], "BRL")))
    totals.append(("Total do orçamento", format_currency(estimate.get("total") or 0, "BRL")))
    elements.append(_pdf_totals_box(totals, width))

    if estimate.get("observations"):
        elements.append(Spacer(1, 10))
        elements.append(_pdf_note_box("Observações", estimate["observations"], width))
    if estimate.get("response_note"):
        elements.append(Spacer(1, 8))
        title = "Motivo da reprovação" if estimate["status"] == "REPROVADO" else "Observação da aprovação"
        elements.append(_pdf_note_box(title, estimate["response_note"], width))

    elements.append(Spacer(1, 18))
    elements.append(_pdf_signatures([
        ("Responsável pelo orçamento", estimate.get("created_by_name")),
        ("De acordo do cliente", "Nome / data"),
    ], width))

    footer = _make_pdf_footer(company["name"])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    buffer.seek(0)
    filename = f"orcamento_reparo_{code}_{estimate['container_number']}.pdf"
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{filename}"'})
