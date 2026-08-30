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
    MAX_VEHICLE_CHECKLIST_PHOTOS, SIMPLE_CHECKLIST_TEMPLATES,
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

@api_router.get("/vehicle-checklists")
async def get_vehicle_checklists(
    search: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    current_user: dict = Depends(get_current_active_user)
):
    """Lista os checklists de veículo com paginação e busca por placa/motorista/cliente"""
    query = {}
    if search:
        search_escaped = re.escape(search)
        query["$or"] = [
            {"cavalo_plate": {"$regex": search_escaped, "$options": "i"}},
            {"vehicle_plate": {"$regex": search_escaped, "$options": "i"}},
            {"driver_name": {"$regex": search_escaped, "$options": "i"}},
            {"client_name": {"$regex": search_escaped, "$options": "i"}},
        ]

    skip = (page - 1) * per_page
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
    await db.vehicle_checklists.update_one(
        {"id": checklist_id},
        {"$set": {"photos": photos + [photo_entry], "updated_at": datetime.now(timezone.utc).isoformat()}}
    )

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
    remaining_photos = [p for p in photos if p["id"] != photo_id]
    if len(remaining_photos) == len(photos):
        raise HTTPException(status_code=404, detail="Foto não encontrada")

    photo_dir = UPLOADS_DIR / "vehicle_checklists" / checklist_id
    for file_path in photo_dir.glob(f"{photo_id}.*"):
        file_path.unlink()

    await db.vehicle_checklists.update_one(
        {"id": checklist_id},
        {"$set": {"photos": remaining_photos, "updated_at": datetime.now(timezone.utc).isoformat()}}
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

@api_router.delete("/vehicle-revisions/{revision_id}")
async def delete_vehicle_revision(
    revision_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Exclui uma revisão"""
    result = await db.vehicle_revisions.delete_one({"id": revision_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Revisão não encontrada")
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
    """Gera PDF da revisão - Layout profissional igual ao comprovante de movimentação"""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    import requests
    
    revision = await db.vehicle_revisions.find_one({"id": revision_id}, {"_id": 0})
    if not revision:
        raise HTTPException(status_code=404, detail="Revisão não encontrada")

    company = merge_company(await get_company_settings())
    buffer = io.BytesIO()
    
    # Cores corporativas (igual aos outros relatórios)
    PRIMARY_COLOR = "008B7B"
    HEADER_BG_COLOR = "E8F4F5"
    
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=15*mm,
        leftMargin=15*mm,
        topMargin=15*mm,
        bottomMargin=15*mm
    )
    
    elements = []
    styles = getSampleStyleSheet()
    
    # ========== DOWNLOAD LOGO ==========
    logo_buffer = load_logo_buffer(company)

    # ========== HEADER SECTION ==========
    company_style = ParagraphStyle(
        'CompanyName',
        parent=styles['Normal'],
        fontSize=14,
        textColor=colors.black,
        alignment=TA_CENTER,
        fontName='Helvetica-Bold',
        leading=16
    )
    address_style = ParagraphStyle(
        'Address',
        parent=styles['Normal'],
        fontSize=8,
        textColor=colors.black,
        alignment=TA_CENTER,
        leading=10
    )

    logo_cell = ""
    if logo_buffer:
        try:
            logo_cell = Image(logo_buffer, width=50, height=50)
        except:
            pass

    address_lines = [line.strip() for line in company['address'].split('\n') if line.strip()]
    company_info = [
        Paragraph(company['name'], company_style),
        Paragraph(f"CNPJ: {company['cnpj']}", address_style),
    ] + [
        Paragraph(line, address_style) for line in address_lines
    ] + [
        Paragraph(f"{company['email']} | {company['phone']}", address_style),
    ]
    
    header_data = [[logo_cell, company_info, ""]]
    header_table = Table(header_data, colWidths=[60, 400, 60])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (0, 0), (0, 0), 'LEFT'),
        ('ALIGN', (1, 0), (1, 0), 'CENTER'),
    ]))
    elements.append(header_table)
    elements.append(Spacer(1, 5))
    
    # Linha separadora
    line_table = Table([[""]], colWidths=[520])
    line_table.setStyle(TableStyle([
        ('LINEABOVE', (0, 0), (-1, 0), 2, colors.HexColor(f'#{PRIMARY_COLOR}')),
    ]))
    elements.append(line_table)
    elements.append(Spacer(1, 10))
    
    # ========== TÍTULO ==========
    title_style = ParagraphStyle(
        'Title',
        parent=styles['Normal'],
        fontSize=16,
        textColor=colors.HexColor(f'#{PRIMARY_COLOR}'),
        alignment=TA_CENTER,
        fontName='Helvetica-Bold',
        spaceAfter=15
    )
    elements.append(Paragraph("CONTROLE DE REVISÃO", title_style))
    
    # ========== INFO BAR ==========
    rev_date = parse_datetime_value(revision['revision_date'])
    info_text = f"Revisão Nº {revision['revision_number']}  |  Veículo: {revision['vehicle_plate']}  |  Data: {rev_date.strftime('%d/%m/%Y')}"
    
    info_style = ParagraphStyle(
        'InfoBar',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.HexColor(f'#{PRIMARY_COLOR}'),
        alignment=TA_CENTER,
        fontName='Helvetica-Bold'
    )
    
    info_data = [[Paragraph(info_text, info_style)]]
    info_table = Table(info_data, colWidths=[520])
    info_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(f'#{HEADER_BG_COLOR}')),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor(f'#{PRIMARY_COLOR}')),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 15))
    
    # ========== DADOS DO VEÍCULO ==========
    label_style = ParagraphStyle('Label', parent=styles['Normal'], fontSize=9, fontName='Helvetica-Bold')
    value_style = ParagraphStyle('Value', parent=styles['Normal'], fontSize=9, fontName='Helvetica')
    
    km = f"{revision['current_km']:,}".replace(",", ".")
    
    vehicle_data = [
        [Paragraph("VEÍCULO:", label_style), Paragraph(revision['vehicle_plate'], value_style),
         Paragraph("MODELO:", label_style), Paragraph(revision.get('vehicle_model') or '-', value_style)],
        [Paragraph("ÓLEO UTILIZADO:", label_style), Paragraph(revision['oil_used'], value_style),
         Paragraph("KM ATUAL:", label_style), Paragraph(f"{km} KM", value_style)],
        [Paragraph("MECÂNICO:", label_style), Paragraph(revision['mechanic_name'], value_style),
         Paragraph("REALIZADO POR:", label_style), Paragraph(revision.get('performed_by') or '-', value_style)],
    ]
    
    vehicle_table = Table(vehicle_data, colWidths=[100, 160, 100, 160])
    vehicle_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#F5F5F5')),
        ('BACKGROUND', (2, 0), (2, -1), colors.HexColor('#F5F5F5')),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CCCCCC')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
    ]))
    elements.append(vehicle_table)
    elements.append(Spacer(1, 20))
    
    # ========== PRÓXIMA REVISÃO - TÍTULO ==========
    section_title_style = ParagraphStyle(
        'SectionTitle',
        parent=styles['Normal'],
        fontSize=11,
        textColor=colors.white,
        alignment=TA_CENTER,
        fontName='Helvetica-Bold'
    )
    
    section_data = [[Paragraph("PRÓXIMA REVISÃO - QUILOMETRAGEM", section_title_style)]]
    section_table = Table(section_data, colWidths=[520])
    section_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(f'#{PRIMARY_COLOR}')),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
    ]))
    elements.append(section_table)
    
    # ========== TABELA DE PRÓXIMAS REVISÕES ==========
    def format_km(value):
        if value:
            return f"{value:,} KM".replace(",", ".")
        return "-"
    
    next_rev_data = [
        ["ITEM", "PRÓXIMA TROCA (KM)"],
        ["Óleo Motor", format_km(revision.get('next_oil_motor_km'))],
        ["Filtro de Óleo", format_km(revision.get('next_oil_filter_km'))],
        ["Filtro de Ar", format_km(revision.get('next_air_filter_km'))],
        ["Filtro Ar Condicionado", format_km(revision.get('next_ac_filter_km'))],
        ["Filtro de Combustível", format_km(revision.get('next_fuel_filter_km'))],
        ["Filtro Racor", format_km(revision.get('next_racor_filter_km'))],
        ["Filtro APU", format_km(revision.get('next_apu_filter_km'))],
        ["Filtro Hidráulico", format_km(revision.get('next_hydraulic_filter_km'))],
        ["Óleo Caixa de Marcha", format_km(revision.get('next_gearbox_oil_km'))],
        ["Óleo Diferencial", format_km(revision.get('next_differential_oil_km'))],
        ["Lubrificação", format_km(revision.get('next_lubrication_km'))],
        ["Lavagem", format_km(revision.get('next_washing_km'))],
    ]
    
    next_table = Table(next_rev_data, colWidths=[300, 220])
    next_table.setStyle(TableStyle([
        # Header
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor(f'#{HEADER_BG_COLOR}')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor(f'#{PRIMARY_COLOR}')),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        # Body
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 9),
        ('ALIGN', (1, 1), (1, -1), 'CENTER'),
        # Borders and padding
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CCCCCC')),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor(f'#{PRIMARY_COLOR}')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        # Alternating rows
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F8F8F8')]),
    ]))
    elements.append(next_table)
    elements.append(Spacer(1, 20))
    
    # ========== OBSERVAÇÕES ==========
    if revision.get('observations'):
        obs_title_style = ParagraphStyle(
            'ObsTitle',
            parent=styles['Normal'],
            fontSize=10,
            fontName='Helvetica-Bold',
            textColor=colors.HexColor(f'#{PRIMARY_COLOR}')
        )
        obs_style = ParagraphStyle(
            'Obs',
            parent=styles['Normal'],
            fontSize=9,
            fontName='Helvetica'
        )
        elements.append(Paragraph("OBSERVAÇÕES:", obs_title_style))
        elements.append(Spacer(1, 5))
        elements.append(Paragraph(revision.get('observations', ''), obs_style))
        elements.append(Spacer(1, 15))
    
    # ========== RODAPÉ COM ASSINATURA ==========
    footer_style = ParagraphStyle(
        'Footer',
        parent=styles['Normal'],
        fontSize=8,
        textColor=colors.grey,
        alignment=TA_CENTER
    )
    
    created_at = parse_datetime_value(revision['created_at']).astimezone(timezone(timedelta(hours=-3)))
    elements.append(Spacer(1, 30))

    # Linha de assinatura
    sig_data = [
        ["_" * 50, "_" * 50],
        ["Responsável pela Revisão", "Conferido por"]
    ]
    sig_table = Table(sig_data, colWidths=[260, 260])
    sig_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 1), (-1, 1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 1), (-1, 1), 5),
    ]))
    elements.append(sig_table)
    elements.append(Spacer(1, 20))
    
    elements.append(Paragraph(f"Registrado por: {revision['created_by_name']} em {created_at.strftime('%d/%m/%Y às %H:%M')}", footer_style))
    elements.append(Paragraph(f"ContainerLogix - {company['name']}", footer_style))
    
    doc.build(elements)
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


