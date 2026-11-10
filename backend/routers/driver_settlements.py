"""Transporte - Acerto da Viagem (antes "Acerto de Motorista"; a rota
/driver-settlements, a coleção driver_settlements e a permissão
operacional.acerto_motorista mantêm o nome técnico).

Junta numa prestação de contas a viagem inteira: os abastecimentos (interno -
tanque próprio - e externo - posto, pago pelo motorista ou pela empresa), as
despesas, as viagens (Ordens de Carregamento aprovadas e Ordens de Serviço -
Cliente em trânsito/concluídas, com km inicial/final e o frete) e os
adiantamentos/devoluções. Daí saem duas contas separadas:

Saldo com o motorista (acerto financeiro) =
    abastecimentos pagos pelo motorista + despesas pagas pelo motorista
    - adiantamentos + devoluções
  positivo: a empresa paga ao motorista; negativo: o motorista devolve.
  O que a empresa pagou (tanque próprio, posto faturado/cartão) NÃO entra.

Resultado da viagem (lucro/prejuízo) =
    frete das viagens - abastecimento total - todas as despesas
  margem = resultado / receita. Adiantamento não é custo.

Abastecimentos e viagens entram como cópia (o que foi acertado não muda se o
registro de origem mudar) e cada um só pode estar em um acerto. Enquanto o
acerto está Aberto a cópia é refeita a cada gravação; Fechado trava tudo até
ser reaberto. Só administradores (mexe com dinheiro do motorista) e respeita o
fechamento de período financeiro (period_lock.py).

Acertos antigos (gravados antes de 10/11/2026) só tinham abastecimentos pagos
pelo motorista e despesas pagas por ele, e as viagens não copiavam o frete:
_complete() completa esses campos na leitura, sem gravar nada."""
from datetime import date, datetime, timezone
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException

from list_filters import combine, text_query
from models import DRIVER_SETTLEMENT_ADVANCE_KINDS, DriverSettlementClose, DriverSettlementCreate
from period_lock import as_local_date, ensure_period_open
from period_reports import Column, Section, DAY, INT, MONEY, excel_response, pdf_response, period_text
from reports import today_brt
from routers.fuel_supply import _fuel_calc
from settlement_links import settlement_holding
from shared import db, get_current_admin_user, plate_regex

api_router = APIRouter(prefix="/api")

STATUS_LABELS = {"ABERTO": "Aberto", "FECHADO": "Fechado"}
ADVANCE_LABELS = {"ADIANTAMENTO": "Adiantamento", "DEVOLUCAO": "Devolução"}
PAID_BY_LABELS = {"MOTORISTA": "Motorista", "EMPRESA": "Empresa"}
FUEL_ORIGIN_LABELS = {"INTERNO": "Interno", "EXTERNO": "Externo"}
EXPENSE_CATEGORY_LABELS = {"PEDAGIO": "Pedágio", "DIARIA": "Diária", "COMISSAO": "Comissão do motorista",
                           "ALIMENTACAO": "Alimentação", "OUTRAS": "Outras"}
WHAT = "Acerto da Viagem"

# Situações da Ordem de Serviço - Cliente que já podem entrar no acerto (a viagem saiu)
CLIENT_OS_TRIP_STATUSES = ("EM_TRANSITO", "CONCLUIDA")
CLIENT_OS_STATUS_LABELS = {"ABERTA": "aberta", "EM_TRANSITO": "em trânsito", "CONCLUIDA": "concluída", "CANCELADA": "cancelada"}
TRIP_SOURCE_PREFIX = {"ORDEM_CARREGAMENTO": "OC", "OS_CLIENTE": "OS-C"}


def _day(value: Optional[str], label: str) -> Optional[str]:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10]).isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{label} inválida")


def _br_number(value, digits: int = 2) -> Optional[str]:
    """1234.5 -> '1.234,50' (inteiro sem casas: 810 -> '810')."""
    if value is None:
        return None
    if float(value).is_integer():
        digits = 0
    return f"{value:,.{digits}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _money(value: float) -> str:
    return f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _pct(value: Optional[float]) -> Optional[str]:
    return None if value is None else f"{value:.1f}%".replace(".", ",")


# ==================== ABASTECIMENTO ====================

def _fuel_snapshot(supply: dict) -> dict:
    calc = _fuel_calc(supply)
    liters = round(float(supply.get("liters") or 0), 2)
    total = calc["total_value"]
    unit_price = float(supply.get("unit_price") or 0) or (round(total / liters, 4) if liters and total else 0)
    return {
        "id": supply["id"], "supply_number": supply.get("supply_number"), "supply_date": supply.get("supply_date"),
        "supplier_name": supply.get("supplier_name"), "document_number": supply.get("document_number"),
        "plate": supply.get("equipment_plate"), "liters": liters,
        "reading": supply.get("reading"), "total": total, "unit_price": round(unit_price, 4),
        # Interno = tanque próprio da empresa (custo do litro registrado no lançamento)
        "origin": "INTERNO" if supply.get("source") == "TANQUE_PROPRIO" else "EXTERNO",
        "paid_by": "MOTORISTA" if supply.get("payment_type") == "PAGO_MOTORISTA" else "EMPRESA",
    }


def _fuel_origin(f: dict) -> str:
    return f.get("origin") or "EXTERNO"  # acerto antigo: só posto pago pelo motorista


def _fuel_paid_by(f: dict) -> str:
    return f.get("paid_by") or "MOTORISTA"


def _fuel_location(f: dict) -> str:
    return "Tanque próprio" if _fuel_origin(f) == "INTERNO" else (f.get("supplier_name") or "-")


# ==================== VIAGENS ====================

def _km(km_start, km_end):
    return round(km_end - km_start, 1) if km_start is not None and km_end is not None else None


def _freight(order: dict) -> float:
    return round(float(order.get("freight_value") or 0), 2)


def _trip_snapshot(order: dict, km_start, km_end) -> dict:
    return {
        "source": "ORDEM_CARREGAMENTO",
        "loading_order_id": order["id"], "order_number": order.get("order_number"),
        "order_date": as_local_date(order.get("created_at")), "order_type": order.get("order_type"),
        "booking": order.get("booking"), "route_name": order.get("route_name"), "client_name": order.get("client_name"),
        "truck_plate": order.get("truck_plate"), "km_start": km_start, "km_end": km_end,
        "km": _km(km_start, km_end), "freight_value": _freight(order),  # frete da Rota = receita
    }


def _client_os_trip_snapshot(order: dict, km_start, km_end) -> dict:
    """Viagem de uma Ordem de Serviço - Cliente (routers/port_client_orders.py)."""
    port, client = order.get("port_terminal_name"), order.get("client_name")
    route = f"{client} → {port}" if order.get("operation_type") == "COLETA" else f"{port} → {client}"
    return {
        "source": "OS_CLIENTE",
        "port_client_order_id": order["id"], "order_number": order.get("order_number"),
        "order_date": (order.get("scheduled_at") or "")[:10] or as_local_date(order.get("created_at")),
        "order_type": order.get("operation_type"), "booking": order.get("booking"), "route_name": route,
        "client_name": client, "truck_plate": order.get("truck_plate"), "km_start": km_start, "km_end": km_end,
        "km": _km(km_start, km_end), "freight_value": _freight(order),  # frete lançado na OS = receita
    }


def trip_order_label(trip: dict) -> str:
    """'OC 12' / 'OS-C 5': as duas numerações são independentes."""
    return f"{TRIP_SOURCE_PREFIX.get(trip.get('source') or 'ORDEM_CARREGAMENTO', '')} {trip.get('order_number') or ''}".strip()


# ==================== AS DUAS CONTAS ====================

def _totals(fuel: list, trips: list, expenses: list, advances: list) -> dict:
    fuel_total = round(sum(f["total"] for f in fuel), 2)
    fuel_internal = round(sum(f["total"] for f in fuel if _fuel_origin(f) == "INTERNO"), 2)
    fuel_driver = round(sum(f["total"] for f in fuel if _fuel_paid_by(f) == "MOTORISTA"), 2)
    liters = round(sum(f["liters"] for f in fuel), 2)
    expenses_total = round(sum(e["total"] for e in expenses), 2)
    expenses_driver = round(sum(e["total"] for e in expenses if (e.get("paid_by") or "MOTORISTA") == "MOTORISTA"), 2)
    advances_total = round(sum(a["amount"] for a in advances if a["kind"] == "ADIANTAMENTO"), 2)
    returns_total = round(sum(a["amount"] for a in advances if a["kind"] == "DEVOLUCAO"), 2)
    km_total = round(sum(t.get("km") or 0 for t in trips), 1)
    revenue = round(sum(t.get("freight_value") or 0 for t in trips), 2)
    cost_total = round(fuel_total + expenses_total, 2)
    result = round(revenue - cost_total, 2)
    return {
        "fuel_total": fuel_total, "fuel_internal_total": fuel_internal,
        "fuel_external_total": round(fuel_total - fuel_internal, 2), "fuel_driver_total": fuel_driver,
        "fuel_liters": liters, "expenses_total": expenses_total, "expenses_driver_total": expenses_driver,
        "advances_total": advances_total, "returns_total": returns_total, "km_total": km_total,
        "km_per_liter": round(km_total / liters, 2) if km_total and liters else None,
        # Saldo com o motorista: só o que ELE pagou
        "balance": round(fuel_driver + expenses_driver - advances_total + returns_total, 2),
        # Resultado da viagem: tudo o que a viagem custou, quem quer que tenha pago
        "revenue": revenue, "cost_total": cost_total, "result": result,
        "margin": round(result / revenue * 100, 1) if revenue else None,
        "fuel_without_cost": sum(1 for f in fuel if not f.get("total")),
    }


async def _complete(docs: list) -> list:
    """Acerto antigo: viagens sem o frete copiado buscam o frete na ordem, e
    as contas são refeitas a partir das cópias gravadas (nada é gravado)."""
    missing_oc, missing_os = set(), set()
    for d in docs:
        for t in d.get("trips") or []:
            if "freight_value" in t:
                continue
            if t.get("port_client_order_id"):
                missing_os.add(t["port_client_order_id"])
            elif t.get("loading_order_id"):
                missing_oc.add(t["loading_order_id"])
    freights = {}
    if missing_oc:
        async for o in db.loading_orders.find({"id": {"$in": list(missing_oc)}}, {"_id": 0, "id": 1, "freight_value": 1}):
            freights[("oc", o["id"])] = _freight(o)
    if missing_os:
        async for o in db.port_client_orders.find({"id": {"$in": list(missing_os)}}, {"_id": 0, "id": 1, "freight_value": 1}):
            freights[("os", o["id"])] = _freight(o)
    for d in docs:
        trips = []
        for t in d.get("trips") or []:
            if "freight_value" not in t:
                key = ("os", t["port_client_order_id"]) if t.get("port_client_order_id") else ("oc", t.get("loading_order_id"))
                t = {**t, "freight_value": freights.get(key, 0.0)}
            trips.append(t)
        d["trips"] = trips
        d.update(_totals(d.get("fuel_supplies") or [], trips, d.get("expenses") or [], d.get("advances") or []))
    return docs


# ==================== GRAVAÇÃO ====================

async def _build(data: DriverSettlementCreate, settlement_id: Optional[str] = None) -> dict:
    """Valida tudo e monta os campos gravados (cópias + totais)."""
    driver = await db.drivers.find_one({"id": data.driver_id}, {"_id": 0, "id": 1, "name": 1})
    if not driver:
        raise HTTPException(status_code=400, detail="Motorista não encontrado")
    vehicle = None
    if data.vehicle_id:
        vehicle = await db.vehicles.find_one({"id": data.vehicle_id}, {"_id": 0, "id": 1, "plate": 1})
        if not vehicle:
            raise HTTPException(status_code=400, detail="Veículo não encontrado")
    settlement_date = _day(data.settlement_date, "Data do acerto")
    if not settlement_date:
        raise HTTPException(status_code=400, detail="Informe a data do acerto")
    trip_start = _day(data.trip_start, "Data de saída")
    trip_end = _day(data.trip_end, "Data de chegada")
    if trip_start and trip_end and trip_end < trip_start:
        raise HTTPException(status_code=400, detail="A chegada da viagem é antes da saída")

    fuel = []
    for supply_id in dict.fromkeys(data.fuel_supply_ids):
        supply = await db.fuel_supplies.find_one({"id": supply_id}, {"_id": 0})
        if not supply:
            raise HTTPException(status_code=400, detail="Abastecimento não encontrado")
        label = f"Abastecimento nº {supply.get('supply_number')}"
        # Da viagem: do motorista, ou do veículo do acerto (o tanque próprio pode
        # ter sido lançado com outro operador)
        same_vehicle = vehicle and supply.get("equipment_id") == vehicle["id"]
        if supply.get("driver_id") != driver["id"] and not same_vehicle:
            raise HTTPException(status_code=400, detail=f"{label} é de outro motorista e de outro veículo")
        other = await settlement_holding("fuel", supply_id, exclude_id=settlement_id)
        if other:
            raise HTTPException(status_code=400, detail=f"{label} já está no Acerto nº {other['settlement_number']}")
        fuel.append(_fuel_snapshot(supply))

    trips, seen = [], set()
    for trip in data.trips:
        if bool(trip.loading_order_id) == bool(trip.port_client_order_id):
            raise HTTPException(status_code=400, detail="Cada viagem deve indicar uma Ordem de Carregamento ou uma Ordem de Serviço - Cliente")
        if trip.port_client_order_id:
            if ("os", trip.port_client_order_id) in seen:
                continue
            seen.add(("os", trip.port_client_order_id))
            order = await db.port_client_orders.find_one({"id": trip.port_client_order_id}, {"_id": 0})
            if not order:
                raise HTTPException(status_code=400, detail="Ordem de Serviço - Cliente não encontrada")
            label = f"Ordem de Serviço - Cliente nº {order.get('order_number')}"
            if order.get("status") not in CLIENT_OS_TRIP_STATUSES:
                raise HTTPException(status_code=400, detail=(
                    f"{label} está {CLIENT_OS_STATUS_LABELS.get(order.get('status'), order.get('status'))}: "
                    "só entra no acerto em trânsito ou concluída"))
            if order.get("driver_id") != driver["id"]:
                raise HTTPException(status_code=400, detail=f"{label} é de outro motorista")
            if trip.km_start is not None and trip.km_end is not None and trip.km_end < trip.km_start:
                raise HTTPException(status_code=400, detail=f"{label}: km final menor que o inicial")
            other = await settlement_holding("client_os", trip.port_client_order_id, exclude_id=settlement_id)
            if other:
                raise HTTPException(status_code=400, detail=f"{label} já está no Acerto nº {other['settlement_number']}")
            trips.append(_client_os_trip_snapshot(order, trip.km_start, trip.km_end))
            continue
        if ("oc", trip.loading_order_id) in seen:
            continue
        seen.add(("oc", trip.loading_order_id))
        order = await db.loading_orders.find_one({"id": trip.loading_order_id}, {"_id": 0})
        if not order:
            raise HTTPException(status_code=400, detail="Ordem de Carregamento não encontrada")
        label = f"Ordem de Carregamento nº {order.get('order_number')}"
        if order.get("status") != "APROVADA":
            raise HTTPException(status_code=400, detail=f"{label} não está aprovada")
        if order.get("driver_id") != driver["id"]:
            raise HTTPException(status_code=400, detail=f"{label} é de outro motorista")
        if trip.km_start is not None and trip.km_end is not None and trip.km_end < trip.km_start:
            raise HTTPException(status_code=400, detail=f"{label}: km final menor que o inicial")
        other = await settlement_holding("trip", trip.loading_order_id, exclude_id=settlement_id)
        if other:
            raise HTTPException(status_code=400, detail=f"{label} já está no Acerto nº {other['settlement_number']}")
        trips.append(_trip_snapshot(order, trip.km_start, trip.km_end))

    expenses = []
    for e in data.expenses:
        description = " ".join((e.description or "").split())
        if not description:
            raise HTTPException(status_code=400, detail="Descreva cada despesa")
        expenses.append({
            "id": e.id, "expense_date": _day(e.expense_date, "Data da despesa"), "description": description,
            "supplier_name": (e.supplier_name or "").strip() or None, "quantity": e.quantity,
            "unit_value": round(e.unit_value, 2), "total": round(e.quantity * e.unit_value, 2),
            "paid_by": e.paid_by, "category": e.category,
        })

    advances = []
    for a in data.advances:
        if a.kind not in DRIVER_SETTLEMENT_ADVANCE_KINDS:
            raise HTTPException(status_code=400, detail="Tipo de adiantamento inválido")
        advances.append({
            "id": a.id, "kind": a.kind, "number": (a.number or "").strip() or None,
            "advance_date": _day(a.advance_date, "Data do adiantamento"), "amount": round(a.amount, 2),
        })

    return {
        "driver_id": driver["id"], "driver_name": driver["name"],
        "vehicle_id": vehicle["id"] if vehicle else None, "vehicle_plate": vehicle["plate"] if vehicle else None,
        "settlement_date": settlement_date, "trip_start": trip_start, "trip_end": trip_end,
        "observations": (data.observations or "").strip() or None,
        "fuel_supplies": fuel, "trips": trips, "expenses": expenses, "advances": advances,
        **_totals(fuel, trips, expenses, advances),
    }


async def _get_or_404(settlement_id: str) -> dict:
    doc = await db.driver_settlements.find_one({"id": settlement_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Acerto não encontrado")
    return (await _complete([doc]))[0]


def _ensure_open(doc: dict, action: str):
    if doc.get("status") == "FECHADO":
        raise HTTPException(status_code=400, detail=f"Acerto fechado: reabra o acerto para {action}")


def _list_query(search, status, driver_id, date_from, date_to) -> dict:
    query = {}
    if status:
        query["status"] = status
    if driver_id:
        query["driver_id"] = driver_id
    if date_from or date_to:
        query["settlement_date"] = {k: v for k, v in (("$gte", date_from), ("$lte", date_to)) if v}
    text = text_query(("driver_name", "vehicle_plate", "observations"), search)
    digits = (search or "").strip().lstrip("#")
    if digits.isdigit():
        text = {"$or": [text, {"settlement_number": int(digits)}]}
    return combine(query, text)


# ==================== ROTAS ====================

@api_router.get("/driver-settlements")
async def list_settlements(
    search: Optional[str] = None, status: Optional[str] = None, driver_id: Optional[str] = None,
    date_from: Optional[str] = None, date_to: Optional[str] = None, page: int = 1, per_page: int = 15,
    current_user: dict = Depends(get_current_admin_user),
):
    query = _list_query(search, status, driver_id, date_from, date_to)
    page, per_page = max(page, 1), min(max(per_page, 1), 100)
    total = await db.driver_settlements.count_documents(query)
    items = await db.driver_settlements.find(query, {"_id": 0}).sort(
        [("settlement_date", -1), ("settlement_number", -1)]
    ).skip((page - 1) * per_page).limit(per_page).to_list(per_page)
    return {"items": await _complete(items), "total": total, "page": page, "pages": (total + per_page - 1) // per_page}


@api_router.get("/driver-settlements/candidates")
async def list_candidates(
    driver_id: str, vehicle_id: Optional[str] = None, settlement_id: Optional[str] = None,
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user),
):
    """O que ainda não está em outro acerto (os do próprio acerto em edição continuam):
    - abastecimentos (interno e externo, qualquer forma de pagamento) do veículo
      escolhido - ou, sem veículo, do motorista - no período da viagem;
    - viagens do motorista: Ordens de Carregamento aprovadas e Ordens de
      Serviço - Cliente em trânsito ou concluídas."""
    fuel_query = {"equipment_id": vehicle_id} if vehicle_id else {"driver_id": driver_id}
    day_from, day_to = _day(date_from, "Data de saída"), _day(date_to, "Data de chegada")
    if day_from or day_to:
        fuel_query["supply_date"] = {k: v for k, v in (("$gte", day_from), ("$lte", day_to)) if v}
    trip_query = {"driver_id": driver_id, "status": "APROVADA"}
    os_query = {"driver_id": driver_id, "status": {"$in": list(CLIENT_OS_TRIP_STATUSES)}}
    if vehicle_id:
        vehicle = await db.vehicles.find_one({"id": vehicle_id}, {"_id": 0, "plate": 1})
        if vehicle and vehicle.get("plate"):
            trip_query["truck_plate"] = vehicle["plate"]
            os_query["truck_plate"] = {"$regex": plate_regex(vehicle["plate"], exact=True), "$options": "i"}

    used_fuel, used_trips, used_os = set(), set(), set()
    others = {"id": {"$ne": settlement_id}} if settlement_id else {}
    projection = {"_id": 0, "fuel_supplies.id": 1, "trips.loading_order_id": 1, "trips.port_client_order_id": 1}
    async for s in db.driver_settlements.find(others, projection):
        used_fuel.update(f["id"] for f in s.get("fuel_supplies") or [])
        for t in s.get("trips") or []:
            if t.get("port_client_order_id"):
                used_os.add(t["port_client_order_id"])
            elif t.get("loading_order_id"):
                used_trips.add(t["loading_order_id"])

    supplies = await db.fuel_supplies.find(fuel_query, {"_id": 0}).sort("supply_date", -1).to_list(300)
    orders = await db.loading_orders.find(trip_query, {"_id": 0}).sort("order_number", -1).to_list(300)
    client_orders = await db.port_client_orders.find(os_query, {"_id": 0}).sort("order_number", -1).to_list(300)
    return {
        "fuel_supplies": [_fuel_snapshot(s) for s in supplies if s["id"] not in used_fuel],
        "trips": [_trip_snapshot(o, None, None) for o in orders if o["id"] not in used_trips]
        + [_client_os_trip_snapshot(o, None, None) for o in client_orders if o["id"] not in used_os],
    }


# ==================== RELATÓRIO DE ACERTOS ====================

def _report_rows(items: list) -> list:
    return [[
        s.get("settlement_number"), s.get("settlement_date"), s.get("driver_name"), s.get("vehicle_plate"),
        len(s.get("trips") or []), s.get("km_total") or 0, s.get("revenue") or 0, s.get("cost_total") or 0,
        s.get("result") or 0, _pct(s.get("margin")), s.get("balance") or 0, STATUS_LABELS.get(s.get("status"), s.get("status")),
    ] for s in items]


def _report_section(items: list) -> Section:
    revenue = round(sum(s.get("revenue") or 0 for s in items), 2)
    cost = round(sum(s.get("cost_total") or 0 for s in items), 2)
    result = round(revenue - cost, 2)
    return Section(
        "Acertos da viagem",
        [Column("Nº", INT, 5), Column("Data", DAY, 8), Column("Motorista", width=20), Column("Veículo", width=8, align="center"),
         Column("Viagens", INT, 6), Column("Km", INT, 7), Column("Receita", MONEY, 11), Column("Custo Total", MONEY, 11),
         Column("Resultado", MONEY, 11), Column("Margem %", width=7, align="right"), Column("Saldo motorista", MONEY, 11),
         Column("Situação", width=7, align="center")],
        _report_rows(items),
        total=["TOTAL", None, None, None, sum(len(s.get("trips") or []) for s in items),
               round(sum(s.get("km_total") or 0 for s in items), 1), revenue, cost, result,
               _pct(round(result / revenue * 100, 1)) if revenue else None,
               round(sum(s.get("balance") or 0 for s in items), 2), None],
        empty_text="Nenhum acerto no período.",
        sheet_name="Acertos",
    )


async def _report_data(search, status, driver_id, date_from, date_to):
    query = _list_query(search, status, driver_id, date_from, date_to)
    items = await db.driver_settlements.find(query, {"_id": 0}).sort(
        [("settlement_date", 1), ("settlement_number", 1)]).to_list(None)
    items = await _complete(items)
    revenue = round(sum(s["revenue"] for s in items), 2)
    cost = round(sum(s["cost_total"] for s in items), 2)
    result = round(revenue - cost, 2)
    margin = round(result / revenue * 100, 1) if revenue else None
    filters = [period_text("Período", date_from, date_to)]
    if status:
        filters.append(f"Situação: {STATUS_LABELS.get(status, status)}")
    if driver_id:
        driver = await db.drivers.find_one({"id": driver_id}, {"_id": 0, "name": 1})
        filters.append(f"Motorista: {(driver or {}).get('name') or driver_id}")
    if search:
        filters.append(f"Busca: {search}")
    subtitle = " · ".join(f for f in filters if f) or "Todos os acertos"
    info = [("Acertos", str(len(items))), ("Receita", _money(revenue)), ("Custo total", _money(cost)),
            ("Resultado", f"{'Lucro' if result >= 0 else 'Prejuízo'} de {_money(abs(result))}"),
            ("Margem", _pct(margin) or "-")]
    return items, subtitle, info


@api_router.get("/driver-settlements/report/pdf")
async def settlements_report_pdf(
    search: Optional[str] = None, status: Optional[str] = None, driver_id: Optional[str] = None,
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user),
):
    items, subtitle, info = await _report_data(search, status, driver_id, date_from, date_to)
    return await pdf_response("Relatório de Acertos da Viagem", subtitle, info, [_report_section(items)],
                              "relatorio_acertos_viagem", current_user.get("name", "Sistema"))


@api_router.get("/driver-settlements/report/excel")
async def settlements_report_excel(
    search: Optional[str] = None, status: Optional[str] = None, driver_id: Optional[str] = None,
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user),
):
    items, subtitle, info = await _report_data(search, status, driver_id, date_from, date_to)
    stats = f"{subtitle}   •   " + "   •   ".join(f"{label}: {value}" for label, value in info)
    return await excel_response("Relatório de Acertos da Viagem", stats, [_report_section(items)], "relatorio_acertos_viagem")


# ==================== CRUD ====================

@api_router.get("/driver-settlements/{settlement_id}")
async def get_settlement(settlement_id: str, current_user: dict = Depends(get_current_admin_user)):
    return await _get_or_404(settlement_id)


@api_router.post("/driver-settlements")
async def create_settlement(data: DriverSettlementCreate, current_user: dict = Depends(get_current_admin_user)):
    fields = await _build(data)
    await ensure_period_open(fields["settlement_date"], what=WHAT)
    counter = await db.counters.find_one_and_update(
        {"_id": "driver_settlement_number"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    doc = {
        "id": str(uuid.uuid4()), "settlement_number": counter["seq"], **fields,
        "status": "ABERTO", "closed_at": None, "closed_by_name": None,
        "created_by": current_user["sub"], "created_by_name": current_user.get("name", "Sistema"),
        "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": None,
    }
    await db.driver_settlements.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/driver-settlements/{settlement_id}")
async def update_settlement(settlement_id: str, data: DriverSettlementCreate, current_user: dict = Depends(get_current_admin_user)):
    current = await _get_or_404(settlement_id)
    _ensure_open(current, "alterar")
    fields = await _build(data, settlement_id)
    await ensure_period_open(current.get("settlement_date"), fields["settlement_date"], what=WHAT)
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.driver_settlements.update_one({"id": settlement_id}, {"$set": fields})
    return await _get_or_404(settlement_id)


@api_router.delete("/driver-settlements/{settlement_id}")
async def delete_settlement(settlement_id: str, current_user: dict = Depends(get_current_admin_user)):
    current = await _get_or_404(settlement_id)
    _ensure_open(current, "excluir")
    await ensure_period_open(current.get("settlement_date"), what=WHAT)
    await db.driver_settlements.delete_one({"id": settlement_id})
    return {"message": "Acerto excluído"}


@api_router.put("/driver-settlements/{settlement_id}/close")
async def close_settlement(settlement_id: str, data: DriverSettlementClose, current_user: dict = Depends(get_current_admin_user)):
    """Fechar = saldo pago/recebido; reabrir apaga a data do fechamento."""
    current = await _get_or_404(settlement_id)
    if data.closed:
        if current.get("status") == "FECHADO":
            raise HTTPException(status_code=400, detail="Acerto já está fechado")
        closed_at = _day(data.date, "Data do fechamento") or today_brt().isoformat()
        await ensure_period_open(closed_at, what="Fechamento do acerto")
        fields = {"status": "FECHADO", "closed_at": closed_at, "closed_by_name": current_user.get("name", "Sistema")}
    else:
        if current.get("status") != "FECHADO":
            raise HTTPException(status_code=400, detail="Acerto não está fechado")
        await ensure_period_open(current.get("closed_at"), what="Fechamento do acerto")
        fields = {"status": "ABERTO", "closed_at": None, "closed_by_name": None}
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.driver_settlements.update_one({"id": settlement_id}, {"$set": fields})
    return await _get_or_404(settlement_id)


# ==================== IMPRESSÃO ====================

def _colored(text: str, positive: bool):
    """Valor do quadro do topo em verde (lucro/a pagar) ou vermelho."""
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import Paragraph
    color = "#047857" if positive else "#B91C1C"
    style = ParagraphStyle("SettlementColored", fontName="Helvetica-Bold", fontSize=8.5, leading=10.5)
    return Paragraph(f'<font color="{color}">{text}</font>', style)


def result_text(result: float, margin: Optional[float]) -> str:
    """'Lucro de R$ 1.700,00 (56,7%)' / 'Prejuízo de R$ 200,00'."""
    if result >= 0:
        return f"Lucro de {_money(result)}" + (f" ({_pct(margin)})" if margin is not None else "")
    return f"Prejuízo de {_money(-result)}"


@api_router.get("/driver-settlements/{settlement_id}/pdf")
async def get_settlement_pdf(settlement_id: str, current_user: dict = Depends(get_current_admin_user)):
    s = await _get_or_404(settlement_id)
    balance = s.get("balance") or 0
    if balance > 0:
        balance_text = f"{_money(balance)} a pagar ao motorista"
    elif balance < 0:
        balance_text = f"{_money(-balance)} a devolver pelo motorista"
    else:
        balance_text = "Zerado"
    result = s.get("result") or 0
    res_text = result_text(result, s.get("margin"))
    trip_days = None
    if s.get("trip_start") or s.get("trip_end"):
        trip_days = " a ".join(date.fromisoformat(d).strftime("%d/%m/%Y") if d else "-" for d in (s.get("trip_start"), s.get("trip_end")))
    info = [
        ("Motorista", s.get("driver_name") or "-"), ("Veículo", s.get("vehicle_plate") or "-"),
        ("Data do acerto", date.fromisoformat(s["settlement_date"]).strftime("%d/%m/%Y")),
        ("Situação", STATUS_LABELS.get(s.get("status"), s.get("status"))
         + (f" em {date.fromisoformat(s['closed_at']).strftime('%d/%m/%Y')}" if s.get("closed_at") else "")),
        ("Viagem", trip_days or "-"),
        ("Km rodado", _br_number(s.get("km_total") or 0, 1)),
        ("Média", f"{s['km_per_liter']:.2f} km/L".replace(".", ",") if s.get("km_per_liter") else "-"),
        ("Saldo com o motorista", _colored(balance_text, balance >= 0) if balance else balance_text),
        ("Resultado da viagem", _colored(res_text, result >= 0)),
    ]
    fuel = s.get("fuel_supplies") or []
    trips = s.get("trips") or []
    expenses = s.get("expenses") or []
    advances = s.get("advances") or []
    sections = [
        Section(
            "Saldo com o motorista",
            [Column("Item", width=30), Column("Valor", MONEY, 12)],
            [["Abastecimentos pagos pelo motorista", s.get("fuel_driver_total") or 0],
             ["Despesas pagas pelo motorista", s.get("expenses_driver_total") or 0],
             ["(-) Adiantamentos entregues ao motorista", -(s.get("advances_total") or 0)],
             ["(+) Devoluções do motorista", s.get("returns_total") or 0]],
            total=["= " + ("A pagar ao motorista" if balance > 0 else "A devolver pelo motorista" if balance < 0 else "Zerado"), abs(balance)],
            side_by_side=True,  # ao lado do "Resultado da viagem"
        ),
        Section(
            "Resultado da viagem",
            [Column("Item", width=30), Column("Valor", MONEY, 12)],
            [["Receita (frete das viagens)", s.get("revenue") or 0],
             ["(-) Abastecimento interno (tanque próprio)", -(s.get("fuel_internal_total") or 0)],
             ["(-) Abastecimento externo (posto)", -(s.get("fuel_external_total") or 0)],
             ["(-) Despesas (pedágio, diária, comissão...)", -(s.get("expenses_total") or 0)]],
            total=["= " + res_text, result],
        ),
        Section(
            "Abastecimento",
            [Column("Nº", INT, 4), Column("Data", DAY, 8.5), Column("Local/Posto", width=15), Column("Origem", width=7, align="center"),
             Column("Pagamento", width=8, align="center"), Column("Placa", width=8.5, align="center"),
             Column("Litros", width=6.5, align="right"), Column("R$/Litro", MONEY, 7.5), Column("Km hodôm.", INT, 7),
             Column("Total", MONEY, 9.5)],
            [[f.get("supply_number"), f.get("supply_date"), _fuel_location(f), FUEL_ORIGIN_LABELS[_fuel_origin(f)],
              PAID_BY_LABELS[_fuel_paid_by(f)], f.get("plate"), _br_number(f.get("liters")),
              round(f.get("unit_price") or (f["total"] / f["liters"] if f.get("liters") else 0), 2) or None,
              f.get("reading"), f.get("total")] for f in fuel],
            total=[None, None, "TOTAL", None, None, None, _br_number(s.get("fuel_liters")), None, None, s.get("fuel_total")],
            empty_text="Nenhum abastecimento.",
        ),
        Section(
            "Despesas",
            [Column("Descrição", width=18), Column("Categoria", width=11), Column("Pago por", width=8, align="center"),
             Column("Data", DAY, 8.5), Column("Fornecedor", width=12),
             Column("Qtd.", width=5, align="right"), Column("Unitário", MONEY, 9), Column("Total", MONEY, 9.5)],
            [[e.get("description"), EXPENSE_CATEGORY_LABELS.get(e.get("category") or "OUTRAS"),
              PAID_BY_LABELS.get(e.get("paid_by") or "MOTORISTA"), e.get("expense_date"), e.get("supplier_name"),
              _br_number(e.get("quantity")), e.get("unit_value"), e.get("total")] for e in expenses],
            total=["TOTAL", None, None, None, None, None, None, s.get("expenses_total")],
            empty_text="Nenhuma despesa.",
        ),
        Section(
            "Viagens",
            [Column("Ordem", width=7, align="center"), Column("Data", DAY, 8.5), Column("Booking", width=9), Column("Rota", width=20),
             Column("Placa", width=8.5, align="center"), Column("Km inicial", INT, 7), Column("Km final", INT, 7), Column("Km", INT, 6),
             Column("Frete", MONEY, 9.5)],
            [[trip_order_label(t), t.get("order_date"), t.get("booking"), t.get("route_name"), t.get("truck_plate"),
              t.get("km_start"), t.get("km_end"), t.get("km"), t.get("freight_value")] for t in trips],
            total=["TOTAL", None, None, None, None, None, None, s.get("km_total"), s.get("revenue")],
            empty_text="Nenhuma viagem.",
        ),
        Section(
            "Adiantamentos e devoluções",
            [Column("Tipo", width=14), Column("Número", width=14), Column("Data", DAY, 10), Column("Valor", MONEY, 12)],
            [[ADVANCE_LABELS.get(a.get("kind"), a.get("kind")), a.get("number"), a.get("advance_date"),
              a.get("amount") if a.get("kind") == "DEVOLUCAO" else -(a.get("amount") or 0)] for a in advances],
            # sem linha de total: o saldo já está no quadro "Saldo com o motorista"
            empty_text="Nenhum adiantamento.",
        ),
    ]
    subtitle = f"Acerto nº {s['settlement_number']}" + (f" · {s['observations']}" if s.get("observations") else "")
    return await pdf_response("Acerto da Viagem", subtitle, info, sections,
                              f"acerto_viagem_{s['settlement_number']}", current_user.get("name", "Sistema"),
                              portrait=True, info_cols=3)
