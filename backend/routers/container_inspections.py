from datetime import datetime, timezone
import asyncio
import io
import shutil
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from typing import Optional

from models import (
    ContainerInspection, ContainerInspectionCreate, ContainerInspectionUpdate,
    ContainerInspectionResponse, MAX_CONTAINER_INSPECTION_PHOTOS
)

from list_filters import combine, period_query, text_query
from reports import generate_container_photo_document_pdf, photo_document_filename
from routers.container_vistorias import DAMAGE_PATTERN, damage_query

from shared import (
    db, get_current_active_user, migrate_inspection_photos, validate_and_read_upload,
    ALLOWED_EXTENSIONS, UPLOADS_DIR, get_company_settings,
)

api_router = APIRouter(prefix="/api")

# ========== REGISTRO FOTOGRÁFICO ==========

INSPECTION_SEARCH_FIELDS = ("container_number", "client_name", "booking", "shipping_line_name", "container_seal")


def inspection_query(search=None, date_from=None, date_to=None, damage=None) -> dict:
    return combine(text_query(INSPECTION_SEARCH_FIELDS, search), period_query("created_at", date_from, date_to), damage_query(damage))

@api_router.get("/container-inspections")
async def list_container_inspections(
    page: int = 1,
    per_page: int = 20,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    damage: Optional[str] = Query(None, pattern=DAMAGE_PATTERN),
    current_user: dict = Depends(get_current_active_user)
):
    """Lista os registros fotográficos de container, com busca e período feitos no banco"""
    skip = (page - 1) * per_page
    query = inspection_query(search, date_from, date_to, damage)

    total = await db.container_inspections.count_documents(query)
    inspections = await db.container_inspections.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page).to_list(per_page)
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
    """Obtém um registro fotográfico de container pelo ID"""
    inspection = await db.container_inspections.find_one({"id": inspection_id}, {"_id": 0})
    if not inspection:
        raise HTTPException(status_code=404, detail="Registro fotográfico de container não encontrado")
    return ContainerInspectionResponse(**migrate_inspection_photos(inspection))

@api_router.get("/container-inspections/{inspection_id}/pdf")
async def download_container_inspection_pdf(inspection_id: str, current_user: dict = Depends(get_current_active_user)):
    """PDF do registro fotográfico (o mesmo documento da impressão), pro download em lote da lista"""
    inspection = await db.container_inspections.find_one({"id": inspection_id}, {"_id": 0})
    if not inspection:
        raise HTTPException(status_code=404, detail="Registro fotográfico de container não encontrado")
    inspection = migrate_inspection_photos(inspection)
    company = await get_company_settings()
    # Fora do loop de eventos: abrir e reduzir as fotos leva alguns segundos
    pdf_bytes = await asyncio.to_thread(generate_container_photo_document_pdf, inspection, 'inspection', company, UPLOADS_DIR)
    filename = photo_document_filename('RegistroFotografico', inspection.get('container_number'), inspection.get('inspection_number'))
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@api_router.post("/container-inspections", response_model=ContainerInspectionResponse)
async def create_container_inspection(
    data: ContainerInspectionCreate,
    current_user: dict = Depends(get_current_active_user)
):
    """Cria um novo registro fotográfico de container"""
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
    """Atualiza um registro fotográfico de container"""
    inspection = await db.container_inspections.find_one({"id": inspection_id}, {"_id": 0})
    if not inspection:
        raise HTTPException(status_code=404, detail="Registro fotográfico de container não encontrado")
    
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
    photo_type: str = Query(..., alias="type", pattern="^(front|back|left|right|internal)$"),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_active_user)
):
    """Faz upload de uma foto para um registro fotográfico de container (até 8 fotos, cada uma com um tipo)"""
    inspection = await db.container_inspections.find_one({"id": inspection_id}, {"_id": 0})
    if not inspection:
        raise HTTPException(status_code=404, detail="Registro fotográfico de container não encontrado")

    if not inspection.get("photos"):
        # Registro antigo (photo_front/back/...): grava a lista convertida uma
        # vez, só se ninguém gravou fotos nesse meio tempo, pra o $push abaixo
        # partir dela.
        legacy = migrate_inspection_photos(dict(inspection))["photos"]
        if legacy:
            await db.container_inspections.update_one(
                {"id": inspection_id, "$or": [{"photos": {"$exists": False}}, {"photos": None}, {"photos": []}]},
                {"$set": {"photos": legacy}}
            )
        inspection["photos"] = legacy
    if len(inspection["photos"]) >= MAX_CONTAINER_INSPECTION_PHOTOS:
        raise HTTPException(status_code=400, detail=f"Limite de {MAX_CONTAINER_INSPECTION_PHOTOS} fotos por registro atingido")

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
    # $push (e não regravar a lista lida lá em cima): a tela de novo registro
    # envia as fotos em paralelo, e duas requisições que leram a mesma lista
    # apagavam a foto uma da outra. O filtro garante o limite mesmo assim.
    result = await db.container_inspections.update_one(
        {"id": inspection_id, f"photos.{MAX_CONTAINER_INSPECTION_PHOTOS - 1}": {"$exists": False}},
        {"$push": {"photos": photo_entry}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.modified_count == 0:
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Limite de {MAX_CONTAINER_INSPECTION_PHOTOS} fotos por registro atingido")

    return photo_entry

@api_router.delete("/container-inspections/{inspection_id}/photo/{photo_id}")
async def delete_container_inspection_photo(
    inspection_id: str,
    photo_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Remove uma foto de um registro fotográfico de container"""
    inspection = await db.container_inspections.find_one({"id": inspection_id}, {"_id": 0})
    if not inspection:
        raise HTTPException(status_code=404, detail="Registro fotográfico de container não encontrado")

    stored_has_list = bool(inspection.get("photos"))
    inspection = migrate_inspection_photos(inspection)
    inspection["photos_migrated_on_read"] = not stored_has_list
    remaining_photos = [p for p in inspection["photos"] if p["id"] != photo_id]
    if len(remaining_photos) == len(inspection["photos"]):
        raise HTTPException(status_code=404, detail="Foto não encontrada")

    # Remover arquivo
    photo_dir = UPLOADS_DIR / "container_inspections" / inspection_id
    for file_path in photo_dir.glob(f"{photo_id}.*"):
        file_path.unlink()

    # $pull pelo mesmo motivo do $push no envio: não regravar a lista inteira
    # (registro antigo, ainda sem a lista gravada, recebe a lista convertida)
    if inspection.get("photos_migrated_on_read"):
        update = {"$set": {"photos": remaining_photos}}
    else:
        update = {"$pull": {"photos": {"id": photo_id}}}
    update.setdefault("$set", {})["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.container_inspections.update_one({"id": inspection_id}, update)

    return {"message": "Foto removida com sucesso"}

@api_router.delete("/container-inspections/{inspection_id}")
async def delete_container_inspection(
    inspection_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Exclui um registro fotográfico de container"""
    inspection = await db.container_inspections.find_one({"id": inspection_id}, {"_id": 0})
    if not inspection:
        raise HTTPException(status_code=404, detail="Registro fotográfico de container não encontrado")
    
    # Remover diretório de fotos
    try:
        photo_dir = UPLOADS_DIR / "container_inspections" / inspection_id
        if photo_dir.exists():
            shutil.rmtree(photo_dir)
    except Exception:
        pass
    
    await db.container_inspections.delete_one({"id": inspection_id})
    
    return {"message": "Registro fotográfico de container excluído com sucesso"}

