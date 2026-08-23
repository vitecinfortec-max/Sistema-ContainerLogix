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

# ===== REGISTRO FOTOGRÁFICO =====

async def get_next_registry_number():
    """Obtém o próximo registry_number usando um contador atômico"""
    result = await db.counters.find_one_and_update(
        {"_id": "registry_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    return result["seq"]

@api_router.get("/photo-registries")
async def list_photo_registries(
    page: int = 1,
    page_size: int = 20,
    search: Optional[str] = None,
    client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    """Lista registros fotográficos com paginação"""
    query = {}
    
    if search:
        search_escaped = re.escape(search)
        query["$or"] = [
            {"container_number": {"$regex": search_escaped, "$options": "i"}},
            {"booking": {"$regex": search_escaped, "$options": "i"}},
            {"client_name": {"$regex": search_escaped, "$options": "i"}},
        ]
    
    if client_id:
        query["client_id"] = client_id
    
    total = await db.photo_registries.count_documents(query)
    skip = (page - 1) * page_size
    
    registries = await db.photo_registries.find(
        query, {"_id": 0}
    ).sort("created_at", -1).skip(skip).limit(page_size).to_list(page_size)
    
    return {
        "items": registries,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size
    }

@api_router.get("/photo-registries/{registry_id}", response_model=PhotoRegistryResponse)
async def get_photo_registry(registry_id: str, current_user: dict = Depends(get_current_active_user)):
    """Obtém um registro fotográfico específico"""
    registry = await db.photo_registries.find_one({"id": registry_id}, {"_id": 0})
    if not registry:
        raise HTTPException(status_code=404, detail="Registro fotográfico não encontrado")
    return PhotoRegistryResponse(**registry)

@api_router.post("/photo-registries", response_model=PhotoRegistryResponse)
async def create_photo_registry(
    data: PhotoRegistryCreate,
    current_user: dict = Depends(get_current_active_user)
):
    """Cria um novo registro fotográfico"""
    registry_number = await get_next_registry_number()
    
    # Buscar nome do cliente se informado
    client_name = None
    if data.client_id:
        client = await db.clients.find_one({"id": data.client_id}, {"_id": 0, "name": 1})
        if client:
            client_name = client.get("name")
    
    # Buscar nome do armador se informado
    shipping_line_name = None
    if data.shipping_line_id:
        shipping_line = await db.shipping_lines.find_one({"id": data.shipping_line_id}, {"_id": 0, "name": 1})
        if shipping_line:
            shipping_line_name = shipping_line.get("name")
    
    registry = PhotoRegistry(
        registry_number=registry_number,
        container_number=data.container_number,
        container_seal=data.container_seal,
        collection_terminal=data.collection_terminal,
        booking=data.booking,
        client_id=data.client_id,
        client_name=client_name,
        shipping_line_id=data.shipping_line_id,
        shipping_line_name=shipping_line_name,
        created_by=current_user["sub"],
        created_by_name=current_user["name"]
    )
    
    registry_dict = registry.model_dump()
    registry_dict["created_at"] = registry_dict["created_at"].isoformat()
    
    await db.photo_registries.insert_one(registry_dict)
    
    return PhotoRegistryResponse(**registry_dict)

@api_router.put("/photo-registries/{registry_id}", response_model=PhotoRegistryResponse)
async def update_photo_registry(
    registry_id: str,
    data: PhotoRegistryUpdate,
    current_user: dict = Depends(get_current_active_user)
):
    """Atualiza um registro fotográfico"""
    registry = await db.photo_registries.find_one({"id": registry_id}, {"_id": 0})
    if not registry:
        raise HTTPException(status_code=404, detail="Registro fotográfico não encontrado")
    
    update_data = {}
    
    if data.container_number is not None:
        update_data["container_number"] = data.container_number
    
    if data.container_seal is not None:
        update_data["container_seal"] = data.container_seal
    
    if data.collection_terminal is not None:
        update_data["collection_terminal"] = data.collection_terminal
    
    if data.booking is not None:
        update_data["booking"] = data.booking
    
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
        await db.photo_registries.update_one({"id": registry_id}, {"$set": update_data})
    
    updated = await db.photo_registries.find_one({"id": registry_id}, {"_id": 0})
    return PhotoRegistryResponse(**updated)

@api_router.post("/photo-registries/{registry_id}/upload-photo")
async def upload_photo_registry_photo(
    registry_id: str,
    position: str,  # front, back, left, right
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_active_user)
):
    """Upload de foto para um registro fotográfico"""
    if position not in ["front", "back", "left", "right"]:
        raise HTTPException(status_code=400, detail="Posição inválida. Use: front, back, left, right")
    
    registry = await db.photo_registries.find_one({"id": registry_id}, {"_id": 0})
    if not registry:
        raise HTTPException(status_code=404, detail="Registro fotográfico não encontrado")
    
    # Criar diretório para fotos de registro
    photo_dir = UPLOADS_DIR / "photo_registries" / registry_id
    photo_dir.mkdir(parents=True, exist_ok=True)
    
    # Gerar nome do arquivo
    file_ext = Path(file.filename).suffix.lower() if file.filename else ".jpg"
    if file_ext not in [".jpg", ".jpeg", ".png", ".webp"]:
        file_ext = ".jpg"
    
    filename = f"{position}{file_ext}"
    file_path = photo_dir / filename
    
    # Salvar arquivo
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # URL relativa do arquivo
    photo_url = f"/api/uploads/photo_registries/{registry_id}/{filename}"
    
    # Atualizar registro no banco
    field_name = f"photo_{position}"
    await db.photo_registries.update_one(
        {"id": registry_id},
        {"$set": {field_name: photo_url, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {"url": photo_url, "position": position}

@api_router.delete("/photo-registries/{registry_id}/photo/{position}")
async def delete_photo_registry_photo(
    registry_id: str,
    position: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Remove uma foto de um registro fotográfico"""
    if position not in ["front", "back", "left", "right"]:
        raise HTTPException(status_code=400, detail="Posição inválida")
    
    registry = await db.photo_registries.find_one({"id": registry_id}, {"_id": 0})
    if not registry:
        raise HTTPException(status_code=404, detail="Registro fotográfico não encontrado")
    
    field_name = f"photo_{position}"
    photo_url = registry.get(field_name)
    
    if photo_url:
        # Tentar remover arquivo físico
        try:
            file_path = UPLOADS_DIR / photo_url.replace("/api/uploads/", "")
            if file_path.exists():
                file_path.unlink()
        except Exception:
            pass
        
        # Remover referência do banco
        await db.photo_registries.update_one(
            {"id": registry_id},
            {"$set": {field_name: None, "updated_at": datetime.now(timezone.utc).isoformat()}}
        )
    
    return {"message": "Foto removida com sucesso"}

@api_router.delete("/photo-registries/{registry_id}")
async def delete_photo_registry(
    registry_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Exclui um registro fotográfico"""
    registry = await db.photo_registries.find_one({"id": registry_id}, {"_id": 0})
    if not registry:
        raise HTTPException(status_code=404, detail="Registro fotográfico não encontrado")
    
    # Remover diretório de fotos
    try:
        photo_dir = UPLOADS_DIR / "photo_registries" / registry_id
        if photo_dir.exists():
            shutil.rmtree(photo_dir)
    except Exception:
        pass
    
    await db.photo_registries.delete_one({"id": registry_id})
    
    return {"message": "Registro fotográfico excluído com sucesso"}

