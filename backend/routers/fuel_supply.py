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

    BLUE = colors.HexColor('#1D4ED8')
    BLACK = colors.HexColor('#000000')

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
    doc = SimpleDocTemplate(buffer, pagesize=A4,
                            leftMargin=10 * mm, rightMargin=10 * mm,
                            topMargin=8 * mm, bottomMargin=8 * mm)
    styles = getSampleStyleSheet()

    logo_buffer = download_logo(company)
    logo_img = RLImage(logo_buffer, width=18 * mm, height=18 * mm) if logo_buffer else Paragraph("", styles['Normal'])

    COL_W = [32 * mm, 55 * mm, 25 * mm, 43 * mm, 17.5 * mm, 17.5 * mm]  # Equip/Solic/Qtd/Produto/Preço/Total

    def build_via():
        elems = []
        # ===== Cabeçalho: logo + empresa centralizada + data/nº à direita =====
        company_name_style = ParagraphStyle('CompName', parent=styles['Normal'], fontSize=12, leading=14,
                                            alignment=TA_CENTER, fontName='Helvetica-Bold')
        company_contact_style = ParagraphStyle('CompContact', parent=styles['Normal'], fontSize=7, leading=9,
                                               alignment=TA_CENTER, textColor=BLUE)
        company_address_line = (company['address'] or '').replace('\n', ', ')
        company_block = Table([
            [Paragraph(f"<b>{company['name']}</b>", company_name_style)],
            [Paragraph(f"{company_address_line}<br/>"
                      f"Fone: {company['phone']}, E-mail: {company['email']}", company_contact_style)],
        ], colWidths=[150 * mm])
        company_block.setStyle(TableStyle([
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 1),
        ]))

        info_style = ParagraphStyle('OAInfo', parent=styles['Normal'], fontSize=7, leading=9, alignment=TA_RIGHT)
        right_para = Paragraph(
            f"<b>Data/Hora:</b> {fmt_dt(order.get('created_at'))}<br/>"
            f"<b>Nº:</b> {order['order_number']}<br/>"
            f"<b>Criado por:</b> {order.get('created_by_name') or '-'}<br/>"
            f"<b>Impresso por:</b> {current_user.get('name') or '-'}", info_style)

        header = Table([[logo_img, company_block, right_para]], colWidths=[20 * mm, 145 * mm, 25 * mm])
        header.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ]))
        elems.append(header)
        elems.append(Spacer(1, 4))

        # ===== Título da seção =====
        title_t = Table([[Paragraph("<b>Ordem de abastecimento</b>",
                                    ParagraphStyle('OATit', parent=styles['Normal'], fontSize=9, alignment=TA_CENTER))]],
                        colWidths=[sum(COL_W)])
        title_t.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 0.75, BLACK),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ]))
        elems.append(title_t)

        # ===== Fornecedor =====
        supplier_t = Table([[Paragraph(
            f"<font size='9'>Fornecedor: <b>{order.get('supplier_name') or '-'}</b></font>", styles['Normal']
        )]], colWidths=[sum(COL_W)])
        supplier_t.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 0.75, BLACK),
            ('LINEABOVE', (0, 0), (-1, 0), 0, colors.white),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ]))
        elems.append(supplier_t)

        # ===== Tabela principal: Equipamento/Solicitante/Quantidade/Produto/Preço/Total =====
        cell_style = ParagraphStyle('Cell', parent=styles['Normal'], fontSize=7.5, alignment=TA_CENTER)
        header_row = [Paragraph(f"<b>{h}</b>", cell_style) for h in
                     ['Equipamento', 'Solicitante', 'Quantidade', 'Produto', 'Preço', 'Total']]
        data_row = [
            Paragraph(order.get('equipment_plate') or '-', cell_style),
            Paragraph(order.get('requester') or '-', cell_style),
            Paragraph(f"{liters:.2f}".replace('.', ',') if liters is not None else '-', cell_style),
            Paragraph(_FUEL_TYPE_LABELS.get(order.get('fuel_type'), order.get('fuel_type')) or '-', cell_style),
            Paragraph(money(estimated_value) if estimated_value is not None else '-', cell_style),
            Paragraph(money(total_value) if has_total else '-', cell_style),
        ]
        main_t = Table([header_row, data_row], colWidths=COL_W, rowHeights=[16, 22])
        main_t.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 0.75, BLACK),
            ('INNERGRID', (0, 0), (-1, -1), 0.4, colors.grey),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        elems.append(main_t)

        # ===== Linha de total + valor por extenso =====
        extenso = _valor_por_extenso(total_value) if has_total and total_value else ''
        total_row_t = Table([[
            Paragraph("<font size='7.5'>Valor por extenso:</font>", styles['Normal']),
            Paragraph("<font size='7.5'><b>TOTAL</b></font>", ParagraphStyle('TotLbl', parent=styles['Normal'], alignment=TA_CENTER)),
            Paragraph(f"<font size='8'><b>{money(total_value) if has_total else '-'}</b></font>", ParagraphStyle('TotVal', parent=styles['Normal'], alignment=TA_CENTER)),
        ]], colWidths=[COL_W[0] + COL_W[1] + COL_W[2] + COL_W[3], COL_W[4], COL_W[5]])
        total_row_t.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 0.75, BLACK),
            ('LINEABOVE', (0, 0), (-1, 0), 0, colors.white),
            ('INNERGRID', (0, 0), (-1, -1), 0.4, colors.grey),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
            ('BACKGROUND', (1, 0), (2, 0), colors.HexColor('#F0F0F0')),
        ]))
        elems.append(total_row_t)

        if extenso:
            extenso_t = Table([[Paragraph(f"<b>{extenso}</b>",
                                          ParagraphStyle('Extenso', parent=styles['Normal'], fontSize=10, alignment=TA_CENTER))]],
                              colWidths=[sum(COL_W)])
            extenso_t.setStyle(TableStyle([
                ('BOX', (0, 0), (-1, -1), 0.75, BLACK),
                ('LINEABOVE', (0, 0), (-1, 0), 0, colors.white),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ]))
            elems.append(extenso_t)

        # ===== Campos manuais (azul) + observação livre =====
        manual_style = ParagraphStyle('Manual', parent=styles['Normal'], fontSize=8, leading=13, textColor=BLUE)
        obs_block = Table([[
            Paragraph("Data abastecimento:<br/>Km de abastecimento:<br/>Quantidade em litros:<br/>"
                     "Km último abastecimento:<br/>Média:", manual_style),
            Paragraph(f"<font size='8'>OBS: <b>{(order.get('observations') or '').replace(chr(10), '<br/>')}</b></font>",
                     styles['Normal']),
        ]], colWidths=[COL_W[0] + COL_W[1] + COL_W[2], COL_W[3] + COL_W[4] + COL_W[5]])
        obs_block.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 0.75, BLACK),
            ('INNERGRID', (0, 0), (-1, -1), 0.4, colors.grey),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ]))
        elems.append(obs_block)

        elems.append(Paragraph(
            "<font size='7.5'><b><i>OBS: Favor anexar esta via junto com a nota fiscal que será enviada "
            "para cobrança. Obrigado.</i></b></font>",
            ParagraphStyle('Note', parent=styles['Normal'], spaceBefore=3)
        ))
        elems.append(Spacer(1, 10))

        # ===== Assinaturas (só o rótulo, espaço em branco acima) =====
        sig_t = Table([
            [Paragraph("<font size='8'>Assinatura do Solicitante</font>", styles['Normal']),
             Paragraph("<font size='8'>Assinatura do Solicitado</font>", styles['Normal'])],
        ], colWidths=[sum(COL_W) / 2, sum(COL_W) / 2], rowHeights=[10])
        sig_t.setStyle(TableStyle([
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
