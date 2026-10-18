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
_rate_limit_last_sweep = {"at": 0.0}
_RATE_LIMIT_SWEEP_SECONDS = 600
_RATE_LIMIT_MAX_WINDOW = 3600  # maior janela usada em qualquer regra
RATE_LIMIT_MESSAGE = "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente."


def _sweep_rate_limits(now: float):
    """Tira da memória as chaves sem tentativa recente: cada email digitado
    no login e cada usuário/IP virava uma chave que nunca saía."""
    if now - _rate_limit_last_sweep["at"] < _RATE_LIMIT_SWEEP_SECONDS:
        return
    _rate_limit_last_sweep["at"] = now
    for key in [k for k, v in _rate_limit_attempts.items() if not v or now - v[-1] >= _RATE_LIMIT_MAX_WINDOW]:
        _rate_limit_attempts.pop(key, None)


def rate_limit_exceeded(key: str, limit: int, window_seconds: int) -> bool:
    """Registra a tentativa e diz se 'key' passou de 'limit' dentro de
    'window_seconds' (a tentativa recusada não conta)."""
    now = time.time()
    _sweep_rate_limits(now)
    attempts = _rate_limit_attempts[key]
    attempts[:] = [t for t in attempts if now - t < window_seconds]
    if len(attempts) >= limit:
        return True
    attempts.append(now)
    return False


def check_rate_limit(key: str, limit: int, window_seconds: int):
    """Levanta 429 se 'key' já tiver 'limit' tentativas dentro de 'window_seconds'."""
    if rate_limit_exceeded(key, limit, window_seconds):
        raise HTTPException(status_code=429, detail=RATE_LIMIT_MESSAGE)


# Atrás do proxy do Render, request.client é o proxy: todo mundo aparecia com
# o mesmo IP e dividia o mesmo limite de login. Lá (o Render define RENDER) ou
# com TRUST_PROXY_HEADERS ligado, vale o último IP do X-Forwarded-For - o que
# o próprio proxy acrescentou (os anteriores vêm do cliente e podem ser
# inventados). Sem proxy (instalação local), o cabeçalho é ignorado.
_TRUST_PROXY_HEADERS = (
    os.environ.get('TRUST_PROXY_HEADERS', '').strip().lower() in ('1', 'true', 'yes', 'sim')
    or bool(os.environ.get('RENDER'))
)


def client_ip(request: Request) -> str:
    if _TRUST_PROXY_HEADERS:
        forwarded = [ip.strip() for ip in request.headers.get('x-forwarded-for', '').split(',') if ip.strip()]
        if forwarded:
            return forwarded[-1]
    return request.client.host if request.client else "unknown"


# Limite geral por usuário (ou IP, sem login) - além dos de login/senha.
# Folgado pra uso normal (inclusive excluir vários selecionados de uma vez),
# mas barra script em loop e geração de PDF/Excel em massa.
_EXPORT_SUFFIXES = ("/pdf", "/excel", "/xlsx", "/zip")
# EIR: o caminho é de lista, mas o download em lote pede um EIR por vez
_DOCUMENT_EXPORT_PATHS = ("/api/movements/pdf",)


def _is_report_export(path: str) -> bool:
    """Relatório de período/lista (consulta pesada) - /reports/*, */report/*,
    */ledger/* ou /<recurso>/pdf. O resto é o documento de um registro só
    (Vistoria, EIR, OS...), que o download em lote pede um por um."""
    if path in _DOCUMENT_EXPORT_PATHS:
        return False
    parts = path[len("/api/"):].split("/")
    return parts[0] == "reports" or len(parts) == 2 or any(p in ("report", "ledger") for p in parts)


def rate_limit_rule(method: str, path: str):
    """(nome do grupo, limite, janela em segundos) pra requisição, ou None."""
    if method == "OPTIONS" or not path.startswith("/api/"):
        return None
    if path.startswith(("/api/auth/login", "/api/auth/forgot-password")):
        return None  # já têm limite próprio, mais apertado
    clean = path.rstrip("/")
    if clean.endswith(_EXPORT_SUFFIXES) or "/pdf/" in path or "/excel/" in path:
        if _is_report_export(clean):
            return ("export", 30, 60)
        # Folgado pra baixar dezenas de documentos marcados numa lista
        return ("document", 300, 60)
    if method in ("POST", "PUT", "PATCH", "DELETE"):
        if "upload" in path:
            return ("upload", 120, 60)
        return ("write", 300, 60)
    return None


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
# A pasta é criada na inicialização do app (lifespan em server.py).
UPLOADS_DIR = ROOT_DIR.parent / 'uploads'
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
# tz_aware: as datas gravadas como data do Mongo (created_at/updated_at de
# vários cadastros, paid_at, released_at...) voltam com fuso UTC. Sem isso
# voltavam "sem fuso", a API as mandava sem o "+00:00" e o navegador as lia
# como hora local - tudo aparecia 3 horas adiantado.
client = AsyncIOMotorClient(mongo_url, tz_aware=True, tzinfo=timezone.utc)
db = client[os.environ['DB_NAME']]


# Quem ainda precisa trocar a senha provisória só alcança o necessário pra
# trocá-la (e o que o app carrega antes de chegar nessa tela).
_PASSWORD_CHANGE_ALLOWED_PREFIXES = ("/api/auth/", "/api/module-config")


def session_is_current(payload: dict, user_doc: dict) -> bool:
    """False quando o token foi emitido antes da última troca de senha da
    conta: trocar a senha (ou entrar com uma senha provisória) encerra as
    sessões que já estavam abertas. Cada troca soma 1 em password_version, e
    o token carrega a versão que valia quando foi emitido ("pv"). Contas que
    nunca trocaram de senha e tokens antigos (sem "pv") contam como versão 0,
    então ninguém é deslogado só por esta checagem ter passado a existir."""
    return (payload.get('pv') or 0) == (user_doc.get('password_version') or 0)


async def _load_session_user(request: Request, current_user: dict, extra_fields: dict) -> dict:
    """Checagens comuns a toda rota autenticada. O token sozinho só prova que
    foi emitido por este sistema - aqui se confirma que a conta ainda existe,
    está ativa, não trocou de senha depois de o token ser emitido e não está
    com troca de senha obrigatória pendente."""
    user_doc = await db.users.find_one(
        {"id": current_user['sub']},
        {"_id": 0, "id": 1, "active": 1, "password_version": 1, "must_change_password": 1, **extra_fields},
    )
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
    if not session_is_current(current_user, user_doc):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sessão encerrada: a senha desta conta foi alterada. Entre novamente.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if user_doc.get('must_change_password') and not request.url.path.startswith(_PASSWORD_CHANGE_ALLOWED_PREFIXES):
        raise HTTPException(status_code=403, detail="Troque sua senha provisória para continuar usando o sistema")
    return user_doc


async def get_current_active_user(request: Request, current_user: dict = Depends(get_current_user)) -> dict:
    """Dependência de toda rota autenticada - ver _load_session_user."""
    await _load_session_user(request, current_user, {})
    return current_user


async def get_current_admin_user(request: Request, current_user: dict = Depends(get_current_user)) -> dict:
    """Dependência para endpoints restritos ao perfil admin (módulo Financeiro)."""
    user_doc = await _load_session_user(request, current_user, {"role": 1})
    if user_doc.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")
    return current_user


async def get_current_superadmin_user(request: Request, current_user: dict = Depends(get_current_user)) -> dict:
    """Dependência para endpoints restritos ao dono do sistema (ex: liberar/bloquear
    módulos contratados por um cliente). is_superadmin nunca é exposto em nenhum
    endpoint de edição de usuário - só pode ser setado direto no banco - então
    o admin comum de um cliente nunca consegue se autopromover a isso."""
    user_doc = await _load_session_user(request, current_user, {"is_superadmin": 1})
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


_UPLOAD_CHUNK_SIZE = 1024 * 1024


def _content_matches_extension(content: bytes, file_ext: str) -> bool:
    """Confere a assinatura (primeiros bytes) do arquivo contra a extensão -
    a extensão sozinha é só o nome que o remetente escolheu. Extensão sem
    assinatura conhecida aqui passa sem essa conferência."""
    if file_ext in ('.jpg', '.jpeg'):
        return content.startswith(bytes.fromhex('ffd8ff'))
    if file_ext == '.png':
        return content.startswith(bytes.fromhex('89504e470d0a1a0a'))
    if file_ext == '.webp':
        return content[:4] == b'RIFF' and content[8:12] == b'WEBP'
    if file_ext == '.pdf':
        return content[:1024].lstrip().startswith(b'%PDF-')
    return True


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
    # Lê em blocos e para assim que passa do limite - antes o arquivo inteiro
    # ia pra memória antes de o tamanho ser conferido.
    chunks, size = [], 0
    while True:
        chunk = await file.read(_UPLOAD_CHUNK_SIZE)
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"Arquivo muito grande. Máximo: {MAX_FILE_SIZE // (1024*1024)}MB"
            )
        chunks.append(chunk)
    content = b''.join(chunks)
    if not _content_matches_extension(content, file_ext):
        raise HTTPException(
            status_code=400,
            detail="O conteúdo do arquivo não corresponde ao tipo indicado pela extensão"
        )
    return file_ext, content


# ==================== ASSINATURAS (Motorista / Funcionário) ====================
# A assinatura vem da tela como data URL (imagem importada ou desenhada na
# tela) e vira um PNG em uploads/signatures/. Cada assinatura nova ganha um
# arquivo novo (nunca sobrescreve), então uma Entrega de EPI que guardou o
# caminho da assinatura do dia continua imprimindo a assinatura daquele dia.
SIGNATURES_DIR = UPLOADS_DIR / 'signatures'
SIGNATURE_URL_PREFIX = '/api/uploads/signatures/'
MAX_SIGNATURE_BYTES = 3 * 1024 * 1024


def save_signature_value(kind: str, person_id: str, incoming, existing):
    """Resolve o valor de signature_url recebido no cadastro:
    - data URL de imagem -> salva como PNG e devolve o caminho novo;
    - vazio/None -> assinatura removida (None);
    - o próprio caminho que já estava salvo -> mantém;
    - qualquer outra coisa -> ignora e mantém o que já estava (a tela só
      manda data URL, vazio ou o caminho atual)."""
    if incoming is None or (isinstance(incoming, str) and not incoming.strip()):
        return None
    if not isinstance(incoming, str):
        return existing
    if not incoming.startswith('data:image/'):
        return existing
    import base64
    from PIL import Image as PILImage
    try:
        header, b64 = incoming.split(',', 1)
        raw = base64.b64decode(b64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Assinatura inválida")
    if len(raw) > MAX_SIGNATURE_BYTES:
        raise HTTPException(status_code=400, detail="Imagem da assinatura muito grande (máximo 3MB)")
    try:
        with PILImage.open(io.BytesIO(raw)) as img:
            img.load()
            img = img.convert('RGBA')
            # Reduz fotos grandes de assinatura - nos PDFs ela sai com ~3cm
            img.thumbnail((1200, 600))
            SIGNATURES_DIR.mkdir(parents=True, exist_ok=True)
            filename = f"{kind}_{person_id}_{uuid.uuid4().hex[:10]}.png"
            img.save(SIGNATURES_DIR / filename, 'PNG', optimize=True)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Não foi possível ler a imagem da assinatura")
    return SIGNATURE_URL_PREFIX + filename


def signature_file_path(url):
    """Caminho no disco de uma assinatura salva (ou None se não existir)."""
    if not url or not str(url).startswith(SIGNATURE_URL_PREFIX):
        return None
    name = Path(str(url)[len(SIGNATURE_URL_PREFIX):]).name  # sem "../"
    path = SIGNATURES_DIR / name
    return path if path.is_file() else None


# ==================== MÓDULOS CONTRATADOS ====================
# Cada instância (um cliente) pode ter grupos ou itens específicos do menu
# desativados até o cliente contratar aquele serviço. A chave de um item é
# "<grupo>.<item>" - desativar só o grupo ("terminal") bloqueia tudo dentro
# dele de uma vez, sem precisar listar item por item.
MODULE_CATALOG = [
    {"key": "terminal", "label": "Terminal", "items": [
        {"key": "terminal.vistoria", "label": "Registro Fotográfico"},
        {"key": "terminal.vistoria_container", "label": "Vistoria de Container"},
        {"key": "terminal.movimentacoes", "label": "Movimentações"},
        {"key": "terminal.flex_tank", "label": "Flex Tank"},
        {"key": "terminal.auditoria", "label": "Auditoria"},
    ]},
    {"key": "frota", "label": "Manutenção", "items": [
        {"key": "frota.veiculos", "label": "Cadastro de Veículos"},
        {"key": "frota.revisao", "label": "Controle de Revisão"},
        {"key": "frota.hodometro", "label": "Lançamento de Hodômetro"},
        {"key": "frota.ordem_servico", "label": "Ordem de Serviço"},
        {"key": "frota.cadastro_categoria", "label": "Categorias de OS"},
        {"key": "frota.checklist", "label": "Checklist de Veículo"},
        {"key": "frota.controle_media", "label": "Controle de Média"},
        {"key": "frota.relatorio_servicos", "label": "Relatório de Serviços"},
    ]},
    {"key": "abastecimento", "label": "Abastecimento", "items": [
        {"key": "frota.ordem_abastecimento", "label": "Ordem de Abastecimento"},
        {"key": "frota.abastecimento", "label": "Abastecimento"},
        {"key": "abastecimento.nivel_tanque", "label": "Nível do Tanque"},
        {"key": "frota.relatorio_abastecimento", "label": "Relatório de Abastecimento"},
        {"key": "abastecimento.configuracao_tanque", "label": "Configuração de Tanque"},
    ]},
    {"key": "cadastro", "label": "Cadastro", "items": [
        {"key": "cadastro.pessoas", "label": "Pessoas"},
        {"key": "cadastro.transportadora", "label": "Transportadora"},
        {"key": "cadastro.cliente", "label": "Cliente"},
        {"key": "cadastro.fornecedor", "label": "Fornecedor"},
        {"key": "cadastro.funcionario", "label": "Funcionário"},
        {"key": "cadastro.seguradora", "label": "Seguradora"},
        {"key": "cadastro.terminal", "label": "Terminal"},
        {"key": "cadastro.armador", "label": "Armador"},
        {"key": "cadastro.tipos_servico", "label": "Tipos de Serviço"},
        {"key": "cadastro.rota", "label": "Rota"},
    ]},
    {"key": "financeiro", "label": "Financeiro", "items": [
        {"key": "financeiro.faturas", "label": "Faturas"},
        {"key": "financeiro.invoice_internacional", "label": "Invoice Internacional"},
        {"key": "financeiro.relatorio_faturamento", "label": "Relatório de Faturamento"},
        {"key": "financeiro.diaria", "label": "Solicitação de Diária"},
        {"key": "financeiro.prestacao_contas", "label": "Prestação de Contas"},
        {"key": "financeiro.rpa_terceiro", "label": "Contrato de Frete"},
        {"key": "financeiro.pagamento_frete", "label": "Pagamento Frete"},
        {"key": "financeiro.faturamento_portuario", "label": "Faturamento Portuário"},
    ]},
    {"key": "operacional", "label": "Operacional", "items": [
        {"key": "operacional.programacao_carregamento", "label": "Programação de Carregamento"},
        {"key": "operacional.status_entrega", "label": "Status de Entrega"},
        {"key": "operacional.ordem_carregamento", "label": "Ordem de Carregamento"},
        {"key": "operacional.servico_portuario", "label": "Serviço Portuário"},
        {"key": "operacional.relatorio_servico_portuario", "label": "Relatório de Serviço Portuário"},
    ]},
    {"key": "estoque", "label": "Almoxarifado", "items": [
        {"key": "estoque.almoxarifado", "label": "Almoxarifado"},
        {"key": "estoque.familia_produto", "label": "Família de Produto"},
        {"key": "estoque.familia_servico", "label": "Família de Serviço"},
        {"key": "estoque.cadastro_servico", "label": "Cadastro de Serviço"},
        {"key": "estoque.produto", "label": "Produto"},
        {"key": "estoque.consulta", "label": "Estoque"},
        {"key": "estoque.entradas", "label": "Entradas de Estoque"},
        {"key": "estoque.movimentacao", "label": "Movimentação de Estoque"},
        {"key": "estoque.relatorio", "label": "Relatórios do Estoque"},
        {"key": "estoque.entrega_epi", "label": "Entrega de EPI's"},
    ]},
    {"key": "comercial", "label": "Comercial", "items": [
        {"key": "comercial.representante", "label": "Representante"},
        {"key": "comercial.tabela_servicos", "label": "Tabela de Serviços"},
        {"key": "comercial.vinculo_clientes", "label": "Vínculo de Clientes"},
        {"key": "comercial.proposta", "label": "Proposta Comercial"},
    ]},
    {"key": "gestao_container", "label": "Gestão de Container", "items": [
        {"key": "gestao_container.compra", "label": "Compra de Container"},
        {"key": "gestao_container.representante", "label": "Cadastro de Representantes"},
        {"key": "gestao_container.venda", "label": "Registro de Venda"},
    ]},
]

# Prefixo de rota da API -> chave do módulo dono dela. Usado pelo middleware
# em server.py pra bloquear no backend, não só esconder no menu (esconder no
# menu sozinho não impede alguém de chamar a rota direto).
PATH_MODULE_MAP = [
    ("/api/container-inspections", "terminal.vistoria"),
    ("/api/container-vistorias", "terminal.vistoria_container"),
    ("/api/reports/movements", "terminal.movimentacoes"),
    ("/api/movements", "terminal.movimentacoes"),
    ("/api/yard-control", "terminal.movimentacoes"),
    ("/api/unit-segregations", "terminal.movimentacoes"),
    ("/api/check-segregation", "terminal.movimentacoes"),
    ("/api/flex-tank", "terminal.flex_tank"),
    ("/api/container-audits", "terminal.auditoria"),
    ("/api/representatives", "comercial.representante"),
    ("/api/service-price-entries", "comercial.tabela_servicos"),
    ("/api/client-representative-links", "comercial.vinculo_clientes"),
    ("/api/reports/commission", "comercial.vinculo_clientes"),
    ("/api/commercial-proposals", "comercial.proposta"),
    ("/api/container-purchases", "gestao_container.compra"),
    ("/api/container-representatives", "gestao_container.representante"),
    ("/api/container-sales", "gestao_container.venda"),
    ("/api/vehicle-revisions", "frota.revisao"),
    ("/api/odometer-readings", "frota.hodometro"),
    ("/api/vehicle-checklists", "frota.checklist"),
    ("/api/vehicles", "frota.veiculos"),
    ("/api/drivers", "cadastro.pessoas"),
    ("/api/transport-companies", "cadastro.transportadora"),
    ("/api/clients", "cadastro.cliente"),
    ("/api/suppliers", "cadastro.fornecedor"),
    ("/api/employees", "cadastro.funcionario"),
    ("/api/insurance-companies", "cadastro.seguradora"),
    ("/api/terminals", "cadastro.terminal"),
    ("/api/shipping-lines", "cadastro.armador"),
    ("/api/service-types", "cadastro.tipos_servico"),
    ("/api/freight-routes", "cadastro.rota"),
    ("/api/reports/billing", "financeiro.relatorio_faturamento"),
    ("/api/invoices", "financeiro.faturas"),
    ("/api/intl-invoices", "financeiro.invoice_internacional"),
    ("/api/daily-rate-requests", "financeiro.diaria"),
    ("/api/expense-reports", "financeiro.prestacao_contas"),
    ("/api/rpa-terceiro", "financeiro.rpa_terceiro"),
    ("/api/freight-payments", "financeiro.pagamento_frete"),
    ("/api/ordem-servico", "frota.ordem_servico"),
    ("/api/os-categories", "frota.cadastro_categoria"),
    ("/api/fuel-supply-orders", "frota.ordem_abastecimento"),
    ("/api/loading-orders", "operacional.ordem_carregamento"),
    ("/api/warehouses", "estoque.almoxarifado"),
    ("/api/product-families", "estoque.familia_produto"),
    ("/api/service-families", "estoque.familia_servico"),
    ("/api/service-catalog", "estoque.cadastro_servico"),
    ("/api/stock/ledger", "estoque.relatorio"),
    ("/api/stock/report", "estoque.relatorio"),
    ("/api/stock/entries", "estoque.entradas"),
    ("/api/stock/nfe-import", "estoque.entradas"),
    ("/api/stock/movements", "estoque.movimentacao"),
    ("/api/epi-deliveries", "estoque.entrega_epi"),
    ("/api/products", "estoque.produto"),
    ("/api/fuel-supplies/consumption-summary", "frota.controle_media"),
    ("/api/fuel-supplies/consumption-history", "frota.controle_media"),
    ("/api/fuel-supplies", "frota.abastecimento"),
    ("/api/tank-settings", "abastecimento.configuracao_tanque"),
    ("/api/tank-refills", "abastecimento.nivel_tanque"),
    ("/api/tank-level", "abastecimento.nivel_tanque"),
    ("/api/tank-ledger", "abastecimento.nivel_tanque"),
    ("/api/reports/fuel-supply", "frota.relatorio_abastecimento"),
    ("/api/reports/service-orders", "frota.relatorio_servicos"),
    ("/api/loading-schedules", "operacional.programacao_carregamento"),
    ("/api/delivery-status", "operacional.status_entrega"),
    ("/api/reports/port-services", "operacional.relatorio_servico_portuario"),
    ("/api/port-services/billing-batches", "financeiro.faturamento_portuario"),
    ("/api/port-services/billing-candidates", "financeiro.faturamento_portuario"),
    ("/api/port-services", "operacional.servico_portuario"),
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


# Item -> grupo do catálogo. O grupo não é sempre o prefixo da chave: os
# itens de Abastecimento são "frota.*" - pelo prefixo, desativar
# Abastecimento não bloqueava esses itens, e desativar Manutenção ("frota")
# bloqueava junto o Abastecimento.
MODULE_GROUP_OF = {item["key"]: group["key"] for group in MODULE_CATALOG for item in group["items"]}
MODULE_KEYS = set(MODULE_GROUP_OF) | {group["key"] for group in MODULE_CATALOG}


def is_module_disabled(module_key: str, disabled_modules: list) -> bool:
    group = MODULE_GROUP_OF.get(module_key, module_key.split(".")[0])
    return group in disabled_modules or module_key in disabled_modules
