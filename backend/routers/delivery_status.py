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

# ==================== STATUS DE ENTREGA ENDPOINTS ====================

from models import DeliveryStatus, DeliveryStatusCreate, DeliveryStatusResponse, DeliveryStatusItem

@api_router.get("/delivery-status")
async def get_delivery_statuses(
    page: int = 1,
    per_page: int = 20,
    status: Optional[str] = None,
    schedule_number: Optional[int] = None,
    current_user: dict = Depends(get_current_active_user)
):
    """Lista todos os status de entrega com paginação e filtros"""
    query = {}
    if status:
        query["status"] = status
    if schedule_number:
        query["schedule_number"] = schedule_number
    
    total = await db.delivery_statuses.count_documents(query)
    skip = (page - 1) * per_page
    
    statuses = await db.delivery_statuses.find(query, {"_id": 0}).sort("status_number", -1).skip(skip).limit(per_page).to_list(per_page)
    
    return {
        "items": statuses,
        "total": total,
        "page": page,
        "pages": (total + per_page - 1) // per_page
    }

@api_router.get("/delivery-status/schedule/{schedule_number}")
async def get_schedule_for_delivery_status(schedule_number: int, current_user: dict = Depends(get_current_active_user)):
    """Busca uma programação de carregamento pelo número para criar um status de entrega"""
    schedule = await db.loading_schedules.find_one({"schedule_number": schedule_number}, {"_id": 0})
    if not schedule:
        raise HTTPException(status_code=404, detail="Programação não encontrada")
    return schedule

@api_router.get("/delivery-status/{status_id}", response_model=DeliveryStatusResponse)
async def get_delivery_status(status_id: str, current_user: dict = Depends(get_current_active_user)):
    """Busca um status de entrega pelo ID"""
    status = await db.delivery_statuses.find_one({"id": status_id}, {"_id": 0})
    if not status:
        raise HTTPException(status_code=404, detail="Status de entrega não encontrado")
    return status

def _compute_delivery_status(current_status: str, items: list) -> str:
    """Deriva ATIVO/CONCLUIDO automaticamente a partir de items[].delivery_completed
    (o horário "Entrega Final.") - CONCLUIDO assim que todo motorista já tiver
    esse horário preenchido, volta pra ATIVO se algum for apagado depois numa
    edição (nunca fica "preso" em CONCLUIDO por engano). CANCELADO nunca é
    tocado aqui - só muda de forma manual, via PUT .../update-status."""
    if current_status == 'CANCELADO':
        return current_status
    if items and all((it.get('delivery_completed') or '').strip() for it in items):
        return 'CONCLUIDO'
    return 'ATIVO'


async def _sync_loading_schedule_status(schedule_id: str, delivery_status: str) -> bool:
    """Espelha a conclusão do Status de Entrega na Programação de Carregamento
    que o originou (schedule_id) - fica CONCLUIDO quando o Status de Entrega
    também está, volta pra ATIVO se deixar de estar (mesma lógica de
    _compute_delivery_status, nunca um "trinco" só de ida). Um Status de
    Entrega CANCELADO não mexe na Programação (cancelar o acompanhamento não
    significa que o carregamento em si foi cancelado). Nunca mexe numa
    Programação CANCELADA manualmente. Retorna se algo foi de fato alterado
    (usado pelo reprocessamento em massa pra contar quantas mudaram)."""
    if delivery_status == 'CANCELADO':
        return False
    schedule = await db.loading_schedules.find_one({"id": schedule_id}, {"_id": 0, "status": 1})
    if not schedule or schedule.get("status") == "CANCELADO":
        return False
    new_status = "CONCLUIDO" if delivery_status == 'CONCLUIDO' else "ATIVO"
    if schedule.get("status") == new_status:
        return False
    await db.loading_schedules.update_one(
        {"id": schedule_id},
        {"$set": {"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return True


@api_router.post("/delivery-status/resync-schedules")
async def resync_delivery_status_schedules(current_user: dict = Depends(get_current_admin_user)):
    """Reprocessamento único (idempotente, pode rodar quantas vezes quiser):
    recalcula o status de todo Status de Entrega já existente e sincroniza a
    Programação de Carregamento que o originou. Necessário porque
    _compute_delivery_status/_sync_loading_schedule_status só passaram a
    rodar em create/update a partir desse deploy - um Status de Entrega que
    já estava com todos os horários preenchidos ANTES disso nunca dispara o
    recálculo sozinho até ser salvo de novo pela tela."""
    statuses = await db.delivery_statuses.find({}, {"_id": 0}).to_list(None)
    delivery_updated = 0
    schedules_updated = 0
    for doc in statuses:
        computed = _compute_delivery_status(doc.get("status", "ATIVO"), doc.get("items") or [])
        if computed != doc.get("status"):
            await db.delivery_statuses.update_one(
                {"id": doc["id"]},
                {"$set": {"status": computed, "updated_at": datetime.now(timezone.utc)}}
            )
            delivery_updated += 1
        if doc.get("schedule_id") and await _sync_loading_schedule_status(doc["schedule_id"], computed):
            schedules_updated += 1
    return {
        "delivery_statuses_checked": len(statuses),
        "delivery_statuses_updated": delivery_updated,
        "schedules_updated": schedules_updated,
    }


@api_router.post("/delivery-status", response_model=DeliveryStatusResponse)
async def create_delivery_status(data: DeliveryStatusCreate, current_user: dict = Depends(get_current_active_user)):
    """Cria um novo status de entrega baseado em uma programação"""
    # Buscar a programação de carregamento
    schedule = await db.loading_schedules.find_one({"schedule_number": data.schedule_number}, {"_id": 0})
    if not schedule:
        raise HTTPException(status_code=404, detail="Programação não encontrada")

    # Gerar próximo número sequencial de forma atômica (find_one+1 permitia duas
    # requisições concorrentes lerem o mesmo "último número" e gravarem duplicado)
    counter = await db.counters.find_one_and_update(
        {"_id": "status_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    next_number = counter["seq"]

    processed_items = [item.model_dump() if hasattr(item, 'model_dump') else item for item in data.items]
    computed_status = _compute_delivery_status('ATIVO', processed_items)

    # Criar o status com dados da programação
    status = DeliveryStatus(
        status_number=next_number,
        schedule_id=schedule["id"],
        schedule_number=schedule["schedule_number"],
        destination_client_name=schedule["destination_client_name"],
        contracting_client_name=schedule["contracting_client_name"],
        booking=schedule.get("booking"),
        voyage=schedule.get("voyage"),
        status_date=data.status_date,
        items=processed_items,
        observations=data.observations,
        status=computed_status,
        created_by=current_user["sub"],
        created_by_name=current_user["name"]
    )

    await db.delivery_statuses.insert_one(status.model_dump())
    await _sync_loading_schedule_status(schedule["id"], computed_status)

    result = await db.delivery_statuses.find_one({"id": status.id}, {"_id": 0})
    return result

@api_router.put("/delivery-status/{status_id}", response_model=DeliveryStatusResponse)
async def update_delivery_status(status_id: str, data: DeliveryStatusCreate, current_user: dict = Depends(get_current_active_user)):
    """Atualiza um status de entrega existente"""
    existing = await db.delivery_statuses.find_one({"id": status_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Status de entrega não encontrado")

    updated_items = [item.model_dump() for item in data.items]
    computed_status = _compute_delivery_status(existing.get("status", "ATIVO"), updated_items)
    update_data = {
        "status_date": data.status_date,
        "items": updated_items,
        "observations": data.observations,
        "status": computed_status,
        "updated_at": datetime.now(timezone.utc)
    }

    await db.delivery_statuses.update_one({"id": status_id}, {"$set": update_data})
    await _sync_loading_schedule_status(existing["schedule_id"], computed_status)

    result = await db.delivery_statuses.find_one({"id": status_id}, {"_id": 0})
    return result

@api_router.delete("/delivery-status/{status_id}")
async def delete_delivery_status(status_id: str, current_user: dict = Depends(get_current_active_user)):
    """Deleta um status de entrega"""
    result = await db.delivery_statuses.delete_one({"id": status_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Status de entrega não encontrado")
    return {"message": "Status de entrega deletado com sucesso"}

@api_router.put("/delivery-status/{status_id}/update-status")
async def update_delivery_status_status(status_id: str, new_status: str, current_user: dict = Depends(get_current_active_user)):
    """Atualiza o status (ATIVO, CONCLUIDO, CANCELADO)"""
    if new_status not in ["ATIVO", "CONCLUIDO", "CANCELADO"]:
        raise HTTPException(status_code=400, detail="Status inválido")
    
    result = await db.delivery_statuses.update_one(
        {"id": status_id},
        {"$set": {"status": new_status, "updated_at": datetime.now(timezone.utc)}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Status de entrega não encontrado")
    return {"message": "Status atualizado com sucesso"}

@api_router.get("/delivery-status/{status_id}/pdf")
async def generate_delivery_status_pdf(status_id: str, current_user: dict = Depends(get_current_active_user)):
    """Gera PDF do status de entrega - mesmo padrão visual dos demais
    documentos do sistema (cabeçalho, quadro de dados, tabela e rodapé)."""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    from reports import (
        _pdf_info_grid, _pdf_section_title, _pdf_header_cells, _pdf_cell_factory,
        _pdf_table_style, _pdf_note_box, _pdf_empty_state,
    )

    delivery_status = await db.delivery_statuses.find_one({"id": status_id}, {"_id": 0})
    if not delivery_status:
        raise HTTPException(status_code=404, detail="Status de entrega não encontrado")

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
        styles, logo_buffer, f"Status de Entrega Nº {delivery_status['status_number']}",
        company=company, content_width=CONTENT_WIDTH,
    ))

    # Converter para horário de Brasília
    from zoneinfo import ZoneInfo
    created_at = parse_datetime_value(delivery_status['created_at'])
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

    status_date_value = delivery_status.get('status_date', '')
    if status_date_value:
        try:
            dt = datetime.fromisoformat(status_date_value.replace('Z', '+00:00'))
            status_date_value = dt.strftime('%d/%m/%Y')
        except Exception:
            pass

    # ========== DADOS DA PROGRAMAÇÃO ==========
    elements.append(_pdf_info_grid([
        ("Programação Ref.", f"Nº {delivery_status['schedule_number']}"),
        ("Data do Status", status_date_value or '-'),
        ("Criado em", date_str),
        ("Criado por", short_name(delivery_status.get('created_by_name'), 'Sistema')),
        ("Cliente Contratante", delivery_status['contracting_client_name'], 2),
        ("Cliente Destino", delivery_status['destination_client_name'], 2),
        ("Booking", delivery_status.get('booking') or '-'),
        ("Viagem", delivery_status.get('voyage') or '-'),
    ], CONTENT_WIDTH, cols=4))

    # ========== STATUS POR MOTORISTA ==========
    elements.extend(_pdf_section_title("Status de entrega por motorista", CONTENT_WIDTH))
    cell = _pdf_cell_factory(styles, font_size=7.5)
    has_bag_numbers = any((item.get('bag_number') or '').strip() for item in delivery_status['items'])
    table_header = ["#", "Motorista", "CPF", "Cavalo", "Container", "Local", "Chegada", "Início", "Término", "Saída", "Agend.", "Entrega"]
    if has_bag_numbers:
        table_header.append("Nº da Bolsa")
    table_data = [_pdf_header_cells(table_header, font_size=7.5)]

    for idx, item in enumerate(delivery_status['items'], 1):
        row = [
            cell(idx, 'center'),
            cell(short_name(item.get('driver_name', '-'), '-'), bold=True),
            cell(item.get('driver_cpf', '-') or '-'),
            cell(item.get('cavalo_plate', '-') or '-', 'center'),
            cell(item.get('container_number', '-') or '-'),
            cell(item.get('loading_location', '-') or '-'),
            cell(item.get('arrival_time', '-') or '-', 'center'),
            cell(item.get('loading_start_time', '-') or '-', 'center'),
            cell(item.get('loading_end_time', '-') or '-', 'center'),
            cell(item.get('departure_time', '-') or '-', 'center'),
            cell(item.get('port_schedule_time', '-') or '-', 'center'),
            cell(item.get('delivery_completed', '-') or '-', 'center'),
        ]
        if has_bag_numbers:
            row.append(cell(item.get('bag_number') or '-', 'center'))
        table_data.append(row)

    # Larguras-base escaladas pra CONTENT_WIDTH; LOCAL mais larga (e as 6
    # colunas de horário, que só têm "HH:MM", mais estreitas) reduz quantas
    # linhas o nome do local quebra - cada linha a menos evita transbordar pra
    # uma 2ª página com poucos motoristas na lista.
    if has_bag_numbers:
        base_widths = [20, 65, 60, 40, 65, 85, 48, 48, 48, 48, 48, 50, 80]
    else:
        base_widths = [20, 85, 70, 50, 80, 115, 47, 47, 47, 47, 47, 50]
    scale = CONTENT_WIDTH / sum(base_widths)
    col_widths = [w * scale for w in base_widths]

    if delivery_status['items']:
        data_table = Table(table_data, colWidths=col_widths, repeatRows=1)
        data_table.setStyle(TableStyle(_pdf_table_style()))
        elements.append(data_table)
    else:
        elements.append(_pdf_empty_state("Nenhum motorista neste status de entrega.", CONTENT_WIDTH))

    # ========== OBSERVAÇÕES ==========
    # Caixa única (título + texto no mesmo flowable) - nunca fica um título
    # órfão numa página e o texto na seguinte.
    if delivery_status.get('observations'):
        elements.append(Spacer(1, 10))
        elements.append(_pdf_note_box("Observações", delivery_status['observations'], CONTENT_WIDTH))

    footer = _make_pdf_footer(company['name'])
    doc.build(elements, onFirstPage=footer, onLaterPages=footer)
    buffer.seek(0)

    filename = f"status_entrega_{delivery_status['status_number']}.pdf"
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={filename}"})


@api_router.get("/delivery-status/{status_id}/excel")
async def download_delivery_status_excel(status_id: str, current_user: dict = Depends(get_current_active_user)):
    """Gera Excel (XLS) do status de entrega"""
    from reports import generate_delivery_status_excel

    delivery_status = await db.delivery_statuses.find_one({"id": status_id}, {"_id": 0})
    if not delivery_status:
        raise HTTPException(status_code=404, detail="Status de entrega não encontrado")

    company = await get_company_settings()
    excel_bytes = generate_delivery_status_excel(delivery_status, company=company)

    filename = f"status_entrega_{delivery_status['status_number']}.xlsx"
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )



