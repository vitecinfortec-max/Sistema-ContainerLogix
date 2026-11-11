"""Manutenção - Plano de Manutenção por tipo de veículo: cada plano vale para
um ou mais tipos do Cadastro de Veículos e lista os itens preventivos (troca
de óleo, filtros, lubrificação...) com intervalo em km e/ou em dias, vencendo
pelo que chegar primeiro. A execução de um item num veículo é registrada à
parte e recomeça a contagem dele. A situação de cada veículo x item vai para o
sino, o card de alertas e um e-mail diário às 07:00 para os e-mails
configurados no próprio plano.

Só entram os veículos marcados "Participa do Plano de Manutenção" no cadastro
(a frota própria acompanhada) e que não estejam inativos. O Registro de
Manutenção (MAN-000001) junta o que foi feito numa ida à oficina: os itens do
plano executados (cada um vira uma execução e recomeça a contagem), outros
serviços, peças e valores, com PDF e código de barras."""
import asyncio
import io
import re
import logging
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from html import escape
from typing import Optional

import resend
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pymongo.errors import DuplicateKeyError

from branding import email_layout
from models import MaintenanceExecutionCreate, MaintenancePlanCreate, MaintenancePlanSettings, MaintenanceRecordCreate
from reports import BRT_TZ, download_logo, merge_company
from routers.frota import get_vehicle_types, get_vehicles_current_km
from shared import db, get_company_settings, get_current_active_user, get_current_admin_user, get_disabled_modules, is_module_disabled
from tenancy import sender_email

api_router = APIRouter(prefix="/api")

logger = logging.getLogger(__name__)

MODULE_KEY = "frota.plano_manutencao"
SETTINGS_ID = "settings"
STATUS_LABELS = {"OVERDUE": "Vencido", "DUE_SOON": "Vence em breve", "OK": "Em dia", "NO_HISTORY": "Sem execução registrada"}
STATUS_ORDER = {"OVERDUE": 0, "DUE_SOON": 1, "NO_HISTORY": 2, "OK": 3}


def _today() -> date:
    return datetime.now(BRT_TZ).date()


def _parse_day(value: str, what: str) -> str:
    try:
        return date.fromisoformat((value or "")[:10]).isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{what} inválida")


# ------------------------------------------------------------------ planos

async def _clean_plan(data: MaintenancePlanCreate) -> dict:
    name = " ".join((data.name or "").split())
    if not name:
        raise HTTPException(status_code=400, detail="Informe o nome do plano")
    valid_types = {t["value"] for t in await get_vehicle_types(current_user={})}
    vehicle_types = list(dict.fromkeys(t for t in data.vehicle_types if t))
    if not vehicle_types:
        raise HTTPException(status_code=400, detail="Escolha pelo menos um tipo de veículo")
    unknown = [t for t in vehicle_types if t not in valid_types]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Tipo de veículo inválido: {', '.join(unknown)}")
    if not data.items:
        raise HTTPException(status_code=400, detail="Inclua pelo menos um item no plano")
    items, seen = [], set()
    for item in data.items:
        item_name = " ".join((item.name or "").split())
        if not item_name:
            raise HTTPException(status_code=400, detail="Todo item precisa de um nome")
        if not item.interval_km and not item.interval_days:
            raise HTTPException(status_code=400, detail=f"Informe o intervalo em km ou em dias do item \"{item_name}\"")
        if item_name.lower() in seen:
            raise HTTPException(status_code=400, detail=f"O item \"{item_name}\" aparece duas vezes no plano")
        seen.add(item_name.lower())
        items.append({**item.model_dump(), "name": item_name})
    return {
        "name": name, "vehicle_types": vehicle_types, "items": items,
        "active": data.active, "notes": (data.notes or "").strip() or None,
    }


@api_router.get("/maintenance-plans")
async def list_plans(current_user: dict = Depends(get_current_active_user)):
    return await db.maintenance_plans.find({}, {"_id": 0}).sort("name", 1).to_list(None)


@api_router.get("/maintenance-plans/settings")
async def get_settings(current_user: dict = Depends(get_current_active_user)):
    doc = await db.maintenance_plan_settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or {}
    return {"alert_emails": doc.get("alert_emails") or ""}


@api_router.put("/maintenance-plans/settings")
async def update_settings(data: MaintenancePlanSettings, current_user: dict = Depends(get_current_admin_user)):
    emails = [e.strip() for e in (data.alert_emails or "").split(";") if e.strip()]
    bad = [e for e in emails if "@" not in e or " " in e]
    if bad:
        raise HTTPException(status_code=400, detail=f"E-mail inválido: {', '.join(bad)}")
    value = "; ".join(emails)
    await db.maintenance_plan_settings.update_one({"id": SETTINGS_ID}, {"$set": {"id": SETTINGS_ID, "alert_emails": value}}, upsert=True)
    return {"alert_emails": value}


@api_router.get("/maintenance-plans/{plan_id}")
async def get_plan(plan_id: str, current_user: dict = Depends(get_current_active_user)):
    plan = await db.maintenance_plans.find_one({"id": plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(status_code=404, detail="Plano de manutenção não encontrado")
    return plan


@api_router.post("/maintenance-plans")
async def create_plan(data: MaintenancePlanCreate, current_user: dict = Depends(get_current_active_user)):
    doc = {
        "id": str(uuid.uuid4()), **await _clean_plan(data),
        "created_by": current_user["sub"], "created_by_name": current_user.get("name", "Sistema"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.maintenance_plans.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/maintenance-plans/{plan_id}")
async def update_plan(plan_id: str, data: MaintenancePlanCreate, current_user: dict = Depends(get_current_active_user)):
    current = await db.maintenance_plans.find_one({"id": plan_id}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Plano de manutenção não encontrado")
    fields = await _clean_plan(data)
    # Item que já tem execução não pode sumir do plano: o histórico apontaria para nada
    kept = {i["id"] for i in fields["items"]}
    for item in current.get("items", []):
        if item["id"] not in kept and await db.maintenance_executions.find_one({"plan_id": plan_id, "item_id": item["id"]}):
            raise HTTPException(
                status_code=400,
                detail=f"O item \"{item['name']}\" já tem execução registrada e não pode ser removido. Exclua as execuções dele antes.",
            )
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.maintenance_plans.update_one({"id": plan_id}, {"$set": fields})
    # As execuções guardam os nomes: renomear vale para o histórico também
    for item in fields["items"]:
        await db.maintenance_executions.update_many(
            {"plan_id": plan_id, "item_id": item["id"]}, {"$set": {"item_name": item["name"], "plan_name": fields["name"]}}
        )
    return await db.maintenance_plans.find_one({"id": plan_id}, {"_id": 0})


@api_router.delete("/maintenance-plans/{plan_id}")
async def delete_plan(plan_id: str, current_user: dict = Depends(get_current_active_user)):
    if not await db.maintenance_plans.find_one({"id": plan_id}):
        raise HTTPException(status_code=404, detail="Plano de manutenção não encontrado")
    if await db.maintenance_executions.find_one({"plan_id": plan_id}):
        raise HTTPException(status_code=400, detail="Este plano já tem execuções registradas. Desative o plano em vez de excluir.")
    await db.maintenance_plans.delete_one({"id": plan_id})
    return {"message": "Plano de manutenção excluído"}


# ------------------------------------------------------------------ situação

def _item_status(item: dict, last: Optional[dict], current_km, today: date) -> dict:
    """Próximo vencimento de um item num veículo, a partir da última execução."""
    row = {
        "item_id": item["id"], "item_name": item["name"],
        "interval_km": item.get("interval_km"), "interval_days": item.get("interval_days"),
        "last_date": None, "last_km": None, "due_km": None, "km_remaining": None,
        "due_date": None, "days_remaining": None, "status": "NO_HISTORY",
    }
    if not last:
        return row
    row["last_date"], row["last_km"] = last["executed_date"], last.get("km")
    late = soon = False
    if item.get("interval_km") and last.get("km") is not None:
        row["due_km"] = last["km"] + item["interval_km"]
        row["km_remaining"] = row["due_km"] - current_km
        late = late or row["km_remaining"] <= 0
        soon = soon or row["km_remaining"] <= item.get("alert_km", 0)
    if item.get("interval_days"):
        due = date.fromisoformat(last["executed_date"]) + timedelta(days=item["interval_days"])
        row["due_date"] = due.isoformat()
        row["days_remaining"] = (due - today).days
        late = late or row["days_remaining"] < 0
        soon = soon or row["days_remaining"] <= item.get("alert_days", 0)
    if row["due_km"] is None and row["due_date"] is None:
        return row  # só intervalo em km e a execução foi lançada sem km
    row["status"] = "OVERDUE" if late else "DUE_SOON" if soon else "OK"
    return row


def _fleet_query(types) -> dict:
    """Frota acompanhada: marcados no cadastro, não inativos, do tipo de algum plano."""
    return {"vehicle_type": {"$in": list(types)}, "status": {"$ne": "INATIVO"}, "in_maintenance_plan": True}


async def compute_plan_status(vehicle_id: Optional[str] = None, plan_id: Optional[str] = None) -> list:
    """Uma linha por veículo ativo x item dos planos ativos do tipo dele."""
    plan_query = {"active": True}
    if plan_id:
        plan_query["id"] = plan_id
    plans = await db.maintenance_plans.find(plan_query, {"_id": 0}).to_list(None)
    if not plans:
        return []
    types = {t for p in plans for t in p["vehicle_types"]}
    vehicle_query = _fleet_query(types)
    if vehicle_id:
        vehicle_query["id"] = vehicle_id
    vehicles = await db.vehicles.find(
        vehicle_query, {"_id": 0, "id": 1, "plate": 1, "model": 1, "vehicle_type": 1}
    ).sort("plate", 1).to_list(None)

    today = _today()
    # Tudo de uma vez (execuções e KM de todos os veículos), não uma consulta por veículo
    kms = await get_vehicles_current_km(vehicles)
    executions_by_vehicle = {}
    async for execution in db.maintenance_executions.find(
        {"vehicle_id": {"$in": [v["id"] for v in vehicles]}, "plan_id": {"$in": [p["id"] for p in plans]}}, {"_id": 0}
    ).sort([("executed_date", -1), ("created_at", -1)]):
        executions_by_vehicle.setdefault(execution["vehicle_id"], []).append(execution)
    rows = []
    for vehicle in vehicles:
        vehicle_plans = [p for p in plans if vehicle.get("vehicle_type") in p["vehicle_types"]]
        plan_ids = {p["id"] for p in vehicle_plans}
        executions = [e for e in executions_by_vehicle.get(vehicle["id"], []) if e["plan_id"] in plan_ids]
        last_by_item = {}
        for execution in executions:
            last_by_item.setdefault((execution["plan_id"], execution["item_id"]), execution)
        known_km = [e["km"] for e in executions if e.get("km") is not None]
        current_km = max([kms[vehicle["id"]], *known_km])
        for plan in vehicle_plans:
            for item in plan["items"]:
                row = _item_status(item, last_by_item.get((plan["id"], item["id"])), current_km, today)
                rows.append({
                    "vehicle_id": vehicle["id"], "vehicle_plate": vehicle.get("plate"), "vehicle_model": vehicle.get("model"),
                    "vehicle_type": vehicle.get("vehicle_type"), "current_km": current_km,
                    "plan_id": plan["id"], "plan_name": plan["name"], **row,
                })
    rows.sort(key=lambda r: (STATUS_ORDER[r["status"]], r["vehicle_plate"] or "", r["item_name"]))
    return rows


@api_router.get("/maintenance-plans-status")
async def get_plan_status(
    vehicle_id: Optional[str] = None, plan_id: Optional[str] = None, status: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user),
):
    rows = await compute_plan_status(vehicle_id, plan_id)
    summary = {key: sum(1 for r in rows if r["status"] == key) for key in STATUS_LABELS}
    if status:
        rows = [r for r in rows if r["status"] == status]
    # Veículos ativos do tipo de algum plano que ainda não foram marcados no
    # cadastro: a tela avisa, para nenhum ficar de fora sem ninguém perceber
    types = {t for p in await db.maintenance_plans.find({"active": True}, {"_id": 0, "vehicle_types": 1}).to_list(None) for t in p["vehicle_types"]}
    not_in_plan = await db.vehicles.count_documents(
        {"vehicle_type": {"$in": list(types)}, "status": {"$ne": "INATIVO"}, "in_maintenance_plan": {"$ne": True}}
    ) if types else 0
    return {"items": rows, "summary": summary, "vehicles_not_in_plan": not_in_plan}


@api_router.get("/maintenance-plans-fleet")
async def get_plan_fleet(current_user: dict = Depends(get_current_active_user)):
    """Veículos que podem receber um Registro de Manutenção, com os itens dos
    planos ativos do tipo de cada um e o KM atual."""
    plans = await db.maintenance_plans.find({"active": True}, {"_id": 0}).to_list(None)
    vehicles = await db.vehicles.find(
        {"status": {"$ne": "INATIVO"}, "in_maintenance_plan": True},
        {"_id": 0, "id": 1, "plate": 1, "model": 1, "brand": 1, "vehicle_type": 1},
    ).sort("plate", 1).to_list(None)
    kms = await get_vehicles_current_km(vehicles)
    out = []
    for vehicle in vehicles:
        items = [
            {"plan_id": p["id"], "plan_name": p["name"], "item_id": i["id"], "item_name": i["name"],
             "interval_km": i.get("interval_km"), "interval_days": i.get("interval_days")}
            for p in plans if vehicle.get("vehicle_type") in p["vehicle_types"] for i in p["items"]
        ]
        out.append({**vehicle, "items": items, "current_km": kms[vehicle["id"]]})
    return out


# ------------------------------------------------------------------ execuções

@api_router.get("/maintenance-executions")
async def list_executions(
    vehicle_id: Optional[str] = None, plan_id: Optional[str] = None, item_id: Optional[str] = None,
    page: int = 1, per_page: int = 20,
    current_user: dict = Depends(get_current_active_user),
):
    query = {k: v for k, v in (("vehicle_id", vehicle_id), ("plan_id", plan_id), ("item_id", item_id)) if v}
    page, per_page = max(page, 1), min(max(per_page, 1), 100)
    total = await db.maintenance_executions.count_documents(query)
    items = await db.maintenance_executions.find(query, {"_id": 0}).sort(
        [("executed_date", -1), ("created_at", -1)]
    ).skip((page - 1) * per_page).limit(per_page).to_list(per_page)
    return {"items": items, "total": total, "page": page, "pages": (total + per_page - 1) // per_page}


@api_router.post("/maintenance-executions")
async def create_execution(data: MaintenanceExecutionCreate, current_user: dict = Depends(get_current_active_user)):
    plan = await db.maintenance_plans.find_one({"id": data.plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(status_code=400, detail="Plano de manutenção não encontrado")
    item = next((i for i in plan["items"] if i["id"] == data.item_id), None)
    if not item:
        raise HTTPException(status_code=400, detail="Item do plano não encontrado")
    vehicle = await db.vehicles.find_one({"id": data.vehicle_id}, {"_id": 0, "id": 1, "plate": 1, "vehicle_type": 1, "in_maintenance_plan": 1})
    if not vehicle:
        raise HTTPException(status_code=400, detail="Veículo não encontrado")
    if not vehicle.get("in_maintenance_plan"):
        raise HTTPException(status_code=400, detail="Este veículo não participa do Plano de Manutenção (marque no cadastro do veículo)")
    if vehicle.get("vehicle_type") not in plan["vehicle_types"]:
        raise HTTPException(status_code=400, detail="Este plano não vale para o tipo deste veículo")
    executed_date = _parse_day(data.executed_date, "Data da execução")
    if executed_date > _today().isoformat():
        raise HTTPException(status_code=400, detail="A data da execução não pode ser futura")
    if item.get("interval_km") and data.km is None:
        raise HTTPException(status_code=400, detail="Informe o KM do veículo na execução: o item vence por km")

    doc = {
        "id": str(uuid.uuid4()), "plan_id": plan["id"], "plan_name": plan["name"],
        "item_id": item["id"], "item_name": item["name"],
        "vehicle_id": vehicle["id"], "vehicle_plate": vehicle.get("plate"),
        "executed_date": executed_date, "km": data.km,
        "service_order_number": (data.service_order_number or "").strip() or None,
        "notes": (data.notes or "").strip() or None,
        "created_by": current_user["sub"], "created_by_name": current_user.get("name", "Sistema"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.maintenance_executions.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.delete("/maintenance-executions/{execution_id}")
async def delete_execution(execution_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.maintenance_executions.delete_one({"id": execution_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Execução não encontrada")
    return {"message": "Execução excluída"}


# ------------------------------------------------------------------ alertas

def _plural(count: int, singular: str, plural: str) -> str:
    return f"{count} {singular if count == 1 else plural}"


def _names(items: list, limit: int = 3) -> str:
    """'ABC1D23, XYZ9K87 e mais 2' - os primeiros da lista e quantos sobraram."""
    shown = ", ".join(items[:limit])
    rest = len(items) - limit
    return f"{shown} e mais {rest}" if rest > 0 else shown


async def build_maintenance_plan_alerts() -> list:
    """Itens vencidos e vencendo, para o sino e o card "Alertas do Sistema"."""
    if is_module_disabled(MODULE_KEY, await get_disabled_modules()):
        return []
    rows = await compute_plan_status()
    alerts = []
    for status, key, tone, singular, plural in (
        ("OVERDUE", "maintenance_plan_overdue", "red", "vencido", "vencidos"),
        ("DUE_SOON", "maintenance_plan_due_soon", "amber", "vencendo", "vencendo"),
    ):
        hits = [r for r in rows if r["status"] == status]
        if not hits:
            continue
        alerts.append({
            "key": key,
            "title": f"{_plural(len(hits), 'item', 'itens')} do plano de manutenção {singular if len(hits) == 1 else plural}",
            "description": _names([f"{r['vehicle_plate']} ({r['item_name']})" for r in hits]),
            "path": f"/fleet/plano-manutencao?status={status}",
            "tone": tone,
        })
    return alerts


# ------------------------------------------------------------------ e-mail

resend.api_key = os.environ.get('RESEND_API_KEY', '')
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'onboarding@resend.dev')


def _situation_text(row: dict) -> str:
    parts = []
    if row["km_remaining"] is not None:
        km = row["km_remaining"]
        parts.append(f"{abs(km):,} km {'passados' if km <= 0 else 'restantes'}".replace(",", "."))
    if row["days_remaining"] is not None:
        days = row["days_remaining"]
        parts.append(f"{abs(days)} dia(s) {'de atraso' if days < 0 else 'restantes'}")
    return " / ".join(parts)


def _rows_table(title: str, rows: list) -> str:
    if not rows:
        return ""
    cell = "padding:4px 8px;border-bottom:1px solid #e2e8f0"
    head = "".join(f"<th style='text-align:left;padding:4px 8px;border-bottom:2px solid #cbd5e1'>{h}</th>" for h in ("Placa", "Item", "Situação"))
    body = "".join(
        f"<tr><td style='{cell}'>{escape(r['vehicle_plate'] or '-')}</td><td style='{cell}'>{escape(r['item_name'])}</td>"
        f"<td style='{cell}'>{escape(_situation_text(r))}</td></tr>"
        for r in rows
    )
    return f"<p><strong>{title} ({len(rows)})</strong></p><table style='border-collapse:collapse;font-size:13px;width:100%'><tr>{head}</tr>{body}</table>"


async def send_maintenance_plan_email() -> dict:
    """Manda a lista de itens vencidos/vencendo para os e-mails do plano.
    Sem e-mail configurado ou sem nada a avisar, não manda nada."""
    if is_module_disabled(MODULE_KEY, await get_disabled_modules()):
        return {"sent": False, "reason": "module_disabled"}
    settings = await db.maintenance_plan_settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or {}
    recipients = [e.strip() for e in (settings.get("alert_emails") or "").split(";") if e.strip()]
    if not recipients:
        return {"sent": False, "reason": "no_recipients"}
    rows = await compute_plan_status()
    overdue = [r for r in rows if r["status"] == "OVERDUE"]
    due_soon = [r for r in rows if r["status"] == "DUE_SOON"]
    if not overdue and not due_soon:
        return {"sent": False, "reason": "nothing_due"}

    company = await get_company_settings()
    company_name = company.get("name") or "ContainerLogix"
    today = _today().strftime("%d/%m/%Y")
    html = email_layout(company_name, "Plano de Manutenção", f"""
            <p>Olá,</p>
            <p>Situação do plano de manutenção em <strong>{today}</strong>:</p>
            {_rows_table("Vencidos", overdue)}
            {_rows_table("Vencendo em breve", due_soon)}
            <p>Ao fazer o serviço, registre a execução em Manutenção &gt; Plano de Manutenção para recomeçar a contagem.</p>
    """, f"E-mail automático - {company_name}")
    await asyncio.to_thread(resend.Emails.send, {
        "from": sender_email(SENDER_EMAIL),
        "to": recipients,
        "subject": f"{company_name} - Plano de Manutenção: {len(overdue)} vencido(s), {len(due_soon)} vencendo - {today}",
        "html": html,
    })
    return {"sent": True, "recipients": recipients, "overdue": len(overdue), "due_soon": len(due_soon)}


@api_router.post("/maintenance-plans/send-alert-email")
async def trigger_maintenance_plan_email(current_user: dict = Depends(get_current_admin_user)):
    """Manda agora o mesmo e-mail do envio automático das 07:00 (para testar)."""
    try:
        return await send_maintenance_plan_email()
    except Exception as e:
        logger.error(f"Erro ao enviar e-mail do plano de manutenção: {e}")
        raise HTTPException(status_code=502, detail="Não foi possível enviar o e-mail agora. Tente de novo em instantes.")


async def run_maintenance_plan_email_once():
    """Execução agendada: reserva o dia antes de enviar, para não mandar em
    dobro quando o backend roda em mais de um processo."""
    try:
        await db.scheduled_job_runs.insert_one({
            "_id": f"maintenance_plan_email:{_today().isoformat()}",
            "started_at": datetime.now(timezone.utc).isoformat(),
        })
    except DuplicateKeyError:
        return
    logger.info(f"E-mail do plano de manutenção: {await send_maintenance_plan_email()}")


# ------------------------------------------------------------------ registro de manutenção

RECORD_TYPES = {"PREVENTIVA": "Preventiva", "CORRETIVA": "Corretiva"}


def record_code(number: int) -> str:
    return f"MAN-{number:06d}"


def _record_number_from(search: str) -> Optional[int]:
    """'MAN-000012', 'man12', '000012' ou '12' (digitado ou lido pelo leitor)."""
    match = re.fullmatch(r"(?:MAN)?-?0*(\d+)", (search or "").strip().upper())
    return int(match.group(1)) if match else None


async def _next_record_number() -> int:
    # $inc atômico: dois usuários salvando ao mesmo tempo recebem números diferentes
    counter = await db.counters.find_one_and_update(
        {"_id": "maintenance_record_number"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    return counter["seq"]


@api_router.post("/maintenance-records")
async def create_maintenance_record(data: MaintenanceRecordCreate, current_user: dict = Depends(get_current_active_user)):
    vehicle = await db.vehicles.find_one({"id": data.vehicle_id}, {"_id": 0})
    if not vehicle:
        raise HTTPException(status_code=400, detail="Veículo não encontrado")
    if not vehicle.get("in_maintenance_plan") or vehicle.get("status") == "INATIVO":
        raise HTTPException(status_code=400, detail="Este veículo não participa do Plano de Manutenção (marque no cadastro do veículo)")
    executed_date = _parse_day(data.executed_date, "Data da execução")
    if executed_date > _today().isoformat():
        raise HTTPException(status_code=400, detail="A data da execução não pode ser futura")

    # Itens do plano: do tipo do veículo, sem repetir
    items, seen = [], set()
    for ref in data.items:
        if (ref.plan_id, ref.item_id) in seen:
            continue
        seen.add((ref.plan_id, ref.item_id))
        plan = await db.maintenance_plans.find_one({"id": ref.plan_id}, {"_id": 0})
        item = next((i for i in (plan or {}).get("items", []) if i["id"] == ref.item_id), None)
        if not plan or not item:
            raise HTTPException(status_code=400, detail="Item do plano não encontrado. Atualize a tela.")
        if vehicle.get("vehicle_type") not in plan["vehicle_types"]:
            raise HTTPException(status_code=400, detail=f"O plano \"{plan['name']}\" não vale para o tipo deste veículo")
        items.append({"plan_id": plan["id"], "plan_name": plan["name"], "item_id": item["id"], "item_name": item["name"],
                      "interval_km": item.get("interval_km"), "interval_days": item.get("interval_days")})
    if any(i["interval_km"] for i in items) and data.km is None:
        raise HTTPException(status_code=400, detail="Informe o KM do veículo: há item executado que vence por km")

    parts = []
    for part in data.parts:
        description = " ".join((part.description or "").split())
        if not description:
            continue
        parts.append({"description": description, "quantity": part.quantity, "unit_value": round(part.unit_value, 2),
                      "total": round(part.quantity * part.unit_value, 2)})
    other_services = (data.other_services or "").strip() or None
    if not items and not other_services and not parts:
        raise HTTPException(status_code=400, detail="Informe os itens do plano, os serviços ou as peças da manutenção")

    parts_total = round(sum(p["total"] for p in parts), 2)
    number = await _next_record_number()
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()), "record_number": number, "record_code": record_code(number),
        "vehicle_id": vehicle["id"], "vehicle_plate": vehicle.get("plate"),
        "vehicle_name": " ".join(p for p in (vehicle.get("brand"), vehicle.get("model")) if p) or None,
        "vehicle_type": vehicle.get("vehicle_type"),
        "executed_date": executed_date, "km": data.km, "maintenance_type": data.maintenance_type,
        "items": items, "other_services": other_services, "workshop": (data.workshop or "").strip() or None,
        "parts": parts, "parts_total": parts_total, "labor_value": round(data.labor_value, 2),
        "total_value": round(parts_total + data.labor_value, 2), "notes": (data.notes or "").strip() or None,
        "created_by": current_user["sub"], "created_by_name": current_user.get("name", "Sistema"), "created_at": now,
    }
    await db.maintenance_records.insert_one(doc)
    doc.pop("_id", None)
    # Cada item do plano executado recomeça a contagem dele (mesma execução da Situação)
    executions = [{
        "id": str(uuid.uuid4()), "plan_id": i["plan_id"], "plan_name": i["plan_name"], "item_id": i["item_id"], "item_name": i["item_name"],
        "vehicle_id": vehicle["id"], "vehicle_plate": vehicle.get("plate"), "executed_date": executed_date, "km": data.km,
        "service_order_number": doc["record_code"], "record_id": doc["id"], "notes": None,
        "created_by": current_user["sub"], "created_by_name": current_user.get("name", "Sistema"), "created_at": now,
    } for i in items]
    if executions:
        try:
            await db.maintenance_executions.insert_many(executions)
        except Exception:
            await db.maintenance_records.delete_one({"id": doc["id"]})
            raise
    return doc


def _record_query(search: Optional[str], vehicle_id: Optional[str]) -> dict:
    query = {"vehicle_id": vehicle_id} if vehicle_id else {}
    search = (search or "").strip()
    if not search:
        return query
    number = _record_number_from(search)
    # Número digitado ou lido pelo leitor ("MAN-000012", "12"): só esse registro
    if number is not None and (search.isdigit() or search.upper().startswith("MAN")):
        return {**query, "record_number": number}
    regex = {"$regex": re.escape(search), "$options": "i"}
    compact = re.sub(r"[^A-Za-z0-9]", "", search)
    plate = {"$regex": r"[\s-]*".join(re.escape(ch) for ch in compact), "$options": "i"} if compact else regex
    ors = [{"vehicle_plate": plate}, {"vehicle_name": regex}, {"workshop": regex}, {"other_services": regex}, {"items.item_name": regex}]
    return {**query, "$or": ors}


@api_router.get("/maintenance-records")
async def list_maintenance_records(
    search: Optional[str] = None, vehicle_id: Optional[str] = None, page: int = 1, per_page: int = 20,
    current_user: dict = Depends(get_current_active_user),
):
    query = _record_query(search, vehicle_id)
    page, per_page = max(page, 1), min(max(per_page, 1), 100)
    total = await db.maintenance_records.count_documents(query)
    items = await db.maintenance_records.find(query, {"_id": 0}).sort(
        [("executed_date", -1), ("record_number", -1)]
    ).skip((page - 1) * per_page).limit(per_page).to_list(per_page)
    return {"items": items, "total": total, "page": page, "pages": (total + per_page - 1) // per_page}


async def _get_record(record_id: str) -> dict:
    doc = await db.maintenance_records.find_one({"id": record_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Registro de manutenção não encontrado")
    return doc


@api_router.get("/maintenance-records/{record_id}")
async def get_maintenance_record(record_id: str, current_user: dict = Depends(get_current_active_user)):
    return await _get_record(record_id)


@api_router.delete("/maintenance-records/{record_id}")
async def delete_maintenance_record(record_id: str, current_user: dict = Depends(get_current_active_user)):
    doc = await _get_record(record_id)
    removed = await db.maintenance_executions.delete_many({"record_id": doc["id"]})
    await db.maintenance_records.delete_one({"id": doc["id"]})
    return {"message": f"Registro {doc['record_code']} excluído", "executions_removed": removed.deleted_count}


# ------------------------------------------------------------------ PDFs (modelo "Plano de Manutenção Preventiva")

PDF_BORDER = "#111827"
PDF_SHADE = "#F3F4F6"
PDF_NOTE_BG = "#FFF7ED"
PDF_NOTE_BORDER = "#9A3412"


def _br_int(value) -> str:
    return "-" if value in (None, "") else f"{int(round(value)):,}".replace(",", ".")


def _br_money(value) -> str:
    return "R$ " + f"{float(value or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _br_day(iso: Optional[str]) -> str:
    return "-" if not iso else "/".join(reversed(iso[:10].split("-")))


async def _pdf_document(*, title: str, info_rows: list, km_label: str, km_value, km_note: str, sections: list,
                        notes: list, signature: str, barcode: Optional[str] = None) -> bytes:
    """Monta o PDF no layout do modelo: cabeçalho em três caixas (título | logo |
    empresa, com o código de barras embaixo do nome), quadro do veículo com o
    hodômetro ao lado, as tabelas e o quadro de observações, e a assinatura."""
    from reportlab.graphics.barcode import code128
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.utils import ImageReader
    from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    from xml.sax.saxutils import escape as x

    company = merge_company(await get_company_settings())
    buffer = io.BytesIO()
    page = landscape(A4)
    doc = SimpleDocTemplate(buffer, pagesize=page, leftMargin=28, rightMargin=28, topMargin=24, bottomMargin=24,
                            title=title, author=company.get("name") or "ContainerLogix")
    width = page[0] - 56
    border, shade = colors.HexColor(PDF_BORDER), colors.HexColor(PDF_SHADE)
    base = ParagraphStyle("base", fontName="Helvetica", fontSize=10, leading=13)
    center = ParagraphStyle("center", parent=base, alignment=TA_CENTER)
    bold_center = ParagraphStyle("boldc", parent=center, fontName="Helvetica-Bold")
    elements = []

    # Cabeçalho: título | logo | empresa (+ código de barras do documento)
    logo_cell = ""
    logo = download_logo(company)
    if logo:
        try:
            iw, ih = ImageReader(logo).getSize()
            logo.seek(0)
            scale = min(110 / iw, 56 / ih)
            logo_cell = Image(logo, width=iw * scale, height=ih * scale)
        except Exception:
            logo_cell = ""
    right = [Paragraph(f"<b>{x(company.get('name') or '')}</b>", ParagraphStyle("co", parent=bold_center, fontSize=15, leading=18))]
    if barcode:
        right += [Spacer(1, 4), code128.Code128(barcode, barWidth=0.95, barHeight=26, humanReadable=False),
                  Paragraph(f"<b>{x(barcode)}</b>", ParagraphStyle("bc", parent=center, fontSize=9, leading=11))]
    header = Table([[Paragraph(f"<b>{x(title)}</b>", ParagraphStyle("t", parent=bold_center, fontSize=17, leading=21)), logo_cell, right]],
                   colWidths=[width * 0.36, width * 0.18, width * 0.46])
    header.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.9, border), ("INNERGRID", (0, 0), (-1, -1), 0.9, border),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    elements += [header, Spacer(1, 12)]

    # Quadro do veículo | hodômetro
    left = Table([[Paragraph(f"{x(label)}: {x(str(value or '-'))}", base)] for label, value in info_rows], colWidths=[width * 0.6])
    left.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.9, border), ("LINEBELOW", (0, 0), (-1, -2), 0.6, border),
        ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    km_box = Table([
        [Paragraph(f"<b>{x(km_label)}</b>", bold_center)],
        [Paragraph(_br_int(km_value), ParagraphStyle("km", parent=center, fontSize=15, leading=18))],
        [Paragraph(x(km_note), ParagraphStyle("kmn", parent=center, fontSize=8, leading=10, textColor=colors.HexColor("#7C2D12")))],
    ], colWidths=[width * 0.4])
    km_box.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.9, border), ("LINEABOVE", (0, 2), (-1, 2), 0.9, colors.HexColor(PDF_NOTE_BORDER)),
        ("BACKGROUND", (0, 2), (-1, 2), colors.HexColor(PDF_NOTE_BG)), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    info = Table([[left, km_box]], colWidths=[width * 0.6, width * 0.4])
    info.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    elements += [info, Spacer(1, 14)]

    # Seções: barra de título + cabeçalho com borda + linhas sobre fundo cinza
    for section in sections:
        bar = Table([[Paragraph(f"<b>{x(section['title'])}</b>", base)]], colWidths=[width])
        bar.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.9, border), ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
        elements += [bar, Spacer(1, 8)]
        cols = section["columns"]
        col_widths = [width * w for w in section["widths"]]
        head = Table([[Paragraph(f"<b>{x(c)}</b>", bold_center) for c in cols]], colWidths=col_widths)
        head.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.9, border), ("INNERGRID", (0, 0), (-1, -1), 0.9, border),
                                  ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
        cell = lambda v, i, bold=False: Paragraph(f"<b>{x(str(v))}</b>" if bold else x(str(v)), base if i == 0 else center)
        rows = [[cell(v, i) for i, v in enumerate(r)] for r in (section["rows"] or [["Nenhum item."] + [""] * (len(cols) - 1)])]
        style = [("BACKGROUND", (0, 0), (-1, -1), shade), ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]
        if section.get("total"):
            rows.append([cell(v, i, bold=True) for i, v in enumerate(section["total"])])
            style.append(("LINEABOVE", (0, -1), (-1, -1), 0.6, border))
        body = Table(rows, colWidths=col_widths)
        body.setStyle(TableStyle(style))
        elements += [head, Spacer(1, 4), body, Spacer(1, 12)]

    if notes:
        note_rows = [[Paragraph(n, ParagraphStyle("n", parent=center, fontSize=9, leading=12, textColor=colors.HexColor("#431407")))] for n in notes]
        box = Table(note_rows, colWidths=[width])
        box.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.9, colors.HexColor(PDF_NOTE_BORDER)),
                                 ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(PDF_NOTE_BG))]))
        elements.append(box)

    elements += [Spacer(1, 40), Paragraph(f"{x(signature)}: " + "_" * 70, base)]
    doc.build(elements)
    return buffer.getvalue()


def _pdf_response(pdf: bytes, filename: str) -> StreamingResponse:
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})


def _interval_text(item: dict) -> str:
    return " ou ".join(p for p in (f"{_br_int(item.get('interval_km'))} km" if item.get("interval_km") else None,
                                   f"{item['interval_days']} dias" if item.get("interval_days") else None) if p) or "-"


@api_router.get("/maintenance-records/{record_id}/pdf")
async def maintenance_record_pdf(record_id: str, current_user: dict = Depends(get_current_active_user)):
    from xml.sax.saxutils import escape as x
    rec = await _get_record(record_id)
    # Próxima troca de cada item a partir desta execução
    item_rows = []
    for i in rec["items"]:
        next_km = rec["km"] + i["interval_km"] if i.get("interval_km") and rec.get("km") is not None else None
        next_day = (date.fromisoformat(rec["executed_date"]) + timedelta(days=i["interval_days"])).isoformat() if i.get("interval_days") else None
        item_rows.append([i["item_name"], _interval_text(i),
                          " ou ".join(p for p in (f"{_br_int(next_km)} km" if next_km else None, _br_day(next_day) if next_day else None) if p) or "-"])
    sections = [{
        "title": "Itens do plano executados:", "columns": ["Item ou serviço", "Periodicidade", "Próxima troca (KM / data)"],
        "widths": [0.44, 0.22, 0.34], "rows": item_rows,
    }]
    if rec.get("other_services"):
        sections.append({"title": "Outros serviços executados:", "columns": ["Descrição"], "widths": [1.0],
                         "rows": [[line] for line in rec["other_services"].splitlines() if line.strip()]})
    if rec.get("parts") or rec.get("labor_value"):
        sections.append({
            "title": "Peças e valores:", "columns": ["Peça", "Quantidade", "Valor unitário", "Total"],
            "widths": [0.46, 0.14, 0.2, 0.2],
            "rows": [[p["description"], f"{p['quantity']:g}".replace(".", ","), _br_money(p["unit_value"]), _br_money(p["total"])] for p in rec.get("parts", [])]
                    + ([["Mão de obra", "", "", _br_money(rec["labor_value"])]] if rec.get("labor_value") else []),
            "total": ["TOTAL", "", "", _br_money(rec.get("total_value"))],
        })
    notes = []
    if rec.get("notes"):
        notes.append(f"<b>Observações:</b> {x(rec['notes'])}")
    notes.append("<b>Este registro não substitui a inspeção geral em todos os itens do veículo.</b>")
    pdf = await _pdf_document(
        title="Registro de Manutenção",
        info_rows=[("Nome do Veículo", rec.get("vehicle_name")), ("Placa", rec.get("vehicle_plate")),
                   ("Oficina / Responsável", rec.get("workshop")),
                   ("Data", f"{_br_day(rec['executed_date'])}   ·   Tipo: {RECORD_TYPES.get(rec['maintenance_type'], rec['maintenance_type'])}")],
        km_label="Hodômetro na execução (KM):", km_value=rec.get("km"),
        km_note=f"Registro {rec['record_code']} · lançado por {rec.get('created_by_name') or '-'}",
        sections=sections, notes=notes, signature="ASSINATURA DO RESPONSÁVEL", barcode=rec["record_code"],
    )
    return _pdf_response(pdf, f"{rec['record_code']}.pdf")


@api_router.get("/maintenance-plans-status/vehicle/{vehicle_id}/pdf")
async def maintenance_plan_vehicle_pdf(vehicle_id: str, current_user: dict = Depends(get_current_active_user)):
    """O plano do veículo para imprimir (o modelo da J.A): cada item com a
    periodicidade e o próximo KM/data, a partir da última execução ou, sem
    execução, do KM atual."""
    vehicle = await db.vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    if not vehicle:
        raise HTTPException(status_code=404, detail="Veículo não encontrado")
    rows = await compute_plan_status(vehicle_id=vehicle_id)
    if not rows:
        raise HTTPException(status_code=400, detail="Este veículo não está em nenhum plano ativo (confira o tipo e a marcação no cadastro)")
    today = _today()
    current_km = rows[0]["current_km"]
    table = []
    for r in sorted(rows, key=lambda r: r["item_name"]):
        next_km = r["due_km"] if r["due_km"] is not None else (current_km + r["interval_km"] if r.get("interval_km") else None)
        next_day = r["due_date"] if r["due_date"] else ((today + timedelta(days=r["interval_days"])).isoformat() if r.get("interval_days") else None)
        table.append([r["item_name"], _br_int(r["interval_km"]) if r.get("interval_km") else "-",
                      f"{r['interval_days']} dias" if r.get("interval_days") else "-",
                      _br_int(next_km) if next_km else "-", _br_day(next_day) if next_day else "-",
                      STATUS_LABELS[r["status"]]])
    plan_names = sorted({r["plan_name"] for r in rows})
    pdf = await _pdf_document(
        title="Plano de Manutenção Preventiva",
        info_rows=[("Nome do Veículo", " ".join(p for p in (vehicle.get("brand"), vehicle.get("model")) if p)),
                   ("Placa", vehicle.get("plate")), ("Responsável", current_user.get("name")), ("Data", today.strftime("%d/%m/%Y"))],
        km_label="Hodômetro atual (KM):", km_value=current_km,
        km_note="Maior KM conhecido: hodômetro, abastecimentos, revisões e execuções",
        sections=[{
            "title": "Itens de troca obrigatória:",
            "columns": ["Item ou serviço", "Periodicidade (KM)", "Periodicidade (dias)", "Hodômetro (KM)", "Data", "Situação"],
            "widths": [0.32, 0.13, 0.13, 0.14, 0.12, 0.16], "rows": table,
        }],
        notes=[f"Plano: {', '.join(plan_names)}. Este plano não sobrepõe as orientações do manual do proprietário do veículo.",
               "<b>Esse plano também não substitui a inspeção geral em todos os itens do veículo.</b>"],
        signature="ASSINATURA DO RESPONSÁVEL",
    )
    return _pdf_response(pdf, f"plano_manutencao_{(vehicle.get('plate') or 'veiculo').replace('-', '')}.pdf")
