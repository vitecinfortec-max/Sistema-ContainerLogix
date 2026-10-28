"""Comercial > Comissão: lançamento do frete faturado por cliente (um a um ou
por representante, com o período de referência), cálculo da comissão pelo
Vínculo de Clientes (representante + %), descontos, adiantamentos descontados
na baixa do pagamento e prestação de contas em PDF por representante."""
import io
import re
import uuid
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from models import (CommissionAdvanceCreate, CommissionBatchCreate, CommissionEntryCreate, CommissionFromCtesRequest,
                    CommissionPayRequest)
from reports import BRT_TZ, generate_commission_statement_pdf
from shared import db, get_company_settings, get_current_active_user, round_money

api_router = APIRouter(prefix="/api")

DOCUMENT_TYPES = {"CTE": "CT-e", "NF": "Nota fiscal", "FATURA": "Fatura", "OUTRO": "Outro"}
STATUSES = {"PENDENTE", "PAGO"}
# Adiantamento: a descontar até entrar na baixa de um pagamento
ADVANCE_STATUS = {"PENDENTE": "PENDENTE", "PAGO": "DESCONTADO"}
# Quem paga o frete do CT-e (tomador_papel) e onde está o cadastro dele
CTE_PAYER = {0: "remetente", 3: "destinatario", 4: "tomador"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _day(value: Optional[str], label: str) -> Optional[str]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10]).isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{label} inválida (use AAAA-MM-DD)")


def _period(start: Optional[str], end: Optional[str]) -> tuple:
    start, end = _day(start, "Início do período"), _day(end, "Fim do período")
    if start and end and start > end:
        raise HTTPException(status_code=400, detail="O início do período não pode ser depois do fim")
    return start, end


def _digits(value) -> str:
    return re.sub(r"\D", "", str(value or ""))


async def _active_link(client_id: str) -> Optional[dict]:
    return await db.client_representative_links.find_one({"client_id": client_id, "status": "ATIVO"}, {"_id": 0})


async def _get_or_404(entry_id: str) -> dict:
    entry = await db.commission_entries.find_one({"id": entry_id}, {"_id": 0})
    if not entry:
        raise HTTPException(status_code=404, detail="Lançamento de comissão não encontrado")
    return entry


def _calculate(freight: float, discounts: list, percentage: float) -> dict:
    discount_total = round_money(sum(d["value"] for d in discounts))
    base = round_money(max(freight - discount_total, 0))
    return {"discount_total": discount_total, "calculation_base": base,
            "commission_value": round_money(base * percentage / 100)}


async def _build(data: CommissionEntryCreate, representative_id: Optional[str] = None) -> dict:
    """Campos calculados do lançamento (cliente, representante, %, base e comissão).
    Com `representative_id`, o cliente tem que estar vinculado a esse representante."""
    if data.document_type not in DOCUMENT_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de documento inválido (CT-e, nota fiscal, fatura ou outro)")
    billing_date = _day(data.billing_date, "Data do faturamento")
    if not billing_date:
        raise HTTPException(status_code=400, detail="Informe a data do faturamento")
    period_start, period_end = _period(data.period_start, data.period_end)
    if data.freight_value is None or data.freight_value <= 0:
        raise HTTPException(status_code=400, detail="Informe o valor do frete faturado")
    discounts = []
    for d in data.discounts:
        if not (d.description or "").strip():
            raise HTTPException(status_code=400, detail="Informe a descrição de cada desconto")
        if d.value is None or d.value < 0:
            raise HTTPException(status_code=400, detail="Desconto não pode ser negativo")
        discounts.append({"description": d.description.strip(), "value": round_money(d.value)})
    if sum(d["value"] for d in discounts) > data.freight_value + 0.005:
        raise HTTPException(status_code=400, detail="Os descontos passam do valor do frete")

    client = await db.clients.find_one({"id": data.client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    link = await _active_link(data.client_id)
    if not link:
        raise HTTPException(status_code=400, detail=f"{client['name']} não tem representante vinculado (Comercial > Vínculo de Clientes)")
    if representative_id and link["representative_id"] != representative_id:
        raise HTTPException(status_code=400, detail=f"{client['name']} está vinculado a outro representante ({link['representative_name']})")
    percentage = link["commission_percentage"] if data.commission_percentage is None else data.commission_percentage
    if not 0 <= percentage <= 100:
        raise HTTPException(status_code=400, detail="Percentual de comissão deve estar entre 0 e 100")

    return {
        "client_id": data.client_id,
        "client_name": client["name"],
        "representative_id": link["representative_id"],
        "representative_name": link["representative_name"],
        "table_percentage": link["commission_percentage"],
        "commission_percentage": percentage,
        "percentage_overridden": data.commission_percentage is not None and percentage != link["commission_percentage"],
        "document_type": data.document_type,
        "document_number": (data.document_number or "").strip() or None,
        "billing_date": billing_date,
        "period_start": period_start,
        "period_end": period_end,
        "freight_value": round_money(data.freight_value),
        "discounts": discounts,
        **_calculate(data.freight_value, discounts, percentage),
        "observations": (data.observations or "").strip() or None,
        "cte_id": data.cte_id or None,
    }


def _filters(representative_id, client_id, status, start_date, end_date, search) -> dict:
    query = {}
    if representative_id:
        query["representative_id"] = representative_id
    if client_id:
        query["client_id"] = client_id
    if status:
        if status not in STATUSES:
            raise HTTPException(status_code=400, detail="Situação inválida (PENDENTE ou PAGO)")
        query["status"] = status
    start, end = _day(start_date, "Data inicial"), _day(end_date, "Data final")
    if start and end and start > end:
        raise HTTPException(status_code=400, detail="A data inicial não pode ser depois da data final")
    if start or end:
        query["billing_date"] = {**({"$gte": start} if start else {}), **({"$lte": end} if end else {})}
    if search and search.strip():
        escaped = re.escape(search.strip())
        query["$or"] = [{"client_name": {"$regex": escaped, "$options": "i"}},
                        {"representative_name": {"$regex": escaped, "$options": "i"}},
                        {"document_number": {"$regex": escaped, "$options": "i"}},
                        {"observations": {"$regex": escaped, "$options": "i"}}]
    return query


async def _list(**filters) -> list:
    return await db.commission_entries.find(_filters(**filters), {"_id": 0}).sort(
        [("billing_date", -1), ("created_at", -1)]).to_list(None)


@api_router.get("/commission-entries")
async def list_commission_entries(
    representative_id: Optional[str] = None, client_id: Optional[str] = None, status: Optional[str] = None,
    start_date: Optional[str] = None, end_date: Optional[str] = None, search: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user),
):
    return await _list(representative_id=representative_id, client_id=client_id, status=status,
                       start_date=start_date, end_date=end_date, search=search)


@api_router.get("/commission-entries/pdf")
async def commission_statement_pdf(
    representative_id: Optional[str] = None, client_id: Optional[str] = None, status: Optional[str] = None,
    start_date: Optional[str] = None, end_date: Optional[str] = None, search: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user),
):
    """Prestação de contas: lançamentos dos filtros, agrupados por representante."""
    entries = await _list(representative_id=representative_id, client_id=client_id, status=status,
                          start_date=start_date, end_date=end_date, search=search)
    advances = [] if client_id else await _list_advances(representative_id=representative_id, status=ADVANCE_STATUS.get(status),
                                                          start_date=start_date, end_date=end_date, search=search)
    pdf = generate_commission_statement_pdf(
        sorted(entries, key=lambda e: (e["representative_name"], e["billing_date"], e.get("document_number") or "")),
        {"start_date": _day(start_date, "Data inicial"), "end_date": _day(end_date, "Data final"), "status": status},
        company=await get_company_settings(),
        advances=sorted(advances, key=lambda a: (a["representative_name"], a["advance_date"])),
    )
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": 'attachment; filename="Prestacao_Contas_Comissao.pdf"'})


@api_router.get("/commission-entries/cte-candidates")
async def commission_cte_candidates(start_date: Optional[str] = None, end_date: Optional[str] = None,
                                    current_user: dict = Depends(get_current_active_user)):
    """CT-es autorizados ainda sem lançamento de comissão, com o cliente pagador
    do frete achado no cadastro (pelo vínculo do CT-e ou pelo CNPJ/CPF) e o
    representante dele. Os que não têm vínculo vêm marcados, para conferir."""
    start, end = _day(start_date, "Data inicial"), _day(end_date, "Data final")
    launched = set(await db.commission_entries.distinct("cte_id", {"cte_id": {"$ne": None}}))
    ctes = await db.ctes.find({"status": "AUTORIZADO"}, {"_id": 0}).to_list(None)
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1, "cnpj": 1}).to_list(None)
    by_id = {c["id"]: c for c in clients}
    by_doc = {_digits(c.get("cnpj")): c for c in clients if _digits(c.get("cnpj"))}
    links = {l["client_id"]: l for l in await db.client_representative_links.find({"status": "ATIVO"}, {"_id": 0}).to_list(None)}

    out = []
    for cte in ctes:
        if cte["id"] in launched:
            continue
        day = _cte_day(cte)
        if (start and day < start) or (end and day > end):
            continue
        payer = cte.get(CTE_PAYER.get(int(cte.get("tomador_papel") or 0), "remetente")) or {}
        client = by_id.get(payer.get("client_id")) or by_doc.get(_digits(payer.get("cnpj_cpf")))
        link = links.get(client["id"]) if client else None
        out.append({
            "cte_id": cte["id"], "numero": cte.get("numero"), "billing_date": day,
            "freight_value": cte.get("valor_total"), "payer_name": payer.get("nome"),
            "client_id": client["id"] if client else None, "client_name": client["name"] if client else None,
            "representative_name": link["representative_name"] if link else None,
            "commission_percentage": link["commission_percentage"] if link else None,
        })
    return sorted(out, key=lambda c: (c["billing_date"], c["numero"] or 0))


def _cte_day(cte: dict) -> str:
    stamp = cte.get("emitido_em") or cte.get("created_at")
    try:
        return datetime.fromisoformat(stamp).astimezone(BRT_TZ).date().isoformat()
    except (TypeError, ValueError):
        return str(stamp or "")[:10]


@api_router.post("/commission-entries/from-ctes")
async def commission_from_ctes(data: CommissionFromCtesRequest, current_user: dict = Depends(get_current_active_user)):
    """Lança a comissão dos CT-es escolhidos (frete = valor total da prestação).
    Devolve os criados e os que ficaram de fora, com o motivo."""
    candidates = {c["cte_id"]: c for c in await commission_cte_candidates(current_user=current_user)}
    created, skipped = [], []
    for cte_id in data.ids:
        cand = candidates.get(cte_id)
        if not cand:
            skipped.append({"cte_id": cte_id, "reason": "CT-e não autorizado ou já lançado"})
            continue
        if not cand["client_id"]:
            skipped.append({"cte_id": cte_id, "numero": cand["numero"], "reason": f"Pagador {cand['payer_name'] or '-'} não está no cadastro de clientes"})
            continue
        try:
            fields = await _build(CommissionEntryCreate(
                client_id=cand["client_id"], document_type="CTE", document_number=str(cand["numero"] or ""),
                billing_date=cand["billing_date"], freight_value=cand["freight_value"] or 0, cte_id=cte_id,
            ))
        except HTTPException as e:
            skipped.append({"cte_id": cte_id, "numero": cand["numero"], "reason": e.detail})
            continue
        created.append(await _insert(fields, current_user))
    return {"created": created, "skipped": skipped}


@api_router.post("/commission-entries/batch")
async def commission_batch(data: CommissionBatchCreate, current_user: dict = Depends(get_current_active_user)):
    """Lançamento por representante: um lançamento para cada cliente dele com
    frete faturado no período, mais os adiantamentos. Tudo é conferido antes
    de gravar, para não ficar lançamento pela metade."""
    representative = await db.representatives.find_one({"id": data.representative_id}, {"_id": 0, "name": 1})
    if not representative:
        raise HTTPException(status_code=404, detail="Representante não encontrado")
    if not data.items and not data.advances:
        raise HTTPException(status_code=400, detail="Informe o frete faturado de pelo menos um cliente ou um adiantamento")
    if len({i.client_id for i in data.items}) != len(data.items):
        raise HTTPException(status_code=400, detail="Cliente repetido no lançamento")
    entries = []
    for item in data.items:
        try:
            entries.append(await _build(CommissionEntryCreate(
                client_id=item.client_id, document_type=data.document_type, document_number=item.document_number,
                billing_date=data.billing_date, period_start=item.period_start or data.period_start,
                period_end=item.period_end or data.period_end, freight_value=item.freight_value,
                observations=item.observations,
            ), representative_id=data.representative_id))
        except HTTPException as e:
            client = await db.clients.find_one({"id": item.client_id}, {"_id": 0, "name": 1}) or {}
            if e.status_code != 400 or client.get("name", "") in e.detail:
                raise
            raise HTTPException(status_code=400, detail=f"{client.get('name', 'Cliente')}: {e.detail}")
    advances = [await _advance_fields(a.model_copy(update={"representative_id": data.representative_id})) for a in data.advances]
    return {"created": [await _insert(f, current_user) for f in entries],
            "advances": [await _insert_advance(f, current_user) for f in advances]}


async def _insert(fields: dict, current_user: dict) -> dict:
    doc = {"id": str(uuid.uuid4()), **fields, "status": "PENDENTE", "payment_date": None, "payment_notes": None,
           "created_at": _now_iso(), "created_by": current_user["sub"], "created_by_name": current_user.get("name")}
    await db.commission_entries.insert_one(dict(doc))
    return doc


@api_router.post("/commission-entries/pay")
async def pay_commission_entries(data: CommissionPayRequest, current_user: dict = Depends(get_current_active_user)):
    """Baixa (prestação de contas paga): marca os lançamentos pendentes como pagos."""
    payment_date = _day(data.payment_date, "Data do pagamento")
    if not data.ids or not payment_date:
        raise HTTPException(status_code=400, detail="Escolha os lançamentos e a data do pagamento")
    entries = await db.commission_entries.find({"id": {"$in": data.ids}, "status": "PENDENTE"}, {"_id": 0}).to_list(None)
    if not entries:
        return {"paid": 0, "advances_deducted": 0, "net": 0}
    advance_ids = set(data.advance_ids)
    advances = await db.commission_advances.find({"id": {"$in": list(advance_ids)}, "status": "PENDENTE"}, {"_id": 0}).to_list(None)
    reps = {e["representative_id"] for e in entries}
    if len(advances) != len(advance_ids) or any(a["representative_id"] not in reps for a in advances):
        raise HTTPException(status_code=400, detail="Adiantamento já descontado ou de outro representante")
    for rep_id in reps:
        commission = sum(e["commission_value"] for e in entries if e["representative_id"] == rep_id)
        advanced = sum(a["value"] for a in advances if a["representative_id"] == rep_id)
        if advanced > commission + 0.005:
            name = next(e["representative_name"] for e in entries if e["representative_id"] == rep_id)
            raise HTTPException(status_code=400, detail=f"Os adiantamentos de {name} passam da comissão desta baixa: "
                                                        "deixe algum para o próximo pagamento")
    payment_id = str(uuid.uuid4())
    result = await db.commission_entries.update_many(
        {"id": {"$in": [e["id"] for e in entries]}, "status": "PENDENTE"},
        {"$set": {"status": "PAGO", "payment_date": payment_date, "payment_notes": (data.payment_notes or "").strip() or None,
                  "payment_id": payment_id, "paid_at": _now_iso(), "paid_by_name": current_user.get("name")}},
    )
    if advances:
        await db.commission_advances.update_many(
            {"id": {"$in": [a["id"] for a in advances]}},
            {"$set": {"status": "DESCONTADO", "deducted_on": payment_date, "payment_id": payment_id}},
        )
    deducted = round_money(sum(a["value"] for a in advances))
    return {"paid": result.modified_count, "advances_deducted": deducted,
            "net": round_money(sum(e["commission_value"] for e in entries) - deducted)}


@api_router.post("/commission-entries/unpay")
async def unpay_commission_entries(data: CommissionFromCtesRequest, current_user: dict = Depends(get_current_active_user)):
    """Estorna a baixa (volta para pendente). Quando a baixa inteira é
    estornada, os adiantamentos descontados nela voltam a ficar a descontar."""
    payment_ids = set(await db.commission_entries.distinct("payment_id", {"id": {"$in": data.ids}, "status": "PAGO"})) - {None}
    result = await db.commission_entries.update_many(
        {"id": {"$in": data.ids}, "status": "PAGO"},
        {"$set": {"status": "PENDENTE", "payment_date": None, "payment_notes": None, "payment_id": None,
                  "paid_at": None, "paid_by_name": None}},
    )
    still_paid = set(await db.commission_entries.distinct("payment_id", {"payment_id": {"$in": list(payment_ids)}, "status": "PAGO"}))
    advances = await db.commission_advances.update_many(
        {"payment_id": {"$in": list(payment_ids - still_paid)}, "status": "DESCONTADO"},
        {"$set": {"status": "PENDENTE", "deducted_on": None, "payment_id": None}},
    )
    return {"reverted": result.modified_count, "advances_reverted": advances.modified_count}


@api_router.post("/commission-entries")
async def create_commission_entry(data: CommissionEntryCreate, current_user: dict = Depends(get_current_active_user)):
    if data.cte_id and await db.commission_entries.find_one({"cte_id": data.cte_id}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=400, detail="Este CT-e já tem lançamento de comissão")
    return await _insert(await _build(data), current_user)


@api_router.get("/commission-entries/{entry_id}")
async def get_commission_entry(entry_id: str, current_user: dict = Depends(get_current_active_user)):
    return await _get_or_404(entry_id)


@api_router.put("/commission-entries/{entry_id}")
async def update_commission_entry(entry_id: str, data: CommissionEntryCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await _get_or_404(entry_id)
    if existing["status"] == "PAGO":
        raise HTTPException(status_code=400, detail="Lançamento já pago: estorne o pagamento antes de alterar")
    fields = await _build(data)
    fields["cte_id"] = existing.get("cte_id")
    await db.commission_entries.update_one({"id": entry_id}, {"$set": {
        **fields, "updated_at": _now_iso(), "updated_by_name": current_user.get("name")}})
    return await _get_or_404(entry_id)


@api_router.delete("/commission-entries/{entry_id}")
async def delete_commission_entry(entry_id: str, current_user: dict = Depends(get_current_active_user)):
    existing = await _get_or_404(entry_id)
    if existing["status"] == "PAGO":
        raise HTTPException(status_code=400, detail="Lançamento já pago: estorne o pagamento antes de excluir")
    await db.commission_entries.delete_one({"id": entry_id})
    return {"message": "Lançamento excluído"}



# ----- Adiantamentos -----

async def _advance_fields(data: CommissionAdvanceCreate) -> dict:
    representative = await db.representatives.find_one({"id": data.representative_id}, {"_id": 0, "name": 1})
    if not representative:
        raise HTTPException(status_code=404, detail="Representante não encontrado")
    advance_date = _day(data.advance_date, "Data do adiantamento")
    if not advance_date:
        raise HTTPException(status_code=400, detail="Informe a data do adiantamento")
    if data.value is None or data.value <= 0:
        raise HTTPException(status_code=400, detail="Informe o valor do adiantamento")
    return {"representative_id": data.representative_id, "representative_name": representative["name"],
            "advance_date": advance_date, "value": round_money(data.value),
            "description": (data.description or "").strip() or None}


async def _insert_advance(fields: dict, current_user: dict) -> dict:
    doc = {"id": str(uuid.uuid4()), **fields, "status": "PENDENTE", "deducted_on": None, "payment_id": None,
           "created_at": _now_iso(), "created_by_name": current_user.get("name")}
    await db.commission_advances.insert_one(dict(doc))
    return doc


async def _advance_or_404(advance_id: str) -> dict:
    advance = await db.commission_advances.find_one({"id": advance_id}, {"_id": 0})
    if not advance:
        raise HTTPException(status_code=404, detail="Adiantamento não encontrado")
    if advance["status"] != "PENDENTE":
        raise HTTPException(status_code=400, detail="Adiantamento já descontado: estorne o pagamento antes de alterar")
    return advance


async def _list_advances(representative_id=None, status=None, start_date=None, end_date=None, search=None) -> list:
    query = {}
    if representative_id:
        query["representative_id"] = representative_id
    if status:
        if status not in ADVANCE_STATUS.values():
            raise HTTPException(status_code=400, detail="Situação inválida (PENDENTE ou DESCONTADO)")
        query["status"] = status
    start, end = _day(start_date, "Data inicial"), _day(end_date, "Data final")
    if start or end:
        query["advance_date"] = {**({"$gte": start} if start else {}), **({"$lte": end} if end else {})}
    if search and search.strip():
        escaped = re.escape(search.strip())
        query["$or"] = [{"representative_name": {"$regex": escaped, "$options": "i"}},
                        {"description": {"$regex": escaped, "$options": "i"}}]
    return await db.commission_advances.find(query, {"_id": 0}).sort([("advance_date", -1), ("created_at", -1)]).to_list(None)


@api_router.get("/commission-advances")
async def list_commission_advances(
    representative_id: Optional[str] = None, status: Optional[str] = None, start_date: Optional[str] = None,
    end_date: Optional[str] = None, search: Optional[str] = None, current_user: dict = Depends(get_current_active_user),
):
    return await _list_advances(representative_id, status, start_date, end_date, search)


@api_router.post("/commission-advances")
async def create_commission_advance(data: CommissionAdvanceCreate, current_user: dict = Depends(get_current_active_user)):
    return await _insert_advance(await _advance_fields(data), current_user)


@api_router.put("/commission-advances/{advance_id}")
async def update_commission_advance(advance_id: str, data: CommissionAdvanceCreate, current_user: dict = Depends(get_current_active_user)):
    await _advance_or_404(advance_id)
    await db.commission_advances.update_one({"id": advance_id}, {"$set": {
        **await _advance_fields(data), "updated_at": _now_iso(), "updated_by_name": current_user.get("name")}})
    return await db.commission_advances.find_one({"id": advance_id}, {"_id": 0})


@api_router.delete("/commission-advances/{advance_id}")
async def delete_commission_advance(advance_id: str, current_user: dict = Depends(get_current_active_user)):
    await _advance_or_404(advance_id)
    await db.commission_advances.delete_one({"id": advance_id})
    return {"message": "Adiantamento excluído"}
