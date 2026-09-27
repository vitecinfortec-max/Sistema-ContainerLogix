import os
from datetime import datetime, timezone, timedelta
from typing import Optional, List
import io
import re
import json
import shutil
import uuid
import logging
from pathlib import Path
from urllib.parse import quote as url_quote

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel as PydanticBaseModel

from models import (
    User, UserCreate, UserLogin, UserResponse, Token,
    CompanySettings, CompanySettingsUpdate,
    Driver, DriverCreate, DriverResponse,
    TransportCompany, TransportCompanyCreate, TransportCompanyResponse,
    Client, ClientCreate, ClientResponse,
    Supplier, SupplierCreate, SupplierResponse,
    ContainerMovement, ContainerMovementCreate, ContainerMovementResponse,
    DailyMovementPoint, DriverRankingEntry, DashboardStats,
    ShippingLine, ShippingLineCreate, ShippingLineResponse,
    ServiceType, ServiceTypeCreate, ServiceTypeResponse,
    Invoice, InvoiceCreate, InvoiceUpdate, InvoiceResponse, InvoiceMovementDetail,
    InvoiceHistory, InvoiceHistoryResponse,
    ContainerInspectionPhoto, ContainerInspection, ContainerInspectionCreate,
    ContainerInspectionUpdate, ContainerInspectionResponse,
    CONTAINER_INSPECTION_PHOTO_TYPES, MAX_CONTAINER_INSPECTION_PHOTOS,
    FlexTankMovement, FlexTankMovementCreate, FlexTankMovementUpdate,
    FlexTankMovementResponse, FlexTankStockSummary,
    Vehicle, VehicleCreate, VehicleUpdate, VehicleResponse,
    VehicleChecklistItem, VehicleChecklistProduct, VehicleChecklistFields,
    VehicleChecklist, VehicleChecklistCreate, VehicleChecklistResponse,
    VEHICLE_CHECKLIST_TEMPLATE, VEHICLE_CHECKLIST_SECTION_LABELS,
    VehicleRevision, VehicleRevisionCreate, VehicleRevisionResponse,
    LoadingScheduleItem, LoadingSchedule, LoadingScheduleCreate, LoadingScheduleResponse,
    DailyRateRequestItem, DailyRateRequest, DailyRateRequestCreate, DailyRateRequestResponse,
    IntlInvoiceItem, IntlInvoice, IntlInvoiceCreate, IntlInvoiceResponse,
    DeliveryStatusItem, DeliveryStatus, DeliveryStatusCreate, DeliveryStatusResponse,
    UnitSegregationItem, UnitSegregation, UnitSegregationCreate, UnitSegregationUpdate,
    UnitSegregationResponse,
    RPAServiceItem, RPATerceiro, RPATerceiroCreate, RPATerceiroUpdate, RPATerceiroResponse,
    OSItem, OrdemServico, OrdemServicoCreate, OrdemServicoUpdate, OrdemServicoResponse,
    ExpenseReportReceipt, ExpenseReportDeposit, ExpenseReportPurchase,
    ExpenseReport, ExpenseReportCreate, ExpenseReportResponse,
)
from auth import get_password_hash, verify_password, create_access_token, get_current_user, decode_token
from reports import (
    generate_pdf_report, generate_excel_report, generate_billing_pdf_report, generate_billing_excel,
    now_brt, to_brt, merge_company, DEFAULT_COMPANY
)

from shared import (
    db, manager, get_current_active_user, get_current_admin_user, get_company_settings,
    get_next_transaction_id, parse_datetime_value, round_money, migrate_inspection_photos,
    load_logo_buffer, validate_and_read_upload, ALLOWED_EXTENSIONS, ALLOWED_RECEIPT_EXTENSIONS,
    MAX_FILE_SIZE, check_rate_limit, client_ip, UPLOADS_DIR, ROOT_DIR
)

api_router = APIRouter(prefix="/api")

# ==================== SEGREGAÇÃO DE UNIDADE ENDPOINTS ====================

from models import UnitSegregation, UnitSegregationCreate, UnitSegregationUpdate, UnitSegregationResponse, UnitSegregationItem
from routers.movements import _normalize_client_name


def _unit_segregation_serialize(doc: dict) -> dict:
    """Acrescenta `retrieval_status` (PENDENTE/CONCLUIDO), computado a partir
    de items[].retrieved - nunca persistido, pra nunca ficar dessincronizado
    do que a baixa automática (movements.py) realmente marcou."""
    out = {**doc}
    items = out.get('items') or []
    out['retrieval_status'] = 'CONCLUIDO' if items and all(i.get('retrieved') for i in items) else 'PENDENTE'
    return out


@api_router.get("/unit-segregations")
async def get_unit_segregations(
    page: int = 1,
    per_page: int = 20,
    status: Optional[str] = None,
    client_id: Optional[str] = None,
    container_number: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    """Lista todas as segregações de unidade com filtros"""
    query = {}

    if status:
        query["status"] = status
    if client_id:
        query["client_id"] = client_id
    if container_number:
        # Buscar nos itens
        query["items.container_number"] = {"$regex": re.escape(container_number), "$options": "i"}

    total = await db.unit_segregations.count_documents(query)
    skip = (page - 1) * per_page

    cursor = db.unit_segregations.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page)
    items = await cursor.to_list(length=per_page)

    return {
        "items": [_unit_segregation_serialize(i) for i in items],
        "total": total,
        "page": page,
        "pages": (total + per_page - 1) // per_page
    }


@api_router.get("/unit-segregations/{segregation_id}")
async def get_unit_segregation(segregation_id: str, current_user: dict = Depends(get_current_active_user)):
    """Busca uma segregação específica"""
    segregation = await db.unit_segregations.find_one({"id": segregation_id}, {"_id": 0})
    if not segregation:
        raise HTTPException(status_code=404, detail="Segregação não encontrada")
    return _unit_segregation_serialize(segregation)


@api_router.post("/unit-segregations", response_model=UnitSegregationResponse)
async def create_unit_segregation(data: UnitSegregationCreate, current_user: dict = Depends(get_current_active_user)):
    """Cria uma nova segregação de unidade com múltiplos containers"""
    
    if not data.items or len(data.items) == 0:
        raise HTTPException(status_code=400, detail="Pelo menos um container deve ser informado")
    
    # Verificar se algum container já está segregado (ativo)
    for item in data.items:
        existing = await db.unit_segregations.find_one({
            "items.container_number": item.container_number.upper(),
            "status": "ATIVO"
        })
        if existing:
            raise HTTPException(status_code=400, detail=f"Container {item.container_number} já está segregado para o cliente {existing['client_name']}")
    
    # Buscar nome do cliente
    client = await db.clients.find_one({"id": data.client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=400, detail="Cliente não encontrado")
    
    # Processar itens - buscar nomes dos armadores
    processed_items = []
    for item in data.items:
        shipowner = await db.shipping_lines.find_one({"id": item.shipping_line}, {"_id": 0, "name": 1})
        shipping_line_name = shipowner["name"] if shipowner else item.shipping_line
        processed_items.append({
            "container_number": item.container_number.upper(),
            "tare": item.tare,
            "shipping_line": item.shipping_line,
            "shipping_line_name": shipping_line_name
        })
    
    # Gerar número sequencial de forma atômica (evita duplicidade com criação concorrente)
    counter = await db.counters.find_one_and_update(
        {"_id": "segregation_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    next_number = counter["seq"]
    
    segregation = UnitSegregation(
        segregation_number=next_number,
        client_id=data.client_id,
        client_name=client["name"],
        items=processed_items,
        observations=data.observations,
        created_by=current_user["sub"],
        created_by_name=current_user["name"]
    )
    
    await db.unit_segregations.insert_one(segregation.model_dump())

    return _unit_segregation_serialize(segregation.model_dump())


@api_router.put("/unit-segregations/{segregation_id}")
async def update_unit_segregation(segregation_id: str, data: UnitSegregationUpdate, current_user: dict = Depends(get_current_active_user)):
    """Atualiza uma segregação de unidade"""
    segregation = await db.unit_segregations.find_one({"id": segregation_id})
    if not segregation:
        raise HTTPException(status_code=404, detail="Segregação não encontrada")
    
    update_data = data.model_dump(exclude_unset=True)
    
    # Se mudou o cliente, buscar o nome
    if "client_id" in update_data:
        client = await db.clients.find_one({"id": update_data["client_id"]}, {"_id": 0, "name": 1})
        if not client:
            raise HTTPException(status_code=400, detail="Cliente não encontrado")
        update_data["client_name"] = client["name"]
    
    # Se atualizou os itens, buscar nomes dos armadores
    if "items" in update_data and update_data["items"]:
        # Baixa (retirada) já registrada num container existente não pode se
        # perder só porque a segregação foi editada (ex: adicionar mais um
        # container à mesma reserva) - preserva por número de container.
        existing_by_number = {
            (i.get('container_number') or '').upper(): i
            for i in (segregation.get('items') or [])
        }
        processed_items = []
        for item in update_data["items"]:
            item_dict = item if isinstance(item, dict) else item.model_dump() if hasattr(item, 'model_dump') else dict(item)
            shipowner = await db.shipping_lines.find_one({"id": item_dict.get("shipping_line")}, {"_id": 0, "name": 1})
            shipping_line_name = shipowner["name"] if shipowner else item_dict.get("shipping_line")
            container_number = item_dict.get("container_number", "").upper()
            previous = existing_by_number.get(container_number, {})
            processed_items.append({
                "container_number": container_number,
                "tare": item_dict.get("tare"),
                "shipping_line": item_dict.get("shipping_line"),
                "shipping_line_name": shipping_line_name,
                "retrieved": previous.get("retrieved", False),
                "retrieved_at": previous.get("retrieved_at"),
                "retrieved_transaction_id": previous.get("retrieved_transaction_id"),
            })
        update_data["items"] = processed_items
    
    # Se está liberando a segregação
    if update_data.get("status") == "LIBERADO":
        update_data["released_at"] = datetime.now(timezone.utc)
        update_data["released_by"] = current_user["sub"]
        update_data["released_by_name"] = current_user["name"]
    
    await db.unit_segregations.update_one(
        {"id": segregation_id},
        {"$set": update_data}
    )

    updated = await db.unit_segregations.find_one({"id": segregation_id}, {"_id": 0})
    return _unit_segregation_serialize(updated)


@api_router.delete("/unit-segregations/{segregation_id}")
async def delete_unit_segregation(segregation_id: str, current_user: dict = Depends(get_current_active_user)):
    """Exclui uma segregação de unidade"""
    result = await db.unit_segregations.delete_one({"id": segregation_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Segregação não encontrada")
    return {"message": "Segregação excluída com sucesso"}


@api_router.post("/unit-segregations/{segregation_id}/release")
async def release_unit_segregation(segregation_id: str, current_user: dict = Depends(get_current_active_user)):
    """Libera uma segregação de unidade"""
    segregation = await db.unit_segregations.find_one({"id": segregation_id})
    if not segregation:
        raise HTTPException(status_code=404, detail="Segregação não encontrada")
    
    if segregation["status"] != "ATIVO":
        raise HTTPException(status_code=400, detail="Segregação já foi liberada ou cancelada")
    
    await db.unit_segregations.update_one(
        {"id": segregation_id},
        {"$set": {
            "status": "LIBERADO",
            "released_at": datetime.now(timezone.utc),
            "released_by": current_user["sub"],
            "released_by_name": current_user["name"]
        }}
    )

    updated = await db.unit_segregations.find_one({"id": segregation_id}, {"_id": 0})
    return _unit_segregation_serialize(updated)


@api_router.get("/unit-segregations/{segregation_id}/pdf")
async def get_unit_segregation_pdf(segregation_id: str, current_user: dict = Depends(get_current_active_user)):
    """Gera PDF da segregação de unidade (paisagem) no padrão visual dos
    documentos do sistema: cabeçalho, quadro de dados, tabela de unidades,
    observações, código de barras de controle e rodapé com páginas."""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reports import (
        _build_pdf_header, _make_pdf_footer, _fmt_int, _pdf_info_grid, _pdf_section_title,
        _pdf_header_cells, _pdf_cell_factory, _pdf_table_style, _pdf_note_box, _pdf_barcode_block,
        _pdf_empty_state, _pdf_tone_markup,
    )

    segregation = await db.unit_segregations.find_one({"id": segregation_id}, {"_id": 0})
    if not segregation:
        raise HTTPException(status_code=404, detail="Segregação não encontrada")

    company = merge_company(await get_company_settings())
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), leftMargin=34, rightMargin=34, topMargin=30, bottomMargin=40)
    elements = []
    styles = getSampleStyleSheet()
    SECTION_WIDTH = doc.width

    elements.extend(_build_pdf_header(
        styles, load_logo_buffer(company), f"Segregação de Unidade Nº {segregation['segregation_number']}",
        company=company, content_width=SECTION_WIDTH,
    ))

    from zoneinfo import ZoneInfo
    created_at = parse_datetime_value(segregation['created_at'])
    date_str = created_at.astimezone(ZoneInfo('America/Sao_Paulo')).strftime('%d/%m/%Y')

    # Abreviar nome do criador
    full_creator_name = segregation.get('created_by_name', 'Sistema')
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

    # ========== INFORMAÇÕES DA SEGREGAÇÃO ==========
    status_value = segregation.get('status', 'ATIVO')
    items = segregation.get('items', []) or []
    status_par = Paragraph(
        _pdf_tone_markup(status_value, 'emerald' if status_value == 'ATIVO' else 'slate'),
        ParagraphStyle('SegStatus', fontName='Helvetica-Bold', fontSize=8.5, leading=10.5),
    )
    elements.append(_pdf_info_grid([
        ("Cliente reservado", segregation['client_name'], 2),
        ("Status", status_par),
        ("Qtd. de containers", _fmt_int(len(items))),
        ("Data", date_str),
        ("Criado por", creator_short_name),
    ], SECTION_WIDTH, cols=6))

    # ========== UNIDADES SEGREGADAS ==========
    elements.extend(_pdf_section_title("Unidades segregadas", SECTION_WIDTH))
    if items:
        cell = _pdf_cell_factory(styles, font_size=9)
        table_data = [_pdf_header_cells(["#", "Container", "Tara", "Armador"], font_size=8.5)]
        for idx, item in enumerate(items, 1):
            table_data.append([
                cell(idx, 'center'),
                cell(item.get('container_number', '-'), bold=True),
                cell(item.get('tare', '-') or '-', 'center'),
                cell(item.get('shipping_line_name', '') or item.get('shipping_line', '-')),
            ])
        data_table = Table(table_data, colWidths=[40, 250, 120, SECTION_WIDTH - 410], repeatRows=1)
        data_table.setStyle(TableStyle(_pdf_table_style() + [
            ('TOPPADDING', (0, 1), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 1), (-1, -1), 5),
        ]))
        elements.append(data_table)
    else:
        elements.append(_pdf_empty_state("Nenhum container cadastrado.", SECTION_WIDTH))

    # ========== Observações ==========
    if segregation.get('observations'):
        elements.append(Spacer(1, 10))
        elements.append(_pdf_note_box("Observações", segregation['observations'], SECTION_WIDTH))

    # Código de barras de controle (mesmo valor do layout anterior: SEG + nº)
    elements.append(Spacer(1, 16))
    elements.append(_pdf_barcode_block(
        f"SEG{segregation['segregation_number']:06d}", creator_short_name, SECTION_WIDTH, barcode_width=150,
    ))

    footer = _make_pdf_footer(company['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    buffer.seek(0)

    filename = f"segregacao_unidade_{segregation['segregation_number']}.pdf"
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={filename}"})


@api_router.get("/unit-segregations/{segregation_id}/label")
async def get_unit_segregation_label(segregation_id: str, current_user: dict = Depends(get_current_active_user)):
    """Gera a etiqueta de identificação da Segregação de Unidade - grade de
    até 8 etiquetas por página (4 colunas x 2 linhas, A4 paisagem), pra
    imprimir, recortar e colar/afixar em cada unidade sinalizando que está
    reservada pro cliente. Mais de 8 containers viram páginas seguintes, cada
    uma com sua própria grade de até 8."""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER
    from reportlab.graphics.barcode import code128

    segregation = await db.unit_segregations.find_one({"id": segregation_id}, {"_id": 0})
    if not segregation:
        raise HTTPException(status_code=404, detail="Segregação não encontrada")

    items = segregation.get('items') or []
    if not items:
        raise HTTPException(status_code=400, detail="Essa segregação não tem containers para gerar etiqueta")

    company = merge_company(await get_company_settings())

    COLS, ROWS = 4, 2
    PER_PAGE = COLS * ROWS

    PRIMARY_GREEN = colors.HexColor('#047857')
    BLACK = colors.HexColor('#1F2937')
    BORDER_GRAY = colors.HexColor('#D1D5DB')

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=landscape(A4),
        leftMargin=8 * mm, rightMargin=8 * mm, topMargin=8 * mm, bottomMargin=8 * mm
    )
    styles = getSampleStyleSheet()

    CELL_WIDTH = doc.width / COLS
    CELL_TEXT_WIDTH = CELL_WIDTH - 6 * mm  # descontando o padding esquerdo/direito da célula

    company_style = ParagraphStyle('LblCompany', parent=styles['Normal'], fontSize=7, leading=9, fontName='Helvetica-Bold', textColor=PRIMARY_GREEN, alignment=TA_CENTER)
    title_style = ParagraphStyle('LblTitle', parent=styles['Normal'], fontSize=8, leading=10, fontName='Helvetica-Bold', textColor=colors.white, alignment=TA_CENTER)
    container_style = ParagraphStyle('LblContainer', parent=styles['Normal'], fontSize=18, leading=21, fontName='Helvetica-Bold', textColor=BLACK, alignment=TA_CENTER)
    client_label_style = ParagraphStyle('LblClientLabel', parent=styles['Normal'], fontSize=6, leading=8, fontName='Helvetica', textColor=colors.grey, alignment=TA_CENTER)
    client_style = ParagraphStyle('LblClient', parent=styles['Normal'], fontSize=9, leading=11, fontName='Helvetica-Bold', textColor=PRIMARY_GREEN, alignment=TA_CENTER)
    detail_style = ParagraphStyle('LblDetail', parent=styles['Normal'], fontSize=6.5, leading=8.5, fontName='Helvetica', textColor=BLACK, alignment=TA_CENTER)
    footer_style = ParagraphStyle('LblFooter', parent=styles['Normal'], fontSize=8, textColor=colors.grey, alignment=TA_CENTER)

    def build_label_cell(item):
        cell = [
            Paragraph(company['name'], company_style),
            Spacer(1, 2),
        ]
        title_tbl = Table([[Paragraph('UNIDADE SEGREGADA', title_style)]], colWidths=[CELL_TEXT_WIDTH])
        title_tbl.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), PRIMARY_GREEN),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ]))
        cell.append(title_tbl)
        cell.append(Spacer(1, 5))
        cell.append(Paragraph(item.get('container_number', '-'), container_style))
        cell.append(Spacer(1, 5))
        cell.append(Paragraph('RESERVADO PARA', client_label_style))
        cell.append(Paragraph(segregation['client_name'], client_style))
        cell.append(Spacer(1, 3))

        detail_parts = [f"Segregação Nº {segregation['segregation_number']}"]
        if item.get('shipping_line_name') or item.get('shipping_line'):
            detail_parts.append(item.get('shipping_line_name') or item.get('shipping_line'))
        if item.get('tare'):
            detail_parts.append(f"Tara: {item['tare']}")
        cell.append(Paragraph(' | '.join(detail_parts), detail_style))
        cell.append(Spacer(1, 5))

        try:
            barcode = code128.Code128(item.get('container_number', ''), barWidth=0.5, barHeight=13)
            bc_tbl = Table([[barcode]], colWidths=[CELL_TEXT_WIDTH])
            bc_tbl.setStyle(TableStyle([('ALIGN', (0, 0), (-1, -1), 'CENTER')]))
            cell.append(bc_tbl)
        except Exception:
            pass
        return cell

    elements = []
    for page_start in range(0, len(items), PER_PAGE):
        if page_start > 0:
            elements.append(PageBreak())

        page_items = items[page_start:page_start + PER_PAGE]
        grid_rows = []
        for r in range(ROWS):
            row = []
            for c in range(COLS):
                idx = r * COLS + c
                row.append(build_label_cell(page_items[idx]) if idx < len(page_items) else '')
            grid_rows.append(row)

        grid = Table(grid_rows, colWidths=[CELL_WIDTH] * COLS)
        grid.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 0.75, BORDER_GRAY),
            ('INNERGRID', (0, 0), (-1, -1), 0.75, BORDER_GRAY),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('LEFTPADDING', (0, 0), (-1, -1), 3 * mm),
            ('RIGHTPADDING', (0, 0), (-1, -1), 3 * mm),
        ]))
        elements.append(grid)
        elements.append(Spacer(1, 6))
        elements.append(Paragraph(
            f"Segregação Nº {segregation['segregation_number']} - Gerado em {now_brt().strftime('%d/%m/%Y %H:%M')} - {company['name']}",
            footer_style
        ))

    doc.build(elements)
    buffer.seek(0)

    filename = f"etiqueta_segregacao_{segregation['segregation_number']}.pdf"
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={filename}"})


@api_router.get("/check-segregation/{container_number}")
async def check_container_segregation(container_number: str, current_user: dict = Depends(get_current_active_user)):
    """Verifica se um container está segregado"""
    segregation = await db.unit_segregations.find_one({
        "items.container_number": container_number.upper(),
        "status": "ATIVO"
    }, {"_id": 0})
    
    if segregation:
        return {
            "is_segregated": True,
            "segregation": segregation
        }
    return {"is_segregated": False}


class CheckSegregationBatchRequest(PydanticBaseModel):
    container_numbers: List[str]


@api_router.post("/check-segregation-batch")
async def check_container_segregation_batch(
    data: CheckSegregationBatchRequest,
    current_user: dict = Depends(get_current_active_user)
):
    """Verifica segregação para vários containers em uma única chamada - o Controle
    de Pátio chamava /check-segregation uma vez por container (uma requisição HTTP
    para cada um dos 100-300 containers ativos a cada carregamento de página)."""
    numbers = list({c.upper() for c in data.container_numbers if c})
    if not numbers:
        return {}

    active_segregations = await db.unit_segregations.find(
        {"items.container_number": {"$in": numbers}, "status": "ATIVO"},
        {"_id": 0}
    ).to_list(None)

    result = {number: {"is_segregated": False, "segregation_client": None} for number in numbers}
    for segregation in active_segregations:
        for item in segregation.get("items", []):
            container_number = (item.get("container_number") or "").upper()
            if container_number in result:
                result[container_number] = {
                    "is_segregated": True,
                    "segregation_client": segregation.get("client_name")
                }
    return result


@api_router.post("/unit-segregations/resync-retrievals")
async def resync_unit_segregation_retrievals(current_user: dict = Depends(get_current_admin_user)):
    """Reprocessamento único (idempotente, pode rodar quantas vezes quiser):
    varre toda Segregação ATIVA com item ainda Pendente e procura, no
    histórico de movimentações, uma EIR de Saída desse container cujo
    Cliente OU Comprador já bata com o cliente reservado - dá baixa
    retroativa se achar. Necessário porque a baixa só é registrada no
    momento em que a EIR é emitida (ver _mark_segregation_retrieved em
    routers/movements.py); uma EIR de Saída emitida ANTES desse campo
    reconhecer o Comprador nunca dispara a baixa sozinha até ser reemitida."""
    segregations = await db.unit_segregations.find(
        {"status": "ATIVO", "items.retrieved": False}, {"_id": 0}
    ).to_list(None)
    items_checked = 0
    items_updated = 0
    for segregation in segregations:
        reserved = _normalize_client_name(segregation.get("client_name"))
        for item in segregation.get("items", []):
            if item.get("retrieved"):
                continue
            items_checked += 1
            container_number = (item.get("container_number") or "").strip().upper()
            if not container_number:
                continue
            candidates = await db.movements.find(
                {"container_number": container_number, "operation_type": "SAIDA"},
                {"_id": 0, "transaction_id": 1, "client_name": 1, "buyer_name": 1, "created_at": 1},
            ).sort("created_at", -1).to_list(None)
            movement = next(
                (m for m in candidates if reserved in (
                    _normalize_client_name(m.get("client_name")), _normalize_client_name(m.get("buyer_name"))
                )),
                None
            )
            if not movement:
                continue
            result = await db.unit_segregations.update_one(
                {
                    "id": segregation["id"],
                    "items.container_number": item["container_number"],
                    "items.retrieved": False,
                },
                {"$set": {
                    "items.$.retrieved": True,
                    "items.$.retrieved_at": movement.get("created_at") or datetime.now(timezone.utc).isoformat(),
                    "items.$.retrieved_transaction_id": movement["transaction_id"],
                }}
            )
            if result.modified_count:
                items_updated += 1
    return {
        "segregations_checked": len(segregations),
        "items_checked": items_checked,
        "items_updated": items_updated,
    }
