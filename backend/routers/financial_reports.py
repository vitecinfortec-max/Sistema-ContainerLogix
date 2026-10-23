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


async def build_expenses(date_from=None, date_to=None, status=None, supplier=None, only_without_receipt=False) -> dict:
    query = {"status": status} if status else {}
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
            row = {"report": number, "report_id": rep["id"], "status": rep_status, "purchase_date": (p.get("purchase_date") or "")[:10] or None,
                   "supplier_name": name, "observation": p.get("observation"), "amount": _r(p.get("amount")),
                   "receipts": len(p.get("receipts") or [])}
            purchases.append(row)
            sup = suppliers.setdefault(name, {"supplier_name": name, "count": 0, "total": 0.0, "without_receipt": 0, "without_receipt_total": 0.0})
            sup["count"] += 1
            sup["total"] += row["amount"]
            if not has_receipt:
                sup["without_receipt"] += 1
                sup["without_receipt_total"] += row["amount"]
        if supplier_re or only_without_receipt:
            continue  # depósito não tem fornecedor nem recibo: não entra nesses filtros
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
    return {
        "purchases": purchases,
        "deposits": deposits,
        "suppliers": sorted(suppliers.values(), key=lambda s: (-s["total"], s["supplier_name"])),
        "summary": {
            "purchases_count": len(purchases), "total_purchases": total_purchases,
            "deposits_count": len(deposits), "total_deposits": total_deposits,
            "balance": _r(total_purchases - total_deposits),
            "without_receipt_count": len(missing), "without_receipt_total": _r(sum(p["amount"] for p in missing)),
        },
    }


def _expense_sections(data):
    s = data["summary"]
    sections = [
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
             Column("Fornecedor", width=28), Column("Observação", width=30), Column("Recibos", INT, 8), Column("Valor", MONEY, 12)],
            [[p["report"], EXPENSE_STATUS_LABELS.get(p["status"], p["status"]), p["purchase_date"], p["supplier_name"],
              p["observation"], p["receipts"], p["amount"]] for p in data["purchases"]],
            total=["TOTAL", None, None, None, None, None, s["total_purchases"]],
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


EXPENSE_STATUS_PATTERN = "^(EM_ANDAMENTO|CONCLUIDA)$"


def _expense_subtitle(date_from, date_to, status, only_without_receipt):
    parts = [period_text("Compras/depósitos", date_from, date_to), EXPENSE_STATUS_LABELS.get(status),
             "Só compras sem recibo" if only_without_receipt else None]
    return " · ".join(p for p in parts if p) or None


@api_router.get("/reports/expenses")
async def get_expenses_report(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    status: Optional[str] = Query(None, pattern=EXPENSE_STATUS_PATTERN),
    supplier: Optional[str] = None, only_without_receipt: bool = False,
    current_user: dict = Depends(get_current_admin_user),
):
    """Compras e depósitos das Prestações de Contas no período, por fornecedor e sem recibo"""
    return await build_expenses(date_from, date_to, status, supplier, only_without_receipt)


@api_router.get("/reports/expenses/pdf")
async def get_expenses_report_pdf(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    status: Optional[str] = Query(None, pattern=EXPENSE_STATUS_PATTERN),
    supplier: Optional[str] = None, only_without_receipt: bool = False,
    current_user: dict = Depends(get_current_admin_user),
):
    from reports import format_currency
    data = await build_expenses(date_from, date_to, status, supplier, only_without_receipt)
    s = data["summary"]
    info = [("Compras", format_currency(s["total_purchases"], "BRL")), ("Depósitos", format_currency(s["total_deposits"], "BRL")),
            ("Saldo (compras - depósitos)", format_currency(s["balance"], "BRL")),
            ("Sem recibo", f"{s['without_receipt_count']} · {format_currency(s['without_receipt_total'], 'BRL')}"),
            ("Lançamentos de compra", str(s["purchases_count"])), ("Depósitos recebidos", str(s["deposits_count"]))]
    return await pdf_response("Relatório de Prestação de Contas", _expense_subtitle(date_from, date_to, status, only_without_receipt),
                              info, _expense_sections(data), "relatorio_prestacao_contas", current_user.get("name", "Sistema"))


@api_router.get("/reports/expenses/excel")
async def get_expenses_report_excel(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    status: Optional[str] = Query(None, pattern=EXPENSE_STATUS_PATTERN),
    supplier: Optional[str] = None, only_without_receipt: bool = False,
    current_user: dict = Depends(get_current_admin_user),
):
    data = await build_expenses(date_from, date_to, status, supplier, only_without_receipt)
    return await excel_response("Relatório de Prestação de Contas", _expense_subtitle(date_from, date_to, status, only_without_receipt) or "Todas as prestações",
                                _expense_sections(data), "relatorio_prestacao_contas")
