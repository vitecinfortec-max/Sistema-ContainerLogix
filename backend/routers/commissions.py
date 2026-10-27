"""Comercial > Comissão: lançamento do frete faturado por cliente, cálculo da
comissão pelo Vínculo de Clientes (representante + %), descontos, baixa do
pagamento e prestação de contas em PDF por representante."""
import io
import re
import uuid
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from models import CommissionEntryCreate, CommissionFromCtesRequest, CommissionPayRequest
from reports import BRT_TZ, generate_commission_statement_pdf
from shared import db, get_company_settings, get_current_active_user, round_money

api_router = APIRouter(prefix="/api")

DOCUMENT_TYPES = {"CTE": "CT-e", "NF": "Nota fiscal", "FATURA": "Fatura", "OUTRO": "Outro"}
STATUSES = {"PENDENTE", "PAGO"}
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


async def _build(data: CommissionEntryCreate) -> dict:
    """Campos calculados do lançamento (cliente, representante, %, base e comissão)."""
    if data.document_type not in DOCUMENT_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de documento inválido (CT-e, nota fiscal, fatura ou outro)")
    billing_date = _day(data.billing_date, "Data do faturamento")
    if not billing_date:
        raise HTTPException(status_code=400, detail="Informe a data do faturamento")
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
    pdf = generate_commission_statement_pdf(
        sorted(entries, key=lambda e: (e["representative_name"], e["billing_date"], e.get("document_number") or "")),
        {"start_date": _day(start_date, "Data inicial"), "end_date": _day(end_date, "Data final"), "status": status},
        company=await get_company_settings(),
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
    result = await db.commission_entries.update_many(
        {"id": {"$in": data.ids}, "status": "PENDENTE"},
        {"$set": {"status": "PAGO", "payment_date": payment_date, "payment_notes": (data.payment_notes or "").strip() or None,
                  "paid_at": _now_iso(), "paid_by_name": current_user.get("name")}},
    )
    return {"paid": result.modified_count}


@api_router.post("/commission-entries/unpay")
async def unpay_commission_entries(data: CommissionFromCtesRequest, current_user: dict = Depends(get_current_active_user)):
    """Estorna a baixa (volta para pendente)."""
    result = await db.commission_entries.update_many(
        {"id": {"$in": data.ids}, "status": "PAGO"},
        {"$set": {"status": "PENDENTE", "payment_date": None, "payment_notes": None, "paid_at": None, "paid_by_name": None}},
    )
    return {"reverted": result.modified_count}


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

