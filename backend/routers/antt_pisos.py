"""Tabelas de piso mínimo de frete da ANTT (coeficientes CCD e CC por
resolução/portaria, com início de vigência), cálculo para o CT-e e aviso de
nova publicação no DOU. Regras em antt_piso.py."""
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

import antt_piso
import geo_distancia
from shared import db, get_current_active_user, get_current_admin_user

api_router = APIRouter(prefix="/api")
BASE = "/fiscal/pisos-antt"


class AnttCoefficient(BaseModel):
    tabela: str = Field(pattern="^[ABCD]$")
    tipo_carga: int = Field(ge=1, le=12)
    eixos: int
    ccd: float = Field(gt=0)
    cc: float = Field(ge=0)


class AnttResolutionInput(BaseModel):
    resolucao: str = Field(min_length=3, max_length=120)  # ex.: "Portaria SUROC nº 22/2026"
    vigencia_inicio: date
    fator_retorno_vazio: Optional[float] = Field(default=None, ge=0, le=1)
    observacoes: Optional[str] = None
    # Dados de exemplo, que não são os oficiais: o cálculo avisa "TESTE"
    teste: bool = False
    coeficientes: List[AnttCoefficient] = []


def _check_axles(coefs: list):
    for c in coefs:
        if c.eixos not in antt_piso.EIXOS:
            raise HTTPException(status_code=400, detail=f"Número de eixos inválido: {c.eixos} (use 2, 3, 4, 5, 6, 7 ou 9)")


async def _get_or_404(res_id: str) -> dict:
    doc = await db.antt_pisos.find_one({"id": res_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Tabela ANTT não encontrada")
    return doc


@api_router.get(BASE + "/opcoes")
async def floor_options(current_user: dict = Depends(get_current_active_user)):
    return {"tabelas": [{"value": k, "label": v} for k, v in antt_piso.TABELAS.items()],
            "tipos_carga": [{"value": k, "label": f"{k} - {v}"} for k, v in antt_piso.TIPOS_CARGA.items()],
            "eixos": list(antt_piso.EIXOS), "tipo_carga_padrao": antt_piso.TIPO_CARGA_PADRAO}


@api_router.get(BASE)
async def list_resolutions(current_user: dict = Depends(get_current_active_user)):
    docs = await db.antt_pisos.find({}, {"_id": 0}).sort("vigencia_inicio", -1).to_list(200)
    today = date.today().isoformat()
    current = next((d["id"] for d in docs if d["vigencia_inicio"] <= today), None)
    for d in docs:
        d["total_coeficientes"] = len(d.get("coeficientes") or [])
        d["vigente"] = d["id"] == current
        d.pop("coeficientes", None)
    check = await db.antt_verificacoes.find_one({"_id": "dou"}, {"_id": 0}) or {}
    return {"items": docs, "verificacao": check, "publicacoes": await antt_piso.pending_publications()}


@api_router.get(BASE + "/calcular")
async def calculate(tabela: str = "A", tipo_carga: int = antt_piso.TIPO_CARGA_PADRAO, eixos: int = 0,
                    distancia_km: float = 0, retorno_vazio: bool = False, distancia_retorno_km: Optional[float] = None,
                    data: Optional[date] = None, current_user: dict = Depends(get_current_active_user)):
    """Prévia do piso na tela do CT-e (a data padrão é hoje)."""
    params = {"tabela": tabela, "tipo_carga": tipo_carga, "eixos": eixos, "distancia_km": distancia_km,
              "retorno_vazio": retorno_vazio, "distancia_retorno_km": distancia_retorno_km}
    return antt_piso.compute(await antt_piso.resolution_for(data or date.today()), params)


@api_router.get(BASE + "/distancia")
async def road_distance(origem_cidade: Optional[str] = None, origem_uf: Optional[str] = None, origem_codigo: Optional[str] = None,
                        destino_cidade: Optional[str] = None, destino_uf: Optional[str] = None, destino_codigo: Optional[str] = None,
                        current_user: dict = Depends(get_current_active_user)):
    """Distância rodoviária sugerida entre o início e o fim da prestação
    (IBGE + OSRM, gratuitos; ver geo_distancia.py)."""
    from routers.fiscal import _codigo_municipio
    origem = geo_distancia.plain_code(origem_codigo) or await _codigo_municipio(origem_cidade, origem_uf)
    destino = geo_distancia.plain_code(destino_codigo) or await _codigo_municipio(destino_cidade, destino_uf)
    if not origem or not destino:
        raise HTTPException(status_code=400, detail="Município de início ou de fim da prestação não encontrado (confira cidade e UF)")
    try:
        return await geo_distancia.road_distance_km(origem, destino)
    except geo_distancia.DistanceError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@api_router.get(BASE + "/publicacoes")
async def list_publications(current_user: dict = Depends(get_current_admin_user)):
    items = await db.antt_publicacoes.find({}, {"_id": 0}).sort("data", -1).to_list(100)
    check = await db.antt_verificacoes.find_one({"_id": "dou"}, {"_id": 0}) or {}
    return {"items": items, "verificacao": check}


@api_router.post(BASE + "/verificar")
async def check_now(current_user: dict = Depends(get_current_admin_user)):
    """Consulta o DOU agora (o mesmo que o agendador faz uma vez por dia)."""
    try:
        items = await antt_piso.fetch_dou_publications()
    except Exception as exc:  # site fora do ar, bloqueio, mudança de layout
        await antt_piso.store_publications([], error=str(exc)[:300])
        raise HTTPException(status_code=502, detail=f"Não foi possível consultar o Diário Oficial: {str(exc)[:200]}")
    await antt_piso.store_publications(items)
    return {"encontradas": len(items), "pendentes": await antt_piso.pending_publications()}


@api_router.post(BASE + "/publicacoes/{pub_id}/conferida")
async def mark_checked(pub_id: str, current_user: dict = Depends(get_current_admin_user)):
    result = await db.antt_publicacoes.update_one({"id": pub_id}, {"$set": {
        "conferida": True, "conferida_por": current_user.get("name"),
        "conferida_em": datetime.now(timezone.utc).isoformat()}})
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Publicação não encontrada")
    return {"ok": True}


@api_router.get(BASE + "/{res_id}")
async def get_resolution(res_id: str, current_user: dict = Depends(get_current_active_user)):
    return await _get_or_404(res_id)


@api_router.post(BASE)
async def create_resolution(data: AnttResolutionInput, current_user: dict = Depends(get_current_admin_user)):
    _check_axles(data.coeficientes)
    if await db.antt_pisos.find_one({"vigencia_inicio": data.vigencia_inicio.isoformat()}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Já existe uma tabela com essa data de início de vigência")
    doc = {**data.model_dump(mode="json"), "id": antt_piso.new_id(), "created_by_name": current_user.get("name"),
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.antt_pisos.insert_one(dict(doc))
    return doc


@api_router.put(BASE + "/{res_id}")
async def update_resolution(res_id: str, data: AnttResolutionInput, current_user: dict = Depends(get_current_admin_user)):
    await _get_or_404(res_id)
    _check_axles(data.coeficientes)
    clash = await db.antt_pisos.find_one({"vigencia_inicio": data.vigencia_inicio.isoformat(), "id": {"$ne": res_id}}, {"_id": 1})
    if clash:
        raise HTTPException(status_code=400, detail="Já existe outra tabela com essa data de início de vigência")
    update = {**data.model_dump(mode="json"), "updated_by_name": current_user.get("name"),
              "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.antt_pisos.update_one({"id": res_id}, {"$set": update})
    return await _get_or_404(res_id)


@api_router.delete(BASE + "/{res_id}")
async def delete_resolution(res_id: str, current_user: dict = Depends(get_current_admin_user)):
    await _get_or_404(res_id)
    # CT-es já calculados guardam o próprio cálculo; apagar a tabela não muda eles
    await db.antt_pisos.delete_one({"id": res_id})
    return {"ok": True}


@api_router.post(BASE + "/{res_id}/importar")
async def import_coefficients(res_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_admin_user)):
    """Planilha (.xlsx ou .csv) com tabela, tipo_carga, eixos, ccd e cc.
    Substitui os coeficientes da tabela. Qualquer linha com erro cancela a
    importação inteira (nada é gravado pela metade)."""
    await _get_or_404(res_id)
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Arquivo maior que 5 MB")
    try:
        items, errors = antt_piso.parse_coefficients(content, file.filename)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Não foi possível ler a planilha: {str(exc)[:200]}")
    if errors:
        raise HTTPException(status_code=400, detail={"mensagem": "Planilha com erros: nada foi importado", "erros": errors[:50]})
    if not items:
        raise HTTPException(status_code=400, detail="Nenhum coeficiente na planilha")
    await db.antt_pisos.update_one({"id": res_id}, {"$set": {
        "coeficientes": items, "importado_de": file.filename, "importado_por": current_user.get("name"),
        "importado_em": datetime.now(timezone.utc).isoformat()}})
    return {"importados": len(items)}
