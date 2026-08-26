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
    """Gera o PDF da minuta de Ordem de Carregamento (coleta/entrega de container)."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.platypus import Image as RLImage
    from reports import download_logo

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

    BLACK = colors.HexColor('#000000')
    GRAY_BG = colors.HexColor('#E8E8E8')
    STATUS_HEX = {
        "APROVADA": "#15803D",
        "PENDENTE": "#B45309",
        "CANCELADA": "#B91C1C",
    }.get(order.get('status'), "#000000")

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4,
                            leftMargin=10 * mm, rightMargin=10 * mm,
                            topMargin=8 * mm, bottomMargin=8 * mm)
    styles = getSampleStyleSheet()

    logo_buffer = download_logo(company)
    logo_img = RLImage(logo_buffer, width=20 * mm, height=20 * mm) if logo_buffer else Paragraph("", styles['Normal'])

    def field(label, val):
        return Paragraph(f"<font size='7' color='#555'>{label}</font><br/>"
                         f"<font size='8'><b>{val if val else '-'}</b></font>",
                         ParagraphStyle('F', parent=styles['Normal'], leading=11))

    def section_bar(title):
        t = Table([[Paragraph(f"<b>{title}</b>", ParagraphStyle('SB', parent=styles['Normal'], fontSize=8.5))]],
                  colWidths=[190 * mm])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), GRAY_BG),
            ('LINEBELOW', (0, 0), (-1, -1), 0.5, BLACK),
            ('TOPPADDING', (0, 0), (-1, -1), 2),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
            ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ]))
        return t

    def grid(rows, col_widths):
        t = Table(rows, colWidths=col_widths)
        t.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 0.5, BLACK),
            ('INNERGRID', (0, 0), (-1, -1), 0.3, colors.grey),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ]))
        return t

    elements = []

    company_style = ParagraphStyle('CompHead', parent=styles['Normal'], fontSize=9, leading=11,
                                   fontName='Helvetica-Bold')
    company_address_line = (company['address'] or '').replace('\n', ', ')
    company_para = Paragraph(
        f"<b>{company['name']}</b><br/>"
        f"<font size='8'>{company_address_line}<br/>"
        f"CNPJ: {company['cnpj']}, Fone: {company['phone']}</font>", company_style)

    title_style = ParagraphStyle('LOTit', parent=styles['Normal'], fontSize=13, leading=15,
                                 alignment=TA_RIGHT, fontName='Helvetica-Bold')
    right_para = Paragraph(
        f"Ordem de Carregamento<br/>"
        f"<font size='9'>{_ORDER_TYPE_LABELS.get(order.get('order_type'), order.get('order_type'))}</font><br/>"
        f"<font size='9'>Nº: <b>{order['order_number']}</b></font>", title_style)

    header = Table([[logo_img, company_para, right_para]], colWidths=[22 * mm, 96 * mm, 72 * mm])
    header.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('LEFTPADDING', (1, 0), (1, 0), 4),
    ]))
    elements.append(header)
    elements.append(Spacer(1, 4))

    # Dados do agendamento e controle
    elements.append(section_bar("Dados do Agendamento e Controle"))
    status_val = f"<font color='{STATUS_HEX}'><b>{_STATUS_LABELS.get(order.get('status'), order.get('status'))}</b></font>"
    ag_t = Table([[
        field("Data/Hora Emissão", fmt_dt(order.get('created_at'))),
        field("Janela", order.get('collection_window')),
        Paragraph(f"<font size='7' color='#555'>Status</font><br/><font size='8'>{status_val}</font>",
                 ParagraphStyle('StatusF', parent=styles['Normal'], leading=11)),
    ]], colWidths=[63.3 * mm, 63.3 * mm, 63.3 * mm])
    ag_t.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.5, BLACK),
        ('INNERGRID', (0, 0), (-1, -1), 0.3, colors.grey),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(ag_t)
    elements.append(Spacer(1, 4))

    # Origem e destino
    elements.append(section_bar("Origem e Destino"))
    elements.append(grid([[
        field("Terminal de Origem", order.get('origin_terminal')),
        field("Porto", order.get('port')),
    ]], [95 * mm, 95 * mm]))
    elements.append(Spacer(1, 4))

    # Especificações do container e carga
    elements.append(section_bar("Especificações do Container e Carga"))
    elements.append(grid([[
        field("ID do Container", order.get('container_number')),
        field("Tipo/Tamanho", order.get('size_type')),
        field("Peso Bruto", order.get('gross_weight')),
        field("Lacre (Seal)", order.get('seal')),
    ], [
        field("Armador", order.get('shipping_line')),
        field("Booking/Ref.", order.get('booking')),
        field("Quantidade", order.get('quantity')),
        Paragraph("", styles['Normal']),
    ]], [47.5 * mm, 47.5 * mm, 47.5 * mm, 47.5 * mm]))
    elements.append(Spacer(1, 4))

    # Dados do transporte
    elements.append(section_bar("Dados do Transporte (Transportador/Motorista)"))
    elements.append(grid([[
        field("Nome do Motorista", order.get('driver_name')),
        field("CPF", order.get('driver_cpf')),
    ], [
        field("Transportadora Contratada", order.get('transport_company')),
        Paragraph("", styles['Normal']),
    ], [
        field("Placa do Cavalo", order.get('truck_plate')),
        field("Placa da Carreta", order.get('trailer_plate')),
    ]], [95 * mm, 95 * mm]))
    elements.append(Spacer(1, 4))

    if order.get('observations'):
        elements.append(section_bar("Observações"))
        elements.append(grid([[Paragraph(
            f"<font size='8'>{order['observations'].replace(chr(10), '<br/>')}</font>", styles['Normal']
        )]], [190 * mm]))
        elements.append(Spacer(1, 4))

    # Instruções operacionais fixas (boilerplate, igual pra todas as ordens)
    elements.append(section_bar("Instruções Operacionais / Operações Portuárias"))
    instr_style = ParagraphStyle('Instr', parent=styles['Normal'], fontSize=7.5, leading=11)
    elements.append(grid([[Paragraph(
        "<b>OBSERVAÇÕES IMPORTANTES</b><br/>"
        "• Motorista deve apresentar a OS de agendamento na portaria principal do terminal.<br/>"
        "• Obrigatório o uso completo de EPI (Capacete, colete refletivo, bota de biqueira de aço e óculos de proteção).<br/>"
        "• Verificar rigorosamente a integridade estrutural do container e as marcas do lacre antes de deixar o bolsão do terminal.<br/>"
        "• Em caso de divergência de lacre ou avarias aparentes, não retirar/entregar a unidade e acionar imediatamente a central de operações.",
        instr_style
    )]], [190 * mm]))
    elements.append(Spacer(1, 4))

    # Checklist de inspeção visual (pra preencher na hora, igual referência)
    elements.append(section_bar("Checklist de Inspeção Visual"))
    checklist_items = [
        "Portas, trincos e borrachas de vedação",
        "Teto e painéis laterais (furos/amassados)",
        "Assoalho interno e limpeza",
        "Lacre intacto e batendo com a OS",
    ]
    check_rows = [[Paragraph("<b>Item de Inspeção</b>", styles['Normal']),
                   Paragraph("<b>OK</b>", ParagraphStyle('C', parent=styles['Normal'], alignment=TA_CENTER)),
                   Paragraph("<b>DM</b>", ParagraphStyle('C', parent=styles['Normal'], alignment=TA_CENTER))]]
    for i, item in enumerate(checklist_items, 1):
        check_rows.append([
            Paragraph(f"<font size='8'>{i}. {item}</font>", styles['Normal']),
            Paragraph("[ &nbsp; ]", ParagraphStyle('C', parent=styles['Normal'], alignment=TA_CENTER)),
            Paragraph("[ &nbsp; ]", ParagraphStyle('C', parent=styles['Normal'], alignment=TA_CENTER)),
        ])
    check_t = Table(check_rows, colWidths=[150 * mm, 20 * mm, 20 * mm])
    check_t.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.5, BLACK),
        ('INNERGRID', (0, 0), (-1, -1), 0.3, colors.grey),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(check_t)
    elements.append(Spacer(1, 8))

    elements.append(Paragraph(
        f"<font size='7' color='#888'>{now_brt().strftime('%d/%m/%Y %H:%M')} &nbsp;&nbsp; "
        f"{company['name']} - Sistema de Gestão</font>",
        ParagraphStyle('Footer', parent=styles['Normal'], alignment=TA_CENTER)
    ))

    doc.build(elements)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    filename = f"OrdemCarregamento_{order['order_number']}.pdf"
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})
