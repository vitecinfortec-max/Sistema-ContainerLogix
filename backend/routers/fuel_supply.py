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
    DailyFuelSupplyPoint,
    TankSettings, TankSettingsUpdate, TankRefill, TankRefillCreate, TankRefillResponse,
)
from auth import get_password_hash, verify_password, create_access_token, get_current_user, decode_token
from reports import (
    generate_pdf_report, generate_excel_report, generate_billing_pdf_report, generate_billing_excel,
    generate_fuel_supply_report_pdf, generate_fuel_supply_report_excel,
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


async def _compute_fuel_consumption_pairs() -> list:
    """Calcula a média (km/L) de cada par de abastecimentos consecutivos de um mesmo
    veículo (CAVALO/CAMINHÃO, ATIVO). Média do par = (KM do abastecimento atual - KM do
    anterior) / litros do abastecimento atual. Pares com KM igual/menor que o anterior
    (erro de digitação) ou sem litros são pulados - nunca gera média negativa/zero."""
    vehicles = await db.vehicles.find(
        {"vehicle_type": {"$in": ["CAVALO", "CAMINHÃO"]}, "status": "ATIVO"},
        {"_id": 0, "id": 1, "plate": 1, "model": 1}
    ).to_list(None)

    all_pairs = []
    for vehicle in vehicles:
        supplies = await db.fuel_supplies.find(
            {"equipment_id": vehicle["id"], "reading": {"$ne": None}},
            {"_id": 0, "id": 1, "supply_number": 1, "supply_date": 1, "created_at": 1, "reading": 1, "liters": 1}
        ).sort([("supply_date", 1), ("created_at", 1)]).to_list(None)

        for i in range(1, len(supplies)):
            prev, curr = supplies[i - 1], supplies[i]
            prev_reading, curr_reading = prev.get("reading"), curr.get("reading")
            liters = curr.get("liters") or 0
            if prev_reading is None or curr_reading is None:
                continue
            if curr_reading <= prev_reading or liters <= 0:
                continue
            km_traveled = curr_reading - prev_reading
            all_pairs.append({
                "vehicle_id": vehicle["id"],
                "vehicle_plate": vehicle.get("plate"),
                "vehicle_model": vehicle.get("model"),
                "supply_id": curr["id"],
                "supply_number": curr.get("supply_number"),
                "supply_date": curr.get("supply_date"),
                "previous_reading": prev_reading,
                "current_reading": curr_reading,
                "km_traveled": km_traveled,
                "liters": liters,
                "average": round(km_traveled / liters, 2),
            })

    all_pairs.sort(key=lambda p: (p["supply_date"] or "", p["supply_number"] or 0), reverse=True)
    return all_pairs


@api_router.get("/fuel-supplies/consumption-summary")
async def get_fuel_consumption_summary(current_user: dict = Depends(get_current_active_user)):
    """Média atual (km/L) de cada veículo - a do par de abastecimentos mais recente -
    pra Seção 'Média Atual por Veículo' do Controle de Média."""
    pairs = await _compute_fuel_consumption_pairs()
    by_vehicle = {}
    for p in pairs:
        vid = p["vehicle_id"]
        if vid not in by_vehicle:
            by_vehicle[vid] = {
                "vehicle_id": p["vehicle_id"],
                "vehicle_plate": p["vehicle_plate"],
                "vehicle_model": p["vehicle_model"],
                "current_average": p["average"],
                "last_supply_date": p["supply_date"],
                "pair_count": 0,
            }
        by_vehicle[vid]["pair_count"] += 1
    return list(by_vehicle.values())


@api_router.get("/fuel-supplies/consumption-history")
async def get_fuel_consumption_history(
    vehicle_plate: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    """Lista de todos os pares de abastecimento já calculados, mais recente primeiro."""
    pairs = await _compute_fuel_consumption_pairs()
    if vehicle_plate:
        regex = re.compile(re.escape(vehicle_plate.upper()), re.IGNORECASE)
        pairs = [p for p in pairs if regex.search(p["vehicle_plate"] or "")]
    return pairs


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


_FUEL_SUPPLY_FUEL_TYPE_LABELS = {
    "DIESEL_S10": "Diesel S10", "DIESEL_S500": "Diesel S500",
    "GASOLINA_COMUM": "Gasolina Comum", "GASOLINA_ADITIVADA": "Gasolina Aditivada",
    "ETANOL": "Etanol", "ARLA_32": "Arla 32", "GNV": "GNV", "OUTRO": "Outro",
}


async def _filter_fuel_supplies(
    date_from: Optional[str], date_to: Optional[str],
    equipment_plate: Optional[str], supplier_name: Optional[str], fuel_type: Optional[str],
) -> list:
    """Consulta db.fuel_supplies com os mesmos filtros usados pelo Relatório
    de Abastecimento (resumo, gráfico diário, PDF e Excel), sempre a partir
    de supply_date (data real do abastecimento, não created_at)."""
    query = {}
    if equipment_plate and equipment_plate != 'all':
        query['equipment_plate'] = equipment_plate
    if supplier_name and supplier_name != 'all':
        query['supplier_name'] = supplier_name
    if fuel_type and fuel_type != 'all':
        query['fuel_type'] = fuel_type
    if date_from or date_to:
        date_query = {}
        if date_from:
            date_query['$gte'] = date_from
        if date_to:
            date_query['$lte'] = date_to
        query['supply_date'] = date_query
    rows = await db.fuel_supplies.find(query, {"_id": 0}).sort("supply_date", -1).to_list(None)
    out = []
    for r in rows:
        calc = _fuel_calc(r)
        calc['fuel_type_label'] = _FUEL_SUPPLY_FUEL_TYPE_LABELS.get(calc.get('fuel_type'), calc.get('fuel_type'))
        out.append(calc)
    return out


@api_router.get("/reports/fuel-supply/summary")
async def get_fuel_supply_report_summary(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    equipment_plate: Optional[str] = None, supplier_name: Optional[str] = None, fuel_type: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    rows = await _filter_fuel_supplies(date_from, date_to, equipment_plate, supplier_name, fuel_type)
    total_liters = round(sum(r.get('liters') or 0 for r in rows), 2)
    total_value = round(sum(r.get('total_value') or 0 for r in rows), 2)
    return {
        "count": len(rows),
        "total_liters": total_liters,
        "total_value": total_value,
        "avg_price_per_liter": round(total_value / total_liters, 2) if total_liters else 0,
    }


async def _compute_daily_fuel_supply_chart(today: datetime) -> List[DailyFuelSupplyPoint]:
    """Valor/litros abastecidos por dia dos últimos 14 dias (por supply_date,
    a data real do abastecimento) - mesma estratégia de agregação em janela
    fixa usada em movements.py's _compute_daily_billing_chart."""
    day0 = (today - timedelta(days=13)).strftime('%Y-%m-%d')
    rows = await db.fuel_supplies.find({"supply_date": {"$gte": day0}}, {"_id": 0}).to_list(None)
    by_day: dict = {}
    for r in rows:
        day_key = r.get('supply_date')
        if not day_key:
            continue
        calc = _fuel_calc(r)
        entry = by_day.setdefault(day_key, {"value": 0.0, "liters": 0.0})
        entry["value"] += calc.get('total_value') or 0
        entry["liters"] += float(r.get('liters') or 0)

    daily_chart = []
    for i in range(13, -1, -1):
        day_key = (today - timedelta(days=i)).strftime('%Y-%m-%d')
        totals = by_day.get(day_key, {})
        daily_chart.append(DailyFuelSupplyPoint(
            date=day_key,
            total_value=round(totals.get('value', 0), 2),
            total_liters=round(totals.get('liters', 0), 2),
        ))
    return daily_chart


@api_router.get("/reports/fuel-supply/daily-chart", response_model=List[DailyFuelSupplyPoint])
async def get_fuel_supply_daily_chart(current_user: dict = Depends(get_current_admin_user)):
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return await _compute_daily_fuel_supply_chart(today)


@api_router.get("/reports/fuel-supply/pdf")
async def download_fuel_supply_report_pdf(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    equipment_plate: Optional[str] = None, supplier_name: Optional[str] = None, fuel_type: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    rows = await _filter_fuel_supplies(date_from, date_to, equipment_plate, supplier_name, fuel_type)
    company = await get_company_settings()
    pdf_buffer = generate_fuel_supply_report_pdf(rows, company=company)
    return StreamingResponse(
        io.BytesIO(pdf_buffer),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=relatorio_abastecimento.pdf"}
    )


@api_router.get("/reports/fuel-supply/excel")
async def download_fuel_supply_report_excel(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    equipment_plate: Optional[str] = None, supplier_name: Optional[str] = None, fuel_type: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    rows = await _filter_fuel_supplies(date_from, date_to, equipment_plate, supplier_name, fuel_type)
    company = await get_company_settings()
    excel_buffer = generate_fuel_supply_report_excel(rows, company=company)
    return StreamingResponse(
        io.BytesIO(excel_buffer),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=relatorio_abastecimento.xlsx"}
    )


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
    # Abastecimentos lançados antes do vínculo fuel_supply_order_id existir só têm o texto livre
    # "Nº X" em supply_order - sem isso, ordens antigas já usadas voltariam a aparecer como disponíveis.
    launched_order_texts = set(await db.fuel_supplies.distinct("supply_order", {"supply_order": {"$ne": None}}))
    for r in rows:
        r["is_launched"] = r["id"] in launched_ids or f"Nº {r['order_number']}" in launched_order_texts
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
    """Gera PDF da Ordem de Abastecimento (2 vias na mesma página, com linha
    de corte) no padrão visual dos documentos do sistema - cabeçalho padrão
    na versão compacta pra as duas vias caberem numa folha."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from reports import (
        download_logo, _build_pdf_header, _pdf_info_grid, _pdf_header_cells, _pdf_table_style,
        _pdf_signatures, _hex, BRAND_LINE, BRAND_MUTED, BRAND_TEXT,
    )

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
        topMargin=12 * mm, bottomMargin=10 * mm
    )
    styles = getSampleStyleSheet()
    WIDTH = doc.width

    def build_via():
        elems = []

        # ========== CABEÇALHO (padrão, versão compacta) ==========
        elems.extend(_build_pdf_header(
            styles, download_logo(company), f"Ordem de Abastecimento Nº {order['order_number']}",
            company=company, content_width=WIDTH, compact=True,
        ))

        # ========== DADOS DO ABASTECIMENTO ==========
        order_date_str = fmt_date(order.get('order_date')) or fmt_dt(order.get('created_at'))
        elems.append(_pdf_info_grid([
            ("Data", order_date_str or '-'),
            ("Equipamento", order.get('equipment_plate') or '-'),
            ("Produto", _FUEL_TYPE_LABELS.get(order.get('fuel_type'), order.get('fuel_type')) or '-'),
            ("Solicitante", order.get('requester') or '-'),
            ("Fornecedor", order.get('supplier_name') or '-', 4),
        ], WIDTH, cols=4))
        elems.append(Spacer(1, 5))

        # ========== QUANTIDADE E VALOR ==========
        value_style = ParagraphStyle('FSOValue', parent=styles['Normal'], fontSize=9.5, fontName='Helvetica-Bold', alignment=TA_CENTER, textColor=_hex(BRAND_TEXT))
        items_table = Table([
            _pdf_header_cells(['Quantidade (L)', 'Preço unit.', 'Total'], font_size=7.5),
            [
                Paragraph(f"{liters:.2f}".replace('.', ',') if liters is not None else '-', value_style),
                Paragraph(f"R$ {money(estimated_value)}" if estimated_value is not None else '-', value_style),
                Paragraph(f"R$ {money(total_value)}" if has_total else '-', value_style),
            ],
        ], colWidths=[WIDTH / 3] * 3)
        items_table.setStyle(TableStyle(_pdf_table_style(zebra=False) + [
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ('LINEBELOW', (0, -1), (-1, -1), 0.6, _hex(BRAND_LINE)),
        ]))
        elems.append(items_table)

        extenso = _valor_por_extenso(total_value) if has_total and total_value else ''
        if extenso:
            elems.append(Paragraph(
                f"<font color='#{BRAND_MUTED}'>Valor por extenso:</font> <b>{extenso}</b>",
                ParagraphStyle('Extenso', parent=styles['Normal'], fontSize=7.5, alignment=TA_CENTER, textColor=_hex(BRAND_TEXT), spaceBefore=3, spaceAfter=4),
            ))
        else:
            elems.append(Spacer(1, 5))

        # ========== DADOS PARA CONFERÊNCIA (preenchimento manual) + OBSERVAÇÃO ==========
        manual_style = ParagraphStyle('Manual', parent=styles['Normal'], fontSize=7.5, leading=10, fontName='Helvetica', textColor=_hex(BRAND_TEXT))
        obs_style = ParagraphStyle('ObsCell', parent=styles['Normal'], fontSize=7.5, leading=9.5, fontName='Helvetica', textColor=_hex(BRAND_TEXT))
        obs_block = Table([[
            Paragraph("Data abastecimento:<br/>Km de abastecimento:<br/>Quantidade em litros:<br/>"
                      "Km último abastecimento:<br/>Média:", manual_style),
            Paragraph(f"<b>OBS:</b> {(order.get('observations') or '').replace(chr(10), '<br/>')}", obs_style),
        ]], colWidths=[WIDTH / 2, WIDTH / 2])
        obs_block.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), _hex('F8FAFC')),
            ('BOX', (0, 0), (-1, -1), 0.6, _hex(BRAND_LINE)),
            ('INNERGRID', (0, 0), (-1, -1), 0.6, _hex(BRAND_LINE)),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ]))
        elems.append(obs_block)
        elems.append(Paragraph(
            "Favor anexar esta via junto com a nota fiscal que será enviada para cobrança. Obrigado.",
            ParagraphStyle('Note', parent=styles['Normal'], fontSize=6.5, fontName='Helvetica-Oblique',
                           textColor=_hex(BRAND_MUTED), leading=8, spaceBefore=2)
        ))

        # ========== ASSINATURAS ==========
        elems.append(_pdf_signatures(["Assinatura do Solicitante", "Assinatura do Solicitado"], WIDTH, space_above=18))

        # ========== RODAPÉ ==========
        footer_style = ParagraphStyle('Footer', parent=styles['Normal'], fontSize=6.5,
                                      textColor=_hex(BRAND_MUTED), alignment=TA_CENTER, leading=8)
        elems.append(Spacer(1, 3))
        elems.append(Paragraph(
            f"Criado por {order.get('created_by_name') or '-'} em {fmt_dt(order.get('created_at'))}  ·  "
            f"Impresso por {current_user.get('name') or '-'} em {now_brt().strftime('%d/%m/%Y %H:%M')}  ·  "
            f"ContainerLogix - {company['name']}", footer_style
        ))
        return elems

    elements = build_via()
    elements.append(Spacer(1, 6))
    elements.append(HRFlowable(width="100%", thickness=0.75, color=colors.HexColor('#94A3B8'),
                               dash=(4, 3), spaceBefore=0, spaceAfter=0))
    elements.append(Paragraph(
        "&#9986;  corte aqui  &#9986;",
        ParagraphStyle('CutLine', parent=styles['Normal'], fontSize=6.5, textColor=colors.HexColor('#94A3B8'),
                       alignment=TA_CENTER, spaceBefore=1, spaceAfter=1)
    ))
    elements.append(HRFlowable(width="100%", thickness=0.75, color=colors.HexColor('#94A3B8'),
                               dash=(4, 3), spaceBefore=0, spaceAfter=0))
    elements.append(Spacer(1, 8))
    elements += build_via()

    doc.build(elements)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    filename = f"OrdemAbastecimento_{order['order_number']}.pdf"
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})


# ==================== FROTA - TANQUE PRÓPRIO ====================

async def _compute_tank_level() -> Optional[dict]:
    """Calcula o nível atual do tanque próprio: soma dos Reabastecimentos
    (entradas) menos soma dos Abastecimentos com source=TANQUE_PROPRIO
    (saídas). Retorna None se o tanque ainda não foi configurado."""
    settings = await db.tank_settings.find_one({}, {"_id": 0})
    if not settings:
        return None

    refills = await db.tank_refills.find({}, {"_id": 0, "liters": 1}).to_list(None)
    total_in = sum(r.get("liters") or 0 for r in refills)

    supplies = await db.fuel_supplies.find(
        {"source": "TANQUE_PROPRIO"}, {"_id": 0, "liters": 1}
    ).to_list(None)
    total_out = sum(s.get("liters") or 0 for s in supplies)

    current_liters = total_in - total_out
    capacity = settings["capacity_liters"]
    minimum = settings["minimum_alert_liters"]
    percentage = round(max(0, min(100, (current_liters / capacity) * 100)), 1) if capacity > 0 else 0

    return {
        "configured": True,
        "capacity_liters": capacity,
        "minimum_alert_liters": minimum,
        "current_liters": round(current_liters, 2),
        "percentage": percentage,
        "status": "LOW" if current_liters <= minimum else "OK",
    }


@api_router.get("/tank-settings")
async def get_tank_settings(current_user: dict = Depends(get_current_active_user)):
    settings = await db.tank_settings.find_one({}, {"_id": 0})
    return settings or {"capacity_liters": None, "minimum_alert_liters": None}


@api_router.put("/tank-settings")
async def update_tank_settings(data: TankSettingsUpdate, current_user: dict = Depends(get_current_admin_user)):
    """Define a capacidade e o alerta mínimo do tanque próprio. Restrito a administradores."""
    settings = TankSettings(**data.model_dump())
    doc = settings.model_dump()
    doc["updated_at"] = doc["updated_at"].isoformat()
    await db.tank_settings.replace_one({}, doc, upsert=True)
    return doc


@api_router.get("/tank-level")
async def get_tank_level_route(current_user: dict = Depends(get_current_active_user)):
    """Nível atual do tanque, pro medidor visual de 'Nível do Tanque'."""
    level = await _compute_tank_level()
    return level or {"configured": False}


@api_router.get("/tank-ledger")
async def get_tank_ledger(current_user: dict = Depends(get_current_active_user)):
    """Histórico combinado de Reabastecimentos (ENTRADA) e Abastecimentos do
    Tanque Próprio (SAÍDA), mais recente primeiro - mesmo espírito de merge
    já usado em GET /odometer-readings."""
    refills = await db.tank_refills.find({}, {"_id": 0}).to_list(None)
    entradas = [{
        "type": "ENTRADA",
        "id": r["id"],
        "date": r.get("refill_date"),
        "liters": r.get("liters"),
        "label": r.get("supplier_name") or "-",
        "reference_number": r.get("refill_number"),
        "observations": r.get("observations"),
        "created_at": r.get("created_at"),
    } for r in refills]

    supplies = await db.fuel_supplies.find(
        {"source": "TANQUE_PROPRIO"},
        {"_id": 0, "id": 1, "supply_number": 1, "supply_date": 1, "liters": 1,
         "equipment_plate": 1, "observations": 1, "created_at": 1}
    ).to_list(None)
    saidas = [{
        "type": "SAIDA",
        "id": s["id"],
        "date": s.get("supply_date"),
        "liters": s.get("liters"),
        "label": s.get("equipment_plate") or "-",
        "reference_number": s.get("supply_number"),
        "observations": s.get("observations"),
        "created_at": s.get("created_at"),
    } for s in supplies]

    combined = entradas + saidas
    combined.sort(key=lambda x: (x.get("date") or "", x.get("created_at") or ""), reverse=True)
    return combined


@api_router.post("/tank-refills", response_model=TankRefillResponse)
async def create_tank_refill(data: TankRefillCreate, current_user: dict = Depends(get_current_active_user)):
    counter = await db.counters.find_one_and_update(
        {"_id": "tank_refill_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    refill_number = counter["seq"]

    refill = TankRefill(
        refill_number=refill_number,
        refill_date=data.refill_date,
        liters=data.liters,
        supplier_name=data.supplier_name,
        observations=data.observations,
        created_by=current_user["sub"],
        created_by_name=current_user["name"]
    )

    refill_dict = refill.model_dump()
    refill_dict["created_at"] = refill_dict["created_at"].isoformat()

    await db.tank_refills.insert_one(refill_dict)
    refill_dict.pop('_id', None)

    return TankRefillResponse(**refill_dict)


@api_router.delete("/tank-refills/{refill_id}")
async def delete_tank_refill(refill_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.tank_refills.delete_one({"id": refill_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Reabastecimento não encontrado")
    return {"message": "Reabastecimento excluído com sucesso"}
