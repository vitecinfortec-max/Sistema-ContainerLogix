"""Filtros de lista feitos no banco (e não na página já carregada): período
pelo dia no horário de Brasília e busca de texto em vários campos."""
from datetime import datetime, time, timedelta, timezone
from typing import Iterable, Optional
import re

from fastapi import HTTPException

from reports import BRT_TZ


def _parse_filter_day(value: str, field: str):
    """Mesma regra de routers.movements._parse_filter_day (copiada para este
    módulo não depender dos routers): data inválida vira 400."""
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Data inválida em {field}: use o formato AAAA-MM-DD")


def period_query(field: str, date_from: Optional[str], date_to: Optional[str]) -> dict:
    """Registros cujo `field` (gravado em UTC) cai entre os dias date_from e
    date_to de Brasília, inclusive. Aceita o campo gravado como texto ISO
    (o padrão) ou como data do Mongo (registros antigos)."""
    if not date_from and not date_to:
        return {}
    bounds = {}
    if date_from:
        bounds["$gte"] = datetime.combine(_parse_filter_day(date_from, "date_from"), time.min, BRT_TZ).astimezone(timezone.utc)
    if date_to:
        bounds["$lt"] = datetime.combine(_parse_filter_day(date_to, "date_to") + timedelta(days=1), time.min, BRT_TZ).astimezone(timezone.utc)
    as_text = {op: value.isoformat() for op, value in bounds.items()}
    return {"$or": [{field: as_text}, {field: bounds}]}


def day_query(field: str, date_from: Optional[str], date_to: Optional[str]) -> dict:
    """Mesmo filtro, para campo gravado só com o dia ('YYYY-MM-DD', sem hora nem fuso)"""
    bounds = {}
    if date_from:
        bounds["$gte"] = _parse_filter_day(date_from, "date_from").isoformat()
    if date_to:
        bounds["$lte"] = _parse_filter_day(date_to, "date_to").isoformat()
    return {field: bounds} if bounds else {}


def text_query(fields: Iterable[str], search: Optional[str]) -> dict:
    search = (search or "").strip()
    if not search:
        return {}
    regex = {"$regex": re.escape(search), "$options": "i"}
    return {"$or": [{f: regex} for f in fields]}


def combine(*queries: dict) -> dict:
    parts = [q for q in queries if q]
    if not parts:
        return {}
    return parts[0] if len(parts) == 1 else {"$and": parts}
