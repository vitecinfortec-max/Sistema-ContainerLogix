from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from models import ContainerRepresentative, ContainerRepresentativeCreate, ContainerRepresentativeResponse
from shared import db, get_current_active_user, get_current_admin_user

api_router = APIRouter(prefix="/api")

# ==================== CADASTRO DE REPRESENTANTES (GESTÃO DE CONTAINER) ====================
# Separado de propósito do "Representative" do grupo Comercial (comissão %
# sobre faturamento) - este é usado como "vendedor" no Registro de Venda,
# comissão fixa por venda. Ver [[project_freight_route_payment_feature]]
# pro precedente de cadastro dedicado sob um grupo de menu próprio.


@api_router.post("/container-representatives", response_model=ContainerRepresentativeResponse)
async def create_container_representative(data: ContainerRepresentativeCreate, current_user: dict = Depends(get_current_admin_user)):
    representative = ContainerRepresentative(**data.model_dump(), created_by=current_user['sub'])

    doc = representative.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.container_representatives.insert_one(doc)

    return ContainerRepresentativeResponse(**representative.model_dump())


@api_router.get("/container-representatives", response_model=List[ContainerRepresentativeResponse])
async def get_container_representatives(current_user: dict = Depends(get_current_active_user)):
    rows = await db.container_representatives.find({}, {"_id": 0}).sort("name", 1).to_list(None)
    return [
        ContainerRepresentativeResponse(**{**r, "created_at": datetime.fromisoformat(r['created_at'])})
        for r in rows
    ]


@api_router.put("/container-representatives/{representative_id}", response_model=ContainerRepresentativeResponse)
async def update_container_representative(representative_id: str, data: ContainerRepresentativeCreate, current_user: dict = Depends(get_current_admin_user)):
    existing = await db.container_representatives.find_one({"id": representative_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Representante não encontrado")

    update_data = {
        **data.model_dump(),
        "id": representative_id,
        "created_at": existing['created_at'],
        "created_by": existing['created_by'],
    }

    await db.container_representatives.replace_one({"id": representative_id}, update_data)

    return ContainerRepresentativeResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})


@api_router.delete("/container-representatives/{representative_id}")
async def delete_container_representative(representative_id: str, current_user: dict = Depends(get_current_admin_user)):
    result = await db.container_representatives.delete_one({"id": representative_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Representante não encontrado")
    return {"message": "Representante deletado com sucesso"}
