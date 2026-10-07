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
    MAX_VEHICLE_CHECKLIST_PHOTOS, SIMPLE_CHECKLIST_TEMPLATES,
    VehicleRevision, VehicleRevisionCreate, VehicleRevisionResponse,
    OdometerReading, OdometerReadingCreate, OdometerReadingResponse,
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

# ==================== FROTA - CADASTRO DE VEÍCULOS ====================

from models import Vehicle, VehicleCreate, VehicleUpdate, VehicleResponse

@api_router.get("/vehicles")
async def get_vehicles(
    search: Optional[str] = None,
    vehicle_type: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    current_user: dict = Depends(get_current_active_user)
):
    """Lista todos os veículos cadastrados"""
    query = {}
    
    if search:
        search_escaped = re.escape(search)
        query["$or"] = [
            {"plate": {"$regex": search_escaped, "$options": "i"}},
            {"model": {"$regex": search_escaped, "$options": "i"}},
            {"brand": {"$regex": search_escaped, "$options": "i"}}
        ]
    
    if vehicle_type:
        query["vehicle_type"] = vehicle_type
    
    if status:
        query["status"] = status
    
    total = await db.vehicles.count_documents(query)
    skip = (page - 1) * per_page
    
    cursor = db.vehicles.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page)
    vehicles = await cursor.to_list(length=per_page)
    
    return {
        "items": vehicles,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page
    }


@api_router.get("/vehicles/{vehicle_id}", response_model=VehicleResponse)
async def get_vehicle(vehicle_id: str, current_user: dict = Depends(get_current_active_user)):
    """Busca veículo por ID"""
    vehicle = await db.vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    if not vehicle:
        raise HTTPException(status_code=404, detail="Veículo não encontrado")
    return vehicle


@api_router.post("/vehicles", response_model=VehicleResponse)
async def create_vehicle(data: VehicleCreate, current_user: dict = Depends(get_current_active_user)):
    """Cadastra novo veículo"""
    # Verificar se placa já existe
    existing = await db.vehicles.find_one({"plate": data.plate.upper()})
    if existing:
        raise HTTPException(status_code=400, detail="Placa já cadastrada")

    driver_name = None
    if data.driver_id:
        driver = await db.drivers.find_one({"id": data.driver_id}, {"_id": 0, "name": 1})
        if not driver:
            raise HTTPException(status_code=404, detail="Motorista não encontrado")
        driver_name = driver["name"]

    vehicle_data = {
        **data.model_dump(),
        "id": str(uuid.uuid4()),
        "plate": data.plate.upper(),
        "vehicle_type": data.vehicle_type.upper(),
        "status": data.status.upper(),
        "driver_name": driver_name,
        "created_by": current_user["sub"],
        "created_by_name": current_user.get("name", "Sistema"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": None
    }

    await db.vehicles.insert_one(vehicle_data)
    vehicle_data.pop("_id", None)

    return vehicle_data


@api_router.put("/vehicles/{vehicle_id}", response_model=VehicleResponse)
async def update_vehicle(vehicle_id: str, data: VehicleUpdate, current_user: dict = Depends(get_current_active_user)):
    """Atualiza veículo"""
    vehicle = await db.vehicles.find_one({"id": vehicle_id})
    if not vehicle:
        raise HTTPException(status_code=404, detail="Veículo não encontrado")
    
    update_data = data.model_dump(exclude_unset=True, exclude={"driver_id", "clear_driver"})
    update_data = {k: v for k, v in update_data.items() if v is not None}

    if data.plate is not None:
        # Verificar se placa já existe em outro veículo
        existing = await db.vehicles.find_one({"plate": data.plate.upper(), "id": {"$ne": vehicle_id}})
        if existing:
            raise HTTPException(status_code=400, detail="Placa já cadastrada em outro veículo")
        update_data["plate"] = data.plate.upper()
    if data.vehicle_type is not None:
        update_data["vehicle_type"] = data.vehicle_type.upper()
    if data.status is not None:
        update_data["status"] = data.status.upper()

    if data.clear_driver:
        update_data["driver_id"] = None
        update_data["driver_name"] = None
    elif data.driver_id is not None:
        driver = await db.drivers.find_one({"id": data.driver_id}, {"_id": 0, "name": 1})
        if not driver:
            raise HTTPException(status_code=404, detail="Motorista não encontrado")
        update_data["driver_id"] = data.driver_id
        update_data["driver_name"] = driver["name"]

    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.vehicles.update_one({"id": vehicle_id}, {"$set": update_data})
    
    updated = await db.vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    return updated


@api_router.delete("/vehicles/{vehicle_id}")
async def delete_vehicle(vehicle_id: str, current_user: dict = Depends(get_current_active_user)):
    """Exclui veículo"""
    vehicle = await db.vehicles.find_one({"id": vehicle_id})
    if not vehicle:
        raise HTTPException(status_code=404, detail="Veículo não encontrado")
    
    await db.vehicles.delete_one({"id": vehicle_id})
    return {"message": "Veículo excluído com sucesso"}


@api_router.get("/vehicles/types/list")
async def get_vehicle_types(current_user: dict = Depends(get_current_active_user)):
    """Lista tipos de veículos disponíveis"""
    return [
        {"value": "CAMINHÃO", "label": "Caminhão"},
        {"value": "CARRETA", "label": "Carreta"},
        {"value": "CAVALO", "label": "Cavalo Mecânico"},
        {"value": "EMPILHADEIRA", "label": "Empilhadeira"},
        {"value": "GUINDASTE", "label": "Guindaste"},
        {"value": "REACH_STACKER", "label": "Reach Stacker"},
        {"value": "EQUIPAMENTO", "label": "Outro Equipamento"},
    ]


# ==================== FROTA - CHECKLIST DE VEÍCULO (LVT) ====================

@api_router.get("/vehicle-checklists/template")
async def get_vehicle_checklist_template(current_user: dict = Depends(get_current_active_user)):
    """Retorna a lista fixa de itens do checklist, agrupados por seção"""
    return {
        "sections": [
            {"key": key, "label": VEHICLE_CHECKLIST_SECTION_LABELS[key], "items": items}
            for key, items in VEHICLE_CHECKLIST_TEMPLATE.items()
        ]
    }

@api_router.get("/vehicle-checklists/simple-template")
async def get_simple_vehicle_checklist_template(
    vehicle_type: str = Query(..., regex="^(CAMINHAO|CARRETA|CARRO)$"),
    current_user: dict = Depends(get_current_active_user)
):
    """Retorna as seções/itens de verificação do checklist simplificado pro tipo de veículo informado"""
    return {"sections": SIMPLE_CHECKLIST_TEMPLATES.get(vehicle_type, [])}

# O resultado do checklist (Aprovado/Reprovado/Pendente) não fica gravado: sai
# das respostas dos itens. Mesma regra de checklistResult() no frontend
# (components/checklist/checklistShared.js) - se mudar uma, mudar a outra.
_CHECKLIST_LEGACY_ITEM_FIELDS = [
    "documentos_items", "vehicle_condition_items", "epi_items",
    "kit_items", "tank_items", "post_loading_items",
]
# Só o necessário pra calcular o resultado (sem fotos nem o resto do documento)
_CHECKLIST_RESULT_PROJECTION = {
    "_id": 0, "id": 1, "checklist_sections.items.answer": 1,
    **{f"{field}.answer": 1 for field in _CHECKLIST_LEGACY_ITEM_FIELDS},
}


def vehicle_checklist_result(checklist: dict) -> str:
    """REPROVADO se algum item foi marcado NÃO, APROVADO se todos foram marcados SIM, senão PENDENTE"""
    answers = [
        item.get("answer")
        for field in _CHECKLIST_LEGACY_ITEM_FIELDS
        for item in (checklist.get(field) or [])
    ]
    answers += [
        item.get("answer")
        for section in (checklist.get("checklist_sections") or [])
        for item in (section.get("items") or [])
    ]
    if any(answer == "NAO" for answer in answers):
        return "REPROVADO"
    if answers and all(answer == "SIM" for answer in answers):
        return "APROVADO"
    return "PENDENTE"


def _vehicle_checklist_search_query(search: Optional[str]) -> dict:
    if not search:
        return {}
    search_escaped = re.escape(search)
    return {"$or": [
        {field: {"$regex": search_escaped, "$options": "i"}}
        for field in ("cavalo_plate", "vehicle_plate", "driver_name", "vistoriador_name", "client_name")
    ]}


@api_router.get("/vehicle-checklists/stats")
async def get_vehicle_checklist_stats(
    search: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    """Quantos checklists há em cada resultado (dentro da busca, se houver) - indicadores do topo da tela"""
    docs = await db.vehicle_checklists.find(_vehicle_checklist_search_query(search), _CHECKLIST_RESULT_PROJECTION).to_list(None)
    counts = {"APROVADO": 0, "REPROVADO": 0, "PENDENTE": 0}
    for doc in docs:
        counts[vehicle_checklist_result(doc)] += 1
    return {
        "total": len(docs),
        "approved": counts["APROVADO"],
        "failed": counts["REPROVADO"],
        "pending": counts["PENDENTE"],
    }

@api_router.get("/vehicle-checklists")
async def get_vehicle_checklists(
    search: Optional[str] = None,
    result: Optional[str] = Query(None, regex="^(APROVADO|REPROVADO|PENDENTE)$"),
    page: int = 1,
    per_page: int = 20,
    current_user: dict = Depends(get_current_active_user)
):
    """Lista os checklists de veículo com paginação, busca por placa/motorista/vistoriador/cliente e filtro por resultado"""
    query = _vehicle_checklist_search_query(search)
    skip = (page - 1) * per_page

    if result:
        # Como o resultado é calculado, confere todos os que batem com a busca
        # (só com as respostas) e depois busca os documentos da página
        docs = await db.vehicle_checklists.find(query, _CHECKLIST_RESULT_PROJECTION).sort("checklist_number", -1).to_list(None)
        matching_ids = [doc["id"] for doc in docs if vehicle_checklist_result(doc) == result]
        total = len(matching_ids)
        page_ids = matching_ids[skip:skip + per_page]
        found = await db.vehicle_checklists.find({"id": {"$in": page_ids}}, {"_id": 0}).to_list(len(page_ids) or 1)
        by_id = {doc["id"]: doc for doc in found}
        checklists = [by_id[checklist_id] for checklist_id in page_ids if checklist_id in by_id]
    else:
        total = await db.vehicle_checklists.count_documents(query)
        checklists = await db.vehicle_checklists.find(query, {"_id": 0}).sort("checklist_number", -1).skip(skip).limit(per_page).to_list(per_page)

    return {
        "items": checklists,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page
    }

@api_router.get("/vehicle-checklists/{checklist_id}", response_model=VehicleChecklistResponse)
async def get_vehicle_checklist(checklist_id: str, current_user: dict = Depends(get_current_active_user)):
    """Busca um checklist de veículo pelo ID"""
    checklist = await db.vehicle_checklists.find_one({"id": checklist_id}, {"_id": 0})
    if not checklist:
        raise HTTPException(status_code=404, detail="Checklist não encontrado")
    return VehicleChecklistResponse(**checklist)

@api_router.post("/vehicle-checklists", response_model=VehicleChecklistResponse)
async def create_vehicle_checklist(data: VehicleChecklistCreate, current_user: dict = Depends(get_current_active_user)):
    """Cria um novo checklist de veículo"""
    counter = await db.counters.find_one_and_update(
        {"_id": "vehicle_checklist_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    checklist_number = counter["seq"]

    checklist = VehicleChecklist(
        **data.model_dump(),
        checklist_number=checklist_number,
        created_by=current_user["sub"],
        created_by_name=current_user["name"]
    )

    doc = checklist.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    await db.vehicle_checklists.insert_one(doc)
    doc.pop("_id", None)

    return VehicleChecklistResponse(**doc)

@api_router.put("/vehicle-checklists/{checklist_id}", response_model=VehicleChecklistResponse)
async def update_vehicle_checklist(checklist_id: str, data: VehicleChecklistCreate, current_user: dict = Depends(get_current_active_user)):
    """Atualiza um checklist de veículo existente"""
    existing = await db.vehicle_checklists.find_one({"id": checklist_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Checklist não encontrado")

    update_data = data.model_dump()
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    await db.vehicle_checklists.update_one({"id": checklist_id}, {"$set": update_data})
    result = await db.vehicle_checklists.find_one({"id": checklist_id}, {"_id": 0})
    return VehicleChecklistResponse(**result)

@api_router.delete("/vehicle-checklists/{checklist_id}")
async def delete_vehicle_checklist(checklist_id: str, current_user: dict = Depends(get_current_active_user)):
    """Exclui um checklist de veículo"""
    result = await db.vehicle_checklists.delete_one({"id": checklist_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Checklist não encontrado")

    try:
        photo_dir = UPLOADS_DIR / "vehicle_checklists" / checklist_id
        if photo_dir.exists():
            shutil.rmtree(photo_dir)
    except Exception:
        pass

    return {"message": "Checklist excluído com sucesso"}


@api_router.post("/vehicle-checklists/{checklist_id}/upload-photo")
async def upload_vehicle_checklist_photo(
    checklist_id: str,
    photo_type: str = Query(..., alias="type", regex="^(front|back|left_side|right_side|speedometer|tires)$"),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_active_user)
):
    """Faz upload de uma foto do checklist simplificado (frente/traseira/laterais/velocímetro/pneus)"""
    checklist = await db.vehicle_checklists.find_one({"id": checklist_id}, {"_id": 0})
    if not checklist:
        raise HTTPException(status_code=404, detail="Checklist não encontrado")

    photos = checklist.get("photos") or []
    if len(photos) >= MAX_VEHICLE_CHECKLIST_PHOTOS:
        raise HTTPException(status_code=400, detail=f"Limite de {MAX_VEHICLE_CHECKLIST_PHOTOS} fotos por checklist atingido")

    file_ext, content = await validate_and_read_upload(file, ALLOWED_EXTENSIONS)

    photo_dir = UPLOADS_DIR / "vehicle_checklists" / checklist_id
    photo_dir.mkdir(parents=True, exist_ok=True)
    photo_id = str(uuid.uuid4())
    file_path = photo_dir / f"{photo_id}{file_ext}"

    with open(file_path, "wb") as buffer:
        buffer.write(content)

    photo_url = f"/api/uploads/vehicle_checklists/{checklist_id}/{photo_id}{file_ext}"
    photo_entry = {"id": photo_id, "type": photo_type, "url": photo_url}
    # $push (e não regravar a lista lida lá em cima): a tela envia as fotos em
    # paralelo, e duas requisições que leram a mesma lista apagavam a foto uma
    # da outra. O filtro garante o limite mesmo com envios simultâneos.
    result = await db.vehicle_checklists.update_one(
        {"id": checklist_id, f"photos.{MAX_VEHICLE_CHECKLIST_PHOTOS - 1}": {"$exists": False}},
        {"$push": {"photos": photo_entry}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.modified_count == 0:
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Limite de {MAX_VEHICLE_CHECKLIST_PHOTOS} fotos por checklist atingido")

    return photo_entry


@api_router.delete("/vehicle-checklists/{checklist_id}/photo/{photo_id}")
async def delete_vehicle_checklist_photo(
    checklist_id: str,
    photo_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Remove uma foto de um checklist de veículo"""
    checklist = await db.vehicle_checklists.find_one({"id": checklist_id}, {"_id": 0})
    if not checklist:
        raise HTTPException(status_code=404, detail="Checklist não encontrado")

    photos = checklist.get("photos") or []
    if not any(p["id"] == photo_id for p in photos):
        raise HTTPException(status_code=404, detail="Foto não encontrada")

    photo_dir = UPLOADS_DIR / "vehicle_checklists" / checklist_id
    for file_path in photo_dir.glob(f"{photo_id}.*"):
        file_path.unlink()

    # $pull pelo mesmo motivo do $push no envio: não regravar a lista inteira
    await db.vehicle_checklists.update_one(
        {"id": checklist_id},
        {"$pull": {"photos": {"id": photo_id}}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )

    return {"message": "Foto removida com sucesso"}

@api_router.get("/vehicle-checklists/{checklist_id}/pdf")
async def download_vehicle_checklist_pdf(checklist_id: str, current_user: dict = Depends(get_current_active_user)):
    """Gera o PDF do checklist de veículo (modelo Petrobras/LVT ou modelo padrão, conforme o template do checklist)"""
    from reports import generate_vehicle_checklist_pdf, generate_petrobras_lvt_pdf

    checklist = await db.vehicle_checklists.find_one({"id": checklist_id}, {"_id": 0})
    if not checklist:
        raise HTTPException(status_code=404, detail="Checklist não encontrado")

    company = await get_company_settings()
    if checklist.get("template") == "petrobras_lvt":
        pdf_bytes = generate_petrobras_lvt_pdf(checklist, company=company)
    else:
        pdf_bytes = generate_vehicle_checklist_pdf(checklist, company=company)

    filename = f"checklist_veiculo_{checklist['checklist_number']}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# ==================== FROTA - CONTROLE DE REVISÃO ====================

@api_router.get("/vehicle-revisions")
async def get_vehicle_revisions(
    vehicle_plate: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    current_user: dict = Depends(get_current_active_user)
):
    """Lista todas as revisões de veículos"""
    query = {}
    if vehicle_plate:
        query["vehicle_plate"] = {"$regex": re.escape(vehicle_plate.upper()), "$options": "i"}
    
    skip = (page - 1) * per_page
    
    total = await db.vehicle_revisions.count_documents(query)
    revisions = await db.vehicle_revisions.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page).to_list(per_page)
    
    return {
        "items": revisions,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page
    }

@api_router.get("/vehicle-revisions/{revision_id}", response_model=VehicleRevisionResponse)
async def get_vehicle_revision(
    revision_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Busca uma revisão específica"""
    revision = await db.vehicle_revisions.find_one({"id": revision_id}, {"_id": 0})
    if not revision:
        raise HTTPException(status_code=404, detail="Revisão não encontrada")
    return VehicleRevisionResponse(**revision)

@api_router.post("/vehicle-revisions", response_model=VehicleRevisionResponse)
async def create_vehicle_revision(
    data: VehicleRevisionCreate,
    current_user: dict = Depends(get_current_active_user)
):
    """Cria uma nova revisão de veículo"""
    counter = await db.counters.find_one_and_update(
        {"_id": "vehicle_revision_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    revision_number = counter["seq"]
    
    revision = VehicleRevision(
        revision_number=revision_number,
        vehicle_plate=data.vehicle_plate.upper(),
        vehicle_model=data.vehicle_model,
        revision_date=data.revision_date,
        oil_used=data.oil_used,
        current_km=data.current_km,
        next_oil_motor_km=data.next_oil_motor_km,
        next_oil_filter_km=data.next_oil_filter_km,
        next_air_filter_km=data.next_air_filter_km,
        next_ac_filter_km=data.next_ac_filter_km,
        next_fuel_filter_km=data.next_fuel_filter_km,
        next_racor_filter_km=data.next_racor_filter_km,
        next_apu_filter_km=data.next_apu_filter_km,
        next_hydraulic_filter_km=data.next_hydraulic_filter_km,
        next_gearbox_oil_km=data.next_gearbox_oil_km,
        next_differential_oil_km=data.next_differential_oil_km,
        next_lubrication_km=data.next_lubrication_km,
        next_washing_km=data.next_washing_km,
        mechanic_name=data.mechanic_name,
        performed_by=data.performed_by,
        observations=data.observations,
        created_by=current_user["sub"],
        created_by_name=current_user["name"]
    )
    
    revision_dict = revision.model_dump()
    revision_dict["revision_date"] = revision_dict["revision_date"].isoformat()
    revision_dict["created_at"] = revision_dict["created_at"].isoformat()
    
    await db.vehicle_revisions.insert_one(revision_dict)
    revision_dict.pop('_id', None)
    
    return VehicleRevisionResponse(**revision_dict)

@api_router.post("/vehicle-revisions/{revision_id}/upload-km-photo")
async def upload_vehicle_revision_km_photo(
    revision_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_active_user)
):
    """Faz upload da foto do Km (hodômetro) da revisão - substitui a foto anterior, se houver."""
    revision = await db.vehicle_revisions.find_one({"id": revision_id}, {"_id": 0, "id": 1})
    if not revision:
        raise HTTPException(status_code=404, detail="Revisão não encontrada")

    file_ext, content = await validate_and_read_upload(file, ALLOWED_EXTENSIONS)

    photo_dir = UPLOADS_DIR / "vehicle_revisions" / revision_id
    photo_dir.mkdir(parents=True, exist_ok=True)
    for old_file in photo_dir.glob("*"):
        old_file.unlink()

    photo_id = str(uuid.uuid4())
    file_path = photo_dir / f"{photo_id}{file_ext}"
    with open(file_path, "wb") as buffer:
        buffer.write(content)

    photo_url = f"/api/uploads/vehicle_revisions/{revision_id}/{photo_id}{file_ext}"
    await db.vehicle_revisions.update_one(
        {"id": revision_id},
        {"$set": {"current_km_photo_url": photo_url, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )

    return {"current_km_photo_url": photo_url}

@api_router.delete("/vehicle-revisions/{revision_id}/km-photo")
async def delete_vehicle_revision_km_photo(
    revision_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Remove a foto do Km da revisão."""
    revision = await db.vehicle_revisions.find_one({"id": revision_id}, {"_id": 0, "id": 1})
    if not revision:
        raise HTTPException(status_code=404, detail="Revisão não encontrada")

    photo_dir = UPLOADS_DIR / "vehicle_revisions" / revision_id
    if photo_dir.exists():
        for old_file in photo_dir.glob("*"):
            old_file.unlink()

    await db.vehicle_revisions.update_one(
        {"id": revision_id},
        {"$set": {"current_km_photo_url": None, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )

    return {"message": "Foto removida com sucesso"}

@api_router.delete("/vehicle-revisions/{revision_id}")
async def delete_vehicle_revision(
    revision_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Exclui uma revisão"""
    result = await db.vehicle_revisions.delete_one({"id": revision_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Revisão não encontrada")

    try:
        photo_dir = UPLOADS_DIR / "vehicle_revisions" / revision_id
        if photo_dir.exists():
            shutil.rmtree(photo_dir)
    except Exception:
        pass

    return {"message": "Revisão excluída com sucesso"}


@api_router.put("/vehicle-revisions/{revision_id}", response_model=VehicleRevisionResponse)
async def update_vehicle_revision(
    revision_id: str,
    data: VehicleRevisionCreate,
    current_user: dict = Depends(get_current_active_user)
):
    """Atualiza uma revisão existente."""
    existing = await db.vehicle_revisions.find_one({"id": revision_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Revisão não encontrada")

    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}

    # Atualizar dados do veículo (placa/modelo) caso vehicle_id tenha mudado
    if 'vehicle_id' in update_data and update_data['vehicle_id']:
        vehicle = await db.vehicles.find_one({"id": update_data['vehicle_id']}, {"_id": 0})
        if vehicle:
            update_data['vehicle_plate'] = vehicle.get('plate', existing.get('vehicle_plate'))
            update_data['vehicle_model'] = vehicle.get('model', existing.get('vehicle_model'))

    update_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    await db.vehicle_revisions.update_one({"id": revision_id}, {"$set": update_data})

    updated = await db.vehicle_revisions.find_one({"id": revision_id}, {"_id": 0})
    return VehicleRevisionResponse(**updated)


@api_router.get("/vehicle-revisions/{revision_id}/pdf")
async def generate_revision_pdf(
    revision_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Gera PDF da revisão no padrão visual dos documentos do sistema
    (cabeçalho, quadro de dados, foto do hodômetro, tabela de próximas trocas,
    observações, assinaturas e rodapé com páginas)."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Spacer, Image
    from reportlab.lib.styles import getSampleStyleSheet
    from reports import (
        _build_pdf_header, _make_pdf_footer, _pdf_info_grid, _pdf_section_title,
        _pdf_header_cells, _pdf_cell_factory, _pdf_table_style, _pdf_note_box, _pdf_signatures,
    )

    revision = await db.vehicle_revisions.find_one({"id": revision_id}, {"_id": 0})
    if not revision:
        raise HTTPException(status_code=404, detail="Revisão não encontrada")

    company = merge_company(await get_company_settings())
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=15*mm,
        leftMargin=15*mm,
        topMargin=12*mm,
        bottomMargin=15*mm
    )
    width = doc.width

    elements = []
    styles = getSampleStyleSheet()

    elements.extend(_build_pdf_header(
        styles, load_logo_buffer(company), f"Controle de Revisão Nº {revision['revision_number']}",
        company=company, content_width=width,
    ))

    # ========== DADOS DA REVISÃO ==========
    rev_date = parse_datetime_value(revision['revision_date'])
    created_at = parse_datetime_value(revision['created_at']).astimezone(timezone(timedelta(hours=-3)))
    km = f"{revision['current_km']:,}".replace(",", ".")
    elements.append(_pdf_info_grid([
        ("Veículo", revision['vehicle_plate']),
        ("Modelo", revision.get('vehicle_model') or '-'),
        ("Data da revisão", rev_date.strftime('%d/%m/%Y')),
        ("KM atual", f"{km} KM"),
        ("Óleo utilizado", revision['oil_used'], 2),
        ("Mecânico", revision['mechanic_name']),
        ("Realizado por", revision.get('performed_by') or '-'),
        ("Registrado por", f"{revision['created_by_name']} em {created_at.strftime('%d/%m/%Y às %H:%M')}", 4),
    ], width, cols=4))

    # ========== FOTO DO HODÔMETRO (KM) ==========
    km_photo_url = revision.get('current_km_photo_url')
    if km_photo_url:
        try:
            relative = km_photo_url.split('/api/uploads/', 1)[1]
            km_photo_path = UPLOADS_DIR / relative
            if km_photo_path.exists():
                elements.extend(_pdf_section_title("Foto do hodômetro (KM)", width))
                photo = Image(str(km_photo_path), width=190, height=130, kind='proportional')
                photo.hAlign = 'LEFT'
                elements.append(photo)
        except Exception:
            pass

    # ========== PRÓXIMA REVISÃO ==========
    def format_km(value):
        if value:
            return f"{value:,} KM".replace(",", ".")
        return "-"

    elements.extend(_pdf_section_title("Próxima revisão — quilometragem", width))
    cell = _pdf_cell_factory(styles, font_size=9)
    next_items = [
        ("Óleo Motor", 'next_oil_motor_km'),
        ("Filtro de Óleo", 'next_oil_filter_km'),
        ("Filtro de Ar", 'next_air_filter_km'),
        ("Filtro Ar Condicionado", 'next_ac_filter_km'),
        ("Filtro de Combustível", 'next_fuel_filter_km'),
        ("Filtro Racor", 'next_racor_filter_km'),
        ("Filtro APU", 'next_apu_filter_km'),
        ("Filtro Hidráulico", 'next_hydraulic_filter_km'),
        ("Óleo Caixa de Marcha", 'next_gearbox_oil_km'),
        ("Óleo Diferencial", 'next_differential_oil_km'),
        ("Lubrificação", 'next_lubrication_km'),
        ("Lavagem", 'next_washing_km'),
    ]
    next_rev_data = [_pdf_header_cells(["Item", "Próxima troca (KM)"], font_size=8.5)]
    for label, key in next_items:
        next_rev_data.append([cell(label), cell(format_km(revision.get(key)), 'center', bold=bool(revision.get(key)))])
    next_table = Table(next_rev_data, colWidths=[width * 0.6, width * 0.4], repeatRows=1)
    next_table.setStyle(TableStyle(_pdf_table_style() + [
        ('TOPPADDING', (0, 1), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 4),
    ]))
    elements.append(next_table)

    # ========== OBSERVAÇÕES ==========
    if revision.get('observations'):
        elements.append(Spacer(1, 10))
        elements.append(_pdf_note_box("Observações", revision.get('observations', ''), width))

    # ========== ASSINATURAS ==========
    elements.append(Spacer(1, 14))
    elements.append(_pdf_signatures(["Responsável pela Revisão", "Conferido por"], width, space_above=34))

    footer = _make_pdf_footer(company['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    buffer.seek(0)

    filename = f"revisao_{revision['vehicle_plate']}_{revision['revision_number']}.pdf"
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={filename}"})

@api_router.get("/vehicles/plates")
async def get_vehicle_plates(current_user: dict = Depends(get_current_active_user)):
    """Lista todas as placas de veículos"""
    movements_plates = await db.movements.distinct("truck_plate")
    revisions_plates = await db.vehicle_revisions.distinct("vehicle_plate")
    all_plates = list(set([p for p in movements_plates if p] + [p for p in revisions_plates if p]))
    all_plates.sort()
    return all_plates


# ==================== FROTA - LANÇAMENTO DE HODÔMETRO ====================

NEXT_KM_FIELDS = [
    "next_oil_motor_km", "next_oil_filter_km", "next_air_filter_km", "next_ac_filter_km",
    "next_fuel_filter_km", "next_racor_filter_km", "next_apu_filter_km", "next_hydraulic_filter_km",
    "next_gearbox_oil_km", "next_differential_oil_km", "next_lubrication_km", "next_washing_km",
]

MAINTENANCE_ALERT_MARGIN_KM = 1000


async def _compute_vehicle_maintenance_status(vehicle: dict) -> Optional[dict]:
    """Calcula a situação de manutenção de um veículo a partir da última Revisão
    registrada e do maior KM conhecido (revisão, hodômetro ou abastecimento).
    Retorna None se não houver dado suficiente (sem revisão ou sem nenhum next_*_km preenchido)."""
    plate = (vehicle.get("plate") or "").upper()
    if not plate:
        return None

    revision = await db.vehicle_revisions.find_one(
        {"vehicle_plate": {"$regex": f"^{re.escape(plate)}$", "$options": "i"}},
        {"_id": 0},
        sort=[("created_at", -1)]
    )
    if not revision:
        return None

    next_due_km = min([revision[f] for f in NEXT_KM_FIELDS if revision.get(f) is not None], default=None)
    if next_due_km is None:
        return None

    current_km = revision.get("current_km") or 0

    latest_reading = await db.odometer_readings.find_one(
        {"vehicle_id": vehicle["id"]}, {"_id": 0, "km": 1}, sort=[("created_at", -1)]
    )
    if latest_reading and latest_reading.get("km") is not None:
        current_km = max(current_km, latest_reading["km"])

    latest_fuel_supply = await db.fuel_supplies.find_one(
        {"equipment_id": vehicle["id"], "reading": {"$ne": None}}, {"_id": 0, "reading": 1}, sort=[("created_at", -1)]
    )
    if latest_fuel_supply and latest_fuel_supply.get("reading") is not None:
        current_km = max(current_km, latest_fuel_supply["reading"])

    km_remaining = next_due_km - current_km
    if km_remaining <= 0:
        maintenance_status = "OVERDUE"
    elif km_remaining <= MAINTENANCE_ALERT_MARGIN_KM:
        maintenance_status = "DUE_SOON"
    else:
        maintenance_status = "OK"

    return {
        "vehicle_id": vehicle["id"],
        "vehicle_plate": plate,
        "vehicle_model": vehicle.get("model"),
        "current_km": current_km,
        "next_due_km": next_due_km,
        "km_remaining": km_remaining,
        "status": maintenance_status,
    }


async def get_all_vehicle_maintenance_status() -> list:
    """Situação de manutenção de todos os veículos com hodômetro próprio (CAVALO/CAMINHÃO, ATIVO)."""
    vehicles = await db.vehicles.find(
        {"vehicle_type": {"$in": ["CAVALO", "CAMINHÃO"]}, "status": "ATIVO"},
        {"_id": 0, "id": 1, "plate": 1, "model": 1}
    ).to_list(None)

    results = []
    for vehicle in vehicles:
        status = await _compute_vehicle_maintenance_status(vehicle)
        if status:
            results.append(status)
    return results


@api_router.get("/odometer-readings/maintenance-status")
async def get_maintenance_status_route(current_user: dict = Depends(get_current_active_user)):
    """Situação de manutenção de todos os veículos, pra Seção 'Situação de Manutenção'"""
    return await get_all_vehicle_maintenance_status()


@api_router.get("/odometer-readings")
async def get_odometer_readings(
    vehicle_plate: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    current_user: dict = Depends(get_current_active_user)
):
    """Lista os lançamentos de hodômetro - une os lançamentos manuais com os KMs
    ("Leitura") já lançados em cada Abastecimento, pra não exigir digitação duplicada.
    Entradas vindas do Abastecimento vêm marcadas com source=ABASTECIMENTO e não são
    excluíveis por aqui (a exclusão é feita editando/removendo o Abastecimento em si)."""
    query = {}
    if vehicle_plate:
        query["vehicle_plate"] = {"$regex": re.escape(vehicle_plate.upper()), "$options": "i"}

    manual = await db.odometer_readings.find(query, {"_id": 0}).to_list(None)
    for r in manual:
        r["source"] = "MANUAL"

    fuel_query = {"reading": {"$ne": None}, "equipment_id": {"$ne": None}}
    if vehicle_plate:
        fuel_query["equipment_plate"] = {"$regex": re.escape(vehicle_plate.upper()), "$options": "i"}
    fuel_supplies = await db.fuel_supplies.find(
        fuel_query,
        {"_id": 0, "id": 1, "supply_number": 1, "equipment_id": 1, "equipment_plate": 1,
         "reading": 1, "supply_date": 1, "created_at": 1}
    ).to_list(None)
    from_fuel = [{
        "id": fs["id"],
        "reading_number": fs.get("supply_number"),
        "vehicle_id": fs.get("equipment_id"),
        "vehicle_plate": fs.get("equipment_plate"),
        "km": fs.get("reading"),
        "reading_date": fs.get("supply_date"),
        "observations": None,
        "created_by": None,
        "created_by_name": None,
        "created_at": fs.get("created_at"),
        "source": "ABASTECIMENTO",
    } for fs in fuel_supplies]

    combined = manual + from_fuel
    combined.sort(key=lambda r: r.get("created_at") or "", reverse=True)

    total = len(combined)
    skip = (page - 1) * per_page
    page_items = combined[skip:skip + per_page]

    return {
        "items": page_items,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page
    }


@api_router.post("/odometer-readings", response_model=OdometerReadingResponse)
async def create_odometer_reading(
    data: OdometerReadingCreate,
    current_user: dict = Depends(get_current_active_user)
):
    """Cria um novo lançamento de hodômetro"""
    counter = await db.counters.find_one_and_update(
        {"_id": "odometer_reading_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    reading_number = counter["seq"]

    reading = OdometerReading(
        reading_number=reading_number,
        vehicle_id=data.vehicle_id,
        vehicle_plate=data.vehicle_plate.upper(),
        km=data.km,
        reading_date=data.reading_date,
        observations=data.observations,
        created_by=current_user["sub"],
        created_by_name=current_user["name"]
    )

    reading_dict = reading.model_dump()
    reading_dict["created_at"] = reading_dict["created_at"].isoformat()

    await db.odometer_readings.insert_one(reading_dict)
    reading_dict.pop('_id', None)

    return OdometerReadingResponse(**reading_dict)


@api_router.delete("/odometer-readings/{reading_id}")
async def delete_odometer_reading(
    reading_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Exclui um lançamento de hodômetro"""
    result = await db.odometer_readings.delete_one({"id": reading_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    return {"message": "Lançamento excluído com sucesso"}


