from typing import Optional
import re

from fastapi import APIRouter, Depends, Query

from period_reports import Column, Section, MONEY, DAY, INT, pdf_response, excel_response, period_text
from routers.movements import _parse_filter_day
from routers.daily_rate import item_is_paid, item_paid_at
from shared import db, get_current_admin_user

api_router = APIRouter(prefix="/api")

# ==================== FINANCEIRO - RELATÓRIOS DE CONFERÊNCIA ====================
# Solicitação de Diária e Prestação de Contas só tinham o PDF de cada
# lançamento; aqui ficam os relatórios do período para conferir o conjunto.


def _in_period(day: Optional[str], date_from: Optional[str], date_to: Optional[str]) -> bool:
    if not date_from and not date_to:
        return True
    if not day:
        return False
    day = day[:10]
    if date_from and day < _parse_filter_day(date_from, "date_from").isoformat():
        return False
    if date_to and day > _parse_filter_day(date_to, "date_to").isoformat():
        return False
    return True


def _r(value) -> float:
    return round(value or 0, 2)


# ---------------------------------------------------------------- Diárias

DAILY_STATUS_LABELS = {"PENDENTE": "Pendente", "PAGO": "Pago", "CANCELADO": "Cancelado"}
DAILY_PERIOD_LABELS = {"departure": "Saída", "payment": "Pagamento"}


async def build_daily_rates(date_from=None, date_to=None, status=None, driver=None, client=None, period_by="departure") -> dict:
    """Situação item a item (cada motorista é pago à parte). Período pela data
    de saída ou pela do pagamento (aí só entra o que foi pago)."""
    query = {"status": "CANCELADO"} if status == "CANCELADO" else {"status": {"$ne": "CANCELADO"}}
    requests = await db.daily_rate_requests.find(query, {"_id": 0}).sort("request_number", 1).to_list(None)
    driver_re = re.compile(re.escape(driver.strip()), re.I) if driver else None
    client_re = re.compile(re.escape(client.strip()), re.I) if client else None

    items, drivers = [], {}
    totals = {"others": 0.0, "commission": 0.0, "lunch": 0.0, "daily": 0.0, "total": 0.0, "days": 0.0}
    for req in requests:
        for item in req.get("items") or []:
            paid = item_is_paid(req, item)
            row_status = "CANCELADO" if req.get("status") == "CANCELADO" else ("PAGO" if paid else "PENDENTE")
            if status and row_status != status:
                continue
            paid_day = (item_paid_at(req, item) or "")[:10] or None
            period_day = paid_day if period_by == "payment" else item.get("departure_date")
            if period_by == "payment" and not paid_day:
                continue
            if not _in_period(period_day, date_from, date_to):
                continue
            if driver_re and not driver_re.search(item.get("driver_name") or ""):
                continue
            if client_re and not client_re.search(item.get("client_name") or ""):
                continue
            daily = (item.get("daily_rate_quantity") or 0) * (item.get("daily_rate_value") or 0)
            row = {
                "request_number": req["request_number"],
                "status": row_status,
                "paid_at": paid_day,
                "driver_name": item.get("driver_name"),
                "vehicle_plate": item.get("vehicle_plate"),
                "client_name": item.get("client_name"),
                "departure_date": (item.get("departure_date") or "")[:10] or None,
                "others": _r(item.get("others_value")),
                "commission": _r(item.get("commission_value")),
                "lunch": _r(item.get("lunch_value")),
                "days": item.get("daily_rate_quantity") or 0,
                "daily": _r(daily),
                "total": _r(item.get("total")),
            }
            items.append(row)
            d = drivers.setdefault(row["driver_name"], {"driver_name": row["driver_name"], "trips": 0, "days": 0.0,
                                                        "daily": 0.0, "commission": 0.0, "lunch": 0.0, "others": 0.0,
                                                        "total": 0.0, "paid": 0.0, "pending": 0.0})
            d["trips"] += 1
            for key in ("days", "daily", "commission", "lunch", "others", "total"):
                d[key] += row[key]
                totals[key] += row[key]
            if row["status"] == "PENDENTE":
                d["pending"] += row["total"]
            elif row["status"] == "PAGO":
                d["paid"] += row["total"]
    items.sort(key=lambda r: (r["departure_date"] or "", r["request_number"]))
    for d in drivers.values():
        for key in ("daily", "commission", "lunch", "others", "total", "paid", "pending"):
            d[key] = _r(d[key])
    pending = _r(sum(r["total"] for r in items if r["status"] == "PENDENTE"))
    return {
        "items": items,
        "drivers": sorted(drivers.values(), key=lambda d: (-d["total"], d["driver_name"] or "")),
        "summary": {**{k: _r(v) for k, v in totals.items()}, "count": len(items), "pending": pending,
                    "paid": _r(sum(r["total"] for r in items if r["status"] == "PAGO"))},
    }


def _daily_sections(data):
    s = data["summary"]
    by_driver = Section(
        "Por motorista",
        [Column("Motorista", width=30), Column("Viagens", INT, 8), Column("Qtd. diárias", INT, 9),
         Column("Diárias", MONEY, 12), Column("Comissão", MONEY, 12), Column("Almoço", MONEY, 11),
         Column("Outros", MONEY, 11), Column("Total", MONEY, 13), Column("Pago", MONEY, 13), Column("A pagar", MONEY, 13)],
        [[d["driver_name"], d["trips"], d["days"], d["daily"], d["commission"], d["lunch"], d["others"], d["total"], d["paid"], d["pending"]]
         for d in data["drivers"]],
        total=["TOTAL", s["count"], s["days"], s["daily"], s["commission"], s["lunch"], s["others"], s["total"], s["paid"], s["pending"]],
        empty_text="Nenhuma diária no período.", sheet_name="Por motorista",
    )
    detail = Section(
        "Itens",
        [Column("Nº", INT, 6), Column("Saída", DAY, 9), Column("Motorista", width=22), Column("Placa", width=9, align="center"),
         Column("Cliente", width=20), Column("Status", width=9, align="center"), Column("Pago em", DAY, 9), Column("Qtd.", INT, 6),
         Column("Diárias", MONEY, 11), Column("Comissão", MONEY, 11), Column("Almoço", MONEY, 10),
         Column("Outros", MONEY, 10), Column("Total", MONEY, 12)],
        [[r["request_number"], r["departure_date"], r["driver_name"], r["vehicle_plate"], r["client_name"],
          DAILY_STATUS_LABELS.get(r["status"], r["status"]), r["paid_at"], r["days"], r["daily"], r["commission"], r["lunch"], r["others"], r["total"]]
         for r in data["items"]],
        total=["TOTAL", None, None, None, None, None, None, s["days"], s["daily"], s["commission"], s["lunch"], s["others"], s["total"]],
        empty_text="Nenhuma diária no período.", sheet_name="Itens",
    )
    return [by_driver, detail]


DAILY_STATUS_PATTERN = "^(PENDENTE|PAGO|CANCELADO)$"
DAILY_PERIOD_PATTERN = "^(departure|payment)$"


def _daily_subtitle(date_from, date_to, status, period_by="departure"):
    parts = [period_text(DAILY_PERIOD_LABELS[period_by], date_from, date_to), DAILY_STATUS_LABELS.get(status, "Pendentes e pagas") if status else "Pendentes e pagas"]
    return " · ".join(p for p in parts if p)


@api_router.get("/reports/daily-rates")
async def get_daily_rates_report(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    status: Optional[str] = Query(None, pattern=DAILY_STATUS_PATTERN),
    driver: Optional[str] = None, client: Optional[str] = None,
    period_by: str = Query("departure", pattern=DAILY_PERIOD_PATTERN),
    current_user: dict = Depends(get_current_admin_user),
):
    """Diárias do período (pela data de saída ou do pagamento), por motorista e item a item"""
    return await build_daily_rates(date_from, date_to, status, driver, client, period_by)


@api_router.get("/reports/daily-rates/pdf")
async def get_daily_rates_report_pdf(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    status: Optional[str] = Query(None, pattern=DAILY_STATUS_PATTERN),
    driver: Optional[str] = None, client: Optional[str] = None,
    period_by: str = Query("departure", pattern=DAILY_PERIOD_PATTERN),
    current_user: dict = Depends(get_current_admin_user),
):
    data = await build_daily_rates(date_from, date_to, status, driver, client, period_by)
    s = data["summary"]
    from reports import format_currency
    info = [("Viagens", str(s["count"])), ("Total", format_currency(s["total"], "BRL")),
            ("Pago", format_currency(s["paid"], "BRL")), ("A pagar", format_currency(s["pending"], "BRL")),
            ("Motoristas", str(len(data["drivers"]))), ("Qtd. diárias", f"{s['days']:g}")]
    return await pdf_response("Relatório de Diárias", _daily_subtitle(date_from, date_to, status, period_by), info,
                              _daily_sections(data), "relatorio_diarias", current_user.get("name", "Sistema"))


@api_router.get("/reports/daily-rates/excel")
async def get_daily_rates_report_excel(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    status: Optional[str] = Query(None, pattern=DAILY_STATUS_PATTERN),
    driver: Optional[str] = None, client: Optional[str] = None,
    period_by: str = Query("departure", pattern=DAILY_PERIOD_PATTERN),
    current_user: dict = Depends(get_current_admin_user),
):
    data = await build_daily_rates(date_from, date_to, status, driver, client, period_by)
    return await excel_response("Relatório de Diárias", _daily_subtitle(date_from, date_to, status, period_by), _daily_sections(data), "relatorio_diarias")


# ---------------------------------------------------------- Prestação de Contas

EXPENSE_STATUS_LABELS = {"EM_ANDAMENTO": "Em andamento", "CONCLUIDA": "Concluída"}


NO_GROUP = "(sem grupo)"


async def build_expenses(date_from=None, date_to=None, status=None, supplier=None, only_without_receipt=False, group=None) -> dict:
    """`group`: id do grupo de custo, "SEM_GRUPO" (compras sem grupo) ou vazio/"TODOS"."""
    query = {"status": status} if status else {}
    group = None if group in (None, "", "TODOS") else group
    reports = await db.expense_reports.find(query, {"_id": 0}).sort("report_number_formatted", 1).to_list(None)
    supplier_re = re.compile(re.escape(supplier.strip()), re.I) if supplier else None

    purchases, deposits, suppliers = [], [], {}
    for rep in reports:
        number = rep.get("report_number_formatted") or str(rep.get("report_number"))
        rep_status = rep.get("status") or "EM_ANDAMENTO"
        for p in rep.get("purchases") or []:
            if not _in_period(p.get("purchase_date"), date_from, date_to):
                continue
            name = p.get("supplier_name") or "(sem fornecedor)"
            if supplier_re and not supplier_re.search(name):
                continue
            has_receipt = bool(p.get("receipts"))
            if only_without_receipt and has_receipt:
                continue
            if group and (p.get("group_id") or "SEM_GRUPO") != group:
                continue
            row = {"report": number, "report_id": rep["id"], "status": rep_status, "purchase_date": (p.get("purchase_date") or "")[:10] or None,
                   "supplier_name": name, "observation": p.get("observation"), "amount": _r(p.get("amount")),
                   "receipts": len(p.get("receipts") or []), "group_name": p.get("group_name") or NO_GROUP}
            purchases.append(row)
            sup = suppliers.setdefault(name, {"supplier_name": name, "count": 0, "total": 0.0, "without_receipt": 0, "without_receipt_total": 0.0})
            sup["count"] += 1
            sup["total"] += row["amount"]
            if not has_receipt:
                sup["without_receipt"] += 1
                sup["without_receipt_total"] += row["amount"]
        if supplier_re or only_without_receipt or group:
            continue  # depósito não tem fornecedor, recibo nem grupo: não entra nesses filtros
        for d in rep.get("deposits") or []:
            if _in_period(d.get("date"), date_from, date_to):
                deposits.append({"report": number, "date": (d.get("date") or "")[:10] or None, "sent_by": d.get("sent_by"), "amount": _r(d.get("amount"))})
    purchases.sort(key=lambda r: (r["purchase_date"] or "", r["report"]))
    deposits.sort(key=lambda r: (r["date"] or "", r["report"]))
    for sup in suppliers.values():
        sup["total"] = _r(sup["total"])
        sup["without_receipt_total"] = _r(sup["without_receipt_total"])
    total_purchases = _r(sum(p["amount"] for p in purchases))
    total_deposits = _r(sum(d["amount"] for d in deposits))
    missing = [p for p in purchases if not p["receipts"]]
    groups = {}
    for p in purchases:
        g = groups.setdefault(p["group_name"], {"group_name": p["group_name"], "count": 0, "total": 0.0, "largest": 0.0})
        g["count"] += 1
        g["total"] += p["amount"]
        g["largest"] = max(g["largest"], p["amount"])
    for g in groups.values():
        g["total"] = _r(g["total"])
        g["average"] = _r(g["total"] / g["count"])
        g["share"] = round(g["total"] / total_purchases * 100, 1) if total_purchases else 0
    return {
        "purchases": purchases,
        "deposits": deposits,
        "groups": sorted(groups.values(), key=lambda g: (-g["total"], g["group_name"])),
        "top_purchases": sorted(purchases, key=lambda p: -p["amount"])[:20],
        "suppliers": sorted(suppliers.values(), key=lambda s: (-s["total"], s["supplier_name"])),
        "summary": {
            "purchases_count": len(purchases), "total_purchases": total_purchases,
            "deposits_count": len(deposits), "total_deposits": total_deposits,
            "balance": _r(total_purchases - total_deposits),
            "without_receipt_count": len(missing), "without_receipt_total": _r(sum(p["amount"] for p in missing)),
            "without_group_total": groups.get(NO_GROUP, {}).get("total", 0.0),
            "groups_count": len([g for g in groups if g != NO_GROUP]),
        },
    }


def _expense_sections(data):
    s = data["summary"]
    sections = [
        Section(
            "Custo por grupo",
            [Column("Grupo", width=34), Column("Compras", INT, 10), Column("Total", MONEY, 14), Column("% do total", width=10, align="center"),
             Column("Média por compra", MONEY, 14), Column("Maior compra", MONEY, 14)],
            [[g["group_name"], g["count"], g["total"], f"{g['share']:.1f}%".replace(".", ","), g["average"], g["largest"]] for g in data["groups"]],
            total=["TOTAL", s["purchases_count"], s["total_purchases"], "100%" if s["purchases_count"] else None, None, None],
            empty_text="Nenhuma compra no período.", sheet_name="Por grupo",
        ),
        Section(
            "Maiores compras",
            [Column("Prestação", width=10, align="center"), Column("Data", DAY, 9), Column("Grupo", width=20), Column("Fornecedor", width=26),
             Column("Observação", width=28), Column("Valor", MONEY, 12)],
            [[p["report"], p["purchase_date"], p["group_name"], p["supplier_name"], p["observation"], p["amount"]] for p in data["top_purchases"]],
            empty_text="Nenhuma compra no período.", sheet_name="Maiores compras",
        ),
        Section(
            "Compras sem recibo anexado",
            [Column("Prestação", width=10, align="center"), Column("Data", DAY, 9), Column("Fornecedor", width=30),
             Column("Observação", width=36), Column("Valor", MONEY, 12)],
            [[p["report"], p["purchase_date"], p["supplier_name"], p["observation"], p["amount"]] for p in data["purchases"] if not p["receipts"]],
            total=["TOTAL", None, None, None, s["without_receipt_total"]] if s["without_receipt_count"] else None,
            empty_text="Todas as compras do período têm recibo anexado.", sheet_name="Sem recibo",
        ),
        Section(
            "Por fornecedor",
            [Column("Fornecedor", width=40), Column("Compras", INT, 10), Column("Total", MONEY, 14),
             Column("Sem recibo", INT, 10), Column("Valor sem recibo", MONEY, 14)],
            [[x["supplier_name"], x["count"], x["total"], x["without_receipt"], x["without_receipt_total"]] for x in data["suppliers"]],
            total=["TOTAL", s["purchases_count"], s["total_purchases"], s["without_receipt_count"], s["without_receipt_total"]],
            empty_text="Nenhuma compra no período.", sheet_name="Por fornecedor",
        ),
        Section(
            "Compras",
            [Column("Prestação", width=10, align="center"), Column("Situação", width=11, align="center"), Column("Data", DAY, 9),
             Column("Grupo", width=18), Column("Fornecedor", width=24), Column("Observação", width=26), Column("Recibos", INT, 8),
             Column("Valor", MONEY, 12)],
            [[p["report"], EXPENSE_STATUS_LABELS.get(p["status"], p["status"]), p["purchase_date"], p["group_name"], p["supplier_name"],
              p["observation"], p["receipts"], p["amount"]] for p in data["purchases"]],
            total=["TOTAL", None, None, None, None, None, None, s["total_purchases"]],
            empty_text="Nenhuma compra no período.", sheet_name="Compras",
        ),
    ]
    if data["deposits"] or not data["purchases"]:
        sections.append(Section(
            "Depósitos recebidos",
            [Column("Prestação", width=10, align="center"), Column("Data", DAY, 9), Column("Enviado por", width=40), Column("Valor", MONEY, 12)],
            [[d["report"], d["date"], d["sent_by"], d["amount"]] for d in data["deposits"]],
            total=["TOTAL", None, None, s["total_deposits"]],
            empty_text="Nenhum depósito no período.", sheet_name="Depósitos",
        ))
    return sections


def _expense_dashboard(data, width):
    """Dashboard do PDF: barras de custo por grupo e, com mais de um mês, a evolução mensal."""
    from reports import _pdf_section_title, pdf_group_cost_bars, pdf_month_cost_columns
    if not data["groups"]:
        return []
    out = list(_pdf_section_title("Dashboard - custo por grupo", width))
    out.append(pdf_group_cost_bars(data["groups"], width))
    months = {}
    for p in data["purchases"]:
        if p["purchase_date"]:
            months[p["purchase_date"][:7]] = months.get(p["purchase_date"][:7], 0) + p["amount"]
    if len(months) > 1:
        out.extend(_pdf_section_title("Dashboard - total gasto por mês", width))
        out.append(pdf_month_cost_columns([{"month": k, "total": round(v, 2)} for k, v in sorted(months.items())], width))
    return out


EXPENSE_STATUS_PATTERN = "^(EM_ANDAMENTO|CONCLUIDA)$"


# ------------------------------------------- Prestação de Contas: ressarcimentos
# Saldo de cada prestação (compras - depósitos): positivo = ressarcir ao
# funcionário, negativo = ele devolve. Pendente até alguém marcar o acerto.

SETTLEMENT_LABELS = {"PENDENTE": "Pendente", "ACERTADO": "Acertado"}
SETTLEMENT_PERIOD_LABELS = {"report": "Período da prestação", "settlement": "Acerto"}


def _overlaps(start: Optional[str], end: Optional[str], date_from: Optional[str], date_to: Optional[str]) -> bool:
    """Período da prestação cruza o filtro"""
    start, end = (start or "")[:10], (end or start or "")[:10]
    if date_from and end and end < _parse_filter_day(date_from, "date_from").isoformat():
        return False
    if date_to and start and start > _parse_filter_day(date_to, "date_to").isoformat():
        return False
    return True


async def build_expense_settlements(date_from=None, date_to=None, situation=None, period_by="report") -> dict:
    reports = await db.expense_reports.find({}, {"_id": 0, "purchases": 0, "deposits": 0}).sort("report_number_formatted", 1).to_list(None)
    rows = []
    for rep in reports:
        balance = _r(rep.get("balance"))
        if abs(balance) < 0.005:
            continue  # quitada: nada a acertar
        settled_at = (rep.get("settled_at") or "")[:10] or None
        row_situation = "ACERTADO" if settled_at else "PENDENTE"
        if situation and row_situation != situation:
            continue
        if period_by == "settlement":
            if not settled_at or not _in_period(settled_at, date_from, date_to):
                continue
        elif not _overlaps(rep.get("period_start"), rep.get("period_end"), date_from, date_to):
            continue
        rows.append({
            "report": rep.get("report_number_formatted") or str(rep.get("report_number")), "report_id": rep["id"],
            "status": rep.get("status") or "EM_ANDAMENTO", "situation": row_situation,
            "period_start": (rep.get("period_start") or "")[:10] or None, "period_end": (rep.get("period_end") or "")[:10] or None,
            "responsible": rep.get("created_by_name"),
            "total_purchases": _r(rep.get("total_purchases")), "total_deposits": _r(rep.get("total_deposits")),
            "to_reimburse": balance if balance > 0 else 0.0, "to_return": -balance if balance < 0 else 0.0,
            "settled_at": settled_at, "settled_by_name": rep.get("settled_by_name") if settled_at else None,
        })
    sums = lambda sit, key: _r(sum(r[key] for r in rows if r["situation"] == sit))
    pending = [r for r in rows if r["situation"] == "PENDENTE"]
    return {
        "items": rows,
        "summary": {
            "count": len(rows), "pending_count": len(pending), "settled_count": len(rows) - len(pending),
            "pending_reimburse": sums("PENDENTE", "to_reimburse"), "pending_return": sums("PENDENTE", "to_return"),
            "settled_reimburse": sums("ACERTADO", "to_reimburse"), "settled_return": sums("ACERTADO", "to_return"),
        },
    }


def _settlement_sections(data, situation):
    s = data["summary"]
    base = [Column("Prestação", width=10, align="center"), Column("Início", DAY, 9), Column("Fim", DAY, 9),
            Column("Responsável", width=22), Column("Situação", width=11, align="center"),
            Column("Compras", MONEY, 12), Column("Depósitos", MONEY, 12),
            Column("A ressarcir", MONEY, 12), Column("A devolver", MONEY, 12)]
    row = lambda r: [r["report"], r["period_start"], r["period_end"], r["responsible"],
                     EXPENSE_STATUS_LABELS.get(r["status"], r["status"]), r["total_purchases"], r["total_deposits"],
                     r["to_reimburse"], r["to_return"]]
    sections = []
    if situation != "ACERTADO":
        sections.append(Section(
            "Pendentes de acerto", base,
            [row(r) for r in data["items"] if r["situation"] == "PENDENTE"],
            total=["TOTAL", None, None, None, None, None, None, s["pending_reimburse"], s["pending_return"]] if s["pending_count"] else None,
            empty_text="Nenhum saldo pendente no período.", sheet_name="Pendentes",
        ))
    if situation != "PENDENTE":
        sections.append(Section(
            "Acertadas", base + [Column("Acertado em", DAY, 10), Column("Por", width=18)],
            [row(r) + [r["settled_at"], r["settled_by_name"]] for r in data["items"] if r["situation"] == "ACERTADO"],
            total=["TOTAL", None, None, None, None, None, None, s["settled_reimburse"], s["settled_return"], None, None] if s["settled_count"] else None,
            empty_text="Nenhum saldo acertado no período.", sheet_name="Acertadas",
        ))
    return sections


SETTLEMENT_PATTERN = "^(PENDENTE|ACERTADO)$"
SETTLEMENT_PERIOD_PATTERN = "^(report|settlement)$"


def _settlement_subtitle(date_from, date_to, situation, period_by):
    parts = [period_text(SETTLEMENT_PERIOD_LABELS[period_by], date_from, date_to),
             {"PENDENTE": "Só pendentes", "ACERTADO": "Só acertadas"}.get(situation, "Pendentes e acertadas")]
    return " · ".join(p for p in parts if p)


@api_router.get("/reports/expenses/settlements")
async def get_expense_settlements_report(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    situation: Optional[str] = Query(None, pattern=SETTLEMENT_PATTERN),
    period_by: str = Query("report", pattern=SETTLEMENT_PERIOD_PATTERN),
    current_user: dict = Depends(get_current_admin_user),
):
    """Saldos das prestações de contas: o que falta ressarcir/devolver e o que já foi acertado"""
    return await build_expense_settlements(date_from, date_to, situation, period_by)


@api_router.get("/reports/expenses/settlements/pdf")
async def get_expense_settlements_report_pdf(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    situation: Optional[str] = Query(None, pattern=SETTLEMENT_PATTERN),
    period_by: str = Query("report", pattern=SETTLEMENT_PERIOD_PATTERN),
    current_user: dict = Depends(get_current_admin_user),
):
    from reports import format_currency
    data = await build_expense_settlements(date_from, date_to, situation, period_by)
    s = data["summary"]
    info = [("A ressarcir (pendente)", format_currency(s["pending_reimburse"], "BRL")),
            ("A devolver (pendente)", format_currency(s["pending_return"], "BRL")),
            ("Ressarcido", format_currency(s["settled_reimburse"], "BRL")),
            ("Devolvido", format_currency(s["settled_return"], "BRL")),
            ("Prestações pendentes", str(s["pending_count"])), ("Prestações acertadas", str(s["settled_count"]))]
    return await pdf_response("Ressarcimentos da Prestação de Contas", _settlement_subtitle(date_from, date_to, situation, period_by),
                              info, _settlement_sections(data, situation), "relatorio_ressarcimentos", current_user.get("name", "Sistema"))


@api_router.get("/reports/expenses/settlements/excel")
async def get_expense_settlements_report_excel(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    situation: Optional[str] = Query(None, pattern=SETTLEMENT_PATTERN),
    period_by: str = Query("report", pattern=SETTLEMENT_PERIOD_PATTERN),
    current_user: dict = Depends(get_current_admin_user),
):
    data = await build_expense_settlements(date_from, date_to, situation, period_by)
    return await excel_response("Ressarcimentos da Prestação de Contas", _settlement_subtitle(date_from, date_to, situation, period_by),
                                _settlement_sections(data, situation), "relatorio_ressarcimentos")


def _expense_subtitle(date_from, date_to, status, only_without_receipt):
    parts = [period_text("Compras/depósitos", date_from, date_to), EXPENSE_STATUS_LABELS.get(status),
             "Só compras sem recibo" if only_without_receipt else None]
    return " · ".join(p for p in parts if p) or None


@api_router.get("/reports/expenses")
async def get_expenses_report(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    status: Optional[str] = Query(None, pattern=EXPENSE_STATUS_PATTERN),
    supplier: Optional[str] = None, only_without_receipt: bool = False, group: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user),
):
    """Compras e depósitos das Prestações de Contas no período, por fornecedor e sem recibo"""
    return await build_expenses(date_from, date_to, status, supplier, only_without_receipt, group)


@api_router.get("/reports/expenses/pdf")
async def get_expenses_report_pdf(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    status: Optional[str] = Query(None, pattern=EXPENSE_STATUS_PATTERN),
    supplier: Optional[str] = None, only_without_receipt: bool = False, group: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user),
):
    from reports import format_currency
    data = await build_expenses(date_from, date_to, status, supplier, only_without_receipt, group)
    s = data["summary"]
    info = [("Compras", format_currency(s["total_purchases"], "BRL")), ("Depósitos", format_currency(s["total_deposits"], "BRL")),
            ("Saldo (compras - depósitos)", format_currency(s["balance"], "BRL")),
            ("Sem recibo", f"{s['without_receipt_count']} · {format_currency(s['without_receipt_total'], 'BRL')}"),
            ("Lançamentos de compra", str(s["purchases_count"])), ("Depósitos recebidos", str(s["deposits_count"]))]
    subtitle = _expense_subtitle(date_from, date_to, status, only_without_receipt)
    if group and group != "TODOS":
        label = data["groups"][0]["group_name"] if data["groups"] else ("sem grupo" if group == "SEM_GRUPO" else "grupo")
        subtitle = f"{subtitle} · Grupo: {label}" if subtitle else f"Grupo: {label}"
    return await pdf_response("Relatório de Prestação de Contas", subtitle,
                              info, _expense_sections(data), "relatorio_prestacao_contas", current_user.get("name", "Sistema"),
                              dashboard=lambda width: _expense_dashboard(data, width))


@api_router.get("/reports/expenses/excel")
async def get_expenses_report_excel(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    status: Optional[str] = Query(None, pattern=EXPENSE_STATUS_PATTERN),
    supplier: Optional[str] = None, only_without_receipt: bool = False, group: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user),
):
    data = await build_expenses(date_from, date_to, status, supplier, only_without_receipt, group)
    return await excel_response("Relatório de Prestação de Contas", _expense_subtitle(date_from, date_to, status, only_without_receipt) or "Todas as prestações",
                                _expense_sections(data), "relatorio_prestacao_contas")
