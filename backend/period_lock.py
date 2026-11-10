"""Bloqueio de período financeiro: o administrador informa em Dados da Empresa
uma data de fechamento (financial_lock_date) e nenhum lançamento financeiro
com data até esse dia pode ser incluído, alterado ou excluído, nem pelo
administrador. Para corrigir algo, ele volta a data, corrige e fecha de novo
(a troca da data fica na Auditoria, como qualquer alteração em Dados da Empresa).

Cada rota diz quais datas valem para o que está fazendo:
  - incluir/alterar/excluir: a data do documento (emissão, criação...), a
    antiga e, se mudou, a nova;
  - baixa/pagamento: a data da baixa. Uma fatura emitida em período fechado
    pode ser paga depois; desfazer uma baixa olha a data da baixa antiga.
"""
from datetime import datetime

from fastapi import HTTPException

from reports import BRT_TZ, local_datetime
from shared import db


async def get_lock_date() -> str | None:
    settings = await db.company_settings.find_one({}, {"_id": 0, "financial_lock_date": 1}) or {}
    return settings.get("financial_lock_date") or None


def as_local_date(value) -> str | None:
    """'YYYY-MM-DD' do dia como o usuário vê: data digitada fica como está;
    horário carimbado pelo servidor (UTC) vira o dia em Brasília."""
    if value in (None, ""):
        return None
    if isinstance(value, str) and len(value.strip()) == 10:
        return value.strip()
    dt = local_datetime(value)
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(BRT_TZ)
    return dt.date().isoformat()


def _br(iso: str) -> str:
    return datetime.fromisoformat(iso).strftime("%d/%m/%Y")


async def ensure_period_open(*dates, what: str = "Lançamento") -> None:
    """HTTP 400 se alguma das datas cair no período fechado. Datas vazias
    (lançamento sem data) não travam."""
    lock = await get_lock_date()
    if not lock:
        return
    for value in dates:
        day = as_local_date(value)
        if day and day <= lock:
            raise HTTPException(
                status_code=400,
                detail=f"Período financeiro fechado até {_br(lock)}: {what} de {_br(day)} não pode ser incluído, alterado ou excluído. "
                       "Para corrigir, o administrador precisa reabrir o período em Dados da Empresa.",
            )
