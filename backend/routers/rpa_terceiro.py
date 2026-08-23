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

# ==================== RPA TERCEIRO ====================
from models import RPATerceiro, RPATerceiroCreate, RPATerceiroUpdate, RPATerceiroResponse, RPAServiceItem


def _rpa_calc_balance(rpa: dict) -> float:
    """Calcula SALDO A RECEBER: service_value + daily + fuel + others - advance - discounts"""
    sv = float(rpa.get('service_value') or 0)
    dr = float(rpa.get('daily_rate') or 0)
    fu = float(rpa.get('fuel') or 0)
    ad = float(rpa.get('advance') or 0)
    ot = float(rpa.get('others') or 0)
    de = float(rpa.get('discounts') or 0)
    return round(sv + dr + fu + ot - ad - de, 2)


def _rpa_serialize(rpa: dict) -> dict:
    """Adiciona balance calculado ao dict de RPA para resposta."""
    out = {**rpa}
    out['balance'] = _rpa_calc_balance(rpa)
    return out


@api_router.get("/rpa-terceiro", response_model=List[RPATerceiroResponse])
async def list_rpa_terceiro(
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    rpa_type: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    """Listar RPAs (todos, sem paginação)."""
    query = {}
    if rpa_type:
        # Aceita 'terceiro' ou 'agregado'. Documentos antigos sem campo são tratados como 'terceiro'.
        if rpa_type == "terceiro":
            query["$or"] = [{"rpa_type": "terceiro"}, {"rpa_type": {"$exists": False}}]
        else:
            query["rpa_type"] = rpa_type
    if search:
        search_escaped = re.escape(search)
        search_or = [
            {"driver_name": {"$regex": search_escaped, "$options": "i"}},
            {"client_name": {"$regex": search_escaped, "$options": "i"}},
            {"container_number": {"$regex": search_escaped, "$options": "i"}},
            {"truck_plate": {"$regex": search_escaped, "$options": "i"}},
            {"bank_beneficiary": {"$regex": search_escaped, "$options": "i"}},
        ]
        if "$or" in query:
            # Combinar com filtro de tipo
            existing_or = query.pop("$or")
            query["$and"] = [{"$or": existing_or}, {"$or": search_or}]
        else:
            query["$or"] = search_or
    if date_from:
        query.setdefault("created_at", {})["$gte"] = date_from
    if date_to:
        query.setdefault("created_at", {})["$lte"] = date_to + "T23:59:59"

    rpas = await db.rpa_terceiro.find(query, {"_id": 0}).sort("rpa_number", -1).to_list(None)
    return [_rpa_serialize(r) for r in rpas]


@api_router.get("/rpa-terceiro/next-number")
async def get_next_rpa_number(
    rpa_type: Optional[str] = "terceiro",
    current_user: dict = Depends(get_current_admin_user)
):
    """Próximo número sequencial do RPA (separado por tipo) - só uma prévia para
    exibir na tela; o número real é reservado de forma atômica na criação (ver
    create_rpa_terceiro). Lê o mesmo contador em vez de buscar o último RPA
    criado, senão a prévia pode ficar dessincronizada sob concorrência."""
    counter = await db.counters.find_one({"_id": f"rpa_number:{rpa_type or 'terceiro'}"})
    next_num = (counter["seq"] + 1) if counter else 1
    return {"next_number": next_num}


@api_router.get("/rpa-terceiro/driver-info/{driver_id}")
async def get_rpa_driver_info(driver_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Retorna info do motorista para autopreencher RPA. Prioriza o(s) veículo(s)
    cadastrados com esse motorista como responsável; se não houver nenhum, cai
    para a última movimentação desse motorista (comportamento antigo)."""
    driver = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not driver:
        raise HTTPException(status_code=404, detail="Motorista não encontrado")

    driver_vehicles = await db.vehicles.find({"driver_id": driver_id}, {"_id": 0}).to_list(50)
    truck_plate = next((v["plate"] for v in driver_vehicles if v.get("vehicle_type") in ("CAVALO", "CAMINHÃO")), None)
    trailer_plate = next((v["plate"] for v in driver_vehicles if v.get("vehicle_type") == "CARRETA"), None)
    truck_owner = None

    if not truck_plate and not trailer_plate:
        last_mov = await db.movements.find_one(
            {"driver_name": driver["name"]},
            {"_id": 0},
            sort=[("created_at", -1)]
        )
        truck_plate = (last_mov or {}).get("truck_plate")
        trailer_plate = (last_mov or {}).get("trailer_plate_1")
        truck_owner = (last_mov or {}).get("transport_company")

    return {
        "driver_name": driver.get("name"),
        "driver_cpf": driver.get("cpf"),
        "driver_phone": driver.get("phone"),
        "truck_plate": truck_plate,
        "trailer_plate": trailer_plate,
        "truck_owner": truck_owner,
    }


@api_router.get("/rpa-terceiro/{rpa_id}", response_model=RPATerceiroResponse)
async def get_rpa_terceiro(rpa_id: str, current_user: dict = Depends(get_current_admin_user)):
    rpa = await db.rpa_terceiro.find_one({"id": rpa_id}, {"_id": 0})
    if not rpa:
        raise HTTPException(status_code=404, detail="RPA não encontrado")
    return _rpa_serialize(rpa)


@api_router.post("/rpa-terceiro", response_model=RPATerceiroResponse)
async def create_rpa_terceiro(data: RPATerceiroCreate, current_user: dict = Depends(get_current_admin_user)):
    # Próximo número - separado por tipo (terceiro / agregado), gerado de forma
    # atômica para não duplicar número com duas criações concorrentes.
    rpa_type = data.rpa_type or "terceiro"
    counter = await db.counters.find_one_and_update(
        {"_id": f"rpa_number:{rpa_type}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    next_num = counter["seq"]

    rpa = RPATerceiro(
        rpa_number=next_num,
        **data.model_dump(),
        created_by=current_user["sub"],
        created_by_name=current_user["name"]
    )
    rpa_dict = rpa.model_dump()
    rpa_dict["created_at"] = rpa.created_at.isoformat()
    await db.rpa_terceiro.insert_one(rpa_dict)
    return _rpa_serialize(rpa_dict)


@api_router.put("/rpa-terceiro/{rpa_id}", response_model=RPATerceiroResponse)
async def update_rpa_terceiro(rpa_id: str, data: RPATerceiroUpdate, current_user: dict = Depends(get_current_admin_user)):
    existing = await db.rpa_terceiro.find_one({"id": rpa_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="RPA não encontrado")

    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.rpa_terceiro.update_one({"id": rpa_id}, {"$set": update_data})

    updated = await db.rpa_terceiro.find_one({"id": rpa_id}, {"_id": 0})
    return _rpa_serialize(updated)


@api_router.delete("/rpa-terceiro/{rpa_id}")
async def delete_rpa_terceiro(rpa_id: str, current_user: dict = Depends(get_current_admin_user)):
    result = await db.rpa_terceiro.delete_one({"id": rpa_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="RPA não encontrado")
    return {"message": "RPA removido"}


@api_router.get("/rpa-terceiro/{rpa_id}/pdf")
async def download_rpa_terceiro_pdf(rpa_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Gera PDF do RPA seguindo o modelo da J.A Logística."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
    from reports import download_logo, PRIMARY_COLOR

    rpa = await db.rpa_terceiro.find_one({"id": rpa_id}, {"_id": 0})
    if not rpa:
        raise HTTPException(status_code=404, detail="RPA não encontrado")

    rpa['balance'] = _rpa_calc_balance(rpa)
    company = merge_company(await get_company_settings())

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=10 * mm, rightMargin=10 * mm,
        topMargin=8 * mm, bottomMargin=8 * mm
    )

    elements = []
    styles = getSampleStyleSheet()

    def money(v):
        try:
            return f"R$ {float(v or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        except Exception:
            return "R$ 0,00"

    def fmt_date_br(iso_str):
        if not iso_str:
            return "-"
        try:
            return datetime.fromisoformat(iso_str).strftime('%d/%m/%Y')
        except Exception:
            return str(iso_str)

    # ============================================================
    # LAYOUT NO ESTILO EIR - Centralizado, limpo, com linhas finas
    # ============================================================
    PRIMARY = colors.HexColor(f'#{PRIMARY_COLOR}')
    RULE_COLOR = colors.HexColor('#2D3748')   # cinza-preto para linhas
    LABEL_COLOR = colors.HexColor('#4A5568')  # cinza médio para labels
    VALUE_COLOR = colors.HexColor('#1A202C')  # quase preto para valores
    MUTED_COLOR = colors.HexColor('#718096')  # cinza para textos secundários

    # ===== HEADER CENTRALIZADO (logo + nome + tagline + título) =====
    logo_buffer = download_logo(company)
    if logo_buffer:
        logo_img = Image(logo_buffer, width=18 * mm, height=18 * mm)
        logo_img.hAlign = 'CENTER'
        elements.append(logo_img)

    company_name_style = ParagraphStyle(
        'CompanyName', parent=styles['Normal'], fontSize=14, leading=15,
        alignment=TA_CENTER, fontName='Helvetica-Bold', textColor=PRIMARY
    )
    elements.append(Paragraph(company['name'], company_name_style))

    elements.append(Spacer(1, 3))

    doc_title_style = ParagraphStyle(
        'DocTitle', parent=styles['Normal'], fontSize=11, leading=13,
        alignment=TA_CENTER, fontName='Helvetica-Bold', textColor=VALUE_COLOR
    )
    elements.append(Paragraph("RPA - RECIBO DE PAGAMENTO A AUTÔNOMO", doc_title_style))

    rpa_id_style = ParagraphStyle(
        'RPAId', parent=styles['Normal'], fontSize=8, leading=10,
        alignment=TA_CENTER, fontName='Helvetica', textColor=MUTED_COLOR
    )
    elements.append(Paragraph(f"RPA Nº #{rpa['rpa_number']}", rpa_id_style))
    elements.append(Spacer(1, 5))

    # ===== Estilos das seções (estilo EIR) =====
    section_title_style = ParagraphStyle(
        'SectionTitle', parent=styles['Normal'], fontSize=10, leading=12,
        alignment=TA_LEFT, fontName='Helvetica-Bold', textColor=VALUE_COLOR,
        spaceBefore=0, spaceAfter=2
    )
    label_style = ParagraphStyle(
        'Label', parent=styles['Normal'], fontSize=7, leading=9,
        fontName='Helvetica', textColor=LABEL_COLOR
    )
    value_style = ParagraphStyle(
        'Value', parent=styles['Normal'], fontSize=9, leading=11,
        fontName='Helvetica-Bold', textColor=VALUE_COLOR
    )

    def section_header(title: str):
        """Linha horizontal escura + título da seção (estilo EIR)"""
        rule = Table([[""]], colWidths=[190 * mm], rowHeights=[0.7])
        rule.setStyle(TableStyle([
            ('LINEBELOW', (0, 0), (-1, -1), 1.2, RULE_COLOR),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ]))
        elements.append(rule)
        elements.append(Spacer(1, 2))
        elements.append(Paragraph(title, section_title_style))
        elements.append(Spacer(1, 3))

    def field_cell(label, val):
        """Célula com label em cima (cinza pequeno) e valor abaixo (preto bold)"""
        return Paragraph(
            f"<font color='#4A5568' size='7'>{label}</font><br/>"
            f"<font color='#1A202C' size='9'><b>{val if val else '-'}</b></font>",
            ParagraphStyle('Cell', parent=styles['Normal'], leading=11)
        )

    fields_grid_style = TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 1),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ])

    # ===== INFORMAÇÕES DO AUTÔNOMO =====
    section_header("Informações do Autônomo")
    auto_data = [
        [field_cell("Motorista", rpa.get('driver_name')),
         field_cell("CPF", rpa.get('driver_cpf')),
         field_cell("Telefone", rpa.get('driver_phone'))],
        [field_cell("Placa Cavalo", rpa.get('truck_plate')),
         field_cell("Renavan", rpa.get('truck_renavam')),
         field_cell("Proprietário", rpa.get('truck_owner'))],
        [field_cell("Placa Carreta", rpa.get('trailer_plate')),
         field_cell("Renavan Carreta", rpa.get('trailer_renavam')),
         field_cell("Proprietário Carreta", rpa.get('trailer_owner'))],
    ]
    auto_table = Table(auto_data, colWidths=[80 * mm, 50 * mm, 60 * mm])
    auto_table.setStyle(fields_grid_style)
    elements.append(auto_table)
    elements.append(Spacer(1, 2))

    # ===== INFORMAÇÕES DO SERVIÇO PRESTADO =====
    section_header("Informações do Serviço Prestado")
    serv_data = [
        [field_cell("Local", rpa.get('service_local')),
         field_cell("Data", fmt_date_br(rpa.get('service_date'))),
         field_cell("Serviço", rpa.get('service_type'))],
        [field_cell("Tipo (LS/RODO)", rpa.get('service_modality')),
         field_cell("Origem", rpa.get('origin')),
         field_cell("Destino", rpa.get('destination'))],
        [field_cell("CTE", rpa.get('cte')),
         field_cell("Peso", rpa.get('weight')),
         field_cell("Nº Container", rpa.get('container_number'))],
        [field_cell("Data Coleta", fmt_date_br(rpa.get('collection_date'))),
         field_cell("Data Entrega", fmt_date_br(rpa.get('delivery_date'))),
         field_cell("Cliente", rpa.get('client_name'))],
    ]
    serv_table = Table(serv_data, colWidths=[63 * mm, 63 * mm, 64 * mm])
    serv_table.setStyle(fields_grid_style)
    elements.append(serv_table)
    elements.append(Spacer(1, 2))

    # ===== DEMONSTRATIVO DOS SERVIÇOS PRESTADOS =====
    section_header("Demonstrativo dos Serviços Prestados")
    services = rpa.get('services') or []
    demo_header = [
        Paragraph("<font size='8'><b>Descrição</b></font>", styles['Normal']),
        Paragraph("<font size='8'><b>Valor</b></font>", styles['Normal']),
    ]
    demo_data = [demo_header]
    if not services:
        demo_data.append([Paragraph("<font size='9'>-</font>", styles['Normal']),
                          Paragraph(f"<font size='9'>{money(0)}</font>", styles['Normal'])])
    else:
        for s in services:
            demo_data.append([
                Paragraph(f"<font size='9'>{s.get('description') or '-'}</font>", styles['Normal']),
                Paragraph(f"<font size='9'>{money(s.get('value'))}</font>", styles['Normal']),
            ])
    demo_table = Table(demo_data, colWidths=[150 * mm, 40 * mm])
    demo_table.setStyle(TableStyle([
        ('LINEABOVE', (0, 0), (-1, 0), 0.5, RULE_COLOR),
        ('LINEBELOW', (0, 0), (-1, 0), 0.5, RULE_COLOR),
        ('LINEBELOW', (0, -1), (-1, -1), 0.5, RULE_COLOR),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(demo_table)
    elements.append(Spacer(1, 2))

    # ===== ESPECIFICAÇÃO DA REMUNERAÇÃO =====
    section_header("Especificação da Remuneração do Serviço")
    rem_data = [
        [field_cell("I. Valor do Serviço", money(rpa.get('service_value'))),
         field_cell("II. Diárias", money(rpa.get('daily_rate'))),
         field_cell("III. Abastecimento", money(rpa.get('fuel')))],
        [field_cell("IV. Adiantamento", money(rpa.get('advance'))),
         field_cell("VI. Outros", money(rpa.get('others'))),
         field_cell("Descontos", money(rpa.get('discounts')))],
    ]
    rem_table = Table(rem_data, colWidths=[63 * mm, 63 * mm, 64 * mm])
    rem_table.setStyle(fields_grid_style)
    elements.append(rem_table)
    elements.append(Spacer(1, 4))

    # ===== SALDO A RECEBER (destacado) =====
    saldo_para = Paragraph(
        f"<font size='13' color='#1A202C'><b>SALDO A RECEBER:</b></font>"
        f"<font size='14' color='#{PRIMARY_COLOR}'><b>&nbsp;&nbsp;{money(rpa['balance'])}</b></font>",
        ParagraphStyle('Saldo', parent=styles['Normal'], alignment=TA_CENTER)
    )
    saldo_table = Table([[saldo_para]], colWidths=[190 * mm])
    saldo_table.setStyle(TableStyle([
        ('LINEABOVE', (0, 0), (-1, -1), 1.2, RULE_COLOR),
        ('LINEBELOW', (0, 0), (-1, -1), 1.2, RULE_COLOR),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(saldo_table)
    elements.append(Spacer(1, 4))

    # ===== DADOS BANCÁRIOS =====
    section_header("Dados Bancários do Beneficiário")
    bank_data = [
        [field_cell("Beneficiário", rpa.get('bank_beneficiary')),
         field_cell("Nº Agência", rpa.get('bank_agency')),
         field_cell("Nº Conta", rpa.get('bank_account'))],
        [field_cell("Chave PIX", rpa.get('bank_pix')),
         Paragraph("", styles['Normal']),
         Paragraph("", styles['Normal'])],
    ]
    bank_table = Table(bank_data, colWidths=[80 * mm, 50 * mm, 60 * mm])
    bank_table.setStyle(fields_grid_style)
    elements.append(bank_table)
    elements.append(Spacer(1, 6))

    # ===== ASSINATURAS (estilo EIR: 2 colunas) =====
    sig_label_style = ParagraphStyle(
        'SigLabel', parent=styles['Normal'], fontSize=8, leading=10,
        alignment=TA_CENTER, fontName='Helvetica-Bold', textColor=VALUE_COLOR
    )
    sig_field_style = ParagraphStyle(
        'SigField', parent=styles['Normal'], fontSize=7, leading=9,
        alignment=TA_LEFT, fontName='Helvetica', textColor=LABEL_COLOR
    )

    sign_data = [
        [Paragraph("&nbsp;", styles['Normal']),
         Paragraph("&nbsp;", styles['Normal'])],
        [Paragraph("Assinatura do Motorista/Proprietário", sig_label_style),
         Paragraph("Local e Data", sig_label_style)],
        [Paragraph(
            f"<font size='7' color='#4A5568'>Nome:</font> <font size='8'><b>{rpa.get('driver_name') or '-'}</b></font><br/>"
            f"<font size='7' color='#4A5568'>CPF:</font> <font size='8'><b>{rpa.get('driver_cpf') or '-'}</b></font>",
            sig_field_style),
         Paragraph(
            f"<font size='7' color='#4A5568'>Data:</font> <font size='8'><b>{now_brt().strftime('%d/%m/%Y')}</b></font>",
            sig_field_style)],
    ]
    sign_table = Table(sign_data, colWidths=[95 * mm, 95 * mm], rowHeights=[18, None, None])
    sign_table.setStyle(TableStyle([
        ('LINEABOVE', (0, 1), (-1, 1), 0.5, RULE_COLOR),
        ('TOPPADDING', (0, 0), (-1, -1), 1),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 1),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    elements.append(sign_table)
    elements.append(Spacer(1, 4))

    # ===== DECLARAÇÃO =====
    decl_style = ParagraphStyle(
        'Decl', parent=styles['Normal'], fontSize=7, leading=9,
        alignment=TA_CENTER, fontName='Helvetica-Oblique', textColor=MUTED_COLOR
    )
    elements.append(Paragraph(
        f"Declaro para os devidos fins, que recebi da {company['name']} - CNPJ {company['cnpj']}, "
        "os valores descritos neste recibo referente aos serviços prestados por mim, sem mais nada a declarar.",
        decl_style
    ))
    elements.append(Spacer(1, 4))

    # ===== RODAPÉ (estilo EIR) =====
    footer_rule = Table([[""]], colWidths=[190 * mm], rowHeights=[0.5])
    footer_rule.setStyle(TableStyle([
        ('LINEBELOW', (0, 0), (-1, -1), 0.5, RULE_COLOR),
    ]))
    elements.append(footer_rule)
    elements.append(Spacer(1, 3))

    # Linha do ID + obs
    note_text = rpa.get('observations') or "Somente efetuar pagamento mediante comprovante de exportação e pesagem"
    footer_id_style = ParagraphStyle(
        'FooterId', parent=styles['Normal'], fontSize=8, leading=10,
        alignment=TA_LEFT, fontName='Helvetica-Bold', textColor=VALUE_COLOR
    )
    elements.append(Paragraph(f"#{rpa['rpa_number']}", footer_id_style))

    footer_meta_style = ParagraphStyle(
        'FooterMeta', parent=styles['Normal'], fontSize=7, leading=9,
        alignment=TA_LEFT, fontName='Helvetica', textColor=MUTED_COLOR
    )
    elements.append(Paragraph(
        f"Usuário: {rpa.get('created_by_name') or '-'}", footer_meta_style
    ))
    elements.append(Paragraph(
        f"Data e hora da impressão: {now_brt().strftime('%d/%m/%Y %H:%M')}", footer_meta_style
    ))
    elements.append(Spacer(1, 4))

    elements.append(Paragraph(
        f"<i>* {note_text}</i>",
        ParagraphStyle('Note', parent=styles['Normal'], fontSize=7, leading=9,
                       alignment=TA_LEFT, textColor=MUTED_COLOR)
    ))
    elements.append(Spacer(1, 3))

    elements.append(Paragraph(
        f"<b>{company['name']}</b> | Este documento é válido como recibo de pagamento",
        ParagraphStyle('FooterCo', parent=styles['Normal'], fontSize=7, leading=9,
                       alignment=TA_CENTER, textColor=MUTED_COLOR)
    ))

    doc.build(elements)
    pdf_bytes = buffer.getvalue()
    buffer.close()

    filename = f"RPA_{rpa['rpa_number']}_{(rpa.get('driver_name') or 'motorista').upper().replace(' ', '_')}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


