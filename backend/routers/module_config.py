from fastapi import APIRouter, Depends

from models import ModuleConfigUpdate
from shared import (
    db, get_current_active_user, get_current_superadmin_user,
    MODULE_CATALOG, invalidate_module_config_cache,
)

api_router = APIRouter(prefix="/api")


@api_router.get("/module-config")
async def get_module_config(current_user: dict = Depends(get_current_active_user)):
    """Retorna quais módulos estão desativados nesta instância - qualquer
    usuário logado pode ler (precisa saber o que esconder no próprio menu),
    só o superadmin pode alterar."""
    doc = await db.module_config.find_one({}, {"_id": 0, "disabled_modules": 1})
    return {"disabled_modules": (doc or {}).get("disabled_modules", [])}


@api_router.get("/module-config/catalog")
async def get_module_catalog(current_user: dict = Depends(get_current_superadmin_user)):
    """Lista todos os grupos/itens que existem pra liberar ou bloquear."""
    return {"catalog": MODULE_CATALOG}


@api_router.put("/module-config")
async def update_module_config(data: ModuleConfigUpdate, current_user: dict = Depends(get_current_superadmin_user)):
    """Define quais módulos ficam desativados nesta instância - restrito ao
    dono do sistema (is_superadmin), nunca ao admin comum do cliente."""
    await db.module_config.replace_one({}, {"disabled_modules": data.disabled_modules}, upsert=True)
    invalidate_module_config_cache()
    return {"disabled_modules": data.disabled_modules}
