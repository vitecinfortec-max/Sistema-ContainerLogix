"""Configuração comum dos testes.

Os testes de test_rules_unit.py importam os módulos do backend direto (sem
servidor no ar e sem banco) - auth.py e shared.py exigem essas variáveis já
na importação. setdefault não mexe em nada que o ambiente já tenha definido;
o MONGO_URL de mentira nunca é usado, porque o cliente Mongo só conecta na
primeira consulta e esses testes não fazem nenhuma.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault("JWT_SECRET_KEY", "chave-somente-para-testes")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "containerlogix_testes_unitarios")


# ---------- Testes de API com banco em memória ----------
# Usados por test_api_*.py: o app FastAPI inteiro responde em processo (sem
# servidor no ar) e todo acesso ao banco cai num Mongo de mentira
# (mongomock-motor, ver requirements-dev.txt), criado vazio a cada teste.

import asyncio

import pytest


def _teach_mongomock_date_operators():
    """O mongomock não implementa o operador $toDate, que o Dashboard e os
    relatórios usam pra comparar created_at (gravado como texto ISO). Aqui ele
    ganha a mesma conversão que o Mongo real faz: texto ISO ou datetime ->
    datetime em UTC."""
    from datetime import datetime, timedelta, timezone

    from mongomock import aggregate

    if '$toDate' in aggregate.type_convertion_operators:
        return
    aggregate.type_convertion_operators.append('$toDate')
    original = aggregate._Parser._handle_type_convertion_operator

    def handle(self, operator, values):
        if operator != '$toDate':
            return original(self, operator, values)
        try:
            parsed = self.parse(values)
        except KeyError:
            return None
        if isinstance(parsed, str):
            parsed = datetime.fromisoformat(parsed.replace('Z', '+00:00'))
        # Como o Mongo guarda datas: UTC, sem fuso (o mongomock também
        # converte assim os datetimes que chegam na consulta).
        if isinstance(parsed, datetime) and parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed

    aggregate._Parser._handle_type_convertion_operator = handle

    # $dateToString com "timezone" (que o mongomock recusa por não implementar
    # fusos): "UTC" equivale a não informar; um deslocamento fixo como
    # "-03:00" é aplicado à data antes de formatar, como o Mongo faz.
    original_date = aggregate._Parser._handle_date_operator

    def handle_date(self, operator, values):
        if operator == '$dateToString' and isinstance(values, dict) and 'timezone' in values:
            zone = values['timezone']
            values = {k: v for k, v in values.items() if k != 'timezone'}
            if zone != 'UTC':
                sign = -1 if zone.startswith('-') else 1
                hours, minutes = zone.lstrip('+-').split(':')
                shifted = self.parse(values['date'])
                if shifted is not None:
                    values['date'] = shifted + sign * timedelta(hours=int(hours), minutes=int(minutes))
        return original_date(self, operator, values)

    aggregate._Parser._handle_date_operator = handle_date


class ApiClient:
    """Chamadas HTTP síncronas contra o app, já autenticadas como admin."""

    def __init__(self, app, db, loop, headers, base_headers=None):
        import httpx
        self.db = db
        self._loop = loop
        self._headers = headers
        self._base_headers = base_headers or {}
        self._client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    def run(self, coroutine):
        return self._loop.run_until_complete(coroutine)

    def request(self, method, path, as_user="admin", **kwargs):
        headers = {**self._base_headers, **(self._headers[as_user] if as_user else {}), **kwargs.pop("headers", {})}
        return self.run(self._client.request(method, path, headers=headers, **kwargs))

    def get(self, path, **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path, **kwargs):
        return self.request("POST", path, **kwargs)

    def put(self, path, **kwargs):
        return self.request("PUT", path, **kwargs)

    def delete(self, path, **kwargs):
        return self.request("DELETE", path, **kwargs)

    def close(self):
        self.run(self._client.aclose())


# TEST_MULTI_TENANT=1 roda a suíte inteira com o multi-cliente ligado (uma
# empresa de teste no cadastro central, banco e pasta de arquivos dela, token
# com a empresa e cabeçalho X-Tenant em toda chamada) - prova que nenhuma rota
# depende do banco fixo de antes.
_MULTI_TENANT_SUITE = os.environ.get("TEST_MULTI_TENANT", "").strip() == "1"


@pytest.fixture
def api(monkeypatch, tmp_path):
    from mongomock_motor import AsyncMongoMockClient

    _teach_mongomock_date_operators()
    import server
    import shared
    from auth import create_access_token

    from audit import AuditedDatabase
    # igual ao cliente real (shared.py), inclusive o log de auditoria
    mongo = AsyncMongoMockClient(tz_aware=True)
    fake_db = AuditedDatabase(mongo["containerlogix_teste"])
    app_db = fake_db
    tenant = None
    if _MULTI_TENANT_SUITE:
        import reports
        import tenancy
        tenant = {"slug": "teste", "name": "Teste", "db_name": "containerlogix_teste", "status": "ATIVO"}
        app_db = tenancy.TenantRoutedDatabase(mongo, wrap=AuditedDatabase)
        fake_db = app_db.for_tenant(tenant)  # os testes leem/gravam direto no banco da empresa
        central = mongo["central_teste"]
        asyncio.new_event_loop().run_until_complete(central.tenants.insert_one(dict(tenant)))
        monkeypatch.setattr(tenancy, "_directory", None)  # restaurado ao fim do teste
        tenancy.configure(central)
        monkeypatch.setattr(tenancy, "MULTI_TENANT", True)
        monkeypatch.setattr(shared, "_module_config_cache_by_tenant", {})
        uploads = tenancy.TenantUploadsRoot(tmp_path)
        originals = (shared.UPLOADS_DIR, reports.UPLOADS_DIR)  # antes de trocar qualquer um
        for module in list(sys.modules.values()):
            current = getattr(module, "UPLOADS_DIR", None)
            if any(current is original for original in originals):
                monkeypatch.setattr(module, "UPLOADS_DIR", uploads)
    real_db = shared.db
    # Cada router fez "from shared import db" - a troca precisa alcançar a
    # referência guardada em cada módulo, não só a de shared.
    for module in list(sys.modules.values()):
        if getattr(module, "db", None) is real_db:
            monkeypatch.setattr(module, "db", app_db)
    monkeypatch.setitem(shared._module_config_cache, "value", None)
    monkeypatch.setitem(shared._module_config_cache, "expires_at", 0)
    # A suíte inteira roda como o mesmo admin, em segundos: sem zerar,
    # passaria do limite geral de requisições (rate_limit_rule)
    shared._rate_limit_attempts.clear()

    loop = asyncio.new_event_loop()
    users = [
        {"id": "admin-1", "name": "Admin Teste", "email": "admin@teste.local", "role": "admin", "active": True},
        {"id": "oper-1", "name": "Operador Teste", "email": "oper@teste.local", "role": "user", "active": True},
    ]
    loop.run_until_complete(fake_db.users.insert_many([dict(u) for u in users]))
    claims = {"tid": tenant["slug"]} if tenant else {}
    headers = {
        key: {"Authorization": "Bearer " + create_access_token({"sub": u["id"], "email": u["email"], "name": u["name"], **claims})}
        for key, u in zip(("admin", "operator"), users)
    }
    client = ApiClient(server.app, fake_db, loop, headers, {"X-Tenant": tenant["slug"]} if tenant else None)
    # O teste inteiro roda "dentro" da empresa: funções chamadas direto (fora
    # de uma requisição) também usam o banco e a pasta dela
    context_token = tenancy.set_current_tenant(tenant) if tenant else None
    yield client
    if context_token is not None:
        tenancy.reset_current_tenant(context_token)
    client.close()
    loop.close()


# ---------- Testes antigos (requests + REACT_APP_BACKEND_URL) ----------
# Os arquivos mais antigos chamam o servidor por HTTP com `requests`, no
# endereço de REACT_APP_BACKEND_URL. Sem essa variável (o normal ao rodar a
# suíte), as chamadas sem endereço ("/api/...") passam a ser respondidas pelo
# próprio app, com um banco em memória por arquivo de teste (os testes de um
# arquivo dependem dos dados criados pelos anteriores). Esses testes também
# contavam com contas já existentes no servidor ou com o autocadastro (hoje
# desativado): o login de um email que não existe cria a conta de admin com a
# senha informada, e /api/auth/register cria a conta e entra com ela.

class _LegacyHttpBridge:
    def __init__(self, app, db, loop):
        import httpx
        self.db = db
        self.loop = loop
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    async def _ensure_user(self, payload: dict, role: str = "admin"):
        from auth import get_password_hash
        from models import User
        from routers.users import email_query

        if not payload.get("email") or not payload.get("password"):
            return
        if await self.db.users.find_one(email_query(payload["email"]), {"_id": 1}):
            return
        user = User(
            name=payload.get("name") or payload["email"].split("@")[0],
            email=payload["email"].strip(),
            password=get_password_hash(payload["password"]),
            role="admin" if payload.get("role", role) == "admin" else "operator",
        )
        doc = user.model_dump()
        doc["created_at"] = doc["created_at"].isoformat()
        await self.db.users.insert_one(doc)

    async def _request(self, method, path, **kwargs):
        import shared

        # Cada arquivo faz dezenas de logins em segundos
        shared._rate_limit_attempts.clear()
        if method == "POST" and path.split("?")[0] in ("/api/auth/login", "/api/auth/register"):
            payload = kwargs.get("json") or {}
            await self._ensure_user(payload)
            if path.startswith("/api/auth/register"):
                path = "/api/auth/login"
                kwargs["json"] = {"email": payload.get("email"), "password": payload.get("password")}
        return await self.client.request(method, path, **kwargs)

    def request(self, method, url, headers=None, **kwargs):
        allowed = {k: v for k, v in kwargs.items() if k in ("json", "data", "files", "params", "content")}
        if allowed.get("data") is not None and not isinstance(allowed["data"], dict):
            allowed["content"] = allowed.pop("data")
        if allowed.get("files"):
            # O multipart monta o próprio Content-Type (com o boundary)
            headers = {k: v for k, v in (headers or {}).items() if k.lower() != "content-type"}
        return self.loop.run_until_complete(
            self._request(method.upper(), url, headers=dict(headers or {}), **allowed)
        )

    def close(self):
        self.loop.run_until_complete(self.client.aclose())


@pytest.fixture(scope="module", autouse=True)
def _legacy_http_tests(request):
    if getattr(request.module, "BASE_URL", None) != "":
        yield
        return

    import requests
    from mongomock_motor import AsyncMongoMockClient

    _teach_mongomock_date_operators()
    import server
    import shared

    from audit import AuditedDatabase
    fake_db = AuditedDatabase(AsyncMongoMockClient(tz_aware=True)["containerlogix_teste_legado"])
    real_db = shared.db
    loop = asyncio.new_event_loop()
    bridge = _LegacyHttpBridge(server.app, fake_db, loop)
    original_request = requests.Session.request

    def session_request(self, method, url, *args, headers=None, **kwargs):
        if not str(url).startswith("/"):
            return original_request(self, method, url, *args, headers=headers, **kwargs)
        merged = {**dict(self.headers), **dict(headers or {})}
        return bridge.request(method, url, headers=merged, **kwargs)

    with pytest.MonkeyPatch.context() as mp:
        for module in list(sys.modules.values()):
            if getattr(module, "db", None) is real_db:
                mp.setattr(module, "db", fake_db)
        mp.setitem(shared._module_config_cache, "value", None)
        mp.setitem(shared._module_config_cache, "expires_at", 0)
        mp.setattr(requests.Session, "request", session_request)
        yield
    bridge.close()
    loop.close()
