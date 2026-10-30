from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query

from list_filters import combine, day_query, text_query
from period_reports import Column, Section, DAY, INT, pdf_response, excel_response, period_text
from reports import BRT_TZ, short_person_name
from shared import db, get_current_active_user

api_router = APIRouter(prefix="/api")

# ==================== STATUS DE ENTREGA - RELATÓRIO DO PERÍODO ====================
# Cada Status de Entrega só tinha o próprio PDF/Excel. Aqui: as viagens do
# período (pela data do status) por cliente e por motorista, com o tempo de
# permanência no cliente e de carregamento, e as pendências de lançamento
# (status concluído com viagem sem "Entrega finalizada", status ainda ativo
# de dia que já passou, horários incompletos).

STATUS_LABELS = {"ATIVO": "Ativo", "CONCLUIDO": "Concluído", "CANCELADO": "Cancelado"}
STATUS_PATTERN = "^(ATIVO|CONCLUIDO|CANCELADO)$"


def _minutes(start: Optional[str], end: Optional[str]) -> Optional[int]:
    """Minutos entre dois horários HH:MM; passa da meia-noite se o fim for menor"""
    try:
        h1, m1 = map(int, start.split(":")[:2])
        h2, m2 = map(int, end.split(":")[:2])
    except (AttributeError, ValueError):
        return None
    diff = (h2 * 60 + m2) - (h1 * 60 + m1)
    return diff + 24 * 60 if diff < 0 else diff


def _hhmm(minutes: Optional[float]) -> Optional[str]:
    if minutes is None:
        return None
    minutes = int(round(minutes))
    return f"{minutes // 60}h{minutes % 60:02d}"


def _avg(values):
    values = [v for v in values if v is not None]
    return sum(values) / len(values) if values else None


async def build_delivery_report(date_from=None, date_to=None, status=None, search=None) -> dict:
    query = combine(
        day_query("status_date", date_from, date_to),
        {"status": status} if status else {"status": {"$ne": "CANCELADO"}},
        text_query(("destination_client_name", "contracting_client_name", "items.driver_name", "items.container_number"), search),
    )
    docs = await db.delivery_statuses.find(query, {"_id": 0}).sort([("status_date", 1), ("status_number", 1)]).to_list(None)
    today = datetime.now(BRT_TZ).date().isoformat()

    trips, issues, clients, drivers = [], [], {}, {}
    for doc in docs:
        client = doc.get("destination_client_name") or "(sem cliente)"
        doc_status = doc.get("status") or "ATIVO"
        if doc_status == "ATIVO" and (doc.get("status_date") or today) < today:
            issues.append({"status_number": doc.get("status_number"), "day": doc.get("status_date"), "client_name": client,
                           "driver_name": None, "issue": "Status ainda ativo de um dia que já passou"})
        for item in doc.get("items") or []:
            at_client = _minutes(item.get("arrival_time"), item.get("departure_time"))
            loading = _minutes(item.get("loading_start_time"), item.get("loading_end_time"))
            missing = [label for key, label in (("arrival_time", "chegada"), ("departure_time", "saída"),
                                                 ("delivery_completed", "entrega finalizada")) if not item.get(key)]
            trip = {
                "status_number": doc.get("status_number"), "day": doc.get("status_date"), "status": doc_status,
                "client_name": client, "booking": doc.get("booking"),
                "driver_name": item.get("driver_name"), "cavalo_plate": item.get("cavalo_plate"),
                "container_number": item.get("container_number"),
                "arrival_time": item.get("arrival_time"), "departure_time": item.get("departure_time"),
                "delivery_completed": item.get("delivery_completed"),
                "minutes_at_client": at_client, "minutes_loading": loading,
            }
            trips.append(trip)
            if doc_status == "CONCLUIDO" and not item.get("delivery_completed"):
                issues.append({**{k: trip[k] for k in ("status_number", "day", "client_name", "driver_name")},
                               "issue": "Status concluído com viagem sem entrega finalizada"})
            elif doc_status == "CONCLUIDO" and missing:
                issues.append({**{k: trip[k] for k in ("status_number", "day", "client_name", "driver_name")},
                               "issue": "Horário sem lançar: " + ", ".join(missing)})
            for group, key in ((clients, client), (drivers, item.get("driver_name") or "(sem motorista)")):
                g = group.setdefault(key, {"name": key, "trips": 0, "at_client": [], "loading": []})
                g["trips"] += 1
                g["at_client"].append(at_client)
                g["loading"].append(loading)

    def summarize(group):
        return sorted(({"name": g["name"], "trips": g["trips"], "avg_at_client": _avg(g["at_client"]),
                        "avg_loading": _avg(g["loading"])} for g in group.values()), key=lambda g: (-g["trips"], g["name"]))

    return {
        "trips": trips,
        "issues": issues,
        "clients": summarize(clients),
        "drivers": summarize(drivers),
        "summary": {
            "statuses": len(docs),
            "trips": len(trips),
            "avg_at_client": _avg(t["minutes_at_client"] for t in trips),
            "avg_loading": _avg(t["minutes_loading"] for t in trips),
            "issues": len(issues),
        },
    }


def _sections(data):
    s = data["summary"]
    group_cols = lambda label: [Column(label, width=40), Column("Viagens", INT, 10),
                                Column("Média no cliente", width=14, align="center"), Column("Média de carregamento", width=16, align="center")]
    group_rows = lambda rows: [[g["name"], g["trips"], _hhmm(g["avg_at_client"]), _hhmm(g["avg_loading"])] for g in rows]
    issues = Section(
        "Pendências de lançamento",
        [Column("Status nº", INT, 9), Column("Data", DAY, 10), Column("Cliente", width=28), Column("Motorista", width=24),
         Column("Pendência", width=40)],
        [[i["status_number"], i["day"], i["client_name"], short_person_name(i["driver_name"]), i["issue"]] for i in data["issues"]],
        empty_text="Nenhuma pendência no período.", sheet_name="Pendências",
    )
    by_client = Section("Por cliente", group_cols("Cliente"), group_rows(data["clients"]),
                        total=["TOTAL", s["trips"], _hhmm(s["avg_at_client"]), _hhmm(s["avg_loading"])],
                        empty_text="Nenhuma viagem no período.", sheet_name="Por cliente")
    by_driver = Section("Por motorista", group_cols("Motorista"), group_rows([{**g, "name": short_person_name(g["name"])} for g in data["drivers"]]),
                        empty_text="Nenhuma viagem no período.", sheet_name="Por motorista")
    detail = Section(
        "Viagens",
        [Column("Status nº", INT, 8), Column("Data", DAY, 9), Column("Situação", width=9, align="center"), Column("Cliente", width=20),
         Column("Motorista", width=18), Column("Placa", width=9, align="center"), Column("Container", width=13),
         Column("Chegada", width=7, align="center"), Column("Saída", width=7, align="center"),
         Column("No cliente", width=8, align="center"), Column("Finalizada", width=8, align="center")],
        [[t["status_number"], t["day"], STATUS_LABELS.get(t["status"], t["status"]), t["client_name"], short_person_name(t["driver_name"]),
          t["cavalo_plate"], t["container_number"], t["arrival_time"], t["departure_time"], _hhmm(t["minutes_at_client"]),
          t["delivery_completed"]] for t in data["trips"]],
        empty_text="Nenhuma viagem no período.", sheet_name="Viagens",
    )
    return [issues, by_client, by_driver, detail]


def _subtitle(date_from, date_to, status, search):
    parts = [period_text("Data do status", date_from, date_to), STATUS_LABELS.get(status, "Ativos e concluídos"),
             f"Busca: {search}" if search else None]
    return " · ".join(p for p in parts if p)


@api_router.get("/reports/delivery-status")
async def get_delivery_report(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    status: Optional[str] = Query(None, pattern=STATUS_PATTERN), search: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user),
):
    """Viagens do período por cliente e motorista, tempos e pendências de lançamento"""
    return await build_delivery_report(date_from, date_to, status, search)


@api_router.get("/reports/delivery-status/pdf")
async def get_delivery_report_pdf(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    status: Optional[str] = Query(None, pattern=STATUS_PATTERN), search: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user),
):
    data = await build_delivery_report(date_from, date_to, status, search)
    s = data["summary"]
    info = [("Status de entrega", str(s["statuses"])), ("Viagens", str(s["trips"])),
            ("Média no cliente", _hhmm(s["avg_at_client"]) or "-"), ("Média de carregamento", _hhmm(s["avg_loading"]) or "-"),
            ("Pendências", str(s["issues"]))]
    return await pdf_response("Relatório de Status de Entrega", _subtitle(date_from, date_to, status, search), info,
                              _sections(data), "relatorio_status_entrega", current_user.get("name", "Sistema"))


@api_router.get("/reports/delivery-status/excel")
async def get_delivery_report_excel(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    status: Optional[str] = Query(None, pattern=STATUS_PATTERN), search: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user),
):
    data = await build_delivery_report(date_from, date_to, status, search)
    return await excel_response("Relatório de Status de Entrega", _subtitle(date_from, date_to, status, search),
                                _sections(data), "relatorio_status_entrega")
