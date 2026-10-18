from datetime import datetime, timezone
import asyncio
import io
import uuid
import shutil

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse

from models import (
    ContainerVistoria, ContainerVistoriaCreate, ContainerVistoriaUpdate, ContainerVistoriaResponse,
    MAX_VISTORIA_PHOTOS, Driver, TransportCompany, VehicleCreate
)

from reports import generate_container_photo_document_pdf, photo_document_filename

from shared import (
    db, get_current_active_user, validate_and_read_upload, ALLOWED_EXTENSIONS,
    UPLOADS_DIR, get_company_settings,
)

api_router = APIRouter(prefix="/api")

# ========== VISTORIA DE CONTAINER ==========

def _same_text(a, b) -> bool:
    return (a or '').strip().casefold() == (b or '').strip().casefold()


def _digits(value) -> str:
    return ''.join(ch for ch in (value or '') if ch.isdigit())


def _plate_key(value) -> str:
    return ''.join(ch for ch in (value or '').upper() if ch.isalnum())


async def _pre_register_cadastros(vistoria: dict, current_user: dict) -> list:
    """Pré-cadastro do que a vistoria informou e ainda não existe no sistema:
    Motorista (precisa de nome e CPF), Cavalo, Carreta e Transportadora.
    Nunca altera um cadastro existente - só cria o que falta, com o mínimo
    de dados e uma observação dizendo de qual vistoria veio. Devolve os
    rótulos do que foi criado, pra tela avisar o operador."""
    created = []
    now = datetime.now(timezone.utc).isoformat()
    origin = f"Pré-cadastro gerado pela Vistoria de Container VC{vistoria['vistoria_number']:06d} - complete os dados."

    company_name = (vistoria.get('transport_company') or '').strip()
    if company_name:
        companies = await db.transport_companies.find({}, {"_id": 0, "name": 1, "trade_name": 1}).to_list(None)
        if not any(_same_text(c.get('name'), company_name) or _same_text(c.get('trade_name'), company_name) for c in companies):
            company = TransportCompany(name=company_name, observations=origin, created_by=current_user['sub'])
            doc = company.model_dump()
            doc['created_at'] = doc['created_at'].isoformat()
            await db.transport_companies.insert_one(doc)
            created.append('Transportadora')

    driver_name = (vistoria.get('driver_name') or '').strip()
    driver_cpf = (vistoria.get('driver_cpf') or '').strip()
    if driver_name and _digits(driver_cpf):
        drivers = await db.drivers.find({}, {"_id": 0, "name": 1, "cpf": 1}).to_list(None)
        if not any(_digits(d.get('cpf')) == _digits(driver_cpf) or _same_text(d.get('name'), driver_name) for d in drivers):
            driver = Driver(
                name=driver_name, cpf=driver_cpf, transport_company=company_name or None,
                observations=origin, created_by=current_user['sub'],
            )
            doc = driver.model_dump()
            doc['created_at'] = doc['created_at'].isoformat()
            await db.drivers.insert_one(doc)
            created.append('Motorista')

    for field, vehicle_type, label in (('truck_plate', 'CAVALO', 'Cavalo'), ('trailer_plate', 'CARRETA', 'Carreta')):
        plate = (vistoria.get(field) or '').strip().upper()
        if not _plate_key(plate):
            continue
        plates = await db.vehicles.find({}, {"_id": 0, "plate": 1}).to_list(None)
        if any(_plate_key(v.get('plate')) == _plate_key(plate) for v in plates):
            continue
        # Mesmo formato de documento que POST /vehicles grava (routers/frota.py)
        await db.vehicles.insert_one({
            **VehicleCreate(
                plate=plate, vehicle_type=vehicle_type, transport_company=company_name or None, observations=origin
            ).model_dump(),
            "id": str(uuid.uuid4()),
            "driver_name": None,
            "created_by": current_user["sub"],
            "created_by_name": current_user.get("name", "Sistema"),
            "created_at": now,
            "updated_at": None,
        })
        created.append(label)

    return created


@api_router.get("/container-vistorias")
async def list_container_vistorias(
    page: int = 1,
    per_page: int = 20,
    current_user: dict = Depends(get_current_active_user)
):
    """Lista todas as vistorias de container"""
    skip = (page - 1) * per_page

    total = await db.container_vistorias.count_documents({})
    vistorias = await db.container_vistorias.find({}, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page).to_list(per_page)

    return {
        "items": vistorias,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page
    }

@api_router.get("/container-vistorias/{vistoria_id}", response_model=ContainerVistoriaResponse)
async def get_container_vistoria(vistoria_id: str, current_user: dict = Depends(get_current_active_user)):
    """Obtém uma vistoria de container pelo ID"""
    vistoria = await db.container_vistorias.find_one({"id": vistoria_id}, {"_id": 0})
    if not vistoria:
        raise HTTPException(status_code=404, detail="Vistoria de container não encontrada")
    return ContainerVistoriaResponse(**vistoria)

@api_router.get("/container-vistorias/{vistoria_id}/pdf")
async def download_container_vistoria_pdf(vistoria_id: str, current_user: dict = Depends(get_current_active_user)):
    """PDF da vistoria (o mesmo documento da impressão), pro download em lote da lista"""
    vistoria = await db.container_vistorias.find_one({"id": vistoria_id}, {"_id": 0})
    if not vistoria:
        raise HTTPException(status_code=404, detail="Vistoria de container não encontrada")
    company = await get_company_settings()
    # Fora do loop de eventos: abrir e reduzir até 12 fotos leva alguns segundos
    pdf_bytes = await asyncio.to_thread(generate_container_photo_document_pdf, vistoria, 'vistoria', company, UPLOADS_DIR)
    filename = photo_document_filename('Vistoria', vistoria.get('container_number'), vistoria.get('vistoria_number'))
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@api_router.post("/container-vistorias", response_model=ContainerVistoriaResponse)
async def create_container_vistoria(
    data: ContainerVistoriaCreate,
    current_user: dict = Depends(get_current_active_user)
):
    """Cria uma nova vistoria de container"""
    counter = await db.counters.find_one_and_update(
        {"_id": "vistoria_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    vistoria_number = counter["seq"]

    vistoria = ContainerVistoria(
        vistoria_number=vistoria_number,
        container_number=data.container_number,
        client_name=data.client_name,
        shipping_line=data.shipping_line,
        truck_plate=data.truck_plate,
        trailer_plate=data.trailer_plate,
        transport_company=data.transport_company,
        driver_name=data.driver_name,
        driver_cpf=data.driver_cpf,
        size_type=data.size_type,
        tare=data.tare,
        no_damage=data.no_damage,
        damage_items=data.damage_items,
        observations=data.observations,
        created_by=current_user["sub"],
        created_by_name=current_user["name"]
    )

    vistoria_dict = vistoria.model_dump()
    vistoria_dict["created_at"] = vistoria_dict["created_at"].isoformat()

    await db.container_vistorias.insert_one(vistoria_dict)
    vistoria_dict.pop("_id", None)

    pre_registered = await _pre_register_cadastros(vistoria_dict, current_user)
    return ContainerVistoriaResponse(**vistoria_dict, pre_registered=pre_registered)

@api_router.put("/container-vistorias/{vistoria_id}", response_model=ContainerVistoriaResponse)
async def update_container_vistoria(
    vistoria_id: str,
    data: ContainerVistoriaUpdate,
    current_user: dict = Depends(get_current_active_user)
):
    """Atualiza uma vistoria de container"""
    vistoria = await db.container_vistorias.find_one({"id": vistoria_id}, {"_id": 0})
    if not vistoria:
        raise HTTPException(status_code=404, detail="Vistoria de container não encontrada")

    update_data = {}

    for field in (
        "container_number", "client_name", "shipping_line", "truck_plate",
        "trailer_plate", "transport_company", "driver_name", "driver_cpf", "size_type", "tare",
        "no_damage", "damage_items", "observations",
        "movement_id", "movement_transaction_id",
    ):
        value = getattr(data, field)
        if value is not None:
            update_data[field] = value

    if update_data:
        update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.container_vistorias.update_one({"id": vistoria_id}, {"$set": update_data})

    updated = await db.container_vistorias.find_one({"id": vistoria_id}, {"_id": 0})
    pre_registered = await _pre_register_cadastros(updated, current_user)
    return ContainerVistoriaResponse(**updated, pre_registered=pre_registered)

@api_router.post("/container-vistorias/{vistoria_id}/upload-photo")
async def upload_container_vistoria_photo(
    vistoria_id: str,
    photo_type: str = Query(..., alias="type", pattern="^(front|back|left|right|internal|csc_plate)$"),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_active_user)
):
    """Faz upload de uma foto para uma vistoria de container (até MAX_VISTORIA_PHOTOS fotos, cada uma com um tipo)"""
    vistoria = await db.container_vistorias.find_one({"id": vistoria_id}, {"_id": 0, "photos": 1})
    if not vistoria:
        raise HTTPException(status_code=404, detail="Vistoria de container não encontrada")

    existing_photos = vistoria.get("photos") or []
    if len(existing_photos) >= MAX_VISTORIA_PHOTOS:
        raise HTTPException(status_code=400, detail=f"Limite de {MAX_VISTORIA_PHOTOS} fotos por vistoria atingido")

    file_ext, content = await validate_and_read_upload(file, ALLOWED_EXTENSIONS)

    photo_dir = UPLOADS_DIR / "container_vistorias" / vistoria_id
    photo_dir.mkdir(parents=True, exist_ok=True)

    photo_id = str(uuid.uuid4())
    file_path = photo_dir / f"{photo_id}{file_ext}"
    with open(file_path, "wb") as buffer:
        buffer.write(content)

    photo_url = f"/api/uploads/container_vistorias/{vistoria_id}/{photo_id}{file_ext}"
    photo_entry = {"id": photo_id, "type": photo_type, "url": photo_url}
    # $push (e não regravar a lista lida acima): a tela envia as fotos em
    # paralelo, e regravar a lista fazia um envio apagar a foto do outro.
    result = await db.container_vistorias.update_one(
        {"id": vistoria_id, f"photos.{MAX_VISTORIA_PHOTOS - 1}": {"$exists": False}},
        {"$push": {"photos": photo_entry}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.modified_count == 0:
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Limite de {MAX_VISTORIA_PHOTOS} fotos por vistoria atingido")

    return photo_entry

@api_router.delete("/container-vistorias/{vistoria_id}/photo/{photo_id}")
async def delete_container_vistoria_photo(
    vistoria_id: str,
    photo_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Remove uma foto de uma vistoria de container"""
    vistoria = await db.container_vistorias.find_one({"id": vistoria_id}, {"_id": 0, "photos": 1})
    if not vistoria:
        raise HTTPException(status_code=404, detail="Vistoria de container não encontrada")

    existing_photos = vistoria.get("photos") or []
    remaining_photos = [p for p in existing_photos if p["id"] != photo_id]
    if len(remaining_photos) == len(existing_photos):
        raise HTTPException(status_code=404, detail="Foto não encontrada")

    photo_dir = UPLOADS_DIR / "container_vistorias" / vistoria_id
    for file_path in photo_dir.glob(f"{photo_id}.*"):
        file_path.unlink()

    # $pull: não regravar a lista inteira (um envio em andamento sumiria)
    await db.container_vistorias.update_one(
        {"id": vistoria_id},
        {"$pull": {"photos": {"id": photo_id}}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )

    return {"message": "Foto removida com sucesso"}

@api_router.delete("/container-vistorias/{vistoria_id}")
async def delete_container_vistoria(
    vistoria_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Exclui uma vistoria de container"""
    vistoria = await db.container_vistorias.find_one({"id": vistoria_id}, {"_id": 0})
    if not vistoria:
        raise HTTPException(status_code=404, detail="Vistoria de container não encontrada")

    try:
        photo_dir = UPLOADS_DIR / "container_vistorias" / vistoria_id
        if photo_dir.exists():
            shutil.rmtree(photo_dir)
    except Exception:
        pass

    await db.container_vistorias.delete_one({"id": vistoria_id})

    return {"message": "Vistoria de container excluída com sucesso"}
