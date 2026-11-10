"""Financeiro - Contas a Pagar: títulos de fornecedores e despesas (aluguel,
peças, impostos, serviços...) com Plano de Contas e Centro de Custo.

Cada parcela é um documento; as parcelas de um mesmo lançamento (parcelado ou
recorrente) dividem o número e o group_id ("Nº 12 - 2/3"). A parcela em aberto
pode ser alterada; paga, só depois de estornar a baixa. A NF-e importada em
Entradas de Estoque também gera as parcelas das duplicatas dela
(create_nfe_payables), ligadas pelo import_id.

Fechamento do período financeiro (period_lock): incluir, alterar, cancelar e
excluir olham a data do documento; a baixa e o estorno olham a data da baixa.
"""
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from list_filters import combine, text_query
from models import ChartAccountCreate, CostCenterCreate, PayableCancel, PayableCreate, PayablePay, PayableUpdate
from period_lock import ensure_period_open
from period_reports import Column, Section, DAY, MONEY, excel_response, pdf_response, period_text
from reports import BRT_TZ
from routers.container_audits import _remove_photo_file
from shared import ALLOWED_RECEIPT_EXTENSIONS, UPLOADS_DIR, db, get_current_admin_user, validate_and_read_upload

api_router = APIRouter(prefix="/api")

MODULE_KEY = "financeiro.contas_pagar"
MAX_ATTACHMENTS = 5
MAX_INSTALLMENTS = 120
DUE_SOON_DAYS = 3  # alerta do sino: vencendo de hoje até daqui a 3 dias
STATUS_LABELS = {"ABERTO": "Em aberto", "PAGO": "Pago", "CANCELADO": "Cancelado", "VENCIDO": "Vencido", "A_VENCER": "A vencer"}
PAYMENT_METHODS = {
    "PIX": "PIX", "BOLETO": "Boleto", "TRANSFERENCIA": "Transferência", "DINHEIRO": "Dinheiro",
    "CHEQUE": "Cheque", "CARTAO": "Cartão", "DEBITO_AUTOMATICO": "Débito automático",
}

# Criados na primeira vez que a lista é aberta; dá para renomear, desativar ou criar outros
DEFAULT_ACCOUNTS = [
    ("1.01", "Receita de frete", "RECEITA"), ("1.02", "Receita de armazenagem", "RECEITA"),
    ("1.03", "Receita de serviços portuários", "RECEITA"), ("1.99", "Outras receitas", "RECEITA"),
    ("2.01", "Combustível", "DESPESA"), ("2.02", "Manutenção de veículos e equipamentos", "DESPESA"),
    ("2.03", "Pneus", "DESPESA"), ("2.04", "Pedágio", "DESPESA"), ("2.05", "Salários e encargos", "DESPESA"),
    ("2.06", "Impostos e taxas", "DESPESA"), ("2.07", "Aluguel", "DESPESA"),
    ("2.08", "Energia, água, telefone e internet", "DESPESA"), ("2.09", "Seguros", "DESPESA"),
    ("2.10", "Serviços de terceiros", "DESPESA"), ("2.11", "Materiais e almoxarifado", "DESPESA"),
    ("2.12", "Tarifas bancárias e juros", "DESPESA"), ("2.99", "Outras despesas", "DESPESA"),
]
DEFAULT_COST_CENTERS = ["Administrativo", "Terminal", "Frota / Transporte", "Oficina"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> str:
    return datetime.now(BRT_TZ).date().isoformat()


def _parse_day(value: Optional[str], what: str) -> str:
    try:
        return date.fromisoformat((value or "")[:10]).isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{what} inválida")


def _clean(value: Optional[str]) -> Optional[str]:
    return " ".join((value or "").split()) or None


def _code_key(code: str) -> tuple:
    """'2.10' depois de '2.9': ordena o código pelos números."""
    return tuple((0, int(p)) if p.isdigit() else (1, p) for p in re.split(r"[.\- ]", code or ""))


def _brl(value: float) -> str:
    return f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


# ------------------------------------------------------------------ plano de contas e centros de custo

async def _ensure_defaults():
    if await db.chart_accounts.count_documents({}) == 0:
        await db.chart_accounts.insert_many([
            {"id": str(uuid.uuid4()), "code": code, "name": name, "kind": kind, "active": True, "created_at": _now()}
            for code, name, kind in DEFAULT_ACCOUNTS
        ])
    if await db.cost_centers.count_documents({}) == 0:
        await db.cost_centers.insert_many([
            {"id": str(uuid.uuid4()), "name": name, "active": True, "created_at": _now()} for name in DEFAULT_COST_CENTERS
        ])


async def _ensure_unique(collection: str, field: str, value: str, exclude_id: Optional[str], message: str):
    query = {field: {"$regex": f"^{re.escape(value)}$", "$options": "i"}}
    if exclude_id:
        query["id"] = {"$ne": exclude_id}
    if await db[collection].find_one(query):
        raise HTTPException(status_code=400, detail=message)


@api_router.get("/chart-accounts")
async def list_chart_accounts(current_user: dict = Depends(get_current_admin_user)):
    await _ensure_defaults()
    accounts = await db.chart_accounts.find({}, {"_id": 0}).to_list(None)
    return sorted(accounts, key=lambda a: _code_key(a["code"]))


async def _clean_account(data: ChartAccountCreate, exclude_id: Optional[str] = None) -> dict:
    code, name = _clean(data.code), _clean(data.name)
    if not code or not name:
        raise HTTPException(status_code=400, detail="Informe o código e o nome da conta")
    await _ensure_unique("chart_accounts", "code", code, exclude_id, f"Já existe uma conta com o código {code}")
    return {"code": code, "name": name, "kind": data.kind, "active": data.active}


@api_router.post("/chart-accounts")
async def create_chart_account(data: ChartAccountCreate, current_user: dict = Depends(get_current_admin_user)):
    doc = {"id": str(uuid.uuid4()), **await _clean_account(data), "created_at": _now()}
    await db.chart_accounts.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/chart-accounts/{account_id}")
async def update_chart_account(account_id: str, data: ChartAccountCreate, current_user: dict = Depends(get_current_admin_user)):
    if not await db.chart_accounts.find_one({"id": account_id}):
        raise HTTPException(status_code=404, detail="Conta não encontrada")
    fields = await _clean_account(data, account_id)
    await db.chart_accounts.update_one({"id": account_id}, {"$set": fields})
    # Os títulos guardam o nome: renomear vale para os antigos também
    await db.payables.update_many({"account_id": account_id}, {"$set": {"account_name": f"{fields['code']} {fields['name']}"}})
    return await db.chart_accounts.find_one({"id": account_id}, {"_id": 0})


@api_router.delete("/chart-accounts/{account_id}")
async def delete_chart_account(account_id: str, current_user: dict = Depends(get_current_admin_user)):
    if await db.payables.find_one({"account_id": account_id}):
        raise HTTPException(status_code=400, detail="Esta conta já foi usada em contas a pagar. Desative em vez de excluir.")
    result = await db.chart_accounts.delete_one({"id": account_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Conta não encontrada")
    return {"message": "Conta excluída"}


@api_router.get("/cost-centers")
async def list_cost_centers(current_user: dict = Depends(get_current_admin_user)):
    await _ensure_defaults()
    return await db.cost_centers.find({}, {"_id": 0}).sort("name", 1).to_list(None)


async def _clean_center(data: CostCenterCreate, exclude_id: Optional[str] = None) -> str:
    name = _clean(data.name)
    if not name:
        raise HTTPException(status_code=400, detail="Informe o nome do centro de custo")
    await _ensure_unique("cost_centers", "name", name, exclude_id, "Já existe um centro de custo com esse nome")
    return name


@api_router.post("/cost-centers")
async def create_cost_center(data: CostCenterCreate, current_user: dict = Depends(get_current_admin_user)):
    doc = {"id": str(uuid.uuid4()), "name": await _clean_center(data), "active": data.active, "created_at": _now()}
    await db.cost_centers.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/cost-centers/{center_id}")
async def update_cost_center(center_id: str, data: CostCenterCreate, current_user: dict = Depends(get_current_admin_user)):
    if not await db.cost_centers.find_one({"id": center_id}):
        raise HTTPException(status_code=404, detail="Centro de custo não encontrado")
    name = await _clean_center(data, center_id)
    await db.cost_centers.update_one({"id": center_id}, {"$set": {"name": name, "active": data.active}})
    await db.payables.update_many({"cost_center_id": center_id}, {"$set": {"cost_center_name": name}})
    return await db.cost_centers.find_one({"id": center_id}, {"_id": 0})


@api_router.delete("/cost-centers/{center_id}")
async def delete_cost_center(center_id: str, current_user: dict = Depends(get_current_admin_user)):
    if await db.payables.find_one({"cost_center_id": center_id}):
        raise HTTPException(status_code=400, detail="Este centro de custo já foi usado em contas a pagar. Desative em vez de excluir.")
    result = await db.cost_centers.delete_one({"id": center_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Centro de custo não encontrado")
    return {"message": "Centro de custo excluído"}


# ------------------------------------------------------------------ títulos

async def _links(supplier_id, supplier_name, account_id, cost_center_id) -> dict:
    """Confere os vínculos e devolve os nomes que o título guarda."""
    fields = {"supplier_id": None, "supplier_name": _clean(supplier_name),
              "account_id": None, "account_name": None, "cost_center_id": None, "cost_center_name": None}
    if supplier_id:
        supplier = await db.suppliers.find_one({"id": supplier_id}, {"_id": 0, "id": 1, "name": 1})
        if not supplier:
            raise HTTPException(status_code=400, detail="Fornecedor não encontrado")
        fields["supplier_id"], fields["supplier_name"] = supplier["id"], supplier["name"]
    if account_id:
        account = await db.chart_accounts.find_one({"id": account_id}, {"_id": 0})
        if not account:
            raise HTTPException(status_code=400, detail="Conta do plano de contas não encontrada")
        fields["account_id"], fields["account_name"] = account["id"], f"{account['code']} {account['name']}"
    if cost_center_id:
        center = await db.cost_centers.find_one({"id": cost_center_id}, {"_id": 0})
        if not center:
            raise HTTPException(status_code=400, detail="Centro de custo não encontrado")
        fields["cost_center_id"], fields["cost_center_name"] = center["id"], center["name"]
    return fields


async def _next_number() -> int:
    counter = await db.counters.find_one_and_update(
        {"_id": "payable_number"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    return counter["seq"]


async def insert_payable_group(*, description: str, issue_date: str, installments: list, recurrence: str,
                               links: dict, current_user: dict, document_number: Optional[str] = None,
                               notes: Optional[str] = None, extra: Optional[dict] = None) -> list:
    """Grava as parcelas de um lançamento (também usado pela importação de NF-e)."""
    number, group_id, now = await _next_number(), str(uuid.uuid4()), _now()
    docs = []
    for index, inst in enumerate(installments, start=1):
        docs.append({
            "id": str(uuid.uuid4()), "group_id": group_id, "payable_number": number,
            "installment": index, "installments_total": len(installments), "recurrence": recurrence,
            "description": description, "document_number": document_number, "issue_date": issue_date,
            "due_date": inst["due_date"], "amount": round(inst["amount"], 2), **links,
            "status": "ABERTO", "paid_date": None, "paid_amount": None, "interest": 0, "discount": 0,
            "payment_method": None, "payment_notes": None, "attachments": [], "notes": notes,
            "origin": "MANUAL", **(extra or {}),
            "created_by": current_user["sub"], "created_by_name": current_user.get("name", "Sistema"), "created_at": now,
        })
    await db.payables.insert_many(docs)
    for doc in docs:
        doc.pop("_id", None)
    return docs


@api_router.post("/payables")
async def create_payable(data: PayableCreate, current_user: dict = Depends(get_current_admin_user)):
    description = _clean(data.description)
    if not description:
        raise HTTPException(status_code=400, detail="Informe a descrição da conta")
    if not data.supplier_id and not _clean(data.supplier_name):
        raise HTTPException(status_code=400, detail="Informe o fornecedor (do cadastro ou só o nome)")
    if not data.installments:
        raise HTTPException(status_code=400, detail="Informe pelo menos uma parcela")
    if len(data.installments) > MAX_INSTALLMENTS:
        raise HTTPException(status_code=400, detail=f"No máximo {MAX_INSTALLMENTS} parcelas por lançamento")
    if data.recurrence == "UNICA" and len(data.installments) > 1:
        raise HTTPException(status_code=400, detail="Conta única tem uma parcela só")
    issue_date = _parse_day(data.issue_date, "Data do documento")
    installments = [{"due_date": _parse_day(i.due_date, "Data de vencimento"), "amount": i.amount} for i in data.installments]
    await ensure_period_open(issue_date, what="Conta a pagar")
    links = await _links(data.supplier_id, data.supplier_name, data.account_id, data.cost_center_id)
    return await insert_payable_group(
        description=description, issue_date=issue_date, installments=installments, recurrence=data.recurrence,
        links=links, current_user=current_user, document_number=_clean(data.document_number),
        notes=(data.notes or "").strip() or None,
    )


DATE_FIELDS = {"due_date": "due_date", "paid_date": "paid_date", "issue_date": "issue_date"}


def _list_query(search=None, status=None, account_id=None, cost_center_id=None, supplier_id=None,
                date_field="due_date", date_from=None, date_to=None) -> dict:
    today = _today()
    query = {}
    if status == "VENCIDO":
        query = {"status": "ABERTO", "due_date": {"$lt": today}}
    elif status == "A_VENCER":
        query = {"status": "ABERTO", "due_date": {"$gte": today}}
    elif status:
        query = {"status": status}
    for field, value in (("account_id", account_id), ("cost_center_id", cost_center_id), ("supplier_id", supplier_id)):
        if value:
            query[field] = value
    field = DATE_FIELDS.get(date_field)
    if not field:
        raise HTTPException(status_code=400, detail="Filtro de data inválido")
    period = {k: v for k, v in (("$gte", date_from), ("$lte", date_to)) if v}
    period_part = {field: period} if period else {}
    text = text_query(("description", "supplier_name", "document_number", "account_name", "cost_center_name"), search)
    digits = (search or "").strip().lstrip("#")
    if digits.isdigit():
        text = {"$or": [text, {"payable_number": int(digits)}]}
    return combine(query, period_part, text)


def _with_overdue(doc: dict, today: str) -> dict:
    doc["overdue"] = doc.get("status") == "ABERTO" and (doc.get("due_date") or "") < today
    return doc


@api_router.get("/payables")
async def list_payables(
    search: Optional[str] = None, status: Optional[str] = None, account_id: Optional[str] = None,
    cost_center_id: Optional[str] = None, supplier_id: Optional[str] = None,
    date_field: str = "due_date", date_from: Optional[str] = None, date_to: Optional[str] = None,
    page: int = 1, per_page: int = 20,
    current_user: dict = Depends(get_current_admin_user),
):
    query = _list_query(search, status, account_id, cost_center_id, supplier_id, date_field, date_from, date_to)
    page, per_page = max(page, 1), min(max(per_page, 1), 200)
    total = await db.payables.count_documents(query)
    items = await db.payables.find(query, {"_id": 0}).sort(
        [("due_date", 1), ("payable_number", 1), ("installment", 1)]
    ).skip((page - 1) * per_page).limit(per_page).to_list(per_page)
    sums = {"open": 0.0, "paid": 0.0}
    async for doc in db.payables.find(query, {"_id": 0, "status": 1, "amount": 1, "paid_amount": 1}):
        if doc["status"] == "ABERTO":
            sums["open"] += doc.get("amount") or 0
        elif doc["status"] == "PAGO":
            sums["paid"] += doc.get("paid_amount") or 0
    today = _today()
    return {
        "items": [_with_overdue(i, today) for i in items], "total": total, "page": page,
        "pages": (total + per_page - 1) // per_page, "sums": {k: round(v, 2) for k, v in sums.items()},
    }


@api_router.get("/payables/summary")
async def payables_summary(current_user: dict = Depends(get_current_admin_user)):
    """Os quadros do topo da tela: vencidos, vence hoje, próximos 7 dias, pagos no mês."""
    today_date = datetime.now(BRT_TZ).date()
    today, week = today_date.isoformat(), (today_date + timedelta(days=7)).isoformat()
    month_start = today_date.replace(day=1).isoformat()
    cards = {key: {"count": 0, "total": 0.0} for key in ("overdue", "today", "next_7_days", "paid_this_month")}
    cursor = db.payables.find(
        {"$or": [{"status": "ABERTO", "due_date": {"$lte": week}}, {"status": "PAGO", "paid_date": {"$gte": month_start}}]},
        {"_id": 0, "status": 1, "due_date": 1, "amount": 1, "paid_amount": 1},
    )
    async for doc in cursor:
        if doc["status"] == "PAGO":
            key, value = "paid_this_month", doc.get("paid_amount") or 0
        elif doc["due_date"] < today:
            key, value = "overdue", doc.get("amount") or 0
        elif doc["due_date"] == today:
            key, value = "today", doc.get("amount") or 0
        else:
            key, value = "next_7_days", doc.get("amount") or 0
        cards[key]["count"] += 1
        cards[key]["total"] += value
    return {k: {"count": v["count"], "total": round(v["total"], 2)} for k, v in cards.items()}


async def _get(payable_id: str) -> dict:
    doc = await db.payables.find_one({"id": payable_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Conta a pagar não encontrada")
    return doc


@api_router.get("/payables/{payable_id}")
async def get_payable(payable_id: str, current_user: dict = Depends(get_current_admin_user)):
    doc = await _get(payable_id)
    doc["group"] = await db.payables.find(
        {"group_id": doc["group_id"]},
        {"_id": 0, "id": 1, "installment": 1, "due_date": 1, "amount": 1, "status": 1, "paid_date": 1, "paid_amount": 1},
    ).sort("installment", 1).to_list(None)
    return _with_overdue(doc, _today())


def _label(doc: dict) -> str:
    total = doc.get("installments_total") or 1
    return f"Nº {doc['payable_number']}" + (f" - {doc['installment']}/{total}" if total > 1 else "")


@api_router.put("/payables/{payable_id}")
async def update_payable(payable_id: str, data: PayableUpdate, current_user: dict = Depends(get_current_admin_user)):
    current = await _get(payable_id)
    if current["status"] != "ABERTO":
        raise HTTPException(status_code=400, detail=f"A conta {_label(current)} não está em aberto: só conta em aberto pode ser alterada")
    description = _clean(data.description)
    if not description:
        raise HTTPException(status_code=400, detail="Informe a descrição da conta")
    if not data.supplier_id and not _clean(data.supplier_name):
        raise HTTPException(status_code=400, detail="Informe o fornecedor (do cadastro ou só o nome)")
    issue_date = _parse_day(data.issue_date, "Data do documento")
    await ensure_period_open(current["issue_date"], issue_date, what="Conta a pagar")
    fields = {
        "description": description, "document_number": _clean(data.document_number), "issue_date": issue_date,
        "due_date": _parse_day(data.due_date, "Data de vencimento"), "amount": round(data.amount, 2),
        "notes": (data.notes or "").strip() or None,
        **await _links(data.supplier_id, data.supplier_name, data.account_id, data.cost_center_id),
        "updated_at": _now(),
    }
    # Gravação condicionada: paga ou cancelada entre a leitura e aqui, não altera
    result = await db.payables.update_one({"id": payable_id, "status": "ABERTO"}, {"$set": fields})
    if result.matched_count == 0:
        raise HTTPException(status_code=409, detail="A conta mudou de situação enquanto era alterada. Atualize a tela.")
    return await get_payable(payable_id, current_user)


@api_router.delete("/payables/{payable_id}")
async def delete_payable(payable_id: str, whole_group: bool = False, current_user: dict = Depends(get_current_admin_user)):
    current = await _get(payable_id)
    if current.get("origin") == "NFE":
        raise HTTPException(status_code=400, detail="Esta conta veio da importação de uma NF-e. Para excluir, estorne a importação em Entradas de Estoque (ou cancele a conta).")
    targets = await db.payables.find({"group_id": current["group_id"]}, {"_id": 0}).to_list(None) if whole_group else [current]
    paid = [t for t in targets if t["status"] == "PAGO"]
    if paid:
        raise HTTPException(status_code=400, detail=f"A conta {_label(paid[0])} já foi paga. Estorne o pagamento antes de excluir.")
    await ensure_period_open(current["issue_date"], what="Conta a pagar")
    await db.payables.delete_many({"id": {"$in": [t["id"] for t in targets]}, "status": {"$ne": "PAGO"}})
    for target in targets:
        for attachment in target.get("attachments") or []:
            _remove_photo_file(attachment)
    return {"deleted": len(targets)}


@api_router.post("/payables/pay")
async def pay_payables(data: PayablePay, current_user: dict = Depends(get_current_admin_user)):
    ids = list(dict.fromkeys(data.ids))
    if not ids:
        raise HTTPException(status_code=400, detail="Selecione as contas a pagar")
    if data.payment_method not in PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail="Forma de pagamento inválida")
    if len(ids) > 1 and (data.interest or data.discount):
        raise HTTPException(status_code=400, detail="Juros e desconto só podem ser informados pagando uma conta por vez")
    paid_date = _parse_day(data.paid_date, "Data do pagamento")
    if paid_date > _today():
        raise HTTPException(status_code=400, detail="A data do pagamento não pode ser futura")
    await ensure_period_open(paid_date, what="Pagamento")
    docs = await db.payables.find({"id": {"$in": ids}}, {"_id": 0}).to_list(None)
    if len(docs) != len(ids):
        raise HTTPException(status_code=404, detail="Alguma das contas não foi encontrada. Atualize a tela.")
    not_open = [d for d in docs if d["status"] != "ABERTO"]
    if not_open:
        raise HTTPException(status_code=400, detail=f"A conta {_label(not_open[0])} não está em aberto")
    if docs[0]["amount"] + data.interest - data.discount <= 0:
        raise HTTPException(status_code=400, detail="O desconto não pode ser maior que o valor da conta")
    paid = 0
    for doc in docs:
        result = await db.payables.update_one({"id": doc["id"], "status": "ABERTO"}, {"$set": {
            "status": "PAGO", "paid_date": paid_date, "paid_amount": round(doc["amount"] + data.interest - data.discount, 2),
            "interest": round(data.interest, 2), "discount": round(data.discount, 2),
            "payment_method": data.payment_method, "payment_notes": (data.payment_notes or "").strip() or None,
            "paid_by_name": current_user.get("name", "Sistema"), "updated_at": _now(),
        }})
        paid += result.modified_count
    return {"paid": paid}


@api_router.post("/payables/{payable_id}/unpay")
async def unpay_payable(payable_id: str, current_user: dict = Depends(get_current_admin_user)):
    current = await _get(payable_id)
    if current["status"] != "PAGO":
        raise HTTPException(status_code=400, detail="Esta conta não está paga")
    await ensure_period_open(current["paid_date"], what="Pagamento")
    await db.payables.update_one({"id": payable_id, "status": "PAGO"}, {"$set": {
        "status": "ABERTO", "paid_date": None, "paid_amount": None, "interest": 0, "discount": 0,
        "payment_method": None, "payment_notes": None, "paid_by_name": None, "updated_at": _now(),
    }})
    return await get_payable(payable_id, current_user)


@api_router.post("/payables/{payable_id}/cancel")
async def cancel_payable(payable_id: str, data: PayableCancel, current_user: dict = Depends(get_current_admin_user)):
    current = await _get(payable_id)
    expected = "ABERTO" if data.cancelled else "CANCELADO"
    if current["status"] != expected:
        raise HTTPException(status_code=400, detail="Só conta em aberto pode ser cancelada" if data.cancelled else "Esta conta não está cancelada")
    await ensure_period_open(current["issue_date"], what="Conta a pagar")
    await db.payables.update_one({"id": payable_id, "status": expected}, {"$set": {
        "status": "CANCELADO" if data.cancelled else "ABERTO", "updated_at": _now(),
    }})
    return await get_payable(payable_id, current_user)


@api_router.post("/payables/{payable_id}/attachments")
async def upload_payable_attachment(payable_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_admin_user)):
    current = await _get(payable_id)
    if len(current.get("attachments") or []) >= MAX_ATTACHMENTS:
        raise HTTPException(status_code=400, detail=f"No máximo {MAX_ATTACHMENTS} anexos por conta")
    file_ext, content = await validate_and_read_upload(file, ALLOWED_RECEIPT_EXTENSIONS)
    folder = UPLOADS_DIR / "payables" / current["group_id"]
    folder.mkdir(parents=True, exist_ok=True)
    attachment_id = str(uuid.uuid4())
    (folder / f"{attachment_id}{file_ext}").write_bytes(content)
    attachment = {
        "id": attachment_id, "url": f"/api/uploads/payables/{current['group_id']}/{attachment_id}{file_ext}",
        "name": (file.filename or f"anexo{file_ext}")[:120], "uploaded_at": _now(),
    }
    await db.payables.update_one({"id": payable_id}, {"$push": {"attachments": attachment}})
    return await get_payable(payable_id, current_user)


@api_router.delete("/payables/{payable_id}/attachments/{attachment_id}")
async def delete_payable_attachment(payable_id: str, attachment_id: str, current_user: dict = Depends(get_current_admin_user)):
    current = await _get(payable_id)
    attachment = next((a for a in current.get("attachments") or [] if a["id"] == attachment_id), None)
    if not attachment:
        raise HTTPException(status_code=404, detail="Anexo não encontrado")
    await db.payables.update_one({"id": payable_id}, {"$pull": {"attachments": {"id": attachment_id}}})
    _remove_photo_file(attachment)
    return await get_payable(payable_id, current_user)


# ------------------------------------------------------------------ NF-e de entrada

async def prepare_nfe_payables(*, nfe_issue_date: Optional[str], installments: list, account_id: Optional[str],
                               cost_center_id: Optional[str]) -> dict:
    """Confere as parcelas da NF-e antes da importação gravar qualquer coisa."""
    issue = _parse_day(nfe_issue_date, "Data de emissão da NF-e") if nfe_issue_date else _today()
    parsed = []
    for inst in installments:
        if not inst.amount or inst.amount <= 0:
            raise HTTPException(status_code=400, detail="Parcela da NF-e com valor inválido")
        parsed.append({"due_date": _parse_day(inst.due_date, "Vencimento da parcela da NF-e"), "amount": inst.amount})
    if len(parsed) > MAX_INSTALLMENTS:
        raise HTTPException(status_code=400, detail=f"No máximo {MAX_INSTALLMENTS} parcelas por lançamento")
    await ensure_period_open(issue, what="Conta a pagar da NF-e")
    links = await _links(None, None, account_id, cost_center_id)
    return {"issue_date": issue, "installments": parsed, "links": links}


async def create_nfe_payables(prepared: dict, *, import_id: str, nfe_number: Optional[str], nfe_key: Optional[str],
                              supplier_id: Optional[str], supplier_name: Optional[str], current_user: dict) -> list:
    """As duplicatas da NF-e importada viram parcelas a pagar ao fornecedor."""
    if not prepared or not prepared["installments"]:
        return []
    links = {**prepared["links"], "supplier_id": supplier_id, "supplier_name": supplier_name}
    return await insert_payable_group(
        description=f"NF-e {nfe_number}" if nfe_number else "NF-e de entrada", issue_date=prepared["issue_date"],
        installments=prepared["installments"], recurrence="PARCELADA" if len(prepared["installments"]) > 1 else "UNICA",
        links=links, current_user=current_user, document_number=nfe_number,
        extra={"origin": "NFE", "nfe_import_id": import_id, "nfe_key": nfe_key},
    )


async def nfe_payables_to_remove(import_id: Optional[str]) -> list:
    """Estornar a importação apaga as parcelas dela; parcela paga impede."""
    if not import_id:
        return []
    docs = await db.payables.find({"nfe_import_id": import_id}, {"_id": 0}).to_list(None)
    paid = [d for d in docs if d["status"] == "PAGO"]
    if paid:
        raise HTTPException(
            status_code=409,
            detail=f"A conta a pagar {_label(paid[0])} desta nota já foi paga. Estorne o pagamento em Contas a Pagar antes de estornar a importação.",
        )
    if docs:
        await ensure_period_open(docs[0]["issue_date"], what="Conta a pagar da NF-e")
    return docs


async def delete_payables(docs: list):
    if not docs:
        return
    await db.payables.delete_many({"id": {"$in": [d["id"] for d in docs]}, "status": {"$ne": "PAGO"}})
    for doc in docs:
        for attachment in doc.get("attachments") or []:
            _remove_photo_file(attachment)


# ------------------------------------------------------------------ relatório

async def build_payables_report(date_field="due_date", date_from=None, date_to=None, status=None,
                                account_id=None, cost_center_id=None, search=None) -> dict:
    query = _list_query(search, status, account_id, cost_center_id, None, date_field, date_from, date_to)
    rows = await db.payables.find(query, {"_id": 0, "attachments": 0}).sort(
        [("due_date", 1), ("payable_number", 1), ("installment", 1)]
    ).to_list(None)
    today = _today()
    by_account, by_center = {}, {}
    summary = {"total": len(rows), "open": 0.0, "overdue": 0.0, "paid": 0.0, "cancelled": 0}
    for r in rows:
        r["label"] = _label(r)
        r["situation"] = "VENCIDO" if r["status"] == "ABERTO" and r["due_date"] < today else r["status"]
        if r["status"] == "CANCELADO":
            summary["cancelled"] += 1
            continue
        is_paid = r["status"] == "PAGO"
        value = (r.get("paid_amount") if is_paid else r.get("amount")) or 0
        summary["paid" if is_paid else "open"] += value
        if r["situation"] == "VENCIDO":
            summary["overdue"] += value
        for bucket, key in ((by_account, r.get("account_name") or "Sem conta"),
                            (by_center, r.get("cost_center_name") or "Sem centro de custo")):
            line = bucket.setdefault(key, {"name": key, "open": 0.0, "paid": 0.0})
            line["paid" if is_paid else "open"] += value
    return {
        "rows": rows,
        "by_account": sorted(by_account.values(), key=lambda a: _code_key(a["name"])),
        "by_center": sorted(by_center.values(), key=lambda c: c["name"]),
        "summary": {k: round(v, 2) if isinstance(v, float) else v for k, v in summary.items()},
    }


def _report_sections(data):
    s = data["summary"]
    cols = lambda title: [Column(title, width=40), Column("Em aberto", MONEY, 14), Column("Pago", MONEY, 14), Column("Total", MONEY, 14)]
    lines = lambda items: [[l["name"], round(l["open"], 2), round(l["paid"], 2), round(l["open"] + l["paid"], 2)] for l in items]
    total_row = ["TOTAL", s["open"], s["paid"], round(s["open"] + s["paid"], 2)]
    by_account = Section("Por conta do plano de contas", cols("Conta"), lines(data["by_account"]), total=total_row,
                         empty_text="Nenhuma conta no período.", sheet_name="Por conta")
    by_center = Section("Por centro de custo", cols("Centro de custo"), lines(data["by_center"]), total=total_row,
                        empty_text="Nenhuma conta no período.", sheet_name="Por centro de custo")
    detail = Section(
        "Contas do período",
        [Column("Nº", width=8), Column("Vencimento", DAY, 9), Column("Fornecedor", width=17), Column("Descrição", width=19),
         Column("Documento", width=9), Column("Conta", width=15), Column("Centro de custo", width=12),
         Column("Valor", MONEY, 10), Column("Pago em", DAY, 9), Column("Valor pago", MONEY, 10), Column("Situação", width=9, align="center")],
        [[r["label"], r.get("due_date"), r.get("supplier_name"), r.get("description"), r.get("document_number"),
          r.get("account_name"), r.get("cost_center_name"), r.get("amount"), r.get("paid_date"), r.get("paid_amount"),
          STATUS_LABELS.get(r["situation"], r["situation"])] for r in data["rows"]],
        empty_text="Nenhuma conta no período.", sheet_name="Contas",
    )
    return [by_account, by_center, detail]


def _subtitle(date_field, date_from, date_to, status, search):
    label = {"paid_date": "Pagamento", "issue_date": "Emissão"}.get(date_field, "Vencimento")
    parts = [period_text(label, date_from, date_to),
             f"Situação: {STATUS_LABELS.get(status, status)}" if status else None,
             f"Busca: {search}" if search else None]
    return " · ".join(p for p in parts if p) or None


@api_router.get("/reports/payables")
async def get_payables_report(
    date_field: str = "due_date", date_from: Optional[str] = None, date_to: Optional[str] = None, status: Optional[str] = None,
    account_id: Optional[str] = None, cost_center_id: Optional[str] = None, search: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user),
):
    return await build_payables_report(date_field, date_from, date_to, status, account_id, cost_center_id, search)


@api_router.get("/reports/payables/pdf")
async def get_payables_report_pdf(
    date_field: str = "due_date", date_from: Optional[str] = None, date_to: Optional[str] = None, status: Optional[str] = None,
    account_id: Optional[str] = None, cost_center_id: Optional[str] = None, search: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user),
):
    data = await build_payables_report(date_field, date_from, date_to, status, account_id, cost_center_id, search)
    s = data["summary"]
    info = [("Contas", str(s["total"])), ("Em aberto", _brl(s["open"])), ("Vencido", _brl(s["overdue"])), ("Pago", _brl(s["paid"]))]
    return await pdf_response("Relatório de Contas a Pagar", _subtitle(date_field, date_from, date_to, status, search), info,
                              _report_sections(data), "relatorio_contas_pagar", current_user.get("name", "Sistema"))


@api_router.get("/reports/payables/excel")
async def get_payables_report_excel(
    date_field: str = "due_date", date_from: Optional[str] = None, date_to: Optional[str] = None, status: Optional[str] = None,
    account_id: Optional[str] = None, cost_center_id: Optional[str] = None, search: Optional[str] = None,
    current_user: dict = Depends(get_current_admin_user),
):
    data = await build_payables_report(date_field, date_from, date_to, status, account_id, cost_center_id, search)
    return await excel_response("Relatório de Contas a Pagar",
                                _subtitle(date_field, date_from, date_to, status, search) or "Todas as contas",
                                _report_sections(data), "relatorio_contas_pagar")


# ------------------------------------------------------------------ alertas do sino

async def build_payable_alerts() -> list:
    today_date = datetime.now(BRT_TZ).date()
    today, soon = today_date.isoformat(), (today_date + timedelta(days=DUE_SOON_DAYS)).isoformat()
    groups = {"overdue": [0, 0.0], "due_soon": [0, 0.0]}
    async for doc in db.payables.find({"status": "ABERTO", "due_date": {"$lte": soon}}, {"_id": 0, "due_date": 1, "amount": 1}):
        key = "overdue" if doc["due_date"] < today else "due_soon"
        groups[key][0] += 1
        groups[key][1] += doc.get("amount") or 0
    alerts = []
    for key, singular, plural, tone, status in (
        ("overdue", "conta a pagar vencida", "contas a pagar vencidas", "red", "VENCIDO"),
        ("due_soon", f"conta a pagar vencendo em até {DUE_SOON_DAYS} dias", f"contas a pagar vencendo em até {DUE_SOON_DAYS} dias", "amber", "A_VENCER"),
    ):
        count, total = groups[key]
        if count:
            alerts.append({
                "key": f"payables_{key}",
                "title": f"{count} {singular if count == 1 else plural}",
                "description": f"Total de {_brl(total)}",
                "path": f"/accounts-payable?status={status}",
                "tone": tone,
            })
    return alerts
