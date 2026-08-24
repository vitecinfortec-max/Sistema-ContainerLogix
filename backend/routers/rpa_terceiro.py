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
    RPAServiceItem, RPACargoItem, RPATerceiro, RPATerceiroCreate, RPATerceiroUpdate, RPATerceiroResponse,
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

# ==================== CONTRATO DE FRETE (nome técnico legado: RPA TERCEIRO) ====================
from models import RPATerceiro, RPATerceiroCreate, RPATerceiroUpdate, RPATerceiroResponse, RPAServiceItem, RPACargoItem


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


# 14 cláusulas do Contrato de Afretamento, com base no Dec. 89874/84 - texto
# padrão de mercado (mesmo usado pelo Bsoft TMS, referência fornecida pelo
# usuário em 2026-08-24), adaptado para não citar dados específicos de um
# cliente (seguradora, comarca) já que o sistema é revendido white-label -
# ver [[project-menu-checklist-rework]] na memória sobre a limpeza de marca.
CONTRATO_FRETE_CLAUSES = [
    "Através do presente instrumento de transporte, declara o Transportador que recebeu e se responsabiliza a transportar as mercadorias constantes das Notas Fiscais descritas no CTRC caracterizado abaixo, bem como entregá-las no tempo e lugar convencionados.",
    "O CONTRATADO, sendo pessoa física, está sendo contratado na qualidade de transportador autônomo, sem qualquer vínculo empregatício, devendo responder pelo recolhimento de suas contribuições previdenciárias e fiscais, estando livre, após o cumprimento deste contrato, para prestar serviços a outras empresas.",
    "Em caso de acidente com veículo e caso seja vítima de furto ou roubo, deverá o CONTRATADO comunicar o fato imediatamente à seguradora responsável, relatando detalhadamente o evento e registrando ocorrência na delegacia mais próxima, providenciando uma cópia do respectivo Boletim de Ocorrência.",
    "Somente será permitida a troca de veículo, para entrega da mercadoria no destino, em caso de pane mecânica do veículo contratado e mediante autorização da CONTRATANTE e do cliente.",
    "O prazo inicial da responsabilidade do transportador começa a fluir desde o recebimento da mercadoria para transporte e cessa com a efetiva entrega ao destinatário, mediante comprovante de entrega das mercadorias, ficando vedado ao Transportador efetivar, após a consulta de Gerenciamento de Risco e do recebimento das mercadorias, troca de condutores do veículo de transporte das mercadorias sem que haja prévio e expresso consentimento do Contratante, sob pena de caracterizar infração contratual, sujeitando o Transportador nas condições descritas na Cláusula 10 deste contrato.",
    "Fica vedado ao Transportador aceitar variação de consignação, ou seja, alteração do destinatário, inclusive de via de encaminhamento e do destino.",
    "No caso de perdas, furtos ou avarias nas mercadorias transportadas, o Transportador será responsabilizado desde o momento em que recebeu as mercadorias até a sua efetiva entrega.",
    "É de responsabilidade exclusiva do Transportador verificar, no momento em que receber as mercadorias, a ocorrência de defeito na embalagem do produto ou qualquer outra condição que possa acarretar perdas ou avarias das mercadorias transportadas.",
    "Resta estabelecido que a indenização ou liquidação do prejuízo decorrente de perdas, furtos ou avarias das mercadorias transportadas, deverá observar o preço constante no CTRC de embarque do produto. Não havendo o preço neste, aplicar-se-á o preço de mercado do produto. No caso em que a mercadoria tenha apenas o seu valor diminuído pela avaria ou dano, o apuramento do prejuízo levará em consideração a diminuição de seu valor.",
    "O prazo de entrega das mercadorias em seu destino é o constante neste documento, sendo que no caso de inadimplência de data de entrega, fica estabelecido que a responsabilidade pelo atraso na entrega deverá ser suportada exclusivamente pelo transportador.",
    "No caso de descumprimento de formalidades fiscais no curso da viagem ocasionados pelo Transportador, fica estabelecido que os danos por tal razão, tais como atraso na entrega, perecimento da mercadoria, multas, etc. serão de responsabilidade exclusiva deste.",
    "O Transportador fica responsabilizado a seguir o itinerário que for ajustado, caso determinado. Não obedecendo, responderá o Transportador pelos riscos, inclusive os que caberiam ao remetente.",
    "Será de responsabilidade do Contratado a realização do Seguro de Responsabilidade Civil, destinado à reparação dos danos causados a pessoas em decorrência de acidentes que porventura se envolvam os veículos.",
    "As partes elegem o foro da comarca da CONTRATANTE para dirimir eventuais dúvidas ou controvérsias oriundas deste contrato. E por estarem plenamente de acordo com as condições acima especificadas as partes assinam o presente contrato em 5 vias de igual teor e forma, tendo cada via a seguinte destinação: 1ª Arquivo da Contratante / 2ª Comprovante de receita de Contratado / 3ª Contabilidade do Contratante / 4ª Arquivo da Contratante (recibo de saldo) / 5ª Arquivo da Contratante (recibo de adiantamento).",
]

CONTRATO_FRETE_VIAS = [
    (1, "Arquivo da Contratante"),
    (2, "Comprovante de receita de Contratado"),
    (3, "Contabilidade"),
    (4, "Saldo"),
    (5, "Adiantamento"),
]


@api_router.get("/rpa-terceiro/{rpa_id}/pdf")
async def download_rpa_terceiro_pdf(rpa_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Gera o PDF do Contrato de Frete (Contrato de Afretamento, Dec. 89874/84) em 5 vias."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak
    from reports import download_logo, PRIMARY_COLOR

    rpa = await db.rpa_terceiro.find_one({"id": rpa_id}, {"_id": 0})
    if not rpa:
        raise HTTPException(status_code=404, detail="RPA não encontrado")

    rpa['balance'] = _rpa_calc_balance(rpa)
    company = merge_company(await get_company_settings())

    contratado = None
    if rpa.get('contratado_id'):
        contratado = await db.transport_companies.find_one({"id": rpa['contratado_id']}, {"_id": 0})

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=9 * mm, rightMargin=9 * mm,
        topMargin=6 * mm, bottomMargin=6 * mm
    )

    styles = getSampleStyleSheet()
    PRIMARY = colors.HexColor(f'#{PRIMARY_COLOR}')
    RULE_COLOR = colors.HexColor('#2D3748')
    VALUE_COLOR = colors.HexColor('#1A202C')
    MUTED_COLOR = colors.HexColor('#718096')
    CONTENT_WIDTH = 192 * mm

    def money(v):
        try:
            return f"R$ {float(v or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        except Exception:
            return "R$ 0,00"

    def num(v, suffix=""):
        if v is None or v == "":
            return "-"
        try:
            return f"{float(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") + suffix
        except Exception:
            return f"{v}{suffix}"

    def fmt_date_br(iso_str):
        if not iso_str:
            return "-"
        try:
            return datetime.fromisoformat(str(iso_str).replace('Z', '+00:00')).strftime('%d/%m/%Y')
        except Exception:
            return str(iso_str)

    def field_cell(label, val, size=7, val_size=8):
        return Paragraph(
            f"<font color='#4A5568' size='{size}'>{label}</font><br/>"
            f"<font color='#1A202C' size='{val_size}'><b>{val if val not in (None, '') else '-'}</b></font>",
            ParagraphStyle('Cell', parent=styles['Normal'], leading=val_size + 2)
        )

    def box(title, rows, col_widths, spans=None):
        """Caixa com título de seção (fundo cinza) + grid de campos label/valor.
        `spans` é uma lista opcional de (row, col_start, col_end) pra mesclar
        células de uma linha (ex: um campo que ocupa a largura toda)."""
        elems = []
        title_bar = Table([[Paragraph(f"<b>{title}</b>", ParagraphStyle('BoxTitle', parent=styles['Normal'], fontSize=8, textColor=colors.white))]], colWidths=[CONTENT_WIDTH])
        title_bar.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), RULE_COLOR),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ]))
        elems.append(title_bar)
        grid = Table(rows, colWidths=col_widths)
        style_cmds = [
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E0')),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
            ('RIGHTPADDING', (0, 0), (-1, -1), 5),
            ('TOPPADDING', (0, 0), (-1, -1), 2),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ]
        for row, col_start, col_end in (spans or []):
            style_cmds.append(('SPAN', (col_start, row), (col_end, row)))
        grid.setStyle(TableStyle(style_cmds))
        elems.append(grid)
        return elems

    def build_via(via_num, via_label):
        elements = []

        # ===== CABEÇALHO =====
        logo_buffer = download_logo(company)
        header_left = []
        if logo_buffer:
            img = Image(logo_buffer, width=14 * mm, height=14 * mm)
            header_left.append(img)
        company_block = Paragraph(
            f"<font size='11'><b>{company['name']}</b></font><br/>"
            f"<font size='7'>{(company.get('address') or '').replace(chr(10), ', ')}</font><br/>"
            f"<font size='7'>Fone: {company.get('phone') or '-'} | CNPJ: {company.get('cnpj') or '-'}</font><br/>"
            f"<font size='7'>{company.get('email') or ''}</font>",
            ParagraphStyle('CompanyBlock', parent=styles['Normal'], alignment=TA_LEFT, leading=9)
        )
        header_right = Paragraph(
            f"<font size='9'><b>Nº {rpa['rpa_number']}</b></font><br/>"
            f"<font size='7'>Emissão: {fmt_date_br(rpa.get('emission_date')) if rpa.get('emission_date') else now_brt().strftime('%d/%m/%Y')}</font>",
            ParagraphStyle('HeaderRight', parent=styles['Normal'], alignment=TA_RIGHT, leading=9)
        )
        header_table = Table([[header_left if header_left else "", company_block, header_right]], colWidths=[16 * mm, 136 * mm, 40 * mm])
        header_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ]))
        elements.append(header_table)
        elements.append(Spacer(1, 3))

        title_style = ParagraphStyle(
            'DocTitle', parent=styles['Normal'], fontSize=10, leading=12,
            alignment=TA_CENTER, fontName='Helvetica-Bold', textColor=PRIMARY
        )
        elements.append(Paragraph(
            f"CONTRATO DE AFRETAMENTO &nbsp;-&nbsp; {via_num}ª Via &nbsp;-&nbsp; {via_label}",
            title_style
        ))
        elements.append(Spacer(1, 4))

        # ===== CONTRATADO =====
        contratado_name = rpa.get('contratado_name') or (contratado or {}).get('name')
        contratado_cnpj = (contratado or {}).get('cnpj')
        elements += box("Contratado", [
            [field_cell("Nome/CNPJ", f"{contratado_name or '-'}{(' / ' + contratado_cnpj) if contratado_cnpj else ''}"),
             field_cell("Talão", rpa.get('talao'))],
        ], [130 * mm, 62 * mm])
        elements.append(Spacer(1, 3))

        # ===== MOTORISTA / VEÍCULOS =====
        placas = " / ".join(filter(None, [
            f"Principal: {rpa['truck_plate']}" if rpa.get('truck_plate') else None,
            f"Vinculado 01: {rpa['trailer_plate']}" if rpa.get('trailer_plate') else None,
            f"Vinculado 02: {rpa['trailer2_plate']}" if rpa.get('trailer2_plate') else None,
        ])) or "-"
        elements += box("Motorista", [
            [field_cell("Nome/CPF", f"{rpa.get('driver_name') or '-'} / {rpa.get('driver_cpf') or '-'}"),
             field_cell("Telefone", rpa.get('driver_phone'))],
            [field_cell("Placas", placas), ""],
        ], [130 * mm, 62 * mm], spans=[(1, 0, 1)])
        elements.append(Spacer(1, 4))

        # ===== TEXTO INTRODUTÓRIO + CLÁUSULAS =====
        clause_style = ParagraphStyle(
            'Clause', parent=styles['Normal'], fontSize=6.3, leading=7.6,
            alignment=TA_JUSTIFY, textColor=VALUE_COLOR, spaceAfter=1.5
        )
        elements.append(Paragraph(
            "As partes acima identificadas contratam com base no Dec. 89874, de 28/06/84, o serviço de transporte "
            "nas seguintes condições:", clause_style
        ))
        for idx, clause in enumerate(CONTRATO_FRETE_CLAUSES, start=1):
            elements.append(Paragraph(f"{idx} - {clause}", clause_style))
        elements.append(Spacer(1, 4))

        # ===== DADOS DO TRANSPORTE =====
        elements += box("Dados do Transporte", [
            [field_cell("Local Coleta", rpa.get('origin')),
             field_cell("Local Entrega", rpa.get('destination')),
             field_cell("Prazo Entrega", fmt_date_br(rpa.get('delivery_date')))],
            [field_cell("Data Inicial da Viagem", fmt_date_br(rpa.get('trip_start_date'))),
             field_cell("Data Final da Viagem", fmt_date_br(rpa.get('trip_end_date'))),
             field_cell("Forma de Pagamento", rpa.get('payment_method'))],
        ], [64 * mm, 64 * mm, 64 * mm])
        elements.append(Spacer(1, 3))

        # ===== DADOS DA CARGA =====
        cargo_items = rpa.get('cargo_items') or []
        cargo_header = [Paragraph(f"<font size='6.5'><b>{h}</b></font>", styles['Normal']) for h in
                         ["Nro NF", "Natureza", "Espécie", "Qtd.", "Kg", "M³", "Valor"]]
        cargo_data = [cargo_header]
        if not cargo_items:
            cargo_data.append([Paragraph("<font size='7'>-</font>", styles['Normal'])] * 7)
        else:
            for c in cargo_items:
                cargo_data.append([
                    Paragraph(f"<font size='7'>{c.get('nf_number') or '-'}</font>", styles['Normal']),
                    Paragraph(f"<font size='7'>{c.get('nature') or '-'}</font>", styles['Normal']),
                    Paragraph(f"<font size='7'>{c.get('species') or '-'}</font>", styles['Normal']),
                    Paragraph(f"<font size='7'>{c.get('quantity') or '-'}</font>", styles['Normal']),
                    Paragraph(f"<font size='7'>{num(c.get('weight_kg'))}</font>", styles['Normal']),
                    Paragraph(f"<font size='7'>{num(c.get('cubage_m3'))}</font>", styles['Normal']),
                    Paragraph(f"<font size='7'>{money(c.get('value'))}</font>", styles['Normal']),
                ])
        cargo_table = Table(cargo_data, colWidths=[28 * mm, 46 * mm, 28 * mm, 18 * mm, 22 * mm, 20 * mm, 30 * mm])
        cargo_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#EDF2F7')),
            ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#CBD5E0')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 2), ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
            ('LEFTPADDING', (0, 0), (-1, -1), 3), ('RIGHTPADDING', (0, 0), (-1, -1), 3),
        ]))
        elements.append(Paragraph("<b><font size='8'>Dados da Carga</font></b>", ParagraphStyle('T', parent=styles['Normal'], spaceAfter=2)))
        elements.append(cargo_table)
        elements.append(Spacer(1, 2))
        elements.append(Paragraph(
            f"<font size='7'><b>Relação de Documentos:</b> {rpa.get('documents_list') or '-'}</font>",
            ParagraphStyle('Docs', parent=styles['Normal'], leading=9)
        ))
        elements.append(Spacer(1, 4))

        # ===== VALORES =====
        val_rows = [
            [field_cell("Frete", money(rpa.get('service_value')), val_size=9),
             field_cell("(-) Adiantamento", money(rpa.get('advance'))),
             field_cell("(-) Desconto INSS", (num(rpa.get('inss_discount_percent'), '%') if rpa.get('inss_discount_percent') is not None else '-'))],
            [field_cell("(-) IRRF", money(rpa.get('irrf_discount'))),
             field_cell("(-) Outros Descontos", money(rpa.get('other_discounts'))),
             field_cell("(-) SEST/SENAT", (num(rpa.get('sest_senat_discount_percent'), '%') if rpa.get('sest_senat_discount_percent') is not None else '-'))],
            [field_cell("(+) Diária", money(rpa.get('daily_rate'))),
             field_cell("(+) Pedágio", money(rpa.get('toll_value'))),
             field_cell("(+) Outros Acréscimos", money(rpa.get('others')))],
            [field_cell("Frete Líquido", money(rpa.get('net_freight')), val_size=9),
             field_cell("Saldo", money(rpa['balance']), val_size=9),
             field_cell("Combustível", money(rpa.get('fuel')))],
        ]
        elements += box("Valores", val_rows, [64 * mm, 64 * mm, 64 * mm])
        elements.append(Spacer(1, 3))

        # ===== COMPOSIÇÃO DO FRETE =====
        elements += box("Composição do Frete", [
            [field_cell("Peso de Coleta", num(rpa.get('collection_weight'), ' Kg')),
             field_cell("Peso de Chegada", num(rpa.get('arrival_weight'), ' Kg')),
             field_cell("(-) Seguro", money(rpa.get('insurance_discount')))],
        ], [64 * mm, 64 * mm, 64 * mm])
        elements.append(Spacer(1, 3))

        if rpa.get('observations'):
            elements.append(Paragraph(
                f"<font size='7'><b>Observações/Instruções de Transporte:</b> {rpa['observations']}</font>",
                ParagraphStyle('Obs', parent=styles['Normal'], leading=9)
            ))
            elements.append(Spacer(1, 4))

        # ===== ASSINATURAS =====
        sig_label_style = ParagraphStyle('SigLabel', parent=styles['Normal'], fontSize=7.5, alignment=TA_CENTER, fontName='Helvetica-Bold', textColor=VALUE_COLOR)
        sign_data = [
            [Paragraph("&nbsp;", styles['Normal']), Paragraph("&nbsp;", styles['Normal'])],
            [Paragraph("Contratante", sig_label_style), Paragraph(f"Motorista: {rpa.get('driver_name') or '-'}", sig_label_style)],
        ]
        sign_table = Table(sign_data, colWidths=[96 * mm, 96 * mm], rowHeights=[16, None])
        sign_table.setStyle(TableStyle([
            ('LINEABOVE', (0, 1), (-1, 1), 0.5, RULE_COLOR),
            ('TOPPADDING', (0, 0), (-1, -1), 1), ('BOTTOMPADDING', (0, 0), (-1, -1), 1),
        ]))
        elements.append(sign_table)
        elements.append(Spacer(1, 3))

        footer_meta_style = ParagraphStyle('FooterMeta', parent=styles['Normal'], fontSize=6.5, leading=8, alignment=TA_LEFT, textColor=MUTED_COLOR)
        elements.append(Paragraph(
            f"Manifestador: {rpa.get('created_by_name') or '-'} &nbsp;|&nbsp; Impresso em: {now_brt().strftime('%d/%m/%Y %H:%M')} "
            f"&nbsp;|&nbsp; Página {via_num} de 5",
            footer_meta_style
        ))

        return elements

    all_elements = []
    for i, (via_num, via_label) in enumerate(CONTRATO_FRETE_VIAS):
        if i > 0:
            all_elements.append(PageBreak())
        all_elements += build_via(via_num, via_label)

    doc.build(all_elements)
    pdf_bytes = buffer.getvalue()
    buffer.close()

    filename = f"ContratoFrete_{rpa['rpa_number']}_{(rpa.get('driver_name') or 'motorista').upper().replace(' ', '_')}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


