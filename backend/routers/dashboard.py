"""Dashboard, atalhos do usuário, busca global e resumo de alertas.
Separado de movements.py - antes ficava tudo num arquivo só.
"""
import asyncio
from datetime import datetime, timedelta
import re
import logging
from urllib.parse import quote as url_quote

from fastapi import APIRouter, Depends

from models import DailyMovementPoint, DailyBillingPoint, DriverRankingEntry, DashboardStats

from reports import today_brt, BRT_OFFSET
from shared import db, get_current_active_user
from routers.frota import get_all_vehicle_maintenance_status
from routers.fuel_supply import _compute_tank_level
from routers.movements import _movement_response
from routers.yard_control import get_yard_control

api_router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)


@api_router.get("/user/shortcuts")
async def get_user_shortcuts(current_user: dict = Depends(get_current_active_user)):
    user = await db.users.find_one({"email": current_user["email"]}, {"_id": 0, "shortcuts": 1})
    if user and "shortcuts" in user:
        return {"shortcuts": user["shortcuts"]}
    return {"shortcuts": None}


@api_router.put("/user/shortcuts")
async def update_user_shortcuts(data: dict, current_user: dict = Depends(get_current_active_user)):
    shortcuts = data.get("shortcuts", [])
    await db.users.update_one(
        {"email": current_user["email"]},
        {"$set": {"shortcuts": shortcuts}}
    )
    return {"message": "Atalhos atualizados", "shortcuts": shortcuts}


def _created_at_gte(dt: datetime) -> dict:
    """Filtro de data sobre 'created_at' (armazenado como string ISO), convertendo
    para Date dentro do próprio MongoDB - evita comparação de string frágil e evita
    trazer a coleção inteira para o Python só para filtrar por data."""
    return {"$expr": {"$gte": [{"$toDate": "$created_at"}, dt]}}


async def _compute_stock_by_status() -> dict:
    """Para cada container, soma entradas/saídas e pega o status da última entrada
    (histórico completo, feito no MongoDB via agregação em vez de carregar todas as
    movimentações em memória no Python)."""
    pipeline = [
        {"$sort": {"created_at": 1}},
        {"$group": {
            "_id": "$container_number",
            "entries": {"$sum": {"$cond": [{"$eq": ["$operation_type", "ENTRADA"]}, 1, 0]}},
            "exits": {"$sum": {"$cond": [{"$eq": ["$operation_type", "SAIDA"]}, 1, 0]}},
            "last_status": {"$last": "$status"},
        }},
        {"$match": {"$expr": {"$gt": ["$entries", "$exits"]}}},
        {"$group": {"_id": "$last_status", "count": {"$sum": 1}}},
    ]
    result = {r["_id"]: r["count"] async for r in db.movements.aggregate(pipeline)}
    return {"VAZIO": result.get("VAZIO", 0), "CHEIO": result.get("CHEIO", 0)}


async def _compute_daily_chart(today: datetime) -> list[DailyMovementPoint]:
    """Entradas/saídas por dia dos últimos 14 dias - agregação restrita à janela de
    datas (usa o índice de created_at) em vez de escanear a coleção inteira. O
    dia de cada movimentação é o dia no horário de Brasília (BRT_OFFSET), o mesmo
    de "today" - em UTC, o que era lançado depois das 21h caía na barra do dia
    seguinte."""
    day0 = today - timedelta(days=13)
    pipeline = [
        {"$match": _created_at_gte(day0)},
        {"$addFields": {"_day": {"$dateToString": {
            "format": "%Y-%m-%d", "date": {"$toDate": "$created_at"}, "timezone": BRT_OFFSET
        }}}},
        {"$group": {"_id": {"day": "$_day", "op": "$operation_type"}, "count": {"$sum": 1}}},
    ]
    by_day: dict = {}
    async for r in db.movements.aggregate(pipeline):
        by_day.setdefault(r["_id"]["day"], {})[r["_id"]["op"]] = r["count"]

    daily_chart = []
    for i in range(13, -1, -1):
        day_start = today - timedelta(days=i)
        day_key = day_start.strftime('%Y-%m-%d')
        counts = by_day.get(day_key, {})
        daily_chart.append(DailyMovementPoint(
            date=day_key,
            entries=counts.get('ENTRADA', 0),
            exits=counts.get('SAIDA', 0)
        ))
    return daily_chart


async def _compute_daily_billing_chart(today: datetime) -> list[DailyBillingPoint]:
    """Valor faturado/não faturado por dia dos últimos 14 dias - mesma estratégia de
    agregação restrita à janela de datas usada em _compute_daily_chart."""
    day0 = today - timedelta(days=13)
    pipeline = [
        {"$match": {**_created_at_gte(day0), "service_value": {"$ne": None}}},
        {"$addFields": {"_day": {"$dateToString": {
            "format": "%Y-%m-%d", "date": {"$toDate": "$created_at"}, "timezone": BRT_OFFSET
        }}}},
        {"$group": {
            "_id": {"day": "$_day", "billed": {"$eq": ["$billed", True]}},
            "total": {"$sum": "$service_value"}
        }},
    ]
    by_day: dict = {}
    async for r in db.movements.aggregate(pipeline):
        key = 'billed' if r["_id"]["billed"] else 'unbilled'
        by_day.setdefault(r["_id"]["day"], {})[key] = r["total"]

    daily_chart = []
    for i in range(13, -1, -1):
        day_start = today - timedelta(days=i)
        day_key = day_start.strftime('%Y-%m-%d')
        totals = by_day.get(day_key, {})
        daily_chart.append(DailyBillingPoint(
            date=day_key,
            billed=totals.get('billed', 0),
            unbilled=totals.get('unbilled', 0)
        ))
    return daily_chart


async def _compute_driver_ranking(first_day_of_month: datetime) -> list[DriverRankingEntry]:
    """Ranking de motoristas no mês vigente - agregação restrita ao mês (usa o índice
    de created_at) em vez de escanear a coleção inteira."""
    pipeline = [
        {"$match": _created_at_gte(first_day_of_month)},
        {"$group": {
            "_id": {"driver": {"$ifNull": ["$driver_name", "Não informado"]}, "op": "$operation_type"},
            "count": {"$sum": 1}
        }},
    ]
    driver_stats: dict = {}
    async for r in db.movements.aggregate(pipeline):
        name = r["_id"]["driver"]
        data = driver_stats.setdefault(name, {"entries": 0, "exits": 0})
        if r["_id"]["op"] == "ENTRADA":
            data["entries"] = r["count"]
        elif r["_id"]["op"] == "SAIDA":
            data["exits"] = r["count"]

    return sorted(
        [
            DriverRankingEntry(
                driver_name=name,
                entries=data['entries'],
                exits=data['exits'],
                total=data['entries'] + data['exits']
            )
            for name, data in driver_stats.items()
        ],
        key=lambda x: x.total,
        reverse=True
    )[:10]


@api_router.get("/dashboard", response_model=DashboardStats)
async def get_dashboard_stats(current_user: dict = Depends(get_current_active_user)):
    today = today_brt()
    # Início do mês atual (dia e mês no horário de Brasília, como "today")
    first_day_of_month = today.replace(day=1)

    # Otimização: cada estatística vira uma query indexada/agregação enxuta no
    # MongoDB (executadas em paralelo) em vez de trazer a coleção inteira de
    # movimentações para o Python a cada carregamento do dashboard.
    (
        total_movements,
        entries_today, exits_today,
        full_containers, empty_containers,
        total_entries, total_exits,
        entries_month, exits_month,
        stock_by_status,
        daily_chart,
        driver_ranking,
        recent,
    ) = await asyncio.gather(
        db.movements.count_documents({}),
        db.movements.count_documents({"operation_type": "ENTRADA", **_created_at_gte(today)}),
        db.movements.count_documents({"operation_type": "SAIDA", **_created_at_gte(today)}),
        db.movements.count_documents({"status": "CHEIO"}),
        db.movements.count_documents({"status": "VAZIO"}),
        db.movements.count_documents({"operation_type": "ENTRADA"}),
        db.movements.count_documents({"operation_type": "SAIDA"}),
        db.movements.count_documents({"operation_type": "ENTRADA", **_created_at_gte(first_day_of_month)}),
        db.movements.count_documents({"operation_type": "SAIDA", **_created_at_gte(first_day_of_month)}),
        _compute_stock_by_status(),
        _compute_daily_chart(today),
        _compute_driver_ranking(first_day_of_month),
        db.movements.find({}, {"_id": 0}).sort("created_at", -1).limit(5).to_list(5),
    )

    current_stock = total_entries - total_exits
    stock_empty = stock_by_status["VAZIO"]
    stock_full = stock_by_status["CHEIO"]

    recent_movements = [
        _movement_response(m)
        for m in recent
    ]
    
    return DashboardStats(
        total_movements=total_movements,
        entries_today=entries_today,
        exits_today=exits_today,
        full_containers=full_containers,
        empty_containers=empty_containers,
        total_entries=total_entries,
        total_exits=total_exits,
        current_stock=current_stock,
        stock_empty=stock_empty,
        stock_full=stock_full,
        entries_month=entries_month,
        exits_month=exits_month,
        recent_movements=recent_movements,
        daily_chart=daily_chart,
        driver_ranking=driver_ranking
    )


@api_router.get("/search")
async def global_search(q: str, current_user: dict = Depends(get_current_active_user)):
    """Busca global usada pela paleta de comandos (Ctrl+K): contêineres, motoristas,
    clientes e transportadoras que batem com o termo digitado."""
    term = q.strip()
    if len(term) < 2:
        return {"results": []}

    regex = {"$regex": re.escape(term), "$options": "i"}
    results = []

    movements = await db.movements.find(
        {"container_number": regex},
        {"_id": 0, "id": 1, "container_number": 1, "operation_type": 1, "status": 1, "driver_name": 1}
    ).sort("created_at", -1).limit(20).to_list(20)
    seen_containers = set()
    for m in movements:
        if m['container_number'] in seen_containers:
            continue
        seen_containers.add(m['container_number'])
        op_label = 'Entrada' if m['operation_type'] == 'ENTRADA' else 'Saída'
        results.append({
            "type": "container",
            "label": m['container_number'],
            "subtitle": f"{op_label} · {m['status']}" + (f" · {m['driver_name']}" if m.get('driver_name') else ""),
            "path": f"/movements/{m['id']}",
        })
        if len(seen_containers) >= 6:
            break

    drivers = await db.drivers.find(
        {"$or": [{"name": regex}, {"cpf": regex}]}, {"_id": 0, "name": 1, "cpf": 1}
    ).limit(6).to_list(6)
    for d in drivers:
        results.append({
            "type": "driver",
            "label": d['name'],
            "subtitle": f"Motorista · CPF {d['cpf']}" if d.get('cpf') else "Motorista",
            "path": f"/drivers?q={url_quote(d['name'])}",
        })

    clients = await db.clients.find(
        {"$or": [{"name": regex}, {"cnpj": regex}]}, {"_id": 0, "name": 1, "cnpj": 1}
    ).limit(6).to_list(6)
    for c in clients:
        results.append({
            "type": "client",
            "label": c['name'],
            "subtitle": f"Cliente · {c['cnpj']}" if c.get('cnpj') else "Cliente",
            "path": f"/clients?q={url_quote(c['name'])}",
        })

    companies = await db.transport_companies.find(
        {"$or": [{"name": regex}, {"cnpj": regex}]}, {"_id": 0, "name": 1, "cnpj": 1}
    ).limit(6).to_list(6)
    for c in companies:
        results.append({
            "type": "company",
            "label": c['name'],
            "subtitle": f"Transportadora · {c['cnpj']}" if c.get('cnpj') else "Transportadora",
            "path": f"/companies?q={url_quote(c['name'])}",
        })

    return {"results": results}

@api_router.get("/alerts/summary")
async def get_alerts_summary(current_user: dict = Depends(get_current_active_user)):
    """Resumo leve de alertas - usado pelo sino do topo e pelo card 'Alertas do
    Sistema' do dashboard (containers parados no pátio há mais de 30/60/90 dias)."""
    yard = await get_yard_control(current_user=current_user)
    maintenance = await get_all_vehicle_maintenance_status()
    tank = await _compute_tank_level()
    return {
        'yard_over_30_days': yard['stats']['over_30_days'],
        'yard_over_60_days': yard['stats']['over_60_days'],
        'yard_over_90_days': yard['stats']['over_90_days'],
        'maintenance_due_soon': sum(1 for m in maintenance if m['status'] == 'DUE_SOON'),
        'maintenance_overdue': sum(1 for m in maintenance if m['status'] == 'OVERDUE'),
        'tank_low': bool(tank and tank['status'] == 'LOW'),
    }
