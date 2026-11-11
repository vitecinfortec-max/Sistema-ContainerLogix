from datetime import date, datetime
from typing import Optional
import io
import logging
import re

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from reports import BRT_TZ, merge_company
from routers.movements import _parse_filter_day
from routers.receivable_titles import label as title_label
from shared import (
    db, get_current_admin_user, get_company_settings, get_disabled_modules, is_module_disabled, load_logo_buffer,
    parse_datetime_value,
)

api_router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)

# ==================== FINANCEIRO - CONTAS A RECEBER ====================
# Conferência das Faturas: o que está em aberto, há quanto tempo, de quem, e o
# que foi recebido no período. O atraso conta do vencimento; fatura sem
# vencimento (as anteriores ao campo) conta da emissão e vem marcada assim.

AGING_BUCKETS = [  # (chave, rótulo, de, até) em dias de atraso
    ("current", "A vencer", None, 0),
    ("d1_30", "1 a 30 dias", 1, 30),
    ("d31_60", "31 a 60 dias", 31, 60),
    ("d61_90", "61 a 90 dias", 61, 90),
    ("d90", "Mais de 90 dias", 91, None),
]
AGING_LABELS = {key: label for key, label, _, _ in AGING_BUCKETS}
STATUS_LABELS = {"PENDENTE": "Em aberto", "PAGO": "Recebido"}
DATE_FIELD_LABELS = {"issue": "Emissão", "due": "Vencimento", "paid": "Recebimento"}


def _bucket(days: int) -> str:
    for key, _, low, high in AGING_BUCKETS:
        if (low is None or days >= low) and (high is None or days <= high):
            return key
    return "d90"


def _fmt_day(value) -> str:
    if not value:
        return "-"
    return (value if isinstance(value, date) else date.fromisoformat(value)).strftime("%d/%m/%Y")


SOURCE_LABELS = {"FATURA": "Fatura", "PORTUARIO": "Faturamento Portuário", "VENDA": "Venda de container", "TITULO": "Título avulso"}
SOURCE_MODULES = {"FATURA": "financeiro.faturas", "PORTUARIO": "financeiro.faturamento_portuario",
                  "VENDA": "gestao_container.venda", "TITULO": "financeiro.contas_receber"}


def _brt_day(value) -> Optional[date]:
    return parse_datetime_value(value).astimezone(BRT_TZ).date() if value else None


def _iso_day(value) -> Optional[date]:
    return date.fromisoformat(value[:10]) if value else None


def _status_query(wanted, open_value, paid_value):
    if wanted == "open":
        return open_value
    if wanted == "paid":
        return paid_value
    return {"$in": [*(open_value["$in"] if isinstance(open_value, dict) else [open_value]), paid_value]}


async def _source_docs(source: str, query_status: Optional[str], client_name: Optional[str]) -> list:
    """Os documentos de uma origem, já no formato comum do painel."""
    name_regex = {"$regex": re.escape(client_name.strip()), "$options": "i"} if client_name else None
    wanted = {"PENDENTE": "open", "PAGO": "paid"}.get(query_status)
    out = []
    if source == "FATURA":
        query = {"status": _status_query(wanted, {"$in": ["PENDENTE", None]}, "PAGO")}
        if name_regex:
            query["client_name"] = name_regex
        async for inv in db.invoices.find(query, {"_id": 0, "movement_ids": 0}):
            total = inv.get("total_value") or 0
            out.append({"id": inv["id"], "invoice_number": inv["invoice_number"], "number_label": str(inv["invoice_number"]),
                        "client_name": inv["client_name"], "client_cnpj": inv.get("client_cnpj"),
                        "issue": _brt_day(inv["created_at"]), "due": _iso_day(inv.get("due_date")), "paid": _iso_day(inv.get("paid_date")),
                        "total_value": total, "credit_applied": inv.get("credit_applied") or 0,
                        "open_value": total - (inv.get("credit_applied") or 0),
                        "is_open": (inv.get("status") or "PENDENTE") == "PENDENTE",
                        "account_name": inv.get("account_name"), "cost_center_name": inv.get("cost_center_name")})
    elif source == "PORTUARIO":
        query = {"status": _status_query(wanted, "PENDENTE", "PAGO")}
        if name_regex:
            query["client_name"] = name_regex
        async for b in db.port_service_billing_batches.find(query, {"_id": 0, "service_ids": 0}):
            total = b.get("net_total", b.get("total_value")) or 0
            out.append({"id": b["id"], "number_label": str(b["batch_number"]), "client_name": b["client_name"],
                        "issue": _brt_day(b.get("created_at")), "due": None, "paid": _brt_day(b.get("paid_at")),
                        "total_value": total, "credit_applied": 0, "open_value": total, "is_open": b["status"] == "PENDENTE"})
    elif source == "VENDA":
        # Venda sem valor combinado ainda não tem o que receber
        query = {"status": _status_query(wanted, "PENDENTE", "RECEBIDO"), "sale_value": {"$gt": 0}}
        if name_regex:
            query["representative_name"] = name_regex
        async for sale in db.container_sales.find(query, {"_id": 0}):
            total, received = sale.get("sale_value") or 0, sale.get("received_value") or 0
            is_open = sale["status"] == "PENDENTE"
            out.append({"id": sale["id"], "number_label": sale.get("container_number") or "-",
                        "client_name": sale.get("representative_name") or "Venda de container",
                        "issue": _brt_day(sale.get("created_at")), "due": None, "paid": _brt_day(sale.get("received_at")),
                        "total_value": total if is_open else (received or total), "credit_applied": 0,
                        "open_value": total - received, "is_open": is_open})
    elif source == "TITULO":
        query = {"status": _status_query(wanted, "ABERTO", "RECEBIDO")}
        if name_regex:
            query["client_name"] = name_regex
        async for t in db.receivable_titles.find(query, {"_id": 0, "attachments": 0}):
            is_open = t["status"] == "ABERTO"
            out.append({"id": t["id"], "number_label": title_label(t), "client_name": t["client_name"],
                        "description": t.get("description"),
                        "issue": _iso_day(t["issue_date"]), "due": _iso_day(t.get("due_date")), "paid": _iso_day(t.get("paid_date")),
                        "total_value": t["amount"] if is_open else (t.get("paid_amount") or t["amount"]), "credit_applied": 0,
                        "open_value": t["amount"], "is_open": is_open,
                        "account_name": t.get("account_name"), "cost_center_name": t.get("cost_center_name")})
    return out


async def build_receivables(status=None, client_name=None, date_field="issue", date_from=None, date_to=None, source=None) -> dict:
    """O painel Contas a Receber: Faturas, Faturamento Portuário, Venda de
    Container e títulos avulsos (de cada módulo contratado), no mesmo formato."""
    day_from = _parse_filter_day(date_from, "date_from") if date_from else None
    day_to = _parse_filter_day(date_to, "date_to") if date_to else None
    disabled = await get_disabled_modules()
    sources = [s for s in SOURCE_LABELS if (not source or s == source) and not is_module_disabled(SOURCE_MODULES[s], disabled)]
    today = datetime.now(BRT_TZ).date()

    rows = []
    for src in sources:
        for doc in await _source_docs(src, status, client_name):
            issue, due, paid = doc["issue"], doc["due"], doc["paid"]
            ref = {"issue": issue, "due": due, "paid": paid}[date_field]
            if (day_from or day_to) and ref is None:
                continue
            if (day_from and ref < day_from) or (day_to and ref > day_to):
                continue
            is_open = doc["is_open"]
            row = {
                "id": doc["id"],
                "source": src,
                "source_label": SOURCE_LABELS[src],
                "invoice_number": doc.get("invoice_number"),
                "number_label": doc["number_label"],
                "client_name": doc["client_name"],
                "client_cnpj": doc.get("client_cnpj"),
                "description": doc.get("description"),
                "account_name": doc.get("account_name"),
                "cost_center_name": doc.get("cost_center_name"),
                "issue_date": issue.isoformat() if issue else None,
                "due_date": due.isoformat() if due else None,
                "paid_date": paid.isoformat() if paid else None,
                "total_value": round(doc["total_value"], 2),
                # Crédito de Cliente já usado: em aberto conta só o que falta
                "credit_applied": round(doc["credit_applied"], 2),
                "open_value": round(doc["open_value"], 2) if is_open else 0,
                "status": "PENDENTE" if is_open else "PAGO",
                "days_overdue": None,
                "aging": None,
                "aging_from_issue": False,
                "days_to_receive": (paid - issue).days if paid and issue else None,
            }
            if is_open:
                days = (today - (due or issue or today)).days
                row.update(days_overdue=max(days, 0), aging=_bucket(days), aging_from_issue=due is None)
            rows.append(row)
    order = list(SOURCE_LABELS)
    rows.sort(key=lambda r: (r["status"] != "PENDENTE", -(r["days_overdue"] or 0), order.index(r["source"]), r["number_label"].zfill(12)))

    aging = {key: {"label": label, "count": 0, "total": 0.0} for key, label, _, _ in AGING_BUCKETS}
    clients = {}
    open_total = paid_total = 0.0
    receive_days = []
    for r in rows:
        c = clients.setdefault(r["client_name"], {"client_name": r["client_name"], "count": 0, "open": 0.0, "overdue": 0.0, "paid": 0.0})
        c["count"] += 1
        if r["status"] == "PENDENTE":
            open_total += r["open_value"]
            c["open"] += r["open_value"]
            aging[r["aging"]]["count"] += 1
            aging[r["aging"]]["total"] += r["open_value"]
            if r["aging"] != "current":
                c["overdue"] += r["open_value"]
        else:
            paid_total += r["total_value"]
            c["paid"] += r["total_value"]
            if r["days_to_receive"] is not None:
                receive_days.append(r["days_to_receive"])
    for bucket in aging.values():
        bucket["total"] = round(bucket["total"], 2)
    for c in clients.values():
        for k in ("open", "overdue", "paid"):
            c[k] = round(c[k], 2)

    return {
        "rows": rows,
        "summary": {
            "count": len(rows),
            "open_total": round(open_total, 2),
            "overdue_total": round(open_total - aging["current"]["total"], 2),
            "paid_total": round(paid_total, 2),
            "avg_days_to_receive": round(sum(receive_days) / len(receive_days), 1) if receive_days else None,
            "without_due_date": sum(1 for r in rows if r["status"] == "PENDENTE" and r["aging_from_issue"]),
            "aging": [{"key": k, **v} for k, v in aging.items()],
        },
        "clients": sorted(clients.values(), key=lambda c: (-c["open"], c["client_name"])),
    }


STATUS_PATTERN = "^(PENDENTE|PAGO)$"
DATE_FIELD_PATTERN = "^(issue|due|paid)$"
SOURCE_PATTERN = "^(FATURA|PORTUARIO|VENDA|TITULO)$"


@api_router.get("/reports/receivables")
async def get_receivables(
    status: Optional[str] = Query(None, pattern=STATUS_PATTERN),
    client_name: Optional[str] = None,
    date_field: str = Query("issue", pattern=DATE_FIELD_PATTERN),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    source: Optional[str] = Query(None, pattern=SOURCE_PATTERN),
    current_user: dict = Depends(get_current_admin_user)
):
    """Contas a Receber: o que está em aberto e o que foi recebido (Faturas,
    Faturamento Portuário, Venda de Container e títulos avulsos), com atraso por faixa e por cliente"""
    return await build_receivables(status, client_name, date_field, date_from, date_to, source)


def _report_subtitle(status, client_name, date_field, date_from, date_to, source=None) -> str:
    parts = [STATUS_LABELS.get(status, "Em aberto e recebidos")]
    if source:
        parts.append(f"Origem: {SOURCE_LABELS[source]}")
    if client_name:
        parts.append(f"Cliente: {client_name}")
    if date_from or date_to:
        parts.append(f"{DATE_FIELD_LABELS[date_field]}: {_fmt_day(date_from) if date_from else 'início'} a {_fmt_day(date_to) if date_to else 'hoje'}")
    return " · ".join(parts)


@api_router.get("/reports/receivables/pdf")
async def get_receivables_pdf(
    status: Optional[str] = Query(None, pattern=STATUS_PATTERN),
    client_name: Optional[str] = None,
    date_field: str = Query("issue", pattern=DATE_FIELD_PATTERN),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    source: Optional[str] = Query(None, pattern=SOURCE_PATTERN),
    current_user: dict = Depends(get_current_admin_user)
):
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    from reports import (
        _build_pdf_header, _make_pdf_footer, format_currency, _fmt_int, _pdf_info_grid, _pdf_section_title,
        _pdf_header_cells, _pdf_cell_factory, _pdf_table_style, _pdf_empty_state, _pdf_narrow_table,
    )

    data = await build_receivables(status, client_name, date_field, date_from, date_to, source)
    s = data["summary"]
    company = merge_company(await get_company_settings())
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), rightMargin=12*mm, leftMargin=12*mm, topMargin=10*mm, bottomMargin=14*mm)
    width = doc.width
    styles = getSampleStyleSheet()
    money = lambda v: format_currency(v, "BRL")

    elements = list(_build_pdf_header(
        styles, load_logo_buffer(company), "Contas a Receber",
        generation_info=_report_subtitle(status, client_name, date_field, date_from, date_to, source), company=company, content_width=width,
    ))
    avg = s["avg_days_to_receive"]
    elements.append(_pdf_info_grid([
        ("Títulos", _fmt_int(s["count"])),
        ("Em aberto", money(s["open_total"])),
        ("Vencido", money(s["overdue_total"])),
        ("Recebido", money(s["paid_total"])),
        ("Prazo médio de recebimento", f"{avg:.0f} dias".replace(".", ",") if avg is not None else "-"),
        ("Gerado em", datetime.now(BRT_TZ).strftime("%d/%m/%Y %H:%M")),
        ("Gerado por", current_user.get("name", "Sistema")),
        ("Em aberto sem vencimento", _fmt_int(s["without_due_date"])),
    ], width, cols=4))

    cell = _pdf_cell_factory(styles, font_size=7.5)
    if not data["rows"]:
        elements.append(Spacer(1, 10))
        elements.append(_pdf_empty_state("Nada a receber encontrado com esses filtros.", width))
    else:
        if s["open_total"]:
            elements.extend(_pdf_section_title("Em aberto por tempo de atraso", width))
            aging_rows = [_pdf_header_cells(["Faixa", "Títulos", "Valor"], font_size=7.5)]
            for a in s["aging"]:
                aging_rows.append([cell(a["label"]), cell(_fmt_int(a["count"]), "center"), cell(money(a["total"]), "right", bold=True)])
            elements.append(_pdf_narrow_table(aging_rows, [130, 60, 100], width))

        elements.extend(_pdf_section_title("Por cliente", width))
        client_rows = [_pdf_header_cells(["Cliente", "Títulos", "Em aberto", "Vencido", "Recebido"], font_size=7.5)]
        for c in data["clients"]:
            client_rows.append([cell(c["client_name"], bold=True), cell(_fmt_int(c["count"]), "center"),
                                cell(money(c["open"]), "right"), cell(money(c["overdue"]), "right"), cell(money(c["paid"]), "right")])
        client_rows.append([cell("TOTAL", bold=True), cell(_fmt_int(s["count"]), "center", bold=True), cell(money(s["open_total"]), "right", bold=True),
                            cell(money(s["overdue_total"]), "right", bold=True), cell(money(s["paid_total"]), "right", bold=True)])
        scale = width / 760
        table = Table(client_rows, colWidths=[w * scale for w in [340, 70, 115, 115, 120]], repeatRows=1)
        table.setStyle(TableStyle(_pdf_table_style(total_row=True)))
        elements.append(table)

        elements.extend(_pdf_section_title("Títulos", width))
        detail = [_pdf_header_cells(["Origem", "Nº", "Cliente", "Emissão", "Vencimento", "Atraso", "Recebido em", "Situação", "Valor"], font_size=7.5)]
        for r in data["rows"]:
            if r["status"] == "PENDENTE":
                late = f"{r['days_overdue']} dia(s)" if r["days_overdue"] else "-"
                if r["aging_from_issue"] and r["days_overdue"]:
                    late += " (emissão)"
                situation = AGING_LABELS[r["aging"]] if r["aging"] == "current" else "Vencido"
            else:
                late, situation = "-", "Recebido"
            if r["credit_applied"]:
                situation += f" (crédito {money(r['credit_applied'])})"
            detail.append([
                cell(r["source_label"]), cell(r["number_label"], "center", bold=True), cell(r["client_name"]), cell(_fmt_day(r["issue_date"]), "center"),
                cell(_fmt_day(r["due_date"]), "center"), cell(late, "center"), cell(_fmt_day(r["paid_date"]), "center"),
                cell(situation, "center"), cell(money(r["open_value"] if r["status"] == "PENDENTE" else r["total_value"]), "right", bold=True),
            ])
        scale = width / 760
        table = Table(detail, colWidths=[w * scale for w in [80, 60, 190, 62, 62, 72, 68, 76, 90]], repeatRows=1)
        table.setStyle(TableStyle(_pdf_table_style()))
        elements.append(table)

    footer = _make_pdf_footer(company["name"])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": "attachment; filename=contas_a_receber.pdf"})


@api_router.get("/reports/receivables/excel")
async def get_receivables_excel(
    status: Optional[str] = Query(None, pattern=STATUS_PATTERN),
    client_name: Optional[str] = None,
    date_field: str = Query("issue", pattern=DATE_FIELD_PATTERN),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    source: Optional[str] = Query(None, pattern=SOURCE_PATTERN),
    current_user: dict = Depends(get_current_admin_user)
):
    from openpyxl import Workbook
    from reports import (
        _bsoft_style_excel, _xl_date, _xl_totals, _xl_extend_print_area, _xl_color_column, _xl_error_workbook,
        XL_DATE, format_currency, download_logo,
    )

    data = await build_receivables(status, client_name, date_field, date_from, date_to, source)
    s = data["summary"]
    try:
        company = await get_company_settings()
        wb = Workbook()
        ws = wb.active
        ws.title = "Contas a Receber"
        headers = ["Origem", "Nº", "Cliente", "CNPJ", "Emissão", "Vencimento", "Dias de atraso", "Faixa", "Recebido em", "Situação", "Valor"]
        rows = []
        for r in data["rows"]:
            is_open = r["status"] == "PENDENTE"
            rows.append([
                r["source_label"], r["number_label"], r["client_name"], r["client_cnpj"] or "-",
                _xl_date(r["issue_date"]) if r["issue_date"] else "-",
                _xl_date(r["due_date"]) if r["due_date"] else "-",
                (r["days_overdue"] if is_open else None),
                (AGING_LABELS[r["aging"]] + (" (emissão)" if r["aging_from_issue"] else "")) if is_open else "-",
                _xl_date(r["paid_date"]) if r["paid_date"] else "-",
                ("A vencer" if r["aging"] == "current" else "Vencido") if is_open else "Recebido",
                r["open_value"] if is_open else r["total_value"],
            ])
        stats = (f"{_report_subtitle(status, client_name, date_field, date_from, date_to, source)}   •   Em aberto: {format_currency(s['open_total'], 'BRL')}"
                 f"   •   Vencido: {format_currency(s['overdue_total'], 'BRL')}   •   Recebido: {format_currency(s['paid_total'], 'BRL')}")
        _bsoft_style_excel(
            ws, "Contas a Receber", stats, headers, rows,
            {'B': 20, 'C': 12, 'D': 34, 'E': 20, 'F': 12, 'G': 12, 'H': 13, 'I': 22, 'J': 13, 'K': 12, 'L': 15},
            center_cols={0, 1, 3, 4, 5, 6, 7, 8, 9},
            number_fmt_cols={4: XL_DATE, 5: XL_DATE, 8: XL_DATE, 10: 'R$ #,##0.00'},
            stats_text=stats, company_name=merge_company(company)['name'], logo_buffer=download_logo(company),
            company=company, autofilter=True, empty_message="Nada a receber encontrado com esses filtros.",
        )
        tones = {"Recebido": "emerald", "Vencido": "red", "A vencer": "amber"}
        _xl_color_column(ws, 9, [tones.get(row[9]) for row in rows])
        totals_row = 9 + max(len(rows), 1) + 1
        aging_rows = [(a["label"], a["total"]) for a in s["aging"] if a["count"]]
        last_row = _xl_totals(ws, totals_row, 9, 11, 12, aging_rows + [
            ("Total em aberto", s["open_total"]),
            ("Total recebido", s["paid_total"]),
        ])
        _xl_extend_print_area(ws, 'L', last_row)
        buffer = io.BytesIO()
        wb.save(buffer)
        content = buffer.getvalue()
    except Exception:
        logger.exception("Erro ao gerar o Excel de Contas a Receber")
        content = _xl_error_workbook("Erro ao gerar Contas a Receber.")
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=contas_a_receber.xlsx"},
    )
