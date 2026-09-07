from datetime import datetime, timezone
from typing import List, Optional
import io
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from models import (
    Representative, RepresentativeCreate, RepresentativeResponse,
    ServicePriceEntry, ServicePriceEntryCreate, ServicePriceEntryResponse,
    ClientRepresentativeLink, ClientRepresentativeLinkCreate, ClientRepresentativeLinkResponse,
)
from shared import db, get_current_active_user, get_company_settings, round_money
from reports import generate_commission_report_pdf, generate_service_price_table_pdf

api_router = APIRouter(prefix="/api")


def _created_at_between(start_date: Optional[str], end_date: Optional[str]) -> dict:
    """Filtro sobre 'created_at' (data da própria movimentação/serviço, string
    ISO) dentro de um período, convertendo para Date dentro do próprio
    MongoDB - mesma técnica de _created_at_gte usada em movements.py, mas com
    limite inferior E superior.

    Usa created_at (data do serviço) em vez de billed_at (data em que a
    fatura foi gerada) de propósito: o período de um relatório de comissão
    é "comissão sobre o que foi prestado em agosto", não "sobre o que foi
    faturado em agosto" - na prática o faturamento de um mês inteiro costuma
    ser feito de uma vez só, dias ou semanas depois, então filtrar por
    billed_at fazia o relatório de um período inteiro voltar zerado sempre
    que o faturamento daquelas movimentações só aconteceu no mês seguinte."""
    conditions = []
    if start_date:
        conditions.append({"$gte": [{"$toDate": "$created_at"}, datetime.fromisoformat(start_date)]})
    if end_date:
        end_dt = datetime.fromisoformat(end_date).replace(hour=23, minute=59, second=59)
        conditions.append({"$lte": [{"$toDate": "$created_at"}, end_dt]})
    if not conditions:
        return {}
    return {"$expr": {"$and": conditions} if len(conditions) > 1 else conditions[0]}


def _exact_client_name_filter(client_name: str) -> dict:
    """Filtro de client_name por igualdade exata, sem diferenciar maiúsculas/
    minúsculas - ContainerMovement não tem client_id (só client_name como
    texto livre), mesmo cuidado já usado na Auditoria de Estoque. re.escape
    evita que um nome com parênteses/pontos (comum em razão social, ex.
    "CIA. INDUSTRIA DE OLEOS (CIONE)") quebre a regex."""
    return {"$regex": f"^{re.escape(client_name.strip())}$", "$options": "i"}


def _service_type_in_filter(service_type_names: list) -> dict:
    """Filtro 'o service_type da movimentação é um destes', sem diferenciar
    maiúsculas/minúsculas - o texto de service_type na movimentação é uma
    string livre copiada do catálogo de Tipo de Serviço no momento da
    seleção, e pode ter sido digitada/salva com uma variação de caixa
    diferente da que está no catálogo hoje (mesmo problema já visto em
    client_name - ex. "(VAZIO)" nas movimentações reais vs "(Vazio)" no
    catálogo/Tabela de Serviços)."""
    return {"$or": [
        {"service_type": {"$regex": f"^{re.escape(name.strip())}$", "$options": "i"}}
        for name in service_type_names
    ]}


# ==================== REPRESENTANTE ====================

@api_router.post("/representatives", response_model=RepresentativeResponse)
async def create_representative(data: RepresentativeCreate, current_user: dict = Depends(get_current_active_user)):
    representative = Representative(**data.model_dump(), created_by=current_user['sub'])
    doc = representative.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.representatives.insert_one(doc)
    return RepresentativeResponse(**representative.model_dump())

@api_router.get("/representatives", response_model=List[RepresentativeResponse])
async def get_representatives(current_user: dict = Depends(get_current_active_user)):
    items = await db.representatives.find({}, {"_id": 0}).sort("name", 1).to_list(None)
    return [RepresentativeResponse(**{**i, "created_at": datetime.fromisoformat(i['created_at'])}) for i in items]

@api_router.put("/representatives/{item_id}", response_model=RepresentativeResponse)
async def update_representative(item_id: str, data: RepresentativeCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.representatives.find_one({"id": item_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Representante não encontrado")
    update_data = {**data.model_dump(), "id": item_id, "created_at": existing['created_at'], "created_by": existing['created_by']}
    await db.representatives.replace_one({"id": item_id}, update_data)
    return RepresentativeResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})

@api_router.delete("/representatives/{item_id}")
async def delete_representative(item_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.representatives.delete_one({"id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Representante não encontrado")
    return {"message": "Representante removido com sucesso"}


# ==================== TABELA DE SERVIÇOS ====================

@api_router.post("/service-price-entries", response_model=ServicePriceEntryResponse)
async def create_service_price_entry(data: ServicePriceEntryCreate, current_user: dict = Depends(get_current_active_user)):
    client = await db.clients.find_one({"id": data.client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    service_type = await db.service_types.find_one({"id": data.service_type_id}, {"_id": 0, "name": 1})
    if not service_type:
        raise HTTPException(status_code=404, detail="Tipo de Serviço não encontrado")

    entry = ServicePriceEntry(
        client_id=data.client_id,
        client_name=client['name'],
        service_type_id=data.service_type_id,
        service_type_name=service_type['name'],
        value=round_money(data.value),
        status=data.status,
        created_by=current_user['sub'],
    )
    doc = entry.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.service_price_entries.insert_one(doc)
    return ServicePriceEntryResponse(**doc)

@api_router.get("/service-price-entries", response_model=List[ServicePriceEntryResponse])
async def get_service_price_entries(
    client_id: Optional[str] = None,
    client_name: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    query = {}
    if client_id:
        query['client_id'] = client_id
    elif client_name:
        # Match exato, sem diferenciar maiúsculas/minúsculas - mesmo cuidado
        # já usado em _get_expected_stock_for_client (Auditoria de Estoque),
        # evita casar com um cliente parecido por acidente.
        query['client_name'] = _exact_client_name_filter(client_name)
    items = await db.service_price_entries.find(query, {"_id": 0}).sort("service_type_name", 1).to_list(None)
    return [ServicePriceEntryResponse(**{**i, "created_at": datetime.fromisoformat(i['created_at'])}) for i in items]

@api_router.get("/service-price-entries/pdf")
async def download_service_price_table_pdf(
    client_id: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Gera o PDF da tabela de serviços (serviço + valor) de um cliente"""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")

    entries = await db.service_price_entries.find(
        {"client_id": client_id}, {"_id": 0}
    ).sort("service_type_name", 1).to_list(None)

    company = await get_company_settings()
    pdf_bytes = generate_service_price_table_pdf(client['name'], entries, company=company)

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=Tabela_Servicos.pdf"}
    )

@api_router.put("/service-price-entries/{item_id}", response_model=ServicePriceEntryResponse)
async def update_service_price_entry(item_id: str, data: ServicePriceEntryCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.service_price_entries.find_one({"id": item_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Preço de serviço não encontrado")
    client = await db.clients.find_one({"id": data.client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    service_type = await db.service_types.find_one({"id": data.service_type_id}, {"_id": 0, "name": 1})
    if not service_type:
        raise HTTPException(status_code=404, detail="Tipo de Serviço não encontrado")

    update_data = {
        "id": item_id,
        "client_id": data.client_id,
        "client_name": client['name'],
        "service_type_id": data.service_type_id,
        "service_type_name": service_type['name'],
        "value": round_money(data.value),
        "status": data.status,
        "created_at": existing['created_at'],
        "created_by": existing['created_by'],
    }
    await db.service_price_entries.replace_one({"id": item_id}, update_data)
    return ServicePriceEntryResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})

@api_router.delete("/service-price-entries/{item_id}")
async def delete_service_price_entry(item_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.service_price_entries.delete_one({"id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Preço de serviço não encontrado")
    return {"message": "Preço de serviço removido com sucesso"}


# ==================== VÍNCULO DE CLIENTES ====================

@api_router.post("/client-representative-links", response_model=ClientRepresentativeLinkResponse)
async def create_client_representative_link(data: ClientRepresentativeLinkCreate, current_user: dict = Depends(get_current_active_user)):
    client = await db.clients.find_one({"id": data.client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    representative = await db.representatives.find_one({"id": data.representative_id}, {"_id": 0, "name": 1})
    if not representative:
        raise HTTPException(status_code=404, detail="Representante não encontrado")

    existing_active = await db.client_representative_links.find_one(
        {"client_id": data.client_id, "status": "ATIVO"}, {"_id": 0, "representative_name": 1}
    )
    if existing_active:
        raise HTTPException(
            status_code=400,
            detail=f"Este cliente já está vinculado ao representante {existing_active['representative_name']}. Edite ou inative o vínculo existente antes de criar um novo."
        )

    link = ClientRepresentativeLink(
        client_id=data.client_id,
        client_name=client['name'],
        representative_id=data.representative_id,
        representative_name=representative['name'],
        commission_percentage=data.commission_percentage,
        status=data.status,
        created_by=current_user['sub'],
    )
    doc = link.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.client_representative_links.insert_one(doc)
    return ClientRepresentativeLinkResponse(**doc)

@api_router.get("/client-representative-links", response_model=List[ClientRepresentativeLinkResponse])
async def get_client_representative_links(current_user: dict = Depends(get_current_active_user)):
    items = await db.client_representative_links.find({}, {"_id": 0}).sort("client_name", 1).to_list(None)
    return [ClientRepresentativeLinkResponse(**{**i, "created_at": datetime.fromisoformat(i['created_at'])}) for i in items]

@api_router.put("/client-representative-links/{item_id}", response_model=ClientRepresentativeLinkResponse)
async def update_client_representative_link(item_id: str, data: ClientRepresentativeLinkCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.client_representative_links.find_one({"id": item_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Vínculo não encontrado")
    client = await db.clients.find_one({"id": data.client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    representative = await db.representatives.find_one({"id": data.representative_id}, {"_id": 0, "name": 1})
    if not representative:
        raise HTTPException(status_code=404, detail="Representante não encontrado")

    if data.status == "ATIVO":
        conflicting = await db.client_representative_links.find_one(
            {"client_id": data.client_id, "status": "ATIVO", "id": {"$ne": item_id}}, {"_id": 0, "representative_name": 1}
        )
        if conflicting:
            raise HTTPException(
                status_code=400,
                detail=f"Este cliente já está vinculado ao representante {conflicting['representative_name']}."
            )

    update_data = {
        "id": item_id,
        "client_id": data.client_id,
        "client_name": client['name'],
        "representative_id": data.representative_id,
        "representative_name": representative['name'],
        "commission_percentage": data.commission_percentage,
        "status": data.status,
        "created_at": existing['created_at'],
        "created_by": existing['created_by'],
    }
    await db.client_representative_links.replace_one({"id": item_id}, update_data)
    return ClientRepresentativeLinkResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})

@api_router.delete("/client-representative-links/{item_id}")
async def delete_client_representative_link(item_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.client_representative_links.delete_one({"id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Vínculo não encontrado")
    return {"message": "Vínculo removido com sucesso"}


# ==================== RELATÓRIO DE COMISSÃO ====================

async def _compute_commission_report(representative_id: Optional[str], start_date: Optional[str], end_date: Optional[str]) -> dict:
    rep_query = {"status": "ATIVO"}
    if representative_id:
        rep_query = {"id": representative_id}
    representatives = await db.representatives.find(rep_query, {"_id": 0}).sort("name", 1).to_list(None)

    date_filter = _created_at_between(start_date, end_date)
    report_representatives = []
    grand_total = 0.0

    for rep in representatives:
        links = await db.client_representative_links.find(
            {"representative_id": rep['id'], "status": "ATIVO"}, {"_id": 0}
        ).to_list(None)
        if not links:
            continue

        clients_data = []
        rep_total = 0.0
        for link in links:
            # Só conta pra comissão os serviços que o cliente tem cadastrados
            # na Tabela de Serviços (Comercial > Tabela de Serviços) - não
            # todo valor faturado do cliente, que pode incluir serviços fora
            # do acordo de comissão com o representante.
            price_entries = await db.service_price_entries.find(
                {"client_id": link['client_id']}, {"_id": 0, "service_type_name": 1}
            ).to_list(None)
            registered_service_types = [e['service_type_name'] for e in price_entries]

            if registered_service_types:
                match_query = {
                    **date_filter,
                    **_service_type_in_filter(registered_service_types),
                    "client_name": _exact_client_name_filter(link['client_name']),
                    "billed": True,
                }
                movements = await db.movements.find(match_query, {"_id": 0, "service_value": 1}).to_list(None)
                total_billed = round_money(sum((m.get('service_value') or 0) for m in movements))
            else:
                total_billed = 0.0
            commission_value = round_money(total_billed * (link['commission_percentage'] / 100))
            clients_data.append({
                "client_name": link['client_name'],
                "commission_percentage": link['commission_percentage'],
                "total_billed": total_billed,
                "commission_value": commission_value,
            })
            rep_total += commission_value

        if clients_data:
            report_representatives.append({
                "representative_name": rep['name'],
                "clients": clients_data,
                "total_commission": round_money(rep_total),
            })
            grand_total += rep_total

    return {
        "representatives": report_representatives,
        "grand_total": round_money(grand_total),
        "start_date": start_date,
        "end_date": end_date,
    }

@api_router.get("/reports/commission/pdf")
async def download_commission_report_pdf(
    representative_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    data = await _compute_commission_report(representative_id, start_date, end_date)
    company = await get_company_settings()
    pdf_bytes = generate_commission_report_pdf(data, company=company)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="Relatorio_Comissao.pdf"'}
    )
