import io
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pymongo.errors import DuplicateKeyError

from models import (
    FREIGHT_PAYMENT_STATUS_OPTIONS,
    FreightPayment, FreightPaymentUpdate, FreightPaymentResponse,
    FreightPaymentHistory, FreightPaymentHistoryResponse,
)
from shared import db, get_current_admin_user, get_company_settings
from reports import merge_company, generate_freight_payment_report_pdf, generate_freight_payment_report_excel

api_router = APIRouter(prefix="/api")

# ==================== PAGAMENTO FRETE (TRANSPORTE) ====================
# Lançamento gerado automaticamente quando uma Ordem de Carregamento de
# Coleta, feita numa Rota cadastrada, é Aprovada - ver create_loading_order/
# update_loading_order em loading_orders.py. Não existe POST público: o
# único jeito de nascer um registro aqui é o hook abaixo.


async def get_next_freight_payment_number():
    """Obtém o próximo payment_number usando um contador atômico."""
    result = await db.counters.find_one_and_update(
        {"_id": "freight_payment_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    return result["seq"]


async def log_freight_payment_history(freight_payment_id: str, payment_number: int, action: str, changes: dict, user_id: str, user_name: str):
    history = FreightPaymentHistory(
        freight_payment_id=freight_payment_id,
        payment_number=payment_number,
        action=action,
        changes=changes,
        user_id=user_id,
        user_name=user_name
    )
    doc = history.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.freight_payment_history.insert_one(doc)


async def create_freight_payment_for_order(order: dict, current_user: dict):
    """Lança um Pagamento Frete quando uma Ordem de Carregamento de Coleta
    numa Rota cadastrada vira Aprovada. Chamado a partir de loading_orders.py.
    Idempotente: nunca duplica o lançamento de uma mesma ordem (cobre
    reaprovação, dupla chamada, ou edição de uma ordem já Aprovada)."""
    if order.get('order_type') != 'COLETA':
        return None
    if not order.get('route_id'):
        return None

    existing = await db.freight_payments.find_one({"loading_order_id": order['id']}, {"_id": 0})
    if existing:
        return existing

    payment_number = await get_next_freight_payment_number()
    payment = FreightPayment(
        payment_number=payment_number,
        loading_order_id=order['id'],
        order_number=order['order_number'],
        route_id=order['route_id'],
        route_name=order.get('route_name'),
        driver_id=order.get('driver_id'),
        driver_name=order.get('driver_name'),
        driver_cpf=order.get('driver_cpf'),
        transport_company=order.get('transport_company'),
        freight_value=order.get('freight_value') or 0,
        created_by=current_user['sub'],
        created_by_name=current_user['name'],
    )
    doc = payment.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()

    try:
        await db.freight_payments.insert_one(doc)
    except DuplicateKeyError:
        # Corrida com outra chamada concorrente - o índice único em
        # loading_order_id garante que só um lançamento sobrevive.
        existing = await db.freight_payments.find_one({"loading_order_id": order['id']}, {"_id": 0})
        if existing:
            return existing
        raise

    await log_freight_payment_history(
        freight_payment_id=payment.id,
        payment_number=payment_number,
        action="CREATED",
        changes={
            "loading_order_id": order['id'],
            "order_number": order['order_number'],
            "route_name": order.get('route_name'),
            "freight_value": payment.freight_value,
        },
        user_id=current_user['sub'],
        user_name=current_user['name'],
    )
    return doc


async def cancel_pending_freight_payment_for_order(loading_order_id: str, current_user: dict):
    """Chamado quando uma Ordem de Carregamento sai do status Aprovada
    (volta pra Pendente ou vira Cancelada). Nunca mexe num lançamento já
    Pago ou já Cancelado - só cancela o que ainda está Pendente, pra nunca
    reverter silenciosamente um pagamento em andamento."""
    fp = await db.freight_payments.find_one({"loading_order_id": loading_order_id}, {"_id": 0})
    if not fp or fp.get('status') != 'PENDENTE':
        return None

    await db.freight_payments.update_one(
        {"id": fp['id']},
        {"$set": {"status": "CANCELADO", "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    await log_freight_payment_history(
        freight_payment_id=fp['id'],
        payment_number=fp['payment_number'],
        action="UPDATED",
        changes={"status": {"from": "PENDENTE", "to": "CANCELADO"}, "reason": "ordem_saiu_de_aprovada"},
        user_id=current_user['sub'],
        user_name=current_user['name'],
    )
    return None


def _build_freight_payment_query(driver_id: Optional[str], status: Optional[str], route_id: Optional[str], date_from: Optional[str], date_to: Optional[str]) -> dict:
    query = {}
    if driver_id:
        query['driver_id'] = driver_id
    if status:
        query['status'] = status
    if route_id:
        query['route_id'] = route_id
    if date_from or date_to:
        range_q = {}
        if date_from:
            range_q['$gte'] = f"{date_from}T00:00:00"
        if date_to:
            range_q['$lte'] = f"{date_to}T23:59:59"
        query['created_at'] = range_q
    return query


@api_router.get("/freight-payments/report/pdf")
async def download_freight_payment_report_pdf(
    driver_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    driver = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not driver:
        raise HTTPException(status_code=404, detail="Motorista não encontrado")

    query = _build_freight_payment_query(driver_id, None, None, date_from, date_to)
    payments = await db.freight_payments.find(query, {"_id": 0}).sort("created_at", 1).to_list(None)
    company = merge_company(await get_company_settings())

    pdf_bytes = generate_freight_payment_report_pdf(
        driver_info={"name": driver.get('name'), "cpf": driver.get('cpf')},
        payments=payments,
        period={"date_from": date_from, "date_to": date_to},
        company=company,
    )
    filename = f"PrestacaoContas_{(driver.get('name') or 'motorista').replace(' ', '_')}.pdf"
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})


@api_router.get("/freight-payments/report/excel")
async def download_freight_payment_report_excel(
    driver_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    driver = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not driver:
        raise HTTPException(status_code=404, detail="Motorista não encontrado")

    query = _build_freight_payment_query(driver_id, None, None, date_from, date_to)
    payments = await db.freight_payments.find(query, {"_id": 0}).sort("created_at", 1).to_list(None)
    company = merge_company(await get_company_settings())

    excel_bytes = generate_freight_payment_report_excel(
        driver_info={"name": driver.get('name'), "cpf": driver.get('cpf')},
        payments=payments,
        period={"date_from": date_from, "date_to": date_to},
        company=company,
    )
    filename = f"PrestacaoContas_{(driver.get('name') or 'motorista').replace(' ', '_')}.xlsx"
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@api_router.get("/freight-payments", response_model=List[FreightPaymentResponse])
async def list_freight_payments(
    driver_id: Optional[str] = None,
    status: Optional[str] = None,
    route_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    query = _build_freight_payment_query(driver_id, status, route_id, date_from, date_to)
    rows = await db.freight_payments.find(query, {"_id": 0}).sort("created_at", -1).to_list(None)
    return rows


@api_router.get("/freight-payments/{payment_id}", response_model=FreightPaymentResponse)
async def get_freight_payment(payment_id: str, current_user: dict = Depends(get_current_admin_user)):
    doc = await db.freight_payments.find_one({"id": payment_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Pagamento Frete não encontrado")
    return doc


@api_router.put("/freight-payments/{payment_id}/status")
async def update_freight_payment_status(
    payment_id: str,
    status: str,
    current_user: dict = Depends(get_current_admin_user)
):
    """Atualiza o status do lançamento (Pendente/Pago/Cancelado) - mesmo
    padrão de PUT /invoices/{id}/status."""
    if status not in FREIGHT_PAYMENT_STATUS_OPTIONS:
        raise HTTPException(status_code=400, detail="Status inválido")

    payment = await db.freight_payments.find_one({"id": payment_id}, {"_id": 0})
    if not payment:
        raise HTTPException(status_code=404, detail="Pagamento Frete não encontrado")

    old_status = payment.get('status', 'PENDENTE')
    update_data = {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}
    if status == 'PAGO':
        update_data['paid_at'] = datetime.now(timezone.utc).isoformat()
        update_data['paid_by'] = current_user['sub']
        update_data['paid_by_name'] = current_user['name']
    elif old_status == 'PAGO' and status != 'PAGO':
        update_data['paid_at'] = None
        update_data['paid_by'] = None
        update_data['paid_by_name'] = None

    await db.freight_payments.update_one({"id": payment_id}, {"$set": update_data})

    if old_status != status:
        await log_freight_payment_history(
            freight_payment_id=payment_id,
            payment_number=payment['payment_number'],
            action="UPDATED",
            changes={"status": {"from": old_status, "to": status}},
            user_id=current_user['sub'],
            user_name=current_user['name'],
        )

    return {"message": "Status atualizado com sucesso"}


@api_router.put("/freight-payments/{payment_id}", response_model=FreightPaymentResponse)
async def update_freight_payment(payment_id: str, data: FreightPaymentUpdate, current_user: dict = Depends(get_current_admin_user)):
    """Corrige valor do frete/observações de um lançamento - só permitido
    enquanto ainda está Pendente (uma vez Pago/Cancelado, o valor fica
    congelado como registro histórico)."""
    payment = await db.freight_payments.find_one({"id": payment_id}, {"_id": 0})
    if not payment:
        raise HTTPException(status_code=404, detail="Pagamento Frete não encontrado")
    if payment.get('status') != 'PENDENTE':
        raise HTTPException(status_code=400, detail="Só é possível editar um lançamento Pendente")

    changes = {}
    update_data = {}
    if data.freight_value is not None and data.freight_value != payment.get('freight_value'):
        changes['freight_value'] = {"from": payment.get('freight_value'), "to": data.freight_value}
        update_data['freight_value'] = data.freight_value
    if data.observations is not None and data.observations != payment.get('observations'):
        changes['observations'] = {"from": payment.get('observations'), "to": data.observations}
        update_data['observations'] = data.observations

    if update_data:
        update_data['updated_at'] = datetime.now(timezone.utc).isoformat()
        await db.freight_payments.update_one({"id": payment_id}, {"$set": update_data})
        await log_freight_payment_history(
            freight_payment_id=payment_id,
            payment_number=payment['payment_number'],
            action="UPDATED",
            changes=changes,
            user_id=current_user['sub'],
            user_name=current_user['name'],
        )

    updated = await db.freight_payments.find_one({"id": payment_id}, {"_id": 0})
    return updated


@api_router.get("/freight-payments/{payment_id}/history", response_model=List[FreightPaymentHistoryResponse])
async def get_freight_payment_history(payment_id: str, current_user: dict = Depends(get_current_admin_user)):
    rows = await db.freight_payment_history.find({"freight_payment_id": payment_id}, {"_id": 0}).sort("created_at", -1).to_list(None)
    return rows
