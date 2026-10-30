from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta, date
from typing import Optional, List, Literal
import io
import re
import logging

from container_ocr import format_container_number

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel as PydanticBaseModel, ValidationError
from pymongo.errors import DuplicateKeyError

from models import ContainerMovement, ContainerMovementCreate, ContainerMovementResponse
from reports import generate_movement_voucher_pdf, to_brt, BRT_TZ

from shared import (
    db, manager, get_current_active_user, get_company_settings, get_next_transaction_id,
    parse_datetime_value, round_money
)
from routers.invoices import sync_invoice_with_movement, find_invoice_of_movement

api_router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)


def _movement_response(m: dict) -> ContainerMovementResponse:
    """Único ponto que monta a resposta de uma movimentação a partir do
    documento do banco. Antes eram 7 construtores escritos à mão, campo por
    campo, e cada um esquecia campos diferentes (foi assim que a moeda sumia
    de algumas telas). Os fallbacks cobrem os documentos gravados pela antiga
    saída rápida do Controle de Pátio, que usava outros nomes de campo
    (vehicle_plate, transport_company_name, created_by_name) e não tinha CPF
    do motorista - lidos direto com m['...'] derrubavam o Dashboard."""
    return ContainerMovementResponse(
        id=m['id'],
        transaction_id=m.get('transaction_id', 0),
        operation_type=m['operation_type'],
        driver_name=m.get('driver_name', ''),
        driver_cpf=m.get('driver_cpf', ''),
        truck_plate=m.get('truck_plate', m.get('vehicle_plate', '')),
        trailer_plate_1=m.get('trailer_plate_1', ''),
        trailer_plate_2=m.get('trailer_plate_2'),
        transport_company=m.get('transport_company', m.get('transport_company_name', '')),
        client_name=m.get('client_name'),
        buyer_name=m.get('buyer_name'),
        container_number=m['container_number'],
        status=m['status'],
        size_type=m['size_type'],
        tare=m.get('tare'),
        shipping_line=m['shipping_line'],
        seal=m.get('seal'),
        genset=m.get('genset'),
        booking=m.get('booking'),
        origin_terminal=m.get('origin_terminal'),
        service_type=m.get('service_type'),
        invoice_number=m.get('invoice_number'),
        service_value=m.get('service_value'),
        currency=m.get('currency') or 'BRL',
        observations=m.get('observations'),
        container_photos=m.get('container_photos'),
        container_damages=m.get('container_damages') or [],
        inspection_notes=m.get('inspection_notes'),
        container_value=m.get('container_value'),
        container_value_currency=m.get('container_value_currency') or 'BRL',
        manufacture_date=m.get('manufacture_date'),
        loading_order_id=m.get('loading_order_id'),
        billed=m.get('billed', False),
        billed_at=parse_datetime_value(m['billed_at']) if m.get('billed_at') else None,
        created_at=parse_datetime_value(m['created_at']),
        user_name=m.get('user_name', m.get('created_by_name', '')),
    )


def _parse_filter_day(value: str, field: str) -> date:
    """Dia (YYYY-MM-DD) recebido num filtro de período - data inválida vira
    400, em vez de o filtro ser ignorado em silêncio."""
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Data inválida em {field}: use o formato AAAA-MM-DD")


def _filter_movements_by_period(movements: list, date_from: Optional[str], date_to: Optional[str]) -> list:
    """Mantém as movimentações cujo dia de lançamento, no horário de Brasília,
    cai entre date_from e date_to (ambos inclusive). Movimentação com
    created_at ilegível não é descartada."""
    if not date_from and not date_to:
        return movements
    day_from = _parse_filter_day(date_from, "date_from") if date_from else None
    day_to = _parse_filter_day(date_to, "date_to") if date_to else None
    filtered = []
    for m in movements:
        created_brt = to_brt(m.get('created_at'))
        if created_brt is not None:
            movement_day = created_brt.date()
            if day_from and movement_day < day_from:
                continue
            if day_to and movement_day > day_to:
                continue
        filtered.append(m)
    return filtered


# Colunas pelas quais a lista de movimentações pode ser ordenada
_MOVEMENT_SORT_FIELDS = {
    "transaction_id", "operation_type", "container_number", "client_name", "driver_name",
    "truck_plate", "status", "created_at", "user_name",
}


def _transaction_id_prefix_ranges(text: str) -> list:
    """Filtros que casam todo Nº de registro que COMEÇA com os dígitos
    digitados ("12" -> 12, 120-129, 1200-1299...). transaction_id é número, e
    faixas numéricas usam o índice - a alternativa seria converter cada
    registro pra texto dentro do banco a cada busca."""
    digits = text.strip().lstrip('#')
    if not digits.isdigit() or len(digits) > 12:
        return []
    prefix = int(digits)
    if prefix == 0:
        return [{"transaction_id": 0}]
    ranges, scale = [], 1
    while prefix * scale < 10 ** 12:
        low = prefix * scale
        ranges.append({"transaction_id": {"$gte": low, "$lt": low + scale}})
        scale *= 10
    return ranges


async def _movement_filter_stats(query: dict, total: int) -> dict:
    """Entradas/saídas e cheios/vazios de tudo que o filtro alcança - os
    indicadores do topo da tela não podem depender de quantas linhas a página
    atual carregou."""
    counts = {"ENTRADA": 0, "SAIDA": 0, "CHEIO": 0, "VAZIO": 0}
    pipeline = [
        {"$match": query},
        {"$group": {"_id": {"op": "$operation_type", "status": "$status"}, "count": {"$sum": 1}}},
    ]
    async for row in db.movements.aggregate(pipeline):
        for key in (row["_id"].get("op"), row["_id"].get("status")):
            if key in counts:
                counts[key] += row["count"]
    return {
        "total": total, "entries": counts["ENTRADA"], "exits": counts["SAIDA"],
        "full": counts["CHEIO"], "empty": counts["VAZIO"],
    }


def _movement_order_key(m: dict):
    """Ordem cronológica das movimentações; o Nº da transação desempata
    registros gravados no mesmo instante."""
    return (parse_datetime_value(m['created_at']), m.get('transaction_id') or 0)


def last_movement_by_container(movements: list) -> dict:
    """Movimentação mais recente de cada container."""
    last = {}
    for m in sorted(movements, key=_movement_order_key):
        last[m['container_number']] = m
    return last


def in_stock_movements(movements: list) -> list:
    """Regra única de "Estoque Atual": o container está no pátio quando a
    última movimentação dele é uma ENTRADA (devolve essa entrada). Contar
    entradas contra saídas do histórico inteiro errava pra sempre depois de
    uma entrada lançada em dobro, ou com um número de container reutilizado."""
    return [m for m in last_movement_by_container(movements).values() if m['operation_type'] == 'ENTRADA']


async def _find_last_movement(container_number: str):
    """Movimentação mais recente (qualquer tipo) registrada pra esse container."""
    return await db.movements.find_one(
        {"container_number": container_number.strip().upper()},
        {"_id": 0, "transaction_id": 1, "operation_type": 1, "created_at": 1},
        sort=[("created_at", -1)]
    )


@api_router.get("/movements/last-for-container/{container_number}")
async def get_last_movement_for_container(container_number: str, current_user: dict = Depends(get_current_active_user)):
    """Usado pelo formulário de Emissão de EIR pra avisar, assim que o
    container é digitado, se uma Entrada/Saída em duplicidade vai ser
    bloqueada no envio - antes que o usuário preencha o formulário inteiro."""
    last = await _find_last_movement(container_number)
    if not last:
        return {"movement": None}
    return {"movement": last}


@api_router.get("/movements/sync-state")
async def get_movements_sync_state(current_user: dict = Depends(get_current_active_user)):
    """Resumo barato do estado das movimentações (quantidade + última criação
    + última edição), consultado pelo polling de fallback do frontend
    (WebSocketContext.js) pra saber se precisa baixar a lista de novo - muda
    quando alguém cria, edita ou exclui uma movimentação."""
    last_created = await db.movements.find_one({}, {"_id": 0, "created_at": 1}, sort=[("created_at", -1)])
    last_updated = await db.movements.find_one(
        {"updated_at": {"$type": "string"}}, {"_id": 0, "updated_at": 1}, sort=[("updated_at", -1)]
    )
    return {
        "count": await db.movements.estimated_document_count(),
        "last_created_at": str(last_created['created_at']) if last_created else None,
        "last_updated_at": last_updated['updated_at'] if last_updated else None,
    }


def _normalize_client_name(name: Optional[str]) -> str:
    return (name or '').strip().casefold()


def container_number_pattern(container_number: str) -> str:
    """Regex que acha o container gravado com ou sem o traço do dígito
    verificador: a reserva e a EIR podem ter sido digitadas em formatos
    diferentes, e a comparação exata deixava a saída passar sem baixa."""
    formatted = format_container_number(container_number)
    if re.fullmatch(r'[A-Z]{4}[0-9]{6}-[0-9]', formatted):
        return f"^{formatted[:10]}-?[0-9]?$"
    return f"^{re.escape(formatted)}$"


async def _check_segregation_conflict(
    container_number: str, operation_type: str,
    client_name: Optional[str], buyer_name: Optional[str] = None,
) -> Optional[str]:
    """Trava #1 da Segregação de Unidade: se o container está Segregado
    (ATIVO) pra um cliente, uma EIR de Saída só pode ser emitida quando o
    cliente reservado aparece no campo Cliente OU no campo Comprador da EIR
    (o reconhecimento da baixa é feito por qualquer um dos dois, já que na
    prática quem retira um container comprado costuma ser preenchido em
    Comprador, não em Cliente) - qualquer outra combinação é bloqueada.
    Retorna a mensagem de erro (ou None se pode seguir). Não se aplica a
    Entrada, só a Saída, já que a segregação reserva o container pra retirada."""
    if operation_type != 'SAIDA':
        return None
    segregation = await db.unit_segregations.find_one(
        {"items.container_number": {"$regex": container_number_pattern(container_number)}, "status": "ATIVO"},
        {"_id": 0, "client_name": 1}
    )
    if not segregation:
        return None
    reserved = _normalize_client_name(segregation['client_name'])
    if reserved not in (_normalize_client_name(client_name), _normalize_client_name(buyer_name)):
        return (
            f"Este container está segregado (reservado) para o cliente \"{segregation['client_name']}\". "
            f"Selecione esse cliente no campo Cliente ou Comprador para emitir a saída, ou libere a segregação em Segregação de Unidade."
        )
    return None


async def _mark_segregation_retrieved(container_number: str, transaction_id: int):
    """Dá baixa (retirada) no item segregado desse container, assim que a EIR
    de Saída pro cliente certo é emitida - chamado incondicionalmente em toda
    Saída (criação ou edição); só tem efeito se existir mesmo uma segregação
    ATIVA pra ele com o item ainda Pendente (query não casa e o update vira
    no-op, senão) - a guarda "retrieved": {"$ne": True} evita que uma
    edição posterior da mesma EIR (ex: corrigindo um campo não relacionado)
    fique reescrevendo retrieved_at/retrieved_transaction_id a cada save.
    O $elemMatch é obrigatório: com "items.retrieved": {"$ne": True} solto, o
    $ne vale pra lista inteira, e depois da primeira baixa da reserva os
    outros containers nunca mais recebiam a deles."""
    await db.unit_segregations.update_one(
        {
            "status": "ATIVO",
            "items": {"$elemMatch": {
                "container_number": {"$regex": container_number_pattern(container_number)},
                "retrieved": {"$ne": True},
            }},
        },
        {"$set": {
            "items.$.retrieved": True,
            "items.$.retrieved_at": datetime.now(timezone.utc).isoformat(),
            "items.$.retrieved_transaction_id": transaction_id,
        }}
    )


async def _inherit_from_open_entry(movement_input: ContainerMovementCreate, before: Optional[str] = None) -> dict:
    """Valor do container e data de fabricação são informados na Entrada
    (opcionais). Numa Saída, o que a entrada do container tiver preenchido
    vale e fica travado: o que vier no pedido pra esses campos é ignorado. Só
    o que a entrada deixou em branco pode ser informado na própria saída.
    Aplicado em todo caminho que grava uma saída (Emissão e edição de EIR,
    saída rápida do Controle de Pátio e Ordem de Carregamento), não só no
    formulário, que mostra os campos puxados já bloqueados.
    `before`: created_at da saída que está sendo editada - a entrada dela é a
    última anterior a esse momento."""
    values = {
        "container_value": movement_input.container_value,
        "container_value_currency": movement_input.container_value_currency,
        "manufacture_date": movement_input.manufacture_date,
    }
    if movement_input.operation_type != 'SAIDA':
        return values
    values.update(await _entry_locked_fields(movement_input.container_number, before))
    return values


async def _entry_locked_fields(container_number: str, before: Optional[str] = None) -> dict:
    """O que a última entrada do container tem preenchido de valor do
    container e data de fabricação - só as chaves preenchidas, que são as que
    ficam travadas na saída."""
    query = {"container_number": container_number, "operation_type": "ENTRADA"}
    if before:
        query["created_at"] = {"$lt": before}
    entry = await db.movements.find_one(
        query,
        {"_id": 0, "container_value": 1, "container_value_currency": 1, "manufacture_date": 1},
        sort=[("created_at", -1)]
    )
    locked = {}
    if not entry:
        return locked
    if entry.get("container_value") is not None:
        locked["container_value"] = entry["container_value"]
        locked["container_value_currency"] = entry.get("container_value_currency") or "BRL"
    if entry.get("manufacture_date"):
        locked["manufacture_date"] = entry["manufacture_date"]
    return locked


@asynccontextmanager
async def _container_movement_lock(container_number: str):
    """Reserva o container no banco enquanto uma movimentação dele é
    registrada. A trava de duplicidade é "lê a última movimentação, depois
    grava" - sem isso, duas Entradas enviadas ao mesmo tempo liam o mesmo
    estado e as duas passavam. A reserva expira sozinha (índice TTL em
    movement_locks.created_at) se o processo cair antes de liberar."""
    key = container_number.strip().upper()
    try:
        await db.movement_locks.insert_one({"_id": key, "created_at": datetime.now(timezone.utc)})
    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail="Outra movimentação deste container está sendo registrada neste momento. Aguarde alguns segundos e tente novamente."
        )
    try:
        yield
    finally:
        await db.movement_locks.delete_one({"_id": key})


async def _create_container_movement(
    movement_input: ContainerMovementCreate,
    current_user: dict,
    loading_order_id: Optional[str] = None,
) -> ContainerMovementResponse:
    """Cria uma movimentação de estoque (Entrada/Saída) - caminho único usado
    tanto pelo POST /movements manual (Emissão de EIR) quanto pelo gatilho
    automático da Ordem de Carregamento, pra garantir que a trava de
    duplicidade, o contador de transação e o broadcast de WebSocket nunca
    fiquem divergentes entre os dois (ver quick-exit em yard-control pra um
    exemplo do que dá errado quando esse caminho é duplicado à mão)."""
    async with _container_movement_lock(movement_input.container_number):
        return await _create_container_movement_locked(movement_input, current_user, loading_order_id)


async def _create_container_movement_locked(
    movement_input: ContainerMovementCreate,
    current_user: dict,
    loading_order_id: Optional[str] = None,
) -> ContainerMovementResponse:
    # Trava de duplicidade: não permite registrar uma Entrada quando a
    # movimentação mais recente desse container já é uma Entrada (ainda não
    # saiu), nem uma Saída quando a mais recente já é uma Saída (já saiu e
    # não voltou a entrar) - mesmo critério "mesmo tipo duas vezes seguidas"
    # já usado na auditoria de duplicidades da produção.
    last_movement = await _find_last_movement(movement_input.container_number)
    if last_movement and last_movement.get('operation_type') == movement_input.operation_type:
        tipo_label = 'ENTRADA' if movement_input.operation_type == 'ENTRADA' else 'SAÍDA'
        last_dt = parse_datetime_value(last_movement['created_at'])
        last_dt_brt = to_brt(last_dt) if last_dt else None
        date_str = last_dt_brt.strftime('%d/%m/%Y %H:%M') if last_dt_brt else '-'
        raise HTTPException(
            status_code=400,
            detail=(
                f"Este container já teve uma {tipo_label} registrada (Transação #{last_movement.get('transaction_id')}, "
                f"em {date_str}) sem uma movimentação do tipo oposto depois. "
                f"Não é possível registrar outra {tipo_label} em duplicidade."
            )
        )

    segregation_error = await _check_segregation_conflict(
        movement_input.container_number, movement_input.operation_type,
        movement_input.client_name, movement_input.buyer_name
    )
    if segregation_error:
        raise HTTPException(status_code=400, detail=segregation_error)

    inherited = await _inherit_from_open_entry(movement_input)

    # Usar contador atômico para garantir sequência única
    next_transaction_id = await get_next_transaction_id()

    movement = ContainerMovement(
        transaction_id=next_transaction_id,
        operation_type=movement_input.operation_type,
        driver_name=movement_input.driver_name,
        driver_cpf=movement_input.driver_cpf,
        truck_plate=movement_input.truck_plate,
        trailer_plate_1=movement_input.trailer_plate_1,
        trailer_plate_2=movement_input.trailer_plate_2,
        transport_company=movement_input.transport_company,
        client_name=movement_input.client_name,
        buyer_name=movement_input.buyer_name,
        container_number=movement_input.container_number,
        status=movement_input.status,
        size_type=movement_input.size_type,
        tare=movement_input.tare,
        shipping_line=movement_input.shipping_line,
        seal=movement_input.seal,
        genset=movement_input.genset,
        booking=movement_input.booking,
        origin_terminal=movement_input.origin_terminal,
        service_type=movement_input.service_type,
        invoice_number=movement_input.invoice_number,
        service_value=round_money(movement_input.service_value),
        currency=movement_input.currency,
        observations=movement_input.observations,
        container_photos=movement_input.container_photos,
        container_damages=movement_input.container_damages,
        inspection_notes=movement_input.inspection_notes,
        container_value=round_money(inherited['container_value']),
        container_value_currency=inherited['container_value_currency'],
        manufacture_date=inherited['manufacture_date'],
        loading_order_id=loading_order_id,
        created_by=current_user['sub'],
        user_name=current_user['name']
    )

    doc = movement.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    if doc.get('billed_at'):
        doc['billed_at'] = doc['billed_at'].isoformat()
    await db.movements.insert_one(doc)

    if movement.operation_type == 'SAIDA':
        await _mark_segregation_retrieved(movement.container_number, movement.transaction_id)

    response = _movement_response(doc)

    # Notificar todos os clientes conectados via WebSocket
    await manager.broadcast({
        "type": "MOVEMENT_CREATED",
        "data": {
            "id": response.id,
            "transaction_id": response.transaction_id,
            "operation_type": response.operation_type,
            "driver_name": response.driver_name,
            "driver_cpf": response.driver_cpf,
            "truck_plate": response.truck_plate,
            "trailer_plate_1": response.trailer_plate_1,
            "trailer_plate_2": response.trailer_plate_2,
            "transport_company": response.transport_company,
            "container_number": response.container_number,
            "status": response.status,
            "size_type": response.size_type,
            "tare": response.tare,
            "shipping_line": response.shipping_line,
            "seal": response.seal,
            "genset": response.genset,
            "booking": response.booking,
            "created_at": response.created_at.isoformat(),
            "user_name": response.user_name
        }
    })

    return response


@api_router.post("/movements", response_model=ContainerMovementResponse)
async def create_movement(movement_input: ContainerMovementCreate, current_user: dict = Depends(get_current_active_user)):
    await _ensure_not_blocked(movement_input)
    return await _create_container_movement(movement_input, current_user)


async def _ensure_not_blocked(movement_input):
    """Status Bloqueado no Cadastro: não deixa lançar EIR novo pra esse
    cliente/motorista (Inativo só some das listas da tela)."""
    client_name = (movement_input.client_name or '').strip()
    if client_name:
        blocked = await db.clients.find_one(
            {"name": {"$regex": f"^{re.escape(client_name)}$", "$options": "i"}, "status": "BLOQUEADO"}, {"_id": 0, "id": 1}
        )
        if blocked:
            raise HTTPException(status_code=400, detail=f"Cliente {client_name} está bloqueado no Cadastro")
    cpf_digits = re.sub(r'\D', '', movement_input.driver_cpf or '')
    if cpf_digits:
        for driver in await db.drivers.find({"status": "BLOQUEADO"}, {"_id": 0, "name": 1, "cpf": 1}).to_list(None):
            if re.sub(r'\D', '', driver.get('cpf') or '') == cpf_digits:
                raise HTTPException(status_code=400, detail=f"Motorista {driver.get('name') or ''} está bloqueado no Cadastro")


_LOADING_ORDER_TYPE_TO_OPERATION = {"COLETA": "ENTRADA", "ENTREGA": "SAIDA"}
_VALID_MOVEMENT_SIZE_TYPES = {"20DC", "20RF", "20OT", "20FR", "40HC", "40RF", "40OT", "40FR", "40DRY"}
_VALID_MOVEMENT_STATUSES = {"CHEIO", "VAZIO"}


async def validate_loading_order_movements(order: dict, loading_order_id: Optional[str] = None) -> List[str]:
    """Verifica se aprovar essa Ordem de Carregamento consegue gerar a
    movimentação de estoque de cada container sem violar a trava de
    duplicidade nem faltar campo obrigatório de ContainerMovementCreate.
    Retorna uma lista de mensagens de erro (vazia = pode aprovar). DEVE ser
    chamada ANTES de qualquer escrita no banco em create_loading_order/
    update_loading_order (loading_orders.py), já que uma falha aqui precisa
    bloquear a aprovação inteira, não só avisar depois de já ter salvo."""
    errors = []
    items = [it for it in (order.get('items') or []) if (it.get('container_number') or '').strip()]
    if not items:
        return errors  # já bloqueado antes por "ao menos 1 container" - defensivo

    operation_type = _LOADING_ORDER_TYPE_TO_OPERATION.get(order.get('order_type'), 'ENTRADA')
    tipo_label = 'ENTRADA' if operation_type == 'ENTRADA' else 'SAÍDA'

    # Campos de nível de ordem: opcionais em LoadingOrder, mas obrigatórios
    # em ContainerMovementCreate - sem essa checagem o hook quebraria com um
    # ValidationError não tratado depois que o status já teria sido gravado.
    required_order_fields = {
        'driver_name': 'Motorista', 'driver_cpf': 'CPF do Motorista',
        'truck_plate': 'Placa do Cavalo', 'trailer_plate': 'Placa da Carreta',
        'transport_company': 'Transportadora',
    }
    for field, label in required_order_fields.items():
        if not (order.get(field) or '').strip():
            errors.append(f"{label} é obrigatório para gerar as movimentações de estoque ao aprovar.")

    for item in items:
        container_number = item['container_number'].strip().upper()
        if item.get('size_type') not in _VALID_MOVEMENT_SIZE_TYPES:
            errors.append(f"Container {container_number}: Tipo/Tamanho é obrigatório e deve ser válido.")
        if item.get('status') not in _VALID_MOVEMENT_STATUSES:
            errors.append(f"Container {container_number}: Status (Cheio/Vazio) é obrigatório.")
        if not (item.get('shipping_line') or '').strip():
            errors.append(f"Container {container_number}: Armador é obrigatório.")

        if loading_order_id:
            existing_own = await db.movements.find_one(
                {"loading_order_id": loading_order_id, "container_number": container_number},
                {"_id": 0, "id": 1}
            )
            if existing_own:
                continue  # idempotência: essa ordem já gerou a movimentação desse container

        last_movement = await _find_last_movement(container_number)
        if last_movement and last_movement.get('operation_type') == operation_type:
            last_dt = parse_datetime_value(last_movement['created_at'])
            last_dt_brt = to_brt(last_dt) if last_dt else None
            date_str = last_dt_brt.strftime('%d/%m/%Y %H:%M') if last_dt_brt else '-'
            errors.append(
                f"Container {container_number}: já teve uma {tipo_label} registrada (Transação #{last_movement.get('transaction_id')}, "
                f"em {date_str}) sem uma movimentação do tipo oposto depois. Não é possível registrar outra {tipo_label} em duplicidade."
            )

        segregation_error = await _check_segregation_conflict(container_number, operation_type, order.get('client_name'))
        if segregation_error:
            errors.append(f"Container {container_number}: {segregation_error}")
    return errors


async def create_movements_for_loading_order(order: dict, current_user: dict) -> List[dict]:
    """Gera a movimentação de estoque (Entrada pra Coleta, Saída pra Entrega)
    de cada container de uma Ordem de Carregamento recém-Aprovada. Espelha
    create_freight_payment_for_order (freight_payments.py). Chamado depois
    que validate_loading_order_movements já bloqueou a transição se houvesse
    conflito - então nenhuma falha é esperada aqui; mesmo assim cada item
    roda isolado num try/except pra não deixar uma falha pontual (corrida
    rara entre o precheck e este hook) derrubar os containers já processados,
    já que nesse ponto o status da ordem já foi gravado e não tem como
    'desfazer' de forma limpa."""
    operation_type = _LOADING_ORDER_TYPE_TO_OPERATION.get(order.get('order_type'), 'ENTRADA')
    results = []
    for item in (order.get('items') or []):
        container_number = (item.get('container_number') or '').strip().upper()
        if not container_number:
            continue

        existing = await db.movements.find_one(
            {"loading_order_id": order['id'], "container_number": container_number}, {"_id": 0}
        )
        if existing:
            results.append(existing)
            continue

        try:
            payload = ContainerMovementCreate(
                operation_type=operation_type,
                driver_name=order.get('driver_name') or '',
                driver_cpf=order.get('driver_cpf') or '',
                truck_plate=order.get('truck_plate') or '',
                trailer_plate_1=order.get('trailer_plate') or '',
                transport_company=order.get('transport_company') or '',
                client_name=order.get('client_name'),
                container_number=container_number,
                status=item.get('status'),
                size_type=item.get('size_type'),
                tare=item.get('gross_weight'),
                shipping_line=item.get('shipping_line') or '',
                seal=item.get('seal'),
                booking=order.get('booking'),
                origin_terminal=order.get('origin_terminal'),
            )
            response = await _create_container_movement(payload, current_user, loading_order_id=order['id'])
            results.append(response.model_dump())
        except (ValidationError, HTTPException) as e:
            logger.error(
                f"Falha ao gerar movimentação automática pro container {container_number} "
                f"da Ordem de Carregamento Nº {order.get('order_number')}: {e}"
            )
    return results


class MovementPDFRequest(PydanticBaseModel):
    movement_ids: List[str]
    via: Literal["TERMINAL", "MOTORISTA"]

@api_router.post("/movements/pdf")
async def download_movements_pdf(request: MovementPDFRequest, current_user: dict = Depends(get_current_active_user)):
    if not request.movement_ids:
        raise HTTPException(status_code=400, detail="Selecione pelo menos um registro")

    docs = await db.movements.find({"id": {"$in": request.movement_ids}}, {"_id": 0}).to_list(None)
    if not docs:
        raise HTTPException(status_code=404, detail="Nenhum registro encontrado")

    order = {mid: i for i, mid in enumerate(request.movement_ids)}
    docs.sort(key=lambda d: order.get(d['id'], 0))

    company = await get_company_settings()
    pdf_bytes = generate_movement_voucher_pdf(docs, request.via, company)

    filename = f"registro-gate-{docs[0].get('transaction_id')}.pdf" if len(docs) == 1 else f"registros-gate-{len(docs)}-documentos.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@api_router.get("/movements")
async def get_movements(
    operation_type: Optional[str] = None,
    status_filter: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    transaction_id: Optional[str] = None,
    container_number: Optional[str] = None,
    driver_name: Optional[str] = None,
    client_name: Optional[str] = None,
    search_id: Optional[str] = None,  # começo do Nº do registro, pra busca enquanto digita
    sort_by: Optional[str] = None,
    sort_dir: Literal["asc", "desc"] = "desc",
    page: int = Query(1, ge=1),
    per_page: int = Query(0, ge=0, le=1000),  # 0 = sem limite (compatível com quem já chamava sem paginar)
    current_user: dict = Depends(get_current_active_user)
):
    # Caso especial: Estoque Atual - containers que entraram mas não saíram
    if operation_type == "ESTOQUE":
        # Buscar todas as movimentações com projeção de campos necessários
        all_movements = await db.movements.find(
            {}, 
            {"_id": 0, "operation_type": 1, "container_number": 1, "status": 1, "created_at": 1,
             "driver_name": 1, "driver_cpf": 1, "truck_plate": 1, "trailer_plate_1": 1,
             "trailer_plate_2": 1, "transport_company": 1, "client_name": 1, "size_type": 1,
             "tare": 1, "shipping_line": 1, "seal": 1, "genset": 1, "booking": 1,
             "service_type": 1, "invoice_number": 1, "service_value": 1, "container_photos": 1,
             "billed": 1, "billed_at": 1, "user_name": 1, "id": 1, "transaction_id": 1}
        ).sort("created_at", -1).to_list(None)
        
        # Em estoque = última movimentação do container é uma ENTRADA
        stock = [m for m in in_stock_movements(all_movements) if not status_filter or m['status'] == status_filter]
        stock.sort(key=_movement_order_key, reverse=True)
        return [_movement_response(m) for m in stock]

    # Fluxo normal para outros tipos de operação
    query = {}
    if operation_type:
        query['operation_type'] = operation_type
    if status_filter:
        query['status'] = status_filter
    if transaction_id:
        try:
            query['transaction_id'] = int(transaction_id)
        except ValueError:
            query['transaction_id'] = -1  # nº inválido -> nenhum resultado, em vez de ignorar o filtro
    if container_number:
        query['container_number'] = {"$regex": re.escape(container_number), "$options": "i"}
    if driver_name:
        query['driver_name'] = {"$regex": re.escape(driver_name), "$options": "i"}
    if client_name:
        query['client_name'] = {"$regex": re.escape(client_name), "$options": "i"}
    # created_at é salvo como string ISO 8601 (sempre UTC) — comparação de string
    # funciona corretamente para ordenar/filtrar por data nesse formato.
    # date_from/date_to são dias no horário de Brasília: o intervalo vai de
    # 00:00 BRT do primeiro dia até 00:00 BRT do dia seguinte ao último (fim
    # exclusivo), convertido pra UTC.
    date_range = {}
    if date_from:
        day_from = _parse_filter_day(date_from, "date_from")
        date_range['$gte'] = datetime.combine(day_from, datetime.min.time(), tzinfo=BRT_TZ).astimezone(timezone.utc).isoformat()
    if date_to:
        day_to = _parse_filter_day(date_to, "date_to")
        date_range['$lt'] = datetime.combine(day_to + timedelta(days=1), datetime.min.time(), tzinfo=BRT_TZ).astimezone(timezone.utc).isoformat()
    if date_range:
        query['created_at'] = date_range

    if search_id and search_id.strip():
        id_ranges = _transaction_id_prefix_ranges(search_id)
        # Texto que não é número não bate com nenhum registro
        query['$or'] = id_ranges or [{"transaction_id": -1}]

    total = await db.movements.count_documents(query) if per_page else None
    # Desempate por id: sem ele, movimentações com o mesmo valor na coluna
    # ordenada podem trocar de ordem entre uma página e outra (repetindo ou
    # pulando registro).
    direction = 1 if sort_dir == "asc" else -1
    sort_field = sort_by if sort_by in _MOVEMENT_SORT_FIELDS else "created_at"
    if sort_by not in _MOVEMENT_SORT_FIELDS:
        direction = -1
    cursor = db.movements.find(query, {"_id": 0}).sort([(sort_field, direction), ("id", direction)])
    if per_page:
        cursor = cursor.skip((page - 1) * per_page).limit(per_page)
    movements = await cursor.to_list(None if not per_page else per_page)

    items = [
        _movement_response(m)
        for m in movements
    ]

    if per_page:
        return {
            "items": items,
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": (total + per_page - 1) // per_page,
            # Indicadores do filtro inteiro (não só da página devolvida)
            "stats": await _movement_filter_stats(query, total),
        }
    return items

@api_router.get("/movements/unbilled", response_model=List[ContainerMovementResponse])
async def get_unbilled_movements(
    client_name: Optional[str] = None,
    client_cnpj: Optional[str] = None,
    search: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    """Lista movimentações não faturadas para seleção"""
    query = {"billed": {"$ne": True}}
    
    # Filtrar por cliente (nome ou CNPJ)
    if client_name:
        # Buscar clientes que correspondem ao nome ou CNPJ
        client_name_escaped = re.escape(client_name)
        client_query = await db.clients.find_one({
            "$or": [
                {"name": {"$regex": client_name_escaped, "$options": "i"}},
                {"cnpj": {"$regex": client_name_escaped, "$options": "i"}}
            ]
        }, {"_id": 0})

        if client_query:
            query['client_name'] = client_query['name']
        else:
            # Se não encontrou cliente exato, buscar por nome parcial na movimentação
            query['client_name'] = {"$regex": client_name_escaped, "$options": "i"}
    
    if client_cnpj:
        # Buscar cliente pelo CNPJ
        client_by_cnpj = await db.clients.find_one({"cnpj": client_cnpj}, {"_id": 0})
        if client_by_cnpj:
            query['client_name'] = client_by_cnpj['name']
    
    if search:
        # Busca exata por transaction_id (ID digitado ou lido via código de
        # barras, que codifica o transaction_id) ou por container_number
        # (correspondência exata, não parcial) - antes usava regex parcial
        # contra container_number e até contra o campo interno "id" (um UUID),
        # o que fazia dígitos digitados baterem por coincidência em outras
        # movimentações não relacionadas.
        search_stripped = search.strip()
        try:
            transaction_id = int(search_stripped)
            query['transaction_id'] = transaction_id
        except ValueError:
            query['container_number'] = {
                "$regex": f"^{re.escape(search_stripped)}$", "$options": "i"
            }
    
    movements = await db.movements.find(query, {"_id": 0}).sort("created_at", -1).to_list(None)

    return [
        _movement_response(m)
        for m in movements
    ]


@api_router.get("/movements/find-for-invoice")
async def find_movement_for_invoice(
    search: str,
    current_user: dict = Depends(get_current_active_user)
):
    """Busca uma movimentação por ID (transaction_id) ou Nº de Container para
    adicionar a uma fatura manualmente. Ao contrário de /movements/unbilled,
    inclui movimentações já faturadas de propósito - assim o front consegue
    avisar em qual fatura ela já está, em vez de dizer "não encontrada"."""
    search_stripped = search.strip()
    query = {}
    try:
        query['transaction_id'] = int(search_stripped)
    except ValueError:
        query['container_number'] = {
            "$regex": f"^{re.escape(search_stripped)}$", "$options": "i"
        }

    movements = await db.movements.find(query, {"_id": 0}).sort("created_at", -1).to_list(None)

    results = []
    for m in movements:
        billed_invoice_number = None
        if m.get('billed'):
            # Pelo invoice_id; registros antigos perderam esse campo, então
            # cai pra lista de movimentações de uma fatura não cancelada.
            invoice = None
            if m.get('invoice_id'):
                invoice = await db.invoices.find_one({"id": m['invoice_id']}, {"_id": 0, "invoice_number": 1})
            if not invoice:
                invoice = await db.invoices.find_one(
                    {"movement_ids": m['id'], "status": {"$ne": "CANCELADO"}}, {"_id": 0, "invoice_number": 1}
                )
            if invoice:
                billed_invoice_number = invoice['invoice_number']

        results.append({
            "id": m['id'],
            "transaction_id": m.get('transaction_id', 0),
            "container_number": m['container_number'],
            "client_name": m.get('client_name'),
            "service_type": m.get('service_type'),
            "service_value": m.get('service_value'),
            "created_at": m['created_at'],
            "billed": m.get('billed', False),
            "billed_invoice_number": billed_invoice_number,
        })
    return results

@api_router.get("/movements/open-entry/{container_number}")
async def get_open_entry_for_container(container_number: str, current_user: dict = Depends(get_current_active_user)):
    """Retorna a ENTRADA mais recente desse container que ainda não teve uma SAÍDA
    correspondente — usado para autopreencher a Saída com os dados da Entrada."""
    entry = await db.movements.find_one(
        {"container_number": container_number.upper(), "operation_type": "ENTRADA"},
        {"_id": 0},
        sort=[("created_at", -1)]
    )
    if not entry:
        return {"entry": None}

    existing_exit = await db.movements.find_one({
        "container_number": entry["container_number"],
        "operation_type": "SAIDA",
        "created_at": {"$gt": entry["created_at"]}
    }, {"_id": 0})

    if existing_exit:
        return {"entry": None}

    return {"entry": entry}

@api_router.get("/movements/entry-locked-fields/{container_number}")
async def get_entry_locked_fields(
    container_number: str,
    exit_id: Optional[str] = None,
    current_user: dict = Depends(get_current_active_user)
):
    """Valor do container e data de fabricação que a entrada do container tem
    preenchidos - os formulários de Emissão e Edição de EIR usam pra mostrar
    esses campos já puxados e bloqueados numa Saída. `exit_id`: a saída que
    está sendo editada (a entrada dela é a última anterior a ela)."""
    before = None
    if exit_id:
        existing = await db.movements.find_one({"id": exit_id}, {"_id": 0, "created_at": 1})
        if existing:
            before = str(existing['created_at'])
    return await _entry_locked_fields(container_number.strip().upper(), before)

@api_router.get("/movements/{movement_id}", response_model=ContainerMovementResponse)
async def get_movement(movement_id: str, current_user: dict = Depends(get_current_active_user)):
    movement = await db.movements.find_one({"id": movement_id}, {"_id": 0})
    if not movement:
        raise HTTPException(status_code=404, detail="Movimentação não encontrada")
    
    return _movement_response(movement)

async def _edit_duplicate_conflict(container_number: str, operation_type: str, created_at: str, movement_id: str) -> Optional[str]:
    """Trava de duplicidade na edição: trocar o container ou o tipo de uma EIR
    não pode deixar duas movimentações do mesmo tipo seguidas no histórico do
    container (olha a vizinha anterior e a seguinte, pela data da EIR)."""
    base = {"container_number": container_number.strip().upper(), "id": {"$ne": movement_id}}
    projection = {"_id": 0, "transaction_id": 1, "operation_type": 1, "created_at": 1}
    previous = await db.movements.find_one({**base, "created_at": {"$lt": created_at}}, projection, sort=[("created_at", -1)])
    following = await db.movements.find_one({**base, "created_at": {"$gt": created_at}}, projection, sort=[("created_at", 1)])
    for neighbor in (previous, following):
        if neighbor and neighbor.get('operation_type') == operation_type:
            tipo_label = 'ENTRADA' if operation_type == 'ENTRADA' else 'SAÍDA'
            neighbor_brt = to_brt(parse_datetime_value(neighbor['created_at']))
            date_str = neighbor_brt.strftime('%d/%m/%Y %H:%M') if neighbor_brt else '-'
            return (
                f"Com essa alteração o container ficaria com duas {tipo_label}s seguidas "
                f"(a outra é a Transação #{neighbor.get('transaction_id')}, em {date_str}). "
                f"Confira o número do container e o tipo da movimentação."
            )
    return None


@api_router.put("/movements/{movement_id}", response_model=ContainerMovementResponse)
async def update_movement(movement_id: str, movement_input: ContainerMovementCreate, current_user: dict = Depends(get_current_active_user)):
    existing = await db.movements.find_one({"id": movement_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Movimentação não encontrada")

    if existing.get('billed'):
        requester = await db.users.find_one({"id": current_user['sub']}, {"_id": 0, "role": 1})
        if not requester or requester.get('role') != 'admin':
            raise HTTPException(status_code=403, detail="Movimentação já faturada não pode ser editada. Solicite a um administrador.")

    update_data = movement_input.model_dump()
    update_data['id'] = movement_id
    update_data['transaction_id'] = existing.get('transaction_id', 0)
    update_data['created_at'] = existing['created_at']
    update_data['created_by'] = existing['created_by']
    update_data['user_name'] = existing['user_name']
    update_data['billed'] = existing.get('billed', False)
    update_data['billed_at'] = existing.get('billed_at')
    # Vínculo com a fatura: sem isso o replace_one abaixo apagava o invoice_id
    # de toda movimentação faturada que fosse editada.
    if existing.get('invoice_id') is not None:
        update_data['invoice_id'] = existing['invoice_id']
    update_data['loading_order_id'] = existing.get('loading_order_id')
    # container_photos não faz parte de ContainerMovementCreate - sem isso, o
    # replace_one abaixo (substitui o documento inteiro) apagaria o campo
    # legado em qualquer edição.
    update_data['container_photos'] = existing.get('container_photos')
    # Lido por /movements/sync-state pra o polling de fallback perceber edições.
    update_data['updated_at'] = datetime.now(timezone.utc).isoformat()

    # Arredondar valor monetário para evitar problemas de precisão
    if update_data.get('service_value') is not None:
        update_data['service_value'] = round_money(update_data['service_value'])

    # Numa Saída, valor do container e data de fabricação seguem os da
    # entrada (travados) - mesma regra da criação.
    update_data.update(await _inherit_from_open_entry(movement_input, before=str(existing['created_at'])))
    update_data['container_value'] = round_money(update_data['container_value'])

    # Mesma trava #1 da Segregação de Unidade aplicada na criação
    # (_create_container_movement) - editar uma EIR também pode trocar
    # container/operação/cliente/comprador pra uma combinação que deveria
    # estar bloqueada, e sem isso aqui o reconhecimento da baixa (abaixo)
    # nunca rodava pra EIRs de Saída que só ganharam o Cliente/Comprador
    # certo numa edição posterior à criação.
    segregation_error = await _check_segregation_conflict(
        update_data['container_number'], update_data['operation_type'],
        update_data.get('client_name'), update_data.get('buyer_name')
    )
    if segregation_error:
        raise HTTPException(status_code=400, detail=segregation_error)

    # Mesma trava de duplicidade da criação, quando a edição troca o
    # container ou o tipo (Entrada/Saída)
    changed_identity = (
        (update_data['container_number'] or '').strip().upper() != (existing.get('container_number') or '').strip().upper()
        or update_data['operation_type'] != existing.get('operation_type')
    )
    if changed_identity:
        duplicate_error = await _edit_duplicate_conflict(
            update_data['container_number'], update_data['operation_type'], str(existing['created_at']), movement_id
        )
        if duplicate_error:
            raise HTTPException(status_code=400, detail=duplicate_error)

    await db.movements.replace_one({"id": movement_id}, update_data)

    # Movimentação faturada com valor alterado: a fatura acompanha.
    if existing.get('billed') and update_data.get('service_value') != existing.get('service_value'):
        await sync_invoice_with_movement(update_data, deleted=False, current_user=current_user)

    if update_data['operation_type'] == 'SAIDA':
        await _mark_segregation_retrieved(update_data['container_number'], update_data['transaction_id'])

    return _movement_response(update_data)

@api_router.delete("/movements/{movement_id}")
async def delete_movement(movement_id: str, current_user: dict = Depends(get_current_active_user)):
    existing = await db.movements.find_one({"id": movement_id}, {"_id": 0, "id": 1, "billed": 1, "transaction_id": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Movimentação não encontrada")

    if existing.get('billed'):
        requester = await db.users.find_one({"id": current_user['sub']}, {"_id": 0, "role": 1})
        if not requester or requester.get('role') != 'admin':
            raise HTTPException(status_code=403, detail="Movimentação já faturada não pode ser excluída. Solicite a um administrador.")
        # Uma fatura não pode ficar sem nenhuma movimentação.
        invoice = await find_invoice_of_movement(movement_id)
        if invoice and len(invoice['movement_ids']) <= 1:
            raise HTTPException(
                status_code=400,
                detail=f"Esta é a única movimentação da Fatura nº {invoice['invoice_number']}. Exclua a fatura antes de excluir a movimentação."
            )

    result = await db.movements.delete_one({"id": movement_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Movimentação não encontrada")

    # Era faturada: sai da lista da fatura e o total é recalculado.
    if existing.get('billed'):
        await sync_invoice_with_movement(existing, deleted=True, current_user=current_user)

    # Notificar todos os clientes conectados via WebSocket
    await manager.broadcast({
        "type": "MOVEMENT_DELETED",
        "data": {"id": movement_id}
    })

    return {"message": "Movimentação deletada com sucesso"}
