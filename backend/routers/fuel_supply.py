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
