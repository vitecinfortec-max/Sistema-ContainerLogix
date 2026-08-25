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


@api_router.get("/fuel-supply-orders/{order_id}/pdf")
async def download_fuel_supply_order_pdf(order_id: str, current_user: dict = Depends(get_current_active_user)):
    """Gera PDF da Ordem de Abastecimento (2 vias), seguindo o modelo Bsoft TMS."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.platypus import Image as RLImage
    from reports import download_logo

    order = await db.fuel_supply_orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Ordem de Abastecimento não encontrada")
    company = merge_company(await get_company_settings())

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

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4,
                            leftMargin=10 * mm, rightMargin=10 * mm,
                            topMargin=8 * mm, bottomMargin=8 * mm)
    styles = getSampleStyleSheet()
    BLACK = colors.HexColor('#000000')
    GRAY_BG = colors.HexColor('#E8E8E8')

    logo_buffer = download_logo(company)
    logo_img = RLImage(logo_buffer, width=20 * mm, height=20 * mm) if logo_buffer else Paragraph("", styles['Normal'])

    def field(label, val):
        return Paragraph(f"<font size='7' color='#555'>{label}</font><br/>"
                         f"<font size='8'><b>{val if val else '_____________'}</b></font>",
                         ParagraphStyle('F', parent=styles['Normal'], leading=11))

    def build_via():
        elems = []
        company_style = ParagraphStyle('CompHead', parent=styles['Normal'], fontSize=9, leading=11,
                                       fontName='Helvetica-Bold')
        company_address_line = (company['address'] or '').replace('\n', ', ')
        company_para = Paragraph(
            f"<b>{company['name']}</b><br/>"
            f"<font size='8'>{company_address_line}<br/>"
            f"CNPJ: {company['cnpj']}, Fone: {company['phone']}<br/>"
            f"E-mail: {company['email']}</font>", company_style)

        title_style = ParagraphStyle('OATit', parent=styles['Normal'], fontSize=13, leading=15,
                                     alignment=TA_RIGHT, fontName='Helvetica-Bold')
        right_para = Paragraph(
            f"Ordem de Abastecimento<br/>"
            f"<font size='9'>Nº: <b>{order['order_number']}</b></font><br/>"
            f"<font size='7'>Data/Hora: {fmt_dt(order.get('created_at'))}<br/>"
            f"Criado por: {order.get('created_by_name') or '-'}</font>", title_style)

        header = Table([[logo_img, company_para, right_para]], colWidths=[22 * mm, 96 * mm, 72 * mm])
        header.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('LEFTPADDING', (1, 0), (1, 0), 4),
        ]))
        elems.append(header)
        elems.append(Spacer(1, 4))

        supplier_t = Table([[Paragraph(
            f"<font size='9'>Fornecedor: <b>{order.get('supplier_name') or '-'}</b></font>", styles['Normal']
        )]], colWidths=[190 * mm])
        supplier_t.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 0.5, BLACK),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ]))
        elems.append(supplier_t)

        info_rows = [[
            field("Equipamento", order.get('equipment_plate')),
            field("Solicitante", order.get('requester')),
            field("Empresa", order.get('company_name')),
        ], [
            field("Produto", _FUEL_TYPE_LABELS.get(order.get('fuel_type'), order.get('fuel_type'))),
            field("Tipo", _SUPPLY_MODE_LABELS.get(order.get('supply_mode'), order.get('supply_mode'))),
            field("Data", fmt_date(order.get('order_date'))),
        ]]
        info_t = Table(info_rows, colWidths=[63.3 * mm, 63.3 * mm, 63.3 * mm])
        info_t.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 0.5, BLACK),
            ('INNERGRID', (0, 0), (-1, -1), 0.3, colors.grey),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ]))
        elems.append(info_t)

        blank_block = Table([[
            Paragraph(
                "<font size='8'>Data abastecimento: ___________<br/>"
                "Km de abastecimento: ___________<br/>"
                "Quantidade em litros: ___________<br/>"
                "Km último abastecimento: ___________<br/>"
                "Média: ___________</font>", styles['Normal']),
            Paragraph(
                f"<font size='8'>OBS: <b>{(order.get('observations') or '').replace(chr(10), '<br/>')}</b></font>",
                styles['Normal']),
        ]], colWidths=[95 * mm, 95 * mm])
        blank_block.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 0.5, BLACK),
            ('INNERGRID', (0, 0), (-1, -1), 0.3, colors.grey),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ]))
        elems.append(blank_block)

        elems.append(Paragraph(
            "<font size='7.5'>OBS: Favor anexar esta via junto com a nota fiscal que será enviada para cobrança. Obrigado.</font>",
            ParagraphStyle('Note', parent=styles['Normal'], spaceBefore=3)
        ))
        elems.append(Spacer(1, 8))

        sig_t = Table([
            [Paragraph("<font size='8'>__________________________<br/>Assinatura do Solicitante</font>", styles['Normal']),
             Paragraph("<font size='8'>__________________________<br/>Assinatura do Solicitado</font>", styles['Normal'])],
        ], colWidths=[95 * mm, 95 * mm])
        sig_t.setStyle(TableStyle([
            ('TOPPADDING', (0, 0), (-1, -1), 2),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ]))
        elems.append(sig_t)
        return elems

    elements = build_via()
    elements.append(Spacer(1, 10))
    elements += build_via()
    elements.append(Spacer(1, 8))
    elements.append(Paragraph(
        f"<font size='7' color='#888'>{now_brt().strftime('%d/%m/%Y %H:%M')} &nbsp;&nbsp; "
        f"{company['name']} - Sistema de Gestão</font>",
        ParagraphStyle('Footer', parent=styles['Normal'], alignment=TA_CENTER)
    ))

    doc.build(elements)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    filename = f"OrdemAbastecimento_{order['order_number']}.pdf"
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})
