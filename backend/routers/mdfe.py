"""Fiscal: MDF-e (Manifesto Eletrônico de Documentos Fiscais) rodoviário,
emitido pela Focus NFe para os CT-es autorizados de uma viagem. Usa a mesma
Configuração Fiscal e os mesmos tokens do CT-e (ver routers/fiscal.py).
Tudo restrito a administradores."""
import asyncio
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

import fiscal_cte
import fiscal_focus
import fiscal_mdfe
from fiscal_cte import only_digits
from fiscal_focus import FiscalProviderError
from models import CteCancelRequest, MdfeCloseRequest, MdfeCreate, MdfeDriverRequest
from routers import fiscal as fiscal_router
from shared import db, get_current_admin_user

api_router = APIRouter(prefix="/api")

EDITABLE_STATUSES = fiscal_router.EDITABLE_STATUSES
BRT = timezone(timedelta(hours=-3))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _get_mdfe_or_404(mdfe_id: str) -> dict:
    doc = await db.mdfes.find_one({"id": mdfe_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="MDF-e não encontrado")
    return doc


async def _resolve_places(mdfe: dict) -> dict:
    """Completa os códigos IBGE de carregamento/descarregamento pelo nome."""
    for place in [*(mdfe.get("municipios_carregamento") or []), *(mdfe.get("descarregamentos") or [])]:
        if not re.fullmatch(r"\d{7}", only_digits(place.get("codigo_municipio"))):
            code = await fiscal_router._codigo_municipio(place.get("cidade"), place.get("uf"))
            if code:
                place["codigo_municipio"] = code
    return mdfe


def _kg(value) -> Optional[int]:
    """Peso digitado no cadastro ("24.500", "3800 kg", "24,5 t") em kg inteiros."""
    text = str(value or "").strip().lower()
    if not text:
        return None
    tons = "t" in text.replace("kg", "")
    number = re.sub(r"[^\d,\.]", "", text)
    if not number:
        return None
    if "," in number:
        number = number.replace(".", "").replace(",", ".")
    elif number.count(".") == 1 and len(number.split(".")[1]) == 3:
        number = number.replace(".", "")  # 24.500 = milhar
    try:
        kg = float(number) * (1000 if tons else 1)
    except ValueError:
        return None
    return int(round(kg)) or None


async def _vehicle_from_plate(plate: Optional[str], uf: str, trailer: bool) -> Optional[dict]:
    plate = fiscal_mdfe._plate(plate)
    if not plate:
        return None
    vehicles = await db.vehicles.find({}, {"_id": 0}).to_list(None)
    vehicle = next((v for v in vehicles if fiscal_mdfe._plate(v.get("plate")) == plate), None) or {}
    category = (vehicle.get("category") or "").upper()
    data = {
        "vehicle_id": vehicle.get("id"),
        "placa": plate,
        "renavam": vehicle.get("renavam"),
        "tara": _kg(vehicle.get("tare_weight")),
        "capacidade_kg": _kg(vehicle.get("load_capacity")),
        "tipo_carroceria": "04" if trailer else ("00" if category == "TRACAO" or not vehicle else None),
        "uf_licenciamento": uf,
    }
    if not trailer:
        data["tipo_rodado"] = "03" if (category == "TRACAO" or not vehicle) else None
    return data


def _contractor_of(cte: dict) -> Optional[dict]:
    papel = cte.get("tomador_papel", 0)
    party = {0: cte.get("remetente"), 3: cte.get("destinatario"), 4: cte.get("tomador")}.get(papel) or {}
    if not party.get("cnpj_cpf"):
        return None
    return {"nome": party.get("nome"), "cnpj_cpf": only_digits(party.get("cnpj_cpf"))}


@api_router.get("/mdfes")
async def list_mdfes(search: Optional[str] = None, status: Optional[str] = None,
                     current_user: dict = Depends(get_current_admin_user)):
    query = {}
    if status:
        query["status"] = status
    if search:
        escaped = re.escape(search.strip())
        query["$or"] = [
            {"veiculo.placa": {"$regex": escaped, "$options": "i"}},
            {"condutores.nome": {"$regex": escaped, "$options": "i"}},
            {"descarregamentos.cidade": {"$regex": escaped, "$options": "i"}},
            {"chave": {"$regex": escaped}},
        ]
        if search.strip().isdigit():
            query["$or"].append({"numero": int(search.strip())})
    return await db.mdfes.find(query, {"_id": 0}).sort("created_at", -1).to_list(None)


@api_router.get("/mdfes/from-ctes")
async def mdfe_draft_from_ctes(ids: str = Query(...), current_user: dict = Depends(get_current_admin_user)):
    """Rascunho (não salvo) de MDF-e com os CT-es autorizados escolhidos:
    origens viram municípios de carregamento, destinos viram descarregamentos
    com as chaves, e veículo/carreta/motorista vêm da Ordem de Carregamento."""
    cte_ids = [i for i in ids.split(",") if i]
    ctes = await db.ctes.find({"id": {"$in": cte_ids}}, {"_id": 0}).to_list(None)
    if not ctes:
        raise HTTPException(status_code=404, detail="Nenhum CT-e encontrado")
    pending = [str(c.get("numero") or "-") for c in ctes if c.get("status") != "AUTORIZADO" or not c.get("chave")]
    if pending:
        raise HTTPException(status_code=400, detail="Só CT-e autorizado entra no MDF-e (verifique: " + ", ".join(pending) + ")")
    if len({c.get("ambiente") for c in ctes}) > 1:
        raise HTTPException(status_code=400, detail="Não misture CT-es de homologação e de produção no mesmo MDF-e")
    settings = await fiscal_router.get_fiscal_settings()
    ctes.sort(key=lambda c: c.get("numero") or 0)

    carregamento, descarregamentos, contratantes = [], {}, {}
    for cte in ctes:
        origem, destino = cte.get("origem") or {}, cte.get("destino") or {}
        place = {"cidade": origem.get("cidade"), "uf": origem.get("uf"), "codigo_municipio": origem.get("codigo_municipio")}
        if place not in carregamento:
            carregamento.append(place)
        key = (destino.get("cidade"), destino.get("uf"))
        descarregamentos.setdefault(key, {"cidade": destino.get("cidade"), "uf": destino.get("uf"),
                                          "codigo_municipio": destino.get("codigo_municipio"), "ctes": []})
        descarregamentos[key]["ctes"].append(cte["chave"])
        contractor = _contractor_of(cte)
        if contractor:
            contratantes.setdefault(contractor["cnpj_cpf"], contractor)

    peso = sum(float(q.get("quantidade") or 0) for c in ctes for q in c.get("quantidades") or []
               if (q.get("unidade") or "01") == "01")
    valor = sum(float(c.get("valor_carga") or 0) for c in ctes)
    uf_emit = ((settings.get("endereco") or {}).get("uf") or "").upper() or None

    veiculo, reboques, condutores = None, [], []
    # Motorista e veículos informados no CT-e; sem eles, os da Ordem de Carregamento
    trip = next((c for c in ctes if c.get("veiculo_placa") or (c.get("motorista") or {}).get("nome")), None)
    if trip:
        veiculo = await _vehicle_from_plate(trip.get("veiculo_placa"), uf_emit, trailer=False)
        for placa in trip.get("reboque_placas") or []:
            trailer = await _vehicle_from_plate(placa, uf_emit, trailer=True)
            if trailer:
                reboques.append(trailer)
        motorista = trip.get("motorista") or {}
        if motorista.get("nome") or motorista.get("cpf"):
            condutores.append({"driver_id": motorista.get("driver_id"), "nome": motorista.get("nome"), "cpf": only_digits(motorista.get("cpf"))})
    order_id = next((c.get("loading_order_id") for c in ctes if c.get("loading_order_id")), None)
    order = await db.loading_orders.find_one({"id": order_id}, {"_id": 0}) if order_id and not trip else None
    if order:
        veiculo = await _vehicle_from_plate(order.get("truck_plate"), uf_emit, trailer=False)
        trailer = await _vehicle_from_plate(order.get("trailer_plate"), uf_emit, trailer=True)
        if trailer:
            reboques.append(trailer)
        driver = await db.drivers.find_one({"id": order.get("driver_id")}, {"_id": 0}) if order.get("driver_id") else None
        nome = (driver or {}).get("name") or order.get("driver_name")
        cpf = (driver or {}).get("cpf") or order.get("driver_cpf")
        if nome or cpf:
            condutores.append({"driver_id": (driver or {}).get("id"), "nome": nome, "cpf": only_digits(cpf)})

    # Seguro do CT-e (ou o padrão da Configuração Fiscal) e vale-pedágio nas observações
    insured = next((c for c in ctes if c.get("seguradora_nome") or c.get("seguro_apolice")), None) or {}
    seguro = insured if insured else settings
    averbacoes = list(dict.fromkeys(c["seguro_averbacao"] for c in ctes if c.get("seguro_averbacao")))
    obs = ["CT-e nº " + ", ".join(str(c.get("numero")) for c in ctes)]
    obs += [n for c in ctes for n in fiscal_cte.trip_notes({"vales_pedagio": c.get("vales_pedagio")})]

    first, last = ctes[0], ctes[-1]
    return MdfeCreate(
        cte_ids=[c["id"] for c in ctes],
        uf_inicio=(first.get("origem") or {}).get("uf"),
        uf_fim=(last.get("destino") or {}).get("uf"),
        municipios_carregamento=carregamento,
        descarregamentos=list(descarregamentos.values()),
        veiculo=veiculo,
        reboques=reboques,
        condutores=condutores,
        contratantes=list(contratantes.values()),
        seguro_responsavel=seguro.get("seguro_responsavel") or settings.get("seguro_responsavel"),
        seguradora_nome=seguro.get("seguradora_nome"),
        seguradora_cnpj=seguro.get("seguradora_cnpj"),
        seguro_apolice=seguro.get("seguro_apolice"),
        averbacoes=averbacoes,
        tipo_carga=settings.get("mdfe_tipo_carga") or "04",
        descricao_produto=next((c.get("produto_predominante") for c in ctes if c.get("produto_predominante")),
                               settings.get("produto_predominante")),
        valor_total_carga=round(valor, 2) or None,
        unidade_peso="01",
        peso_bruto=round(peso, 4) or None,
        observacoes=" | ".join(obs),
    ).model_dump()


@api_router.get("/mdfes/{mdfe_id}")
async def get_mdfe(mdfe_id: str, current_user: dict = Depends(get_current_admin_user)):
    return await _get_mdfe_or_404(mdfe_id)


@api_router.post("/mdfes")
async def create_mdfe(data: MdfeCreate, current_user: dict = Depends(get_current_admin_user)):
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
    await db.mdfes.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api_router.put("/mdfes/{mdfe_id}")
async def update_mdfe(mdfe_id: str, data: MdfeCreate, current_user: dict = Depends(get_current_admin_user)):
    update = {**data.model_dump(), "updated_at": _now_iso()}
    result = await db.mdfes.update_one({"id": mdfe_id, "status": {"$in": list(EDITABLE_STATUSES)}}, {"$set": update})
    if result.matched_count == 0:
        await _get_mdfe_or_404(mdfe_id)
        raise HTTPException(status_code=400, detail="Só é possível editar MDF-e em rascunho, rejeitado ou com erro")
    return await _get_mdfe_or_404(mdfe_id)


@api_router.delete("/mdfes/{mdfe_id}")
async def delete_mdfe(mdfe_id: str, current_user: dict = Depends(get_current_admin_user)):
    result = await db.mdfes.delete_one({"id": mdfe_id, "status": {"$in": list(EDITABLE_STATUSES)}})
    if result.deleted_count == 0:
        await _get_mdfe_or_404(mdfe_id)
        raise HTTPException(status_code=400, detail="MDF-e já transmitido não pode ser excluído (cancele ou encerre)")
    return {"message": "MDF-e excluído"}


def _context(mdfe: dict, settings: dict) -> tuple:
    ambiente = mdfe.get("ambiente") or settings.get("ambiente") or "homologacao"
    return ambiente, fiscal_router._emission_token(settings, ambiente)


async def _consult(mdfe: dict, settings: dict) -> dict:
    ambiente, token = _context(mdfe, settings)
    return fiscal_mdfe.provider_result(await fiscal_focus.get_mdfe(ambiente, token, mdfe["ref"]))


@api_router.post("/mdfes/{mdfe_id}/emitir")
async def emit_mdfe(mdfe_id: str, current_user: dict = Depends(get_current_admin_user)):
    mdfe = await _get_mdfe_or_404(mdfe_id)
    if mdfe["status"] not in EDITABLE_STATUSES:
        raise HTTPException(status_code=400, detail="Este MDF-e já foi transmitido")
    settings = await fiscal_router.get_fiscal_settings()
    if not fiscal_focus.is_configured():
        raise HTTPException(status_code=503, detail="Emissor fiscal não configurado no servidor")
    ambiente = settings.get("ambiente") or "homologacao"
    token = fiscal_router._emission_token(settings, ambiente)
    if not settings.get("provider_synced_at") or not token:
        raise HTTPException(status_code=400, detail="Envie o cadastro da empresa ao emissor (Configuração Fiscal)")
    await fiscal_router.resolve_municipalities({}, settings)
    await _resolve_places(mdfe)
    errors = fiscal_mdfe.validate(mdfe, settings)
    if errors:
        raise HTTPException(status_code=400, detail="Corrija antes de emitir: " + " | ".join(errors))

    lock = await db.mdfes.update_one(
        {"id": mdfe_id, "status": {"$in": list(EDITABLE_STATUSES)}},
        {"$set": {"status": "ENVIANDO", "updated_at": _now_iso()}},
    )
    if lock.matched_count == 0:
        raise HTTPException(status_code=409, detail="Este MDF-e já está sendo transmitido")

    tentativa = int(mdfe.get("tentativas") or 0) + 1
    ref = f"{mdfe_id.replace('-', '')}m{tentativa}"
    payload = fiscal_mdfe.build_payload(mdfe, settings)
    update = {
        "ref": ref, "ambiente": ambiente, "tentativas": tentativa, "motivo": None,
        "municipios_carregamento": mdfe.get("municipios_carregamento"),
        "descarregamentos": mdfe.get("descarregamentos"),
        "emitido_por": current_user.get("name"), "emitido_em": _now_iso(),
    }
    try:
        await fiscal_focus.emit_mdfe(ambiente, token, ref, payload)
        update["status"] = "PENDENTE"
        await db.mdfes.update_one({"id": mdfe_id}, {"$set": update})
        for attempt in range(fiscal_router.POLL_ATTEMPTS):
            await asyncio.sleep(fiscal_router.POLL_INTERVAL)
            result = await _consult({**mdfe, **update}, settings)
            if result["status"] != "PENDENTE" or attempt == fiscal_router.POLL_ATTEMPTS - 1:
                update.update(result)
                break
    except FiscalProviderError as e:
        if update.get("status") == "PENDENTE":
            await db.mdfes.update_one({"id": mdfe_id}, {"$set": update})
            return await _get_mdfe_or_404(mdfe_id)
        update.update({"status": "ERRO", "motivo": e.message})
        await db.mdfes.update_one({"id": mdfe_id}, {"$set": update})
        raise fiscal_router._provider_error(e)
    except Exception:
        update.update({"status": "ERRO", "motivo": "Falha inesperada ao transmitir; tente novamente"})
        await db.mdfes.update_one({"id": mdfe_id}, {"$set": update})
        raise
    await db.mdfes.update_one({"id": mdfe_id}, {"$set": update})
    if update.get("status") == "AUTORIZADO":
        await _link_ctes(mdfe, update)
    return await _get_mdfe_or_404(mdfe_id)


async def _link_ctes(mdfe: dict, result: dict):
    """Marca nos CT-es em qual MDF-e eles viajaram (aparece na tela do CT-e)."""
    if mdfe.get("cte_ids"):
        await db.ctes.update_many({"id": {"$in": mdfe["cte_ids"]}},
                                  {"$set": {"mdfe_id": mdfe["id"], "mdfe_numero": result.get("numero")}})


@api_router.post("/mdfes/{mdfe_id}/atualizar")
async def refresh_mdfe(mdfe_id: str, current_user: dict = Depends(get_current_admin_user)):
    mdfe = await _get_mdfe_or_404(mdfe_id)
    if not mdfe.get("ref"):
        raise HTTPException(status_code=400, detail="Este MDF-e ainda não foi transmitido")
    try:
        result = await _consult(mdfe, await fiscal_router.get_fiscal_settings())
    except FiscalProviderError as e:
        raise fiscal_router._provider_error(e)
    await db.mdfes.update_one({"id": mdfe_id}, {"$set": {**result, "updated_at": _now_iso()}})
    if result["status"] == "AUTORIZADO" and mdfe.get("status") != "AUTORIZADO":
        await _link_ctes(mdfe, result)
    return await _get_mdfe_or_404(mdfe_id)


def _event_message(event: dict) -> str:
    motivo = event.get("mensagem_sefaz") or event.get("mensagem") or event.get("status") or ""
    if event.get("status_sefaz") and event.get("mensagem_sefaz"):
        motivo = f"{event['status_sefaz']} - {motivo}"
    return motivo


@api_router.post("/mdfes/{mdfe_id}/encerrar")
async def close_mdfe(mdfe_id: str, data: MdfeCloseRequest, current_user: dict = Depends(get_current_admin_user)):
    """Encerramento obrigatório ao fim da viagem (sem ele a Sefaz recusa novo
    MDF-e para a mesma placa)."""
    mdfe = await _get_mdfe_or_404(mdfe_id)
    if mdfe["status"] != "AUTORIZADO":
        raise HTTPException(status_code=400, detail="Só é possível encerrar MDF-e autorizado")
    uf = (data.uf or "").upper()
    if uf not in fiscal_mdfe.UF_CODES or len((data.cidade or "").strip()) < 2:
        raise HTTPException(status_code=400, detail="Informe a cidade e a UF do encerramento")
    if not await fiscal_router._codigo_municipio(data.cidade, uf):
        raise HTTPException(status_code=400, detail="Município do encerramento não encontrado nessa UF")
    day = (data.data or datetime.now(BRT).strftime("%Y-%m-%d"))[:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise HTTPException(status_code=400, detail="Data do encerramento inválida")
    settings = await fiscal_router.get_fiscal_settings()
    ambiente, token = _context(mdfe, settings)
    try:
        event = await fiscal_focus.close_mdfe(ambiente, token, mdfe["ref"], day, uf, data.cidade.strip())
    except FiscalProviderError as e:
        raise fiscal_router._provider_error(e)
    if (event.get("status") or "").lower() != "encerrado":
        raise HTTPException(status_code=400, detail=f"Encerramento não aceito: {_event_message(event)}")
    await db.mdfes.update_one({"id": mdfe_id}, {"$set": {
        "status": "ENCERRADO",
        "encerramento": {"data": day, "cidade": data.cidade.strip(), "uf": uf, "motivo": _event_message(event),
                         "caminho_xml": event.get("caminho_xml"), "solicitado_por": current_user.get("name"),
                         "solicitado_em": _now_iso()},
        "updated_at": _now_iso(),
    }})
    return await _get_mdfe_or_404(mdfe_id)


@api_router.post("/mdfes/{mdfe_id}/incluir-condutor")
async def add_driver(mdfe_id: str, data: MdfeDriverRequest, current_user: dict = Depends(get_current_admin_user)):
    mdfe = await _get_mdfe_or_404(mdfe_id)
    if mdfe["status"] != "AUTORIZADO":
        raise HTTPException(status_code=400, detail="Só é possível incluir condutor em MDF-e autorizado")
    cpf, nome = only_digits(data.cpf), re.sub(r"\s+", " ", data.nome or "").strip()
    if len(cpf) != 11 or len(nome) < 2:
        raise HTTPException(status_code=400, detail="Informe o nome e o CPF (11 dígitos) do condutor")
    if any(only_digits(c.get("cpf")) == cpf for c in mdfe.get("condutores") or []):
        raise HTTPException(status_code=400, detail="Este condutor já está no MDF-e")
    settings = await fiscal_router.get_fiscal_settings()
    ambiente, token = _context(mdfe, settings)
    try:
        event = await fiscal_focus.add_driver_mdfe(ambiente, token, mdfe["ref"], nome, cpf)
    except FiscalProviderError as e:
        raise fiscal_router._provider_error(e)
    if (event.get("status") or "").lower() != "incluido":
        raise HTTPException(status_code=400, detail=f"Inclusão não aceita: {_event_message(event)}")
    await db.mdfes.update_one({"id": mdfe_id}, {
        "$push": {"condutores": {"driver_id": None, "nome": nome, "cpf": cpf, "incluido_em": _now_iso()}},
        "$set": {"updated_at": _now_iso()},
    })
    return await _get_mdfe_or_404(mdfe_id)


@api_router.post("/mdfes/{mdfe_id}/cancelar")
async def cancel_mdfe(mdfe_id: str, data: CteCancelRequest, current_user: dict = Depends(get_current_admin_user)):
    mdfe = await _get_mdfe_or_404(mdfe_id)
    if mdfe["status"] != "AUTORIZADO":
        raise HTTPException(status_code=400, detail="Só é possível cancelar MDF-e autorizado (encerrado não cancela)")
    justificativa = re.sub(r"\s+", " ", data.justificativa or "").strip()
    if not (15 <= len(justificativa) <= 255):
        raise HTTPException(status_code=400, detail="A justificativa deve ter entre 15 e 255 caracteres")
    settings = await fiscal_router.get_fiscal_settings()
    ambiente, token = _context(mdfe, settings)
    try:
        event = await fiscal_focus.cancel_mdfe(ambiente, token, mdfe["ref"], justificativa)
    except FiscalProviderError as e:
        raise fiscal_router._provider_error(e)
    if (event.get("status") or "").lower() != "cancelado":
        raise HTTPException(status_code=400, detail=f"Cancelamento não aceito: {_event_message(event)}")
    await db.mdfes.update_one({"id": mdfe_id}, {"$set": {
        "status": "CANCELADO",
        "cancelamento": {"justificativa": justificativa, "caminho_xml": event.get("caminho_xml_cancelamento"),
                         "solicitado_por": current_user.get("name"), "solicitado_em": _now_iso()},
        "updated_at": _now_iso(),
    }})
    # Os CT-es ficam livres para outro manifesto
    await db.ctes.update_many({"mdfe_id": mdfe_id}, {"$unset": {"mdfe_id": "", "mdfe_numero": ""}})
    return await _get_mdfe_or_404(mdfe_id)


async def _download(mdfe_id: str, kind: str) -> Response:
    mdfe = await _get_mdfe_or_404(mdfe_id)
    if not mdfe.get("ref") or mdfe["status"] not in ("AUTORIZADO", "ENCERRADO", "CANCELADO"):
        raise HTTPException(status_code=400, detail="Documento disponível só para MDF-e autorizado")
    settings = await fiscal_router.get_fiscal_settings()
    ambiente, token = _context(mdfe, settings)
    field = "caminho_damdfe" if kind == "pdf" else "caminho_xml"
    try:
        path = mdfe.get(field)
        if not path:
            path = (await _consult(mdfe, settings)).get(field)
            await db.mdfes.update_one({"id": mdfe_id}, {"$set": {field: path}})
        if not path:
            raise HTTPException(status_code=404, detail="Arquivo ainda não disponível no emissor fiscal")
        content = await fiscal_focus.download(path, ambiente, token)
    except FiscalProviderError as e:
        raise fiscal_router._provider_error(e)
    name = f"MDFe_{mdfe.get('numero')}_{mdfe.get('chave') or mdfe_id}.{kind}"
    media = "application/pdf" if kind == "pdf" else "application/xml"
    return Response(content=content, media_type=media, headers={"Content-Disposition": f"attachment; filename={name}"})


@api_router.get("/mdfes/{mdfe_id}/pdf")
async def mdfe_pdf(mdfe_id: str, current_user: dict = Depends(get_current_admin_user)):
    return await _download(mdfe_id, "pdf")


@api_router.get("/mdfes/{mdfe_id}/xml")
async def mdfe_xml(mdfe_id: str, current_user: dict = Depends(get_current_admin_user)):
    return await _download(mdfe_id, "xml")
