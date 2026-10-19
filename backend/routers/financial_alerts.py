"""Alertas financeiros do sino do topo (só para administradores): cheques
vencidos sem compensar, cheques vencendo nos próximos dias, cheques devolvidos
e faturas vencidas. Módulo não contratado pelo cliente não gera alerta."""
from datetime import datetime, timedelta

from reports import BRT_TZ
from shared import db, get_disabled_modules, is_module_disabled
from routers.checks import DUE_SOON_DAYS


def _brl(value: float) -> str:
    text = f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {text}"


def _plural(count: int, singular: str, plural: str) -> str:
    return f"{count} {singular if count == 1 else plural}"


async def build_financial_alerts() -> list:
    disabled = await get_disabled_modules()
    today = datetime.now(BRT_TZ).date()
    today_iso = today.isoformat()
    alerts = []

    if not is_module_disabled("financeiro.controle_cheque", disabled):
        soon = (today + timedelta(days=DUE_SOON_DAYS)).isoformat()
        groups = {key: [0, 0.0] for key in ("overdue", "due_soon", "returned")}
        cursor = db.checks.find({"status": {"$in": ["EMITIDO", "DEVOLVIDO"]}}, {"_id": 0, "status": 1, "amount": 1, "due_date": 1})
        async for doc in cursor:
            due = doc.get("due_date") or ""
            if doc["status"] == "DEVOLVIDO":
                key = "returned"
            elif due < today_iso:
                key = "overdue"
            elif due <= soon:
                key = "due_soon"
            else:
                continue
            groups[key][0] += 1
            groups[key][1] += doc.get("amount") or 0
        texts = {
            "overdue": ("vencido sem compensar", "vencidos sem compensar", "red"),
            "returned": ("devolvido", "devolvidos", "red"),
            "due_soon": (f"vencendo em até {DUE_SOON_DAYS} dias", f"vencendo em até {DUE_SOON_DAYS} dias", "amber"),
        }
        for key, (singular, plural, tone) in texts.items():
            count, total = groups[key]
            if count:
                alerts.append({
                    "key": f"checks_{key}",
                    "title": f"{_plural(count, 'cheque', 'cheques')} {singular if count == 1 else plural}",
                    "description": f"Total de {_brl(total)}",
                    "path": "/checks",
                    "tone": tone,
                })

    if not is_module_disabled("financeiro.faturas", disabled):
        count, total, oldest = 0, 0.0, None
        cursor = db.invoices.find(
            {"status": {"$in": ["PENDENTE", None]}, "due_date": {"$lt": today_iso, "$nin": [None, ""]}},
            {"_id": 0, "total_value": 1, "due_date": 1},
        )
        async for inv in cursor:
            count += 1
            total += inv.get("total_value") or 0
            oldest = min(oldest or inv["due_date"], inv["due_date"])
        if count:
            days = (today - datetime.fromisoformat(oldest[:10]).date()).days
            alerts.append({
                "key": "invoices_overdue",
                "title": f"{_plural(count, 'fatura vencida', 'faturas vencidas')} sem recebimento",
                "description": f"Total de {_brl(total)} · a mais antiga venceu há {_plural(days, 'dia', 'dias')}",
                "path": "/reports/receivables",
                "tone": "red",
            })

    return alerts
