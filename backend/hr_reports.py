"""RH - documentos em PDF: contracheque (2 vias por página), aviso e recibo
de férias, simulação da rescisão, termo de advertência/suspensão e ficha
do funcionário. Mesma identidade visual dos outros documentos (reports.py)."""
import io
from xml.sax.saxutils import escape as xml_escape

from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import KeepInFrame, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.platypus.flowables import HRFlowable

from hr_payroll import CONTRACT_TYPES, RUN_TYPES
from reports import (
    BRAND_MUTED, BRAND_TEXT, _build_pdf_header, _hex, _make_pdf_footer,
    _pdf_cell_factory, _pdf_header_cells, _pdf_info_grid, _pdf_note_box, _pdf_section_title, _pdf_signatures,
    _pdf_table_style, _pdf_totals_box, download_logo, fmt_date, format_currency,
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

def _payslip_via(slip: dict, run: dict, company: dict, logo, width: float, via_label: str):
    styles = getSampleStyleSheet()
    title = "Recibo de Pagamento de Salário" if slip.get("run_type") == "MENSAL" else "Recibo de 13º Salário"
    info = f"{RUN_TYPES.get(slip.get('run_type'), '')} · Competência {competence_label(slip['competence'])} · {via_label}"
    parts = list(_build_pdf_header(styles, logo, title, generation_info=info, company=company, content_width=width, compact=True))
    parts.append(_pdf_info_grid([
        ("Funcionário", slip.get("person_name"), 2),
        ("CPF", slip.get("person_cpf")),
        ("Matrícula", slip.get("contract_number")),
        ("Cargo", slip.get("position_name")),
        ("CBO", slip.get("cbo")),
        ("Setor", slip.get("department")),
        ("Admissão", fmt_date(slip.get("admission_date"))),
    ], width, cols=4))
    parts.append(Spacer(1, 5))

    cell = _pdf_cell_factory(styles, font_size=7.5)
    data = [_pdf_header_cells(["Cód.", "Descrição", "Referência", "Vencimentos", "Descontos"], font_size=7.5)]
    for e in slip.get("events") or []:
        data.append([
            cell(e.get("number"), "center"), cell(e.get("label")), cell(e.get("reference") or "", "center"),
            cell(_num(e["value"]) if e["kind"] == "P" else "", "right"),
            cell(_num(e["value"]) if e["kind"] == "D" else "", "right"),
        ])
    t = slip.get("totals") or {}
    data.append([cell(""), cell("Totais", bold=True), cell(""), cell(_num(t.get("gross")), "right", bold=True),
                 cell(_num(t.get("deductions")), "right", bold=True)])
    widths = [32, 230, 70, 80, 80]
    scale = width / sum(widths)
    table = Table(data, colWidths=[w * scale for w in widths], repeatRows=1)
    table.setStyle(TableStyle(_pdf_table_style(total_row=True) + [("FONTSIZE", (0, 0), (-1, -1), 7.5)]))
    parts.append(table)
    parts.append(Spacer(1, 4))

    bank = " · ".join(x for x in (slip.get("bank_name"), f"Ag. {slip['bank_agency']}" if slip.get("bank_agency") else None,
                                  f"C/C {slip['bank_account']}" if slip.get("bank_account") else None,
                                  f"PIX {slip['pix_key']}" if slip.get("pix_key") else None) if x)
    net_box = _pdf_totals_box([("Valor líquido", _money(t.get("net")))], width, width=200)
    bases = _pdf_info_grid([
        ("Salário base", _money(slip.get("base_salary"))),
        ("Base INSS", _money(t.get("inss_base"))),
        ("Base FGTS", _money(t.get("fgts_base"))),
        ("FGTS do mês", _money(t.get("fgts"))),
        ("Base IRRF", _money(t.get("irrf_base"))),
        ("Faixa IRRF", f"{_num(t.get('irrf_rate'))}%" + (" (simplificado)" if t.get("irrf_simplified") else "")),
        ("Dependentes IR", slip.get("irrf_dependents") or 0),
        ("Depósito", bank or "-"),
    ], width, cols=4)
    parts.append(net_box)
    parts.append(Spacer(1, 4))
    parts.append(bases)
    if slip.get("observations"):
        parts.append(Spacer(1, 4))
        parts.append(_pdf_note_box("Observações", slip["observations"], width))
    decl = ParagraphStyle("PayslipDecl", parent=styles["Normal"], fontSize=7.5, leading=9.5, textColor=_hex(BRAND_TEXT))
    parts.append(Spacer(1, 6))
    parts.append(Paragraph("Declaro ter recebido a importância líquida discriminada neste recibo.", decl))
    parts.append(_pdf_signatures([("Data", "____/____/________"), ("Assinatura do funcionário", slip.get("person_name") or "")],
                                 width, space_above=22))
    return parts


def generate_payslips_pdf(slips: list, runs: dict, company: dict) -> bytes:
    """Um contracheque por página, em 2 vias (empresa e funcionário) separadas por linha de corte."""
    buffer = io.BytesIO()
    doc = _doc(buffer, top=8)
    logo = download_logo(company)
    half = (doc.height - 14) / 2
    elements = []
    for i, slip in enumerate(slips):
        if i:
            elements.append(PageBreak())
        run = runs.get(slip["run_id"], {})
        for j, via in enumerate(("1ª via - empresa", "2ª via - funcionário")):
            if logo:
                logo.seek(0)
            block = _payslip_via(slip, run, company, logo, doc.width, via)
            elements.append(KeepInFrame(doc.width, half, block, mode="shrink"))
            if j == 0:
                elements.append(Spacer(1, 4))
                elements.append(HRFlowable(width="100%", thickness=0.6, color=_hex(BRAND_MUTED), dash=(3, 3)))
                elements.append(Spacer(1, 4))
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


# ---------------------------------------------------------------- Ficha do funcionário

def generate_employee_sheet_pdf(contract: dict, person: dict, company: dict) -> bytes:
    buffer = io.BytesIO()
    doc = _doc(buffer)
    styles = getSampleStyleSheet()
    addr = person.get("address_details") or {}
    address = ", ".join(x for x in (addr.get("street"), addr.get("number"), addr.get("neighborhood"), addr.get("city"), addr.get("state"), addr.get("zip")) if x)
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
