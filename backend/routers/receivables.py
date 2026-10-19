from datetime import date, datetime
from typing import Optional
import io
import logging
import re

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from reports import BRT_TZ, merge_company
from routers.movements import _parse_filter_day
from shared import db, get_current_admin_user, get_company_settings, load_logo_buffer, parse_datetime_value

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
STATUS_LABELS = {"PENDENTE": "Em aberto", "PAGO": "Recebida"}
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


async def build_receivables(status=None, client_name=None, date_field="issue", date_from=None, date_to=None) -> dict:
    query = {"status": {"$in": ["PENDENTE", "PAGO", None]}}
    if status == "PENDENTE":
        query["status"] = {"$in": ["PENDENTE", None]}
    elif status == "PAGO":
        query["status"] = "PAGO"
    if client_name:
        query["client_name"] = {"$regex": re.escape(client_name.strip()), "$options": "i"}
    day_from = _parse_filter_day(date_from, "date_from") if date_from else None
    day_to = _parse_filter_day(date_to, "date_to") if date_to else None

    invoices = await db.invoices.find(query, {"_id": 0, "movement_ids": 0}).to_list(None)
    today = datetime.now(BRT_TZ).date()

    rows = []
    for inv in invoices:
        issue = parse_datetime_value(inv["created_at"]).astimezone(BRT_TZ).date()
        due = date.fromisoformat(inv["due_date"]) if inv.get("due_date") else None
        paid = date.fromisoformat(inv["paid_date"]) if inv.get("paid_date") else None
        ref = {"issue": issue, "due": due, "paid": paid}[date_field]
        if (day_from or day_to) and ref is None:
            continue
        if (day_from and ref < day_from) or (day_to and ref > day_to):
            continue
        is_open = (inv.get("status") or "PENDENTE") == "PENDENTE"
        row = {
            "id": inv["id"],
            "invoice_number": inv["invoice_number"],
            "client_name": inv["client_name"],
            "client_cnpj": inv.get("client_cnpj"),
            "issue_date": issue.isoformat(),
            "due_date": due.isoformat() if due else None,
            "paid_date": paid.isoformat() if paid else None,
            "total_value": round(inv.get("total_value") or 0, 2),
            "status": "PENDENTE" if is_open else "PAGO",
            "days_overdue": None,
            "aging": None,
            "aging_from_issue": False,
            "days_to_receive": (paid - issue).days if paid else None,
        }
        if is_open:
            days = (today - (due or issue)).days
            row.update(days_overdue=max(days, 0), aging=_bucket(days), aging_from_issue=due is None)
        rows.append(row)
    rows.sort(key=lambda r: (r["status"] != "PENDENTE", -(r["days_overdue"] or 0), r["invoice_number"]))

    aging = {key: {"label": label, "count": 0, "total": 0.0} for key, label, _, _ in AGING_BUCKETS}
    clients = {}
    open_total = paid_total = 0.0
    receive_days = []
    for r in rows:
        c = clients.setdefault(r["client_name"], {"client_name": r["client_name"], "count": 0, "open": 0.0, "overdue": 0.0, "paid": 0.0})
        c["count"] += 1
        if r["status"] == "PENDENTE":
            open_total += r["total_value"]
            c["open"] += r["total_value"]
            aging[r["aging"]]["count"] += 1
            aging[r["aging"]]["total"] += r["total_value"]
            if r["aging"] != "current":
                c["overdue"] += r["total_value"]
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


@api_router.get("/reports/receivables")
async def get_receivables(
    status: Optional[str] = Query(None, pattern=STATUS_PATTERN),
    client_name: Optional[str] = None,
    date_field: str = Query("issue", pattern=DATE_FIELD_PATTERN),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    """Contas a Receber: faturas em aberto e recebidas, com atraso por faixa e por cliente"""
    return await build_receivables(status, client_name, date_field, date_from, date_to)


def _report_subtitle(status, client_name, date_field, date_from, date_to) -> str:
    parts = [STATUS_LABELS.get(status, "Em aberto e recebidas")]
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

    data = await build_receivables(status, client_name, date_field, date_from, date_to)
    s = data["summary"]
    company = merge_company(await get_company_settings())
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), rightMargin=12*mm, leftMargin=12*mm, topMargin=10*mm, bottomMargin=14*mm)
    width = doc.width
    styles = getSampleStyleSheet()
    money = lambda v: format_currency(v, "BRL")

    elements = list(_build_pdf_header(
        styles, load_logo_buffer(company), "Contas a Receber",
        generation_info=_report_subtitle(status, client_name, date_field, date_from, date_to), company=company, content_width=width,
    ))
    avg = s["avg_days_to_receive"]
    elements.append(_pdf_info_grid([
        ("Faturas", _fmt_int(s["count"])),
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
        elements.append(_pdf_empty_state("Nenhuma fatura encontrada com esses filtros.", width))
    else:
        if s["open_total"]:
            elements.extend(_pdf_section_title("Em aberto por tempo de atraso", width))
            aging_rows = [_pdf_header_cells(["Faixa", "Faturas", "Valor"], font_size=7.5)]
            for a in s["aging"]:
                aging_rows.append([cell(a["label"]), cell(_fmt_int(a["count"]), "center"), cell(money(a["total"]), "right", bold=True)])
            elements.append(_pdf_narrow_table(aging_rows, [130, 60, 100], width))

        elements.extend(_pdf_section_title("Por cliente", width))
        client_rows = [_pdf_header_cells(["Cliente", "Faturas", "Em aberto", "Vencido", "Recebido"], font_size=7.5)]
        for c in data["clients"]:
            client_rows.append([cell(c["client_name"], bold=True), cell(_fmt_int(c["count"]), "center"),
                                cell(money(c["open"]), "right"), cell(money(c["overdue"]), "right"), cell(money(c["paid"]), "right")])
        client_rows.append([cell("TOTAL", bold=True), cell(_fmt_int(s["count"]), "center", bold=True), cell(money(s["open_total"]), "right", bold=True),
                            cell(money(s["overdue_total"]), "right", bold=True), cell(money(s["paid_total"]), "right", bold=True)])
        scale = width / 760
        table = Table(client_rows, colWidths=[w * scale for w in [340, 70, 115, 115, 120]], repeatRows=1)
        table.setStyle(TableStyle(_pdf_table_style(total_row=True)))
        elements.append(table)

        elements.extend(_pdf_section_title("Faturas", width))
        detail = [_pdf_header_cells(["Nº", "Cliente", "Emissão", "Vencimento", "Atraso", "Recebida em", "Situação", "Valor"], font_size=7.5)]
        for r in data["rows"]:
            if r["status"] == "PENDENTE":
                late = f"{r['days_overdue']} dia(s)" if r["days_overdue"] else "-"
                if r["aging_from_issue"] and r["days_overdue"]:
                    late += " (emissão)"
                situation = AGING_LABELS[r["aging"]] if r["aging"] == "current" else "Vencida"
            else:
                late, situation = "-", "Recebida"
            detail.append([
                cell(r["invoice_number"], "center", bold=True), cell(r["client_name"]), cell(_fmt_day(r["issue_date"]), "center"),
                cell(_fmt_day(r["due_date"]), "center"), cell(late, "center"), cell(_fmt_day(r["paid_date"]), "center"),
                cell(situation, "center"), cell(money(r["total_value"]), "right", bold=True),
            ])
        scale = width / 760
        table = Table(detail, colWidths=[w * scale for w in [45, 245, 70, 70, 85, 75, 75, 95]], repeatRows=1)
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
    current_user: dict = Depends(get_current_admin_user)
):
    from openpyxl import Workbook
    from reports import (
        _bsoft_style_excel, _xl_date, _xl_totals, _xl_extend_print_area, _xl_color_column, _xl_error_workbook,
        XL_DATE, format_currency, download_logo,
    )

    data = await build_receivables(status, client_name, date_field, date_from, date_to)
    s = data["summary"]
    try:
        company = await get_company_settings()
        wb = Workbook()
        ws = wb.active
        ws.title = "Contas a Receber"
        headers = ["Nº Fatura", "Cliente", "CNPJ", "Emissão", "Vencimento", "Dias de atraso", "Faixa", "Recebida em", "Situação", "Valor"]
        rows = []
        for r in data["rows"]:
            is_open = r["status"] == "PENDENTE"
            rows.append([
                r["invoice_number"], r["client_name"], r["client_cnpj"] or "-", _xl_date(r["issue_date"]),
                _xl_date(r["due_date"]) if r["due_date"] else "-",
                (r["days_overdue"] if is_open else None),
                (AGING_LABELS[r["aging"]] + (" (emissão)" if r["aging_from_issue"] else "")) if is_open else "-",
                _xl_date(r["paid_date"]) if r["paid_date"] else "-",
                ("A vencer" if r["aging"] == "current" else "Vencida") if is_open else "Recebida",
                r["total_value"],
            ])
        stats = (f"{_report_subtitle(status, client_name, date_field, date_from, date_to)}   •   Em aberto: {format_currency(s['open_total'], 'BRL')}"
                 f"   •   Vencido: {format_currency(s['overdue_total'], 'BRL')}   •   Recebido: {format_currency(s['paid_total'], 'BRL')}")
        _bsoft_style_excel(
            ws, "Contas a Receber", stats, headers, rows,
            {'B': 10, 'C': 36, 'D': 20, 'E': 12, 'F': 12, 'G': 13, 'H': 22, 'I': 13, 'J': 12, 'K': 15},
            center_cols={0, 2, 3, 4, 5, 6, 7, 8},
            number_fmt_cols={3: XL_DATE, 4: XL_DATE, 7: XL_DATE, 9: 'R$ #,##0.00'},
            stats_text=stats, company_name=merge_company(company)['name'], logo_buffer=download_logo(company),
            company=company, autofilter=True, empty_message="Nenhuma fatura encontrada com esses filtros.",
        )
        tones = {"Recebida": "emerald", "Vencida": "red", "A vencer": "amber"}
        _xl_color_column(ws, 8, [tones.get(row[8]) for row in rows])
        totals_row = 9 + max(len(rows), 1) + 1
        aging_rows = [(a["label"], a["total"]) for a in s["aging"] if a["count"]]
        last_row = _xl_totals(ws, totals_row, 8, 10, 11, aging_rows + [
            ("Total em aberto", s["open_total"]),
            ("Total recebido", s["paid_total"]),
        ])
        _xl_extend_print_area(ws, 'K', last_row)
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
