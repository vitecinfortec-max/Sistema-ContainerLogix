from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from datetime import datetime, timezone, timedelta
from pathlib import Path
import io
import os
import re
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.drawing.image import Image as XLImage
from xml.sax.saxutils import escape as xml_escape
import requests
from PIL import Image as PILImage
import logging
from models import VEHICLE_CHECKLIST_TEMPLATE, VEHICLE_CHECKLIST_SECTION_LABELS

logger = logging.getLogger(__name__)

# Fuso horário de Brasília (UTC-3). Independe do TZ do container.
BRT_TZ = timezone(timedelta(hours=-3))


def now_brt() -> datetime:
    """Retorna o horário atual em Brasília (UTC-3) com tzinfo."""
    return datetime.now(BRT_TZ)


def to_brt(dt_value) -> datetime | None:
    """Converte um datetime/ISO string para o fuso de Brasília.
    - Datetimes 'naive' (sem tz) são interpretados como UTC (padrão do banco).
    - Retorna None se não for possível converter.
    """
    if dt_value is None or dt_value == '':
        return None
    try:
        if isinstance(dt_value, str):
            # Suporta 'Z' e offset
            iso = dt_value.replace('Z', '+00:00')
            dt = datetime.fromisoformat(iso)
        elif isinstance(dt_value, datetime):
            dt = dt_value
        else:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(BRT_TZ)
    except Exception:
        return None

def fmt_date(value):
    """Formata uma data 'YYYY-MM-DD' como 'DD/MM/YYYY'; devolve o valor original
    (ou '-') se não for possível interpretar."""
    if not value:
        return '-'
    try:
        return datetime.strptime(value, '%Y-%m-%d').strftime('%d/%m/%Y')
    except Exception:
        return value


def fmt_datetime(value):
    """Formata um datetime ISO como 'DD/MM/YYYY HH:MM'; devolve o valor original
    (ou '-') se não for possível interpretar."""
    if not value:
        return '-'
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).strftime('%d/%m/%Y %H:%M')
    except Exception:
        return value


# Sem valor padrão fixo: cada instância/cliente define seu próprio logo em "Dados
# da Empresa", ou via variável de ambiente se quiser um logo padrão pré-configurado.
LOGO_URL = os.environ.get('LOGO_URL')

PRIMARY_COLOR = "008B7B"
HEADER_BG_COLOR = "E8F4F5"

ROOT_DIR = Path(__file__).parent
UPLOADS_DIR = ROOT_DIR.parent / 'uploads'

# Valores usados quando a empresa ainda não configurou seus próprios dados em
# "Dados da Empresa" - propositalmente genéricos (nunca dados reais de um cliente
# específico), já que cada instância vendida usa esse mesmo fallback até configurar
# o seu. CNPJ/telefone/dados bancários/PIX ficam como placeholder óbvio em vez de
# vazios, pra não sair "Banco: " em branco nem, pior, os dados de outro cliente.
DEFAULT_COMPANY = {
    'name': 'Sua Empresa',
    'cnpj': '00.000.000/0000-00',
    'address': 'Configure em "Dados da Empresa"',
    'phone': '(00) 00000-0000',
    'email': 'contato@suaempresa.com',
    'slogan': '',  # opcional - sem padrão óbvio, some da assinatura quando vazio
    'bank_name': 'Configure em "Dados da Empresa"',
    'bank_agency': '-',
    'bank_account': '-',
    'pix_key': 'Configure em "Dados da Empresa"',
}


def format_currency(value, currency='BRL'):
    """Formata valor monetário com o símbolo da moeda. BRL usa separador
    decimal brasileiro (R$ 1.234,56); demais moedas usam o padrão
    internacional (US$ 1,234.56), que é o correto para elas."""
    value = value or 0
    symbol = {'USD': '$', 'EUR': '€', 'BRL': 'R$'}.get(currency, currency)
    if currency == 'BRL':
        formatted = f"{value:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')
    else:
        formatted = f"{value:,.2f}"
    return f"{symbol} {formatted}"


def merge_company(company: dict = None) -> dict:
    """Combina os dados cadastrados em 'Dados da Empresa' com os valores padrão,
    usando o padrão para qualquer campo ainda não preenchido."""
    company = company or {}
    return {**DEFAULT_COMPANY, **{k: v for k, v in company.items() if v}}


def download_logo(company: dict = None):
    """Retorna o logo como file-like object.
    Prioriza o logo enviado pelo usuário em 'Dados da Empresa' (uploads/); se não
    houver e a variável de ambiente LOGO_URL estiver configurada (opcional, usada
    quando essa instância quer um logo padrão pré-definido), cai pra ela. Sem
    nenhum dos dois, o cabeçalho do documento simplesmente sai sem logo."""
    if company and company.get('logo_filename'):
        try:
            logo_path = UPLOADS_DIR / company['logo_filename']
            if logo_path.exists():
                return io.BytesIO(logo_path.read_bytes())
        except Exception as e:
            logger.error(f"Error reading uploaded logo: {e}")
    if not LOGO_URL:
        return None
    try:
        response = requests.get(LOGO_URL, timeout=5)
        if response.status_code == 200:
            return io.BytesIO(response.content)
    except Exception as e:
        logger.error(f"Error downloading logo: {e}")
    return None


# ==================== IDENTIDADE VISUAL DOS DOCUMENTOS ====================
# Paleta única dos PDFs e planilhas Excel do sistema - mudar aqui muda o
# visual de todos os documentos que usam os helpers abaixo de uma vez.
BRAND_DARK = "0F172A"    # nome da empresa, valores de destaque
BRAND_TEXT = "334155"    # texto das tabelas
BRAND_MUTED = "64748B"   # textos secundários (CNPJ, rótulos, rodapé)
BRAND_LINE = "E2E8F0"    # linhas finas entre as linhas das tabelas
BRAND_ZEBRA = "F5F9F9"   # fundo das linhas alternadas
BRAND_SOFT = "E8F4F3"    # fundo suave na cor da marca (indicadores, totais)


def _hex(color_hex):
    return colors.HexColor(f'#{color_hex}')


def _downscale_logo(logo_buffer, max_px):
    """Cópia da logo reduzida (lado maior <= max_px) pra embutir no documento:
    a logo enviada em "Dados da Empresa" costuma ter 500px+ e ia inteira pra
    dentro de cada PDF/planilha mesmo aparecendo com ~50px. Mantém a
    transparência (PNG). Em caso de erro devolve o buffer original."""
    try:
        logo_buffer.seek(0)
        with PILImage.open(logo_buffer) as pil_img:
            if max(pil_img.size) <= max_px:
                logo_buffer.seek(0)
                return logo_buffer
            img = pil_img.convert('RGBA') if pil_img.mode not in ('RGB', 'RGBA') else pil_img.copy()
        img.thumbnail((max_px, max_px), PILImage.LANCZOS)
        out = io.BytesIO()
        img.save(out, format='PNG', optimize=True)
        out.seek(0)
        return out
    except Exception as e:
        logger.error(f"Error downscaling logo: {e}")
        logo_buffer.seek(0)
        return logo_buffer


def _split_report_title(report_title):
    """Os routers montam títulos como "Relatório de X - Cliente: Y". No
    cabeçalho o título principal fica em destaque e o complemento (filtro)
    vira uma linha menor embaixo, em vez de uma linha única enorme."""
    main, _, rest = (report_title or '').partition(' - ')
    return main.strip(), rest.strip()


def _build_pdf_header(styles, logo_buffer, report_title, generation_info=None, company=None, content_width=540, compact=False):
    """
    Cabeçalho padrão dos PDFs: logo + dados da empresa à esquerda, título do
    documento à direita (com o complemento do título e `generation_info`,
    quando houver, em linhas menores embaixo) e uma linha na cor da marca
    separando do conteúdo. Sem logo configurada, o bloco da empresa simplesmente
    começa na margem - nada de coluna vazia empurrando o texto.
    `content_width` deve ser a largura útil real do documento (doc.width) para
    que o cabeçalho nunca ultrapasse a margem nem fique desalinhado do resto do conteúdo.
    `compact=True` reduz logo, fontes e espaçamentos - pra documentos que
    precisam caber inteiros numa página (ex.: Ordem de Abastecimento em 2 vias).
    """
    c = merge_company(company)
    elements = []
    scale_f = 0.72 if compact else 1.0

    # ========== LOGO ==========
    # Redimensiona mantendo a proporção original (evita esticar/achatar a logo).
    logo_cell = None
    logo_w = 0
    if logo_buffer:
        try:
            max_w, max_h = 120 * scale_f, 58 * scale_f
            logo_buffer.seek(0)
            with PILImage.open(logo_buffer) as pil_img:
                orig_w, orig_h = pil_img.size
            if orig_w and orig_h:
                scale = min(max_w / orig_w, max_h / orig_h)
                logo_w, logo_h = orig_w * scale, orig_h * scale
            else:
                logo_w, logo_h = max_h, max_h
            # ~300dpi no tamanho impresso (1pt = 1/72")
            logo_cell = Image(_downscale_logo(logo_buffer, int(max(logo_w, logo_h) * 300 / 72)), width=logo_w, height=logo_h)
        except Exception as e:
            logger.error(f"Error adding logo to PDF: {e}")
            logo_cell, logo_w = None, 0

    # ========== EMPRESA ==========
    name_style = ParagraphStyle(
        'HeaderCompanyName', parent=styles['Normal'], fontName='Helvetica-Bold',
        fontSize=12 if not compact else 10, leading=14.5 if not compact else 12, textColor=_hex(BRAND_DARK),
    )
    info_style = ParagraphStyle(
        'HeaderCompanyInfo', parent=styles['Normal'], fontSize=7.5 if not compact else 6.5,
        leading=9.5 if not compact else 8, textColor=_hex(BRAND_MUTED),
    )
    address = '  ·  '.join(line.strip() for line in c['address'].split('\n') if line.strip())
    company_block = [
        Paragraph(xml_escape(c['name']), name_style),
        Paragraph(f"CNPJ {xml_escape(c['cnpj'])}", info_style),
    ]
    if address:
        company_block.append(Paragraph(xml_escape(address), info_style))
    company_block.append(Paragraph(f"{xml_escape(c['email'])}  ·  {xml_escape(c['phone'])}", info_style))
    if compact:
        # Versão compacta: CNPJ, endereço e contato numa linha só
        company_block = [
            Paragraph(xml_escape(c['name']), name_style),
            Paragraph('  ·  '.join(xml_escape(p) for p in [f"CNPJ {c['cnpj']}", address, c['email'], c['phone']] if p), info_style),
        ]

    # ========== TÍTULO ==========
    title_style = ParagraphStyle(
        'HeaderReportTitle', parent=styles['Normal'], fontName='Helvetica-Bold',
        fontSize=13 if not compact else 11, leading=16 if not compact else 13.5,
        textColor=_hex(PRIMARY_COLOR), alignment=TA_RIGHT,
    )
    subtitle_style = ParagraphStyle(
        'HeaderReportSubtitle', parent=styles['Normal'], fontName='Helvetica-Bold',
        fontSize=8.5, leading=11, textColor=_hex(BRAND_TEXT), alignment=TA_RIGHT,
    )
    extra_style = ParagraphStyle('HeaderReportExtra', parent=info_style, alignment=TA_RIGHT)
    main_title, title_complement = _split_report_title(report_title)
    title_block = [Paragraph(xml_escape(main_title), title_style)]
    if title_complement:
        title_block.append(Paragraph(xml_escape(title_complement), subtitle_style))
    if generation_info:
        title_block.append(Paragraph(xml_escape(generation_info), extra_style))

    title_w = content_width * 0.40
    if logo_cell:
        logo_col = logo_w + 12
        header_table = Table(
            [[logo_cell, company_block, title_block]],
            colWidths=[logo_col, content_width - logo_col - title_w, title_w],
        )
    else:
        header_table = Table(
            [[company_block, title_block]],
            colWidths=[content_width - title_w, title_w],
        )
    # Centralizado com a mesma largura (content_width) das tabelas de dados -
    # o Frame do SimpleDocTemplate tem 6pt de padding de cada lado, então
    # alinhar à esquerda deslocaria o cabeçalho em relação ao resto.
    header_table.hAlign = 'CENTER'
    header_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    elements.append(header_table)
    elements.append(Spacer(1, 8 if not compact else 4))
    # Faixa na cor da marca como tabela de 1 célula (e não HRFlowable, que
    # limita a largura à área do Frame e ficaria mais curta que as tabelas).
    rule = Table([['']], colWidths=[content_width], rowHeights=[2 if not compact else 1.5])
    rule.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), _hex(PRIMARY_COLOR))]))
    elements.append(rule)
    elements.append(Spacer(1, 10 if not compact else 5))

    return elements


def _install_total_pages(canvas, draw_fn):
    """Adia a finalização de cada página até o fim do documento (mesma técnica
    do "NumberedCanvas" da documentação do ReportLab), pra que o rodapé saiba o
    total de páginas e escreva "Página X de Y" - sem que cada um dos geradores
    precise trocar o canvasmaker do seu doc.build(). Idempotente: só instala na
    primeira página."""
    if getattr(canvas, '_cl_total_pages_hook', False):
        return
    canvas._cl_total_pages_hook = True
    saved_states = []
    original_show_page = canvas.showPage
    original_save = canvas.save

    def show_page():
        saved_states.append(dict(canvas.__dict__))
        canvas._startPage()

    def save():
        total = len(saved_states)
        for state in saved_states:
            canvas.__dict__.update(state)
            try:
                draw_fn(canvas, total)
            except Exception as e:
                logger.error(f"Error drawing PDF page count: {e}")
            original_show_page()
        original_save()

    canvas.showPage = show_page
    canvas.save = save


def _make_pdf_footer(company_name):
    """Retorna uma função de rodapé (canvas, doc) -> None presa ao nome da empresa
    cadastrada em 'Dados da Empresa' — necessário porque o ReportLab só chama
    onFirstPage/onLaterPages com (canvas, doc), sem espaço para outros argumentos.
    Rodapé: empresa + data/hora de emissão à esquerda, "Página X de Y" à direita."""
    gen_stamp = now_brt().strftime('%d/%m/%Y às %H:%M')

    def _footer(canvas, doc):
        left = doc.leftMargin
        right = doc.leftMargin + doc.width

        def _draw_page_count(cv, total):
            cv.saveState()
            cv.setFont('Helvetica-Bold', 7.5)
            cv.setFillColor(_hex(BRAND_MUTED))
            cv.drawRightString(right, 14, f"Página {cv.getPageNumber()} de {total}")
            cv.restoreState()

        _install_total_pages(canvas, _draw_page_count)

        canvas.saveState()
        canvas.setStrokeColor(_hex(BRAND_LINE))
        canvas.setLineWidth(0.75)
        canvas.line(left, 26, right, 26)
        canvas.setFont('Helvetica', 7.5)
        canvas.setFillColor(_hex(BRAND_MUTED))
        canvas.drawString(left, 14, f"{company_name}  ·  Emitido em {gen_stamp}  ·  ContainerLogix")
        canvas.restoreState()
    return _footer


def _fmt_int(value):
    """Inteiro com separador de milhar brasileiro (1.234)."""
    try:
        return f"{int(value):,}".replace(',', '.')
    except (TypeError, ValueError):
        return str(value)


def _build_pdf_summary(items, content_width, max_box_width=175):
    """Faixa de indicadores logo abaixo do cabeçalho: cada (rótulo, valor) vira
    uma caixinha com fundo suave e barra lateral na cor da marca - substitui a
    antiga linha de texto "Total: X | Entradas: Y" centralizada."""
    label_style = ParagraphStyle(
        'SummaryLabel', fontName='Helvetica-Bold', fontSize=6.5, leading=8,
        textColor=_hex(BRAND_MUTED),
    )
    value_style = ParagraphStyle(
        'SummaryValue', fontName='Helvetica-Bold', fontSize=13, leading=15.5,
        textColor=_hex(BRAND_DARK),
    )
    gap = 8
    n = len(items)
    box_w = min(max_box_width, (content_width - gap * (n - 1)) / n)
    row, widths, box_cols = [], [], []
    for i, (label, value) in enumerate(items):
        if i:
            row.append('')
            widths.append(gap)
        box_cols.append(len(row))
        row.append([Paragraph(xml_escape(label.upper()), label_style), Paragraph(xml_escape(str(value)), value_style)])
        widths.append(box_w)
    # Completa até content_width com uma coluna vazia: a faixa fica com a mesma
    # largura (e centralização) das tabelas, alinhada à esquerda com elas.
    filler = content_width - sum(widths)
    if filler > 0.5:
        row.append('')
        widths.append(filler)
    table = Table([row], colWidths=widths)
    cmds = [
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
    ]
    for ci in box_cols:
        cmds += [
            ('BACKGROUND', (ci, 0), (ci, 0), _hex(BRAND_SOFT)),
            ('LINEBEFORE', (ci, 0), (ci, 0), 2.5, _hex(PRIMARY_COLOR)),
            ('LEFTPADDING', (ci, 0), (ci, 0), 9),
            ('RIGHTPADDING', (ci, 0), (ci, 0), 6),
        ]
    table.setStyle(TableStyle(cmds))
    return [table, Spacer(1, 10)]


def _pdf_align_left(flowable, content_width):
    """Encosta um bloco CURTO (título de seção) na mesma margem esquerda das
    tabelas de largura total - hAlign='LEFT' sozinho fica 6pt pra dentro por
    causa do padding do Frame. Não usar com tabelas longas: a célula única não
    quebra entre páginas (pra essas, ver _pdf_narrow_table)."""
    wrapper = Table([[flowable]], colWidths=[content_width])
    wrapper.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    return wrapper


def _pdf_section_title(text, content_width):
    """Título de seção dentro do documento (ex.: "Saídas por Booking"),
    alinhado na mesma margem das tabelas. Retorna uma lista de flowables."""
    style = ParagraphStyle(
        'SectionTitle', fontName='Helvetica-Bold', fontSize=9.5, leading=12,
        textColor=_hex(PRIMARY_COLOR),
    )
    return [Spacer(1, 14), _pdf_align_left(Paragraph(xml_escape(text), style), content_width), Spacer(1, 5)]


def _pdf_header_cells(labels, font_size=7):
    """Células de cabeçalho de tabela em Paragraph (quebram linha dentro da
    célula em vez de vazar pra vizinha, como acontecia com "Terminal de Origem")."""
    style = ParagraphStyle(
        'TableHeaderCell', fontName='Helvetica-Bold', fontSize=font_size,
        leading=font_size + 1.5, textColor=colors.white, alignment=TA_CENTER,
    )
    return [Paragraph(xml_escape(label), style) for label in labels]


def _pdf_table_style(header_rows=1, zebra=True, total_row=False, last_col=-1):
    """Estilo padrão das tabelas de dados: cabeçalho na cor da marca, linhas
    separadas só por filetes horizontais claros, listras alternadas e, se
    houver, linha de total com fundo suave. Retorna a lista de comandos pra
    o gerador poder somar ajustes próprios (alinhamentos por coluna etc.).
    `last_col` limita o estilo às colunas reais quando a tabela tem uma coluna
    de preenchimento no fim (ver _pdf_narrow_table)."""
    lc = last_col
    last_header = header_rows - 1
    cmds = [
        ('BACKGROUND', (0, 0), (lc, last_header), _hex(PRIMARY_COLOR)),
        ('TEXTCOLOR', (0, 0), (lc, last_header), colors.white),
        ('FONTNAME', (0, 0), (lc, last_header), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (lc, -1), 7),
        ('TEXTCOLOR', (0, header_rows), (lc, -1), _hex(BRAND_TEXT)),
        ('VALIGN', (0, 0), (lc, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (lc, last_header), 5),
        ('BOTTOMPADDING', (0, 0), (lc, last_header), 5),
        ('TOPPADDING', (0, header_rows), (lc, -1), 3.5),
        ('BOTTOMPADDING', (0, header_rows), (lc, -1), 3.5),
        ('LEFTPADDING', (0, 0), (lc, -1), 4),
        ('RIGHTPADDING', (0, 0), (lc, -1), 4),
        ('LINEBELOW', (0, header_rows), (lc, -1), 0.4, _hex(BRAND_LINE)),
    ]
    if zebra:
        cmds.append(('ROWBACKGROUNDS', (0, header_rows), (lc, -1), [colors.white, _hex(BRAND_ZEBRA)]))
    if total_row:
        cmds += [
            ('BACKGROUND', (0, -1), (lc, -1), _hex(BRAND_SOFT)),
            ('FONTNAME', (0, -1), (lc, -1), 'Helvetica-Bold'),
            ('LINEABOVE', (0, -1), (lc, -1), 0.8, _hex(PRIMARY_COLOR)),
        ]
    return cmds


def _pdf_narrow_table(data, col_widths, content_width, extra_style=None, header_rows=1, total_row=False, zebra=True):
    """Tabela mais estreita que a página (resumos, totais) encostada na mesma
    margem esquerda das tabelas de largura total: completa a largura com uma
    coluna vazia no fim, que fica fora do estilo. Diferente de _pdf_align_left,
    continua quebrando normalmente entre páginas."""
    n_cols = len(col_widths)
    filler = content_width - sum(col_widths)
    if filler > 0.5:
        data = [list(row) + [''] for row in data]
        col_widths = list(col_widths) + [filler]
    table = Table(data, colWidths=col_widths, repeatRows=header_rows)
    table.setStyle(TableStyle(
        _pdf_table_style(header_rows=header_rows, zebra=zebra, total_row=total_row, last_col=n_cols - 1)
        + (extra_style or [])
    ))
    return table

# Cores de destaque pra texto de status nas tabelas (ENTRADA/SAÍDA, PAGO,
# PENDENTE, VENCIDO...) e fundos suaves correspondentes pra alertas em célula.
PDF_TONES = {
    'primary': PRIMARY_COLOR,
    'amber': 'B45309',
    'red': 'B91C1C',
    'emerald': '047857',
    'blue': '1D4ED8',
    'slate': BRAND_MUTED,
    'dark': BRAND_DARK,
}
PDF_SOFT_FILLS = {
    'primary': BRAND_SOFT,
    'amber': 'FEF3C7',
    'red': 'FEE2E2',
    'emerald': 'D1FAE5',
    'blue': 'DBEAFE',
    'slate': 'F1F5F9',
}


def _pdf_tone_markup(text, tone='dark', bold=True):
    """Texto colorido (markup de Paragraph) pra status dentro de uma célula."""
    t = xml_escape(str(text)) if text not in (None, '') else '-'
    if bold:
        t = f'<b>{t}</b>'
    return f'<font color="#{PDF_TONES.get(tone, BRAND_DARK)}">{t}</font>'


def _pdf_cell_factory(styles, font_size=7):
    """Retorna cell(texto, align='left'|'center'|'right', markup=None, bold=False):
    células de tabela em Paragraph (quebram linha dentro da própria célula),
    com o texto escapado e na cor padrão das tabelas."""
    base = ParagraphStyle(
        f'StdCellL{font_size}', parent=styles['Normal'], fontSize=font_size,
        leading=font_size + 1.5, textColor=_hex(BRAND_TEXT), alignment=TA_LEFT,
    )
    by_align = {
        'left': base,
        'center': ParagraphStyle(f'StdCellC{font_size}', parent=base, alignment=TA_CENTER),
        'right': ParagraphStyle(f'StdCellR{font_size}', parent=base, alignment=TA_RIGHT),
    }

    def cell(text, align='left', markup=None, bold=False):
        if markup is None:
            markup = xml_escape(str(text)) if text not in (None, '') else '-'
            if bold:
                markup = f'<b>{markup}</b>'
        return Paragraph(markup, by_align[align])
    return cell


def _pdf_info_grid(pairs, content_width, cols=4):
    """Quadro de informações de um registro (fatura, ordem, comprovante...):
    pares (rótulo, valor) em grade, rótulo pequeno em cima e valor em negrito
    embaixo, sobre fundo suave. Um item (rótulo, valor, n) ocupa n colunas.
    `valor` pode ser um Paragraph pronto (ex.: com cor de status)."""
    label_style = ParagraphStyle(
        'InfoGridLabel', fontName='Helvetica', fontSize=6.5, leading=8,
        textColor=_hex(BRAND_MUTED),
    )
    value_style = ParagraphStyle(
        'InfoGridValue', fontName='Helvetica-Bold', fontSize=8.5, leading=10.5,
        textColor=_hex(BRAND_DARK),
    )
    grid, cmds = [], []
    r, c = -1, cols
    for item in pairs:
        label, value = item[0], item[1]
        span = max(1, min(item[2] if len(item) > 2 else 1, cols))
        if c + span > cols:
            grid.append([''] * cols)
            r += 1
            c = 0
        if isinstance(value, Paragraph):
            val = value
        else:
            val = Paragraph(xml_escape(str(value)) if value not in (None, '') else '-', value_style)
        grid[r][c] = [Paragraph(xml_escape(str(label).upper()), label_style), val]
        if span > 1:
            cmds.append(('SPAN', (c, r), (c + span - 1, r)))
        c += span
    table = Table(grid, colWidths=[content_width / cols] * cols)
    cmds += [
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('BACKGROUND', (0, 0), (-1, -1), _hex('F8FAFC')),
        ('BOX', (0, 0), (-1, -1), 0.6, _hex(BRAND_LINE)),
        ('LINEBELOW', (0, 0), (-1, -2), 0.4, _hex(BRAND_LINE)),
        ('LEFTPADDING', (0, 0), (-1, -1), 7),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]
    table.setStyle(TableStyle(cmds))
    return table


def _pdf_totals_box(rows, content_width, width=230, highlight_last=True):
    """Quadro de totais encostado à direita: [(rótulo, valor), ...]. A última
    linha (total geral) vai em destaque na cor da marca."""
    label_style = ParagraphStyle('TotalsLabel', fontName='Helvetica', fontSize=8, leading=10, textColor=_hex(BRAND_TEXT))
    value_style = ParagraphStyle('TotalsValue', fontName='Helvetica-Bold', fontSize=8, leading=10, textColor=_hex(BRAND_DARK), alignment=TA_RIGHT)
    grand_label = ParagraphStyle('TotalsGrandLabel', parent=label_style, fontName='Helvetica-Bold', fontSize=9.5, leading=12, textColor=colors.white)
    grand_value = ParagraphStyle('TotalsGrandValue', parent=value_style, fontSize=10.5, leading=13, textColor=colors.white)
    filler = max(content_width - width, 0)
    data = []
    for i, (label, value) in enumerate(rows):
        is_grand = highlight_last and i == len(rows) - 1
        data.append(['', Paragraph(xml_escape(str(label)), grand_label if is_grand else label_style),
                     Paragraph(xml_escape(str(value)), grand_value if is_grand else value_style)])
    table = Table(data, colWidths=[filler, width * 0.55, width * 0.45])
    cmds = [
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (1, 0), (-1, -1), 8),
        ('RIGHTPADDING', (1, 0), (-1, -1), 8),
        ('TOPPADDING', (1, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (1, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (0, -1), 0),
        ('RIGHTPADDING', (0, 0), (0, -1), 0),
        ('LINEBELOW', (1, 0), (-1, -2), 0.4, _hex(BRAND_LINE)),
    ]
    if highlight_last:
        cmds.append(('BACKGROUND', (1, -1), (-1, -1), _hex(PRIMARY_COLOR)))
    table.setStyle(TableStyle(cmds))
    return table


def _pdf_note_box(title, text, content_width):
    """Caixa de observações/notas: título pequeno na cor da marca + texto
    (quebras de linha preservadas) sobre fundo suave."""
    title_style = ParagraphStyle('NoteTitle', fontName='Helvetica-Bold', fontSize=7.5, leading=9.5, textColor=_hex(PRIMARY_COLOR))
    text_style = ParagraphStyle('NoteText', fontName='Helvetica', fontSize=8, leading=10.5, textColor=_hex(BRAND_TEXT))
    body = xml_escape(str(text or '-')).replace('\n', '<br/>')
    table = Table([[[Paragraph(xml_escape(title.upper()), title_style), Spacer(1, 2), Paragraph(body, text_style)]]], colWidths=[content_width])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), _hex('F8FAFC')),
        ('BOX', (0, 0), (-1, -1), 0.6, _hex(BRAND_LINE)),
        ('LINEBEFORE', (0, 0), (0, -1), 2.5, _hex(PRIMARY_COLOR)),
        ('LEFTPADDING', (0, 0), (-1, -1), 9),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    return table


def _pdf_signatures(signers, content_width, space_above=30):
    """Linhas de assinatura lado a lado. `signers`: lista de títulos ou de
    (título, linha de apoio) - ex.: ("Motorista", "Nome: Fulano")."""
    n = max(len(signers), 1)
    gap = 28
    w = (content_width - gap * (n - 1)) / n
    title_style = ParagraphStyle('SignTitle', fontName='Helvetica-Bold', fontSize=8, leading=10, textColor=_hex(BRAND_DARK), alignment=TA_CENTER)
    sub_style = ParagraphStyle('SignSub', fontName='Helvetica', fontSize=7, leading=9, textColor=_hex(BRAND_MUTED), alignment=TA_CENTER)
    top, bottom, widths, sign_cols = [], [], [], []
    for i, s in enumerate(signers):
        title, sub = (s[0], s[1]) if isinstance(s, (tuple, list)) else (s, None)
        if i:
            top.append('')
            bottom.append('')
            widths.append(gap)
        sign_cols.append(len(top))
        top.append('')
        cell = [Paragraph(xml_escape(str(title)), title_style)]
        if sub:
            cell.append(Paragraph(xml_escape(str(sub)), sub_style))
        bottom.append(cell)
        widths.append(w)
    table = Table([top, bottom], colWidths=widths, rowHeights=[space_above, None])
    cmds = [
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 1), (-1, 1), 3),
    ]
    for ci in sign_cols:
        cmds.append(('LINEBELOW', (ci, 0), (ci, 0), 0.8, _hex(BRAND_TEXT)))
    table.setStyle(TableStyle(cmds))
    return table


def _pdf_empty_state(text, content_width):
    """Aviso de "nenhum registro" no lugar da tabela, numa caixa suave."""
    style = ParagraphStyle('EmptyState', fontName='Helvetica', fontSize=9, leading=12, textColor=_hex(BRAND_MUTED), alignment=TA_CENTER)
    table = Table([[Paragraph(xml_escape(text), style)]], colWidths=[content_width])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), _hex('F8FAFC')),
        ('BOX', (0, 0), (-1, -1), 0.6, _hex(BRAND_LINE)),
        ('TOPPADDING', (0, 0), (-1, -1), 18),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 18),
    ]))
    return table


def generate_pdf_report(movements: list, report_title: str = "Relatório de Movimentações", company: dict = None) -> bytes:
    """
    Relatório de Movimentações/Entradas/Saídas/Estoque Atual no padrão visual
    dos documentos do sistema: cabeçalho (_build_pdf_header), faixa de
    indicadores (_build_pdf_summary), tabela no estilo _pdf_table_style e
    rodapé com "Página X de Y" (_make_pdf_footer).
    """
    c = merge_company(company)
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=10*mm,
        leftMargin=10*mm,
        topMargin=12*mm,
        bottomMargin=15*mm
    )

    elements = []
    styles = getSampleStyleSheet()

    logo_buffer = download_logo(company)
    elements.extend(_build_pdf_header(styles, logo_buffer, report_title, company=company, content_width=doc.width))

    # ========== INDICADORES ==========
    total_records = len(movements)
    total_entries = sum(1 for m in movements if m.get('operation_type') == 'ENTRADA')
    total_exits = sum(1 for m in movements if m.get('operation_type') == 'SAIDA')
    total_full = sum(1 for m in movements if m.get('status') == 'CHEIO')
    total_empty = total_records - total_full

    if "Estoque" in report_title:
        summary = [("Containers em estoque", _fmt_int(total_records))]
    elif "Entradas" in report_title:
        summary = [("Total de entradas", _fmt_int(total_records))]
    elif "Saídas" in report_title:
        summary = [("Total de saídas", _fmt_int(total_records))]
    else:
        summary = [
            ("Total de registros", _fmt_int(total_records)),
            ("Entradas", _fmt_int(total_entries)),
            ("Saídas", _fmt_int(total_exits)),
        ]
    summary += [("Cheios", _fmt_int(total_full)), ("Vazios", _fmt_int(total_empty))]
    elements.extend(_build_pdf_summary(summary, doc.width))

    # ========== TABELA ==========
    # Células de texto usam Paragraph (não string pura) pra quebrar linha
    # dentro da própria célula em vez de vazar visualmente pra célula vizinha
    # quando o conteúdo é mais largo que a coluna (nome de motorista grande,
    # CPF, transportadora) - era a causa da sobreposição de texto no relatório.
    cell_style_l = ParagraphStyle(
        'ReportCellL', parent=styles['Normal'], fontSize=7, leading=8.5,
        alignment=TA_LEFT, textColor=_hex(BRAND_TEXT),
    )
    cell_style_c = ParagraphStyle('ReportCellC', parent=cell_style_l, alignment=TA_CENTER)

    def cell(text, centered=False, markup=None):
        if markup is not None:
            return Paragraph(markup, cell_style_c if centered else cell_style_l)
        return Paragraph(xml_escape(str(text)) if text not in (None, '') else '-', cell_style_c if centered else cell_style_l)

    # 14 colunas
    data = [_pdf_header_cells([
        'ID Trans.', 'Data/Hora', 'Tipo', 'Nº Container', 'Motorista',
        'Placa Cavalo', 'Placa Carreta', 'Transportadora', 'Terminal de Origem',
        'Status', 'Tamanho', 'Tara', 'Armador', 'Booking'
    ])]

    for m in movements:
        dt_brt = to_brt(m.get('created_at'))
        created_at = dt_brt.strftime('%d/%m/%Y %H:%M') if dt_brt else str(m.get('created_at', '-'))
        is_entry = m.get('operation_type') == 'ENTRADA'
        type_markup = (
            f'<font color="#{PRIMARY_COLOR}"><b>ENTRADA</b></font>' if is_entry
            else '<font color="#B45309"><b>SAÍDA</b></font>'
        )
        status = m.get('status', 'VAZIO')
        status_markup = (
            f'<font color="#{BRAND_DARK}"><b>{xml_escape(status)}</b></font>' if status == 'CHEIO'
            else f'<font color="#{BRAND_MUTED}">{xml_escape(status)}</font>'
        )

        data.append([
            cell(m.get('transaction_id', '-'), centered=True),
            cell(created_at),
            cell(None, centered=True, markup=type_markup),
            cell(m.get('container_number', '-')),
            cell(m.get('driver_name', '-')),
            cell(m.get('truck_plate', '-')),
            cell(m.get('trailer_plate_1', '') or '-'),
            cell(m.get('transport_company', '-')),
            cell(m.get('origin_terminal', '') or '-'),
            cell(None, centered=True, markup=status_markup),
            cell(m.get('size_type', '-'), centered=True),
            cell(str(m.get('tare', '')) if m.get('tare') else '-', centered=True),
            cell(m.get('shipping_line', '-')),
            cell(m.get('booking', '') or '-')
        ])

    # Larguras somam a área útil real da página (doc.width em A4 paisagem, ~785pt);
    # colunas de texto mais longo (Motorista, Transportadora, Terminal de
    # Origem) têm mais espaço pra reduzir a quantidade de quebra de linha.
    col_widths = [30, 70, 44, 60, 105, 46, 46, 96, 62, 38, 40, 30, 66, 52]

    table = Table(data, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle(_pdf_table_style()))
    elements.append(table)

    # ========== SAÍDAS POR BOOKING (resumo) ==========
    booking_counts = {}
    for m in movements:
        if m.get('operation_type') == 'SAIDA':
            booking = (m.get('booking') or '').strip()
            key = booking if booking else 'Sem Booking'
            booking_counts[key] = booking_counts.get(key, 0) + 1

    if booking_counts:
        total_exits_summary = sum(booking_counts.values())
        elements.extend(_pdf_section_title(
            f"Saídas por Booking ({_fmt_int(total_exits_summary)} container{'s' if total_exits_summary != 1 else ''})",
            doc.width,
        ))

        # Ordenar por quantidade decrescente, depois por nome do booking
        sorted_bookings = sorted(booking_counts.items(), key=lambda x: (-x[1], x[0]))
        summary_data = [_pdf_header_cells(['Booking', 'Qtd. Containers (Saída)'])]
        for booking_name, qty in sorted_bookings:
            summary_data.append([booking_name, _fmt_int(qty)])
        summary_data.append(['TOTAL', _fmt_int(total_exits_summary)])

        elements.append(_pdf_narrow_table(
            summary_data, [180, 110], doc.width, total_row=True,
            extra_style=[('FONTSIZE', (0, 0), (1, -1), 7.5), ('ALIGN', (1, 1), (1, -1), 'CENTER')],
        ))

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    pdf_bytes = buffer.getvalue()
    buffer.close()

    return pdf_bytes


def generate_yard_control_pdf(containers: list, stats: dict, company: dict = None) -> bytes:
    """
    Gera o PDF do Controle de Pátio - mesmo padrão visual de generate_pdf_report
    (cabeçalho + indicadores + tabela + rodapé), com as colunas específicas do
    Controle de Pátio (entrada/saída/dias no pátio).
    """
    c = merge_company(company)
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=10*mm,
        leftMargin=10*mm,
        topMargin=12*mm,
        bottomMargin=15*mm
    )

    elements = []
    styles = getSampleStyleSheet()

    logo_buffer = download_logo(company)
    elements.extend(_build_pdf_header(styles, logo_buffer, "Controle de Pátio", company=company, content_width=doc.width))

    # ========== INDICADORES ==========
    elements.extend(_build_pdf_summary([
        ("Containers", _fmt_int(stats['total'])),
        ("Cheios / Vazios", f"{_fmt_int(stats['full'])} / {_fmt_int(stats['empty'])}"),
        ("Média de dias", stats['avg_days']),
        ("Máximo de dias", _fmt_int(stats['max_days'])),
        ("Mais de 30 dias", _fmt_int(stats['over_30_days'])),
        ("Mais de 60 dias", _fmt_int(stats['over_60_days'])),
        ("Mais de 90 dias", _fmt_int(stats['over_90_days'])),
    ], doc.width))

    # ========== TABELA ==========
    cell = _pdf_cell_factory(styles)

    def fmt_date_iso(value):
        if not value:
            return '-'
        try:
            return datetime.fromisoformat(value.replace('Z', '+00:00')).strftime('%d/%m/%Y')
        except Exception:
            return '-'

    data = [_pdf_header_cells(["Nº Container", "Tipo", "Status", "Tamanho", "Armador", "Cliente", "Data Entrada", "Data Saída", "Dias no Pátio", "Booking"])]
    alert_cmds = []
    for row, item in enumerate(containers, 1):
        in_stock = item.get('in_stock', True)
        days = item.get('days_in_yard', 0) or 0
        days_tone = 'red' if days > 90 else 'amber' if days > 30 else 'dark'
        data.append([
            cell(item['container_number'], bold=True),
            cell(None, 'center', markup=_pdf_tone_markup('ENTRADA' if in_stock else 'SAÍDA', 'primary' if in_stock else 'amber')),
            cell(item.get('status', '-'), 'center'),
            cell(item.get('size_type', '-'), 'center'),
            cell(item.get('shipping_line', '-')),
            cell(item.get('client_name') or '-'),
            cell(fmt_date_iso(item.get('entry_date')), 'center'),
            cell(fmt_date_iso(item.get('exit_date')), 'center'),
            cell(None, 'center', markup=_pdf_tone_markup(days, days_tone, bold=days > 30)),
            cell(item.get('booking') or '-'),
        ])
        # Alerta de permanência: fundo suave na célula de dias (>30 âmbar, >90 vermelho)
        if days > 30:
            alert_cmds.append(('BACKGROUND', (8, row), (8, row), _hex(PDF_SOFT_FILLS['red' if days > 90 else 'amber'])))

    col_widths = [100, 58, 55, 58, 95, 165, 68, 68, 58, 60]
    table = Table(data, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle(_pdf_table_style() + alert_cmds))
    elements.append(table)

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    pdf_bytes = buffer.getvalue()
    buffer.close()

    return pdf_bytes


def _xl_fill(color_hex):
    return PatternFill(start_color=color_hex, end_color=color_hex, fill_type='solid')


def _xl_col_px(width_chars):
    """Largura aproximada, em pixels, de uma coluna do Excel com a fonte padrão."""
    return int((width_chars or 8.43) * 7 + 5)


def _bsoft_style_excel(ws, title, info_text, headers, data_rows, col_widths, center_cols=None, right_align_cols=None, number_fmt_cols=None, total_col=None, stats_text=None, company_name=None, logo_buffer=None, total_number_format='R$ #,##0.00', company=None, autofilter=False, empty_message=None):
    """
    Formatação padrão das planilhas Excel do sistema - mesma identidade visual
    dos PDFs (_build_pdf_header/_pdf_table_style). O layout de linhas é FIXO
    porque vários geradores escrevem conteúdo extra contando com o cabeçalho
    das colunas na linha 8 e os dados a partir da linha 9:
      1   faixa fina na cor da marca
      2   nome da empresa (logo à esquerda, quando houver)
      3   CNPJ · endereço · contato (quando `company` é passado)
      4   espaço
      5   título do relatório (faixa na cor da marca)
      6   indicadores (stats_text, ou info_text)
      7   data/hora de emissão
      8   cabeçalho das colunas
      9+  dados (+ linha de TOTAL opcional)
    - ws: worksheet
    - title: título do relatório; " - " separa o complemento (ex.: "Relatório X - Cliente: Y")
    - info_text / stats_text: linha de indicadores (stats_text tem prioridade)
    - headers: list of header strings
    - data_rows: list of lists (each inner list = 1 row of data)
    - col_widths: dict {col_letter: width}
    - center_cols: set of 0-based col indices for center alignment
    - right_align_cols: set of 0-based col indices for right alignment
    - number_fmt_cols: dict {0-based col index: format_string}
    - total_col: índice (0-based) da coluna somada na linha de TOTAL, ou lista
      de índices pra somar mais de uma coluna (ex.: Litros e Valor)
    - company: dict de "Dados da Empresa" (opcional) pra linha de CNPJ/contato
    - autofilter: liga o filtro do Excel no cabeçalho (relatórios de consulta;
      desligado em documentos que vão pro cliente, como fatura)
    - empty_message: texto mostrado na linha 9 quando não há nenhuma linha
    """
    from openpyxl.utils import get_column_letter
    from openpyxl.cell.rich_text import CellRichText, TextBlock
    from openpyxl.cell.text import InlineFont
    from openpyxl.drawing.spreadsheet_drawing import OneCellAnchor, AnchorMarker
    from openpyxl.drawing.xdr import XDRPositiveSize2D
    from openpyxl.utils.units import pixels_to_EMU

    if center_cols is None:
        center_cols = set()
    if right_align_cols is None:
        right_align_cols = set()
    if number_fmt_cols is None:
        number_fmt_cols = {}

    num_cols = len(headers)
    first_col = 2  # column B (1-indexed)
    last_col = first_col + num_cols - 1
    first_letter = get_column_letter(first_col)
    last_letter = get_column_letter(last_col)
    header_row = 8

    brand_fill = _xl_fill(PRIMARY_COLOR)
    soft_fill = _xl_fill(BRAND_SOFT)
    zebra_fill = _xl_fill(BRAND_ZEBRA)
    line_side = Side(style='thin', color=BRAND_LINE)
    brand_side = Side(style='medium', color=PRIMARY_COLOR)
    white_side = Side(style='thin', color='FFFFFF')

    # Coluna A é só uma margem
    ws.column_dimensions['A'].width = 2
    for letter, w in col_widths.items():
        ws.column_dimensions[letter].width = w

    def band(row_num, fill=None, border=None):
        for ci in range(first_col, last_col + 1):
            cell = ws.cell(row=row_num, column=ci)
            if fill is not None:
                cell.fill = fill
            if border is not None:
                cell.border = border

    # ======== LINHA 1: faixa da marca ========
    ws.row_dimensions[1].height = 5
    band(1, fill=brand_fill)

    # ======== LOGO ========
    # Ancorada no início da coluna B, ocupando as linhas 2-3. O nome da empresa
    # começa na primeira coluna livre depois da logo (calculado pelas larguras
    # das colunas), então texto e imagem nunca se sobrepõem.
    text_start_col = first_col
    if logo_buffer is not None:
        try:
            target_h = 46
            try:
                logo_buffer.seek(0)
                with PILImage.open(logo_buffer) as pil_img:
                    orig_w, orig_h = pil_img.size
                target_w = int(target_h * orig_w / orig_h) if orig_h else target_h
            except Exception:
                target_w = target_h
            target_w = min(target_w, 160)

            covered, ci = 0, first_col
            while ci <= last_col and covered < target_w + 6:
                covered += _xl_col_px(col_widths.get(get_column_letter(ci)))
                ci += 1
            if ci <= last_col - 1:
                logo_img = XLImage(_downscale_logo(logo_buffer, target_w * 3 if target_w > target_h else target_h * 3))
                logo_img.width = target_w
                logo_img.height = target_h
                marker = AnchorMarker(col=first_col - 1, colOff=pixels_to_EMU(2), row=1, rowOff=pixels_to_EMU(3))
                logo_img.anchor = OneCellAnchor(
                    _from=marker,
                    ext=XDRPositiveSize2D(pixels_to_EMU(target_w), pixels_to_EMU(target_h)),
                )
                ws.add_image(logo_img)
                text_start_col = ci
        except Exception as e:
            logger.error(f"Error adding logo to Excel: {e}")

    # ======== LINHAS 2-3: empresa ========
    ws.merge_cells(start_row=2, start_column=text_start_col, end_row=2, end_column=last_col)
    c = ws.cell(row=2, column=text_start_col, value=company_name or DEFAULT_COMPANY['name'])
    c.font = Font(name='Calibri', size=16, bold=True, color=BRAND_DARK)
    c.alignment = Alignment(horizontal='left', vertical='bottom')
    ws.row_dimensions[2].height = 22

    info_line = None
    if company:
        cm = merge_company(company)
        address = '  ·  '.join(line.strip() for line in cm['address'].split('\n') if line.strip())
        info_line = '  ·  '.join(p for p in [f"CNPJ {cm['cnpj']}", address, cm['email'], cm['phone']] if p)
    ws.merge_cells(start_row=3, start_column=text_start_col, end_row=3, end_column=last_col)
    c = ws.cell(row=3, column=text_start_col, value=info_line)
    c.font = Font(name='Calibri', size=9, color=BRAND_MUTED)
    c.alignment = Alignment(horizontal='left', vertical='top')
    ws.row_dimensions[3].height = 17

    # ======== LINHA 4: espaço ========
    ws.row_dimensions[4].height = 8

    # ======== LINHA 5: título do relatório ========
    main_title, title_complement = _split_report_title(title)
    ws.merge_cells(f'{first_letter}5:{last_letter}5')
    c = ws[f'{first_letter}5']
    if title_complement:
        c.value = CellRichText(
            TextBlock(InlineFont(rFont='Calibri', sz=13, b=True, color='FFFFFF'), main_title),
            TextBlock(InlineFont(rFont='Calibri', sz=11, color='FFFFFF'), f"   ·   {title_complement}"),
        )
    else:
        c.value = main_title
    c.font = Font(name='Calibri', size=13, bold=True, color='FFFFFF')
    c.alignment = Alignment(horizontal='left', vertical='center', indent=1)
    ws.row_dimensions[5].height = 26
    band(5, fill=brand_fill)

    # ======== LINHA 6: indicadores ========
    ws.merge_cells(f'{first_letter}6:{last_letter}6')
    c = ws[f'{first_letter}6']
    c.value = stats_text if stats_text else info_text
    c.font = Font(name='Calibri', size=11, bold=True, color=PRIMARY_COLOR)
    c.alignment = Alignment(horizontal='left', vertical='center', indent=1)
    ws.row_dimensions[6].height = 22
    band(6, fill=soft_fill)

    # ======== LINHA 7: emissão ========
    ws.merge_cells(f'{first_letter}7:{last_letter}7')
    c = ws[f'{first_letter}7']
    c.value = f"Emitido em {now_brt().strftime('%d/%m/%Y às %H:%M')} (horário de Brasília)"
    c.font = Font(name='Calibri', size=9, italic=True, color=BRAND_MUTED)
    c.alignment = Alignment(horizontal='left', vertical='center', indent=1)
    ws.row_dimensions[7].height = 18

    # ======== LINHA 8: cabeçalho das colunas ========
    header_font = Font(name='Calibri', size=10, bold=True, color='FFFFFF')
    header_align = Alignment(horizontal='center', vertical='center', wrap_text=True)
    header_border = Border(left=white_side, right=white_side, bottom=brand_side)
    needs_two_lines = False
    for i, h in enumerate(headers):
        ci = first_col + i
        cell = ws.cell(row=header_row, column=ci, value=h)
        cell.font = header_font
        cell.fill = brand_fill
        cell.alignment = header_align
        cell.border = header_border
        width = col_widths.get(get_column_letter(ci)) or 8.43
        if len(str(h)) * 1.15 > width:
            needs_two_lines = True
    ws.row_dimensions[header_row].height = 30 if needs_two_lines else 20

    # ======== DADOS ========
    data_start = header_row + 1
    total_data = len(data_rows)
    left_align = Alignment(horizontal='left', vertical='center')
    center_align_data = Alignment(horizontal='center', vertical='center')
    right_align = Alignment(horizontal='right', vertical='center')
    data_font = Font(name='Calibri', size=10, color=BRAND_TEXT)
    row_border = Border(bottom=line_side)

    for row_offset, row_data in enumerate(data_rows):
        row_num = data_start + row_offset
        is_zebra_row = (row_offset % 2 == 1)

        for i, val in enumerate(row_data):
            ci = first_col + i
            cell = ws.cell(row=row_num, column=ci, value=val)
            cell.font = data_font
            cell.border = row_border
            if is_zebra_row:
                cell.fill = zebra_fill

            if i in center_cols:
                cell.alignment = center_align_data
            elif i in right_align_cols or i in number_fmt_cols:
                cell.alignment = right_align
            else:
                cell.alignment = left_align

            if i in number_fmt_cols:
                cell.number_format = number_fmt_cols[i]

    # ======== LINHA DE TOTAL ========
    total_cols = [total_col] if isinstance(total_col, int) else list(total_col or [])
    if total_cols and total_data > 0:
        total_row_num = data_start + total_data
        total_border = Border(top=brand_side, bottom=line_side)
        band(total_row_num, fill=soft_fill, border=total_border)

        label_ci = first_col + min(total_cols) - 1
        label_cell = ws.cell(row=total_row_num, column=label_ci, value='TOTAL:')
        label_cell.font = Font(name='Calibri', size=10, bold=True, color=BRAND_DARK)
        label_cell.alignment = Alignment(horizontal='right', vertical='center')

        for tc in total_cols:
            val_ci = first_col + tc
            val_letter = get_column_letter(val_ci)
            sum_formula = f'=SUM({val_letter}{data_start}:{val_letter}{data_start + total_data - 1})'
            sum_cell = ws.cell(row=total_row_num, column=val_ci, value=sum_formula)
            sum_cell.font = Font(name='Calibri', size=10, bold=True, color=BRAND_DARK)
            sum_cell.number_format = number_fmt_cols.get(tc, total_number_format)
            sum_cell.alignment = Alignment(horizontal='right', vertical='center')
        ws.row_dimensions[total_row_num].height = 20
        last_row = total_row_num
    elif total_data == 0 and empty_message:
        ws.merge_cells(start_row=data_start, start_column=first_col, end_row=data_start, end_column=last_col)
        c = ws.cell(row=data_start, column=first_col, value=empty_message)
        c.font = Font(name='Calibri', size=10, italic=True, color=BRAND_MUTED)
        c.alignment = Alignment(horizontal='center', vertical='center')
        band(data_start, fill=zebra_fill, border=Border(bottom=line_side))
        ws.row_dimensions[data_start].height = 28
        last_row = data_start
    else:
        last_row = data_start + total_data - 1

    if autofilter and total_data > 0:
        ws.auto_filter.ref = f'{first_letter}{header_row}:{last_letter}{data_start + total_data - 1}'

    # ======== IMPRESSÃO ========
    # Sem isso, o Excel abre/imprime a planilha larga (13-15 colunas) no padrão
    # retrato dele, cortando colunas em várias páginas — configura para caber
    # numa página de largura, em paisagem, repetindo o cabeçalho das colunas em
    # cada página impressa e com "Página X de Y" no rodapé.
    ws.sheet_view.showGridLines = False
    ws.freeze_panes = f'{first_letter}{header_row + 1}'
    ws.print_area = f'A1:{last_letter}{max(last_row, header_row)}'
    ws.print_title_rows = f'{header_row}:{header_row}'
    ws.page_setup.orientation = 'landscape'
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_options.horizontalCentered = True
    ws.page_margins.left = ws.page_margins.right = 0.4
    ws.page_margins.top = 0.5
    ws.page_margins.bottom = 0.6
    ws.oddFooter.left.text = company_name or DEFAULT_COMPANY['name']
    ws.oddFooter.left.size = 8
    ws.oddFooter.right.text = "Página &P de &N"
    ws.oddFooter.right.size = 8


# ==================== BLOCOS EXTRAS DAS PLANILHAS ====================
# Pra conteúdo abaixo da tabela principal (totais por moeda, observações,
# dados bancários, tabelas de resumo) no mesmo visual de _bsoft_style_excel.

XL_CURRENCY_FORMATS = {'BRL': 'R$ #,##0.00', 'USD': '$ #,##0.00', 'EUR': '€ #,##0.00'}
XL_DATE = 'dd/mm/yyyy'
XL_DATETIME = 'dd/mm/yyyy hh:mm'
XL_DECIMAL = '#,##0.00'


def _xl_currency_format(currency):
    return XL_CURRENCY_FORMATS.get(currency or 'BRL', 'R$ #,##0.00')


def _xl_date(value):
    """Converte data/ISO em datetime sem fuso (horário de Brasília) pra gravar
    como data de verdade na planilha - ordena e filtra certo no Excel. Datas
    só de dia ('YYYY-MM-DD') viram datetime à meia-noite; valor que não dá pra
    converter volta como veio (texto)."""
    if value in (None, ''):
        return None
    try:
        if isinstance(value, datetime):
            dt = value
        else:
            s = str(value).strip()
            if len(s) == 10:
                return datetime.strptime(s, '%Y-%m-%d')
            dt = datetime.fromisoformat(s.replace('Z', '+00:00'))
        if dt.tzinfo is not None:
            dt = to_brt(dt)
        return dt.replace(tzinfo=None)
    except Exception:
        return value


def _xl_col_span_width(ws, first_col, last_col):
    from openpyxl.utils import get_column_letter
    return sum((ws.column_dimensions[get_column_letter(ci)].width or 8.43) for ci in range(first_col, last_col + 1))


def _xl_section_title(ws, row, first_col, last_col, text):
    """Título de bloco (na cor da marca) mesclado de first_col a last_col."""
    if last_col > first_col:
        ws.merge_cells(start_row=row, start_column=first_col, end_row=row, end_column=last_col)
    c = ws.cell(row=row, column=first_col, value=text)
    c.font = Font(name='Calibri', size=11, bold=True, color=PRIMARY_COLOR)
    c.alignment = Alignment(horizontal='left', vertical='center')
    ws.row_dimensions[row].height = 20
    return row + 1


def _xl_table(ws, start_row, first_col, headers, rows, number_formats=None, center_cols=None, total_values=None):
    """Mini-tabela no padrão das planilhas (cabeçalho na cor da marca,
    filetes, listras e linha de total opcional). `total_values`: valores da
    linha de total, None nas colunas vazias. Retorna a próxima linha livre."""
    number_formats = number_formats or {}
    center_cols = center_cols or set()
    line_side = Side(style='thin', color=BRAND_LINE)
    white_side = Side(style='thin', color='FFFFFF')
    brand_side = Side(style='medium', color=PRIMARY_COLOR)
    left = Alignment(horizontal='left', vertical='center')
    center = Alignment(horizontal='center', vertical='center')
    right = Alignment(horizontal='right', vertical='center')

    r = start_row
    for i, h in enumerate(headers):
        cell = ws.cell(row=r, column=first_col + i, value=h)
        cell.font = Font(name='Calibri', size=10, bold=True, color='FFFFFF')
        cell.fill = _xl_fill(PRIMARY_COLOR)
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        cell.border = Border(left=white_side, right=white_side, bottom=brand_side)
    ws.row_dimensions[r].height = 20
    r += 1
    for k, row in enumerate(rows):
        for i, v in enumerate(row):
            cell = ws.cell(row=r, column=first_col + i, value=v)
            cell.font = Font(name='Calibri', size=10, color=BRAND_TEXT)
            cell.border = Border(bottom=line_side)
            if k % 2 == 1:
                cell.fill = _xl_fill(BRAND_ZEBRA)
            if i in number_formats:
                cell.number_format = number_formats[i]
                cell.alignment = right
            elif i in center_cols:
                cell.alignment = center
            else:
                cell.alignment = left
        r += 1
    if total_values is not None:
        for i, v in enumerate(total_values):
            cell = ws.cell(row=r, column=first_col + i, value=v)
            cell.font = Font(name='Calibri', size=10, bold=True, color=BRAND_DARK)
            cell.fill = _xl_fill(BRAND_SOFT)
            cell.border = Border(top=brand_side, bottom=line_side)
            if i in number_formats and not isinstance(v, str):
                cell.number_format = number_formats[i]
            cell.alignment = right if (i in number_formats or isinstance(v, str)) else left
        ws.row_dimensions[r].height = 20
        r += 1
    return r


def _xl_totals(ws, start_row, label_first_col, label_last_col, value_col, rows, number_format='R$ #,##0.00', highlight_last=True):
    """Quadro de totais (rótulo mesclado à esquerda, valor à direita) com a
    última linha em destaque na cor da marca - mesmo quadro de totais dos PDFs.
    Cada item de `rows` é (rótulo, valor) ou (rótulo, valor, formato)."""
    line_side = Side(style='thin', color=BRAND_LINE)
    r = start_row
    for i, item in enumerate(rows):
        label, value = item[0], item[1]
        fmt = item[2] if len(item) > 2 else number_format
        grand = highlight_last and i == len(rows) - 1
        if label_last_col > label_first_col:
            ws.merge_cells(start_row=r, start_column=label_first_col, end_row=r, end_column=label_last_col)
        lc = ws.cell(row=r, column=label_first_col, value=label)
        vc = ws.cell(row=r, column=value_col, value=value)
        if not isinstance(value, str):
            vc.number_format = fmt
        for ci in list(range(label_first_col, label_last_col + 1)) + [value_col]:
            cell = ws.cell(row=r, column=ci)
            if grand:
                cell.fill = _xl_fill(PRIMARY_COLOR)
            else:
                cell.border = Border(bottom=line_side)
        lc.font = Font(name='Calibri', size=11 if grand else 10, bold=grand, color='FFFFFF' if grand else BRAND_TEXT)
        vc.font = Font(name='Calibri', size=11 if grand else 10, bold=True, color='FFFFFF' if grand else BRAND_DARK)
        lc.alignment = Alignment(horizontal='right', vertical='center', indent=1)
        vc.alignment = Alignment(horizontal='right', vertical='center')
        ws.row_dimensions[r].height = 22 if grand else 18
        r += 1
    return r


def _xl_note(ws, row, first_col, last_col, title, text):
    """Caixa de observações: título na cor da marca + texto (quebras de linha
    preservadas) numa faixa mesclada de fundo suave. Retorna a próxima linha livre."""
    import math
    t = ws.cell(row=row, column=first_col, value=title)
    t.font = Font(name='Calibri', size=10, bold=True, color=PRIMARY_COLOR)
    ws.row_dimensions[row].height = 18
    body_row = row + 1
    if last_col > first_col:
        ws.merge_cells(start_row=body_row, start_column=first_col, end_row=body_row, end_column=last_col)
    body = ws.cell(row=body_row, column=first_col, value=str(text or '-'))
    body.font = Font(name='Calibri', size=10, color=BRAND_TEXT)
    body.alignment = Alignment(horizontal='left', vertical='top', wrap_text=True, indent=1)
    for ci in range(first_col, last_col + 1):
        cell = ws.cell(row=body_row, column=ci)
        cell.fill = _xl_fill('F8FAFC')
        cell.border = Border(
            left=Side(style='medium', color=PRIMARY_COLOR) if ci == first_col else None,
            top=Side(style='thin', color=BRAND_LINE), bottom=Side(style='thin', color=BRAND_LINE),
        )
    chars_per_line = max(20, int(_xl_col_span_width(ws, first_col, last_col) * 1.1))
    n_lines = sum(max(1, math.ceil(len(line) / chars_per_line)) for line in str(text or '-').split('\n'))
    ws.row_dimensions[body_row].height = max(20, 15 * n_lines + 6)
    return body_row + 2


def _xl_key_values(ws, row, first_col, pairs, label_span=2, value_span=4, title=None):
    """Bloco 'rótulo / valor' (ex.: dados bancários), uma linha por par, com
    rótulo e valor em faixas mescladas próprias pra nunca ficarem cortados.
    Retorna a próxima linha livre."""
    last_col = first_col + label_span + value_span - 1
    if title:
        row = _xl_section_title(ws, row, first_col, last_col, title)
    line_side = Side(style='thin', color=BRAND_LINE)
    for label, value in pairs:
        v_first = first_col + label_span
        if label_span > 1:
            ws.merge_cells(start_row=row, start_column=first_col, end_row=row, end_column=v_first - 1)
        if value_span > 1:
            ws.merge_cells(start_row=row, start_column=v_first, end_row=row, end_column=last_col)
        lc = ws.cell(row=row, column=first_col, value=label)
        vc = ws.cell(row=row, column=v_first, value=value)
        lc.font = Font(name='Calibri', size=9, bold=True, color=BRAND_MUTED)
        vc.font = Font(name='Calibri', size=10, bold=True, color=BRAND_DARK)
        lc.alignment = Alignment(horizontal='left', vertical='center', indent=1)
        vc.alignment = Alignment(horizontal='left', vertical='center')
        for ci in range(first_col, last_col + 1):
            cell = ws.cell(row=row, column=ci)
            cell.fill = _xl_fill('F8FAFC')
            cell.border = Border(bottom=line_side)
        ws.row_dimensions[row].height = 18
        row += 1
    return row


def _xl_extend_print_area(ws, last_col_letter, last_row):
    """Estende a área de impressão até last_row (blocos abaixo da tabela)."""
    ws.print_area = f'A1:{last_col_letter}{last_row}'


def generate_stock_report_pdf(products: list, company: dict = None) -> bytes:
    """Gera PDF do Relatório de Estoque no padrão visual dos relatórios
    (cabeçalho + indicadores + tabela + rodapé com páginas)."""
    c = merge_company(company)
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=10*mm,
        leftMargin=10*mm,
        topMargin=12*mm,
        bottomMargin=15*mm
    )

    elements = []
    styles = getSampleStyleSheet()

    logo_buffer = download_logo(company)
    elements.extend(_build_pdf_header(styles, logo_buffer, "Relatório de Estoque", company=company, content_width=doc.width))

    # ========== INDICADORES ==========
    total_value = sum((p.get('stock_quantity') or 0) * (p.get('reference_value') or 0) for p in products)
    zero_stock = sum(1 for p in products if not (p.get('stock_quantity') or 0))
    elements.extend(_build_pdf_summary([
        ("Produtos", _fmt_int(len(products))),
        ("Sem saldo", _fmt_int(zero_stock)),
        ("Valor total em estoque", format_currency(total_value, 'BRL')),
    ], doc.width, max_box_width=200))

    # ========== TABELA ==========
    if products:
        cell = _pdf_cell_factory(styles, font_size=8)
        data = [_pdf_header_cells(['Cód. Produto', 'Almoxarifado', 'Produto', 'Quantidade', 'Valor do Produto'], font_size=8)]
        for p in products:
            qty = p.get('stock_quantity') or 0
            data.append([
                cell(p.get('code', '-'), 'center'),
                cell(p.get('warehouse_name') or '-'),
                cell(p.get('description', '-')),
                cell(None, 'center', markup=_pdf_tone_markup(qty, 'dark' if qty else 'red')),
                cell(format_currency(p.get('reference_value') or 0, 'BRL'), 'right'),
            ])

        col_widths = [75, 170, 360, 80, 100]
        table = Table(data, colWidths=col_widths, repeatRows=1)
        table.setStyle(TableStyle(_pdf_table_style()))
        elements.append(table)
    else:
        elements.append(_pdf_empty_state("Nenhum produto cadastrado.", doc.width))

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    pdf_bytes = buffer.getvalue()
    buffer.close()

    return pdf_bytes


def generate_stock_report_excel(products: list, company: dict = None) -> bytes:
    """Gera Excel do Relatório de Estoque (1 produto por linha)."""
    try:
        c = merge_company(company)
        wb = Workbook()
        ws = wb.active
        ws.title = "Relatório de Estoque"

        total_value = sum((p.get('stock_quantity') or 0) * (p.get('reference_value') or 0) for p in products)
        zero_stock = sum(1 for p in products if not (p.get('stock_quantity') or 0))
        stats_text = (
            f"Produtos: {_fmt_int(len(products))}   •   Sem saldo: {_fmt_int(zero_stock)}   •   "
            f"Valor total em estoque: {format_currency(total_value, 'BRL')}"
        )

        headers = ['Cód. Produto', 'Almoxarifado', 'Produto', 'Quantidade', 'Valor do Produto']
        data_rows = [
            [
                p.get('code', '-'),
                p.get('warehouse_name') or '-',
                p.get('description', '-'),
                p.get('stock_quantity') or 0,
                p.get('reference_value') or 0,
            ]
            for p in products
        ]

        _bsoft_style_excel(
            ws, "Relatório de Estoque", stats_text, headers, data_rows,
            {'B': 14, 'C': 26, 'D': 44, 'E': 13, 'F': 18},
            center_cols={0, 3},
            number_fmt_cols={4: 'R$ #,##0.00'},
            stats_text=stats_text,
            company_name=c['name'],
            logo_buffer=download_logo(company),
            company=company,
            autofilter=True,
            empty_message="Nenhum produto cadastrado.",
        )
        # Produto sem saldo com a quantidade em vermelho (mesmo destaque do PDF)
        _xl_color_column(ws, 3, ['red' if not (p.get('stock_quantity') or 0) else None for p in products])

        buffer = io.BytesIO()
        wb.save(buffer)
        return buffer.getvalue()

    except Exception as e:
        logger.error(f"Error generating stock report Excel: {e}")
        return _xl_error_workbook()


def generate_stock_ledger_report_pdf(rows: list, company: dict = None, report_title: str = "Relatório de Movimentações de Estoque") -> bytes:
    """Extrato de Entradas e Saídas de estoque (StockEntry de NF-e + StockMovement
    manual, já unidos em `rows` por _build_stock_ledger), com a Referência
    (NF/OS/Veículo) na última coluna."""
    c = merge_company(company)
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=10*mm,
        leftMargin=10*mm,
        topMargin=12*mm,
        bottomMargin=15*mm
    )

    elements = []
    styles = getSampleStyleSheet()

    logo_buffer = download_logo(company)
    elements.extend(_build_pdf_header(styles, logo_buffer, report_title, company=company, content_width=doc.width))

    entrada_rows = [r for r in rows if r.get('operation_type') == 'ENTRADA']
    saida_rows = [r for r in rows if r.get('operation_type') == 'SAIDA']
    entrada_total = round(sum(r.get('total_value') or 0 for r in entrada_rows), 2)
    saida_total = round(sum(r.get('total_value') or 0 for r in saida_rows), 2)
    elements.extend(_build_pdf_summary([
        ("Entradas", _fmt_int(len(entrada_rows))),
        ("Valor das entradas", format_currency(entrada_total, 'BRL')),
        ("Saídas", _fmt_int(len(saida_rows))),
        ("Valor das saídas", format_currency(saida_total, 'BRL')),
    ], doc.width))

    if rows:
        cell = _pdf_cell_factory(styles, font_size=7.5)
        table_rows = [_pdf_header_cells(['Data', 'Tipo', 'Produto', 'Almoxarifado', 'Qtd', 'V. Unit.', 'V. Total', 'Referência'], font_size=7.5)]
        for r in rows:
            is_entry = r.get('operation_type') == 'ENTRADA'
            table_rows.append([
                cell(fmt_date(r.get('date')), 'center'),
                cell(None, 'center', markup=_pdf_tone_markup('Entrada' if is_entry else 'Saída', 'primary' if is_entry else 'amber')),
                cell(r.get('product_name') or '-'),
                cell(r.get('warehouse_name') or '-'),
                cell(f"{r.get('quantity', 0):.2f}".replace('.', ','), 'right'),
                cell(format_currency(r.get('unit_value') or 0), 'right'),
                cell(format_currency(r.get('total_value') or 0), 'right'),
                cell(r.get('reference_label') or '-'),
            ])

        col_widths = [doc.width*0.07, doc.width*0.08, doc.width*0.23, doc.width*0.16, doc.width*0.07, doc.width*0.12, doc.width*0.12, doc.width*0.15]
        table = Table(table_rows, colWidths=col_widths, repeatRows=1)
        table.setStyle(TableStyle(_pdf_table_style()))
        elements.append(table)
    else:
        elements.append(_pdf_empty_state("Nenhuma movimentação encontrada para os filtros selecionados.", doc.width))

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def generate_stock_ledger_report_excel(rows: list, company: dict = None, report_title: str = "Relatório de Movimentações de Estoque") -> bytes:
    """Gera Excel do extrato de Entradas e Saídas de estoque (uma linha por item movimentado)."""
    try:
        c = merge_company(company)
        wb = Workbook()
        ws = wb.active
        ws.title = "Movimentações de Estoque"

        entrada_rows = [r for r in rows if r.get('operation_type') == 'ENTRADA']
        saida_rows = [r for r in rows if r.get('operation_type') == 'SAIDA']
        entrada_total = round(sum(r.get('total_value') or 0 for r in entrada_rows), 2)
        saida_total = round(sum(r.get('total_value') or 0 for r in saida_rows), 2)
        stats_text = (
            f"Entradas: {_fmt_int(len(entrada_rows))} ({format_currency(entrada_total)})   •   "
            f"Saídas: {_fmt_int(len(saida_rows))} ({format_currency(saida_total)})"
        )

        headers = ['Data', 'Tipo', 'Produto', 'Almoxarifado', 'Quantidade', 'Valor Unit.', 'Valor Total', 'Referência']
        data_rows = [
            [
                _xl_date(r.get('date')),
                'Entrada' if r.get('operation_type') == 'ENTRADA' else 'Saída',
                r.get('product_name') or '-',
                r.get('warehouse_name') or '-',
                r.get('quantity') or 0,
                r.get('unit_value') or 0,
                r.get('total_value') or 0,
                r.get('reference_label') or '-',
            ]
            for r in rows
        ]

        _bsoft_style_excel(
            ws, report_title, stats_text, headers, data_rows,
            {'B': 12, 'C': 10, 'D': 34, 'E': 22, 'F': 12, 'G': 14, 'H': 14, 'I': 26},
            center_cols={0, 1},
            number_fmt_cols={0: XL_DATE, 4: XL_DECIMAL, 5: 'R$ #,##0.00', 6: 'R$ #,##0.00'},
            stats_text=stats_text,
            company_name=c['name'],
            logo_buffer=download_logo(company),
            company=company,
            autofilter=True,
            empty_message="Nenhuma movimentação encontrada para os filtros selecionados.",
        )
        _xl_color_column(ws, 1, ['primary' if r.get('operation_type') == 'ENTRADA' else 'amber' for r in rows])

        buffer = io.BytesIO()
        wb.save(buffer)
        return buffer.getvalue()

    except Exception as e:
        logger.error(f"Error generating stock ledger report Excel: {e}")
        return _xl_error_workbook()


def generate_delivery_status_excel(status: dict, company: dict = None) -> bytes:
    """Gera Excel de um Status de Entrega (um motorista/veículo por linha)."""
    try:
        c = merge_company(company)
        wb = Workbook()
        ws = wb.active
        ws.title = "Status de Entrega"

        status_date_value = status.get('status_date', '')
        if status_date_value:
            try:
                status_date_value = datetime.fromisoformat(status_date_value.replace('Z', '+00:00')).strftime('%d/%m/%Y')
            except Exception:
                pass

        title = f"Status de Entrega Nº {status.get('status_number', '-')} - Programação #{status.get('schedule_number', '-')}"
        stats_text = (
            f"Cliente destino: {status.get('destination_client_name', '-')}"
            f"   •   Data: {status_date_value or '-'}"
            f"   •   Booking: {status.get('booking') or '-'}"
        )

        items = status.get('items', []) or []
        has_bag_numbers = any((item.get('bag_number') or '').strip() for item in items)

        headers = ['#', 'Motorista', 'CPF', 'Cavalo', 'Carreta', 'Container', 'Local', 'Agend. Porto', 'Chegada', 'Início Carreg.', 'Término Carreg.', 'Saída', 'Entrega Finalizada']
        col_widths = {
            'B': 5, 'C': 28, 'D': 15, 'E': 11, 'F': 11, 'G': 16, 'H': 26,
            'I': 12, 'J': 10, 'K': 13, 'L': 14, 'M': 9, 'N': 16
        }
        center_cols = {0, 2, 3, 4, 7, 8, 9, 10, 11, 12}

        if has_bag_numbers:
            headers.append('Nº da Bolsa')
            longest_bag_number = max((len(item.get('bag_number') or '') for item in items), default=0)
            col_widths['O'] = max(24, longest_bag_number + 8)
            center_cols.add(13)

        data_rows = []
        for idx, item in enumerate(items, 1):
            row = [
                idx,
                item.get('driver_name', '-') or '-',
                item.get('driver_cpf', '-') or '-',
                item.get('cavalo_plate', '-') or '-',
                item.get('carreta_plate', '-') or '-',
                item.get('container_number', '-') or '-',
                item.get('loading_location', '-') or '-',
                item.get('port_schedule_time', '-') or '-',
                item.get('arrival_time', '-') or '-',
                item.get('loading_start_time', '-') or '-',
                item.get('loading_end_time', '-') or '-',
                item.get('departure_time', '-') or '-',
                item.get('delivery_completed', '-') or '-',
            ]
            if has_bag_numbers:
                row.append(item.get('bag_number') or '-')
            data_rows.append(row)

        _bsoft_style_excel(
            ws, title, stats_text, headers, data_rows, col_widths,
            center_cols=center_cols,
            stats_text=stats_text,
            company_name=c['name'],
            logo_buffer=download_logo(company),
            company=company,
            empty_message="Nenhum motorista neste status de entrega.",
        )
        last_row = 9 + max(len(data_rows), 1)
        if status.get('observations'):
            last_row = _xl_note(ws, last_row + 1, 2, 1 + len(headers), "Observações", status['observations'])
            _xl_extend_print_area(ws, 'O' if has_bag_numbers else 'N', last_row)

        buffer = io.BytesIO()
        wb.save(buffer)
        return buffer.getvalue()

    except Exception as e:
        logger.error(f"Error generating delivery status Excel: {e}")
        return _xl_error_workbook()


def generate_excel_report(movements: list, report_title: str = "Relatório de Movimentações", company: dict = None) -> bytes:
    """Generate Excel report following Bsoft template style."""
    try:
        c = merge_company(company)
        wb = Workbook()
        ws = wb.active
        ws.title = "Movimentações"

        total_records = len(movements)
        total_entries = sum(1 for m in movements if m.get('operation_type') == 'ENTRADA')
        total_exits = sum(1 for m in movements if m.get('operation_type') == 'SAIDA')

        total_full = sum(1 for m in movements if m.get('status') == 'CHEIO')
        total_empty = total_records - total_full

        if "Estoque" in report_title:
            stats_text = f"Containers em estoque: {_fmt_int(total_records)}"
        elif "Entradas" in report_title:
            stats_text = f"Total de entradas: {_fmt_int(total_records)}"
        elif "Saídas" in report_title:
            stats_text = f"Total de saídas: {_fmt_int(total_records)}"
        else:
            stats_text = (
                f"Total de registros: {_fmt_int(total_records)}   •   Entradas: {_fmt_int(total_entries)}"
                f"   •   Saídas: {_fmt_int(total_exits)}"
            )
        stats_text += f"   •   Cheios: {_fmt_int(total_full)}   •   Vazios: {_fmt_int(total_empty)}"

        # Headers matching template (14 columns)
        headers = [
            'ID Trans.', 'Data/Hora', 'Tipo', 'Nº Container', 'Motorista',
            'Placa Cavalo', 'Placa Carreta', 'Transportadora', 'Terminal de Origem',
            'Status', 'Tamanho', 'Tara', 'Armador', 'Booking'
        ]

        data_rows = []
        for m in movements:
            # Data/hora como valor de data de verdade (não texto): ordena e
            # filtra corretamente no Excel. openpyxl não aceita fuso -> naive BRT.
            dt_brt = to_brt(m.get('created_at'))
            created_at = dt_brt.replace(tzinfo=None) if dt_brt else str(m.get('created_at', ''))
            data_rows.append([
                m.get('transaction_id', '-'),
                created_at,
                "ENTRADA" if m.get('operation_type') == 'ENTRADA' else "SAÍDA",
                m.get('container_number', '-'),
                m.get('driver_name', '-'),
                m.get('truck_plate', '-'),
                m.get('trailer_plate_1', '-') or '-',
                m.get('transport_company', '-'),
                m.get('origin_terminal', '') or '-',
                m.get('status', 'VAZIO'),
                m.get('size_type', '-'),
                m.get('tare', '') or '-',
                m.get('shipping_line', '-'),
                m.get('booking', '') or '-'
            ])

        # 14 colunas: B a O
        col_widths = {
            'B': 9, 'C': 16, 'D': 10, 'E': 15, 'F': 32, 'G': 11,
            'H': 11, 'I': 26, 'J': 20, 'K': 9, 'L': 12,
            'M': 8, 'N': 16, 'O': 13
        }

        # Centralizadas: ID Trans.(0), Data/Hora(1), Tipo(2), Status(9), Tamanho(10), Tara(11)
        center_cols = {0, 1, 2, 9, 10, 11}

        _bsoft_style_excel(
            ws, report_title, stats_text, headers, data_rows, col_widths,
            center_cols=center_cols,
            number_fmt_cols={1: 'dd/mm/yyyy hh:mm'},
            stats_text=stats_text,
            company_name=c['name'],
            logo_buffer=download_logo(company),
            company=company,
            autofilter=True,
        )

        # Tipo e Status com a mesma cor usada no PDF (Entrada na cor da marca,
        # Saída em âmbar, Cheio em destaque) - dados começam na linha 9.
        entry_font = Font(name='Calibri', size=10, bold=True, color=PRIMARY_COLOR)
        exit_font = Font(name='Calibri', size=10, bold=True, color='B45309')
        full_font = Font(name='Calibri', size=10, bold=True, color=BRAND_DARK)
        for offset, m in enumerate(movements):
            row_num = 9 + offset
            ws.cell(row=row_num, column=4).font = entry_font if m.get('operation_type') == 'ENTRADA' else exit_font
            if m.get('status') == 'CHEIO':
                ws.cell(row=row_num, column=11).font = full_font

        # ========== SAÍDAS POR BOOKING (resumo no final da planilha) ==========
        booking_counts = {}
        for m in movements:
            if m.get('operation_type') == 'SAIDA':
                booking_val = (m.get('booking') or '').strip()
                key = booking_val if booking_val else 'Sem Booking'
                booking_counts[key] = booking_counts.get(key, 0) + 1

        if booking_counts:
            line_border = Border(bottom=Side(style='thin', color=BRAND_LINE))
            header_border = Border(left=Side(style='thin', color='FFFFFF'), right=Side(style='thin', color='FFFFFF'))
            total_border = Border(top=Side(style='medium', color=PRIMARY_COLOR), bottom=Side(style='thin', color=BRAND_LINE))
            header_fill = _xl_fill(PRIMARY_COLOR)
            total_fill = _xl_fill(BRAND_SOFT)
            zebra_fill = _xl_fill(BRAND_ZEBRA)

            start_row = ws.max_row + 3  # deixa espaço da tabela principal
            # Alinhado embaixo das duas últimas colunas da tabela principal
            # (Armador/Booking), não das duas primeiras.
            col_a = 2 + len(headers) - 2
            col_b = col_a + 1

            # Título do bloco
            total_exits_summary = sum(booking_counts.values())
            ws.cell(row=start_row, column=col_a,
                    value=f"Saídas por Booking ({_fmt_int(total_exits_summary)} container{'s' if total_exits_summary != 1 else ''})")
            ws.cell(row=start_row, column=col_a).font = Font(name='Calibri', size=11, bold=True, color=PRIMARY_COLOR)
            ws.merge_cells(start_row=start_row, start_column=col_a, end_row=start_row, end_column=col_b)

            # Cabeçalho da tabela
            header_row = start_row + 1
            ws.cell(row=header_row, column=col_a, value='Booking')
            ws.cell(row=header_row, column=col_b, value='Quantidade (Saída)')
            for col_idx in (col_a, col_b):
                cell = ws.cell(row=header_row, column=col_idx)
                cell.font = Font(name='Calibri', size=10, bold=True, color='FFFFFF')
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.fill = header_fill
                cell.border = header_border
            ws.row_dimensions[header_row].height = 20

            # Linhas de dados (ordenado por quantidade desc, depois alfabético)
            sorted_bookings = sorted(booking_counts.items(), key=lambda x: (-x[1], x[0]))
            current_row = header_row + 1
            for idx, (booking_name, qty) in enumerate(sorted_bookings):
                ws.cell(row=current_row, column=col_a, value=booking_name)
                ws.cell(row=current_row, column=col_b, value=qty)
                ws.cell(row=current_row, column=col_a).alignment = Alignment(horizontal='left', vertical='center')
                ws.cell(row=current_row, column=col_b).alignment = Alignment(horizontal='center', vertical='center')
                for col_idx in (col_a, col_b):
                    cell = ws.cell(row=current_row, column=col_idx)
                    cell.border = line_border
                    cell.font = Font(name='Calibri', size=10, color=BRAND_TEXT)
                    if idx % 2 == 1:
                        cell.fill = zebra_fill
                current_row += 1

            # Linha de total
            ws.cell(row=current_row, column=col_a, value='TOTAL')
            ws.cell(row=current_row, column=col_b, value=total_exits_summary)
            for col_idx in (col_a, col_b):
                cell = ws.cell(row=current_row, column=col_idx)
                cell.font = Font(name='Calibri', size=10, bold=True, color=BRAND_DARK)
                cell.alignment = Alignment(
                    horizontal='left' if col_idx == col_a else 'center', vertical='center'
                )
                cell.fill = total_fill
                cell.border = total_border

            # O resumo de bookings fica abaixo da tabela principal — estende a área
            # de impressão pra ele não ficar de fora ao imprimir/exportar em PDF.
            from openpyxl.utils import get_column_letter as _get_col_letter
            ws.print_area = f'A1:{_get_col_letter(2 + len(headers) - 1)}{current_row}'

        buffer = io.BytesIO()
        wb.save(buffer)
        return buffer.getvalue()

    except Exception as e:
        logger.error(f"Error generating Excel report: {e}")
        wb = Workbook()
        ws = wb.active
        ws['A1'] = "Erro ao gerar relatório."
        ws['A1'].font = Font(size=14, bold=True, color="FF0000")
        buffer = io.BytesIO()
        wb.save(buffer)
        return buffer.getvalue()


def _xl_error_workbook(message="Erro ao gerar relatório."):
    """Planilha mínima devolvida quando a geração falha (mantém a resposta
    como .xlsx válido em vez de estourar o endpoint)."""
    wb = Workbook()
    ws = wb.active
    ws['A1'] = message
    ws['A1'].font = Font(size=14, bold=True, color="FF0000")
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def _xl_color_column(ws, col_idx0, tones, bold=True, first_data_row=9):
    """Pinta o texto de uma coluna da tabela principal conforme `tones`
    (lista com um tom de PDF_TONES por linha, None = mantém) - mesma cor de
    status usada nos PDFs (Entrada/Saída, Pago/Pendente...)."""
    for offset, tone in enumerate(tones):
        if tone:
            ws.cell(row=first_data_row + offset, column=2 + col_idx0).font = Font(
                name='Calibri', size=10, bold=bold, color=PDF_TONES.get(tone, BRAND_DARK))


def generate_yard_control_excel(containers: list, stats: dict, filter_text: str = None, company: dict = None) -> bytes:
    """Controle de Pátio em Excel no padrão das planilhas do sistema: uma linha
    por container, dias no pátio com alerta de permanência (>30, >60 e >90
    dias) e os filtros aplicados na linha de indicadores."""
    try:
        c = merge_company(company)
        wb = Workbook()
        ws = wb.active
        ws.title = "Controle de Pátio"

        stats_text = (
            f"Containers: {_fmt_int(stats['total'])}   •   Cheios/Vazios: {_fmt_int(stats['full'])}/{_fmt_int(stats['empty'])}"
            f"   •   Média de dias: {stats['avg_days']}   •   Máximo: {_fmt_int(stats['max_days'])}"
            f"   •   >30 dias: {_fmt_int(stats['over_30_days'])}   •   >60: {_fmt_int(stats['over_60_days'])}"
            f"   •   >90: {_fmt_int(stats['over_90_days'])}"
        )
        title = "Controle de Pátio" + (f" - {filter_text}" if filter_text else "")

        def op_type(item):
            value = item.get('operation_type') or ('ENTRADA' if item.get('in_stock', True) else 'SAIDA')
            return 'SAÍDA' if value == 'SAIDA' else value

        headers = ["Nº Container", "Tipo", "Status", "Tamanho", "Armador", "Cliente", "Data Entrada", "Data Saída", "Dias no Pátio", "Booking"]
        data_rows = [[
            item['container_number'], op_type(item), item.get('status') or '-', item.get('size_type') or '-',
            item.get('shipping_line') or '-', item.get('client_name') or '-',
            _xl_date(item.get('entry_date')) or '-', _xl_date(item.get('exit_date')) or '-',
            item.get('days_in_yard') or 0, item.get('booking') or '-',
        ] for item in containers]

        _bsoft_style_excel(
            ws, title, stats_text, headers, data_rows,
            {'B': 17, 'C': 11, 'D': 10, 'E': 10, 'F': 18, 'G': 32, 'H': 13, 'I': 13, 'J': 13, 'K': 15},
            center_cols={1, 2, 3, 6, 7, 8},
            number_fmt_cols={6: XL_DATE, 7: XL_DATE},
            stats_text=stats_text,
            company_name=c['name'],
            logo_buffer=download_logo(company),
            company=company,
            autofilter=True,
            empty_message="Nenhum container encontrado para os filtros selecionados.",
        )
        _xl_color_column(ws, 1, ['amber' if op_type(item) == 'SAÍDA' else 'primary' for item in containers])

        # Alerta de permanência na coluna de dias (mesmas faixas dos indicadores)
        for offset, item in enumerate(containers):
            days = item.get('days_in_yard') or 0
            if days > 30:
                cell = ws.cell(row=9 + offset, column=10)
                fill = 'FEE2E2' if days > 90 else 'FED7AA' if days > 60 else 'FEF3C7'
                cell.fill = _xl_fill(fill)
                cell.font = Font(name='Calibri', size=10, bold=True, color=PDF_TONES['red'] if days > 90 else PDF_TONES['amber'])

        buffer = io.BytesIO()
        wb.save(buffer)
        return buffer.getvalue()

    except Exception as e:
        logger.error(f"Error generating yard control Excel: {e}")
        return _xl_error_workbook()


def generate_flex_tank_report_excel(movements: list, company: dict = None, report_title: str = "Relatório de Flex Tank") -> bytes:
    """Movimentações de Flex Tank (bolsas) em Excel no padrão das planilhas
    do sistema: uma linha por movimentação, Entrada/Saída em cor."""
    try:
        c = merge_company(company)
        wb = Workbook()
        ws = wb.active
        ws.title = "Movimentações Flex Tank"

        entries = sum(1 for m in movements if m.get('movement_type') == 'ENTRADA')
        exits = sum(1 for m in movements if m.get('movement_type') == 'SAIDA')
        stats_text = (
            f"Movimentações: {_fmt_int(len(movements))}   •   Entradas: {_fmt_int(entries)}   •   Saídas: {_fmt_int(exits)}"
        )

        headers = ["Nº Registro", "Nº Bolsa", "Tamanho", "Data", "Tipo", "Cliente", "Cliente Destino", "Container", "Observações"]
        data_rows = [[
            m.get("movement_number"), m.get("bag_number") or '-', m.get("bag_size") or '-',
            _xl_date(m.get("movement_date")) or '-',
            'SAÍDA' if m.get("movement_type") == 'SAIDA' else (m.get("movement_type") or '-'),
            m.get("client_name") or "-", m.get("destination_client_name") or "-",
            m.get("container_number") or "-", m.get("observations") or "-",
        ] for m in movements]

        _bsoft_style_excel(
            ws, report_title, stats_text, headers, data_rows,
            {'B': 12, 'C': 22, 'D': 11, 'E': 12, 'F': 10, 'G': 32, 'H': 32, 'I': 17, 'J': 36},
            center_cols={0, 2, 3, 4},
            number_fmt_cols={3: XL_DATE},
            stats_text=stats_text,
            company_name=c['name'],
            logo_buffer=download_logo(company),
            company=company,
            autofilter=True,
            empty_message="Nenhuma movimentação encontrada para os filtros selecionados.",
        )
        _xl_color_column(ws, 4, ['primary' if m.get('movement_type') == 'ENTRADA' else 'amber' for m in movements])

        buffer = io.BytesIO()
        wb.save(buffer)
        return buffer.getvalue()

    except Exception as e:
        logger.error(f"Error generating flex tank Excel: {e}")
        return _xl_error_workbook()


def _write_storage_charges_excel(ws, storage_charges: list, start_row: int) -> int:
    """Escreve a seção de cobrança de Diária de Armazenagem a partir de
    start_row (título + uma tabela por moeda, com subtotal). Retorna a
    próxima linha livre depois da seção. Usado como bloco extra do
    Relatório de Faturamento."""
    if not storage_charges:
        return start_row

    last_row = _xl_section_title(ws, start_row, 2, 8, "Cobrança de Diária de Armazenagem — containers acima do free time")

    by_currency = {}
    for charge in storage_charges:
        by_currency.setdefault(charge.get('currency') or 'BRL', []).append(charge)

    headers = ['Container', 'Cliente', 'Entrada', 'Dias no Pátio', 'Free Time', 'Dias Excedentes', 'Valor']
    for currency, group in by_currency.items():
        money_fmt = _xl_currency_format(currency)
        rows = [[
            charge['container_number'], charge['client_name'], _xl_date(charge['entry_date']),
            charge['days_in_yard'], charge['free_time_days'], charge['extra_days'], charge['service_value'],
        ] for charge in group]
        subtotal = round(sum(charge['service_value'] for charge in group), 2)
        last_row = _xl_table(
            ws, last_row, 2, headers, rows,
            number_formats={2: XL_DATE, 6: money_fmt}, center_cols={3, 4, 5},
            total_values=[None, None, None, None, None, 'SUBTOTAL', subtotal],
        ) + 1

    return last_row + 1


def generate_storage_overage_excel_report(storage_charges: list, company: dict = None, report_title: str = "Relatório de Diárias de Armazenagem") -> bytes:
    """Relatório standalone (Excel) com só a cobrança de Diária de
    Armazenagem - uma linha por container acima do free time, com o total
    separado por moeda (nunca um total único misturando moedas)."""
    try:
        c = merge_company(company)
        wb = Workbook()
        ws = wb.active
        ws.title = "Diárias"

        extra_days_total = sum(charge.get('extra_days') or 0 for charge in storage_charges)
        stats_text = (
            f"Containers em aberto: {_fmt_int(len(storage_charges))}   •   Diárias excedentes: {_fmt_int(extra_days_total)}"
            f"   •   Valor total: {_storage_charges_totals_text(storage_charges)}"
        )

        headers = ['Container', 'Cliente', 'Entrada', 'Dias no Pátio', 'Free Time', 'Dias Excedentes', 'Moeda', 'Valor']
        data_rows = [[
            charge['container_number'], charge['client_name'], _xl_date(charge['entry_date']),
            charge['days_in_yard'], charge['free_time_days'], charge['extra_days'],
            charge.get('currency') or 'BRL', charge['service_value'],
        ] for charge in storage_charges]

        _bsoft_style_excel(
            ws, report_title, stats_text, headers, data_rows,
            {'B': 16, 'C': 30, 'D': 12, 'E': 13, 'F': 11, 'G': 15, 'H': 9, 'I': 15},
            center_cols={2, 3, 4, 5, 6},
            number_fmt_cols={2: XL_DATE, 7: 'R$ #,##0.00'},
            stats_text=stats_text,
            company_name=c['name'],
            logo_buffer=download_logo(company),
            company=company,
            autofilter=True,
            empty_message="Nenhum container em estoque passou do free time configurado na Tabela de Serviços.",
        )

        # Formato de moeda por linha + total por moeda logo abaixo da tabela
        for offset, charge in enumerate(storage_charges):
            ws.cell(row=9 + offset, column=9).number_format = _xl_currency_format(charge.get('currency'))
        _xl_color_column(ws, 5, ['red'] * len(storage_charges))
        if storage_charges:
            totals = {}
            for charge in storage_charges:
                cur = charge.get('currency') or 'BRL'
                totals[cur] = round(totals.get(cur, 0) + (charge.get('service_value') or 0), 2)
            rows = [(f"Total ({cur})" if len(totals) > 1 else "Valor total", v, _xl_currency_format(cur)) for cur, v in totals.items()]
            last_row = _xl_totals(ws, 9 + len(storage_charges) + 1, 6, 8, 9, rows, highlight_last=len(totals) == 1)
            _xl_extend_print_area(ws, 'I', last_row)

        buffer = io.BytesIO()
        wb.save(buffer)
        return buffer.getvalue()

    except Exception as e:
        logger.error(f"Error generating storage overage Excel: {e}")
        return _xl_error_workbook()


def generate_fuel_supply_report_excel(supplies: list, company: dict = None, report_title: str = "Relatório de Abastecimento") -> bytes:
    """Relatório standalone dos Abastecimentos (fuel supply): uma linha por
    abastecimento, com total de litros e de valor."""
    try:
        c = merge_company(company)
        wb = Workbook()
        ws = wb.active
        ws.title = "Abastecimentos"

        total_liters = round(sum(s.get('liters') or 0 for s in supplies), 2)
        total_value = round(sum(s.get('total_value') or 0 for s in supplies), 2)
        avg_price = total_value / total_liters if total_liters else 0
        liters_text = f"{total_liters:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')
        stats_text = (
            f"Abastecimentos: {_fmt_int(len(supplies))}   •   Litros: {liters_text}   •   "
            f"Preço médio/litro: {format_currency(avg_price, 'BRL')}   •   Valor total: {format_currency(total_value, 'BRL')}"
        )

        headers = ['Data', 'Equipamento', 'Motorista', 'Fornecedor', 'Combustível', 'Litros', 'Preço Unit.', 'Valor Total']
        data_rows = [[
            _xl_date(s.get('supply_date')), s.get('equipment_plate') or '-', s.get('driver_name') or '-',
            s.get('supplier_name') or '-', s.get('fuel_type_label') or '-',
            s.get('liters') or 0, s.get('unit_price') or 0, s.get('total_value') or 0,
        ] for s in supplies]

        _bsoft_style_excel(
            ws, report_title, stats_text, headers, data_rows,
            {'B': 12, 'C': 14, 'D': 26, 'E': 26, 'F': 16, 'G': 12, 'H': 13, 'I': 15},
            center_cols={0, 1},
            number_fmt_cols={0: XL_DATE, 5: XL_DECIMAL, 6: 'R$ #,##0.00', 7: 'R$ #,##0.00'},
            total_col=[5, 7],
            stats_text=stats_text,
            company_name=c['name'],
            logo_buffer=download_logo(company),
            company=company,
            autofilter=True,
            empty_message="Nenhum abastecimento encontrado para os filtros selecionados.",
        )
        buffer = io.BytesIO()
        wb.save(buffer)
        return buffer.getvalue()

    except Exception as e:
        logger.error(f"Error generating fuel supply Excel: {e}")
        return _xl_error_workbook()


_OS_STATUS_LABELS_XLSX = {
    "ABERTO": "Aberto", "ANDAMENTO": "Em Andamento", "FECHADO": "Fechado", "CANCELADO": "Cancelado",
}


def generate_service_orders_report_excel(orders: list, company: dict = None, report_title: str = "Relatório de Serviços") -> bytes:
    """Relatório standalone das Ordens de Serviço: uma linha por OS, com a
    situação colorida e o total de valor."""
    try:
        c = merge_company(company)
        wb = Workbook()
        ws = wb.active
        ws.title = "Ordens de Serviço"

        total_value = round(sum(o.get('grand_total') or 0 for o in orders), 2)
        open_count = sum(1 for o in orders if o.get('status') in ('ABERTO', 'ANDAMENTO'))
        closed_count = sum(1 for o in orders if o.get('status') == 'FECHADO')
        stats_text = (
            f"Ordens de serviço: {_fmt_int(len(orders))}   •   Em aberto/andamento: {_fmt_int(open_count)}   •   "
            f"Fechadas: {_fmt_int(closed_count)}   •   Valor total: {format_currency(total_value, 'BRL')}"
        )

        headers = ['Nº OS', 'Data Abertura', 'Equipamento', 'Categoria', 'Status', 'Valor Total']
        data_rows = [[
            o.get('os_number'), _xl_date(o.get('opened_at')), o.get('equipment_plate') or '-',
            o.get('category') or '-', _OS_STATUS_LABELS_XLSX.get(o.get('status'), o.get('status') or '-'),
            o.get('grand_total') or 0,
        ] for o in orders]

        _bsoft_style_excel(
            ws, report_title, stats_text, headers, data_rows,
            {'B': 10, 'C': 17, 'D': 15, 'E': 30, 'F': 16, 'G': 16},
            center_cols={0, 1, 2, 4},
            number_fmt_cols={1: XL_DATETIME, 5: 'R$ #,##0.00'},
            total_col=5,
            stats_text=stats_text,
            company_name=c['name'],
            logo_buffer=download_logo(company),
            company=company,
            autofilter=True,
            empty_message="Nenhuma ordem de serviço encontrada para os filtros selecionados.",
        )
        status_tones = {"ABERTO": 'blue', "ANDAMENTO": 'amber', "FECHADO": 'emerald', "CANCELADO": 'red'}
        _xl_color_column(ws, 4, [status_tones.get(o.get('status')) for o in orders])

        buffer = io.BytesIO()
        wb.save(buffer)
        return buffer.getvalue()

    except Exception as e:
        logger.error(f"Error generating service orders Excel: {e}")
        return _xl_error_workbook()


_TURNO_LABELS_XLSX = {"DIA": "Dia", "NOITE": "Noite"}


def _port_service_xl_rows(services):
    """Linhas da tabela de Serviço Portuário (relatório e fatura usam as mesmas colunas)."""
    return [[
        s.get('service_number'), _xl_date(s.get('service_date')), s.get('client_name') or '-',
        s.get('driver_name') or '-', s.get('cavalo_plate') or '-',
        _TURNO_LABELS_XLSX.get(s.get('turno'), s.get('turno') or '-'),
        s.get('entry_time') or '-', s.get('exit_time') or '-', s.get('operation_value') or 0,
    ] for s in services]


_PORT_SERVICE_XL_HEADERS = ['Nº', 'Data', 'Cliente', 'Motorista', 'Placa', 'Turno', 'Entrada', 'Saída', 'Valor']


_PORT_SERVICE_XL_WIDTHS = {'B': 8, 'C': 12, 'D': 28, 'E': 28, 'F': 12, 'G': 9, 'H': 10, 'I': 10, 'J': 15}


def generate_port_services_report_excel(services: list, company: dict = None, report_title: str = "Relatório de Serviço Portuário") -> bytes:
    """Relatório standalone de Serviço Portuário: uma linha por serviço, com total."""
    try:
        c = merge_company(company)
        wb = Workbook()
        ws = wb.active
        ws.title = "Serviço Portuário"

        total_value = round(sum(s.get('operation_value') or 0 for s in services), 2)
        day_count = sum(1 for s in services if s.get('turno') == 'DIA')
        night_count = sum(1 for s in services if s.get('turno') == 'NOITE')
        stats_text = (
            f"Serviços: {_fmt_int(len(services))}   •   Turno dia: {_fmt_int(day_count)}   •   "
            f"Turno noite: {_fmt_int(night_count)}   •   Valor total: {format_currency(total_value, 'BRL')}"
        )

        _bsoft_style_excel(
            ws, report_title, stats_text, _PORT_SERVICE_XL_HEADERS, _port_service_xl_rows(services),
            _PORT_SERVICE_XL_WIDTHS,
            center_cols={0, 1, 4, 5, 6, 7},
            number_fmt_cols={1: XL_DATE, 8: 'R$ #,##0.00'},
            total_col=8,
            stats_text=stats_text,
            company_name=c['name'],
            logo_buffer=download_logo(company),
            company=company,
            autofilter=True,
            empty_message="Nenhum serviço portuário encontrado para os filtros selecionados.",
        )

        buffer = io.BytesIO()
        wb.save(buffer)
        return buffer.getvalue()

    except Exception as e:
        logger.error(f"Error generating port services Excel: {e}")
        return _xl_error_workbook()


def _format_port_service_period(batch: dict) -> str:
    """Formata period_from/period_to (YYYY-MM-DD) da fatura como
    'DD/MM/YYYY a DD/MM/YYYY', com fallback pra quando um dos dois (ou
    ambos) não foi informado na hora do faturamento."""
    def fmt(d):
        if not d:
            return None
        try:
            return datetime.strptime(d, '%Y-%m-%d').strftime('%d/%m/%Y')
        except Exception:
            return d
    de = fmt(batch.get('period_from'))
    ate = fmt(batch.get('period_to'))
    if de and ate:
        return f"{de} a {ate}"
    return de or ate or '-'


def generate_port_service_invoice_excel(batch: dict, services: list, company: dict = None) -> bytes:
    """Fatura de Serviço Portuário (Financeiro): tabela dos serviços faturados,
    quadro de totais (valor, desconto, total) e observações."""
    try:
        c = merge_company(company)
        wb = Workbook()
        ws = wb.active
        ws.title = "Fatura Serviço Portuário"

        total_value = batch.get('total_value') or 0
        discount_value = batch.get('discount_value') or 0
        net_total = batch.get('net_total')
        if net_total is None:
            net_total = total_value
        title = f"Fatura de Serviço Portuário Nº {batch.get('batch_number', '-')} - Cliente: {batch.get('client_name') or '-'}"
        stats_text = (
            f"Período: {_format_port_service_period(batch)}   •   Serviços: {_fmt_int(batch.get('item_count', len(services)))}"
            f"   •   Valor total: {format_currency(net_total, 'BRL')}"
        )

        _bsoft_style_excel(
            ws, title, stats_text, _PORT_SERVICE_XL_HEADERS, _port_service_xl_rows(services),
            _PORT_SERVICE_XL_WIDTHS,
            center_cols={0, 1, 4, 5, 6, 7},
            number_fmt_cols={1: XL_DATE, 8: 'R$ #,##0.00'},
            stats_text=stats_text,
            company_name=c['name'],
            logo_buffer=download_logo(company),
            company=company,
            empty_message="Nenhum serviço nesta fatura.",
        )

        last_row = 9 + max(len(services), 1) + 1
        last_row = _xl_totals(ws, last_row, 7, 9, 10, [
            ("Valor dos serviços", total_value),
            ("Desconto", discount_value),
            ("Valor total", net_total),
        ])
        if batch.get('observations'):
            last_row = _xl_note(ws, last_row + 1, 2, 10, "Observações", batch['observations'])
        _xl_extend_print_area(ws, 'J', last_row)

        buffer = io.BytesIO()
        wb.save(buffer)
        return buffer.getvalue()

    except Exception as e:
        logger.error(f"Error generating port service invoice Excel: {e}")
        return _xl_error_workbook("Erro ao gerar fatura.")


_MOVEMENT_XL_HEADERS = [
    'ID', 'Data/Hora', 'Tipo', 'Nº Container', 'Cliente',
    'Placa', 'Transportadora', 'Armador', 'Status', 'Tamanho',
    'Tipo de Serviço', 'Nota Fiscal', 'Valor da Operação'
]


_MOVEMENT_XL_WIDTHS = {
    'B': 8, 'C': 16, 'D': 10, 'E': 15, 'F': 28,
    'G': 11, 'H': 22, 'I': 15, 'J': 9, 'K': 10,
    'L': 22, 'M': 12, 'N': 17
}


def _movement_xl_rows(movements):
    """Linhas de movimentação pra Faturamento e Fatura (mesmas colunas)."""
    return [[
        m.get('transaction_id', '-'),
        _xl_date(m.get('created_at')),
        "ENTRADA" if m.get('operation_type') == 'ENTRADA' else "SAÍDA",
        m.get('container_number') or '-',
        m.get('client_name') or '-',
        m.get('truck_plate') or '-',
        m.get('transport_company') or '-',
        m.get('shipping_line') or '-',
        m.get('status') or '-',
        m.get('size_type') or '-',
        m.get('service_type', '') or '-',
        m.get('invoice_number', '') or '-',
        m.get('service_value') if m.get('service_value') else 0,
    ] for m in movements]


def _bank_pairs(c):
    return [
        ("Banco", c['bank_name']),
        ("Agência", c['bank_agency']),
        ("Conta corrente", c['bank_account']),
        ("Chave PIX", c['pix_key']),
        ("Beneficiário", c['name']),
        ("CNPJ", c['cnpj']),
    ]


def generate_billing_excel(movements: list, company: dict = None, storage_charges: list = None) -> bytes:
    """Relatório de Faturamento em Excel: uma linha por movimentação (valor na
    moeda de cada uma), total por moeda, diárias de armazenagem em aberto e
    dados bancários."""
    try:
        c = merge_company(company)
        wb = Workbook()
        ws = wb.active
        ws.title = "Faturamento"

        # Cada movimentação carrega sua própria moeda (campo "currency") -
        # mesma lógica multi-moeda do PDF: soma por moeda, só junta num texto
        # "R$ X + $ Y" quando o relatório mistura mais de uma.
        currency_totals = {}
        for m in movements:
            cur = m.get('currency') or 'BRL'
            currency_totals[cur] = currency_totals.get(cur, 0) + (m.get('service_value') or 0)
        single_currency = next(iter(currency_totals), 'BRL') if len(currency_totals) <= 1 else None
        if single_currency:
            val_str = format_currency(currency_totals.get(single_currency, 0), single_currency)
        else:
            val_str = ' + '.join(format_currency(v, cur) for cur, v in currency_totals.items())
        total_billed = sum(1 for m in movements if m.get('billed'))
        stats_text = (
            f"Movimentações: {_fmt_int(len(movements))}   •   Faturadas: {_fmt_int(total_billed)}   •   "
            f"Não faturadas: {_fmt_int(len(movements) - total_billed)}   •   Valor total: {val_str}"
        )

        default_value_format = _xl_currency_format(single_currency or 'BRL')
        _bsoft_style_excel(
            ws, "Relatório de Faturamento", stats_text, _MOVEMENT_XL_HEADERS, _movement_xl_rows(movements),
            _MOVEMENT_XL_WIDTHS,
            center_cols={0, 1, 2, 8, 9},
            number_fmt_cols={1: XL_DATETIME, 12: default_value_format},
            total_col=12 if single_currency else None,
            total_number_format=default_value_format,
            stats_text=stats_text,
            company_name=c['name'],
            logo_buffer=download_logo(company),
            company=company,
            autofilter=True,
            empty_message="Nenhuma movimentação encontrada para os filtros selecionados.",
        )
        _xl_color_column(ws, 2, ['primary' if m.get('operation_type') == 'ENTRADA' else 'amber' for m in movements])

        # Mistura de moedas: cada linha no formato da sua moeda e o total vira
        # um quadro com uma linha por moeda - nunca um SUM único misturando moedas.
        next_row = 9 + max(len(movements), 1) + 1
        if not single_currency:
            for idx, m in enumerate(movements):
                ws.cell(row=9 + idx, column=14).number_format = _xl_currency_format(m.get('currency'))
            next_row = _xl_totals(ws, next_row, 11, 13, 14, [
                (f"Total ({cur})", round(v, 2), _xl_currency_format(cur)) for cur, v in currency_totals.items()
            ], highlight_last=False)

        # ========== DIÁRIAS DE ARMAZENAGEM EM ABERTO ==========
        # Seção adicional, calculada na hora (nada é persistido) - containers
        # em estoque que já passaram do free time acordado na Tabela de
        # Serviços. Cada moeda presente ganha seu próprio subtotal.
        next_row = _write_storage_charges_excel(ws, storage_charges, next_row + 1)

        # ========== DADOS BANCÁRIOS ==========
        last_row = _xl_key_values(ws, next_row + 1, 2, _bank_pairs(c), label_span=2, value_span=5,
                                  title="Dados bancários para pagamento")
        _xl_extend_print_area(ws, 'N', last_row)

        buffer = io.BytesIO()
        wb.save(buffer)
        return buffer.getvalue()

    except Exception as e:
        logger.error(f"Error generating billing Excel: {e}")
        return _xl_error_workbook()


def generate_billing_pdf_report(movements: list, report_title: str = "Relatório de Faturamento", company: dict = None, storage_charges: list = None) -> bytes:
    """
    Relatório de Faturamento no padrão visual dos relatórios: cabeçalho,
    indicadores, tabela com colunas financeiras + linha de total e, se houver,
    a seção de Diárias de Armazenagem em aberto.
    """
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=10*mm,
        leftMargin=10*mm,
        topMargin=12*mm,
        bottomMargin=15*mm
    )

    c = merge_company(company)
    elements = []
    styles = getSampleStyleSheet()

    # ========== CABEÇALHO ==========
    logo_buffer = download_logo(company)
    elements.extend(_build_pdf_header(styles, logo_buffer, report_title, company=company, content_width=doc.width))

    # ========== INDICADORES ==========
    # Cada movimentação carrega sua própria moeda (campo "currency", BRL por
    # padrão) - clientes do exterior podem ter sido cadastrados em USD (ver
    # Tabela de Serviços). Soma-se por moeda em vez de tratar tudo como R$,
    # e só junta num texto único "R$ X + $ Y" quando o relatório mistura
    # mais de uma moeda (o comum é uma só, especialmente com filtro de cliente).
    total_records = len(movements)
    currency_totals = {}
    for m in movements:
        cur = m.get('currency') or 'BRL'
        currency_totals[cur] = currency_totals.get(cur, 0) + (m.get('service_value') or 0)
    if len(currency_totals) <= 1:
        value_str = format_currency(next(iter(currency_totals.values()), 0), next(iter(currency_totals), 'BRL'))
    else:
        value_str = ' + '.join(format_currency(v, cur) for cur, v in currency_totals.items())
    total_billed = sum(1 for m in movements if m.get('billed'))
    total_unbilled = total_records - total_billed

    elements.extend(_build_pdf_summary([
        ("Movimentações", _fmt_int(total_records)),
        ("Faturadas", _fmt_int(total_billed)),
        ("Não faturadas", _fmt_int(total_unbilled)),
        ("Valor total", value_str),
    ], doc.width, max_box_width=190))

    # ========== TABELA ==========
    # Células em Paragraph pra quebrar linha dentro da própria célula em vez
    # de vazar pra vizinha (Cliente, Transportadora) - mesma técnica da Fatura.
    cell = _pdf_cell_factory(styles)

    data = [_pdf_header_cells([
        'ID', 'Data/Hora', 'Tipo', 'Nº Container', 'Cliente', 'Placa',
        'Transportadora', 'Armador', 'Status', 'Tamanho',
        'Tipo Serviço', 'Nota Fiscal', 'Valor'
    ])]

    for m in movements:
        dt_brt = to_brt(m.get('created_at'))
        created_at = dt_brt.strftime('%d/%m/%Y %H:%M') if dt_brt else str(m.get('created_at', '-'))

        service_value = m.get('service_value')
        val_str = format_currency(service_value, m.get('currency') or 'BRL') if service_value else '-'
        is_entry = m.get('operation_type') == 'ENTRADA'

        data.append([
            cell(m.get('transaction_id', '-'), 'center'),
            cell(created_at),
            cell(None, 'center', markup=_pdf_tone_markup('ENTRADA' if is_entry else 'SAÍDA', 'primary' if is_entry else 'amber')),
            cell(m.get('container_number', '-')),
            cell(m.get('client_name', '-') or '-'),
            cell(m.get('truck_plate', '-') or '-'),
            cell(m.get('transport_company', '-') or '-'),
            cell(m.get('shipping_line', '-') or '-'),
            cell(m.get('status', '-') or '-', 'center'),
            cell(m.get('size_type', '-') or '-', 'center'),
            cell(m.get('service_type', '-') or '-'),
            cell(m.get('invoice_number', '-') or '-'),
            cell(val_str, 'right'),
        ])

    data.append([''] * 11 + [cell('TOTAL', 'right', bold=True), cell(value_str, 'right', bold=True)])

    col_widths = [28, 68, 46, 62, 104, 50, 84, 60, 38, 42, 80, 52, 71]
    table = Table(data, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle(_pdf_table_style(total_row=True) + [
        ('TOPPADDING', (0, -1), (-1, -1), 6),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 6),
    ]))
    elements.append(table)

    # ========== DIÁRIAS DE ARMAZENAGEM EM ABERTO ==========
    # Seção adicional, calculada na hora (nada é persistido) - containers em
    # estoque que já passaram do free time acordado na Tabela de Serviços.
    # Não soma com o total de movimentações acima: cada moeda presente ganha
    # sua própria subtabela/subtotal, nunca um total único misturando moedas.
    elements.extend(_build_storage_charges_pdf_elements(styles, doc.width, storage_charges))

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    pdf_bytes = buffer.getvalue()
    buffer.close()

    return pdf_bytes


def _build_storage_charges_pdf_elements(styles, doc_width, storage_charges: list) -> list:
    """Monta os elementos (título + uma tabela por moeda, com subtotal) da
    cobrança de Diária de Armazenagem. Reaproveitado como seção extra do
    Relatório de Faturamento e como corpo do Relatório de Diárias
    standalone (generate_storage_overage_pdf_report)."""
    if not storage_charges:
        return []

    elements = _pdf_section_title("Cobrança de Diária de Armazenagem — containers acima do free time", doc_width)
    cell = _pdf_cell_factory(styles, font_size=7.5)

    by_currency = {}
    for charge in storage_charges:
        by_currency.setdefault(charge.get('currency') or 'BRL', []).append(charge)

    for currency, group in by_currency.items():
        rows = [_pdf_header_cells(['Container', 'Cliente', 'Entrada', 'Dias no Pátio', 'Free Time', 'Dias Excedentes', 'Valor'], font_size=7.5)]
        for charge in group:
            rows.append([
                cell(charge['container_number'], bold=True),
                cell(charge['client_name']),
                cell(charge['entry_date'].strftime('%d/%m/%Y'), 'center'),
                cell(charge['days_in_yard'], 'center'),
                cell(charge['free_time_days'], 'center'),
                cell(None, 'center', markup=_pdf_tone_markup(charge['extra_days'], 'red')),
                cell(format_currency(charge['service_value'], currency), 'right'),
            ])
        subtotal = round(sum(charge['service_value'] for charge in group), 2)
        rows.append([''] * 5 + [cell('SUBTOTAL', 'right', bold=True), cell(format_currency(subtotal, currency), 'right', bold=True)])

        storage_table = Table(rows, colWidths=[doc_width*0.14, doc_width*0.26, doc_width*0.12, doc_width*0.12, doc_width*0.1, doc_width*0.12, doc_width*0.14], repeatRows=1)
        storage_table.setStyle(TableStyle(_pdf_table_style(total_row=True)))
        elements.append(storage_table)
        elements.append(Spacer(1, 10))

    return elements


def _storage_charges_totals_text(storage_charges: list) -> str:
    """'Valor Total: R$ X' ou, quando há mais de uma moeda, 'R$ X + $ Y'."""
    currency_totals = {}
    for charge in storage_charges:
        cur = charge.get('currency') or 'BRL'
        currency_totals[cur] = currency_totals.get(cur, 0) + (charge.get('service_value') or 0)
    if len(currency_totals) <= 1:
        return format_currency(next(iter(currency_totals.values()), 0), next(iter(currency_totals), 'BRL'))
    return ' + '.join(format_currency(v, cur) for cur, v in currency_totals.items())


def generate_storage_overage_pdf_report(storage_charges: list, company: dict = None, report_title: str = "Relatório de Diárias de Armazenagem") -> bytes:
    """Relatório standalone com só a cobrança de Diária de Armazenagem
    (containers em estoque acima do free time cadastrado na Tabela de
    Serviços) - mesmo cálculo/seção usados no Relatório de Faturamento,
    mas sem misturar com a lista de movimentações."""
    c = merge_company(company)
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=10*mm,
        leftMargin=10*mm,
        topMargin=12*mm,
        bottomMargin=15*mm
    )

    elements = []
    styles = getSampleStyleSheet()

    logo_buffer = download_logo(company)
    elements.extend(_build_pdf_header(styles, logo_buffer, report_title, company=company, content_width=doc.width))

    extra_days_total = sum(charge.get('extra_days') or 0 for charge in storage_charges)
    elements.extend(_build_pdf_summary([
        ("Containers em aberto", _fmt_int(len(storage_charges))),
        ("Diárias excedentes", _fmt_int(extra_days_total)),
        ("Valor total", _storage_charges_totals_text(storage_charges)),
    ], doc.width, max_box_width=200))

    if storage_charges:
        elements.extend(_build_storage_charges_pdf_elements(styles, doc.width, storage_charges))
    else:
        elements.append(_pdf_empty_state("Nenhum container em estoque passou do free time configurado na Tabela de Serviços.", doc.width))

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def generate_fuel_supply_report_pdf(supplies: list, company: dict = None, report_title: str = "Relatório de Abastecimento") -> bytes:
    """Relatório standalone dos Abastecimentos (fuel supply) no padrão visual
    dos relatórios: indicadores (contagem/litros/valor) + uma linha por
    abastecimento + total."""
    c = merge_company(company)
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=10*mm,
        leftMargin=10*mm,
        topMargin=12*mm,
        bottomMargin=15*mm
    )

    elements = []
    styles = getSampleStyleSheet()

    logo_buffer = download_logo(company)
    elements.extend(_build_pdf_header(styles, logo_buffer, report_title, company=company, content_width=doc.width))

    def fmt_liters(value):
        return f"{(value or 0):,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')

    total_liters = round(sum(s.get('liters') or 0 for s in supplies), 2)
    total_value = round(sum(s.get('total_value') or 0 for s in supplies), 2)
    avg_price = total_value / total_liters if total_liters else 0
    elements.extend(_build_pdf_summary([
        ("Abastecimentos", _fmt_int(len(supplies))),
        ("Litros", fmt_liters(total_liters)),
        ("Preço médio / litro", format_currency(avg_price, 'BRL')),
        ("Valor total", format_currency(total_value, 'BRL')),
    ], doc.width))

    if supplies:
        cell = _pdf_cell_factory(styles, font_size=8)
        rows = [_pdf_header_cells(['Data', 'Equipamento', 'Motorista', 'Fornecedor', 'Combustível', 'Litros', 'Preço Unit.', 'Valor Total'], font_size=8)]
        for s in supplies:
            rows.append([
                cell(fmt_date(s.get('supply_date')), 'center'),
                cell(s.get('equipment_plate') or '-', bold=True),
                cell(s.get('driver_name') or '-'),
                cell(s.get('supplier_name') or '-'),
                cell(s.get('fuel_type_label') or '-'),
                cell(fmt_liters(s.get('liters')), 'right'),
                cell(format_currency(s.get('unit_price') or 0), 'right'),
                cell(format_currency(s.get('total_value') or 0), 'right'),
            ])
        rows.append([''] * 4 + [cell('TOTAL', 'right', bold=True), cell(fmt_liters(total_liters), 'right', bold=True), '', cell(format_currency(total_value), 'right', bold=True)])

        col_widths = [doc.width*0.09, doc.width*0.12, doc.width*0.16, doc.width*0.18, doc.width*0.13, doc.width*0.1, doc.width*0.11, doc.width*0.11]
        table = Table(rows, colWidths=col_widths, repeatRows=1)
        table.setStyle(TableStyle(_pdf_table_style(total_row=True)))
        elements.append(table)
    else:
        elements.append(_pdf_empty_state("Nenhum abastecimento encontrado para os filtros selecionados.", doc.width))

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


_OS_STATUS_LABELS_PDF = {
    "ABERTO": "Aberto", "ANDAMENTO": "Em Andamento", "FECHADO": "Fechado", "CANCELADO": "Cancelado",
}


def generate_service_orders_report_pdf(orders: list, company: dict = None, report_title: str = "Relatório de Serviços") -> bytes:
    """Relatório standalone das Ordens de Serviço no padrão visual dos
    relatórios: indicadores (contagem por situação/valor) + uma linha por OS."""
    c = merge_company(company)
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=10*mm,
        leftMargin=10*mm,
        topMargin=12*mm,
        bottomMargin=15*mm
    )

    elements = []
    styles = getSampleStyleSheet()

    logo_buffer = download_logo(company)
    elements.extend(_build_pdf_header(styles, logo_buffer, report_title, company=company, content_width=doc.width))

    total_value = round(sum(o.get('grand_total') or 0 for o in orders), 2)
    open_count = sum(1 for o in orders if o.get('status') in ('ABERTO', 'ANDAMENTO'))
    closed_count = sum(1 for o in orders if o.get('status') == 'FECHADO')
    elements.extend(_build_pdf_summary([
        ("Ordens de serviço", _fmt_int(len(orders))),
        ("Em aberto / andamento", _fmt_int(open_count)),
        ("Fechadas", _fmt_int(closed_count)),
        ("Valor total", format_currency(total_value, 'BRL')),
    ], doc.width))

    status_tones = {"ABERTO": 'blue', "ANDAMENTO": 'amber', "FECHADO": 'emerald', "CANCELADO": 'red'}

    if orders:
        cell = _pdf_cell_factory(styles, font_size=8)
        rows = [_pdf_header_cells(['Nº OS', 'Data Abertura', 'Equipamento', 'Categoria', 'Status', 'Valor Total'], font_size=8)]
        for o in orders:
            status = o.get('status')
            rows.append([
                cell(o.get('os_number') or '-', 'center', bold=True),
                cell(fmt_datetime(o.get('opened_at')), 'center'),
                cell(o.get('equipment_plate') or '-'),
                cell(o.get('category') or '-'),
                cell(None, 'center', markup=_pdf_tone_markup(_OS_STATUS_LABELS_PDF.get(status, status or '-'), status_tones.get(status, 'slate'))),
                cell(format_currency(o.get('grand_total') or 0), 'right'),
            ])
        rows.append([''] * 4 + [cell('TOTAL', 'right', bold=True), cell(format_currency(total_value), 'right', bold=True)])

        col_widths = [doc.width*0.1, doc.width*0.18, doc.width*0.18, doc.width*0.26, doc.width*0.14, doc.width*0.14]
        table = Table(rows, colWidths=col_widths, repeatRows=1)
        table.setStyle(TableStyle(_pdf_table_style(total_row=True)))
        elements.append(table)
    else:
        elements.append(_pdf_empty_state("Nenhuma ordem de serviço encontrada para os filtros selecionados.", doc.width))

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


_TURNO_LABELS_PDF = {"DIA": "Dia", "NOITE": "Noite"}


def _port_service_rows(services, cell):
    """Linhas da tabela de Serviço Portuário (relatório e fatura usam as mesmas colunas)."""
    rows = []
    for s in services:
        date_display = s.get('service_date') or '-'
        try:
            date_display = datetime.strptime(s['service_date'], '%Y-%m-%d').strftime('%d/%m/%Y')
        except Exception:
            pass
        rows.append([
            cell(s.get('service_number') or '-', 'center', bold=True),
            cell(date_display, 'center'),
            cell(s.get('client_name') or '-'),
            cell(s.get('driver_name') or '-'),
            cell(s.get('cavalo_plate') or '-', 'center'),
            cell(_TURNO_LABELS_PDF.get(s.get('turno'), s.get('turno') or '-'), 'center'),
            cell(s.get('entry_time') or '-', 'center'),
            cell(s.get('exit_time') or '-', 'center'),
            cell(format_currency(s.get('operation_value') or 0), 'right'),
        ])
    return rows


_PORT_SERVICE_HEADERS = ['Nº', 'Data', 'Cliente', 'Motorista', 'Placa', 'Turno', 'Entrada', 'Saída', 'Valor']


def generate_port_services_report_pdf(services: list, company: dict = None, report_title: str = "Relatório de Serviço Portuário") -> bytes:
    """Relatório standalone de Serviço Portuário no padrão visual dos
    relatórios: indicadores (contagem/turnos/valor) + uma linha por serviço."""
    c = merge_company(company)
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=10*mm,
        leftMargin=10*mm,
        topMargin=12*mm,
        bottomMargin=15*mm
    )

    elements = []
    styles = getSampleStyleSheet()

    logo_buffer = download_logo(company)
    elements.extend(_build_pdf_header(styles, logo_buffer, report_title, company=company, content_width=doc.width))

    total_value = round(sum(s.get('operation_value') or 0 for s in services), 2)
    day_count = sum(1 for s in services if s.get('turno') == 'DIA')
    night_count = sum(1 for s in services if s.get('turno') == 'NOITE')
    elements.extend(_build_pdf_summary([
        ("Serviços", _fmt_int(len(services))),
        ("Turno dia", _fmt_int(day_count)),
        ("Turno noite", _fmt_int(night_count)),
        ("Valor total", format_currency(total_value, 'BRL')),
    ], doc.width))

    if services:
        cell = _pdf_cell_factory(styles, font_size=8)
        rows = [_pdf_header_cells(_PORT_SERVICE_HEADERS, font_size=8)] + _port_service_rows(services, cell)
        rows.append([''] * 7 + [cell('TOTAL', 'right', bold=True), cell(format_currency(total_value), 'right', bold=True)])

        col_widths = [doc.width*0.06, doc.width*0.1, doc.width*0.2, doc.width*0.2, doc.width*0.1, doc.width*0.08, doc.width*0.08, doc.width*0.08, doc.width*0.1]
        table = Table(rows, colWidths=col_widths, repeatRows=1)
        table.setStyle(TableStyle(_pdf_table_style(total_row=True)))
        elements.append(table)
    else:
        elements.append(_pdf_empty_state("Nenhum serviço portuário encontrado para os filtros selecionados.", doc.width))

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def generate_port_service_invoice_pdf(batch: dict, services: list, company: dict = None) -> bytes:
    """Fatura de Serviço Portuário (Financeiro): quadro com os dados da fatura
    (cliente, período, serviços), tabela dos serviços faturados, quadro de
    totais (valor, desconto, total) e observações."""
    c = merge_company(company)
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=10*mm,
        leftMargin=10*mm,
        topMargin=12*mm,
        bottomMargin=15*mm
    )

    elements = []
    styles = getSampleStyleSheet()

    logo_buffer = download_logo(company)
    report_title = f"Fatura de Serviço Portuário Nº {batch.get('batch_number', '-')}"
    elements.extend(_build_pdf_header(styles, logo_buffer, report_title, company=company, content_width=doc.width))

    total_value = batch.get('total_value') or 0
    discount_value = batch.get('discount_value') or 0
    net_total = batch.get('net_total')
    if net_total is None:
        net_total = total_value

    elements.append(_pdf_info_grid([
        ("Cliente", batch.get('client_name') or '-', 2),
        ("Período", _format_port_service_period(batch)),
        ("Serviços", _fmt_int(batch.get('item_count', len(services)))),
    ], doc.width, cols=4))
    elements.append(Spacer(1, 10))

    if services:
        cell = _pdf_cell_factory(styles, font_size=8)
        rows = [_pdf_header_cells(_PORT_SERVICE_HEADERS, font_size=8)] + _port_service_rows(services, cell)
        col_widths = [doc.width*0.06, doc.width*0.1, doc.width*0.2, doc.width*0.2, doc.width*0.1, doc.width*0.08, doc.width*0.08, doc.width*0.08, doc.width*0.1]
        table = Table(rows, colWidths=col_widths, repeatRows=1)
        table.setStyle(TableStyle(_pdf_table_style()))
        elements.append(table)
        elements.append(Spacer(1, 8))
        elements.append(_pdf_totals_box([
            ("Valor dos serviços", format_currency(total_value, 'BRL')),
            ("Desconto", format_currency(discount_value, 'BRL')),
            ("Valor total", format_currency(net_total, 'BRL')),
        ], doc.width))

        if batch.get('observations'):
            elements.append(Spacer(1, 10))
            elements.append(_pdf_note_box("Observações", batch['observations'], doc.width))
    else:
        elements.append(_pdf_empty_state("Nenhum serviço nesta fatura.", doc.width))

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def generate_invoice_pdf(invoice: dict, movements: list, company: dict = None) -> bytes:
    """
    Fatura (movimentações) no padrão visual dos documentos: cabeçalho, quadro
    com os dados do cliente, tabela das movimentações, quadro de totais,
    observações e dados bancários pra pagamento.
    """
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=10*mm,
        leftMargin=10*mm,
        topMargin=12*mm,
        bottomMargin=15*mm
    )

    c = merge_company(company)
    elements = []
    styles = getSampleStyleSheet()

    # ========== CABEÇALHO ==========
    logo_buffer = download_logo(company)
    report_title = f"Fatura Nº {invoice.get('invoice_number', '-')}"
    elements.extend(_build_pdf_header(styles, logo_buffer, report_title, company=company, content_width=doc.width))

    # ========== DADOS DO CLIENTE ==========
    total_value = sum(m.get('service_value', 0) or 0 for m in movements)
    total_str = format_currency(total_value, 'BRL')

    # Movimentações com Valor da Operação zerado/vazio não aparecem na fatura
    # impressa - não somam nada ao total, então ocultá-las não afeta o valor.
    visible_movements = [m for m in movements if (m.get('service_value') or 0) != 0]

    issued = to_brt(invoice.get('created_at'))
    elements.append(_pdf_info_grid([
        ("Cliente", invoice.get('client_name', '-'), 2),
        ("CNPJ", invoice.get('client_cnpj', '-') or '-'),
        ("Data de emissão", issued.strftime('%d/%m/%Y') if issued else '-'),
    ], doc.width, cols=4))
    elements.append(Spacer(1, 10))

    # ========== MOVIMENTAÇÕES ==========
    # Células em Paragraph pra quebrar linha dentro da própria célula em vez
    # de vazar pra vizinha (Cliente, Transportadora).
    cell = _pdf_cell_factory(styles)

    table_data = [_pdf_header_cells([
        'ID', 'Data/Hora', 'Tipo', 'Nº Container', 'Cliente', 'Placa',
        'Transportadora', 'Armador', 'Status', 'Tamanho',
        'Tipo de Serviço', 'Nota Fiscal', 'Valor da Operação'
    ])]

    for m in visible_movements:
        _m_dt = to_brt(m.get('created_at'))
        mov_date = _m_dt.strftime('%d/%m/%Y %H:%M') if _m_dt else '-'
        service_value = m.get('service_value')
        value_str = format_currency(service_value, 'BRL') if service_value else '-'
        is_entry = m.get('operation_type') == 'ENTRADA'

        table_data.append([
            cell(m.get('transaction_id', '-'), 'center'),
            cell(mov_date),
            cell(None, 'center', markup=_pdf_tone_markup('ENTRADA' if is_entry else 'SAÍDA', 'primary' if is_entry else 'amber')),
            cell(m.get('container_number', '-')),
            cell(m.get('client_name', '-') or '-'),
            cell(m.get('truck_plate', '-') or '-'),
            cell(m.get('transport_company', '-') or '-'),
            cell(m.get('shipping_line', '-') or '-'),
            cell(m.get('status', '-') or '-', 'center'),
            cell(m.get('size_type', '-') or '-', 'center'),
            cell(m.get('service_type', '-') or '-'),
            cell(m.get('invoice_number', '-') or '-'),
            cell(value_str, 'right'),
        ])

    col_widths = [28, 68, 46, 62, 104, 50, 84, 60, 38, 42, 80, 52, 71]
    table = Table(table_data, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle(_pdf_table_style()))
    elements.append(table)
    elements.append(Spacer(1, 8))
    elements.append(_pdf_totals_box([
        ("Movimentações", _fmt_int(len(visible_movements))),
        ("Valor total", total_str),
    ], doc.width))

    # ========== OBSERVAÇÕES ==========
    if invoice.get('notes'):
        elements.append(Spacer(1, 10))
        elements.append(_pdf_note_box("Observações", invoice.get('notes', ''), doc.width))

    # ========== DADOS BANCÁRIOS ==========
    # A versão Excel desta mesma fatura já traz os dados de pagamento — o PDF
    # (o formato que de fato vai pro cliente) precisa da mesma informação.
    elements.extend(_pdf_section_title("Dados bancários para pagamento", doc.width))
    elements.append(_pdf_info_grid([
        ("Banco", c['bank_name']),
        ("Agência", c['bank_agency']),
        ("Conta corrente", c['bank_account']),
        ("Chave PIX", c['pix_key']),
        ("Beneficiário", c['name'], 2),
        ("CNPJ", c['cnpj'], 2),
    ], doc.width, cols=4))

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    pdf_bytes = buffer.getvalue()
    buffer.close()

    return pdf_bytes


def generate_invoice_excel(invoice: dict, movements: list, company: dict = None) -> bytes:
    """Fatura (movimentações) em Excel: tabela das movimentações com total,
    observações e dados bancários pra pagamento."""
    try:
        c = merge_company(company)
        wb = Workbook()
        ws = wb.active
        # Nomes de planilha no Excel: máx. 31 caracteres, sem \ / ? * [ ] :
        sheet_title = re.sub(r'[\\/?*\[\]:]', '-', f"Fatura {invoice.get('invoice_number', '')}").strip()
        ws.title = sheet_title[:31] or "Fatura"

        _inv_dt = to_brt(invoice.get('created_at'))
        issued = _inv_dt.strftime('%d/%m/%Y') if _inv_dt else '-'

        # Movimentações com Valor da Operação zerado/vazio não aparecem na
        # fatura exportada - não somam nada ao total, então ocultá-las não
        # afeta o valor (mesmo critério do PDF).
        visible_movements = [m for m in movements if (m.get('service_value') or 0) != 0]
        total_value = sum(m.get('service_value', 0) or 0 for m in movements)

        title = f"Fatura Nº {invoice.get('invoice_number', '-')} - Cliente: {invoice.get('client_name', '-')}"
        stats_text = (
            f"CNPJ: {invoice.get('client_cnpj') or '-'}   •   Data de emissão: {issued}   •   "
            f"Movimentações: {_fmt_int(len(visible_movements))}   •   Valor total: {format_currency(total_value, 'BRL')}"
        )

        _bsoft_style_excel(
            ws, title, stats_text, _MOVEMENT_XL_HEADERS, _movement_xl_rows(visible_movements),
            _MOVEMENT_XL_WIDTHS,
            center_cols={0, 1, 2, 8, 9},
            number_fmt_cols={1: XL_DATETIME, 12: 'R$ #,##0.00'},
            total_col=12,
            stats_text=stats_text,
            company_name=c['name'],
            logo_buffer=download_logo(company),
            company=company,
            empty_message="Nenhuma movimentação com valor nesta fatura.",
        )
        _xl_color_column(ws, 2, ['primary' if m.get('operation_type') == 'ENTRADA' else 'amber' for m in visible_movements])

        next_row = 9 + max(len(visible_movements), 1) + 2
        if invoice.get('notes'):
            next_row = _xl_note(ws, next_row, 2, 14, "Observações", invoice.get('notes', ''))
        last_row = _xl_key_values(ws, next_row, 2, _bank_pairs(c), label_span=2, value_span=5,
                                  title="Dados bancários para pagamento")
        _xl_extend_print_area(ws, 'N', last_row)

        buffer = io.BytesIO()
        wb.save(buffer)
        return buffer.getvalue()

    except Exception as e:
        logger.error(f"Error generating invoice Excel: {e}")
        return _xl_error_workbook("Erro ao gerar fatura.")


FREIGHT_PAYMENT_STATUS_LABELS = {"PENDENTE": "Pendente", "PAGO": "Pago", "CANCELADO": "Cancelado"}


def generate_freight_payment_report_pdf(driver_info: dict, payments: list, period: dict, company: dict = None) -> bytes:
    """Gera a 'Prestação de Contas' de Pagamento Frete de um motorista: lista
    itemizada de cada Ordem de Carregamento aprovada numa Rota cadastrada,
    com status de pagamento e totais, incluindo Nº do Container/Tamanho/Placas
    lidos da Ordem de Carregamento de origem. Quando a ordem levou mais de um
    container na mesma viagem, os valores de Nº do Container/Tamanho ficam
    empilhados (um abaixo do outro) dentro da mesma linha/célula."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=landscape(A4),
        rightMargin=10 * mm, leftMargin=10 * mm, topMargin=12 * mm, bottomMargin=15 * mm
    )
    c = merge_company(company)
    elements = []
    styles = getSampleStyleSheet()

    logo_buffer = download_logo(company)
    report_title = "Prestação de Contas — Pagamento Frete"
    elements.extend(_build_pdf_header(styles, logo_buffer, report_title, company=company, content_width=doc.width))

    period_str = f"{period.get('date_from') or '-'} a {period.get('date_to') or '-'}"
    elements.append(_pdf_info_grid([
        ("Motorista", driver_info.get('name', '-'), 2),
        ("CPF", driver_info.get('cpf', '-') or '-'),
        ("Período", period_str),
    ], doc.width, cols=4))
    elements.append(Spacer(1, 10))

    cell = _pdf_cell_factory(styles, font_size=8)

    def multiline_cell(values, align='left'):
        values = [xml_escape(str(v)) if v not in (None, '') else '-' for v in values] or ['-']
        return cell(None, align, markup='<br/>'.join(values))

    status_tones = {'PAGO': 'emerald', 'PENDENTE': 'amber', 'CANCELADO': 'red'}

    table_data = [_pdf_header_cells([
        'Ordem Nº', 'Nº Pgto', 'Rota', 'Data Aprovação', 'Nº do Container',
        'Tamanho', 'Placa Cavalo', 'Placa Carreta', 'Valor do Frete', 'Status', 'Data Pagamento'
    ], font_size=8)]

    total_pago = 0.0
    total_pendente = 0.0
    for p in payments:
        value = p.get('freight_value') or 0
        status_p = p.get('status', 'PENDENTE')
        if status_p == 'PAGO':
            total_pago += value
        elif status_p == 'PENDENTE':
            total_pendente += value
        created = to_brt(p.get('created_at'))
        paid = to_brt(p.get('paid_at')) if p.get('paid_at') else None
        items = p.get('container_items') or []

        table_data.append([
            cell(p.get('order_number'), 'center', bold=True),
            cell(p.get('payment_number'), 'center'),
            cell(p.get('route_name')),
            cell(created.strftime('%d/%m/%Y %H:%M') if created else '-'),
            multiline_cell([it.get('container_number') for it in items]),
            multiline_cell([it.get('size_type') for it in items], 'center'),
            cell(p.get('truck_plate')),
            cell(p.get('trailer_plate')),
            cell(format_currency(value, 'BRL'), 'right'),
            cell(None, 'center', markup=_pdf_tone_markup(FREIGHT_PAYMENT_STATUS_LABELS.get(status_p, status_p), status_tones.get(status_p, 'slate'))),
            cell(paid.strftime('%d/%m/%Y %H:%M') if paid else '-'),
        ])

    base_widths = [45, 45, 120, 65, 85, 50, 60, 60, 70, 55, 65]
    scale = doc.width / sum(base_widths)
    col_widths = [w * scale for w in base_widths]

    if payments:
        table = Table(table_data, colWidths=col_widths, repeatRows=1)
        table.setStyle(TableStyle(_pdf_table_style()))
        elements.append(table)
    else:
        elements.append(_pdf_empty_state("Nenhum lançamento no período.", doc.width))

    elements.append(Spacer(1, 8))
    elements.append(_pdf_totals_box([
        ("Lançamentos", _fmt_int(len(payments))),
        ("Total pago", format_currency(total_pago, 'BRL')),
        ("Total pendente", format_currency(total_pendente, 'BRL')),
        ("Total geral", format_currency(total_pago + total_pendente, 'BRL')),
    ], doc.width))

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes


def generate_freight_payment_report_excel(driver_info: dict, payments: list, period: dict, company: dict = None) -> bytes:
    """Versão Excel da prestação de contas de Pagamento Frete, incluindo Nº do
    Container/Tamanho/Placas lidos da Ordem de Carregamento de origem. Quando
    a ordem levou mais de um container na mesma viagem, os valores de Nº do
    Container/Tamanho ficam empilhados (quebra de linha dentro da célula)."""
    try:
        c = merge_company(company)
        wb = Workbook()
        ws = wb.active
        sheet_title = re.sub(r'[\\/?*\[\]:]', '-', f"Frete {driver_info.get('name', '')}").strip()
        ws.title = sheet_title[:31] or "Pagamento Frete"

        total_pago = sum((p.get('freight_value') or 0) for p in payments if p.get('status') == 'PAGO')
        total_pendente = sum((p.get('freight_value') or 0) for p in payments if p.get('status') == 'PENDENTE')
        total_geral = total_pago + total_pendente

        period_str = f"{period.get('date_from') or '-'} a {period.get('date_to') or '-'}"
        title = f"Prestação de Contas — Pagamento Frete - Motorista: {driver_info.get('name', '-')}"
        stats_text = (
            f"CPF: {driver_info.get('cpf') or '-'}   •   Período: {period_str}   •   "
            f"Lançamentos: {_fmt_int(len(payments))}   •   Total geral: {format_currency(total_geral, 'BRL')}"
        )

        headers = [
            'Ordem Nº', 'Nº Pgto', 'Rota', 'Data Aprovação', 'Nº do Container',
            'Tamanho', 'Placa Cavalo', 'Placa Carreta', 'Valor do Frete', 'Status', 'Data Pagamento'
        ]

        data_rows = []
        multiline_row_lines = []
        for p in payments:
            items = p.get('container_items') or []
            container_numbers = [str(it.get('container_number')) if it.get('container_number') else '-' for it in items] or ['-']
            sizes = [str(it.get('size_type')) if it.get('size_type') else '-' for it in items] or ['-']
            data_rows.append([
                p.get('order_number'),
                p.get('payment_number'),
                p.get('route_name') or '-',
                _xl_date(p.get('created_at')),
                '\n'.join(container_numbers),
                '\n'.join(sizes),
                p.get('truck_plate') or '-',
                p.get('trailer_plate') or '-',
                p.get('freight_value') or 0,
                FREIGHT_PAYMENT_STATUS_LABELS.get(p.get('status'), p.get('status')),
                _xl_date(p.get('paid_at')) if p.get('paid_at') else '-',
            ])
            multiline_row_lines.append(max(len(container_numbers), len(sizes)))

        _bsoft_style_excel(
            ws, title, stats_text, headers, data_rows,
            {'B': 9, 'C': 9, 'D': 30, 'E': 16, 'F': 16, 'G': 9, 'H': 12, 'I': 12, 'J': 14, 'K': 12, 'L': 16},
            center_cols={0, 1, 3, 5, 6, 7, 9, 10},
            number_fmt_cols={3: XL_DATETIME, 8: 'R$ #,##0.00', 10: XL_DATETIME},
            stats_text=stats_text,
            company_name=c['name'],
            logo_buffer=download_logo(company),
            company=company,
            empty_message="Nenhum lançamento no período.",
        )
        status_tones = {'PAGO': 'emerald', 'PENDENTE': 'amber', 'CANCELADO': 'red'}
        _xl_color_column(ws, 9, [status_tones.get(p.get('status')) for p in payments])

        # Quebra de linha dentro da célula pra Nº do Container/Tamanho quando a
        # ordem levou mais de um container (empilhados um abaixo do outro) +
        # altura de linha ajustada pra caber todas as linhas empilhadas.
        data_start = 9
        wrap_align_left = Alignment(horizontal='left', vertical='center', wrap_text=True)
        wrap_align_center = Alignment(horizontal='center', vertical='center', wrap_text=True)
        for row_offset, n_lines in enumerate(multiline_row_lines):
            row_num = data_start + row_offset
            ws.cell(row=row_num, column=2 + 4).alignment = wrap_align_left    # Nº do Container (col F)
            ws.cell(row=row_num, column=2 + 5).alignment = wrap_align_center  # Tamanho (col G)
            if n_lines > 1:
                ws.row_dimensions[row_num].height = max(15, 14 * n_lines)

        totals_row = data_start + max(len(data_rows), 1) + 1
        last_row = _xl_totals(ws, totals_row, 7, 9, 10, [
            ("Total pago", total_pago),
            ("Total pendente", total_pendente),
            ("Total geral", total_geral),
        ])
        _xl_extend_print_area(ws, 'L', last_row)

        buffer = io.BytesIO()
        wb.save(buffer)
        return buffer.getvalue()

    except Exception as e:
        logger.error(f"Error generating freight payment report Excel: {e}")
        return _xl_error_workbook("Erro ao gerar prestação de contas.")


def generate_freight_payment_receipt_pdf(batch: dict, payments: list, company: dict = None) -> bytes:
    """Gera o Recibo de Pagamento de uma Ordem de Pagamento (FreightPaymentBatch):
    documento enxuto de comprovação (não a Prestação de Contas detalhada em
    generate_freight_payment_report_pdf), com declaração de quitação e linhas
    de assinatura do motorista/responsável."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        rightMargin=15 * mm, leftMargin=15 * mm, topMargin=12 * mm, bottomMargin=15 * mm
    )
    c = merge_company(company)
    elements = []
    styles = getSampleStyleSheet()

    logo_buffer = download_logo(company)
    report_title = "Recibo de Pagamento — Frete"
    elements.extend(_build_pdf_header(styles, logo_buffer, report_title, company=company, content_width=doc.width))

    paid_at = to_brt(batch.get('created_at'))
    paid_at_str = paid_at.strftime('%d/%m/%Y %H:%M') if paid_at else '-'
    elements.append(_pdf_info_grid([
        ("Ordem de pagamento", f"Nº {batch.get('batch_number')}"),
        ("Data do pagamento", paid_at_str),
        ("Lançamentos", _fmt_int(batch.get('item_count') or len(payments))),
        ("Motorista", batch.get('driver_name') or '-', 2),
        ("CPF", batch.get('driver_cpf') or '-'),
    ], doc.width, cols=3))
    elements.append(Spacer(1, 10))

    cell = _pdf_cell_factory(styles, font_size=8.5)
    total_str = format_currency(batch.get('total_value') or 0, 'BRL')

    table_data = [_pdf_header_cells(['Ordem Nº', 'Rota', 'Data Aprovação', 'Valor do Frete'], font_size=8.5)]
    for p in payments:
        approved = to_brt(p.get('created_at'))
        table_data.append([
            cell(p.get('order_number'), 'center', bold=True),
            cell(p.get('route_name')),
            cell(approved.strftime('%d/%m/%Y') if approved else '-', 'center'),
            cell(format_currency(p.get('freight_value') or 0, 'BRL'), 'right'),
        ])

    base_widths = [70, 220, 100, 100]
    scale = doc.width / sum(base_widths)
    col_widths = [w * scale for w in base_widths]
    table = Table(table_data, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle(_pdf_table_style() + [('FONTSIZE', (0, 0), (-1, -1), 8.5)]))
    elements.append(table)
    elements.append(Spacer(1, 8))
    elements.append(_pdf_totals_box([("Valor total", total_str)], doc.width))
    elements.append(Spacer(1, 16))

    declaration_style = ParagraphStyle(
        'ReceiptDeclaration', parent=styles['Normal'], fontSize=10, alignment=TA_LEFT, leading=15,
        textColor=_hex(BRAND_TEXT),
    )
    item_word = 'lançamento' if (batch.get('item_count') or 0) == 1 else 'lançamentos'
    declaration = (
        f"Eu, <b>{xml_escape(batch.get('driver_name') or '-')}</b>, portador do CPF <b>{xml_escape(batch.get('driver_cpf') or '-')}</b>, "
        f"declaro ter recebido de <b>{xml_escape(c['name'])}</b> a quantia de <b>{total_str}</b>, referente aos "
        f"{batch.get('item_count') or 0} {item_word} de frete discriminados acima, dando plena quitação "
        f"do valor recebido."
    )
    elements.append(Paragraph(declaration, declaration_style))
    elements.append(Spacer(1, 16))

    elements.append(_pdf_signatures([
        ("Assinatura do Motorista", f"{batch.get('driver_name') or '-'}  ·  CPF {batch.get('driver_cpf') or '-'}"),
        ("Assinatura do Responsável", f"{batch.get('created_by_name') or '-'}  ·  {now_brt().strftime('%d/%m/%Y')}"),
    ], doc.width, space_above=40))

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes


def _pdf_barcode_block(code, issued_by, content_width, barcode_width=130, print_datetime=False):
    """Código de barras (Code128) do número do documento + "Emitido por" e
    data de impressão ao lado - bloco de controle usado nos documentos que
    são conferidos fisicamente (invoice, prestação de contas)."""
    import barcode
    from barcode.writer import ImageWriter

    barcode_buffer = io.BytesIO()
    try:
        code128 = barcode.get_barcode_class('code128')
        barcode_obj = code128(str(code), writer=ImageWriter())
        barcode_obj.write(barcode_buffer, options={
            'module_width': 0.3,
            'module_height': 12,
            'font_size': 10,
            'text_distance': 5,
            'quiet_zone': 2
        })
        barcode_buffer.seek(0)
        barcode_image = Image(barcode_buffer, width=barcode_width, height=50)
    except Exception as e:
        logger.error(f"Error generating barcode: {e}")
        barcode_image = Paragraph(f"[{xml_escape(str(code))}]", ParagraphStyle('BarcodeFallback', fontSize=9))

    label = ParagraphStyle('BarcodeUserLabel', fontName='Helvetica', fontSize=7, leading=9, textColor=_hex(BRAND_MUTED))
    value = ParagraphStyle('BarcodeUserValue', fontName='Helvetica-Bold', fontSize=9, leading=11, textColor=_hex(BRAND_DARK))
    stamp = now_brt().strftime('%d/%m/%Y %H:%M' if print_datetime else '%d/%m/%Y')
    user_info = [
        Paragraph("EMITIDO POR", label),
        Paragraph(xml_escape(str(issued_by or 'Sistema')), value),
        Spacer(1, 5),
        Paragraph("DATA DA IMPRESSÃO", label),
        Paragraph(stamp, value),
    ]
    table = Table([[barcode_image, user_info]], colWidths=[barcode_width + 20, content_width - barcode_width - 20])
    table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (0, 0), 0),
        ('LEFTPADDING', (1, 0), (1, 0), 16),
    ]))
    return table


def generate_intl_invoice_pdf(invoice: dict, company: dict = None) -> bytes:
    """
    Invoice internacional no padrão visual dos documentos: quadro com os dados
    da invoice e do pagador, tabela de serviços, quadro de totais, observações
    e código de barras do número da invoice.
    """
    c = merge_company(company)
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=15*mm,
        leftMargin=15*mm,
        topMargin=12*mm,
        bottomMargin=20*mm
    )

    elements = []
    styles = getSampleStyleSheet()

    currency = invoice.get('currency', 'USD')

    # ========== CABEÇALHO ==========
    logo_buffer = download_logo(company)
    report_title = f"Invoice Nº {invoice.get('invoice_number', '-')}"
    elements.extend(_build_pdf_header(styles, logo_buffer, report_title, company=company, content_width=doc.width))

    # ========== DADOS DA INVOICE ==========
    total_str = format_currency(invoice.get('total', 0), currency)
    elements.append(_pdf_info_grid([
        ("Moeda / Currency", invoice.get('currency', '-')),
        ("Emissão / Issue date", invoice.get('issue_date', '-')),
        ("Vencimento / Due date", invoice.get('due_date', '-')),
    ], doc.width, cols=3))

    # ========== PAGADOR ==========
    elements.extend(_pdf_section_title("Pagador / Payer", doc.width))
    elements.append(_pdf_info_grid([
        ("Empresa / Company", invoice.get('payer_company', '-'), 2),
        ("CNPJ / Tax ID", invoice.get('payer_cnpj', '-') or '-'),
        ("Contato / Contact", invoice.get('payer_contact', '-') or '-'),
        ("E-mail", invoice.get('payer_email', '-') or '-', 2),
        ("Endereço / Address", invoice.get('payer_address', '-') or '-', 3),
    ], doc.width, cols=3))

    # ========== SERVIÇOS ==========
    elements.extend(_pdf_section_title("Serviços / Services", doc.width))
    cell = _pdf_cell_factory(styles, font_size=9)
    items_data = [_pdf_header_cells(['Descrição / Description', 'Qtd', 'Valor Unitário', 'Total'], font_size=8.5)]
    for item in invoice.get('items', []):
        items_data.append([
            cell(item.get('description', '-') or '-'),
            cell(item.get('quantity', 1), 'center'),
            cell(format_currency(item.get('unit_price', 0), currency), 'right'),
            cell(format_currency(item.get('total', 0), currency), 'right'),
        ])

    base_widths = [260, 50, 100, 100]
    scale = doc.width / sum(base_widths)
    items_table = Table(items_data, colWidths=[w * scale for w in base_widths], repeatRows=1)
    items_table.setStyle(TableStyle(_pdf_table_style() + [
        ('TOPPADDING', (0, 1), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 5),
    ]))
    elements.append(items_table)
    elements.append(Spacer(1, 8))
    elements.append(_pdf_totals_box([("Total", total_str)], doc.width, width=210))

    # ========== OBSERVAÇÕES ==========
    if invoice.get('notes'):
        elements.append(Spacer(1, 12))
        elements.append(_pdf_note_box("Observações / Notes", invoice['notes'], doc.width))

    # ========== CÓDIGO DE BARRAS ==========
    elements.append(Spacer(1, 22))
    elements.append(_pdf_barcode_block(
        str(invoice.get('invoice_number', '0')).zfill(3), invoice.get('created_by_name', 'Sistema'), doc.width, barcode_width=120,
    ))

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def generate_expense_report_pdf(report: dict, company: dict = None) -> bytes:
    """
    Gera o PDF final da Prestação de Contas: período, depósitos recebidos,
    lançamentos de compra, saldo, código de barras de controle e os recibos
    anexados a cada compra.
    """
    c = merge_company(company)
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=15*mm,
        leftMargin=15*mm,
        topMargin=12*mm,
        bottomMargin=20*mm
    )

    elements = []
    styles = getSampleStyleSheet()

    def money(value):
        return format_currency(value)

    # ========== CABEÇALHO ==========
    logo_buffer = download_logo(company)
    report_title = f"Prestação de Contas Nº {report.get('report_number_formatted', '-')}"
    elements.extend(_build_pdf_header(styles, logo_buffer, report_title, company=company, content_width=doc.width))

    # ========== DADOS: período / responsável / status ==========
    is_done = report.get('status') == 'CONCLUIDA'
    status_value = Paragraph(
        _pdf_tone_markup('Concluída' if is_done else 'Em Andamento', 'emerald' if is_done else 'amber'),
        ParagraphStyle('ExpenseStatus', fontName='Helvetica-Bold', fontSize=8.5, leading=10.5),
    )
    elements.append(_pdf_info_grid([
        ("Período", f"{fmt_date(report.get('period_start'))} a {fmt_date(report.get('period_end'))}"),
        ("Responsável", report.get('created_by_name', '-')),
        ("Status", status_value),
    ], doc.width, cols=3))

    cell = _pdf_cell_factory(styles, font_size=8.5)

    # ========== DEPÓSITOS RECEBIDOS (antes dos lançamentos de compra) ==========
    elements.extend(_pdf_section_title("Depósitos recebidos", doc.width))
    deposits = report.get('deposits', []) or []
    deposits_data = [_pdf_header_cells(['Data', 'Enviado Por', 'Valor'], font_size=8.5)]
    for d in deposits:
        deposits_data.append([cell(fmt_date(d.get('date')), 'center'), cell(d.get('sent_by', '-') or '-'), cell(money(d.get('amount')), 'right')])
    deposits_data.append(['', cell('TOTAL DEPÓSITOS', 'right', bold=True), cell(money(report.get('total_deposits')), 'right', bold=True)])

    deposits_table = Table(deposits_data, colWidths=[doc.width * 0.2, doc.width * 0.58, doc.width * 0.22], repeatRows=1)
    deposits_table.setStyle(TableStyle(_pdf_table_style(total_row=True)))
    elements.append(deposits_table)

    # ========== LANÇAMENTOS DE COMPRAS ==========
    elements.extend(_pdf_section_title("Lançamentos de compras", doc.width))
    purchases = report.get('purchases', []) or []
    purchases = sorted(purchases, key=lambda p: p.get('purchase_date') or '')
    purchases_data = [_pdf_header_cells(['Local de Compra', 'Data', 'Valor', 'Observação'], font_size=8.5)]
    for p in purchases:
        purchases_data.append([
            cell(p.get('supplier_name') or '-'),
            cell(fmt_date(p.get('purchase_date')), 'center'),
            cell(money(p.get('amount')), 'right'),
            cell(p.get('observation') or '-'),
        ])
    purchases_data.append(['', cell('TOTAL COMPRAS', 'right', bold=True), cell(money(report.get('total_purchases')), 'right', bold=True), ''])

    purchases_table = Table(purchases_data, colWidths=[doc.width * 0.32, doc.width * 0.16, doc.width * 0.17, doc.width * 0.35], repeatRows=1)
    purchases_table.setStyle(TableStyle(_pdf_table_style(total_row=True)))
    elements.append(purchases_table)
    elements.append(Spacer(1, 12))

    # ========== TOTAIS / SALDO ==========
    balance = report.get('balance', 0) or 0
    if balance > 0:
        balance_label = 'Valor a ressarcir ao funcionário'
    elif balance < 0:
        balance_label = 'Saldo a devolver pelo funcionário'
    else:
        balance_label = 'Quitado'
    elements.append(_pdf_totals_box([
        ('Total de compras', money(report.get('total_purchases'))),
        ('Total de depósitos', money(report.get('total_deposits'))),
        (balance_label, money(abs(balance))),
    ], doc.width, width=280))

    # ========== CÓDIGO DE BARRAS ==========
    elements.append(Spacer(1, 20))
    elements.append(_pdf_barcode_block(
        report.get('report_number_formatted', '0'), report.get('created_by_name', 'Sistema'), doc.width,
        barcode_width=140, print_datetime=True,
    ))

    # ========== RECIBOS ANEXADOS ==========
    if any(p.get('receipts') for p in purchases):
        elements.extend(_pdf_section_title("Recibos anexados", doc.width))

        receipt_label_style = ParagraphStyle(
            'ExpenseReceiptLabel', parent=styles['Normal'], fontSize=8.5,
            fontName='Helvetica-Bold', textColor=_hex(BRAND_DARK), spaceAfter=4
        )
        unavailable_style = ParagraphStyle('ExpenseReceiptUnavailable', parent=styles['Normal'], fontSize=8, textColor=_hex(BRAND_MUTED))

        images_per_row = 3
        for p in purchases:
            receipts = p.get('receipts', []) or []
            if not receipts:
                continue

            label = f"{p.get('supplier_name') or '-'} — {fmt_date(p.get('purchase_date'))} — {money(p.get('amount'))}"
            elements.append(Paragraph(xml_escape(label), receipt_label_style))

            rows = []
            current_row = []
            for r in receipts:
                img_flowable = None
                try:
                    url = r.get('url', '') or ''
                    marker = '/expense_reports/'
                    if marker in url:
                        relative = url.split(marker, 1)[1]
                        file_path = UPLOADS_DIR / 'expense_reports' / relative
                        if file_path.exists():
                            img_flowable = Image(str(file_path), width=150, height=200, kind='proportional')
                except Exception as e:
                    logger.error(f"Error loading receipt image: {e}")
                if img_flowable is None:
                    img_flowable = Paragraph("[Recibo indisponível]", unavailable_style)
                current_row.append(img_flowable)
                if len(current_row) == images_per_row:
                    rows.append(current_row)
                    current_row = []
            if current_row:
                while len(current_row) < images_per_row:
                    current_row.append('')
                rows.append(current_row)

            receipts_table = Table(rows, colWidths=[doc.width / images_per_row] * images_per_row)
            receipts_table.setStyle(TableStyle([
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
            ]))
            elements.append(receipts_table)
            elements.append(Spacer(1, 8))

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def generate_container_audit_pdf(audit: dict, company: dict = None) -> bytes:
    """Gera o PDF da Auditoria de Estoque: confronto entre o que o sistema
    esperava em estoque para o cliente e o que foi encontrado fisicamente,
    com código de barras do audit_code e fotos anexadas por container."""
    c = merge_company(company)
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=15*mm,
        leftMargin=15*mm,
        topMargin=12*mm,
        bottomMargin=20*mm
    )

    elements = []
    styles = getSampleStyleSheet()

    # ========== CABEÇALHO ==========
    logo_buffer = download_logo(company)
    report_title = f"Auditoria de Estoque Nº {audit.get('audit_code', '-')}"
    elements.extend(_build_pdf_header(styles, logo_buffer, report_title, company=company, content_width=doc.width))

    # ========== DADOS ==========
    is_done = audit.get('status') == 'CONCLUIDA'
    status_value = Paragraph(
        _pdf_tone_markup('Concluída' if is_done else 'Em Andamento', 'emerald' if is_done else 'amber'),
        ParagraphStyle('AuditStatus', fontName='Helvetica-Bold', fontSize=8.5, leading=10.5),
    )
    elements.append(_pdf_info_grid([
        ("Cliente", audit.get('client_name', '-'), 2),
        ("Status", status_value),
        ("Responsável", audit.get('created_by_name', '-'), 2),
        ("Concluída em", fmt_datetime(audit.get('completed_at')) if audit.get('completed_at') else '-'),
    ], doc.width, cols=3))
    elements.append(Spacer(1, 10))

    # ========== INDICADORES ==========
    items = audit.get('items', []) or []
    elements.extend(_build_pdf_summary([
        ("Esperados", _fmt_int(sum(1 for i in items if i.get('expected')))),
        ("Confirmados", _fmt_int(sum(1 for i in items if i.get('status') == 'CONFIRMADO'))),
        ("Faltantes", _fmt_int(sum(1 for i in items if i.get('status') == 'FALTANTE'))),
        ("Não esperados", _fmt_int(sum(1 for i in items if i.get('status') == 'NAO_ESPERADO'))),
    ], doc.width))

    # ========== TABELA DE ITENS ==========
    cell = _pdf_cell_factory(styles, font_size=8)
    STATUS_LABELS = {
        'CONFIRMADO': 'Confirmado',
        'FALTANTE': 'Faltante',
        'NAO_ESPERADO': 'Não Esperado',
        'PENDENTE': 'Pendente',
    }
    STATUS_TONES = {'CONFIRMADO': 'emerald', 'FALTANTE': 'red', 'NAO_ESPERADO': 'amber', 'PENDENTE': 'slate'}

    data = [_pdf_header_cells(['Container', 'Situação', 'Nº Transação', 'Tamanho/Tipo', 'Observações'], font_size=8)]
    alert_cmds = []
    for idx, item in enumerate(items, start=1):
        status = item.get('status')
        data.append([
            cell(item.get('container_number'), 'center', bold=True),
            cell(None, 'center', markup=_pdf_tone_markup(STATUS_LABELS.get(status, status), STATUS_TONES.get(status, 'slate'))),
            cell(item.get('transaction_id'), 'center'),
            cell(item.get('size_type'), 'center'),
            cell(item.get('observations')),
        ])
        # Faltante / não esperado ganham fundo suave na célula de situação
        if status in ('FALTANTE', 'NAO_ESPERADO'):
            alert_cmds.append(('BACKGROUND', (1, idx), (1, idx), _hex(PDF_SOFT_FILLS['red' if status == 'FALTANTE' else 'amber'])))

    if items:
        col_widths = [doc.width*0.18, doc.width*0.16, doc.width*0.14, doc.width*0.14, doc.width*0.38]
        table = Table(data, colWidths=col_widths, repeatRows=1)
        table.setStyle(TableStyle(_pdf_table_style() + alert_cmds))
        elements.append(table)
    else:
        elements.append(_pdf_empty_state("Nenhum container nesta auditoria.", doc.width))

    # ========== CÓDIGO DE BARRAS ==========
    elements.append(Spacer(1, 20))
    elements.append(_pdf_barcode_block(
        audit.get('audit_code', '0'), audit.get('created_by_name', 'Sistema'), doc.width,
        barcode_width=160, print_datetime=True,
    ))

    # ========== FOTOS ANEXADAS ==========
    items_with_photo = [i for i in items if i.get('photo')]
    if items_with_photo:
        elements.extend(_pdf_section_title("Fotos anexadas", doc.width))

        caption_style = ParagraphStyle('AuditPhotoCaption', parent=styles['Normal'], fontSize=8, alignment=TA_CENTER, textColor=_hex(BRAND_TEXT))
        unavailable_style = ParagraphStyle('AuditPhotoUnavailable', parent=styles['Normal'], fontSize=8, textColor=_hex(BRAND_MUTED), alignment=TA_CENTER)

        images_per_row = 3
        cells = []
        for item in items_with_photo:
            img_flowable = None
            try:
                url = item['photo'].get('url', '') or ''
                marker = '/container_audits/'
                if marker in url:
                    relative = url.split(marker, 1)[1]
                    file_path = UPLOADS_DIR / 'container_audits' / relative
                    if file_path.exists():
                        img_flowable = Image(str(file_path), width=150, height=110, kind='proportional')
            except Exception as e:
                logger.error(f"Error loading audit photo: {e}")
            if img_flowable is None:
                img_flowable = Paragraph("[Foto indisponível]", unavailable_style)
            cells.append([img_flowable, Paragraph(xml_escape(item.get('container_number', '-') or '-'), caption_style)])

        rows = []
        current_row = []
        for cell_content in cells:
            current_row.append(cell_content)
            if len(current_row) == images_per_row:
                rows.append(current_row)
                current_row = []
        if current_row:
            while len(current_row) < images_per_row:
                current_row.append('')
            rows.append(current_row)

        photos_table = Table(rows, colWidths=[doc.width/images_per_row]*images_per_row)
        photos_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ]))
        elements.append(photos_table)

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def generate_commission_report_pdf(data: dict, company: dict = None) -> bytes:
    """Gera o PDF do Relatório de Comissão: para cada representante, o valor
    faturado de cada cliente vinculado no período, a comissão calculada
    (valor faturado x percentual do vínculo) e o total do representante."""
    c = merge_company(company)
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=15*mm,
        leftMargin=15*mm,
        topMargin=12*mm,
        bottomMargin=20*mm
    )

    elements = []
    styles = getSampleStyleSheet()

    def money(value):
        return format_currency(value)

    logo_buffer = download_logo(company)
    elements.extend(_build_pdf_header(styles, logo_buffer, "Relatório de Comissão", company=company, content_width=doc.width))

    representatives = data.get('representatives', [])
    period_text = (
        f"{fmt_date(data.get('start_date')) if data.get('start_date') else 'Início'} a "
        f"{fmt_date(data.get('end_date')) if data.get('end_date') else 'Hoje'}"
    )
    elements.append(_pdf_info_grid([
        ("Período", period_text),
        ("Representantes", _fmt_int(len(representatives))),
        ("Comissão total", money(data.get('grand_total', 0))),
    ], doc.width, cols=3))

    if not representatives:
        elements.append(Spacer(1, 10))
        elements.append(_pdf_empty_state("Nenhuma comissão encontrada para o período informado.", doc.width))

    cell = _pdf_cell_factory(styles, font_size=8.5)
    for rep in representatives:
        elements.extend(_pdf_section_title(rep['representative_name'], doc.width))

        rows = [_pdf_header_cells(['Cliente', '% Comissão', 'Valor Faturado', 'Comissão'], font_size=8.5)]
        for cl in rep['clients']:
            rows.append([
                cell(cl['client_name']),
                cell(f"{cl['commission_percentage']:.2f}%".replace('.', ','), 'center'),
                cell(money(cl['total_billed']), 'right'),
                cell(money(cl['commission_value']), 'right'),
            ])
        rows.append(['', '', cell('TOTAL DO REPRESENTANTE', 'right', bold=True), cell(money(rep['total_commission']), 'right', bold=True)])

        table = Table(rows, colWidths=[doc.width*0.40, doc.width*0.15, doc.width*0.225, doc.width*0.225], repeatRows=1)
        table.setStyle(TableStyle(_pdf_table_style(total_row=True)))
        elements.append(table)

    if representatives:
        elements.append(Spacer(1, 12))
        elements.append(_pdf_totals_box([("Total geral", money(data.get('grand_total', 0)))], doc.width))

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def generate_service_price_table_pdf(client_name: str, entries: list, company: dict = None) -> bytes:
    """Gera o PDF da Tabela de Serviços de um cliente (Comercial > Tabela de
    Serviços): lista simples de serviço + valor cadastrados para ele."""
    c = merge_company(company)
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=15*mm,
        leftMargin=15*mm,
        topMargin=12*mm,
        bottomMargin=20*mm
    )

    elements = []
    styles = getSampleStyleSheet()

    logo_buffer = download_logo(company)
    elements.extend(_build_pdf_header(styles, logo_buffer, "Tabela de Serviços", company=company, content_width=doc.width))

    elements.append(_pdf_info_grid([
        ("Cliente", client_name or '-', 2),
        ("Serviços", _fmt_int(len(entries))),
    ], doc.width, cols=3))
    elements.append(Spacer(1, 10))

    if entries:
        cell = _pdf_cell_factory(styles, font_size=9)
        data = [_pdf_header_cells(['Serviço', 'Valor'], font_size=8.5)]
        for e in entries:
            name = xml_escape(e.get('service_type_name', '-') or '-')
            if e.get('billing_type') == 'DIARIA':
                size_label = f"{e['container_size_group']} pés" if e.get('container_size_group') else 'qualquer tamanho'
                caption = f"Diária após {e.get('free_time_days', 0)} dias de free time · Contêiner {size_label}"
                service_cell = cell(None, markup=f"<b>{name}</b><br/><font size=7 color='#{BRAND_MUTED}'>{xml_escape(caption)}</font>")
                value_str = f"{format_currency(e.get('value', 0), e.get('currency') or 'BRL')}/dia"
            else:
                service_cell = cell(None, markup=f"<b>{name}</b>")
                value_str = format_currency(e.get('value', 0), e.get('currency') or 'BRL')
            data.append([service_cell, cell(value_str, 'right')])

        table = Table(data, colWidths=[doc.width*0.7, doc.width*0.3], repeatRows=1)
        table.setStyle(TableStyle(_pdf_table_style() + [
            ('TOPPADDING', (0, 1), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 1), (-1, -1), 5),
        ]))
        elements.append(table)
    else:
        elements.append(_pdf_empty_state("Nenhum serviço cadastrado para este cliente.", doc.width))

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def generate_commercial_proposal_pdf(proposal: dict, company: dict = None) -> bytes:
    """Gera o PDF da Proposta Comercial: cabeçalho (com o assunto embaixo do
    título), quadro com número/destinatário/data/validade, tabela de serviços
    e valores, blocos de Free Time e Forma de Pagamento (quando preenchidos),
    e fechamento com assinatura da empresa."""
    c = merge_company(company)
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=15*mm,
        leftMargin=15*mm,
        topMargin=12*mm,
        bottomMargin=15*mm
    )

    elements = []
    styles = getSampleStyleSheet()

    logo_buffer = download_logo(company)
    elements.extend(_build_pdf_header(
        styles, logo_buffer, "Proposta Comercial", generation_info=proposal.get('subject') or None,
        company=company, content_width=doc.width,
    ))

    # ========== Nº / DESTINATÁRIO / DATA / VALIDADE ==========
    date_only = fmt_datetime(proposal.get('created_at')).split(' ')[0] if proposal.get('created_at') else now_brt().strftime('%d/%m/%Y')
    elements.append(_pdf_info_grid([
        ("Nº da proposta", str(proposal.get('proposal_number', '-'))),
        ("Em nome de", proposal.get('recipient_name', '-'), 2),
        ("Data", date_only),
        ("Validade", f"{proposal.get('validity_days', 7)} dias"),
    ], doc.width, cols=5))
    elements.append(Spacer(1, 12))

    body_style = ParagraphStyle('ProposalBody', parent=styles['Normal'], fontSize=10, leading=14, textColor=_hex(BRAND_TEXT), spaceAfter=6)
    elements.append(Paragraph(f"Prezado(a) {xml_escape(proposal.get('recipient_name', '-') or '-')},", body_style))
    elements.append(Paragraph(
        f"Agradecemos o contato e apresentamos, a seguir, nossa proposta comercial para os serviços de "
        f"{xml_escape((proposal.get('subject') or '').lower())} na {xml_escape(c['name'])}.",
        body_style
    ))

    # ========== SERVIÇOS E VALORES ==========
    elements.extend(_pdf_section_title("Serviços e valores", doc.width))
    proposal_currency = proposal.get('currency') or 'BRL'
    cell = _pdf_cell_factory(styles, font_size=9)
    items = proposal.get('items', []) or []
    data = [_pdf_header_cells(['Serviço', 'Valor'], font_size=8.5)]
    for item in items:
        data.append([cell(item.get('description', '-')), cell(format_currency(item.get('value', 0), proposal_currency), 'right', bold=True)])

    items_table = Table(data, colWidths=[doc.width*0.7, doc.width*0.3], repeatRows=1)
    items_table.setStyle(TableStyle(_pdf_table_style() + [
        ('TOPPADDING', (0, 1), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 5),
    ]))
    elements.append(items_table)

    note_style = ParagraphStyle('ProposalNote', parent=styles['Normal'], fontSize=7.5, textColor=_hex(BRAND_MUTED), spaceBefore=3, spaceAfter=8)
    currency_note = {'USD': 'Dólares Americanos (US$)'}.get(proposal_currency, 'Reais (R$)')
    elements.append(Paragraph(f"Valores expressos em {currency_note}.", note_style))

    # ========== BLOCOS DESTACADOS: FREE TIME / FORMA DE PAGAMENTO ==========
    if proposal.get('free_time_text'):
        elements.append(_pdf_note_box("Free time de armazenagem", proposal['free_time_text'], doc.width))
        elements.append(Spacer(1, 6))

    if proposal.get('payment_terms_text'):
        elements.append(_pdf_note_box("Forma de pagamento", proposal['payment_terms_text'], doc.width))
        elements.append(Spacer(1, 6))

    elements.append(Spacer(1, 4))
    elements.append(Paragraph(
        f"Esta proposta tem validade de {proposal.get('validity_days', 7)} dias a partir da data de emissão.",
        body_style
    ))
    elements.append(Paragraph(
        "Ficamos à disposição para esclarecer quaisquer dúvidas e para tratativas sobre as condições operacionais deste serviço.",
        body_style
    ))

    elements.append(Spacer(1, 6))
    elements.append(Paragraph("Atenciosamente,", body_style))
    signature_style = ParagraphStyle('ProposalSignature', parent=styles['Normal'], fontSize=11, fontName='Helvetica-Bold', textColor=_hex(BRAND_DARK))
    elements.append(Paragraph(xml_escape(c['name']), signature_style))
    if c.get('slogan'):
        slogan_style = ParagraphStyle('ProposalSlogan', parent=styles['Normal'], fontSize=9, textColor=_hex(BRAND_MUTED))
        elements.append(Paragraph(xml_escape(c['slogan']), slogan_style))

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


VEHICLE_CHECKLIST_TEMPLATE_SECTIONS = list(VEHICLE_CHECKLIST_TEMPLATE.keys())


def generate_vehicle_checklist_pdf(checklist: dict, company: dict = None) -> bytes:
    """Gera o PDF do Checklist de Veículo (LVT), com os itens e respostas SIM/NÃO por seção."""
    c = merge_company(company)
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=15 * mm,
        leftMargin=15 * mm,
        topMargin=12 * mm,
        bottomMargin=20 * mm
    )

    elements = []
    styles = getSampleStyleSheet()
    # Largura útil real da página (A4 - margens), não um valor fixo — evita vazar da margem.
    SECTION_WIDTH = doc.width

    # ========== CABEÇALHO ==========
    logo_buffer = download_logo(company)
    elements.extend(_build_pdf_header(styles, logo_buffer, f"Checklist de Veículo Nº {checklist.get('checklist_number', '-')}", company=company, content_width=doc.width))

    # ========== FALHA / ATENÇÃO ==========
    has_failure = any(
        item.get('answer') == 'NAO'
        for section in VEHICLE_CHECKLIST_TEMPLATE_SECTIONS
        for item in (checklist.get(f"{section}_items") or [])
    )
    if has_failure:
        warn_style = ParagraphStyle('CLWarn', parent=styles['Normal'], fontSize=9.5, leading=12, fontName='Helvetica-Bold', textColor=_hex(PDF_TONES['red']))
        warn_table = Table([[Paragraph("ATENÇÃO: há item(ns) reprovado(s) neste checklist. O carregamento deve ser cancelado.", warn_style)]], colWidths=[SECTION_WIDTH])
        warn_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), _hex(PDF_SOFT_FILLS['red'])),
            ('LINEBEFORE', (0, 0), (0, -1), 3, _hex(PDF_TONES['red'])),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 7),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ]))
        elements.append(warn_table)
        elements.append(Spacer(1, 8))

    # ========== DADOS DO CHECKLIST ==========
    elements.append(_pdf_info_grid([
        ("Expedidor", checklist.get('expedidor')),
        ("UN", checklist.get('un')),
        ("Data/Hora da Vistoria", fmt_datetime(checklist.get('inspection_datetime'))),
        ("Cód. Agendamento", checklist.get('scheduling_code')),
        ("Cliente", checklist.get('client_name'), 2),
        ("Transportadora", checklist.get('transport_company_name'), 2),
        ("Número ORP/ODP", checklist.get('orp_odp_number')),
        ("Número da NF", checklist.get('nf_number')),
        ("Produto(s)", checklist.get('products_description')),
        ("Código SAP", checklist.get('sap_code')),
        ("Motorista", checklist.get('driver_name'), 2),
        ("CPF Motorista", checklist.get('driver_cpf')),
        ("CNH Vencimento", fmt_date(checklist.get('cnh_expiry'))),
        ("CNH Nº / Categoria", f"{checklist.get('cnh_number') or '-'} / {checklist.get('cnh_category') or '-'}"),
        ("Placa do Cavalo / Ano", f"{checklist.get('cavalo_plate') or '-'} / {checklist.get('cavalo_year') or '-'}"),
        ("Placa Carreta 1 / Ano", f"{checklist.get('carreta1_plate') or '-'} / {checklist.get('carreta1_year') or '-'}"),
        ("Capacidade Carreta 1", checklist.get('carreta1_capacity')),
        ("Placa Carreta 2 / Ano", f"{checklist.get('carreta2_plate') or '-'} / {checklist.get('carreta2_year') or '-'}"),
        ("Capacidade Carreta 2", checklist.get('carreta2_capacity')),
    ], SECTION_WIDTH, cols=4))

    cell = _pdf_cell_factory(styles, font_size=8)

    # ========== SEÇÕES DE ITENS ==========
    for section in VEHICLE_CHECKLIST_TEMPLATE_SECTIONS:
        items = checklist.get(f"{section}_items") or []
        if not items:
            continue
        has_expiry = section == 'documentos'

        elements.extend(_pdf_section_title(VEHICLE_CHECKLIST_SECTION_LABELS[section], SECTION_WIDTH))
        rows = [_pdf_header_cells(["Descrição", "Sim", "Não"] + (["Vencimento"] if has_expiry else []), font_size=8)]
        fail_cmds = []
        for idx, item in enumerate(items, start=1):
            answer = item.get('answer')
            row = [
                cell(item.get('text', '')),
                cell(None, 'center', markup=_pdf_tone_markup('X', 'emerald') if answer == 'SIM' else ''),
                cell(None, 'center', markup=_pdf_tone_markup('X', 'red') if answer == 'NAO' else ''),
            ]
            if has_expiry:
                row.append(cell(fmt_date(item.get('expiry')), 'center'))
            rows.append(row)
            if answer == 'NAO':
                fail_cmds.append(('BACKGROUND', (0, idx), (-1, idx), _hex(PDF_SOFT_FILLS['red'])))

        # Colunas fixas (Sim/Não/Vencimento) + Descrição absorvendo o resto da largura útil.
        col_widths = [SECTION_WIDTH - 140, 35, 35, 70] if has_expiry else [SECTION_WIDTH - 70, 35, 35]
        items_table = Table(rows, colWidths=col_widths, repeatRows=1)
        items_table.setStyle(TableStyle(_pdf_table_style() + fail_cmds))
        elements.append(items_table)

    # ========== PRODUTOS / RÓTULOS DE RISCO ==========
    products = checklist.get('products') or []
    if products:
        elements.extend(_pdf_section_title("Produtos transportados", SECTION_WIDTH))
        prod_rows = [_pdf_header_cells(["Produto", "ONU", "Nº de Risco", "Subclasse"], font_size=8)]
        for p in products:
            prod_rows.append([
                cell(p.get('product') or '-'),
                cell(p.get('un_number') or '-', 'center'),
                cell(p.get('risk_number') or '-', 'center'),
                cell(p.get('subclass') or '-', 'center'),
            ])
        # ONU/Risco/Subclasse são códigos curtos e fixos; Produto absorve o resto.
        prod_table = Table(prod_rows, colWidths=[SECTION_WIDTH - 300, 100, 100, 100], repeatRows=1)
        prod_table.setStyle(TableStyle(_pdf_table_style()))
        elements.append(prod_table)

    # ========== KIT: VALIDADES / ÚLTIMAS 3 VIAGENS ==========
    elements.extend(_pdf_section_title("Kit e últimas viagens", SECTION_WIDTH))
    elements.append(_pdf_info_grid([
        ("Validade Calço/Extintor 1", fmt_date(checklist.get('kit_validity_1'))),
        ("Validade 2", fmt_date(checklist.get('kit_validity_2'))),
        ("Validade 3", fmt_date(checklist.get('kit_validity_3'))),
        ("Últ. Viagem - Produto 1", checklist.get('last_trip_product_1')),
        ("Produto 2", checklist.get('last_trip_product_2')),
        ("Produto 3", checklist.get('last_trip_product_3')),
    ], SECTION_WIDTH, cols=3))

    # ========== OBSERVAÇÕES ==========
    if checklist.get('observations'):
        elements.append(Spacer(1, 10))
        elements.append(_pdf_note_box("Observações", checklist['observations'], SECTION_WIDTH))

    # ========== RESPONSÁVEIS ==========
    elements.extend(_pdf_section_title("Responsáveis", SECTION_WIDTH))
    elements.append(_pdf_info_grid([
        ("Resp. Transportadora", checklist.get('transport_responsible_name')),
        ("RG", checklist.get('transport_responsible_rg')),
        ("Recebedor da LVT", checklist.get('lvt_receiver_name')),
        ("Matrícula", checklist.get('lvt_receiver_registration')),
        ("Resp. pela Vistoria", checklist.get('inspection_responsible_name')),
        ("Matrícula", checklist.get('inspection_responsible_registration')),
        ("Registro de Mérito", checklist.get('merit_record')),
        ("Registro de Ocorrências", checklist.get('occurrence_record')),
        ("Documento do Condutor", checklist.get('driver_document')),
        ("Liberação do Veículo", fmt_datetime(checklist.get('release_datetime'))),
    ], SECTION_WIDTH, cols=2))

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


# ==================== CHECKLIST DE VEÍCULO — MODELO PETROBRAS (LVT) ====================
# Réplica das informações da "Lista de Verificação de Transporte - LVT N° 14" (Petrobras),
# usada quando o cliente contratante do checklist é a Manuport. O logo oficial da Petrobras
# não está embutido (não temos o arquivo da marca) — usamos um cabeçalho em texto no lugar.

def generate_petrobras_lvt_pdf(checklist: dict, company: dict = None) -> bytes:
    """Gera o PDF do Checklist de Veículo no formato LVT da Petrobras."""
    c = merge_company(company)
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=12 * mm,
        leftMargin=12 * mm,
        topMargin=12 * mm,
        bottomMargin=15 * mm
    )

    elements = []
    styles = getSampleStyleSheet()
    # Largura útil real da página (A4 - margens), não o valor fixo 546 usado antes
    # (vazava ~19pt da margem em todas as tabelas do documento). As tabelas abaixo
    # que não usam SECTION_WIDTH diretamente têm suas larguras escaladas por
    # _scale, preservando as proporções originais do layout (réplica do formulário
    # oficial da Petrobras) dentro da área realmente disponível.
    SECTION_WIDTH = doc.width
    _scale = SECTION_WIDTH / 546
    BLACK = colors.black

    label_style = ParagraphStyle('LVTLabel', parent=styles['Normal'], fontSize=7.5, fontName='Helvetica')
    value_style = ParagraphStyle('LVTValue', parent=styles['Normal'], fontSize=8.5, fontName='Helvetica-Bold')
    section_label_style = ParagraphStyle('LVTSectionLabel', parent=styles['Normal'], fontSize=7.5, fontName='Helvetica-Bold', textColor=BLACK)
    item_style = ParagraphStyle('LVTItem', parent=styles['Normal'], fontSize=7.5, fontName='Helvetica', leading=9.5)
    static_style = ParagraphStyle('LVTStatic', parent=styles['Normal'], fontSize=7.5, fontName='Helvetica', leading=10)
    static_bold_style = ParagraphStyle('LVTStaticBold', parent=styles['Normal'], fontSize=8, fontName='Helvetica-Bold', leading=10)
    heading_style = ParagraphStyle('LVTHeading', parent=styles['Normal'], fontSize=9, fontName='Helvetica-Bold', alignment=TA_CENTER)

    def field(label, value):
        return Paragraph(f"<b>{label}:</b> {value if value not in (None, '') else ''}", label_style)

    # ========== CABEÇALHO (logo em texto, já que não temos o arquivo oficial) ==========
    logo_text = Paragraph("<b>BR</b><br/><font size=6>PETROBRAS</font>", ParagraphStyle('LVTLogo', parent=styles['Normal'], fontSize=16, fontName='Helvetica-Bold', textColor=colors.HexColor('#006633'), alignment=TA_CENTER, leading=16))
    title_block = [
        [Paragraph("LISTA DE VERIFICAÇÃO DE TRANSPORTE - LVT N° 14", heading_style), Paragraph("Versão: 01/2023 Rev. 3", ParagraphStyle('LVTVer', parent=styles['Normal'], fontSize=7, alignment=TA_RIGHT))],
        [Paragraph("INSPEÇÃO DE VEÍCULOS PARA TRANSPORTE RODOVIÁRIO DE DERIVADOS DE PETRÓLEO", ParagraphStyle('LVTSub', parent=styles['Normal'], fontSize=8, fontName='Helvetica-BoldOblique', alignment=TA_CENTER)), ""],
    ]
    title_table = Table(title_block, colWidths=[440 * _scale, 106 * _scale])
    title_table.setStyle(TableStyle([
        ('SPAN', (0, 1), (1, 1)),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
    ]))
    header_table = Table([[logo_text, title_table]], colWidths=[70 * _scale, 476 * _scale])
    header_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1.2, BLACK),
        ('INNERGRID', (0, 0), (-1, -1), 1.2, BLACK),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (0, 0), (0, 0), 'CENTER'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    elements.append(header_table)
    elements.append(Spacer(1, 4))

    # ========== INFORMAÇÕES DO CABEÇALHO (mesma ordem/agrupamento do documento original) ==========
    cnh_line = f"{checklist.get('cnh_number') or '-'} / {checklist.get('cnh_category') or '-'} / {fmt_date(checklist.get('cnh_expiry'))}"
    header_rows = [
        [field("Expedidor", checklist.get('expedidor') or "Petróleo Brasileiro S.A."), field("UN", checklist.get('un')), field("Data e Hora da vistoria", fmt_datetime(checklist.get('inspection_datetime')))],
        [field("Endereço da UN", checklist.get('un_address')), field("Telefones", checklist.get('phone')), field("Fax", checklist.get('fax'))],
        [field("Cliente", checklist.get('client_name')), field("Número ORP / ODP", checklist.get('orp_odp_number')), field("Número da NF (Descarga)", checklist.get('nf_number'))],
        [field("Transportadora", checklist.get('transport_company_name')), field("Motorista", checklist.get('driver_name')), field("Produto(s)", checklist.get('products_description'))],
        [field("Placa do cavalo", checklist.get('cavalo_plate')), field("Placa da carreta 1 / Ano", f"{checklist.get('carreta1_plate') or '-'} / {checklist.get('carreta1_year') or '-'}"), field("Placa da carreta 2 / Ano", f"{checklist.get('carreta2_plate') or '-'} / {checklist.get('carreta2_year') or '-'}")],
        [field("Ano de Fabricação do Cavalo", checklist.get('cavalo_year')), field("Capacidade carreta 1", checklist.get('carreta1_capacity')), field("Capacidade carreta 2", checklist.get('carreta2_capacity'))],
        [field("Nº CNH / Categoria / Vencimento", cnh_line), field("Código SAP", checklist.get('sap_code')), ""],
    ]
    header_info_table = Table(header_rows, colWidths=[SECTION_WIDTH / 3] * 3)
    header_info_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1, BLACK),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, BLACK),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    elements.append(header_info_table)
    elements.append(Spacer(1, 6))

    # ========== ATENÇÃO / REPROVAÇÃO ==========
    has_failure = any(
        item.get('answer') == 'NAO'
        for section in VEHICLE_CHECKLIST_TEMPLATE_SECTIONS
        for item in (checklist.get(f"{section}_items") or [])
    )
    if has_failure:
        warn_style = ParagraphStyle('LVTWarn', parent=styles['Normal'], fontSize=9, fontName='Helvetica-Bold', textColor=colors.white, alignment=TA_CENTER)
        warn_table = Table([[Paragraph("ATENÇÃO: há item que não atende aos requisitos — o carregamento deve ser cancelado.", warn_style)]], colWidths=[SECTION_WIDTH])
        warn_table.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#DC2626')), ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5)]))
        elements.append(warn_table)
        elements.append(Spacer(1, 6))

    # ========== DESCRIÇÃO — itens SIM/NÃO por seção ==========
    desc_header = Table([["DESCRIÇÃO", "SIM", "NÃO", "DOCUMENTOS / VENCIMENTO"]], colWidths=[380 * _scale, 30 * _scale, 30 * _scale, 106 * _scale])
    desc_header.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#F0F0F0')),
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 7.5),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
        ('BOX', (0, 0), (-1, -1), 1, BLACK),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, BLACK),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    elements.append(desc_header)

    for section in VEHICLE_CHECKLIST_TEMPLATE_SECTIONS:
        items = checklist.get(f"{section}_items") or []
        if not items:
            continue
        has_expiry = section == 'documentos'
        sec_rows = []
        for item in items:
            answer = item.get('answer')
            sec_rows.append([
                Paragraph(item.get('text', ''), item_style),
                "X" if answer == 'SIM' else "",
                "X" if answer == 'NAO' else "",
                fmt_date(item.get('expiry')) if has_expiry else "",
            ])
        sec_table = Table(
            [[Paragraph(VEHICLE_CHECKLIST_SECTION_LABELS[section], section_label_style), "", "", ""]] + sec_rows,
            colWidths=[380 * _scale, 30 * _scale, 30 * _scale, 106 * _scale]
        )
        sec_style = [
            ('SPAN', (0, 0), (-1, 0)),
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#D9D9D9')),
            ('ALIGN', (1, 1), (2, -1), 'CENTER'),
            ('FONTNAME', (1, 1), (2, -1), 'Helvetica-Bold'),
            ('BOX', (0, 0), (-1, -1), 1, BLACK),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, BLACK),
            ('LEFTPADDING', (0, 0), (-1, -1), 4),
            ('TOPPADDING', (0, 0), (-1, -1), 2.5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]
        sec_table.setStyle(TableStyle(sec_style))
        elements.append(sec_table)

    elements.append(Spacer(1, 8))

    # ========== DECLARAÇÃO DO MOTORISTA / TRANSPORTADORA (texto padrão do documento) ==========
    declaration_text = (
        "<b>A transportadora e o motorista declaram que:</b> "
        "1) Observarão as Normas do Decreto nº 96.044 de 18 de maio de 1988, e demais legislações pertinentes, "
        "para o carregamento e transporte. "
        "2) Manifestam a concordância e anuência com a participação do motorista nas operações de carregamento, "
        "descarregamento e transbordo de carga (quando aplicável). "
        "3) O motorista está com Curso Básico em Norma Regulamentadora nº 20 concluído e válido, com carga horária "
        "de 8 horas e com certificado emitido. "
        "4) O motorista está capacitado para trabalho em altura (quando aplicável), para atividades acima de 2,00m "
        "do nível inferior, onde haja risco de queda, conforme atendimento à Norma Regulamentadora nº 35. "
        "5) O motorista está portando a FISPQ do produto."
    )
    decl_table = Table([[Paragraph(declaration_text, static_style)]], colWidths=[SECTION_WIDTH])
    decl_table.setStyle(TableStyle([('BOX', (0, 0), (-1, -1), 1, BLACK), ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6), ('LEFTPADDING', (0, 0), (-1, -1), 6)]))
    elements.append(decl_table)
    elements.append(Spacer(1, 10))

    # ========== PRODUTOS / RÓTULOS DE RISCO ==========
    products = checklist.get('products') or []
    prod_title = Table([[Paragraph("PRODUTOS TRANSPORTADOS (válido para o(s) seguinte(s) produto(s))", static_bold_style)]], colWidths=[SECTION_WIDTH])
    prod_title.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#F0F0F0')), ('BOX', (0, 0), (-1, -1), 1, BLACK), ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4), ('LEFTPADDING', (0, 0), (-1, -1), 6)]))
    elements.append(prod_title)
    prod_rows = [["Produto", "ONU", "Nº de Risco", "Subclasse"]]
    for p in products:
        prod_rows.append([
            Paragraph(p.get('product') or '-', item_style),
            p.get('un_number') or '-', p.get('risk_number') or '-', p.get('subclass') or '-'
        ])
    if len(prod_rows) == 1:
        prod_rows.append(['-', '-', '-', '-'])
    prod_table = Table(prod_rows, colWidths=[246 * _scale, 100 * _scale, 100 * _scale, 100 * _scale])
    prod_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#F0F0F0')),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 7.5),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
        ('BOX', (0, 0), (-1, -1), 1, BLACK),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, BLACK),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    elements.append(prod_table)
    elements.append(Spacer(1, 10))

    # ========== UNIFORME E EPI (texto de referência fixo do documento) ==========
    uniforme_epi_text = (
        "<b>UNIFORME:</b> Calça de brim ou algodão; Camisa de brim ou algodão (mangas compridas); Bota de couro fechada.<br/><br/>"
        "<b>EQUIPAMENTOS DE PROTEÇÃO INDIVIDUAL (EPI)</b> — todos devem possuir Certificado de Aprovação (CA): "
        "Luvas de PVC; Capacete com jugular; Protetor auricular; Proteção respiratória semi-facial com filtro químico "
        "para vapores orgânicos; Óculos ampla visão com proteção lateral; Cinto de segurança para trabalho em altura "
        "(uso obrigatório nas baias de carregamento, quando acessar a parte superior do caminhão)."
    )
    epi_table = Table([[Paragraph("UNIFORME E EQUIPAMENTOS DE PROTEÇÃO INDIVIDUAL (EPI)", static_bold_style)], [Paragraph(uniforme_epi_text, static_style)]], colWidths=[SECTION_WIDTH])
    epi_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, 0), colors.HexColor('#F0F0F0')),
        ('BOX', (0, 0), (-1, -1), 1, BLACK),
        ('LINEBELOW', (0, 0), (-1, 0), 1, BLACK),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ]))
    elements.append(epi_table)
    elements.append(Spacer(1, 8))

    # ========== KIT DE EMERGÊNCIA (texto de referência fixo + validades preenchidas) ==========
    kit_text = (
        "Calços, com dimensões mínimas de 150mm x 200mm x 150mm (2 unid. em caminhão ou caminhão-trator com "
        "semirreboque; 4 unid. em caminhão com reboque, bitrem, bitrenzão ou rodotrem); Jogo de ferramentas adequado "
        "para reparos em situações de emergência (alicate universal, chave de fenda ou Philips, chave para desconexão "
        "do cabo da bateria); Triângulo ou equipamento similar reflexivo; 1 extintor de incêndio de Pó Químico ou "
        "Gás Carbônico de 2 kg."
    )
    validity_line = f"Validades: {fmt_date(checklist.get('kit_validity_1'))}, {fmt_date(checklist.get('kit_validity_2'))} e {fmt_date(checklist.get('kit_validity_3'))}."
    kit_table = Table([
        [Paragraph("KIT DE EMERGÊNCIA", static_bold_style)],
        [Paragraph(kit_text, static_style)],
        [Paragraph(f"<b>{validity_line}</b>", static_style)],
    ], colWidths=[SECTION_WIDTH])
    kit_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, 0), colors.HexColor('#F0F0F0')),
        ('BOX', (0, 0), (-1, -1), 1, BLACK),
        ('LINEBELOW', (0, 0), (-1, 0), 1, BLACK),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ]))
    elements.append(kit_table)
    elements.append(Spacer(1, 8))

    elements.append(Paragraph(
        "<b>Aparelhos eletrônicos (celular, bip, nextel) OBRIGATORIAMENTE DEVEM ESTAR DESLIGADOS na Base de Carregamento.</b>",
        ParagraphStyle('LVTPhoneWarn', parent=styles['Normal'], fontSize=8, fontName='Helvetica-Bold', alignment=TA_CENTER)
    ))
    elements.append(Spacer(1, 8))

    # ========== REGISTRO DE OBSERVAÇÕES ==========
    if checklist.get('observations'):
        obs_table = Table([[Paragraph("REGISTRO DE OBSERVAÇÕES", static_bold_style)], [Paragraph(checklist['observations'], static_style)]], colWidths=[SECTION_WIDTH])
        obs_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, 0), colors.HexColor('#F0F0F0')),
            ('BOX', (0, 0), (-1, -1), 1, BLACK),
            ('LINEBELOW', (0, 0), (-1, 0), 1, BLACK),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ]))
        elements.append(obs_table)
        elements.append(Spacer(1, 8))

    # ========== DECLARAÇÕES (texto padrão do documento) ==========
    trips = ", ".join(filter(None, [checklist.get('last_trip_product_1'), checklist.get('last_trip_product_2'), checklist.get('last_trip_product_3')])) or '-'
    expedidor_decl = (
        "<b>EXPEDIDOR/TRANSPORTADOR:</b> 1 - Declaramos que o veículo acima caracterizado foi inspecionado e que "
        "neste momento encontra-se em perfeito estado de conservação, que a documentação exigida foi entregue, que "
        "foram informados os riscos e características do(s) produto(s) a ser(em) transportado(s), que as embalagens "
        "atendem às legislações, que o veículo está apto ao transporte e que estão colocados corretamente os rótulos "
        "de risco e painéis de segurança. "
        "2 - Declaramos que o veículo está com as válvulas de descarregamento na posição fechada e em pleno "
        "funcionamento. "
        f"3 - Declaramos que as últimas 3 viagens do veículo foram com os seguintes produtos: {trips}."
    )
    condutor_decl = (
        "<b>CONDUTOR:</b> 1 - Declaro que o veículo acima caracterizado foi inspecionado pelo transportador/expedidor "
        "e que neste momento encontra-se em perfeito estado de conservação, que a documentação exigida foi recebida, "
        "que foram recebidas as informações sobre os riscos e características do(s) produto(s) e que todos os "
        "documentos, identificação e equipamentos permanecerão no veículo até o destino final da carga. "
        "2 - Declaro que cumpri o descanso previsto na legislação."
    )
    decl2_table = Table([[Paragraph(expedidor_decl, static_style)], [Paragraph(condutor_decl, static_style)]], colWidths=[SECTION_WIDTH])
    decl2_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1, BLACK),
        ('LINEBELOW', (0, 0), (-1, 0), 0.5, BLACK),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ]))
    elements.append(decl2_table)
    elements.append(Spacer(1, 8))

    # ========== RESPONSÁVEIS / ASSINATURAS ==========
    def info_pair(label, value):
        return [Paragraph(label, label_style), Paragraph(str(value) if value not in (None, '') else '-', value_style)]

    resp_rows = [
        [info_pair("Responsável da Transportadora", checklist.get('transport_responsible_name')), info_pair("RG", checklist.get('transport_responsible_rg'))],
        [info_pair("Recebedor da LVT", checklist.get('lvt_receiver_name')), info_pair("Matrícula", checklist.get('lvt_receiver_registration'))],
        [info_pair("Responsável pela Vistoria", checklist.get('inspection_responsible_name')), info_pair("Matrícula", checklist.get('inspection_responsible_registration'))],
        [info_pair("Registro de Mérito", checklist.get('merit_record')), info_pair("Registro de Ocorrências", checklist.get('occurrence_record'))],
        [info_pair("Data e Horário da Liberação do Veículo", fmt_datetime(checklist.get('release_datetime'))), info_pair("Documento do Condutor", checklist.get('driver_document'))],
    ]
    resp_table = Table(resp_rows, colWidths=[SECTION_WIDTH / 2, SECTION_WIDTH / 2])
    resp_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1, BLACK),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CCCCCC')),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    elements.append(resp_table)
    elements.append(Spacer(1, 10))

    # ========== RODAPÉ DE ADVERTÊNCIA ==========
    footer_warn = Table([[Paragraph("NÃO SERÁ ACEITO NENHUM TIPO DE RASURA NESTE DOCUMENTO", ParagraphStyle('LVTFooterWarn', parent=styles['Normal'], fontSize=9, fontName='Helvetica-Bold', alignment=TA_CENTER))]], colWidths=[SECTION_WIDTH])
    footer_warn.setStyle(TableStyle([('BOX', (0, 0), (-1, -1), 1, BLACK), ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5)]))
    elements.append(footer_warn)

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


# ==================== REGISTRO DE GATE — COMPROVANTE EM PDF (para download) ====================
# Réplica do comprovante hoje só disponível via impressão do navegador
# (frontend/src/pages/MovementDetailPage.js, componente ViaSection) - mesmas caixas
# e campos, mas gerado no servidor pra virar um arquivo baixável, uma via por vez
# (Terminal ou Motorista, nunca as duas juntas nesse fluxo) e uma página por
# movimentação selecionada.

_MOVEMENT_DAMAGE_LABELS = {
    'SEM_AVARIA': 'Sem Avaria',
    'AMASSADO': 'Amassado',
    'FURADO': 'Furado/Perfurado',
    'VAZAMENTO': 'Vazamento',
    'ESTRUTURA_COMPROMETIDA': 'Estrutura Comprometida',
    'PISO_DANIFICADO': 'Piso Danificado',
    'PORTAS_DANIFICADAS': 'Portas Danificadas',
    'SUJEIRA_RESIDUOS': 'Sujeira/Resíduos',
    'LACRE_VIOLADO': 'Lacre Violado',
}


def _voucher_field(label, value, label_value_style):
    """Um par label/valor no estilo 'comprovante' - extraído de
    generate_movement_voucher_pdf pra ser reaproveitado por outros documentos
    no mesmo formato visual (ex: Ordem de Carregamento)."""
    v = value if value not in (None, '') else '-'
    return Paragraph(
        f'<font size=6.5 color="#{BRAND_MUTED}">{str(label).upper()}</font><br/>'
        f'<font size=9.5 color="#{BRAND_DARK}"><b>{v}</b></font>',
        label_value_style,
    )


def _voucher_field_row(pairs, width, label_value_style, n_cols=4):
    cells = [_voucher_field(l, v, label_value_style) for l, v in pairs]
    while len(cells) < n_cols:
        cells.append('')
    col_w = width / n_cols
    t = Table([cells], colWidths=[col_w] * n_cols)
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    return t


def _voucher_boxed_section(title, row_tables, width, box_title_style, extra=None):
    """Seção de comprovante: título na cor da marca e campos numa caixa de
    fundo suave com barra lateral - mesmo acabamento dos quadros de
    informação dos relatórios (_pdf_info_grid)."""
    inner = [Paragraph(f'<font color="#{PRIMARY_COLOR}"><b>{title}</b></font>', box_title_style)]
    for i, rt in enumerate(row_tables):
        inner.append(Spacer(1, 5 if i == 0 else 7))
        inner.append(rt)
    if extra:
        inner.append(Spacer(1, 5 if row_tables else 2))
        inner.extend(extra)
    wrapper = Table([[inner]], colWidths=[width])
    wrapper.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), _hex('F8FAFC')),
        ('BOX', (0, 0), (-1, -1), 0.6, _hex(BRAND_LINE)),
        ('LINEBEFORE', (0, 0), (0, -1), 2.5, _hex(PRIMARY_COLOR)),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
    ]))
    return wrapper


def generate_movement_voucher_pdf(movements: list, via: str, company: dict = None) -> bytes:
    """Gera o comprovante de Registro de Gate em PDF - uma página por movimentação
    selecionada, todas na mesma via escolhida (TERMINAL ou MOTORISTA)."""
    from reportlab.platypus import PageBreak
    from reportlab.graphics.barcode import code128

    c = merge_company(company)
    via_label = 'Via Terminal' if via == 'TERMINAL' else 'Via Motorista'
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        rightMargin=12 * mm, leftMargin=12 * mm, topMargin=10 * mm, bottomMargin=10 * mm
    )
    width = doc.width
    styles = getSampleStyleSheet()
    logo_buffer = download_logo(c)

    label_value_style = styles['Normal']
    box_title_style = ParagraphStyle('VoucherBoxTitle', parent=styles['Normal'], fontSize=9, fontName='Helvetica-Bold')
    footer_style = ParagraphStyle('VoucherFooter', parent=styles['Normal'], fontSize=7, alignment=TA_CENTER, textColor=_hex(BRAND_MUTED))

    def field(label, value):
        return _voucher_field(label, value, label_value_style)

    def field_row(pairs, n_cols=4):
        return _voucher_field_row(pairs, width, label_value_style, n_cols=n_cols)

    def boxed_section(title, row_tables, extra=None):
        return _voucher_boxed_section(title, row_tables, width, box_title_style, extra=extra)

    elements = []
    for idx, m in enumerate(movements):
        if idx > 0:
            elements.append(PageBreak())

        # Cabeçalho padrão (logo + empresa à esquerda); o título do comprovante,
        # o ID da transação e a via ficam no bloco da direita.
        elements.extend(_build_pdf_header(
            styles, logo_buffer,
            f"Comprovante de Movimentação - ID Transação #{m.get('transaction_id')}  ·  {via_label}",
            company=company, content_width=width,
        ))

        created_brt = to_brt(m.get('created_at'))
        created_str = created_brt.strftime('%d/%m/%Y %H:%M') if created_brt else '-'
        is_entry = m.get('operation_type') == 'ENTRADA'

        elements.append(boxed_section('Informações da Operação', [
            field_row([
                ('ID Transação', f"#{m.get('transaction_id')}"),
                ('Tipo de Operação', f'<font color="#{PRIMARY_COLOR if is_entry else PDF_TONES["amber"]}">{m.get("operation_type")}</font>'),
                ('Status', m.get('status')),
                ('Data/Hora', created_str),
            ]),
        ]))
        elements.append(Spacer(1, 6))

        elements.append(boxed_section('Informações do Veículo e Motorista', [
            field_row([
                ('Motorista', m.get('driver_name')),
                ('CPF', m.get('driver_cpf')),
                ('Transportadora', m.get('transport_company')),
            ], n_cols=3),
            field_row([
                ('Placa Cavalo', m.get('truck_plate')),
                ('Placa Carreta', m.get('trailer_plate_1')),
            ], n_cols=2),
        ]))
        elements.append(Spacer(1, 6))

        elements.append(boxed_section('Informações do Contêiner', [
            field_row([
                ('Número Container', m.get('container_number')),
                ('Tamanho/Tipo', m.get('size_type')),
                ('Armador', m.get('shipping_line')),
                ('Tara', m.get('tare')),
            ]),
            field_row([
                ('Lacre', m.get('seal')),
                ('Genset', m.get('genset')),
                ('Booking', m.get('booking')),
                ('Tipo de Serviço', m.get('service_type')),
            ]),
            field_row([
                ('Nota Fiscal', m.get('invoice_number')),
                ('Cliente', m.get('client_name')),
                ('Terminal de Origem', m.get('origin_terminal')),
            ], n_cols=3),
        ]))
        elements.append(Spacer(1, 6))

        if m.get('observations'):
            obs_style = ParagraphStyle('VoucherObs', parent=styles['Normal'], fontSize=9, leading=12, textColor=_hex(BRAND_TEXT))
            elements.append(boxed_section('Observações', [], extra=[
                Paragraph(str(m['observations']).replace('\n', '<br/>'), obs_style),
            ]))
            elements.append(Spacer(1, 6))

        damages = m.get('container_damages') or []
        photos = m.get('container_photos')
        notes = m.get('inspection_notes')
        if damages or photos or notes:
            extra = [field('Estado do Container', ', '.join(_MOVEMENT_DAMAGE_LABELS.get(d, d) for d in damages) if damages else '-')]
            if photos:
                extra.append(Spacer(1, 4))
                extra.append(Paragraph(f"{len(photos)} foto(s) do container anexada(s) ao registro digital.", ParagraphStyle('VoucherPhotoNote', parent=styles['Normal'], fontSize=8, textColor=_hex(BRAND_MUTED))))
            if notes:
                extra.append(Spacer(1, 4))
                extra.append(field('Observações da Vistoria', notes))
            elements.append(boxed_section('Vistoria de Container', [], extra=extra))
            elements.append(Spacer(1, 6))

        # Área de assinaturas
        elements.append(Spacer(1, 4))
        elements.append(_pdf_signatures([
            ('Assinatura do Motorista', f"{m.get('driver_name') or '-'}  ·  CPF {m.get('driver_cpf') or '-'}"),
            ('Assinatura do Responsável', f"{m.get('user_name') or '-'}  ·  {now_brt().strftime('%d/%m/%Y')}"),
        ], width, space_above=34))
        elements.append(Spacer(1, 12))

        # Código de barras + usuário + data/hora
        barcode_value = str(m.get('transaction_id') or 0).zfill(6)
        try:
            bc = code128.Code128(barcode_value, barWidth=1.0, barHeight=28)
        except Exception:
            bc = None
        bc_num = Paragraph(f"<b>{m.get('transaction_id')}</b>", ParagraphStyle('VoucherBcNum', parent=styles['Normal'], fontSize=8, alignment=TA_CENTER, textColor=_hex(BRAND_DARK)))
        left_cell = [bc, bc_num] if bc else [bc_num]
        info_label = ParagraphStyle('VoucherInfoLabel', fontName='Helvetica', fontSize=7, leading=9, textColor=_hex(BRAND_MUTED))
        info_value = ParagraphStyle('VoucherInfoValue', fontName='Helvetica-Bold', fontSize=9, leading=11, textColor=_hex(BRAND_DARK))
        right_info = [
            Paragraph("USUÁRIO", info_label),
            Paragraph(xml_escape(m.get('user_name') or '-'), info_value),
            Spacer(1, 3),
            Paragraph("DATA E HORA DA IMPRESSÃO", info_label),
            Paragraph(now_brt().strftime('%d/%m/%Y %H:%M'), info_value),
        ]
        info_tbl = Table([[left_cell, right_info]], colWidths=[110, width - 110])
        info_tbl.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (0, 0), 0),
            ('LEFTPADDING', (1, 0), (1, 0), 14),
            ('LINEBELOW', (0, 0), (-1, -1), 0.75, _hex(BRAND_LINE)),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ]))
        elements.append(info_tbl)
        elements.append(Spacer(1, 6))

        elements.append(Paragraph(
            f"{xml_escape(c['name'])}  ·  Este documento é válido como comprovante de movimentação",
            footer_style
        ))

    doc.build(elements)
    buffer.seek(0)
    return buffer.getvalue()


# ==================== ENTREGA DE EPI'S ====================

EPI_DECLARATION = (
    "Declaro ter recebido gratuitamente de {company} os Equipamentos de Proteção Individual (EPI) "
    "relacionados neste documento, em perfeito estado de conservação e funcionamento, e ter sido "
    "orientado(a) sobre o uso correto, a guarda e a conservação de cada um. Comprometo-me a usá-los "
    "apenas para a finalidade a que se destinam, a responsabilizar-me pela guarda e conservação, a "
    "comunicar qualquer alteração que os torne impróprios para uso e a devolvê-los quando solicitado, "
    "ciente de que o uso é obrigatório (NR-6)."
)


def _fmt_qty(value):
    """Quantidade sem casas desnecessárias: 1 -> "1", 1.5 -> "1,5"."""
    try:
        v = float(value or 0)
    except (TypeError, ValueError):
        return str(value)
    return (f"{v:.3f}".rstrip('0').rstrip('.')).replace('.', ',')


def _fmt_date_br(value):
    if not value:
        return '-'
    try:
        return datetime.fromisoformat(str(value)[:10]).strftime('%d/%m/%Y')
    except ValueError:
        return str(value)


def _signature_image(path, max_w, max_h):
    """Assinatura (PNG) redimensionada pra caber em max_w x max_h mantendo a
    proporção, ou None se o arquivo não existir/não abrir."""
    if not path:
        return None
    try:
        with PILImage.open(path) as im:
            w, h = im.size
        if not w or not h:
            return None
        scale = min(max_w / w, max_h / h)
        return Image(str(path), width=w * scale, height=h * scale, mask='auto')
    except Exception as e:
        logger.error(f"Error loading signature image: {e}")
        return None


def _epi_person_grid(person, content_width, extra=None):
    """Quadro com os dados da pessoa que recebeu os EPIs."""
    is_employee = person.get('type') == 'FUNCIONARIO'
    pairs = [
        ('Nome', person.get('recipient_name'), 2),
        ('CPF', person.get('recipient_cpf')),
        ('Tipo', 'Funcionário' if is_employee else 'Motorista'),
        ('Cargo / Função', person.get('recipient_position')),
    ]
    if is_employee:  # Setor/Matrícula só existem no cadastro de Funcionário
        pairs += [('Setor', person.get('recipient_department')), ('Matrícula', person.get('recipient_code'))]
    if is_employee and person.get('admission_date'):
        pairs.append(('Admissão', _fmt_date_br(person.get('admission_date'))))
    pairs += list(extra or [])
    return _pdf_info_grid(pairs, content_width, cols=4)


def generate_epi_delivery_pdf(delivery: dict, signature_path=None, company: dict = None) -> bytes:
    """Termo de Entrega de EPI de uma entrega: dados da pessoa, EPIs entregues
    (Qtd/Un/EPI/C.A.), declaração de recebimento e a assinatura da pessoa
    (importada/desenhada no cadastro) sobre a linha de assinatura."""
    c = merge_company(company)
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=15 * mm, leftMargin=15 * mm, topMargin=12 * mm, bottomMargin=18 * mm)
    width = doc.width
    styles = getSampleStyleSheet()
    cell = _pdf_cell_factory(styles, font_size=8)
    elements = []

    elements.extend(_build_pdf_header(
        styles, download_logo(company),
        f"Termo de Entrega de EPI - Nº {delivery.get('delivery_number')}  ·  {_fmt_date_br(delivery.get('delivery_date'))}",
        company=company, content_width=width,
    ))

    person = {**delivery, 'type': delivery.get('recipient_type')}
    elements.append(_epi_person_grid(person, width, extra=[
        ('Data da entrega', _fmt_date_br(delivery.get('delivery_date'))),
        ('Almoxarifado', delivery.get('warehouse_name'), 2),
        ('Entregue por', delivery.get('created_by_name')),
    ]))

    elements.extend(_pdf_section_title('EPIs entregues', width))
    rows = [_pdf_header_cells(['Qtd', 'Un', 'EPI', 'C.A.'], font_size=7.5)]
    for it in delivery.get('items') or []:
        rows.append([
            cell(_fmt_qty(it.get('quantity')), 'center', bold=True),
            cell(it.get('unit') or 'UN', 'center'),
            cell(it.get('product_description')),
            cell(it.get('ca_number'), 'center'),
        ])
    items_table = Table(rows, colWidths=[width * 0.10, width * 0.10, width * 0.60, width * 0.20], repeatRows=1)
    items_table.setStyle(TableStyle(_pdf_table_style()))
    elements.append(items_table)

    if delivery.get('observations'):
        elements.append(Spacer(1, 8))
        elements.append(_pdf_note_box('Observações', delivery.get('observations'), width))

    elements.append(Spacer(1, 10))
    elements.append(_pdf_note_box('Declaração', EPI_DECLARATION.format(company=c['name']), width))

    # Assinatura: a imagem fica logo acima da linha, no lado da pessoa; do
    # outro lado, a linha de quem entregou (assinada à mão, se for o caso).
    gap = 28
    col_w = (width - gap) / 2
    sig = _signature_image(signature_path, col_w - 20, 46)
    title_style = ParagraphStyle('EpiSignTitle', fontName='Helvetica-Bold', fontSize=8, leading=10, textColor=_hex(BRAND_DARK), alignment=TA_CENTER)
    sub_style = ParagraphStyle('EpiSignSub', fontName='Helvetica', fontSize=7, leading=9, textColor=_hex(BRAND_MUTED), alignment=TA_CENTER)
    no_sig_style = ParagraphStyle('EpiNoSig', fontName='Helvetica-Oblique', fontSize=7, leading=9, textColor=_hex(BRAND_MUTED), alignment=TA_CENTER)
    sign_table = Table([
        [sig or Paragraph('Sem assinatura no cadastro - assinar à mão', no_sig_style), '', ''],
        [[Paragraph(xml_escape(delivery.get('recipient_name') or '-'), title_style),
          Paragraph(f"CPF {xml_escape(delivery.get('recipient_cpf') or '-')}", sub_style)],
         '',
         [Paragraph('Responsável pela entrega', title_style),
          Paragraph(xml_escape(delivery.get('created_by_name') or '-'), sub_style)]],
    ], colWidths=[col_w, gap, col_w], rowHeights=[54, None])
    sign_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('VALIGN', (0, 0), (-1, 0), 'BOTTOM'),
        ('VALIGN', (0, 1), (-1, 1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 2),
        ('TOPPADDING', (0, 1), (-1, 1), 3),
        ('LINEBELOW', (0, 0), (0, 0), 0.8, _hex(BRAND_TEXT)),
        ('LINEBELOW', (2, 0), (2, 0), 0.8, _hex(BRAND_TEXT)),
    ]))
    elements.append(Spacer(1, 22))
    elements.append(sign_table)

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def generate_epi_ficha_pdf(person: dict, rows: list, company: dict = None, date_from=None, date_to=None) -> bytes:
    """Ficha de Controle de Entrega de EPI de uma pessoa: todos os EPIs que
    ela recebeu (um por linha), cada linha com a assinatura da entrega."""
    c = merge_company(company)
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=12 * mm, leftMargin=12 * mm, topMargin=12 * mm, bottomMargin=18 * mm)
    width = doc.width
    styles = getSampleStyleSheet()
    cell = _pdf_cell_factory(styles, font_size=7.5)
    elements = []

    period = None
    if date_from or date_to:
        period = f"Período: {_fmt_date_br(date_from) if date_from else 'início'} a {_fmt_date_br(date_to) if date_to else 'hoje'}"
    elements.extend(_build_pdf_header(
        styles, download_logo(company), f"Ficha de Controle de EPI - {person.get('recipient_name') or ''}",
        generation_info=period, company=company, content_width=width,
    ))
    elements.append(_epi_person_grid(person, width))
    elements.append(Spacer(1, 8))

    total_qty = sum(float(r.get('quantity') or 0) for r in rows)
    deliveries = len({r.get('delivery_number') for r in rows})
    elements.extend(_build_pdf_summary([
        ('Entregas', _fmt_int(deliveries)),
        ('EPIs entregues', _fmt_qty(total_qty)),
        ('Última entrega', _fmt_date_br(rows[-1].get('delivery_date')) if rows else '-'),
    ], width))

    elements.extend(_pdf_section_title('EPIs recebidos', width))
    if not rows:
        elements.append(_pdf_empty_state('Nenhuma entrega de EPI registrada para esta pessoa.', width))
    else:
        widths = [0.11, 0.07, 0.06, 0.06, 0.35, 0.12, 0.23]
        widths = [w * width for w in widths]
        data = [_pdf_header_cells(['Data', 'Nº', 'Qtd', 'Un', 'EPI', 'C.A.', 'Assinatura'], font_size=7)]
        no_sig_style = ParagraphStyle('EpiFichaNoSig', fontName='Helvetica-Oblique', fontSize=6.5, leading=8, textColor=_hex(BRAND_MUTED), alignment=TA_CENTER)
        for r in rows:
            sig = _signature_image(r.get('signature_path'), widths[-1] - 10, 26)
            data.append([
                cell(_fmt_date_br(r.get('delivery_date')), 'center'),
                cell(r.get('delivery_number'), 'center'),
                cell(_fmt_qty(r.get('quantity')), 'center', bold=True),
                cell(r.get('unit') or 'UN', 'center'),
                cell(r.get('product_description')),
                cell(r.get('ca_number'), 'center'),
                sig or Paragraph('sem assinatura', no_sig_style),
            ])
        table = Table(data, colWidths=widths, repeatRows=1)
        table.setStyle(TableStyle(_pdf_table_style() + [
            ('ALIGN', (-1, 1), (-1, -1), 'CENTER'),
            ('TOPPADDING', (0, 1), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 1), (-1, -1), 3),
        ]))
        elements.append(table)

    elements.append(Spacer(1, 10))
    elements.append(_pdf_note_box('Declaração', EPI_DECLARATION.format(company=c['name']), width))

    footer = _make_pdf_footer(c['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
