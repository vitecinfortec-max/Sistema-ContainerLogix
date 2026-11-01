"""RH - documentos em PDF: contracheque (2 funcionários por página), aviso e recibo
de férias, simulação da rescisão, termo de advertência/suspensão e ficha
do funcionário. Mesma identidade visual dos outros documentos (reports.py)."""
import io
from xml.sax.saxutils import escape as xml_escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import CondPageBreak, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.platypus.flowables import HRFlowable

from hr_payroll import CONTRACT_TYPES, RUN_TYPES
from period_reports import _pdf_block
from reports import (
    BRAND_MUTED, BRAND_TEXT, _build_pdf_header, _build_pdf_summary, _hex, _make_pdf_footer,
    _pdf_cell_factory, _pdf_empty_state, _pdf_header_cells, _pdf_info_grid, _pdf_note_box, _pdf_section_title, _pdf_signatures,
    _pdf_table_style, _pdf_tone_markup, _pdf_totals_box, download_logo, fmt_date, format_currency,
)

MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]


def _money(value) -> str:
    return format_currency(value or 0, "BRL")


def _num(value) -> str:
    return f"{value or 0:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def competence_label(competence: str) -> str:
    year, month = competence.split("-")
    return f"{MONTHS[int(month) - 1].capitalize()}/{year}"


def _doc(buffer, top=12):
    return SimpleDocTemplate(buffer, pagesize=A4, rightMargin=14 * mm, leftMargin=14 * mm, topMargin=top * mm, bottomMargin=15 * mm)


def _build(doc, elements, company):
    footer = _make_pdf_footer(company["name"])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)


def _paragraph_style(styles, size=9.5, leading=14, align=TA_LEFT):
    return ParagraphStyle(f"HRText{size}{align}", parent=styles["Normal"], fontSize=size, leading=leading,
                          alignment=align, textColor=_hex(BRAND_TEXT))


# ---------------------------------------------------------------- Contracheque

# Tudo que vai para a impressora em fundo branco, com texto e filetes pretos
PAYSLIP_ROW_STYLE = [("FONTSIZE", (0, 0), (-1, -1), 7.5), ("TOPPADDING", (0, 1), (-1, -1), 1.6), ("BOTTOMPADDING", (0, 1), (-1, -1), 1.6),
                     ("LINEABOVE", (0, -2), (-1, -2), 0.8, colors.black), ("LINEABOVE", (0, -1), (-1, -1), 0.4, colors.black),
                     ("LINEBELOW", (0, -1), (-1, -1), 0.8, colors.black), ("SPAN", (3, -1), (4, -1)),
                     ("TOPPADDING", (0, -1), (-1, -1), 3), ("BOTTOMPADDING", (0, -1), (-1, -1), 3)]


def _payslip_via(slip: dict, run: dict, company: dict, logo, width: float, via_label: str = ""):
    styles = getSampleStyleSheet()
    title = {"MENSAL": "Recibo de Pagamento de Salário", "ADIANTAMENTO": "Recibo de Adiantamento Salarial"}.get(
        slip.get("run_type"), "Recibo de 13º Salário")
    info = f"{RUN_TYPES.get(slip.get('run_type'), '')} · Competência {competence_label(slip['competence'])}" + (f" · {via_label}" if via_label else "")
    parts = list(_build_pdf_header(styles, logo, title, generation_info=info, company=company, content_width=width, compact=True))
    t = slip.get("totals") or {}
    bank = " · ".join(x for x in (slip.get("bank_name"), f"Ag. {slip['bank_agency']}" if slip.get("bank_agency") else None,
                                  f"C/C {slip['bank_account']}" if slip.get("bank_account") else None,
                                  f"PIX {slip['pix_key']}" if slip.get("pix_key") else None) if x)
    parts.append(_pdf_info_grid([
        ("Funcionário", slip.get("person_name"), 3),
        ("CPF", slip.get("person_cpf")),
        ("Matrícula", slip.get("contract_number")),
        ("Admissão", fmt_date(slip.get("admission_date"))),
        ("Cargo", slip.get("position_name"), 2),
        ("Setor", slip.get("department")),
        ("CBO", slip.get("cbo")),
        ("Depósito", bank or "-", 2),
    ], width, cols=6, plain=True, tight=True))
    parts.append(Spacer(1, 5))

    cell = _pdf_cell_factory(styles, font_size=7.5)
    blank = cell("", markup="")
    data = [_pdf_header_cells(["Cód.", "Descrição", "Referência", "Vencimentos", "Descontos"], font_size=7.5, light=True)]
    for e in slip.get("events") or []:
        data.append([
            cell(e.get("number"), "center"), cell(e.get("label")), cell(e["reference"], "center") if e.get("reference") else blank,
            cell(_num(e["value"]), "right") if e["kind"] == "P" else blank,
            cell(_num(e["value"]), "right") if e["kind"] == "D" else blank,
        ])
    data.append([blank, cell("Totais", bold=True), blank, cell(_num(t.get("gross")), "right", bold=True),
                 cell(_num(t.get("deductions")), "right", bold=True)])
    data.append([blank, cell("", markup='<font size="9.5" color="black"><b>Valor líquido</b></font>'), blank,
                 cell("", "right", markup=f'<font size="9.5" color="black"><b>{_money(t.get("net"))}</b></font>'), blank])
    widths = [32, 230, 70, 80, 80]
    scale = width / sum(widths)
    table = Table(data, colWidths=[w * scale for w in widths], repeatRows=1)
    table.setStyle(TableStyle(_pdf_table_style(light_header=True, zebra=False, ruled_rows=(0, -2)) + PAYSLIP_ROW_STYLE))
    parts.append(table)
    parts.append(Spacer(1, 4))

    parts.append(_pdf_info_grid([
        ("Salário base", _money(slip.get("base_salary"))),
        ("Base INSS", _money(t.get("inss_base"))),
        ("Base FGTS", _money(t.get("fgts_base"))),
        ("FGTS do mês", _money(t.get("fgts"))),
        ("Base IRRF", _money(t.get("irrf_base"))),
        ("IRRF simplif." if t.get("irrf_simplified") else "Faixa IRRF", f"{_num(t.get('irrf_rate'))}%"),
        ("Dependentes IR", slip.get("irrf_dependents") or 0),
    ], width, cols=7, plain=True, tight=True))
    if slip.get("observations"):
        parts.append(Spacer(1, 4))
        parts.append(_pdf_note_box("Observações", slip["observations"], width))
    decl = ParagraphStyle("PayslipDecl", parent=styles["Normal"], fontSize=7.5, leading=9.5, textColor=_hex(BRAND_TEXT))
    parts.append(Spacer(1, 4))
    parts.append(Paragraph("Declaro ter recebido a importância líquida discriminada neste recibo.", decl))
    parts.append(_pdf_signatures([("Data", "____/____/________"), ("Assinatura do funcionário", slip.get("person_name") or "")],
                                 width, space_above=14))
    return parts


def generate_payslips_pdf(slips: list, runs: dict, company: dict) -> bytes:
    """Uma via por funcionário e dois funcionários por folha (economia de
    papel), separados por linha de corte. O funcionário assina e a empresa guarda.
    Nenhuma via é encolhida, para todas saírem com a mesma largura e a mesma
    letra: quem não cabe em meia folha usa a folha inteira."""
    buffer = io.BytesIO()
    doc = _doc(buffer, top=8)
    logo = download_logo(company)
    width = doc.width - 12  # área útil real: o quadro do ReportLab tem 6pt de cada lado
    half = (doc.height - 12 - 12) / 2
    elements, half_used = [], False
    for slip in slips:
        if logo:
            logo.seek(0)
        block = _payslip_via(slip, runs.get(slip["run_id"], {}), company, logo, width)
        height = sum(part.wrap(width, half)[1] for part in block)
        if height > half:
            if half_used:
                elements.append(PageBreak())
            elements.extend(block)
            elements.append(PageBreak())
            half_used = False
        elif half_used:
            elements.extend([Spacer(1, 4), HRFlowable(width="100%", thickness=0.6, color=_hex(BRAND_MUTED), dash=(3, 3)), Spacer(1, 4)])
            elements.extend(block)
            elements.append(PageBreak())
            half_used = False
        else:
            elements.extend(block)
            elements.append(Spacer(1, half - height))  # a segunda via começa sempre na mesma altura
            half_used = True
    if isinstance(elements[-1], PageBreak):
        elements.pop()
    _build(doc, elements, company)
    return buffer.getvalue()


# ---------------------------------------------------------------- Conferência da folha

def _table(rows, widths, width, total_row=False):
    scale = width / sum(widths)
    table = Table(rows, colWidths=[w * scale for w in widths], repeatRows=1)
    table.setStyle(TableStyle(_pdf_table_style(total_row=total_row, light_header=True, zebra=False, ruled_rows=(0, -1))))
    return table


def _variation_cell(cell, text):
    """Destaca a variação do líquido a partir de 20%, o mesmo corte das pendências da tela."""
    if text == "-" or abs(float(text.rstrip("%").replace(",", "."))) < 20:
        return cell(text, "center")
    return cell(text, "center", markup=_pdf_tone_markup(text, "amber"))


def generate_payroll_check_pdf(run: dict, status_label: str, data: dict, company: dict, user_name: str) -> bytes:
    """Conferência da folha para arquivo e assinatura: indicadores, funcionários,
    contratos fora da folha (só quando há), detalhamento por funcionário e, por
    último, o resumo por rubrica fechando no líquido. As pendências ficam na tela e no Excel."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), rightMargin=12 * mm, leftMargin=12 * mm, topMargin=10 * mm, bottomMargin=14 * mm)
    width = doc.width
    styles = getSampleStyleSheet()
    cell = _pdf_cell_factory(styles, font_size=7.5)
    totals = run.get("totals") or {}
    blank = cell("", markup="")
    info = f"{RUN_TYPES.get(run['run_type'], run['run_type'])} · {competence_label(run['competence'])} · {status_label}"
    if data.get("previous_competence"):
        info += f" · Variação sobre {competence_label(data['previous_competence'])}"

    elements = list(_build_pdf_header(styles, download_logo(company), "Conferência da Folha de Pagamento",
                                      generation_info=info, company=company, content_width=width))
    elements.extend(_build_pdf_summary([
        ("Contracheques", len(data["people"])), ("Total de proventos", _money(totals.get("gross"))),
        ("Total de descontos", _money(totals.get("deductions"))), ("Líquido a pagar", _money(totals.get("net"))),
        ("FGTS do mês", _money(totals.get("fgts"))),
    ], width, boxed=True))

    elements.extend(_pdf_section_title("Funcionários", width))
    if data["people"]:
        rows = [_pdf_header_cells(["Mat.", "Funcionário", "Cargo", "Dias" if data["monthly"] else "Avos", "Salário base", "Proventos",
                                   "Descontos", "Líquido", "INSS", "IRRF", "FGTS", "Var. líquido"], font_size=7.5, light=True)]
        for r in data["people"]:
            qty = r[3]
            rows.append([cell(r[0], "center"), cell(r[1]), cell(r[2]), cell("-" if qty is None else f"{qty:g}".replace(".", ","), "center"),
                         *[cell(_money(v), "right") for v in r[4:7]], cell(_money(r[7]), "right", bold=True),
                         *[cell(_money(v), "right") for v in r[8:11]], _variation_cell(cell, r[11])])
        t = data["people_total"]
        rows.append([cell("Total", bold=True), blank, blank, blank, *[cell(_money(v), "right", bold=True) for v in t[4:11]], blank])
        elements.append(_table(rows, [6, 28, 19, 6, 13, 13, 13, 13, 11, 11, 11, 9], width, total_row=True))
    else:
        elements.append(_pdf_empty_state("Nenhum contracheque nesta folha.", width))

    if data["left_out"]:
        elements.extend([CondPageBreak(70)] + _pdf_section_title("Contratos vigentes fora desta folha", width))
        rows = [_pdf_header_cells(["Mat.", "Funcionário", "Cargo", "Motivo"], font_size=7.5, light=True)]
        rows += [[cell(r[0], "center"), cell(r[1]), cell(r[2]), cell(r[3])] for r in data["left_out"]]
        elements.append(_table(rows, [6, 30, 22, 50], width))

    if data["detail"].rows:
        elements.extend([CondPageBreak(130)] + _pdf_section_title("Detalhamento por funcionário", width))
        elements.extend(KeepTogether([_pdf_block(b, data["detail"].block_columns, width, cell, light=True), Spacer(1, 8)]) for b in data["detail"].blocks)

    elements.extend([CondPageBreak(110)] + _pdf_section_title("Resumo por rubrica", width))
    if data["rubrics"]:
        rows = [_pdf_header_cells(["Cód.", "Rubrica", "Funcionários", "Proventos", "Descontos"], font_size=7.5, light=True)]
        for r in data["rubrics"]:
            value = _money(round(r["total"], 2))
            rows.append([cell(r["number"], "center"), cell(r["label"]), cell(r["people"], "center"),
                         cell(value, "right") if r["kind"] == "P" else blank, cell(value, "right") if r["kind"] == "D" else blank])
        rows.append([blank, cell("Total", bold=True), blank, cell(_money(totals.get("gross")), "right", bold=True),
                     cell(_money(totals.get("deductions")), "right", bold=True)])
        elements.append(_table(rows, [6, 44, 10, 16, 16], width, total_row=True))
    else:
        elements.append(_pdf_empty_state("Nenhuma rubrica.", width))

    elements.append(KeepTogether([
        Spacer(1, 6), _pdf_totals_box([("Líquido a pagar", _money(totals.get("net")))], width, width=230, light=True),
        _pdf_signatures([("Elaborado por", user_name), ("Conferido por", "Nome e data"), ("Aprovado por", "Nome e data")], width, space_above=28),
    ]))
    _build(doc, elements, company)
    return buffer.getvalue()


# ---------------------------------------------------------------- Férias

def generate_vacation_notice_pdf(vacation: dict, company: dict) -> bytes:
    """Aviso de férias (CLT art. 135: com 30 dias de antecedência)."""
    buffer = io.BytesIO()
    doc = _doc(buffer)
    styles = getSampleStyleSheet()
    elements = list(_build_pdf_header(styles, download_logo(company), "Aviso de Férias", company=company, content_width=doc.width))
    elements.append(_pdf_info_grid([
        ("Funcionário", vacation.get("person_name"), 2), ("CPF", vacation.get("person_cpf")), ("Cargo", vacation.get("position_name")),
        ("Período aquisitivo", f"{fmt_date(vacation.get('acquisition_start'))} a {fmt_date(vacation.get('acquisition_end'))}", 2),
        ("Gozo", f"{fmt_date(vacation.get('start_date'))} a {fmt_date(vacation.get('end_date'))}", 2),
        ("Dias de férias", vacation.get("days")), ("Abono pecuniário", f"{vacation.get('sell_days') or 0} dias"),
        ("Retorno ao trabalho", fmt_date(vacation.get("return_date"))), ("Pagamento até", fmt_date(vacation.get("payment_date"))),
    ], doc.width, cols=4))
    elements.append(Spacer(1, 16))
    text = (
        f"Comunicamos que, de acordo com o art. 135 da CLT, suas férias relativas ao período aquisitivo de "
        f"<b>{fmt_date(vacation.get('acquisition_start'))}</b> a <b>{fmt_date(vacation.get('acquisition_end'))}</b> "
        f"serão concedidas de <b>{fmt_date(vacation.get('start_date'))}</b> a <b>{fmt_date(vacation.get('end_date'))}</b> "
        f"({vacation.get('days')} dias), devendo retornar ao trabalho em <b>{fmt_date(vacation.get('return_date'))}</b>."
    )
    if vacation.get("sell_days"):
        text += f" Conforme sua solicitação, {vacation['sell_days']} dia(s) serão convertidos em abono pecuniário (art. 143 da CLT)."
    if vacation.get("advance_13th"):
        text += " Junto com as férias será paga a 1ª parcela do 13º salário."
    elements.append(Paragraph(text, _paragraph_style(styles, 10, 15)))
    elements.append(Spacer(1, 10))
    elements.append(Paragraph(f"{xml_escape(company.get('address') or '')}, {fmt_date(vacation.get('notice_date'))}.", _paragraph_style(styles, 9.5)))
    elements.append(_pdf_signatures([("Empresa", company["name"]), ("Ciente do funcionário", vacation.get("person_name") or "")],
                                    doc.width, space_above=50))
    _build(doc, elements, company)
    return buffer.getvalue()


def generate_vacation_receipt_pdf(vacation: dict, company: dict) -> bytes:
    buffer = io.BytesIO()
    doc = _doc(buffer)
    styles = getSampleStyleSheet()
    calc = vacation.get("calc") or {}
    elements = list(_build_pdf_header(styles, download_logo(company), "Recibo de Férias",
                                      generation_info=f"Nº {vacation.get('vacation_number')}", company=company, content_width=doc.width))
    elements.append(_pdf_info_grid([
        ("Funcionário", vacation.get("person_name"), 2), ("CPF", vacation.get("person_cpf")), ("Cargo", vacation.get("position_name")),
        ("Período aquisitivo", f"{fmt_date(vacation.get('acquisition_start'))} a {fmt_date(vacation.get('acquisition_end'))}", 2),
        ("Gozo", f"{fmt_date(vacation.get('start_date'))} a {fmt_date(vacation.get('end_date'))}", 2),
        ("Remuneração base", _money(calc.get("monthly_base"))), ("Dias", vacation.get("days")),
        ("Retorno", fmt_date(vacation.get("return_date"))), ("Pagamento", fmt_date(vacation.get("paid_at") or vacation.get("payment_date"))),
    ], doc.width, cols=4))
    elements.append(Spacer(1, 10))
    cell = _pdf_cell_factory(styles, font_size=8.5)
    data = [_pdf_header_cells(["Descrição", "Vencimentos", "Descontos"], font_size=8.5)]
    for item in calc.get("items") or []:
        data.append([cell(item["label"]), cell(_money(item["value"]) if item["kind"] == "P" else "", "right"),
                     cell(_money(item["value"]) if item["kind"] == "D" else "", "right")])
    data.append([cell("Totais", bold=True), cell(_money(calc.get("gross")), "right", bold=True), cell(_money(calc.get("deductions")), "right", bold=True)])
    widths = [300, 110, 110]
    scale = doc.width / sum(widths)
    table = Table(data, colWidths=[w * scale for w in widths])
    table.setStyle(TableStyle(_pdf_table_style(total_row=True) + [("FONTSIZE", (0, 0), (-1, -1), 8.5)]))
    elements.append(table)
    elements.append(Spacer(1, 8))
    elements.append(_pdf_totals_box([("FGTS (informativo)", _money(calc.get("fgts"))), ("Valor líquido", _money(calc.get("net")))], doc.width))
    elements.append(Spacer(1, 14))
    elements.append(Paragraph(
        f"Recebi de <b>{xml_escape(company['name'])}</b> a importância líquida de <b>{_money(calc.get('net'))}</b>, referente às "
        f"férias acima discriminadas, dando plena quitação.", _paragraph_style(styles, 10, 15)))
    elements.append(_pdf_signatures([("Empresa", company["name"]), ("Funcionário", vacation.get("person_name") or "")], doc.width, space_above=46))
    _build(doc, elements, company)
    return buffer.getvalue()


# ---------------------------------------------------------------- Rescisão

def generate_termination_pdf(contract: dict, termination: dict, company: dict) -> bytes:
    buffer = io.BytesIO()
    doc = _doc(buffer)
    styles = getSampleStyleSheet()
    calc = termination.get("calc") or {}
    elements = list(_build_pdf_header(styles, download_logo(company), "Demonstrativo de Rescisão",
                                      generation_info="Simulação para conferência - não substitui o TRCT oficial",
                                      company=company, content_width=doc.width))
    elements.append(_pdf_info_grid([
        ("Funcionário", contract.get("person_name"), 2), ("CPF", contract.get("person_cpf")), ("Matrícula", contract.get("contract_number")),
        ("Cargo", contract.get("position_name")), ("Tipo de contrato", CONTRACT_TYPES.get(contract.get("contract_type"))),
        ("Admissão", fmt_date(contract.get("admission_date"))), ("Desligamento", fmt_date(termination.get("termination_date"))),
        ("Motivo", termination.get("termination_label"), 2), ("Aviso prévio", termination.get("notice_label")),
        ("Projeção do aviso", fmt_date(calc.get("projected_end"))),
        ("Remuneração base", _money(calc.get("monthly_base"))), ("Dias de aviso", calc.get("notice_days")),
    ], doc.width, cols=4))
    elements.extend(_pdf_section_title("Verbas rescisórias", doc.width))
    cell = _pdf_cell_factory(styles, font_size=8.5)
    data = [_pdf_header_cells(["Descrição", "Referência", "Vencimentos", "Descontos"], font_size=8.5)]
    for item in calc.get("items") or []:
        data.append([cell(item["label"]), cell(item.get("reference") or "", "center"),
                     cell(_money(item["value"]) if item["kind"] == "P" else "", "right"),
                     cell(_money(item["value"]) if item["kind"] == "D" else "", "right")])
    data.append([cell("Totais", bold=True), cell(""), cell(_money(calc.get("gross")), "right", bold=True),
                 cell(_money(calc.get("deductions")), "right", bold=True)])
    widths = [250, 80, 95, 95]
    scale = doc.width / sum(widths)
    table = Table(data, colWidths=[w * scale for w in widths])
    table.setStyle(TableStyle(_pdf_table_style(total_row=True) + [("FONTSIZE", (0, 0), (-1, -1), 8.5)]))
    elements.append(table)
    elements.append(Spacer(1, 8))
    elements.append(_pdf_totals_box([("Valor líquido", _money(calc.get("net")))], doc.width))
    elements.extend(_pdf_section_title("FGTS", doc.width))
    elements.append(_pdf_info_grid([
        ("Depósito do mês da rescisão", _money(calc.get("fgts_month"))),
        ("Saldo considerado", _money(calc.get("fgts_balance")) + ("" if termination.get("fgts_balance_informed") else " (estimado)")),
        (f"Multa rescisória ({calc.get('fgts_fine_rate') or 0}%)", _money(calc.get("fgts_fine"))),
        ("Saque", calc.get("fgts_withdraw")),
    ], doc.width, cols=4))
    if termination.get("reason"):
        elements.append(Spacer(1, 8))
        elements.append(_pdf_note_box("Observações", termination["reason"], doc.width))
    elements.append(Spacer(1, 8))
    elements.append(Paragraph(
        "Cálculo de conferência feito pelo sistema com o salário e os adicionais fixos do contrato. Médias de horas extras, "
        "comissões e outras verbas variáveis, multa do art. 477/479 e descontos específicos devem ser conferidos pela contabilidade.",
        ParagraphStyle("HRNote", parent=styles["Normal"], fontSize=7.5, leading=10, textColor=_hex(BRAND_MUTED))))
    elements.append(_pdf_signatures([("Empresa", company["name"]), ("Funcionário", contract.get("person_name") or "")], doc.width, space_above=46))
    _build(doc, elements, company)
    return buffer.getvalue()


# ---------------------------------------------------------------- Advertência / suspensão

def generate_occurrence_term_pdf(occ: dict, company: dict) -> bytes:
    buffer = io.BytesIO()
    doc = _doc(buffer)
    styles = getSampleStyleSheet()
    suspension = occ["occurrence_type"] == "SUSPENSAO"
    title = "Termo de Suspensão Disciplinar" if suspension else "Termo de Advertência"
    elements = list(_build_pdf_header(styles, download_logo(company), title, generation_info=f"Nº {occ.get('occurrence_number')}",
                                      company=company, content_width=doc.width))
    elements.append(_pdf_info_grid([
        ("Funcionário", occ.get("person_name"), 2), ("CPF", occ.get("person_cpf")), ("Cargo", occ.get("position_name")),
        ("Data", fmt_date(occ.get("start_date"))), ("Setor", occ.get("department")),
        ("Dias de suspensão" if suspension else "Tipo", f"{occ.get('days') or 0} dia(s)" if suspension else "Advertência por escrito", 2),
    ], doc.width, cols=4))
    elements.append(Spacer(1, 14))
    if suspension:
        period = f" de {fmt_date(occ.get('start_date'))} a {fmt_date(occ.get('end_date'))}" if occ.get("end_date") else ""
        text = (f"Pelo presente, fica V.Sa. <b>suspenso(a)</b> de suas atividades por <b>{occ.get('days') or 0} dia(s)</b>{period}, "
                "pelo motivo descrito abaixo, devendo retornar ao trabalho ao fim do período. Os dias de suspensão serão descontados "
                "da remuneração. A reincidência poderá acarretar a rescisão do contrato por justa causa (art. 482 da CLT).")
    else:
        text = ("Pelo presente, fica V.Sa. <b>advertido(a)</b> pelo motivo descrito abaixo, para que fatos como este não se repitam. "
                "A reincidência poderá acarretar penalidades mais severas, conforme a legislação trabalhista.")
    elements.append(Paragraph(text, _paragraph_style(styles, 10, 15)))
    elements.append(Spacer(1, 10))
    elements.append(_pdf_note_box("Motivo", occ.get("description") or "-", doc.width))
    elements.append(_pdf_signatures([("Empresa", company["name"]), ("Ciente do funcionário", occ.get("person_name") or "")],
                                    doc.width, space_above=50))
    elements.append(_pdf_signatures([("Testemunha 1", "Nome / CPF"), ("Testemunha 2", "Nome / CPF")], doc.width, space_above=40))
    _build(doc, elements, company)
    return buffer.getvalue()


# ---------------------------------------------------------------- Contrato de trabalho

# Tipos com modelo de contrato (aprendiz, temporário, estágio e PJ têm
# requisitos próprios - programa de aprendizagem, agência, instituição de ensino)
WORK_CONTRACT_TYPES = {"CLT", "EXPERIENCIA"}


def _person_address(person: dict) -> str:
    addr = person.get("address_details") or {}
    return ", ".join(x for x in (addr.get("street"), addr.get("number"), addr.get("neighborhood"), addr.get("city"), addr.get("state"), addr.get("zip")) if x)


def _long_date(value) -> str:
    from datetime import date
    day = value if isinstance(value, date) else date.fromisoformat(str(value)[:10])
    return f"{day.day} de {MONTHS[day.month - 1]} de {day.year}"


def generate_work_contract_pdf(contract: dict, person: dict, company: dict) -> bytes:
    """Contrato individual de trabalho (CLT), por prazo indeterminado ou de
    experiência - com o termo de prorrogação quando a experiência é menor que 90 dias."""
    from datetime import date, timedelta

    buffer = io.BytesIO()
    doc = _doc(buffer)
    styles = getSampleStyleSheet()
    text_style = _paragraph_style(styles, 9.5, 14)
    text_style.alignment = 4  # justificado
    clause_title = ParagraphStyle("HRClause", parent=text_style, fontName="Helvetica-Bold", spaceBefore=6, spaceAfter=2)

    def esc(value) -> str:
        return xml_escape(str(value)) if value not in (None, "") else "-"

    # prazo inicial da experiência; com prorrogação registrada, o total vai no termo
    total_days = int(contract.get("experience_days") or 0)
    experience_days = int(contract.get("experience_initial_days") or total_days)
    extended = total_days > experience_days
    is_experience = contract.get("contract_type") == "EXPERIENCIA" or experience_days > 0
    title = "Contrato de Trabalho a Título de Experiência" if is_experience else "Contrato Individual de Trabalho"
    driver = contract.get("person_type") == "MOTORISTA"
    admission = date.fromisoformat(contract["admission_date"][:10])

    elements = list(_build_pdf_header(styles, download_logo(company), title,
                                      generation_info=f"Matrícula {contract.get('contract_number')}", company=company, content_width=doc.width))
    elements.extend(_pdf_section_title("Empregadora", doc.width))
    elements.append(_pdf_info_grid([
        ("Razão social", company.get("name"), 2), ("CNPJ", company.get("cnpj"), 2), ("Endereço", company.get("address"), 4),
    ], doc.width, cols=4))
    elements.extend(_pdf_section_title("Empregado(a)", doc.width))
    elements.append(_pdf_info_grid([
        ("Nome", contract.get("person_name"), 2), ("CPF", contract.get("person_cpf")), ("RG", person.get("rg")),
        ("Nascimento", fmt_date(person.get("birth_date"))), ("Nacionalidade", person.get("nationality")),
        ("Estado civil", person.get("marital_status")), ("PIS", contract.get("pis")),
        ("CTPS", contract.get("ctps_number")), ("Série", contract.get("ctps_series")),
        ("Endereço", _person_address(person) or "-", 2),
    ], doc.width, cols=4))
    elements.append(Spacer(1, 8))
    elements.append(Paragraph(
        "As partes acima identificadas celebram o presente contrato individual de trabalho, regido pela Consolidação das "
        "Leis do Trabalho (CLT) e pelas cláusulas a seguir:", text_style))

    position = esc(contract.get("position_name"))
    if contract.get("cbo"):
        position += f" (CBO {esc(contract['cbo'])})"
    if contract.get("department"):
        position += f", no setor {esc(contract['department'])}"
    schedule = f"{_num(contract.get('weekly_hours') or 44).replace(',00', '')} horas semanais"
    if contract.get("work_schedule"):
        schedule += f", no horário {esc(contract['work_schedule'])}"
    extras = []
    if contract.get("insalubridade_grade"):
        extras.append(f"adicional de insalubridade de {_num(contract['insalubridade_grade']).replace(',00', '')}% sobre o salário mínimo (art. 192 da CLT)")
    if contract.get("periculosidade"):
        extras.append("adicional de periculosidade de 30% sobre o salário-base (art. 193 da CLT)")

    clauses = [
        ("Função", f"O(A) EMPREGADO(A) é admitido(a) para exercer a função de <b>{position}</b>, obrigando-se a executar "
                   "também as tarefas compatíveis com a sua condição pessoal que lhe forem atribuídas (art. 456, parágrafo único, da CLT)."),
        ("Remuneração", f"O(A) EMPREGADO(A) receberá o salário mensal de <b>{_money(contract.get('base_salary'))}</b>, pago até o "
                        "5º (quinto) dia útil do mês seguinte ao vencido (art. 459, § 1º, da CLT)"
                        + (", além de " + " e ".join(extras) if extras else "") + "."),
        ("Jornada de trabalho", f"A jornada será de <b>{schedule}</b>, com intervalo para repouso e alimentação na forma do art. 71 da CLT. "
                                "A jornada poderá ser prorrogada ou compensada nos termos da lei e de acordo individual ou coletivo, "
                                "inclusive por banco de horas, sendo as horas extras não compensadas pagas com o adicional legal."
                                + (" Por se tratar de motorista profissional, aplicam-se os arts. 235-A a 235-G da CLT (Lei 13.103/2015), "
                                   "com o controle da jornada e dos tempos de direção e de descanso." if driver else "")),
        ("Local de trabalho", f"O trabalho será prestado no estabelecimento da EMPREGADORA ({esc(company.get('address'))})"
                              + (" e nas rotas e locais em que for necessária a prestação do serviço" if driver else "")
                              + ", podendo o(a) EMPREGADO(A) ser transferido(a) nas hipóteses do art. 469 da CLT."),
    ]
    if is_experience:
        end = admission + timedelta(days=experience_days - 1)
        text = (f"Este contrato é celebrado a título de experiência, pelo prazo de <b>{experience_days} dias</b>, de "
                f"<b>{fmt_date(admission.isoformat())}</b> a <b>{fmt_date(end.isoformat())}</b> (art. 443, § 2º, \"c\", da CLT)")
        if experience_days < 90:
            text += (f", podendo ser prorrogado uma única vez por até {90 - experience_days} dias, sem ultrapassar o total de 90 dias "
                     "(arts. 445, parágrafo único, e 451 da CLT)")
        text += (". Continuando a prestação de serviços após o término do prazo, o contrato passará a vigorar por prazo indeterminado. "
                 "A rescisão antecipada sem justa causa obriga a parte que lhe der causa à indenização dos arts. 479 e 480 da CLT.")
        clauses.append(("Prazo", text))
    else:
        clauses.append(("Prazo", f"Este contrato vigora por prazo indeterminado a partir de <b>{fmt_date(admission.isoformat())}</b>, "
                                 "e sua rescisão observará o aviso prévio e as demais regras da legislação."))
    discount = ("Além dos descontos previstos em lei, o(a) EMPREGADO(A) autoriza o desconto dos danos que causar à EMPREGADORA, "
                "em caso de dolo ou culpa, valendo esta cláusula como o acordo previsto no art. 462, § 1º, da CLT")
    if contract.get("vt_opt_in"):
        discount += ", e o desconto de até 6% do salário-base referente ao vale-transporte (Lei 7.418/1985)"
    clauses += [
        ("Descontos", discount + "."),
        ("Normas da empresa e segurança", "O(A) EMPREGADO(A) obriga-se a cumprir o regulamento interno, as ordens de serviço e as normas de "
                                          "segurança e medicina do trabalho, inclusive o uso dos equipamentos de proteção individual fornecidos "
                                          "(art. 158 da CLT), e a manter sigilo sobre as informações da EMPREGADORA e de seus clientes."),
        ("Dados pessoais", "A EMPREGADORA tratará os dados pessoais do(a) EMPREGADO(A) e de seus dependentes para a execução deste contrato e "
                           "o cumprimento das obrigações legais (Lei 13.709/2018, art. 7º, II e V)."),
    ]
    if contract.get("observations"):
        clauses.append(("Disposições adicionais", esc(contract["observations"])))
    for i, (name, text) in enumerate(clauses, 1):
        elements.append(KeepTogether([Paragraph(f"Cláusula {i}ª - {name}", clause_title), Paragraph(text, text_style)]))

    elements.append(Spacer(1, 8))
    elements.append(Paragraph("E, por estarem de acordo, as partes assinam este contrato em 2 (duas) vias de igual teor, "
                              "na presença das testemunhas abaixo.", text_style))
    elements.append(Spacer(1, 6))
    elements.append(Paragraph(f"{esc(company.get('address'))}, {_long_date(admission)}.", _paragraph_style(styles, 9.5)))
    elements.append(_pdf_signatures([("Empregadora", company["name"]), ("Empregado(a)", contract.get("person_name") or "")],
                                    doc.width, space_above=44))
    elements.append(_pdf_signatures([("Testemunha 1", "Nome / CPF"), ("Testemunha 2", "Nome / CPF")], doc.width, space_above=36))

    if is_experience and experience_days < 90:
        first_end = admission + timedelta(days=experience_days - 1)
        final_end = admission + timedelta(days=(total_days if extended else 90) - 1)
        elements.append(PageBreak())
        elements.extend(_build_pdf_header(styles, download_logo(company), "Termo de Prorrogação do Contrato de Experiência",
                                          generation_info=f"Matrícula {contract.get('contract_number')}", company=company, content_width=doc.width))
        elements.append(Spacer(1, 10))
        elements.append(Paragraph(
            f"Por mútuo acordo, o contrato de experiência celebrado em <b>{fmt_date(admission.isoformat())}</b> entre "
            f"<b>{esc(company.get('name'))}</b> e <b>{esc(contract.get('person_name'))}</b>, CPF {esc(contract.get('person_cpf'))}, "
            f"com término previsto para <b>{fmt_date(first_end.isoformat())}</b>, fica prorrogado por mais "
            f"<b>{(final_end - first_end).days} dias</b>, de <b>{fmt_date((first_end + timedelta(days=1)).isoformat())}</b> a "
            f"<b>{fmt_date(final_end.isoformat())}</b>, mantidas as demais cláusulas (arts. 445, parágrafo único, e 451 da CLT).",
            text_style))
        elements.append(Spacer(1, 10))
        signed = (f"{esc(company.get('address'))}, {_long_date(contract['experience_extended_at'][:10])}." if extended
                  and contract.get("experience_extended_at") else f"{esc(company.get('address'))}, ____ de ______________ de ______.")
        elements.append(Paragraph(signed, _paragraph_style(styles, 9.5)))
        elements.append(_pdf_signatures([("Empregadora", company["name"]), ("Empregado(a)", contract.get("person_name") or "")],
                                        doc.width, space_above=44))
        elements.append(_pdf_signatures([("Testemunha 1", "Nome / CPF"), ("Testemunha 2", "Nome / CPF")], doc.width, space_above=36))
    _build(doc, elements, company)
    return buffer.getvalue()


# ---------------------------------------------------------------- Ficha do funcionário

def generate_employee_sheet_pdf(contract: dict, person: dict, company: dict) -> bytes:
    buffer = io.BytesIO()
    doc = _doc(buffer)
    styles = getSampleStyleSheet()
    address = _person_address(person)
    elements = list(_build_pdf_header(styles, download_logo(company), "Ficha de Registro do Empregado",
                                      generation_info=f"Matrícula {contract.get('contract_number')}", company=company, content_width=doc.width))
    elements.extend(_pdf_section_title("Dados pessoais", doc.width))
    elements.append(_pdf_info_grid([
        ("Nome", contract.get("person_name"), 2), ("CPF", contract.get("person_cpf")), ("RG", person.get("rg")),
        ("Nascimento", fmt_date(person.get("birth_date"))), ("Telefone", person.get("phone")), ("E-mail", person.get("email"), 2),
        ("Endereço", address or "-", 4),
        ("PIS", contract.get("pis")), ("CTPS", contract.get("ctps_number")), ("Série", contract.get("ctps_series")),
        ("CNH", person.get("cnh_number")),
    ], doc.width, cols=4))
    elements.extend(_pdf_section_title("Contrato", doc.width))
    extra = []
    if contract.get("insalubridade_grade"):
        extra.append(f"Insalubridade {contract['insalubridade_grade']}%")
    if contract.get("periculosidade"):
        extra.append("Periculosidade 30%")
    if contract.get("vt_opt_in"):
        extra.append("Vale-transporte")
    elements.append(_pdf_info_grid([
        ("Cargo", contract.get("position_name"), 2), ("CBO", contract.get("cbo")), ("Setor", contract.get("department")),
        ("Tipo", CONTRACT_TYPES.get(contract.get("contract_type"))), ("Admissão", fmt_date(contract.get("admission_date"))),
        ("Experiência até", fmt_date(contract.get("experience_end")) if contract.get("experience_end") else "-"),
        ("Salário", _money(contract.get("base_salary"))),
        ("Jornada", contract.get("work_schedule") or (f"{contract.get('weekly_hours')}h semanais" if contract.get("weekly_hours") else "-"), 2),
        ("Adicionais / benefícios", ", ".join(extra) or "-", 2),
        ("Banco", " · ".join(x for x in (contract.get("bank_name"), contract.get("bank_agency"), contract.get("bank_account")) if x) or "-", 2),
        ("PIX", contract.get("pix_key"), 2),
    ], doc.width, cols=4))
    deps = contract.get("dependents") or []
    elements.extend(_pdf_section_title("Dependentes", doc.width))
    cell = _pdf_cell_factory(styles, font_size=8)
    data = [_pdf_header_cells(["Nome", "Parentesco", "Nascimento", "CPF", "IRRF", "Sal.-família"], font_size=8)]
    for d in deps:
        data.append([cell(d.get("name")), cell(d.get("relationship")), cell(fmt_date(d.get("birth_date")), "center"), cell(d.get("cpf"), "center"),
                     cell("Sim" if d.get("irrf") else "Não", "center"), cell("Sim" if d.get("family_allowance") else "Não", "center")])
    if not deps:
        data.append([cell("Nenhum dependente cadastrado"), "", "", "", "", ""])
    widths = [180, 80, 70, 90, 45, 60]
    scale = doc.width / sum(widths)
    table = Table(data, colWidths=[w * scale for w in widths])
    table.setStyle(TableStyle(_pdf_table_style() + [("FONTSIZE", (0, 0), (-1, -1), 8)]))
    elements.append(table)
    term = contract.get("termination")
    if term:
        elements.extend(_pdf_section_title("Desligamento", doc.width))
        elements.append(_pdf_info_grid([
            ("Data", fmt_date(term.get("termination_date"))), ("Motivo", term.get("termination_label"), 2),
            ("Aviso prévio", term.get("notice_label")),
        ], doc.width, cols=4))
    if contract.get("observations"):
        elements.append(Spacer(1, 8))
        elements.append(_pdf_note_box("Observações", contract["observations"], doc.width))
    elements.append(_pdf_signatures([("Empresa", company["name"]), ("Empregado", contract.get("person_name") or "")], doc.width, space_above=46))
    _build(doc, elements, company)
    return buffer.getvalue()
