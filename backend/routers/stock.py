import io
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List

from models import (
    Warehouse, WarehouseCreate, WarehouseResponse,
    ProductFamily, ProductFamilyCreate, ProductFamilyResponse,
    ServiceFamily, ServiceFamilyCreate, ServiceFamilyResponse,
    ServiceCatalogItem, ServiceCatalogItemCreate, ServiceCatalogItemResponse,
    Product, ProductCreate, ProductResponse,
    StockEntry, StockEntryResponse,
    Supplier,
)
from shared import db, get_current_active_user, get_company_settings, validate_and_read_upload
from reports import generate_stock_report_excel, generate_stock_report_pdf
from nfe_import import parse_nfe_xml

api_router = APIRouter(prefix="/api")

# ==================== ALMOXARIFADO ====================

@api_router.post("/warehouses", response_model=WarehouseResponse)
async def create_warehouse(data: WarehouseCreate, current_user: dict = Depends(get_current_active_user)):
    warehouse = Warehouse(**data.model_dump(), created_by=current_user['sub'])
    doc = warehouse.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.warehouses.insert_one(doc)
    return WarehouseResponse(**warehouse.model_dump())

@api_router.get("/warehouses", response_model=List[WarehouseResponse])
async def get_warehouses(current_user: dict = Depends(get_current_active_user)):
    items = await db.warehouses.find({}, {"_id": 0}).sort("name", 1).to_list(None)
    return [WarehouseResponse(**{**i, "created_at": datetime.fromisoformat(i['created_at'])}) for i in items]

@api_router.put("/warehouses/{item_id}", response_model=WarehouseResponse)
async def update_warehouse(item_id: str, data: WarehouseCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.warehouses.find_one({"id": item_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Almoxarifado não encontrado")
    update_data = {**data.model_dump(), "id": item_id, "created_at": existing['created_at'], "created_by": existing['created_by']}
    await db.warehouses.replace_one({"id": item_id}, update_data)
    return WarehouseResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})

@api_router.delete("/warehouses/{item_id}")
async def delete_warehouse(item_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.warehouses.delete_one({"id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Almoxarifado não encontrado")
    return {"message": "Almoxarifado removido com sucesso"}


# ==================== FAMÍLIA DE PRODUTO ====================

@api_router.post("/product-families", response_model=ProductFamilyResponse)
async def create_product_family(data: ProductFamilyCreate, current_user: dict = Depends(get_current_active_user)):
    family = ProductFamily(**data.model_dump(), created_by=current_user['sub'])
    doc = family.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.product_families.insert_one(doc)
    return ProductFamilyResponse(**family.model_dump())

@api_router.get("/product-families", response_model=List[ProductFamilyResponse])
async def get_product_families(current_user: dict = Depends(get_current_active_user)):
    items = await db.product_families.find({}, {"_id": 0}).sort("name", 1).to_list(None)
    return [ProductFamilyResponse(**{**i, "created_at": datetime.fromisoformat(i['created_at'])}) for i in items]

@api_router.put("/product-families/{item_id}", response_model=ProductFamilyResponse)
async def update_product_family(item_id: str, data: ProductFamilyCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.product_families.find_one({"id": item_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Família de Produto não encontrada")
    update_data = {**data.model_dump(), "id": item_id, "created_at": existing['created_at'], "created_by": existing['created_by']}
    await db.product_families.replace_one({"id": item_id}, update_data)
    return ProductFamilyResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})

@api_router.delete("/product-families/{item_id}")
async def delete_product_family(item_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.product_families.delete_one({"id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Família de Produto não encontrada")
    return {"message": "Família de Produto removida com sucesso"}


# ==================== FAMÍLIA DE SERVIÇO ====================

@api_router.post("/service-families", response_model=ServiceFamilyResponse)
async def create_service_family(data: ServiceFamilyCreate, current_user: dict = Depends(get_current_active_user)):
    family = ServiceFamily(**data.model_dump(), created_by=current_user['sub'])
    doc = family.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.service_families.insert_one(doc)
    return ServiceFamilyResponse(**family.model_dump())

@api_router.get("/service-families", response_model=List[ServiceFamilyResponse])
async def get_service_families(current_user: dict = Depends(get_current_active_user)):
    items = await db.service_families.find({}, {"_id": 0}).sort("name", 1).to_list(None)
    return [ServiceFamilyResponse(**{**i, "created_at": datetime.fromisoformat(i['created_at'])}) for i in items]

@api_router.put("/service-families/{item_id}", response_model=ServiceFamilyResponse)
async def update_service_family(item_id: str, data: ServiceFamilyCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.service_families.find_one({"id": item_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Família de Serviço não encontrada")
    update_data = {**data.model_dump(), "id": item_id, "created_at": existing['created_at'], "created_by": existing['created_by']}
    await db.service_families.replace_one({"id": item_id}, update_data)
    return ServiceFamilyResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})

@api_router.delete("/service-families/{item_id}")
async def delete_service_family(item_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.service_families.delete_one({"id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Família de Serviço não encontrada")
    return {"message": "Família de Serviço removida com sucesso"}


# ==================== CADASTRO DE SERVIÇO ====================

@api_router.get("/service-catalog/next-code")
async def get_next_service_code(current_user: dict = Depends(get_current_active_user)):
    counter = await db.counters.find_one({"_id": "service_catalog_code"})
    return {"next_code": (counter["seq"] + 1) if counter else 1}

@api_router.post("/service-catalog", response_model=ServiceCatalogItemResponse)
async def create_service_catalog_item(data: ServiceCatalogItemCreate, current_user: dict = Depends(get_current_active_user)):
    counter = await db.counters.find_one_and_update(
        {"_id": "service_catalog_code"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    item = ServiceCatalogItem(code=counter["seq"], **data.model_dump(), created_by=current_user['sub'])
    doc = item.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.service_catalog.insert_one(doc)
    return ServiceCatalogItemResponse(**item.model_dump())

@api_router.get("/service-catalog", response_model=List[ServiceCatalogItemResponse])
async def get_service_catalog(current_user: dict = Depends(get_current_active_user)):
    items = await db.service_catalog.find({}, {"_id": 0}).sort("code", 1).to_list(None)
    return [ServiceCatalogItemResponse(**{**i, "created_at": datetime.fromisoformat(i['created_at'])}) for i in items]

@api_router.put("/service-catalog/{item_id}", response_model=ServiceCatalogItemResponse)
async def update_service_catalog_item(item_id: str, data: ServiceCatalogItemCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.service_catalog.find_one({"id": item_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Serviço não encontrado")
    update_data = {
        **data.model_dump(), "id": item_id, "code": existing['code'],
        "created_at": existing['created_at'], "created_by": existing['created_by']
    }
    await db.service_catalog.replace_one({"id": item_id}, update_data)
    return ServiceCatalogItemResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})

@api_router.delete("/service-catalog/{item_id}")
async def delete_service_catalog_item(item_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.service_catalog.delete_one({"id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Serviço não encontrado")
    return {"message": "Serviço removido com sucesso"}


# ==================== PRODUTO ====================

@api_router.get("/products/next-code")
async def get_next_product_code(current_user: dict = Depends(get_current_active_user)):
    counter = await db.counters.find_one({"_id": "product_code"})
    return {"next_code": (counter["seq"] + 1) if counter else 1}

@api_router.post("/products", response_model=ProductResponse)
async def create_product(data: ProductCreate, current_user: dict = Depends(get_current_active_user)):
    counter = await db.counters.find_one_and_update(
        {"_id": "product_code"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    product = Product(
        code=counter["seq"], **data.model_dump(),
        created_by=current_user['sub'], created_by_name=current_user['name']
    )
    doc = product.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.products.insert_one(doc)
    return ProductResponse(**product.model_dump())

@api_router.get("/products", response_model=List[ProductResponse])
async def get_products(search: str = None, current_user: dict = Depends(get_current_active_user)):
    query = {}
    if search:
        import re
        search_escaped = re.escape(search)
        query["$or"] = [
            {"description": {"$regex": search_escaped, "$options": "i"}},
            {"barcode": {"$regex": search_escaped, "$options": "i"}},
        ]
    items = await db.products.find(query, {"_id": 0}).sort("code", -1).to_list(None)
    return [ProductResponse(**{**i, "created_at": datetime.fromisoformat(i['created_at'])}) for i in items]

@api_router.put("/products/{item_id}", response_model=ProductResponse)
async def update_product(item_id: str, data: ProductCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.products.find_one({"id": item_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    update_data = {
        **data.model_dump(), "id": item_id, "code": existing['code'],
        "created_at": existing['created_at'], "created_by": existing['created_by'],
        "created_by_name": existing['created_by_name']
    }
    await db.products.replace_one({"id": item_id}, update_data)
    return ProductResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})

@api_router.delete("/products/{item_id}")
async def delete_product(item_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.products.delete_one({"id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    return {"message": "Produto removido com sucesso"}


# ==================== RELATÓRIO DE ESTOQUE ====================

@api_router.get("/stock/report/excel")
async def download_stock_report_excel(current_user: dict = Depends(get_current_active_user)):
    products = await db.products.find({}, {"_id": 0}).sort("code", 1).to_list(None)
    company = await get_company_settings()
    excel_bytes = generate_stock_report_excel(products, company=company)
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=relatorio_estoque.xlsx"}
    )

@api_router.get("/stock/report/pdf")
async def download_stock_report_pdf(current_user: dict = Depends(get_current_active_user)):
    products = await db.products.find({}, {"_id": 0}).sort("code", 1).to_list(None)
    company = await get_company_settings()
    pdf_bytes = generate_stock_report_pdf(products, company=company)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=relatorio_estoque.pdf"}
    )


# ==================== ENTRADAS DE ESTOQUE (IMPORTAÇÃO DE XML DE NF-e) ====================

ALLOWED_XML_EXTENSIONS = {'.xml'}


def _normalize_text(s: str) -> str:
    return (s or '').strip().lower()


def _only_digits(s: str) -> str:
    return ''.join(ch for ch in (s or '') if ch.isdigit())


async def _match_product(item: dict):
    """Tenta achar um Product já cadastrado pro item da NF-e: primeiro por
    código de barras/EAN exato (mais confiável), senão por NCM + descrição
    normalizada (minúsculo, sem espaços nas pontas) iguais."""
    barcode = (item.get('barcode') or '').strip()
    if barcode:
        found = await db.products.find_one({"barcode": barcode}, {"_id": 0})
        if found:
            return found
    ncm = (item.get('ncm') or '').strip()
    description_norm = _normalize_text(item.get('description'))
    if ncm and description_norm:
        async for p in db.products.find({"ncm": ncm}, {"_id": 0}):
            if _normalize_text(p.get('description')) == description_norm:
                return p
    return None


async def _match_supplier(cnpj: str):
    digits = _only_digits(cnpj)
    if not digits:
        return None
    async for s in db.suppliers.find({}, {"_id": 0}):
        if _only_digits(s.get('cnpj')) == digits:
            return s
    return None


@api_router.post("/stock/nfe-import/parse")
async def parse_nfe_import(file: UploadFile = File(...), current_user: dict = Depends(get_current_active_user)):
    """Recebe o XML da NF-e, extrai emitente + itens e devolve uma prévia
    (com sugestão de Produto/Fornecedor já cadastrados, quando encontrados)
    pra revisão do usuário - não grava nada no banco ainda."""
    _, content = await validate_and_read_upload(file, ALLOWED_XML_EXTENSIONS)
    try:
        parsed = parse_nfe_xml(content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    matched_supplier = await _match_supplier(parsed['supplier_cnpj'])

    items_out = []
    for item in parsed['items']:
        matched_product = await _match_product(item)
        items_out.append({
            **item,
            "matched_product_id": matched_product['id'] if matched_product else None,
            "matched_product_name": matched_product['description'] if matched_product else None,
        })

    return {
        "nfe_number": parsed['nfe_number'],
        "nfe_key": parsed['nfe_key'],
        "nfe_issue_date": parsed['nfe_issue_date'],
        "supplier_cnpj": parsed['supplier_cnpj'],
        "supplier_name": parsed['supplier_name'],
        "matched_supplier_id": matched_supplier['id'] if matched_supplier else None,
        "matched_supplier_name": matched_supplier['name'] if matched_supplier else None,
        "items": items_out,
    }


class NfeImportItemConfirm(BaseModel):
    barcode: Optional[str] = None
    description: str
    ncm: Optional[str] = None
    cfop: Optional[str] = None
    unit: Optional[str] = None
    quantity: float
    unit_value: float = 0.0
    total_value: float = 0.0
    matched_product_id: Optional[str] = None  # None = criar produto novo


class NfeImportConfirm(BaseModel):
    nfe_number: Optional[str] = None
    nfe_key: Optional[str] = None
    nfe_issue_date: Optional[str] = None
    supplier_cnpj: Optional[str] = None
    supplier_name: Optional[str] = None
    matched_supplier_id: Optional[str] = None  # None = criar fornecedor novo a partir do emitente
    items: List[NfeImportItemConfirm]


@api_router.post("/stock/nfe-import/confirm")
async def confirm_nfe_import(data: NfeImportConfirm, current_user: dict = Depends(get_current_active_user)):
    """Efetiva a importação revisada: cria/atualiza o Fornecedor, cria
    Produtos novos (quando o item não foi vinculado a um já existente),
    soma a quantidade em Product.stock_quantity e grava um StockEntry por
    item, pra manter o extrato de onde cada entrada veio."""
    if not data.items:
        raise HTTPException(status_code=400, detail="Nenhum item para importar")
    for item in data.items:
        if not item.description.strip():
            raise HTTPException(status_code=400, detail="Há um item sem descrição")
        if item.quantity <= 0:
            raise HTTPException(status_code=400, detail=f"Quantidade inválida para o item \"{item.description}\"")

    supplier_id = data.matched_supplier_id
    supplier_name = (data.supplier_name or '').strip() or None
    if not supplier_id and supplier_name:
        supplier = Supplier(name=supplier_name, cnpj=data.supplier_cnpj, created_by=current_user['sub'])
        doc = supplier.model_dump()
        doc['created_at'] = doc['created_at'].isoformat()
        await db.suppliers.insert_one(doc)
        supplier_id = supplier.id

    products_created = 0
    products_updated = 0

    for item in data.items:
        if item.matched_product_id:
            product_doc = await db.products.find_one({"id": item.matched_product_id}, {"_id": 0})
            if not product_doc:
                raise HTTPException(status_code=404, detail=f"Produto vinculado não encontrado: {item.description}")
            product_id = product_doc['id']
            product_name = product_doc['description']
            new_qty = float(product_doc.get('stock_quantity') or 0) + item.quantity
            await db.products.update_one({"id": product_id}, {"$set": {"stock_quantity": new_qty}})
            products_updated += 1
        else:
            counter = await db.counters.find_one_and_update(
                {"_id": "product_code"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
            )
            product = Product(
                code=counter["seq"],
                description=item.description,
                barcode=item.barcode or None,
                ncm=item.ncm or None,
                cfop=item.cfop or None,
                unit=item.unit or None,
                reference_value=item.unit_value,
                stock_quantity=item.quantity,
                linked_party_name=supplier_name,
                created_by=current_user['sub'], created_by_name=current_user['name'],
            )
            doc = product.model_dump()
            doc['created_at'] = doc['created_at'].isoformat()
            await db.products.insert_one(doc)
            product_id = product.id
            product_name = product.description
            products_created += 1

        entry = StockEntry(
            product_id=product_id, product_name=product_name,
            quantity=item.quantity, unit_value=item.unit_value, total_value=item.total_value,
            supplier_id=supplier_id, supplier_name=supplier_name,
            nfe_number=data.nfe_number, nfe_key=data.nfe_key, nfe_issue_date=data.nfe_issue_date,
            created_by=current_user['sub'], created_by_name=current_user['name'],
        )
        entry_doc = entry.model_dump()
        entry_doc['created_at'] = entry_doc['created_at'].isoformat()
        await db.stock_entries.insert_one(entry_doc)

    return {
        "products_created": products_created,
        "products_updated": products_updated,
        "entries_created": len(data.items),
    }


@api_router.get("/stock/entries", response_model=List[StockEntryResponse])
async def get_stock_entries(current_user: dict = Depends(get_current_active_user)):
    items = await db.stock_entries.find({}, {"_id": 0}).sort("created_at", -1).to_list(None)
    return [StockEntryResponse(**{**i, "created_at": datetime.fromisoformat(i['created_at'])}) for i in items]
