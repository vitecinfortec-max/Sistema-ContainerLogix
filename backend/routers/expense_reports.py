from datetime import datetime, timezone
from typing import Optional
import io
import re
import shutil
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from list_filters import combine, period_query, text_query
from fastapi.responses import StreamingResponse

from models import ExpenseGroupCreate, ExpenseReportPurchase, ExpenseReportCreate, ExpenseReportResponse, ExpenseReportSettlement
from reports import now_brt

from shared import (
    db, get_current_admin_user, get_company_settings, validate_and_read_upload,
    ALLOWED_RECEIPT_EXTENSIONS, UPLOADS_DIR
)

api_router = APIRouter(prefix="/api")

# ==================== FINANCEIRO - PRESTAÇÃO DE CONTAS ====================

from models import ExpenseReportCreate, ExpenseReportResponse, ExpenseReportPurchase


async def get_next_expense_report_number():
    """Obtém o próximo número de Prestação de Contas, reiniciando em 0001 a cada ano civil."""
    year = now_brt().year
    counter = await db.counters.find_one_and_update(
        {"_id": f"expense_report_number_{year}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    seq = counter["seq"]
    return seq, f"{year}{seq:04d}"


def calculate_expense_report_totals(deposits: list, purchases: list):
    total_deposits = round(sum(d.amount for d in deposits), 2)
    total_purchases = round(sum(p.amount for p in purchases), 2)
    balance = round(total_purchases - total_deposits, 2)
    return total_deposits, total_purchases, balance


async def resolve_expense_report_purchases(purchases: list) -> list:
    """Garante item_id em cada compra e resolve supplier_name/group_name a partir dos ids."""
    resolved = []
    for p in purchases:
        d = p.model_dump()
        if not d.get("item_id"):
            d["item_id"] = str(uuid.uuid4())
        if d.get("supplier_id"):
            supplier = await db.suppliers.find_one({"id": d["supplier_id"]}, {"_id": 0, "name": 1})
            d["supplier_name"] = supplier.get("name") if supplier else d.get("supplier_name")
        if d.get("group_id"):
            group = await db.expense_groups.find_one({"id": d["group_id"]}, {"_id": 0, "name": 1})
            if not group:
                raise HTTPException(status_code=400, detail="Grupo de custo não encontrado")
            d["group_name"] = group["name"]
        else:
            d["group_id"], d["group_name"] = None, None
        resolved.append(d)
    return resolved


# ---------------------------------------------------------- Grupos de custo
# Cada compra da prestação aponta para um grupo (Combustível, Alimentação...)
# para somar o custo por grupo no dashboard e nos relatórios.

DEFAULT_EXPENSE_GROUPS = [
    "Combustível", "Alimentação", "Manutenção e peças", "Pedágio e estacionamento", "Hospedagem",
    "Material de escritório", "Limpeza e higiene", "Ferramentas e equipamentos", "Taxas e documentos", "Outros",
]


async def ensure_expense_groups():
    """Na primeira vez, a empresa recebe os grupos padrão (editáveis)."""
    if await db.expense_groups.count_documents({}) == 0:
        now = datetime.now(timezone.utc).isoformat()
        await db.expense_groups.insert_many([{"id": str(uuid.uuid4()), "name": name, "description": None, "status": "ATIVO",
                                              "created_at": now} for name in DEFAULT_EXPENSE_GROUPS])


def _clean_group(data: ExpenseGroupCreate) -> dict:
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Informe o nome do grupo")
    if data.status not in ("ATIVO", "INATIVO"):
        raise HTTPException(status_code=400, detail="Situação inválida")
    return {"name": name, "description": (data.description or "").strip() or None, "status": data.status}


async def _refuse_duplicate_group(name: str, current_id: Optional[str]):
    query = {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}
    if current_id:
        query["id"] = {"$ne": current_id}
    if await db.expense_groups.find_one(query, {"_id": 1}):
        raise HTTPException(status_code=400, detail=f"O grupo {name} já existe")


async def _group_usage() -> dict:
    usage = {}
    for rep in await db.expense_reports.find({}, {"_id": 0, "purchases.group_id": 1}).to_list(None):
        for p in rep.get("purchases") or []:
            if p.get("group_id"):
                usage[p["group_id"]] = usage.get(p["group_id"], 0) + 1
    return usage


@api_router.get("/expense-groups")
async def list_expense_groups(current_user: dict = Depends(get_current_admin_user)):
    await ensure_expense_groups()
    usage = await _group_usage()
    rows = await db.expense_groups.find({}, {"_id": 0}).to_list(None)
    for row in rows:
        row["purchases"] = usage.get(row["id"], 0)
    return sorted(rows, key=lambda g: (g["status"] != "ATIVO", g["name"] == "Outros", g["name"].lower()))


@api_router.post("/expense-groups")
async def create_expense_group(data: ExpenseGroupCreate, current_user: dict = Depends(get_current_admin_user)):
    fields = _clean_group(data)
    await _refuse_duplicate_group(fields["name"], None)
    doc = {"id": str(uuid.uuid4()), **fields, "created_at": datetime.now(timezone.utc).isoformat()}
    await db.expense_groups.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/expense-groups/{group_id}")
async def update_expense_group(group_id: str, data: ExpenseGroupCreate, current_user: dict = Depends(get_current_admin_user)):
    current = await db.expense_groups.find_one({"id": group_id}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Grupo não encontrado")
    fields = _clean_group(data)
    await _refuse_duplicate_group(fields["name"], group_id)
    await db.expense_groups.update_one({"id": group_id}, {"$set": fields})
    if fields["name"] != current["name"]:
        # o nome novo vale também nas compras já lançadas
        for rep in await db.expense_reports.find({"purchases.group_id": group_id}, {"_id": 0, "id": 1, "purchases": 1}).to_list(None):
            purchases = [{**p, "group_name": fields["name"]} if p.get("group_id") == group_id else p for p in rep["purchases"]]
            await db.expense_reports.update_one({"id": rep["id"]}, {"$set": {"purchases": purchases}})
    return await db.expense_groups.find_one({"id": group_id}, {"_id": 0})


@api_router.delete("/expense-groups/{group_id}")
async def delete_expense_group(group_id: str, current_user: dict = Depends(get_current_admin_user)):
    used = (await _group_usage()).get(group_id, 0)
    if used:
        raise HTTPException(status_code=400, detail=f"Grupo usado em {used} compra(s): em vez de excluir, marque como Inativo")
    result = await db.expense_groups.delete_one({"id": group_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Grupo não encontrado")
    return {"message": "Grupo excluído"}


@api_router.get("/expense-reports/dashboard")
async def expense_dashboard(date_from: Optional[str] = None, date_to: Optional[str] = None, status: Optional[str] = None,
                            current_user: dict = Depends(get_current_admin_user)):
    """Custo por grupo no período: totais, participação, comparação com o
    período anterior de mesmo tamanho, evolução mensal, maiores compras e fornecedores."""
    from datetime import date, timedelta
    from routers.financial_reports import build_expenses
    data = await build_expenses(date_from, date_to, status)
    previous = {}
    if date_from and date_to:
        start, end = date.fromisoformat(date_from[:10]), date.fromisoformat(date_to[:10])
        prev_end = start - timedelta(days=1)
        prev_start = prev_end - (end - start)
        prev = await build_expenses(prev_start.isoformat(), prev_end.isoformat(), status)
        previous = {g["group_name"]: g["total"] for g in prev["groups"]}
        data["previous_period"] = {"date_from": prev_start.isoformat(), "date_to": prev_end.isoformat(),
                                   "total": prev["summary"]["total_purchases"]}
    for g in data["groups"]:
        before = previous.get(g["group_name"])
        g["previous_total"] = before
        g["variation"] = round((g["total"] - before) / before * 100, 1) if before else None
    by_month = {}
    for p in data["purchases"]:
        month = (p["purchase_date"] or "")[:7]
        if month:
            bucket = by_month.setdefault(month, {"month": month, "total": 0.0})
            bucket[p["group_name"]] = round(bucket.get(p["group_name"], 0) + p["amount"], 2)
            bucket["total"] = round(bucket["total"] + p["amount"], 2)
    return {
        "summary": data["summary"], "groups": data["groups"], "previous_period": data.get("previous_period"),
        "by_month": [by_month[k] for k in sorted(by_month)],
        "top_purchases": data["top_purchases"][:10],
        "top_suppliers": data["suppliers"][:10],
    }


@api_router.get("/expense-reports")
async def get_expense_reports(
    search: Optional[str] = None,
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    current_user: dict = Depends(get_current_admin_user)
):
    """Lista as prestações de contas (período pela data de abertura)"""
    query = {}

    if search:
        search_escaped = re.escape(search)
        query["$or"] = [
            {"report_number_formatted": {"$regex": search_escaped, "$options": "i"}},
            {"purchases.supplier_name": {"$regex": search_escaped, "$options": "i"}}
        ]

    if status:
        query["status"] = status

    query = combine(query, period_query("created_at", date_from, date_to))

    total = await db.expense_reports.count_documents(query)
    skip = (page - 1) * per_page

    cursor = db.expense_reports.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page)
    reports_list = await cursor.to_list(length=per_page)

    return {
        "items": reports_list,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page
    }


@api_router.get("/expense-reports/{report_id}", response_model=ExpenseReportResponse)
async def get_expense_report(report_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Busca prestação de contas por ID"""
    report = await db.expense_reports.find_one({"id": report_id}, {"_id": 0})
    if not report:
        raise HTTPException(status_code=404, detail="Prestação de contas não encontrada")
    return report


@api_router.post("/expense-reports", response_model=ExpenseReportResponse)
async def create_expense_report(data: ExpenseReportCreate, current_user: dict = Depends(get_current_admin_user)):
    """Cria nova prestação de contas"""
    seq, formatted = await get_next_expense_report_number()

    purchases_data = await resolve_expense_report_purchases(data.purchases)
    total_deposits, total_purchases, balance = calculate_expense_report_totals(
        data.deposits, [ExpenseReportPurchase(**p) for p in purchases_data]
    )

    report_data = {
        "id": str(uuid.uuid4()),
        "report_number": seq,
        "report_number_formatted": formatted,
        "period_start": data.period_start,
        "period_end": data.period_end,
        "deposits": [d.model_dump() for d in data.deposits],
        "purchases": purchases_data,
        "total_deposits": total_deposits,
        "total_purchases": total_purchases,
        "balance": balance,
        "status": "EM_ANDAMENTO",
        "created_by": current_user["sub"],
        "created_by_name": current_user.get("name", "Sistema"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": None
    }

    await db.expense_reports.insert_one(report_data)
    report_data.pop("_id", None)

    return report_data


@api_router.put("/expense-reports/{report_id}", response_model=ExpenseReportResponse)
async def update_expense_report(report_id: str, data: ExpenseReportCreate, current_user: dict = Depends(get_current_admin_user)):
    """Atualiza prestação de contas (bloqueado se já estiver concluída)"""
    existing = await db.expense_reports.find_one({"id": report_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Prestação de contas não encontrada")

    if existing["status"] == "CONCLUIDA":
        raise HTTPException(status_code=400, detail="Prestação de contas concluída não pode ser editada. Reabra antes de editar.")

    # Preserva os recibos já anexados a cada lançamento, casando por item_id
    existing_by_id = {p["item_id"]: p for p in existing.get("purchases", [])}
    purchases_data = await resolve_expense_report_purchases(data.purchases)
    for p in purchases_data:
        prior = existing_by_id.get(p["item_id"])
        p["receipts"] = prior["receipts"] if prior else []

    total_deposits, total_purchases, balance = calculate_expense_report_totals(
        data.deposits, [ExpenseReportPurchase(**p) for p in purchases_data]
    )

    update_data = {
        "period_start": data.period_start,
        "period_end": data.period_end,
        "deposits": [d.model_dump() for d in data.deposits],
        "purchases": purchases_data,
        "total_deposits": total_deposits,
        "total_purchases": total_purchases,
        "balance": balance,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }

    await db.expense_reports.update_one({"id": report_id}, {"$set": update_data})
    updated = await db.expense_reports.find_one({"id": report_id}, {"_id": 0})
    return updated


@api_router.delete("/expense-reports/{report_id}")
async def delete_expense_report(report_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Exclui prestação de contas"""
    result = await db.expense_reports.delete_one({"id": report_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Prestação de contas não encontrada")

    receipt_dir = UPLOADS_DIR / "expense_reports" / report_id
    if receipt_dir.exists():
        shutil.rmtree(receipt_dir, ignore_errors=True)

    return {"message": "Prestação de contas excluída com sucesso"}


@api_router.put("/expense-reports/{report_id}/status")
async def update_expense_report_status(report_id: str, status: str, current_user: dict = Depends(get_current_admin_user)):
    """Conclui ou reabre uma prestação de contas"""
    if status not in ["EM_ANDAMENTO", "CONCLUIDA"]:
        raise HTTPException(status_code=400, detail="Status inválido")
    if status == "EM_ANDAMENTO" and await db.expense_reports.find_one({"id": report_id, "settled_at": {"$nin": [None, ""]}}):
        raise HTTPException(status_code=400, detail="O saldo desta prestação já foi acertado. Desfaça o acerto antes de reabrir.")

    result = await db.expense_reports.update_one(
        {"id": report_id},
        {"$set": {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    # matched, não modified: repetir o status atual não é "não encontrada"
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Prestação de contas não encontrada")

    return {"message": "Status atualizado"}


@api_router.put("/expense-reports/{report_id}/settlement", response_model=ExpenseReportResponse)
async def update_expense_report_settlement(report_id: str, data: ExpenseReportSettlement, current_user: dict = Depends(get_current_admin_user)):
    """Marca (ou desfaz) o acerto do saldo: ressarcimento pago ao funcionário
    ou devolução recebida dele. Só com a prestação concluída."""
    report = await db.expense_reports.find_one({"id": report_id}, {"_id": 0})
    if not report:
        raise HTTPException(status_code=404, detail="Prestação de contas não encontrada")
    if data.settled:
        if report.get("status") != "CONCLUIDA":
            raise HTTPException(status_code=400, detail="Conclua a prestação de contas antes de acertar o saldo")
        if abs(report.get("balance") or 0) < 0.005:
            raise HTTPException(status_code=400, detail="Esta prestação não tem saldo a acertar")
        day = (data.date or now_brt().date().isoformat())[:10]
        try:
            datetime.strptime(day, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="Data do acerto inválida")
        update = {"settled_at": day, "settled_by_name": current_user.get("name", "Sistema")}
    else:
        update = {"settled_at": None, "settled_by_name": None}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.expense_reports.update_one({"id": report_id}, {"$set": update})
    return await db.expense_reports.find_one({"id": report_id}, {"_id": 0})


@api_router.post("/expense-reports/{report_id}/purchases/{item_id}/upload-receipt")
async def upload_expense_report_receipt(
    report_id: str,
    item_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_admin_user)
):
    """Anexa um recibo (foto/scan) a um lançamento de compra específico"""
    report = await db.expense_reports.find_one(
        {"id": report_id, "purchases.item_id": item_id}, {"_id": 0}
    )
    if not report:
        raise HTTPException(status_code=404, detail="Prestação de contas ou lançamento de compra não encontrado")
    if report.get("status") == "CONCLUIDA":
        raise HTTPException(status_code=400, detail="Prestação de contas concluída não recebe novos recibos. Reabra antes de anexar.")

    file_ext, content = await validate_and_read_upload(file, ALLOWED_RECEIPT_EXTENSIONS)

    receipt_dir = UPLOADS_DIR / "expense_reports" / report_id
    receipt_dir.mkdir(parents=True, exist_ok=True)

    receipt_id = str(uuid.uuid4())
    file_path = receipt_dir / f"{receipt_id}{file_ext}"

    with open(file_path, "wb") as buffer:
        buffer.write(content)

    receipt_url = f"/api/uploads/expense_reports/{report_id}/{receipt_id}{file_ext}"
    receipt_entry = {"id": receipt_id, "url": receipt_url}

    await db.expense_reports.update_one(
        {"id": report_id, "purchases.item_id": item_id},
        {
            "$push": {"purchases.$.receipts": receipt_entry},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
        }
    )

    return receipt_entry


@api_router.delete("/expense-reports/{report_id}/purchases/{item_id}/receipt/{receipt_id}")
async def delete_expense_report_receipt(
    report_id: str,
    item_id: str,
    receipt_id: str,
    current_user: dict = Depends(get_current_admin_user)
):
    """Remove um recibo de um lançamento de compra"""
    report = await db.expense_reports.find_one({"id": report_id}, {"_id": 0})
    if not report:
        raise HTTPException(status_code=404, detail="Prestação de contas não encontrada")
    if report.get("status") == "CONCLUIDA":
        raise HTTPException(status_code=400, detail="Prestação de contas concluída não pode ter recibos removidos. Reabra antes.")

    purchase = next((p for p in report.get("purchases", []) if p["item_id"] == item_id), None)
    if not purchase:
        raise HTTPException(status_code=404, detail="Lançamento de compra não encontrado")

    remaining = [r for r in purchase.get("receipts", []) if r["id"] != receipt_id]
    if len(remaining) == len(purchase.get("receipts", [])):
        raise HTTPException(status_code=404, detail="Recibo não encontrado")

    receipt_dir = UPLOADS_DIR / "expense_reports" / report_id
    for file_path in receipt_dir.glob(f"{receipt_id}.*"):
        file_path.unlink()

    await db.expense_reports.update_one(
        {"id": report_id, "purchases.item_id": item_id},
        {"$set": {"purchases.$.receipts": remaining, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )

    return {"message": "Recibo removido com sucesso"}


@api_router.get("/expense-reports/{report_id}/pdf")
async def download_expense_report_pdf(report_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Gera PDF final da prestação de contas (somente quando concluída)"""
    from reports import generate_expense_report_pdf

    report = await db.expense_reports.find_one({"id": report_id}, {"_id": 0})
    if not report:
        raise HTTPException(status_code=404, detail="Prestação de contas não encontrada")

    if report["status"] != "CONCLUIDA":
        raise HTTPException(status_code=400, detail="Só é possível gerar o PDF de uma prestação de contas concluída")

    company = await get_company_settings()
    pdf_bytes = generate_expense_report_pdf(report, company=company)

    filename = f"prestacao_contas_{report['report_number_formatted']}.pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


