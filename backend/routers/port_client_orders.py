"""Ordem de Serviço - Cliente (antes "Porto x Cliente").

Entrega e coleta de container CHEIO feitas direto entre o porto e o cliente,
sem passar pelo terminal. Fica numa coleção própria (port_client_orders) e,
de propósito, NÃO importa nada de movements, freight_payments,
container_purchases/sales nem unit_segregation: essa operação não gera EIR,
não registra gate in/gate out e não mexe em estoque, segregação ou posição de
container no pátio. O número do container é livre (só um aviso de formato
ISO 6346, sem bloquear) e não cria registro de unidade.
"""
import io
import math
import re
from collections import defaultdict
from typing import Optional
from xml.sax.saxutils import escape as xml_escape

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from models import PortClientOrderCreate, PortClientOrderUpdate
from reports import (
    fmt_datetime, merge_company, now_brt, tabular_fmt,
    generate_tabular_report_pdf, generate_tabular_report_excel,
)
from settlement_links import ensure_not_in_settlement, settlement_holding
from shared import db, get_current_active_user, get_company_settings, format_plate, plate_regex

api_router = APIRouter(prefix="/api")

OPERATION_LABELS = {"ENTREGA": "Entrega (Porto → Cliente)", "COLETA": "Coleta (Cliente → Porto)"}
OPERATION_SHORT = {"ENTREGA": "Entrega", "COLETA": "Coleta"}
STATUS_LABELS = {"ABERTA": "Aberta", "EM_TRANSITO": "Em trânsito", "CONCLUIDA": "Concluída", "CANCELADA": "Cancelada"}
STATUS_TONES = {"ABERTA": "blue", "EM_TRANSITO": "amber", "CONCLUIDA": "emerald", "CANCELADA": "red"}
FINAL_STATUSES = ("CONCLUIDA", "CANCELADA")
PENDING_STATUSES = ("ABERTA", "EM_TRANSITO")


# ==================== NÚMERO DO CONTAINER (ISO 6346) ====================

_ISO_LETTER_VALUES = {
    'A': 10, 'B': 12, 'C': 13, 'D': 14, 'E': 15, 'F': 16, 'G': 17, 'H': 18, 'I': 19, 'J': 20,
    'K': 21, 'L': 23, 'M': 24, 'N': 25, 'O': 26, 'P': 27, 'Q': 28, 'R': 29, 'S': 30, 'T': 31,
    'U': 32, 'V': 34, 'W': 35, 'X': 36, 'Y': 37, 'Z': 38,
}


def _iso_check_digit(first10: str) -> int:
    total = sum((int(ch) if ch.isdigit() else _ISO_LETTER_VALUES[ch]) * (2 ** i) for i, ch in enumerate(first10))
    remainder = total % 11
    return 0 if remainder == 10 else remainder


def normalize_container_number(raw: str) -> str:
    """Maiúsculas e sem espaços nas pontas. No padrão 4 letras + 7 números,
    grava como no resto do sistema (ABCU123456-7); fora dele, como digitado."""
    text = (raw or '').strip().upper()
    clean = re.sub(r'[^A-Z0-9]', '', text)
    if re.fullmatch(r'[A-Z]{4}\d{7}', clean):
        return f"{clean[:10]}-{clean[10]}"
    return text


def container_number_warning(number: str) -> Optional[str]:
    """Aviso (não bloqueia) quando o número foge do ISO 6346."""
    clean = re.sub(r'[^A-Z0-9]', '', (number or '').upper())
    if not re.fullmatch(r'[A-Z]{4}\d{7}', clean):
        return 'Número do container fora do padrão ISO 6346 (4 letras + 7 números). A ordem foi salva assim mesmo.'
    expected = _iso_check_digit(clean[:10])
    if expected != int(clean[10]):
        return f'Dígito verificador do container não confere (pelo ISO 6346 seria {expected}). A ordem foi salva assim mesmo.'
    return None


# ==================== REGRAS ====================

def _now_local() -> str:
    return now_brt().strftime('%Y-%m-%dT%H:%M')


def _clean_text(value):
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def _validate(doc: dict):
    if not _clean_text(doc.get('client_name')):
        raise HTTPException(status_code=400, detail='Informe o Cliente')
    if not _clean_text(doc.get('port_terminal_name')):
        raise HTTPException(status_code=400, detail='Informe o Porto/Terminal portuário')
    containers = order_containers(doc)
    if not containers:
        raise HTTPException(status_code=400, detail='Informe ao menos 1 container')
    seen = set()
    for c in containers:
        key = re.sub(r'[^A-Z0-9]', '', c['container_number'].upper())
        if key in seen:
            raise HTTPException(status_code=400, detail=f"Container {c['container_number']} repetido na ordem")
        seen.add(key)
    if not _clean_text(doc.get('scheduled_at')):
        raise HTTPException(status_code=400, detail='Informe a data/hora prevista')
    value = doc.get('freight_value')
    if value is None or isinstance(value, bool) or not math.isfinite(float(value)) or float(value) <= 0:
        raise HTTPException(status_code=400, detail='O Valor do Frete é obrigatório e deve ser maior que zero')


def _normalize(data: dict) -> dict:
    out = {}
    for key, value in data.items():
        out[key] = _clean_text(value) if isinstance(value, str) else value
    if out.get('containers') is not None:
        containers = []
        for c in out['containers']:
            number = _clean_text(c.get('container_number'))
            if not number:
                continue  # linha deixada em branco no formulário
            containers.append({
                'container_number': normalize_container_number(number),
                'container_size': _clean_text(c.get('container_size')),
                'container_type': _clean_text(c.get('container_type')),
            })
        out['containers'] = containers
    for key in ('truck_plate', 'trailer_plate', 'trailer_plate_2'):
        if out.get(key):
            out[key] = format_plate(out[key])
    for key in ('booking', 'bl'):
        if out.get(key):
            out[key] = out[key].upper()
    if out.get('freight_value') is not None:
        out['freight_value'] = round(float(out['freight_value']), 2)
    return out


def _check_status_change(old: str, new: str):
    if old == new:
        return
    if old in FINAL_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f'A ordem está {STATUS_LABELS[old]} e não pode mudar de status',
        )


def order_containers(doc: dict) -> list:
    """Containers da ordem. As primeiras ordens (antes de aceitar vários
    containers) guardavam um só, nos campos soltos container_number/size/type."""
    if doc.get('containers'):
        return doc['containers']
    if _clean_text(doc.get('container_number')):
        return [{'container_number': doc['container_number'], 'container_size': doc.get('container_size'),
                 'container_type': doc.get('container_type')}]
    return []


def _serialize(doc: dict) -> dict:
    doc = dict(doc)
    doc.pop('_id', None)
    containers = []
    warnings = []
    for c in order_containers(doc):
        warning = container_number_warning(c['container_number'])
        containers.append({**c, 'warning': warning})
        if warning:
            warnings.append(f"{c['container_number']}: {warning}")
    doc['containers'] = containers
    for legacy in ('container_number', 'container_size', 'container_type'):
        doc.pop(legacy, None)
    doc['container_warnings'] = warnings
    return doc


def counts_for_billing(order: dict, status_filter: Optional[str]) -> bool:
    """Ordem cancelada não entra nos totais de frete, nem conta viagem - a
    não ser que o filtro de status seja justamente Cancelada."""
    return order.get('status') != 'CANCELADA' or status_filter == 'CANCELADA'


def build_query(date_from=None, date_to=None, client_id=None, client_name=None, operation_type=None,
                status=None, search=None, statuses=None) -> dict:
    conditions = []
    if date_from or date_to:
        cond = {}
        if date_from:
            cond['$gte'] = date_from
        if date_to:
            cond['$lte'] = f"{date_to}T23:59:59"
        conditions.append({'scheduled_at': cond})
    if client_id:
        conditions.append({'client_id': client_id})
    elif client_name:
        conditions.append({'client_name': {'$regex': re.escape(client_name.strip()), '$options': 'i'}})
    if operation_type:
        conditions.append({'operation_type': operation_type})
    if status:
        conditions.append({'status': status})
    if statuses:
        conditions.append({'status': {'$in': list(statuses)}})
    if search:
        s = re.escape(search.strip())
        ors = [
            {'containers.container_number': {'$regex': s, '$options': 'i'}},
            {'container_number': {'$regex': s, '$options': 'i'}},
            {'client_name': {'$regex': s, '$options': 'i'}},
            {'driver_name': {'$regex': s, '$options': 'i'}},
            {'truck_plate': {'$regex': plate_regex(search) or s, '$options': 'i'}},
            {'trailer_plate': {'$regex': plate_regex(search) or s, '$options': 'i'}},
            {'trailer_plate_2': {'$regex': plate_regex(search) or s, '$options': 'i'}},
            {'booking': {'$regex': s, '$options': 'i'}},
            {'bl': {'$regex': s, '$options': 'i'}},
            {'port_terminal_name': {'$regex': s, '$options': 'i'}},
        ]
        number = search.strip().lstrip('#')
        if number.isdigit():
            ors.append({'order_number': int(number)})
        conditions.append({'$or': ors})
    return {'$and': conditions} if conditions else {}


def order_stats(orders: list, status_filter: Optional[str] = None) -> dict:
    billable = [o for o in orders if counts_for_billing(o, status_filter)]
    return {
        'count': len(orders),
        'freight_total': round(sum(o.get('freight_value') or 0 for o in billable), 2),
        'open': sum(1 for o in orders if o.get('status') == 'ABERTA'),
        'in_transit': sum(1 for o in orders if o.get('status') == 'EM_TRANSITO'),
        'completed': sum(1 for o in orders if o.get('status') == 'CONCLUIDA'),
        'cancelled': sum(1 for o in orders if o.get('status') == 'CANCELADA'),
    }


# ==================== CRUD ====================

@api_router.get("/port-client-orders")
async def list_port_client_orders(
    page: int = 1,
    per_page: int = 20,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    client_id: Optional[str] = None,
    client_name: Optional[str] = None,
    operation_type: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user),
):
    query = build_query(date_from, date_to, client_id, client_name, operation_type, status, search)
    everything = await db.port_client_orders.find(query, {'_id': 0, 'status': 1, 'freight_value': 1}).to_list(None)
    total = len(everything)
    page = max(page, 1)
    per_page = max(min(per_page, 500), 1)
    rows = await db.port_client_orders.find(query, {'_id': 0}).sort('order_number', -1) \
        .skip((page - 1) * per_page).limit(per_page).to_list(per_page)
    return {
        'items': [_serialize(r) for r in rows],
        'total': total,
        'page': page,
        'pages': max(math.ceil(total / per_page), 1),
        'stats': order_stats(everything, status),
    }


@api_router.get("/port-client-orders/next-number")
async def next_port_client_order_number(current_user: dict = Depends(get_current_active_user)):
    counter = await db.counters.find_one({'_id': 'port_client_order_number'})
    return {'next_number': (counter['seq'] + 1) if counter else 1}


@api_router.get("/port-client-orders/{order_id}")
async def get_port_client_order(order_id: str, current_user: dict = Depends(get_current_active_user)):
    doc = await db.port_client_orders.find_one({'id': order_id}, {'_id': 0})
    if not doc:
        raise HTTPException(status_code=404, detail='Ordem de Serviço não encontrada')
    return _serialize(doc)


@api_router.post("/port-client-orders")
async def create_port_client_order(data: PortClientOrderCreate, current_user: dict = Depends(get_current_active_user)):
    import uuid
    from datetime import datetime, timezone
    payload = _normalize(data.model_dump())
    _validate(payload)
    if payload['status'] == 'CONCLUIDA' and not payload.get('completed_at'):
        payload['completed_at'] = _now_local()
    counter = await db.counters.find_one_and_update(
        {'_id': 'port_client_order_number'}, {'$inc': {'seq': 1}}, upsert=True, return_document=True,
    )
    doc = {
        'id': str(uuid.uuid4()),
        'order_number': counter['seq'],
        **payload,
        'container_condition': 'CHEIO',
        'created_by': current_user['sub'],
        'created_by_name': current_user.get('name'),
        'created_at': datetime.now(timezone.utc).isoformat(),
        'updated_at': None,
    }
    await db.port_client_orders.insert_one(doc)
    return _serialize(doc)


@api_router.put("/port-client-orders/{order_id}")
async def update_port_client_order(order_id: str, data: PortClientOrderUpdate, current_user: dict = Depends(get_current_active_user)):
    from datetime import datetime, timezone
    existing = await db.port_client_orders.find_one({'id': order_id}, {'_id': 0})
    if not existing:
        raise HTTPException(status_code=404, detail='Ordem de Serviço não encontrada')
    changes = _normalize(data.model_dump(exclude_unset=True))
    merged = {**existing, **changes}
    _validate(merged)
    _check_status_change(existing.get('status'), merged.get('status'))
    if merged.get('status') != existing.get('status') or merged.get('driver_id') != existing.get('driver_id'):
        settlement = await settlement_holding('client_os', order_id)
        if settlement:
            raise HTTPException(status_code=400, detail=(
                f"Ordem está no Acerto da Viagem nº {settlement['settlement_number']}: tire-a do acerto "
                "(ou reabra o acerto) antes de mudar o status ou o motorista."))
    if merged.get('status') == 'CONCLUIDA' and not merged.get('completed_at'):
        changes['completed_at'] = _now_local()
    changes['container_condition'] = 'CHEIO'
    changes['updated_at'] = datetime.now(timezone.utc).isoformat()
    changes['updated_by_name'] = current_user.get('name')
    update = {'$set': changes}
    if 'containers' in changes:
        update['$unset'] = {'container_number': '', 'container_size': '', 'container_type': ''}
    await db.port_client_orders.update_one({'id': order_id}, update)
    updated = await db.port_client_orders.find_one({'id': order_id}, {'_id': 0})
    return _serialize(updated)


@api_router.delete("/port-client-orders/{order_id}")
async def delete_port_client_order(order_id: str, current_user: dict = Depends(get_current_active_user)):
    await ensure_not_in_settlement('client_os', order_id, 'excluir')
    result = await db.port_client_orders.delete_one({'id': order_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail='Ordem de Serviço não encontrada')
    return {'message': 'Ordem de Serviço removida'}


# ==================== IMPRESSÃO PARA O MOTORISTA ====================

@api_router.get("/port-client-orders/{order_id}/pdf")
async def download_port_client_order_pdf(order_id: str, current_user: dict = Depends(get_current_active_user)):
    """Mesmo layout visual da Ordem de Carregamento (cabeçalho, quadros,
    checklist, assinaturas e código de barras), sem nenhuma referência a EIR
    nem a movimentação no terminal."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.graphics.barcode import code128
    from reports import (
        download_logo, _build_pdf_header, _voucher_field_row, _voucher_boxed_section,
        _pdf_signatures, _hex, _pdf_header_cells, _pdf_table_style, BRAND_LINE, BRAND_DARK, BRAND_MUTED,
    )

    order = await db.port_client_orders.find_one({'id': order_id}, {'_id': 0})
    if not order:
        raise HTTPException(status_code=404, detail='Ordem de Serviço não encontrada')
    company = merge_company(await get_company_settings())

    def esc(value):
        return xml_escape(str(value)) if value not in (None, '') else None

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=10 * mm, leftMargin=10 * mm, topMargin=4 * mm, bottomMargin=3 * mm)
    width = doc.width
    styles = getSampleStyleSheet()
    label_value_style = styles['Normal']
    box_title_style = ParagraphStyle('PCBoxTitle', parent=styles['Normal'], fontSize=9, fontName='Helvetica-Bold')
    footer_style = ParagraphStyle('PCFooter', parent=styles['Normal'], fontSize=7, alignment=TA_CENTER, textColor=_hex(BRAND_MUTED))

    def field_row(pairs, n_cols=4):
        # Texto escapado; um valor ("raw", markup) entra como markup pronto (cor do status)
        cells = [(label, value[1] if isinstance(value, tuple) else esc(value)) for label, value in pairs]
        return _voucher_field_row(cells, width, label_value_style, n_cols=n_cols)

    def boxed_section(title, row_tables, extra=None):
        return _voucher_boxed_section(title, row_tables, width, box_title_style, extra=extra)

    op = order.get('operation_type')
    elements = list(_build_pdf_header(
        styles, download_logo(company),
        f"Ordem de Serviço – Cliente - Nº {order['order_number']}  ·  {OPERATION_LABELS.get(op, op)}",
        company=company, content_width=width,
    ))

    status = order.get('status')
    elements.append(boxed_section('Dados da Operação', [
        field_row([
            ('Data/Hora Emissão', fmt_datetime(order.get('created_at'), empty='')),
            ('Previsão', fmt_datetime(order.get('scheduled_at'), empty='')),
            ('Realizada em', fmt_datetime(order.get('completed_at'), empty='')),
            ('Status', ('raw', f'<font color="#{_status_hex(status)}">{STATUS_LABELS.get(status, status)}</font>')),
        ]),
    ]))
    elements.append(Spacer(1, 2))

    port = order.get('port_terminal_name')
    client_place = order.get('client_name')
    address = order.get('client_address')
    if op == 'COLETA':
        origin_rows = [field_row([('Origem (Cliente)', client_place), ('Destino (Porto/Terminal)', port)], n_cols=2)]
    else:
        origin_rows = [field_row([('Origem (Porto/Terminal)', port), ('Destino (Cliente)', client_place)], n_cols=2)]
    origin_rows.append(field_row([('Endereço do Cliente para ' + ('Coleta' if op == 'COLETA' else 'Entrega'), address)], n_cols=1))
    elements.append(boxed_section('Origem e Destino', origin_rows))
    elements.append(Spacer(1, 2))

    containers = order_containers(order)
    elements.append(boxed_section('Container(s) e Carga', [
        field_row([
            ('Booking', order.get('booking')),
            ('BL', order.get('bl')),
            ('Quantidade de Containers', len(containers) or None),
            ('Condição', 'Cheio'),
        ]),
    ]))
    elements.append(Spacer(1, 2))
    item_rows = [_pdf_header_cells(["#", "Nº do Container", "Tamanho", "Tipo", "Condição"], font_size=7.5)]
    for idx, c in enumerate(containers, 1):
        size = c.get('container_size')
        item_rows.append([str(idx), c.get('container_number') or '-', f"{size}'" if size else '-',
                          c.get('container_type') or '-', 'Cheio'])
    base_widths = [20, 150, 70, 90, 70]
    scale = width / sum(base_widths)
    items_table = Table(item_rows, colWidths=[w * scale for w in base_widths], repeatRows=1)
    items_table.setStyle(TableStyle(_pdf_table_style() + [
        ('FONTSIZE', (0, 0), (-1, -1), 7.5),
        ('FONTNAME', (1, 1), (1, -1), 'Helvetica-Bold'),
        ('ALIGN', (0, 1), (0, -1), 'CENTER'),
        ('ALIGN', (2, 1), (-1, -1), 'CENTER'),
        ('TOPPADDING', (0, 0), (-1, -1), 2.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
    ]))
    elements.append(items_table)
    elements.append(Spacer(1, 2))

    elements.append(boxed_section('Dados do Transporte (Motorista/Veículo)', [
        field_row([('Motorista', order.get('driver_name'))], n_cols=1),
        field_row([
            ('CPF', order.get('driver_cpf')),
            ('Placa Cavalo', order.get('truck_plate')),
            ('Placa Carreta' if not order.get('trailer_plate_2') else 'Placa 1ª Carreta', order.get('trailer_plate')),
        ] + ([('Placa 2ª Carreta (rodotrem)', order.get('trailer_plate_2'))] if order.get('trailer_plate_2') else []),
            n_cols=4 if order.get('trailer_plate_2') else 3),
    ]))
    elements.append(Spacer(1, 2))

    if order.get('observations'):
        obs_style = ParagraphStyle('PCObs', parent=styles['Normal'], fontSize=8.5, leading=10.5)
        elements.append(boxed_section('Observações', [], extra=[
            Paragraph(xml_escape(str(order['observations'])).replace(chr(10), '<br/>'), obs_style),
        ]))
        elements.append(Spacer(1, 2))

    instr_style = ParagraphStyle('PCInstr', parent=styles['Normal'], fontSize=7, leading=8.5)
    if op == 'COLETA':
        steps = ("• Retirar o(s) container(s) cheio(s) no endereço do cliente e entregá-lo(s) no porto/terminal indicado acima.<br/>"
                 "• Conferir o número de cada container e o lacre com esta ordem antes de sair do cliente.<br/>")
    else:
        steps = ("• Retirar o(s) container(s) cheio(s) no porto/terminal indicado acima e entregá-lo(s) no endereço do cliente.<br/>"
                 "• Conferir o número de cada container e o lacre com esta ordem antes de sair do porto.<br/>")
    elements.append(boxed_section('Instruções ao Motorista', [], extra=[Paragraph(
        "<b>OBSERVAÇÕES IMPORTANTES</b><br/>" + steps +
        "• Obrigatório o uso completo de EPI (Capacete, colete refletivo, bota de biqueira de aço e óculos de proteção).<br/>"
        "• Em caso de divergência de lacre ou avarias aparentes, não seguir viagem e acionar imediatamente a central de operações.<br/>"
        "• Colher a assinatura do responsável no cliente ao final da " + ('coleta.' if op == 'COLETA' else 'entrega.'),
        instr_style,
    )]))
    elements.append(Spacer(1, 2))

    checklist_items = [
        "Portas, trincos e borrachas de vedação",
        "Teto e painéis laterais (furos/amassados)",
        "Números dos containers batendo com a ordem",
        "Lacre intacto",
    ]
    check_header_style = ParagraphStyle('PCCheckHeader', parent=styles['Normal'], fontSize=8, fontName='Helvetica-Bold')
    check_center_style = ParagraphStyle('PCCheckC', parent=styles['Normal'], fontSize=8, fontName='Helvetica-Bold', alignment=TA_CENTER)
    check_item_style = ParagraphStyle('PCCheckItem', parent=styles['Normal'], fontSize=7.5)
    check_rows = [[Paragraph("Item de Inspeção", check_header_style), Paragraph("OK", check_center_style), Paragraph("DM", check_center_style)]]
    for i, item in enumerate(checklist_items, 1):
        check_rows.append([Paragraph(f"{i}. {item}", check_item_style), Paragraph("[ &nbsp; ]", check_center_style), Paragraph("[ &nbsp; ]", check_center_style)])
    check_t = Table(check_rows, colWidths=[width - 20 - 80, 40, 40])
    check_t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.white),
        ('BOX', (0, 0), (-1, -1), 0.6, _hex(BRAND_LINE)),
        ('INNERGRID', (0, 0), (-1, -1), 0.4, _hex(BRAND_LINE)),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 1.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 1.5),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(boxed_section('Checklist de Inspeção Visual', [], extra=[check_t]))
    elements.append(Spacer(1, 2))

    elements.append(_pdf_signatures([
        ('Assinatura do Motorista', f"{order.get('driver_name') or '-'}  ·  CPF {order.get('driver_cpf') or '-'}"),
        ('Assinatura do Cliente', 'Nome legível e data'),
        ('Assinatura do Responsável', f"{order.get('created_by_name') or '-'}  ·  {now_brt().strftime('%d/%m/%Y')}"),
    ], width, space_above=24))
    elements.append(Spacer(1, 6))

    barcode_value = str(order.get('order_number') or 0).zfill(6)
    try:
        bc = code128.Code128(barcode_value, barWidth=1.0, barHeight=20)
    except Exception:
        bc = None
    bc_num = Paragraph(f"<b>{order['order_number']}</b>", ParagraphStyle('PCBcNum', parent=styles['Normal'], fontSize=7.5, alignment=TA_CENTER, textColor=_hex(BRAND_DARK)))
    info_text_style = ParagraphStyle('PCInfoText', parent=styles['Normal'], fontSize=8.5, textColor=_hex(BRAND_DARK))
    info_tbl = Table([[
        [bc, bc_num] if bc else [bc_num],
        [
            Paragraph(f"<font color='#{BRAND_MUTED}'>Usuário:</font> <b>{xml_escape(order.get('created_by_name') or '-')}</b>", info_text_style),
            Paragraph(f"<font color='#{BRAND_MUTED}'>Data e hora da impressão:</font> <b>{now_brt().strftime('%d/%m/%Y %H:%M')}</b>", info_text_style),
        ],
    ]], colWidths=[100, width - 100])
    info_tbl.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (1, 0), (1, 0), 12),
        ('LINEBELOW', (0, 0), (-1, -1), 0.75, _hex(BRAND_LINE)),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    elements.append(info_tbl)
    elements.append(Spacer(1, 2))
    elements.append(Paragraph(f"{xml_escape(company['name'])}  ·  Este documento é válido como Ordem de Serviço – Cliente", footer_style))

    doc.build(elements)
    filename = f"OrdemServicoCliente_{order['order_number']}.pdf"
    return StreamingResponse(io.BytesIO(buffer.getvalue()), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})


def _status_hex(status):
    return {"ABERTA": "1D4ED8", "EM_TRANSITO": "B45309", "CONCLUIDA": "15803D", "CANCELADA": "B91C1C"}.get(status, "000000")


# ==================== RELATÓRIOS ====================

REPORT_KINDS = {
    'periodo': 'Ordens por Período',
    'faturamento-cliente': 'Faturamento de Frete por Cliente',
    'producao': 'Produção por Motorista e Veículo',
    'em-aberto': 'Ordens em Aberto / Em Trânsito',
    'resumo-mensal': 'Resumo Mensal',
}


def _col(label, col_type='text', weight=1.0, xl_width=14):
    return {'label': label, 'type': col_type, 'weight': weight, 'xl_width': xl_width}


def _fmt_day(value):
    try:
        y, m, d = value.split('-')
        return f"{d}/{m}/{y}"
    except (ValueError, AttributeError):
        return value


async def _filters_text(f: dict) -> str:
    parts = []
    if f.get('date_from') and f.get('date_to'):
        parts.append(f"Período: {_fmt_day(f['date_from'])} a {_fmt_day(f['date_to'])}")
    elif f.get('date_from'):
        parts.append(f"Período: a partir de {_fmt_day(f['date_from'])}")
    elif f.get('date_to'):
        parts.append(f"Período: até {_fmt_day(f['date_to'])}")
    client = f.get('client_name')
    if f.get('client_id'):
        found = await db.clients.find_one({'id': f['client_id']}, {'_id': 0, 'name': 1})
        client = (found or {}).get('name') or client
    if client:
        parts.append(f"Cliente: {client}")
    if f.get('operation_type'):
        parts.append(f"Operação: {OPERATION_SHORT.get(f['operation_type'], f['operation_type'])}")
    if f.get('status'):
        parts.append(f"Status: {STATUS_LABELS.get(f['status'], f['status'])}")
    return '  ·  '.join(parts) if parts else 'Todos os registros (sem filtros)'


def _sum(orders):
    return round(sum(o.get('freight_value') or 0 for o in orders), 2)


def _size_type_of(c):
    size = c.get('container_size')
    parts = [f"{size}'" if size else None, c.get('container_type')]
    return ' '.join(p for p in parts if p) or None


def _size_type(o):
    """Tamanho/tipo dos containers da ordem, sem repetir (ex.: "40' HC, 20' DRY")."""
    seen = []
    for c in order_containers(o):
        st = _size_type_of(c)
        if st and st not in seen:
            seen.append(st)
    return ', '.join(seen) or None


def _container_numbers(o):
    return ', '.join(c['container_number'] for c in order_containers(o)) or None


def _container_count(orders):
    return sum(len(order_containers(o)) for o in orders)


def _report_periodo(orders, status_filter):
    billable = [o for o in orders if counts_for_billing(o, status_filter)]
    cancelled_out = len(orders) - len(billable)
    columns = [
        _col('Nº', 'int', 0.45, 7), _col('Prevista', 'datetime', 1.2, 16), _col('Realizada', 'datetime', 1.2, 16),
        _col('Operação', 'text', 0.85, 10), _col('Cliente', 'text', 1.6, 30), _col('Porto/Terminal', 'text', 1.1, 22),
        _col('Containers', 'text', 1.3, 18), _col('Qtd.', 'int', 0.4, 6), _col('Tam./Tipo', 'text', 0.85, 10),
        _col('Motorista', 'text', 1.3, 24), _col('Placa', 'text', 0.8, 10), _col('Status', 'text', 1.0, 12),
        _col('Frete', 'money', 0.95, 14),
    ]
    rows = [[
        o.get('order_number'), o.get('scheduled_at'), o.get('completed_at'),
        OPERATION_SHORT.get(o.get('operation_type'), o.get('operation_type')), o.get('client_name'),
        o.get('port_terminal_name'), _container_numbers(o), len(order_containers(o)), _size_type(o), o.get('driver_name'),
        o.get('truck_plate'), STATUS_LABELS.get(o.get('status'), o.get('status')), o.get('freight_value') or 0,
    ] for o in orders]
    total = _sum(billable)
    totals = [('Quantidade de ordens', len(orders), 'int'), ('Quantidade de containers', _container_count(orders), 'int')]
    if cancelled_out:
        totals.append(('Canceladas (fora do frete)', cancelled_out, 'int'))
    totals.append(('Valor total do frete', total, 'money'))
    return {
        'summary': [
            ('Ordens', tabular_fmt(len(orders), 'int')),
            ('Entregas', tabular_fmt(sum(1 for o in orders if o.get('operation_type') == 'ENTREGA'), 'int')),
            ('Coletas', tabular_fmt(sum(1 for o in orders if o.get('operation_type') == 'COLETA'), 'int')),
            ('Frete total', tabular_fmt(total, 'money')),
        ],
        'sections': [{
            'sheet': 'Ordens', 'columns': columns, 'rows': rows,
            'row_tones': [STATUS_TONES.get(o.get('status')) for o in orders], 'tone_col': 11,
            'total': [None] * 12 + [total],
            'total_label': 'TOTAL (sem canceladas)' if cancelled_out else 'TOTAL',
        }],
        'totals': totals,
    }


def _report_faturamento(orders, status_filter):
    billable = [o for o in orders if counts_for_billing(o, status_filter)]
    groups = defaultdict(list)
    for o in billable:
        groups[o.get('client_name') or '(sem cliente)'].append(o)
    rows = []
    for client, items in groups.items():
        ent = [o for o in items if o.get('operation_type') == 'ENTREGA']
        col = [o for o in items if o.get('operation_type') == 'COLETA']
        rows.append([client, len(ent), _sum(ent), len(col), _sum(col), len(items), _container_count(items), _sum(items)])
    rows.sort(key=lambda r: (-r[7], r[0]))
    tot = [None] + [sum(r[i] for r in rows) for i in range(1, 8)]
    tot = [round(v, 2) if isinstance(v, float) else v for v in tot]
    columns = [
        _col('Cliente', 'text', 2.6, 34), _col('Entregas', 'int', 0.7, 10), _col('Frete Entregas', 'money', 1.1, 16),
        _col('Coletas', 'int', 0.7, 10), _col('Frete Coletas', 'money', 1.1, 16), _col('Total de Ordens', 'int', 0.8, 12),
        _col('Containers', 'int', 0.8, 12), _col('Frete Total', 'money', 1.1, 16),
    ]
    return {
        'summary': [
            ('Clientes', tabular_fmt(len(rows), 'int')),
            ('Ordens', tabular_fmt(len(billable), 'int')),
            ('Frete total', tabular_fmt(_sum(billable), 'money')),
        ],
        'sections': [{'sheet': 'Por cliente', 'columns': columns, 'rows': rows, 'total': tot}],
        'totals': [
            ('Frete de Entregas', tot[2] or 0, 'money'),
            ('Frete de Coletas', tot[4] or 0, 'money'),
            ('Valor total do frete', _sum(billable), 'money'),
        ],
    }


def _report_producao(orders, status_filter):
    billable = [o for o in orders if counts_for_billing(o, status_filter)]
    by_driver = defaultdict(list)
    by_vehicle = defaultdict(list)
    for o in billable:
        by_driver[o.get('driver_name') or '(sem motorista)'].append(o)
        by_vehicle[o.get('truck_plate') or '(sem placa)'].append(o)
    driver_rows = []
    for name, items in by_driver.items():
        total = _sum(items)
        driver_rows.append([name, len(items), sum(1 for o in items if o.get('operation_type') == 'ENTREGA'),
                            sum(1 for o in items if o.get('operation_type') == 'COLETA'), total,
                            round(total / len(items), 2)])
    driver_rows.sort(key=lambda r: (-r[4], r[0]))
    vehicle_rows = []
    for plate, items in by_vehicle.items():
        trailers = sorted({p for o in items for p in (o.get('trailer_plate'), o.get('trailer_plate_2')) if p})
        drivers = {o.get('driver_name') for o in items if o.get('driver_name')}
        vehicle_rows.append([plate, ', '.join(trailers) or None, len(items), len(drivers), _sum(items)])
    vehicle_rows.sort(key=lambda r: (-r[4], r[0]))
    trips, freight = len(billable), _sum(billable)
    return {
        'summary': [
            ('Viagens', tabular_fmt(trips, 'int')),
            ('Motoristas', tabular_fmt(len(by_driver), 'int')),
            ('Veículos', tabular_fmt(len(by_vehicle), 'int')),
            ('Frete gerado', tabular_fmt(freight, 'money')),
        ],
        'sections': [
            {
                'title': 'Por motorista', 'sheet': 'Por motorista',
                'columns': [_col('Motorista', 'text', 2.6, 34), _col('Viagens', 'int', 0.8, 10), _col('Entregas', 'int', 0.8, 10),
                            _col('Coletas', 'int', 0.8, 10), _col('Frete Gerado', 'money', 1.2, 16), _col('Frete Médio/Viagem', 'money', 1.2, 18)],
                'rows': driver_rows,
                'total': [None, trips, sum(r[2] for r in driver_rows), sum(r[3] for r in driver_rows), freight,
                          round(freight / trips, 2) if trips else None],
            },
            {
                'title': 'Por veículo', 'sheet': 'Por veículo',
                'columns': [_col('Placa do Cavalo', 'text', 1.2, 16), _col('Carreta(s)', 'text', 2.0, 26), _col('Viagens', 'int', 0.8, 10),
                            _col('Motoristas', 'int', 0.8, 12), _col('Frete Gerado', 'money', 1.2, 16)],
                'rows': vehicle_rows,
                'total': [None, None, trips, None, freight],
            },
        ],
        'totals': [('Viagens', trips, 'int'), ('Frete gerado', freight, 'money')],
    }


def _report_em_aberto(orders, status_filter):
    now = _now_local()
    pending = [o for o in orders if o.get('status') in PENDING_STATUSES]
    pending.sort(key=lambda o: (o.get('scheduled_at') or '9999', o.get('order_number') or 0))

    def situation(o):
        when = o.get('scheduled_at')
        if not when:
            return 'Sem data', None
        if when[:16] < now:
            days = (now_brt().date() - _parse_day(when)).days
            return ('Atrasada (hoje)' if days <= 0 else f'Atrasada há {days} dia(s)'), 'red'
        return 'No prazo', 'emerald'

    rows, tones = [], []
    for o in pending:
        label, tone = situation(o)
        tones.append(tone)
        rows.append([
            o.get('order_number'), o.get('scheduled_at'), label,
            OPERATION_SHORT.get(o.get('operation_type'), o.get('operation_type')), o.get('client_name'),
            o.get('port_terminal_name'), o.get('client_address'), _container_numbers(o), o.get('driver_name'),
            o.get('truck_plate'), STATUS_LABELS.get(o.get('status'), o.get('status')), o.get('freight_value') or 0,
        ])
    total = _sum(pending)
    late = sum(1 for t in tones if t == 'red')
    return {
        'summary': [
            ('Pendentes', tabular_fmt(len(pending), 'int')),
            ('Abertas', tabular_fmt(sum(1 for o in pending if o.get('status') == 'ABERTA'), 'int')),
            ('Em trânsito', tabular_fmt(sum(1 for o in pending if o.get('status') == 'EM_TRANSITO'), 'int')),
            ('Atrasadas', tabular_fmt(late, 'int')),
            ('Frete a realizar', tabular_fmt(total, 'money')),
        ],
        'sections': [{
            'sheet': 'Em aberto',
            'columns': [
                _col('Nº', 'int', 0.45, 7), _col('Prevista', 'datetime', 1.2, 16), _col('Prazo', 'text', 1.0, 18),
                _col('Operação', 'text', 0.7, 10), _col('Cliente', 'text', 1.5, 28), _col('Porto/Terminal', 'text', 1.2, 20),
                _col('Endereço do Cliente', 'text', 1.8, 34), _col('Containers', 'text', 1.2, 18), _col('Motorista', 'text', 1.2, 22),
                _col('Placa', 'text', 0.7, 10), _col('Status', 'text', 0.8, 12), _col('Frete', 'money', 0.9, 14),
            ],
            'rows': rows, 'row_tones': tones, 'tone_col': 2,
            'total': [None] * 11 + [total],
            'empty_message': 'Nenhuma ordem em aberto ou em trânsito para os filtros selecionados.',
        }],
        'totals': [('Ordens pendentes', len(pending), 'int'), ('Atrasadas', late, 'int'), ('Frete a realizar', total, 'money')],
    }


def _parse_day(value):
    from datetime import date
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return now_brt().date()


def _report_resumo_mensal(orders, status_filter):
    billable = [o for o in orders if counts_for_billing(o, status_filter) and o.get('scheduled_at')]
    months = defaultdict(list)
    for o in billable:
        months[o['scheduled_at'][:7]].append(o)
    rows = []
    previous = None
    for month in sorted(months):
        items = months[month]
        ent = [o for o in items if o.get('operation_type') == 'ENTREGA']
        col = [o for o in items if o.get('operation_type') == 'COLETA']
        total = _sum(items)
        variation = round((total - previous) / previous * 100, 1) if previous else None
        rows.append([month, len(ent), len(col), len(items), _sum(ent), _sum(col), total, variation])
        previous = total
    tot = [None] + [sum(r[i] for r in rows) for i in range(1, 7)] + [None]
    tot = [round(v, 2) if isinstance(v, float) else v for v in tot]
    return {
        'summary': [
            ('Meses', tabular_fmt(len(rows), 'int')),
            ('Ordens', tabular_fmt(len(billable), 'int')),
            ('Frete total', tabular_fmt(_sum(billable), 'money')),
            ('Média mensal', tabular_fmt(round(_sum(billable) / len(rows), 2) if rows else 0, 'money')),
        ],
        'sections': [{
            'sheet': 'Resumo mensal',
            'columns': [
                _col('Mês', 'month', 0.8, 10), _col('Entregas', 'int', 0.8, 10), _col('Coletas', 'int', 0.8, 10),
                _col('Total de Ordens', 'int', 0.9, 12), _col('Frete Entregas', 'money', 1.2, 16),
                _col('Frete Coletas', 'money', 1.2, 16), _col('Frete Total', 'money', 1.2, 16),
                _col('Variação do Frete', 'pct', 1.0, 14),
            ],
            'rows': rows, 'total': tot,
        }],
        'totals': [('Ordens', len(billable), 'int'), ('Valor total do frete', _sum(billable), 'money')],
    }


_REPORT_BUILDERS = {
    'periodo': _report_periodo,
    'faturamento-cliente': _report_faturamento,
    'producao': _report_producao,
    'em-aberto': _report_em_aberto,
    'resumo-mensal': _report_resumo_mensal,
}


async def build_report(kind: str, filters: dict) -> dict:
    if kind not in _REPORT_BUILDERS:
        raise HTTPException(status_code=404, detail='Relatório não encontrado')
    query = build_query(
        filters.get('date_from'), filters.get('date_to'), filters.get('client_id'), filters.get('client_name'),
        filters.get('operation_type'), filters.get('status'),
    )
    orders = await db.port_client_orders.find(query, {'_id': 0}).sort([('scheduled_at', 1), ('order_number', 1)]).to_list(None)
    report = _REPORT_BUILDERS[kind](orders, filters.get('status'))
    report['title'] = f"{REPORT_KINDS[kind]} – Ordem de Serviço – Cliente"
    report['filters_text'] = await _filters_text(filters)
    report['kind'] = kind
    return report


def _filters(date_from, date_to, client_id, client_name, operation_type, status):
    return {'date_from': date_from, 'date_to': date_to, 'client_id': client_id, 'client_name': client_name,
            'operation_type': operation_type, 'status': status}


@api_router.get("/reports/port-client-orders/{kind}")
async def port_client_orders_report(
    kind: str, date_from: Optional[str] = None, date_to: Optional[str] = None, client_id: Optional[str] = None,
    client_name: Optional[str] = None, operation_type: Optional[str] = None, status: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user),
):
    return await build_report(kind, _filters(date_from, date_to, client_id, client_name, operation_type, status))


@api_router.get("/reports/port-client-orders/{kind}/pdf")
async def port_client_orders_report_pdf(
    kind: str, date_from: Optional[str] = None, date_to: Optional[str] = None, client_id: Optional[str] = None,
    client_name: Optional[str] = None, operation_type: Optional[str] = None, status: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user),
):
    report = await build_report(kind, _filters(date_from, date_to, client_id, client_name, operation_type, status))
    pdf = generate_tabular_report_pdf(report, company=await get_company_settings())
    filename = f"os_cliente_{kind}_{now_brt().strftime('%d-%m-%Y_%H-%M')}.pdf"
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})


@api_router.get("/reports/port-client-orders/{kind}/excel")
async def port_client_orders_report_excel(
    kind: str, date_from: Optional[str] = None, date_to: Optional[str] = None, client_id: Optional[str] = None,
    client_name: Optional[str] = None, operation_type: Optional[str] = None, status: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user),
):
    report = await build_report(kind, _filters(date_from, date_to, client_id, client_name, operation_type, status))
    xlsx = generate_tabular_report_excel(report, company=await get_company_settings())
    filename = f"os_cliente_{kind}_{now_brt().strftime('%d-%m-%Y_%H-%M')}.xlsx"
    return StreamingResponse(io.BytesIO(xlsx), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})
