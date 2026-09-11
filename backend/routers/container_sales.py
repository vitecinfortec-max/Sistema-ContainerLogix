from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException

from models import (
    CONTAINER_SALE_STATUS_OPTIONS,
    ContainerSale, ContainerSaleCreate, ContainerSaleUpdate, ContainerSaleResponse,
)
from shared import db, get_current_admin_user, round_money, parse_datetime_value

api_router = APIRouter(prefix="/api")

# ==================== REGISTRO DE VENDA (GESTÃO DE CONTAINER) ====================
# Lançamento gerado automaticamente quando uma Ordem de Entrega é Aprovada
# (ver create_sale_records_for_order, chamado de loading_orders.py), mas
# também aceita lançamento manual. Ao criar, tenta vincular à Compra de
# Container Disponível mais recente desse mesmo container - se achar, copia
# Booking/Terminal/Data de Entrada dela (não da própria Ordem de Entrega) e
# marca a Compra como Vendida; se não achar, cria mesmo assim com esses 3
# campos em branco (decisão explícita do usuário - nunca bloqueia).


async def _create_container_sale(
    data: ContainerSaleCreate,
    current_user: dict,
    loading_order_id: Optional[str] = None,
    order_number: Optional[int] = None,
    movement_id: Optional[str] = None,
) -> ContainerSaleResponse:
    container_number = data.container_number.strip().upper()

    # Compra DISPONIVEL mais recente desse container - cobre o caso raro de
    # um mesmo container ser comprado/vendido/comprado de novo ao longo do
    # tempo.
    purchase = await db.container_purchases.find_one(
        {"container_number": container_number, "status": "DISPONIVEL"},
        {"_id": 0}, sort=[("created_at", -1)]
    )

    sale = ContainerSale(
        container_number=container_number,
        booking=purchase.get('booking') if purchase else data.booking,
        origin_terminal=purchase.get('origin_terminal') if purchase else data.origin_terminal,
        entry_date=(parse_datetime_value(purchase['entry_date']) if purchase.get('entry_date') else None) if purchase else data.entry_date,
        purchase_id=purchase['id'] if purchase else None,
        representative_id=data.representative_id,
        representative_name=data.representative_name,
        sale_value=round_money(data.sale_value) if data.sale_value is not None else None,
        received_value=round_money(data.received_value) if data.received_value is not None else None,
        loading_order_id=loading_order_id,
        order_number=order_number,
        movement_id=movement_id,
        observations=data.observations,
        created_by=current_user['sub'],
        created_by_name=current_user['name'],
    )
    doc = sale.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    if doc.get('entry_date'):
        doc['entry_date'] = doc['entry_date'].isoformat()
    await db.container_sales.insert_one(doc)

    if purchase:
        await db.container_purchases.update_one(
            {"id": purchase['id']},
            {"$set": {"status": "VENDIDO", "sold_at": datetime.now(timezone.utc).isoformat(), "sale_id": sale.id}}
        )

    return ContainerSaleResponse(**sale.model_dump())


async def create_sale_records_for_order(order: dict, current_user: dict) -> List[dict]:
    """Gera um Registro de Venda por container de uma Ordem de Entrega
    recém-Aprovada. Chamado DEPOIS de create_movements_for_loading_order."""
    if order.get('order_type') != 'ENTREGA':
        return []

    results = []
    for item in (order.get('items') or []):
        container_number = (item.get('container_number') or '').strip().upper()
        if not container_number:
            continue

        existing = await db.container_sales.find_one(
            {"loading_order_id": order['id'], "container_number": container_number}, {"_id": 0}
        )
        if existing:
            results.append(existing)
            continue

        movement = await db.movements.find_one(
            {"loading_order_id": order['id'], "container_number": container_number, "operation_type": "SAIDA"},
            {"_id": 0}
        )
        payload = ContainerSaleCreate(
            container_number=container_number,
            representative_id=order.get('representative_id'),
            representative_name=order.get('representative_name'),
        )
        response = await _create_container_sale(
            payload, current_user,
            loading_order_id=order['id'], order_number=order.get('order_number'),
            movement_id=movement['id'] if movement else None,
        )
        results.append(response.model_dump())
    return results


@api_router.post("/container-sales", response_model=ContainerSaleResponse)
async def create_container_sale(data: ContainerSaleCreate, current_user: dict = Depends(get_current_admin_user)):
    """Lançamento manual - container vendido fora do fluxo de Ordem de
    Carregamento."""
    return await _create_container_sale(data, current_user)


@api_router.get("/container-sales", response_model=List[ContainerSaleResponse])
async def list_container_sales(
    status: Optional[str] = None,
    container_number: Optional[str] = None,
    representative_id: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    query = {}
    if status:
        query['status'] = status
    if representative_id:
        query['representative_id'] = representative_id
    if container_number:
        import re
        query['container_number'] = {"$regex": re.escape(container_number.strip().upper()), "$options": "i"}
    rows = await db.container_sales.find(query, {"_id": 0}).sort("created_at", -1).to_list(None)
    return rows


@api_router.get("/container-sales/{sale_id}", response_model=ContainerSaleResponse)
async def get_container_sale(sale_id: str, current_user: dict = Depends(get_current_admin_user)):
    doc = await db.container_sales.find_one({"id": sale_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Registro de Venda não encontrado")
    return doc


@api_router.put("/container-sales/{sale_id}/status")
async def update_container_sale_status(sale_id: str, status: str, current_user: dict = Depends(get_current_admin_user)):
    """Atualiza o status do registro (Pendente/Recebido) - mesmo padrão de
    PUT /freight-payments/{id}/status."""
    if status not in CONTAINER_SALE_STATUS_OPTIONS:
        raise HTTPException(status_code=400, detail="Status inválido")

    sale = await db.container_sales.find_one({"id": sale_id}, {"_id": 0})
    if not sale:
        raise HTTPException(status_code=404, detail="Registro de Venda não encontrado")

    old_status = sale.get('status', 'PENDENTE')
    update_data = {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}
    if status == 'RECEBIDO':
        update_data['received_at'] = datetime.now(timezone.utc).isoformat()
    elif old_status == 'RECEBIDO' and status != 'RECEBIDO':
        update_data['received_at'] = None

    await db.container_sales.update_one({"id": sale_id}, {"$set": update_data})
    return {"message": "Status atualizado com sucesso"}


@api_router.put("/container-sales/{sale_id}", response_model=ContainerSaleResponse)
async def update_container_sale(sale_id: str, data: ContainerSaleUpdate, current_user: dict = Depends(get_current_admin_user)):
    """Edita os dados de uma Venda - status/purchase_id/loading_order_id
    nunca são tocados aqui."""
    existing = await db.container_sales.find_one({"id": sale_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Registro de Venda não encontrado")

    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if update_data.get('container_number'):
        update_data['container_number'] = update_data['container_number'].strip().upper()
    if 'sale_value' in update_data:
        update_data['sale_value'] = round_money(update_data['sale_value'])
    if 'received_value' in update_data:
        update_data['received_value'] = round_money(update_data['received_value'])
    if update_data.get('entry_date'):
        update_data['entry_date'] = update_data['entry_date'].isoformat()
    update_data['updated_at'] = datetime.now(timezone.utc).isoformat()

    await db.container_sales.update_one({"id": sale_id}, {"$set": update_data})
    updated = await db.container_sales.find_one({"id": sale_id}, {"_id": 0})
    return updated


@api_router.delete("/container-sales/{sale_id}")
async def delete_container_sale(sale_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Exclusão manual - não reverte a Compra vinculada (se houver) de volta
    pra Disponível, ela fica marcada como Vendida mesmo sem a Venda."""
    result = await db.container_sales.delete_one({"id": sale_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Registro de Venda não encontrado")
    return {"message": "Registro de Venda removido"}
