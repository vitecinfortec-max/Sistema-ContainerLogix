"""Entrega de EPI's (grupo Almoxarifado): registra a entrega de EPIs do
estoque a um Motorista ou Funcionário, dá baixa no estoque (Saída em
Movimentação de Estoque) e gera o Termo de Entrega e a Ficha de EPI da
pessoa, ambos com a assinatura importada/desenhada no cadastro dela."""
import io
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from models import (
    EpiDelivery, EpiDeliveryCreate, EpiDeliveryResponse,
    StockMovementCreate, StockMovementUpdate, StockMovementItem,
)
from shared import db, get_current_active_user, get_company_settings, signature_file_path
from reports import generate_epi_delivery_pdf, generate_epi_ficha_pdf
from routers.stock import _create_stock_movement, _update_stock_movement

api_router = APIRouter(prefix="/api")

RECIPIENT_COLLECTIONS = {'MOTORISTA': 'drivers', 'FUNCIONARIO': 'employees'}
RECIPIENT_KIND = {'MOTORISTA': 'motorista', 'FUNCIONARIO': 'funcionario'}


async def _load_recipient(recipient_type: str, recipient_id: str) -> dict:
    collection = RECIPIENT_COLLECTIONS.get(recipient_type)
    if not collection:
        raise HTTPException(status_code=400, detail="Tipo de pessoa inválido")
    person = await db[collection].find_one({"id": recipient_id}, {"_id": 0})
    if not person:
        raise HTTPException(status_code=404, detail="Motorista/Funcionário não encontrado")
    return person


async def _load_products(items) -> dict:
    if not items:
        raise HTTPException(status_code=400, detail="Adicione ao menos um EPI à entrega")
    products = {}
    for it in items:
        if not (it.quantity and it.quantity > 0):
            raise HTTPException(status_code=400, detail=f"Quantidade inválida para \"{it.product_description or 'EPI'}\"")
        if it.product_id not in products:
            product = await db.products.find_one({"id": it.product_id}, {"_id": 0})
            if not product:
                raise HTTPException(status_code=404, detail=f"Produto não encontrado: {it.product_description}")
            products[it.product_id] = product
    return products


def _check_balance(items, products: dict, already_taken: Optional[dict] = None):
    """Confere o saldo antes de reservar o número da entrega (senão uma
    entrega recusada por falta de saldo queimaria um número). `already_taken`
    é o que a versão anterior da entrega já baixou, por produto (edição)."""
    requested = {}
    for it in items:
        requested[it.product_id] = requested.get(it.product_id, 0) + float(it.quantity)
    for pid, qty in requested.items():
        available = float(products[pid].get('stock_quantity') or 0) + (already_taken or {}).get(pid, 0)
        if available < qty:
            raise HTTPException(
                status_code=400,
                detail=f"Saldo insuficiente para \"{products[pid]['description']}\": disponível {available:g}, solicitado {qty:g}",
            )


def _normalized_items(items, products: dict):
    out = []
    for it in items:
        p = products[it.product_id]
        out.append({
            "product_id": it.product_id,
            "product_code": p.get('code'),
            "product_description": p.get('description') or it.product_description,
            "unit": p.get('unit') or it.unit,
            "quantity": float(it.quantity),
            "ca_number": (it.ca_number or '').strip() or p.get('ca_number') or None,
        })
    return out


def _movement_payload(delivery_number, data: EpiDeliveryCreate, recipient_name: str, items: list, products: dict, update=False):
    cls = StockMovementUpdate if update else StockMovementCreate
    return cls(
        operation_type="SAIDA",
        movement_date=data.delivery_date,
        warehouse_id=data.warehouse_id,
        warehouse_name=data.warehouse_name,
        purpose_type="OUTRO",
        purpose_text=f"Entrega de EPI Nº {delivery_number} - {recipient_name}",
        observations="Gerada automaticamente pela Entrega de EPI's",
        items=[
            StockMovementItem(
                product_id=it['product_id'],
                product_code=it['product_code'],
                product_description=it['product_description'],
                quantity=it['quantity'],
                unit_value=float(products[it['product_id']].get('reference_value') or 0),
                total_value=round(it['quantity'] * float(products[it['product_id']].get('reference_value') or 0), 2),
            )
            for it in items
        ],
    )


def _recipient_fields(recipient_type: str, person: dict) -> dict:
    return {
        "recipient_name": person.get('name') or '',
        "recipient_cpf": person.get('cpf'),
        "recipient_position": person.get('position') if recipient_type == 'FUNCIONARIO' else 'Motorista',
        "recipient_department": person.get('department') if recipient_type == 'FUNCIONARIO' else None,
        "recipient_code": person.get('employee_code') if recipient_type == 'FUNCIONARIO' else None,
    }


async def _current_signatures(deliveries: list) -> dict:
    """Assinatura atual do cadastro de cada pessoa das entregas - usada quando
    a entrega foi lançada antes de a pessoa ter assinatura cadastrada."""
    out = {}
    for rtype, collection in RECIPIENT_COLLECTIONS.items():
        ids = list({d['recipient_id'] for d in deliveries if d.get('recipient_type') == rtype})
        if not ids:
            continue
        async for p in db[collection].find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "signature_url": 1}):
            out[(rtype, p['id'])] = p.get('signature_url')
    return out


def _serialize(doc: dict, current_signatures: dict) -> dict:
    out = {**doc}
    for f in ('created_at', 'updated_at'):
        if isinstance(out.get(f), str):
            out[f] = datetime.fromisoformat(out[f])
    out['total_quantity'] = round(sum(float(i.get('quantity') or 0) for i in (out.get('items') or [])), 3)
    current = current_signatures.get((out.get('recipient_type'), out.get('recipient_id')))
    out['has_signature'] = bool(out.get('signature_url') or current)
    return out


async def _reverse_stock_movement(movement_id: Optional[str]):
    """Desfaz a Saída gerada pela entrega: devolve as quantidades ao estoque
    e apaga a movimentação."""
    if not movement_id:
        return
    movement = await db.stock_movements.find_one({"id": movement_id}, {"_id": 0})
    if not movement:
        return
    sign = 1 if movement.get('operation_type') == 'SAIDA' else -1
    for it in movement.get('items') or []:
        await db.products.update_one({"id": it['product_id']}, {"$inc": {"stock_quantity": sign * float(it.get('quantity') or 0)}})
    await db.stock_movements.delete_one({"id": movement_id})


@api_router.get("/epi-deliveries/next-number")
async def get_next_epi_delivery_number(current_user: dict = Depends(get_current_active_user)):
    counter = await db.counters.find_one({"_id": "epi_delivery_number"})
    return {"next_number": (counter["seq"] + 1) if counter else 1}


@api_router.get("/epi-deliveries")
async def list_epi_deliveries(
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    recipient_type: Optional[str] = None,
    recipient_id: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user),
):
    query = {}
    if recipient_type:
        query['recipient_type'] = recipient_type
    if recipient_id:
        query['recipient_id'] = recipient_id
    if date_from or date_to:
        query['delivery_date'] = {}
        if date_from:
            query['delivery_date']['$gte'] = date_from
        if date_to:
            query['delivery_date']['$lte'] = date_to
    if search:
        rx = {"$regex": re.escape(search.strip()), "$options": "i"}
        query["$or"] = [
            {"recipient_name": rx}, {"recipient_cpf": rx},
            {"items.product_description": rx}, {"items.ca_number": rx},
        ]
    docs = await db.epi_deliveries.find(query, {"_id": 0}).sort("delivery_number", -1).to_list(None)
    signatures = await _current_signatures(docs)
    return [EpiDeliveryResponse(**_serialize(d, signatures)) for d in docs]


@api_router.get("/epi-deliveries/ficha/pdf")
async def download_epi_ficha_pdf(
    recipient_type: str,
    recipient_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user),
):
    """Ficha de EPI da pessoa: todas as entregas (ou as do período), um EPI
    por linha, cada linha com a assinatura daquela entrega."""
    person = await _load_recipient(recipient_type, recipient_id)
    query = {"recipient_type": recipient_type, "recipient_id": recipient_id}
    if date_from or date_to:
        query['delivery_date'] = {}
        if date_from:
            query['delivery_date']['$gte'] = date_from
        if date_to:
            query['delivery_date']['$lte'] = date_to
    deliveries = await db.epi_deliveries.find(query, {"_id": 0}).sort([("delivery_date", 1), ("delivery_number", 1)]).to_list(None)
    current_sig = signature_file_path(person.get('signature_url'))
    rows = []
    for d in deliveries:
        sig = signature_file_path(d.get('signature_url')) or current_sig
        for it in d.get('items') or []:
            rows.append({**it, "delivery_date": d.get('delivery_date'), "delivery_number": d.get('delivery_number'), "signature_path": sig})
    person_info = {"type": recipient_type, **_recipient_fields(recipient_type, person),
                   "admission_date": person.get('admission_date') if recipient_type == 'FUNCIONARIO' else None}
    company = await get_company_settings()
    pdf_bytes = generate_epi_ficha_pdf(person_info, rows, company=company, date_from=date_from, date_to=date_to)
    safe_name = re.sub(r'[^A-Za-z0-9]+', '_', person.get('name') or 'pessoa').strip('_')
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename=Ficha_EPI_{safe_name}.pdf"})


@api_router.get("/epi-deliveries/{delivery_id}", response_model=EpiDeliveryResponse)
async def get_epi_delivery(delivery_id: str, current_user: dict = Depends(get_current_active_user)):
    doc = await db.epi_deliveries.find_one({"id": delivery_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Entrega de EPI não encontrada")
    signatures = await _current_signatures([doc])
    return EpiDeliveryResponse(**_serialize(doc, signatures))


@api_router.post("/epi-deliveries", response_model=EpiDeliveryResponse)
async def create_epi_delivery(data: EpiDeliveryCreate, current_user: dict = Depends(get_current_active_user)):
    if not data.delivery_date:
        raise HTTPException(status_code=400, detail="Informe a data da entrega")
    if not data.warehouse_id:
        raise HTTPException(status_code=400, detail="Selecione o Almoxarifado")
    person = await _load_recipient(data.recipient_type, data.recipient_id)
    products = await _load_products(data.items)
    _check_balance(data.items, products)
    items = _normalized_items(data.items, products)

    counter = await db.counters.find_one_and_update(
        {"_id": "epi_delivery_number"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True,
    )
    number = counter["seq"]
    recipient = _recipient_fields(data.recipient_type, person)
    delivery_id = str(uuid.uuid4())
    movement = await _create_stock_movement(
        _movement_payload(number, data, recipient['recipient_name'], items, products), current_user,
        origin="EPI", origin_id=delivery_id, origin_label=f"Entrega de EPI Nº {number}",
    )

    delivery = EpiDelivery(
        id=delivery_id,
        delivery_number=number,
        recipient_type=data.recipient_type,
        recipient_id=data.recipient_id,
        **recipient,
        delivery_date=data.delivery_date,
        warehouse_id=data.warehouse_id,
        warehouse_name=data.warehouse_name,
        items=items,
        observations=data.observations,
        signature_url=person.get('signature_url'),
        stock_movement_id=movement['id'],
        stock_movement_number=movement['movement_number'],
        created_by=current_user['sub'],
        created_by_name=current_user['name'],
    )
    doc = delivery.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.epi_deliveries.insert_one(doc)
    doc.pop('_id', None)
    return EpiDeliveryResponse(**_serialize(doc, {(data.recipient_type, data.recipient_id): person.get('signature_url')}))


@api_router.put("/epi-deliveries/{delivery_id}", response_model=EpiDeliveryResponse)
async def update_epi_delivery(delivery_id: str, data: EpiDeliveryCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.epi_deliveries.find_one({"id": delivery_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Entrega de EPI não encontrada")
    if not data.warehouse_id:
        raise HTTPException(status_code=400, detail="Selecione o Almoxarifado")
    person = await _load_recipient(data.recipient_type, data.recipient_id)
    products = await _load_products(data.items)

    movement = None
    if existing.get('stock_movement_id'):
        movement = await db.stock_movements.find_one({"id": existing['stock_movement_id']}, {"_id": 0})
    already_taken = {}
    for it in (movement or {}).get('items') or []:
        already_taken[it['product_id']] = already_taken.get(it['product_id'], 0) + float(it.get('quantity') or 0)
    _check_balance(data.items, products, already_taken)
    items = _normalized_items(data.items, products)
    recipient = _recipient_fields(data.recipient_type, person)
    number = existing['delivery_number']

    if movement:
        # Ajusta a Saída já lançada pela diferença (mesma lógica da edição
        # em Movimentação de Estoque)
        movement = await _update_stock_movement(
            movement['id'], _movement_payload(number, data, recipient['recipient_name'], items, products, update=True), current_user,
        )
    else:
        movement = await _create_stock_movement(
            _movement_payload(number, data, recipient['recipient_name'], items, products), current_user,
            origin="EPI", origin_id=delivery_id, origin_label=f"Entrega de EPI Nº {number}",
        )

    same_person = existing.get('recipient_type') == data.recipient_type and existing.get('recipient_id') == data.recipient_id
    update_data = {
        **existing,
        "recipient_type": data.recipient_type,
        "recipient_id": data.recipient_id,
        **recipient,
        "delivery_date": data.delivery_date,
        "warehouse_id": data.warehouse_id,
        "warehouse_name": data.warehouse_name,
        "items": items,
        "observations": data.observations,
        # Troca de pessoa: passa a valer a assinatura da nova pessoa
        "signature_url": existing.get('signature_url') if same_person else person.get('signature_url'),
        "stock_movement_id": movement['id'],
        "stock_movement_number": movement['movement_number'],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.epi_deliveries.replace_one({"id": delivery_id}, update_data)
    return EpiDeliveryResponse(**_serialize(update_data, {(data.recipient_type, data.recipient_id): person.get('signature_url')}))


@api_router.delete("/epi-deliveries/{delivery_id}")
async def delete_epi_delivery(delivery_id: str, current_user: dict = Depends(get_current_active_user)):
    existing = await db.epi_deliveries.find_one({"id": delivery_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Entrega de EPI não encontrada")
    await _reverse_stock_movement(existing.get('stock_movement_id'))
    await db.epi_deliveries.delete_one({"id": delivery_id})
    return {"message": "Entrega de EPI excluída e itens devolvidos ao estoque"}


@api_router.get("/epi-deliveries/{delivery_id}/pdf")
async def download_epi_delivery_pdf(delivery_id: str, current_user: dict = Depends(get_current_active_user)):
    """Termo de Entrega de EPI de uma entrega, com a assinatura da pessoa."""
    doc = await db.epi_deliveries.find_one({"id": delivery_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Entrega de EPI não encontrada")
    person = await db[RECIPIENT_COLLECTIONS[doc['recipient_type']]].find_one({"id": doc['recipient_id']}, {"_id": 0}) or {}
    signature_path = signature_file_path(doc.get('signature_url')) or signature_file_path(person.get('signature_url'))
    company = await get_company_settings()
    pdf_bytes = generate_epi_delivery_pdf(doc, signature_path, company=company)
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename=Termo_Entrega_EPI_{doc['delivery_number']}.pdf"})
