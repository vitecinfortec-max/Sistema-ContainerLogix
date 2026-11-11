"""Plano de Contas e Centro de Custo nos documentos financeiros (Contas a
Pagar, Contas a Receber, Faturas). Fora de routers/payables.py porque as
Faturas importam daqui, e payables -> container_audits -> movements -> invoices
fecharia um ciclo de import."""
from typing import Optional

from fastapi import HTTPException

from shared import db


async def account_links(account_id: Optional[str], cost_center_id: Optional[str]) -> dict:
    """Confere a conta do plano de contas e o centro de custo e devolve os
    ids com os nomes que o documento guarda (Contas a Pagar/Receber, Faturas)."""
    fields = {"account_id": None, "account_name": None, "cost_center_id": None, "cost_center_name": None}
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
