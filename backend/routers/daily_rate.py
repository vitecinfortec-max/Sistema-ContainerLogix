from datetime import datetime, timezone
from typing import Optional
import io
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from models import DailyRateRequestItem, DailyRateRequestCreate, DailyRateRequestResponse
from reports import merge_company

from shared import db, get_current_admin_user, get_company_settings, parse_datetime_value, load_logo_buffer

api_router = APIRouter(prefix="/api")

# ==================== FINANCEIRO - SOLICITAÇÃO DE DIÁRIA ====================

from models import DailyRateRequestCreate, DailyRateRequestResponse, DailyRateRequestItem


def calculate_daily_rate_item_total(item: DailyRateRequestItem) -> float:
    return round(
        item.others_value + item.commission_value + item.lunch_value
        + item.daily_rate_quantity * item.daily_rate_value,
        2
    )


DAILY_RATE_MONEY_FIELDS = (
    ("others_value", "Outros"), ("commission_value", "Comissão"), ("lunch_value", "Almoço"),
    ("daily_rate_quantity", "Qtd. Diária"), ("daily_rate_value", "Diária"),
)


def _build_daily_rate_items(data: DailyRateRequestCreate):
    """Valida e totaliza os itens - antes aceitava solicitação sem item e
    valores negativos (que abatiam do total)."""
    if not data.items:
        raise HTTPException(status_code=400, detail="A solicitação deve ter pelo menos um item")
    items_data = []
    total_value = 0.0
    for idx, item in enumerate(data.items, 1):
        for field, label in DAILY_RATE_MONEY_FIELDS:
            if (getattr(item, field) or 0) < 0:
                raise HTTPException(status_code=400, detail=f"Item {idx}: {label} não pode ser negativo")
        item.total = calculate_daily_rate_item_total(item)
        total_value += item.total
        items_data.append(item.model_dump())
    return items_data, round(total_value, 2)


@api_router.get("/daily-rate-requests")
async def get_daily_rate_requests(
    search: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    current_user: dict = Depends(get_current_admin_user)
):
    """Lista todas as solicitações de diária"""
    query = {}

    if search:
        search_escaped = re.escape(search)
        query["$or"] = [
            {"items.driver_name": {"$regex": search_escaped, "$options": "i"}},
            {"items.vehicle_plate": {"$regex": search_escaped, "$options": "i"}},
            {"items.client_name": {"$regex": search_escaped, "$options": "i"}}
        ]

    if status:
        query["status"] = status

    total = await db.daily_rate_requests.count_documents(query)
    skip = (page - 1) * per_page

    cursor = db.daily_rate_requests.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page)
    requests_list = await cursor.to_list(length=per_page)

    return {
        "items": requests_list,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page
    }


@api_router.get("/daily-rate-requests/{request_id}", response_model=DailyRateRequestResponse)
async def get_daily_rate_request(request_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Busca solicitação de diária por ID"""
    daily_request = await db.daily_rate_requests.find_one({"id": request_id}, {"_id": 0})
    if not daily_request:
        raise HTTPException(status_code=404, detail="Solicitação de diária não encontrada")
    return daily_request


@api_router.post("/daily-rate-requests", response_model=DailyRateRequestResponse)
async def create_daily_rate_request(data: DailyRateRequestCreate, current_user: dict = Depends(get_current_admin_user)):
    """Cria nova solicitação de diária"""
    items_data, total_value = _build_daily_rate_items(data)

    # Número reservado depois de validar, pra não pular número
    counter = await db.counters.find_one_and_update(
        {"_id": "daily_rate_request_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    request_number = counter["seq"]

    request_data = {
        "id": str(uuid.uuid4()),
        "request_number": request_number,
        "items": items_data,
        "total_value": total_value,
        "status": "PENDENTE",
        "observations": data.observations,
        "created_by": current_user["sub"],
        "created_by_name": current_user.get("name", "Sistema"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": None
    }

    await db.daily_rate_requests.insert_one(request_data)
    request_data.pop("_id", None)

    return request_data


@api_router.put("/daily-rate-requests/{request_id}", response_model=DailyRateRequestResponse)
async def update_daily_rate_request(request_id: str, data: DailyRateRequestCreate, current_user: dict = Depends(get_current_admin_user)):
    """Atualiza solicitação de diária"""
    daily_request = await db.daily_rate_requests.find_one({"id": request_id})
    if not daily_request:
        raise HTTPException(status_code=404, detail="Solicitação de diária não encontrada")
    # Paga ou cancelada não muda mais de valor (volte para Pendente antes)
    if daily_request.get('status', 'PENDENTE') != 'PENDENTE':
        raise HTTPException(status_code=400, detail="Só é possível editar solicitação pendente. Volte o status para Pendente antes de editar.")

    items_data, total_value = _build_daily_rate_items(data)

    update_data = {
        "items": items_data,
        "total_value": total_value,
        "observations": data.observations,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }

    await db.daily_rate_requests.update_one({"id": request_id}, {"$set": update_data})
    updated = await db.daily_rate_requests.find_one({"id": request_id}, {"_id": 0})
    return updated


@api_router.delete("/daily-rate-requests/{request_id}")
async def delete_daily_rate_request(request_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Exclui solicitação de diária"""
    daily_request = await db.daily_rate_requests.find_one({"id": request_id})
    if not daily_request:
        raise HTTPException(status_code=404, detail="Solicitação de diária não encontrada")

    await db.daily_rate_requests.delete_one({"id": request_id})
    return {"message": "Solicitação de diária excluída com sucesso"}


@api_router.put("/daily-rate-requests/{request_id}/update-status")
async def update_daily_rate_request_status(request_id: str, new_status: str, current_user: dict = Depends(get_current_admin_user)):
    """Atualiza status da solicitação de diária"""
    if new_status not in ["PENDENTE", "PAGO", "CANCELADO"]:
        raise HTTPException(status_code=400, detail="Status inválido")

    daily_request = await db.daily_rate_requests.find_one({"id": request_id}, {"_id": 0, "status": 1, "paid_at": 1})
    if not daily_request:
        raise HTTPException(status_code=404, detail="Solicitação de diária não encontrada")

    now = datetime.now(timezone.utc).isoformat()
    update = {"status": new_status, "updated_at": now}
    # Quando foi paga (Resumo Financeiro); repetir "Pago" não muda a data
    if new_status != "PAGO":
        update["paid_at"] = None
    elif daily_request.get("status") != "PAGO" or not daily_request.get("paid_at"):
        update["paid_at"] = now
    await db.daily_rate_requests.update_one({"id": request_id}, {"$set": update})

    return {"message": "Status atualizado"}


@api_router.get("/daily-rate-requests/{request_id}/pdf")
async def generate_daily_rate_request_pdf(request_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Gera PDF da solicitação de diária no padrão visual dos documentos do
    sistema: cabeçalho, quadro de dados, tabela de itens com total, código de
    barras de controle e rodapé com páginas."""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    from reports import (
        _build_pdf_header, _make_pdf_footer, format_currency, _fmt_int,
        _pdf_info_grid, _pdf_section_title, _pdf_header_cells, _pdf_cell_factory,
        _pdf_table_style, _pdf_note_box, _pdf_barcode_block, _pdf_empty_state,
    )

    daily_request = await db.daily_rate_requests.find_one({"id": request_id}, {"_id": 0})
    if not daily_request:
        raise HTTPException(status_code=404, detail="Solicitação de diária não encontrada")

    company = merge_company(await get_company_settings())
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=12*mm,
        leftMargin=12*mm,
        topMargin=10*mm,
        bottomMargin=14*mm
    )
    CONTENT_WIDTH = doc.width

    elements = []
    styles = getSampleStyleSheet()

    elements.extend(_build_pdf_header(
        styles, load_logo_buffer(company), f"Solicitação de Diária Nº {daily_request['request_number']}",
        company=company, content_width=CONTENT_WIDTH,
    ))

    from zoneinfo import ZoneInfo
    created_at = parse_datetime_value(daily_request['created_at'])
    created_at_brasilia = created_at.astimezone(ZoneInfo('America/Sao_Paulo'))

    full_creator_name = daily_request.get('created_by_name', 'Sistema')
    if full_creator_name:
        name_parts = full_creator_name.strip().split()
        preposicoes = ['DE', 'DA', 'DO', 'DOS', 'DAS', 'E']
        nomes_filtrados = [p for p in name_parts if p.upper() not in preposicoes]
        if len(nomes_filtrados) >= 2:
            creator_short_name = f"{nomes_filtrados[0]} {nomes_filtrados[1]}"
        elif len(nomes_filtrados) == 1:
            creator_short_name = nomes_filtrados[0]
        else:
            creator_short_name = ' '.join(name_parts[:2]) if len(name_parts) >= 2 else name_parts[0] if name_parts else 'Sistema'
    else:
        creator_short_name = 'Sistema'

    items = daily_request.get('items') or []
    elements.append(_pdf_info_grid([
        ("Data de criação", created_at_brasilia.strftime('%d/%m/%Y %H:%M')),
        ("Criado por", creator_short_name),
        ("Itens", _fmt_int(len(items))),
        ("Total geral", format_currency(daily_request.get('total_value', 0), 'BRL')),
    ], CONTENT_WIDTH, cols=4))

    # ========== ITENS ==========
    elements.extend(_pdf_section_title("Itens da solicitação", CONTENT_WIDTH))
    cell = _pdf_cell_factory(styles, font_size=7.5)
    table_data = [_pdf_header_cells(["#", "Motorista", "Placa", "Cliente", "Data Saída", "Outros", "Comissão", "Almoço", "Qtd. Diária", "Diária", "Total"], font_size=7.5)]

    for idx, item in enumerate(items, 1):
        departure_date = item.get('departure_date', '')
        if departure_date:
            try:
                dt = datetime.fromisoformat(departure_date.replace('Z', '+00:00'))
                departure_date = dt.strftime('%d/%m/%Y')
            except Exception:
                pass
        table_data.append([
            cell(idx, 'center'),
            cell(item.get('driver_name', '-'), bold=True),
            cell(item.get('vehicle_plate', '-'), 'center'),
            cell(item.get('client_name', '-')),
            cell(departure_date or '-', 'center'),
            cell(format_currency(item.get('others_value', 0), 'BRL'), 'right'),
            cell(format_currency(item.get('commission_value', 0), 'BRL'), 'right'),
            cell(format_currency(item.get('lunch_value', 0), 'BRL'), 'right'),
            cell(f"{item.get('daily_rate_quantity', 0):.0f}", 'center'),
            cell(format_currency(item.get('daily_rate_value', 0), 'BRL'), 'right'),
            cell(format_currency(item.get('total', 0), 'BRL'), 'right', bold=True),
        ])
    table_data.append([''] * 9 + [cell('TOTAL GERAL', 'right', bold=True), cell(format_currency(daily_request.get('total_value', 0), 'BRL'), 'right', bold=True)])

    base_widths = [20, 105, 60, 90, 60, 60, 60, 55, 60, 60, 70]
    scale = CONTENT_WIDTH / sum(base_widths)
    if items:
        main_table = Table(table_data, colWidths=[w * scale for w in base_widths], repeatRows=1)
        main_table.setStyle(TableStyle(_pdf_table_style(total_row=True) + [
            ('TOPPADDING', (0, 1), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 1), (-1, -1), 5),
        ]))
        elements.append(main_table)
    else:
        elements.append(_pdf_empty_state("Nenhum item nesta solicitação.", CONTENT_WIDTH))

    if daily_request.get('observations'):
        elements.append(Spacer(1, 10))
        elements.append(_pdf_note_box("Observações", daily_request['observations'], CONTENT_WIDTH))

    # Código de barras de controle (mesmo valor do layout anterior: DIAR + nº)
    elements.append(Spacer(1, 16))
    elements.append(_pdf_barcode_block(
        f"DIAR{daily_request['request_number']:06d}", creator_short_name, CONTENT_WIDTH, barcode_width=150,
    ))

    footer = _make_pdf_footer(company['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    buffer.seek(0)

    filename = f"solicitacao_diaria_{daily_request['request_number']}.pdf"
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={filename}"})


