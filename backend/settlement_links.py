"""Vínculo de abastecimentos, Ordens de Carregamento e Ordens de Serviço -
Cliente com o Acerto de Motorista (routers/driver_settlements.py). Fica fora dos routers pra
fuel_supply.py e loading_orders.py poderem consultar sem import circular."""
from typing import Optional

from fastapi import HTTPException

from shared import db


async def settlement_holding(kind: str, record_id: str, exclude_id: Optional[str] = None) -> Optional[dict]:
    """Acerto que já contém o abastecimento (kind='fuel'), a Ordem de
    Carregamento (kind='trip') ou a Ordem de Serviço - Cliente (kind='client_os')."""
    field = {"fuel": "fuel_supplies.id", "client_os": "trips.port_client_order_id"}.get(kind, "trips.loading_order_id")
    query = {field: record_id}
    if exclude_id:
        query["id"] = {"$ne": exclude_id}
    return await db.driver_settlements.find_one(query, {"_id": 0, "id": 1, "settlement_number": 1, "status": 1})


async def ensure_not_in_settlement(kind: str, record_id: str, action: str) -> None:
    """HTTP 400 quando o registro está em algum acerto (o valor/viagem já foi acertado com o motorista)."""
    settlement = await settlement_holding(kind, record_id)
    if settlement:
        what = {"fuel": "Abastecimento", "client_os": "Ordem de Serviço - Cliente"}.get(kind, "Ordem de Carregamento")
        raise HTTPException(
            status_code=400,
            detail=f"{what} está no Acerto de Motorista nº {settlement['settlement_number']}: "
                   f"tire-o do acerto (ou reabra o acerto) antes de {action}.",
        )
