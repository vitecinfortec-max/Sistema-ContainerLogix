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
    ExpenseReportReceipt, ExpenseReportDeposit, ExpenseReportPurchase,
    ExpenseReport, ExpenseReportCreate, ExpenseReportResponse,
)
from auth import get_password_hash, verify_password, create_access_token, get_current_user, decode_token
from reports import (
    generate_pdf_report, generate_excel_report, generate_billing_pdf_report, generate_billing_excel,
    _build_pdf_header, _make_pdf_footer,
    now_brt, to_brt, merge_company, DEFAULT_COMPANY
)

from shared import (
    db, manager, get_current_active_user, get_current_admin_user, get_company_settings,
    get_next_transaction_id, parse_datetime_value, round_money, migrate_inspection_photos,
    load_logo_buffer, validate_and_read_upload, ALLOWED_EXTENSIONS, ALLOWED_RECEIPT_EXTENSIONS,
    MAX_FILE_SIZE, check_rate_limit, client_ip, UPLOADS_DIR, ROOT_DIR
)

api_router = APIRouter(prefix="/api")

# ==================== OPERACIONAL - PROGRAMAÇÃO DE CARREGAMENTO ====================

from models import LoadingSchedule, LoadingScheduleCreate, LoadingScheduleResponse, LoadingScheduleItem

@api_router.get("/loading-schedules")
async def get_loading_schedules(
    search: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    current_user: dict = Depends(get_current_active_user)
):
    """Lista todas as programações de carregamento"""
    query = {}
    
    if search:
        search_escaped = re.escape(search)
        query["$or"] = [
            {"destination_client_name": {"$regex": search_escaped, "$options": "i"}},
            {"contracting_client_name": {"$regex": search_escaped, "$options": "i"}},
            {"items.driver_name": {"$regex": search_escaped, "$options": "i"}},
            {"items.container_number": {"$regex": search_escaped, "$options": "i"}}
        ]
    
    if status:
        query["status"] = status
    
    total = await db.loading_schedules.count_documents(query)
    skip = (page - 1) * per_page
    
    cursor = db.loading_schedules.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page)
    schedules = await cursor.to_list(length=per_page)
    
    return {
        "items": schedules,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page
    }


@api_router.get("/loading-schedules/{schedule_id}", response_model=LoadingScheduleResponse)
async def get_loading_schedule(schedule_id: str, current_user: dict = Depends(get_current_active_user)):
    """Busca programação por ID"""
    schedule = await db.loading_schedules.find_one({"id": schedule_id}, {"_id": 0})
    if not schedule:
        raise HTTPException(status_code=404, detail="Programação não encontrada")
    return schedule


@api_router.post("/loading-schedules", response_model=LoadingScheduleResponse)
async def create_loading_schedule(data: LoadingScheduleCreate, current_user: dict = Depends(get_current_active_user)):
    """Cria nova programação de carregamento"""
    counter = await db.counters.find_one_and_update(
        {"_id": "loading_schedule_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    schedule_number = counter["seq"]
    
    schedule_data = {
        "id": str(uuid.uuid4()),
        "schedule_number": schedule_number,
        "destination_client_id": data.destination_client_id,
        "destination_client_name": data.destination_client_name,
        "contracting_client_id": data.contracting_client_id,
        "contracting_client_name": data.contracting_client_name,
        "booking": data.booking,
        "voyage": data.voyage,
        "items": [item.model_dump() for item in data.items],
        "status": "ATIVO",
        "observations": data.observations,
        "created_by": current_user["sub"],
        "created_by_name": current_user.get("name", "Sistema"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": None
    }
    
    await db.loading_schedules.insert_one(schedule_data)
    schedule_data.pop("_id", None)
    
    return schedule_data


@api_router.put("/loading-schedules/{schedule_id}", response_model=LoadingScheduleResponse)
async def update_loading_schedule(schedule_id: str, data: LoadingScheduleCreate, current_user: dict = Depends(get_current_active_user)):
    """Atualiza programação de carregamento"""
    schedule = await db.loading_schedules.find_one({"id": schedule_id})
    if not schedule:
        raise HTTPException(status_code=404, detail="Programação não encontrada")
    
    update_data = {
        "destination_client_id": data.destination_client_id,
        "destination_client_name": data.destination_client_name,
        "contracting_client_id": data.contracting_client_id,
        "contracting_client_name": data.contracting_client_name,
        "booking": data.booking,
        "voyage": data.voyage,
        "items": [item.model_dump() for item in data.items],
        "observations": data.observations,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }

    await db.loading_schedules.update_one({"id": schedule_id}, {"$set": update_data})
    updated = await db.loading_schedules.find_one({"id": schedule_id}, {"_id": 0})
    return updated


@api_router.delete("/loading-schedules/{schedule_id}")
async def delete_loading_schedule(schedule_id: str, current_user: dict = Depends(get_current_active_user)):
    """Exclui programação de carregamento"""
    schedule = await db.loading_schedules.find_one({"id": schedule_id})
    if not schedule:
        raise HTTPException(status_code=404, detail="Programação não encontrada")
    
    await db.loading_schedules.delete_one({"id": schedule_id})
    return {"message": "Programação excluída com sucesso"}


@api_router.put("/loading-schedules/{schedule_id}/update-status")
async def update_loading_schedule_status(schedule_id: str, new_status: str, current_user: dict = Depends(get_current_active_user)):
    """Atualiza status da programação"""
    if new_status not in ["ATIVO", "CONCLUIDO", "CANCELADO"]:
        raise HTTPException(status_code=400, detail="Status inválido")
    
    result = await db.loading_schedules.update_one(
        {"id": schedule_id},
        {"$set": {"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Programação não encontrada")
    
    return {"message": "Status atualizado"}


@api_router.get("/loading-schedules/{schedule_id}/pdf")
async def generate_loading_schedule_pdf(schedule_id: str, current_user: dict = Depends(get_current_active_user)):
    """Gera PDF da programação de carregamento - mesmo padrão visual dos
    demais documentos do sistema (cabeçalho, quadro de dados, tabela e rodapé)."""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    from reports import (
        _pdf_info_grid, _pdf_section_title, _pdf_header_cells, _pdf_cell_factory,
        _pdf_table_style, _pdf_note_box, _pdf_empty_state, _pdf_tone_markup,
    )

    schedule = await db.loading_schedules.find_one({"id": schedule_id}, {"_id": 0})
    if not schedule:
        raise HTTPException(status_code=404, detail="Programação não encontrada")

    company = merge_company(await get_company_settings())
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=12*mm,
        leftMargin=12*mm,
        topMargin=10*mm,
        bottomMargin=12*mm
    )
    # Largura útil real da página - todas as tabelas/quadros abaixo usam ela
    # pra alinhar exatamente com o cabeçalho padrão.
    CONTENT_WIDTH = doc.width

    elements = []
    styles = getSampleStyleSheet()

    logo_buffer = load_logo_buffer(company)
    elements.extend(_build_pdf_header(
        styles, logo_buffer, f"Programação de Carregamento Nº {schedule['schedule_number']}",
        company=company, content_width=CONTENT_WIDTH,
    ))

    # Converter para horário de Brasília (UTC-3)
    from zoneinfo import ZoneInfo
    created_at = parse_datetime_value(schedule['created_at'])
    created_at_brasilia = created_at.astimezone(ZoneInfo('America/Sao_Paulo'))
    date_str = created_at_brasilia.strftime('%d/%m/%Y')

    def short_name(full_name, fallback):
        """Primeiro + segundo nome, ignorando preposições (DE, DA, DOS...)."""
        if not full_name or full_name == '-':
            return fallback
        name_parts = full_name.strip().split()
        preposicoes = ['DE', 'DA', 'DO', 'DOS', 'DAS', 'E']
        nomes_filtrados = [p for p in name_parts if p.upper() not in preposicoes]
        if len(nomes_filtrados) >= 2:
            return f"{nomes_filtrados[0]} {nomes_filtrados[1]}"
        if len(nomes_filtrados) == 1:
            return nomes_filtrados[0]
        return ' '.join(name_parts[:2]) if name_parts else fallback

    # ========== DADOS DA PROGRAMAÇÃO ==========
    elements.append(_pdf_info_grid([
        ("Cliente Contratante", schedule['contracting_client_name'], 2),
        ("Criado em", date_str),
        ("Criado por", short_name(schedule.get('created_by_name'), 'Sistema')),
        ("Cliente Destino", schedule['destination_client_name'], 2),
        ("Booking", schedule.get('booking') or '-'),
        ("Viagem", schedule.get('voyage') or '-'),
    ], CONTENT_WIDTH, cols=4))

    # ========== ITENS DA PROGRAMAÇÃO ==========
    elements.extend(_pdf_section_title("Itens da programação", CONTENT_WIDTH))
    cell = _pdf_cell_factory(styles, font_size=8)
    has_bag_numbers = any((item.get('bag_number') or '').strip() for item in schedule['items'])
    table_header = ["#", "Tipo", "Motorista", "CPF", "Cavalo", "Carreta", "Local de Carreg.", "Data", "Container", "Lacre"]
    if has_bag_numbers:
        table_header.append("Nº da Bolsa")
    table_data = [_pdf_header_cells(table_header, font_size=8)]

    for idx, item in enumerate(schedule['items'], 1):
        loading_date = item.get('loading_date', '')
        if loading_date:
            try:
                dt = datetime.fromisoformat(loading_date.replace('Z', '+00:00'))
                loading_date = dt.strftime('%d/%m/%Y')
            except Exception:
                pass

        op_type = item.get('operation_type') or '-'
        row = [
            cell(idx, 'center'),
            cell(None, 'center', markup=_pdf_tone_markup(op_type, 'primary' if op_type == 'COLETA' else 'amber' if op_type == 'ENTREGA' else 'dark')),
            cell(short_name(item.get('driver_name', '-'), '-'), bold=True),
            cell(item.get('driver_cpf', '-') or '-'),
            cell(item.get('cavalo_plate', '-'), 'center'),
            cell(item.get('carreta_plate', '-') or '-', 'center'),
            cell(item.get('loading_location', '-') or '-'),
            cell(loading_date or '-', 'center'),
            cell(item.get('container_number', '-') or '-'),
            cell(item.get('seal_number', '-') or '-', 'center'),
        ]
        if has_bag_numbers:
            row.append(cell(item.get('bag_number') or '-', 'center'))
        table_data.append(row)

    # Larguras-base escaladas pra CONTENT_WIDTH (área útil real da página).
    if has_bag_numbers:
        base_widths = [20, 45, 95, 60, 50, 50, 110, 55, 70, 55, 90]
    else:
        base_widths = [20, 55, 100, 70, 55, 55, 130, 60, 90, 65]
    scale = CONTENT_WIDTH / sum(base_widths)
    col_widths = [w * scale for w in base_widths]

    if schedule['items']:
        main_table = Table(table_data, colWidths=col_widths, repeatRows=1)
        main_table.setStyle(TableStyle(_pdf_table_style() + [
            ('TOPPADDING', (0, 1), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 1), (-1, -1), 5),
        ]))
        elements.append(main_table)
    else:
        elements.append(_pdf_empty_state("Nenhum item nesta programação.", CONTENT_WIDTH))

    # ========== OBSERVAÇÕES (se houver) ==========
    if schedule.get('observations'):
        elements.append(Spacer(1, 10))
        elements.append(_pdf_note_box("Observações", schedule['observations'], CONTENT_WIDTH))

    footer = _make_pdf_footer(company['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    buffer.seek(0)

    filename = f"programacao_carregamento_{schedule['schedule_number']}.pdf"
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={filename}"})


