from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

# Carregar variáveis de ambiente ANTES de qualquer outra importação
load_dotenv()

from starlette.middleware.cors import CORSMiddleware
import os
import logging
from typing import Optional

from shared import (
    db, client, manager, UPLOADS_DIR,
    get_disabled_modules, match_module_for_path, is_module_disabled,
)
from auth import decode_token

from routers.auth import api_router as auth_router
from routers.cadastros import api_router as cadastros_router
from routers.movements import api_router as movements_router
from routers.invoices import api_router as invoices_router
from routers.photo_registries import api_router as photo_registries_router
from routers.container_inspections import api_router as container_inspections_router
from routers.flex_tank import api_router as flex_tank_router
from routers.frota import api_router as frota_router
from routers.loading_schedule import api_router as loading_schedule_router
from routers.daily_rate import api_router as daily_rate_router
from routers.delivery_status import api_router as delivery_status_router
from routers.unit_segregation import api_router as unit_segregation_router
from routers.intl_invoices import api_router as intl_invoices_router
from routers.rpa_terceiro import api_router as rpa_terceiro_router
from routers.ordem_servico import api_router as ordem_servico_router
from routers.fuel_supply import api_router as fuel_supply_router
from routers.loading_orders import api_router as loading_orders_router
from routers.locations import api_router as locations_router
from routers.expense_reports import api_router as expense_reports_router
from routers.users import api_router as users_router
from routers.module_config import api_router as module_config_router

app = FastAPI()


@app.middleware("http")
async def module_gate_middleware(request: Request, call_next):
    """Bloqueia no backend o acesso a módulos que o cliente ainda não
    contratou - complementa o menu escondido no frontend, que sozinho não
    impede alguém de chamar a rota da API direto."""
    if request.method != "OPTIONS":
        module_key = match_module_for_path(request.url.path)
        if module_key:
            disabled = await get_disabled_modules()
            if is_module_disabled(module_key, disabled):
                return JSONResponse(status_code=403, content={"detail": "Este módulo não está disponível no seu plano atual"})
    return await call_next(request)
api_router = APIRouter(prefix="/api")

# Montar diretório de uploads para servir arquivos estáticos via /api/uploads
app.mount("/api/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")


@api_router.get("/")
async def root():
    return {"message": "ContainerLogix API"}


app.include_router(api_router)
app.include_router(auth_router)
app.include_router(cadastros_router)
app.include_router(movements_router)
app.include_router(invoices_router)
app.include_router(photo_registries_router)
app.include_router(container_inspections_router)
app.include_router(flex_tank_router)
app.include_router(frota_router)
app.include_router(loading_schedule_router)
app.include_router(daily_rate_router)
app.include_router(delivery_status_router)
app.include_router(unit_segregation_router)
app.include_router(intl_invoices_router)
app.include_router(rpa_terceiro_router)
app.include_router(ordem_servico_router)
app.include_router(fuel_supply_router)
app.include_router(loading_orders_router)
app.include_router(locations_router)
app.include_router(expense_reports_router)
app.include_router(users_router)
app.include_router(module_config_router)

# WebSocket endpoint para sincronização em tempo real
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: Optional[str] = None):
    # O feed em tempo real transmite dados operacionais (motorista, contêiner,
    # cliente) a cada movimentação — precisa do mesmo token JWT usado na API,
    # passado por query string já que o WebSocket do navegador não permite
    # cabeçalhos customizados no handshake.
    if not token:
        await websocket.close(code=1008)
        return
    try:
        payload = decode_token(token)
    except HTTPException:
        await websocket.close(code=1008)
        return

    # Confirma que o usuário do token ainda existe - decode_token só valida a
    # assinatura/expiração, então um usuário removido continuava recebendo
    # eventos em tempo real até o token expirar sozinho (até 7 dias). Mesma
    # proteção que get_current_active_user já aplica ao resto da API.
    user_doc = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0, "id": 1, "active": 1})
    if not user_doc or user_doc.get('active') is False:
        await websocket.close(code=1008)
        return

    await manager.connect(websocket)
    try:
        while True:
            # Mantém a conexão aberta e escuta mensagens (ping/pong)
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

_cors_origins_raw = os.environ.get('CORS_ORIGINS', '').strip()
if _cors_origins_raw:
    _cors_origins = [origin.strip() for origin in _cors_origins_raw.split(',') if origin.strip()]
else:
    # Sem CORS_ORIGINS configurada, não liberamos '*': com allow_credentials=True isso faz
    # o Starlette refletir qualquer origem da requisição, permitindo que qualquer site
    # faça requisições autenticadas ao backend. Melhor bloquear tudo e forçar configuração explícita.
    logging.warning("CORS_ORIGINS não configurada - nenhuma origem cross-origin será permitida")
    _cors_origins = []

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def startup_event():
    # Inicializar contador de transaction_id se não existir
    counter = await db.counters.find_one({"_id": "transaction_id"})
    if not counter:
        # Buscar o maior transaction_id existente
        last_movement = await db.movements.find_one({}, {"_id": 0, "transaction_id": 1}, sort=[("transaction_id", -1)])
        max_id = last_movement.get('transaction_id', 0) if last_movement else 0
        await db.counters.insert_one({"_id": "transaction_id", "seq": max_id})

    # Mesma inicialização para os demais contadores que passaram a usar incremento
    # atômico (antes usavam find_one(sort=...)+1, que permitia duas criações
    # concorrentes gerarem o mesmo número) - semeia a partir do maior valor já
    # existente na coleção para não colidir com registros antigos.
    async def _seed_counter(counter_id: str, collection, field: str, query: dict = None):
        if await db.counters.find_one({"_id": counter_id}):
            return
        last_doc = await collection.find_one(query or {}, {"_id": 0, field: 1}, sort=[(field, -1)])
        max_val = (last_doc.get(field) or 0) if last_doc else 0
        await db.counters.insert_one({"_id": counter_id, "seq": max_val})

    await _seed_counter("status_number", db.delivery_statuses, "status_number")
    await _seed_counter("segregation_number", db.unit_segregations, "segregation_number")
    await _seed_counter("os_number", db.ordem_servico, "os_number")
    # "terceiro" primeiro e com query que também cobre RPAs legados sem rpa_type
    # gravado (contavam como "terceiro" na busca antiga) - precisa rodar antes do
    # loop abaixo para não ser pulado por já existir com um valor incompleto.
    await _seed_counter(
        "rpa_number:terceiro", db.rpa_terceiro, "rpa_number",
        {"$or": [{"rpa_type": "terceiro"}, {"rpa_type": {"$exists": False}}]}
    )
    for existing_rpa_type in await db.rpa_terceiro.distinct("rpa_type"):
        if existing_rpa_type == "terceiro":
            continue
        await _seed_counter(
            f"rpa_number:{existing_rpa_type}", db.rpa_terceiro, "rpa_number", {"rpa_type": existing_rpa_type}
        )

    # Índices para os campos mais consultados — sem eles, toda busca por e-mail,
    # contêiner ou data faz varredura completa da coleção, e isso fica cada vez
    # mais lento conforme a base cresce. create_index é idempotente, então é
    # seguro rodar isso a cada início do processo.
    try:
        await db.users.create_index("email", unique=True)
    except Exception as e:
        # Se já existirem e-mails duplicados na base, o índice único falha —
        # não pode travar o startup do sistema por causa disso.
        logger.warning(f"Não foi possível criar índice único em users.email (pode haver e-mails duplicados na base): {e}")
    # Consultado em toda requisição autenticada (get_current_active_user /
    # get_current_admin_user checam se o usuário do token ainda existe).
    await db.users.create_index("id")
    await db.movements.create_index("container_number")
    await db.movements.create_index("created_at")
    await db.movements.create_index("transaction_id")
    await db.movements.create_index([("operation_type", 1), ("created_at", -1)])
    await db.drivers.create_index("cpf")
    await db.clients.create_index("cnpj")
    await db.transport_companies.create_index("cnpj")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
