from typing import Optional
import io
import re

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from reports import (
    local_datetime, generate_vehicle_results_report_pdf, generate_vehicle_results_report_excel,
)
from shared import db, get_current_admin_user, get_company_settings
from routers.fuel_supply import _fuel_calc
from routers.ordem_servico import _os_serialize

api_router = APIRouter(prefix="/api")

# ==================== CUSTO E FATURAMENTO POR VEÍCULO ====================
# Resultado de cada placa no período, juntando o que já é lançado em outras
# telas (nada é digitado aqui):
#   Faturamento: Serviço Portuário (placa do cavalo) e Ordem de Carregamento
#                Aprovada (frete da Rota, placa do cavalo)
#   Custo:       Abastecimento, Ordem de Serviço (sem as canceladas), Saída de
#                estoque com finalidade Veículo e Solicitação de Diária (sem as
#                canceladas)

RECEITA = "RECEITA"
CUSTO = "CUSTO"

CATEGORY_ORDER = [
    ("Serviço Portuário", RECEITA),
    ("Ordem de Carregamento", RECEITA),
    ("Abastecimento", CUSTO),
    ("Ordem de Serviço", CUSTO),
    ("Saída de Estoque", CUSTO),
    ("Diária de Motorista", CUSTO),
]


def plate_key(plate: Optional[str]) -> str:
    """'abc-1d23 ' -> 'ABC1D23': as telas gravam a placa com e sem hífen."""
    return re.sub(r'[^A-Z0-9]', '', (plate or '').upper())


def _in_period(day: Optional[str], date_from: Optional[str], date_to: Optional[str]) -> bool:
    if date_from and (not day or day < date_from):
        return False
    if date_to and (not day or day > date_to):
        return False
    return True


def _local_day(value) -> Optional[str]:
    dt = local_datetime(value)
    return dt.date().isoformat() if dt else None


async def _vehicle_result_rows(date_from: Optional[str], date_to: Optional[str]) -> list:
    """Todos os lançamentos de receita/custo com placa no período, um por
    documento: {date, plate, kind, category, document, description, value}."""
    rows = []

    def add(day, plate, kind, category, document, description, value):
        key = plate_key(plate)
        value = round(float(value or 0), 2)
        if not key or not value or not _in_period(day, date_from, date_to):
            return
        rows.append({
            "date": day, "plate": key, "kind": kind, "category": category,
            "document": document, "description": description or '-', "value": value,
        })

    async for s in db.port_services.find({}, {"_id": 0}):
        add(s.get('service_date'), s.get('cavalo_plate'), RECEITA, "Serviço Portuário",
            f"Serviço Nº {s.get('service_number')}", s.get('client_name'), s.get('operation_value'))

    async for o in db.loading_orders.find({"status": "APROVADA"}, {"_id": 0}):
        description = ' · '.join(x for x in (o.get('route_name'), o.get('client_name')) if x)
        add(_local_day(o.get('created_at')), o.get('truck_plate'), RECEITA, "Ordem de Carregamento",
            f"Ordem Nº {o.get('order_number')}", description, o.get('freight_value'))

    async for f in db.fuel_supplies.find({}, {"_id": 0}):
        f = _fuel_calc(f)
        liters = f.get('liters')
        description = f"{float(liters):g} L" if liters else None
        add(f.get('supply_date'), f.get('equipment_plate'), CUSTO, "Abastecimento",
            f"Abast. Nº {f.get('supply_number')}", description, f.get('total_value'))

    async for o in db.ordem_servico.find({"status": {"$ne": "CANCELADO"}}, {"_id": 0}):
        o = _os_serialize(o)
        add((o.get('opened_at') or '')[:10] or None, o.get('equipment_plate'), CUSTO, "Ordem de Serviço",
            f"OS Nº {o.get('os_number')}", o.get('category'), o.get('grand_total'))

    async for m in db.stock_movements.find(
        {"operation_type": "SAIDA", "purpose_type": "VEICULO"}, {"_id": 0},
    ):
        items = m.get('items') or []
        total = sum(float(i.get('total_value') or 0) for i in items)
        description = ', '.join(i.get('product_description') or '' for i in items[:3]) + ('…' if len(items) > 3 else '')
        add(m.get('movement_date'), m.get('purpose_vehicle_plate'), CUSTO, "Saída de Estoque",
            f"Saída Nº {m.get('movement_number')}", description, total)

    async for r in db.daily_rate_requests.find({"status": {"$ne": "CANCELADO"}}, {"_id": 0}):
        for item in r.get('items') or []:
            add(item.get('departure_date'), item.get('vehicle_plate'), CUSTO, "Diária de Motorista",
                f"Diária Nº {r.get('request_number')}", item.get('driver_name'), item.get('total'))

    rows.sort(key=lambda x: (x['date'] or '', x['category']), reverse=True)
    return rows


def _totals(rows: list) -> dict:
    revenue = round(sum(r['value'] for r in rows if r['kind'] == RECEITA), 2)
    cost = round(sum(r['value'] for r in rows if r['kind'] == CUSTO), 2)
    result = round(revenue - cost, 2)
    return {
        "revenue": revenue, "cost": cost, "result": result,
        # margem só faz sentido com faturamento
        "margin": round(result / revenue * 100, 1) if revenue else None,
    }


async def _vehicle_results(date_from: Optional[str], date_to: Optional[str], plate: Optional[str]) -> dict:
    all_rows = await _vehicle_result_rows(date_from, date_to)
    key = plate_key(plate)
    rows = [r for r in all_rows if r['plate'] == key] if key else all_rows

    # Placas cadastradas: modelo/tipo pra exibir junto
    vehicles = {
        plate_key(v.get('plate')): v async for v in db.vehicles.find(
            {}, {"_id": 0, "plate": 1, "model": 1, "brand": 1, "vehicle_type": 1},
        )
    }

    by_plate: dict = {}
    for r in all_rows:
        by_plate.setdefault(r['plate'], []).append(r)
    ranking = []
    for p, plate_rows in by_plate.items():
        info = vehicles.get(p) or {}
        ranking.append({
            "plate": info.get('plate') or p,
            "plate_key": p,
            "vehicle": ' '.join(x for x in (info.get('brand'), info.get('model')) if x) or info.get('vehicle_type') or None,
            "registered": p in vehicles,
            "count": len(plate_rows),
            **_totals(plate_rows),
        })
    ranking.sort(key=lambda v: v['result'], reverse=True)

    by_category = []
    for category, kind in CATEGORY_ORDER:
        cat_rows = [r for r in rows if r['category'] == category]
        by_category.append({
            "category": category, "kind": kind, "count": len(cat_rows),
            "value": round(sum(r['value'] for r in cat_rows), 2),
        })

    months: dict = {}
    for r in rows:
        month = (r['date'] or '')[:7]
        entry = months.setdefault(month, {"month": month, "revenue": 0.0, "cost": 0.0})
        entry["revenue" if r['kind'] == RECEITA else "cost"] += r['value']
    monthly = [
        {**m, "revenue": round(m["revenue"], 2), "cost": round(m["cost"], 2), "result": round(m["revenue"] - m["cost"], 2)}
        for m in sorted(months.values(), key=lambda m: m["month"])
    ]

    info = (vehicles.get(key) or {}) if key else {}
    return {
        "plate": (info.get('plate') or key) if key else None,
        "vehicle": ' '.join(x for x in (info.get('brand'), info.get('model')) if x) or info.get('vehicle_type'),
        **_totals(rows),
        "by_category": by_category,
        "monthly": monthly,
        "vehicles": ranking,
        "rows": rows if key else [],
    }


@api_router.get("/reports/vehicle-results/summary")
async def get_vehicle_results_summary(
    date_from: Optional[str] = None, date_to: Optional[str] = None, plate: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user),
):
    return await _vehicle_results(date_from, date_to, plate)


@api_router.get("/reports/vehicle-results/pdf")
async def download_vehicle_results_pdf(
    date_from: Optional[str] = None, date_to: Optional[str] = None, plate: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user),
):
    data = await _vehicle_results(date_from, date_to, plate)
    company = await get_company_settings()
    pdf = generate_vehicle_results_report_pdf(data, date_from, date_to, company=company)
    name = f"custo_faturamento_{data['plate'] or 'frota'}.pdf"
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={name}"})


@api_router.get("/reports/vehicle-results/excel")
async def download_vehicle_results_excel(
    date_from: Optional[str] = None, date_to: Optional[str] = None, plate: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user),
):
    data = await _vehicle_results(date_from, date_to, plate)
    company = await get_company_settings()
    xlsx = generate_vehicle_results_report_excel(data, date_from, date_to, company=company)
    name = f"custo_faturamento_{data['plate'] or 'frota'}.xlsx"
    return StreamingResponse(
        io.BytesIO(xlsx),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={name}"},
    )
