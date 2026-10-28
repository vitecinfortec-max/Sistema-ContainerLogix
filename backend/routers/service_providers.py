"""Financeiro > Prestadores de Serviço: cadastro dos prestadores da empresa
(Soldador, Pintor, Ajudante Geral, Vigia, Motorista...), serviços/diárias
lançados no dia a dia, vales (adiantamentos) e o fechamento do período:
serviços - vales - descontos = líquido a pagar. Se os descontos passam dos
serviços, o saldo negativo vira um vale automático, descontado no próximo
fechamento. Pago o fechamento, sai o recibo em PDF."""
import io
import re
import uuid
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from models import (
    DEFAULT_SERVICE_PROVIDER_ROLES, SERVICE_PROVIDER_UNITS, ServiceProviderAdvanceCreate, ServiceProviderClosingCreate,
    ServiceProviderCreate, ServiceProviderEntryCreate, ServiceProviderPayRequest,
)
from reports import format_currency, generate_service_provider_receipt_pdf, generate_service_provider_report_pdf
from routers.fuel_supply import _valor_por_extenso
from shared import db, get_company_settings, get_current_admin_user, round_money

api_router = APIRouter(prefix="/api")

UNIT_LABELS = {"DIARIA": "Diária", "HORA": "Hora", "SERVICO": "Serviço", "MES": "Mês"}
CLOSING_STATUSES = {"FECHADO", "PAGO"}
SALDO = "SALDO_NEGATIVO"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(value: Optional[str]) -> Optional[str]:
    return (value or "").strip() or None


def _day(value: Optional[str], label: str, required: bool = True) -> Optional[str]:
    if not value:
        if required:
            raise HTTPException(status_code=400, detail=f"Informe {label.lower()}")
        return None
    try:
        return date.fromisoformat(str(value)[:10]).isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{label} inválida (use AAAA-MM-DD)")


def _br(day: str) -> str:
    return date.fromisoformat(day).strftime("%d/%m/%Y")


async def _provider_or_404(provider_id: str) -> dict:
    provider = await db.service_providers.find_one({"id": provider_id}, {"_id": 0})
    if not provider:
        raise HTTPException(status_code=404, detail="Prestador não encontrado")
    return provider


async def _find_or_404(collection: str, item_id: str, label: str) -> dict:
    doc = await db[collection].find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail=f"{label} não encontrado")
    return doc


def _period_query(field: str, start_date: Optional[str], end_date: Optional[str]) -> dict:
    start, end = _day(start_date, "Data inicial", False), _day(end_date, "Data final", False)
    if start and end and start > end:
        raise HTTPException(status_code=400, detail="A data inicial não pode ser depois da data final")
    return {field: {**({"$gte": start} if start else {}), **({"$lte": end} if end else {})}} if start or end else {}


# ---------------------------------------------------------------- Prestadores

@api_router.get("/service-provider-roles")
async def list_service_provider_roles(current_user: dict = Depends(get_current_admin_user)):
    """Funções para escolher: as padrão + as já usadas nos cadastros."""
    used = await db.service_providers.distinct("role")
    extra = sorted({r for r in used if r} - set(DEFAULT_SERVICE_PROVIDER_ROLES), key=str.lower)
    return DEFAULT_SERVICE_PROVIDER_ROLES + extra


def _provider_fields(data: ServiceProviderCreate) -> dict:
    name, role = _clean(data.name), _clean(data.role)
    if not name:
        raise HTTPException(status_code=400, detail="Informe o nome do prestador")
    if not role:
        raise HTTPException(status_code=400, detail="Informe a função do prestador")
    if data.payment_unit not in SERVICE_PROVIDER_UNITS:
        raise HTTPException(status_code=400, detail="Forma de cobrança inválida (diária, hora, serviço ou mês)")
    if data.default_rate is not None and data.default_rate < 0:
        raise HTTPException(status_code=400, detail="O valor padrão não pode ser negativo")
    if data.status not in ("ATIVO", "INATIVO"):
        raise HTTPException(status_code=400, detail="Situação inválida")
    return {"name": name, "document": _clean(data.document), "role": role, "payment_unit": data.payment_unit,
            "default_rate": round_money(data.default_rate) if data.default_rate is not None else None,
            "phone": _clean(data.phone), "pix_key": _clean(data.pix_key), "bank_info": _clean(data.bank_info),
            "status": data.status, "observations": _clean(data.observations)}


@api_router.get("/service-providers")
async def list_service_providers(current_user: dict = Depends(get_current_admin_user)):
    return await db.service_providers.find({}, {"_id": 0}).sort("name", 1).to_list(None)


@api_router.post("/service-providers")
async def create_service_provider(data: ServiceProviderCreate, current_user: dict = Depends(get_current_admin_user)):
    doc = {"id": str(uuid.uuid4()), **_provider_fields(data), "created_at": _now_iso(), "created_by_name": current_user.get("name")}
    await db.service_providers.insert_one(dict(doc))
    return doc


@api_router.put("/service-providers/{provider_id}")
async def update_service_provider(provider_id: str, data: ServiceProviderCreate, current_user: dict = Depends(get_current_admin_user)):
    await _provider_or_404(provider_id)
    fields = _provider_fields(data)
    await db.service_providers.update_one({"id": provider_id}, {"$set": {**fields, "updated_at": _now_iso()}})
    # Listas e fechamentos em aberto mostram o nome guardado neles
    for collection in ("service_provider_entries", "service_provider_advances"):
        await db[collection].update_many({"provider_id": provider_id}, {"$set": {"provider_name": fields["name"]}})
    await db.service_provider_closings.update_many({"provider_id": provider_id, "status": "FECHADO"},
                                                   {"$set": {"provider_name": fields["name"], "provider_document": fields["document"]}})
    return await _provider_or_404(provider_id)


@api_router.delete("/service-providers/{provider_id}")
async def delete_service_provider(provider_id: str, current_user: dict = Depends(get_current_admin_user)):
    await _provider_or_404(provider_id)
    uses = [f"{n} {label}" for collection, label in (("service_provider_entries", "serviço(s)"), ("service_provider_advances", "vale(s)"),
                                                    ("service_provider_closings", "fechamento(s)"))
            if (n := await db[collection].count_documents({"provider_id": provider_id}))]
    if uses:
        raise HTTPException(status_code=400, detail=f"Prestador em uso ({', '.join(uses)}). Em vez de excluir, mude a situação para Inativo.")
    await db.service_providers.delete_one({"id": provider_id})
    return {"message": "Prestador excluído"}


# ---------------------------------------------------------------- Serviços / diárias

def _entry_fields(provider: dict, entry_date: str, description, quantity, unit, unit_value) -> dict:
    unit = unit or provider.get("payment_unit") or "DIARIA"
    if unit not in SERVICE_PROVIDER_UNITS:
        raise HTTPException(status_code=400, detail="Unidade inválida (diária, hora, serviço ou mês)")
    if quantity is None or quantity <= 0:
        raise HTTPException(status_code=400, detail="A quantidade deve ser maior que zero")
    if unit_value is None or unit_value <= 0:
        raise HTTPException(status_code=400, detail="Informe o valor do serviço")
    return {"provider_id": provider["id"], "provider_name": provider["name"], "role": provider.get("role"),
            "date": _day(entry_date, "Data do serviço"), "description": _clean(description),
            "quantity": round(quantity, 2), "unit": unit, "unit_value": round_money(unit_value),
            "total": round_money(quantity * unit_value)}


async def _insert_entry(fields: dict, current_user: dict) -> dict:
    doc = {"id": str(uuid.uuid4()), **fields, "status": "ABERTO", "closing_id": None,
           "created_at": _now_iso(), "created_by_name": current_user.get("name")}
    await db.service_provider_entries.insert_one(dict(doc))
    return doc


async def _open_entry(entry_id: str) -> dict:
    entry = await _find_or_404("service_provider_entries", entry_id, "Serviço")
    if entry["status"] != "ABERTO":
        raise HTTPException(status_code=400, detail="Serviço já entrou num fechamento: cancele o fechamento para alterar")
    return entry


@api_router.get("/service-provider-entries")
async def list_service_provider_entries(provider_id: Optional[str] = None, status: Optional[str] = None,
                                        start_date: Optional[str] = None, end_date: Optional[str] = None,
                                        search: Optional[str] = None, current_user: dict = Depends(get_current_admin_user)):
    query = _period_query("date", start_date, end_date)
    if provider_id:
        query["provider_id"] = provider_id
    if status:
        query["status"] = status
    if search and search.strip():
        rx = {"$regex": re.escape(search.strip()), "$options": "i"}
        query["$or"] = [{"provider_name": rx}, {"description": rx}, {"role": rx}]
    return await db.service_provider_entries.find(query, {"_id": 0}).sort([("date", -1), ("created_at", -1)]).to_list(None)


@api_router.post("/service-provider-entries")
async def create_service_provider_entry(data: ServiceProviderEntryCreate, current_user: dict = Depends(get_current_admin_user)):
    provider = await _provider_or_404(data.provider_id)
    return await _insert_entry(_entry_fields(provider, data.date, data.description, data.quantity, data.unit, data.unit_value), current_user)


@api_router.put("/service-provider-entries/{entry_id}")
async def update_service_provider_entry(entry_id: str, data: ServiceProviderEntryCreate, current_user: dict = Depends(get_current_admin_user)):
    await _open_entry(entry_id)
    provider = await _provider_or_404(data.provider_id)
    fields = _entry_fields(provider, data.date, data.description, data.quantity, data.unit, data.unit_value)
    await db.service_provider_entries.update_one({"id": entry_id}, {"$set": {**fields, "updated_at": _now_iso()}})
    return await _find_or_404("service_provider_entries", entry_id, "Serviço")


@api_router.delete("/service-provider-entries/{entry_id}")
async def delete_service_provider_entry(entry_id: str, current_user: dict = Depends(get_current_admin_user)):
    await _open_entry(entry_id)
    await db.service_provider_entries.delete_one({"id": entry_id})
    return {"message": "Serviço excluído"}


# ---------------------------------------------------------------- Vales

def _advance_fields(provider: dict, data: ServiceProviderAdvanceCreate) -> dict:
    if data.value is None or data.value <= 0:
        raise HTTPException(status_code=400, detail="Informe o valor do vale")
    return {"provider_id": provider["id"], "provider_name": provider["name"], "date": _day(data.date, "Data do vale"),
            "value": round_money(data.value), "description": _clean(data.description)}


async def _insert_advance(fields: dict, current_user: dict, origin: str = "VALE") -> dict:
    doc = {"id": str(uuid.uuid4()), "origin": origin, **fields, "status": "PENDENTE", "closing_id": None, "deducted_on": None,
           "created_at": _now_iso(), "created_by_name": current_user.get("name")}
    await db.service_provider_advances.insert_one(dict(doc))
    return doc


async def _editable_advance(advance_id: str) -> dict:
    advance = await _find_or_404("service_provider_advances", advance_id, "Vale")
    if advance["status"] != "PENDENTE":
        raise HTTPException(status_code=400, detail="Vale já descontado num fechamento: cancele o fechamento para alterar")
    if advance.get("origin") == SALDO:
        raise HTTPException(status_code=400, detail="Saldo negativo de um fechamento anterior: para desfazer, cancele aquele fechamento")
    return advance


@api_router.get("/service-provider-advances")
async def list_service_provider_advances(provider_id: Optional[str] = None, status: Optional[str] = None,
                                         start_date: Optional[str] = None, end_date: Optional[str] = None,
                                         search: Optional[str] = None, current_user: dict = Depends(get_current_admin_user)):
    query = _period_query("date", start_date, end_date)
    if provider_id:
        query["provider_id"] = provider_id
    if status:
        query["status"] = status
    if search and search.strip():
        rx = {"$regex": re.escape(search.strip()), "$options": "i"}
        query["$or"] = [{"provider_name": rx}, {"description": rx}]
    return await db.service_provider_advances.find(query, {"_id": 0}).sort([("date", -1), ("created_at", -1)]).to_list(None)


@api_router.post("/service-provider-advances")
async def create_service_provider_advance(data: ServiceProviderAdvanceCreate, current_user: dict = Depends(get_current_admin_user)):
    provider = await _provider_or_404(data.provider_id)
    return await _insert_advance(_advance_fields(provider, data), current_user)


@api_router.put("/service-provider-advances/{advance_id}")
async def update_service_provider_advance(advance_id: str, data: ServiceProviderAdvanceCreate, current_user: dict = Depends(get_current_admin_user)):
    await _editable_advance(advance_id)
    provider = await _provider_or_404(data.provider_id)
    await db.service_provider_advances.update_one({"id": advance_id}, {"$set": {**_advance_fields(provider, data), "updated_at": _now_iso()}})
    return await _find_or_404("service_provider_advances", advance_id, "Vale")


@api_router.delete("/service-provider-advances/{advance_id}")
async def delete_service_provider_advance(advance_id: str, current_user: dict = Depends(get_current_admin_user)):
    await _editable_advance(advance_id)
    await db.service_provider_advances.delete_one({"id": advance_id})
    return {"message": "Vale excluído"}


# ---------------------------------------------------------------- Fechamentos

async def _next_closing_number() -> int:
    result = await db.counters.find_one_and_update({"_id": "service_provider_closing_number"}, {"$inc": {"seq": 1}},
                                                   upsert=True, return_document=True)
    return result["seq"]


def _closings_query(provider_id=None, status=None, start_date=None, end_date=None, search=None) -> dict:
    query = {}
    if provider_id:
        query["provider_id"] = provider_id
    if status:
        if status not in CLOSING_STATUSES:
            raise HTTPException(status_code=400, detail="Situação inválida (FECHADO ou PAGO)")
        query["status"] = status
    # Fechamento entra no filtro quando o período dele cruza o período filtrado
    start, end = _day(start_date, "Data inicial", False), _day(end_date, "Data final", False)
    if start and end and start > end:
        raise HTTPException(status_code=400, detail="A data inicial não pode ser depois da data final")
    if end:
        query["period_start"] = {"$lte": end}
    if start:
        query["period_end"] = {"$gte": start}
    if search and search.strip():
        rx = {"$regex": re.escape(search.strip()), "$options": "i"}
        query["$or"] = [{"provider_name": rx}, {"role": rx}, {"observations": rx}]
    return query


@api_router.get("/service-provider-closings")
async def list_service_provider_closings(provider_id: Optional[str] = None, status: Optional[str] = None,
                                         start_date: Optional[str] = None, end_date: Optional[str] = None,
                                         search: Optional[str] = None, current_user: dict = Depends(get_current_admin_user)):
    return await db.service_provider_closings.find(_closings_query(provider_id, status, start_date, end_date, search), {"_id": 0}).sort(
        [("period_end", -1), ("number", -1)]).to_list(None)


@api_router.get("/service-provider-closings/pdf")
async def service_provider_closings_pdf(provider_id: Optional[str] = None, status: Optional[str] = None,
                                        start_date: Optional[str] = None, end_date: Optional[str] = None,
                                        search: Optional[str] = None, current_user: dict = Depends(get_current_admin_user)):
    """Relatório dos fechamentos dos filtros, por prestador."""
    closings = await db.service_provider_closings.find(_closings_query(provider_id, status, start_date, end_date, search), {"_id": 0}).sort(
        [("provider_name", 1), ("period_start", 1)]).to_list(None)
    pdf = generate_service_provider_report_pdf(closings, {"start_date": _day(start_date, "Data inicial", False),
                                                          "end_date": _day(end_date, "Data final", False), "status": status},
                                               company=await get_company_settings())
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": 'attachment; filename="Fechamentos_Prestadores.pdf"'})


@api_router.post("/service-provider-closings")
async def create_service_provider_closing(data: ServiceProviderClosingCreate, current_user: dict = Depends(get_current_admin_user)):
    provider = await _provider_or_404(data.provider_id)
    period_start, period_end = _day(data.period_start, "Início do período"), _day(data.period_end, "Fim do período")
    if period_start > period_end:
        raise HTTPException(status_code=400, detail="O início do período não pode ser depois do fim")

    # Confere tudo antes de gravar
    entry_ids, advance_ids = list(dict.fromkeys(data.entry_ids)), list(dict.fromkeys(data.advance_ids))
    entries = await db.service_provider_entries.find({"id": {"$in": entry_ids}, "provider_id": provider["id"], "status": "ABERTO"},
                                                     {"_id": 0}).to_list(None)
    if len(entries) != len(entry_ids):
        raise HTTPException(status_code=400, detail="Serviço já fechado, excluído ou de outro prestador: atualize a tela")
    advances = await db.service_provider_advances.find({"id": {"$in": advance_ids}, "provider_id": provider["id"], "status": "PENDENTE"},
                                                       {"_id": 0}).to_list(None)
    if len(advances) != len(advance_ids):
        raise HTTPException(status_code=400, detail="Vale já descontado, excluído ou de outro prestador: atualize a tela")
    new_entries = [_entry_fields(provider, line.date, line.description, line.quantity, None, line.unit_value) for line in data.new_entries]
    new_advances = [_advance_fields(provider, a) for a in data.new_advances]
    discounts = []
    for d in data.discounts:
        if not _clean(d.description):
            raise HTTPException(status_code=400, detail="Informe a descrição de cada desconto")
        if d.value is None or d.value <= 0:
            raise HTTPException(status_code=400, detail="O valor de cada desconto deve ser maior que zero")
        discounts.append({"description": d.description.strip(), "value": round_money(d.value)})
    if not entries and not new_entries:
        raise HTTPException(status_code=400, detail="O fechamento precisa de pelo menos um serviço")

    entries += [await _insert_entry(f, current_user) for f in new_entries]
    advances += [await _insert_advance(f, current_user) for f in new_advances]
    gross = round_money(sum(e["total"] for e in entries))
    advances_total = round_money(sum(a["value"] for a in advances))
    discount_total = round_money(sum(d["value"] for d in discounts))
    balance = round_money(gross - advances_total - discount_total)
    closing_id, number = str(uuid.uuid4()), await _next_closing_number()
    doc = {
        "id": closing_id, "number": number,
        "provider_id": provider["id"], "provider_name": provider["name"], "provider_document": provider.get("document"),
        "role": provider.get("role"), "period_start": period_start, "period_end": period_end,
        "entry_ids": [e["id"] for e in entries], "entries_count": len(entries), "gross_total": gross,
        "advance_ids": [a["id"] for a in advances], "advances_total": advances_total,
        "discounts": discounts, "discount_total": discount_total,
        "net_total": max(balance, 0), "carried_over": max(-balance, 0),
        "observations": _clean(data.observations), "status": "FECHADO",
        "payment_date": None, "payment_method": None, "payment_notes": None, "paid_by_name": None,
        "created_at": _now_iso(), "created_by_name": current_user.get("name"),
    }
    await db.service_provider_closings.insert_one(dict(doc))
    await db.service_provider_entries.update_many({"id": {"$in": doc["entry_ids"]}}, {"$set": {"status": "FECHADO", "closing_id": closing_id}})
    await db.service_provider_advances.update_many({"id": {"$in": doc["advance_ids"]}},
                                                   {"$set": {"status": "DESCONTADO", "closing_id": closing_id, "deducted_on": period_end}})
    if balance < 0:
        await _insert_advance({
            "provider_id": provider["id"], "provider_name": provider["name"], "date": period_end, "value": -balance,
            "description": (f"Saldo negativo do fechamento nº {number} ({_br(period_start)} a {_br(period_end)}): "
                            f"vales e descontos de {format_currency(advances_total + discount_total)} maiores que os serviços de "
                            f"{format_currency(gross)}"),
            "source_closing_id": closing_id,
        }, current_user, origin=SALDO)
    return doc


async def _closing_or_404(closing_id: str) -> dict:
    return await _find_or_404("service_provider_closings", closing_id, "Fechamento")


@api_router.get("/service-provider-closings/{closing_id}")
async def get_service_provider_closing(closing_id: str, current_user: dict = Depends(get_current_admin_user)):
    closing = await _closing_or_404(closing_id)
    closing["entries"] = await db.service_provider_entries.find({"id": {"$in": closing["entry_ids"]}}, {"_id": 0}).sort("date", 1).to_list(None)
    closing["advances"] = await db.service_provider_advances.find({"id": {"$in": closing["advance_ids"]}}, {"_id": 0}).sort("date", 1).to_list(None)
    return closing


@api_router.delete("/service-provider-closings/{closing_id}")
async def cancel_service_provider_closing(closing_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Cancela o fechamento (não pago): os serviços voltam a ficar em aberto,
    os vales voltam a ficar a descontar e o saldo negativo levado adiante sai."""
    closing = await _closing_or_404(closing_id)
    if closing["status"] == "PAGO":
        raise HTTPException(status_code=400, detail="Fechamento pago: estorne o pagamento antes de cancelar")
    used = await db.service_provider_advances.find_one({"source_closing_id": closing_id, "status": "DESCONTADO"}, {"_id": 0})
    if used:
        number = (await db.service_provider_closings.find_one({"id": used["closing_id"]}, {"_id": 0, "number": 1}) or {}).get("number")
        raise HTTPException(status_code=400, detail=f"O saldo negativo deste fechamento já foi descontado no fechamento nº {number}: cancele aquele antes")
    await db.service_provider_advances.delete_many({"source_closing_id": closing_id, "status": "PENDENTE"})
    await db.service_provider_entries.update_many({"closing_id": closing_id}, {"$set": {"status": "ABERTO", "closing_id": None}})
    await db.service_provider_advances.update_many({"closing_id": closing_id},
                                                   {"$set": {"status": "PENDENTE", "closing_id": None, "deducted_on": None}})
    await db.service_provider_closings.delete_one({"id": closing_id})
    return {"message": "Fechamento cancelado"}


@api_router.post("/service-provider-closings/{closing_id}/pay")
async def pay_service_provider_closing(closing_id: str, data: ServiceProviderPayRequest, current_user: dict = Depends(get_current_admin_user)):
    closing = await _closing_or_404(closing_id)
    if closing["status"] != "FECHADO":
        raise HTTPException(status_code=400, detail="Fechamento já pago")
    await db.service_provider_closings.update_one({"id": closing_id}, {"$set": {
        "status": "PAGO", "payment_date": _day(data.payment_date, "Data do pagamento"), "payment_method": _clean(data.payment_method),
        "payment_notes": _clean(data.payment_notes), "paid_by_name": current_user.get("name"), "paid_at": _now_iso()}})
    return await _closing_or_404(closing_id)


@api_router.post("/service-provider-closings/{closing_id}/unpay")
async def unpay_service_provider_closing(closing_id: str, current_user: dict = Depends(get_current_admin_user)):
    closing = await _closing_or_404(closing_id)
    if closing["status"] != "PAGO":
        raise HTTPException(status_code=400, detail="Fechamento não está pago")
    await db.service_provider_closings.update_one({"id": closing_id}, {"$set": {
        "status": "FECHADO", "payment_date": None, "payment_method": None, "payment_notes": None, "paid_by_name": None, "paid_at": None}})
    return await _closing_or_404(closing_id)


@api_router.get("/service-provider-closings/{closing_id}/receipt-pdf")
async def service_provider_receipt_pdf(closing_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Recibo do fechamento: serviços, vales e descontos, líquido por extenso e assinaturas."""
    closing = await get_service_provider_closing(closing_id, current_user)
    provider = await db.service_providers.find_one({"id": closing["provider_id"]}, {"_id": 0}) or {}
    pdf = generate_service_provider_receipt_pdf(closing, provider, _valor_por_extenso(closing["net_total"]) if closing["net_total"] else "",
                                                company=await get_company_settings())
    name = re.sub(r"[^A-Za-z0-9]+", "_", closing["provider_name"] or "prestador")
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="Recibo_{name}_{closing["number"]}.pdf"'})
