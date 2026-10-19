from datetime import date, datetime, timezone
from typing import Optional
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query

from list_filters import combine, day_query, text_query
from models import CLIENT_CREDIT_PAYMENT_METHODS, ClientCreditApply, ClientCreditCreate, ClientCreditReverse
from period_reports import Column, Section, MONEY, DAY, INT, pdf_response, excel_response, period_text
from reports import BRT_TZ, format_currency
from shared import db, get_current_admin_user, parse_datetime_value

api_router = APIRouter(prefix="/api")

# ==================== FINANCEIRO - CRÉDITO DE CLIENTE ====================
# Conta corrente de crédito por cliente (adiantamento, pagamento a maior,
# devolução de cobrança...). O saldo é a soma dos lançamentos:
#   CREDITO   (+) dinheiro recebido do cliente que ainda não virou fatura
#   USO       (-) baixa do crédito numa fatura (parcial ou total)
#   DEVOLUCAO (-) crédito devolvido em dinheiro ao cliente
#   ESTORNO   (±) desfaz um lançamento (o efeito contrário), com motivo
# Lançamento nunca é apagado nem editado - errado, estorna e lança de novo.
#
# O saldo também fica num documento por cliente (client_credit_accounts),
# atualizado com $inc condicionado ao saldo: duas baixas ao mesmo tempo não
# conseguem usar o mesmo crédito. Valores internos em centavos (int) para a
# soma nunca acumular erro de arredondamento.
#
# Na fatura ficam credit_applied (quanto do crédito foi usado nela) e
# paid_by_credit (quitada pelo crédito). Cancelar/excluir a fatura, ou o
# total dela cair abaixo do crédito usado, devolve a diferença ao saldo.

SIGN = {"CREDITO": 1, "USO": -1, "DEVOLUCAO": -1}
TYPE_LABELS = {"CREDITO": "Crédito", "USO": "Uso em fatura", "DEVOLUCAO": "Devolução", "ESTORNO": "Estorno"}
METHOD_LABELS = {"PIX": "PIX", "TED": "TED/DOC", "BOLETO": "Boleto", "DEPOSITO": "Depósito", "DINHEIRO": "Dinheiro",
                 "CHEQUE": "Cheque", "OUTRO": "Outro"}


def _cents(value) -> int:
    return int(round((value or 0) * 100))


def _money(cents: int) -> float:
    return round(cents / 100, 2)


def _brl(cents: int) -> str:
    return format_currency(_money(cents), "BRL")


def _today() -> date:
    return datetime.now(BRT_TZ).date()


def _digits(value) -> str:
    return re.sub(r"\D", "", value or "")


def _parse_day(value: str, label: str = "data") -> date:
    try:
        day = date.fromisoformat((value or "")[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Informe a {label} no formato AAAA-MM-DD")
    if day > _today():
        raise HTTPException(status_code=400, detail=f"A {label} não pode ser no futuro")
    return day


def _invoice_day(invoice: dict) -> date:
    return parse_datetime_value(invoice["created_at"]).astimezone(BRT_TZ).date()


def _invoice_matches_client(invoice: dict, client: dict) -> bool:
    """A fatura guarda o cliente por nome/CNPJ (não pelo id do cadastro)"""
    a, b = _digits(invoice.get("client_cnpj")), _digits(client.get("cnpj"))
    if a and b:
        return a == b
    return (invoice.get("client_name") or "").strip().casefold() == (client.get("name") or "").strip().casefold()


def _client_invoices_query(client: dict) -> dict:
    ors = [{"client_name": {"$regex": f"^{re.escape((client.get('name') or '').strip())}$", "$options": "i"}}]
    if _digits(client.get("cnpj")):
        ors.append({"client_cnpj": client["cnpj"]})
    return {"$or": ors}


async def _get_client(client_id: str) -> dict:
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1, "cnpj": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    return client


async def _next_number() -> int:
    counter = await db.counters.find_one_and_update(
        {"_id": "client_credit_entry_number"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
    return counter["seq"]


async def _move_balance(client: dict, delta_cents: int) -> None:
    """Soma delta ao saldo do cliente; saída (delta < 0) só se houver saldo"""
    if delta_cents >= 0:
        await db.client_credit_accounts.update_one(
            {"client_id": client["id"]},
            {"$inc": {"balance_cents": delta_cents}, "$set": {"client_name": client["name"], "client_cnpj": client.get("cnpj")}},
            upsert=True,
        )
        return
    done = await db.client_credit_accounts.find_one_and_update(
        {"client_id": client["id"], "balance_cents": {"$gte": -delta_cents}}, {"$inc": {"balance_cents": delta_cents}})
    if not done:
        account = await db.client_credit_accounts.find_one({"client_id": client["id"]}, {"_id": 0, "balance_cents": 1}) or {}
        raise HTTPException(status_code=400, detail=f"Saldo de crédito insuficiente: o cliente tem {_brl(account.get('balance_cents', 0))}")


async def _undo_balance(client: dict, delta_cents: int) -> None:
    """Desfaz um _move_balance já feito (sem conferir saldo: só devolve o que saiu ou tira o que entrou)"""
    await db.client_credit_accounts.update_one({"client_id": client["id"]}, {"$inc": {"balance_cents": -delta_cents}})


async def _insert_entry(client: dict, entry_type: str, cents: int, entry_date: str, user: dict, **extra) -> dict:
    doc = {
        "id": str(uuid.uuid4()),
        "entry_number": await _next_number(),
        "client_id": client["id"], "client_name": client["name"], "client_cnpj": client.get("cnpj"),
        "entry_type": entry_type,
        "amount": _money(cents),
        "signed_amount": _money(cents * extra.pop("sign")),
        "entry_date": entry_date,
        "payment_method": None, "reference": None, "notes": None,
        "invoice_id": None, "invoice_number": None,
        "reversed_amount": 0, "reverses_entry_id": None, "reverses_entry_number": None, "reason": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": user["sub"], "created_by_name": user.get("name"),
        **extra,
    }
    await db.client_credit_entries.insert_one(dict(doc))
    return doc


async def _log_invoice(invoice: dict, changes: dict, user: dict) -> None:
    from routers.invoices import log_invoice_history  # evita import circular (invoices chama este módulo)
    await log_invoice_history(invoice_id=invoice["id"], invoice_number=invoice["invoice_number"], action="UPDATED",
                              changes=changes, user_id=user["sub"], user_name=user.get("name"))


async def _set_invoice_credit(invoice: dict, new_cents: int, paid_day: Optional[str], user: dict, reason: str) -> None:
    """Grava o crédito usado na fatura e acerta a situação: crédito cobrindo o
    total quita a fatura; estornar o crédito de uma fatura quitada por ele a
    reabre. Fatura paga por outro meio continua paga."""
    old_cents = _cents(invoice.get("credit_applied"))
    total_cents = _cents(invoice.get("total_value"))
    status = invoice.get("status") or "PENDENTE"
    update = {"credit_applied": _money(new_cents)}
    changes = {"credit_applied": {"from": _money(old_cents), "to": _money(new_cents)}, "reason": reason}
    if status == "PENDENTE" and total_cents > 0 and new_cents >= total_cents:
        update.update(status="PAGO", paid_date=paid_day or _today().isoformat(), paid_by_credit=True)
        changes.update(status={"from": "PENDENTE", "to": "PAGO"}, paid_date={"from": invoice.get("paid_date"), "to": update["paid_date"]})
    elif status == "PAGO" and invoice.get("paid_by_credit") and new_cents < total_cents:
        update.update(status="PENDENTE", paid_date=None, paid_by_credit=False)
        changes.update(status={"from": "PAGO", "to": "PENDENTE"}, paid_date={"from": invoice.get("paid_date"), "to": None})
    # Condicionado ao valor lido: outra baixa na mesma fatura no meio do caminho vira 409
    done = await db.invoices.update_one(
        {"id": invoice["id"], "credit_applied": invoice.get("credit_applied") if old_cents else {"$in": [invoice.get("credit_applied"), 0, None]}},
        {"$set": update})
    if not done.matched_count:
        raise HTTPException(status_code=409, detail=f"A fatura #{invoice['invoice_number']} acabou de ser alterada. Atualize e tente de novo.")
    await _log_invoice(invoice, changes, user)


async def _reverse(entry: dict, cents: int, reason: str, user: dict, entry_date: Optional[str] = None) -> dict:
    """Estorna `cents` de um lançamento (o total, pela tela; parte, quando o
    sistema devolve a sobra de uma fatura que diminuiu)"""
    client = {"id": entry["client_id"], "name": entry["client_name"], "cnpj": entry.get("client_cnpj")}
    sign = -SIGN[entry["entry_type"]]
    await _move_balance(client, sign * cents)
    done = await db.client_credit_entries.update_one(
        {"id": entry["id"], "reversed_amount": entry.get("reversed_amount") or 0},
        {"$set": {"reversed_amount": _money(_cents(entry.get("reversed_amount")) + cents)}})
    if not done.matched_count:
        await _undo_balance(client, sign * cents)
        raise HTTPException(status_code=409, detail="Este lançamento acabou de ser estornado. Atualize a lista.")
    return await _insert_entry(client, "ESTORNO", cents, entry_date or _today().isoformat(), user, sign=sign,
                               reverses_entry_id=entry["id"], reverses_entry_number=entry["entry_number"],
                               invoice_id=entry.get("invoice_id"), invoice_number=entry.get("invoice_number"), reason=reason)


async def return_invoice_credit(invoice: dict, cents: Optional[int], reason: str, user: dict) -> int:
    """Devolve ao saldo do cliente o crédito usado numa fatura (tudo, se
    cents=None), estornando as baixas da mais nova para a mais antiga. Usado
    quando a fatura é cancelada/excluída ou o total dela cai abaixo do
    crédito. Não mexe na fatura - quem chama grava o novo credit_applied."""
    uses = await db.client_credit_entries.find(
        {"invoice_id": invoice["id"], "entry_type": "USO"}, {"_id": 0}).sort("entry_number", -1).to_list(None)
    pending = cents if cents is not None else sum(_cents(u["amount"]) - _cents(u.get("reversed_amount")) for u in uses)
    returned = 0
    for use in uses:
        if pending <= 0:
            break
        available = _cents(use["amount"]) - _cents(use.get("reversed_amount"))
        part = min(available, pending)
        if part > 0:
            await _reverse(use, part, reason, user)
            pending -= part
            returned += part
    return returned


async def sync_invoice_total(invoice: dict, new_total: float, reason: str, user: dict) -> dict:
    """Chamado quando o total de uma fatura muda (edição, movimentação editada
    ou excluída). Devolve ao cliente o crédito que passou do novo total e
    acerta a situação. Retorna os campos a gravar junto com o total."""
    applied = _cents(invoice.get("credit_applied"))
    if not applied:
        return {}
    total = _cents(new_total)
    update = {}
    if applied > total:
        await return_invoice_credit(invoice, applied - total, reason, user)
        applied = total
        update["credit_applied"] = _money(applied)
    status = invoice.get("status") or "PENDENTE"
    if status == "PENDENTE" and total and applied >= total:
        update.update(status="PAGO", paid_date=_today().isoformat(), paid_by_credit=True)
    elif status == "PAGO" and invoice.get("paid_by_credit") and applied < total:
        update.update(status="PENDENTE", paid_date=None, paid_by_credit=False)
    return update


# ------------------------------------------------------------------ consultas

async def _accounts() -> dict:
    return {a["client_id"]: a async for a in db.client_credit_accounts.find({}, {"_id": 0})}


def _month_bounds():
    today = _today()
    return today.replace(day=1).isoformat(), today.isoformat()


@api_router.get("/client-credits/summary")
async def get_summary(current_user: dict = Depends(get_current_admin_user)):
    """Indicadores do topo: saldo total, clientes com saldo, recebido e usado no mês"""
    accounts = await _accounts()
    start, end = _month_bounds()
    month = await db.client_credit_entries.find(day_query("entry_date", start, end), {"_id": 0}).to_list(None)
    by_id = {e["id"]: e for e in month}
    received = used = 0
    for e in month:
        cents = _cents(e["amount"])
        if e["entry_type"] == "CREDITO":
            received += cents
        elif e["entry_type"] == "USO":
            used += cents
        elif e["entry_type"] == "ESTORNO":
            original = by_id.get(e["reverses_entry_id"]) or await db.client_credit_entries.find_one(
                {"id": e["reverses_entry_id"]}, {"_id": 0, "entry_type": 1}) or {}
            if original.get("entry_type") == "CREDITO":
                received -= cents
            elif original.get("entry_type") == "USO":
                used -= cents
    return {
        "balance_total": _money(sum(a.get("balance_cents", 0) for a in accounts.values())),
        "clients_with_balance": sum(1 for a in accounts.values() if a.get("balance_cents", 0) > 0),
        "received_month": _money(received),
        "used_month": _money(used),
    }


@api_router.get("/client-credits/accounts")
async def list_accounts(search: Optional[str] = None, only_with_balance: bool = False,
                        current_user: dict = Depends(get_current_admin_user)):
    """Clientes com conta de crédito: saldo, totais e quanto têm em faturas em
    aberto (onde o saldo pode ser usado)"""
    accounts = await _accounts()
    totals = {}
    async for e in db.client_credit_entries.find({}, {"_id": 0, "client_id": 1, "entry_type": 1, "amount": 1,
                                                       "reversed_amount": 1, "entry_date": 1}):
        t = totals.setdefault(e["client_id"], {"credited": 0, "used": 0, "refunded": 0, "last_date": None})
        net = _cents(e["amount"]) - _cents(e.get("reversed_amount"))
        key = {"CREDITO": "credited", "USO": "used", "DEVOLUCAO": "refunded"}.get(e["entry_type"])
        if key:
            t[key] += net
        t["last_date"] = max(t["last_date"] or "", e["entry_date"] or "") or None
    ids = set(accounts) | set(totals)
    clients = {c["id"]: c async for c in db.clients.find({"id": {"$in": list(ids)}}, {"_id": 0, "id": 1, "name": 1, "cnpj": 1})}
    open_invoices = await db.invoices.find({"status": {"$in": ["PENDENTE", None]}},
                                           {"_id": 0, "client_name": 1, "client_cnpj": 1, "total_value": 1, "credit_applied": 1}).to_list(None)
    search_re = re.compile(re.escape(search.strip()), re.I) if search and search.strip() else None
    rows = []
    for client_id in ids:
        account = accounts.get(client_id, {})
        client = clients.get(client_id) or {"id": client_id, "name": account.get("client_name"), "cnpj": account.get("client_cnpj")}
        if search_re and not (search_re.search(client.get("name") or "") or search_re.search(client.get("cnpj") or "")):
            continue
        balance = account.get("balance_cents", 0)
        if only_with_balance and balance <= 0:
            continue
        t = totals.get(client_id, {"credited": 0, "used": 0, "refunded": 0, "last_date": None})
        open_cents = sum(_cents(i.get("total_value")) - _cents(i.get("credit_applied")) for i in open_invoices if _invoice_matches_client(i, client))
        rows.append({
            "client_id": client_id, "client_name": client.get("name"), "client_cnpj": client.get("cnpj"),
            "balance": _money(balance), "total_credited": _money(t["credited"]), "total_used": _money(t["used"]),
            "total_refunded": _money(t["refunded"]), "last_date": t["last_date"], "open_invoices": _money(open_cents),
        })
    rows.sort(key=lambda r: (-r["balance"], (r["client_name"] or "").casefold()))
    return rows


@api_router.get("/client-credits/entries")
async def list_entries(
    client_id: Optional[str] = None, entry_type: Optional[str] = Query(None, pattern="^(CREDITO|USO|DEVOLUCAO|ESTORNO)$"),
    date_from: Optional[str] = None, date_to: Optional[str] = None, search: Optional[str] = None,
    page: int = Query(1, ge=1), per_page: int = Query(20, ge=1, le=200),
    current_user: dict = Depends(get_current_admin_user),
):
    """Lançamentos (mais recentes primeiro), com filtros e paginação"""
    search_q = text_query(("client_name", "reference", "notes", "reason"), search)
    if search and search.strip().lstrip("#").isdigit():
        number = int(search.strip().lstrip("#"))
        search_q = {"$or": search_q["$or"] + [{"invoice_number": number}, {"entry_number": number}]}
    query = combine({"client_id": client_id} if client_id else {}, {"entry_type": entry_type} if entry_type else {},
                    day_query("entry_date", date_from, date_to), search_q)
    total = await db.client_credit_entries.count_documents(query)
    items = await db.client_credit_entries.find(query, {"_id": 0}).sort([("entry_date", -1), ("entry_number", -1)]) \
        .skip((page - 1) * per_page).limit(per_page).to_list(per_page)
    for e in items:
        e["reversible"] = e["entry_type"] != "ESTORNO" and _cents(e["amount"]) > _cents(e.get("reversed_amount"))
    return {"items": items, "total": total, "page": page, "pages": (total + per_page - 1) // per_page}


@api_router.get("/client-credits/open-invoices")
async def open_invoices(client_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Faturas em aberto do cliente onde o crédito pode ser usado (mais antigas primeiro)"""
    client = await _get_client(client_id)
    docs = await db.invoices.find(combine({"status": {"$in": ["PENDENTE", None]}}, _client_invoices_query(client)), {"_id": 0}) \
        .sort("created_at", 1).to_list(None)
    rows = []
    for inv in docs:
        if not _invoice_matches_client(inv, client):
            continue
        open_cents = _cents(inv.get("total_value")) - _cents(inv.get("credit_applied"))
        if open_cents <= 0:
            continue
        rows.append({"invoice_id": inv["id"], "invoice_number": inv["invoice_number"], "issue_date": _invoice_day(inv).isoformat(),
                     "due_date": inv.get("due_date"), "total_value": inv.get("total_value"),
                     "credit_applied": inv.get("credit_applied") or 0, "open_value": _money(open_cents)})
    account = await db.client_credit_accounts.find_one({"client_id": client_id}, {"_id": 0}) or {}
    return {"client": client, "balance": _money(account.get("balance_cents", 0)), "invoices": rows}


@api_router.get("/client-credits/invoice/{invoice_id}")
async def invoice_credits(invoice_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Baixas de crédito (e estornos) de uma fatura - mostradas no detalhe da fatura"""
    entries = await db.client_credit_entries.find({"invoice_id": invoice_id}, {"_id": 0}).sort("entry_number", 1).to_list(None)
    return entries


# ------------------------------------------------------------------ lançamentos

@api_router.post("/client-credits/entries")
async def create_entry(data: ClientCreditCreate, current_user: dict = Depends(get_current_admin_user)):
    """Lança um crédito recebido do cliente ou uma devolução de crédito a ele"""
    if data.entry_type not in ("CREDITO", "DEVOLUCAO"):
        raise HTTPException(status_code=400, detail="Use a baixa em faturas para usar o crédito")
    cents = _cents(data.amount)
    if cents <= 0:
        raise HTTPException(status_code=400, detail="Informe um valor maior que zero")
    if data.payment_method and data.payment_method not in CLIENT_CREDIT_PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail="Forma de pagamento inválida")
    day = _parse_day(data.entry_date)
    client = await _get_client(data.client_id)
    sign = SIGN[data.entry_type]
    await _move_balance(client, sign * cents)
    return await _insert_entry(client, data.entry_type, cents, day.isoformat(), current_user, sign=sign,
                               payment_method=data.payment_method, reference=(data.reference or "").strip() or None,
                               notes=(data.notes or "").strip() or None)


@api_router.post("/client-credits/apply")
async def apply_credit(data: ClientCreditApply, current_user: dict = Depends(get_current_admin_user)):
    """Dá baixa do crédito do cliente em uma ou mais faturas em aberto dele.
    Cada fatura recebe no máximo o que falta dela; o total, no máximo o saldo.
    Fatura totalmente coberta passa a Paga na data informada."""
    client = await _get_client(data.client_id)
    day = _parse_day(data.entry_date)
    allocations = [(a.invoice_id, _cents(a.amount)) for a in data.allocations if _cents(a.amount) > 0]
    if not allocations:
        raise HTTPException(status_code=400, detail="Informe o valor a usar em pelo menos uma fatura")
    if len({i for i, _ in allocations}) != len(allocations):
        raise HTTPException(status_code=400, detail="A mesma fatura aparece duas vezes")

    # Confere tudo antes de gravar qualquer coisa
    invoices = {}
    for invoice_id, cents in allocations:
        inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
        if not inv:
            raise HTTPException(status_code=404, detail="Fatura não encontrada")
        label = f"Fatura #{inv['invoice_number']}"
        if (inv.get("status") or "PENDENTE") != "PENDENTE":
            raise HTTPException(status_code=400, detail=f"{label} não está em aberto")
        if not _invoice_matches_client(inv, client):
            raise HTTPException(status_code=400, detail=f"{label} é de outro cliente ({inv.get('client_name')})")
        open_cents = _cents(inv.get("total_value")) - _cents(inv.get("credit_applied"))
        if cents > open_cents:
            raise HTTPException(status_code=400, detail=f"{label}: o valor passa do que falta receber ({_brl(open_cents)})")
        if day < _invoice_day(inv):
            raise HTTPException(status_code=400, detail=f"{label}: a data da baixa não pode ser antes da emissão")
        invoices[invoice_id] = inv
    total = sum(c for _, c in allocations)
    account = await db.client_credit_accounts.find_one({"client_id": client["id"]}, {"_id": 0}) or {}
    if total > account.get("balance_cents", 0):
        raise HTTPException(status_code=400, detail=f"Saldo de crédito insuficiente: o cliente tem {_brl(account.get('balance_cents', 0))} e a baixa soma {_brl(total)}")

    created = []
    for invoice_id, cents in allocations:
        inv = invoices[invoice_id]
        await _move_balance(client, -cents)
        try:
            await _set_invoice_credit(inv, _cents(inv.get("credit_applied")) + cents, day.isoformat(), current_user,
                                      "Baixa com crédito do cliente")
        except HTTPException:
            await _undo_balance(client, -cents)
            raise
        created.append(await _insert_entry(client, "USO", cents, day.isoformat(), current_user, sign=-1,
                                           invoice_id=inv["id"], invoice_number=inv["invoice_number"],
                                           notes=(data.notes or "").strip() or None))
    return {"entries": created, "balance": _money((await db.client_credit_accounts.find_one({"client_id": client["id"]}))["balance_cents"])}


@api_router.post("/client-credits/entries/{entry_id}/reverse")
async def reverse_entry(entry_id: str, data: ClientCreditReverse, current_user: dict = Depends(get_current_admin_user)):
    """Estorna o que resta de um lançamento. Estornar uma baixa devolve o valor
    ao saldo e reabre a fatura se ela tinha sido quitada pelo crédito; estornar
    um crédito só é possível se o saldo ainda o comporta."""
    reason = (data.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Informe o motivo do estorno")
    entry = await db.client_credit_entries.find_one({"id": entry_id}, {"_id": 0})
    if not entry:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    if entry["entry_type"] == "ESTORNO":
        raise HTTPException(status_code=400, detail="Estorno não pode ser estornado: lance de novo o valor correto")
    remaining = _cents(entry["amount"]) - _cents(entry.get("reversed_amount"))
    if remaining <= 0:
        raise HTTPException(status_code=400, detail="Este lançamento já foi estornado")

    if entry["entry_type"] == "USO":
        inv = await db.invoices.find_one({"id": entry["invoice_id"]}, {"_id": 0})
        if inv and (inv.get("status") or "PENDENTE") == "PAGO" and not inv.get("paid_by_credit"):
            raise HTTPException(status_code=400, detail=f"A fatura #{inv['invoice_number']} foi paga por outro meio: volte-a para Pendente antes de estornar o crédito")
        if inv and (inv.get("status") or "PENDENTE") != "CANCELADO":
            await _set_invoice_credit(inv, max(_cents(inv.get("credit_applied")) - remaining, 0), None, current_user,
                                      f"Estorno da baixa de crédito: {reason}")
    elif entry["entry_type"] == "CREDITO":
        account = await db.client_credit_accounts.find_one({"client_id": entry["client_id"]}, {"_id": 0}) or {}
        if account.get("balance_cents", 0) < remaining:
            raise HTTPException(status_code=400, detail=f"O crédito já foi usado: o saldo é {_brl(account.get('balance_cents', 0))}. Estorne antes as baixas em faturas.")
    return await _reverse(entry, remaining, reason, current_user)


# ------------------------------------------------------------------ extrato

async def build_statement(client_id: str, date_from: Optional[str], date_to: Optional[str]) -> dict:
    client = await _get_client(client_id)
    entries = await db.client_credit_entries.find({"client_id": client_id}, {"_id": 0}).sort([("entry_date", 1), ("entry_number", 1)]).to_list(None)
    opening = 0
    rows = []
    running = 0
    for e in entries:
        cents = _cents(e["signed_amount"])
        if date_from and e["entry_date"] < date_from:
            opening += cents
            running += cents
            continue
        if date_to and e["entry_date"] > date_to:
            continue
        running += cents
        rows.append({**e, "balance": _money(running)})
    period_in = sum(_cents(r["signed_amount"]) for r in rows if r["signed_amount"] > 0)
    period_out = -sum(_cents(r["signed_amount"]) for r in rows if r["signed_amount"] < 0)
    account = await db.client_credit_accounts.find_one({"client_id": client_id}, {"_id": 0}) or {}
    return {"client": client, "opening_balance": _money(opening), "closing_balance": _money(running),
            "period_in": _money(period_in), "period_out": _money(period_out),
            "current_balance": _money(account.get("balance_cents", 0)), "rows": rows}


def _entry_text(r: dict) -> str:
    if r["entry_type"] == "USO":
        text = f"Baixa na fatura #{r['invoice_number']}"
    elif r["entry_type"] == "ESTORNO":
        text = f"Estorno do lançamento #{r['reverses_entry_number']}" + (f" (fatura #{r['invoice_number']})" if r.get("invoice_number") else "")
        text += f" - {r['reason']}" if r.get("reason") else ""
    else:
        text = TYPE_LABELS[r["entry_type"]] + (f" · {METHOD_LABELS.get(r['payment_method'], r['payment_method'])}" if r.get("payment_method") else "")
        text += f" · {r['reference']}" if r.get("reference") else ""
    return text + (f" · {r['notes']}" if r.get("notes") and r["entry_type"] != "ESTORNO" else "")


def _statement_sections(data):
    rows = [[None, None, "Saldo anterior", None, None, data["opening_balance"]]] if data["rows"] or data["opening_balance"] else []
    for r in data["rows"]:
        rows.append([r["entry_number"], r["entry_date"], _entry_text(r),
                     r["amount"] if r["signed_amount"] > 0 else None,
                     r["amount"] if r["signed_amount"] < 0 else None, r["balance"]])
    return [Section(
        "Extrato",
        [Column("Nº", INT, 7), Column("Data", DAY, 10), Column("Histórico", width=52), Column("Entrada", MONEY, 13),
         Column("Saída", MONEY, 13), Column("Saldo", MONEY, 13)],
        rows, total=["TOTAL", None, None, data["period_in"], data["period_out"], data["closing_balance"]],
        empty_text="Nenhum lançamento no período.", sheet_name="Extrato",
    )]


def _statement_info(data):
    return [("Cliente", data["client"]["name"]), ("CNPJ", data["client"].get("cnpj") or "-"),
            ("Saldo anterior", format_currency(data["opening_balance"], "BRL")),
            ("Entradas", format_currency(data["period_in"], "BRL")), ("Saídas", format_currency(data["period_out"], "BRL")),
            ("Saldo final", format_currency(data["closing_balance"], "BRL"))]


@api_router.get("/client-credits/statement/{client_id}")
async def get_statement(client_id: str, date_from: Optional[str] = None, date_to: Optional[str] = None,
                        current_user: dict = Depends(get_current_admin_user)):
    """Extrato do cliente com saldo anterior, lançamentos e saldo corrido"""
    day_query("entry_date", date_from, date_to)  # valida as datas
    return await build_statement(client_id, date_from, date_to)


@api_router.get("/client-credits/statement/{client_id}/pdf")
async def get_statement_pdf(client_id: str, date_from: Optional[str] = None, date_to: Optional[str] = None,
                            current_user: dict = Depends(get_current_admin_user)):
    day_query("entry_date", date_from, date_to)
    data = await build_statement(client_id, date_from, date_to)
    return await pdf_response(f"Extrato de Crédito - {data['client']['name']}", period_text("Lançamentos", date_from, date_to),
                              _statement_info(data), _statement_sections(data), "extrato_credito", current_user.get("name", "Sistema"))


@api_router.get("/client-credits/statement/{client_id}/excel")
async def get_statement_excel(client_id: str, date_from: Optional[str] = None, date_to: Optional[str] = None,
                              current_user: dict = Depends(get_current_admin_user)):
    day_query("entry_date", date_from, date_to)
    data = await build_statement(client_id, date_from, date_to)
    return await excel_response(f"Extrato de Crédito - {data['client']['name']}",
                                period_text("Lançamentos", date_from, date_to) or "Todos os lançamentos",
                                _statement_sections(data), "extrato_credito")
