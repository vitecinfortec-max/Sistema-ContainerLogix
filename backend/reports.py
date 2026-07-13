from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from datetime import datetime, timezone, timedelta
import io
import os
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from openpyxl.drawing.image import Image as XLImage
import requests
from PIL import Image as PILImage
import logging

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

LOGO_URL = os.environ.get('LOGO_URL', "https://customer-assets.emergentagent.com/job_e636a955-bdb3-43db-964e-ca26060412cc/artifacts/026b56rs_J.A%20LOGISTICA%20-%201.png")

# Cor verde/teal da logo J.A Logística
PRIMARY_COLOR = "008B7B"
PRIMARY_COLOR_LIGHT = "E6F4F3"
HEADER_BG_COLOR = "E8F4F5"

def download_logo():
    """Download logo and return as file-like object"""
    try:
        response = requests.get(LOGO_URL, timeout=5)
        if response.status_code == 200:
            return io.BytesIO(response.content)
    except Exception as e:
        logger.error(f"Error downloading logo: {e}")
    return None


def _build_pdf_header(styles, logo_buffer, report_title, generation_info=None):
    """
    Build standard PDF header with logo on left and company info centered.
    """
    elements = []
    
    # ========== LOGO ==========
    logo_cell = ""
    if logo_buffer:
        try:
            logo = Image(logo_buffer, width=70, height=70)
            logo_cell = logo
        except Exception as e:
            logger.error(f"Error adding logo to PDF: {e}")
    
    # ========== COMPANY INFO ==========
    company_style = ParagraphStyle(
        'CompanyName',
        parent=styles['Normal'],
        fontSize=14,
        textColor=colors.black,
        alignment=TA_CENTER,
        fontName='Helvetica-Bold',
        leading=16
    )
    address_style = ParagraphStyle(
        'Address',
        parent=styles['Normal'],
        fontSize=9,
        textColor=colors.black,
        alignment=TA_CENTER,
        leading=12
    )
    
    company_info_elements = [
        Paragraph("J.A LOGÍSTICA E ARMAZENAGEM LTDA", company_style),
        Paragraph("CNPJ: 58.180.321/0001-03", address_style),
        Paragraph("Rodovia CE-155, 16226 - Distrito Industrial", address_style),
        Paragraph("São Gonçalo do Amarante - CE", address_style),
        Paragraph("operacional@jalogisticas.com | (85) 9 9175-1472", address_style),
    ]
    
    # Inner header table: Logo | Company Info
    header_data = [[logo_cell, company_info_elements]]
    header_table = Table(header_data, colWidths=[80, 350])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (0, 0), (0, 0), 'CENTER'),
        ('ALIGN', (1, 0), (1, 0), 'CENTER'),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
    ]))
    
    # Outer table to center the entire header on the page
    outer_table = Table([[header_table]], colWidths=[540])
    outer_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    elements.append(outer_table)
    elements.append(Spacer(1, 8))
    
    # Horizontal line separator
    elements.append(HRFlowable(width="100%", thickness=2, color=colors.HexColor(f'#{PRIMARY_COLOR}'), spaceAfter=10))
    
    # ========== REPORT TITLE ==========
    title_style = ParagraphStyle(
        'ReportTitle',
        parent=styles['Normal'],
        fontSize=14,
        textColor=colors.HexColor(f'#{PRIMARY_COLOR}'),
        alignment=TA_CENTER,
        fontName='Helvetica-Bold',
        spaceAfter=10
    )
    elements.append(Paragraph(report_title.upper(), title_style))
    
    return elements


def _build_pdf_footer(canvas, doc):
    """Build PDF footer with page number and system info."""
    canvas.saveState()
    
    # Footer line
    canvas.setStrokeColor(colors.HexColor(f'#{PRIMARY_COLOR}'))
    canvas.setLineWidth(0.5)
    canvas.line(doc.leftMargin, 25, doc.width + doc.leftMargin, 25)
    
    # Page number (left)
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(colors.grey)
    canvas.drawString(doc.leftMargin, 12, f"Página {doc.page}")
    
    # System info (right)
    canvas.drawRightString(doc.width + doc.leftMargin, 12, "ContainerLogix - J.A Logística")
    
    canvas.restoreState()


def generate_pdf_report(movements: list, report_title: str = "Relatório de Movimentações") -> bytes:
    """
    Generate PDF report following the exact J.A LOGÍSTICA model template.
    - Large "J.A LOGÍSTICA" centered, bold, teal color
    - Report title centered below
    - Statistics line centered
    - Generation date centered, gray, small
    - Table with gray header background, thin gray borders
    """
    buffer = io.BytesIO()
    
    # Use landscape orientation for A4
    doc = SimpleDocTemplate(
        buffer, 
        pagesize=landscape(A4), 
        rightMargin=10*mm, 
        leftMargin=10*mm, 
        topMargin=15*mm, 
        bottomMargin=10*mm
    )
    
    elements = []
    styles = getSampleStyleSheet()
    
    # ========== HEADER: "J.A LOGÍSTICA" - Large, centered, bold, teal ==========
    company_style = ParagraphStyle(
        'CompanyHeader',
        parent=styles['Normal'],
        fontSize=28,
        textColor=colors.HexColor(f'#{PRIMARY_COLOR}'),
        alignment=TA_CENTER,
        fontName='Helvetica-Bold',
        spaceBefore=0,
        spaceAfter=4
    )
    elements.append(Paragraph("J.A LOGÍSTICA", company_style))
    
    # ========== REPORT TITLE - centered, regular, teal, smaller ==========
    subtitle_style = ParagraphStyle(
        'ReportSubtitle',
        parent=styles['Normal'],
        fontSize=12,
        textColor=colors.HexColor(f'#{PRIMARY_COLOR}'),
        alignment=TA_CENTER,
        fontName='Helvetica',
        spaceBefore=8,
        spaceAfter=6
    )
    elements.append(Paragraph(report_title, subtitle_style))
    
    # ========== STATISTICS LINE ==========
    total_records = len(movements)
    total_entries = sum(1 for m in movements if m.get('operation_type') == 'ENTRADA')
    total_exits = sum(1 for m in movements if m.get('operation_type') == 'SAIDA')
    
    if "Estoque" in report_title:
        stats_text = f"Containers em Estoque: {total_records}"
    elif "Entradas" in report_title:
        stats_text = f"Total de Entradas: {total_records}"
    elif "Saídas" in report_title:
        stats_text = f"Total de Saídas: {total_records}"
    else:
        stats_text = f"Total: {total_records}  |  Entradas: {total_entries}  |  Saídas: {total_exits}"
    
    stats_style = ParagraphStyle(
        'StatsLine',
        parent=styles['Normal'],
        fontSize=11,
        textColor=colors.HexColor(f'#{PRIMARY_COLOR}'),
        alignment=TA_CENTER,
        fontName='Helvetica-Bold',
        spaceBefore=6,
        spaceAfter=8
    )
    elements.append(Paragraph(stats_text, stats_style))
    
    # ========== GENERATION INFO ==========
    gen_style = ParagraphStyle(
        'GenInfo',
        parent=styles['Normal'],
        fontSize=9,
        textColor=colors.HexColor('#808080'),
        alignment=TA_CENTER,
        spaceBefore=0,
        spaceAfter=12
    )
    gen_date = now_brt().strftime('%d/%m/%Y %H:%M')
    elements.append(Paragraph(f"Gerado em: {gen_date} | Fuso: UTC-3 (Brasília)", gen_style))
    
    # ========== TABLE SECTION ==========
    # 15 columns matching template
    data = [[
        'ID Trans.', 'Data/Hora', 'Tipo', 'Nº Container', 'Motorista', 'CPF',
        'Placa Cavalo', 'Placa 1ª Carreta', 'Placa 2ª Carreta', 'Transportadora',
        'Status', 'Tamanho', 'Tara', 'Armador', 'Booking'
    ]]
    
    for m in movements:
        dt_brt = to_brt(m.get('created_at'))
        created_at = dt_brt.strftime('%d/%m/%Y %H:%M') if dt_brt else str(m.get('created_at', '-'))
        
        data.append([
            str(m.get('transaction_id', '-')),
            created_at,
            "ENTRADA" if m.get('operation_type') == 'ENTRADA' else "SAÍDA",
            m.get('container_number', '-'),
            m.get('driver_name', '-'),
            m.get('driver_cpf', '-'),
            m.get('truck_plate', '-'),
            m.get('trailer_plate_1', '') or '-',
            m.get('trailer_plate_2', '') or '-',
            m.get('transport_company', '-'),
            m.get('status', 'VAZIO'),
            m.get('size_type', '-'),
            str(m.get('tare', '')) if m.get('tare') else '-',
            m.get('shipping_line', '-'),
            m.get('booking', '') or '-'
        ])

    # Column widths for 15 columns in landscape A4 (~780 points available)
    col_widths = [30, 56, 42, 58, 75, 48, 46, 52, 52, 72, 38, 38, 32, 52, 42]
    
    table = Table(data, colWidths=col_widths, repeatRows=1)
    
    # Gray color for header background (light gray like in the model)
    header_gray = colors.HexColor('#E8E8E8')
    border_gray = colors.HexColor('#CCCCCC')
    zebra_gray = colors.HexColor('#F8F8F8')
    
    table.setStyle(TableStyle([
        # Header styling - light gray background, black text
        ('BACKGROUND', (0, 0), (-1, 0), header_gray),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.black),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 7),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 5),
        ('TOPPADDING', (0, 0), (-1, 0), 5),
        
        # Body styling
        ('TEXTCOLOR', (0, 1), (-1, -1), colors.black),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 7),
        ('TOPPADDING', (0, 1), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 3),
        ('RIGHTPADDING', (0, 0), (-1, -1), 3),
        
        # Alignments
        ('ALIGN', (0, 1), (0, -1), 'CENTER'),   # ID Trans.
        ('ALIGN', (2, 1), (2, -1), 'CENTER'),   # Tipo
        ('ALIGN', (10, 1), (10, -1), 'CENTER'), # Status
        ('ALIGN', (11, 1), (11, -1), 'CENTER'), # Tamanho
        ('ALIGN', (12, 1), (12, -1), 'CENTER'), # Tara
        ('ALIGN', (1, 1), (1, -1), 'LEFT'),     # Data/Hora
        ('ALIGN', (3, 1), (3, -1), 'LEFT'),     # Nº Container
        ('ALIGN', (4, 1), (4, -1), 'LEFT'),     # Motorista
        ('ALIGN', (5, 1), (5, -1), 'LEFT'),     # CPF
        ('ALIGN', (6, 1), (6, -1), 'LEFT'),     # Placa Cavalo
        ('ALIGN', (7, 1), (7, -1), 'LEFT'),     # Placa 1ª Carreta
        ('ALIGN', (8, 1), (8, -1), 'LEFT'),     # Placa 2ª Carreta
        ('ALIGN', (9, 1), (9, -1), 'LEFT'),     # Transportadora
        ('ALIGN', (13, 1), (13, -1), 'LEFT'),   # Armador
        ('ALIGN', (14, 1), (14, -1), 'LEFT'),   # Booking
        
        # Thin gray borders
        ('GRID', (0, 0), (-1, -1), 0.25, border_gray),
        ('LINEBELOW', (0, 0), (-1, 0), 0.5, border_gray),
        
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        # Zebra striping
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, zebra_gray]),
    ]))
    
    elements.append(table)

    # ========== SAÍDAS POR BOOKING (resumo) ==========
    booking_counts = {}
    for m in movements:
        if m.get('operation_type') == 'SAIDA':
            booking = (m.get('booking') or '').strip()
            key = booking if booking else 'Sem Booking'
            booking_counts[key] = booking_counts.get(key, 0) + 1

    if booking_counts:
        elements.append(Spacer(1, 14))

        summary_title_style = ParagraphStyle(
            'BookingSummaryTitle',
            parent=styles['Normal'],
            fontSize=10,
            textColor=colors.HexColor(f'#{PRIMARY_COLOR}'),
            alignment=TA_LEFT,
            fontName='Helvetica-Bold',
            spaceAfter=4
        )
        total_exits_summary = sum(booking_counts.values())
        elements.append(Paragraph(
            f"Saídas por Booking ({total_exits_summary} container{'s' if total_exits_summary != 1 else ''})",
            summary_title_style
        ))

        # Ordenar por quantidade decrescente, depois por nome do booking
        sorted_bookings = sorted(booking_counts.items(), key=lambda x: (-x[1], x[0]))
        summary_data = [['Booking', 'Qtd. Containers (Saída)']]
        for booking_name, qty in sorted_bookings:
            summary_data.append([booking_name, str(qty)])
        summary_data.append(['TOTAL', str(total_exits_summary)])

        summary_table = Table(summary_data, colWidths=[180, 110])
        summary_table.setStyle(TableStyle([
            # Header
            ('BACKGROUND', (0, 0), (-1, 0), header_gray),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.black),
            ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 8),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 5),
            ('TOPPADDING', (0, 0), (-1, 0), 5),

            # Body
            ('FONTNAME', (0, 1), (-1, -2), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 8),
            ('ALIGN', (0, 1), (0, -1), 'LEFT'),
            ('ALIGN', (1, 1), (1, -1), 'CENTER'),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
            ('RIGHTPADDING', (0, 0), (-1, -1), 5),
            ('TOPPADDING', (0, 1), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 1), (-1, -1), 3),

            # Total row (last)
            ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor(f'#{HEADER_BG_COLOR}')),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),

            ('GRID', (0, 0), (-1, -1), 0.25, border_gray),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        elements.append(summary_table)

    # Build without footer
    doc.build(elements)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    
    return pdf_bytes


def _bsoft_style_excel(ws, title, info_text, headers, data_rows, col_widths, center_cols=None, right_align_cols=None, number_fmt_cols=None, total_col=None, stats_text=None):
    """
    Shared Bsoft-style Excel formatting matching the J.A LOGÍSTICA template.
    - ws: worksheet
    - title: report subtitle text (e.g., "Relatório de Estoque Atual - Cliente: X")
    - info_text: stats line (e.g., "Containers em Estoque: 182")
    - headers: list of header strings
    - data_rows: list of lists (each inner list = 1 row of data)
    - col_widths: dict {col_letter: width}
    - center_cols: set of 0-based col indices for center alignment
    - right_align_cols: set of 0-based col indices for right alignment
    - number_fmt_cols: dict {0-based col index: format_string}
    - total_col: 0-based col index for SUM total row (or None)
    - stats_text: optional separate stats text for row 6
    """
    from openpyxl.utils import get_column_letter

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

    # Colors from template
    TEAL_COLOR = '008B7B'
    STATS_BG = 'E8F4F5'
    ZEBRA_GRAY = 'F8F8F8'

    # Column A spacer
    ws.column_dimensions['A'].width = 3

    # Apply col widths (keys are B, C, D...)
    for letter, w in col_widths.items():
        ws.column_dimensions[letter].width = w

    # Border style - all thin
    thin_side = Side(style='thin', color='000000')
    thin_border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

    # ======== HEADER ========
    # Row 2-3: Company name "J.A LOGÍSTICA" (merged B2:O3)
    ws.merge_cells(f'{first_letter}2:{last_letter}3')
    c = ws[f'{first_letter}2']
    c.value = 'J.A LOGÍSTICA'
    c.font = Font(name='Calibri', size=38, bold=True, color=TEAL_COLOR)
    c.alignment = Alignment(horizontal='center', vertical='center')
    c.border = thin_border
    ws.row_dimensions[2].height = 30
    ws.row_dimensions[3].height = 40.5
    # Apply border to all cells in merged range
    for r in [2, 3]:
        for ci in range(first_col, last_col + 1):
            ws.cell(row=r, column=ci).border = thin_border

    # Row 4: Report subtitle (e.g., "Relatório de Estoque Atual - Cliente: X")
    ws.merge_cells(f'{first_letter}4:{last_letter}4')
    c = ws[f'{first_letter}4']
    c.value = title
    c.font = Font(name='Calibri', size=16, color=TEAL_COLOR)
    c.alignment = Alignment(horizontal='center', vertical='center')
    c.border = Border(left=thin_side, right=thin_side, top=Side(), bottom=thin_side)
    ws.row_dimensions[4].height = 21
    for ci in range(first_col, last_col + 1):
        cell = ws.cell(row=4, column=ci)
        cell.border = Border(left=thin_side, right=thin_side, top=Side(), bottom=thin_side)

    # Row 5: Empty spacer row
    ws.row_dimensions[5].height = 13

    # Row 6: Stats bar (e.g., "Containers em Estoque: 182")
    ws.merge_cells(f'{first_letter}6:{last_letter}6')
    c = ws[f'{first_letter}6']
    c.value = stats_text if stats_text else info_text
    c.font = Font(name='Calibri', size=12, bold=True, color=TEAL_COLOR)
    c.fill = PatternFill(start_color=STATS_BG, end_color=STATS_BG, fill_type='solid')
    c.alignment = Alignment(horizontal='center', vertical='center')
    c.border = thin_border
    ws.row_dimensions[6].height = 28
    for ci in range(first_col, last_col + 1):
        cell = ws.cell(row=6, column=ci)
        cell.fill = PatternFill(start_color=STATS_BG, end_color=STATS_BG, fill_type='solid')
        cell.border = thin_border

    # Row 7: Generation date/time
    ws.merge_cells(f'{first_letter}7:{last_letter}7')
    c = ws[f'{first_letter}7']
    c.value = f"Gerado em: {now_brt().strftime('%d/%m/%Y %H:%M')} | Fuso: UTC-3 (Brasília)"
    c.font = Font(name='Calibri', size=9, color='808080')
    c.alignment = Alignment(horizontal='center')
    c.border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=Side())
    ws.row_dimensions[7].height = 15
    for ci in range(first_col, last_col + 1):
        ws.cell(row=7, column=ci).border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=Side())

    # ======== COLUMN HEADERS (Row 8) ========
    header_row = 8
    header_fill = PatternFill(start_color=TEAL_COLOR, end_color=TEAL_COLOR, fill_type='solid')
    header_font = Font(name='Calibri', size=9, bold=True, color='FFFFFF')
    center_align = Alignment(horizontal='center', vertical='center', wrap_text=True)

    for i, h in enumerate(headers):
        ci = first_col + i
        cell = ws.cell(row=header_row, column=ci, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align
        cell.border = thin_border
    ws.row_dimensions[header_row].height = 18

    # ======== DATA ROWS ========
    data_start = header_row + 1
    total_data = len(data_rows)
    left_align = Alignment(horizontal='left', vertical='center')
    center_align_data = Alignment(horizontal='center', vertical='center')
    right_align = Alignment(horizontal='right', vertical='center')
    data_font = Font(name='Calibri', size=9)

    for row_offset, row_data in enumerate(data_rows):
        row_num = data_start + row_offset
        # Zebra striping: odd rows get gray background
        is_gray_row = (row_offset % 2 == 1)
        row_fill = PatternFill(start_color=ZEBRA_GRAY, end_color=ZEBRA_GRAY, fill_type='solid') if is_gray_row else PatternFill(fill_type=None)
        
        for i, val in enumerate(row_data):
            ci = first_col + i
            cell = ws.cell(row=row_num, column=ci, value=val)
            cell.font = data_font
            cell.border = thin_border
            if is_gray_row:
                cell.fill = row_fill
            
            # Apply alignment based on column type
            if i in center_cols:
                cell.alignment = center_align_data
            elif i in right_align_cols:
                cell.alignment = right_align
            elif i in number_fmt_cols:
                cell.alignment = right_align
                cell.number_format = number_fmt_cols[i]
            else:
                cell.alignment = left_align

    # ======== TOTAL ROW ========
    if total_col is not None and total_data > 0:
        total_row_num = data_start + total_data
        # Label
        label_ci = first_col + total_col - 1
        label_cell = ws.cell(row=total_row_num, column=label_ci, value='TOTAL:')
        label_cell.font = Font(name='Calibri', size=9, bold=True)
        label_cell.alignment = Alignment(horizontal='right', vertical='center')

        # Sum formula
        val_ci = first_col + total_col
        val_letter = get_column_letter(val_ci)
        sum_formula = f'=SUM({val_letter}{data_start}:{val_letter}{data_start + total_data - 1})'
        sum_cell = ws.cell(row=total_row_num, column=val_ci, value=sum_formula)
        sum_cell.font = Font(name='Calibri', size=9, bold=True)
        sum_cell.number_format = 'R$ #,##0.00'
        sum_cell.border = thin_border
        sum_cell.fill = PatternFill(start_color=STATS_BG, end_color=STATS_BG, fill_type='solid')


def generate_excel_report(movements: list, report_title: str = "Relatório de Movimentações") -> bytes:
    """Generate Excel report following Bsoft template style."""
    try:
        wb = Workbook()
        ws = wb.active
        ws.title = "Movimentações"

        total_records = len(movements)
        total_entries = sum(1 for m in movements if m.get('operation_type') == 'ENTRADA')
        total_exits = sum(1 for m in movements if m.get('operation_type') == 'SAIDA')

        if "Estoque" in report_title:
            stats_text = f"Containers em Estoque: {total_records}"
        elif "Entradas" in report_title:
            stats_text = f"Total de Entradas: {total_records}"
        elif "Saídas" in report_title:
            stats_text = f"Total de Saídas: {total_records}"
        else:
            stats_text = f"Total: {total_records}  |  Entradas: {total_entries}  |  Saídas: {total_exits}"

        # Headers matching template (15 columns, with Placa 2ª Carreta)
        headers = [
            'ID Trans.', 'Data/Hora', 'Tipo', 'Nº Container', 'Motorista', 'CPF',
            'Placa Cavalo', 'Placa 1ª Carreta', 'Placa 2ª Carreta', 'Transportadora',
            'Status', 'Tamanho', 'Tara', 'Armador', 'Booking'
        ]

        data_rows = []
        for m in movements:
            dt_brt = to_brt(m.get('created_at'))
            created_at = dt_brt.strftime('%d/%m/%Y %H:%M') if dt_brt else str(m.get('created_at', ''))
            data_rows.append([
                m.get('transaction_id', '-'),
                created_at,
                "ENTRADA" if m.get('operation_type') == 'ENTRADA' else "SAÍDA",
                m.get('container_number', '-'),
                m.get('driver_name', '-'),
                m.get('driver_cpf', '-'),
                m.get('truck_plate', '-'),
                m.get('trailer_plate_1', '-') or '-',
                m.get('trailer_plate_2', '-') or '-',
                m.get('transport_company', '-'),
                m.get('status', 'VAZIO'),
                m.get('size_type', '-'),
                m.get('tare', '') or '-',
                m.get('shipping_line', '-'),
                m.get('booking', '') or '-'
            ])

        # Column widths matching template (15 columns: B to P)
        col_widths = {
            'B': 7.3, 'C': 13.7, 'D': 8, 'E': 14, 'F': 30, 'G': 14,
            'H': 12, 'I': 14, 'J': 14, 'K': 27.3, 'L': 5.6, 'M': 7.6,
            'N': 4.5, 'O': 13.2, 'P': 12
        }

        # Center alignment for: ID Trans.(0), Tipo(2), Status(10), Tamanho(11), Tara(12)
        center_cols = {0, 2, 10, 11, 12}

        _bsoft_style_excel(
            ws, report_title, stats_text, headers, data_rows, col_widths,
            center_cols=center_cols,
            stats_text=stats_text
        )

        # ========== SAÍDAS POR BOOKING (resumo no final da planilha) ==========
        booking_counts = {}
        for m in movements:
            if m.get('operation_type') == 'SAIDA':
                booking_val = (m.get('booking') or '').strip()
                key = booking_val if booking_val else 'Sem Booking'
                booking_counts[key] = booking_counts.get(key, 0) + 1

        if booking_counts:
            from openpyxl.styles import Font as XLFont, Alignment as XLAlign, PatternFill as XLFill, Border as XLBorder, Side as XLSide

            thin_side = XLSide(style='thin', color='000000')
            thin_border = XLBorder(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)
            header_fill = XLFill(start_color='E8E8E8', end_color='E8E8E8', fill_type='solid')
            total_fill = XLFill(start_color='E8F4F5', end_color='E8F4F5', fill_type='solid')

            start_row = ws.max_row + 3  # deixa espaço da tabela principal

            # Título do bloco
            total_exits_summary = sum(booking_counts.values())
            ws.cell(row=start_row, column=2,
                    value=f"Saídas por Booking ({total_exits_summary} container{'s' if total_exits_summary != 1 else ''})")
            ws.cell(row=start_row, column=2).font = XLFont(name='Calibri', size=11, bold=True, color='008B7B')
            ws.merge_cells(start_row=start_row, start_column=2, end_row=start_row, end_column=3)

            # Cabeçalho da tabela
            header_row = start_row + 1
            ws.cell(row=header_row, column=2, value='Booking')
            ws.cell(row=header_row, column=3, value='Qtd. Containers (Saída)')
            for col_idx in (2, 3):
                cell = ws.cell(row=header_row, column=col_idx)
                cell.font = XLFont(name='Calibri', size=10, bold=True)
                cell.alignment = XLAlign(horizontal='center', vertical='center')
                cell.fill = header_fill
                cell.border = thin_border

            # Linhas de dados (ordenado por quantidade desc, depois alfabético)
            sorted_bookings = sorted(booking_counts.items(), key=lambda x: (-x[1], x[0]))
            current_row = header_row + 1
            for booking_name, qty in sorted_bookings:
                ws.cell(row=current_row, column=2, value=booking_name)
                ws.cell(row=current_row, column=3, value=qty)
                ws.cell(row=current_row, column=2).alignment = XLAlign(horizontal='left', vertical='center')
                ws.cell(row=current_row, column=3).alignment = XLAlign(horizontal='center', vertical='center')
                ws.cell(row=current_row, column=2).border = thin_border
                ws.cell(row=current_row, column=3).border = thin_border
                ws.cell(row=current_row, column=2).font = XLFont(name='Calibri', size=10)
                ws.cell(row=current_row, column=3).font = XLFont(name='Calibri', size=10)
                current_row += 1

            # Linha de total
            ws.cell(row=current_row, column=2, value='TOTAL')
            ws.cell(row=current_row, column=3, value=total_exits_summary)
            for col_idx in (2, 3):
                cell = ws.cell(row=current_row, column=col_idx)
                cell.font = XLFont(name='Calibri', size=10, bold=True)
                cell.alignment = XLAlign(
                    horizontal='left' if col_idx == 2 else 'center', vertical='center'
                )
                cell.fill = total_fill
                cell.border = thin_border

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


def generate_billing_excel(movements: list) -> bytes:
    """Generate billing Excel report with Bsoft template style."""
    try:
        wb = Workbook()
        ws = wb.active
        ws.title = "Faturamento"

        total_value = sum(m.get('service_value', 0) or 0 for m in movements)
        val_str = f"R$ {total_value:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')
        stats_text = f"Total: {len(movements)} movimentações  |  Valor Total: {val_str}"

        headers = [
            'ID', 'Data/Hora', 'Tipo', 'Nº Container', 'Cliente',
            'Placa', 'Transportadora', 'Armador', 'Status', 'Tamanho',
            'Tipo de Serviço', 'Nota Fiscal', 'VALOR DA OPERAÇÃO'
        ]

        data_rows = []
        for m in movements:
            dt_brt = to_brt(m.get('created_at'))
            created_at = dt_brt.strftime('%d/%m/%Y %H:%M') if dt_brt else str(m.get('created_at', ''))
            data_rows.append([
                m.get('transaction_id', '-'),
                created_at,
                m.get('operation_type', ''),
                m.get('container_number', ''),
                m.get('client_name', '') or '-',
                m.get('truck_plate', ''),
                m.get('transport_company', ''),
                m.get('shipping_line', ''),
                m.get('status', ''),
                m.get('size_type', ''),
                m.get('service_type', '') or '-',
                m.get('invoice_number', '') or '-',
                m.get('service_value') if m.get('service_value') else 0,
            ])

        col_widths = {
            'B': 7.3, 'C': 13.7, 'D': 8, 'E': 14, 'F': 25,
            'G': 12, 'H': 20, 'I': 14, 'J': 6, 'K': 8,
            'L': 16, 'M': 12, 'N': 18
        }

        # Center alignment for: ID(0), Tipo(2), Status(8), Tamanho(9)
        center_cols = {0, 2, 8, 9}

        _bsoft_style_excel(
            ws, "Relatório de Faturamento", stats_text, headers, data_rows, col_widths,
            center_cols=center_cols,
            right_align_cols={12},
            number_fmt_cols={12: 'R$ #,##0.00'},
            total_col=12,
            stats_text=stats_text
        )
        
        # ========== DADOS BANCÁRIOS ==========
        # Encontrar a última linha com dados
        last_row = ws.max_row + 3  # Pular 3 linhas após a tabela
        
        # Estilo para o título dos dados bancários
        bank_title_font = Font(size=12, bold=True, color="047857")
        bank_label_font = Font(size=10, bold=True)
        bank_value_font = Font(size=10)
        
        # Título "DADOS BANCÁRIOS PARA PAGAMENTO"
        ws.cell(row=last_row, column=2, value="DADOS BANCÁRIOS PARA PAGAMENTO")
        ws.cell(row=last_row, column=2).font = bank_title_font
        ws.merge_cells(start_row=last_row, start_column=2, end_row=last_row, end_column=6)
        
        # Linha separadora
        last_row += 1
        
        # Dados do banco
        bank_data = [
            ("Banco:", "Bradesco S/A"),
            ("Agência:", "699"),
            ("Conta Corrente:", "64660-1"),
            ("CNPJ:", "58.180.321/0001-03"),
            ("Beneficiário:", "J.A LOGISTICA LTDA"),
            ("", ""),
            ("Chave PIX:", "operacional@jalogisticas.com"),
        ]
        
        for label, value in bank_data:
            last_row += 1
            if label:
                ws.cell(row=last_row, column=2, value=label)
                ws.cell(row=last_row, column=2).font = bank_label_font
                ws.cell(row=last_row, column=3, value=value)
                ws.cell(row=last_row, column=3).font = bank_value_font
            elif value:
                ws.cell(row=last_row, column=2, value=value)
                ws.cell(row=last_row, column=2).font = bank_value_font

        buffer = io.BytesIO()
        wb.save(buffer)
        return buffer.getvalue()

    except Exception as e:
        logger.error(f"Error generating billing Excel: {e}")
        wb = Workbook()
        ws = wb.active
        ws['A1'] = "Erro ao gerar relatório."
        ws['A1'].font = Font(size=14, bold=True, color="FF0000")
        buffer = io.BytesIO()
        wb.save(buffer)
        return buffer.getvalue()


def generate_billing_pdf_report(movements: list, report_title: str = "Relatório de Faturamento") -> bytes:
    """
    Generate PDF billing report following Bsoft layout style.
    Header: Logo left, company name + address center, generation info right
    Table with financial columns and total row
    """
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=10*mm,
        leftMargin=10*mm,
        topMargin=10*mm,
        bottomMargin=15*mm
    )

    elements = []
    styles = getSampleStyleSheet()

    # ========== HEADER ==========
    logo_buffer = download_logo()
    header_elements = _build_pdf_header(styles, logo_buffer, report_title)
    elements.extend(header_elements)

    # ========== STATISTICS BAR ==========
    total_records = len(movements)
    total_value = sum(m.get('service_value', 0) or 0 for m in movements)
    total_billed = sum(1 for m in movements if m.get('billed'))
    total_unbilled = total_records - total_billed
    value_str = f"R$ {total_value:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')

    stats_text = f"Total: {total_records}  |  Faturadas: {total_billed}  |  Não Faturadas: {total_unbilled}  |  Valor Total: {value_str}"

    stats_style = ParagraphStyle(
        'BillingStatsBar',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.HexColor(f'#{PRIMARY_COLOR}'),
        alignment=TA_CENTER,
        fontName='Helvetica-Bold'
    )

    stats_data = [[Paragraph(stats_text, stats_style)]]
    stats_table = Table(stats_data, colWidths=[760])
    stats_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(f'#{HEADER_BG_COLOR}')),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor(f'#{PRIMARY_COLOR}')),
    ]))
    elements.append(stats_table)
    elements.append(Spacer(1, 10))

    # ========== TABLE ==========
    data = [[
        'ID', 'Data/Hora', 'Tipo', 'Nº Container', 'Cliente', 'Placa',
        'Transportadora', 'Armador', 'Status', 'Tamanho',
        'Tipo Serviço', 'Nota Fiscal', 'Valor'
    ]]

    for m in movements:
        dt_brt = to_brt(m.get('created_at'))
        created_at = dt_brt.strftime('%d/%m/%Y %H:%M') if dt_brt else str(m.get('created_at', '-'))

        service_value = m.get('service_value')
        val_str = f"R$ {service_value:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.') if service_value else '-'

        data.append([
            str(m.get('transaction_id', '-')),
            created_at,
            "ENTRADA" if m.get('operation_type') == 'ENTRADA' else "SAÍDA",
            m.get('container_number', '-'),
            m.get('client_name', '-') or '-',
            m.get('truck_plate', '-') or '-',
            m.get('transport_company', '-') or '-',
            m.get('shipping_line', '-') or '-',
            m.get('status', '-') or '-',
            m.get('size_type', '-') or '-',
            m.get('service_type', '-') or '-',
            m.get('invoice_number', '-') or '-',
            val_str
        ])

    # Total row
    data.append(['', '', '', '', '', '', '', '', '', '', '', 'TOTAL:', value_str])

    col_widths = [30, 58, 42, 62, 75, 45, 70, 55, 40, 42, 62, 52, 58]

    table = Table(data, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle([
        # Header styling
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor(f'#{PRIMARY_COLOR}')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 7),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 5),
        ('TOPPADDING', (0, 0), (-1, 0), 5),

        # Body styling
        ('BACKGROUND', (0, 1), (-1, -2), colors.white),
        ('TEXTCOLOR', (0, 1), (-1, -1), colors.black),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 7),
        ('TOPPADDING', (0, 1), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 2),
        ('RIGHTPADDING', (0, 0), (-1, -1), 2),
        
        # Alignments
        ('ALIGN', (0, 1), (0, -1), 'CENTER'),   # ID
        ('ALIGN', (2, 1), (2, -1), 'CENTER'),   # Tipo
        ('ALIGN', (8, 1), (8, -1), 'CENTER'),   # Status
        ('ALIGN', (9, 1), (9, -1), 'CENTER'),   # Tamanho
        ('ALIGN', (12, 1), (12, -1), 'RIGHT'),  # Valor
        
        # Borders
        ('GRID', (0, 0), (-1, -2), 0.5, colors.HexColor('#CCCCCC')),
        ('BOX', (0, 0), (-1, -2), 1, colors.HexColor(f'#{PRIMARY_COLOR}')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, colors.HexColor('#F8F8F8')]),

        # Total row styling
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor(f'#{HEADER_BG_COLOR}')),
        ('FONTNAME', (11, -1), (12, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (11, -1), (12, -1), 9),
        ('ALIGN', (11, -1), (11, -1), 'RIGHT'),
        ('ALIGN', (12, -1), (12, -1), 'RIGHT'),
        ('TOPPADDING', (0, -1), (-1, -1), 6),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 6),
        ('BOX', (11, -1), (12, -1), 1, colors.HexColor(f'#{PRIMARY_COLOR}')),
    ]))

    elements.append(table)

    # Build with footer
    doc.build(elements, onFirstPage=_build_pdf_footer, onLaterPages=_build_pdf_footer)
    pdf_bytes = buffer.getvalue()
    buffer.close()

    return pdf_bytes


def generate_invoice_pdf(invoice: dict, movements: list) -> bytes:
    """
    Generate PDF for a specific invoice following Bsoft layout style.
    Format: Landscape with header, client info, movements table, and total.
    """
    buffer = io.BytesIO()
    
    doc = SimpleDocTemplate(
        buffer, 
        pagesize=landscape(A4), 
        rightMargin=10*mm, 
        leftMargin=10*mm, 
        topMargin=10*mm, 
        bottomMargin=15*mm
    )
    
    elements = []
    styles = getSampleStyleSheet()
    
    # ========== HEADER SECTION ==========
    logo_buffer = download_logo()
    report_title = f"FATURA Nº {invoice.get('invoice_number', '-')}"
    header_elements = _build_pdf_header(styles, logo_buffer, report_title)
    elements.extend(header_elements)
    
    # ========== CLIENT INFO BAR ==========
    total_value = sum(m.get('service_value', 0) or 0 for m in movements)
    total_str = f"R$ {total_value:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')
    
    client_info_text = f"Cliente: {invoice.get('client_name', '-')}  |  CNPJ: {invoice.get('client_cnpj', '-') or '-'}  |  Movimentações: {len(movements)}  |  Valor Total: {total_str}"
    
    client_style = ParagraphStyle(
        'ClientInfo',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.HexColor(f'#{PRIMARY_COLOR}'),
        alignment=TA_CENTER,
        fontName='Helvetica-Bold'
    )
    
    client_data = [[Paragraph(client_info_text, client_style)]]
    client_table = Table(client_data, colWidths=[760])
    client_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(f'#{HEADER_BG_COLOR}')),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor(f'#{PRIMARY_COLOR}')),
    ]))
    elements.append(client_table)
    elements.append(Spacer(1, 10))
    
    # ========== MOVEMENTS TABLE ==========
    table_data = [[
        'ID', 'Data/Hora', 'Tipo', 'Nº Container', 'Cliente', 'Placa', 
        'Transportadora', 'Armador', 'Status', 'Tamanho', 
        'Tipo de Serviço', 'Nota Fiscal', 'VALOR DA OPERAÇÃO'
    ]]
    
    for m in movements:
        _m_dt = to_brt(m.get('created_at'))
        mov_date = _m_dt.strftime('%d/%m/%Y %H:%M') if _m_dt else '-'
        
        service_value = m.get('service_value')
        value_str = f"R$ {service_value:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.') if service_value else '-'
        
        table_data.append([
            str(m.get('transaction_id', '-')),
            mov_date,
            m.get('operation_type', '-'),
            m.get('container_number', '-'),
            m.get('client_name', '-') or '-',
            m.get('truck_plate', '-') or '-',
            m.get('transport_company', '-') or '-',
            m.get('shipping_line', '-') or '-',
            m.get('status', '-') or '-',
            m.get('size_type', '-') or '-',
            m.get('service_type', '-') or '-',
            m.get('invoice_number', '-') or '-',
            value_str
        ])
    
    # Total row
    table_data.append(['', '', '', '', '', '', '', '', '', '', '', 'TOTAL:', total_str])
    
    col_widths = [28, 55, 42, 62, 75, 42, 70, 52, 40, 42, 65, 50, 62]
    
    table = Table(table_data, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle([
        # Header
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor(f'#{PRIMARY_COLOR}')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 7),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 5),
        ('TOPPADDING', (0, 0), (-1, 0), 5),
        
        # Body
        ('BACKGROUND', (0, 1), (-1, -2), colors.white),
        ('TEXTCOLOR', (0, 1), (-1, -1), colors.black),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 7),
        ('TOPPADDING', (0, 1), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 2),
        ('RIGHTPADDING', (0, 0), (-1, -1), 2),
        
        # Alignments
        ('ALIGN', (0, 1), (0, -1), 'CENTER'),   # ID
        ('ALIGN', (2, 1), (2, -1), 'CENTER'),   # Tipo
        ('ALIGN', (8, 1), (8, -1), 'CENTER'),   # Status
        ('ALIGN', (9, 1), (9, -1), 'CENTER'),   # Tamanho
        ('ALIGN', (12, 1), (12, -1), 'RIGHT'),  # Valor
        
        # Borders
        ('GRID', (0, 0), (-1, -2), 0.5, colors.HexColor('#CCCCCC')),
        ('BOX', (0, 0), (-1, -2), 1, colors.HexColor(f'#{PRIMARY_COLOR}')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, colors.HexColor('#F8F8F8')]),
        
        # Total row
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor(f'#{HEADER_BG_COLOR}')),
        ('FONTNAME', (11, -1), (12, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (11, -1), (12, -1), 9),
        ('ALIGN', (11, -1), (11, -1), 'RIGHT'),
        ('ALIGN', (12, -1), (12, -1), 'RIGHT'),
        ('TOPPADDING', (0, -1), (-1, -1), 6),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 6),
        ('BOX', (11, -1), (12, -1), 1, colors.HexColor(f'#{PRIMARY_COLOR}')),
    ]))
    
    elements.append(table)
    
    # ========== NOTES SECTION ==========
    if invoice.get('notes'):
        elements.append(Spacer(1, 10))
        section_style = ParagraphStyle(
            'SectionTitle',
            parent=styles['Normal'],
            fontSize=10,
            textColor=colors.HexColor(f'#{PRIMARY_COLOR}'),
            fontName='Helvetica-Bold',
            spaceAfter=5
        )
        elements.append(Paragraph("OBSERVAÇÕES:", section_style))
        notes_style = ParagraphStyle(
            'NotesStyle',
            parent=styles['Normal'],
            fontSize=8,
            textColor=colors.black,
        )
        notes_data = [[Paragraph(invoice.get('notes', ''), notes_style)]]
        notes_table = Table(notes_data, colWidths=[760])
        notes_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#FFF9E6')),
            ('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#FFD700')),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ]))
        elements.append(notes_table)
    
    # Build with footer
    doc.build(elements, onFirstPage=_build_pdf_footer, onLaterPages=_build_pdf_footer)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    
    return pdf_bytes


def generate_invoice_excel(invoice: dict, movements: list) -> bytes:
    """Generate invoice Excel with Bsoft template style."""
    try:
        wb = Workbook()
        ws = wb.active
        ws.title = f"Fatura {invoice.get('invoice_number', '')}"

        _inv_dt = to_brt(invoice.get('created_at'))
        created_at = _inv_dt.strftime('%d/%m/%Y %H:%M') if _inv_dt else str(invoice.get('created_at', '-'))

        # Calculate total value
        total_value = sum(m.get('service_value', 0) or 0 for m in movements)
        val_str = f"R$ {total_value:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')
        
        title = f"FATURA Nº {invoice.get('invoice_number', '-')} - Cliente: {invoice.get('client_name', '-')}"
        stats_text = f"Total: {len(movements)} movimentações  |  Valor: {val_str}  |  Data: {created_at}"

        headers = [
            'ID', 'Data/Hora', 'Tipo', 'Nº Container', 'Cliente', 'Placa',
            'Transportadora', 'Armador', 'Status', 'Tamanho',
            'Tipo de Serviço', 'Nota Fiscal', 'VALOR DA OPERAÇÃO'
        ]

        data_rows = []
        for m in movements:
            _m_dt = to_brt(m.get('created_at'))
            mov_date = _m_dt.strftime('%d/%m/%Y %H:%M') if _m_dt else '-'
            data_rows.append([
                m.get('transaction_id', '-'),
                mov_date,
                m.get('operation_type', '-'),
                m.get('container_number', '-'),
                m.get('client_name', '-') or '-',
                m.get('truck_plate', '-') or '-',
                m.get('transport_company', '-') or '-',
                m.get('shipping_line', '-') or '-',
                m.get('status', '-') or '-',
                m.get('size_type', '-') or '-',
                m.get('service_type', '-') or '-',
                m.get('invoice_number', '-') or '-',
                m.get('service_value') if m.get('service_value') else 0,
            ])

        col_widths = {
            'B': 7.3, 'C': 13.7, 'D': 8, 'E': 14, 'F': 25, 'G': 12,
            'H': 20, 'I': 14, 'J': 6, 'K': 8, 'L': 16, 'M': 12, 'N': 18
        }

        # Center alignment for: ID(0), Tipo(2), Status(8), Tamanho(9)
        center_cols = {0, 2, 8, 9}

        _bsoft_style_excel(
            ws, title, stats_text,
            headers, data_rows, col_widths,
            center_cols=center_cols,
            right_align_cols={12},
            number_fmt_cols={12: 'R$ #,##0.00'},
            total_col=12,
            stats_text=stats_text
        )

        # Notes section
        data_start = 9  # Updated to match new header rows (8 = header row)
        notes_row = data_start + len(data_rows) + 2
        
        if invoice.get('notes'):
            ws.cell(row=notes_row, column=2, value="OBSERVAÇÕES:")
            ws.cell(row=notes_row, column=2).font = Font(name='Calibri', size=10, bold=True)
            ws.merge_cells(f'B{notes_row + 1}:N{notes_row + 1}')
            notes_cell = ws.cell(row=notes_row + 1, column=2, value=invoice.get('notes', ''))
            notes_cell.font = Font(name='Calibri', size=10)
            notes_cell.alignment = Alignment(wrap_text=True)
            notes_cell.border = Border(
                left=Side(style='thin'), right=Side(style='thin'),
                top=Side(style='thin'), bottom=Side(style='thin')
            )
            ws.row_dimensions[notes_row + 1].height = 30
            bank_start_row = notes_row + 3  # Pular 1 linha após observações
        else:
            bank_start_row = notes_row + 1
        
        # ========== DADOS BANCÁRIOS ==========
        # Estilo para o título dos dados bancários
        bank_title_font = Font(name='Calibri', size=12, bold=True, color="047857")
        bank_label_font = Font(name='Calibri', size=10, bold=True)
        bank_value_font = Font(name='Calibri', size=10)
        
        # Título "DADOS BANCÁRIOS PARA PAGAMENTO"
        ws.cell(row=bank_start_row, column=2, value="DADOS BANCÁRIOS PARA PAGAMENTO")
        ws.cell(row=bank_start_row, column=2).font = bank_title_font
        ws.merge_cells(start_row=bank_start_row, start_column=2, end_row=bank_start_row, end_column=6)
        
        # Dados do banco - SEM linha em branco entre Beneficiário e Chave PIX
        bank_data = [
            ("Banco:", "Bradesco S/A"),
            ("Agência:", "699"),
            ("Conta Corrente:", "64660-1"),
            ("CNPJ:", "58.180.321/0001-03"),
            ("Beneficiário:", "J.A LOGISTICA LTDA"),
            ("Chave PIX:", "operacional@jalogisticas.com"),
        ]
        
        current_row = bank_start_row
        for label, value in bank_data:
            current_row += 1
            ws.cell(row=current_row, column=2, value=label)
            ws.cell(row=current_row, column=2).font = bank_label_font
            ws.cell(row=current_row, column=3, value=value)
            ws.cell(row=current_row, column=3).font = bank_value_font

        buffer = io.BytesIO()
        wb.save(buffer)
        return buffer.getvalue()

    except Exception as e:
        logger.error(f"Error generating invoice Excel: {e}")
        wb = Workbook()
        ws = wb.active
        ws['A1'] = "Erro ao gerar fatura."
        ws['A1'].font = Font(size=14, bold=True, color="FF0000")
        buffer = io.BytesIO()
        wb.save(buffer)
        return buffer.getvalue()



def generate_intl_invoice_pdf(invoice: dict) -> bytes:
    """
    Generate International Invoice PDF following J.A LOGÍSTICA standard layout.
    Same style as movement reports but for international invoices.
    """
    buffer = io.BytesIO()
    
    doc = SimpleDocTemplate(
        buffer, 
        pagesize=A4, 
        rightMargin=15*mm, 
        leftMargin=15*mm, 
        topMargin=15*mm, 
        bottomMargin=20*mm
    )
    
    elements = []
    styles = getSampleStyleSheet()
    
    # Currency symbol
    currency_symbols = {'USD': '$', 'EUR': '€', 'BRL': 'R$'}
    currency_symbol = currency_symbols.get(invoice.get('currency', 'USD'), invoice.get('currency', 'USD'))
    
    # ========== HEADER SECTION ==========
    logo_buffer = download_logo()
    report_title = f"INVOICE Nº {invoice.get('invoice_number', '-')}"
    header_elements = _build_pdf_header(styles, logo_buffer, report_title)
    elements.extend(header_elements)
    
    # ========== INVOICE INFO BAR ==========
    total_str = f"{currency_symbol} {invoice.get('total', 0):,.2f}"
    info_text = f"Moeda: {invoice.get('currency', '-')}  |  Emissão: {invoice.get('issue_date', '-')}  |  Vencimento: {invoice.get('due_date', '-')}  |  Total: {total_str}"
    
    info_bar_style = ParagraphStyle(
        'InfoBar',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.HexColor(f'#{PRIMARY_COLOR}'),
        alignment=TA_CENTER,
        fontName='Helvetica-Bold'
    )
    
    info_bar_data = [[Paragraph(info_text, info_bar_style)]]
    info_bar_table = Table(info_bar_data, colWidths=[510])
    info_bar_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(f'#{HEADER_BG_COLOR}')),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor(f'#{PRIMARY_COLOR}')),
    ]))
    elements.append(info_bar_table)
    elements.append(Spacer(1, 15))
    
    # ========== PAYER INFO (Apenas Pagador) ==========
    section_title_style = ParagraphStyle(
        'SectionTitle',
        parent=styles['Heading2'],
        fontSize=11,
        textColor=colors.HexColor(f'#{PRIMARY_COLOR}'),
        fontName='Helvetica-Bold',
        spaceBefore=5,
        spaceAfter=5
    )
    
    info_style = ParagraphStyle(
        'InfoText',
        parent=styles['Normal'],
        fontSize=9,
        leading=12,
        textColor=colors.black
    )
    
    payer_text = f"""
    <b>{invoice.get('payer_company', '-')}</b><br/>
    CNPJ: {invoice.get('payer_cnpj', '-') or '-'}<br/>
    Contato: {invoice.get('payer_contact', '-') or '-'}<br/>
    E-mail: {invoice.get('payer_email', '-') or '-'}<br/>
    {invoice.get('payer_address', '-')}
    """
    
    parties_data = [
        [Paragraph("PAGADOR / PAYER", section_title_style)],
        [Paragraph(payer_text, info_style)]
    ]
    
    parties_table = Table(parties_data, colWidths=[510])
    parties_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor(f'#{PRIMARY_COLOR}')),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor(f'#{HEADER_BG_COLOR}')),
    ]))
    elements.append(parties_table)
    elements.append(Spacer(1, 15))
    
    # ========== ITEMS TABLE ==========
    elements.append(Paragraph("SERVIÇOS / SERVICES", section_title_style))
    elements.append(Spacer(1, 5))
    
    items_header = ['Descrição / Description', 'Qtd', 'Valor Unitário', 'Total']
    items_data = [items_header]
    
    for item in invoice.get('items', []):
        items_data.append([
            item.get('description', '-'),
            str(item.get('quantity', 1)),
            f"{currency_symbol} {item.get('unit_price', 0):,.2f}",
            f"{currency_symbol} {item.get('total', 0):,.2f}"
        ])
    
    # Total row
    items_data.append(['', '', 'TOTAL:', total_str])
    
    col_widths = [260, 50, 100, 100]
    
    items_table = Table(items_data, colWidths=col_widths, repeatRows=1)
    items_table.setStyle(TableStyle([
        # Header
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor(f'#{PRIMARY_COLOR}')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 6),
        ('TOPPADDING', (0, 0), (-1, 0), 6),
        
        # Body
        ('BACKGROUND', (0, 1), (-1, -2), colors.white),
        ('TEXTCOLOR', (0, 1), (-1, -1), colors.black),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 9),
        ('TOPPADDING', (0, 1), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        
        # Alignments
        ('ALIGN', (0, 1), (0, -1), 'LEFT'),    # Description
        ('ALIGN', (1, 1), (1, -1), 'CENTER'),  # Qty
        ('ALIGN', (2, 1), (2, -1), 'RIGHT'),   # Unit price
        ('ALIGN', (3, 1), (3, -1), 'RIGHT'),   # Total
        
        # Borders
        ('GRID', (0, 0), (-1, -2), 0.5, colors.HexColor('#CCCCCC')),
        ('BOX', (0, 0), (-1, -2), 1, colors.HexColor(f'#{PRIMARY_COLOR}')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, colors.HexColor('#F8F8F8')]),
        
        # Total row
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor(f'#{HEADER_BG_COLOR}')),
        ('FONTNAME', (2, -1), (3, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (2, -1), (3, -1), 11),
        ('ALIGN', (2, -1), (2, -1), 'RIGHT'),
        ('ALIGN', (3, -1), (3, -1), 'RIGHT'),
        ('TOPPADDING', (0, -1), (-1, -1), 8),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 8),
        ('BOX', (2, -1), (3, -1), 1, colors.HexColor(f'#{PRIMARY_COLOR}')),
    ]))
    
    elements.append(items_table)
    
    # ========== NOTES SECTION ==========
    if invoice.get('notes'):
        elements.append(Spacer(1, 15))
        elements.append(Paragraph("OBSERVAÇÕES / NOTES", section_title_style))
        elements.append(Spacer(1, 5))
        
        notes_style = ParagraphStyle(
            'Notes',
            parent=styles['Normal'],
            fontSize=9,
            leading=12,
            textColor=colors.HexColor('#333333'),
            borderColor=colors.HexColor('#CCCCCC'),
            borderWidth=1,
            borderPadding=8
        )
        
        notes_data = [[Paragraph(invoice['notes'], notes_style)]]
        notes_table = Table(notes_data, colWidths=[510])
        notes_table.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#CCCCCC')),
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#FAFAFA')),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ]))
        elements.append(notes_table)
    
    # ========== BARCODE SECTION ==========
    elements.append(Spacer(1, 25))
    
    # Generate barcode for invoice number
    import barcode
    from barcode.writer import ImageWriter
    
    barcode_buffer = io.BytesIO()
    try:
        invoice_num_str = str(invoice.get('invoice_number', '0')).zfill(3)
        code128 = barcode.get_barcode_class('code128')
        barcode_obj = code128(invoice_num_str, writer=ImageWriter())
        barcode_obj.write(barcode_buffer, options={
            'module_width': 0.3,
            'module_height': 12,
            'font_size': 10,
            'text_distance': 5,
            'quiet_zone': 2
        })
        barcode_buffer.seek(0)
        barcode_image = Image(barcode_buffer, width=120, height=50)
    except Exception as e:
        logger.error(f"Error generating barcode: {e}")
        barcode_image = Paragraph(f"[{invoice.get('invoice_number', '-')}]", styles['Normal'])
    
    # User and timestamp info
    created_by = invoice.get('created_by_name', 'Sistema')
    print_date = now_brt().strftime('%d/%m/%Y')
    
    user_info_style = ParagraphStyle(
        'UserInfo',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.black,
        fontName='Helvetica-Bold',
        leading=14
    )
    
    user_info = [
        Paragraph(f"Usuário: {created_by}", user_info_style),
        Spacer(1, 8),
        Paragraph(f"Data da impressão: {print_date}", user_info_style),
    ]
    
    # Barcode section table: Barcode | User Info
    barcode_section_data = [[barcode_image, user_info]]
    barcode_section_table = Table(barcode_section_data, colWidths=[150, 360])
    barcode_section_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (0, 0), (0, 0), 'LEFT'),
        ('ALIGN', (1, 0), (1, 0), 'LEFT'),
        ('LEFTPADDING', (1, 0), (1, 0), 20),
    ]))
    elements.append(barcode_section_table)
    
    # ========== FOOTER INFO ==========
    elements.append(Spacer(1, 15))
    
    footer_style = ParagraphStyle(
        'FooterInfo',
        parent=styles['Normal'],
        fontSize=8,
        textColor=colors.HexColor('#666666'),
        alignment=TA_CENTER
    )
    
    elements.append(Paragraph(f"Documento gerado em {now_brt().strftime('%d/%m/%Y')} | ContainerLogix - J.A Logística", footer_style))
    
    # Build PDF
    doc.build(elements)
    return buffer.getvalue()
