import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from typing import Optional, List

from models import (
    LoadingOrder, LoadingOrderCreate, LoadingOrderUpdate, LoadingOrderResponse,
)
from shared import db, get_current_active_user, get_company_settings
from reports import merge_company, now_brt

api_router = APIRouter(prefix="/api")

# ==================== ORDEM DE CARREGAMENTO (TRANSPORTE) ====================

_ORDER_TYPE_LABELS = {"COLETA": "Coleta de Container", "ENTREGA": "Entrega de Container"}
_STATUS_LABELS = {"PENDENTE": "Pendente", "APROVADA": "Aprovada", "CANCELADA": "Cancelada"}


@api_router.get("/loading-orders", response_model=List[LoadingOrderResponse])
async def list_loading_orders(
    search: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    query = {}
    if search:
        import re
        search_escaped = re.escape(search)
        query["$or"] = [
            {"container_number": {"$regex": search_escaped, "$options": "i"}},
            {"driver_name": {"$regex": search_escaped, "$options": "i"}},
            {"transport_company": {"$regex": search_escaped, "$options": "i"}},
        ]
    rows = await db.loading_orders.find(query, {"_id": 0}).sort("order_number", -1).to_list(None)
    return rows


@api_router.get("/loading-orders/next-number")
async def get_next_loading_order_number(current_user: dict = Depends(get_current_active_user)):
    """Só uma prévia pra tela; o número real é reservado de forma atômica na criação."""
    counter = await db.counters.find_one({"_id": "loading_order_number"})
    return {"next_number": (counter["seq"] + 1) if counter else 1}


@api_router.get("/loading-orders/{order_id}", response_model=LoadingOrderResponse)
async def get_loading_order(order_id: str, current_user: dict = Depends(get_current_active_user)):
    doc = await db.loading_orders.find_one({"id": order_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Ordem de Carregamento não encontrada")
    return doc


@api_router.post("/loading-orders", response_model=LoadingOrderResponse)
async def create_loading_order(data: LoadingOrderCreate, current_user: dict = Depends(get_current_active_user)):
    counter = await db.counters.find_one_and_update(
        {"_id": "loading_order_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    next_num = counter["seq"]

    obj = LoadingOrder(
        order_number=next_num,
        **data.model_dump(),
        created_by=current_user["sub"],
        created_by_name=current_user["name"]
    )
    doc = obj.model_dump()
    doc["created_at"] = obj.created_at.isoformat()
    await db.loading_orders.insert_one(doc)
    return doc


@api_router.put("/loading-orders/{order_id}", response_model=LoadingOrderResponse)
async def update_loading_order(order_id: str, data: LoadingOrderUpdate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.loading_orders.find_one({"id": order_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Ordem de Carregamento não encontrada")
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.loading_orders.update_one({"id": order_id}, {"$set": update_data})
    updated = await db.loading_orders.find_one({"id": order_id}, {"_id": 0})
    return updated


@api_router.delete("/loading-orders/{order_id}")
async def delete_loading_order(order_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.loading_orders.delete_one({"id": order_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Ordem de Carregamento não encontrada")
    return {"message": "Ordem de Carregamento removida"}


@api_router.get("/loading-orders/{order_id}/pdf")
async def download_loading_order_pdf(order_id: str, current_user: dict = Depends(get_current_active_user)):
    """Gera o PDF da Ordem de Carregamento no mesmo layout visual do
    comprovante de Registro de Gate (cabeçalho padrão, caixas com título,
    área de assinaturas, código de barras) - reaproveita os helpers de
    generate_movement_voucher_pdf em reports.py."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from reportlab.graphics.barcode import code128
    from reports import download_logo, _build_pdf_header, _voucher_field, _voucher_field_row, _voucher_boxed_section

    order = await db.loading_orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Ordem de Carregamento não encontrada")
    company = merge_company(await get_company_settings())

    def fmt_dt(s):
        if not s:
            return ''
        try:
            return datetime.fromisoformat(str(s).replace('Z', '+00:00')).strftime('%d/%m/%Y %H:%M')
        except Exception:
            return str(s)

    STATUS_HEX = {
        "APROVADA": "#15803D",
        "PENDENTE": "#B45309",
        "CANCELADA": "#B91C1C",
    }.get(order.get('status'), "#000000")

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        rightMargin=12 * mm, leftMargin=12 * mm, topMargin=7 * mm, bottomMargin=6 * mm
    )
    width = doc.width
    styles = getSampleStyleSheet()
    logo_buffer = download_logo(company)

    label_value_style = styles['Normal']
    box_title_style = ParagraphStyle('LOBoxTitle', parent=styles['Normal'], fontSize=9, fontName='Helvetica-Bold')
    title_style = ParagraphStyle('LOTitle', parent=styles['Normal'], fontSize=14, fontName='Helvetica-Bold', alignment=TA_CENTER)
    subtitle_style = ParagraphStyle('LOSubtitle', parent=styles['Normal'], fontSize=10, alignment=TA_CENTER)
    footer_style = ParagraphStyle('LOFooter', parent=styles['Normal'], fontSize=7, alignment=TA_CENTER, textColor=colors.HexColor('#555555'))

    def field(label, value):
        return _voucher_field(label, value, label_value_style)

    def field_row(pairs, n_cols=4):
        return _voucher_field_row(pairs, width, label_value_style, n_cols=n_cols)

    def boxed_section(title, row_tables, extra=None):
        return _voucher_boxed_section(title, row_tables, width, box_title_style, extra=extra)

    elements = []

    # Header: logo + dados completos da empresa - mesmo bloco compartilhado
    # com os demais documentos (_build_pdf_header), sem a linha/título padrão
    # já que o título aqui é o box abaixo (mesmo truque do comprovante).
    elements.extend(_build_pdf_header(styles, logo_buffer, '', company=company, content_width=width)[:2])

    # Título
    order_type_label = _ORDER_TYPE_LABELS.get(order.get('order_type'), order.get('order_type'))
    title_tbl = Table([
        [Paragraph('ORDEM DE CARREGAMENTO', title_style)],
        [Paragraph(f"Nº {order['order_number']} - {order_type_label}", subtitle_style)],
    ], colWidths=[width])
    title_tbl.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1.5, colors.black),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(title_tbl)
    elements.append(Spacer(1, 5))

    status_label = _STATUS_LABELS.get(order.get('status'), order.get('status'))
    elements.append(boxed_section('Dados do Agendamento, Controle e Destino', [
        field_row([
            ('Data/Hora Emissão', fmt_dt(order.get('created_at'))),
            ('Janela', order.get('collection_window')),
            ('Status', f'<font color="{STATUS_HEX}">{status_label}</font>' if status_label else None),
        ], n_cols=3),
        field_row([
            ('Terminal de Origem', order.get('origin_terminal')),
            ('Porto', order.get('port')),
        ], n_cols=2),
    ]))
    elements.append(Spacer(1, 4))

    elements.append(boxed_section('Especificações do Container e Carga', [
        field_row([
            ('ID do Container', order.get('container_number')),
            ('Tipo/Tamanho', order.get('size_type')),
            ('Armador', order.get('shipping_line')),
            ('Booking/Ref.', order.get('booking')),
        ]),
        field_row([
            ('Peso Bruto', order.get('gross_weight')),
            ('Lacre (Seal)', order.get('seal')),
            ('Quantidade', order.get('quantity')),
        ], n_cols=3),
    ]))
    elements.append(Spacer(1, 4))

    elements.append(boxed_section('Dados do Transporte (Transportador/Motorista)', [
        field_row([
            ('Motorista', order.get('driver_name')),
            ('CPF', order.get('driver_cpf')),
            ('Transportadora', order.get('transport_company')),
            ('Placa Cavalo', order.get('truck_plate')),
            ('Placa Carreta', order.get('trailer_plate')),
        ], n_cols=5),
    ]))
    elements.append(Spacer(1, 4))

    if order.get('observations'):
        elements.append(boxed_section('Observações', [], extra=[
            Paragraph(str(order['observations']).replace(chr(10), '<br/>'), styles['Normal']),
        ]))
        elements.append(Spacer(1, 4))

    # Instruções operacionais fixas (boilerplate, igual pra todas as ordens)
    instr_style = ParagraphStyle('LOInstr', parent=styles['Normal'], fontSize=7.5, leading=9.5)
    elements.append(boxed_section('Instruções Operacionais / Operações Portuárias', [], extra=[Paragraph(
        "<b>OBSERVAÇÕES IMPORTANTES</b><br/>"
        "• Motorista deve apresentar a OS de agendamento na portaria principal do terminal.<br/>"
        "• Obrigatório o uso completo de EPI (Capacete, colete refletivo, bota de biqueira de aço e óculos de proteção).<br/>"
        "• Verificar rigorosamente a integridade estrutural do container e as marcas do lacre antes de deixar o bolsão do terminal.<br/>"
        "• Em caso de divergência de lacre ou avarias aparentes, não retirar/entregar a unidade e acionar imediatamente a central de operações.",
        instr_style
    )]))
    elements.append(Spacer(1, 4))

    # Checklist de inspeção visual (pra preencher na hora, igual referência)
    checklist_items = [
        "Portas, trincos e borrachas de vedação",
        "Teto e painéis laterais (furos/amassados)",
        "Assoalho interno e limpeza",
        "Lacre intacto e batendo com a OS",
    ]
    check_center_style = ParagraphStyle('LOCheckC', parent=styles['Normal'], alignment=TA_CENTER)
    check_rows = [[
        Paragraph("<b>Item de Inspeção</b>", styles['Normal']),
        Paragraph("<b>OK</b>", check_center_style),
        Paragraph("<b>DM</b>", check_center_style),
    ]]
    for i, item in enumerate(checklist_items, 1):
        check_rows.append([
            Paragraph(f"<font size='8'>{i}. {item}</font>", styles['Normal']),
            Paragraph("[ &nbsp; ]", check_center_style),
            Paragraph("[ &nbsp; ]", check_center_style),
        ])
    check_item_width = width - 20 - 80
    check_t = Table(check_rows, colWidths=[check_item_width, 40, 40])
    check_t.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.5, colors.black),
        ('INNERGRID', (0, 0), (-1, -1), 0.3, colors.grey),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(boxed_section('Checklist de Inspeção Visual', [], extra=[check_t]))
    elements.append(Spacer(1, 5))

    # Área de assinaturas - mesmo padrão do comprovante de movimentação
    sig_title_style = ParagraphStyle('LOSigTitle', parent=styles['Normal'], fontSize=9, fontName='Helvetica-Bold', alignment=TA_CENTER)
    sig_info_style = ParagraphStyle('LOSigInfo', parent=styles['Normal'], fontSize=8)
    sig_data = [[
        [
            Paragraph('Assinatura do Motorista', sig_title_style),
            Spacer(1, 14),
            HRFlowable(width='100%', thickness=0.8, color=colors.black),
            Paragraph(f"Nome: {order.get('driver_name') or '-'}", sig_info_style),
            Paragraph(f"CPF: {order.get('driver_cpf') or '-'}", sig_info_style),
        ],
        [
            Paragraph('Assinatura do Responsável', sig_title_style),
            Spacer(1, 14),
            HRFlowable(width='100%', thickness=0.8, color=colors.black),
            Paragraph(f"Nome: {order.get('created_by_name') or '-'}", sig_info_style),
            Paragraph(f"Data: {now_brt().strftime('%d/%m/%Y')}", sig_info_style),
        ],
    ]]
    sig_tbl = Table(sig_data, colWidths=[width / 2] * 2)
    sig_tbl.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1, colors.black),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 15),
        ('RIGHTPADDING', (0, 0), (-1, -1), 15),
    ]))
    elements.append(sig_tbl)
    elements.append(Spacer(1, 5))

    # Código de barras + usuário + data/hora de impressão
    barcode_value = str(order.get('order_number') or 0).zfill(6)
    try:
        bc = code128.Code128(barcode_value, barWidth=1.0, barHeight=28)
    except Exception:
        bc = None
    bc_num = Paragraph(f"<b>{order['order_number']}</b>", ParagraphStyle('LOBcNum', parent=styles['Normal'], fontSize=8, alignment=TA_CENTER))
    left_cell = [bc, bc_num] if bc else [bc_num]
    right_info = [
        Paragraph(f"<b>Usuário: {order.get('created_by_name') or '-'}</b>", styles['Normal']),
        Paragraph(f"<b>Data e hora da impressão: {now_brt().strftime('%d/%m/%Y %H:%M')}</b>", styles['Normal']),
    ]
    info_tbl = Table([[left_cell, right_info]], colWidths=[100, width - 100])
    info_tbl.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LINEBELOW', (0, 0), (-1, -1), 1, colors.black),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    elements.append(info_tbl)
    elements.append(Spacer(1, 4))

    elements.append(Paragraph(
        f"{company['name']} | Este documento é válido como Ordem de Carregamento",
        footer_style
    ))

    doc.build(elements)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    filename = f"OrdemCarregamento_{order['order_number']}.pdf"
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})
