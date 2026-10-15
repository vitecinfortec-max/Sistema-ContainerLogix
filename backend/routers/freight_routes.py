from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from models import FreightRoute, FreightRouteCreate, FreightRouteResponse
from shared import db, get_current_active_user, get_current_admin_user

api_router = APIRouter(prefix="/api")

# ==================== ROTA (TRANSPORTE) ====================


@api_router.post("/freight-routes", response_model=FreightRouteResponse)
async def create_freight_route(route_input: FreightRouteCreate, current_user: dict = Depends(get_current_admin_user)):
    route = FreightRoute(**route_input.model_dump(), created_by=current_user['sub'])

    doc = route.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.freight_routes.insert_one(doc)

    return FreightRouteResponse(**route.model_dump())


@api_router.get("/freight-routes", response_model=List[FreightRouteResponse])
async def get_freight_routes(current_user: dict = Depends(get_current_active_user)):
    routes = await db.freight_routes.find({}, {"_id": 0}).sort([("origin", 1), ("destination", 1)]).to_list(None)
    return [
        FreightRouteResponse(**{**r, "created_at": datetime.fromisoformat(r['created_at'])})
        for r in routes
    ]


@api_router.put("/freight-routes/{route_id}", response_model=FreightRouteResponse)
async def update_freight_route(route_id: str, route_input: FreightRouteCreate, current_user: dict = Depends(get_current_admin_user)):
    existing = await db.freight_routes.find_one({"id": route_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Rota não encontrada")

    update_data = {
        **route_input.model_dump(),
        "id": route_id,
        "created_at": existing['created_at'],
        "created_by": existing['created_by'],
    }

    await db.freight_routes.replace_one({"id": route_id}, update_data)

    return FreightRouteResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})


@api_router.delete("/freight-routes/{route_id}")
async def delete_freight_route(route_id: str, current_user: dict = Depends(get_current_admin_user)):
    # Rota já usada fica no histórico das ordens e dos pagamentos de frete
    in_use = (await db.loading_orders.count_documents({"route_id": route_id}, limit=1)
              or await db.freight_payments.count_documents({"route_id": route_id}, limit=1))
    if in_use:
        raise HTTPException(status_code=400, detail="Rota já usada em Ordem de Carregamento. Para tirá-la da lista, edite e mude o status para Inativo.")
    result = await db.freight_routes.delete_one({"id": route_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Rota não encontrada")
    return {"message": "Rota deletada com sucesso"}
