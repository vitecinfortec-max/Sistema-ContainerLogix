"""Fiscal: Configuração Fiscal da empresa e emissão de CT-e pela Focus NFe
(ver fiscal_focus.py para a conta/tokens e fiscal_cte.py para a montagem do
documento). Tudo restrito a administradores."""
import asyncio
import base64
import json
import logging
import re
import unicodedata
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

import fiscal_cte
import fiscal_focus
from fiscal_focus import FiscalProviderError
from models import CteCancelRequest, CteCreate, FiscalSettingsUpdate
from shared import ROOT_DIR, db, get_current_admin_user

api_router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)

EDITABLE_STATUSES = ("RASCUNHO", "REJEITADO", "ERRO")
SETTINGS_DEFAULTS = {
    "ambiente": "homologacao",
    "crt": 3,
    "cte_serie": 1,
    "cfop_padrao": "5353",
    "natureza_operacao": "PRESTACAO DE SERVICO DE TRANSPORTE",
    "icms_cst": "00",
    "icms_aliquota": None,
    "produto_predominante": "CONTAINER",
    "endereco": {},
}
# Tokens da empresa na Focus: nunca saem do servidor
SECRET_FIELDS = ("focus_token_homologacao", "focus_token_producao")
# Depois de transmitir, a Focus processa em fila: consulta algumas vezes antes
# de devolver "Pendente" (aí o botão "Atualizar situação" resolve)
POLL_ATTEMPTS = 3
POLL_INTERVAL = 1.5


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _provider_error(e: FiscalProviderError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail=e.message)


async def get_fiscal_settings() -> dict:
    doc = await db.fiscal_settings.find_one({}, {"_id": 0}) or {}
    return {**SETTINGS_DEFAULTS, **doc}


def _emission_token(settings: dict, ambiente: str) -> str:
    return settings.get(f"focus_token_{ambiente}") or ""


# ==================== MUNICÍPIOS (código IBGE) ====================

_MUNICIPIOS_FILE = ROOT_DIR / "data" / "br_municipios_ibge.json"


def _plain(text: str) -> str:
    text = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", text).strip().upper()


@lru_cache(maxsize=1)
def _load_municipios() -> dict:
    """Tabela oficial do IBGE (código -> nome por UF), guardada no projeto pra
    emissão não depender do site do IBGE estar no ar."""
    with open(_MUNICIPIOS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)["municipiosByUf"]


async def _municipios_da_uf(uf: str) -> list:
    uf = (uf or "").upper()
    if uf not in fiscal_cte.UF_CODES:
        raise HTTPException(status_code=400, detail="UF inválida")
    return [{"codigo": code, "nome": nome} for code, nome in _load_municipios().get(uf, {}).items()]


async def _codigo_municipio(cidade: str, uf: str) -> Optional[str]:
    if not cidade or not uf:
        return None
    alvo = _plain(cidade)
    for m in await _municipios_da_uf(uf):
        if _plain(m["nome"]) == alvo:
            return m["codigo"]
    return None


async def resolve_municipalities(cte: dict, settings: dict) -> dict:
    """Completa os códigos IBGE que faltam (endereços e início/término da
    prestação) pelo nome da cidade + UF. Não altera o que já veio preenchido."""
    targets = [(settings.get("endereco") or {})]
    for key in ("remetente", "destinatario", "tomador"):
        party = cte.get(key) or {}
        if party.get("endereco"):
            targets.append(party["endereco"])
    for key in ("origem", "destino"):
        if cte.get(key):
            targets.append(cte[key])
    for place in targets:
        if not re.fullmatch(r"\d{7}", fiscal_cte.only_digits(place.get("codigo_municipio"))):
            code = await _codigo_municipio(place.get("cidade"), place.get("uf"))
            if code:
                place["codigo_municipio"] = code
    return cte


@api_router.get("/fiscal/municipios/{uf}")
async def list_municipios(uf: str, current_user: dict = Depends(get_current_admin_user)):
    return await _municipios_da_uf(uf)


# ==================== CONFIGURAÇÃO FISCAL ====================

def _public_settings(settings: dict) -> dict:
    public = {k: v for k, v in settings.items() if k not in SECRET_FIELDS}
    ambiente = settings.get("ambiente") or "homologacao"
    numeracao = settings.get("focus_numeracao") or {}
    public["cte_proximo_numero"] = settings.get("cte_proximo_numero_pendente") or numeracao.get(ambiente)
    public["has_emission_token"] = bool(_emission_token(settings, ambiente))
    public["provider_configured"] = fiscal_focus.is_configured()
    return public


@api_router.get("/fiscal/settings")
async def read_fiscal_settings(current_user: dict = Depends(get_current_admin_user)):
    return _public_settings(await get_fiscal_settings())


@api_router.put("/fiscal/settings")
async def update_fiscal_settings(data: FiscalSettingsUpdate, current_user: dict = Depends(get_current_admin_user)):
    update = data.model_dump(exclude_unset=True)
    proximo = update.pop("cte_proximo_numero", None)
    if "cnpj" in update:
        update["cnpj"] = fiscal_cte.only_digits(update["cnpj"]) or None
    if update.get("crt") is not None and update["crt"] not in (1, 2, 3, 4):
        raise HTTPException(status_code=400, detail="Regime Tributário (CRT) inválido")
    if update.get("cte_serie") is not None and not (0 <= update["cte_serie"] <= 999):
        raise HTTPException(status_code=400, detail="Série do CT-e deve estar entre 0 e 999")
    if update.get("icms_cst") is not None and update["icms_cst"] not in fiscal_cte.ICMS_CST_FOCUS:
        raise HTTPException(status_code=400, detail="CST do ICMS inválido")
    for field in ("icms_aliquota", "ibs_uf_aliquota", "ibs_mun_aliquota", "cbs_aliquota"):
        if update.get(field) is not None and not (0 <= update[field] <= 100):
            raise HTTPException(status_code=400, detail="Alíquotas devem estar entre 0 e 100")
    for field in ("ibs_cbs_cst", "ibs_cbs_classificacao"):
        if field in update:
            update[field] = fiscal_cte.only_digits(update[field]) or None
    settings = {**await get_fiscal_settings(), **update}
    if proximo is not None:
        if proximo < 1 or proximo > 999999999:
            raise HTTPException(status_code=400, detail="Próximo número do CT-e inválido")
        atual = (settings.get("focus_numeracao") or {}).get(settings.get("ambiente") or "homologacao")
        # Nunca volta a numeração para trás (evita repetir número já usado)
        if atual and proximo < int(atual):
            raise HTTPException(status_code=400, detail="O próximo número não pode ser menor que o atual")
        # Vai para a Focus no próximo "enviar cadastro ao emissor"
        if not atual or proximo != int(atual):
            update["cte_proximo_numero_pendente"] = proximo
    update["updated_at"] = _now_iso()
    await db.fiscal_settings.update_one({}, {"$set": update}, upsert=True)
    return await read_fiscal_settings(current_user)


def _company_payload(settings: dict) -> dict:
    endereco = settings.get("endereco") or {}
    serie = int(settings.get("cte_serie") or 1)
    payload = {
        "cnpj": fiscal_cte.only_digits(settings.get("cnpj")),
        "nome": (settings.get("razao_social") or "").strip(),
        "inscricao_estadual": fiscal_cte.only_digits(settings.get("ie")),
        "regime_tributario": int(settings.get("crt") or 3),
        "email": (settings.get("email") or "").strip(),
        "logradouro": endereco.get("logradouro") or "",
        "numero": endereco.get("numero") or "S/N",
        "bairro": endereco.get("bairro") or "",
        "municipio": endereco.get("cidade") or "",
        "uf": (endereco.get("uf") or "").upper(),
        "cep": fiscal_cte.only_digits(endereco.get("cep")),
        "habilita_cte": True,
        "habilita_mdfe": True,
        "serie_cte_homologacao": serie,
        "serie_cte_producao": serie,
    }
    if endereco.get("complemento"):
        payload["complemento"] = endereco["complemento"]
    if settings.get("nome_fantasia"):
        payload["nome_fantasia"] = settings["nome_fantasia"]
    if settings.get("fone"):
        payload["telefone"] = fiscal_cte.only_digits(settings["fone"])
    pendente = settings.get("cte_proximo_numero_pendente")
    if pendente:
        payload[f"proximo_numero_cte_{settings.get('ambiente') or 'homologacao'}"] = int(pendente)
    return payload


def _certificate_summary(company: dict) -> Optional[dict]:
    if not company or not company.get("certificado_valido_ate"):
        return None
    return {
        "not_valid_before": company.get("certificado_valido_de"),
        "not_valid_after": company.get("certificado_valido_ate"),
        "cpf_cnpj": company.get("certificado_cnpj"),
    }


def _company_update(company: dict) -> dict:
    """O que guardar do retorno da Focus: id, tokens e numeração da empresa."""
    update = {
        "focus_empresa_id": company.get("id"),
        "focus_numeracao": {
            "homologacao": company.get("proximo_numero_cte_homologacao"),
            "producao": company.get("proximo_numero_cte_producao"),
        },
        "certificate": _certificate_summary(company),
    }
    for ambiente in ("homologacao", "producao"):
        if company.get(f"token_{ambiente}"):
            update[f"focus_token_{ambiente}"] = company[f"token_{ambiente}"]
    return update


@api_router.post("/fiscal/settings/sync")
async def sync_company_with_provider(current_user: dict = Depends(get_current_admin_user)):
    """Envia (cria/atualiza) o cadastro da empresa na Focus NFe, com o CT-e e o
    MDF-e habilitados, e guarda os tokens de emissão que ela devolve."""
    settings = await get_fiscal_settings()
    await resolve_municipalities({}, settings)
    payload = _company_payload(settings)
    missing = [label for label, ok in (
        ("CNPJ", len(payload["cnpj"]) == 14),
        ("Razão Social", payload["nome"]),
        ("Inscrição Estadual", payload["inscricao_estadual"]),
        ("E-mail", payload["email"]),
        ("Logradouro", payload["logradouro"]),
        ("Bairro", payload["bairro"]),
        ("CEP", len(payload["cep"]) == 8),
        ("Cidade/UF", payload["municipio"] and payload["uf"]),
    ) if not ok]
    if missing:
        raise HTTPException(status_code=400, detail="Preencha antes de enviar: " + ", ".join(missing))
    try:
        company = await fiscal_focus.save_company(payload["cnpj"], payload, settings.get("focus_empresa_id"))
    except FiscalProviderError as e:
        raise _provider_error(e)
    update = {
        **_company_update(company),
        "endereco": settings.get("endereco") or {},  # com o código IBGE resolvido
        "provider_synced_at": _now_iso(),
    }
    if update["certificate"] is None:
        update.pop("certificate")  # não apaga o que já foi mostrado se a Focus omitir
    await db.fiscal_settings.update_one({}, {"$set": update, "$unset": {"cte_proximo_numero_pendente": ""}}, upsert=True)
    return await read_fiscal_settings(current_user)


@api_router.post("/fiscal/settings/certificate")
async def upload_certificate(
    file: UploadFile = File(...),
    password: str = Form(...),
    current_user: dict = Depends(get_current_admin_user),
):
    """Repassa o certificado A1 (.pfx/.p12) para a Focus NFe, no cadastro da
    empresa. O arquivo e a senha não são gravados no sistema."""
    settings = await get_fiscal_settings()
    cnpj = fiscal_cte.only_digits(settings.get("cnpj"))
    if len(cnpj) != 14 or not settings.get("focus_empresa_id"):
        raise HTTPException(status_code=400, detail="Envie o cadastro da empresa ao emissor antes do certificado")
    content = await file.read()
    if not content or len(content) > 100_000:
        raise HTTPException(status_code=400, detail="Arquivo de certificado inválido")
    if not (file.filename or "").lower().endswith((".pfx", ".p12")):
        raise HTTPException(status_code=400, detail="Envie o certificado A1 no formato .pfx ou .p12")
    try:
        company = await fiscal_focus.save_company(cnpj, {
            "arquivo_certificado_base64": base64.b64encode(content).decode(),
            "senha_certificado": password,
        }, settings["focus_empresa_id"])
    except FiscalProviderError as e:
        raise _provider_error(e)
    await db.fiscal_settings.update_one({}, {"$set": _company_update(company)}, upsert=True)
    return await read_fiscal_settings(current_user)


# ==================== CT-e ====================

async def _get_cte_or_404(cte_id: str) -> dict:
    doc = await db.ctes.find_one({"id": cte_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="CT-e não encontrado")
    return doc


@api_router.get("/ctes")
async def list_ctes(search: Optional[str] = None, status: Optional[str] = None,
                    current_user: dict = Depends(get_current_admin_user)):
    query = {}
    if status:
        query["status"] = status
    if search:
        escaped = re.escape(search.strip())
        query["$or"] = [
            {"remetente.nome": {"$regex": escaped, "$options": "i"}},
            {"destinatario.nome": {"$regex": escaped, "$options": "i"}},
            {"tomador.nome": {"$regex": escaped, "$options": "i"}},
            {"chave": {"$regex": escaped}},
            {"containers.numero": {"$regex": escaped, "$options": "i"}},
        ]
        number = search.strip().lstrip("#")
        if number.isdigit():
            query["$or"].append({"numero": int(number)})
            query["$or"].append({"loading_order_number": int(number)})
    return await db.ctes.find(query, {"_id": 0}).sort("created_at", -1).to_list(None)


async def _party_from_client(name: Optional[str]) -> dict:
    if not name:
        return {}
    client = await db.clients.find_one({"name": {"$regex": f"^{re.escape(name.strip())}$", "$options": "i"}}, {"_id": 0})
    if not client:
        return {"nome": name}
    details = client.get("address_details") or {}
    return {
        "client_id": client.get("id"),
        "nome": client.get("name"),
        "cnpj_cpf": client.get("cnpj"),
        "ie": client.get("state_registration"),
        "fone": client.get("phone"),
        "email": client.get("email"),
        "endereco": {
            "logradouro": details.get("street"),
            "numero": details.get("number"),
            "complemento": details.get("complement"),
            "bairro": details.get("neighborhood"),
            "cep": details.get("zip"),
            "cidade": details.get("city"),
            "uf": details.get("state"),
        },
    }


@api_router.get("/ctes/from-loading-order/{order_id}")
async def cte_draft_from_loading_order(order_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Rascunho (não salvo) de CT-e com os dados da Ordem de Carregamento: o
    cliente da ordem entra como tomador/remetente, os containers e o peso
    como carga, o frete como valor da prestação."""
    order = await db.loading_orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Ordem de Carregamento não encontrada")
    settings = await get_fiscal_settings()
    client = await _party_from_client(order.get("client_name"))
    containers, peso = [], 0.0
    for item in order.get("items") or []:
        if item.get("container_number"):
            containers.append({"numero": item["container_number"], "lacre": item.get("seal")})
        try:
            peso += float(str(item.get("gross_weight") or "0").replace(".", "").replace(",", "."))
        except ValueError:
            pass
    freight = order.get("freight_value")
    obs = [f"Ordem de Carregamento nº {order.get('order_number')}"]
    if order.get("booking"):
        obs.append(f"Booking/Ref.: {order['booking']}")
    if order.get("truck_plate"):
        obs.append(f"Placa: {order['truck_plate']}" + (f" / {order['trailer_plate']}" if order.get("trailer_plate") else ""))
    if order.get("driver_name"):
        obs.append(f"Motorista: {order['driver_name']}")
    return CteCreate(
        loading_order_id=order["id"],
        loading_order_number=order.get("order_number"),
        cfop=settings.get("cfop_padrao"),
        natureza_operacao=settings.get("natureza_operacao"),
        tomador_papel=0,
        remetente=client or None,
        valor_total=freight,
        componentes=[{"nome": "FRETE", "valor": freight}] if freight else [],
        icms_cst=settings.get("icms_cst"),
        icms_aliquota=settings.get("icms_aliquota"),
        produto_predominante=settings.get("produto_predominante"),
        quantidades=[{"unidade": "01", "tipo_medida": "PESO BRUTO", "quantidade": peso}] if peso > 0 else [],
        containers=containers,
        observacoes=" · ".join(obs),
    ).model_dump()


@api_router.get("/ctes/{cte_id}")
async def get_cte(cte_id: str, current_user: dict = Depends(get_current_admin_user)):
    return await _get_cte_or_404(cte_id)


@api_router.post("/ctes")
async def create_cte(data: CteCreate, current_user: dict = Depends(get_current_admin_user)):
    doc = {
        "id": str(uuid.uuid4()),
        **data.model_dump(),
        "status": "RASCUNHO",
        "numero": None,
        "serie": None,
        "ambiente": None,
        "tentativas": 0,
        "created_at": _now_iso(),
        "created_by": current_user["sub"],
        "created_by_name": current_user.get("name"),
    }
    await db.ctes.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api_router.put("/ctes/{cte_id}")
async def update_cte(cte_id: str, data: CteCreate, current_user: dict = Depends(get_current_admin_user)):
    update = {**data.model_dump(), "updated_at": _now_iso()}
    result = await db.ctes.update_one({"id": cte_id, "status": {"$in": list(EDITABLE_STATUSES)}}, {"$set": update})
    if result.matched_count == 0:
        await _get_cte_or_404(cte_id)
        raise HTTPException(status_code=400, detail="Só é possível editar CT-e em rascunho, rejeitado ou com erro")
    return await _get_cte_or_404(cte_id)


@api_router.delete("/ctes/{cte_id}")
async def delete_cte(cte_id: str, current_user: dict = Depends(get_current_admin_user)):
    result = await db.ctes.delete_one({"id": cte_id, "status": {"$in": list(EDITABLE_STATUSES)}})
    if result.deleted_count == 0:
        await _get_cte_or_404(cte_id)
        raise HTTPException(status_code=400, detail="CT-e já transmitido não pode ser excluído (cancele-o)")
    return {"message": "CT-e excluído"}


async def _consult(cte: dict, settings: dict) -> dict:
    token = _emission_token(settings, cte.get("ambiente") or "homologacao")
    response = await fiscal_focus.get_cte(cte.get("ambiente") or "homologacao", token, cte["ref"])
    return fiscal_cte.provider_result(response)


@api_router.post("/ctes/{cte_id}/emitir")
async def emit_cte(cte_id: str, current_user: dict = Depends(get_current_admin_user)):
    cte = await _get_cte_or_404(cte_id)
    if cte["status"] not in EDITABLE_STATUSES:
        raise HTTPException(status_code=400, detail="Este CT-e já foi transmitido")
    settings = await get_fiscal_settings()
    if not fiscal_focus.is_configured():
        raise HTTPException(status_code=503, detail="Emissor fiscal não configurado no servidor")
    ambiente = settings.get("ambiente") or "homologacao"
    token = _emission_token(settings, ambiente)
    if not settings.get("provider_synced_at") or not token:
        raise HTTPException(status_code=400, detail="Envie o cadastro da empresa ao emissor (Configuração Fiscal)")
    await resolve_municipalities(cte, settings)
    errors = fiscal_cte.validate(cte, settings)
    if errors:
        raise HTTPException(status_code=400, detail="Corrija antes de emitir: " + " | ".join(errors))

    # Trava contra duplo clique / duas abas: só um pedido passa de editável para ENVIANDO
    lock = await db.ctes.update_one(
        {"id": cte_id, "status": {"$in": list(EDITABLE_STATUSES)}},
        {"$set": {"status": "ENVIANDO", "updated_at": _now_iso()}},
    )
    if lock.matched_count == 0:
        raise HTTPException(status_code=409, detail="Este CT-e já está sendo transmitido")

    # Cada tentativa usa uma referência nova na Focus (a numeração é dela)
    tentativa = int(cte.get("tentativas") or 0) + 1
    ref = f"{cte_id.replace('-', '')}t{tentativa}"
    payload = fiscal_cte.build_payload(cte, settings)
    update = {
        "ref": ref, "ambiente": ambiente, "tentativas": tentativa, "motivo": None,
        "origem": cte.get("origem"), "destino": cte.get("destino"),
        "remetente": cte.get("remetente"), "destinatario": cte.get("destinatario"), "tomador": cte.get("tomador"),
        "emitido_por": current_user.get("name"), "emitido_em": _now_iso(),
    }
    try:
        await fiscal_focus.emit_cte(ambiente, token, ref, payload)
        update["status"] = "PENDENTE"
        await db.ctes.update_one({"id": cte_id}, {"$set": update})
        for attempt in range(POLL_ATTEMPTS):
            await asyncio.sleep(POLL_INTERVAL)
            result = await _consult({**cte, **update}, settings)
            if result["status"] != "PENDENTE" or attempt == POLL_ATTEMPTS - 1:
                update.update(result)
                break
    except FiscalProviderError as e:
        if update.get("status") == "PENDENTE":
            # A Focus recebeu o CT-e; só a consulta falhou - "Atualizar situação" resolve depois
            await db.ctes.update_one({"id": cte_id}, {"$set": update})
            return await _get_cte_or_404(cte_id)
        update.update({"status": "ERRO", "motivo": e.message})
        await db.ctes.update_one({"id": cte_id}, {"$set": update})
        raise _provider_error(e)
    except Exception:
        # Não deixa o CT-e preso em ENVIANDO
        update.update({"status": "ERRO", "motivo": "Falha inesperada ao transmitir; tente novamente"})
        await db.ctes.update_one({"id": cte_id}, {"$set": update})
        raise
    await db.ctes.update_one({"id": cte_id}, {"$set": update})
    return await _get_cte_or_404(cte_id)


@api_router.post("/ctes/{cte_id}/atualizar")
async def refresh_cte(cte_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Consulta de novo a situação na Focus NFe (CT-e na fila de processamento,
    ou cancelado fora do sistema)."""
    cte = await _get_cte_or_404(cte_id)
    if not cte.get("ref"):
        raise HTTPException(status_code=400, detail="Este CT-e ainda não foi transmitido")
    try:
        result = await _consult(cte, await get_fiscal_settings())
    except FiscalProviderError as e:
        raise _provider_error(e)
    await db.ctes.update_one({"id": cte_id}, {"$set": {**result, "updated_at": _now_iso()}})
    return await _get_cte_or_404(cte_id)


@api_router.post("/ctes/{cte_id}/cancelar")
async def cancel_cte(cte_id: str, data: CteCancelRequest, current_user: dict = Depends(get_current_admin_user)):
    cte = await _get_cte_or_404(cte_id)
    if cte["status"] != "AUTORIZADO":
        raise HTTPException(status_code=400, detail="Só é possível cancelar CT-e autorizado")
    justificativa = re.sub(r"\s+", " ", data.justificativa or "").strip()
    if not (15 <= len(justificativa) <= 255):
        raise HTTPException(status_code=400, detail="A justificativa deve ter entre 15 e 255 caracteres")
    settings = await get_fiscal_settings()
    ambiente = cte.get("ambiente") or "homologacao"
    try:
        event = await fiscal_focus.cancel_cte(ambiente, _emission_token(settings, ambiente), cte["ref"], justificativa)
    except FiscalProviderError as e:
        raise _provider_error(e)
    status = (event.get("status") or "").lower()
    motivo = event.get("mensagem_sefaz") or event.get("mensagem")
    if event.get("status_sefaz") and motivo:
        motivo = f"{event['status_sefaz']} - {motivo}"
    if status != "cancelado":
        raise HTTPException(status_code=400, detail=f"Cancelamento não aceito: {motivo or status}")
    await db.ctes.update_one({"id": cte_id}, {"$set": {
        "status": "CANCELADO",
        "cancelamento": {
            "justificativa": justificativa, "motivo": motivo,
            "caminho_xml": event.get("caminho_xml_cancelamento"),
            "solicitado_por": current_user.get("name"), "solicitado_em": _now_iso(),
        },
        "updated_at": _now_iso(),
    }})
    return await _get_cte_or_404(cte_id)


async def _download(cte_id: str, kind: str) -> Response:
    cte = await _get_cte_or_404(cte_id)
    if not cte.get("ref") or cte["status"] not in ("AUTORIZADO", "CANCELADO"):
        raise HTTPException(status_code=400, detail="Documento disponível só para CT-e autorizado")
    settings = await get_fiscal_settings()
    ambiente = cte.get("ambiente") or "homologacao"
    field = "caminho_dacte" if kind == "pdf" else "caminho_xml"
    try:
        path = cte.get(field)
        if not path:
            result = await _consult(cte, settings)
            path = result.get(field)
            await db.ctes.update_one({"id": cte_id}, {"$set": {field: path}})
        if not path:
            raise HTTPException(status_code=404, detail="Arquivo ainda não disponível no emissor fiscal")
        content = await fiscal_focus.download(path, ambiente, _emission_token(settings, ambiente))
    except FiscalProviderError as e:
        raise _provider_error(e)
    name = f"CTe_{cte.get('numero')}_{cte.get('chave') or cte_id}.{kind}"
    media = "application/pdf" if kind == "pdf" else "application/xml"
    return Response(content=content, media_type=media, headers={"Content-Disposition": f"attachment; filename={name}"})


@api_router.get("/ctes/{cte_id}/pdf")
async def cte_pdf(cte_id: str, current_user: dict = Depends(get_current_admin_user)):
    return await _download(cte_id, "pdf")


@api_router.get("/ctes/{cte_id}/xml")
async def cte_xml(cte_id: str, current_user: dict = Depends(get_current_admin_user)):
    return await _download(cte_id, "xml")
