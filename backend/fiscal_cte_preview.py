"""Espelho do CT-e em PDF para conferência antes de transmitir: mesmos dados
que vão para a Sefaz, com a marca "SEM VALOR FISCAL" em todas as páginas.
O DACTE oficial só existe depois da autorização (vem da Focus NFe)."""
import io
from xml.sax.saxutils import escape as xml_escape

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_CENTER
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

import fiscal_cte
from reports import (
    _build_pdf_header, _hex, _make_pdf_footer, _pdf_cell_factory, _pdf_header_cells, _pdf_info_grid,
    _pdf_narrow_table, _pdf_note_box, _pdf_section_title, _pdf_totals_box, download_logo, format_currency, merge_company,
)

TOMADOR = {0: "Remetente", 1: "Expedidor", 2: "Recebedor", 3: "Destinatário", 4: "Outros"}
UNIDADES = {"00": "M3", "01": "KG", "02": "TON", "03": "UNIDADE", "04": "LITROS"}
STATUS = {"RASCUNHO": "Rascunho (não transmitido)", "REJEITADO": "Rejeitado", "ERRO": "Erro no envio",
          "PENDENTE": "Aguardando a Sefaz", "ENVIANDO": "Enviando", "AUTORIZADO": "Autorizado",
          "CANCELADO": "Cancelado", "DENEGADO": "Denegado"}
WARNING = "SEM VALOR FISCAL - ESPELHO PARA CONFERÊNCIA"


def _doc_fmt(value) -> str:
    d = fiscal_cte.only_digits(value)
    if len(d) == 14:
        return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"
    if len(d) == 11:
        return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}"
    return value or "-"


def _address(party: dict) -> str:
    e = (party or {}).get("endereco") or {}
    street = ", ".join(x for x in [e.get("logradouro"), e.get("numero")] if x)
    city = f"{e.get('cidade')}/{e.get('uf') or ''}" if e.get("cidade") else ""
    return " - ".join(x for x in [street, e.get("bairro"), city] if x) or "-"


def _num(value) -> str:
    """Quantidade em pt-BR sem zeros à toa (23.500,5)."""
    text = f"{float(value or 0):,.3f}".rstrip("0").rstrip(".")
    return text.replace(",", "X").replace(".", ",").replace("X", ".")


def _place(p: dict) -> str:
    return f"{p.get('cidade')}/{p.get('uf') or ''}" if (p or {}).get("cidade") else "-"


def _watermark(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica-Bold", 54)
    canvas.setFillColorRGB(0.86, 0.15, 0.15, alpha=0.10)
    canvas.translate(doc.pagesize[0] / 2, doc.pagesize[1] / 2)
    canvas.rotate(45)
    canvas.drawCentredString(0, 0, "SEM VALOR FISCAL")
    canvas.restoreState()


def generate_cte_preview_pdf(cte: dict, settings: dict, company: dict = None) -> bytes:
    c = merge_company(company)
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=10 * mm, leftMargin=10 * mm, topMargin=12 * mm, bottomMargin=15 * mm)
    width = doc.width
    styles = getSampleStyleSheet()
    cell = _pdf_cell_factory(styles)
    elements = []

    numero = f"CT-e nº {cte['numero']}" if cte.get("numero") else "Número definido na transmissão"
    elements.extend(_build_pdf_header(styles, download_logo(company), "Espelho do CT-e",
                                      generation_info=f"{numero} · conferência", company=company, content_width=width))

    banner_style = ParagraphStyle("CteBanner", fontName="Helvetica-Bold", fontSize=10, leading=13, alignment=TA_CENTER, textColor=_hex("B91C1C"))
    banner = Table([[Paragraph(xml_escape(WARNING), banner_style)],
                    [Paragraph("O DACTE oficial é gerado somente depois da autorização pela Sefaz.",
                               ParagraphStyle("CteBannerSub", parent=banner_style, fontName="Helvetica", fontSize=7.5, leading=9.5))]],
                   colWidths=[width])
    banner.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), _hex("FEF2F2")),
        ("BOX", (0, 0), (-1, -1), 0.8, _hex("FCA5A5")),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements += [banner, Spacer(1, 8)]

    ambiente = cte.get("ambiente") or settings.get("ambiente")
    papel = int(cte.get("tomador_papel") or 0)
    elements.append(_pdf_info_grid([
        ("Situação", STATUS.get(cte.get("status"), cte.get("status") or "-")),
        ("Ambiente", "Produção" if ambiente == "producao" else "Homologação"),
        ("CFOP", cte.get("cfop") or settings.get("cfop_padrao")),
        ("Tomador do serviço", TOMADOR.get(papel, "-")),
        ("Natureza da operação", cte.get("natureza_operacao") or settings.get("natureza_operacao"), 2),
        ("Início da prestação", _place(cte.get("origem"))),
        ("Fim da prestação", _place(cte.get("destino"))),
        *([("Chave de acesso", cte["chave"], 4)] if cte.get("chave") else []),
    ], width))

    elements.extend(_pdf_section_title("Envolvidos", width))
    parties = [("Remetente", cte.get("remetente")), ("Destinatário", cte.get("destinatario"))]
    if papel == 4:
        parties.append(("Tomador", cte.get("tomador")))
    rows = [_pdf_header_cells(["Papel", "Nome / Razão social", "CNPJ / CPF", "IE", "Endereço"])]
    for label, p in parties:
        p = p or {}
        rows.append([cell(label, bold=True), cell(p.get("nome")), cell(_doc_fmt(p.get("cnpj_cpf"))), cell(p.get("ie")), cell(_address(p))])
    elements.append(_pdf_narrow_table(rows, [width * x for x in (0.12, 0.27, 0.16, 0.11, 0.34)], width))

    elements.extend(_pdf_section_title("Motorista, veículo e seguro", width))
    motorista = cte.get("motorista") or {}
    placas = " / ".join(p.upper() for p in [cte.get("veiculo_placa"), *(cte.get("reboque_placas") or [])] if p)
    seguro = " - ".join(x for x in [cte.get("seguradora_nome"), cte.get("seguro_apolice") and f"Apólice {cte['seguro_apolice']}"] if x)
    elements.append(_pdf_info_grid([
        ("Motorista", motorista.get("nome") or "-", 2),
        ("CPF", _doc_fmt(motorista.get("cpf")) if motorista.get("cpf") else "-"),
        ("Placas", placas or "-"),
        ("Seguro", seguro or "-", 2),
        ("Averbação", cte.get("seguro_averbacao") or "-"),
        ("Responsável pelo seguro", {1: "Emitente", 2: "Contratante"}.get(cte.get("seguro_responsavel"), "-")),
    ], width))

    elements.extend(_pdf_section_title("Documentos transportados", width))
    rows = [_pdf_header_cells(["Tipo", "Chave de acesso / Descrição", "Número", "Valor"])]
    for d in cte.get("documentos") or []:
        if d.get("tipo") == "NFE":
            key = fiscal_cte.only_digits(d.get("chave"))
            rows.append([cell("NF-e"), cell(key), cell(str(int(key[25:34])) if len(key) == 44 else "-"), cell("-")])
        else:
            rows.append([cell("Outros"), cell(d.get("descricao")), cell(d.get("numero")),
                         cell(format_currency(d["valor"]) if d.get("valor") else "-", "right")])
    if len(rows) == 1:
        rows.append([cell("-"), cell("Nenhum documento informado"), cell("-"), cell("-")])
    elements.append(_pdf_narrow_table(rows, [width * x for x in (0.1, 0.6, 0.14, 0.16)], width))

    elements.extend(_pdf_section_title("Carga", width))
    quantidades = ", ".join(f"{q.get('tipo_medida')}: {_num(q.get('quantidade'))} {UNIDADES.get(q.get('unidade'), '')}"
                            for q in cte.get("quantidades") or [])
    containers = ", ".join(f"{x.get('numero')}" + (f" (lacre {x['lacre']})" if x.get("lacre") else "") for x in cte.get("containers") or [])
    elements.append(_pdf_info_grid([
        ("Produto predominante", cte.get("produto_predominante") or settings.get("produto_predominante") or "-", 2),
        ("Outras características", cte.get("outras_caracteristicas") or "-"),
        ("Valor da carga", format_currency(cte.get("valor_carga") or 0)),
        ("Quantidades", quantidades or "-", 2),
        ("Contêineres", containers or "-", 2),
    ], width))

    elements.extend(_pdf_section_title("Composição do frete e impostos", width))
    rows = [_pdf_header_cells(["Componente", "Valor"])]
    for comp in cte.get("componentes") or []:
        rows.append([cell(comp.get("nome")), cell(format_currency(comp.get("valor") or 0), "right")])
    if len(rows) > 1:
        elements.append(_pdf_narrow_table(rows, [width * 0.7, width * 0.3], width))
        elements.append(Spacer(1, 6))
    total = float(cte.get("valor_total") or 0)
    cst = cte.get("icms_cst") or settings.get("icms_cst") or "-"
    aliquota = cte.get("icms_aliquota") if cte.get("icms_aliquota") is not None else settings.get("icms_aliquota")
    totals = [("ICMS - CST", cst)]
    if cst in ("00", "60", "90") and aliquota:
        totals += [("Base de cálculo", format_currency(total)), (f"ICMS ({aliquota:g}%)".replace(".", ","), format_currency(round(total * float(aliquota) / 100, 2)))]
    receber = cte.get("valor_receber")
    totals += [("Valor a receber", format_currency(receber if receber is not None else total)), ("Total da prestação", format_currency(total))]
    elements.append(_pdf_totals_box(totals, width, width=260))

    obs = " | ".join(n for n in [fiscal_cte._text(cte.get("observacoes")), *fiscal_cte.trip_notes(cte)] if n)
    elements.append(KeepTogether([*_pdf_section_title("Observações (como vão no CT-e)", width),
                                  _pdf_note_box("Observações", obs or "-", width)]))

    footer = _make_pdf_footer(c["name"])

    def page(canvas, document):
        _watermark(canvas, document)
        footer(canvas, document)

    doc.build(elements, onFirstPage=page, onLaterPages=page)
    return buffer.getvalue()
