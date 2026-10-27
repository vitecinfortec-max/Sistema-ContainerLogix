from fastapi import APIRouter, Depends

from models import ModuleConfigUpdate
from shared import (
    db, get_current_active_user, get_current_superadmin_user,
    MODULE_CATALOG, MODULE_GROUP_OF, OPT_IN_MODULES, invalidate_module_config_cache,
    effective_disabled_modules, module_config_document,
)

api_router = APIRouter(prefix="/api")


@api_router.get("/module-config")
async def get_module_config(current_user: dict = Depends(get_current_active_user)):
    """Retorna quais módulos estão desativados nesta instância - qualquer
    usuário logado pode ler (precisa saber o que esconder no próprio menu),
    só o superadmin pode alterar. `module_groups` diz o grupo de cada item
    (nem sempre é o prefixo da chave), pro menu aplicar a mesma regra do
    backend."""
    doc = await db.module_config.find_one({}, {"_id": 0, "disabled_modules": 1, "enabled_opt_in": 1})
    return {"disabled_modules": effective_disabled_modules(doc), "module_groups": MODULE_GROUP_OF}


@api_router.get("/module-config/catalog")
async def get_module_catalog(current_user: dict = Depends(get_current_superadmin_user)):
    """Lista todos os grupos/itens que existem pra liberar ou bloquear."""
    return {"catalog": MODULE_CATALOG, "opt_in": list(OPT_IN_MODULES)}


@api_router.put("/module-config")
async def update_module_config(data: ModuleConfigUpdate, current_user: dict = Depends(get_current_superadmin_user)):
    """Define quais módulos ficam desativados nesta instância - restrito ao
    dono do sistema (is_superadmin), nunca ao admin comum do cliente."""
    # Chave que não existe no catálogo (erro de digitação, módulo renomeado)
    # não bloqueia nada: sai da lista em vez de ficar parecendo que bloqueou
    doc = module_config_document(data.disabled_modules)
    await db.module_config.replace_one({}, doc, upsert=True)
    invalidate_module_config_cache()
    return {"disabled_modules": effective_disabled_modules(doc)}
