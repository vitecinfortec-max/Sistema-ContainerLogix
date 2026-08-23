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

@api_router.post("/auth/register", response_model=Token)
async def register(user_input: UserCreate):
    existing = await db.users.find_one({"email": user_input.email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Email já cadastrado")
    
    user = User(
        name=user_input.name,
        email=user_input.email,
        password=get_password_hash(user_input.password),
        role="operator"  # Autocadastro nunca concede admin; promoção deve ser feita direto no banco por um admin
    )
    
    doc = user.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.users.insert_one(doc)
    
    access_token = create_access_token(data={"sub": user.id, "email": user.email, "name": user.name})
    
    user_response = UserResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        created_at=user.created_at
    )
    
    return Token(access_token=access_token, token_type="bearer", user=user_response)

# Password Recovery with Resend
import resend
import asyncio
import secrets
import string

resend.api_key = os.environ.get('RESEND_API_KEY', '')
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'onboarding@resend.dev')

def generate_temp_password(length=8):
    """Gera uma senha temporária aleatória"""
    chars = string.ascii_letters + string.digits
    return ''.join(secrets.choice(chars) for _ in range(length))

class ForgotPasswordRequest(PydanticBaseModel):
    email: str

class ChangePasswordRequest(PydanticBaseModel):
    current_password: str
    new_password: str

@api_router.post("/auth/forgot-password")
async def forgot_password(request: ForgotPasswordRequest, http_request: Request):
    """Envia senha provisória por email"""
    check_rate_limit(f"forgot-password:ip:{client_ip(http_request)}", limit=5, window_seconds=900)
    check_rate_limit(f"forgot-password:email:{request.email.lower()}", limit=3, window_seconds=900)

    user_doc = await db.users.find_one({"email": request.email}, {"_id": 0})
    if not user_doc:
        # Não revelamos se o email existe ou não (segurança)
        return {"message": "Se o email estiver cadastrado, você receberá uma senha provisória."}
    
    # Gerar senha provisória
    temp_password = generate_temp_password()
    hashed_password = get_password_hash(temp_password)
    
    # Atualizar no banco com flag must_change_password
    await db.users.update_one(
        {"email": request.email},
        {"$set": {"password": hashed_password, "must_change_password": True}}
    )
    
    # Enviar email com senha provisória
    try:
        html_content = f"""
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="color: #3B9BA8;">J.A Logística</h1>
                <h2 style="color: #333;">ContainerLogix</h2>
            </div>
            
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <h3 style="color: #333; margin-top: 0;">Recuperação de Senha</h3>
                <p>Olá <strong>{user_doc['name']}</strong>,</p>
                <p>Recebemos uma solicitação de recuperação de senha para sua conta.</p>
                <p>Sua senha provisória é:</p>
                <div style="background-color: #3B9BA8; color: white; padding: 15px; border-radius: 4px; text-align: center; font-size: 24px; font-family: monospace; letter-spacing: 2px;">
                    {temp_password}
                </div>
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; border-left: 4px solid #ffc107;">
                <p style="margin: 0; color: #856404;">
                    <strong>Importante:</strong> Ao fazer login com esta senha, você será solicitado a criar uma nova senha.
                </p>
            </div>
            
            <p style="color: #666; font-size: 12px; margin-top: 30px; text-align: center;">
                Se você não solicitou esta recuperação, ignore este email.
            </p>
        </div>
        """
        
        params = {
            "from": SENDER_EMAIL,
            "to": [request.email],
            "subject": "ContainerLogix - Recuperação de Senha",
            "html": html_content
        }
        
        # Enviar email de forma assíncrona
        await asyncio.to_thread(resend.Emails.send, params)
        
    except Exception as e:
        logging.error(f"Erro ao enviar email de recuperação: {e}")
        # Mesmo com erro no email, não revelamos detalhes ao usuário
    
    return {"message": "Se o email estiver cadastrado, você receberá uma senha provisória."}

@api_router.post("/auth/change-password")
async def change_password(request: ChangePasswordRequest, current_user: dict = Depends(get_current_active_user)):
    """Altera a senha do usuário logado"""
    user_doc = await db.users.find_one({"id": current_user['sub']}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    
    # Verificar senha atual
    if not verify_password(request.current_password, user_doc['password']):
        raise HTTPException(status_code=400, detail="Senha atual incorreta")
    
    # Atualizar senha e remover flag must_change_password
    new_hashed_password = get_password_hash(request.new_password)
    await db.users.update_one(
        {"id": current_user['sub']},
        {"$set": {"password": new_hashed_password, "must_change_password": False}}
    )
    
    return {"message": "Senha alterada com sucesso"}

@api_router.post("/auth/login", response_model=Token)
async def login(credentials: UserLogin, http_request: Request):
    check_rate_limit(f"login:ip:{client_ip(http_request)}", limit=10, window_seconds=300)
    check_rate_limit(f"login:email:{credentials.email.lower()}", limit=5, window_seconds=300)

    user_doc = await db.users.find_one({"email": credentials.email}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=401, detail="Email ou senha incorretos")

    if not verify_password(credentials.password, user_doc['password']):
        raise HTTPException(status_code=401, detail="Email ou senha incorretos")

    if user_doc.get('active') is False:
        raise HTTPException(status_code=403, detail="Acesso desativado. Fale com um administrador.")

    access_token = create_access_token(data={"sub": user_doc['id'], "email": user_doc['email'], "name": user_doc['name']})

    user_response = UserResponse(
        id=user_doc['id'],
        name=user_doc['name'],
        email=user_doc['email'],
        role=user_doc['role'],
        must_change_password=user_doc.get('must_change_password', False),
        active=user_doc.get('active', True),
        created_at=datetime.fromisoformat(user_doc['created_at'])
    )
    
    return Token(access_token=access_token, token_type="bearer", user=user_response)

@api_router.get("/auth/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_active_user)):
    user_doc = await db.users.find_one({"id": current_user['sub']}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    
    return UserResponse(
        id=user_doc['id'],
        name=user_doc['name'],
        email=user_doc['email'],
        role=user_doc['role'],
        must_change_password=user_doc.get('must_change_password', False),
        created_at=datetime.fromisoformat(user_doc['created_at'])
    )

@api_router.get("/company-settings")
async def get_company_settings_endpoint(current_user: dict = Depends(get_current_active_user)):
    """Retorna os dados cadastrados em 'Dados da Empresa' (usados nos PDFs/Excel gerados pelo sistema)."""
    return await get_company_settings()

@api_router.put("/company-settings")
async def update_company_settings(data: CompanySettingsUpdate, current_user: dict = Depends(get_current_active_user)):
    """Atualiza os dados da empresa. Restrito a administradores."""
    user_doc = await db.users.find_one({"id": current_user['sub']}, {"_id": 0})
    if not user_doc or user_doc.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Apenas administradores podem editar os dados da empresa")

    settings = CompanySettings(**data.model_dump(exclude_unset=True))
    doc = settings.model_dump()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.company_settings.replace_one({}, doc, upsert=True)
    return doc

