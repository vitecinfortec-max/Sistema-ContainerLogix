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
    PhotoRegistry, PhotoRegistryCreate, PhotoRegistryUpdate, PhotoRegistryResponse,
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
        "items": items,
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
    return segregation


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
    
    result = segregation.model_dump()
    return result


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
        processed_items = []
        for item in update_data["items"]:
            item_dict = item if isinstance(item, dict) else item.model_dump() if hasattr(item, 'model_dump') else dict(item)
            shipowner = await db.shipping_lines.find_one({"id": item_dict.get("shipping_line")}, {"_id": 0, "name": 1})
            shipping_line_name = shipowner["name"] if shipowner else item_dict.get("shipping_line")
            processed_items.append({
                "container_number": item_dict.get("container_number", "").upper(),
                "tare": item_dict.get("tare"),
                "shipping_line": item_dict.get("shipping_line"),
                "shipping_line_name": shipping_line_name
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
    return updated


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
    return updated


@api_router.get("/unit-segregations/{segregation_id}/pdf")
async def get_unit_segregation_pdf(segregation_id: str, current_user: dict = Depends(get_current_active_user)):
    """Gera PDF da segregação de unidade - Formato Horizontal (Landscape)"""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    from reportlab.graphics.barcode import code128
    
    segregation = await db.unit_segregations.find_one({"id": segregation_id}, {"_id": 0})
    if not segregation:
        raise HTTPException(status_code=404, detail="Segregação não encontrada")

    company = merge_company(await get_company_settings())
    buffer = io.BytesIO()
    # Usar landscape para orientação horizontal
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), leftMargin=40, rightMargin=40, topMargin=30, bottomMargin=30)
    elements = []
    styles = getSampleStyleSheet()
    
    # Largura total disponível em landscape (A4 landscape = 842 x 595 pontos)
    PAGE_WIDTH = landscape(A4)[0] - 80  # 842 - 80 = 762
    SECTION_WIDTH = PAGE_WIDTH
    
    # Cores
    PRIMARY_GREEN = colors.HexColor('#047857')
    HEADER_BG = colors.HexColor('#F3F4F6')
    BORDER_COLOR = colors.HexColor('#E5E7EB')
    BLACK = colors.HexColor('#1F2937')
    
    # ========== CABEÇALHO ==========
    # Logo
    # ========== DOWNLOAD LOGO ==========
    import requests
    logo_buffer = load_logo_buffer(company)

    # Logo
    logo_cell = ""
    if logo_buffer:
        try:
            logo_cell = Image(logo_buffer, width=50, height=50)
        except:
            logo_cell = Paragraph("", styles['Normal'])
    else:
        logo_cell = Paragraph("", styles['Normal'])

    # Informações centrais
    company_style = ParagraphStyle('Company', parent=styles['Normal'], fontSize=12, fontName='Helvetica-Bold', textColor=PRIMARY_GREEN, alignment=TA_CENTER)
    subtitle_style = ParagraphStyle('Subtitle', parent=styles['Normal'], fontSize=9, fontName='Helvetica', textColor=BLACK, alignment=TA_CENTER)

    center_content = [
        [Paragraph(company['name'], company_style)],
        [Paragraph(company['address'].replace('\n', ' - '), subtitle_style)]
    ]
    center_table = Table(center_content, colWidths=[450])
    center_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    
    # Informações direita (código de barras)
    info_right_style = ParagraphStyle('InfoRight', parent=styles['Normal'], fontSize=8, textColor=BLACK, alignment=TA_CENTER)
    
    barcode_value = f"SEG{segregation['segregation_number']:06d}"
    barcode = code128.Code128(barcode_value, barWidth=1.2, barHeight=30)
    
    from zoneinfo import ZoneInfo
    created_at = parse_datetime_value(segregation['created_at'])
    brasilia_tz = ZoneInfo('America/Sao_Paulo')
    created_at_brasilia = created_at.astimezone(brasilia_tz)
    date_str = created_at_brasilia.strftime('%d/%m/%Y')
    
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
    
    barcode_info = Paragraph(f"<b>Nº {segregation['segregation_number']}</b>", ParagraphStyle('BarcodeNum', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold', alignment=TA_CENTER))
    date_info = Paragraph(f"Data: {date_str}", info_right_style)
    user_info = Paragraph(f"Criado por: {creator_short_name}", info_right_style)
    
    right_content = [[barcode], [barcode_info], [date_info], [user_info]]
    right_table = Table(right_content, colWidths=[150])
    right_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]))
    
    # Montar header completo
    header_data = [[logo_cell, center_table, right_table]]
    header_table = Table(header_data, colWidths=[55, SECTION_WIDTH - 215, 160])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (0, 0), (0, 0), 'LEFT'),
        ('ALIGN', (1, 0), (1, 0), 'CENTER'),
        ('ALIGN', (2, 0), (2, 0), 'RIGHT'),
    ]))
    elements.append(header_table)
    
    # Linha separadora verde
    elements.append(Spacer(1, 5))
    line_data = [[""]]
    line_table = Table(line_data, colWidths=[SECTION_WIDTH])
    line_table.setStyle(TableStyle([
        ('LINEBELOW', (0, 0), (-1, -1), 2, PRIMARY_GREEN),
    ]))
    elements.append(line_table)
    elements.append(Spacer(1, 10))
    
    # ========== TÍTULO ==========
    title_style = ParagraphStyle('Title', parent=styles['Normal'], fontSize=12, fontName='Helvetica-Bold', alignment=TA_CENTER, textColor=PRIMARY_GREEN)
    
    title_content = [[Paragraph("SEGREGAÇÃO DE UNIDADE", title_style)]]
    title_table = Table(title_content, colWidths=[SECTION_WIDTH])
    title_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 2, BORDER_COLOR),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    elements.append(title_table)
    elements.append(Spacer(1, 10))
    
    # ========== INFORMAÇÕES DA SEGREGAÇÃO ==========
    label_style = ParagraphStyle('Label', parent=styles['Normal'], fontSize=8, fontName='Helvetica', textColor=BLACK)
    value_style = ParagraphStyle('Value', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold', textColor=BLACK)
    section_title = ParagraphStyle('SectionTitle', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold', textColor=BLACK)
    
    
    # Header da seção
    info_header = [[Paragraph("Informações da Segregação", section_title)]]
    info_header_table = Table(info_header, colWidths=[SECTION_WIDTH])
    info_header_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), HEADER_BG),
        ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
    ]))
    elements.append(info_header_table)
    
    # Linha 1: Cliente Reservado e Status
    status_value = segregation.get('status', 'ATIVO')
    items_count = len(segregation.get('items', []))
    info_row1 = [
        [Paragraph("Cliente Reservado", label_style), Paragraph(segregation['client_name'], value_style)],
        [Paragraph("Status", label_style), Paragraph(status_value, value_style)]
    ]
    # Linha 2: Quantidade de containers
    info_row2 = [
        [Paragraph("Qtd. de Containers", label_style), Paragraph(str(items_count), value_style)],
        [Paragraph("", label_style), Paragraph("", value_style)]
    ]
    
    info_content = [info_row1, info_row2]
    info_table = Table(info_content, colWidths=[SECTION_WIDTH/2, SECTION_WIDTH/2])
    info_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
        ('LINEAFTER', (0, 0), (0, -1), 0.5, colors.HexColor('#CCCCCC')),
        ('LINEBELOW', (0, 0), (-1, 0), 0.5, colors.HexColor('#CCCCCC')),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 10))
    
    # ========== TABELA DE CONTAINERS ==========
    items_header = [[Paragraph("Unidades Segregadas", section_title)]]
    items_header_table = Table(items_header, colWidths=[SECTION_WIDTH])
    items_header_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), HEADER_BG),
        ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
    ]))
    elements.append(items_header_table)
    
    # Cabeçalho da tabela
    table_data = [["#", "CONTAINER", "TARA", "ARMADOR"]]
    
    for idx, item in enumerate(segregation.get('items', []), 1):
        table_data.append([
            str(idx),
            item.get('container_number', '-'),
            item.get('tare', '-') or '-',
            item.get('shipping_line_name', '') or item.get('shipping_line', '-')
        ])
    
    # Se não houver itens, mostrar mensagem
    if len(table_data) == 1:
        table_data.append(['', 'Nenhum container cadastrado', '', ''])
    
    col_widths = [40, 250, 120, SECTION_WIDTH - 410]  # Ajustado para landscape
    data_table = Table(table_data, colWidths=col_widths)
    data_table.setStyle(TableStyle([
        # Header
        ('BACKGROUND', (0, 0), (-1, 0), PRIMARY_GREEN),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        # Body
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 9),
        ('ALIGN', (0, 1), (0, -1), 'CENTER'),
        # Borders
        ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CCCCCC')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        # Alternating row colors
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F9F9F9')]),
    ]))
    elements.append(data_table)
    elements.append(Spacer(1, 10))
    
    # ========== Observações ==========
    if segregation.get('observations'):
        obs_header = [[Paragraph("Observações", section_title)]]
        obs_header_table = Table(obs_header, colWidths=[SECTION_WIDTH])
        obs_header_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), HEADER_BG),
            ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ]))
        elements.append(obs_header_table)
        
        obs_content_style = ParagraphStyle('ObsContent', parent=styles['Normal'], fontSize=9, fontName='Helvetica', textColor=BLACK)
        obs_content = [[Paragraph(segregation['observations'], obs_content_style)]]
        obs_table = Table(obs_content, colWidths=[SECTION_WIDTH])
        obs_table.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ]))
        elements.append(obs_table)
        elements.append(Spacer(1, 12))
    
    # ========== Rodapé ==========
    footer_style = ParagraphStyle('Footer', parent=styles['Normal'], fontSize=8, textColor=colors.grey, alignment=TA_CENTER)
    elements.append(Spacer(1, 15))
    elements.append(Paragraph(f"Gerado em {now_brt().strftime('%d/%m/%Y %H:%M')} - ContainerLogix - {company['name']}", footer_style))

    doc.build(elements)
    buffer.seek(0)

    filename = f"segregacao_unidade_{segregation['segregation_number']}.pdf"
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


