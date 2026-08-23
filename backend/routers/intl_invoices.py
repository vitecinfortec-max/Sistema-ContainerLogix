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

# ==================== INVOICE ENDPOINTS ====================

DEFAULT_RECEIVER_ZIP = "62670-000"

async def build_receiver_data() -> dict:
    """Monta os dados do recebedor (nossa empresa) a partir de 'Dados da Empresa'."""
    company = merge_company(await get_company_settings())
    address_parts = [line.strip() for line in company['address'].split('\n') if line.strip()]
    return {
        "company": company['name'],
        "cnpj": company['cnpj'],
        "email": company['email'],
        "phone": company['phone'],
        "address": address_parts[0] if address_parts else '',
        "city_state": address_parts[1] if len(address_parts) > 1 else '',
        "zip": DEFAULT_RECEIVER_ZIP,
        "complement": ""
    }

@api_router.get("/intl-invoices")
async def get_intl_invoices(
    page: int = 1,
    per_page: int = 20,
    status: Optional[str] = None,
    currency: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user)
):
    """Lista todas as invoices internacionais"""
    query = {}
    if status:
        query["status"] = status
    if currency:
        query["currency"] = currency
    
    total = await db.intl_invoices.count_documents(query)
    skip = (page - 1) * per_page
    
    invoices = await db.intl_invoices.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page).to_list(per_page)
    
    return {
        "items": invoices,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page
    }

@api_router.get("/intl-invoices/receiver-data")
async def get_intl_receiver_data(current_user: dict = Depends(get_current_admin_user)):
    """Retorna dados pré-preenchidos do recebedor"""
    return await build_receiver_data()

@api_router.get("/intl-invoices/movement/{transaction_id}")
async def get_movement_for_invoice(transaction_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Busca uma movimentação pelo número para adicionar como item na invoice"""
    # Tentar converter para inteiro se possível
    try:
        trans_id_int = int(transaction_id)
        movement = await db.movements.find_one({"transaction_id": trans_id_int}, {"_id": 0})
    except ValueError:
        movement = await db.movements.find_one({"transaction_id": transaction_id}, {"_id": 0})
    
    if not movement:
        raise HTTPException(status_code=404, detail="Movimentação não encontrada")
    
    return {
        "id": movement.get("id"),
        "transaction_id": movement.get("transaction_id"),
        "container_number": movement.get("container_number"),
        "service_type": movement.get("service_type"),
        "service_value": movement.get("service_value") or 0,
        "currency": movement.get("currency", "BRL"),
        "client_name": movement.get("client_name"),
        "operation_type": movement.get("operation_type"),
        "size_type": movement.get("size_type"),
        "shipping_line": movement.get("shipping_line"),
    }

@api_router.post("/intl-invoices")
async def create_intl_invoice(
    data: IntlInvoiceCreate,
    current_user: dict = Depends(get_current_admin_user)
):
    """Cria uma nova invoice internacional"""
    
    # Gerar número sequencial
    counter = await db.counters.find_one_and_update(
        {"_id": "intl_invoice_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    invoice_number = counter.get("seq", 1)
    
    # Calcular totais
    subtotal = sum(item.quantity * item.unit_price for item in data.items)
    total = subtotal
    
    # Preparar itens
    items_data = []
    for item in data.items:
        items_data.append({
            "description": item.description,
            "quantity": item.quantity,
            "unit_price": item.unit_price,
            "total": item.quantity * item.unit_price
        })
    
    receiver_data = await build_receiver_data()
    invoice_data = {
        "id": str(uuid.uuid4()),
        "invoice_number": invoice_number,
        "receiver_company": receiver_data["company"],
        "receiver_cnpj": receiver_data["cnpj"],
        "receiver_email": receiver_data["email"],
        "receiver_phone": receiver_data["phone"],
        "receiver_address": receiver_data["address"],
        "receiver_city_state": receiver_data["city_state"],
        "receiver_zip": receiver_data["zip"],
        "receiver_complement": receiver_data["complement"],
        "payer_client_id": data.payer_client_id,
        "payer_company": data.payer_company,
        "payer_cnpj": data.payer_cnpj,
        "payer_contact": data.payer_contact,
        "payer_email": data.payer_email,
        "payer_address": data.payer_address,
        "issue_date": data.issue_date,
        "due_date": data.due_date,
        "currency": data.currency,
        "items": items_data,
        "subtotal": subtotal,
        "total": total,
        "notes": data.notes,
        "status": "EMITIDA",
        "created_by": current_user["sub"],
        "created_by_name": current_user.get("name", "Sistema"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": None
    }
    
    await db.intl_invoices.insert_one(invoice_data)
    
    # Remover _id inserido pelo MongoDB antes de retornar
    invoice_data.pop("_id", None)
    
    return invoice_data

@api_router.get("/intl-invoices/{invoice_id}")
async def get_intl_invoice(invoice_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Retorna uma invoice internacional específica"""
    invoice = await db.intl_invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice não encontrada")
    return invoice

@api_router.put("/intl-invoices/{invoice_id}/status")
async def update_intl_invoice_status(
    invoice_id: str,
    status: str,
    current_user: dict = Depends(get_current_admin_user)
):
    """Atualiza o status de uma invoice internacional"""
    if status not in ["EMITIDA", "PAGA", "CANCELADA"]:
        raise HTTPException(status_code=400, detail="Status inválido")
    
    result = await db.intl_invoices.update_one(
        {"id": invoice_id},
        {"$set": {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Invoice não encontrada")
    
    return {"message": "Status atualizado com sucesso"}

@api_router.delete("/intl-invoices/{invoice_id}")
async def delete_intl_invoice(invoice_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Exclui uma invoice internacional"""
    result = await db.intl_invoices.delete_one({"id": invoice_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Invoice não encontrada")
    return {"message": "Invoice excluída com sucesso"}

@api_router.put("/intl-invoices/{invoice_id}")
async def update_intl_invoice(
    invoice_id: str,
    data: IntlInvoiceCreate,
    current_user: dict = Depends(get_current_admin_user)
):
    """Atualiza uma invoice internacional"""
    invoice = await db.intl_invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice não encontrada")
    
    # Calcular totais
    subtotal = sum(item.quantity * item.unit_price for item in data.items)
    total = subtotal
    
    # Preparar itens
    items_data = []
    for item in data.items:
        items_data.append({
            "description": item.description,
            "quantity": item.quantity,
            "unit_price": item.unit_price,
            "total": item.quantity * item.unit_price
        })
    
    update_data = {
        "payer_client_id": data.payer_client_id,
        "payer_company": data.payer_company,
        "payer_cnpj": data.payer_cnpj,
        "payer_contact": data.payer_contact,
        "payer_email": data.payer_email,
        "payer_address": data.payer_address,
        "issue_date": data.issue_date,
        "due_date": data.due_date,
        "currency": data.currency,
        "items": items_data,
        "subtotal": subtotal,
        "total": total,
        "notes": data.notes,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.intl_invoices.update_one(
        {"id": invoice_id},
        {"$set": update_data}
    )
    
    # Buscar invoice atualizada
    updated_invoice = await db.intl_invoices.find_one({"id": invoice_id}, {"_id": 0})
    return updated_invoice

@api_router.get("/intl-invoices/{invoice_id}/pdf")
async def generate_intl_invoice_pdf(invoice_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Gera PDF da invoice internacional"""
    from reports import generate_intl_invoice_pdf as gen_pdf
    
    invoice = await db.intl_invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice não encontrada")
    
    company = await get_company_settings()
    pdf_buffer = gen_pdf(invoice, company=company)

    return StreamingResponse(
        io.BytesIO(pdf_buffer),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=invoice_{invoice['invoice_number']}.pdf"}
    )


# ==================== FATURAS DOMÉSTICAS (BILLING) ====================
# Os endpoints de faturas domésticas permanecem em /api/billing-invoices


