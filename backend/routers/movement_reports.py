"""Relatórios de movimentação, de faturamento e de Diária de Armazenagem.
Separado de movements.py.
"""
from datetime import datetime, timezone, timedelta, date
from typing import Optional, List
import io
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from models import DailyBillingPoint
from reports import (
    generate_pdf_report, generate_excel_report, generate_billing_pdf_report, generate_billing_excel,
    generate_storage_overage_pdf_report, generate_storage_overage_excel_report, now_brt, BRT_TZ
)

from shared import (
    db, get_current_active_user, get_current_admin_user, get_company_settings, parse_datetime_value,
    round_money
)
from routers.movements import _filter_movements_by_period
from routers.dashboard import _compute_daily_billing_chart

api_router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)


async def _get_current_stock_movements(status_filter: Optional[str] = None, client_name: Optional[str] = None) -> list:
    """Movimentação (última entrada) de cada container que ainda está em estoque
    (mais entradas que saídas) - usado no relatório 'Estoque Atual' (PDF e Excel).

    Otimização: descobrir quais containers estão em estoque exige olhar o histórico
    inteiro (não tem como saber sem contar entradas/saídas de cada um), mas isso é
    feito com uma projeção enxuta (poucos campos) em vez de carregar o documento
    completo de cada movimentação. Só depois o documento completo é buscado, e
    apenas para os containers que realmente estão em estoque hoje - normalmente uma
    fração pequena do histórico total.
    """
    lean_movements = await db.movements.find(
        {}, {"_id": 0, "id": 1, "container_number": 1, "operation_type": 1, "created_at": 1}
    ).sort("created_at", -1).to_list(None)

    container_counts: dict = {}
    for m in sorted(lean_movements, key=lambda x: parse_datetime_value(x['created_at'])):
        container = m['container_number']
        counts = container_counts.setdefault(container, {'entries': 0, 'exits': 0, 'last_entry_id': None})
        if m['operation_type'] == 'ENTRADA':
            counts['entries'] += 1
            counts['last_entry_id'] = m['id']
        elif m['operation_type'] == 'SAIDA':
            counts['exits'] += 1

    in_stock_ids = [
        counts['last_entry_id']
        for counts in container_counts.values()
        if counts['entries'] > counts['exits'] and counts['last_entry_id']
    ]
    if not in_stock_ids:
        return []

    full_docs = {
        doc['id']: doc
        for doc in await db.movements.find({"id": {"$in": in_stock_ids}}, {"_id": 0}).to_list(None)
    }

    movements = []
    for mid in in_stock_ids:
        m = full_docs.get(mid)
        if not m:
            continue
        if status_filter and m['status'] != status_filter:
            continue
        if client_name and m.get('client_name') != client_name:
            continue
        movements.append(m)

    movements.sort(key=lambda x: parse_datetime_value(x['created_at']), reverse=True)
    return movements


@api_router.get("/reports/pdf")
async def download_pdf_report(
    operation_type: Optional[str] = None,
    status_filter: Optional[str] = None,
    client_name: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    # Caso especial: Estoque Atual
    if operation_type == "ESTOQUE":
        movements = await _get_current_stock_movements(status_filter, client_name)
    else:
        query = {}
        if operation_type:
            query['operation_type'] = operation_type
        if status_filter:
            query['status'] = status_filter
        if client_name:
            query['client_name'] = client_name
        
        movements = await db.movements.find(query, {"_id": 0}).sort("created_at", -1).to_list(None)
    
    # Filtrar por data se fornecido
    movements = _filter_movements_by_period(movements, date_from, date_to)
    
    # Gerar título do relatório baseado no filtro
    report_title = "Relatório de Movimentações"
    if operation_type == "ENTRADA":
        report_title = "Relatório de Entradas"
    elif operation_type == "SAIDA":
        report_title = "Relatório de Saídas"
    elif operation_type == "ESTOQUE":
        report_title = "Relatório de Estoque Atual"
    
    if client_name:
        report_title += f" - Cliente: {client_name}"
    
    company = await get_company_settings()
    pdf_buffer = generate_pdf_report(movements, report_title, company=company)

    return StreamingResponse(
        io.BytesIO(pdf_buffer),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=relatorio_movimentacoes.pdf"}
    )

@api_router.get("/reports/excel")
async def download_excel_report(
    operation_type: Optional[str] = None,
    status_filter: Optional[str] = None,
    client_name: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    # Caso especial: Estoque Atual
    if operation_type == "ESTOQUE":
        movements = await _get_current_stock_movements(status_filter, client_name)
    else:
        query = {}
        if operation_type:
            query['operation_type'] = operation_type
        if status_filter:
            query['status'] = status_filter
        if client_name:
            query['client_name'] = client_name

        movements = await db.movements.find(query, {"_id": 0}).sort("created_at", -1).to_list(None)

    # Filtrar por data se fornecido
    movements = _filter_movements_by_period(movements, date_from, date_to)
    
    # Gerar título do relatório baseado no filtro
    report_title = "Relatório de Movimentações"
    if operation_type == "ENTRADA":
        report_title = "Relatório de Entradas"
    elif operation_type == "SAIDA":
        report_title = "Relatório de Saídas"
    elif operation_type == "ESTOQUE":
        report_title = "Relatório de Estoque Atual"
    
    if client_name:
        report_title += f" - Cliente: {client_name}"
    
    company = await get_company_settings()
    excel_buffer = generate_excel_report(movements, report_title, company=company)

    return StreamingResponse(
        io.BytesIO(excel_buffer),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=relatorio_movimentacoes.xlsx"}
    )

# ==================== RELATÓRIO DE FATURAMENTO ====================

async def _compute_storage_overage_charges(
    client_name: Optional[str] = None,
    status_filter: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> list:
    """Calcula, na hora (nada é salvo), o valor de Diária de Armazenagem devido
    por cada container atualmente em estoque que já passou do free time
    acordado na Tabela de Serviços (Comercial > Tabela de Serviços,
    billing_type == "DIARIA"). Reaproveita o mesmo algoritmo de última-
    movimentação-por-container de _get_expected_stock_for_client
    (container_audits.py) - evita o bug de contagem entradas>saídas do
    _get_current_stock_movements, sem depender dele.

    date_from/date_to restringem quais dias excedentes entram na conta
    (e no valor): só os dias excedentes que caem dentro do período
    selecionado são cobrados nesta chamada - evita cobrar de novo, num
    relatório de um período fechado, os dias excedentes que já foram
    cobrados/mostrados em um relatório de período anterior."""
    entry_query = {"billing_type": "DIARIA", "status": "ATIVO"}
    diaria_entries = await db.service_price_entries.find(entry_query, {"_id": 0}).to_list(None)
    if client_name:
        target = client_name.strip().lower()
        diaria_entries = [e for e in diaria_entries if (e.get('client_name') or '').strip().lower() == target]
    if not diaria_entries:
        return []

    lean = await db.movements.find(
        {}, {"_id": 0, "container_number": 1, "operation_type": 1, "created_at": 1,
             "client_name": 1, "size_type": 1, "status": 1}
    ).to_list(None)
    last_by_container = {}
    for m in sorted(lean, key=lambda x: parse_datetime_value(x['created_at'])):
        last_by_container[m['container_number']] = m
    in_stock = [m for m in last_by_container.values() if m['operation_type'] == 'ENTRADA']
    if status_filter:
        in_stock = [m for m in in_stock if m.get('status') == status_filter]

    # Se um container bater com mais de uma entrada DIARIA do mesmo cliente
    # (não deveria acontecer - bloqueado na criação/edição - mas por segurança
    # aqui também), prefere a mais específica (com container_size_group).
    today = now_brt().date()
    charges = []
    for container in in_stock:
        container_client = (container.get('client_name') or '').strip().lower()
        matches = [
            e for e in diaria_entries
            if (e.get('client_name') or '').strip().lower() == container_client
            and (not e.get('container_size_group') or (container.get('size_type') or '').startswith(e['container_size_group']))
        ]
        if not matches:
            continue
        matches.sort(key=lambda e: e.get('container_size_group') is None)
        entry = matches[0]

        free_time_days = entry.get('free_time_days')
        if free_time_days is None:
            continue
        entry_date = parse_datetime_value(container['created_at'])
        # Dia da entrada no horário de Brasília (o mesmo fuso de "today"), não
        # em UTC - senão quem entra depois das 21h conta como o dia seguinte.
        entry_day = entry_date.astimezone(BRT_TZ).date()
        days_in_yard = (today - entry_day).days
        excess_start = entry_day + timedelta(days=free_time_days)
        period_start = max(excess_start, date_from) if date_from else excess_start
        period_end = min(today, date_to) if date_to else today
        extra_days = (period_end - period_start).days
        if extra_days <= 0:
            continue
        charges.append({
            "container_number": container['container_number'],
            "client_name": entry['client_name'],
            "service_type_name": entry['service_type_name'],
            "entry_date": entry_date,
            "days_in_yard": days_in_yard,
            "free_time_days": free_time_days,
            "extra_days": extra_days,
            "daily_rate": entry['value'],
            "currency": entry.get('currency') or 'BRL',
            "service_value": round_money(extra_days * entry['value']),
        })
    return charges


@api_router.get("/reports/billing/daily-chart", response_model=list[DailyBillingPoint])
async def get_billing_daily_chart(current_user: dict = Depends(get_current_admin_user)):
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return await _compute_daily_billing_chart(today)


@api_router.get("/reports/billing/pdf")
async def download_billing_pdf_report(
    operation_type: Optional[str] = None,
    status_filter: Optional[str] = None,
    client_name: Optional[str] = None,
    billed_filter: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    query = {}
    if operation_type and operation_type != 'all':
        query['operation_type'] = operation_type
    if status_filter and status_filter != 'all':
        query['status'] = status_filter
    if client_name and client_name != 'all':
        query['client_name'] = client_name
    if billed_filter == 'billed':
        query['billed'] = True
    elif billed_filter == 'unbilled':
        query['billed'] = {"$ne": True}

    movements = await db.movements.find(query, {"_id": 0}).sort("created_at", -1).to_list(None)

    movements = _filter_movements_by_period(movements, date_from, date_to)

    report_title = "Relatório de Faturamento"
    if client_name and client_name != 'all':
        report_title += f" - Cliente: {client_name}"

    storage_charges = []
    if billed_filter != 'billed':
        storage_charges = await _compute_storage_overage_charges(
            client_name if client_name and client_name != 'all' else None,
            status_filter if status_filter and status_filter != 'all' else None,
            datetime.fromisoformat(date_from).date() if date_from else None,
            datetime.fromisoformat(date_to).date() if date_to else None,
        )

    company = await get_company_settings()
    pdf_buffer = generate_billing_pdf_report(movements, report_title, company=company, storage_charges=storage_charges)

    return StreamingResponse(
        io.BytesIO(pdf_buffer),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=relatorio_faturamento.pdf"}
    )


@api_router.get("/reports/billing/excel")
async def download_billing_excel_report(
    operation_type: Optional[str] = None,
    status_filter: Optional[str] = None,
    client_name: Optional[str] = None,
    billed_filter: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    query = {}
    if operation_type and operation_type != 'all':
        query['operation_type'] = operation_type
    if status_filter and status_filter != 'all':
        query['status'] = status_filter
    if client_name and client_name != 'all':
        query['client_name'] = client_name
    if billed_filter == 'billed':
        query['billed'] = True
    elif billed_filter == 'unbilled':
        query['billed'] = {"$ne": True}

    movements = await db.movements.find(query, {"_id": 0}).sort("created_at", -1).to_list(None)

    movements = _filter_movements_by_period(movements, date_from, date_to)

    report_title = "Relatório de Faturamento"
    if client_name and client_name != 'all':
        report_title += f" - Cliente: {client_name}"

    storage_charges = []
    if billed_filter != 'billed':
        storage_charges = await _compute_storage_overage_charges(
            client_name if client_name and client_name != 'all' else None,
            status_filter if status_filter and status_filter != 'all' else None,
            datetime.fromisoformat(date_from).date() if date_from else None,
            datetime.fromisoformat(date_to).date() if date_to else None,
        )

    company = await get_company_settings()
    excel_buffer = generate_billing_excel(movements, company=company, storage_charges=storage_charges)

    return StreamingResponse(
        io.BytesIO(excel_buffer),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=relatorio_faturamento.xlsx"}
    )


@api_router.get("/reports/storage-overage/pdf")
async def download_storage_overage_pdf_report(
    client_name: Optional[str] = None,
    status_filter: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    storage_charges = await _compute_storage_overage_charges(
        client_name if client_name and client_name != 'all' else None,
        status_filter if status_filter and status_filter != 'all' else None,
        datetime.fromisoformat(date_from).date() if date_from else None,
        datetime.fromisoformat(date_to).date() if date_to else None,
    )

    report_title = "Relatório de Diárias de Armazenagem"
    if client_name and client_name != 'all':
        report_title += f" - Cliente: {client_name}"
    if date_from or date_to:
        de = datetime.fromisoformat(date_from).strftime('%d/%m/%Y') if date_from else '...'
        ate = datetime.fromisoformat(date_to).strftime('%d/%m/%Y') if date_to else '...'
        report_title += f" - Período: {de} a {ate}"

    company = await get_company_settings()
    pdf_buffer = generate_storage_overage_pdf_report(storage_charges, company=company, report_title=report_title)

    return StreamingResponse(
        io.BytesIO(pdf_buffer),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=relatorio_diarias_armazenagem.pdf"}
    )


@api_router.get("/reports/storage-overage/excel")
async def download_storage_overage_excel_report(
    client_name: Optional[str] = None,
    status_filter: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    storage_charges = await _compute_storage_overage_charges(
        client_name if client_name and client_name != 'all' else None,
        status_filter if status_filter and status_filter != 'all' else None,
        datetime.fromisoformat(date_from).date() if date_from else None,
        datetime.fromisoformat(date_to).date() if date_to else None,
    )

    report_title = "Relatório de Diárias de Armazenagem"
    if client_name and client_name != 'all':
        report_title += f" - Cliente: {client_name}"
    if date_from or date_to:
        de = datetime.fromisoformat(date_from).strftime('%d/%m/%Y') if date_from else '...'
        ate = datetime.fromisoformat(date_to).strftime('%d/%m/%Y') if date_to else '...'
        report_title += f" - Período: {de} a {ate}"

    company = await get_company_settings()
    excel_buffer = generate_storage_overage_excel_report(storage_charges, company=company, report_title=report_title)

    return StreamingResponse(
        io.BytesIO(excel_buffer),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=relatorio_diarias_armazenagem.xlsx"}
    )


from pydantic import BaseModel

class BillingRequest(BaseModel):
    movement_ids: List[str]

@api_router.post("/billing/report")
async def generate_billing_report(
    request: BillingRequest,
    current_user: dict = Depends(get_current_admin_user)
):
    from reports import generate_billing_excel
    
    # Buscar movimentações pelos IDs
    movements = await db.movements.find(
        {"id": {"$in": request.movement_ids}},
        {"_id": 0}
    ).to_list(None)
    
    if not movements:
        raise HTTPException(status_code=404, detail="Nenhuma movimentação encontrada")
    
    # Marcar movimentações como faturadas
    billed_at = datetime.now(timezone.utc).isoformat()
    await db.movements.update_many(
        {"id": {"$in": request.movement_ids}},
        {"$set": {"billed": True, "billed_at": billed_at}}
    )
    
    # Ordenar por transaction_id
    movements.sort(key=lambda x: x.get('transaction_id', 0), reverse=True)

    company = await get_company_settings()
    excel_buffer = generate_billing_excel(movements, company=company)

    return StreamingResponse(
        io.BytesIO(excel_buffer),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=faturamento.xlsx"}
    )
