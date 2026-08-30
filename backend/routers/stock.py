import io
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from typing import List

from models import (
    Warehouse, WarehouseCreate, WarehouseResponse,
    ProductFamily, ProductFamilyCreate, ProductFamilyResponse,
    ServiceFamily, ServiceFamilyCreate, ServiceFamilyResponse,
    ServiceCatalogItem, ServiceCatalogItemCreate, ServiceCatalogItemResponse,
    Product, ProductCreate, ProductResponse,
)
from shared import db, get_current_active_user, get_company_settings
from reports import generate_stock_report_excel

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
