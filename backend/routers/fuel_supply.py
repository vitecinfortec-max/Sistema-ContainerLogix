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
    FuelSupply, FuelSupplyCreate, FuelSupplyUpdate, FuelSupplyResponse,
    FuelSupplyOrder, FuelSupplyOrderCreate, FuelSupplyOrderUpdate, FuelSupplyOrderResponse,
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

# ==================== CONTROLE DE ABASTECIMENTO ====================


def _fuel_calc(doc: dict) -> dict:
    """Calcula Valor Líquido e Valor Total a partir dos campos base."""
    out = {**doc}
    gross = float(out.get('gross_value') or 0)
    discounts = float(out.get('discounts') or 0)
    additions = float(out.get('additions') or 0)
    net_value = round(gross - discounts + additions, 2)
    other = float(out.get('other_expenses_value') or 0) if out.get('has_other_expenses') else 0.0
    out['net_value'] = net_value
    out['total_value'] = round(net_value + other, 2)
    return out


@api_router.get("/fuel-supplies", response_model=List[FuelSupplyResponse])
async def list_fuel_supplies(
    search: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    query = {}
    if search:
        search_escaped = re.escape(search)
        query["$or"] = [
            {"equipment_plate": {"$regex": search_escaped, "$options": "i"}},
            {"driver_name": {"$regex": search_escaped, "$options": "i"}},
            {"supplier_name": {"$regex": search_escaped, "$options": "i"}},
        ]
    rows = await db.fuel_supplies.find(query, {"_id": 0}).sort("supply_number", -1).to_list(None)
    return [_fuel_calc(r) for r in rows]


@api_router.get("/fuel-supplies/next-number")
async def get_next_fuel_supply_number(current_user: dict = Depends(get_current_active_user)):
    """Só uma prévia pra tela; o número real é reservado de forma atômica na criação."""
    counter = await db.counters.find_one({"_id": "fuel_supply_number"})
    return {"next_number": (counter["seq"] + 1) if counter else 1}


@api_router.get("/fuel-supplies/{supply_id}", response_model=FuelSupplyResponse)
async def get_fuel_supply(supply_id: str, current_user: dict = Depends(get_current_active_user)):
    doc = await db.fuel_supplies.find_one({"id": supply_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Abastecimento não encontrado")
    return _fuel_calc(doc)


@api_router.post("/fuel-supplies", response_model=FuelSupplyResponse)
async def create_fuel_supply(data: FuelSupplyCreate, current_user: dict = Depends(get_current_active_user)):
    counter = await db.counters.find_one_and_update(
        {"_id": "fuel_supply_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    next_num = counter["seq"]

    obj = FuelSupply(
        supply_number=next_num,
        **data.model_dump(),
        created_by=current_user["sub"],
        created_by_name=current_user["name"]
    )
    doc = obj.model_dump()
    doc["created_at"] = obj.created_at.isoformat()
    await db.fuel_supplies.insert_one(doc)
    return _fuel_calc(doc)


@api_router.put("/fuel-supplies/{supply_id}", response_model=FuelSupplyResponse)
async def update_fuel_supply(supply_id: str, data: FuelSupplyUpdate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.fuel_supplies.find_one({"id": supply_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Abastecimento não encontrado")
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.fuel_supplies.update_one({"id": supply_id}, {"$set": update_data})
    updated = await db.fuel_supplies.find_one({"id": supply_id}, {"_id": 0})
    return _fuel_calc(updated)


@api_router.delete("/fuel-supplies/{supply_id}")
async def delete_fuel_supply(supply_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.fuel_supplies.delete_one({"id": supply_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Abastecimento não encontrado")
    return {"message": "Abastecimento removido"}


# ==================== ORDEM DE ABASTECIMENTO ====================


@api_router.get("/fuel-supply-orders", response_model=List[FuelSupplyOrderResponse])
async def list_fuel_supply_orders(
    search: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    query = {}
    if search:
        search_escaped = re.escape(search)
        query["$or"] = [
            {"equipment_plate": {"$regex": search_escaped, "$options": "i"}},
            {"requester": {"$regex": search_escaped, "$options": "i"}},
            {"supplier_name": {"$regex": search_escaped, "$options": "i"}},
            {"company_name": {"$regex": search_escaped, "$options": "i"}},
        ]
    rows = await db.fuel_supply_orders.find(query, {"_id": 0}).sort("order_number", -1).to_list(None)
    launched_ids = set(await db.fuel_supplies.distinct("fuel_supply_order_id", {"fuel_supply_order_id": {"$ne": None}}))
    for r in rows:
        r["is_launched"] = r["id"] in launched_ids
    return rows


@api_router.get("/fuel-supply-orders/next-number")
async def get_next_fuel_supply_order_number(current_user: dict = Depends(get_current_active_user)):
    """Só uma prévia pra tela; o número real é reservado de forma atômica na criação."""
    counter = await db.counters.find_one({"_id": "fuel_supply_order_number"})
    return {"next_number": (counter["seq"] + 1) if counter else 1}


@api_router.get("/fuel-supply-orders/{order_id}", response_model=FuelSupplyOrderResponse)
async def get_fuel_supply_order(order_id: str, current_user: dict = Depends(get_current_active_user)):
    doc = await db.fuel_supply_orders.find_one({"id": order_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Ordem de Abastecimento não encontrada")
    return doc


@api_router.post("/fuel-supply-orders", response_model=FuelSupplyOrderResponse)
async def create_fuel_supply_order(data: FuelSupplyOrderCreate, current_user: dict = Depends(get_current_active_user)):
    counter = await db.counters.find_one_and_update(
        {"_id": "fuel_supply_order_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    next_num = counter["seq"]

    obj = FuelSupplyOrder(
        order_number=next_num,
        **data.model_dump(),
        created_by=current_user["sub"],
        created_by_name=current_user["name"]
    )
    doc = obj.model_dump()
    doc["created_at"] = obj.created_at.isoformat()
    await db.fuel_supply_orders.insert_one(doc)
    return doc


@api_router.put("/fuel-supply-orders/{order_id}", response_model=FuelSupplyOrderResponse)
async def update_fuel_supply_order(order_id: str, data: FuelSupplyOrderUpdate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.fuel_supply_orders.find_one({"id": order_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Ordem de Abastecimento não encontrada")
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.fuel_supply_orders.update_one({"id": order_id}, {"$set": update_data})
    updated = await db.fuel_supply_orders.find_one({"id": order_id}, {"_id": 0})
    return updated


@api_router.delete("/fuel-supply-orders/{order_id}")
async def delete_fuel_supply_order(order_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.fuel_supply_orders.delete_one({"id": order_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Ordem de Abastecimento não encontrada")
    return {"message": "Ordem de Abastecimento removida"}


_FUEL_TYPE_LABELS = {
    "DIESEL_S10": "Diesel S10", "DIESEL_S500": "Diesel S500",
    "GASOLINA_COMUM": "Gasolina Comum", "GASOLINA_ADITIVADA": "Gasolina Aditivada",
    "ETANOL": "Etanol", "ARLA_32": "Arla 32", "GNV": "GNV", "OUTRO": "Outro",
}
_SUPPLY_MODE_LABELS = {
    "LITROS": "Litros", "VALOR": "Valor", "LITROS_VALOR": "Litros/Valor",
    "COMPLETAR_TANQUE": "Completar Tanque",
}


def _valor_por_extenso(value):
    """Converte um valor em reais pro texto por extenso (ex: 'Quinhentos e Sessenta e Nove Reais')."""
    from num2words import num2words
    try:
        text = num2words(round(float(value or 0), 2), lang='pt_BR', to='currency')
    except Exception:
        return ''
    conectores = {'e', 'de'}
    words = text.split(' ')
    return ' '.join(w if w in conectores else w.capitalize() for w in words)


@api_router.get("/fuel-supply-orders/{order_id}/pdf")
async def download_fuel_supply_order_pdf(order_id: str, current_user: dict = Depends(get_current_active_user)):
    """Gera PDF da Ordem de Abastecimento (2 vias) - mesmo layout visual do
    Controle de Revisão (backend/routers/frota.py: generate_revision_pdf),
    pra manter os comprovantes de Manutenção com a mesma identidade visual."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from reportlab.platypus import Image as RLImage
    from reports import download_logo

    order = await db.fuel_supply_orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Ordem de Abastecimento não encontrada")
    company = merge_company(await get_company_settings())

    # Cores corporativas (iguais ao Controle de Revisão)
    PRIMARY_COLOR = "008B7B"
    HEADER_BG_COLOR = "E8F4F5"

    def fmt_dt(s):
        if not s:
            return ''
        try:
            return datetime.fromisoformat(str(s).replace('Z', '+00:00')).strftime('%d/%m/%Y %H:%M')
        except Exception:
            return str(s)

    def fmt_date(s):
        if not s:
            return ''
        try:
            return datetime.fromisoformat(str(s)).strftime('%d/%m/%Y')
        except Exception:
            return str(s)

    def money(v):
        try:
            return f"{float(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        except Exception:
            return "-"

    liters = order.get('liters')
    estimated_value = order.get('estimated_value')
    has_total = liters is not None and estimated_value is not None
    total_value = (float(liters) * float(estimated_value)) if has_total else None

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        rightMargin=15 * mm, leftMargin=15 * mm,
        topMargin=15 * mm, bottomMargin=15 * mm
    )
    styles = getSampleStyleSheet()

    logo_buffer = download_logo(company)
    WIDTH = 520

    def build_via():
        elems = []

        # ========== CABEÇALHO ==========
        company_style = ParagraphStyle('CompanyName', parent=styles['Normal'], fontSize=12,
                                       textColor=colors.black, alignment=TA_CENTER,
                                       fontName='Helvetica-Bold', leading=14)
        address_style = ParagraphStyle('Address', parent=styles['Normal'], fontSize=7,
                                       textColor=colors.black, alignment=TA_CENTER, leading=9)

        logo_cell = ""
        if logo_buffer:
            try:
                logo_cell = RLImage(logo_buffer, width=36, height=36)
            except Exception:
                pass

        address_lines = [line.strip() for line in (company['address'] or '').split('\n') if line.strip()]
        company_info = [
            Paragraph(company['name'], company_style),
            Paragraph(f"CNPJ: {company['cnpj']}", address_style),
        ] + [
            Paragraph(line, address_style) for line in address_lines
        ] + [
            Paragraph(f"{company['email']} | {company['phone']}", address_style),
        ]

        header_table = Table([[logo_cell, company_info, ""]], colWidths=[60, 400, 60])
        header_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN', (0, 0), (0, 0), 'LEFT'),
            ('ALIGN', (1, 0), (1, 0), 'CENTER'),
        ]))
        elems.append(header_table)
        elems.append(Spacer(1, 2))

        line_table = Table([[""]], colWidths=[WIDTH])
        line_table.setStyle(TableStyle([
            ('LINEABOVE', (0, 0), (-1, 0), 2, colors.HexColor(f'#{PRIMARY_COLOR}')),
        ]))
        elems.append(line_table)
        elems.append(Spacer(1, 5))

        # ========== TÍTULO ==========
        title_style = ParagraphStyle('Title', parent=styles['Normal'], fontSize=14,
                                     textColor=colors.HexColor(f'#{PRIMARY_COLOR}'), alignment=TA_CENTER,
                                     fontName='Helvetica-Bold', spaceAfter=6)
        elems.append(Paragraph("ORDEM DE ABASTECIMENTO", title_style))

        # ========== INFO BAR ==========
        order_date_str = fmt_date(order.get('order_date')) or fmt_dt(order.get('created_at'))
        info_text = (f"Ordem Nº {order['order_number']}  |  Equipamento: {order.get('equipment_plate') or '-'}  |  "
                    f"Data: {order_date_str}")
        info_style = ParagraphStyle('InfoBar', parent=styles['Normal'], fontSize=10,
                                    textColor=colors.HexColor(f'#{PRIMARY_COLOR}'), alignment=TA_CENTER,
                                    fontName='Helvetica-Bold')
        info_table = Table([[Paragraph(info_text, info_style)]], colWidths=[WIDTH])
        info_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(f'#{HEADER_BG_COLOR}')),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('BOX', (0, 0), (-1, -1), 1, colors.HexColor(f'#{PRIMARY_COLOR}')),
        ]))
        elems.append(info_table)
        elems.append(Spacer(1, 6))

        # ========== DADOS DO ABASTECIMENTO ==========
        label_style = ParagraphStyle('Label', parent=styles['Normal'], fontSize=9, fontName='Helvetica-Bold')
        value_style = ParagraphStyle('Value', parent=styles['Normal'], fontSize=9, fontName='Helvetica')

        dados_data = [
            [Paragraph("FORNECEDOR:", label_style), Paragraph(order.get('supplier_name') or '-', value_style),
             Paragraph("SOLICITANTE:", label_style), Paragraph(order.get('requester') or '-', value_style)],
            [Paragraph("EQUIPAMENTO:", label_style), Paragraph(order.get('equipment_plate') or '-', value_style),
             Paragraph("PRODUTO:", label_style),
             Paragraph(_FUEL_TYPE_LABELS.get(order.get('fuel_type'), order.get('fuel_type')) or '-', value_style)],
        ]
        dados_table = Table(dados_data, colWidths=[100, 160, 100, 160])
        dados_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#F5F5F5')),
            ('BACKGROUND', (2, 0), (2, -1), colors.HexColor('#F5F5F5')),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CCCCCC')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ]))
        elems.append(dados_table)
        elems.append(Spacer(1, 4))

        # ========== QUANTIDADE E VALOR - TÍTULO ==========
        section_title_style = ParagraphStyle('SectionTitle', parent=styles['Normal'], fontSize=10,
                                             textColor=colors.white, alignment=TA_CENTER,
                                             fontName='Helvetica-Bold')
        section_table = Table([[Paragraph("QUANTIDADE E VALOR", section_title_style)]], colWidths=[WIDTH])
        section_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(f'#{PRIMARY_COLOR}')),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        elems.append(section_table)

        items_header = ['QUANTIDADE (L)', 'PREÇO UNIT.', 'TOTAL']
        items_row = [
            f"{liters:.2f}".replace('.', ',') if liters is not None else '-',
            money(estimated_value) if estimated_value is not None else '-',
            money(total_value) if has_total else '-',
        ]
        items_table = Table([items_header, items_row], colWidths=[WIDTH / 3] * 3)
        items_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor(f'#{HEADER_BG_COLOR}')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor(f'#{PRIMARY_COLOR}')),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('FONTNAME', (0, 1), (-1, 1), 'Helvetica'),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CCCCCC')),
            ('BOX', (0, 0), (-1, -1), 1, colors.HexColor(f'#{PRIMARY_COLOR}')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ]))
        elems.append(items_table)
        elems.append(Spacer(1, 3))

        extenso = _valor_por_extenso(total_value) if has_total and total_value else ''
        if extenso:
            extenso_style = ParagraphStyle('Extenso', parent=styles['Normal'], fontSize=8,
                                           fontName='Helvetica-Bold', alignment=TA_CENTER)
            extenso_table = Table([[Paragraph(f"Valor por extenso: {extenso}", extenso_style)]], colWidths=[WIDTH])
            extenso_table.setStyle(TableStyle([
                ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CCCCCC')),
                ('TOPPADDING', (0, 0), (-1, -1), 3),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ]))
            elems.append(extenso_table)
            elems.append(Spacer(1, 5))
        else:
            elems.append(Spacer(1, 2))

        # ========== DADOS PARA CONFERÊNCIA (preenchimento manual) + OBSERVAÇÃO ==========
        manual_style = ParagraphStyle('Manual', parent=styles['Normal'], fontSize=7.5, leading=9.5,
                                      fontName='Helvetica')
        obs_style = ParagraphStyle('ObsCell', parent=styles['Normal'], fontSize=7.5, fontName='Helvetica')
        obs_block = Table([[
            Paragraph("Data abastecimento:<br/>Km de abastecimento:<br/>Quantidade em litros:<br/>"
                     "Km último abastecimento:<br/>Média:", manual_style),
            Paragraph(f"OBS: {(order.get('observations') or '').replace(chr(10), '<br/>')}", obs_style),
        ]], colWidths=[260, 260])
        obs_block.setStyle(TableStyle([
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CCCCCC')),
            ('BOX', (0, 0), (-1, -1), 1, colors.HexColor(f'#{PRIMARY_COLOR}')),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 2),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ]))
        elems.append(obs_block)
        elems.append(Spacer(1, 1))

        elems.append(Paragraph(
            "Favor anexar esta via junto com a nota fiscal que será enviada para cobrança. Obrigado.",
            ParagraphStyle('Note', parent=styles['Normal'], fontSize=6.5, fontName='Helvetica-Oblique',
                          textColor=colors.grey, leading=8)
        ))
        elems.append(Spacer(1, 2))

        # ========== ASSINATURAS ==========
        sig_data = [
            ["_" * 45, "_" * 45],
            ["Assinatura do Solicitante", "Assinatura do Solicitado"],
        ]
        sig_table = Table(sig_data, colWidths=[260, 260])
        sig_table.setStyle(TableStyle([
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 1), (-1, 1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 7),
            ('TOPPADDING', (0, 0), (-1, -1), 1),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 1),
        ]))
        elems.append(sig_table)

        # ========== RODAPÉ ==========
        footer_style = ParagraphStyle('Footer', parent=styles['Normal'], fontSize=6.5,
                                      textColor=colors.grey, alignment=TA_CENTER, leading=7.5)
        elems.append(Spacer(1, 1))
        elems.append(Paragraph(
            f"Criado por: {order.get('created_by_name') or '-'} em {fmt_dt(order.get('created_at'))}", footer_style
        ))
        elems.append(Paragraph(
            f"Impresso por: {current_user.get('name') or '-'} em {now_brt().strftime('%d/%m/%Y %H:%M')}", footer_style
        ))
        elems.append(Paragraph(f"ContainerLogix - {company['name']}", footer_style))
        return elems

    elements = build_via()
    elements.append(Spacer(1, 5))
    elements.append(HRFlowable(width="100%", thickness=0.75, color=colors.HexColor('#999999'),
                               dash=(4, 3), spaceBefore=0, spaceAfter=0))
    elements.append(Paragraph(
        "&#9986;  corte aqui  &#9986;",
        ParagraphStyle('CutLine', parent=styles['Normal'], fontSize=6.5, textColor=colors.HexColor('#999999'),
                      alignment=TA_CENTER, spaceBefore=1, spaceAfter=1)
    ))
    elements.append(HRFlowable(width="100%", thickness=0.75, color=colors.HexColor('#999999'),
                               dash=(4, 3), spaceBefore=0, spaceAfter=0))
    elements.append(Spacer(1, 5))
    elements += build_via()

    doc.build(elements)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    filename = f"OrdemAbastecimento_{order['order_number']}.pdf"
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})
