"""
Infraestrutura compartilhada entre os módulos de routers/ - conexão com o
banco, helpers usados por múltiplos domínios, e o gerenciador de conexões do
WebSocket. Extraído de server.py (que concentrava tudo isso junto com as ~170
rotas da API) para permitir dividir os endpoints em módulos por domínio sem
criar import circular: server.py e todos os routers importam daqui.
"""
from datetime import datetime, timezone
from pathlib import Path
from typing import List
import io
import os
import time
import uuid
from collections import defaultdict

from fastapi import Depends, HTTPException, Request, UploadFile, WebSocket, status
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

from auth import get_current_user

# Rate limiting simples em memória para login e recuperação de senha - protege contra
# força bruta de senha e contra o endpoint de "esqueci minha senha" sendo usado para
# spam de email em massa. Chaveado por IP e por email/conta para cobrir os dois cenários.
_rate_limit_attempts: dict = defaultdict(list)


def check_rate_limit(key: str, limit: int, window_seconds: int):
    """Levanta 429 se 'key' já tiver 'limit' tentativas dentro de 'window_seconds'."""
    now = time.time()
    attempts = _rate_limit_attempts[key]
    attempts[:] = [t for t in attempts if now - t < window_seconds]
    if len(attempts) >= limit:
        raise HTTPException(
            status_code=429,
            detail="Muitas tentativas. Aguarde alguns minutos antes de tentar novamente."
        )
    attempts.append(now)


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


# Helper function to parse datetime from MongoDB (handles both string and datetime objects)
def parse_datetime_value(dt_value):
    """Parse datetime from string or return datetime directly - always timezone-aware"""
    if isinstance(dt_value, datetime):
        # Se não tem timezone, assume UTC
        if dt_value.tzinfo is None:
            return dt_value.replace(tzinfo=timezone.utc)
        return dt_value
    if isinstance(dt_value, str):
        parsed = datetime.fromisoformat(dt_value.replace('Z', '+00:00'))
        # Se não tem timezone, assume UTC
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    return datetime.now(timezone.utc)


# Helper function to round monetary values to 2 decimal places
def round_money(value):
    """Round monetary value to 2 decimal places to avoid floating point precision issues"""
    if value is None:
        return None
    return round(float(value), 2)


def migrate_inspection_photos(inspection: dict) -> dict:
    """Converte vistorias antigas (photo_front/back/left/right/internal) para o formato de lista 'photos'"""
    from models import CONTAINER_INSPECTION_PHOTO_TYPES
    if inspection.get("photos"):
        return inspection
    legacy_photos = []
    for photo_type in CONTAINER_INSPECTION_PHOTO_TYPES:
        url = inspection.get(f"photo_{photo_type}")
        if url:
            legacy_photos.append({"id": str(uuid.uuid4()), "type": photo_type, "url": url})
    inspection["photos"] = legacy_photos
    return inspection


ROOT_DIR = Path(__file__).parent
UPLOADS_DIR = ROOT_DIR.parent / 'uploads'
UPLOADS_DIR.mkdir(exist_ok=True)
LOGO_PATH = ROOT_DIR / 'assets' / 'logo.png'


def load_logo_buffer(company: dict = None):
    """Lê o logo local (sem depender de internet - importante no app desktop offline).
    Prioriza o logo enviado pelo usuário em 'Dados da Empresa'; senão usa o logo padrão do sistema."""
    try:
        if company and company.get('logo_filename'):
            uploaded_path = UPLOADS_DIR / company['logo_filename']
            if uploaded_path.exists():
                return io.BytesIO(uploaded_path.read_bytes())
        if LOGO_PATH.exists():
            return io.BytesIO(LOGO_PATH.read_bytes())
    except Exception:
        pass
    return None


load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]


async def get_current_active_user(current_user: dict = Depends(get_current_user)) -> dict:
    """Confirma que o usuário do token ainda existe na base. Sem isso, apagar um
    usuário (ex: funcionário desligado) não revoga o acesso dele até o token
    expirar sozinho (até 7 dias) — o token continuava sendo aceito só por
    decodificar certo, sem checar se a conta por trás dele ainda existe."""
    user_doc = await db.users.find_one({"id": current_user['sub']}, {"_id": 0, "id": 1, "active": 1})
    if not user_doc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário não encontrado ou removido",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if user_doc.get('active') is False:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Acesso desativado por um administrador",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return current_user


async def get_current_admin_user(current_user: dict = Depends(get_current_user)) -> dict:
    """Dependência para endpoints restritos ao perfil admin (módulo Financeiro).
    Também confirma que o usuário ainda existe, pela mesma razão de get_current_active_user."""
    user_doc = await db.users.find_one({"id": current_user['sub']}, {"_id": 0, "role": 1, "active": 1})
    if not user_doc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário não encontrado ou removido",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if user_doc.get('active') is False:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Acesso desativado por um administrador",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if user_doc.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")
    return current_user


async def get_current_superadmin_user(current_user: dict = Depends(get_current_user)) -> dict:
    """Dependência para endpoints restritos ao dono do sistema (ex: liberar/bloquear
    módulos contratados por um cliente). is_superadmin nunca é exposto em nenhum
    endpoint de edição de usuário - só pode ser setado direto no banco - então
    o admin comum de um cliente nunca consegue se autopromover a isso."""
    user_doc = await db.users.find_one({"id": current_user['sub']}, {"_id": 0, "is_superadmin": 1, "active": 1})
    if not user_doc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário não encontrado ou removido",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if user_doc.get('active') is False:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Acesso desativado por um administrador",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user_doc.get('is_superadmin'):
        raise HTTPException(status_code=403, detail="Acesso restrito ao proprietário do sistema")
    return current_user


# WebSocket connection manager para sincronização em tempo real
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        """Envia mensagem para todos os clientes conectados"""
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)

        # Remove conexões que falharam
        for conn in disconnected:
            self.disconnect(conn)


manager = ConnectionManager()


async def get_company_settings() -> dict:
    """Retorna os dados cadastrados em 'Dados da Empresa', ou {} se ainda não configurado."""
    settings = await db.company_settings.find_one({}, {"_id": 0})
    return settings or {}


# Função para obter próximo transaction_id (sequencial, nunca reutiliza)
async def get_next_transaction_id():
    """Obtém o próximo transaction_id usando um contador atômico"""
    result = await db.counters.find_one_and_update(
        {"_id": "transaction_id"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    return result["seq"]


# Upload de fotos de containers
ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp'}
ALLOWED_RECEIPT_EXTENSIONS = ALLOWED_EXTENSIONS | {'.pdf'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


async def validate_and_read_upload(file: UploadFile, allowed_extensions: set) -> tuple[str, bytes]:
    """Valida extensão e tamanho de um arquivo enviado e retorna (extensão, conteúdo).
    Centraliza a validação que antes só existia no endpoint /upload genérico -
    os endpoints de foto de vistoria e de recibo aceitavam qualquer extensão/tamanho."""
    file_ext = Path(file.filename).suffix.lower() if file.filename else ''
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Tipo de arquivo não permitido. Use: {', '.join(sorted(allowed_extensions))}"
        )
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Arquivo muito grande. Máximo: {MAX_FILE_SIZE // (1024*1024)}MB"
        )
    return file_ext, content


# ==================== MÓDULOS CONTRATADOS ====================
# Cada instância (um cliente) pode ter grupos ou itens específicos do menu
# desativados até o cliente contratar aquele serviço. A chave de um item é
# "<grupo>.<item>" - desativar só o grupo ("terminal") bloqueia tudo dentro
# dele de uma vez, sem precisar listar item por item.
MODULE_CATALOG = [
    {"key": "terminal", "label": "Terminal", "items": [
        {"key": "terminal.vistoria", "label": "Vistoria de Container"},
        {"key": "terminal.movimentacoes", "label": "Movimentações"},
        {"key": "terminal.flex_tank", "label": "Flex Tank"},
    ]},
    {"key": "frota", "label": "Manutenção", "items": [
        {"key": "frota.veiculos", "label": "Cadastro de Veículos"},
        {"key": "frota.revisao", "label": "Controle de Revisão"},
        {"key": "frota.ordem_servico", "label": "Ordem de Serviço"},
        {"key": "frota.checklist", "label": "Checklist"},
        {"key": "frota.abastecimento", "label": "Abastecimento"},
    ]},
    {"key": "cadastro", "label": "Cadastro", "items": [
        {"key": "cadastro.pessoas", "label": "Pessoas"},
        {"key": "cadastro.transportadora", "label": "Transportadora"},
        {"key": "cadastro.cliente", "label": "Cliente"},
        {"key": "cadastro.fornecedor", "label": "Fornecedor"},
        {"key": "cadastro.armador", "label": "Armador"},
        {"key": "cadastro.tipos_servico", "label": "Tipos de Serviço"},
    ]},
    {"key": "financeiro", "label": "Financeiro", "items": [
        {"key": "financeiro.faturas", "label": "Faturas"},
        {"key": "financeiro.invoice_internacional", "label": "Invoice Internacional"},
        {"key": "financeiro.relatorio_faturamento", "label": "Relatório de Faturamento"},
        {"key": "financeiro.diaria", "label": "Solicitação de Diária"},
        {"key": "financeiro.prestacao_contas", "label": "Prestação de Contas"},
        {"key": "financeiro.rpa_terceiro", "label": "Contrato de Frete"},
    ]},
    {"key": "operacional", "label": "Operacional", "items": [
        {"key": "operacional.programacao_carregamento", "label": "Programação de Carregamento"},
        {"key": "operacional.status_entrega", "label": "Status de Entrega"},
    ]},
]

# Prefixo de rota da API -> chave do módulo dono dela. Usado pelo middleware
# em server.py pra bloquear no backend, não só esconder no menu (esconder no
# menu sozinho não impede alguém de chamar a rota direto).
PATH_MODULE_MAP = [
    ("/api/container-inspections", "terminal.vistoria"),
    ("/api/reports/movements", "terminal.movimentacoes"),
    ("/api/movements", "terminal.movimentacoes"),
    ("/api/yard-control", "terminal.movimentacoes"),
    ("/api/unit-segregations", "terminal.movimentacoes"),
    ("/api/check-segregation", "terminal.movimentacoes"),
    ("/api/flex-tank", "terminal.flex_tank"),
    ("/api/vehicle-revisions", "frota.revisao"),
    ("/api/vehicle-checklists", "frota.checklist"),
    ("/api/vehicles", "frota.veiculos"),
    ("/api/drivers", "cadastro.pessoas"),
    ("/api/transport-companies", "cadastro.transportadora"),
    ("/api/clients", "cadastro.cliente"),
    ("/api/suppliers", "cadastro.fornecedor"),
    ("/api/shipping-lines", "cadastro.armador"),
    ("/api/service-types", "cadastro.tipos_servico"),
    ("/api/reports/billing", "financeiro.relatorio_faturamento"),
    ("/api/invoices", "financeiro.faturas"),
    ("/api/intl-invoices", "financeiro.invoice_internacional"),
    ("/api/daily-rate-requests", "financeiro.diaria"),
    ("/api/expense-reports", "financeiro.prestacao_contas"),
    ("/api/rpa-terceiro", "financeiro.rpa_terceiro"),
    ("/api/ordem-servico", "frota.ordem_servico"),
    ("/api/fuel-supplies", "frota.abastecimento"),
    ("/api/loading-schedules", "operacional.programacao_carregamento"),
    ("/api/delivery-status", "operacional.status_entrega"),
]

_module_config_cache = {"value": None, "expires_at": 0}
_MODULE_CONFIG_CACHE_TTL = 10  # segundos - baixo o bastante pra uma mudança feita pelo superadmin valer quase na hora


async def get_disabled_modules() -> list:
    """Lê a lista de módulos desativados, com um cache curto pra não bater no
    banco em toda requisição."""
    now = time.time()
    if _module_config_cache["value"] is not None and now < _module_config_cache["expires_at"]:
        return _module_config_cache["value"]
    doc = await db.module_config.find_one({}, {"_id": 0, "disabled_modules": 1})
    disabled = (doc or {}).get("disabled_modules", [])
    _module_config_cache["value"] = disabled
    _module_config_cache["expires_at"] = now + _MODULE_CONFIG_CACHE_TTL
    return disabled


def invalidate_module_config_cache():
    _module_config_cache["value"] = None
    _module_config_cache["expires_at"] = 0


def match_module_for_path(path: str):
    for prefix, module_key in PATH_MODULE_MAP:
        if path.startswith(prefix):
            return module_key
    return None


def is_module_disabled(module_key: str, disabled_modules: list) -> bool:
    group = module_key.split(".")[0]
    return group in disabled_modules or module_key in disabled_modules
