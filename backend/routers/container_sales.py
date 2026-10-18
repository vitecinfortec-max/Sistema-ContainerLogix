import math
import re
import uuid
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
    container_number = _clean_container_number(data.container_number)
    sale_id = str(uuid.uuid4())

    # Compra DISPONIVEL mais recente desse container - cobre o caso raro de
    # um mesmo container ser comprado/vendido/comprado de novo ao longo do
    # tempo. Já é marcada como Vendida nesse mesmo passo: duas vendas ao
    # mesmo tempo liam a mesma compra Disponível e as duas se vinculavam a ela.
    purchase = await db.container_purchases.find_one_and_update(
        {"container_number": container_number, "status": "DISPONIVEL"},
        {"$set": {"status": "VENDIDO", "sold_at": datetime.now(timezone.utc).isoformat(), "sale_id": sale_id}},
        projection={"_id": 0}, sort=[("created_at", -1)],
    )

    sale = ContainerSale(
        id=sale_id,
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
    try:
        await db.container_sales.insert_one(doc)
    except BaseException:
        await release_purchase_of_sale(doc)
        raise

    return ContainerSaleResponse(**sale.model_dump())


def _clean_container_number(value: Optional[str]) -> str:
    number = (value or '').strip().upper()
    if not number:
        raise HTTPException(status_code=400, detail="Informe o número do container")
    return number


def _refuse_negative_values(values: dict):
    for field, label in (("sale_value", "Valor da Venda"), ("received_value", "Valor Recebido")):
        value = values.get(field)
        if value is not None and (not math.isfinite(value) or value < 0):
            raise HTTPException(status_code=400, detail=f"{label} não pode ser negativo")


async def release_purchase_of_sale(sale: dict):
    """A Compra que a venda tinha marcado como Vendida volta a ficar
    Disponível (só se ainda for desta venda)."""
    if not sale.get('purchase_id'):
        return
    await db.container_purchases.update_one(
        {"id": sale['purchase_id'], "sale_id": sale['id']},
        {"$set": {"status": "DISPONIVEL", "sold_at": None, "sale_id": None}},
    )


async def unlink_sales_of_purchase(purchase: dict):
    """A Compra deixou de existir: a Venda vinculada a ela fica sem vínculo
    (mantém Booking/Terminal/Data de Entrada já copiados)."""
    if purchase.get('sale_id'):
        await db.container_sales.update_one(
            {"id": purchase['sale_id'], "purchase_id": purchase['id']}, {"$set": {"purchase_id": None}},
        )


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
    _refuse_negative_values(data.model_dump())
    await _check_representative(data.representative_id)
    return await _create_container_sale(data, current_user)


async def _check_representative(representative_id: Optional[str]):
    if not representative_id:
        return
    rep = await db.container_representatives.find_one({"id": representative_id}, {"_id": 0, "status": 1})
    if not rep:
        raise HTTPException(status_code=404, detail="Representante não encontrado")
    if rep.get('status') == 'INATIVO':
        raise HTTPException(status_code=400, detail="Este representante está Inativo")


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
        # O campo de busca da tela serve pro container ou pro booking
        rx = {"$regex": re.escape(container_number.strip()), "$options": "i"}
        query['$or'] = [{"container_number": rx}, {"booking": rx}]
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
        # Recebido sem valor deixava o card "Recebido" zerado
        if sale.get('received_value') is None:
            if sale.get('sale_value') is None:
                raise HTTPException(status_code=400, detail="Informe o Valor da Venda (ou o Valor Recebido) antes de marcar como Recebido")
            update_data['received_value'] = sale['sale_value']
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

    # Campo enviado vazio (null) apaga o valor salvo; antes era ignorado e não
    # dava pra limpar um valor ou observação. Só o container é obrigatório.
    update_data = data.model_dump(exclude_unset=True)
    if 'container_number' in update_data:
        number = _clean_container_number(update_data['container_number'])
        if number != existing.get('container_number'):
            if existing.get('loading_order_id'):
                raise HTTPException(status_code=400, detail="O container de uma venda gerada pela Ordem de Entrega não pode ser trocado")
            if existing.get('purchase_id'):
                raise HTTPException(status_code=400, detail="Esta venda está vinculada a uma Compra: o container não pode ser trocado")
        update_data['container_number'] = number
    _refuse_negative_values(update_data)
    if update_data.get('representative_id') and update_data['representative_id'] != existing.get('representative_id'):
        await _check_representative(update_data['representative_id'])
    for field in ('sale_value', 'received_value'):
        if update_data.get(field) is not None:
            update_data[field] = round_money(update_data[field])
    if (existing.get('status') == 'RECEBIDO' and existing.get('received_value') is not None
            and 'received_value' in update_data and update_data['received_value'] is None):
        raise HTTPException(status_code=400, detail="Venda Recebida precisa do Valor Recebido. Marque como Pendente antes de apagá-lo.")
    if update_data.get('entry_date'):
        update_data['entry_date'] = update_data['entry_date'].isoformat()
    update_data['updated_at'] = datetime.now(timezone.utc).isoformat()

    await db.container_sales.update_one({"id": sale_id}, {"$set": update_data})
    updated = await db.container_sales.find_one({"id": sale_id}, {"_id": 0})
    return updated


@api_router.delete("/container-sales/{sale_id}")
async def delete_container_sale(sale_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Exclusão manual. A Compra vinculada volta a ficar Disponível - antes
    ficava Vendida sem venda nenhuma e o container não podia mais ser vendido
    pelo sistema."""
    removed = await db.container_sales.find_one_and_delete({"id": sale_id}, projection={"_id": 0})
    if not removed:
        raise HTTPException(status_code=404, detail="Registro de Venda não encontrado")
    await release_purchase_of_sale(removed)
    return {"message": "Registro de Venda removido"}
