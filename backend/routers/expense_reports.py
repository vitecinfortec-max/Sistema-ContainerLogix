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

# ==================== FINANCEIRO - PRESTAÇÃO DE CONTAS ====================

from models import (
    ExpenseReport, ExpenseReportCreate, ExpenseReportResponse,
    ExpenseReportDeposit, ExpenseReportPurchase, ExpenseReportReceipt
)


async def get_next_expense_report_number():
    """Obtém o próximo número de Prestação de Contas, reiniciando em 0001 a cada ano civil."""
    year = now_brt().year
    counter = await db.counters.find_one_and_update(
        {"_id": f"expense_report_number_{year}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    seq = counter["seq"]
    return seq, f"{year}{seq:04d}"


def calculate_expense_report_totals(deposits: list, purchases: list):
    total_deposits = round(sum(d.amount for d in deposits), 2)
    total_purchases = round(sum(p.amount for p in purchases), 2)
    balance = round(total_purchases - total_deposits, 2)
    return total_deposits, total_purchases, balance


async def resolve_expense_report_purchases(purchases: list) -> list:
    """Garante item_id em cada compra e resolve supplier_name a partir do supplier_id."""
    resolved = []
    for p in purchases:
        d = p.model_dump()
        if not d.get("item_id"):
            d["item_id"] = str(uuid.uuid4())
        if d.get("supplier_id"):
            supplier = await db.suppliers.find_one({"id": d["supplier_id"]}, {"_id": 0, "name": 1})
            d["supplier_name"] = supplier.get("name") if supplier else d.get("supplier_name")
        resolved.append(d)
    return resolved


@api_router.get("/expense-reports")
async def get_expense_reports(
    search: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    current_user: dict = Depends(get_current_admin_user)
):
    """Lista as prestações de contas"""
    query = {}

    if search:
        search_escaped = re.escape(search)
        query["$or"] = [
            {"report_number_formatted": {"$regex": search_escaped, "$options": "i"}},
            {"purchases.supplier_name": {"$regex": search_escaped, "$options": "i"}}
        ]

    if status:
        query["status"] = status

    total = await db.expense_reports.count_documents(query)
    skip = (page - 1) * per_page

    cursor = db.expense_reports.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page)
    reports_list = await cursor.to_list(length=per_page)

    return {
        "items": reports_list,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page
    }


@api_router.get("/expense-reports/{report_id}", response_model=ExpenseReportResponse)
async def get_expense_report(report_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Busca prestação de contas por ID"""
    report = await db.expense_reports.find_one({"id": report_id}, {"_id": 0})
    if not report:
        raise HTTPException(status_code=404, detail="Prestação de contas não encontrada")
    return report


@api_router.post("/expense-reports", response_model=ExpenseReportResponse)
async def create_expense_report(data: ExpenseReportCreate, current_user: dict = Depends(get_current_admin_user)):
    """Cria nova prestação de contas"""
    seq, formatted = await get_next_expense_report_number()

    purchases_data = await resolve_expense_report_purchases(data.purchases)
    total_deposits, total_purchases, balance = calculate_expense_report_totals(
        data.deposits, [ExpenseReportPurchase(**p) for p in purchases_data]
    )

    report_data = {
        "id": str(uuid.uuid4()),
        "report_number": seq,
        "report_number_formatted": formatted,
        "period_start": data.period_start,
        "period_end": data.period_end,
        "deposits": [d.model_dump() for d in data.deposits],
        "purchases": purchases_data,
        "total_deposits": total_deposits,
        "total_purchases": total_purchases,
        "balance": balance,
        "status": "EM_ANDAMENTO",
        "created_by": current_user["sub"],
        "created_by_name": current_user.get("name", "Sistema"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": None
    }

    await db.expense_reports.insert_one(report_data)
    report_data.pop("_id", None)

    return report_data


@api_router.put("/expense-reports/{report_id}", response_model=ExpenseReportResponse)
async def update_expense_report(report_id: str, data: ExpenseReportCreate, current_user: dict = Depends(get_current_admin_user)):
    """Atualiza prestação de contas (bloqueado se já estiver concluída)"""
    existing = await db.expense_reports.find_one({"id": report_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Prestação de contas não encontrada")

    if existing["status"] == "CONCLUIDA":
        raise HTTPException(status_code=400, detail="Prestação de contas concluída não pode ser editada. Reabra antes de editar.")

    # Preserva os recibos já anexados a cada lançamento, casando por item_id
    existing_by_id = {p["item_id"]: p for p in existing.get("purchases", [])}
    purchases_data = await resolve_expense_report_purchases(data.purchases)
    for p in purchases_data:
        prior = existing_by_id.get(p["item_id"])
        p["receipts"] = prior["receipts"] if prior else []

    total_deposits, total_purchases, balance = calculate_expense_report_totals(
        data.deposits, [ExpenseReportPurchase(**p) for p in purchases_data]
    )

    update_data = {
        "period_start": data.period_start,
        "period_end": data.period_end,
        "deposits": [d.model_dump() for d in data.deposits],
        "purchases": purchases_data,
        "total_deposits": total_deposits,
        "total_purchases": total_purchases,
        "balance": balance,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }

    await db.expense_reports.update_one({"id": report_id}, {"$set": update_data})
    updated = await db.expense_reports.find_one({"id": report_id}, {"_id": 0})
    return updated


@api_router.delete("/expense-reports/{report_id}")
async def delete_expense_report(report_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Exclui prestação de contas"""
    result = await db.expense_reports.delete_one({"id": report_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Prestação de contas não encontrada")

    receipt_dir = UPLOADS_DIR / "expense_reports" / report_id
    if receipt_dir.exists():
        shutil.rmtree(receipt_dir, ignore_errors=True)

    return {"message": "Prestação de contas excluída com sucesso"}


@api_router.put("/expense-reports/{report_id}/status")
async def update_expense_report_status(report_id: str, status: str, current_user: dict = Depends(get_current_admin_user)):
    """Conclui ou reabre uma prestação de contas"""
    if status not in ["EM_ANDAMENTO", "CONCLUIDA"]:
        raise HTTPException(status_code=400, detail="Status inválido")

    result = await db.expense_reports.update_one(
        {"id": report_id},
        {"$set": {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Prestação de contas não encontrada")

    return {"message": "Status atualizado"}


@api_router.post("/expense-reports/{report_id}/purchases/{item_id}/upload-receipt")
async def upload_expense_report_receipt(
    report_id: str,
    item_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_admin_user)
):
    """Anexa um recibo (foto/scan) a um lançamento de compra específico"""
    report = await db.expense_reports.find_one(
        {"id": report_id, "purchases.item_id": item_id}, {"_id": 0}
    )
    if not report:
        raise HTTPException(status_code=404, detail="Prestação de contas ou lançamento de compra não encontrado")

    file_ext, content = await validate_and_read_upload(file, ALLOWED_RECEIPT_EXTENSIONS)

    receipt_dir = UPLOADS_DIR / "expense_reports" / report_id
    receipt_dir.mkdir(parents=True, exist_ok=True)

    receipt_id = str(uuid.uuid4())
    file_path = receipt_dir / f"{receipt_id}{file_ext}"

    with open(file_path, "wb") as buffer:
        buffer.write(content)

    receipt_url = f"/api/uploads/expense_reports/{report_id}/{receipt_id}{file_ext}"
    receipt_entry = {"id": receipt_id, "url": receipt_url}

    await db.expense_reports.update_one(
        {"id": report_id, "purchases.item_id": item_id},
        {
            "$push": {"purchases.$.receipts": receipt_entry},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
        }
    )

    return receipt_entry


@api_router.delete("/expense-reports/{report_id}/purchases/{item_id}/receipt/{receipt_id}")
async def delete_expense_report_receipt(
    report_id: str,
    item_id: str,
    receipt_id: str,
    current_user: dict = Depends(get_current_admin_user)
):
    """Remove um recibo de um lançamento de compra"""
    report = await db.expense_reports.find_one({"id": report_id}, {"_id": 0})
    if not report:
        raise HTTPException(status_code=404, detail="Prestação de contas não encontrada")

    purchase = next((p for p in report.get("purchases", []) if p["item_id"] == item_id), None)
    if not purchase:
        raise HTTPException(status_code=404, detail="Lançamento de compra não encontrado")

    remaining = [r for r in purchase.get("receipts", []) if r["id"] != receipt_id]
    if len(remaining) == len(purchase.get("receipts", [])):
        raise HTTPException(status_code=404, detail="Recibo não encontrado")

    receipt_dir = UPLOADS_DIR / "expense_reports" / report_id
    for file_path in receipt_dir.glob(f"{receipt_id}.*"):
        file_path.unlink()

    await db.expense_reports.update_one(
        {"id": report_id, "purchases.item_id": item_id},
        {"$set": {"purchases.$.receipts": remaining, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )

    return {"message": "Recibo removido com sucesso"}


@api_router.get("/expense-reports/{report_id}/pdf")
async def download_expense_report_pdf(report_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Gera PDF final da prestação de contas (somente quando concluída)"""
    from reports import generate_expense_report_pdf

    report = await db.expense_reports.find_one({"id": report_id}, {"_id": 0})
    if not report:
        raise HTTPException(status_code=404, detail="Prestação de contas não encontrada")

    if report["status"] != "CONCLUIDA":
        raise HTTPException(status_code=400, detail="Só é possível gerar o PDF de uma prestação de contas concluída")

    company = await get_company_settings()
    pdf_bytes = generate_expense_report_pdf(report, company=company)

    filename = f"prestacao_contas_{report['report_number_formatted']}.pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


