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

# ==================== OPERACIONAL - PROGRAMAÇÃO DE CARREGAMENTO ====================

from models import LoadingSchedule, LoadingScheduleCreate, LoadingScheduleResponse, LoadingScheduleItem

@api_router.get("/loading-schedules")
async def get_loading_schedules(
    search: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    current_user: dict = Depends(get_current_active_user)
):
    """Lista todas as programações de carregamento"""
    query = {}
    
    if search:
        search_escaped = re.escape(search)
        query["$or"] = [
            {"destination_client_name": {"$regex": search_escaped, "$options": "i"}},
            {"contracting_client_name": {"$regex": search_escaped, "$options": "i"}},
            {"items.driver_name": {"$regex": search_escaped, "$options": "i"}},
            {"items.container_number": {"$regex": search_escaped, "$options": "i"}}
        ]
    
    if status:
        query["status"] = status
    
    total = await db.loading_schedules.count_documents(query)
    skip = (page - 1) * per_page
    
    cursor = db.loading_schedules.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page)
    schedules = await cursor.to_list(length=per_page)
    
    return {
        "items": schedules,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page
    }


@api_router.get("/loading-schedules/{schedule_id}", response_model=LoadingScheduleResponse)
async def get_loading_schedule(schedule_id: str, current_user: dict = Depends(get_current_active_user)):
    """Busca programação por ID"""
    schedule = await db.loading_schedules.find_one({"id": schedule_id}, {"_id": 0})
    if not schedule:
        raise HTTPException(status_code=404, detail="Programação não encontrada")
    return schedule


@api_router.post("/loading-schedules", response_model=LoadingScheduleResponse)
async def create_loading_schedule(data: LoadingScheduleCreate, current_user: dict = Depends(get_current_active_user)):
    """Cria nova programação de carregamento"""
    counter = await db.counters.find_one_and_update(
        {"_id": "loading_schedule_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    schedule_number = counter["seq"]
    
    schedule_data = {
        "id": str(uuid.uuid4()),
        "schedule_number": schedule_number,
        "destination_client_id": data.destination_client_id,
        "destination_client_name": data.destination_client_name,
        "contracting_client_id": data.contracting_client_id,
        "contracting_client_name": data.contracting_client_name,
        "booking": data.booking,
        "voyage": data.voyage,
        "items": [item.model_dump() for item in data.items],
        "status": "ATIVO",
        "observations": data.observations,
        "created_by": current_user["sub"],
        "created_by_name": current_user.get("name", "Sistema"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": None
    }
    
    await db.loading_schedules.insert_one(schedule_data)
    schedule_data.pop("_id", None)
    
    return schedule_data


@api_router.put("/loading-schedules/{schedule_id}", response_model=LoadingScheduleResponse)
async def update_loading_schedule(schedule_id: str, data: LoadingScheduleCreate, current_user: dict = Depends(get_current_active_user)):
    """Atualiza programação de carregamento"""
    schedule = await db.loading_schedules.find_one({"id": schedule_id})
    if not schedule:
        raise HTTPException(status_code=404, detail="Programação não encontrada")
    
    update_data = {
        "destination_client_id": data.destination_client_id,
        "destination_client_name": data.destination_client_name,
        "contracting_client_id": data.contracting_client_id,
        "contracting_client_name": data.contracting_client_name,
        "booking": data.booking,
        "voyage": data.voyage,
        "items": [item.model_dump() for item in data.items],
        "observations": data.observations,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }

    await db.loading_schedules.update_one({"id": schedule_id}, {"$set": update_data})
    updated = await db.loading_schedules.find_one({"id": schedule_id}, {"_id": 0})
    return updated


@api_router.delete("/loading-schedules/{schedule_id}")
async def delete_loading_schedule(schedule_id: str, current_user: dict = Depends(get_current_active_user)):
    """Exclui programação de carregamento"""
    schedule = await db.loading_schedules.find_one({"id": schedule_id})
    if not schedule:
        raise HTTPException(status_code=404, detail="Programação não encontrada")
    
    await db.loading_schedules.delete_one({"id": schedule_id})
    return {"message": "Programação excluída com sucesso"}


@api_router.put("/loading-schedules/{schedule_id}/update-status")
async def update_loading_schedule_status(schedule_id: str, new_status: str, current_user: dict = Depends(get_current_active_user)):
    """Atualiza status da programação"""
    if new_status not in ["ATIVO", "CONCLUIDO", "CANCELADO"]:
        raise HTTPException(status_code=400, detail="Status inválido")
    
    result = await db.loading_schedules.update_one(
        {"id": schedule_id},
        {"$set": {"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Programação não encontrada")
    
    return {"message": "Status atualizado"}


@api_router.get("/loading-schedules/{schedule_id}/pdf")
async def generate_loading_schedule_pdf(schedule_id: str, current_user: dict = Depends(get_current_active_user)):
    """Gera PDF da programação de carregamento - Layout similar ao comprovante de movimentação"""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from reportlab.graphics.barcode import code128
    from reportlab.graphics.shapes import Drawing
    import requests
    
    schedule = await db.loading_schedules.find_one({"id": schedule_id}, {"_id": 0})
    if not schedule:
        raise HTTPException(status_code=404, detail="Programação não encontrada")

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

    # ========== HEADER com Logo, Empresa, Código de Barras ==========
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
    barcode_value = f"PROG{schedule['schedule_number']:06d}"
    barcode = code128.Code128(barcode_value, barWidth=1.2, barHeight=30)
    
    # Converter para horário de Brasília (UTC-3)
    from zoneinfo import ZoneInfo
    created_at = parse_datetime_value(schedule['created_at'])
    brasilia_tz = ZoneInfo('America/Sao_Paulo')
    created_at_brasilia = created_at.astimezone(brasilia_tz)
    date_str = created_at_brasilia.strftime('%d/%m/%Y')
    time_str = created_at_brasilia.strftime('%H:%M')
    
    # Abreviar nome do criador (primeiro e segundo nome, ignorando preposições)
    full_creator_name = schedule.get('created_by_name', 'Sistema')
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
    
    barcode_info = Paragraph(f"<b>Nº {schedule['schedule_number']}</b>", ParagraphStyle('BarcodeNum', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold', alignment=TA_CENTER))
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
    
    # ========== TÍTULO: Box com borda ==========
    title_style = ParagraphStyle('Title', parent=styles['Normal'], fontSize=12, fontName='Helvetica-Bold', alignment=TA_CENTER, textColor=PRIMARY_GREEN)
    
    title_content = [[Paragraph("PROGRAMAÇÃO DE CARREGAMENTO", title_style)]]
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
    
    # ========== BOX 1: Informações dos Clientes ==========
    label_style = ParagraphStyle('Label', parent=styles['Normal'], fontSize=8, fontName='Helvetica', textColor=BLACK)
    value_style = ParagraphStyle('Value', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold', textColor=BLACK)
    section_title = ParagraphStyle('SectionTitle', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold', textColor=BLACK)
    
    # Header da seção
    client_header = [[Paragraph("Informações dos Clientes", section_title)]]
    client_header_table = Table(client_header, colWidths=[700])
    client_header_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), HEADER_BG),
        ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
    ]))
    elements.append(client_header_table)
    
    # Conteúdo - Linha 1: Clientes
    client_row1 = [
        [Paragraph("Cliente Contratante", label_style), Paragraph(schedule['contracting_client_name'], value_style)],
        [Paragraph("Cliente Destino", label_style), Paragraph(schedule['destination_client_name'], value_style)]
    ]
    # Conteúdo - Linha 2: Booking e Viagem
    booking_value = schedule.get('booking') or '-'
    voyage_value = schedule.get('voyage') or '-'
    client_row2 = [
        [Paragraph("Booking", label_style), Paragraph(booking_value, value_style)],
        [Paragraph("Viagem", label_style), Paragraph(voyage_value, value_style)]
    ]

    client_content = [client_row1, client_row2]

    client_table = Table(client_content, colWidths=[350, 350])
    client_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
        ('LINEAFTER', (0, 0), (0, -1), 0.5, colors.HexColor('#CCCCCC')),
        ('LINEBELOW', (0, 0), (-1, 0), 0.5, colors.HexColor('#CCCCCC')),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    elements.append(client_table)
    elements.append(Spacer(1, 10))
    
    # ========== BOX 2: Tabela de Programações ==========
    prog_header = [[Paragraph("Itens da Programação", section_title)]]
    prog_header_table = Table(prog_header, colWidths=[700])
    prog_header_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), HEADER_BG),
        ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
    ]))
    elements.append(prog_header_table)
    
    # Tabela de dados
    cell_wrap_style = ParagraphStyle('CellWrap', parent=styles['Normal'], fontSize=7.5, fontName='Helvetica', leading=9)
    has_bag_numbers = any((item.get('bag_number') or '').strip() for item in schedule['items'])
    table_header = ["#", "TIPO", "MOTORISTA", "CPF", "CAVALO", "CARRETA", "LOCAL DE CARREG.", "DATA", "CONTAINER", "LACRE"]
    if has_bag_numbers:
        table_header.append("Nº DA BOLSA")
    table_data = [table_header]

    for idx, item in enumerate(schedule['items'], 1):
        loading_date = item.get('loading_date', '')
        if loading_date:
            try:
                dt = datetime.fromisoformat(loading_date.replace('Z', '+00:00'))
                loading_date = dt.strftime('%d/%m/%Y')
            except:
                pass
        
        # Pegar primeiro e segundo nome do motorista (ignorando preposições)
        driver_full_name = item.get('driver_name', '-')
        if driver_full_name and driver_full_name != '-':
            name_parts = driver_full_name.strip().split()
            # Filtrar preposições comuns
            preposicoes = ['DE', 'DA', 'DO', 'DOS', 'DAS', 'E']
            nomes_filtrados = [p for p in name_parts if p.upper() not in preposicoes]
            
            if len(nomes_filtrados) >= 2:
                driver_display_name = f"{nomes_filtrados[0]} {nomes_filtrados[1]}"
            elif len(nomes_filtrados) == 1:
                driver_display_name = nomes_filtrados[0]
            else:
                # Se só tem preposições, usa os dois primeiros
                driver_display_name = ' '.join(name_parts[:2]) if len(name_parts) >= 2 else name_parts[0] if name_parts else '-'
        else:
            driver_display_name = '-'
        
        row = [
            str(idx),
            item.get('operation_type') or '-',
            driver_display_name,
            item.get('driver_cpf', '-') or '-',
            item.get('cavalo_plate', '-'),
            item.get('carreta_plate', '-') or '-',
            Paragraph(item.get('loading_location', '-') or '-', cell_wrap_style),
            loading_date or '-',
            Paragraph(item.get('container_number', '-') or '-', cell_wrap_style),
            item.get('seal_number', '-') or '-'
        ]
        if has_bag_numbers:
            row.append(item.get('bag_number') or '-')
        table_data.append(row)

    if has_bag_numbers:
        col_widths = [20, 45, 95, 60, 50, 50, 110, 55, 70, 55, 90]  # Total = 700 para alinhar com cabeçalho
    else:
        col_widths = [20, 55, 100, 70, 55, 55, 130, 60, 90, 65]  # Total = 700 para alinhar com cabeçalho
    main_table = Table(table_data, colWidths=col_widths)
    main_table_style = [
        # Header row - verde padrão
        ('BACKGROUND', (0, 0), (-1, 0), PRIMARY_GREEN),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 8),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        # Body
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 8),
        ('ALIGN', (0, 1), (0, -1), 'CENTER'),  # # column
        ('ALIGN', (6, 1), (6, -1), 'CENTER'),  # Data column
        # Borders
        ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CCCCCC')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        # Alternating row colors
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F9F9F9')]),
    ]
    if has_bag_numbers:
        main_table_style.append(('ALIGN', (10, 1), (10, -1), 'CENTER'))  # Nº da Bolsa
    main_table.setStyle(TableStyle(main_table_style))
    elements.append(main_table)
    elements.append(Spacer(1, 12))
    
    # ========== BOX 3: Observações (se houver) ==========
    if schedule.get('observations'):
        obs_header = [[Paragraph("Observações", section_title)]]
        obs_header_table = Table(obs_header, colWidths=[700])
        obs_header_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), HEADER_BG),
            ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ]))
        elements.append(obs_header_table)
        
        obs_content_style = ParagraphStyle('ObsContent', parent=styles['Normal'], fontSize=9, fontName='Helvetica', textColor=BLACK)
        obs_content = [[Paragraph(schedule['observations'], obs_content_style)]]
        obs_table = Table(obs_content, colWidths=[700])
        obs_table.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ]))
        elements.append(obs_table)
        elements.append(Spacer(1, 12))
    
    # ========== RODAPÉ ==========
    footer_style = ParagraphStyle('Footer', parent=styles['Normal'], fontSize=8, textColor=colors.grey, alignment=TA_CENTER)
    elements.append(Spacer(1, 15))
    elements.append(Paragraph(f"ContainerLogix - {company['name']}", footer_style))
    
    doc.build(elements)
    buffer.seek(0)
    
    filename = f"programacao_carregamento_{schedule['schedule_number']}.pdf"
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={filename}"})


