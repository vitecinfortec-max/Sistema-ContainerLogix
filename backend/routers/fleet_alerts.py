"""Alertas de vencimento de documentos do sino do topo e do card "Alertas do
Sistema": documentos dos veículos ativos (CRLV, licenciamento, tacógrafo,
vistoria, seguro) e CNH dos motoristas ativos, vencidos ou vencendo nos
próximos dias. Módulo de veículos não contratado não gera alerta de veículo."""
from datetime import datetime, timedelta

from reports import BRT_TZ
from shared import db, get_disabled_modules, is_module_disabled

DOC_ALERT_DAYS = 30  # mesmo prazo do aviso na lista da Frota

VEHICLE_DOC_FIELDS = {
    "crlv_expiry": "CRLV",
    "licensing_expiry": "Licenciamento",
    "tachograph_expiry": "Tacógrafo",
    "inspection_expiry": "Vistoria",
    "insurance_expiry": "Seguro",
}


def _plural(count: int, singular: str, plural: str) -> str:
    return f"{count} {singular if count == 1 else plural}"


def _names(items: list, limit: int = 3) -> str:
    """'ABC1D23, XYZ9K87 e mais 2' - os primeiros da lista e quantos sobraram."""
    shown = ", ".join(items[:limit])
    rest = len(items) - limit
    return f"{shown} e mais {rest}" if rest > 0 else shown


async def build_fleet_alerts() -> list:
    disabled = await get_disabled_modules()
    today_date = datetime.now(BRT_TZ).date()
    today = today_date.isoformat()
    soon = (today_date + timedelta(days=DOC_ALERT_DAYS)).isoformat()
    alerts = []

    if not is_module_disabled("frota.veiculos", disabled):
        expired, due_soon = [], []
        projection = {"_id": 0, "plate": 1, **{f: 1 for f in VEHICLE_DOC_FIELDS}}
        async for vehicle in db.vehicles.find({"status": {"$ne": "INATIVO"}}, projection):
            dates = {label: (vehicle.get(field) or "")[:10] for field, label in VEHICLE_DOC_FIELDS.items()}
            late = [label for label, date in dates.items() if date and date < today]
            near = [label for label, date in dates.items() if date and today <= date <= soon]
            if late:
                expired.append(f"{vehicle['plate']} ({', '.join(late)})")
            elif near:
                due_soon.append(f"{vehicle['plate']} ({', '.join(near)})")
        if expired:
            alerts.append({
                "key": "vehicle_docs_expired",
                "title": f"{_plural(len(expired), 'veículo', 'veículos')} com documento vencido",
                "description": _names(expired),
                "path": "/fleet",
                "tone": "red",
            })
        if due_soon:
            alerts.append({
                "key": "vehicle_docs_due_soon",
                "title": f"{_plural(len(due_soon), 'veículo', 'veículos')} com documento vencendo em até {DOC_ALERT_DAYS} dias",
                "description": _names(due_soon),
                "path": "/fleet",
                "tone": "amber",
            })

    expired, due_soon = [], []
    cursor = db.drivers.find(
        {"status": {"$ne": "INATIVO"}, "cnh_expiry": {"$nin": [None, ""]}},
        {"_id": 0, "name": 1, "cnh_expiry": 1},
    )
    async for driver in cursor:
        date = driver["cnh_expiry"][:10]
        if date < today:
            expired.append(driver["name"])
        elif date <= soon:
            due_soon.append(driver["name"])
    if expired:
        alerts.append({
            "key": "driver_cnh_expired",
            "title": f"{_plural(len(expired), 'motorista', 'motoristas')} com CNH vencida",
            "description": _names(expired),
            "path": "/cadastro?type=motorista",
            "tone": "red",
        })
    if due_soon:
        alerts.append({
            "key": "driver_cnh_due_soon",
            "title": f"{_plural(len(due_soon), 'motorista', 'motoristas')} com CNH vencendo em até {DOC_ALERT_DAYS} dias",
            "description": _names(due_soon),
            "path": "/cadastro?type=motorista",
            "tone": "amber",
        })

    return alerts
