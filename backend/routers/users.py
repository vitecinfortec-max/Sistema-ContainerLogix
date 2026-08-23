from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from models import UserResponse, UserRoleUpdate, UserStatusUpdate
from shared import db, get_current_admin_user

api_router = APIRouter(prefix="/api")


def _to_user_response(u: dict) -> UserResponse:
    created_at = u['created_at']
    if isinstance(created_at, str):
        created_at = datetime.fromisoformat(created_at)
    return UserResponse(
        id=u['id'],
        name=u['name'],
        email=u['email'],
        role=u['role'],
        must_change_password=u.get('must_change_password', False),
        active=u.get('active', True),
        created_at=created_at
    )


@api_router.get("/users", response_model=List[UserResponse])
async def list_users(current_user: dict = Depends(get_current_admin_user)):
    """Lista todos os usuários do sistema - restrito a administradores."""
    users = await db.users.find({}, {"_id": 0, "password": 0}).sort("created_at", 1).to_list(None)
    return [_to_user_response(u) for u in users]


@api_router.put("/users/{user_id}/role", response_model=UserResponse)
async def update_user_role(user_id: str, data: UserRoleUpdate, current_user: dict = Depends(get_current_admin_user)):
    """Promove/rebaixa um usuário entre admin e operador."""
    if user_id == current_user['sub']:
        raise HTTPException(status_code=400, detail="Você não pode alterar seu próprio nível de acesso")

    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    if target['role'] == 'admin' and data.role != 'admin':
        admin_count = await db.users.count_documents({"role": "admin", "active": {"$ne": False}})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Não é possível remover o último administrador do sistema")

    await db.users.update_one({"id": user_id}, {"$set": {"role": data.role}})
    updated = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    return _to_user_response(updated)


@api_router.put("/users/{user_id}/status", response_model=UserResponse)
async def update_user_status(user_id: str, data: UserStatusUpdate, current_user: dict = Depends(get_current_admin_user)):
    """Ativa ou desativa o acesso de um usuário, sem apagar o cadastro dele."""
    if user_id == current_user['sub']:
        raise HTTPException(status_code=400, detail="Você não pode desativar seu próprio acesso")

    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    if not data.active and target.get('role') == 'admin':
        admin_count = await db.users.count_documents({"role": "admin", "active": {"$ne": False}})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Não é possível desativar o último administrador do sistema")

    await db.users.update_one({"id": user_id}, {"$set": {"active": data.active}})
    updated = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    return _to_user_response(updated)
