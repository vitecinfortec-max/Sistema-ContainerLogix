"""Manutenção - Plano de Manutenção por tipo de veículo: cada plano vale para
um ou mais tipos do Cadastro de Veículos e lista os itens preventivos (troca
de óleo, filtros, lubrificação...) com intervalo em km e/ou em dias, vencendo
pelo que chegar primeiro. A execução de um item num veículo é registrada à
parte e recomeça a contagem dele. A situação de cada veículo x item vai para o
sino, o card de alertas e um e-mail diário às 07:00 para os e-mails
configurados no próprio plano."""
import asyncio
import logging
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from html import escape
from typing import Optional

import resend
from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from branding import email_layout
from models import MaintenanceExecutionCreate, MaintenancePlanCreate, MaintenancePlanSettings
from reports import BRT_TZ
from routers.frota import get_vehicle_current_km, get_vehicle_types
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


async def compute_plan_status(vehicle_id: Optional[str] = None, plan_id: Optional[str] = None) -> list:
    """Uma linha por veículo ativo x item dos planos ativos do tipo dele."""
    plan_query = {"active": True}
    if plan_id:
        plan_query["id"] = plan_id
    plans = await db.maintenance_plans.find(plan_query, {"_id": 0}).to_list(None)
    if not plans:
        return []
    types = {t for p in plans for t in p["vehicle_types"]}
    vehicle_query = {"vehicle_type": {"$in": list(types)}, "status": {"$ne": "INATIVO"}}
    if vehicle_id:
        vehicle_query["id"] = vehicle_id
    vehicles = await db.vehicles.find(
        vehicle_query, {"_id": 0, "id": 1, "plate": 1, "model": 1, "vehicle_type": 1}
    ).sort("plate", 1).to_list(None)

    today = _today()
    rows = []
    for vehicle in vehicles:
        vehicle_plans = [p for p in plans if vehicle.get("vehicle_type") in p["vehicle_types"]]
        executions = await db.maintenance_executions.find(
            {"vehicle_id": vehicle["id"], "plan_id": {"$in": [p["id"] for p in vehicle_plans]}}, {"_id": 0}
        ).sort([("executed_date", -1), ("created_at", -1)]).to_list(None)
        last_by_item = {}
        for execution in executions:
            last_by_item.setdefault((execution["plan_id"], execution["item_id"]), execution)
        known_km = [e["km"] for e in executions if e.get("km") is not None]
        current_km = max([await get_vehicle_current_km(vehicle["id"], vehicle.get("plate")), *known_km])
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
    return {"items": rows, "summary": summary}


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
    vehicle = await db.vehicles.find_one({"id": data.vehicle_id}, {"_id": 0, "id": 1, "plate": 1, "vehicle_type": 1})
    if not vehicle:
        raise HTTPException(status_code=400, detail="Veículo não encontrado")
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
