from datetime import date, datetime, timedelta, timezone
from typing import List, Optional
import io
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from models import (
    Representative, RepresentativeCreate, RepresentativeResponse,
    ServicePriceEntry, ServicePriceEntryCreate, ServicePriceEntryResponse,
    ClientRepresentativeLink, ClientRepresentativeLinkCreate, ClientRepresentativeLinkResponse,
    CommercialProposal, CommercialProposalCreate, CommercialProposalResponse,
)
from shared import db, get_current_active_user, get_company_settings, round_money
from reports import (
    generate_commission_report_pdf, generate_service_price_table_pdf, now_brt,
    generate_commercial_proposal_pdf, BRT_TZ,
)

api_router = APIRouter(prefix="/api")

CURRENCIES = {"BRL", "USD"}
ACTIVE_STATUSES = {"ATIVO", "INATIVO"}
PROPOSAL_STATUSES = {"EM_ABERTO", "ACEITA", "RECUSADA"}


def _check_currency(currency):
    if currency not in CURRENCIES:
        raise HTTPException(status_code=400, detail="Moeda inválida (use BRL ou USD)")


def _check_active_status(status):
    if status not in ACTIVE_STATUSES:
        raise HTTPException(status_code=400, detail="Status inválido (use ATIVO ou INATIVO)")


def _validate_price_entry(data):
    if data.value is None or data.value < 0:
        raise HTTPException(status_code=400, detail="O valor não pode ser negativo")
    if data.free_time_days is not None and data.free_time_days < 0:
        raise HTTPException(status_code=400, detail="Free time (dias) não pode ser negativo")
    _check_currency(data.currency)
    _check_active_status(data.status)


async def _ensure_no_duplicate_unique_price(data, exclude_id=None):
    """Preço único ativo repetido pro mesmo serviço do mesmo cliente: o EIR
    preenche o Valor do Serviço com um deles, sem dizer qual."""
    if data.billing_type != "UNICO" or data.status != "ATIVO":
        return
    query = {
        "client_id": data.client_id, "service_type_id": data.service_type_id,
        "billing_type": {"$in": ["UNICO", None]}, "status": "ATIVO",
    }
    if exclude_id:
        query["id"] = {"$ne": exclude_id}
    if await db.service_price_entries.find_one(query, {"_id": 0, "id": 1}):
        raise HTTPException(
            status_code=400,
            detail="Este serviço já tem um preço ativo na tabela deste cliente. Edite ou inative o existente.",
        )


def _validate_proposal(data):
    if not data.recipient_name or not data.recipient_name.strip():
        raise HTTPException(status_code=400, detail="Informe o destinatário da proposta")
    if data.validity_days is None or data.validity_days < 1:
        raise HTTPException(status_code=400, detail="A validade deve ser de pelo menos 1 dia")
    _check_currency(data.currency)
    items = [i for i in data.items if (i.description or '').strip()]
    if not items:
        raise HTTPException(status_code=400, detail="Adicione ao menos um serviço à proposta")
    if any(i.value is None or i.value < 0 for i in items):
        raise HTTPException(status_code=400, detail="O valor de um serviço não pode ser negativo")
    if data.status is not None and data.status not in PROPOSAL_STATUSES:
        raise HTTPException(status_code=400, detail="Situação da proposta inválida")
    return [{"description": i.description.strip(), "value": round_money(i.value)} for i in items]


def _commission_period(start_date: Optional[str], end_date: Optional[str]) -> dict:
    """Período do Relatório de Comissão em dias de Brasília: de 00:00 do
    primeiro dia até 00:00 do dia seguinte ao último (antes ia em UTC, e o
    que era lançado depois das 21h caía no dia/mês seguinte)."""
    try:
        day_from = date.fromisoformat(start_date[:10]) if start_date else None
        day_to = date.fromisoformat(end_date[:10]) if end_date else None
    except ValueError:
        raise HTTPException(status_code=400, detail="Data do período inválida")
    if day_from and day_to and day_from > day_to:
        raise HTTPException(status_code=400, detail="A data inicial não pode ser depois da data final")
    conditions = []
    if day_from:
        start = datetime.combine(day_from, datetime.min.time(), tzinfo=BRT_TZ).astimezone(timezone.utc)
        conditions.append({"$gte": [{"$toDate": "$created_at"}, start]})
    if day_to:
        end = datetime.combine(day_to + timedelta(days=1), datetime.min.time(), tzinfo=BRT_TZ).astimezone(timezone.utc)
        conditions.append({"$lt": [{"$toDate": "$created_at"}, end]})
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
    _check_active_status(data.status)
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
    _check_active_status(data.status)
    update_data = {**data.model_dump(), "id": item_id, "created_at": existing['created_at'], "created_by": existing['created_by']}
    await db.representatives.replace_one({"id": item_id}, update_data)
    if (existing.get('name') or '') != data.name:
        # O Vínculo de Clientes mostra o nome guardado nele
        await db.client_representative_links.update_many(
            {"representative_id": item_id}, {"$set": {"representative_name": data.name}}
        )
    return RepresentativeResponse(**{**update_data, "created_at": datetime.fromisoformat(update_data['created_at'])})

@api_router.delete("/representatives/{item_id}")
async def delete_representative(item_id: str, current_user: dict = Depends(get_current_active_user)):
    links = await db.client_representative_links.count_documents({"representative_id": item_id})
    if links:
        raise HTTPException(
            status_code=400,
            detail=f"Representante em uso ({links} vínculo(s) com clientes). Em vez de excluir, mude o status para Inativo.",
        )
    result = await db.representatives.delete_one({"id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Representante não encontrado")
    return {"message": "Representante removido com sucesso"}


# ==================== TABELA DE SERVIÇOS ====================

@api_router.post("/service-price-entries", response_model=ServicePriceEntryResponse)
async def create_service_price_entry(data: ServicePriceEntryCreate, current_user: dict = Depends(get_current_active_user)):
    _validate_price_entry(data)
    client = await db.clients.find_one({"id": data.client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    service_type = await db.service_types.find_one({"id": data.service_type_id}, {"_id": 0, "name": 1})
    if not service_type:
        raise HTTPException(status_code=404, detail="Tipo de Serviço não encontrado")

    if data.billing_type == "DIARIA":
        if data.free_time_days is None:
            raise HTTPException(status_code=400, detail="Free time (dias) é obrigatório para cobrança de Diária de Armazenagem")
        if data.status == "ATIVO":
            conflicting = await db.service_price_entries.find_one(
                {
                    "client_id": data.client_id,
                    "billing_type": "DIARIA",
                    "status": "ATIVO",
                    "container_size_group": data.container_size_group,
                },
                {"_id": 0, "service_type_name": 1}
            )
            if conflicting:
                raise HTTPException(
                    status_code=400,
                    detail=f"Este cliente já tem uma Diária de Armazenagem ativa para esse tamanho de container ({conflicting['service_type_name']}). Edite ou inative a existente antes de criar uma nova."
                )
    await _ensure_no_duplicate_unique_price(data)

    entry = ServicePriceEntry(
        client_id=data.client_id,
        client_name=client['name'],
        service_type_id=data.service_type_id,
        service_type_name=service_type['name'],
        value=round_money(data.value),
        currency=data.currency,
        billing_type=data.billing_type,
        free_time_days=data.free_time_days,
        container_size_group=data.container_size_group,
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
    _validate_price_entry(data)
    client = await db.clients.find_one({"id": data.client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    service_type = await db.service_types.find_one({"id": data.service_type_id}, {"_id": 0, "name": 1})
    if not service_type:
        raise HTTPException(status_code=404, detail="Tipo de Serviço não encontrado")

    if data.billing_type == "DIARIA":
        if data.free_time_days is None:
            raise HTTPException(status_code=400, detail="Free time (dias) é obrigatório para cobrança de Diária de Armazenagem")
        if data.status == "ATIVO":
            conflicting = await db.service_price_entries.find_one(
                {
                    "client_id": data.client_id,
                    "billing_type": "DIARIA",
                    "status": "ATIVO",
                    "container_size_group": data.container_size_group,
                    "id": {"$ne": item_id},
                },
                {"_id": 0, "service_type_name": 1}
            )
            if conflicting:
                raise HTTPException(
                    status_code=400,
                    detail=f"Este cliente já tem uma Diária de Armazenagem ativa para esse tamanho de container ({conflicting['service_type_name']}). Edite ou inative a existente antes de criar uma nova."
                )
    await _ensure_no_duplicate_unique_price(data, exclude_id=item_id)

    update_data = {
        "id": item_id,
        "client_id": data.client_id,
        "client_name": client['name'],
        "service_type_id": data.service_type_id,
        "service_type_name": service_type['name'],
        "value": round_money(data.value),
        "currency": data.currency,
        "billing_type": data.billing_type,
        "free_time_days": data.free_time_days,
        "container_size_group": data.container_size_group,
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

def _validate_link(data):
    if data.commission_percentage is None or not (0 <= data.commission_percentage <= 100):
        raise HTTPException(status_code=400, detail="O percentual de comissão deve estar entre 0 e 100")
    _check_active_status(data.status)


@api_router.post("/client-representative-links", response_model=ClientRepresentativeLinkResponse)
async def create_client_representative_link(data: ClientRepresentativeLinkCreate, current_user: dict = Depends(get_current_active_user)):
    _validate_link(data)
    client = await db.clients.find_one({"id": data.client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    representative = await db.representatives.find_one({"id": data.representative_id}, {"_id": 0, "name": 1})
    if not representative:
        raise HTTPException(status_code=404, detail="Representante não encontrado")

    existing_active = None
    if data.status == "ATIVO":
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
    _validate_link(data)
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

    date_filter = _commission_period(start_date, end_date)
    report_representatives = []
    grand_total = 0.0
    grand_total_usd = 0.0

    for rep in representatives:
        links = await db.client_representative_links.find(
            {"representative_id": rep['id'], "status": "ATIVO"}, {"_id": 0}
        ).to_list(None)
        if not links:
            continue

        clients_data = []
        rep_total = 0.0
        rep_total_usd = 0.0
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
                movements = await db.movements.find(match_query, {"_id": 0, "service_value": 1, "currency": 1}).to_list(None)
                # Real e dólar em totais separados (antes o US$ entrava somado no R$)
                total_billed = round_money(sum((m.get('service_value') or 0) for m in movements if m.get('currency') != 'USD'))
                total_billed_usd = round_money(sum((m.get('service_value') or 0) for m in movements if m.get('currency') == 'USD'))
            else:
                total_billed = total_billed_usd = 0.0
            commission_value = round_money(total_billed * (link['commission_percentage'] / 100))
            commission_value_usd = round_money(total_billed_usd * (link['commission_percentage'] / 100))
            clients_data.append({
                "client_name": link['client_name'],
                "commission_percentage": link['commission_percentage'],
                "total_billed": total_billed,
                "commission_value": commission_value,
                "total_billed_usd": total_billed_usd,
                "commission_value_usd": commission_value_usd,
                "has_price_table": bool(registered_service_types),
            })
            rep_total += commission_value
            rep_total_usd += commission_value_usd

        if clients_data:
            report_representatives.append({
                "representative_name": rep['name'],
                "clients": clients_data,
                "total_commission": round_money(rep_total),
                "total_commission_usd": round_money(rep_total_usd),
            })
            grand_total += rep_total
            grand_total_usd += rep_total_usd

    return {
        "representatives": report_representatives,
        "grand_total": round_money(grand_total),
        "grand_total_usd": round_money(grand_total_usd),
        "start_date": start_date,
        "end_date": end_date,
    }

@api_router.get("/reports/commission")
async def get_commission_report(
    representative_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    """Prévia na tela: os mesmos números do PDF."""
    return await _compute_commission_report(representative_id, start_date, end_date)


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


# ==================== PROPOSTA COMERCIAL ====================

async def get_next_proposal_number():
    """Sequencial anual (reinicia em 1 a cada ano civil), formatado AAAA9999."""
    year = now_brt().year
    counter = await db.counters.find_one_and_update(
        {"_id": f"proposal_number_{year}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    seq = counter["seq"]
    return seq, f"{year}{seq:04d}"


@api_router.post("/commercial-proposals", response_model=CommercialProposalResponse)
async def create_commercial_proposal(data: CommercialProposalCreate, current_user: dict = Depends(get_current_active_user)):
    items = _validate_proposal(data)  # antes de reservar o número
    seq, number = await get_next_proposal_number()
    proposal = CommercialProposal(
        **{**data.model_dump(), "items": items, "status": data.status or "EM_ABERTO"},
        proposal_seq=seq,
        proposal_number=number,
        created_by=current_user['sub'],
        created_by_name=current_user['name'],
    )
    doc = proposal.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.commercial_proposals.insert_one(doc)
    return CommercialProposalResponse(**doc)

@api_router.get("/commercial-proposals", response_model=List[CommercialProposalResponse])
async def list_commercial_proposals(current_user: dict = Depends(get_current_active_user)):
    items = await db.commercial_proposals.find({}, {"_id": 0}).sort("created_at", -1).to_list(None)
    return [CommercialProposalResponse(**{**i, "created_at": datetime.fromisoformat(i['created_at'])}) for i in items]

@api_router.get("/commercial-proposals/{proposal_id}", response_model=CommercialProposalResponse)
async def get_commercial_proposal(proposal_id: str, current_user: dict = Depends(get_current_active_user)):
    proposal = await db.commercial_proposals.find_one({"id": proposal_id}, {"_id": 0})
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposta não encontrada")
    return CommercialProposalResponse(**proposal)

@api_router.put("/commercial-proposals/{proposal_id}", response_model=CommercialProposalResponse)
async def update_commercial_proposal(proposal_id: str, data: CommercialProposalCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.commercial_proposals.find_one({"id": proposal_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Proposta não encontrada")
    items = _validate_proposal(data)
    update_data = {
        **data.model_dump(),
        "items": items,
        "status": data.status or existing.get('status') or "EM_ABERTO",
        "id": proposal_id,
        "proposal_seq": existing['proposal_seq'],
        "proposal_number": existing['proposal_number'],
        "created_by": existing['created_by'],
        "created_by_name": existing['created_by_name'],
        "created_at": existing['created_at'],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.commercial_proposals.replace_one({"id": proposal_id}, update_data)
    return CommercialProposalResponse(**update_data)

@api_router.put("/commercial-proposals/{proposal_id}/status", response_model=CommercialProposalResponse)
async def update_commercial_proposal_status(
    proposal_id: str,
    status: str = Query(...),
    current_user: dict = Depends(get_current_active_user)
):
    if status not in PROPOSAL_STATUSES:
        raise HTTPException(status_code=400, detail="Situação da proposta inválida")
    result = await db.commercial_proposals.update_one(
        {"id": proposal_id},
        {"$set": {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Proposta não encontrada")
    return CommercialProposalResponse(**await db.commercial_proposals.find_one({"id": proposal_id}, {"_id": 0}))


@api_router.delete("/commercial-proposals/{proposal_id}")
async def delete_commercial_proposal(proposal_id: str, current_user: dict = Depends(get_current_active_user)):
    result = await db.commercial_proposals.delete_one({"id": proposal_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Proposta não encontrada")
    return {"message": "Proposta removida com sucesso"}

@api_router.get("/commercial-proposals/{proposal_id}/pdf")
async def download_commercial_proposal_pdf(proposal_id: str, current_user: dict = Depends(get_current_active_user)):
    proposal = await db.commercial_proposals.find_one({"id": proposal_id}, {"_id": 0})
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposta não encontrada")
    company = await get_company_settings()
    pdf_bytes = generate_commercial_proposal_pdf(proposal, company=company)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="Proposta_{proposal["proposal_number"]}.pdf"'}
    )
