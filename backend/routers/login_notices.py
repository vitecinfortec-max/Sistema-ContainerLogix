from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException

from models import LoginNoticeCreate
from reports import BRT_TZ
from shared import db, get_current_admin_user

api_router = APIRouter(prefix="/api")

# ==================== AVISOS DA TELA DE LOGIN ====================
# Recados que aparecem no painel ao lado do formulário de login (referência:
# Bsoft) - feriado, mudança de procedimento, novidade do sistema... Cada
# empresa tem os seus (o banco já é o da empresa, mesmo antes do login).
# A lista pública só devolve o que está ativo e dentro do período.

PUBLIC_FIELDS = ("id", "title", "message", "link_label", "link_url")
MAX_PUBLIC = 5


def _today() -> str:
    return datetime.now(BRT_TZ).date().isoformat()


def _clean(data: LoginNoticeCreate) -> dict:
    doc = {k: (v.strip() if isinstance(v, str) else v) for k, v in data.model_dump().items()}
    for key in ("message", "link_label", "link_url", "start_date", "end_date"):
        doc[key] = doc.get(key) or None
    if not doc["title"]:
        raise HTTPException(status_code=400, detail="Informe o título do aviso")
    if len(doc["title"]) > 80:
        raise HTTPException(status_code=400, detail="O título pode ter no máximo 80 caracteres")
    if doc["message"] and len(doc["message"]) > 400:
        raise HTTPException(status_code=400, detail="O texto pode ter no máximo 400 caracteres")
    if doc["link_url"] and not doc["link_url"].lower().startswith(("https://", "http://")):
        raise HTTPException(status_code=400, detail="O link precisa começar com https://")
    if doc["link_url"] and not doc["link_label"]:
        doc["link_label"] = "Saiba mais"
    if not doc["link_url"]:
        doc["link_label"] = None
    for key in ("start_date", "end_date"):
        if doc[key]:
            try:
                datetime.strptime(doc[key], "%Y-%m-%d")
            except ValueError:
                raise HTTPException(status_code=400, detail="Data inválida (use AAAA-MM-DD)")
    if doc["start_date"] and doc["end_date"] and doc["end_date"] < doc["start_date"]:
        raise HTTPException(status_code=400, detail="O fim da exibição é antes do início")
    return doc


@api_router.get("/login-notices")
async def public_login_notices():
    """Sem login: os avisos ativos de hoje, pra tela de login."""
    today = _today()
    notices = await db.login_notices.find({"active": True}, {"_id": 0}).sort("created_at", -1).to_list(200)
    visible = [
        n for n in notices
        if (not n.get("start_date") or n["start_date"] <= today) and (not n.get("end_date") or n["end_date"] >= today)
    ]
    return [{k: n.get(k) for k in PUBLIC_FIELDS} for n in visible[:MAX_PUBLIC]]


@api_router.get("/login-notices/manage")
async def list_login_notices(current_user: dict = Depends(get_current_admin_user)):
    return await db.login_notices.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


@api_router.post("/login-notices")
async def create_login_notice(data: LoginNoticeCreate, current_user: dict = Depends(get_current_admin_user)):
    doc = {
        "id": str(uuid.uuid4()),
        **_clean(data),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name") or current_user.get("email"),
    }
    await db.login_notices.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api_router.put("/login-notices/{notice_id}")
async def update_login_notice(notice_id: str, data: LoginNoticeCreate, current_user: dict = Depends(get_current_admin_user)):
    changes = _clean(data)
    result = await db.login_notices.update_one({"id": notice_id}, {"$set": changes})
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Aviso não encontrado")
    return await db.login_notices.find_one({"id": notice_id}, {"_id": 0})


@api_router.delete("/login-notices/{notice_id}")
async def delete_login_notice(notice_id: str, current_user: dict = Depends(get_current_admin_user)):
    result = await db.login_notices.delete_one({"id": notice_id})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Aviso não encontrado")
    return {"deleted": True}
