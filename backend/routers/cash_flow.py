"""Financeiro - Fluxo de Caixa: saldo dia a dia, realizado e projetado.

Realizado: as mesmas entradas e saídas do Resumo Financeiro
(financial_summary.build_cash_lines), cada uma no dia em que aconteceu.
Previsto: só o que tem vencimento - faturas a receber, Contas a Pagar e
cheques emitidos a compensar - no dia do vencimento; o que já venceu e não foi
baixado entra hoje (atrasado). O que não tem data (fretes, diárias, folha...)
fica num quadro à parte e não entra no saldo projetado.

Saldo: o administrador informa uma vez o saldo em uma data; dali para frente
(e para trás) o saldo de cada dia é esse valor mais as entradas menos as saídas.
"""
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from period_reports import Column, Section, MONEY, excel_response, pdf_response, period_text
from reports import BRT_TZ
from routers.financial_summary import build_cash_lines
from shared import db, get_current_admin_user, get_disabled_modules, is_module_disabled

api_router = APIRouter(prefix="/api")

SETTINGS_ID = "settings"
MAX_DAYS = 400
GROUPS = {"day": "Dia", "week": "Semana", "month": "Mês"}
# Posições a receber/a pagar do Resumo Financeiro que o previsto já cobre (pelo
# vencimento) ou que não são dinheiro a entrar/sair (crédito já recebido)
DATED_KEYS = {"invoices_open", "checks_open", "payables_open", "receivable_titles_open", "client_credit_balance"}
PARTLY_DATED = {"invoices_open": "Faturas em aberto sem vencimento",
                "port_open": "Faturamento Portuário pendente sem vencimento"}
MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]


class CashFlowSettings(BaseModel):
    opening_date: str  # YYYY-MM-DD
    opening_balance: float


def _today() -> date:
    return datetime.now(BRT_TZ).date()


def _parse(value: Optional[str], what: str) -> date:
    try:
        return date.fromisoformat((value or "")[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{what} inválida")


def _r(value: float) -> float:
    return round(value + 0.0, 2)


@api_router.get("/cash-flow/settings")
async def get_cash_flow_settings(current_user: dict = Depends(get_current_admin_user)):
    doc = await db.cash_flow_settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or {}
    return {"opening_date": doc.get("opening_date"), "opening_balance": doc.get("opening_balance"),
            "updated_by_name": doc.get("updated_by_name"), "updated_at": doc.get("updated_at")}


@api_router.put("/cash-flow/settings")
async def update_cash_flow_settings(data: CashFlowSettings, current_user: dict = Depends(get_current_admin_user)):
    opening_date = _parse(data.opening_date, "Data do saldo inicial")
    if opening_date > _today():
        raise HTTPException(status_code=400, detail="A data do saldo inicial não pode ser futura")
    fields = {"id": SETTINGS_ID, "opening_date": opening_date.isoformat(), "opening_balance": _r(data.opening_balance),
              "updated_by_name": current_user.get("name", "Sistema"), "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.cash_flow_settings.update_one({"id": SETTINGS_ID}, {"$set": fields}, upsert=True)
    return await get_cash_flow_settings(current_user)


def _describe(doc: dict) -> str:
    """Um texto curto do lançamento para a lista do dia."""
    number = next((doc.get(k) for k in ("invoice_number", "payable_number", "check_number", "batch_number", "order_number") if doc.get(k)), None)
    who = next((doc.get(k) for k in ("client_name", "supplier_name", "payee", "driver_name", "employee_name", "provider_name", "description") if doc.get(k)), None)
    return " · ".join(str(p) for p in (f"Nº {number}" if number else None, who) if p) or "-"


async def _forecast_events(today: date) -> list:
    """Entradas e saídas com vencimento, ainda não baixadas."""
    disabled = await get_disabled_modules()
    enabled = lambda module: not is_module_disabled(module, disabled)
    events = []

    def add(due, direction, source, description, amount):
        if not due or not amount:
            return
        day = date.fromisoformat(due[:10])
        events.append({"date": max(day, today).isoformat(), "due_date": due[:10], "overdue": day < today,
                       "kind": "PREVISTO", "direction": direction, "source": source, "description": description, "amount": _r(amount)})

    if enabled("financeiro.faturas"):
        async for inv in db.invoices.find({"status": {"$in": ["PENDENTE", None]}, "due_date": {"$nin": [None, ""]}}, {"_id": 0}):
            add(inv["due_date"], "ENTRADA", "Faturas a receber", _describe(inv), (inv.get("total_value") or 0) - (inv.get("credit_applied") or 0))
    if enabled("financeiro.faturamento_portuario"):
        async for b in db.port_service_billing_batches.find({"status": "PENDENTE", "due_date": {"$nin": [None, ""]}}, {"_id": 0, "service_ids": 0}):
            add(b["due_date"], "ENTRADA", "Faturamento Portuário", _describe(b), b.get("net_total", b.get("total_value")))
    if enabled("financeiro.contas_receber"):
        async for t in db.receivable_titles.find({"status": "ABERTO"}, {"_id": 0}):
            label = f"Nº {t['receivable_number']}" + (f" - {t['installment']}/{t['installments_total']}" if (t.get("installments_total") or 1) > 1 else "")
            add(t.get("due_date"), "ENTRADA", "Contas a Receber", " · ".join(x for x in (label, t.get("client_name"), t.get("description")) if x), t.get("amount"))
    if enabled("financeiro.contas_pagar"):
        async for p in db.payables.find({"status": "ABERTO"}, {"_id": 0}):
            label = f"Nº {p['payable_number']}" + (f" - {p['installment']}/{p['installments_total']}" if (p.get("installments_total") or 1) > 1 else "")
            add(p.get("due_date"), "SAIDA", "Contas a Pagar", " · ".join(x for x in (label, p.get("supplier_name"), p.get("description")) if x), p.get("amount"))
    if enabled("financeiro.controle_cheque"):
        async for c in db.checks.find({"status": "EMITIDO"}, {"_id": 0}):
            add(c.get("due_date"), "SAIDA", "Cheques a compensar", " · ".join(x for x in (f"Cheque {c.get('check_number')}", c.get("payee")) if x), c.get("amount"))
    return events


def _undated(lines: dict) -> dict:
    """Posições sem vencimento: aparecem à parte, fora do saldo projetado."""
    receive, pay = [], []
    for line in lines["receivable"]:
        if not line["docs"]:
            continue
        # Faturas e Faturamento Portuário: só as sem vencimento (as com vencimento estão no previsto)
        partly_dated = line["key"] in PARTLY_DATED
        docs = [d for d in line["docs"] if not d.get("due_date")] if partly_dated else line["docs"]
        if line["key"] in DATED_KEYS and not partly_dated:
            continue
        total = _r(sum(line["value_of"](d) or 0 for d in docs))
        if docs and total:
            label = PARTLY_DATED.get(line["key"], line["label"])
            receive.append({"label": label, "count": len(docs), "total": total})
    for line in lines["payable"]:
        if not line["docs"] or line["key"] in DATED_KEYS:
            continue
        total = _r(sum(line["value_of"](d) or 0 for d in line["docs"]))
        if total:
            pay.append({"label": line["label"], "count": len(line["docs"]), "total": total})
    return {"receivable": receive, "payable": pay}


def _bucket_of(day: date, group: str) -> tuple:
    if group == "week":
        start = day - timedelta(days=day.weekday())
        return start, start + timedelta(days=6)
    if group == "month":
        start = day.replace(day=1)
        end = (start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)) - timedelta(days=1)
        return start, end
    return day, day


def _bucket_label(start: date, end: date, group: str) -> str:
    if group == "month":
        return f"{MONTHS[start.month - 1]}/{start.year}"
    if group == "week":
        return f"{start.strftime('%d/%m')} a {end.strftime('%d/%m')}"
    return start.strftime("%d/%m/%Y")


async def build_cash_flow(date_from: Optional[str], date_to: Optional[str], group: str = "day") -> dict:
    if group not in GROUPS:
        raise HTTPException(status_code=400, detail="Agrupamento inválido")
    start, end = _parse(date_from, "Data inicial"), _parse(date_to, "Data final")
    if end < start:
        raise HTTPException(status_code=400, detail="A data final é anterior à inicial")
    if (end - start).days > MAX_DAYS:
        raise HTTPException(status_code=400, detail=f"Período de no máximo {MAX_DAYS} dias")
    today = _today()
    settings = await db.cash_flow_settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or {}
    opening_date = date.fromisoformat(settings["opening_date"]) if settings.get("opening_date") else None
    opening_balance = settings.get("opening_balance")
    has_balance = opening_date is not None and opening_balance is not None

    # Realizado: cada lançamento no dia em que aconteceu (fluxo líquido por dia para o saldo)
    lines = await build_cash_lines()
    net_by_day, day_totals, realized = {}, {}, []
    for direction, group_lines in (("ENTRADA", lines["inflows"]), ("SAIDA", lines["outflows"])):
        for line in group_lines:
            for doc in line["docs"] or []:
                day_text = line["day_of"](doc) if line["day_of"] else None
                value = line["value_of"](doc) or 0
                if not day_text or not value:
                    continue
                day = date.fromisoformat(str(day_text)[:10])
                net_by_day[day] = net_by_day.get(day, 0) + (value if direction == "ENTRADA" else -value)
                if start <= day <= end:
                    t = day_totals.setdefault(day, {"realized_in": 0, "realized_out": 0, "forecast_in": 0, "forecast_out": 0})
                    t["realized_in" if direction == "ENTRADA" else "realized_out"] += value
                    realized.append({"date": day.isoformat(), "kind": "REALIZADO", "direction": direction, "source": line["label"],
                                     "description": _describe(doc), "amount": _r(value), "overdue": False})

    # Previsto: do dia de hoje em diante (o atrasado já está em hoje)
    forecast = [e for e in await _forecast_events(today) if start <= date.fromisoformat(e["date"]) <= end]
    for e in forecast:
        t = day_totals.setdefault(date.fromisoformat(e["date"]), {"realized_in": 0, "realized_out": 0, "forecast_in": 0, "forecast_out": 0})
        t["forecast_in" if e["direction"] == "ENTRADA" else "forecast_out"] += e["amount"]

    # Saldo no começo do período: o saldo informado vale no começo do dia dele
    balance = None
    if has_balance:
        if start >= opening_date:
            balance = opening_balance + sum(v for d, v in net_by_day.items() if opening_date <= d < start)
        else:
            balance = opening_balance - sum(v for d, v in net_by_day.items() if start <= d < opening_date)
    opening_of_period = balance

    buckets, lowest, balance_today = {}, None, None
    for i in range((end - start).days + 1):
        day = start + timedelta(days=i)
        t = day_totals.get(day, {"realized_in": 0, "realized_out": 0, "forecast_in": 0, "forecast_out": 0})
        if balance is not None:
            balance += t["realized_in"] - t["realized_out"]
            if day == today:
                balance_today = balance  # só o realizado de hoje
            balance += t["forecast_in"] - t["forecast_out"]
            if day >= today and (lowest is None or balance < lowest[1]):
                lowest = (day, balance)
        b_start, b_end = _bucket_of(day, group)
        b = buckets.setdefault(b_start, {"start": b_start.isoformat(), "end": min(b_end, end).isoformat(), "label": _bucket_label(b_start, b_end, group),
                                         "realized_in": 0, "realized_out": 0, "forecast_in": 0, "forecast_out": 0})
        for k in ("realized_in", "realized_out", "forecast_in", "forecast_out"):
            b[k] += t[k]
        b["balance_end"] = balance
        b["projected"] = day >= today

    rows = []
    for b in sorted(buckets.values(), key=lambda b: b["start"]):
        for k in ("realized_in", "realized_out", "forecast_in", "forecast_out"):
            b[k] = _r(b[k])
        b["net"] = _r(b["realized_in"] - b["realized_out"] + b["forecast_in"] - b["forecast_out"])
        b["balance_end"] = _r(b["balance_end"]) if b["balance_end"] is not None else None
        rows.append(b)

    total = lambda key: _r(sum(r[key] for r in rows))
    summary = {
        "has_balance": has_balance,
        "opening_balance": _r(opening_of_period) if opening_of_period is not None else None,
        "closing_balance": _r(balance) if balance is not None else None,
        "balance_today": _r(balance_today) if balance_today is not None else None,
        "realized_in": total("realized_in"), "realized_out": total("realized_out"),
        "forecast_in": total("forecast_in"), "forecast_out": total("forecast_out"),
        "overdue_in": _r(sum(e["amount"] for e in forecast if e["overdue"] and e["direction"] == "ENTRADA")),
        "overdue_out": _r(sum(e["amount"] for e in forecast if e["overdue"] and e["direction"] == "SAIDA")),
        "lowest_balance": _r(lowest[1]) if lowest else None,
        "lowest_balance_date": lowest[0].isoformat() if lowest else None,
    }
    events = sorted(realized + forecast, key=lambda e: (e["date"], e["kind"] != "REALIZADO", e["direction"] != "ENTRADA"))
    return {
        "settings": {"opening_date": settings.get("opening_date"), "opening_balance": opening_balance},
        "group": group, "date_from": start.isoformat(), "date_to": end.isoformat(), "today": today.isoformat(),
        "rows": rows, "events": events, "summary": summary, "undated": _undated(lines),
    }


@api_router.get("/cash-flow")
async def get_cash_flow(date_from: str, date_to: str, group: str = "day", current_user: dict = Depends(get_current_admin_user)):
    return await build_cash_flow(date_from, date_to, group)


def _brl(value) -> str:
    return "-" if value is None else f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _sections(data):
    s = data["summary"]
    period = Section(
        f"Por {GROUPS[data['group']].lower()} (previsto a partir de hoje, {date.fromisoformat(data['today']).strftime('%d/%m/%Y')})",
        [Column(GROUPS[data["group"]], width=16), Column("Entradas realizadas", MONEY, 14), Column("Saídas realizadas", MONEY, 14),
         Column("Entradas previstas", MONEY, 14), Column("Saídas previstas", MONEY, 14), Column("Resultado", MONEY, 13), Column("Saldo no fim", MONEY, 14)],
        [[r["label"], r["realized_in"], r["realized_out"], r["forecast_in"], r["forecast_out"], r["net"], r["balance_end"]] for r in data["rows"]],
        total=["TOTAL", s["realized_in"], s["realized_out"], s["forecast_in"], s["forecast_out"],
               _r(s["realized_in"] - s["realized_out"] + s["forecast_in"] - s["forecast_out"]), s["closing_balance"]],
        empty_text="Nenhum dia no período.", sheet_name="Fluxo",
    )
    events = Section(
        "Lançamentos do período",
        [Column("Data", width=10), Column("Tipo", width=9), Column("Origem", width=20), Column("Descrição", width=40),
         Column("Entrada", MONEY, 12), Column("Saída", MONEY, 12)],
        [[date.fromisoformat(e["date"]).strftime("%d/%m/%Y"), ("Atrasado" if e["overdue"] else "Previsto") if e["kind"] == "PREVISTO" else "Realizado",
          e["source"], e["description"], e["amount"] if e["direction"] == "ENTRADA" else None,
          e["amount"] if e["direction"] == "SAIDA" else None] for e in data["events"]],
        empty_text="Nenhum lançamento no período.", sheet_name="Lançamentos",
    )
    undated = data["undated"]
    without_date = Section(
        "Sem vencimento (fora do saldo previsto)",
        [Column("Posição", width=50), Column("Lançamentos", width=12), Column("A receber", MONEY, 16), Column("A pagar", MONEY, 16)],
        [[u["label"], str(u["count"]), u["total"], None] for u in undated["receivable"]]
        + [[u["label"], str(u["count"]), None, u["total"]] for u in undated["payable"]],
        empty_text="Nada sem vencimento.", sheet_name="Sem vencimento",
    )
    return [period, events, without_date]


def _info(data):
    s = data["summary"]
    if not s["has_balance"]:
        first = ("Saldo", "informe o saldo inicial na tela")
    else:
        first = ("Saldo no início", _brl(s["opening_balance"]))
    return [first, ("Saldo no fim (previsto)", _brl(s["closing_balance"])),
            ("Entradas (realizadas + previstas)", _brl(_r(s["realized_in"] + s["forecast_in"]))),
            ("Saídas (realizadas + previstas)", _brl(_r(s["realized_out"] + s["forecast_out"])))]


def _subtitle(data):
    return f"{period_text('Período', data['date_from'], data['date_to'])} · Agrupado por {GROUPS[data['group']].lower()}"


@api_router.get("/cash-flow/pdf")
async def get_cash_flow_pdf(date_from: str, date_to: str, group: str = "day", current_user: dict = Depends(get_current_admin_user)):
    data = await build_cash_flow(date_from, date_to, group)
    return await pdf_response("Fluxo de Caixa", _subtitle(data), _info(data), _sections(data), "fluxo_caixa", current_user.get("name", "Sistema"))


@api_router.get("/cash-flow/excel")
async def get_cash_flow_excel(date_from: str, date_to: str, group: str = "day", current_user: dict = Depends(get_current_admin_user)):
    data = await build_cash_flow(date_from, date_to, group)
    return await excel_response("Fluxo de Caixa", _subtitle(data), _sections(data), "fluxo_caixa")
