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

# ==================== FINANCEIRO - SOLICITAÇÃO DE DIÁRIA ====================

from models import DailyRateRequest, DailyRateRequestCreate, DailyRateRequestResponse, DailyRateRequestItem


def calculate_daily_rate_item_total(item: DailyRateRequestItem) -> float:
    return round(
        item.others_value + item.commission_value + item.lunch_value
        + item.daily_rate_quantity * item.daily_rate_value,
        2
    )


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
    counter = await db.counters.find_one_and_update(
        {"_id": "daily_rate_request_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    request_number = counter["seq"]

    items_data = []
    total_value = 0.0
    for item in data.items:
        item.total = calculate_daily_rate_item_total(item)
        total_value += item.total
        items_data.append(item.model_dump())
    total_value = round(total_value, 2)

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

    items_data = []
    total_value = 0.0
    for item in data.items:
        item.total = calculate_daily_rate_item_total(item)
        total_value += item.total
        items_data.append(item.model_dump())
    total_value = round(total_value, 2)

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

    result = await db.daily_rate_requests.update_one(
        {"id": request_id},
        {"$set": {"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Solicitação de diária não encontrada")

    return {"message": "Status atualizado"}


@api_router.get("/daily-rate-requests/{request_id}/pdf")
async def generate_daily_rate_request_pdf(request_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Gera PDF da solicitação de diária - Layout similar ao comprovante de programação de carregamento"""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from reportlab.graphics.barcode import code128
    import requests

    daily_request = await db.daily_rate_requests.find_one({"id": request_id}, {"_id": 0})
    if not daily_request:
        raise HTTPException(status_code=404, detail="Solicitação de diária não encontrada")

    company = merge_company(await get_company_settings())
    buffer = io.BytesIO()

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

    logo_buffer = load_logo_buffer(company)

    company_style = ParagraphStyle('Company', parent=styles['Normal'], fontSize=18, fontName='Helvetica-Bold', alignment=TA_CENTER, textColor=PRIMARY_GREEN, leading=20)
    slogan_style = ParagraphStyle('Slogan', parent=styles['Normal'], fontSize=9, fontName='Helvetica', alignment=TA_CENTER, textColor=PRIMARY_GREEN, leading=11)
    address_style = ParagraphStyle('Address', parent=styles['Normal'], fontSize=8, fontName='Helvetica', alignment=TA_CENTER, textColor=BLACK, leading=10)
    info_right_style = ParagraphStyle('InfoRight', parent=styles['Normal'], fontSize=8, fontName='Helvetica', alignment=TA_RIGHT, textColor=BLACK)

    logo_cell = ""
    if logo_buffer:
        try:
            logo_cell = Image(logo_buffer, width=45, height=45)
        except:
            pass

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

    barcode_value = f"DIAR{daily_request['request_number']:06d}"
    barcode = code128.Code128(barcode_value, barWidth=1.2, barHeight=30)

    from zoneinfo import ZoneInfo
    created_at = parse_datetime_value(daily_request['created_at'])
    brasilia_tz = ZoneInfo('America/Sao_Paulo')
    created_at_brasilia = created_at.astimezone(brasilia_tz)
    date_str = created_at_brasilia.strftime('%d/%m/%Y')
    time_str = created_at_brasilia.strftime('%H:%M')

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

    barcode_info = Paragraph(f"<b>Nº {daily_request['request_number']}</b>", ParagraphStyle('BarcodeNum', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold', alignment=TA_CENTER))
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

    header_data = [[logo_cell, center_table, right_table]]
    header_table = Table(header_data, colWidths=[55, 450, 160])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (0, 0), (0, 0), 'LEFT'),
        ('ALIGN', (1, 0), (1, 0), 'CENTER'),
        ('ALIGN', (2, 0), (2, 0), 'RIGHT'),
    ]))
    elements.append(header_table)

    elements.append(Spacer(1, 5))
    line_data = [[""]]
    line_table = Table(line_data, colWidths=[700])
    line_table.setStyle(TableStyle([
        ('LINEBELOW', (0, 0), (-1, -1), 2, PRIMARY_GREEN),
    ]))
    elements.append(line_table)
    elements.append(Spacer(1, 10))

    title_style = ParagraphStyle('Title', parent=styles['Normal'], fontSize=12, fontName='Helvetica-Bold', alignment=TA_CENTER, textColor=PRIMARY_GREEN)

    title_content = [[Paragraph("SOLICITAÇÃO DE DIÁRIA", title_style)]]
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

    section_title = ParagraphStyle('SectionTitle', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold', textColor=BLACK)

    items_header = [[Paragraph("Itens da Solicitação", section_title)]]
    items_header_table = Table(items_header, colWidths=[700])
    items_header_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), HEADER_BG),
        ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
    ]))
    elements.append(items_header_table)

    table_header = ["#", "MOTORISTA", "PLACA", "CLIENTE", "DATA SAÍDA", "OUTROS", "COMISSÃO", "ALMOÇO", "QTD. DIÁRIA", "DIÁRIA", "TOTAL"]
    table_data = [table_header]

    for idx, item in enumerate(daily_request['items'], 1):
        departure_date = item.get('departure_date', '')
        if departure_date:
            try:
                dt = datetime.fromisoformat(departure_date.replace('Z', '+00:00'))
                departure_date = dt.strftime('%d/%m/%Y')
            except:
                pass

        row = [
            str(idx),
            item.get('driver_name', '-'),
            item.get('vehicle_plate', '-'),
            item.get('client_name', '-'),
            departure_date or '-',
            f"R$ {item.get('others_value', 0):.2f}",
            f"R$ {item.get('commission_value', 0):.2f}",
            f"R$ {item.get('lunch_value', 0):.2f}",
            f"{item.get('daily_rate_quantity', 0):.0f}",
            f"R$ {item.get('daily_rate_value', 0):.2f}",
            f"R$ {item.get('total', 0):.2f}",
        ]
        table_data.append(row)

    total_row = ["", "", "", "", "", "", "", "", "", "TOTAL GERAL", f"R$ {daily_request.get('total_value', 0):.2f}"]
    table_data.append(total_row)

    col_widths = [20, 105, 60, 90, 60, 60, 60, 55, 60, 60, 70]  # Total = 700 para alinhar com cabeçalho
    main_table = Table(table_data, colWidths=col_widths)
    main_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), PRIMARY_GREEN),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 7),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('FONTNAME', (0, 1), (-1, -2), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 7),
        ('ALIGN', (0, 1), (0, -1), 'CENTER'),
        ('ALIGN', (4, 1), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('SPAN', (0, -1), (8, -1)),
        ('ALIGN', (9, -1), (9, -1), 'RIGHT'),
        ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CCCCCC')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, colors.HexColor('#F9F9F9')]),
        ('BACKGROUND', (0, -1), (-1, -1), HEADER_BG),
    ]))
    elements.append(main_table)
    elements.append(Spacer(1, 12))

    if daily_request.get('observations'):
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
        obs_content = [[Paragraph(daily_request['observations'], obs_content_style)]]
        obs_table = Table(obs_content, colWidths=[700])
        obs_table.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ]))
        elements.append(obs_table)
        elements.append(Spacer(1, 12))

    footer_style = ParagraphStyle('Footer', parent=styles['Normal'], fontSize=8, textColor=colors.grey, alignment=TA_CENTER)
    elements.append(Spacer(1, 15))
    elements.append(Paragraph(f"Gerado em {now_brt().strftime('%d/%m/%Y %H:%M')} - ContainerLogix - {company['name']}", footer_style))

    doc.build(elements)
    buffer.seek(0)

    filename = f"solicitacao_diaria_{daily_request['request_number']}.pdf"
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={filename}"})


