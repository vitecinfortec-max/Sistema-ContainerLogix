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

# ==================== INVOICES (FATURAS) ====================

# Função para obter próximo invoice_number (sequencial)
async def get_next_invoice_number():
    """Obtém o próximo invoice_number usando um contador atômico"""
    result = await db.counters.find_one_and_update(
        {"_id": "invoice_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    return result["seq"]

# Função para registrar histórico de alterações
async def log_invoice_history(invoice_id: str, invoice_number: int, action: str, changes: dict, user_id: str, user_name: str):
    """Registra uma alteração no histórico da fatura"""
    history = InvoiceHistory(
        invoice_id=invoice_id,
        invoice_number=invoice_number,
        action=action,
        changes=changes,
        user_id=user_id,
        user_name=user_name
    )
    doc = history.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.invoice_history.insert_one(doc)

@api_router.post("/invoices", response_model=InvoiceResponse)
async def create_invoice(
    invoice_input: InvoiceCreate,
    current_user: dict = Depends(get_current_admin_user)
):
    """Cria uma nova fatura a partir das movimentações selecionadas"""
    
    # Verificar se há movimentações
    if not invoice_input.movement_ids:
        raise HTTPException(status_code=400, detail="Selecione pelo menos uma movimentação")
    
    # Buscar movimentações pelos IDs
    movements = await db.movements.find(
        {"id": {"$in": invoice_input.movement_ids}},
        {"_id": 0}
    ).to_list(None)
    
    if not movements:
        raise HTTPException(status_code=404, detail="Nenhuma movimentação encontrada")
    
    # Verificar se alguma movimentação já foi faturada
    already_billed = [m for m in movements if m.get('billed', False)]
    if already_billed:
        billed_ids = [str(m.get('transaction_id', m['id'])) for m in already_billed]
        raise HTTPException(
            status_code=400, 
            detail=f"As seguintes movimentações já foram faturadas: {', '.join(billed_ids)}"
        )
    
    # Calcular valor total (arredondado para 2 casas decimais)
    total_value = round_money(sum(m.get('service_value', 0) or 0 for m in movements))
    
    # Obter próximo número de fatura
    invoice_number = await get_next_invoice_number()
    
    # Criar a fatura
    invoice = Invoice(
        invoice_number=invoice_number,
        client_name=invoice_input.client_name,
        client_cnpj=invoice_input.client_cnpj,
        movement_ids=invoice_input.movement_ids,
        total_value=total_value,
        notes=invoice_input.notes,
        created_by=current_user['sub'],
        user_name=current_user['name']
    )
    
    doc = invoice.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.invoices.insert_one(doc)
    
    # Marcar movimentações como faturadas
    billed_at = datetime.now(timezone.utc).isoformat()
    await db.movements.update_many(
        {"id": {"$in": invoice_input.movement_ids}},
        {"$set": {"billed": True, "billed_at": billed_at, "invoice_id": invoice.id}}
    )
    
    # Registrar no histórico
    await log_invoice_history(
        invoice_id=invoice.id,
        invoice_number=invoice.invoice_number,
        action="CREATED",
        changes={
            "client_name": invoice.client_name,
            "client_cnpj": invoice.client_cnpj,
            "total_value": total_value,
            "movements_count": len(invoice_input.movement_ids),
            "movement_ids": invoice_input.movement_ids
        },
        user_id=current_user['sub'],
        user_name=current_user['name']
    )
    
    return InvoiceResponse(
        id=invoice.id,
        invoice_number=invoice.invoice_number,
        client_name=invoice.client_name,
        client_cnpj=invoice.client_cnpj,
        movement_ids=invoice.movement_ids,
        total_value=invoice.total_value,
        notes=invoice.notes,
        created_at=invoice.created_at,
        user_name=invoice.user_name
    )

@api_router.get("/invoices", response_model=List[InvoiceResponse])
async def get_invoices(
    page: int = 1,
    per_page: int = 15,
    client_name: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    """Lista todas as faturas com paginação"""
    query = {}
    if client_name:
        query['client_name'] = {"$regex": re.escape(client_name), "$options": "i"}
    
    skip = (page - 1) * per_page
    
    invoices = await db.invoices.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page).to_list(per_page)
    
    return [
        InvoiceResponse(
            id=inv['id'],
            invoice_number=inv['invoice_number'],
            client_name=inv['client_name'],
            client_cnpj=inv.get('client_cnpj'),
            movement_ids=inv['movement_ids'],
            total_value=inv['total_value'],
            notes=inv.get('notes'),
            created_at=datetime.fromisoformat(inv['created_at']),
            user_name=inv['user_name']
        )
        for inv in invoices
    ]

@api_router.get("/invoices/count")
async def get_invoices_count(
    client_name: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    """Retorna a contagem total de faturas"""
    query = {}
    if client_name:
        query['client_name'] = {"$regex": re.escape(client_name), "$options": "i"}
    
    count = await db.invoices.count_documents(query)
    return {"count": count}

@api_router.get("/invoices/{invoice_id}", response_model=InvoiceResponse)
async def get_invoice(invoice_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Busca uma fatura específica por ID"""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Fatura não encontrada")
    
    return InvoiceResponse(
        id=invoice['id'],
        invoice_number=invoice['invoice_number'],
        client_name=invoice['client_name'],
        client_cnpj=invoice.get('client_cnpj'),
        movement_ids=invoice['movement_ids'],
        total_value=invoice['total_value'],
        notes=invoice.get('notes'),
        created_at=datetime.fromisoformat(invoice['created_at']),
        user_name=invoice['user_name']
    )

@api_router.put("/invoices/{invoice_id}", response_model=InvoiceResponse)
async def update_invoice(invoice_id: str, invoice_update: InvoiceUpdate, current_user: dict = Depends(get_current_admin_user)):
    """Atualiza uma fatura existente (dados e movimentações)"""
    # Buscar fatura existente
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Fatura não encontrada")
    
    # Preparar dados para atualização e rastrear mudanças
    update_data = {}
    changes = {}
    
    # Atualizar campos básicos se fornecidos
    if invoice_update.client_name is not None and invoice_update.client_name != invoice.get('client_name'):
        changes['client_name'] = {'from': invoice.get('client_name'), 'to': invoice_update.client_name}
        update_data['client_name'] = invoice_update.client_name
    if invoice_update.client_cnpj is not None and invoice_update.client_cnpj != invoice.get('client_cnpj'):
        changes['client_cnpj'] = {'from': invoice.get('client_cnpj'), 'to': invoice_update.client_cnpj}
        update_data['client_cnpj'] = invoice_update.client_cnpj
    if invoice_update.notes is not None and invoice_update.notes != invoice.get('notes'):
        changes['notes'] = {'from': invoice.get('notes'), 'to': invoice_update.notes}
        update_data['notes'] = invoice_update.notes
    
    # Processar movimentações
    current_movement_ids = set(invoice['movement_ids'])
    
    # Remover movimentações
    if invoice_update.movement_ids_to_remove:
        for mov_id in invoice_update.movement_ids_to_remove:
            current_movement_ids.discard(mov_id)
        # Desmarcar movimentações como faturadas
        await db.movements.update_many(
            {"id": {"$in": invoice_update.movement_ids_to_remove}},
            {"$set": {"billed": False, "billed_at": None, "invoice_id": None}}
        )
        changes['movements_removed'] = invoice_update.movement_ids_to_remove
    
    # Adicionar movimentações
    if invoice_update.movement_ids_to_add:
        # Verificar se as movimentações existem e não estão faturadas
        movements_to_add = await db.movements.find(
            {"id": {"$in": invoice_update.movement_ids_to_add}},
            {"_id": 0, "id": 1, "billed": 1, "service_value": 1}
        ).to_list(None)
        
        for mov in movements_to_add:
            if mov.get('billed', False):
                raise HTTPException(
                    status_code=400,
                    detail=f"Movimentação {mov['id']} já está faturada em outra fatura"
                )
            current_movement_ids.add(mov['id'])
        
        # Marcar novas movimentações como faturadas
        billed_at = datetime.now(timezone.utc).isoformat()
        await db.movements.update_many(
            {"id": {"$in": invoice_update.movement_ids_to_add}},
            {"$set": {"billed": True, "billed_at": billed_at, "invoice_id": invoice_id}}
        )
        changes['movements_added'] = invoice_update.movement_ids_to_add
    
    # Verificar se resta pelo menos uma movimentação
    if len(current_movement_ids) == 0:
        raise HTTPException(status_code=400, detail="A fatura deve ter pelo menos uma movimentação")
    
    # Atualizar lista de movimentações
    update_data['movement_ids'] = list(current_movement_ids)
    
    # Recalcular valor total (arredondado para 2 casas decimais)
    movements = await db.movements.find(
        {"id": {"$in": list(current_movement_ids)}},
        {"_id": 0, "service_value": 1}
    ).to_list(None)
    new_total = round_money(sum(m.get('service_value', 0) or 0 for m in movements))
    
    if new_total != invoice.get('total_value'):
        changes['total_value'] = {'from': invoice.get('total_value'), 'to': new_total}
    update_data['total_value'] = new_total
    
    # Aplicar atualização
    await db.invoices.update_one({"id": invoice_id}, {"$set": update_data})
    
    # Registrar no histórico se houve mudanças
    if changes:
        await log_invoice_history(
            invoice_id=invoice_id,
            invoice_number=invoice['invoice_number'],
            action="UPDATED",
            changes=changes,
            user_id=current_user['sub'],
            user_name=current_user['name']
        )
    
    # Buscar fatura atualizada
    updated_invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    
    return InvoiceResponse(
        id=updated_invoice['id'],
        invoice_number=updated_invoice['invoice_number'],
        client_name=updated_invoice['client_name'],
        client_cnpj=updated_invoice.get('client_cnpj'),
        movement_ids=updated_invoice['movement_ids'],
        total_value=updated_invoice['total_value'],
        notes=updated_invoice.get('notes'),
        created_at=datetime.fromisoformat(updated_invoice['created_at']),
        user_name=updated_invoice['user_name']
    )

@api_router.get("/invoices/{invoice_id}/movements", response_model=List[InvoiceMovementDetail])
async def get_invoice_movements(invoice_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Retorna detalhes das movimentações de uma fatura"""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Fatura não encontrada")
    
    movements = await db.movements.find(
        {"id": {"$in": invoice['movement_ids']}},
        {"_id": 0}
    ).to_list(None)
    
    return [
        InvoiceMovementDetail(
            id=m['id'],
            transaction_id=m.get('transaction_id', 0),
            container_number=m['container_number'],
            operation_type=m['operation_type'],
            service_type=m.get('service_type'),
            service_value=m.get('service_value'),
            created_at=parse_datetime_value(m['created_at'])
        )
        for m in movements
    ]

@api_router.get("/invoices/{invoice_id}/pdf")
async def download_invoice_pdf(invoice_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Gera PDF da fatura para download"""
    from reports import generate_invoice_pdf
    
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Fatura não encontrada")
    
    movements = await db.movements.find(
        {"id": {"$in": invoice['movement_ids']}},
        {"_id": 0}
    ).to_list(None)
    
    company = await get_company_settings()
    pdf_buffer = generate_invoice_pdf(invoice, movements, company=company)

    filename = f"fatura_{invoice['invoice_number']}.pdf"
    
    return StreamingResponse(
        io.BytesIO(pdf_buffer),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@api_router.get("/invoices/{invoice_id}/excel")
async def download_invoice_excel(invoice_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Gera Excel da fatura para download"""
    from reports import generate_invoice_excel
    
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Fatura não encontrada")
    
    movements = await db.movements.find(
        {"id": {"$in": invoice['movement_ids']}},
        {"_id": 0}
    ).to_list(None)
    
    company = await get_company_settings()
    excel_buffer = generate_invoice_excel(invoice, movements, company=company)

    filename = f"fatura_{invoice['invoice_number']}.xlsx"
    
    return StreamingResponse(
        io.BytesIO(excel_buffer),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@api_router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Exclui uma fatura e desmarca as movimentações como faturadas"""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Fatura não encontrada")
    
    # Registrar no histórico antes de deletar
    await log_invoice_history(
        invoice_id=invoice_id,
        invoice_number=invoice['invoice_number'],
        action="DELETED",
        changes={
            "client_name": invoice.get('client_name'),
            "total_value": invoice.get('total_value'),
            "movements_count": len(invoice.get('movement_ids', []))
        },
        user_id=current_user['sub'],
        user_name=current_user['name']
    )
    
    # Desmarcar movimentações como faturadas
    await db.movements.update_many(
        {"id": {"$in": invoice['movement_ids']}},
        {"$set": {"billed": False, "billed_at": None}, "$unset": {"invoice_id": ""}}
    )
    
    # Excluir a fatura
    await db.invoices.delete_one({"id": invoice_id})
    
    return {"message": "Fatura excluída com sucesso"}

@api_router.get("/invoices/{invoice_id}/history", response_model=List[InvoiceHistoryResponse])
async def get_invoice_history(invoice_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Retorna o histórico de alterações de uma fatura"""
    history = await db.invoice_history.find(
        {"invoice_id": invoice_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    
    return [
        InvoiceHistoryResponse(
            id=h['id'],
            invoice_id=h['invoice_id'],
            invoice_number=h['invoice_number'],
            action=h['action'],
            changes=h['changes'],
            user_name=h['user_name'],
            created_at=datetime.fromisoformat(h['created_at'])
        )
        for h in history
    ]

