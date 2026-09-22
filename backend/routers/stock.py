import io
import re
from datetime import datetime, timedelta, timezone
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
    StockValueByWarehousePoint, DailyStockLedgerPoint,
    StockEntry, StockEntryResponse,
    StockMovement, StockMovementCreate, StockMovementUpdate, StockMovementResponse,
    Supplier,
)
from shared import db, get_current_active_user, get_company_settings, validate_and_read_upload
from reports import (
    generate_stock_report_excel, generate_stock_report_pdf,
    generate_stock_ledger_report_excel, generate_stock_ledger_report_pdf,
)
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

async def _filter_products_report(
    search: Optional[str] = None,
    warehouse_id: Optional[str] = None,
    family_id: Optional[str] = None,
    status: Optional[str] = None,
):
    query = {}
    if search:
        search_escaped = re.escape(search)
        query["$or"] = [
            {"description": {"$regex": search_escaped, "$options": "i"}},
            {"barcode": {"$regex": search_escaped, "$options": "i"}},
        ]
    if warehouse_id:
        query["warehouse_id"] = warehouse_id
    if family_id:
        query["family_id"] = family_id
    if status:
        query["status"] = status
    return await db.products.find(query, {"_id": 0}).sort("code", 1).to_list(None)


@api_router.get("/stock/report/summary")
async def get_stock_report_summary(
    search: Optional[str] = None,
    warehouse_id: Optional[str] = None,
    family_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    products = await _filter_products_report(search, warehouse_id, family_id, status)
    total_quantity = sum(float(p.get('stock_quantity') or 0) for p in products)
    total_value = sum(float(p.get('stock_quantity') or 0) * float(p.get('reference_value') or 0) for p in products)
    zero_stock_count = sum(1 for p in products if float(p.get('stock_quantity') or 0) <= 0)
    return {
        "count": len(products),
        "total_quantity": total_quantity,
        "total_value": total_value,
        "zero_stock_count": zero_stock_count,
    }


@api_router.get("/stock/report/by-warehouse", response_model=List[StockValueByWarehousePoint])
async def get_stock_report_by_warehouse(
    search: Optional[str] = None,
    warehouse_id: Optional[str] = None,
    family_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    """Agrupa o valor em estoque por Almoxarifado, pro gráfico do relatório."""
    products = await _filter_products_report(search, warehouse_id, family_id, status)
    grouped = {}
    for p in products:
        name = p.get('warehouse_name') or 'Sem Almoxarifado'
        g = grouped.setdefault(name, {"warehouse_name": name, "total_quantity": 0.0, "total_value": 0.0})
        g["total_quantity"] += float(p.get('stock_quantity') or 0)
        g["total_value"] += float(p.get('stock_quantity') or 0) * float(p.get('reference_value') or 0)
    return sorted(grouped.values(), key=lambda x: x["total_value"], reverse=True)


@api_router.get("/stock/report/excel")
async def download_stock_report_excel(
    search: Optional[str] = None,
    warehouse_id: Optional[str] = None,
    family_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    products = await _filter_products_report(search, warehouse_id, family_id, status)
    company = await get_company_settings()
    excel_bytes = generate_stock_report_excel(products, company=company)
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=relatorio_estoque.xlsx"}
    )

@api_router.get("/stock/report/pdf")
async def download_stock_report_pdf(
    search: Optional[str] = None,
    warehouse_id: Optional[str] = None,
    family_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    products = await _filter_products_report(search, warehouse_id, family_id, status)
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


def _merge_duplicate_nfe_items(items: list) -> list:
    """Uma NF-e pode listar o mesmo produto em mais de uma linha <det> (ex:
    lotes/números de série diferentes do mesmo item) - sem isso, cada linha
    vira uma proposta de "produto novo" separada em _match_product (já que
    nenhuma bate no banco ainda na primeira importação), e confirmar cria
    produtos duplicados pro mesmo item. Agrupa pelo MESMO critério de
    _match_product (barcode exato, senão NCM + descrição normalizada,
    exatamente nessa ordem de prioridade) e soma quantidade/valor - roda
    ANTES de tentar casar contra o banco, então o resto do fluxo (match,
    preview, confirmação) já opera em cima de 1 linha por produto."""
    merged: dict = {}
    order: list = []
    for idx, item in enumerate(items):
        barcode = (item.get('barcode') or '').strip()
        ncm = (item.get('ncm') or '').strip()
        description_norm = _normalize_text(item.get('description'))
        if barcode:
            key = ('barcode', barcode)
        elif ncm and description_norm:
            key = ('ncm_desc', ncm, description_norm)
        else:
            # Sem barcode nem NCM+descrição pra identificar com confiança -
            # nunca funde (mesmo critério de _match_product: sem chave
            # confiável, não casa com nada).
            key = ('unmatched', idx)

        if key not in merged:
            merged[key] = dict(item)
            order.append(key)
        else:
            merged[key]['quantity'] = (merged[key].get('quantity') or 0) + (item.get('quantity') or 0)
            merged[key]['total_value'] = (merged[key].get('total_value') or 0) + (item.get('total_value') or 0)

    result = []
    for key in order:
        m = merged[key]
        if m.get('quantity'):
            m['unit_value'] = round(m['total_value'] / m['quantity'], 4)
        result.append(m)
    return result


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
    merged_items = _merge_duplicate_nfe_items(parsed['items'])

    items_out = []
    for item in merged_items:
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


# ==================== MOVIMENTAÇÃO DE ESTOQUE (ENTRADA/SAÍDA MANUAL) ====================

def _stock_movement_serialize(doc: dict) -> dict:
    out = {**doc}
    if isinstance(out.get('created_at'), str):
        out['created_at'] = datetime.fromisoformat(out['created_at'])
    if isinstance(out.get('updated_at'), str):
        out['updated_at'] = datetime.fromisoformat(out['updated_at'])
    out['total_value'] = round(sum(float(i.get('total_value') or 0) for i in (out.get('items') or [])), 2)
    return out


def _stock_movement_effect_by_product(operation_type: str, items) -> dict:
    """Soma, por produto, o quanto uma movimentação altera o estoque (+ pra
    Entrada, - pra Saída). `items` aceita tanto dict (documento do Mongo)
    quanto StockMovementItem (Pydantic, no create/update)."""
    sign = 1 if operation_type == "ENTRADA" else -1
    out = {}
    for it in items:
        pid = it.get('product_id') if isinstance(it, dict) else it.product_id
        qty = it.get('quantity') if isinstance(it, dict) else it.quantity
        out[pid] = out.get(pid, 0) + sign * float(qty or 0)
    return out


@api_router.get("/stock/movements/next-number")
async def get_next_stock_movement_number(current_user: dict = Depends(get_current_active_user)):
    """Só uma prévia pra exibir na tela; o número real é reservado de forma
    atômica na criação (mesmo padrão de Ordem de Serviço/RPA/etc.)."""
    counter = await db.counters.find_one({"_id": "stock_movement_number"})
    return {"next_number": (counter["seq"] + 1) if counter else 1}


@api_router.post("/stock/movements", response_model=StockMovementResponse)
async def create_stock_movement(data: StockMovementCreate, current_user: dict = Depends(get_current_active_user)):
    if not data.items:
        raise HTTPException(status_code=400, detail="Adicione ao menos um item à movimentação")
    for item in data.items:
        if item.quantity <= 0:
            raise HTTPException(status_code=400, detail=f"Quantidade inválida para o item \"{item.product_description}\"")

    # Carrega os produtos e confere saldo ANTES de gravar qualquer coisa -
    # numa Saída, nenhum item deve ser aplicado se algum deles não tiver
    # saldo suficiente (evita baixa parcial no estoque).
    products_by_id = {}
    for item in data.items:
        product = await db.products.find_one({"id": item.product_id}, {"_id": 0})
        if not product:
            raise HTTPException(status_code=404, detail=f"Produto não encontrado: {item.product_description}")
        products_by_id[item.product_id] = product
    if data.operation_type == "SAIDA":
        # Soma por produto antes de comparar - o mesmo produto pode aparecer
        # em mais de uma linha, e validar cada linha isolada contra o mesmo
        # saldo deixaria passar uma soma que no total excede o estoque.
        requested_by_product = {}
        for item in data.items:
            requested_by_product[item.product_id] = requested_by_product.get(item.product_id, 0) + item.quantity
        for product_id, requested in requested_by_product.items():
            available = float(products_by_id[product_id].get('stock_quantity') or 0)
            if available < requested:
                raise HTTPException(
                    status_code=400,
                    detail=f"Saldo insuficiente para \"{products_by_id[product_id]['description']}\": "
                           f"disponível {available:g}, solicitado {requested:g}"
                )

    counter = await db.counters.find_one_and_update(
        {"_id": "stock_movement_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    movement = StockMovement(
        movement_number=counter["seq"],
        **data.model_dump(),
        created_by=current_user['sub'],
        created_by_name=current_user['name'],
    )

    sign = 1 if movement.operation_type == "ENTRADA" else -1
    for item in movement.items:
        await db.products.update_one({"id": item.product_id}, {"$inc": {"stock_quantity": sign * item.quantity}})

    doc = movement.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.stock_movements.insert_one(doc)
    return _stock_movement_serialize(doc)


@api_router.put("/stock/movements/{movement_id}", response_model=StockMovementResponse)
async def update_stock_movement(movement_id: str, data: StockMovementUpdate, current_user: dict = Depends(get_current_active_user)):
    """Edita uma Movimentação já lançada. Recalcula o efeito no estoque como
    a DIFERENÇA entre o que a movimentação antiga já aplicou e o que a nova
    versão deveria aplicar (por produto) - assim cobre trocar quantidade,
    trocar Entrada<->Saída, adicionar/remover item, tudo num único ajuste
    atômico por produto, sem precisar desfazer e refazer em duas etapas."""
    existing = await db.stock_movements.find_one({"id": movement_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Movimentação de Estoque não encontrada")
    if not data.items:
        raise HTTPException(status_code=400, detail="Adicione ao menos um item à movimentação")
    for item in data.items:
        if item.quantity <= 0:
            raise HTTPException(status_code=400, detail=f"Quantidade inválida para o item \"{item.product_description}\"")

    old_effect = _stock_movement_effect_by_product(existing.get('operation_type'), existing.get('items') or [])
    new_effect = _stock_movement_effect_by_product(data.operation_type, data.items)
    net_delta = {
        pid: new_effect.get(pid, 0) - old_effect.get(pid, 0)
        for pid in set(old_effect) | set(new_effect)
    }

    products_by_id = {}
    for pid in net_delta:
        product = await db.products.find_one({"id": pid}, {"_id": 0})
        if not product:
            raise HTTPException(status_code=404, detail=f"Produto vinculado a esta movimentação não foi encontrado (id {pid})")
        products_by_id[pid] = product
    for pid, delta in net_delta.items():
        if delta < 0:
            available = float(products_by_id[pid].get('stock_quantity') or 0)
            if available + delta < 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Saldo insuficiente para \"{products_by_id[pid]['description']}\" com essa edição: "
                           f"disponível {available:g}, faltariam {-(available + delta):g}"
                )

    for pid, delta in net_delta.items():
        if delta != 0:
            await db.products.update_one({"id": pid}, {"$inc": {"stock_quantity": delta}})

    update_data = {
        **data.model_dump(),
        "id": movement_id,
        "movement_number": existing["movement_number"],
        "created_by": existing["created_by"],
        "created_by_name": existing["created_by_name"],
        "created_at": existing["created_at"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.stock_movements.replace_one({"id": movement_id}, update_data)
    return _stock_movement_serialize(update_data)


@api_router.get("/stock/movements", response_model=List[StockMovementResponse])
async def get_stock_movements(
    search: Optional[str] = None,
    operation_type: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    query = {}
    if operation_type:
        query['operation_type'] = operation_type
    if search:
        search_escaped = re.escape(search)
        query["$or"] = [
            {"purpose_text": {"$regex": search_escaped, "$options": "i"}},
            {"purpose_vehicle_plate": {"$regex": search_escaped, "$options": "i"}},
            {"nfe_number": {"$regex": search_escaped, "$options": "i"}},
            {"warehouse_name": {"$regex": search_escaped, "$options": "i"}},
        ]
    items = await db.stock_movements.find(query, {"_id": 0}).sort("movement_number", -1).to_list(None)
    return [_stock_movement_serialize(i) for i in items]


@api_router.get("/stock/movements/{movement_id}", response_model=StockMovementResponse)
async def get_stock_movement(movement_id: str, current_user: dict = Depends(get_current_active_user)):
    doc = await db.stock_movements.find_one({"id": movement_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Movimentação de Estoque não encontrada")
    return _stock_movement_serialize(doc)


@api_router.get("/stock/movements/{movement_id}/pdf")
async def download_stock_movement_pdf(movement_id: str, current_user: dict = Depends(get_current_active_user)):
    """Gera o PDF da Movimentação de Estoque no mesmo layout visual do
    comprovante de Registro de Gate/EIR - mesmo padrão já usado em Ordem de
    Serviço e Ordem de Carregamento."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.graphics.barcode import code128
    from xml.sax.saxutils import escape as xml_escape
    from reports import (
        download_logo, _build_pdf_header, _voucher_field_row, _voucher_boxed_section,
        merge_company, now_brt, PRIMARY_COLOR, HEADER_BG_COLOR,
    )

    doc_data = await db.stock_movements.find_one({"id": movement_id}, {"_id": 0})
    if not doc_data:
        raise HTTPException(status_code=404, detail="Movimentação de Estoque não encontrada")
    movement = _stock_movement_serialize(doc_data)
    company = merge_company(await get_company_settings())

    def money(v):
        try:
            return f"{float(v or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        except Exception:
            return "0,00"

    def fmt_date(s):
        if not s:
            return None
        try:
            return datetime.fromisoformat(str(s)).strftime('%d/%m/%Y')
        except Exception:
            return str(s)

    def safe_text(value):
        return xml_escape(str(value)) if value not in (None, '') else ''

    OPERATION_LABELS = {'ENTRADA': 'Entrada', 'SAIDA': 'Saída'}
    OPERATION_HEX = {'ENTRADA': '#15803D', 'SAIDA': '#B91C1C'}.get(movement.get('operation_type'), '#000000')

    buffer = io.BytesIO()
    pdf_doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        rightMargin=10 * mm, leftMargin=10 * mm, topMargin=6 * mm, bottomMargin=6 * mm
    )
    width = pdf_doc.width
    styles = getSampleStyleSheet()
    logo_buffer = download_logo(company)

    label_value_style = styles['Normal']
    box_title_style = ParagraphStyle('SMBoxTitle', parent=styles['Normal'], fontSize=9, fontName='Helvetica-Bold')
    title_style = ParagraphStyle('SMTitle', parent=styles['Normal'], fontSize=14, fontName='Helvetica-Bold', alignment=TA_CENTER)
    subtitle_style = ParagraphStyle('SMSubtitle', parent=styles['Normal'], fontSize=10, alignment=TA_CENTER)
    footer_style = ParagraphStyle('SMFooter', parent=styles['Normal'], fontSize=7, alignment=TA_CENTER, textColor=colors.HexColor('#555555'))
    text_block_style = ParagraphStyle('SMTextBlock', parent=styles['Normal'], fontSize=8.5, leading=10.5)
    item_desc_style = ParagraphStyle('SMItemDesc', parent=styles['Normal'], fontSize=7.5, leading=9)

    def field_row(pairs, n_cols=4):
        return _voucher_field_row(pairs, width, label_value_style, n_cols=n_cols)

    def boxed_section(title, row_tables, extra=None):
        return _voucher_boxed_section(title, row_tables, width, box_title_style, extra=extra)

    elements = []
    elements.extend(_build_pdf_header(styles, logo_buffer, '', company=company, content_width=width)[:2])

    title_tbl = Table([
        [Paragraph('MOVIMENTAÇÃO DE ESTOQUE', title_style)],
        [Paragraph(f"Nº {movement['movement_number']} - {OPERATION_LABELS.get(movement.get('operation_type'), movement.get('operation_type'))}", subtitle_style)],
    ], colWidths=[width])
    title_tbl.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1.5, colors.black),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(title_tbl)
    elements.append(Spacer(1, 6))

    elements.append(boxed_section('Dados da Movimentação', [
        field_row([
            ('Operação', f'<font color="{OPERATION_HEX}">{OPERATION_LABELS.get(movement.get("operation_type"), movement.get("operation_type"))}</font>'),
            ('Data', fmt_date(movement.get('movement_date'))),
            ('Nota Fiscal', movement.get('nfe_number')),
            ('Valor Nota Fiscal', money(movement['nfe_value']) if movement.get('nfe_value') is not None else None),
        ]),
        field_row([
            ('Almoxarifado', movement.get('warehouse_name')),
            ('Fornecedor', movement.get('supplier_name')),
            ('Conta Lançamento', movement.get('account_entry')),
        ], n_cols=3),
        field_row([
            ('Finalidade', movement.get('purpose_text')),
        ], n_cols=1),
    ]))
    elements.append(Spacer(1, 6))

    if movement.get('observations'):
        elements.append(boxed_section('Observações', [], extra=[
            Paragraph(safe_text(movement['observations']).replace(chr(10), '<br/>'), text_block_style),
        ]))
        elements.append(Spacer(1, 6))

    item_header = ['Código', 'Descrição', 'Qtd', 'V. Unit.', 'V. Total']
    item_rows = [item_header]
    for it in (movement.get('items') or []):
        item_rows.append([
            str(it.get('product_code')) if it.get('product_code') is not None else '-',
            Paragraph(safe_text(it.get('product_description')) or '-', item_desc_style),
            f"{float(it.get('quantity') or 0):.2f}".replace('.', ','),
            money(it.get('unit_value')),
            money(it.get('total_value')),
        ])
    item_rows.append(['', 'Total', '', '', money(movement.get('total_value'))])
    item_base_widths = [40, 320, 40, 55, 55]
    item_table_width = width - 20
    item_scale = item_table_width / sum(item_base_widths)
    item_t = Table(item_rows, colWidths=[w * item_scale for w in item_base_widths], repeatRows=1)
    item_style = [
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#F5F5F5')),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 7.5),
        ('BOX', (0, 0), (-1, -1), 1, colors.black),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CCCCCC')),
        ('ALIGN', (2, 1), (-1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor(f'#{HEADER_BG_COLOR}')),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
    ]
    if movement.get('items'):
        item_style.append(('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, colors.HexColor('#FAFAFA')]))
    item_t.setStyle(TableStyle(item_style))
    elements.append(boxed_section('Itens', [], extra=[item_t]))
    elements.append(Spacer(1, 6))

    grand_total_style = ParagraphStyle('SMGrandTotal', parent=styles['Normal'], fontSize=11,
                                       fontName='Helvetica-Bold', alignment=TA_CENTER,
                                       textColor=colors.HexColor(f'#{PRIMARY_COLOR}'))
    total_tbl = Table([[Paragraph(f"VALOR TOTAL: {money(movement.get('total_value'))}", grand_total_style)]], colWidths=[width])
    total_tbl.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor(f'#{PRIMARY_COLOR}')),
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(f'#{HEADER_BG_COLOR}')),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    elements.append(total_tbl)
    elements.append(Spacer(1, 8))

    barcode_value = str(movement.get('movement_number') or 0).zfill(6)
    try:
        bc = code128.Code128(barcode_value, barWidth=1.0, barHeight=28)
    except Exception:
        bc = None
    bc_num = Paragraph(f"<b>{movement['movement_number']}</b>", ParagraphStyle('SMBcNum', parent=styles['Normal'], fontSize=8, alignment=TA_CENTER))
    left_cell = [bc, bc_num] if bc else [bc_num]
    right_info = [
        Paragraph(f"<b>Usuário: {safe_text(movement.get('created_by_name')) or '-'}</b>", styles['Normal']),
        Paragraph(f"<b>Data e hora da impressão: {now_brt().strftime('%d/%m/%Y %H:%M')}</b>", styles['Normal']),
    ]
    info_tbl = Table([[left_cell, right_info]], colWidths=[100, width - 100])
    info_tbl.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LINEBELOW', (0, 0), (-1, -1), 1, colors.black),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
    ]))
    elements.append(info_tbl)
    elements.append(Spacer(1, 6))

    elements.append(Paragraph(
        f"{company['name']} | Este documento é válido como comprovante de Movimentação de Estoque",
        footer_style
    ))

    pdf_doc.build(elements)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    filename = f"MovimentacaoEstoque_{movement['movement_number']}.pdf"
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})


# ==================== RELATÓRIO DE MOVIMENTAÇÕES DE ESTOQUE (ENTRADAS E SAÍDAS) ====================
# Une as duas origens reais de entrada/saída de Product.stock_quantity num único
# extrato: StockEntry (só Entrada, sempre vinda de importação de XML de NF-e) e
# StockMovement (Entrada/Saída manual, com Finalidade Veículo/OS/Outro). Cada
# linha do extrato carrega pra onde foi (OS) ou de onde veio (Nota Fiscal).

def _stock_entry_to_ledger_row(entry: dict) -> dict:
    date = (entry.get('nfe_issue_date') or '').strip() or str(entry.get('created_at') or '')[:10]
    nfe_number = entry.get('nfe_number')
    return {
        'date': date,
        'operation_type': 'ENTRADA',
        'product_code': None,
        'product_name': entry.get('product_name') or '-',
        'quantity': float(entry.get('quantity') or 0),
        'unit_value': float(entry.get('unit_value') or 0),
        'total_value': float(entry.get('total_value') or 0),
        'warehouse_name': None,
        'supplier_name': entry.get('supplier_name'),
        'reference_type': 'NFE' if nfe_number else None,
        'reference_label': f"NF {nfe_number}" if nfe_number else None,
        'source': 'ENTRADA_NFE',
    }


def _stock_movement_to_ledger_rows(movement: dict) -> list:
    operation_type = movement.get('operation_type')
    if operation_type == 'ENTRADA' and movement.get('nfe_number'):
        reference_type, reference_label = 'NFE', f"NF {movement['nfe_number']}"
    elif movement.get('purpose_type') == 'OS' and movement.get('purpose_os_number'):
        reference_type, reference_label = 'OS', f"OS Nº {movement['purpose_os_number']}"
    elif movement.get('purpose_type') == 'VEICULO' and movement.get('purpose_vehicle_plate'):
        reference_type, reference_label = 'VEICULO', movement['purpose_vehicle_plate']
    elif movement.get('purpose_text'):
        reference_type, reference_label = 'OUTRO', movement['purpose_text']
    else:
        reference_type, reference_label = None, None

    rows = []
    for item in (movement.get('items') or []):
        rows.append({
            'date': movement.get('movement_date'),
            'operation_type': operation_type,
            'product_code': item.get('product_code'),
            'product_name': item.get('product_description') or '-',
            'quantity': float(item.get('quantity') or 0),
            'unit_value': float(item.get('unit_value') or 0),
            'total_value': float(item.get('total_value') or 0),
            'warehouse_name': movement.get('warehouse_name'),
            'supplier_name': movement.get('supplier_name'),
            'reference_type': reference_type,
            'reference_label': reference_label,
            'source': 'MOVIMENTACAO',
        })
    return rows


async def _build_stock_ledger(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    operation_type: Optional[str] = None,
    search: Optional[str] = None,
    reference_type: Optional[str] = None,
) -> list:
    movements = await db.stock_movements.find({}, {"_id": 0}).to_list(None)
    rows = []
    for m in movements:
        rows.extend(_stock_movement_to_ledger_rows(m))

    if operation_type != 'SAIDA':
        entries = await db.stock_entries.find({}, {"_id": 0}).to_list(None)
        rows.extend(_stock_entry_to_ledger_row(e) for e in entries)

    if operation_type:
        rows = [r for r in rows if r['operation_type'] == operation_type]
    if date_from:
        rows = [r for r in rows if (r['date'] or '') >= date_from]
    if date_to:
        rows = [r for r in rows if (r['date'] or '') <= date_to]
    if search:
        needle = search.strip().lower()
        rows = [r for r in rows if needle in (r['product_name'] or '').lower()]
    if reference_type:
        if reference_type == 'SEM_REFERENCIA':
            rows = [r for r in rows if not r['reference_type']]
        else:
            rows = [r for r in rows if r['reference_type'] == reference_type]

    rows.sort(key=lambda r: r['date'] or '', reverse=True)
    return rows


def _compute_daily_stock_ledger_chart(rows: list) -> list:
    today = datetime.now(timezone.utc).date()
    days = [today - timedelta(days=i) for i in range(13, -1, -1)]
    by_date = {d.isoformat(): {"date": d.isoformat(), "entrada_value": 0.0, "saida_value": 0.0} for d in days}
    for r in rows:
        bucket = by_date.get(r.get('date'))
        if bucket is None:
            continue
        key = 'entrada_value' if r['operation_type'] == 'ENTRADA' else 'saida_value'
        bucket[key] += r['total_value']
    return [by_date[d.isoformat()] for d in days]


@api_router.get("/stock/ledger/summary")
async def get_stock_ledger_summary(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    operation_type: Optional[str] = None,
    search: Optional[str] = None,
    reference_type: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    rows = await _build_stock_ledger(date_from, date_to, operation_type, search, reference_type)
    entrada_rows = [r for r in rows if r['operation_type'] == 'ENTRADA']
    saida_rows = [r for r in rows if r['operation_type'] == 'SAIDA']
    return {
        "entrada_count": len(entrada_rows),
        "entrada_value": round(sum(r['total_value'] for r in entrada_rows), 2),
        "saida_count": len(saida_rows),
        "saida_value": round(sum(r['total_value'] for r in saida_rows), 2),
    }


@api_router.get("/stock/ledger/daily-chart", response_model=List[DailyStockLedgerPoint])
async def get_stock_ledger_daily_chart(current_user: dict = Depends(get_current_active_user)):
    rows = await _build_stock_ledger()
    return _compute_daily_stock_ledger_chart(rows)


@api_router.get("/stock/ledger/pdf")
async def download_stock_ledger_pdf(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    operation_type: Optional[str] = None,
    search: Optional[str] = None,
    reference_type: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    rows = await _build_stock_ledger(date_from, date_to, operation_type, search, reference_type)
    company = await get_company_settings()
    pdf_bytes = generate_stock_ledger_report_pdf(rows, company=company)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=relatorio_movimentacoes_estoque.pdf"}
    )


@api_router.get("/stock/ledger/excel")
async def download_stock_ledger_excel(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    operation_type: Optional[str] = None,
    search: Optional[str] = None,
    reference_type: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    rows = await _build_stock_ledger(date_from, date_to, operation_type, search, reference_type)
    company = await get_company_settings()
    excel_bytes = generate_stock_ledger_report_excel(rows, company=company)
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=relatorio_movimentacoes_estoque.xlsx"}
    )
