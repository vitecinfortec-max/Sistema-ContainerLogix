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
    PhotoRegistry, PhotoRegistryCreate, PhotoRegistryUpdate, PhotoRegistryResponse,
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
    last = await db.ordem_servico.find_one({}, sort=[("os_number", -1)])
    return {"next_number": (last["os_number"] + 1) if last else 1}


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
    """Gera PDF da Ordem de Serviço seguindo o modelo Bsoft TMS."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

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

    def fmt_dt(s):
        if not s:
            return ''
        try:
            return datetime.fromisoformat(s.replace('Z', '+00:00')).strftime('%d/%m/%Y %H:%M:%S')
        except Exception:
            return str(s)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4,
                            leftMargin=10 * mm, rightMargin=10 * mm,
                            topMargin=8 * mm, bottomMargin=8 * mm)
    elements = []
    styles = getSampleStyleSheet()

    BLACK = colors.HexColor('#000000')
    GRAY_BG = colors.HexColor('#E8E8E8')

    # ===== HEADER: Logo + Empresa (esquerda) + Título OS (direita) =====
    from reports import download_logo
    from reportlab.platypus import Image as RLImage
    logo_buffer = download_logo(company)
    if logo_buffer:
        logo_img = RLImage(logo_buffer, width=22 * mm, height=22 * mm)
    else:
        logo_img = Paragraph("", styles['Normal'])

    company_style = ParagraphStyle('CompHead', parent=styles['Normal'], fontSize=9, leading=11,
                                   fontName='Helvetica-Bold')
    company_address_line = company['address'].replace('\n', ', ')
    company_para = Paragraph(
        f"<b>{company['name']}</b><br/>"
        f"<font size='8'>{company_address_line}<br/>"
        f"CNPJ: {company['cnpj']}, Fone: {company['phone']}<br/>"
        f"E-mail: {company['email']}</font>", company_style)

    os_title_style = ParagraphStyle('OSTit', parent=styles['Normal'], fontSize=14, leading=16,
                                    alignment=TA_RIGHT, fontName='Helvetica-Bold')
    right_para = Paragraph(
        f"Ordem de Serviço<br/><font size='9'>O.S. Nro: <b>{os_doc['os_number']}</b></font>", os_title_style)

    header = Table([[logo_img, company_para, right_para]], colWidths=[24 * mm, 96 * mm, 70 * mm])
    header.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('LEFTPADDING', (1, 0), (1, 0), 4),
    ]))
    elements.append(header)
    elements.append(Spacer(1, 4))

    # ===== Linha de categoria + datas =====
    label_s = ParagraphStyle('Lbl', parent=styles['Normal'], fontSize=7, leading=9,
                             textColor=colors.HexColor('#555'))
    value_s = ParagraphStyle('Val', parent=styles['Normal'], fontSize=8, leading=10,
                             fontName='Helvetica-Bold')

    def field(label, val):
        return Paragraph(f"<font size='7' color='#555'>{label}</font><br/>"
                         f"<font size='8'><b>{val if val else '_____________'}</b></font>",
                         ParagraphStyle('F', parent=styles['Normal'], leading=11))

    info_row1 = [
        field("Categoria:", os_doc.get('category')),
        field("Data/Hora Recepção:", fmt_dt(os_doc.get('opened_at'))),
        field("Data de abertura:", fmt_dt(os_doc.get('opened_at'))),
    ]
    info_row2 = [
        field("Tipo:", os_doc.get('os_type')),
        field("Data de fechamento:", fmt_dt(os_doc.get('closed_at'))),
        field("Tempo de serviço:", ''),
    ]
    info_t = Table([info_row1, info_row2], colWidths=[80 * mm, 55 * mm, 55 * mm])
    info_t.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.5, BLACK),
        ('INNERGRID', (0, 0), (-1, -1), 0.3, colors.grey),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(info_t)
    elements.append(Spacer(1, 4))

    # ===== Dados da O.S. (Clientes) =====
    def section_bar(title):
        t = Table([[Paragraph(f"<b>{title}</b>",
                              ParagraphStyle('SB', parent=styles['Normal'], fontSize=8.5))]],
                  colWidths=[190 * mm])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), GRAY_BG),
            ('LINEBELOW', (0, 0), (-1, -1), 0.5, BLACK),
            ('TOPPADDING', (0, 0), (-1, -1), 2),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
            ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ]))
        return t

    elements.append(section_bar("Dados da O.S."))
    dados_t = Table([[
        field("Clientes:", os_doc.get('person_name')),
        field("Supervisor:", os_doc.get('supervisor_name')),
    ], [
        field("CPF/CNPJ:", os_doc.get('person_doc')),
        field("Técnico:", os_doc.get('technician_name')),
    ], [
        field("PT:", "Sim" if os_doc.get('requires_pt') else "Não"),
        field("Status:", os_doc.get('status')),
    ]], colWidths=[95 * mm, 95 * mm])
    dados_t.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.5, BLACK),
        ('INNERGRID', (0, 0), (-1, -1), 0.3, colors.grey),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(dados_t)
    elements.append(Spacer(1, 4))

    # ===== Detalhes Operacionais =====
    elements.append(section_bar("Detalhes Operacionais"))
    det_t = Table([[
        field("Endereço:", os_doc.get('address')),
        field("Telefone:", os_doc.get('contact_value')),
    ], [
        field("Cidade/Estado:", os_doc.get('city_uf')),
        field("Data agenda:", ''),
    ], [
        field("Hora agenda:", ''),
        field("Prioridade:", os_doc.get('priority')),
    ]], colWidths=[95 * mm, 95 * mm])
    det_t.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.5, BLACK),
        ('INNERGRID', (0, 0), (-1, -1), 0.3, colors.grey),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(det_t)
    elements.append(Spacer(1, 4))

    # ===== Identificação do Cliente (Equipamento) =====
    elements.append(section_bar("Identificação do Cliente"))
    eq_t = Table([[
        field("Equipamento (Placa):", os_doc.get('equipment_plate')),
        field("Medidor de abertura:", f"{os_doc.get('reading_initial') or 0:.0f}"),
    ], [
        field("Descrição:", os_doc.get('description')),
        Paragraph("", styles['Normal']),
    ]], colWidths=[95 * mm, 95 * mm])
    eq_t.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.5, BLACK),
        ('INNERGRID', (0, 0), (-1, -1), 0.3, colors.grey),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(eq_t)
    elements.append(Spacer(1, 4))

    # ===== Detalhamento da Demanda =====
    elements.append(section_bar("Detalhamento da Demanda"))
    demand_t = Table([[Paragraph(
        f"<font size='9'>{(os_doc.get('description') or '').replace(chr(10), '<br/>')}</font>",
        styles['Normal']
    )]], colWidths=[190 * mm], rowHeights=[36])
    demand_t.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.5, BLACK),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(demand_t)
    elements.append(Spacer(1, 4))

    # ===== Parecer de Encerramento =====
    elements.append(section_bar("Parecer de Encerramento"))
    enc_t = Table([[Paragraph(
        f"<font size='8'>Uso no fechamento: ____________________________________________________________<br/>"
        f"<br/>{(os_doc.get('closure_remark') or '').replace(chr(10), '<br/>')}</font>",
        styles['Normal']
    )]], colWidths=[190 * mm], rowHeights=[28])
    enc_t.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.5, BLACK),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(enc_t)
    elements.append(Spacer(1, 4))

    # ===== Produtos =====
    elements.append(section_bar("Produtos"))
    prod_header = ['Código', 'Descrição', 'Qtd', 'Un', 'V. Unit.', 'V. Total', 'Desc.', 'V. c/ Desc.']
    prod_rows = [prod_header]
    for p in (os_doc.get('products') or []):
        prod_rows.append([
            p.get('code') or '-',
            p.get('description') or '-',
            f"{float(p.get('quantity') or 0):.2f}".replace('.', ','),
            p.get('unit') or 'UN',
            money(p.get('unit_price')),
            money(float(p.get('quantity') or 0) * float(p.get('unit_price') or 0)),
            money(p.get('discount')),
            money(p.get('total')),
        ])
    prod_rows.append(['', 'Total', '', '',
                      money(sum(float(p.get('unit_price') or 0) for p in (os_doc.get('products') or []))),
                      '', '', money(os_doc.get('products_total'))])
    prod_t = Table(prod_rows, colWidths=[16, 70, 14, 14, 18, 18, 14, 26], repeatRows=1)
    prod_t._argW = [16 * mm, 70 * mm, 14 * mm, 14 * mm, 18 * mm, 18 * mm, 14 * mm, 26 * mm]
    prod_t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), GRAY_BG),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 7.5),
        ('GRID', (0, 0), (-1, -1), 0.3, colors.grey),
        ('ALIGN', (2, 1), (-1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 3),
        ('RIGHTPADDING', (0, 0), (-1, -1), 3),
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#F5F5F5')),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
    ]))
    elements.append(prod_t)
    elements.append(Spacer(1, 4))

    # ===== Serviços =====
    elements.append(section_bar("Serviços"))
    serv_header = ['Código', 'Descrição', 'Qtd', 'Unidade', 'V. Unit.', 'V. Total']
    serv_rows = [serv_header]
    for s in (os_doc.get('services') or []):
        serv_rows.append([
            s.get('code') or '-',
            s.get('description') or '-',
            f"{float(s.get('quantity') or 0):.2f}".replace('.', ','),
            s.get('unit') or 'quantidade',
            money(s.get('unit_price')),
            money(s.get('total')),
        ])
    serv_rows.append(['', 'Total', '', '', '', money(os_doc.get('services_total'))])
    serv_t = Table(serv_rows, colWidths=[20 * mm, 95 * mm, 18 * mm, 20 * mm, 18 * mm, 19 * mm], repeatRows=1)
    serv_t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), GRAY_BG),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 7.5),
        ('GRID', (0, 0), (-1, -1), 0.3, colors.grey),
        ('ALIGN', (2, 1), (-1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 3),
        ('RIGHTPADDING', (0, 0), (-1, -1), 3),
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#F5F5F5')),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
    ]))
    elements.append(serv_t)
    elements.append(Spacer(1, 8))

    # ===== Chegada/Saída + Assinaturas =====
    sig_t = Table([
        [Paragraph("<font size='8'>Data / Hora da Chegada: _________________________</font>", styles['Normal']),
         Paragraph("<font size='8'>Data / Hora da Saída: _________________________</font>", styles['Normal'])],
        [Paragraph("&nbsp;", styles['Normal']), Paragraph("&nbsp;", styles['Normal'])],
        [Paragraph("<font size='8'><b>__________________________<br/>Técnico:</b></font>", styles['Normal']),
         Paragraph("<font size='8'><b>__________________________<br/>Cliente:</b></font>", styles['Normal'])],
    ], colWidths=[95 * mm, 95 * mm], rowHeights=[None, 14, None])
    sig_t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(sig_t)
    elements.append(Spacer(1, 6))

    # ===== Declarações =====
    decl_style = ParagraphStyle('Decl', parent=styles['Normal'], fontSize=7.5, leading=10,
                                fontName='Helvetica-Oblique')
    decl_t = Table([
        [Paragraph("O serviço foi realizado e o cliente declara ter realizado os devidos testes de funcionamento do equipamento.", decl_style),
         Paragraph("O cliente não forneceu acesso ao equipamento para realização do serviço responsabilizando-se pelas implicações que esta ação pode gerar.", decl_style)]
    ], colWidths=[95 * mm, 95 * mm])
    decl_t.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.3, colors.grey),
        ('INNERGRID', (0, 0), (-1, -1), 0.3, colors.grey),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(decl_t)
    elements.append(Spacer(1, 8))

    # ===== Rodapé =====
    elements.append(Paragraph(
        f"<font size='7' color='#888'>{now_brt().strftime('%d/%m/%Y %H:%M')} &nbsp;&nbsp; "
        f"{company['name']} - Sistema de Gestão</font>",
        ParagraphStyle('Footer', parent=styles['Normal'], alignment=TA_CENTER)
    ))

    doc.build(elements)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    filename = f"OS_{os_doc['os_number']}.pdf"
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})


