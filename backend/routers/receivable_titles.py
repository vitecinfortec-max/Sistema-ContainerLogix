"""Financeiro - Contas a Receber: títulos avulsos (aluguel, reembolso, venda
de sucata...), o que não passa por Fatura, Faturamento Portuário nem Venda de
Container. Aparecem junto com essas três no painel Contas a Receber
(routers/receivables.py), que é onde ficam o atraso por faixa e por cliente.

Mesmo desenho do Contas a Pagar (routers/payables.py): cada parcela é um
documento, as parcelas de um lançamento dividem o número e o group_id; em
aberto pode ser alterada, recebida só depois de estornar a baixa.
Fechamento do período (period_lock): incluir, alterar, cancelar e excluir
olham a data do documento; a baixa e o estorno, a data do recebimento.
"""
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from chart_links import account_links
from list_filters import combine, text_query
from models import PayableCancel, ReceivableTitleCreate, ReceivableTitleReceive, ReceivableTitleUpdate
from period_lock import ensure_period_open
from reports import BRT_TZ
from routers.container_audits import _remove_photo_file
from routers.payables import (
    DUE_SOON_DAYS, MAX_ATTACHMENTS, MAX_INSTALLMENTS, PAYMENT_METHODS, _brl, _clean, _now, _parse_day, _today,
)
from shared import ALLOWED_RECEIPT_EXTENSIONS, UPLOADS_DIR, db, get_current_admin_user, validate_and_read_upload

api_router = APIRouter(prefix="/api")

MODULE_KEY = "financeiro.contas_receber"


async def _links(client_id, client_name, account_id, cost_center_id) -> dict:
    fields = {"client_id": None, "client_name": _clean(client_name), **await account_links(account_id, cost_center_id)}
    if client_id:
        client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1})
        if not client:
            raise HTTPException(status_code=400, detail="Cliente não encontrado")
        fields["client_id"], fields["client_name"] = client["id"], client["name"]
    if not fields["client_name"]:
        raise HTTPException(status_code=400, detail="Informe o cliente (do cadastro ou só o nome)")
    return fields


def label(doc: dict) -> str:
    total = doc.get("installments_total") or 1
    return f"Nº {doc['receivable_number']}" + (f" - {doc['installment']}/{total}" if total > 1 else "")


def _with_overdue(doc: dict, today: str) -> dict:
    doc["overdue"] = doc.get("status") == "ABERTO" and (doc.get("due_date") or "") < today
    doc["label"] = label(doc)
    return doc


async def _get(title_id: str) -> dict:
    doc = await db.receivable_titles.find_one({"id": title_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Título a receber não encontrado")
    return doc


@api_router.post("/receivable-titles")
async def create_receivable_title(data: ReceivableTitleCreate, current_user: dict = Depends(get_current_admin_user)):
    description = _clean(data.description)
    if not description:
        raise HTTPException(status_code=400, detail="Informe a descrição do título")
    if not data.installments:
        raise HTTPException(status_code=400, detail="Informe pelo menos uma parcela")
    if len(data.installments) > MAX_INSTALLMENTS:
        raise HTTPException(status_code=400, detail=f"No máximo {MAX_INSTALLMENTS} parcelas por lançamento")
    if data.recurrence == "UNICA" and len(data.installments) > 1:
        raise HTTPException(status_code=400, detail="Título único tem uma parcela só")
    issue_date = _parse_day(data.issue_date, "Data do documento")
    installments = [{"due_date": _parse_day(i.due_date, "Data de vencimento"), "amount": i.amount} for i in data.installments]
    await ensure_period_open(issue_date, what="Conta a receber")
    links = await _links(data.client_id, data.client_name, data.account_id, data.cost_center_id)

    counter = await db.counters.find_one_and_update(
        {"_id": "receivable_number"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    group_id, now = str(uuid.uuid4()), _now()
    docs = [{
        "id": str(uuid.uuid4()), "group_id": group_id, "receivable_number": counter["seq"],
        "installment": index, "installments_total": len(installments), "recurrence": data.recurrence,
        "description": description, "document_number": _clean(data.document_number), "issue_date": issue_date,
        "due_date": inst["due_date"], "amount": round(inst["amount"], 2), **links,
        "status": "ABERTO", "paid_date": None, "paid_amount": None, "interest": 0, "discount": 0,
        "payment_method": None, "payment_notes": None, "attachments": [], "notes": (data.notes or "").strip() or None,
        "created_by": current_user["sub"], "created_by_name": current_user.get("name", "Sistema"), "created_at": now,
    } for index, inst in enumerate(installments, start=1)]
    await db.receivable_titles.insert_many(docs)
    for doc in docs:
        doc.pop("_id", None)
    return docs


def _list_query(search=None, status=None, client_id=None, date_from=None, date_to=None) -> dict:
    today = _today()
    query = {}
    if status == "VENCIDO":
        query = {"status": "ABERTO", "due_date": {"$lt": today}}
    elif status == "A_VENCER":
        query = {"status": "ABERTO", "due_date": {"$gte": today}}
    elif status:
        query = {"status": status}
    if client_id:
        query["client_id"] = client_id
    period = {k: v for k, v in (("$gte", date_from), ("$lte", date_to)) if v}
    text = text_query(("description", "client_name", "document_number", "account_name", "cost_center_name"), search)
    digits = (search or "").strip().lstrip("#")
    if digits.isdigit():
        text = {"$or": [text, {"receivable_number": int(digits)}]}
    return combine(query, {"due_date": period} if period else {}, text)


@api_router.get("/receivable-titles")
async def list_receivable_titles(
    search: Optional[str] = None, status: Optional[str] = None, client_id: Optional[str] = None,
    date_from: Optional[str] = None, date_to: Optional[str] = None, page: int = 1, per_page: int = 20,
    current_user: dict = Depends(get_current_admin_user),
):
    query = _list_query(search, status, client_id, date_from, date_to)
    page, per_page = max(page, 1), min(max(per_page, 1), 200)
    total = await db.receivable_titles.count_documents(query)
    items = await db.receivable_titles.find(query, {"_id": 0}).sort(
        [("due_date", 1), ("receivable_number", 1), ("installment", 1)]
    ).skip((page - 1) * per_page).limit(per_page).to_list(per_page)
    today = _today()
    return {"items": [_with_overdue(i, today) for i in items], "total": total, "page": page,
            "pages": (total + per_page - 1) // per_page}


@api_router.get("/receivable-titles/{title_id}")
async def get_receivable_title(title_id: str, current_user: dict = Depends(get_current_admin_user)):
    doc = await _get(title_id)
    doc["group"] = await db.receivable_titles.find(
        {"group_id": doc["group_id"]},
        {"_id": 0, "id": 1, "installment": 1, "due_date": 1, "amount": 1, "status": 1, "paid_date": 1, "paid_amount": 1},
    ).sort("installment", 1).to_list(None)
    return _with_overdue(doc, _today())


@api_router.put("/receivable-titles/{title_id}")
async def update_receivable_title(title_id: str, data: ReceivableTitleUpdate, current_user: dict = Depends(get_current_admin_user)):
    current = await _get(title_id)
    if current["status"] != "ABERTO":
        raise HTTPException(status_code=400, detail=f"O título {label(current)} não está em aberto: só título em aberto pode ser alterado")
    description = _clean(data.description)
    if not description:
        raise HTTPException(status_code=400, detail="Informe a descrição do título")
    issue_date = _parse_day(data.issue_date, "Data do documento")
    await ensure_period_open(current["issue_date"], issue_date, what="Conta a receber")
    fields = {
        "description": description, "document_number": _clean(data.document_number), "issue_date": issue_date,
        "due_date": _parse_day(data.due_date, "Data de vencimento"), "amount": round(data.amount, 2),
        "notes": (data.notes or "").strip() or None,
        **await _links(data.client_id, data.client_name, data.account_id, data.cost_center_id),
        "updated_at": _now(),
    }
    result = await db.receivable_titles.update_one({"id": title_id, "status": "ABERTO"}, {"$set": fields})
    if result.matched_count == 0:
        raise HTTPException(status_code=409, detail="O título mudou de situação enquanto era alterado. Atualize a tela.")
    return await get_receivable_title(title_id, current_user)


@api_router.delete("/receivable-titles/{title_id}")
async def delete_receivable_title(title_id: str, whole_group: bool = False, current_user: dict = Depends(get_current_admin_user)):
    current = await _get(title_id)
    targets = await db.receivable_titles.find({"group_id": current["group_id"]}, {"_id": 0}).to_list(None) if whole_group else [current]
    received = [t for t in targets if t["status"] == "RECEBIDO"]
    if received:
        raise HTTPException(status_code=400, detail=f"O título {label(received[0])} já foi recebido. Estorne o recebimento antes de excluir.")
    await ensure_period_open(current["issue_date"], what="Conta a receber")
    await db.receivable_titles.delete_many({"id": {"$in": [t["id"] for t in targets]}, "status": {"$ne": "RECEBIDO"}})
    for target in targets:
        for attachment in target.get("attachments") or []:
            _remove_photo_file(attachment)
    return {"deleted": len(targets)}


@api_router.post("/receivable-titles/receive")
async def receive_titles(data: ReceivableTitleReceive, current_user: dict = Depends(get_current_admin_user)):
    ids = list(dict.fromkeys(data.ids))
    if not ids:
        raise HTTPException(status_code=400, detail="Selecione os títulos a receber")
    if data.payment_method not in PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail="Forma de recebimento inválida")
    if len(ids) > 1 and (data.interest or data.discount):
        raise HTTPException(status_code=400, detail="Juros e desconto só podem ser informados recebendo um título por vez")
    paid_date = _parse_day(data.paid_date, "Data do recebimento")
    if paid_date > _today():
        raise HTTPException(status_code=400, detail="A data do recebimento não pode ser futura")
    await ensure_period_open(paid_date, what="Recebimento")
    docs = await db.receivable_titles.find({"id": {"$in": ids}}, {"_id": 0}).to_list(None)
    if len(docs) != len(ids):
        raise HTTPException(status_code=404, detail="Algum dos títulos não foi encontrado. Atualize a tela.")
    not_open = [d for d in docs if d["status"] != "ABERTO"]
    if not_open:
        raise HTTPException(status_code=400, detail=f"O título {label(not_open[0])} não está em aberto")
    if docs[0]["amount"] + data.interest - data.discount <= 0:
        raise HTTPException(status_code=400, detail="O desconto não pode ser maior que o valor do título")
    received = 0
    for doc in docs:
        result = await db.receivable_titles.update_one({"id": doc["id"], "status": "ABERTO"}, {"$set": {
            "status": "RECEBIDO", "paid_date": paid_date, "paid_amount": round(doc["amount"] + data.interest - data.discount, 2),
            "interest": round(data.interest, 2), "discount": round(data.discount, 2),
            "payment_method": data.payment_method, "payment_notes": (data.payment_notes or "").strip() or None,
            "paid_by_name": current_user.get("name", "Sistema"), "updated_at": _now(),
        }})
        received += result.modified_count
    return {"received": received}


@api_router.post("/receivable-titles/{title_id}/unreceive")
async def unreceive_title(title_id: str, current_user: dict = Depends(get_current_admin_user)):
    current = await _get(title_id)
    if current["status"] != "RECEBIDO":
        raise HTTPException(status_code=400, detail="Este título não está recebido")
    await ensure_period_open(current["paid_date"], what="Recebimento")
    await db.receivable_titles.update_one({"id": title_id, "status": "RECEBIDO"}, {"$set": {
        "status": "ABERTO", "paid_date": None, "paid_amount": None, "interest": 0, "discount": 0,
        "payment_method": None, "payment_notes": None, "paid_by_name": None, "updated_at": _now(),
    }})
    return await get_receivable_title(title_id, current_user)


@api_router.post("/receivable-titles/{title_id}/cancel")
async def cancel_title(title_id: str, data: PayableCancel, current_user: dict = Depends(get_current_admin_user)):
    current = await _get(title_id)
    expected = "ABERTO" if data.cancelled else "CANCELADO"
    if current["status"] != expected:
        raise HTTPException(status_code=400, detail="Só título em aberto pode ser cancelado" if data.cancelled else "Este título não está cancelado")
    await ensure_period_open(current["issue_date"], what="Conta a receber")
    await db.receivable_titles.update_one({"id": title_id, "status": expected}, {"$set": {
        "status": "CANCELADO" if data.cancelled else "ABERTO", "updated_at": _now(),
    }})
    return await get_receivable_title(title_id, current_user)


@api_router.post("/receivable-titles/{title_id}/attachments")
async def upload_title_attachment(title_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_admin_user)):
    current = await _get(title_id)
    if len(current.get("attachments") or []) >= MAX_ATTACHMENTS:
        raise HTTPException(status_code=400, detail=f"No máximo {MAX_ATTACHMENTS} anexos por título")
    file_ext, content = await validate_and_read_upload(file, ALLOWED_RECEIPT_EXTENSIONS)
    folder = UPLOADS_DIR / "receivables" / current["group_id"]
    folder.mkdir(parents=True, exist_ok=True)
    attachment_id = str(uuid.uuid4())
    (folder / f"{attachment_id}{file_ext}").write_bytes(content)
    attachment = {
        "id": attachment_id, "url": f"/api/uploads/receivables/{current['group_id']}/{attachment_id}{file_ext}",
        "name": (file.filename or f"anexo{file_ext}")[:120], "uploaded_at": _now(),
    }
    await db.receivable_titles.update_one({"id": title_id}, {"$push": {"attachments": attachment}})
    return await get_receivable_title(title_id, current_user)


@api_router.delete("/receivable-titles/{title_id}/attachments/{attachment_id}")
async def delete_title_attachment(title_id: str, attachment_id: str, current_user: dict = Depends(get_current_admin_user)):
    current = await _get(title_id)
    attachment = next((a for a in current.get("attachments") or [] if a["id"] == attachment_id), None)
    if not attachment:
        raise HTTPException(status_code=404, detail="Anexo não encontrado")
    await db.receivable_titles.update_one({"id": title_id}, {"$pull": {"attachments": {"id": attachment_id}}})
    _remove_photo_file(attachment)
    return await get_receivable_title(title_id, current_user)


# ------------------------------------------------------------------ alertas do sino

async def build_receivable_title_alerts() -> list:
    today_date = datetime.now(BRT_TZ).date()
    today, soon = today_date.isoformat(), (today_date + timedelta(days=DUE_SOON_DAYS)).isoformat()
    groups = {"overdue": [0, 0.0], "due_soon": [0, 0.0]}
    async for doc in db.receivable_titles.find({"status": "ABERTO", "due_date": {"$lte": soon}}, {"_id": 0, "due_date": 1, "amount": 1}):
        key = "overdue" if doc["due_date"] < today else "due_soon"
        groups[key][0] += 1
        groups[key][1] += doc.get("amount") or 0
    alerts = []
    for key, singular, plural, tone in (
        ("overdue", "título a receber vencido", "títulos a receber vencidos", "red"),
        ("due_soon", f"título a receber vencendo em até {DUE_SOON_DAYS} dias", f"títulos a receber vencendo em até {DUE_SOON_DAYS} dias", "amber"),
    ):
        count, total = groups[key]
        if count:
            alerts.append({
                "key": f"receivable_titles_{key}",
                "title": f"{count} {singular if count == 1 else plural}",
                "description": f"Total de {_brl(total)}",
                "path": "/reports/receivables?source=TITULO&status=PENDENTE",
                "tone": tone,
            })
    return alerts
