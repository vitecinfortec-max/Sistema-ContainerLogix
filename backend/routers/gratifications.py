"""Financeiro - Controle de Gratificação: gratificações de Motoristas e
Funcionários, cada uma com a função da pessoa (Motorista, Frentista,
Mecânico... - lista que já vem cadastrada e o usuário pode ampliar). Paga a
gratificação, sai o recibo; várias pagas da mesma pessoa saem num recibo só.
O relatório do período fica em /reports/gratifications."""
import io
import re
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from models import (
    DEFAULT_GRATIFICATION_ROLES, GratificationCreate, GratificationPay, GratificationResponse,
    GratificationRoleCreate, GratificationRoleResponse,
)
from period_reports import Column, Section, MONEY, DAY, INT, pdf_response, excel_response, period_text
from reports import merge_company, generate_gratification_receipt_pdf
from routers.fuel_supply import _valor_por_extenso
from routers.movements import _parse_filter_day
from routers.stock import _valid_iso_date
from shared import db, get_current_admin_user, get_company_settings

api_router = APIRouter(prefix="/api")

PERSON_COLLECTIONS = {"MOTORISTA": "drivers", "FUNCIONARIO": "employees"}
STATUS_LABELS = {"PENDENTE": "Pendente", "PAGO": "Pago", "CANCELADO": "Cancelado"}
STATUS_PATTERN = "^(PENDENTE|PAGO|CANCELADO)$"
PERIOD_PATTERN = "^(reference|payment)$"
PERIOD_LABELS = {"reference": "Referência", "payment": "Pagamento"}


def _clean(value: Optional[str]) -> Optional[str]:
    value = (value or "").strip()
    return value or None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _next_number() -> int:
    result = await db.counters.find_one_and_update(
        {"_id": "gratification_number"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    return result["seq"]


# ---------------------------------------------------------------- Funções

async def _ensure_default_roles():
    """As funções padrão existem em todo sistema: entram na primeira leitura
    e não podem ser excluídas (ver delete_gratification_role)."""
    existing = {r["name"].lower() for r in await db.gratification_roles.find({}, {"_id": 0, "name": 1}).to_list(None)}
    missing = [name for name in DEFAULT_GRATIFICATION_ROLES if name.lower() not in existing]
    for name in missing:
        await db.gratification_roles.insert_one({"id": str(uuid.uuid4()), "name": name, "is_default": True, "created_at": _now_iso()})


async def _find_role(name: Optional[str]) -> Optional[dict]:
    name = _clean(name)
    if not name:
        return None
    return await db.gratification_roles.find_one({"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}, {"_id": 0})


@api_router.get("/gratification-roles", response_model=List[GratificationRoleResponse])
async def list_gratification_roles(current_user: dict = Depends(get_current_admin_user)):
    await _ensure_default_roles()
    rows = await db.gratification_roles.find({}, {"_id": 0}).to_list(None)
    return sorted(rows, key=lambda r: r["name"].lower())


@api_router.post("/gratification-roles", response_model=GratificationRoleResponse)
async def create_gratification_role(data: GratificationRoleCreate, current_user: dict = Depends(get_current_admin_user)):
    name = _clean(data.name)
    if not name:
        raise HTTPException(status_code=400, detail="Informe o nome da função")
    await _ensure_default_roles()
    if await _find_role(name):
        raise HTTPException(status_code=400, detail=f"A função {name} já está cadastrada")
    doc = {"id": str(uuid.uuid4()), "name": name, "is_default": False, "created_at": _now_iso()}
    await db.gratification_roles.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.delete("/gratification-roles/{role_id}")
async def delete_gratification_role(role_id: str, current_user: dict = Depends(get_current_admin_user)):
    role = await db.gratification_roles.find_one({"id": role_id}, {"_id": 0})
    if not role:
        raise HTTPException(status_code=404, detail="Função não encontrada")
    if role.get("is_default"):
        raise HTTPException(status_code=400, detail="As funções padrão do sistema não podem ser excluídas")
    if await db.gratifications.find_one({"role": role["name"]}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Essa função já foi usada em gratificações e não pode ser excluída")
    await db.gratification_roles.delete_one({"id": role_id})
    return {"message": "Função excluída"}


# ---------------------------------------------------------------- Gratificações

async def _validate(data: GratificationCreate) -> dict:
    collection = PERSON_COLLECTIONS.get(data.person_type)
    person = await db[collection].find_one({"id": data.person_id}, {"_id": 0}) if collection else None
    if not person:
        raise HTTPException(status_code=404, detail="Motorista/Funcionário não encontrado")
    await _ensure_default_roles()
    role = await _find_role(data.role)
    if not role:
        raise HTTPException(status_code=400, detail="Selecione uma função cadastrada")
    if data.amount is None or data.amount <= 0:
        raise HTTPException(status_code=400, detail="O valor da gratificação deve ser maior que zero")
    return {
        "person_type": data.person_type,
        "person_id": data.person_id,
        "person_name": person.get("name") or "",
        "person_cpf": person.get("cpf"),
        "role": role["name"],
        "reference_date": _valid_iso_date(data.reference_date, "Data de referência"),
        "amount": round(data.amount, 2),
        "description": _clean(data.description),
        "observations": _clean(data.observations),
    }


async def _get_or_404(gratification_id: str) -> dict:
    doc = await db.gratifications.find_one({"id": gratification_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Gratificação não encontrada")
    return doc


def _build_query(search=None, status=None, role=None, person_type=None, person_id=None,
                 date_from=None, date_to=None, period_by="reference") -> dict:
    query = {}
    if search:
        rx = {"$regex": re.escape(search.strip()), "$options": "i"}
        query["$or"] = [{"person_name": rx}, {"person_cpf": rx}, {"description": rx}]
    if status:
        query["status"] = status
    if role:
        query["role"] = {"$regex": f"^{re.escape(role.strip())}$", "$options": "i"}
    if person_type:
        query["person_type"] = person_type
    if person_id:
        query["person_id"] = person_id
    period = {}
    if date_from:
        period["$gte"] = _parse_filter_day(date_from, "date_from").isoformat()
    if date_to:
        period["$lte"] = _parse_filter_day(date_to, "date_to").isoformat()
    if period:
        query["payment_date" if period_by == "payment" else "reference_date"] = period
    return query


@api_router.get("/gratifications", response_model=List[GratificationResponse])
async def list_gratifications(
    search: Optional[str] = None,
    status: Optional[str] = Query(None, pattern=STATUS_PATTERN),
    role: Optional[str] = None,
    person_type: Optional[str] = Query(None, pattern="^(MOTORISTA|FUNCIONARIO)$"),
    person_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    period_by: str = Query("reference", pattern=PERIOD_PATTERN),
    current_user: dict = Depends(get_current_admin_user),
):
    query = _build_query(search, status, role, person_type, person_id, date_from, date_to, period_by)
    return await db.gratifications.find(query, {"_id": 0}).sort([("reference_date", -1), ("gratification_number", -1)]).to_list(None)


@api_router.post("/gratifications", response_model=GratificationResponse)
async def create_gratification(data: GratificationCreate, current_user: dict = Depends(get_current_admin_user)):
    fields = await _validate(data)
    doc = {
        "id": str(uuid.uuid4()),
        "gratification_number": await _next_number(),
        **fields,
        "status": "PENDENTE",
        "payment_date": None,
        "payment_method": None,
        "paid_by_name": None,
        "created_by": current_user["sub"],
        "created_by_name": current_user["name"],
        "created_at": _now_iso(),
    }
    await db.gratifications.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.put("/gratifications/{gratification_id}", response_model=GratificationResponse)
async def update_gratification(gratification_id: str, data: GratificationCreate, current_user: dict = Depends(get_current_admin_user)):
    current = await _get_or_404(gratification_id)
    if current.get("status") != "PENDENTE":
        raise HTTPException(status_code=400, detail="Só é possível editar uma gratificação Pendente")
    fields = await _validate(data)
    fields["updated_at"] = _now_iso()
    await db.gratifications.update_one({"id": gratification_id}, {"$set": fields})
    return await _get_or_404(gratification_id)


@api_router.delete("/gratifications/{gratification_id}")
async def delete_gratification(gratification_id: str, current_user: dict = Depends(get_current_admin_user)):
    current = await _get_or_404(gratification_id)
    if current.get("status") == "PAGO":
        raise HTTPException(status_code=400, detail="Gratificação paga não pode ser excluída: estorne o pagamento antes")
    await db.gratifications.delete_one({"id": gratification_id})
    return {"message": "Gratificação excluída"}


@api_router.post("/gratifications/pay")
async def pay_gratifications(data: GratificationPay, current_user: dict = Depends(get_current_admin_user)):
    """Marca 1+ gratificações Pendentes como Pagas na data informada."""
    ids = list(dict.fromkeys(data.ids or []))
    if not ids:
        raise HTTPException(status_code=400, detail="Selecione ao menos 1 gratificação")
    payment_date = _valid_iso_date(data.payment_date, "Data do pagamento")
    rows = await db.gratifications.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "status": 1}).to_list(None)
    if len(rows) != len(ids):
        raise HTTPException(status_code=404, detail="Uma ou mais gratificações não foram encontradas")
    if any(r.get("status") != "PENDENTE" for r in rows):
        raise HTTPException(status_code=400, detail="Só gratificações Pendentes podem ser pagas")
    await db.gratifications.update_many({"id": {"$in": ids}, "status": "PENDENTE"}, {"$set": {
        "status": "PAGO",
        "payment_date": payment_date,
        "payment_method": _clean(data.payment_method),
        "paid_by_name": current_user["name"],
        "updated_at": _now_iso(),
    }})
    return {"message": "Pagamento registrado", "count": len(ids)}


@api_router.put("/gratifications/{gratification_id}/status")
async def update_gratification_status(
    gratification_id: str,
    status: str = Query(..., pattern="^(PENDENTE|CANCELADO)$"),
    current_user: dict = Depends(get_current_admin_user),
):
    """Volta pra Pendente (estorna o pagamento) ou cancela. Pagar só pelo
    POST /gratifications/pay, que exige a data do pagamento."""
    current = await _get_or_404(gratification_id)
    old = current.get("status")
    if status == "CANCELADO" and old == "PAGO":
        raise HTTPException(status_code=400, detail="Gratificação paga não pode ser cancelada: estorne o pagamento antes")
    update = {"status": status, "updated_at": _now_iso()}
    if status == "PENDENTE":
        update.update({"payment_date": None, "payment_method": None, "paid_by_name": None})
    await db.gratifications.update_one({"id": gratification_id}, {"$set": update})
    return {"message": "Status atualizado"}


@api_router.get("/gratifications/receipt/pdf")
async def download_gratification_receipt(
    ids: str = Query(..., description="IDs separados por vírgula"),
    current_user: dict = Depends(get_current_admin_user),
):
    """Recibo das gratificações selecionadas: todas pagas e da mesma pessoa."""
    id_list = list(dict.fromkeys(i for i in ids.split(",") if i))
    rows = await db.gratifications.find({"id": {"$in": id_list}}, {"_id": 0}).sort([("reference_date", 1), ("gratification_number", 1)]).to_list(None)
    if not rows or len(rows) != len(id_list):
        raise HTTPException(status_code=404, detail="Uma ou mais gratificações não foram encontradas")
    if any(r.get("status") != "PAGO" for r in rows):
        raise HTTPException(status_code=400, detail="O recibo só pode ser gerado para gratificações Pagas")
    if len({(r["person_type"], r["person_id"]) for r in rows}) != 1:
        raise HTTPException(status_code=400, detail="Para gerar o recibo, selecione gratificações de uma única pessoa")

    first = rows[0]
    collection = PERSON_COLLECTIONS.get(first["person_type"])
    current = await db[collection].find_one({"id": first["person_id"]}, {"_id": 0, "name": 1, "cpf": 1}) if collection else None
    person = {"name": (current or {}).get("name") or first.get("person_name"), "cpf": (current or {}).get("cpf") or first.get("person_cpf")}
    total = round(sum(r.get("amount") or 0 for r in rows), 2)
    company = merge_company(await get_company_settings())
    pdf_bytes = generate_gratification_receipt_pdf(person, rows, _valor_por_extenso(total), company)
    numbers = "-".join(str(r["gratification_number"]) for r in rows[:5])
    filename = f"Recibo_Gratificacao_{re.sub(r'[^A-Za-z0-9]+', '_', person['name'] or 'pessoa')}_{numbers}.pdf"
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})


# ---------------------------------------------------------------- Relatório do período

def _r(value) -> float:
    return round(value or 0, 2)


async def build_gratifications_report(date_from=None, date_to=None, status=None, person=None, role=None, period_by="reference") -> dict:
    query = _build_query(person, status, None, None, None, date_from, date_to, period_by)
    if role and role.strip():  # filtro digitado no relatório: parte do nome basta
        query["role"] = {"$regex": re.escape(role.strip()), "$options": "i"}
    if not status:
        query["status"] = {"$ne": "CANCELADO"}
    rows = await db.gratifications.find(query, {"_id": 0}).sort([("reference_date", 1), ("gratification_number", 1)]).to_list(None)

    people, roles = {}, {}
    for g in rows:
        paid = g.get("status") == "PAGO"
        amount = g.get("amount") or 0
        key = (g["person_type"], g["person_id"])
        p = people.setdefault(key, {"person_name": g.get("person_name"), "person_cpf": g.get("person_cpf"), "roles": set(),
                                    "count": 0, "paid": 0.0, "pending": 0.0})
        p["roles"].add(g.get("role"))
        r = roles.setdefault(g.get("role"), {"role": g.get("role"), "count": 0, "paid": 0.0, "pending": 0.0})
        for bucket in (p, r):
            bucket["count"] += 1
            if paid:
                bucket["paid"] += amount
            elif g.get("status") == "PENDENTE":
                bucket["pending"] += amount

    def finish(bucket):
        bucket["paid"], bucket["pending"] = _r(bucket["paid"]), _r(bucket["pending"])
        bucket["total"] = _r(bucket["paid"] + bucket["pending"])
        return bucket

    people_rows = sorted((finish({**p, "roles": ", ".join(sorted(x for x in p["roles"] if x))}) for p in people.values()),
                         key=lambda p: (p["person_name"] or "").lower())
    role_rows = sorted((finish(r) for r in roles.values()), key=lambda r: -r["total"])
    paid_total = _r(sum(g.get("amount") or 0 for g in rows if g.get("status") == "PAGO"))
    pending_total = _r(sum(g.get("amount") or 0 for g in rows if g.get("status") == "PENDENTE"))
    return {
        "items": rows,
        "people": people_rows,
        "roles": role_rows,
        "summary": {"count": len(rows), "paid": paid_total, "pending": pending_total,
                    "total": _r(paid_total + pending_total), "people": len(people_rows)},
    }


def _report_sections(data):
    s = data["summary"]
    return [
        Section(
            "Por pessoa",
            [Column("Nome", width=30), Column("CPF", width=14), Column("Função", width=24), Column("Qtd.", INT, 7),
             Column("Pago", MONEY, 12), Column("A pagar", MONEY, 12), Column("Total", MONEY, 12)],
            [[p["person_name"], p["person_cpf"], p["roles"], p["count"], p["paid"], p["pending"], p["total"]] for p in data["people"]],
            total=["TOTAL", None, None, s["count"], s["paid"], s["pending"], s["total"]] if data["people"] else None,
            empty_text="Nenhuma gratificação no período.", sheet_name="Por pessoa",
        ),
        Section(
            "Por função",
            [Column("Função", width=40), Column("Qtd.", INT, 10), Column("Pago", MONEY, 15),
             Column("A pagar", MONEY, 15), Column("Total", MONEY, 15)],
            [[r["role"], r["count"], r["paid"], r["pending"], r["total"]] for r in data["roles"]],
            total=["TOTAL", s["count"], s["paid"], s["pending"], s["total"]] if data["roles"] else None,
            empty_text="Nenhuma gratificação no período.", sheet_name="Por função",
        ),
        Section(
            "Gratificações",
            [Column("Nº", INT, 6), Column("Referência", DAY, 10), Column("Nome", width=26), Column("Função", width=16),
             Column("Descrição", width=28), Column("Situação", width=10, align="center"), Column("Pagamento", DAY, 10),
             Column("Valor", MONEY, 12)],
            [[g["gratification_number"], g.get("reference_date"), g.get("person_name"), g.get("role"), g.get("description"),
              STATUS_LABELS.get(g.get("status"), g.get("status")), g.get("payment_date"), g.get("amount")] for g in data["items"]],
            total=["TOTAL", None, None, None, None, None, None, s["total"]] if data["items"] else None,
            empty_text="Nenhuma gratificação no período.", sheet_name="Gratificações",
        ),
    ]


def _report_subtitle(date_from, date_to, status, period_by):
    parts = [period_text(PERIOD_LABELS[period_by], date_from, date_to)]
    if status:
        parts.append(f"Situação: {STATUS_LABELS[status]}")
    return " • ".join(p for p in parts if p) or None


@api_router.get("/reports/gratifications")
async def get_gratifications_report(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    status: Optional[str] = Query(None, pattern=STATUS_PATTERN),
    person: Optional[str] = None, role: Optional[str] = None,
    period_by: str = Query("reference", pattern=PERIOD_PATTERN),
    current_user: dict = Depends(get_current_admin_user),
):
    """Gratificações do período (pela data de referência ou do pagamento), por pessoa, por função e item a item"""
    return await build_gratifications_report(date_from, date_to, status, person, role, period_by)


@api_router.get("/reports/gratifications/pdf")
async def get_gratifications_report_pdf(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    status: Optional[str] = Query(None, pattern=STATUS_PATTERN),
    person: Optional[str] = None, role: Optional[str] = None,
    period_by: str = Query("reference", pattern=PERIOD_PATTERN),
    current_user: dict = Depends(get_current_admin_user),
):
    data = await build_gratifications_report(date_from, date_to, status, person, role, period_by)
    s = data["summary"]
    from reports import format_currency
    info = [("Gratificações", str(s["count"])), ("Pessoas", str(s["people"])),
            ("Pago", format_currency(s["paid"], "BRL")), ("A pagar", format_currency(s["pending"], "BRL")),
            ("Total", format_currency(s["total"], "BRL")), ("Função", role or "Todas")]
    return await pdf_response("Relatório de Gratificações", _report_subtitle(date_from, date_to, status, period_by), info,
                              _report_sections(data), "relatorio_gratificacoes", current_user.get("name", "Sistema"))


@api_router.get("/reports/gratifications/excel")
async def get_gratifications_report_excel(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    status: Optional[str] = Query(None, pattern=STATUS_PATTERN),
    person: Optional[str] = None, role: Optional[str] = None,
    period_by: str = Query("reference", pattern=PERIOD_PATTERN),
    current_user: dict = Depends(get_current_admin_user),
):
    data = await build_gratifications_report(date_from, date_to, status, person, role, period_by)
    return await excel_response("Relatório de Gratificações", _report_subtitle(date_from, date_to, status, period_by),
                                _report_sections(data), "relatorio_gratificacoes")
