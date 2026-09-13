from fastapi import APIRouter, Depends, HTTPException
from typing import List

from models import ContainerRepairService, ContainerRepairServiceCreate, ContainerRepairServiceResponse
from shared import db, get_current_active_user, get_current_admin_user

api_router = APIRouter(prefix="/api")

# ==================== TIPO DE SERVIÇOS (VISTORIA DE CONTAINER) ====================
# Catálogo de serviços de reparo, usado no campo de busca "Tipo de Serviços" da
# Vistoria de Container. Aberto (GET) a qualquer usuário ativo - precisa
# aparecer no autocomplete de Novo/Editar Movimentação pra quem não é admin.


@api_router.get("/container-repair-services", response_model=List[ContainerRepairServiceResponse])
async def list_container_repair_services(current_user: dict = Depends(get_current_active_user)):
    rows = await db.container_repair_services.find({}, {"_id": 0}).sort("name", 1).to_list(None)
    return rows


@api_router.post("/container-repair-services", response_model=ContainerRepairServiceResponse)
async def create_container_repair_service(data: ContainerRepairServiceCreate, current_user: dict = Depends(get_current_admin_user)):
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nome do serviço não pode ser vazio")
    existing = await db.container_repair_services.find_one({"name": name}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Já existe um serviço com esse nome")

    service = ContainerRepairService(name=name, created_by=current_user["sub"])
    doc = service.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    await db.container_repair_services.insert_one(doc)
    return doc


@api_router.delete("/container-repair-services/{service_id}")
async def delete_container_repair_service(service_id: str, current_user: dict = Depends(get_current_admin_user)):
    result = await db.container_repair_services.delete_one({"id": service_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Serviço não encontrado")
    return {"message": "Serviço removido"}
