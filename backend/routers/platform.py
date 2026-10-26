"""Multi-cliente, Etapa 4: painel do dono do sistema (só superadmin).

Lista as empresas do cadastro central, cria uma empresa nova (banco próprio,
primeiro administrador com senha provisória e a conta master do dono),
altera nome/endereços, suspende ou reativa e define os módulos contratados
de cada uma. Substitui o provisioning/provision_client.py (que criava um
servidor e um site por cliente).

Funciona com MULTI_TENANT ligado ou desligado: o cadastro central fica no
mesmo cluster do Atlas. Desligado, a empresa criada só passa a ser atendida
quando o servidor multi-cliente entrar no ar (Etapa 6).
"""
import re
import secrets
import string
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_password_hash
import shared
from shared import MODULE_KEYS, db, get_current_superadmin_user
import tenancy
from tenancy import CENTRAL_DB_NAME
from tenants import TenantCreate, ensure_central_indexes, get_tenant, list_tenants, register_tenant, set_tenant_status, update_tenant

api_router = APIRouter(prefix="/api")

_EMAIL_RX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class PlatformTenantCreate(BaseModel):
    slug: str
    name: str
    hosts: List[str] = []
    notes: Optional[str] = None
    admin_name: str
    admin_email: str
    disabled_modules: List[str] = []


class PlatformTenantUpdate(BaseModel):
    name: str
    hosts: List[str] = []
    notes: Optional[str] = None


class PlatformTenantStatus(BaseModel):
    status: str


class PlatformTenantModules(BaseModel):
    disabled_modules: List[str] = []


def _mongo():
    """O cliente do Mongo por trás de shared.db (nos testes, o de memória)."""
    if isinstance(db, tenancy.TenantRoutedDatabase):
        return db._client
    return db.client


def _central():
    if tenancy._directory is not None:
        return tenancy._directory.central
    return _mongo()[CENTRAL_DB_NAME]


def _changed():
    """O que mudou no cadastro central vale na hora (sem esperar o cache)."""
    if tenancy._directory is not None:
        tenancy._directory.clear()


async def _tenant_or_404(slug: str) -> dict:
    tenant = await get_tenant(_central(), slug)
    if not tenant:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    return tenant


def _temp_password(length=10) -> str:
    alphabet = string.ascii_letters + string.digits
    while True:
        value = "".join(secrets.choice(alphabet) for _ in range(length))
        if any(c.isdigit() for c in value) and any(c.isalpha() for c in value):
            return value


@api_router.get("/platform/tenants")
async def platform_list_tenants(current_user: dict = Depends(get_current_superadmin_user)):
    mongo = _mongo()
    rows = []
    for tenant in await list_tenants(_central()):
        tdb = mongo[tenant["db_name"]]
        last = await tdb.movements.find_one({}, {"_id": 0, "created_at": 1}, sort=[("created_at", -1)])
        modules = await tdb.module_config.find_one({}, {"_id": 0, "disabled_modules": 1})
        rows.append({
            **tenant,
            "users": await tdb.users.count_documents({}),
            "movements": await tdb.movements.count_documents({}),
            "last_movement_at": (last or {}).get("created_at"),
            "disabled_modules": (modules or {}).get("disabled_modules", []),
            "current": tenant["slug"] == tenancy.current_tenant_slug(),
        })
    return rows


@api_router.post("/platform/tenants")
async def platform_create_tenant(data: PlatformTenantCreate, current_user: dict = Depends(get_current_superadmin_user)):
    """Cria a empresa: cadastro central, banco novo com o primeiro admin
    (senha provisória, troca obrigatória), a conta master do dono e os
    módulos contratados. A senha provisória só aparece nesta resposta."""
    try:
        tenant_data = TenantCreate(slug=data.slug, name=data.name, db_name=f"containerlogix_{(data.slug or '').strip().lower()}",
                                   hosts=data.hosts, notes=data.notes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e).split("\n")[-1].replace("Value error, ", "").strip())
    admin_name = (data.admin_name or "").strip()
    admin_email = (data.admin_email or "").strip().lower()
    if not admin_name or not _EMAIL_RX.match(admin_email):
        raise HTTPException(status_code=400, detail="Informe o nome e um e-mail válido do administrador da empresa")
    central = _central()
    mongo = _mongo()
    if await get_tenant(central, tenant_data.slug):
        raise HTTPException(status_code=400, detail=f"O identificador {tenant_data.slug} já está em uso")
    if tenant_data.db_name in await mongo.list_database_names():
        raise HTTPException(status_code=400, detail=f"Já existe um banco {tenant_data.db_name} no servidor - escolha outro identificador")

    # Conta master: a mesma do dono que está criando (mesma senha), em todas as empresas
    owner = await db.users.find_one({"id": current_user["sub"]}, {"_id": 0})
    if not owner:
        raise HTTPException(status_code=400, detail="Conta do dono do sistema não encontrada")

    await ensure_central_indexes(central)
    try:
        await register_tenant(central, tenant_data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    tdb = mongo[tenant_data.db_name]
    now = datetime.now(timezone.utc).isoformat()
    temp_password = _temp_password()
    await tdb.users.insert_one({
        "id": str(uuid.uuid4()), "name": admin_name, "email": admin_email, "password": get_password_hash(temp_password),
        "role": "admin", "must_change_password": True, "active": True, "is_superadmin": False, "created_at": now,
    })
    if owner.get("password") and owner["email"].lower() != admin_email:
        await tdb.users.insert_one({
            "id": str(uuid.uuid4()), "name": owner["name"], "email": owner["email"], "password": owner["password"],
            "role": "admin", "must_change_password": False, "active": True, "is_superadmin": True, "created_at": now,
        })
    await tdb.company_settings.insert_one({"name": tenant_data.name})
    disabled = list(dict.fromkeys(k for k in data.disabled_modules if k in MODULE_KEYS))
    await tdb.module_config.insert_one({"disabled_modules": disabled})
    await tdb.users.create_index("email", unique=True)
    await tdb.users.create_index("id")
    _changed()
    return {"tenant": await get_tenant(central, tenant_data.slug), "admin_email": admin_email, "temp_password": temp_password}


@api_router.put("/platform/tenants/{slug}")
async def platform_update_tenant(slug: str, data: PlatformTenantUpdate, current_user: dict = Depends(get_current_superadmin_user)):
    await _tenant_or_404(slug)
    try:
        tenant = await update_tenant(_central(), slug, data.name, data.hosts, data.notes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e).split("\n")[-1].replace("Value error, ", "").strip())
    _changed()
    return tenant


@api_router.put("/platform/tenants/{slug}/status")
async def platform_tenant_status(slug: str, data: PlatformTenantStatus, current_user: dict = Depends(get_current_superadmin_user)):
    tenant = await _tenant_or_404(slug)
    if data.status == "SUSPENSO" and tenant["slug"] == tenancy.current_tenant_slug():
        raise HTTPException(status_code=400, detail="Não dá para suspender a empresa em que você está conectado")
    try:
        tenant = await set_tenant_status(_central(), slug, data.status)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    _changed()
    return tenant


@api_router.put("/platform/tenants/{slug}/modules")
async def platform_tenant_modules(slug: str, data: PlatformTenantModules, current_user: dict = Depends(get_current_superadmin_user)):
    """Módulos contratados de qualquer empresa, sem precisar entrar nela."""
    tenant = await _tenant_or_404(slug)
    disabled = list(dict.fromkeys(k for k in data.disabled_modules if k in MODULE_KEYS))
    await _mongo()[tenant["db_name"]].module_config.replace_one({}, {"disabled_modules": disabled}, upsert=True)
    shared._module_config_cache_by_tenant.pop(tenant["slug"], None)
    shared.invalidate_module_config_cache()  # instância única: o cache é um só
    return {"disabled_modules": disabled}
