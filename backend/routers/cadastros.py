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
    Terminal, TerminalCreate, TerminalResponse,
    Employee, EmployeeCreate, EmployeeResponse,
    InsuranceCompany, InsuranceCompanyCreate, InsuranceCompanyResponse,
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

@api_router.post("/drivers", response_model=DriverResponse)
async def create_driver(driver_input: DriverCreate, current_user: dict = Depends(get_current_active_user)):
    existing_cpf = await db.drivers.find_one({"cpf": driver_input.cpf}, {"_id": 0, "id": 1})
    if existing_cpf:
        raise HTTPException(status_code=400, detail="Já existe uma pessoa cadastrada com este CPF")

    driver = Driver(**driver_input.model_dump(), created_by=current_user['sub'])

    doc = driver.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.drivers.insert_one(doc)

    return DriverResponse(**driver.model_dump())

@api_router.get("/drivers", response_model=List[DriverResponse])
async def get_drivers(
    page: int = 1,
    per_page: int = 0,  # 0 = sem limite
    current_user: dict = Depends(get_current_active_user)
):
    # Se per_page = 0, retorna todos os motoristas
    if per_page == 0:
        drivers = await db.drivers.find({}, {"_id": 0}).sort("created_at", -1).to_list(None)
    else:
        skip = (page - 1) * per_page
        drivers = await db.drivers.find({}, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page).to_list(per_page)
    return [
        DriverResponse(**{**d, "created_at": datetime.fromisoformat(d['created_at'])})
        for d in drivers
    ]

@api_router.put("/drivers/{driver_id}", response_model=DriverResponse)
async def update_driver(driver_id: str, driver_input: DriverCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Motorista não encontrado")

    existing_cpf = await db.drivers.find_one(
        {"cpf": driver_input.cpf, "id": {"$ne": driver_id}}, {"_id": 0, "id": 1}
    )
    if existing_cpf:
        raise HTTPException(status_code=400, detail="Já existe uma pessoa cadastrada com este CPF")

    update_data = {
        **driver_input.model_dump(),
        "id": driver_id,
        "created_at": existing['created_at'],
        "created_by": existing['created_by']
    }

    await db.drivers.replace_one({"id": driver_id}, update_data)

    return DriverResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})

@api_router.delete("/drivers/{driver_id}")
async def delete_driver(driver_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.drivers.delete_one({"id": driver_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Motorista não encontrado")
    return {"message": "Motorista deletado com sucesso"}

@api_router.post("/transport-companies", response_model=TransportCompanyResponse)
async def create_transport_company(company_input: TransportCompanyCreate, current_user: dict = Depends(get_current_active_user)):
    company = TransportCompany(
        name=company_input.name,
        cnpj=company_input.cnpj,
        phone=company_input.phone,
        created_by=current_user['sub']
    )
    
    doc = company.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.transport_companies.insert_one(doc)
    
    return TransportCompanyResponse(
        id=company.id,
        name=company.name,
        cnpj=company.cnpj,
        phone=company.phone,
        created_at=company.created_at
    )

@api_router.get("/transport-companies", response_model=List[TransportCompanyResponse])
async def get_transport_companies(
    page: int = 1,
    per_page: int = 0,  # 0 = sem limite
    current_user: dict = Depends(get_current_active_user)
):
    if per_page == 0:
        companies = await db.transport_companies.find({}, {"_id": 0}).sort("created_at", -1).to_list(None)
    else:
        skip = (page - 1) * per_page
        companies = await db.transport_companies.find({}, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page).to_list(per_page)
    return [
        TransportCompanyResponse(
            id=c['id'],
            name=c['name'],
            cnpj=c.get('cnpj'),
            phone=c.get('phone'),
            created_at=datetime.fromisoformat(c['created_at'])
        )
        for c in companies
    ]

@api_router.post("/shipping-lines", response_model=ShippingLineResponse)
async def create_shipping_line(line_input: ShippingLineCreate, current_user: dict = Depends(get_current_active_user)):
    line = ShippingLine(
        name=line_input.name,
        code=line_input.code,
        created_by=current_user['sub']
    )
    
    doc = line.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.shipping_lines.insert_one(doc)
    
    return ShippingLineResponse(
        id=line.id,
        name=line.name,
        code=line.code,
        created_at=line.created_at
    )

@api_router.get("/shipping-lines", response_model=List[ShippingLineResponse])
async def get_shipping_lines(
    page: int = 1,
    per_page: int = 0,  # 0 = sem limite
    current_user: dict = Depends(get_current_active_user)
):
    if per_page == 0:
        lines = await db.shipping_lines.find({}, {"_id": 0}).sort("created_at", -1).to_list(None)
    else:
        skip = (page - 1) * per_page
        lines = await db.shipping_lines.find({}, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page).to_list(per_page)
    return [
        ShippingLineResponse(
            id=line['id'],
            name=line['name'],
            code=line.get('code'),
            created_at=datetime.fromisoformat(line['created_at'])
        )
        for line in lines
    ]

@api_router.put("/shipping-lines/{line_id}", response_model=ShippingLineResponse)
async def update_shipping_line(line_id: str, line_input: ShippingLineCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.shipping_lines.find_one({"id": line_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Armador não encontrado")
    
    update_data = {
        "id": line_id,
        "name": line_input.name,
        "code": line_input.code,
        "created_at": existing['created_at'],
        "created_by": existing['created_by']
    }
    
    await db.shipping_lines.replace_one({"id": line_id}, update_data)
    
    return ShippingLineResponse(
        id=line_id,
        name=update_data['name'],
        code=update_data['code'],
        created_at=datetime.fromisoformat(update_data['created_at'])
    )

@api_router.delete("/shipping-lines/{line_id}")
async def delete_shipping_line(line_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.shipping_lines.delete_one({"id": line_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Armador não encontrado")
    return {"message": "Armador deletado com sucesso"}

@api_router.put("/transport-companies/{company_id}", response_model=TransportCompanyResponse)
async def update_transport_company(company_id: str, company_input: TransportCompanyCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.transport_companies.find_one({"id": company_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Transportadora não encontrada")
    
    update_data = {
        "id": company_id,
        "name": company_input.name,
        "cnpj": company_input.cnpj,
        "phone": company_input.phone,
        "created_at": existing['created_at'],
        "created_by": existing['created_by']
    }
    
    await db.transport_companies.replace_one({"id": company_id}, update_data)
    
    return TransportCompanyResponse(
        id=company_id,
        name=update_data['name'],
        cnpj=update_data['cnpj'],
        phone=update_data['phone'],
        created_at=datetime.fromisoformat(update_data['created_at'])
    )

@api_router.delete("/transport-companies/{company_id}")
async def delete_transport_company(company_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.transport_companies.delete_one({"id": company_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Transportadora não encontrada")
    return {"message": "Transportadora deletada com sucesso"}

# CRUD de Clientes
@api_router.post("/clients", response_model=ClientResponse)
async def create_client(client_input: ClientCreate, current_user: dict = Depends(get_current_active_user)):
    client = Client(**client_input.model_dump(), created_by=current_user['sub'])

    doc = client.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.clients.insert_one(doc)

    return ClientResponse(**client.model_dump())

@api_router.get("/clients", response_model=List[ClientResponse])
async def get_clients(
    page: int = 1,
    per_page: int = 100,
    current_user: dict = Depends(get_current_active_user)
):
    skip = (page - 1) * per_page
    clients = await db.clients.find({}, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page).to_list(per_page)
    return [
        ClientResponse(**{**c, "created_at": datetime.fromisoformat(c['created_at'])})
        for c in clients
    ]

@api_router.put("/clients/{client_id}", response_model=ClientResponse)
async def update_client(client_id: str, client_input: ClientCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")

    update_data = {
        **client_input.model_dump(),
        "id": client_id,
        "created_at": existing['created_at'],
        "created_by": existing['created_by']
    }

    await db.clients.replace_one({"id": client_id}, update_data)

    return ClientResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})

@api_router.delete("/clients/{client_id}")
async def delete_client(client_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.clients.delete_one({"id": client_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    return {"message": "Cliente deletado com sucesso"}

# CRUD de Fornecedores
@api_router.post("/suppliers", response_model=SupplierResponse)
async def create_supplier(supplier_input: SupplierCreate, current_user: dict = Depends(get_current_active_user)):
    supplier = Supplier(**supplier_input.model_dump(), created_by=current_user['sub'])

    doc = supplier.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.suppliers.insert_one(doc)

    return SupplierResponse(**supplier.model_dump())

@api_router.get("/suppliers", response_model=List[SupplierResponse])
async def get_suppliers(
    page: int = 1,
    per_page: int = 100,
    current_user: dict = Depends(get_current_active_user)
):
    skip = (page - 1) * per_page
    suppliers = await db.suppliers.find({}, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page).to_list(per_page)
    return [
        SupplierResponse(**{**s, "created_at": datetime.fromisoformat(s['created_at'])})
        for s in suppliers
    ]

@api_router.put("/suppliers/{supplier_id}", response_model=SupplierResponse)
async def update_supplier(supplier_id: str, supplier_input: SupplierCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.suppliers.find_one({"id": supplier_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado")

    update_data = {
        **supplier_input.model_dump(),
        "id": supplier_id,
        "created_at": existing['created_at'],
        "created_by": existing['created_by']
    }

    await db.suppliers.replace_one({"id": supplier_id}, update_data)

    return SupplierResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})

@api_router.delete("/suppliers/{supplier_id}")
async def delete_supplier(supplier_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.suppliers.delete_one({"id": supplier_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado")
    return {"message": "Fornecedor deletado com sucesso"}

# CRUD de Terminal (Cadastro, dentro do grupo Terminal)
@api_router.post("/terminals", response_model=TerminalResponse)
async def create_terminal(terminal_input: TerminalCreate, current_user: dict = Depends(get_current_active_user)):
    terminal = Terminal(**terminal_input.model_dump(), created_by=current_user['sub'])

    doc = terminal.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.terminals.insert_one(doc)

    return TerminalResponse(**terminal.model_dump())

@api_router.get("/terminals", response_model=List[TerminalResponse])
async def get_terminals(
    page: int = 1,
    per_page: int = 100,
    current_user: dict = Depends(get_current_active_user)
):
    skip = (page - 1) * per_page
    terminals = await db.terminals.find({}, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page).to_list(per_page)
    return [
        TerminalResponse(**{**t, "created_at": datetime.fromisoformat(t['created_at'])})
        for t in terminals
    ]

@api_router.put("/terminals/{terminal_id}", response_model=TerminalResponse)
async def update_terminal(terminal_id: str, terminal_input: TerminalCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.terminals.find_one({"id": terminal_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Terminal não encontrado")

    update_data = {
        **terminal_input.model_dump(),
        "id": terminal_id,
        "created_at": existing['created_at'],
        "created_by": existing['created_by']
    }

    await db.terminals.replace_one({"id": terminal_id}, update_data)

    return TerminalResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})

@api_router.delete("/terminals/{terminal_id}")
async def delete_terminal(terminal_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.terminals.delete_one({"id": terminal_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Terminal não encontrado")
    return {"message": "Terminal deletado com sucesso"}

# CRUD de Funcionário
@api_router.post("/employees", response_model=EmployeeResponse)
async def create_employee(employee_input: EmployeeCreate, current_user: dict = Depends(get_current_active_user)):
    employee = Employee(**employee_input.model_dump(), created_by=current_user['sub'])

    doc = employee.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.employees.insert_one(doc)

    return EmployeeResponse(**employee.model_dump())

@api_router.get("/employees", response_model=List[EmployeeResponse])
async def get_employees(
    page: int = 1,
    per_page: int = 100,
    current_user: dict = Depends(get_current_active_user)
):
    skip = (page - 1) * per_page
    employees = await db.employees.find({}, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page).to_list(per_page)
    return [
        EmployeeResponse(**{**e, "created_at": datetime.fromisoformat(e['created_at'])})
        for e in employees
    ]

@api_router.put("/employees/{employee_id}", response_model=EmployeeResponse)
async def update_employee(employee_id: str, employee_input: EmployeeCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.employees.find_one({"id": employee_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Funcionário não encontrado")

    update_data = {
        **employee_input.model_dump(),
        "id": employee_id,
        "created_at": existing['created_at'],
        "created_by": existing['created_by']
    }

    await db.employees.replace_one({"id": employee_id}, update_data)

    return EmployeeResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})

@api_router.delete("/employees/{employee_id}")
async def delete_employee(employee_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.employees.delete_one({"id": employee_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Funcionário não encontrado")
    return {"message": "Funcionário deletado com sucesso"}

# CRUD de Seguradora
@api_router.post("/insurance-companies", response_model=InsuranceCompanyResponse)
async def create_insurance_company(insurance_input: InsuranceCompanyCreate, current_user: dict = Depends(get_current_active_user)):
    insurance = InsuranceCompany(**insurance_input.model_dump(), created_by=current_user['sub'])

    doc = insurance.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.insurance_companies.insert_one(doc)

    return InsuranceCompanyResponse(**insurance.model_dump())

@api_router.get("/insurance-companies", response_model=List[InsuranceCompanyResponse])
async def get_insurance_companies(
    page: int = 1,
    per_page: int = 100,
    current_user: dict = Depends(get_current_active_user)
):
    skip = (page - 1) * per_page
    items = await db.insurance_companies.find({}, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page).to_list(per_page)
    return [
        InsuranceCompanyResponse(**{**i, "created_at": datetime.fromisoformat(i['created_at'])})
        for i in items
    ]

@api_router.put("/insurance-companies/{insurance_id}", response_model=InsuranceCompanyResponse)
async def update_insurance_company(insurance_id: str, insurance_input: InsuranceCompanyCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.insurance_companies.find_one({"id": insurance_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Seguradora não encontrada")

    update_data = {
        **insurance_input.model_dump(),
        "id": insurance_id,
        "created_at": existing['created_at'],
        "created_by": existing['created_by']
    }

    await db.insurance_companies.replace_one({"id": insurance_id}, update_data)

    return InsuranceCompanyResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})

@api_router.delete("/insurance-companies/{insurance_id}")
async def delete_insurance_company(insurance_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.insurance_companies.delete_one({"id": insurance_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Seguradora não encontrada")
    return {"message": "Seguradora deletada com sucesso"}

# CRUD de Tipos de Serviço
@api_router.post("/service-types", response_model=ServiceTypeResponse)
async def create_service_type(service_type_input: ServiceTypeCreate, current_user: dict = Depends(get_current_active_user)):
    service_type = ServiceType(
        name=service_type_input.name,
        description=service_type_input.description,
        created_by=current_user['sub']
    )
    
    doc = service_type.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.service_types.insert_one(doc)
    
    return ServiceTypeResponse(
        id=service_type.id,
        name=service_type.name,
        description=service_type.description,
        created_at=service_type.created_at
    )

@api_router.get("/service-types", response_model=List[ServiceTypeResponse])
async def get_service_types(
    page: int = 1,
    per_page: int = 100,
    current_user: dict = Depends(get_current_active_user)
):
    skip = (page - 1) * per_page
    service_types = await db.service_types.find({}, {"_id": 0}).sort("name", 1).skip(skip).limit(per_page).to_list(per_page)
    return [
        ServiceTypeResponse(
            id=st['id'],
            name=st['name'],
            description=st.get('description'),
            created_at=datetime.fromisoformat(st['created_at'])
        )
        for st in service_types
    ]

@api_router.put("/service-types/{service_type_id}", response_model=ServiceTypeResponse)
async def update_service_type(service_type_id: str, service_type_input: ServiceTypeCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.service_types.find_one({"id": service_type_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Tipo de Serviço não encontrado")
    
    update_data = {
        "id": service_type_id,
        "name": service_type_input.name,
        "description": service_type_input.description,
        "created_at": existing['created_at'],
        "created_by": existing['created_by']
    }
    
    await db.service_types.replace_one({"id": service_type_id}, update_data)
    
    return ServiceTypeResponse(
        id=service_type_id,
        name=update_data['name'],
        description=update_data['description'],
        created_at=datetime.fromisoformat(update_data['created_at'])
    )

@api_router.delete("/service-types/{service_type_id}")
async def delete_service_type(service_type_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.service_types.delete_one({"id": service_type_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Tipo de Serviço não encontrado")
    return {"message": "Tipo de Serviço deletado com sucesso"}

@api_router.post("/upload")
async def upload_file(file: UploadFile = File(...), current_user: dict = Depends(get_current_active_user)):
    """Upload de arquivo (imagem) para o servidor"""
    logging.info(f"[Upload] Recebendo arquivo: {file.filename}, content_type: {file.content_type}")
    
    # Verificar extensão
    file_ext = Path(file.filename).suffix.lower() if file.filename else ''
    if file_ext not in ALLOWED_EXTENSIONS:
        logging.error(f"[Upload] Extensão não permitida: {file_ext}")
        raise HTTPException(
            status_code=400, 
            detail=f"Tipo de arquivo não permitido. Use: {', '.join(ALLOWED_EXTENSIONS)}"
        )
    
    # Ler o arquivo
    content = await file.read()
    logging.info(f"[Upload] Arquivo lido: {len(content)} bytes")
    
    # Verificar tamanho
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400, 
            detail=f"Arquivo muito grande. Máximo: {MAX_FILE_SIZE // (1024*1024)}MB"
        )
    
    # Gerar nome único para o arquivo
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = UPLOADS_DIR / unique_filename
    
    # Salvar arquivo
    try:
        with open(file_path, 'wb') as f:
            f.write(content)
        logging.info(f"[Upload] Arquivo salvo: {file_path}")
    except Exception as e:
        logging.error(f"Erro ao salvar arquivo: {e}")
        raise HTTPException(status_code=500, detail="Erro ao salvar arquivo")
    
    # Verificar se o arquivo foi salvo corretamente
    if not file_path.exists():
        logging.error(f"[Upload] Arquivo não encontrado após salvar: {file_path}")
        raise HTTPException(status_code=500, detail="Erro ao verificar arquivo salvo")
    
    url = f"/api/uploads/{unique_filename}"
    logging.info(f"[Upload] Sucesso! URL: {url}")
    
    # Retornar URL do arquivo
    return {
        "filename": unique_filename,
        "url": url,
        "size": len(content),
        "content_type": file.content_type
    }

@api_router.delete("/upload/{filename}")
async def delete_file(filename: str, current_user: dict = Depends(get_current_active_user)):
    """Deletar arquivo do servidor"""
    uploads_root = UPLOADS_DIR.resolve()
    # Resolve o caminho final e garante que ele continua dentro de UPLOADS_DIR -
    # sem isso, um filename como "..\\..\\backend\\server.py" escapava da pasta de uploads.
    file_path = (UPLOADS_DIR / filename).resolve()
    if uploads_root not in file_path.parents and file_path != uploads_root:
        raise HTTPException(status_code=400, detail="Nome de arquivo inválido")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")

    try:
        file_path.unlink()
        return {"message": "Arquivo deletado com sucesso"}
    except Exception as e:
        logging.error(f"Erro ao deletar arquivo: {e}")
        raise HTTPException(status_code=500, detail="Erro ao deletar arquivo")

