from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException

from models import ContainerPurchase, ContainerPurchaseCreate, ContainerPurchaseUpdate, ContainerPurchaseResponse
from shared import db, get_current_admin_user, round_money, parse_datetime_value

api_router = APIRouter(prefix="/api")

# ==================== COMPRA DE CONTAINER (GESTÃO DE CONTAINER) ====================
# Lançamento gerado automaticamente quando uma Ordem de Coleta é Aprovada
# (ver create_purchase_records_for_order, chamado de loading_orders.py),
# mas também aceita lançamento manual (container comprado fora do fluxo de
# Ordem de Carregamento) - os dois caminhos passam por
# _create_container_purchase, mesmo raciocínio de _create_container_movement
# em movements.py.


async def _create_container_purchase(
    data: ContainerPurchaseCreate,
    current_user: dict,
    loading_order_id: Optional[str] = None,
    order_number: Optional[int] = None,
    movement_id: Optional[str] = None,
) -> ContainerPurchaseResponse:
    purchase = ContainerPurchase(
        container_number=data.container_number.strip().upper(),
        booking=data.booking,
        origin_terminal=data.origin_terminal,
        entry_date=data.entry_date,
        purchase_value=round_money(data.purchase_value) if data.purchase_value is not None else None,
        sale_value=round_money(data.sale_value) if data.sale_value is not None else None,
        observations=data.observations,
        loading_order_id=loading_order_id,
        order_number=order_number,
        movement_id=movement_id,
        created_by=current_user['sub'],
        created_by_name=current_user['name'],
    )
    doc = purchase.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    if doc.get('entry_date'):
        doc['entry_date'] = doc['entry_date'].isoformat()
    await db.container_purchases.insert_one(doc)

    return ContainerPurchaseResponse(**purchase.model_dump())


async def create_purchase_records_for_order(order: dict, current_user: dict) -> List[dict]:
    """Gera uma Compra de Container por container de uma Ordem de Coleta
    recém-Aprovada. Chamado DEPOIS de create_movements_for_loading_order
    (movements.py), pra poder ler a movimentação ENTRADA recém-criada e
    usar seu created_at real como Data de Entrada."""
    if order.get('order_type') != 'COLETA':
        return []

    results = []
    for item in (order.get('items') or []):
        container_number = (item.get('container_number') or '').strip().upper()
        if not container_number:
            continue

        existing = await db.container_purchases.find_one(
            {"loading_order_id": order['id'], "container_number": container_number}, {"_id": 0}
        )
        if existing:
            results.append(existing)
            continue

        movement = await db.movements.find_one(
            {"loading_order_id": order['id'], "container_number": container_number, "operation_type": "ENTRADA"},
            {"_id": 0}
        )
        payload = ContainerPurchaseCreate(
            container_number=container_number,
            booking=order.get('booking'),
            origin_terminal=order.get('origin_terminal'),
            entry_date=parse_datetime_value(movement['created_at']) if movement else None,
        )
        response = await _create_container_purchase(
            payload, current_user,
            loading_order_id=order['id'], order_number=order.get('order_number'),
            movement_id=movement['id'] if movement else None,
        )
        results.append(response.model_dump())
    return results


@api_router.post("/container-purchases", response_model=ContainerPurchaseResponse)
async def create_container_purchase(data: ContainerPurchaseCreate, current_user: dict = Depends(get_current_admin_user)):
    """Lançamento manual - container comprado fora do fluxo de Ordem de
    Carregamento (ex: compra em lote direto de um corretor)."""
    return await _create_container_purchase(data, current_user)


@api_router.get("/container-purchases", response_model=List[ContainerPurchaseResponse])
async def list_container_purchases(
    status: Optional[str] = None,
    container_number: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    query = {}
    if status:
        query['status'] = status
    if container_number:
        import re
        query['container_number'] = {"$regex": re.escape(container_number.strip().upper()), "$options": "i"}
    rows = await db.container_purchases.find(query, {"_id": 0}).sort("created_at", -1).to_list(None)
    return rows


@api_router.get("/container-purchases/{purchase_id}", response_model=ContainerPurchaseResponse)
async def get_container_purchase(purchase_id: str, current_user: dict = Depends(get_current_admin_user)):
    doc = await db.container_purchases.find_one({"id": purchase_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Compra de Container não encontrada")
    return doc


@api_router.put("/container-purchases/{purchase_id}", response_model=ContainerPurchaseResponse)
async def update_container_purchase(purchase_id: str, data: ContainerPurchaseUpdate, current_user: dict = Depends(get_current_admin_user)):
    """Edita os dados de uma Compra - status/loading_order_id/sale_id nunca
    são tocados aqui, só mudam pelo vínculo automático com uma Venda."""
    existing = await db.container_purchases.find_one({"id": purchase_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Compra de Container não encontrada")

    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if update_data.get('container_number'):
        update_data['container_number'] = update_data['container_number'].strip().upper()
    if 'purchase_value' in update_data:
        update_data['purchase_value'] = round_money(update_data['purchase_value'])
    if 'sale_value' in update_data:
        update_data['sale_value'] = round_money(update_data['sale_value'])
    if update_data.get('entry_date'):
        update_data['entry_date'] = update_data['entry_date'].isoformat()
    update_data['updated_at'] = datetime.now(timezone.utc).isoformat()

    await db.container_purchases.update_one({"id": purchase_id}, {"$set": update_data})
    updated = await db.container_purchases.find_one({"id": purchase_id}, {"_id": 0})
    return updated
