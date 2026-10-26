"""Multi-cliente, Etapa 2: em qual empresa cada requisição está.

Com MULTI_TENANT ligado, um único servidor atende todas as empresas, cada
uma com o PRÓPRIO banco (o mesmo de hoje). A empresa da requisição fica num
ContextVar - o mesmo mecanismo que o log de auditoria usa para saber quem é
o usuário - e:
  - `shared.db` (TenantRoutedDatabase) entrega o banco dessa empresa: as
    rotas continuam escrevendo `db.movements...` sem saber de nada;
  - `shared.UPLOADS_DIR` (TenantUploadsRoot) aponta para uploads/<empresa>/;
  - sem empresa definida, o acesso ao banco FALHA (nunca cai num banco
    "padrão" - um erro é melhor que mostrar dados de outra empresa).

Com MULTI_TENANT desligado (padrão), nada disso é usado: shared.db é o
AuditedDatabase de sempre, apontando para DB_NAME.

A lista de empresas vem do banco central (tenants.py, Etapa 1).
"""
import os
import time
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Optional

from tenants import CENTRAL_DB_NAME_DEFAULT, find_tenant_by_host, get_tenant, list_tenants, normalize_host


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "sim")


MULTI_TENANT = _env_flag("MULTI_TENANT")
CENTRAL_DB_NAME = os.environ.get("CENTRAL_DB_NAME", CENTRAL_DB_NAME_DEFAULT)
TENANT_HEADER = "x-tenant"  # identificador (app Android: "Código da empresa")
TENANT_HOST_HEADER = "x-tenant-host"  # endereço aberto no navegador (site)
_TENANT_CACHE_TTL = 30  # segundos - suspender uma empresa vale em até meio minuto

_current: ContextVar = ContextVar("current_tenant", default=None)


class NoTenantError(RuntimeError):
    """Acesso ao banco sem empresa definida (bug: nunca deve chegar ao usuário
    em silêncio, nem cair no banco de outra empresa)."""


def is_multi_tenant() -> bool:
    return MULTI_TENANT


def current_tenant() -> Optional[dict]:
    return _current.get()


def current_tenant_slug() -> Optional[str]:
    tenant = _current.get()
    return tenant["slug"] if tenant else None


def set_current_tenant(tenant: Optional[dict]):
    """Define a empresa da requisição/tarefa atual. Devolve o token do
    ContextVar para reset_current_tenant."""
    return _current.set(tenant)


def reset_current_tenant(token):
    _current.reset(token)


@contextmanager
def tenant_context(tenant: dict):
    """`with tenant_context(t):` - tudo dentro roda no banco da empresa t
    (rotinas agendadas, inicialização, scripts)."""
    token = _current.set(tenant)
    try:
        yield tenant
    finally:
        _current.reset(token)


# ---------------------------------------------------------------- Banco por empresa

class TenantRoutedDatabase:
    """Faz o papel de `shared.db`: cada acesso vai para o banco da empresa
    atual. Um AuditedDatabase por banco, criado na primeira vez e reaproveitado."""

    def __init__(self, client, wrap=None):
        self._client = client
        self._wrap = wrap  # AuditedDatabase (log de auditoria); None = banco cru
        self._by_name = {}

    def for_tenant(self, tenant: dict):
        name = tenant["db_name"]
        database = self._by_name.get(name)
        if database is None:
            raw = self._client[name]
            database = self._by_name[name] = self._wrap(raw) if self._wrap else raw
        return database

    def _current_db(self):
        tenant = _current.get()
        if tenant is None:
            raise NoTenantError("Nenhuma empresa definida para acessar o banco")
        return self.for_tenant(tenant)

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return getattr(self._current_db(), name)

    def __getitem__(self, name):
        return self._current_db()[name]

    def get_collection(self, name, *args, **kwargs):
        return self._current_db().get_collection(name, *args, **kwargs)


# ---------------------------------------------------------------- Arquivos por empresa

class TenantUploadsRoot:
    """Faz o papel de `shared.UPLOADS_DIR`: `UPLOADS_DIR / "checks" / id` vira
    uploads/<empresa>/checks/id. As URLs gravadas nos registros
    (/api/uploads/checks/...) não mudam - só a pasta onde o arquivo mora."""

    def __init__(self, base: Path):
        self.base = Path(base)
        self._created = set()

    def _root(self) -> Path:
        slug = current_tenant_slug()
        if not slug:
            raise NoTenantError("Nenhuma empresa definida para acessar os arquivos")
        root = self.base / slug
        # Antes a pasta única era criada na subida do servidor; a da empresa
        # nasce no primeiro uso (vários envios gravam direto nela)
        if slug not in self._created:
            root.mkdir(parents=True, exist_ok=True)
            self._created.add(slug)
        return root

    def __truediv__(self, other):
        return self._root() / other

    def __fspath__(self):
        return str(self._root())

    def __str__(self):
        return str(self._root())

    def resolve(self, *args, **kwargs):
        return self._root().resolve(*args, **kwargs)

    def mkdir(self, *args, **kwargs):
        # Na subida do servidor (sem empresa) cria só a pasta base
        target = self._root() if current_tenant_slug() else self.base
        return target.mkdir(*args, **kwargs)

    def exists(self):
        return self._root().exists()

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return getattr(self._root(), name)


# ---------------------------------------------------------------- Cadastro central

class TenantDirectory:
    """Leitura do banco central com cache curto (toda requisição consulta)."""

    def __init__(self, central):
        self.central = central
        self._cache = {}

    def _cached(self, key):
        hit = self._cache.get(key)
        if hit and hit[1] > time.time():
            return hit[0], True
        return None, False

    def _store(self, key, value):
        self._cache[key] = (value, time.time() + _TENANT_CACHE_TTL)
        return value

    def clear(self):
        self._cache.clear()

    async def by_slug(self, slug: str) -> Optional[dict]:
        slug = (slug or "").strip().lower()
        if not slug:
            return None
        value, hit = self._cached(("slug", slug))
        if hit:
            return value
        return self._store(("slug", slug), await get_tenant(self.central, slug))

    async def by_host(self, host: str) -> Optional[dict]:
        host = normalize_host(host)
        if not host:
            return None
        value, hit = self._cached(("host", host))
        if hit:
            return value
        return self._store(("host", host), await find_tenant_by_host(self.central, host))

    async def active(self) -> list:
        return [t for t in await list_tenants(self.central) if t.get("status") == "ATIVO"]


_directory: Optional[TenantDirectory] = None


def configure(central) -> TenantDirectory:
    global _directory
    _directory = TenantDirectory(central)
    return _directory


def directory() -> TenantDirectory:
    if _directory is None:
        raise RuntimeError("Cadastro central de empresas não configurado")
    return _directory


async def active_tenants() -> list:
    """Empresas ativas - para rotinas que rodam em todas (inicialização,
    e-mail diário): `for t in await active_tenants(): with tenant_context(t): ...`"""
    return await directory().active()
