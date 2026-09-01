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

# ========== VISTORIA DE CONTAINER ==========

@api_router.get("/container-inspections")
async def list_container_inspections(
    page: int = 1,
    per_page: int = 20,
    current_user: dict = Depends(get_current_active_user)
):
    """Lista todas as vistorias de container"""
    skip = (page - 1) * per_page
    
    total = await db.container_inspections.count_documents({})
    inspections = await db.container_inspections.find({}, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page).to_list(per_page)
    inspections = [migrate_inspection_photos(i) for i in inspections]

    return {
        "items": inspections,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page
    }

@api_router.get("/container-inspections/{inspection_id}", response_model=ContainerInspectionResponse)
async def get_container_inspection(inspection_id: str, current_user: dict = Depends(get_current_active_user)):
    """Obtém uma vistoria de container pelo ID"""
    inspection = await db.container_inspections.find_one({"id": inspection_id}, {"_id": 0})
    if not inspection:
        raise HTTPException(status_code=404, detail="Vistoria de container não encontrada")
    return ContainerInspectionResponse(**migrate_inspection_photos(inspection))

@api_router.post("/container-inspections", response_model=ContainerInspectionResponse)
async def create_container_inspection(
    data: ContainerInspectionCreate,
    current_user: dict = Depends(get_current_active_user)
):
    """Cria uma nova vistoria de container"""
    # Gerar número sequencial
    counter = await db.counters.find_one_and_update(
        {"_id": "inspection_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    inspection_number = counter["seq"]
    
    # Buscar nomes de cliente e armador
    client_name = None
    shipping_line_name = None
    
    if data.client_id:
        client = await db.clients.find_one({"id": data.client_id}, {"_id": 0, "name": 1})
        client_name = client.get("name") if client else None
    
    if data.shipping_line_id:
        shipping_line = await db.shipping_lines.find_one({"id": data.shipping_line_id}, {"_id": 0, "name": 1})
        shipping_line_name = shipping_line.get("name") if shipping_line else None
    
    inspection = ContainerInspection(
        inspection_number=inspection_number,
        container_number=data.container_number,
        container_seal=data.container_seal,
        size_type=data.size_type,
        collection_terminal=data.collection_terminal,
        origin_terminal=data.origin_terminal,
        booking=data.booking,
        client_id=data.client_id,
        client_name=client_name,
        shipping_line_id=data.shipping_line_id,
        shipping_line_name=shipping_line_name,
        observations=data.observations,
        no_damage=data.no_damage,
        damage_items=data.damage_items,
        created_by=current_user["sub"],
        created_by_name=current_user["name"]
    )

    inspection_dict = inspection.model_dump()
    inspection_dict["created_at"] = inspection_dict["created_at"].isoformat()
    
    await db.container_inspections.insert_one(inspection_dict)
    
    return ContainerInspectionResponse(**inspection_dict)

@api_router.put("/container-inspections/{inspection_id}", response_model=ContainerInspectionResponse)
async def update_container_inspection(
    inspection_id: str,
    data: ContainerInspectionUpdate,
    current_user: dict = Depends(get_current_active_user)
):
    """Atualiza uma vistoria de container"""
    inspection = await db.container_inspections.find_one({"id": inspection_id}, {"_id": 0})
    if not inspection:
        raise HTTPException(status_code=404, detail="Vistoria de container não encontrada")
    
    update_data = {}
    
    if data.container_number is not None:
        update_data["container_number"] = data.container_number
    
    if data.container_seal is not None:
        update_data["container_seal"] = data.container_seal

    if data.size_type is not None:
        update_data["size_type"] = data.size_type

    if data.collection_terminal is not None:
        update_data["collection_terminal"] = data.collection_terminal

    if data.origin_terminal is not None:
        update_data["origin_terminal"] = data.origin_terminal

    if data.booking is not None:
        update_data["booking"] = data.booking

    if data.observations is not None:
        update_data["observations"] = data.observations

    if data.no_damage is not None:
        update_data["no_damage"] = data.no_damage

    if data.damage_items is not None:
        update_data["damage_items"] = data.damage_items

    if data.client_id is not None:
        update_data["client_id"] = data.client_id
        if data.client_id:
            client = await db.clients.find_one({"id": data.client_id}, {"_id": 0, "name": 1})
            update_data["client_name"] = client.get("name") if client else None
        else:
            update_data["client_name"] = None
    
    if data.shipping_line_id is not None:
        update_data["shipping_line_id"] = data.shipping_line_id
        if data.shipping_line_id:
            shipping_line = await db.shipping_lines.find_one({"id": data.shipping_line_id}, {"_id": 0, "name": 1})
            update_data["shipping_line_name"] = shipping_line.get("name") if shipping_line else None
        else:
            update_data["shipping_line_name"] = None
    
    if update_data:
        update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.container_inspections.update_one({"id": inspection_id}, {"$set": update_data})
    
    updated = await db.container_inspections.find_one({"id": inspection_id}, {"_id": 0})
    return ContainerInspectionResponse(**migrate_inspection_photos(updated))

@api_router.post("/container-inspections/{inspection_id}/upload-photo")
async def upload_container_inspection_photo(
    inspection_id: str,
    photo_type: str = Query(..., alias="type", regex="^(front|back|left|right|internal)$"),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_active_user)
):
    """Faz upload de uma foto para uma vistoria de container (até 8 fotos, cada uma com um tipo)"""
    inspection = await db.container_inspections.find_one({"id": inspection_id}, {"_id": 0})
    if not inspection:
        raise HTTPException(status_code=404, detail="Vistoria de container não encontrada")

    inspection = migrate_inspection_photos(inspection)
    if len(inspection["photos"]) >= MAX_CONTAINER_INSPECTION_PHOTOS:
        raise HTTPException(status_code=400, detail=f"Limite de {MAX_CONTAINER_INSPECTION_PHOTOS} fotos por vistoria atingido")

    file_ext, content = await validate_and_read_upload(file, ALLOWED_EXTENSIONS)

    # Criar diretório
    photo_dir = UPLOADS_DIR / "container_inspections" / inspection_id
    photo_dir.mkdir(parents=True, exist_ok=True)

    # Salvar arquivo
    photo_id = str(uuid.uuid4())
    file_path = photo_dir / f"{photo_id}{file_ext}"

    with open(file_path, "wb") as buffer:
        buffer.write(content)

    # Atualizar banco
    photo_url = f"/api/uploads/container_inspections/{inspection_id}/{photo_id}{file_ext}"
    photo_entry = {"id": photo_id, "type": photo_type, "url": photo_url}
    await db.container_inspections.update_one(
        {"id": inspection_id},
        {
            "$set": {"photos": inspection["photos"] + [photo_entry], "updated_at": datetime.now(timezone.utc).isoformat()}
        }
    )

    return photo_entry

@api_router.delete("/container-inspections/{inspection_id}/photo/{photo_id}")
async def delete_container_inspection_photo(
    inspection_id: str,
    photo_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Remove uma foto de uma vistoria de container"""
    inspection = await db.container_inspections.find_one({"id": inspection_id}, {"_id": 0})
    if not inspection:
        raise HTTPException(status_code=404, detail="Vistoria de container não encontrada")

    inspection = migrate_inspection_photos(inspection)
    remaining_photos = [p for p in inspection["photos"] if p["id"] != photo_id]
    if len(remaining_photos) == len(inspection["photos"]):
        raise HTTPException(status_code=404, detail="Foto não encontrada")

    # Remover arquivo
    photo_dir = UPLOADS_DIR / "container_inspections" / inspection_id
    for file_path in photo_dir.glob(f"{photo_id}.*"):
        file_path.unlink()

    # Atualizar banco
    await db.container_inspections.update_one(
        {"id": inspection_id},
        {"$set": {"photos": remaining_photos, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )

    return {"message": "Foto removida com sucesso"}

@api_router.delete("/container-inspections/{inspection_id}")
async def delete_container_inspection(
    inspection_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Exclui uma vistoria de container"""
    inspection = await db.container_inspections.find_one({"id": inspection_id}, {"_id": 0})
    if not inspection:
        raise HTTPException(status_code=404, detail="Vistoria de container não encontrada")
    
    # Remover diretório de fotos
    try:
        photo_dir = UPLOADS_DIR / "container_inspections" / inspection_id
        if photo_dir.exists():
            shutil.rmtree(photo_dir)
    except Exception:
        pass
    
    await db.container_inspections.delete_one({"id": inspection_id})
    
    return {"message": "Vistoria de container excluída com sucesso"}

