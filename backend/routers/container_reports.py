from datetime import datetime
from typing import Optional
import re

from fastapi import APIRouter, Depends, Query

from period_reports import Column, Section, MONEY, DAY, INT, pdf_response, excel_response, period_text
from reports import BRT_TZ, format_currency
from routers.financial_reports import _in_period, _r
from shared import db, get_current_admin_user, parse_datetime_value

api_router = APIRouter(prefix="/api")

# ==================== GESTÃO DE CONTAINER - RELATÓRIO DE CONFERÊNCIA ====================
# Compra e Venda de Container não tinham relatório nenhum. Aqui: o estoque
# (comprados ainda sem venda, há quantos dias), as vendas do período com a
# margem sobre a compra vinculada, o que falta receber, os totais por
# representante e as pendências de cadastro (venda sem compra, sem valor).

SALE_STATUS_LABELS = {"PENDENTE": "A receber", "RECEBIDO": "Recebido"}


def _day(value) -> Optional[str]:
    if not value:
        return None
    try:
        return parse_datetime_value(value).astimezone(BRT_TZ).date().isoformat()
    except Exception:
        return None


async def build_container_report(date_from=None, date_to=None, representative=None) -> dict:
    today = datetime.now(BRT_TZ).date()
    purchases = await db.container_purchases.find({}, {"_id": 0}).to_list(None)
    by_id = {p["id"]: p for p in purchases}

    stock = []
    for p in purchases:
        if p.get("status") == "VENDIDO":
            continue
        entry = _day(p.get("entry_date")) or _day(p.get("created_at"))
        stock.append({
            "container_number": p["container_number"], "booking": p.get("booking"), "origin_terminal": p.get("origin_terminal"),
            "entry_date": entry, "days_in_stock": (today - datetime.fromisoformat(entry).date()).days if entry else None,
            "purchase_value": p.get("purchase_value"), "target_value": p.get("sale_value"), "order_number": p.get("order_number"),
        })
    stock.sort(key=lambda s: -(s["days_in_stock"] or 0))

    rep_re = re.compile(re.escape(representative.strip()), re.I) if representative else None
    sales_docs = await db.container_sales.find({}, {"_id": 0}).sort("created_at", 1).to_list(None)
    sales, reps = [], {}
    for s in sales_docs:
        sale_day = _day(s.get("created_at"))
        if not _in_period(sale_day, date_from, date_to):
            continue
        rep_name = s.get("representative_name") or "(sem representante)"
        if rep_re and not rep_re.search(rep_name):
            continue
        purchase = by_id.get(s.get("purchase_id")) if s.get("purchase_id") else None
        cost = purchase.get("purchase_value") if purchase else None
        value = s.get("sale_value")
        margin = _r(value - cost) if value is not None and cost is not None else None
        status = s.get("status") or "PENDENTE"
        open_amount = _r((value or 0) - (s.get("received_value") or 0)) if status == "PENDENTE" and value is not None else 0
        row = {
            "container_number": s["container_number"], "booking": s.get("booking"), "order_number": s.get("order_number"),
            "sale_date": sale_day, "representative_name": rep_name, "purchase_linked": purchase is not None,
            "purchase_value": cost, "sale_value": value, "margin": margin,
            "margin_pct": round(margin / cost * 100, 1) if margin is not None and cost else None,
            "status": status, "received_value": s.get("received_value"), "received_at": _day(s.get("received_at")),
            "open_amount": open_amount,
        }
        sales.append(row)
        r = reps.setdefault(rep_name, {"representative_name": rep_name, "count": 0, "sales": 0.0, "margin": 0.0, "open": 0.0})
        r["count"] += 1
        r["sales"] += value or 0
        r["margin"] += margin or 0
        r["open"] += open_amount
    for r in reps.values():
        for key in ("sales", "margin", "open"):
            r[key] = _r(r[key])

    with_margin = [s for s in sales if s["margin"] is not None]
    summary = {
        "stock_count": len(stock),
        "stock_value": _r(sum(s["purchase_value"] or 0 for s in stock)),
        "stock_over_90": sum(1 for s in stock if (s["days_in_stock"] or 0) > 90),
        "sales_count": len(sales),
        "sales_total": _r(sum(s["sale_value"] or 0 for s in sales)),
        "cost_total": _r(sum(s["purchase_value"] or 0 for s in with_margin)),
        "margin_total": _r(sum(s["margin"] for s in with_margin)),
        "open_total": _r(sum(s["open_amount"] for s in sales)),
        "without_purchase": sum(1 for s in sales if not s["purchase_linked"]),
        "without_value": sum(1 for s in sales if s["sale_value"] is None),
    }
    return {
        "stock": stock,
        "sales": sales,
        "representatives": sorted(reps.values(), key=lambda r: (-r["sales"], r["representative_name"])),
        "summary": summary,
    }


def _sections(data):
    s = data["summary"]
    pending = [x for x in data["sales"] if not x["purchase_linked"] or x["sale_value"] is None]
    return [
        Section(
            "Vendas do período",
            [Column("Container", width=13, align="center"), Column("Ordem", INT, 7), Column("Venda", DAY, 9),
             Column("Representante", width=20), Column("Compra", MONEY, 11), Column("Venda (R$)", MONEY, 11),
             Column("Margem", MONEY, 11), Column("Margem %", width=8, align="center"), Column("Situação", width=9, align="center"),
             Column("Recebido em", DAY, 9), Column("A receber", MONEY, 11)],
            [[x["container_number"], x["order_number"], x["sale_date"], x["representative_name"], x["purchase_value"], x["sale_value"],
              x["margin"], f"{x['margin_pct']:.1f}%".replace(".", ",") if x["margin_pct"] is not None else None,
              SALE_STATUS_LABELS.get(x["status"], x["status"]), x["received_at"], x["open_amount"] or None]
             for x in data["sales"]],
            total=["TOTAL", None, None, None, s["cost_total"], s["sales_total"], s["margin_total"], None, None, None, s["open_total"]],
            empty_text="Nenhuma venda no período.", sheet_name="Vendas",
        ),
        Section(
            "Estoque: comprados ainda sem venda",
            [Column("Container", width=13, align="center"), Column("Booking", width=12, align="center"), Column("Terminal de coleta", width=20),
             Column("Ordem", INT, 7), Column("Entrada", DAY, 9), Column("Dias em estoque", INT, 9), Column("Valor de compra", MONEY, 12),
             Column("Valor-alvo de venda", MONEY, 12)],
            [[x["container_number"], x["booking"], x["origin_terminal"], x["order_number"], x["entry_date"], x["days_in_stock"],
              x["purchase_value"], x["target_value"]] for x in data["stock"]],
            total=["TOTAL", None, None, None, None, None, s["stock_value"], None] if data["stock"] else None,
            empty_text="Nenhum container em estoque.", sheet_name="Estoque",
        ),
        Section(
            "Por representante",
            [Column("Representante", width=34), Column("Vendas", INT, 9), Column("Total vendido", MONEY, 14),
             Column("Margem", MONEY, 14), Column("A receber", MONEY, 14)],
            [[r["representative_name"], r["count"], r["sales"], r["margin"], r["open"]] for r in data["representatives"]],
            total=["TOTAL", s["sales_count"], s["sales_total"], s["margin_total"], s["open_total"]] if data["representatives"] else None,
            empty_text="Nenhuma venda no período.", sheet_name="Por representante",
        ),
        Section(
            "Pendências de cadastro",
            [Column("Container", width=14, align="center"), Column("Venda", DAY, 10), Column("Representante", width=24), Column("Pendência", width=40)],
            [[x["container_number"], x["sale_date"], x["representative_name"],
              "; ".join(t for t, bad in (("venda sem compra vinculada (margem não calculada)", not x["purchase_linked"]),
                                           ("valor da venda não informado", x["sale_value"] is None)) if bad)]
             for x in pending],
            empty_text="Nenhuma pendência: todas as vendas têm compra vinculada e valor.", sheet_name="Pendências",
        ),
    ]


def _subtitle(date_from, date_to, representative):
    parts = [period_text("Vendas", date_from, date_to), f"Representante: {representative}" if representative else None]
    return " · ".join(p for p in parts if p) or None


@api_router.get("/reports/containers")
async def get_container_report(
    date_from: Optional[str] = None, date_to: Optional[str] = None, representative: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user),
):
    """Compra e Venda de Container: estoque, vendas do período com margem, a receber e pendências"""
    return await build_container_report(date_from, date_to, representative)


@api_router.get("/reports/containers/pdf")
async def get_container_report_pdf(
    date_from: Optional[str] = None, date_to: Optional[str] = None, representative: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user),
):
    data = await build_container_report(date_from, date_to, representative)
    s = data["summary"]
    money = lambda v: format_currency(v, "BRL")
    info = [("Vendas no período", f"{s['sales_count']} · {money(s['sales_total'])}"), ("Margem", money(s["margin_total"])),
            ("A receber", money(s["open_total"])), ("Em estoque", f"{s['stock_count']} · {money(s['stock_value'])}"),
            ("Estoque há mais de 90 dias", str(s["stock_over_90"])), ("Pendências de cadastro", str(s["without_purchase"] + s["without_value"]))]
    return await pdf_response("Relatório de Compra e Venda de Container", _subtitle(date_from, date_to, representative), info,
                              _sections(data), "relatorio_containers", current_user.get("name", "Sistema"))


@api_router.get("/reports/containers/excel")
async def get_container_report_excel(
    date_from: Optional[str] = None, date_to: Optional[str] = None, representative: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user),
):
    data = await build_container_report(date_from, date_to, representative)
    return await excel_response("Relatório de Compra e Venda de Container", _subtitle(date_from, date_to, representative) or "Todas as vendas",
                                _sections(data), "relatorio_containers")
