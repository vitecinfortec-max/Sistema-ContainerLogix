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
import asyncio
import os
import re
import secrets
import string
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from auth import get_password_hash
import shared
from shared import db, get_current_superadmin_user
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
    sender_email: Optional[str] = None
    admin_name: str
    admin_email: str
    disabled_modules: List[str] = []


class PlatformTenantUpdate(BaseModel):
    name: str
    hosts: List[str] = []
    notes: Optional[str] = None
    sender_email: Optional[str] = None


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
        modules = await tdb.module_config.find_one({}, {"_id": 0, "disabled_modules": 1, "enabled_opt_in": 1})
        rows.append({
            **tenant,
            "users": await tdb.users.count_documents({}),
            "movements": await tdb.movements.count_documents({}),
            "last_movement_at": (last or {}).get("created_at"),
            "disabled_modules": shared.effective_disabled_modules(modules),
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
                                   hosts=data.hosts, notes=data.notes, sender_email=data.sender_email)
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
    # Empresa nova nasce sem os módulos sob contratação (o dono liga depois)
    await tdb.module_config.insert_one(shared.module_config_document([*data.disabled_modules, *shared.OPT_IN_MODULES]))
    await tdb.users.create_index("email", unique=True)
    await tdb.users.create_index("id")
    _changed()
    return {"tenant": await get_tenant(central, tenant_data.slug), "admin_email": admin_email, "temp_password": temp_password}


@api_router.put("/platform/tenants/{slug}")
async def platform_update_tenant(slug: str, data: PlatformTenantUpdate, current_user: dict = Depends(get_current_superadmin_user)):
    await _tenant_or_404(slug)
    try:
        tenant = await update_tenant(_central(), slug, data.name, data.hosts, data.notes, data.sender_email)
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
    doc = shared.module_config_document(data.disabled_modules)
    await _mongo()[tenant["db_name"]].module_config.replace_one({}, doc, upsert=True)
    shared._module_config_cache_by_tenant.pop(tenant["slug"], None)
    shared.invalidate_module_config_cache()  # instância única: o cache é um só
    return {"disabled_modules": shared.effective_disabled_modules(doc)}


# ---------------------------------------------------------------- Cópia dos arquivos (Etapa 6)
# Na virada, as fotos/PDFs de cada empresa saem do disco do servidor antigo
# (uma instância por cliente) para uploads/<empresa>/ do servidor novo. O
# servidor novo busca direto do antigo; os dois conhecem a mesma senha de
# migração (variável MIGRATION_TOKEN). Pode rodar de novo quantas vezes
# precisar: só copia o que falta ou mudou de tamanho, e nunca apaga nada.

_MIGRATION_HEADER = "x-migration-token"
_imports: dict = {}  # empresa -> andamento da cópia (este processo)
_http_transport = None  # nos testes, um servidor antigo de mentira


def _migration_token() -> str:
    token = os.environ.get("MIGRATION_TOKEN", "").strip()
    return token if len(token) >= 24 else ""


def _require_migration_token(request: Request):
    expected = _migration_token()
    given = request.headers.get(_MIGRATION_HEADER, "")
    if not expected or not secrets.compare_digest(given.encode(), expected.encode()):
        raise HTTPException(status_code=404, detail="Not Found")  # sem senha, a rota "não existe"


def _safe_relative(path: str) -> Optional[str]:
    parts = [p for p in str(path).replace("\\", "/").split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts) or ":" in parts[0]:
        return None
    return "/".join(parts)


def _list_files(root: Path) -> list:
    out = []
    if not root.is_dir():
        return out
    for current, _dirs, files in os.walk(root):
        for name in files:
            full = Path(current) / name
            out.append({"path": full.relative_to(root).as_posix(), "size": full.stat().st_size})
    return sorted(out, key=lambda f: f["path"])


@api_router.get("/platform/migration/uploads-manifest", include_in_schema=False)
async def migration_manifest(request: Request):
    """Servidor antigo: lista dos arquivos guardados (caminho e tamanho)."""
    _require_migration_token(request)
    return await asyncio.to_thread(_list_files, Path(shared.UPLOADS_BASE_DIR))


@api_router.get("/platform/migration/uploads/{file_path:path}", include_in_schema=False)
async def migration_file(file_path: str, request: Request):
    """Servidor antigo: entrega um arquivo para a cópia."""
    _require_migration_token(request)
    relative = _safe_relative(file_path)
    root = Path(shared.UPLOADS_BASE_DIR).resolve()
    target = (root / relative).resolve() if relative else None
    if target is None or root not in target.parents or not target.is_file():
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    return FileResponse(target)


class PlatformImportUploads(BaseModel):
    source_url: str


async def _run_import(slug: str, source_url: str):
    status = _imports[slug]
    dest_root = Path(shared.UPLOADS_BASE_DIR) / slug
    headers = {_MIGRATION_HEADER: _migration_token()}
    try:
        async with httpx.AsyncClient(base_url=source_url, headers=headers, timeout=120, transport=_http_transport) as http:
            response = await http.get("/api/platform/migration/uploads-manifest")
            if response.status_code != 200:
                raise RuntimeError(f"o servidor antigo recusou a lista de arquivos (HTTP {response.status_code}) - confira o endereço e a MIGRATION_TOKEN dele")
            manifest = response.json()
            status["total"] = len(manifest)
            for item in manifest:
                relative = _safe_relative(item.get("path"))
                if not relative:
                    status["failed"] += 1
                    continue
                dest = dest_root / relative
                if dest.is_file() and dest.stat().st_size == item.get("size"):
                    status["skipped"] += 1
                    continue
                try:
                    file_response = await http.get(f"/api/platform/migration/uploads/{relative}")
                    if file_response.status_code != 200:
                        raise RuntimeError(f"HTTP {file_response.status_code}")
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    partial = dest.with_name(dest.name + ".parcial")
                    partial.write_bytes(file_response.content)
                    partial.replace(dest)
                    status["copied"] += 1
                    status["bytes"] += len(file_response.content)
                except Exception as e:  # um arquivo com problema não para a cópia
                    status["failed"] += 1
                    if len(status["errors"]) < 50:
                        status["errors"].append(f"{relative}: {e}")
        status["state"] = "CONCLUIDO"
    except Exception as e:
        status["state"] = "ERRO"
        status["error"] = str(e)
    status["finished_at"] = datetime.now(timezone.utc).isoformat()


@api_router.post("/platform/tenants/{slug}/import-uploads")
async def platform_import_uploads(slug: str, data: PlatformImportUploads, current_user: dict = Depends(get_current_superadmin_user)):
    """Servidor novo (multi-cliente): começa a copiar os arquivos da empresa a
    partir do servidor antigo dela. Acompanhe pelo GET da mesma rota."""
    tenant = await _tenant_or_404(slug)
    if not tenancy.is_multi_tenant():
        raise HTTPException(status_code=400, detail="A cópia de arquivos é feita no servidor multi-cliente")
    if not _migration_token():
        raise HTTPException(status_code=400, detail="Configure a variável MIGRATION_TOKEN (mínimo de 24 caracteres) neste servidor e no antigo")
    source = (data.source_url or "").strip().rstrip("/")
    if not re.match(r"^https?://[^\s/]+$", source):
        raise HTTPException(status_code=400, detail="Informe o endereço do servidor antigo (ex.: https://...onrender.com)")
    current = _imports.get(tenant["slug"])
    if current and current["state"] == "COPIANDO":
        raise HTTPException(status_code=409, detail="A cópia desta empresa já está em andamento")
    _imports[tenant["slug"]] = {
        "state": "COPIANDO", "source_url": source, "total": None, "copied": 0, "skipped": 0, "failed": 0, "bytes": 0,
        "errors": [], "error": None, "started_at": datetime.now(timezone.utc).isoformat(), "finished_at": None,
    }
    asyncio.create_task(_run_import(tenant["slug"], source))
    return _imports[tenant["slug"]]


@api_router.get("/platform/tenants/{slug}/import-uploads")
async def platform_import_status(slug: str, current_user: dict = Depends(get_current_superadmin_user)):
    await _tenant_or_404(slug)
    return _imports.get(slug.strip().lower()) or {"state": "NUNCA"}
