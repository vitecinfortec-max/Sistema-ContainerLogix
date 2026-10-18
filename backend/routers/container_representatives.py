from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from models import ContainerRepresentative, ContainerRepresentativeCreate, ContainerRepresentativeResponse
from shared import db, get_current_active_user, get_current_admin_user

api_router = APIRouter(prefix="/api")

# ==================== CADASTRO DE REPRESENTANTES (GESTÃO DE CONTAINER) ====================
# Separado de propósito do "Representative" do grupo Comercial (comissão %
# sobre faturamento) - este é usado como "vendedor" no Registro de Venda,
# comissão fixa por venda. Ver [[project_freight_route_payment_feature]]
# pro precedente de cadastro dedicado sob um grupo de menu próprio.


def _only_digits(value: Optional[str]) -> str:
    return ''.join(ch for ch in (value or '') if ch.isdigit())


async def _validate_representative(data: ContainerRepresentativeCreate, representative_id: Optional[str] = None):
    """Nome obrigatório; CPF/CNPJ não pode repetir entre os representantes
    (compara só os dígitos, como no Cadastro)."""
    data.name = (data.name or '').strip()
    if not data.name:
        raise HTTPException(status_code=400, detail="Informe o nome do representante")
    # PF não guarda CNPJ e PJ não guarda CPF (trocar o tipo deixava o outro documento salvo)
    if data.tipo == 'PF':
        data.cnpj = None
        data.trade_name = None
        data.contact_name = None
    else:
        data.cpf = None
    document = _only_digits(data.cpf if data.tipo == 'PF' else data.cnpj)
    if not document:
        return
    field = 'cpf' if data.tipo == 'PF' else 'cnpj'
    async for other in db.container_representatives.find(
        {field: {"$nin": [None, ""]}, "id": {"$ne": representative_id}}, {"_id": 0, "name": 1, field: 1},
    ):
        if _only_digits(other.get(field)) == document:
            raise HTTPException(
                status_code=400,
                detail=f"Este {field.upper()} já está no representante {other.get('name')}",
            )


@api_router.post("/container-representatives", response_model=ContainerRepresentativeResponse)
async def create_container_representative(data: ContainerRepresentativeCreate, current_user: dict = Depends(get_current_admin_user)):
    await _validate_representative(data)
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
    await _validate_representative(data, representative_id)

    update_data = {
        **data.model_dump(),
        "id": representative_id,
        "created_at": existing['created_at'],
        "created_by": existing['created_by'],
    }

    await db.container_representatives.replace_one({"id": representative_id}, update_data)
    if update_data['name'] != existing.get('name'):
        # O nome fica copiado nas vendas e nas Ordens de Entrega: acompanha a troca
        for collection in (db.container_sales, db.loading_orders):
            await collection.update_many(
                {"representative_id": representative_id}, {"$set": {"representative_name": update_data['name']}},
            )

    return ContainerRepresentativeResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})


@api_router.delete("/container-representatives/{representative_id}")
async def delete_container_representative(representative_id: str, current_user: dict = Depends(get_current_admin_user)):
    in_use = []
    for collection, label in ((db.container_sales, "venda(s)"), (db.loading_orders, "ordem(ns) de carregamento")):
        count = await collection.count_documents({"representative_id": representative_id})
        if count:
            in_use.append(f"{count} {label}")
    if in_use:
        raise HTTPException(
            status_code=409,
            detail=f"Este representante está em uso ({', '.join(in_use)}). Para tirá-lo de uso, mude o Status para Inativo.",
        )
    result = await db.container_representatives.delete_one({"id": representative_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Representante não encontrado")
    return {"message": "Representante deletado com sucesso"}
