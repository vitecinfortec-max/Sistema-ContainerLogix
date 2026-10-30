from typing import Optional
import re

from fastapi import APIRouter, Depends

from list_filters import combine, period_query
from period_reports import Column, Section, MONEY, DAY, INT, pdf_response, excel_response, period_text
from reports import format_currency, short_person_name
from routers.container_reports import _day
from routers.financial_reports import _in_period, _r
from shared import db, get_current_admin_user

api_router = APIRouter(prefix="/api")

# ==================== PAGAMENTO FRETE - CONFERÊNCIA COM AS ORDENS ====================
# O lançamento de frete nasce sozinho quando a Ordem de Carregamento de Coleta
# numa Rota é Aprovada (ver freight_payments.py). Este relatório confere os
# dois lados: ordem aprovada sem frete, coleta aprovada sem rota (o frete não
# é gerado), valor do lançamento diferente do da ordem e frete ativo cuja
# ordem não está mais Aprovada.

FREIGHT_STATUS_LABELS = {"PENDENTE": "Pendente", "PAGO": "Pago", "CANCELADO": "Cancelado"}
ORDER_STATUS_LABELS = {"PENDENTE": "Pendente", "APROVADA": "Aprovada", "CANCELADA": "Cancelada"}

ISSUE_NO_PAYMENT = "Ordem aprovada sem lançamento de frete"
ISSUE_NO_ROUTE = "Coleta aprovada sem rota: frete não gerado"
ISSUE_VALUE = "Valor do frete diferente do da ordem"
ISSUE_ORDER_NOT_APPROVED = "Frete ativo com a ordem fora de Aprovada"
ISSUE_ORDER_MISSING = "Frete ativo com a ordem excluída"


async def build_freight_reconciliation(date_from=None, date_to=None, transport_company=None) -> dict:
    company_re = re.compile(re.escape(transport_company.strip()), re.I) if transport_company else None
    # O período já filtra no banco (o sino roda esta conferência a cada poucos
    # minutos); _in_period abaixo continua valendo para o dia em Brasília
    period = period_query("created_at", date_from, date_to)
    orders = await db.loading_orders.find(combine({"order_type": "COLETA"}, period), {"_id": 0, "items": 0}).sort("order_number", 1).to_list(None)
    payments = await db.freight_payments.find(period, {"_id": 0}).to_list(None)
    # Frete de uma ordem do período pode ter sido lançado depois do período
    order_ids = {o["id"] for o in orders}
    missing = [o["id"] for o in orders if o["id"] not in {p.get("loading_order_id") for p in payments}]
    if missing:
        payments += await db.freight_payments.find({"loading_order_id": {"$in": missing}}, {"_id": 0}).to_list(None)
    payment_by_order = {p["loading_order_id"]: p for p in payments if p.get("loading_order_id")}
    # Frete do período cuja ordem é de outro período não é "ordem excluída"
    other_ids = [p["loading_order_id"] for p in payments if p.get("loading_order_id") and p["loading_order_id"] not in order_ids]
    if other_ids:
        order_ids |= {o["id"] for o in await db.loading_orders.find({"id": {"$in": other_ids}}, {"_id": 0, "id": 1}).to_list(None)}

    rows, issues, companies = [], [], {}

    def add_issue(kind, order, payment):
        issues.append({
            "issue": kind,
            "order_number": (order or {}).get("order_number") or (payment or {}).get("order_number"),
            "order_status": (order or {}).get("status"),
            "payment_number": (payment or {}).get("payment_number"),
            "payment_status": (payment or {}).get("status"),
            "driver_name": (order or payment or {}).get("driver_name"),
            "order_value": _r((order or {}).get("freight_value")) if order else None,
            "payment_value": _r((payment or {}).get("freight_value")) if payment else None,
        })

    for order in orders:
        day = _day(order.get("created_at"))
        if not _in_period(day, date_from, date_to):
            continue
        company = order.get("transport_company") or "(sem transportadora)"
        if company_re and not company_re.search(company):
            continue
        payment = payment_by_order.get(order["id"])
        active = payment if payment and payment.get("status") in ("PENDENTE", "PAGO") else None
        approved = order.get("status") == "APROVADA"
        situation = []
        if approved and not order.get("route_id"):
            situation.append(ISSUE_NO_ROUTE)
        elif approved and not active:
            situation.append(ISSUE_NO_PAYMENT)
        if active and approved and _r(active.get("freight_value")) != _r(order.get("freight_value")):
            situation.append(ISSUE_VALUE)
        if active and not approved:
            situation.append(ISSUE_ORDER_NOT_APPROVED)
        for kind in situation:
            add_issue(kind, order, active or payment)
        if not approved and not active:
            continue  # ordem pendente/cancelada sem frete: nada a conferir

        rows.append({
            "order_number": order["order_number"],
            "order_day": day,
            "order_status": order.get("status"),
            "driver_name": order.get("driver_name"),
            "transport_company": company,
            "route_name": order.get("route_name"),
            "order_value": _r(order.get("freight_value")),
            "payment_number": (payment or {}).get("payment_number"),
            "payment_status": (payment or {}).get("status"),
            "payment_value": _r(payment.get("freight_value")) if payment else None,
            "paid_day": _day(payment.get("paid_at")) if payment else None,
            "situation": "; ".join(situation) or "OK",
        })
        c = companies.setdefault(company, {"transport_company": company, "count": 0, "total": 0.0, "paid": 0.0, "pending": 0.0, "issues": 0})
        c["count"] += 1
        c["issues"] += len(situation)
        if active:
            value = active.get("freight_value") or 0
            c["total"] += value
            c["paid" if active["status"] == "PAGO" else "pending"] += value

    # Lançamento ativo cuja ordem foi apagada: só aparece pelo lado do frete
    for payment in payments:
        if payment.get("status") not in ("PENDENTE", "PAGO") or payment.get("loading_order_id") in order_ids:
            continue
        if not _in_period(_day(payment.get("created_at")), date_from, date_to):
            continue
        if company_re and not company_re.search(payment.get("transport_company") or "(sem transportadora)"):
            continue
        add_issue(ISSUE_ORDER_MISSING, None, payment)

    for c in companies.values():
        for key in ("total", "paid", "pending"):
            c[key] = _r(c[key])
    return {
        "rows": rows,
        "issues": issues,
        "companies": sorted(companies.values(), key=lambda c: (-c["total"], c["transport_company"])),
        "summary": {
            "orders": len(rows),
            "total": _r(sum(c["total"] for c in companies.values())),
            "paid": _r(sum(c["paid"] for c in companies.values())),
            "pending": _r(sum(c["pending"] for c in companies.values())),
            "issues": len(issues),
        },
    }


def _sections(data):
    s = data["summary"]
    issues = Section(
        "Divergências",
        [Column("Divergência", width=36), Column("Ordem", INT, 8), Column("Status ordem", width=11, align="center"),
         Column("Frete nº", INT, 8), Column("Status frete", width=11, align="center"), Column("Motorista", width=24),
         Column("Valor ordem", MONEY, 12), Column("Valor frete", MONEY, 12)],
        [[i["issue"], i["order_number"], ORDER_STATUS_LABELS.get(i["order_status"], i["order_status"] or "Excluída"),
          i["payment_number"], FREIGHT_STATUS_LABELS.get(i["payment_status"], i["payment_status"] or "-"),
          short_person_name(i["driver_name"]), i["order_value"], i["payment_value"]] for i in data["issues"]],
        empty_text="Nenhuma divergência: todas as ordens aprovadas têm o frete lançado com o mesmo valor.",
        sheet_name="Divergências",
    )
    by_company = Section(
        "Por transportadora",
        [Column("Transportadora", width=36), Column("Ordens", INT, 8), Column("Frete", MONEY, 14),
         Column("Pago", MONEY, 14), Column("A pagar", MONEY, 14), Column("Divergências", INT, 10)],
        [[c["transport_company"], c["count"], c["total"], c["paid"], c["pending"], c["issues"]] for c in data["companies"]],
        total=["TOTAL", s["orders"], s["total"], s["paid"], s["pending"], s["issues"]],
        empty_text="Nenhuma ordem de coleta aprovada no período.", sheet_name="Por transportadora",
    )
    detail = Section(
        "Ordens de coleta",
        [Column("Ordem", INT, 7), Column("Data", DAY, 9), Column("Motorista", width=20), Column("Transportadora", width=20),
         Column("Rota", width=20), Column("Valor ordem", MONEY, 11), Column("Frete nº", INT, 7),
         Column("Status frete", width=9, align="center"), Column("Valor frete", MONEY, 11), Column("Pago em", DAY, 9),
         Column("Situação", width=24)],
        [[r["order_number"], r["order_day"], short_person_name(r["driver_name"]), r["transport_company"], r["route_name"], r["order_value"],
          r["payment_number"], FREIGHT_STATUS_LABELS.get(r["payment_status"], "-"), r["payment_value"], r["paid_day"], r["situation"]]
         for r in data["rows"]],
        empty_text="Nenhuma ordem de coleta aprovada no período.", sheet_name="Ordens",
    )
    return [issues, by_company, detail]


def _subtitle(date_from, date_to, transport_company):
    parts = [period_text("Ordens", date_from, date_to), f"Transportadora: {transport_company}" if transport_company else None]
    return " · ".join(p for p in parts if p) or None


@api_router.get("/reports/freight-reconciliation")
async def get_freight_reconciliation(
    date_from: Optional[str] = None, date_to: Optional[str] = None, transport_company: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user),
):
    """Ordens de Carregamento de Coleta x Pagamento Frete: totais e divergências"""
    return await build_freight_reconciliation(date_from, date_to, transport_company)


@api_router.get("/reports/freight-reconciliation/pdf")
async def get_freight_reconciliation_pdf(
    date_from: Optional[str] = None, date_to: Optional[str] = None, transport_company: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user),
):
    data = await build_freight_reconciliation(date_from, date_to, transport_company)
    s = data["summary"]
    money = lambda v: format_currency(v, "BRL")
    info = [("Ordens", str(s["orders"])), ("Frete", money(s["total"])), ("Pago", money(s["paid"])),
            ("A pagar", money(s["pending"])), ("Divergências", str(s["issues"]))]
    return await pdf_response("Conferência de Ordens x Pagamento Frete", _subtitle(date_from, date_to, transport_company), info,
                              _sections(data), "conferencia_frete", current_user.get("name", "Sistema"))


@api_router.get("/reports/freight-reconciliation/excel")
async def get_freight_reconciliation_excel(
    date_from: Optional[str] = None, date_to: Optional[str] = None, transport_company: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user),
):
    data = await build_freight_reconciliation(date_from, date_to, transport_company)
    return await excel_response("Conferência de Ordens x Pagamento Frete", _subtitle(date_from, date_to, transport_company) or "Todas as ordens",
                                _sections(data), "conferencia_frete")
