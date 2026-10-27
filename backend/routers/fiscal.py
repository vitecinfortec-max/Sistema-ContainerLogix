"""Fiscal: Configuração Fiscal da empresa e emissão de CT-e pela Nuvem Fiscal
(ver fiscal_nuvem.py para a conta/credenciais e fiscal_cte.py para a montagem
do documento). Tudo restrito a administradores."""
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
import fiscal_nuvem
from fiscal_nuvem import FiscalProviderError
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


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _provider_error(e: FiscalProviderError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail=e.message)


async def get_fiscal_settings() -> dict:
    doc = await db.fiscal_settings.find_one({}, {"_id": 0}) or {}
    return {**SETTINGS_DEFAULTS, **doc}


def _counter_id(settings: dict) -> str:
    # Numeração separada por ambiente e série (homologação não gasta número de produção)
    return f"cte_numero_{settings.get('ambiente') or 'homologacao'}_{int(settings.get('cte_serie') or 1)}"


async def _next_number_preview(settings: dict) -> int:
    counter = await db.counters.find_one({"_id": _counter_id(settings)})
    return (counter["seq"] + 1) if counter else 1


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

@api_router.get("/fiscal/settings")
async def read_fiscal_settings(current_user: dict = Depends(get_current_admin_user)):
    settings = await get_fiscal_settings()
    return {
        **settings,
        "cte_proximo_numero": await _next_number_preview(settings),
        "provider_configured": fiscal_nuvem.is_configured(),
    }


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
    if update.get("icms_cst") is not None and update["icms_cst"] not in ("00", "40", "41", "51", "60", "90", "SN"):
        raise HTTPException(status_code=400, detail="CST do ICMS inválido")
    if update.get("icms_aliquota") is not None and not (0 <= update["icms_aliquota"] <= 100):
        raise HTTPException(status_code=400, detail="Alíquota do ICMS deve estar entre 0 e 100")
    update["updated_at"] = _now_iso()
    settings = {**await get_fiscal_settings(), **update}
    if proximo is not None:
        if proximo < 1 or proximo > 999999999:
            raise HTTPException(status_code=400, detail="Próximo número do CT-e inválido")
        # Nunca volta a numeração para trás (evita repetir número já usado)
        if proximo < await _next_number_preview(settings):
            raise HTTPException(status_code=400, detail="O próximo número não pode ser menor que o atual")
    await db.fiscal_settings.update_one({}, {"$set": update}, upsert=True)
    if proximo is not None:
        await db.counters.update_one({"_id": _counter_id(settings)}, {"$set": {"seq": proximo - 1}}, upsert=True)
    return await read_fiscal_settings(current_user)


def _company_payload(settings: dict) -> dict:
    endereco = settings.get("endereco") or {}
    payload = {
        "cpf_cnpj": fiscal_cte.only_digits(settings.get("cnpj")),
        "nome_razao_social": (settings.get("razao_social") or "").strip(),
        "email": (settings.get("email") or "").strip(),
        "endereco": {
            "logradouro": endereco.get("logradouro") or "",
            "numero": endereco.get("numero") or "S/N",
            "bairro": endereco.get("bairro") or "",
            "codigo_municipio": fiscal_cte.only_digits(endereco.get("codigo_municipio")),
            "cidade": endereco.get("cidade") or "",
            "uf": (endereco.get("uf") or "").upper(),
            "cep": fiscal_cte.only_digits(endereco.get("cep")),
        },
    }
    if endereco.get("complemento"):
        payload["endereco"]["complemento"] = endereco["complemento"]
    for key, field in (("inscricao_estadual", "ie"), ("nome_fantasia", "nome_fantasia"), ("fone", "fone")):
        if settings.get(field):
            payload[key] = fiscal_cte.only_digits(settings[field]) if key != "nome_fantasia" else settings[field]
    return payload


@api_router.post("/fiscal/settings/sync")
async def sync_company_with_provider(current_user: dict = Depends(get_current_admin_user)):
    """Envia (cria/atualiza) o cadastro da empresa e a configuração de CT-e
    (regime tributário + ambiente) para a Nuvem Fiscal."""
    settings = await get_fiscal_settings()
    await resolve_municipalities({}, settings)
    payload = _company_payload(settings)
    missing = [label for label, ok in (
        ("CNPJ", len(payload["cpf_cnpj"]) == 14),
        ("Razão Social", payload["nome_razao_social"]),
        ("E-mail", payload["email"]),
        ("Logradouro", payload["endereco"]["logradouro"]),
        ("Bairro", payload["endereco"]["bairro"]),
        ("CEP", len(payload["endereco"]["cep"]) == 8),
        ("Município (cidade/UF)", len(payload["endereco"]["codigo_municipio"]) == 7),
    ) if not ok]
    if missing:
        raise HTTPException(status_code=400, detail="Preencha antes de enviar: " + ", ".join(missing))
    try:
        await fiscal_nuvem.save_company(payload["cpf_cnpj"], payload)
        await fiscal_nuvem.save_cte_config(payload["cpf_cnpj"], int(settings.get("crt") or 3),
                                           settings.get("ambiente") or "homologacao")
        certificate = await fiscal_nuvem.get_certificate(payload["cpf_cnpj"])
    except FiscalProviderError as e:
        raise _provider_error(e)
    update = {
        "endereco": settings.get("endereco") or {},  # com o código IBGE resolvido
        "provider_synced_at": _now_iso(),
        "certificate": _certificate_summary(certificate),
    }
    await db.fiscal_settings.update_one({}, {"$set": update}, upsert=True)
    return await read_fiscal_settings(current_user)


def _certificate_summary(certificate) -> Optional[dict]:
    if not certificate:
        return None
    return {
        "subject_name": certificate.get("subject_name"),
        "issuer_name": certificate.get("issuer_name"),
        "not_valid_before": certificate.get("not_valid_before"),
        "not_valid_after": certificate.get("not_valid_after"),
        "cpf_cnpj": certificate.get("cpf_cnpj"),
    }


@api_router.post("/fiscal/settings/certificate")
async def upload_certificate(
    file: UploadFile = File(...),
    password: str = Form(...),
    current_user: dict = Depends(get_current_admin_user),
):
    """Repassa o certificado A1 (.pfx/.p12) para a Nuvem Fiscal. O arquivo e a
    senha não são gravados no sistema."""
    settings = await get_fiscal_settings()
    cnpj = fiscal_cte.only_digits(settings.get("cnpj"))
    if len(cnpj) != 14:
        raise HTTPException(status_code=400, detail="Informe e salve o CNPJ do emitente antes de enviar o certificado")
    if not settings.get("provider_synced_at"):
        raise HTTPException(status_code=400, detail="Envie o cadastro da empresa ao emissor antes do certificado")
    content = await file.read()
    if not content or len(content) > 100_000:
        raise HTTPException(status_code=400, detail="Arquivo de certificado inválido")
    if not (file.filename or "").lower().endswith((".pfx", ".p12")):
        raise HTTPException(status_code=400, detail="Envie o certificado A1 no formato .pfx ou .p12")
    try:
        certificate = await fiscal_nuvem.upload_certificate(cnpj, base64.b64encode(content).decode(), password)
    except FiscalProviderError as e:
        raise _provider_error(e)
    await db.fiscal_settings.update_one({}, {"$set": {"certificate": _certificate_summary(certificate)}}, upsert=True)
    return await read_fiscal_settings(current_user)


@api_router.get("/fiscal/sefaz-status")
async def sefaz_status(current_user: dict = Depends(get_current_admin_user)):
    settings = await get_fiscal_settings()
    cnpj = fiscal_cte.only_digits(settings.get("cnpj"))
    if len(cnpj) != 14:
        raise HTTPException(status_code=400, detail="Configure o CNPJ do emitente")
    try:
        return await fiscal_nuvem.cte_sefaz_status(cnpj)
    except FiscalProviderError as e:
        raise _provider_error(e)


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


@api_router.post("/ctes/{cte_id}/emitir")
async def emit_cte(cte_id: str, current_user: dict = Depends(get_current_admin_user)):
    cte = await _get_cte_or_404(cte_id)
    if cte["status"] not in EDITABLE_STATUSES:
        raise HTTPException(status_code=400, detail="Este CT-e já foi transmitido")
    settings = await get_fiscal_settings()
    if not fiscal_nuvem.is_configured():
        raise HTTPException(status_code=503, detail="Emissor fiscal não configurado no servidor")
    if not settings.get("provider_synced_at"):
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

    # O número é reservado na primeira tentativa e mantido nas seguintes (CT-e
    # rejeitado não chega a usar o número na Sefaz). Trocar ambiente/série
    # depois disso reserva um número novo naquela numeração.
    ambiente = settings.get("ambiente") or "homologacao"
    serie = int(settings.get("cte_serie") or 1)
    numero = cte.get("numero")
    if not numero or cte.get("ambiente") != ambiente or cte.get("serie") != serie:
        counter = await db.counters.find_one_and_update(
            {"_id": _counter_id(settings)}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
        numero = counter["seq"]
    tentativa = int(cte.get("tentativas") or 0) + 1
    payload = fiscal_cte.build_payload(cte, settings, numero, f"{cte_id}-{tentativa}")

    update = {
        "numero": numero, "serie": serie, "ambiente": ambiente, "tentativas": tentativa,
        "origem": cte.get("origem"), "destino": cte.get("destino"),
        "remetente": cte.get("remetente"), "destinatario": cte.get("destinatario"), "tomador": cte.get("tomador"),
        "emitido_por": current_user.get("name"), "emitido_em": _now_iso(),
    }
    try:
        response = await fiscal_nuvem.emit_cte(payload)
    except FiscalProviderError as e:
        update.update({"status": "ERRO", "motivo": e.message})
        await db.ctes.update_one({"id": cte_id}, {"$set": update})
        raise _provider_error(e)
    except Exception:
        # Não deixa o CT-e preso em ENVIANDO; "Atualizar situação" confirma
        # depois se a Nuvem Fiscal chegou a receber o pedido
        update.update({"status": "ERRO", "motivo": "Falha inesperada ao transmitir; tente novamente"})
        await db.ctes.update_one({"id": cte_id}, {"$set": update})
        raise
    update.update(fiscal_cte.provider_result(response))
    await db.ctes.update_one({"id": cte_id}, {"$set": update})
    return await _get_cte_or_404(cte_id)


@api_router.post("/ctes/{cte_id}/atualizar")
async def refresh_cte(cte_id: str, current_user: dict = Depends(get_current_admin_user)):
    """Consulta de novo a situação na Nuvem Fiscal (CT-e pendente na fila, ou
    cancelado fora do sistema). "sincronizar" pede para ela consultar a Sefaz."""
    cte = await _get_cte_or_404(cte_id)
    if not cte.get("provider_id"):
        raise HTTPException(status_code=400, detail="Este CT-e ainda não foi transmitido")
    try:
        await fiscal_nuvem.sync_cte(cte["provider_id"])
        response = await fiscal_nuvem.get_cte(cte["provider_id"])
    except FiscalProviderError as e:
        raise _provider_error(e)
    result = fiscal_cte.provider_result(response)
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
    try:
        event = await fiscal_nuvem.cancel_cte(cte["provider_id"], justificativa)
    except FiscalProviderError as e:
        raise _provider_error(e)
    status = (event.get("status") or "").lower()
    motivo = event.get("motivo_status") or event.get("mensagem")
    if status in ("rejeitado", "erro"):
        raise HTTPException(status_code=400, detail=f"Cancelamento não aceito: {motivo or status}")
    update = {
        "cancelamento": {
            "status": status, "justificativa": justificativa, "protocolo": event.get("numero_protocolo"),
            "motivo": motivo, "solicitado_por": current_user.get("name"), "solicitado_em": _now_iso(),
        },
        "updated_at": _now_iso(),
    }
    if status == "registrado":
        update["status"] = "CANCELADO"
    await db.ctes.update_one({"id": cte_id}, {"$set": update})
    return await _get_cte_or_404(cte_id)


async def _download(cte_id: str, kind: str) -> Response:
    cte = await _get_cte_or_404(cte_id)
    if not cte.get("provider_id") or cte["status"] not in ("AUTORIZADO", "CANCELADO"):
        raise HTTPException(status_code=400, detail="Documento disponível só para CT-e autorizado")
    try:
        content = await (fiscal_nuvem.cte_pdf if kind == "pdf" else fiscal_nuvem.cte_xml)(cte["provider_id"])
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
