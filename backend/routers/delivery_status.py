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

# ==================== STATUS DE ENTREGA ENDPOINTS ====================

from models import DeliveryStatus, DeliveryStatusCreate, DeliveryStatusResponse, DeliveryStatusItem

@api_router.get("/delivery-status")
async def get_delivery_statuses(
    page: int = 1,
    per_page: int = 20,
    status: Optional[str] = None,
    schedule_number: Optional[int] = None,
    current_user: dict = Depends(get_current_active_user)
):
    """Lista todos os status de entrega com paginação e filtros"""
    query = {}
    if status:
        query["status"] = status
    if schedule_number:
        query["schedule_number"] = schedule_number
    
    total = await db.delivery_statuses.count_documents(query)
    skip = (page - 1) * per_page
    
    statuses = await db.delivery_statuses.find(query, {"_id": 0}).sort("status_number", -1).skip(skip).limit(per_page).to_list(per_page)
    
    return {
        "items": statuses,
        "total": total,
        "page": page,
        "pages": (total + per_page - 1) // per_page
    }

@api_router.get("/delivery-status/schedule/{schedule_number}")
async def get_schedule_for_delivery_status(schedule_number: int, current_user: dict = Depends(get_current_active_user)):
    """Busca uma programação de carregamento pelo número para criar um status de entrega"""
    schedule = await db.loading_schedules.find_one({"schedule_number": schedule_number}, {"_id": 0})
    if not schedule:
        raise HTTPException(status_code=404, detail="Programação não encontrada")
    return schedule

@api_router.get("/delivery-status/{status_id}", response_model=DeliveryStatusResponse)
async def get_delivery_status(status_id: str, current_user: dict = Depends(get_current_active_user)):
    """Busca um status de entrega pelo ID"""
    status = await db.delivery_statuses.find_one({"id": status_id}, {"_id": 0})
    if not status:
        raise HTTPException(status_code=404, detail="Status de entrega não encontrado")
    return status

@api_router.post("/delivery-status", response_model=DeliveryStatusResponse)
async def create_delivery_status(data: DeliveryStatusCreate, current_user: dict = Depends(get_current_active_user)):
    """Cria um novo status de entrega baseado em uma programação"""
    # Buscar a programação de carregamento
    schedule = await db.loading_schedules.find_one({"schedule_number": data.schedule_number}, {"_id": 0})
    if not schedule:
        raise HTTPException(status_code=404, detail="Programação não encontrada")
    
    # Gerar próximo número sequencial de forma atômica (find_one+1 permitia duas
    # requisições concorrentes lerem o mesmo "último número" e gravarem duplicado)
    counter = await db.counters.find_one_and_update(
        {"_id": "status_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    next_number = counter["seq"]

    # Criar o status com dados da programação
    status = DeliveryStatus(
        status_number=next_number,
        schedule_id=schedule["id"],
        schedule_number=schedule["schedule_number"],
        destination_client_name=schedule["destination_client_name"],
        contracting_client_name=schedule["contracting_client_name"],
        booking=schedule.get("booking"),
        voyage=schedule.get("voyage"),
        status_date=data.status_date,
        items=[item.model_dump() if hasattr(item, 'model_dump') else item for item in data.items],
        observations=data.observations,
        created_by=current_user["sub"],
        created_by_name=current_user["name"]
    )
    
    await db.delivery_statuses.insert_one(status.model_dump())
    
    result = await db.delivery_statuses.find_one({"id": status.id}, {"_id": 0})
    return result

@api_router.put("/delivery-status/{status_id}", response_model=DeliveryStatusResponse)
async def update_delivery_status(status_id: str, data: DeliveryStatusCreate, current_user: dict = Depends(get_current_active_user)):
    """Atualiza um status de entrega existente"""
    existing = await db.delivery_statuses.find_one({"id": status_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Status de entrega não encontrado")
    
    update_data = {
        "status_date": data.status_date,
        "items": [item.model_dump() for item in data.items],
        "observations": data.observations,
        "updated_at": datetime.now(timezone.utc)
    }

    await db.delivery_statuses.update_one({"id": status_id}, {"$set": update_data})
    
    result = await db.delivery_statuses.find_one({"id": status_id}, {"_id": 0})
    return result

@api_router.delete("/delivery-status/{status_id}")
async def delete_delivery_status(status_id: str, current_user: dict = Depends(get_current_active_user)):
    """Deleta um status de entrega"""
    result = await db.delivery_statuses.delete_one({"id": status_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Status de entrega não encontrado")
    return {"message": "Status de entrega deletado com sucesso"}

@api_router.put("/delivery-status/{status_id}/update-status")
async def update_delivery_status_status(status_id: str, new_status: str, current_user: dict = Depends(get_current_active_user)):
    """Atualiza o status (ATIVO, CONCLUIDO, CANCELADO)"""
    if new_status not in ["ATIVO", "CONCLUIDO", "CANCELADO"]:
        raise HTTPException(status_code=400, detail="Status inválido")
    
    result = await db.delivery_statuses.update_one(
        {"id": status_id},
        {"$set": {"status": new_status, "updated_at": datetime.now(timezone.utc)}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Status de entrega não encontrado")
    return {"message": "Status atualizado com sucesso"}

@api_router.get("/delivery-status/{status_id}/pdf")
async def generate_delivery_status_pdf(status_id: str, current_user: dict = Depends(get_current_active_user)):
    """Gera PDF do status de entrega - Layout similar à programação de carregamento"""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from reportlab.graphics.barcode import code128
    import requests
    
    delivery_status = await db.delivery_statuses.find_one({"id": status_id}, {"_id": 0})
    if not delivery_status:
        raise HTTPException(status_code=404, detail="Status de entrega não encontrado")

    company = merge_company(await get_company_settings())
    buffer = io.BytesIO()
    
    # Cores
    BLACK = colors.black
    BORDER_COLOR = colors.black
    HEADER_BG = colors.HexColor('#F5F5F5')
    PRIMARY_GREEN = colors.HexColor('#008B7B')
    
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=12*mm,
        leftMargin=12*mm,
        topMargin=10*mm,
        bottomMargin=10*mm
    )
    
    elements = []
    styles = getSampleStyleSheet()
    
    # Download logo
    logo_buffer = load_logo_buffer(company)

    # ========== HEADER ==========
    company_style = ParagraphStyle('Company', parent=styles['Normal'], fontSize=18, fontName='Helvetica-Bold', alignment=TA_CENTER, textColor=PRIMARY_GREEN, leading=20)
    slogan_style = ParagraphStyle('Slogan', parent=styles['Normal'], fontSize=9, fontName='Helvetica', alignment=TA_CENTER, textColor=PRIMARY_GREEN, leading=11)
    address_style = ParagraphStyle('Address', parent=styles['Normal'], fontSize=8, fontName='Helvetica', alignment=TA_CENTER, textColor=BLACK, leading=10)
    info_right_style = ParagraphStyle('InfoRight', parent=styles['Normal'], fontSize=8, fontName='Helvetica', alignment=TA_RIGHT, textColor=BLACK)

    # Logo
    logo_cell = ""
    if logo_buffer:
        try:
            logo_cell = Image(logo_buffer, width=45, height=45)
        except:
            pass

    # Informações da empresa (centro)
    company_text = Paragraph(company['name'], company_style)
    address_text = Paragraph(company['address'].replace('\n', ' - '), address_style)

    center_content = [[company_text], [address_text]]
    center_table = Table(center_content, colWidths=[400])
    center_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))

    # Código de barras e informações (direita)
    barcode_value = f"ENTR{delivery_status['status_number']:06d}"
    barcode = code128.Code128(barcode_value, barWidth=1.2, barHeight=30)
    
    # Converter para horário de Brasília
    from zoneinfo import ZoneInfo
    created_at = parse_datetime_value(delivery_status['created_at'])
    brasilia_tz = ZoneInfo('America/Sao_Paulo')
    created_at_brasilia = created_at.astimezone(brasilia_tz)
    date_str = created_at_brasilia.strftime('%d/%m/%Y')
    
    # Abreviar nome do criador
    full_creator_name = delivery_status.get('created_by_name', 'Sistema')
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
    
    barcode_info = Paragraph(f"<b>Nº {delivery_status['status_number']}</b>", ParagraphStyle('BarcodeNum', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold', alignment=TA_CENTER))
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
    header_table = Table(header_data, colWidths=[55, 450, 160])
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
    line_table = Table(line_data, colWidths=[700])
    line_table.setStyle(TableStyle([
        ('LINEBELOW', (0, 0), (-1, -1), 2, PRIMARY_GREEN),
    ]))
    elements.append(line_table)
    elements.append(Spacer(1, 10))
    
    # ========== TÍTULO ==========
    title_style = ParagraphStyle('Title', parent=styles['Normal'], fontSize=12, fontName='Helvetica-Bold', alignment=TA_CENTER, textColor=PRIMARY_GREEN)
    
    title_content = [[Paragraph("STATUS DE ENTREGA", title_style)]]
    title_table = Table(title_content, colWidths=[700])
    title_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 2, BORDER_COLOR),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    elements.append(title_table)
    elements.append(Spacer(1, 10))
    
    # ========== BOX 1: Informações da Programação ==========
    label_style = ParagraphStyle('Label', parent=styles['Normal'], fontSize=8, fontName='Helvetica', textColor=BLACK)
    value_style = ParagraphStyle('Value', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold', textColor=BLACK)
    section_title = ParagraphStyle('SectionTitle', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold', textColor=BLACK)
    
    # Largura padrão para todas as seções (700px para alinhar com o título)
    SECTION_WIDTH = 700
    
    # Header da seção
    info_header = [[Paragraph("Informações da Programação", section_title)]]
    info_header_table = Table(info_header, colWidths=[SECTION_WIDTH])
    info_header_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), HEADER_BG),
        ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
    ]))
    elements.append(info_header_table)
    
    # Linha 1: Programação Ref e Data do Status
    status_date_value = delivery_status.get('status_date', '')
    if status_date_value:
        try:
            dt = datetime.fromisoformat(status_date_value.replace('Z', '+00:00'))
            status_date_value = dt.strftime('%d/%m/%Y')
        except:
            pass
    
    info_row1 = [
        [Paragraph("Programação Ref.", label_style), Paragraph(f"Nº {delivery_status['schedule_number']}", value_style)],
        [Paragraph("Data do Status", label_style), Paragraph(status_date_value, value_style)]
    ]
    # Linha 2: Clientes
    info_row2 = [
        [Paragraph("Cliente Contratante", label_style), Paragraph(delivery_status['contracting_client_name'], value_style)],
        [Paragraph("Cliente Destino", label_style), Paragraph(delivery_status['destination_client_name'], value_style)]
    ]
    # Linha 3: Booking e Viagem
    booking_value = delivery_status.get('booking') or '-'
    voyage_value = delivery_status.get('voyage') or '-'
    info_row3 = [
        [Paragraph("Booking", label_style), Paragraph(booking_value, value_style)],
        [Paragraph("Viagem", label_style), Paragraph(voyage_value, value_style)]
    ]

    info_content = [info_row1, info_row2, info_row3]

    info_table = Table(info_content, colWidths=[SECTION_WIDTH/2, SECTION_WIDTH/2])
    info_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
        ('LINEAFTER', (0, 0), (0, -1), 0.5, colors.HexColor('#CCCCCC')),
        ('LINEBELOW', (0, 0), (-1, 1), 0.5, colors.HexColor('#CCCCCC')),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 10))
    
    # ========== BOX 2: Tabela de Status de Entrega ==========
    status_header = [[Paragraph("Status de Entrega por Motorista", section_title)]]
    status_header_table = Table(status_header, colWidths=[SECTION_WIDTH])
    status_header_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), HEADER_BG),
        ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
    ]))
    elements.append(status_header_table)
    
    # Tabela de dados - headers como strings simples (igual ao PDF de referência)
    cell_wrap_style = ParagraphStyle('CellWrap', parent=styles['Normal'], fontSize=7.5, fontName='Helvetica', leading=9)
    has_bag_numbers = any((item.get('bag_number') or '').strip() for item in delivery_status['items'])
    table_header = ["#", "MOTORISTA", "CPF", "CAVALO", "CONTAINER", "LOCAL", "CHEGADA", "INÍCIO", "TÉRMINO", "SAÍDA", "AGEND.", "ENTREGA"]
    if has_bag_numbers:
        table_header.append("Nº DA BOLSA")
    table_data = [table_header]

    for idx, item in enumerate(delivery_status['items'], 1):
        # Abreviar nome do motorista
        driver_full_name = item.get('driver_name', '-')
        if driver_full_name and driver_full_name != '-':
            name_parts = driver_full_name.strip().split()
            preposicoes = ['DE', 'DA', 'DO', 'DOS', 'DAS', 'E']
            nomes_filtrados = [p for p in name_parts if p.upper() not in preposicoes]
            if len(nomes_filtrados) >= 2:
                driver_display_name = f"{nomes_filtrados[0]} {nomes_filtrados[1]}"
            elif len(nomes_filtrados) == 1:
                driver_display_name = nomes_filtrados[0]
            else:
                driver_display_name = ' '.join(name_parts[:2]) if len(name_parts) >= 2 else name_parts[0] if name_parts else '-'
        else:
            driver_display_name = '-'
        
        row = [
            str(idx),
            driver_display_name,
            item.get('driver_cpf', '-') or '-',
            item.get('cavalo_plate', '-') or '-',
            Paragraph(item.get('container_number', '-') or '-', cell_wrap_style),
            Paragraph(item.get('loading_location', '-') or '-', cell_wrap_style),
            item.get('arrival_time', '-') or '-',
            item.get('loading_start_time', '-') or '-',
            item.get('loading_end_time', '-') or '-',
            item.get('departure_time', '-') or '-',
            item.get('port_schedule_time', '-') or '-',
            item.get('delivery_completed', '-') or '-'
        ]
        if has_bag_numbers:
            row.append(item.get('bag_number') or '-')
        table_data.append(row)

    # Larguras ajustadas para 700px total (igual ao padrão do PDF de Programação)
    # Total = 700px para alinhar perfeitamente com o cabeçalho e demais seções
    if has_bag_numbers:
        col_widths = [20, 65, 60, 40, 65, 60, 52, 52, 52, 52, 52, 50, 80]  # Total = 700
    else:
        col_widths = [20, 85, 70, 50, 80, 85, 52, 52, 52, 52, 52, 50]  # Total = 700
    data_table = Table(table_data, colWidths=col_widths)
    data_table.setStyle(TableStyle([
        # Header row - verde padrão (igual ao PDF de referência)
        ('BACKGROUND', (0, 0), (-1, 0), PRIMARY_GREEN),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 8),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        # Body
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 8),
        ('ALIGN', (0, 1), (0, -1), 'CENTER'),  # # column
        ('ALIGN', (6, 1), (-1, -1), 'CENTER'),  # Horários columns
        # Borders
        ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CCCCCC')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 3),
        ('RIGHTPADDING', (0, 0), (-1, -1), 3),
        # Alternating row colors
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F9F9F9')]),
    ]))
    elements.append(data_table)
    elements.append(Spacer(1, 8))
    
    # ========== Observações ==========
    if delivery_status.get('observations'):
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
        obs_content = [[Paragraph(delivery_status['observations'], obs_content_style)]]
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

    filename = f"status_entrega_{delivery_status['status_number']}.pdf"
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={filename}"})


@api_router.get("/delivery-status/{status_id}/excel")
async def download_delivery_status_excel(status_id: str, current_user: dict = Depends(get_current_active_user)):
    """Gera Excel (XLS) do status de entrega"""
    from reports import generate_delivery_status_excel

    delivery_status = await db.delivery_statuses.find_one({"id": status_id}, {"_id": 0})
    if not delivery_status:
        raise HTTPException(status_code=404, detail="Status de entrega não encontrado")

    company = await get_company_settings()
    excel_bytes = generate_delivery_status_excel(delivery_status, company=company)

    filename = f"status_entrega_{delivery_status['status_number']}.xlsx"
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )



