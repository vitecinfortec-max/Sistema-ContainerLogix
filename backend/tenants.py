"""Multi-cliente - cadastro central de empresas (Etapa 1 do plano).

Cada empresa (tenant) continua com o PRÓPRIO banco no Atlas, exatamente como
hoje (containerlogix_jalogistica, containerlogix_tll-containers...). O banco
central (CENTRAL_DB_NAME, padrão "containerlogix_central") só guarda a lista
de empresas: qual banco é de quem e por quais endereços cada uma é acessada.

Nada aqui grava nos bancos das empresas - só no banco central. A escolha do
banco por requisição (Etapa 2) vai consultar find_tenant_by_host/get_tenant.
"""
import re
from datetime import datetime, timezone
from typing import List, Optional

from pydantic import BaseModel, field_validator

CENTRAL_DB_NAME_DEFAULT = "containerlogix_central"
TENANT_STATUS = ("ATIVO", "SUSPENSO")

_SLUG_RX = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}$")
# Nome de banco aceito pelo Atlas: sem / \ . " $ espaço e no máximo 38 bytes
_DB_RX = re.compile(r"^[A-Za-z0-9_-]{1,38}$")
_HOST_RX = re.compile(r"^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z0-9-]+$|^localhost$")


def normalize_host(host: Optional[str]) -> str:
    """'https://JA.containerlogix.com.br:443/x' -> 'ja.containerlogix.com.br'"""
    host = (host or "").strip().lower()
    host = re.sub(r"^[a-z]+://", "", host)
    host = host.split("/", 1)[0].split(":", 1)[0]
    return host.rstrip(".")


class TenantCreate(BaseModel):
    slug: str  # identificador curto e fixo (vai no token de login a partir da Etapa 2)
    name: str
    db_name: str  # banco da empresa no Atlas - o que já existe hoje
    hosts: List[str] = []  # endereços pelos quais a empresa acessa o sistema
    status: str = "ATIVO"
    notes: Optional[str] = None
    # Onde a instância antiga roda até a virada (Etapa 6) - só referência
    legacy_backend_url: Optional[str] = None
    legacy_frontend_url: Optional[str] = None

    @field_validator("slug")
    @classmethod
    def _slug(cls, v):
        v = (v or "").strip().lower()
        if not _SLUG_RX.match(v):
            raise ValueError("Identificador inválido: use letras minúsculas, números e hífen (2 a 41 caracteres)")
        return v

    @field_validator("name")
    @classmethod
    def _name(cls, v):
        v = (v or "").strip()
        if not v:
            raise ValueError("Informe o nome da empresa")
        return v

    @field_validator("db_name")
    @classmethod
    def _db(cls, v):
        v = (v or "").strip()
        if not _DB_RX.match(v) or v in ("admin", "local", "config"):
            raise ValueError("Nome de banco inválido")
        return v

    @field_validator("hosts")
    @classmethod
    def _hosts(cls, v):
        out = []
        for h in v or []:
            h = normalize_host(h)
            if not h:
                continue
            if not _HOST_RX.match(h):
                raise ValueError(f"Endereço inválido: {h}")
            if h not in out:
                out.append(h)
        return out

    @field_validator("status")
    @classmethod
    def _status(cls, v):
        if v not in TENANT_STATUS:
            raise ValueError("Situação inválida")
        return v


async def ensure_central_indexes(central) -> None:
    """Um identificador, um banco e um endereço nunca pertencem a duas empresas.
    Os endereços ficam também em tenant_hosts (um por documento): o índice
    único vale por endereço e a busca da Etapa 2 é uma consulta direta."""
    await central.tenants.create_index("slug", unique=True)
    await central.tenants.create_index("db_name", unique=True)
    await central.tenant_hosts.create_index("host", unique=True)


async def register_tenant(central, data: TenantCreate) -> dict:
    """Cadastra a empresa se ainda não existir (pelo slug). Nunca altera uma
    empresa já cadastrada - rodar de novo é seguro. Recusa banco ou endereço
    que já pertença a outra empresa."""
    existing = await central.tenants.find_one({"slug": data.slug}, {"_id": 0})
    if existing:
        return {"created": False, "tenant": existing}
    other = await central.tenants.find_one({"db_name": data.db_name}, {"_id": 0, "slug": 1})
    if other:
        raise ValueError(f"O banco {data.db_name} já pertence à empresa {other['slug']}")
    for host in data.hosts:
        other = await central.tenant_hosts.find_one({"host": host}, {"_id": 0, "slug": 1})
        if other:
            raise ValueError(f"O endereço {host} já pertence à empresa {other['slug']}")
    doc = {**data.model_dump(), "created_at": datetime.now(timezone.utc).isoformat()}
    await central.tenants.insert_one(doc)
    doc.pop("_id", None)
    for host in data.hosts:
        await central.tenant_hosts.insert_one({"host": host, "slug": data.slug})
    return {"created": True, "tenant": doc}


async def get_tenant(central, slug: str) -> Optional[dict]:
    return await central.tenants.find_one({"slug": (slug or "").strip().lower()}, {"_id": 0})


async def find_tenant_by_host(central, host: str) -> Optional[dict]:
    host = normalize_host(host)
    if not host:
        return None
    link = await central.tenant_hosts.find_one({"host": host}, {"_id": 0, "slug": 1})
    return await get_tenant(central, link["slug"]) if link else None


async def list_tenants(central) -> list:
    rows = await central.tenants.find({}, {"_id": 0}).to_list(None)
    return sorted(rows, key=lambda t: t["name"].lower())


async def update_tenant(central, slug: str, name: str, hosts: list, notes: Optional[str] = None) -> dict:
    """Altera nome, endereços e observações (o banco e o identificador nunca mudam)."""
    tenant = await get_tenant(central, slug)
    if not tenant:
        raise ValueError("Empresa não encontrada")
    data = TenantCreate(slug=tenant["slug"], name=name, db_name=tenant["db_name"], hosts=hosts,
                        status=tenant.get("status", "ATIVO"), notes=notes)
    for host in data.hosts:
        other = await central.tenant_hosts.find_one({"host": host, "slug": {"$ne": tenant["slug"]}}, {"_id": 0, "slug": 1})
        if other:
            raise ValueError(f"O endereço {host} já pertence à empresa {other['slug']}")
    await central.tenant_hosts.delete_many({"slug": tenant["slug"]})
    for host in data.hosts:
        await central.tenant_hosts.insert_one({"host": host, "slug": tenant["slug"]})
    await central.tenants.update_one({"slug": tenant["slug"]}, {"$set": {
        "name": data.name, "hosts": data.hosts, "notes": data.notes, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return await get_tenant(central, tenant["slug"])


async def set_tenant_status(central, slug: str, status: str) -> dict:
    if status not in TENANT_STATUS:
        raise ValueError("Situação inválida")
    result = await central.tenants.update_one({"slug": (slug or "").strip().lower()}, {"$set": {
        "status": status, "updated_at": datetime.now(timezone.utc).isoformat()}})
    if result.matched_count == 0:
        raise ValueError("Empresa não encontrada")
    return await get_tenant(central, slug)
