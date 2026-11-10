"""Espelho do CT-e em PDF para conferência antes de transmitir, no layout do
DACTE (Documento Auxiliar do CT-e) - quadros em caixa, como o DACTE oficial
que a Sefaz/Focus gera depois da autorização (modelo de referência: DACTE do
Bsoft em C:\\Projetos - Documentos). Mostra os mesmos dados que vão para a
Sefaz, com a marca "SEM VALOR FISCAL" e o aviso de espelho em todas as
partes. O DACTE oficial só existe depois da autorização (vem da Focus NFe).

Desenhado direto no canvas (posições fixas, uma página A4 em pé), porque o
DACTE é um formulário: cada informação tem o seu quadro."""
import io
from datetime import datetime
from xml.sax.saxutils import escape as xml_escape

from reportlab.graphics.barcode import code128
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import Paragraph

import fiscal_cte
from reports import BRT_TZ, download_logo, local_datetime, merge_company

TOMADOR = {0: "Remetente", 1: "Expedidor", 2: "Recebedor", 3: "Destinatário", 4: "Outros"}
UNIDADES = {"00": "M3", "01": "KG", "02": "TON", "03": "UN", "04": "LT", "05": "MMBTU"}
STATUS = {"RASCUNHO": "Rascunho (não transmitido)", "REJEITADO": "Rejeitado", "ERRO": "Erro no envio",
          "PENDENTE": "Aguardando a Sefaz", "ENVIANDO": "Enviando", "AUTORIZADO": "Autorizado",
          "CANCELADO": "Cancelado", "DENEGADO": "Denegado"}
CST_LABELS = {"00": "00 - Tributação normal ICMS", "20": "20 - Tributação com BC reduzida", "40": "40 - ICMS isenção",
              "41": "41 - ICMS não tributada", "51": "51 - ICMS diferido", "60": "60 - ICMS cobrado por substituição tributária",
              "90": "90 - ICMS outros", "SN": "Simples Nacional"}
CST_WITH_RATE = ("00", "20", "60", "90")
WARNING = "SEM VALOR FISCAL - ESPELHO PARA CONFERÊNCIA"

PAGE_W, PAGE_H = A4
MARGIN = 10 * mm
X0 = MARGIN
W = PAGE_W - 2 * MARGIN
RED = colors.HexColor("#B91C1C")
LINE = colors.black
LABEL_SIZE = 5.3


# ==================== FORMATAÇÃO ====================

def _doc_fmt(value) -> str:
    d = fiscal_cte.only_digits(value)
    if len(d) == 14:
        return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"
    if len(d) == 11:
        return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}"
    return value or ""


def _cep(value) -> str:
    d = fiscal_cte.only_digits(value)
    return f"{d[:5]}-{d[5:]}" if len(d) == 8 else (value or "")


def _fone(value) -> str:
    return fiscal_cte.only_digits(value)


def _num(value, places=2) -> str:
    """1234.5 -> '1.234,50'."""
    return f"{float(value or 0):,.{places}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _qty(value) -> str:
    return _num(value, 4)


def _place(p: dict) -> str:
    p = p or {}
    if not p.get("cidade"):
        return ""
    code = fiscal_cte.only_digits(p.get("codigo_municipio"))
    return f"{p['cidade']} - {(p.get('uf') or '').upper()}" + (f" ({code})" if code else "")


def _street(address: dict) -> str:
    a = address or {}
    street = ", ".join(x for x in [a.get("logradouro"), a.get("numero")] if x)
    return " ".join(x for x in [street, a.get("complemento"), a.get("bairro")] if x)


def _chave_fmt(chave: str) -> str:
    return " ".join(chave[i:i + 4] for i in range(0, len(chave), 4))


def _local(value) -> str:
    dt = local_datetime(value) if value else None
    return dt.strftime("%d/%m/%Y %H:%M") if dt else ""


# ==================== DESENHO ====================

class Dacte:
    """Coordenadas de cima para baixo (y = distância do topo da página)."""

    def __init__(self, c):
        self.c = c

    def _y(self, y):
        return PAGE_H - y

    def rect(self, x, y, w, h, width=0.6, fill=None):
        self.c.setLineWidth(width)
        self.c.setStrokeColor(LINE)
        if fill is not None:
            self.c.setFillColor(fill)
        self.c.rect(x, self._y(y + h), w, h, stroke=1, fill=1 if fill is not None else 0)
        self.c.setFillColor(colors.black)

    def label(self, x, y, text, size=LABEL_SIZE, bold=False, center_w=None):
        self.c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        if center_w:
            self.c.drawCentredString(x + center_w / 2, self._y(y + size + 1.5), text)
        else:
            self.c.drawString(x + 2, self._y(y + size + 1.5), text)

    def text(self, x, y, w, value, size=8, bold=False, align="left", min_size=5.5):
        """Uma linha de texto que diminui (e por fim corta) para caber em `w`."""
        value = "" if value in (None, "") else str(value)
        font = "Helvetica-Bold" if bold else "Helvetica"
        while size > min_size and stringWidth(value, font, size) > w - 6:
            size -= 0.25
        while value and stringWidth(value, font, size) > w - 6:
            value = value[:-2] + "…"
        self.c.setFont(font, size)
        baseline = self._y(y + size + 0.5)
        if align == "right":
            self.c.drawRightString(x + w - 4, baseline, value)
        elif align == "center":
            self.c.drawCentredString(x + w / 2, baseline, value)
        else:
            self.c.drawString(x + 2, baseline, value)

    def field(self, x, y, w, h, label, value, size=8, bold=False, align="left"):
        """Quadro com rótulo pequeno em cima e o valor embaixo."""
        self.rect(x, y, w, h)
        self.label(x, y + 1, label)
        self.text(x, y + h - size - 3, w, value, size=size, bold=bold, align=align)

    def para(self, x, y, w, h, text, size=7, leading=None, align=TA_LEFT, bold=False, min_size=5):
        """Texto com quebra de linha dentro do quadro (diminui a fonte até caber)."""
        markup = xml_escape(text or "").replace("\n", "<br/>")
        while True:
            style = ParagraphStyle("p", fontName="Helvetica-Bold" if bold else "Helvetica", fontSize=size,
                                   leading=leading or size * 1.2, alignment=align)
            p = Paragraph(markup, style)
            _, ph = p.wrap(w - 4, h)
            if ph <= h or size <= min_size:
                break
            size -= 0.25
        p.drawOn(self.c, x + 2, self._y(y + min(ph, h)))

    def pair(self, x, y, w, label, value, size=7, bold=False, align="left"):
        """Rótulo pequeno e o valor logo depois dele, na mesma linha (o valor
        nunca encosta no rótulo, qualquer que seja o tamanho do texto)."""
        self.label(x, y + 1, label)
        offset = stringWidth(label, "Helvetica", LABEL_SIZE) + 6 if label else 0
        self.text(x + offset, y, w - offset, value, size=size, bold=bold, align=align)

    def band(self, y, title):
        """Faixa de título de bloco (ex.: COMPONENTES DO VALOR...)."""
        h = 10
        self.rect(X0, y, W, h, fill=colors.HexColor("#F1F5F9"))
        self.label(X0, y + 1.4, title, size=5.8, bold=True, center_w=W)
        return y + h


def _party_box(d: Dacte, x, y, w, title, party):
    """Remetente / Destinatário / Expedidor / Recebedor no padrão do DACTE."""
    h = 58
    d.rect(x, y, w, h)
    p = party or {}
    e = p.get("endereco") or {}
    city = f"{e.get('cidade') or ''}{' - ' + (e.get('uf') or '').upper() if e.get('cidade') else ''}"
    pais = "" if not p else ("EXTERIOR" if (e.get("uf") or "").upper() == "EX" else "BRASIL")
    left, right = w * 0.58, w * 0.42
    d.pair(x, y + 2, w, title.upper(), p.get("nome") or "", size=7, bold=True)
    d.pair(x, y + 12, w, "ENDEREÇO", _street(e), size=7)
    d.pair(x, y + 23, left, "MUNICÍPIO", city, size=7)
    d.pair(x + left, y + 23, right, "CEP", _cep(e.get("cep")), size=7, align="right")
    d.pair(x, y + 34, left, "CNPJ/CPF", _doc_fmt(p.get("cnpj_cpf")), size=7)
    d.pair(x + left, y + 34, right, "INSCRIÇÃO ESTADUAL", p.get("ie") or "", size=7, align="right")
    d.pair(x, y + 45, left, "PAÍS", pais, size=7)
    d.pair(x + left, y + 45, right, "FONE", _fone(p.get("fone")), size=7, align="right")
    return y + h


def _emitter(cte: dict, settings: dict, company: dict) -> dict:
    endereco = settings.get("endereco") or {}
    if settings.get("razao_social") and endereco.get("cidade"):
        line = _street(endereco)
        city = f"{endereco.get('cidade')} - {(endereco.get('uf') or '').upper()}"
        cep = _cep(endereco.get("cep"))
        address = " - ".join(x for x in [line, city, f"CEP {cep}" if cep else ""] if x)
        return {"name": settings["razao_social"], "address": address,
                "doc": f"CNPJ: {_doc_fmt(settings.get('cnpj'))}  IE: {settings.get('ie') or ''}".strip(),
                "fone": _fone(settings.get("fone"))}
    c = merge_company(company)
    return {"name": c["name"], "address": " ".join(c["address"].split()), "doc": f"CNPJ: {c['cnpj']}", "fone": c.get("phone") or ""}


def _logo(d: Dacte, company, x, y, max_w, max_h):
    buffer = download_logo(company)
    if not buffer:
        return 0
    try:
        buffer.seek(0)
        img = ImageReader(buffer)
        iw, ih = img.getSize()
        scale = min(max_w / iw, max_h / ih)
        w, h = iw * scale, ih * scale
        d.c.drawImage(img, x + (max_w - w) / 2, PAGE_H - y - h, w, h, mask="auto")
        return h
    except Exception:
        return 0


def generate_cte_preview_pdf(cte: dict, settings: dict, company: dict = None) -> bytes:
    buffer = io.BytesIO()
    c = pdf_canvas.Canvas(buffer, pagesize=A4)
    numero = str(cte.get("numero")) if cte.get("numero") else ""
    c.setTitle(f"Espelho do CT-e {numero or '(rascunho)'} - SEM VALOR FISCAL")
    d = Dacte(c)
    papel = int(cte.get("tomador_papel") or 0)
    ambiente = cte.get("ambiente") or settings.get("ambiente")
    chave = fiscal_cte.only_digits(cte.get("chave"))

    # Aviso no topo da folha (fora do formulário)
    c.setFillColor(RED)
    c.setFont("Helvetica-Bold", 8)
    c.drawCentredString(PAGE_W / 2, PAGE_H - 7 * mm, WARNING)
    c.setFont("Helvetica", 6)
    c.drawCentredString(PAGE_W / 2, PAGE_H - 7 * mm - 8,
                        "O DACTE oficial é gerado somente depois da autorização pela Sefaz.")
    c.setFillColor(colors.black)

    y = MARGIN + 4

    # ---------- Cabeçalho: emitente | DACTE | modal ----------
    hh = 96
    ew, mw = 190, 108
    dw = W - ew - mw
    em = _emitter(cte, settings, company)
    d.rect(X0, y, ew, hh)
    logo_h = _logo(d, company, X0 + 4, y + 4, ew - 8, 36)
    ty = y + 6 + (logo_h or 0)
    d.text(X0, ty, ew, em["name"], size=8.5, bold=True, align="center")
    d.para(X0 + 2, ty + 12, ew - 4, hh - (ty - y) - 14,
           "\n".join(x for x in [em["address"], em["doc"], f"Fone: {em['fone']}" if em["fone"] else ""] if x),
           size=6.3, align=TA_CENTER)

    dx = X0 + ew
    d.rect(dx, y, dw, hh)
    d.text(dx, y + 2, dw, "DACTE", size=10, bold=True, align="center")
    d.text(dx, y + 13, dw, "Documento Auxiliar do Conhecimento de Transporte Eletrônico", size=6, align="center")
    row_y = y + 25
    cols = [("MODELO", "57", 0.17), ("SÉRIE", str(cte.get("serie") or settings.get("cte_serie") or ""), 0.17),
            ("NÚMERO", numero or "na transmissão", 0.36), ("PÁGINA", "1/1", 0.3)]
    cx = dx
    for label, value, frac in cols:
        cw = dw * frac
        d.field(cx, row_y, cw, 22, label, value, size=8 if value != "na transmissão" else 6.5, bold=label == "NÚMERO", align="center")
        cx += cw
    bar_y = row_y + 22
    if len(chave) == 44:
        probe = code128.Code128(chave, barHeight=22, barWidth=1)
        bar_width = (dw - 16) / probe.width
        bc = code128.Code128(chave, barHeight=22, barWidth=bar_width)
        bc.drawOn(c, dx + (dw - bc.width) / 2, PAGE_H - bar_y - 26)
        d.text(dx, bar_y + 27, dw, _chave_fmt(chave), size=6.5, bold=True, align="center")
    else:
        d.text(dx, bar_y + 6, dw, "CHAVE DE ACESSO", size=6, align="center")
        d.text(dx, bar_y + 16, dw, "gerada na transmissão para a Sefaz", size=7.5, bold=True, align="center")
        d.text(dx, bar_y + 28, dw, "(espelho para conferência dos dados)", size=6, align="center")

    mx = dx + dw
    d.field(mx, y, mw, 25, "MODAL", "Rodoviário", size=8.5, align="center")
    emissao = _local(cte.get("data_emissao") or cte.get("sent_at")) if cte.get("status") == "AUTORIZADO" else ""
    d.field(mx, y + 25, mw, 22, "DATA E HORA DE EMISSÃO", emissao or "na transmissão", size=7 if emissao else 6.5, align="center")
    # carimbo no lugar do QR Code
    d.rect(mx, y + 47, mw, hh - 47)
    c.setStrokeColor(RED)
    c.setLineWidth(1.2)
    c.rect(mx + 6, PAGE_H - (y + hh - 5), mw - 12, hh - 47 - 10)
    c.setFillColor(RED)
    c.setFont("Helvetica-Bold", 9.5)
    c.drawCentredString(mx + mw / 2, PAGE_H - (y + 63), "SEM VALOR")
    c.drawCentredString(mx + mw / 2, PAGE_H - (y + 74), "FISCAL")
    c.setFont("Helvetica", 5.5)
    c.drawCentredString(mx + mw / 2, PAGE_H - (y + 84), "ESPELHO PARA CONFERÊNCIA")
    c.setFillColor(colors.black)
    c.setStrokeColor(LINE)
    y += hh

    # ---------- Tipo / chave / protocolo ----------
    half = W / 2
    d.field(X0, y, half / 2, 20, "TIPO DO CT-E", "Normal", size=7.5)
    d.field(X0 + half / 2, y, half / 2, 20, "TIPO DO SERVIÇO", "Normal", size=7.5)
    protocolo = cte.get("protocolo") or ""
    d.field(X0 + half, y, half, 20, "Nº PROTOCOLO",
            protocolo or "gerado na autorização", size=7.5 if protocolo else 6.5, bold=bool(protocolo))
    y += 20
    d.rect(X0, y, half, 20)
    d.label(X0, y + 1, "INDICADOR DO CT-E GLOBALIZADO")
    d.label(X0 + 30, y + 11, "SIM")
    d.rect(X0 + 44, y + 10, 10, 8)
    d.label(X0 + 64, y + 11, "NÃO")
    d.rect(X0 + 78, y + 10, 10, 8)
    d.text(X0 + 78, y + 10, 10, "X", size=7, bold=True, align="center")
    situacao = STATUS.get(cte.get("status"), cte.get("status") or "")
    d.field(X0 + half, y, half, 20, "SITUAÇÃO NO SISTEMA · AMBIENTE",
            f"{situacao} · {'Produção' if ambiente == 'producao' else 'Homologação'}", size=7.5, bold=True)
    y += 20

    cfop = cte.get("cfop") or settings.get("cfop_padrao") or ""
    natureza = cte.get("natureza_operacao") or settings.get("natureza_operacao") or ""
    d.field(X0, y, W * 0.68, 20, "CFOP - NATUREZA DA PRESTAÇÃO", " - ".join(x for x in [cfop, natureza] if x), size=7.5)
    d.field(X0 + W * 0.68, y, W * 0.32, 20, "TOMADOR DO SERVIÇO", TOMADOR.get(papel, ""), size=7.5)
    y += 20
    d.field(X0, y, half, 20, "ORIGEM DA PRESTAÇÃO", _place(cte.get("origem")), size=7.5)
    d.field(X0 + half, y, half, 20, "DESTINO DA PRESTAÇÃO", _place(cte.get("destino")), size=7.5)
    y += 20

    # ---------- Envolvidos ----------
    _party_box(d, X0, y, half, "Remetente", cte.get("remetente"))
    y = _party_box(d, X0 + half, y, half, "Destinatário", cte.get("destinatario"))
    _party_box(d, X0, y, half, "Expedidor", None)
    y = _party_box(d, X0 + half, y, half, "Recebedor", None)

    tomador = {0: cte.get("remetente"), 3: cte.get("destinatario"), 4: cte.get("tomador")}.get(papel) or {}
    te = tomador.get("endereco") or {}
    th = 32
    d.rect(X0, y, W, th)
    pais_t = "" if not tomador else ("EXTERIOR" if (te.get("uf") or "").upper() == "EX" else "BRASIL")
    d.pair(X0, y + 1, W * 0.5, "TOMADOR DO SERVIÇO", tomador.get("nome") or "", bold=True)
    d.pair(X0 + W * 0.5, y + 1, W * 0.26, "MUNICÍPIO", te.get("cidade") or "")
    d.pair(X0 + W * 0.76, y + 1, W * 0.09, "UF", (te.get("uf") or "").upper())
    d.pair(X0 + W * 0.85, y + 1, W * 0.15, "CEP", _cep(te.get("cep")), align="right")
    d.pair(X0, y + 11, W * 0.76, "ENDEREÇO", _street(te))
    d.pair(X0 + W * 0.76, y + 11, W * 0.24, "PAÍS", pais_t)
    d.pair(X0, y + 21, W * 0.34, "CNPJ/CPF", _doc_fmt(tomador.get("cnpj_cpf")))
    d.pair(X0 + W * 0.34, y + 21, W * 0.34, "INSCRIÇÃO ESTADUAL", tomador.get("ie") or "")
    d.pair(X0 + W * 0.68, y + 21, W * 0.32, "FONE", _fone(tomador.get("fone")))
    y += th

    # ---------- Carga ----------
    d.field(X0, y, W * 0.45, 20, "PRODUTO PREDOMINANTE",
            cte.get("produto_predominante") or settings.get("produto_predominante") or "", size=7.5)
    d.field(X0 + W * 0.45, y, W * 0.3, 20, "OUTRAS CARACTERÍSTICAS DA CARGA", cte.get("outras_caracteristicas") or "", size=7.5)
    d.field(X0 + W * 0.75, y, W * 0.25, 20, "VALOR TOTAL DA MERCADORIA", _num(cte.get("valor_carga")), size=8, bold=True, align="right")
    y += 20
    quantidades = (cte.get("quantidades") or [])[:4]
    qw = W / 5
    d.field(X0, y, qw, 20, "QTD CARGA", f"{len(cte.get('containers') or [])} container(s)" if cte.get("containers") else "", size=7)
    for i in range(4):
        q = quantidades[i] if i < len(quantidades) else None
        d.field(X0 + qw * (i + 1), y, qw, 20, (q.get("tipo_medida") or "").upper() if q else "",
                f"{_qty(q.get('quantidade'))} {UNIDADES.get(q.get('unidade'), '')}" if q else "", size=7)
    y += 20

    # ---------- Componentes do valor ----------
    y = d.band(y, "COMPONENTES DO VALOR DA PRESTAÇÃO DE SERVIÇO")
    ch = 42
    comps = cte.get("componentes") or []
    pair_w = W * 0.22
    for col in range(3):
        cx = X0 + pair_w * col
        d.rect(cx, y, pair_w, ch)
        d.label(cx, y + 1, "NOME")
        d.label(cx + pair_w * 0.6, y + 1, "VALOR")
        for row in range(3):
            idx = col * 3 + row
            if idx < len(comps):
                d.text(cx, y + 9 + row * 10, pair_w * 0.6, (comps[idx].get("nome") or "").upper(), size=7)
                d.text(cx + pair_w * 0.4, y + 9 + row * 10, pair_w * 0.6, _num(comps[idx].get("valor")), size=7, align="right")
    total = float(cte.get("valor_total") or 0)
    receber = cte.get("valor_receber")
    rx = X0 + pair_w * 3
    d.field(rx, y, W - pair_w * 3, ch / 2, "VALOR TOTAL DO SERVIÇO", _num(total), size=8.5, bold=True, align="right")
    d.field(rx, y + ch / 2, W - pair_w * 3, ch / 2, "VALOR A RECEBER", _num(receber if receber is not None else total),
            size=8.5, bold=True, align="right")
    y += ch

    # ---------- Imposto ----------
    y = d.band(y, "INFORMAÇÕES RELATIVAS AO IMPOSTO")
    cst = cte.get("icms_cst") or settings.get("icms_cst") or ""
    aliquota = cte.get("icms_aliquota") if cte.get("icms_aliquota") is not None else settings.get("icms_aliquota")
    with_rate = cst in CST_WITH_RATE and aliquota
    d.field(X0, y, W * 0.4, 20, "SITUAÇÃO TRIBUTÁRIA", CST_LABELS.get(cst, cst), size=7.5)
    d.field(X0 + W * 0.4, y, W * 0.15, 20, "BASE DE CÁLCULO", _num(total) if with_rate else "", size=7.5, align="right")
    d.field(X0 + W * 0.55, y, W * 0.15, 20, "ALÍQ ICMS", f"{_num(aliquota)}%" if with_rate else "", size=7.5, align="right")
    d.field(X0 + W * 0.7, y, W * 0.15, 20, "VALOR ICMS",
            _num(round(total * float(aliquota) / 100, 2)) if with_rate else "", size=7.5, align="right")
    d.field(X0 + W * 0.85, y, W * 0.15, 20, "% RED.BC.CALC.", "", size=7.5)
    y += 20

    # ---------- Documentos originários ----------
    y = d.band(y, "DOCUMENTOS ORIGINÁRIOS")
    dh = 80
    docs = []
    for doc in cte.get("documentos") or []:
        if doc.get("tipo") == "NFE":
            key = fiscal_cte.only_digits(doc.get("chave"))
            docs.append(("NFe", key, f"NF: {key[25:34]}" if len(key) == 44 else "", ""))
        else:
            docs.append(("Outros", doc.get("descricao") or "", doc.get("numero") or "",
                         _num(doc["valor"]) if doc.get("valor") else ""))
    per_col = 6
    for col in range(2):
        cx = X0 + half * col
        d.rect(cx, y, half, dh)
        d.label(cx, y + 1, "TP DOC.")
        d.label(cx + 24, y + 1, "CHAVE / CNPJ-CPF EMITENTE / DESCRIÇÃO")
        d.label(cx + half * 0.70, y + 1, "SÉRIE/NRO.")
        d.label(cx + half * 0.88, y + 1, "VALOR")
        for row in range(per_col):
            idx = col * per_col + row
            if idx >= len(docs):
                break
            tp, desc, nro, val = docs[idx]
            ry = y + 10 + row * 10
            d.text(cx, ry, 26, tp, size=6.3)
            d.text(cx + 22, ry, half * 0.70 - 22, desc, size=6.3)
            d.text(cx + half * 0.70, ry, half * 0.16, nro, size=6.3)
            d.text(cx + half * 0.86, ry, half * 0.14, val, size=6.3, align="right")
    if len(docs) > 2 * per_col:
        d.text(X0, y + dh - 9, W, f"+ {len(docs) - 2 * per_col} documento(s) não exibido(s) no espelho", size=6, align="right")
    y += dh

    # ---------- Observações (como vão no CT-e) ----------
    y = d.band(y, "OBSERVAÇÕES")
    oh = 86
    d.rect(X0, y, W, oh)
    obs = " | ".join(n for n in [fiscal_cte._text(cte.get("observacoes")), *fiscal_cte.trip_notes(cte)] if n)
    containers = ", ".join(x.get("numero") + (f" (lacre {x['lacre']})" if x.get("lacre") else "")
                           for x in cte.get("containers") or [] if x.get("numero"))
    d.para(X0, y + 2, W, oh - 4, obs.replace(" | ", "\n") or "-", size=6.8)
    y += oh

    # ---------- Modal rodoviário e uso do emissor ----------
    y = d.band(y, "INFORMAÇÕES ESPECÍFICAS DO MODAL RODOVIÁRIO")
    d.rect(X0, y, W, 16)
    d.pair(X0, y + 4, W, "RNTRC DA EMPRESA", fiscal_cte.only_digits(settings.get("rntrc")), size=7.5, bold=True)
    y += 16
    d.rect(X0, y, W * 0.68, 10, fill=colors.HexColor("#F1F5F9"))
    d.label(X0, y + 1.4, "USO EXCLUSIVO DO EMISSOR DO CT-E", size=5.8, bold=True, center_w=W * 0.68)
    d.rect(X0 + W * 0.68, y, W * 0.32, 10, fill=colors.HexColor("#F1F5F9"))
    d.label(X0 + W * 0.68, y + 1.4, "RESERVADO AO FISCO", size=5.8, bold=True, center_w=W * 0.32)
    y += 10
    d.rect(X0, y, W * 0.68, 22)
    d.para(X0, y + 2, W * 0.68, 18, f"CONTÊINERES: {containers}" if containers else "", size=6.8)
    d.rect(X0 + W * 0.68, y, W * 0.32, 22)
    y += 22

    # ---------- Canhoto ----------
    y += 9
    c.setDash(3, 2)
    c.setLineWidth(0.6)
    c.line(X0, PAGE_H - y, X0 + W, PAGE_H - y)
    c.setDash()
    y += 5
    numero_txt = numero or "(número definido na transmissão)"
    rw = W * 0.18
    d.rect(X0, y, W - rw, 20)
    d.para(X0, y + 2, W - rw, 17,
           f"DECLARO QUE RECEBI OS VOLUMES DO CONHECIMENTO DE TRANSPORTE {numero_txt} EM PERFEITO ESTADO PELO QUE DOU POR "
           f"CUMPRIDO O PRESENTE CONTRATO DE TRANSPORTE\n{em['doc'].split('  IE')[0]}  EMPRESA: {em['name']}", size=5.6)
    d.field(X0 + W - rw, y, rw, 20, "CTe Nº", numero or "-", size=8, bold=True, align="right")
    y += 20
    for label_left, label_right in (("NOME COMPLETO", "CHEGADA DATA / HORA"), ("CPF/RG/DOC", "SAÍDA DATA / HORA")):
        d.field(X0, y, W * 0.35, 18, label_left, "")
        d.field(X0 + W * 0.35, y, W - rw - W * 0.35, 18, "", "")
        d.field(X0 + W - rw, y, rw, 18, label_right, "")
        y += 18
    d.label(X0 + W * 0.35, y - 10, "ASSINATURA / CARIMBO", center_w=W - rw - W * 0.35)

    # ---------- Rodapé e marca d'água ----------
    c.setFont("Helvetica", 6)
    c.setFillColor(colors.HexColor("#64748B"))
    c.drawString(X0, 5 * mm, f"Espelho gerado pelo ContainerLogix em {datetime.now(BRT_TZ).strftime('%d/%m/%Y %H:%M')} · SEM VALOR FISCAL")
    c.drawRightString(X0 + W, 5 * mm, "Página 1 de 1")
    c.saveState()
    c.setFont("Helvetica-Bold", 64)
    c.setFillColorRGB(0.86, 0.15, 0.15, alpha=0.09)
    c.translate(PAGE_W / 2, PAGE_H / 2)
    c.rotate(50)
    c.drawCentredString(0, 0, "SEM VALOR FISCAL")
    c.restoreState()

    c.showPage()
    c.save()
    return buffer.getvalue()
