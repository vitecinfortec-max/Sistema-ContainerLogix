from datetime import datetime
from typing import Optional, List
import re
import uuid
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel as PydanticBaseModel

from models import (
    Driver, DriverCreate, DriverResponse, TransportCompany, TransportCompanyCreate,
    TransportCompanyResponse, Client, ClientCreate, ClientResponse, Supplier, SupplierCreate,
    SupplierResponse, Terminal, TerminalCreate, TerminalResponse, Employee, EmployeeCreate,
    EmployeeResponse, InsuranceCompany, InsuranceCompanyCreate, InsuranceCompanyResponse, ShippingLine,
    ShippingLineCreate, ShippingLineResponse, ServiceType, ServiceTypeCreate, ServiceTypeResponse
)

from shared import (
    db, get_current_active_user, get_current_admin_user, validate_and_read_upload, ALLOWED_EXTENSIONS, UPLOADS_DIR,
    ALLOWED_RECEIPT_EXTENSIONS, save_signature_value
)
from document_ocr import DOCUMENT_KINDS, read_document

api_router = APIRouter(prefix="/api")


def _digits(value) -> str:
    return re.sub(r'\D', '', value or '')


async def _ensure_unique_document(collection, field, value, exclude_id, message):
    """CNPJ/CPF repetido: compara só os dígitos (um cadastro antigo pode
    estar gravado sem máscara e o novo com, ou vice-versa)."""
    digits = _digits(value)
    if not digits:
        return
    query = {field: {"$nin": [None, ""]}}
    if exclude_id:
        query["id"] = {"$ne": exclude_id}
    for doc in await collection.find(query, {"_id": 0, "id": 1, "name": 1, field: 1}).to_list(None):
        if _digits(doc.get(field)) == digits:
            raise HTTPException(status_code=400, detail=f"{message}: {doc.get('name') or '-'}")


async def _ensure_unique_client_name(name, exclude_id):
    """O sistema liga EIR/fatura/relatórios ao cliente pelo nome, então dois
    clientes com o mesmo nome (ignorando maiúsculas/espaços) viram um só."""
    target = ' '.join((name or '').split()).lower()
    query = {"id": {"$ne": exclude_id}} if exclude_id else {}
    for doc in await db.clients.find(query, {"_id": 0, "name": 1}).to_list(None):
        if ' '.join((doc.get('name') or '').split()).lower() == target:
            raise HTTPException(status_code=400, detail="Já existe um cliente cadastrado com este nome")


def _name_regex(name):
    return {"$regex": f"^{re.escape((name or '').strip())}$", "$options": "i"}


async def _ensure_not_in_use(checks, label):
    """Bloqueia a exclusão de um cadastro que outros registros ainda usam
    (senão eles ficam apontando pra um cadastro que não existe mais).
    `checks` = lista de (coleção, filtro, descrição)."""
    used = []
    for collection, query, description in checks:
        count = await collection.count_documents(query)
        if count:
            used.append(f"{count} {description}")
    if used:
        raise HTTPException(
            status_code=400,
            detail=f"{label} em uso ({', '.join(used)}). Em vez de excluir, mude o status para Inativo.",
        )


def _list_query(collection, page, per_page):
    cursor = collection.find({}, {"_id": 0}).sort("created_at", -1)
    if per_page and per_page > 0:
        cursor = cursor.skip((max(page, 1) - 1) * per_page).limit(per_page)
    return cursor.to_list(None)


def _incoming_signature(data, kind, person_id, existing_url):
    """Assinatura no create/update do cadastro. Se o campo nem veio no
    corpo (ex.: uma aba antiga do sistema, de antes do campo existir),
    mantém a assinatura salva em vez de apagá-la."""
    if 'signature_url' not in data.model_fields_set:
        return existing_url
    return save_signature_value(kind, person_id, data.signature_url, existing_url)

@api_router.post("/drivers", response_model=DriverResponse)
async def create_driver(driver_input: DriverCreate, current_user: dict = Depends(get_current_active_user)):
    await _ensure_unique_document(db.drivers, "cpf", driver_input.cpf, None, "Já existe um motorista cadastrado com este CPF")

    driver = Driver(**driver_input.model_dump(), created_by=current_user['sub'])
    driver.signature_url = _incoming_signature(driver_input, 'motorista', driver.id, None)

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
    drivers = await _list_query(db.drivers, page, per_page)
    return [
        DriverResponse(**{**d, "created_at": datetime.fromisoformat(d['created_at'])})
        for d in drivers
    ]

@api_router.put("/drivers/{driver_id}", response_model=DriverResponse)
async def update_driver(driver_id: str, driver_input: DriverCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Motorista não encontrado")

    await _ensure_unique_document(db.drivers, "cpf", driver_input.cpf, driver_id, "Já existe um motorista cadastrado com este CPF")

    # Campo que nem veio no corpo mantém o valor salvo (fotos e anexos que
    # o formulário não mostra eram apagados a cada edição)
    update_data = {
        **{k: v for k, v in existing.items() if k in DriverCreate.model_fields and k not in driver_input.model_fields_set},
        **driver_input.model_dump(exclude_unset=True),
        "id": driver_id,
        "created_at": existing['created_at'],
        "created_by": existing['created_by']
    }
    update_data['signature_url'] = _incoming_signature(driver_input, 'motorista', driver_id, existing.get('signature_url'))

    await db.drivers.replace_one({"id": driver_id}, update_data)

    return DriverResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})

@api_router.delete("/drivers/{driver_id}")
async def delete_driver(driver_id: str, current_user: dict = Depends(get_current_active_user)):
    driver = await db.drivers.find_one({"id": driver_id}, {"_id": 0, "cpf": 1})
    if not driver:
        raise HTTPException(status_code=404, detail="Motorista não encontrado")
    cpf_values = [v for v in {driver.get('cpf'), _digits(driver.get('cpf'))} if v]
    await _ensure_not_in_use([
        (db.movements, {"driver_cpf": {"$in": cpf_values}}, "movimentação(ões)"),
        (db.vehicles, {"driver_id": driver_id}, "veículo(s)"),
        (db.loading_orders, {"driver_id": driver_id}, "ordem(ns) de carregamento"),
        (db.loading_schedules, {"items.driver_id": driver_id}, "programação(ões) de carregamento"),
        (db.freight_payments, {"driver_id": driver_id}, "pagamento(s) de frete"),
        (db.daily_rate_requests, {"items.driver_id": driver_id}, "solicitação(ões) de diária"),
        (db.gratifications, {"person_type": "MOTORISTA", "person_id": driver_id}, "gratificação(ões)"),
        (db.delivery_statuses, {"items.driver_id": driver_id}, "status de entrega"),
        (db.port_services, {"driver_id": driver_id}, "serviço(s) portuário(s)"),
        (db.fuel_supplies, {"driver_id": driver_id}, "abastecimento(s)"),
        (db.ordem_servico, {"person_id": driver_id}, "ordem(ns) de serviço"),
        (db.epi_deliveries, {"recipient_id": driver_id}, "entrega(s) de EPI"),
        (db.vehicle_checklists, {"driver_id": driver_id}, "checklist(s)"),
    ], "Motorista")
    result = await db.drivers.delete_one({"id": driver_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Motorista não encontrado")
    return {"message": "Motorista deletado com sucesso"}

@api_router.post("/transport-companies", response_model=TransportCompanyResponse)
async def create_transport_company(company_input: TransportCompanyCreate, current_user: dict = Depends(get_current_active_user)):
    await _ensure_unique_document(db.transport_companies, "cnpj", company_input.cnpj, None, "Já existe uma transportadora cadastrada com este CNPJ/CPF")
    company = TransportCompany(**company_input.model_dump(), created_by=current_user['sub'])

    doc = company.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.transport_companies.insert_one(doc)

    return TransportCompanyResponse(**company.model_dump())

@api_router.get("/transport-companies", response_model=List[TransportCompanyResponse])
async def get_transport_companies(
    page: int = 1,
    per_page: int = 0,  # 0 = sem limite
    current_user: dict = Depends(get_current_active_user)
):
    companies = await _list_query(db.transport_companies, page, per_page)
    return [
        TransportCompanyResponse(**{**c, "created_at": datetime.fromisoformat(c['created_at'])})
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
    await _ensure_unique_document(db.transport_companies, "cnpj", company_input.cnpj, company_id, "Já existe uma transportadora cadastrada com este CNPJ/CPF")

    update_data = {
        **company_input.model_dump(),
        "id": company_id,
        "created_at": existing['created_at'],
        "created_by": existing['created_by']
    }

    await db.transport_companies.replace_one({"id": company_id}, update_data)

    return TransportCompanyResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})

@api_router.delete("/transport-companies/{company_id}")
async def delete_transport_company(company_id: str, current_user: dict = Depends(get_current_active_user)):
    company = await db.transport_companies.find_one({"id": company_id}, {"_id": 0, "name": 1})
    if not company:
        raise HTTPException(status_code=404, detail="Transportadora não encontrada")
    await _ensure_not_in_use([
        (db.movements, {"transport_company": _name_regex(company['name'])}, "movimentação(ões)"),
        (db.drivers, {"transport_company": _name_regex(company['name'])}, "motorista(s) vinculado(s)"),
        (db.vehicle_checklists, {"transport_company_id": company_id}, "checklist(s)"),
    ], "Transportadora")
    result = await db.transport_companies.delete_one({"id": company_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Transportadora não encontrada")
    return {"message": "Transportadora deletada com sucesso"}

# CRUD de Clientes
@api_router.post("/clients", response_model=ClientResponse)
async def create_client(client_input: ClientCreate, current_user: dict = Depends(get_current_active_user)):
    await _ensure_unique_client_name(client_input.name, None)
    await _ensure_unique_document(db.clients, "cnpj", client_input.cnpj, None, "Já existe um cliente cadastrado com este CNPJ/CPF")
    client = Client(**client_input.model_dump(), created_by=current_user['sub'])

    doc = client.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.clients.insert_one(doc)

    return ClientResponse(**client.model_dump())

@api_router.get("/clients", response_model=List[ClientResponse])
async def get_clients(
    page: int = 1,
    per_page: int = 0,  # 0 = sem limite (antes cortava em 100 e cliente antigo sumia das telas)
    current_user: dict = Depends(get_current_active_user)
):
    clients = await _list_query(db.clients, page, per_page)
    return [
        ClientResponse(**{**c, "created_at": datetime.fromisoformat(c['created_at'])})
        for c in clients
    ]

@api_router.put("/clients/{client_id}", response_model=ClientResponse)
async def update_client(client_id: str, client_input: ClientCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    await _ensure_unique_client_name(client_input.name, client_id)
    await _ensure_unique_document(db.clients, "cnpj", client_input.cnpj, client_id, "Já existe um cliente cadastrado com este CNPJ/CPF")

    update_data = {
        **client_input.model_dump(),
        "id": client_id,
        "created_at": existing['created_at'],
        "created_by": existing['created_by']
    }

    await db.clients.replace_one({"id": client_id}, update_data)

    # Renomeou: a Tabela de Serviços (Diária de Armazenagem) e os Vínculos de
    # Representante comparam pelo nome guardado neles, então acompanham o
    # nome novo. EIRs/faturas já lançados ficam com o nome da época.
    if (existing.get('name') or '').strip() != (client_input.name or '').strip():
        for collection in (db.service_price_entries, db.client_representative_links):
            await collection.update_many({"client_id": client_id}, {"$set": {"client_name": client_input.name}})

    return ClientResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})

@api_router.delete("/clients/{client_id}")
async def delete_client(client_id: str, current_user: dict = Depends(get_current_active_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    by_name = {"client_name": _name_regex(client['name'])}
    await _ensure_not_in_use([
        (db.movements, by_name, "movimentação(ões)"),
        (db.invoices, by_name, "fatura(s)"),
        (db.service_price_entries, {"client_id": client_id}, "item(ns) da Tabela de Serviços"),
        (db.client_representative_links, {"client_id": client_id}, "vínculo(s) com representante"),
        (db.port_services, {"client_id": client_id}, "serviço(s) portuário(s)"),
        (db.container_inspections, {"client_id": client_id}, "registro(s) fotográfico(s)"),
        (db.container_audits, {"client_id": client_id}, "auditoria(s)"),
        (db.flex_tank_movements, {"client_id": client_id}, "movimentação(ões) de Flex Tank"),
        (db.unit_segregations, {"client_id": client_id}, "segregação(ões) de unidade"),
    ], "Cliente")
    result = await db.clients.delete_one({"id": client_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    return {"message": "Cliente deletado com sucesso"}

# CRUD de Fornecedores
@api_router.post("/suppliers", response_model=SupplierResponse)
async def create_supplier(supplier_input: SupplierCreate, current_user: dict = Depends(get_current_active_user)):
    await _ensure_unique_document(db.suppliers, "cnpj", supplier_input.cnpj, None, "Já existe um fornecedor cadastrado com este CNPJ/CPF")
    supplier = Supplier(**supplier_input.model_dump(), created_by=current_user['sub'])

    doc = supplier.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.suppliers.insert_one(doc)

    return SupplierResponse(**supplier.model_dump())

@api_router.get("/suppliers", response_model=List[SupplierResponse])
async def get_suppliers(
    page: int = 1,
    per_page: int = 0,  # 0 = sem limite
    current_user: dict = Depends(get_current_active_user)
):
    suppliers = await _list_query(db.suppliers, page, per_page)
    return [
        SupplierResponse(**{**s, "created_at": datetime.fromisoformat(s['created_at'])})
        for s in suppliers
    ]

@api_router.put("/suppliers/{supplier_id}", response_model=SupplierResponse)
async def update_supplier(supplier_id: str, supplier_input: SupplierCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.suppliers.find_one({"id": supplier_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado")
    await _ensure_unique_document(db.suppliers, "cnpj", supplier_input.cnpj, supplier_id, "Já existe um fornecedor cadastrado com este CNPJ/CPF")

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
    await _ensure_not_in_use([
        (db.fuel_supplies, {"supplier_id": supplier_id}, "abastecimento(s)"),
        (db.fuel_supply_orders, {"supplier_id": supplier_id}, "ordem(ns) de abastecimento"),
        (db.stock_entries, {"supplier_id": supplier_id}, "entrada(s) de estoque"),
        (db.stock_movements, {"supplier_id": supplier_id}, "movimentação(ões) de estoque"),
        (db.expense_reports, {"purchases.supplier_id": supplier_id}, "prestação(ões) de contas"),
    ], "Fornecedor")
    result = await db.suppliers.delete_one({"id": supplier_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado")
    return {"message": "Fornecedor deletado com sucesso"}

# CRUD de Terminal (Cadastro, dentro do grupo Terminal)
@api_router.post("/terminals", response_model=TerminalResponse)
async def create_terminal(terminal_input: TerminalCreate, current_user: dict = Depends(get_current_active_user)):
    await _ensure_unique_document(db.terminals, "cnpj", terminal_input.cnpj, None, "Já existe um terminal cadastrado com este CNPJ")
    terminal = Terminal(**terminal_input.model_dump(), created_by=current_user['sub'])

    doc = terminal.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.terminals.insert_one(doc)

    return TerminalResponse(**terminal.model_dump())

@api_router.get("/terminals", response_model=List[TerminalResponse])
async def get_terminals(
    page: int = 1,
    per_page: int = 0,  # 0 = sem limite
    current_user: dict = Depends(get_current_active_user)
):
    terminals = await _list_query(db.terminals, page, per_page)
    return [
        TerminalResponse(**{**t, "created_at": datetime.fromisoformat(t['created_at'])})
        for t in terminals
    ]

@api_router.put("/terminals/{terminal_id}", response_model=TerminalResponse)
async def update_terminal(terminal_id: str, terminal_input: TerminalCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.terminals.find_one({"id": terminal_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Terminal não encontrado")
    await _ensure_unique_document(db.terminals, "cnpj", terminal_input.cnpj, terminal_id, "Já existe um terminal cadastrado com este CNPJ")

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
    terminal = await db.terminals.find_one({"id": terminal_id}, {"_id": 0, "name": 1})
    if not terminal:
        raise HTTPException(status_code=404, detail="Terminal não encontrado")
    await _ensure_not_in_use([
        (db.movements, {"origin_terminal": _name_regex(terminal['name'])}, "movimentação(ões)"),
    ], "Terminal")
    result = await db.terminals.delete_one({"id": terminal_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Terminal não encontrado")
    return {"message": "Terminal deletado com sucesso"}

# CRUD de Funcionário
@api_router.post("/employees", response_model=EmployeeResponse)
async def create_employee(employee_input: EmployeeCreate, current_user: dict = Depends(get_current_active_user)):
    await _ensure_unique_document(db.employees, "cpf", employee_input.cpf, None, "Já existe um funcionário cadastrado com este CPF")
    employee = Employee(**employee_input.model_dump(), created_by=current_user['sub'])
    employee.signature_url = _incoming_signature(employee_input, 'funcionario', employee.id, None)

    doc = employee.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.employees.insert_one(doc)

    return EmployeeResponse(**employee.model_dump())

@api_router.get("/employees", response_model=List[EmployeeResponse])
async def get_employees(
    page: int = 1,
    per_page: int = 0,  # 0 = sem limite
    current_user: dict = Depends(get_current_active_user)
):
    employees = await _list_query(db.employees, page, per_page)
    return [
        EmployeeResponse(**{**e, "created_at": datetime.fromisoformat(e['created_at'])})
        for e in employees
    ]

@api_router.put("/employees/{employee_id}", response_model=EmployeeResponse)
async def update_employee(employee_id: str, employee_input: EmployeeCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.employees.find_one({"id": employee_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Funcionário não encontrado")
    await _ensure_unique_document(db.employees, "cpf", employee_input.cpf, employee_id, "Já existe um funcionário cadastrado com este CPF")

    # Campo que nem veio no corpo mantém o valor salvo (fotos e anexos que
    # o formulário não mostra eram apagados a cada edição)
    update_data = {
        **{k: v for k, v in existing.items() if k in EmployeeCreate.model_fields and k not in employee_input.model_fields_set},
        **employee_input.model_dump(exclude_unset=True),
        "id": employee_id,
        "created_at": existing['created_at'],
        "created_by": existing['created_by']
    }
    update_data['signature_url'] = _incoming_signature(employee_input, 'funcionario', employee_id, existing.get('signature_url'))

    await db.employees.replace_one({"id": employee_id}, update_data)

    return EmployeeResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})

class SignatureUpdate(PydanticBaseModel):
    signature: Optional[str] = None  # data URL da imagem, ou vazio pra remover


@api_router.put("/signatures/{kind}/{person_id}")
async def update_person_signature(kind: str, person_id: str, data: SignatureUpdate, current_user: dict = Depends(get_current_active_user)):
    """Grava só a assinatura de um Motorista/Funcionário, sem reenviar o
    cadastro inteiro - usado pelo "Assinar agora" da Entrega de EPI's."""
    collection = {'motorista': db.drivers, 'funcionario': db.employees}.get(kind)
    if collection is None:
        raise HTTPException(status_code=404, detail="Tipo de cadastro inválido")
    existing = await collection.find_one({"id": person_id}, {"_id": 0, "id": 1, "signature_url": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Cadastro não encontrado")
    url = save_signature_value(kind, person_id, data.signature, existing.get('signature_url'))
    await collection.update_one({"id": person_id}, {"$set": {"signature_url": url}})
    return {"signature_url": url}


@api_router.delete("/employees/{employee_id}")
async def delete_employee(employee_id: str, current_user: dict = Depends(get_current_active_user)):
    await _ensure_not_in_use([
        (db.ordem_servico, {"person_id": employee_id}, "ordem(ns) de serviço"),
        (db.epi_deliveries, {"recipient_id": employee_id}, "entrega(s) de EPI"),
        (db.gratifications, {"person_type": "FUNCIONARIO", "person_id": employee_id}, "gratificação(ões)"),
    ], "Funcionário")
    result = await db.employees.delete_one({"id": employee_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Funcionário não encontrado")
    return {"message": "Funcionário deletado com sucesso"}

# CRUD de Seguradora
@api_router.post("/insurance-companies", response_model=InsuranceCompanyResponse)
async def create_insurance_company(insurance_input: InsuranceCompanyCreate, current_user: dict = Depends(get_current_active_user)):
    await _ensure_unique_document(db.insurance_companies, "cnpj", insurance_input.cnpj, None, "Já existe uma seguradora cadastrada com este CNPJ")
    insurance = InsuranceCompany(**insurance_input.model_dump(), created_by=current_user['sub'])

    doc = insurance.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.insurance_companies.insert_one(doc)

    return InsuranceCompanyResponse(**insurance.model_dump())

@api_router.get("/insurance-companies", response_model=List[InsuranceCompanyResponse])
async def get_insurance_companies(
    page: int = 1,
    per_page: int = 0,  # 0 = sem limite
    current_user: dict = Depends(get_current_active_user)
):
    items = await _list_query(db.insurance_companies, page, per_page)
    return [
        InsuranceCompanyResponse(**{**i, "created_at": datetime.fromisoformat(i['created_at'])})
        for i in items
    ]

@api_router.put("/insurance-companies/{insurance_id}", response_model=InsuranceCompanyResponse)
async def update_insurance_company(insurance_id: str, insurance_input: InsuranceCompanyCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.insurance_companies.find_one({"id": insurance_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Seguradora não encontrada")
    await _ensure_unique_document(db.insurance_companies, "cnpj", insurance_input.cnpj, insurance_id, "Já existe uma seguradora cadastrada com este CNPJ")

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

@api_router.get("/service-types")
async def get_service_types(
    page: int = 1,
    per_page: int = 50,
    search: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    query = {}
    if search:
        query["name"] = {"$regex": re.escape(search), "$options": "i"}

    skip = (page - 1) * per_page
    total = await db.service_types.count_documents(query)
    service_types = await db.service_types.find(query, {"_id": 0}).sort("name", 1).skip(skip).limit(per_page).to_list(per_page)
    items = [
        ServiceTypeResponse(
            id=st['id'],
            name=st['name'],
            description=st.get('description'),
            created_at=datetime.fromisoformat(st['created_at'])
        )
        for st in service_types
    ]
    return {
        "items": items,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page
    }

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
    
    # Extensão, tamanho e conteúdo - mesma validação dos outros uploads
    file_ext, content = await validate_and_read_upload(file, ALLOWED_EXTENSIONS)
    logging.info(f"[Upload] Arquivo lido: {len(content)} bytes")

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

@api_router.post("/documents/read")
async def read_document_file(
    kind: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_active_user)
):
    """Lê uma CNH, RG/CIN ou CRLV (foto ou PDF) e devolve os campos para o
    formulário de cadastro, que o usuário confere antes de salvar. Lido o
    documento, o arquivo fica guardado (menos a CNH, da qual só os dados
    interessam) e a URL volta em file_url, para ir junto com o cadastro em
    document_attachments."""
    if kind not in DOCUMENT_KINDS:
        raise HTTPException(status_code=400, detail="Tipo de documento inválido")
    file_ext, content = await validate_and_read_upload(file, ALLOWED_RECEIPT_EXTENSIONS)
    reading = await read_document(kind, content, file_ext)
    reading["file_url"] = None
    if reading["found"] and DOCUMENT_KINDS[kind].get("keep_file", True):
        filename = f"{uuid.uuid4()}{file_ext}"
        with open(UPLOADS_DIR / filename, 'wb') as f:
            f.write(content)
        reading["file_url"] = f"/api/uploads/{filename}"
    return reading


@api_router.delete("/upload/{filename}")
async def delete_file(filename: str, current_user: dict = Depends(get_current_admin_user)):
    """Deletar arquivo do servidor. Restrito a administradores: o arquivo não
    guarda quem o enviou nem a que registro pertence, então qualquer usuário
    logado conseguia apagar um anexo alheio só por saber o nome."""
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

