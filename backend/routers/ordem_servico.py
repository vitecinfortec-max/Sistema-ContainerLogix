import os
from datetime import datetime, timezone, timedelta
from typing import Optional, List
import io
import re
import json
import shutil
import uuid
import logging
from pathlib import Path
from urllib.parse import quote as url_quote

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel as PydanticBaseModel

from models import (
    User, UserCreate, UserLogin, UserResponse, Token,
    CompanySettings, CompanySettingsUpdate,
    Driver, DriverCreate, DriverResponse,
    TransportCompany, TransportCompanyCreate, TransportCompanyResponse,
    Client, ClientCreate, ClientResponse,
    Supplier, SupplierCreate, SupplierResponse,
    ContainerMovement, ContainerMovementCreate, ContainerMovementResponse,
    DailyMovementPoint, DriverRankingEntry, DashboardStats,
    ShippingLine, ShippingLineCreate, ShippingLineResponse,
    ServiceType, ServiceTypeCreate, ServiceTypeResponse,
    Invoice, InvoiceCreate, InvoiceUpdate, InvoiceResponse, InvoiceMovementDetail,
    InvoiceHistory, InvoiceHistoryResponse,
    ContainerInspectionPhoto, ContainerInspection, ContainerInspectionCreate,
    ContainerInspectionUpdate, ContainerInspectionResponse,
    CONTAINER_INSPECTION_PHOTO_TYPES, MAX_CONTAINER_INSPECTION_PHOTOS,
    FlexTankMovement, FlexTankMovementCreate, FlexTankMovementUpdate,
    FlexTankMovementResponse, FlexTankStockSummary,
    Vehicle, VehicleCreate, VehicleUpdate, VehicleResponse,
    VehicleChecklistItem, VehicleChecklistProduct, VehicleChecklistFields,
    VehicleChecklist, VehicleChecklistCreate, VehicleChecklistResponse,
    VEHICLE_CHECKLIST_TEMPLATE, VEHICLE_CHECKLIST_SECTION_LABELS,
    VehicleRevision, VehicleRevisionCreate, VehicleRevisionResponse,
    LoadingScheduleItem, LoadingSchedule, LoadingScheduleCreate, LoadingScheduleResponse,
    DailyRateRequestItem, DailyRateRequest, DailyRateRequestCreate, DailyRateRequestResponse,
    IntlInvoiceItem, IntlInvoice, IntlInvoiceCreate, IntlInvoiceResponse,
    DeliveryStatusItem, DeliveryStatus, DeliveryStatusCreate, DeliveryStatusResponse,
    UnitSegregationItem, UnitSegregation, UnitSegregationCreate, UnitSegregationUpdate,
    UnitSegregationResponse,
    RPAServiceItem, RPATerceiro, RPATerceiroCreate, RPATerceiroUpdate, RPATerceiroResponse,
    OSItem, OrdemServico, OrdemServicoCreate, OrdemServicoUpdate, OrdemServicoResponse,
    OSCategory, OSCategoryCreate, OSCategoryResponse,
    ExpenseReportReceipt, ExpenseReportDeposit, ExpenseReportPurchase,
    ExpenseReport, ExpenseReportCreate, ExpenseReportResponse,
)
from auth import get_password_hash, verify_password, create_access_token, get_current_user, decode_token
from reports import (
    generate_pdf_report, generate_excel_report, generate_billing_pdf_report, generate_billing_excel,
    now_brt, to_brt, merge_company, DEFAULT_COMPANY
)

from shared import (
    db, manager, get_current_active_user, get_current_admin_user, get_company_settings,
    get_next_transaction_id, parse_datetime_value, round_money, migrate_inspection_photos,
    load_logo_buffer, validate_and_read_upload, ALLOWED_EXTENSIONS, ALLOWED_RECEIPT_EXTENSIONS,
    MAX_FILE_SIZE, check_rate_limit, client_ip, UPLOADS_DIR, ROOT_DIR
)

api_router = APIRouter(prefix="/api")

# ==================== MANUTENÇÃO - CADASTRO DE CATEGORIA (OS) ====================

@api_router.post("/os-categories", response_model=OSCategoryResponse)
async def create_os_category(data: OSCategoryCreate, current_user: dict = Depends(get_current_active_user)):
    category = OSCategory(**data.model_dump(), created_by=current_user['sub'])
    doc = category.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.os_categories.insert_one(doc)
    return OSCategoryResponse(**category.model_dump())

@api_router.get("/os-categories", response_model=List[OSCategoryResponse])
async def get_os_categories(current_user: dict = Depends(get_current_active_user)):
    categories = await db.os_categories.find({}, {"_id": 0}).sort("name", 1).to_list(None)
    return [
        OSCategoryResponse(**{**c, "created_at": datetime.fromisoformat(c['created_at'])})
        for c in categories
    ]

@api_router.put("/os-categories/{category_id}", response_model=OSCategoryResponse)
async def update_os_category(category_id: str, data: OSCategoryCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.os_categories.find_one({"id": category_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Categoria não encontrada")
    update_data = {**data.model_dump(), "id": category_id, "created_at": existing['created_at'], "created_by": existing['created_by']}
    await db.os_categories.replace_one({"id": category_id}, update_data)
    return OSCategoryResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})

@api_router.delete("/os-categories/{category_id}")
async def delete_os_category(category_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.os_categories.delete_one({"id": category_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Categoria não encontrada")
    return {"message": "Categoria removida com sucesso"}

# ==================== ORDEM DE SERVIÇO ====================
from models import OrdemServico, OrdemServicoCreate, OrdemServicoUpdate, OrdemServicoResponse, OSItem


def _os_calc_item_total(item: dict) -> float:
    qty = float(item.get('quantity') or 0)
    unit_price = float(item.get('unit_price') or 0)
    discount = float(item.get('discount') or 0)
    return round(qty * unit_price - discount, 2)


def _os_serialize(os_doc: dict) -> dict:
    out = {**os_doc}
    products = out.get('products') or []
    services = out.get('services') or []
    for p in products:
        p['total'] = _os_calc_item_total(p)
    for s in services:
        s['total'] = _os_calc_item_total(s)
    out['products_total'] = round(sum(p.get('total', 0) for p in products), 2)
    out['services_total'] = round(sum(s.get('total', 0) for s in services), 2)
    out['grand_total'] = round(out['products_total'] + out['services_total'], 2)
    return out


@api_router.get("/ordem-servico", response_model=List[OrdemServicoResponse])
async def list_ordem_servico(
    search: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    query = {}
    if status:
        query['status'] = status
    if search:
        search_escaped = re.escape(search)
        query["$or"] = [
            {"person_name": {"$regex": search_escaped, "$options": "i"}},
            {"equipment_plate": {"$regex": search_escaped, "$options": "i"}},
            {"description": {"$regex": search_escaped, "$options": "i"}},
            {"category": {"$regex": search_escaped, "$options": "i"}},
        ]
    rows = await db.ordem_servico.find(query, {"_id": 0}).sort("os_number", -1).to_list(None)
    return [_os_serialize(r) for r in rows]


@api_router.get("/ordem-servico/next-number")
async def get_next_os_number(current_user: dict = Depends(get_current_active_user)):
    """Só uma prévia para exibir na tela; o número real é reservado de forma
    atômica na criação (ver create_ordem_servico). Lê o mesmo contador em vez de
    buscar a última OS criada, senão a prévia pode ficar dessincronizada sob
    concorrência."""
    counter = await db.counters.find_one({"_id": "os_number"})
    return {"next_number": (counter["seq"] + 1) if counter else 1}


@api_router.get("/ordem-servico/{os_id}", response_model=OrdemServicoResponse)
async def get_ordem_servico(os_id: str, current_user: dict = Depends(get_current_active_user)):
    doc = await db.ordem_servico.find_one({"id": os_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Ordem de Serviço não encontrada")
    return _os_serialize(doc)


@api_router.post("/ordem-servico", response_model=OrdemServicoResponse)
async def create_ordem_servico(data: OrdemServicoCreate, current_user: dict = Depends(get_current_active_user)):
    # Numeração atômica - evita duas OS criadas ao mesmo tempo saírem com o mesmo número
    counter = await db.counters.find_one_and_update(
        {"_id": "os_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    next_num = counter["seq"]

    os_obj = OrdemServico(
        os_number=next_num,
        **data.model_dump(),
        created_by=current_user["sub"],
        created_by_name=current_user["name"]
    )
    doc = os_obj.model_dump()
    doc["created_at"] = os_obj.created_at.isoformat()
    await db.ordem_servico.insert_one(doc)
    return _os_serialize(doc)


@api_router.put("/ordem-servico/{os_id}", response_model=OrdemServicoResponse)
async def update_ordem_servico(os_id: str, data: OrdemServicoUpdate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.ordem_servico.find_one({"id": os_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Ordem de Serviço não encontrada")
    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.ordem_servico.update_one({"id": os_id}, {"$set": update_data})
    updated = await db.ordem_servico.find_one({"id": os_id}, {"_id": 0})
    return _os_serialize(updated)


@api_router.delete("/ordem-servico/{os_id}")
async def delete_ordem_servico(os_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.ordem_servico.delete_one({"id": os_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Ordem de Serviço não encontrada")
    return {"message": "Ordem de Serviço removida"}


@api_router.get("/ordem-servico/{os_id}/pdf")
async def download_ordem_servico_pdf(os_id: str, current_user: dict = Depends(get_current_active_user)):
    """Gera o PDF da Ordem de Serviço no mesmo layout visual do comprovante de
    Registro de Gate/EIR (cabeçalho padrão, caixas com título, área de
    assinaturas, código de barras) - reaproveita os helpers de
    generate_movement_voucher_pdf em reports.py, mesmo padrão já usado em
    Ordem de Carregamento (loading_orders.py). Também traz pro PDF campos que
    o formulário já coleta mas o layout antigo (modelo Bsoft TMS) nunca
    imprimia: Ajudante, Leitura Final, Retorno, Orçamento/Aprovação/Prev.
    Fechamento, Ações Associadas e Observação."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    from reportlab.graphics.barcode import code128
    from xml.sax.saxutils import escape as xml_escape
    from reports import (
        download_logo, _build_pdf_header, _voucher_field_row, _voucher_boxed_section,
        PRIMARY_COLOR, HEADER_BG_COLOR,
    )

    os_doc = await db.ordem_servico.find_one({"id": os_id}, {"_id": 0})
    if not os_doc:
        raise HTTPException(status_code=404, detail="Ordem de Serviço não encontrada")
    os_doc = _os_serialize(os_doc)
    company = merge_company(await get_company_settings())

    def money(v):
        try:
            return f"{float(v or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        except Exception:
            return "0,00"

    def safe_text(value):
        """Escapa '&', '<', '>' antes de entrar num Paragraph - texto livre
        (descrição de item, observação etc.) pode conter esses caracteres e o
        Paragraph do ReportLab interpreta o conteúdo como mini-XML, então sem
        isso um '&' sozinho, por exemplo, quebra a geração do PDF."""
        return xml_escape(str(value)) if value not in (None, '') else ''

    def fmt_dt(s):
        if not s:
            return None
        try:
            return datetime.fromisoformat(str(s).replace('Z', '+00:00')).strftime('%d/%m/%Y %H:%M')
        except Exception:
            return str(s)

    def fmt_duration(start_iso, end_iso):
        """Tempo de serviço = Fechamento - Abertura. O layout antigo tinha esse
        campo mas nunca calculava nada (sempre saía em branco)."""
        try:
            start_dt = datetime.fromisoformat(str(start_iso).replace('Z', '+00:00'))
            end_dt = datetime.fromisoformat(str(end_iso).replace('Z', '+00:00'))
            minutes = int((end_dt - start_dt).total_seconds() // 60)
            if minutes < 0:
                return None
            h, m = divmod(minutes, 60)
            return f"{h}h{m:02d}min"
        except Exception:
            return None

    STATUS_LABELS = {'ABERTO': 'Aberto', 'ANDAMENTO': 'Em Andamento', 'FECHADO': 'Fechado', 'CANCELADO': 'Cancelado'}
    STATUS_HEX = {
        'ABERTO': '#1D4ED8', 'ANDAMENTO': '#B45309', 'FECHADO': '#15803D', 'CANCELADO': '#B91C1C',
    }.get(os_doc.get('status'), '#000000')
    PRIORITY_LABELS = {'ALTA': 'Alta', 'MEDIA': 'Média', 'BAIXA': 'Baixa'}

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        rightMargin=10 * mm, leftMargin=10 * mm, topMargin=6 * mm, bottomMargin=6 * mm
    )
    width = doc.width
    styles = getSampleStyleSheet()
    logo_buffer = download_logo(company)

    label_value_style = styles['Normal']
    box_title_style = ParagraphStyle('OSBoxTitle', parent=styles['Normal'], fontSize=9, fontName='Helvetica-Bold')
    title_style = ParagraphStyle('OSTitle', parent=styles['Normal'], fontSize=14, fontName='Helvetica-Bold', alignment=TA_CENTER)
    subtitle_style = ParagraphStyle('OSSubtitle', parent=styles['Normal'], fontSize=10, alignment=TA_CENTER)
    footer_style = ParagraphStyle('OSFooter', parent=styles['Normal'], fontSize=7, alignment=TA_CENTER, textColor=colors.HexColor('#555555'))
    text_block_style = ParagraphStyle('OSTextBlock', parent=styles['Normal'], fontSize=8.5, leading=10.5)

    def field_row(pairs, n_cols=4):
        return _voucher_field_row(pairs, width, label_value_style, n_cols=n_cols)

    def boxed_section(title, row_tables, extra=None):
        return _voucher_boxed_section(title, row_tables, width, box_title_style, extra=extra)

    elements = []

    # Header padrão (logo + dados da empresa), sem a linha/título default - o
    # título aqui é a caixa "ORDEM DE SERVIÇO" abaixo, mesmo truque do
    # comprovante de movimentação/Ordem de Carregamento.
    elements.extend(_build_pdf_header(styles, logo_buffer, '', company=company, content_width=width)[:2])

    # Título
    title_tbl = Table([
        [Paragraph('ORDEM DE SERVIÇO', title_style)],
        [Paragraph(f"O.S. Nº {os_doc['os_number']} - {os_doc.get('category') or 'Sem categoria'}", subtitle_style)],
    ], colWidths=[width])
    title_tbl.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1.5, colors.black),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(title_tbl)
    elements.append(Spacer(1, 6))

    status_label = STATUS_LABELS.get(os_doc.get('status'), os_doc.get('status'))
    priority_label = PRIORITY_LABELS.get(os_doc.get('priority'), os_doc.get('priority'))
    duration = fmt_duration(os_doc.get('opened_at'), os_doc.get('closed_at'))
    elements.append(boxed_section('Dados da O.S.', [
        field_row([
            ('Tipo', os_doc.get('os_type')),
            ('Status', f'<font color="{STATUS_HEX}">{status_label}</font>' if status_label else None),
            ('Prioridade', priority_label),
            ('Exige PT', 'Sim' if os_doc.get('requires_pt') else 'Não'),
        ]),
        field_row([
            ('Abertura', fmt_dt(os_doc.get('opened_at'))),
            ('Orçamento', fmt_dt(os_doc.get('budget_at'))),
            ('Aprovação', fmt_dt(os_doc.get('approved_at'))),
            ('Prev. Fechamento', fmt_dt(os_doc.get('forecast_close_at'))),
        ]),
        field_row([
            ('Fechamento', fmt_dt(os_doc.get('closed_at'))),
            ('Tempo de Serviço', duration),
            ('Retorno', 'Sim' if os_doc.get('is_retorno') else 'Não'),
        ], n_cols=3),
    ]))
    elements.append(Spacer(1, 6))

    city_state = f"{os_doc.get('city')}/{os_doc.get('state')}" if (os_doc.get('city') or os_doc.get('state')) else os_doc.get('city_uf')
    elements.append(boxed_section('Cliente / Local', [
        field_row([
            ('Cliente', os_doc.get('person_name')),
            ('CPF/CNPJ', os_doc.get('person_doc')),
        ], n_cols=2),
        field_row([
            ('Endereço', os_doc.get('address')),
            ('Cidade/Estado', city_state),
            ('Telefone', os_doc.get('contact_value')),
        ], n_cols=3),
    ]))
    elements.append(Spacer(1, 6))

    reading_initial = os_doc.get('reading_initial')
    reading_final = os_doc.get('reading_final')
    elements.append(boxed_section('Equipe e Equipamento', [
        field_row([
            ('Técnico', os_doc.get('technician_name')),
            ('Supervisor', os_doc.get('supervisor_name')),
            ('Ajudante', os_doc.get('helper_name')),
        ], n_cols=3),
        field_row([
            ('Equipamento (Placa)', os_doc.get('equipment_plate')),
            ('Leitura Inicial (KM/HR)', f"{reading_initial:.0f}" if reading_initial is not None else None),
            ('Leitura Final (KM/HR)', f"{reading_final:.0f}" if reading_final is not None else None),
            ('Equipamento Agregador', os_doc.get('appropriation_plate')),
        ]),
    ]))
    elements.append(Spacer(1, 6))

    elements.append(boxed_section('Detalhamento da Demanda', [], extra=[
        Paragraph(safe_text(os_doc.get('description')).replace(chr(10), '<br/>') or '-', text_block_style),
    ]))
    elements.append(Spacer(1, 6))

    if os_doc.get('associated_actions'):
        elements.append(boxed_section('Ações Associadas', [], extra=[
            Paragraph(safe_text(os_doc['associated_actions']).replace(chr(10), '<br/>'), text_block_style),
        ]))
        elements.append(Spacer(1, 6))

    # ===== Produtos =====
    # Descrição entra como Paragraph (não string solta) pra quebrar linha
    # dentro da coluna - antes, uma descrição um pouco mais longa não
    # quebrava e vazava por cima da coluna Qtd ao lado (bug visível no PDF:
    # "WK1060/21,00" era na real "WK1060/2" da descrição colado no "1,00" da
    # Qtd, sem quebra nem espaço). A coluna também ficou mais larga (era a
    # menor fonte de sobra nas colunas de valor, que raramente precisam de
    # toda a largura reservada).
    item_desc_style = ParagraphStyle('OSItemDesc', parent=styles['Normal'], fontSize=7.5, leading=9)

    prod_header = ['Código', 'Descrição', 'Qtd', 'Un', 'V. Unit.', 'V. Total', 'Desc.', 'V. c/ Desc.']
    prod_rows = [prod_header]
    products = os_doc.get('products') or []
    for p in products:
        qty = float(p.get('quantity') or 0)
        unit_price = float(p.get('unit_price') or 0)
        prod_rows.append([
            p.get('code') or '-',
            Paragraph(safe_text(p.get('description')) or '-', item_desc_style),
            f"{qty:.2f}".replace('.', ','),
            p.get('unit') or 'UN',
            money(unit_price),
            money(qty * unit_price),
            money(p.get('discount')),
            money(p.get('total')),
        ])
    # Total soma o valor de cada linha (Qtd x V.Unit e o desconto), não os
    # preços unitários em si - o layout antigo somava os V.Unit. de itens
    # diferentes nessa célula, um total sem sentido de negócio.
    prod_rows.append([
        '', 'Total', '', '', '',
        money(sum(float(p.get('quantity') or 0) * float(p.get('unit_price') or 0) for p in products)),
        money(sum(float(p.get('discount') or 0) for p in products)),
        money(os_doc.get('products_total')),
    ])
    prod_base_widths = [35, 250, 30, 28, 48, 48, 38, 55]
    prod_scale = width / sum(prod_base_widths)
    prod_t = Table(prod_rows, colWidths=[w * prod_scale for w in prod_base_widths], repeatRows=1)
    prod_style = [
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#F5F5F5')),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 7.5),
        ('BOX', (0, 0), (-1, -1), 1, colors.black),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CCCCCC')),
        ('ALIGN', (2, 1), (-1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor(f'#{HEADER_BG_COLOR}')),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
    ]
    if products:
        # Zebra striping só faz sentido com pelo menos 1 linha de item entre o
        # cabeçalho e o total - com a tabela vazia (só cabeçalho + Total), o
        # range (0,1)-(-1,-2) apontaria pra trás (linha 1 até a linha 0).
        prod_style.append(('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, colors.HexColor('#FAFAFA')]))
    prod_t.setStyle(TableStyle(prod_style))
    elements.append(boxed_section('Produtos', [], extra=[prod_t]))
    elements.append(Spacer(1, 6))

    # ===== Serviços =====
    serv_header = ['Código', 'Descrição', 'Qtd', 'Unidade', 'V. Unit.', 'V. Total']
    serv_rows = [serv_header]
    services = os_doc.get('services') or []
    for s in services:
        serv_rows.append([
            s.get('code') or '-',
            Paragraph(safe_text(s.get('description')) or '-', item_desc_style),
            f"{float(s.get('quantity') or 0):.2f}".replace('.', ','),
            s.get('unit') or 'quantidade',
            money(s.get('unit_price')),
            money(s.get('total')),
        ])
    serv_rows.append(['', 'Total', '', '', '', money(os_doc.get('services_total'))])
    serv_base_widths = [35, 330, 30, 48, 48, 48]
    serv_scale = width / sum(serv_base_widths)
    serv_t = Table(serv_rows, colWidths=[w * serv_scale for w in serv_base_widths], repeatRows=1)
    serv_style = [
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#F5F5F5')),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 7.5),
        ('BOX', (0, 0), (-1, -1), 1, colors.black),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CCCCCC')),
        ('ALIGN', (2, 1), (-1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor(f'#{HEADER_BG_COLOR}')),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
    ]
    if services:
        serv_style.append(('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, colors.HexColor('#FAFAFA')]))
    serv_t.setStyle(TableStyle(serv_style))
    elements.append(boxed_section('Serviços', [], extra=[serv_t]))
    elements.append(Spacer(1, 6))

    # ===== Total Geral =====
    grand_total_style = ParagraphStyle('OSGrandTotal', parent=styles['Normal'], fontSize=11,
                                       fontName='Helvetica-Bold', alignment=TA_CENTER,
                                       textColor=colors.HexColor(f'#{PRIMARY_COLOR}'))
    total_tbl = Table([[Paragraph(
        f"TOTAL GERAL (Produtos + Serviços): {money(os_doc.get('grand_total'))}", grand_total_style
    )]], colWidths=[width])
    total_tbl.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor(f'#{PRIMARY_COLOR}')),
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(f'#{HEADER_BG_COLOR}')),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    elements.append(total_tbl)
    elements.append(Spacer(1, 6))

    # ===== Parecer de Encerramento =====
    # Antes era uma Table com rowHeights fixo (28pt) - qualquer parecer um
    # pouco mais longo que isso não cabia e o texto vazava por cima da seção
    # de Produtos logo abaixo (bug visível no PDF impresso). Usando Paragraph
    # solto dentro do boxed_section (altura dinâmica) em vez de Table de
    # altura fixa, o conteúdo sempre empurra o que vem depois pra baixo.
    elements.append(boxed_section('Parecer de Encerramento', [], extra=[
        Paragraph('Uso no fechamento: ' + '_' * 95, ParagraphStyle('OSUso', parent=styles['Normal'], fontSize=8)),
        Spacer(1, 5),
        Paragraph(safe_text(os_doc.get('closure_remark')).replace(chr(10), '<br/>') or '-', text_block_style),
    ]))
    elements.append(Spacer(1, 6))

    if os_doc.get('observations'):
        elements.append(boxed_section('Observações', [], extra=[
            Paragraph(safe_text(os_doc['observations']).replace(chr(10), '<br/>'), text_block_style),
        ]))
        elements.append(Spacer(1, 6))

    # ===== Chegada/Saída (preenchimento manual na visita) =====
    manual_style = ParagraphStyle('OSManual', parent=styles['Normal'], fontSize=8)
    chegada_t = Table([[
        Paragraph('Data / Hora da Chegada: ' + '_' * 35, manual_style),
        Paragraph('Data / Hora da Saída: ' + '_' * 35, manual_style),
    ]], colWidths=[width / 2, width / 2])
    chegada_t.setStyle(TableStyle([
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
    ]))
    elements.append(chegada_t)
    elements.append(Spacer(1, 6))

    # ===== Área de assinaturas - mesmo padrão do comprovante de movimentação/Ordem de Carregamento =====
    sig_title_style = ParagraphStyle('OSSigTitle', parent=styles['Normal'], fontSize=9, fontName='Helvetica-Bold', alignment=TA_CENTER)
    sig_info_style = ParagraphStyle('OSSigInfo', parent=styles['Normal'], fontSize=8)
    sig_data = [[
        [
            Paragraph('Assinatura do Técnico', sig_title_style),
            Spacer(1, 20),
            HRFlowable(width='100%', thickness=0.8, color=colors.black),
            Paragraph(f"Nome: {os_doc.get('technician_name') or '-'}", sig_info_style),
        ],
        [
            Paragraph('Assinatura do Cliente', sig_title_style),
            Spacer(1, 20),
            HRFlowable(width='100%', thickness=0.8, color=colors.black),
            Paragraph(f"Nome: {os_doc.get('person_name') or '-'}", sig_info_style),
        ],
    ]]
    sig_tbl = Table(sig_data, colWidths=[width / 2] * 2)
    sig_tbl.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1, colors.black),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 15),
        ('RIGHTPADDING', (0, 0), (-1, -1), 15),
    ]))
    elements.append(sig_tbl)
    elements.append(Spacer(1, 6))

    # ===== Declarações (termo de aceite) =====
    decl_style = ParagraphStyle('OSDecl', parent=styles['Normal'], fontSize=7.5, leading=10,
                                fontName='Helvetica-Oblique')
    decl_t = Table([
        [Paragraph("O serviço foi realizado e o cliente declara ter realizado os devidos testes de "
                  "funcionamento do equipamento.", decl_style),
         Paragraph("O cliente não forneceu acesso ao equipamento para realização do serviço "
                  "responsabilizando-se pelas implicações que esta ação pode gerar.", decl_style)]
    ], colWidths=[width / 2, width / 2])
    decl_t.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.5, colors.grey),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    elements.append(decl_t)
    elements.append(Spacer(1, 8))

    # Código de barras + usuário + data/hora de impressão
    barcode_value = str(os_doc.get('os_number') or 0).zfill(6)
    try:
        bc = code128.Code128(barcode_value, barWidth=1.0, barHeight=28)
    except Exception:
        bc = None
    bc_num = Paragraph(f"<b>{os_doc['os_number']}</b>", ParagraphStyle('OSBcNum', parent=styles['Normal'], fontSize=8, alignment=TA_CENTER))
    left_cell = [bc, bc_num] if bc else [bc_num]
    right_info = [
        Paragraph(f"<b>Usuário: {current_user.get('name') or '-'}</b>", styles['Normal']),
        Paragraph(f"<b>Data e hora da impressão: {now_brt().strftime('%d/%m/%Y %H:%M')}</b>", styles['Normal']),
    ]
    info_tbl = Table([[left_cell, right_info]], colWidths=[100, width - 100])
    info_tbl.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LINEBELOW', (0, 0), (-1, -1), 1, colors.black),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
    ]))
    elements.append(info_tbl)
    elements.append(Spacer(1, 6))

    elements.append(Paragraph(
        f"{company['name']} | Este documento é válido como Ordem de Serviço",
        footer_style
    ))

    doc.build(elements)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    filename = f"OS_{os_doc['os_number']}.pdf"
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})


