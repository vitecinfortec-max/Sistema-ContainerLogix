from datetime import datetime, timezone
import uuid
import shutil

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query

from models import (
    ContainerVistoriaPhoto, ContainerVistoria, ContainerVistoriaCreate,
    ContainerVistoriaUpdate, ContainerVistoriaResponse, MAX_VISTORIA_PHOTOS,
)

from shared import (
    db, get_current_active_user, validate_and_read_upload, ALLOWED_EXTENSIONS,
    UPLOADS_DIR,
)

api_router = APIRouter(prefix="/api")

# ========== VISTORIA DE CONTAINER ==========

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

    return ContainerVistoriaResponse(**vistoria_dict)

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
        "trailer_plate", "transport_company", "size_type", "tare",
        "no_damage", "damage_items", "observations",
    ):
        value = getattr(data, field)
        if value is not None:
            update_data[field] = value

    if update_data:
        update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.container_vistorias.update_one({"id": vistoria_id}, {"$set": update_data})

    updated = await db.container_vistorias.find_one({"id": vistoria_id}, {"_id": 0})
    return ContainerVistoriaResponse(**updated)

@api_router.post("/container-vistorias/{vistoria_id}/upload-photo")
async def upload_container_vistoria_photo(
    vistoria_id: str,
    photo_type: str = Query(..., alias="type", regex="^(front|back|left|right|internal)$"),
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
    await db.container_vistorias.update_one(
        {"id": vistoria_id},
        {"$set": {"photos": existing_photos + [photo_entry], "updated_at": datetime.now(timezone.utc).isoformat()}}
    )

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

    await db.container_vistorias.update_one(
        {"id": vistoria_id},
        {"$set": {"photos": remaining_photos, "updated_at": datetime.now(timezone.utc).isoformat()}}
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
