import os
from datetime import datetime, timedelta, timezone
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel as PydanticBaseModel

from models import UserLogin, UserResponse, Token, CompanySettingsUpdate
from auth import get_password_hash, verify_password, create_access_token, FILE_TOKEN_SCOPE

from shared import db, get_current_active_user, get_company_settings, check_rate_limit, client_ip

api_router = APIRouter(prefix="/api")

@api_router.post("/auth/register")
async def register():
    # Autocadastro desativado: qualquer um que achasse o sistema conseguia
    # criar acesso. Novos usuários agora são criados por um admin em Gestão de
    # Usuários (POST /users). A rota fica só pra responder com uma mensagem
    # clara a alguma aba antiga ainda aberta com o formulário "Criar Conta".
    raise HTTPException(
        status_code=403,
        detail="O cadastro pela tela de login foi desativado. Peça a um administrador para criar seu acesso em Gestão de Usuários.",
    )

# Password Recovery with Resend
import resend
import asyncio
import secrets
import string

resend.api_key = os.environ.get('RESEND_API_KEY', '')
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'onboarding@resend.dev')

TEMP_PASSWORD_VALIDITY = timedelta(hours=1)


def _session_token(user_doc: dict) -> str:
    """Token de sessão. "pv" é a versão da senha no momento da emissão - ver
    session_is_current em shared.py."""
    return create_access_token(data={
        "sub": user_doc['id'], "email": user_doc['email'], "name": user_doc['name'],
        "pv": user_doc.get('password_version') or 0,
    })


def _temp_password_matches(user_doc: dict, password: str) -> bool:
    """A senha digitada é a provisória enviada por e-mail, ainda na validade?"""
    temp_hash = user_doc.get('temp_password_hash')
    expires_at = user_doc.get('temp_password_expires_at')
    if not temp_hash or not expires_at:
        return False
    if datetime.now(timezone.utc) >= datetime.fromisoformat(expires_at):
        return False
    return verify_password(password, temp_hash)


def generate_temp_password(length=8):
    """Gera uma senha temporária aleatória"""
    chars = string.ascii_letters + string.digits
    return ''.join(secrets.choice(chars) for _ in range(length))

class ForgotPasswordRequest(PydanticBaseModel):
    email: str

class ChangePasswordRequest(PydanticBaseModel):
    current_password: str
    new_password: str

@api_router.post("/auth/forgot-password")
async def forgot_password(request: ForgotPasswordRequest, http_request: Request):
    """Envia senha provisória por email"""
    check_rate_limit(f"forgot-password:ip:{client_ip(http_request)}", limit=5, window_seconds=900)
    check_rate_limit(f"forgot-password:email:{request.email.lower()}", limit=3, window_seconds=900)

    user_doc = await db.users.find_one({"email": request.email}, {"_id": 0})
    if not user_doc:
        # Não revelamos se o email existe ou não (segurança)
        return {"message": "Se o email estiver cadastrado, você receberá uma senha provisória."}
    
    # Gerar senha provisória. Ela NÃO substitui a senha atual: fica guardada
    # à parte, com validade, e só passa a valer se alguém entrar com ela (o
    # que prova acesso ao e-mail da conta). Antes este pedido já trocava a
    # senha na hora - qualquer pessoa que soubesse o e-mail de um usuário
    # conseguia derrubar o acesso dele, e se o envio do e-mail falhasse a
    # conta ficava sem nenhuma senha conhecida.
    temp_password = generate_temp_password()

    # Enviar email com senha provisória
    try:
        html_content = f"""
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="color: #3B9BA8;">ContainerLogix</h1>
            </div>
            
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <h3 style="color: #333; margin-top: 0;">Recuperação de Senha</h3>
                <p>Olá <strong>{user_doc['name']}</strong>,</p>
                <p>Recebemos uma solicitação de recuperação de senha para sua conta.</p>
                <p>Sua senha provisória é:</p>
                <div style="background-color: #3B9BA8; color: white; padding: 15px; border-radius: 4px; text-align: center; font-size: 24px; font-family: monospace; letter-spacing: 2px;">
                    {temp_password}
                </div>
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; border-left: 4px solid #ffc107;">
                <p style="margin: 0; color: #856404;">
                    <strong>Importante:</strong> Ao fazer login com esta senha, você será solicitado a criar uma nova senha.
                </p>
            </div>
            
            <p style="color: #666; font-size: 12px; margin-top: 30px; text-align: center;">
                Se você não solicitou esta recuperação, ignore este email.
            </p>
        </div>
        """
        
        params = {
            "from": SENDER_EMAIL,
            "to": [request.email],
            "subject": "ContainerLogix - Recuperação de Senha",
            "html": html_content
        }
        
        # Enviar email de forma assíncrona
        await asyncio.to_thread(resend.Emails.send, params)

        # Só depois de o e-mail ter saído é que a senha provisória é guardada.
        await db.users.update_one(
            {"email": request.email},
            {"$set": {
                "temp_password_hash": get_password_hash(temp_password),
                "temp_password_expires_at": (datetime.now(timezone.utc) + TEMP_PASSWORD_VALIDITY).isoformat(),
            }}
        )
        
    except Exception as e:
        logging.error(f"Erro ao enviar email de recuperação: {e}")
        # Mesmo com erro no email, não revelamos detalhes ao usuário
    
    return {"message": "Se o email estiver cadastrado, você receberá uma senha provisória."}

@api_router.post("/auth/change-password")
async def change_password(request: ChangePasswordRequest, current_user: dict = Depends(get_current_active_user)):
    """Altera a senha do usuário logado"""
    user_doc = await db.users.find_one({"id": current_user['sub']}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    
    # Verificar senha atual
    if not verify_password(request.current_password, user_doc['password']):
        raise HTTPException(status_code=400, detail="Senha atual incorreta")
    
    # Mesmo mínimo exigido na criação de usuário (routers/users.py)
    if len(request.new_password) < 6:
        raise HTTPException(status_code=400, detail="A nova senha deve ter ao menos 6 caracteres")

    # Atualizar senha e remover flag must_change_password. A nova
    # password_version encerra todas as sessões abertas antes deste momento (inclusive a de
    # quem estiver usando a conta sem autorização); quem acabou de trocar a
    # senha recebe um token novo pra continuar logado.
    new_hashed_password = get_password_hash(request.new_password)
    password_version = (user_doc.get('password_version') or 0) + 1
    await db.users.update_one(
        {"id": current_user['sub']},
        {
            "$set": {
                "password": new_hashed_password,
                "must_change_password": False,
                "password_version": password_version,
            },
            "$unset": {"temp_password_hash": "", "temp_password_expires_at": ""},
        }
    )
    access_token = _session_token({**user_doc, "password_version": password_version})
    return {"message": "Senha alterada com sucesso", "access_token": access_token, "token_type": "bearer"}

@api_router.post("/auth/login", response_model=Token)
async def login(credentials: UserLogin, http_request: Request):
    check_rate_limit(f"login:ip:{client_ip(http_request)}", limit=10, window_seconds=300)
    check_rate_limit(f"login:email:{credentials.email.lower()}", limit=5, window_seconds=300)

    user_doc = await db.users.find_one({"email": credentials.email}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=401, detail="Email ou senha incorretos")

    if not verify_password(credentials.password, user_doc['password']):
        if not _temp_password_matches(user_doc, credentials.password):
            raise HTTPException(status_code=401, detail="Email ou senha incorretos")
        if user_doc.get('active') is False:
            raise HTTPException(status_code=403, detail="Acesso desativado. Fale com um administrador.")
        # Entrou com a senha provisória do e-mail: agora sim ela vira a senha
        # da conta (de uso único - a troca é obrigatória), e as sessões que
        # estavam abertas com a senha antiga são encerradas.
        promoted = {
            "password": user_doc['temp_password_hash'],
            "must_change_password": True,
            "password_version": (user_doc.get('password_version') or 0) + 1,
        }
        await db.users.update_one(
            {"id": user_doc['id']},
            {"$set": promoted, "$unset": {"temp_password_hash": "", "temp_password_expires_at": ""}}
        )
        user_doc.update(promoted)

    if user_doc.get('active') is False:
        raise HTTPException(status_code=403, detail="Acesso desativado. Fale com um administrador.")

    access_token = _session_token(user_doc)

    user_response = UserResponse(
        id=user_doc['id'],
        name=user_doc['name'],
        email=user_doc['email'],
        role=user_doc['role'],
        must_change_password=user_doc.get('must_change_password', False),
        active=user_doc.get('active', True),
        is_superadmin=user_doc.get('is_superadmin', False),
        created_at=datetime.fromisoformat(user_doc['created_at'])
    )

    return Token(access_token=access_token, token_type="bearer", user=user_response)

@api_router.get("/auth/file-token")
async def get_file_token(current_user: dict = Depends(get_current_active_user)):
    """Token que o frontend acrescenta à URL dos anexos (fotos, recibos) -
    ver FILE_TOKEN_SCOPE em auth.py e serve_upload em server.py."""
    user_doc = await db.users.find_one({"id": current_user['sub']}, {"_id": 0, "password_version": 1})
    return {"file_token": create_access_token(data={
        "sub": current_user['sub'], "scope": FILE_TOKEN_SCOPE,
        "pv": (user_doc or {}).get('password_version') or 0,
    })}


@api_router.get("/auth/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_active_user)):
    user_doc = await db.users.find_one({"id": current_user['sub']}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    
    return UserResponse(
        id=user_doc['id'],
        name=user_doc['name'],
        email=user_doc['email'],
        role=user_doc['role'],
        must_change_password=user_doc.get('must_change_password', False),
        active=user_doc.get('active', True),
        is_superadmin=user_doc.get('is_superadmin', False),
        created_at=datetime.fromisoformat(user_doc['created_at'])
    )

@api_router.get("/company-settings")
async def get_company_settings_endpoint(current_user: dict = Depends(get_current_active_user)):
    """Retorna os dados cadastrados em 'Dados da Empresa' (usados nos PDFs/Excel gerados pelo sistema)."""
    return await get_company_settings()

@api_router.put("/company-settings")
async def update_company_settings(data: CompanySettingsUpdate, current_user: dict = Depends(get_current_active_user)):
    """Atualiza os dados da empresa. Restrito a administradores."""
    user_doc = await db.users.find_one({"id": current_user['sub']}, {"_id": 0})
    if not user_doc or user_doc.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Apenas administradores podem editar os dados da empresa")

    # $set só dos campos enviados: antes era replace_one do documento
    # inteiro, e um PUT parcial apagava todos os outros dados da empresa.
    changes = data.model_dump(exclude_unset=True)
    changes['updated_at'] = datetime.now(timezone.utc).isoformat()
    await db.company_settings.update_one({}, {"$set": changes}, upsert=True)
    return await get_company_settings()

