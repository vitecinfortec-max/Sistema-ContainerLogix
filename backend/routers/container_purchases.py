import math
import re
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


def _clean_container_number(value: Optional[str]) -> str:
    number = (value or '').strip().upper()
    if not number:
        raise HTTPException(status_code=400, detail="Informe o número do container")
    return number


def _refuse_negative_values(values: dict):
    for field, label in (("purchase_value", "Valor de Compra"), ("sale_value", "Valor de Venda"),
                         ("received_value", "Valor Recebido")):
        value = values.get(field)
        if value is not None and (not math.isfinite(value) or value < 0):
            raise HTTPException(status_code=400, detail=f"{label} não pode ser negativo")


async def _refuse_duplicate_available(container_number: str, exclude_id: Optional[str] = None):
    """Dois registros Disponíveis do mesmo container deixavam a Venda escolher
    um deles no chute (vincula a mais recente) e o outro ficava Disponível
    pra sempre."""
    query = {"container_number": container_number, "status": "DISPONIVEL"}
    if exclude_id:
        query["id"] = {"$ne": exclude_id}
    if await db.container_purchases.find_one(query, {"_id": 1}):
        raise HTTPException(
            status_code=409,
            detail=f"Já existe uma Compra Disponível do container {container_number}. Edite a existente em vez de lançar outra.",
        )


async def _create_container_purchase(
    data: ContainerPurchaseCreate,
    current_user: dict,
    loading_order_id: Optional[str] = None,
    order_number: Optional[int] = None,
    movement_id: Optional[str] = None,
) -> ContainerPurchaseResponse:
    purchase = ContainerPurchase(
        container_number=_clean_container_number(data.container_number),
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
    _refuse_negative_values(data.model_dump())
    await _refuse_duplicate_available(_clean_container_number(data.container_number))
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
        # O campo de busca da tela serve pro container ou pro booking
        rx = {"$regex": re.escape(container_number.strip()), "$options": "i"}
        query['$or'] = [{"container_number": rx}, {"booking": rx}]
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

    # Campo enviado vazio (null) apaga o valor salvo; antes era ignorado e não
    # dava pra limpar um valor ou observação. Só o container é obrigatório.
    update_data = data.model_dump(exclude_unset=True)
    if 'container_number' in update_data:
        number = _clean_container_number(update_data['container_number'])
        if number != existing.get('container_number'):
            if existing.get('loading_order_id'):
                raise HTTPException(status_code=400, detail="O container de uma compra gerada pela Ordem de Coleta não pode ser trocado")
            if existing.get('status') == 'VENDIDO':
                raise HTTPException(status_code=400, detail="Esta compra já está vinculada a uma Venda: o container não pode ser trocado")
            await _refuse_duplicate_available(number, exclude_id=purchase_id)
        update_data['container_number'] = number
    _refuse_negative_values(update_data)
    for field in ('purchase_value', 'sale_value'):
        if update_data.get(field) is not None:
            update_data[field] = round_money(update_data[field])
    if update_data.get('entry_date'):
        update_data['entry_date'] = update_data['entry_date'].isoformat()
    update_data['updated_at'] = datetime.now(timezone.utc).isoformat()

    await db.container_purchases.update_one({"id": purchase_id}, {"$set": update_data})
    updated = await db.container_purchases.find_one({"id": purchase_id}, {"_id": 0})
    return updated


@api_router.delete("/container-purchases/{purchase_id}")
async def delete_container_purchase(purchase_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Exclusão manual. Compra já vinculada a uma Venda não sai: a Venda
    ficaria apontando pra uma compra que não existe (e com Booking/Terminal/
    Data de Entrada copiados dela)."""
    existing = await db.container_purchases.find_one({"id": purchase_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Compra de Container não encontrada")
    if existing.get('sale_id') and await db.container_sales.find_one({"id": existing['sale_id']}, {"_id": 1}):
        raise HTTPException(
            status_code=409,
            detail="Esta compra está vinculada a um Registro de Venda. Exclua a venda antes, se for o caso.",
        )
    result = await db.container_purchases.delete_one({"id": purchase_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Compra de Container não encontrada")
    return {"message": "Compra de Container removida"}
