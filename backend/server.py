from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from dotenv import load_dotenv

# Carregar variáveis de ambiente ANTES de qualquer outra importação
load_dotenv()

from starlette.middleware.cors import CORSMiddleware
import asyncio
from contextlib import asynccontextmanager
import os
import logging
from datetime import datetime, timezone
from typing import Optional

from shared import (
    db, client, manager, UPLOADS_DIR,
    get_disabled_modules, match_module_for_path, is_module_disabled, session_is_current,
    rate_limit_rule, rate_limit_exceeded, client_ip, RATE_LIMIT_MESSAGE, get_company_settings,
)
from auth import decode_token, FILE_TOKEN_SCOPE

from routers.auth import api_router as auth_router
from routers.cadastros import api_router as cadastros_router
from routers.movements import api_router as movements_router
from routers.dashboard import api_router as dashboard_router
from routers.yard_control import api_router as yard_control_router
from routers.movement_reports import api_router as movement_reports_router
from routers.invoices import api_router as invoices_router
from routers.container_inspections import api_router as container_inspections_router
from routers.container_repair_services import api_router as container_repair_services_router
from routers.container_vistorias import api_router as container_vistorias_router
from routers.container_audits import api_router as container_audits_router
from routers.commercial import api_router as commercial_router
from routers.commissions import api_router as commissions_router
from routers.flex_tank import api_router as flex_tank_router
from routers.frota import api_router as frota_router
from routers.loading_schedule import api_router as loading_schedule_router
from routers.daily_rate import api_router as daily_rate_router
from routers.checks import api_router as checks_router
from routers.repair_estimates import api_router as repair_estimates_router
from routers.receivables import api_router as receivables_router
from routers.financial_reports import api_router as financial_reports_router
from routers.container_reports import api_router as container_reports_router
from routers.freight_reports import api_router as freight_reports_router
from routers.photo_record_reports import api_router as photo_record_reports_router
from routers.fleet_reports import api_router as fleet_reports_router
from routers.delivery_reports import api_router as delivery_reports_router
from routers.client_credits import api_router as client_credits_router
from routers.financial_summary import api_router as financial_summary_router
from routers.delivery_status import api_router as delivery_status_router
from routers.port_services import api_router as port_services_router
from routers.vehicle_results import api_router as vehicle_results_router
from routers.unit_segregation import api_router as unit_segregation_router
from routers.intl_invoices import api_router as intl_invoices_router
from routers.rpa_terceiro import api_router as rpa_terceiro_router
from routers.ordem_servico import api_router as ordem_servico_router
from routers.fuel_supply import api_router as fuel_supply_router
from routers.loading_orders import api_router as loading_orders_router
from routers.freight_routes import api_router as freight_routes_router
from routers.freight_payments import api_router as freight_payments_router
from routers.gratifications import api_router as gratifications_router
from routers.service_providers import api_router as service_providers_router
from routers.login_notices import api_router as login_notices_router
from routers.hr import api_router as hr_router
from routers.payroll import api_router as payroll_router
from routers.container_representatives import api_router as container_representatives_router
from routers.container_purchases import api_router as container_purchases_router
from routers.container_sales import api_router as container_sales_router
from routers.locations import api_router as locations_router
from routers.lookup import api_router as lookup_router
from routers.stock import api_router as stock_router
from routers.epi_deliveries import api_router as epi_deliveries_router
from routers.expense_reports import api_router as expense_reports_router
from routers.users import api_router as users_router
from routers.audit_log import api_router as audit_log_router
from routers.module_config import api_router as module_config_router
from routers.platform import api_router as platform_router
from routers.fiscal import api_router as fiscal_router
from routers.mdfe import api_router as mdfe_router
from scheduled_reports import api_router as scheduled_reports_router, start_scheduler, stop_scheduler
from tenancy import (
    NoTenantError, TENANT_HEADER, TENANT_HOST_HEADER, active_tenants, current_tenant, directory, is_multi_tenant,
    reset_current_tenant,
    set_current_tenant, tenant_context,
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Tudo que o processo prepara ao subir e libera ao encerrar fica aqui
    (antes: @app.on_event, que o FastAPI marcou como obsoleto, mais a criação
    da pasta de uploads escondida na importação de shared.py)."""
    UPLOADS_DIR.mkdir(exist_ok=True)
    await startup_event()
    yield
    stop_scheduler()
    client.close()


app = FastAPI(lifespan=lifespan)


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


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """Limite geral de requisições (ver rate_limit_rule em shared.py), por
    usuário logado ou, sem login válido, por IP."""
    rule = rate_limit_rule(request.method, request.url.path)
    if rule:
        bucket, limit, window = rule
        who = f"ip:{client_ip(request)}"
        authorization = request.headers.get("authorization", "")
        if authorization.lower().startswith("bearer "):
            try:
                who = f"user:{decode_token(authorization[7:].strip())['sub']}"
            except Exception:
                pass  # token inválido: a rota recusa depois, aqui conta pelo IP
        if rate_limit_exceeded(f"{bucket}:{who}", limit, window):
            return JSONResponse(status_code=429, content={"detail": RATE_LIMIT_MESSAGE})
    return await call_next(request)


# Rotas que respondem sem empresa: verificação de saúde do Render e a
# documentação da API (não tocam em banco de empresa nenhuma).
_TENANTLESS_PATHS = {"/api/", "/api", "/openapi.json", "/docs", "/redoc", "/docs/oauth2-redirect"}


async def resolve_request_tenant(request: Request):
    """Multi-cliente: descobre a empresa da requisição.
    - Com login: a empresa vem do token ("tid"). Se o navegador disser outra
      (cabeçalho X-Tenant / X-Tenant-Host), recusa.
    - Sem login (tela de entrar, esqueci a senha): a do cabeçalho.
    Devolve (empresa, None) ou (None, resposta de erro)."""
    token = None
    authorization = request.headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    token = token or request.query_params.get("token")
    token_tid = None
    if token:
        try:
            token_tid = decode_token(token).get("tid")
        except HTTPException:
            token_tid = None  # token inválido: a própria rota recusa depois

    directory_ = directory()
    # ?tenant= vale como o cabeçalho: um <img> não manda cabeçalhos (logo
    # da empresa na tela de login, antes de existir token)
    header_slug = request.headers.get(TENANT_HEADER) or request.query_params.get("tenant")
    header_host = request.headers.get(TENANT_HOST_HEADER)
    header_tenant = None
    if header_slug:
        header_tenant = await directory_.by_slug(header_slug)
    elif header_host:
        header_tenant = await directory_.by_host(header_host)
    if (header_slug or header_host) and header_tenant is None:
        return None, JSONResponse(status_code=404, content={"detail": "Empresa não encontrada"})

    if token_tid:
        tenant = await directory_.by_slug(token_tid)
        if tenant is None:
            return None, JSONResponse(status_code=401, content={"detail": "Sessão inválida: empresa não encontrada. Entre novamente."})
        if header_tenant is not None and header_tenant["slug"] != tenant["slug"]:
            return None, JSONResponse(status_code=403, content={"detail": "Este acesso pertence a outra empresa. Entre novamente."})
    else:
        tenant = header_tenant
    if tenant is None:
        return None, JSONResponse(status_code=400, content={"detail": "Empresa não identificada"})
    if tenant.get("status") != "ATIVO":
        return None, JSONResponse(status_code=403, content={"detail": "O acesso desta empresa está suspenso. Fale com o suporte."})
    return tenant, None


@app.middleware("http")
async def tenant_middleware(request: Request, call_next):
    """Multi-cliente (MULTI_TENANT): define a empresa antes de qualquer outra
    coisa - o bloqueio de módulos e o limite de requisições já rodam no banco
    dela. Desligado, não faz nada."""
    path = request.url.path
    if (not is_multi_tenant() or request.method == "OPTIONS" or path in _TENANTLESS_PATHS
            or not path.startswith("/api/")):
        return await call_next(request)
    tenant, error = await resolve_request_tenant(request)
    if error is not None:
        return error
    context_token = set_current_tenant(tenant)
    try:
        return await call_next(request)
    except NoTenantError:
        logger.exception("Acesso ao banco sem empresa definida")
        return JSONResponse(status_code=500, content={"detail": "Erro interno"})
    finally:
        reset_current_tenant(context_token)


api_router = APIRouter(prefix="/api")

# Pastas de anexos que exigem login mesmo com UPLOADS_REQUIRE_AUTH desligado:
# recibos da Prestação de Contas (financeiro, só administradores).
_PROTECTED_UPLOAD_PREFIXES = {"expense_reports/": "admin"}
# Com UPLOADS_REQUIRE_AUTH=true, TODO anexo exige login. Fica desligado por
# padrão porque versões já instaladas do app (APK, abas antigas) pedem as
# fotos sem token - ligar só depois de todas estarem atualizadas.
_UPLOADS_REQUIRE_AUTH = os.environ.get('UPLOADS_REQUIRE_AUTH', '').strip().lower() in ('1', 'true', 'yes', 'sim')


async def _authorize_upload_request(request: Request, token: Optional[str], required_role: Optional[str]):
    """Aceita o token de arquivos na URL (?token=) ou o token de sessão no
    cabeçalho Authorization, e confere a conta como qualquer rota da API."""
    header = request.headers.get("authorization", "")
    raw_token = token or (header[7:] if header.lower().startswith("bearer ") else None)
    if not raw_token:
        raise HTTPException(status_code=401, detail="Faça login para acessar este arquivo")
    payload = decode_token(raw_token)
    user_doc = await db.users.find_one(
        {"id": payload.get("sub")}, {"_id": 0, "id": 1, "active": 1, "password_version": 1, "role": 1}
    )
    if not user_doc or user_doc.get('active') is False or not session_is_current(payload, user_doc):
        raise HTTPException(status_code=401, detail="Sessão inválida ou encerrada")
    if required_role and user_doc.get('role') != required_role:
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")


@app.api_route("/api/uploads/{file_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def serve_upload(file_path: str, request: Request, token: Optional[str] = None):
    """Entrega os anexos enviados ao sistema. Antes era uma pasta estática
    pública: quem tivesse a URL de um recibo abria sem login."""
    uploads_root = UPLOADS_DIR.resolve()
    target = (UPLOADS_DIR / file_path).resolve()
    if uploads_root not in target.parents or not target.is_file():
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")

    relative = target.relative_to(uploads_root).as_posix()
    required_role = next(
        (role for prefix, role in _PROTECTED_UPLOAD_PREFIXES.items() if relative.startswith(prefix)), None
    )
    if required_role or _UPLOADS_REQUIRE_AUTH:
        await _authorize_upload_request(request, token, required_role)
    # Vary: Origin - a mesma URL é pedida pelo <img> da tela (sem CORS) e pelo
    # botão de baixar (fetch, com CORS). Sem isso o navegador servia ao fetch a
    # resposta do <img> guardada no cache, sem Access-Control-Allow-Origin.
    return FileResponse(target, headers={"Vary": "Origin"})


@api_router.get("/")
async def root():
    return {"message": "ContainerLogix API"}


@api_router.get("/tenant-info")
async def tenant_info():
    """Tela de login (sem login): de qual empresa é este endereço, com o nome
    e o logo dela. Com MULTI_TENANT e endereço desconhecido, o tenant_middleware
    já responde 400/404 - a tela então pede o "Código da empresa"."""
    company = await get_company_settings()
    tenant = current_tenant()
    return {
        "multi_tenant": is_multi_tenant(),
        "slug": tenant["slug"] if tenant else None,
        "name": company.get("name") or (tenant["name"] if tenant else None),
        "logo_filename": company.get("logo_filename"),
    }


app.include_router(api_router)
app.include_router(auth_router)
app.include_router(cadastros_router)
app.include_router(movements_router)
app.include_router(dashboard_router)
app.include_router(yard_control_router)
app.include_router(movement_reports_router)
app.include_router(invoices_router)
app.include_router(container_inspections_router)
app.include_router(container_repair_services_router)
app.include_router(container_vistorias_router)
app.include_router(container_audits_router)
app.include_router(commercial_router)
app.include_router(commissions_router)
app.include_router(flex_tank_router)
app.include_router(frota_router)
app.include_router(loading_schedule_router)
app.include_router(daily_rate_router)
app.include_router(checks_router)
app.include_router(repair_estimates_router)
app.include_router(receivables_router)
app.include_router(financial_reports_router)
app.include_router(container_reports_router)
app.include_router(freight_reports_router)
app.include_router(photo_record_reports_router)
app.include_router(fleet_reports_router)
app.include_router(delivery_reports_router)
app.include_router(client_credits_router)
app.include_router(financial_summary_router)
app.include_router(delivery_status_router)
app.include_router(port_services_router)
app.include_router(vehicle_results_router)
app.include_router(unit_segregation_router)
app.include_router(intl_invoices_router)
app.include_router(rpa_terceiro_router)
app.include_router(ordem_servico_router)
app.include_router(fuel_supply_router)
app.include_router(loading_orders_router)
app.include_router(freight_routes_router)
app.include_router(freight_payments_router)
app.include_router(gratifications_router)
app.include_router(service_providers_router)
app.include_router(login_notices_router)
app.include_router(hr_router)
app.include_router(payroll_router)
app.include_router(container_representatives_router)
app.include_router(container_purchases_router)
app.include_router(container_sales_router)
app.include_router(locations_router)
app.include_router(lookup_router)
app.include_router(stock_router)
app.include_router(epi_deliveries_router)
app.include_router(expense_reports_router)
app.include_router(users_router)
app.include_router(audit_log_router)
app.include_router(module_config_router)
app.include_router(platform_router)
app.include_router(fiscal_router)
app.include_router(mdfe_router)
app.include_router(scheduled_reports_router)

_WS_RECHECK_SECONDS = 60
# O feed em tempo real só transmite eventos de movimentação - mesmo módulo
# que o module_gate_middleware exige pra /api/movements.
_WS_MODULE_KEY = "terminal.movimentacoes"


async def _ws_session_valid(payload: dict) -> bool:
    """Mesmas condições que a API HTTP exige a cada requisição: token ainda
    dentro da validade, usuário existente e ativo (get_current_active_user) e
    módulo de Movimentações liberado (module_gate_middleware)."""
    exp = payload.get("exp")
    if exp is not None and datetime.now(timezone.utc).timestamp() >= exp:
        return False
    user_doc = await db.users.find_one(
        {"id": payload.get("sub")}, {"_id": 0, "id": 1, "active": 1, "password_version": 1}
    )
    if not user_doc or user_doc.get('active') is False or not session_is_current(payload, user_doc):
        return False
    return not is_module_disabled(_WS_MODULE_KEY, await get_disabled_modules())


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
    if payload.get("scope") == FILE_TOKEN_SCOPE:
        await websocket.close(code=1008)
        return

    # Multi-cliente: a conexão inteira roda no banco da empresa do token
    if is_multi_tenant():
        tenant = await directory().by_slug(payload.get("tid") or "")
        if tenant is None or tenant.get("status") != "ATIVO":
            await websocket.close(code=1008)
            return
        set_current_tenant(tenant)

    if not await _ws_session_valid(payload):
        await websocket.close(code=1008)
        return

    await manager.connect(websocket)
    try:
        while True:
            # Mantém a conexão aberta e escuta mensagens (ping/pong). A sessão
            # é revalidada a cada mensagem recebida (o frontend manda um ping
            # a cada 30s) e, sem mensagem nenhuma, a cada _WS_RECHECK_SECONDS -
            # antes só o handshake checava, e a conexão seguia recebendo
            # eventos depois de o token expirar ou a conta ser desativada.
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=_WS_RECHECK_SECONDS)
            except asyncio.TimeoutError:
                data = None
            if not await _ws_session_valid(payload):
                manager.disconnect(websocket)
                await websocket.close(code=1008)
                return
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

# Multi-cliente: cada empresa abre o sistema pelo próprio subdomínio
# (ja.containerlogix.com.br, tll...). Em vez de listar um por um, uma
# expressão, ex.: ^https://([a-z0-9-]+\.)?containerlogix\.com\.br$
_cors_origin_regex = os.environ.get('CORS_ORIGIN_REGEX', '').strip() or None

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_cors_origins,
    allow_origin_regex=_cors_origin_regex,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def startup_event():
    """Prepara o banco (contadores, índices) e liga o agendador. Com
    MULTI_TENANT, prepara o banco de cada empresa ativa; uma empresa com
    problema não impede as outras de subir."""
    if is_multi_tenant():
        for tenant in await active_tenants():
            with tenant_context(tenant):
                try:
                    await prepare_database()
                except Exception:
                    logger.exception(f"Falha ao preparar o banco da empresa {tenant['slug']}")
    else:
        await prepare_database()
    start_scheduler()


async def prepare_database():
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
    await _seed_counter("port_service_number", db.port_services, "service_number")
    await _seed_counter("port_service_billing_batch_number", db.port_service_billing_batches, "batch_number")
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

    # Log de auditoria (audit.py): consultas por data, usuário e registro, e
    # limpeza automática do que passar do prazo de guarda (padrão: 2 anos).
    try:
        retention_days = int(os.environ.get("AUDIT_LOG_RETENTION_DAYS", "730"))
        await db.audit_log.create_index("at", expireAfterSeconds=retention_days * 86400)
        await db.audit_log.create_index([("user_id", 1), ("at", -1)])
        await db.audit_log.create_index("doc_id")
        await db.audit_log.create_index("id")
    except Exception as e:
        logger.warning(f"Não foi possível criar os índices do log de auditoria: {e}")

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
    # Consultado a cada ciclo do polling de fallback (/movements/sync-state).
    await db.movements.create_index("updated_at", sparse=True)
    # Reserva temporária usada por _container_movement_lock (movements.py) -
    # o TTL libera sozinho uma reserva que ficou presa por queda do processo.
    await db.movement_locks.create_index("created_at", expireAfterSeconds=60)
    # Busca por "id" (o identificador da aplicação, não o _id do Mongo) é a
    # consulta mais comum de detalhe/edição/exclusão nessas coleções.
    for collection_name in (
        "movements", "invoices", "products", "stock_movements", "stock_entries",
        "fuel_supplies", "fuel_supply_orders", "checks", "repair_estimates", "client_credit_entries", "gratifications",
        "service_provider_entries", "service_provider_advances", "service_provider_closings", "login_notices",
        "hr_contracts", "hr_payslips", "hr_payroll_runs", "hr_vacations", "hr_occurrences", "hr_documents", "hr_time_bank",
    ):
        await db[collection_name].create_index("id")
    # Crédito de Cliente: um saldo por cliente (a baixa usa $inc condicionado
    # nele - dois documentos do mesmo cliente furariam essa trava).
    try:
        await db.client_credit_accounts.create_index("client_id", unique=True)
    except Exception as e:
        logger.warning(f"Não foi possível criar índice único em client_credit_accounts.client_id: {e}")
    await db.client_credit_entries.create_index([("client_id", 1), ("entry_date", 1), ("entry_number", 1)])
    await db.client_credit_entries.create_index("invoice_id", sparse=True)
    # Controle de Média km/L: abastecimentos de vários veículos em ordem cronológica.
    await db.fuel_supplies.create_index([("equipment_id", 1), ("supply_date", 1), ("created_at", 1)])
    # Lista paginada do Abastecimento: mais recente primeiro, com filtro por período.
    await db.fuel_supplies.create_index("supply_number")
    await db.fuel_supplies.create_index("supply_date")
    await db.drivers.create_index("cpf")
    await db.clients.create_index("cnpj")
    await db.transport_companies.create_index("cnpj")
    try:
        await db.container_repair_services.create_index("name", unique=True)
    except Exception as e:
        logger.warning(f"Não foi possível criar índice único em container_repair_services.name: {e}")
    try:
        await db.freight_payments.create_index("loading_order_id", unique=True)
    except Exception as e:
        # Trava de segurança contra corrida na checagem de idempotência do
        # lançamento automático de Pagamento Frete - não pode travar o
        # startup do sistema por causa disso.
        logger.warning(f"Não foi possível criar índice único em freight_payments.loading_order_id: {e}")
    try:
        # Trava de segurança contra corrida na checagem de idempotência da
        # movimentação de estoque automática da Ordem de Carregamento.
        # partialFilterExpression precisa ser {"$type": "string"}, não
        # {"$exists": true} - toda movimentação manual grava
        # loading_order_id=null explicitamente (o campo nunca fica
        # ausente), e {"$exists": true} trataria todo esse null como valor
        # igual, quebrando a Emissão de EIR normal (mesmo container tendo
        # várias movimentações na vida, todas com loading_order_id: null).
        await db.movements.create_index(
            [("loading_order_id", 1), ("container_number", 1)],
            unique=True,
            partialFilterExpression={"loading_order_id": {"$type": "string"}},
        )
    except Exception as e:
        logger.warning(f"Não foi possível criar índice único em movements.(loading_order_id, container_number): {e}")

    await db.container_purchases.create_index("container_number")
    await db.container_sales.create_index("container_number")
    await db.container_vistorias.create_index("container_number")
    await db.container_vistorias.create_index("created_at")
    try:
        await db.container_purchases.create_index(
            [("loading_order_id", 1), ("container_number", 1)],
            unique=True,
            partialFilterExpression={"loading_order_id": {"$type": "string"}},
        )
    except Exception as e:
        logger.warning(f"Não foi possível criar índice único em container_purchases.(loading_order_id, container_number): {e}")
    try:
        await db.container_sales.create_index(
            [("loading_order_id", 1), ("container_number", 1)],
            unique=True,
            partialFilterExpression={"loading_order_id": {"$type": "string"}},
        )
    except Exception as e:
        logger.warning(f"Não foi possível criar índice único em container_sales.(loading_order_id, container_number): {e}")


