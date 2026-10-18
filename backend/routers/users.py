import re
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from models import User, UserAdminCreate, UserResponse, UserRoleUpdate, UserStatusUpdate
from auth import get_password_hash
from shared import db, get_current_admin_user

api_router = APIRouter(prefix="/api")

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class UserProfileUpdate(BaseModel):
    name: str
    email: str


class UserPasswordReset(BaseModel):
    password: str
    must_change_password: bool = True


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
        # A tela trava as ações sobre a conta do dono do sistema
        is_superadmin=u.get('is_superadmin', False),
        created_at=created_at
    )


def email_query(email: str) -> dict:
    """Busca por email sem diferenciar maiúsculas (e sem espaços nas pontas):
    quem foi cadastrado como "Joao@Empresa.com" e digita "joao@empresa.com"
    no login não era encontrado."""
    return {"email": {"$regex": f"^{re.escape((email or '').strip())}$", "$options": "i"}}


def _clean_name_and_email(name: str, email: str) -> tuple:
    name = (name or '').strip()
    email = (email or '').strip()
    if not name or not email:
        raise HTTPException(status_code=400, detail="Informe o nome e o email")
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Email inválido")
    return name, email


async def _refuse_duplicate_email(email: str, user_id: Optional[str] = None):
    query = email_query(email)
    if user_id:
        query["id"] = {"$ne": user_id}
    if await db.users.find_one(query, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=400, detail="Email já cadastrado")


async def _load_target(user_id: str, current_user: dict) -> dict:
    """O usuário a ser alterado. A conta do dono do sistema (superadmin) só é
    alterada por ele mesmo: o admin do cliente conseguia desativá-la ou
    rebaixá-la, e o dono perdia o acesso a Módulos Contratados."""
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if target.get('is_superadmin'):
        me = await db.users.find_one({"id": current_user['sub']}, {"_id": 0, "is_superadmin": 1}) or {}
        if not me.get('is_superadmin'):
            raise HTTPException(status_code=403, detail="Esta conta é do proprietário do sistema e não pode ser alterada aqui")
    return target


@api_router.get("/users", response_model=List[UserResponse])
async def list_users(current_user: dict = Depends(get_current_admin_user)):
    """Lista todos os usuários do sistema - restrito a administradores."""
    users = await db.users.find({}, {"_id": 0, "password": 0}).sort("created_at", 1).to_list(None)
    return [_to_user_response(u) for u in users]


@api_router.post("/users", response_model=UserResponse)
async def create_user(data: UserAdminCreate, current_user: dict = Depends(get_current_admin_user)):
    """Cadastra um novo usuário. Único jeito de criar acesso ao sistema - o
    autocadastro pela tela de login foi desativado."""
    name, email = _clean_name_and_email(data.name, data.email)
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="A senha deve ter pelo menos 6 caracteres")

    # Sem diferenciar maiúsculas, pra não nascer um segundo cadastro do mesmo email
    await _refuse_duplicate_email(email)

    user = User(
        name=name,
        email=email,
        password=get_password_hash(data.password),
        role=data.role,
        must_change_password=data.must_change_password,
    )
    doc = user.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.users.insert_one(doc)
    return _to_user_response(doc)


@api_router.put("/users/{user_id}", response_model=UserResponse)
async def update_user_profile(user_id: str, data: UserProfileUpdate, current_user: dict = Depends(get_current_admin_user)):
    """Corrige o nome ou o email de um usuário (antes só dava pra criar)."""
    await _load_target(user_id, current_user)
    name, email = _clean_name_and_email(data.name, data.email)
    await _refuse_duplicate_email(email, user_id)
    await db.users.update_one({"id": user_id}, {"$set": {"name": name, "email": email}})
    updated = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    return _to_user_response(updated)


@api_router.put("/users/{user_id}/password", response_model=UserResponse)
async def reset_user_password(user_id: str, data: UserPasswordReset, current_user: dict = Depends(get_current_admin_user)):
    """Define uma senha nova pra quem esqueceu a dele (a recuperação por email
    depende do envio funcionar). Encerra as sessões abertas da pessoa e, por
    padrão, obriga a troca no próximo acesso."""
    if user_id == current_user['sub']:
        raise HTTPException(status_code=400, detail="Para trocar a sua própria senha, use \"Alterar senha\"")
    target = await _load_target(user_id, current_user)
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="A senha deve ter pelo menos 6 caracteres")
    await db.users.update_one(
        {"id": user_id},
        {
            "$set": {
                "password": get_password_hash(data.password),
                "must_change_password": data.must_change_password,
                "password_version": (target.get('password_version') or 0) + 1,
            },
            "$unset": {"temp_password_hash": "", "temp_password_expires_at": ""},
        },
    )
    updated = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    return _to_user_response(updated)


@api_router.put("/users/{user_id}/role", response_model=UserResponse)
async def update_user_role(user_id: str, data: UserRoleUpdate, current_user: dict = Depends(get_current_admin_user)):
    """Promove/rebaixa um usuário entre admin e operador."""
    if user_id == current_user['sub']:
        raise HTTPException(status_code=400, detail="Você não pode alterar seu próprio nível de acesso")

    target = await _load_target(user_id, current_user)

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

    target = await _load_target(user_id, current_user)

    if not data.active and target.get('role') == 'admin':
        admin_count = await db.users.count_documents({"role": "admin", "active": {"$ne": False}})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Não é possível desativar o último administrador do sistema")

    await db.users.update_one({"id": user_id}, {"$set": {"active": data.active}})
    updated = await db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    return _to_user_response(updated)
