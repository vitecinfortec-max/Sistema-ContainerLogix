from datetime import datetime, timedelta
from typing import Optional
import re

from fastapi import APIRouter, Depends, HTTPException, Query

from audit import AUDIT_COLLECTION
from reports import BRT_TZ
from routers.movements import _parse_filter_day
from shared import db, get_current_admin_user, MODULE_CATALOG

api_router = APIRouter(prefix="/api")

# ==================== OPÇÕES DO SISTEMA - LOG DE AUDITORIA ====================
# Consulta do que audit.py registra: quem criou, alterou ou excluiu o quê.
# Só leitura, e só para administradores - ninguém edita nem apaga o log pela tela.

MODULE_LABELS = {item["key"]: item["label"] for group in MODULE_CATALOG for item in group["items"]}

# Rotas que não pertencem a um módulo contratado: o nome sai da coleção
COLLECTION_LABELS = {
    "users": "Usuários",
    "company_settings": "Dados da Empresa",
    "module_config": "Módulos Contratados",
    "tank_settings": "Configuração de Tanque",
    "user_shortcuts": "Atalhos",
    "movements": "Movimentações",
    "invoices": "Faturas",
    "clients": "Cliente",
    "drivers": "Pessoas",
    "suppliers": "Fornecedor",
    "employees": "Funcionário",
    "vehicles": "Veículos",
}

ACTION_PATTERN = "^(create|update|delete|update_many)$"


def _area(entry: dict) -> str:
    return (
        MODULE_LABELS.get(entry.get("module"))
        or COLLECTION_LABELS.get(entry.get("collection"))
        or (entry.get("collection") or "").replace("_", " ").capitalize()
    )


def _summary(entry: dict) -> dict:
    """Linha da lista: sem o conteúdo completo (fica no detalhe)."""
    row = {k: entry.get(k) for k in ("id", "at", "user_id", "user_name", "ip", "method", "path", "module", "collection", "action", "doc_id", "label", "count")}
    row["area"] = _area(entry)
    row["changed_fields"] = sorted((entry.get("changes") or {}).keys())
    return row


@api_router.get("/audit-log")
async def get_audit_log(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user_id: Optional[str] = None,
    action: Optional[str] = Query(None, pattern=ACTION_PATTERN),
    area: Optional[str] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(30, ge=1, le=200),
    current_user: dict = Depends(get_current_admin_user)
):
    """Lista o log, do mais recente para o mais antigo. `area` é uma chave de
    módulo (ex: financeiro.faturas) ou uma coleção (ex: users)."""
    query = {}
    period = {}
    # Dia no horário de Brasília -> instante em UTC
    if date_from:
        day = _parse_filter_day(date_from, "date_from")
        period["$gte"] = datetime(day.year, day.month, day.day, tzinfo=BRT_TZ)
    if date_to:
        day = _parse_filter_day(date_to, "date_to")
        period["$lt"] = datetime(day.year, day.month, day.day, tzinfo=BRT_TZ) + timedelta(days=1)
    if period:
        query["at"] = period
    if user_id:
        query["user_id"] = user_id
    if action:
        query["action"] = action
    if area:
        query["$or"] = [{"module": area}, {"collection": area}]
    if search:
        pattern = {"$regex": re.escape(search.strip()), "$options": "i"}
        query.setdefault("$and", []).append({"$or": [{"label": pattern}, {"doc_id": pattern}, {"path": pattern}]})

    total = await db[AUDIT_COLLECTION].count_documents(query)
    cursor = db[AUDIT_COLLECTION].find(query, {"_id": 0}).sort("at", -1).skip((page - 1) * per_page).limit(per_page)
    entries = await cursor.to_list(length=per_page)
    return {
        "items": [_summary(e) for e in entries],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
    }


@api_router.get("/audit-log/filters")
async def get_audit_log_filters(current_user: dict = Depends(get_current_admin_user)):
    """Opções dos filtros: usuários e áreas que já aparecem no log."""
    users = await db[AUDIT_COLLECTION].aggregate([
        {"$group": {"_id": "$user_id", "name": {"$last": "$user_name"}}},
        {"$sort": {"name": 1}},
    ]).to_list(length=None)
    pairs = await db[AUDIT_COLLECTION].aggregate([
        {"$group": {"_id": {"module": "$module", "collection": "$collection"}}},
    ]).to_list(length=None)
    areas = {}
    for p in pairs:
        key = p["_id"].get("module") or p["_id"].get("collection")
        if key:
            areas[key] = _area(p["_id"])
    return {
        "users": [{"id": u["_id"], "name": u["name"]} for u in users if u["_id"]],
        "areas": sorted(({"key": k, "label": v} for k, v in areas.items()), key=lambda a: a["label"]),
    }


@api_router.get("/audit-log/{entry_id}")
async def get_audit_log_entry(entry_id: str, current_user: dict = Depends(get_current_admin_user)):
    entry = await db[AUDIT_COLLECTION].find_one({"id": entry_id}, {"_id": 0})
    if not entry:
        raise HTTPException(status_code=404, detail="Registro do log não encontrado")
    entry["area"] = _area(entry)
    return entry


@api_router.get("/audit-log/record/{doc_id}")
async def get_record_history(doc_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Tudo o que aconteceu com um mesmo registro, do mais antigo ao mais recente."""
    entries = await db[AUDIT_COLLECTION].find({"doc_id": doc_id}, {"_id": 0}).sort("at", 1).to_list(length=500)
    return [_summary(e) | {"changes": e.get("changes")} for e in entries]
