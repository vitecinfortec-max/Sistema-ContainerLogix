"""Piso mínimo de frete da ANTT (Política Nacional de Pisos Mínimos do
Transporte Rodoviário de Cargas - Lei 13.703/2018, Resolução ANTT
5.867/2020 e atualizações).

    piso = distância (km) × CCD + CC
    com retorno vazio: + distância de retorno × CCD × fator do retorno

CCD = coeficiente de custo de deslocamento (R$/km) e CC = coeficiente de
custo de carga e descarga (R$), por tabela (A-D), tipo de carga (1-12) e
número de eixos carregados. Nenhum coeficiente fica no código: cada
resolução/portaria é cadastrada (ou importada por planilha) na coleção
`antt_pisos` com a data de início de vigência, inclusive o fator do retorno
vazio, e o cálculo usa a que vale na data de emissão do CT-e.

Verificação de publicações: uma vez por dia o sistema consulta a busca do
Diário Oficial da União (in.gov.br) por atos da ANTT sobre pisos mínimos e
avisa quando aparece algo mais novo que a tabela cadastrada. É só um aviso:
os coeficientes nunca são atualizados sozinhos."""
import csv
import io
import json
import logging
import re
import unicodedata
import uuid
from datetime import date, datetime, timezone
from typing import Optional

import httpx

from shared import db

logger = logging.getLogger(__name__)

TABELAS = {
    "A": "A - Transporte rodoviário de carga lotação",
    "B": "B - Contratação apenas do veículo automotor de cargas",
    "C": "C - Carga lotação de alto desempenho",
    "D": "D - Apenas do veículo automotor de cargas de alto desempenho",
}
TIPOS_CARGA = {
    1: "Granel sólido", 2: "Granel líquido", 3: "Frigorificada ou aquecida", 4: "Conteinerizada",
    5: "Carga geral", 6: "Neogranel", 7: "Perigosa (granel sólido)", 8: "Perigosa (granel líquido)",
    9: "Perigosa (frigorificada ou aquecida)", 10: "Perigosa (conteinerizada)", 11: "Perigosa (carga geral)",
    12: "Carga granel pressurizada",
}
EIXOS = (2, 3, 4, 5, 6, 7, 9)
TIPO_CARGA_PADRAO = 4  # conteinerizada


def _round(value: float, places: int = 2) -> float:
    return round(float(value) + 0.0, places)


def find_coefficient(resolution: dict, tabela: str, tipo_carga: int, eixos: int) -> Optional[dict]:
    for c in (resolution or {}).get("coeficientes") or []:
        if c.get("tabela") == tabela and int(c.get("tipo_carga") or 0) == int(tipo_carga) and int(c.get("eixos") or 0) == int(eixos):
            return c
    return None


def compute(resolution: dict, params: dict) -> dict:
    """Piso mínimo para os parâmetros do CT-e (tabela, tipo de carga, eixos,
    distância, retorno vazio). Devolve o detalhe do cálculo ou o motivo de
    não ter calculado (sem tabela vigente, sem coeficiente, sem distância)."""
    tabela = (params.get("tabela") or "A").upper()
    tipo_carga = int(params.get("tipo_carga") or TIPO_CARGA_PADRAO)
    eixos = int(params.get("eixos") or 0)
    distancia = float(params.get("distancia_km") or 0)
    retorno = bool(params.get("retorno_vazio"))
    distancia_retorno = float(params.get("distancia_retorno_km") or distancia) if retorno else 0.0
    out = {"tabela": tabela, "tipo_carga": tipo_carga, "eixos": eixos, "distancia_km": distancia,
           "retorno_vazio": retorno, "distancia_retorno_km": distancia_retorno, "valor_piso": None}
    if not resolution:
        return {**out, "motivo": "Nenhuma tabela ANTT vigente cadastrada para a data"}
    out.update({"resolucao_id": resolution.get("id"), "resolucao": resolution.get("resolucao"),
                "vigencia_inicio": resolution.get("vigencia_inicio"), "teste": bool(resolution.get("teste"))})
    if eixos not in EIXOS:
        return {**out, "motivo": "Informe o número de eixos carregados"}
    if distancia <= 0:
        return {**out, "motivo": "Informe a distância (km)"}
    coef = find_coefficient(resolution, tabela, tipo_carga, eixos)
    if not coef:
        return {**out, "motivo": f"A tabela {resolution.get('resolucao')} não tem coeficiente para tabela {tabela}, "
                                 f"tipo de carga {tipo_carga} e {eixos} eixos"}
    ccd, cc = float(coef["ccd"]), float(coef["cc"])
    ida = distancia * ccd + cc
    fator = float(resolution.get("fator_retorno_vazio") or 0)
    if retorno and not fator:
        return {**out, "ccd": ccd, "cc": cc,
                "motivo": f"A tabela {resolution.get('resolucao')} não tem o fator do retorno vazio cadastrado"}
    volta = distancia_retorno * ccd * fator if retorno else 0.0
    return {**out, "ccd": ccd, "cc": cc, "fator_retorno_vazio": fator if retorno else None,
            "valor_ida": _round(ida), "valor_retorno": _round(volta), "valor_piso": _round(ida + volta)}


def freight_for_floor(cte: dict) -> float:
    """Valor do frete comparado ao piso: total da prestação sem o pedágio (o
    piso da ANTT não inclui pedágio)."""
    total = float(cte.get("valor_total") or 0)
    pedagio = sum(float(c.get("valor") or 0) for c in cte.get("componentes") or []
                  if (c.get("nome") or "").strip().upper() in ("PEDAGIO", "PEDÁGIO"))
    return _round(total - pedagio)


async def resolution_for(day: date) -> Optional[dict]:
    """Tabela vigente na data: a de maior início de vigência que já começou."""
    return await db.antt_pisos.find_one({"vigencia_inicio": {"$lte": day.isoformat()}}, {"_id": 0},
                                        sort=[("vigencia_inicio", -1)])


async def calculate_for_cte(cte: dict, day: date) -> Optional[dict]:
    """Cálculo do piso para gravar no CT-e (fica congelado depois da emissão)."""
    params = cte.get("frete_minimo") or None
    if not params:
        return None
    result = compute(await resolution_for(day), params)
    frete = freight_for_floor(cte)
    result.update({"data_referencia": day.isoformat(), "valor_frete": frete,
                   "abaixo_do_piso": result.get("valor_piso") is not None and frete < result["valor_piso"],
                   "calculado_em": datetime.now(timezone.utc).isoformat()})
    return result


# ==================== IMPORTAÇÃO DE PLANILHA ====================

def _norm(text) -> str:
    text = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", text.lower())


HEADERS = {"tabela": "tabela", "tipocarga": "tipo_carga", "tipodecarga": "tipo_carga", "eixos": "eixos",
           "numeroeixos": "eixos", "neixos": "eixos", "ccd": "ccd", "cc": "cc"}


def _number(value) -> Optional[float]:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace("R$", "").strip()
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def _rows_from_file(content: bytes, filename: str) -> list:
    name = (filename or "").lower()
    if name.endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook
        sheet = load_workbook(io.BytesIO(content), read_only=True, data_only=True).active
        return [list(r) for r in sheet.iter_rows(values_only=True)]
    text = content.decode("utf-8-sig", errors="replace")
    dialect = csv.Sniffer().sniff(text.splitlines()[0] if text else ",", delimiters=";,\t")
    return [row for row in csv.reader(io.StringIO(text), dialect)]


def parse_coefficients(content: bytes, filename: str):
    """Planilha (.xlsx ou .csv) com as colunas tabela, tipo_carga, eixos, ccd e
    cc -> (coeficientes, erros por linha). Aceita vírgula decimal."""
    rows = [r for r in _rows_from_file(content, filename) if any(c not in (None, "") for c in r)]
    if not rows:
        return [], ["Planilha vazia"]
    columns = {}
    for i, header in enumerate(rows[0]):
        key = HEADERS.get(_norm(header))
        if key and key not in columns:
            columns[key] = i
    missing = [k for k in ("tabela", "tipo_carga", "eixos", "ccd", "cc") if k not in columns]
    if missing:
        return [], [f"Colunas obrigatórias não encontradas: {', '.join(missing)} (cabeçalho na 1ª linha)"]
    items, errors, seen = [], [], set()
    for n, row in enumerate(rows[1:], start=2):
        cell = lambda k: row[columns[k]] if columns[k] < len(row) else None  # noqa: E731
        tabela = str(cell("tabela") or "").strip().upper()[:1]
        tipo, eixos = _number(cell("tipo_carga")), _number(cell("eixos"))
        ccd, cc = _number(cell("ccd")), _number(cell("cc"))
        problems = []
        if tabela not in TABELAS:
            problems.append("tabela deve ser A, B, C ou D")
        if tipo is None or int(tipo) != tipo or int(tipo) not in TIPOS_CARGA:
            problems.append("tipo de carga deve ser de 1 a 12")
        if eixos is None or int(eixos) != eixos or int(eixos) not in EIXOS:
            problems.append("eixos deve ser 2, 3, 4, 5, 6, 7 ou 9")
        if ccd is None or ccd <= 0:
            problems.append("CCD inválido")
        if cc is None or cc < 0:
            problems.append("CC inválido")
        if problems:
            errors.append(f"Linha {n}: {'; '.join(problems)}")
            continue
        key = (tabela, int(tipo), int(eixos))
        if key in seen:
            errors.append(f"Linha {n}: tabela {tabela}, tipo {int(tipo)}, {int(eixos)} eixos repetido")
            continue
        seen.add(key)
        items.append({"tabela": tabela, "tipo_carga": int(tipo), "eixos": int(eixos),
                      "ccd": round(ccd, 4), "cc": round(cc, 2)})
    return items, errors


# ==================== AVISO DE NOVA PUBLICAÇÃO (DOU) ====================

DOU_SEARCH = "https://www.in.gov.br/consulta/-/buscar/dou"
DOU_QUERIES = ('"pisos mínimos de frete"', '"PORTARIA SUROC" piso')
ANTT_HIERARCHY = "Agência Nacional de Transportes Terrestres"
_PARAMS_RE = re.compile(r'id="_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params"[^>]*>(.*?)</script>', re.S)


def parse_dou_results(page: str) -> list:
    """Página de resultados da busca do DOU -> atos da ANTT que tratam de
    piso mínimo de frete: [{id, titulo, data (YYYY-MM-DD), url}]."""
    match = _PARAMS_RE.search(page or "")
    if not match:
        raise ValueError("formato da página de busca do DOU mudou (bloco de resultados não encontrado)")
    items = []
    for a in json.loads(match.group(1)).get("jsonArray") or []:
        if ANTT_HIERARCHY not in (a.get("hierarchyStr") or ""):
            continue
        title = re.sub(r"<[^>]+>", "", a.get("title") or "").strip()
        content = re.sub(r"<[^>]+>", "", a.get("content") or "")
        if not re.search(r"RESOLU|PORTARIA SUROC", title, re.I):
            continue
        if "piso" not in (title + " " + content).lower():
            continue
        try:
            day = datetime.strptime(a.get("pubDate") or "", "%d/%m/%Y").date().isoformat()
        except ValueError:
            continue
        slug = a.get("urlTitle") or title
        items.append({"id": slug, "titulo": title, "data": day,
                      "url": f"https://www.in.gov.br/en/web/dou/-/{a['urlTitle']}" if a.get("urlTitle") else None})
    return items


async def fetch_dou_publications() -> list:
    found = {}
    async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"}) as client:
        for query in DOU_QUERIES:
            response = await client.get(DOU_SEARCH, params={"q": query, "s": "do1", "exactDate": "ano",
                                                            "sortType": "0", "delta": "50"})
            response.raise_for_status()
            for item in parse_dou_results(response.text):
                found[item["id"]] = item
    return sorted(found.values(), key=lambda x: x["data"], reverse=True)


async def store_publications(items: list, error: Optional[str] = None):
    """Grava o resultado da verificação no banco da empresa atual."""
    now = datetime.now(timezone.utc).isoformat()
    for item in items:
        await db.antt_publicacoes.update_one({"id": item["id"]}, {"$setOnInsert": {**item, "conferida": False, "vista_em": now}},
                                             upsert=True)
    await db.antt_verificacoes.update_one({"_id": "dou"}, {"$set": {"verificado_em": now, "erro": error,
                                                                     "encontradas": len(items)}}, upsert=True)


async def pending_publications() -> list:
    """Publicações ainda não conferidas e mais novas que a tabela vigente
    cadastrada (a partir da data de início de vigência dela)."""
    latest = await db.antt_pisos.find_one({}, {"_id": 0, "vigencia_inicio": 1}, sort=[("vigencia_inicio", -1)])
    query = {"conferida": False}
    if latest:
        query["data"] = {"$gt": latest["vigencia_inicio"]}
    return await db.antt_publicacoes.find(query, {"_id": 0}).sort("data", -1).to_list(20)


async def floor_alerts() -> list:
    """Avisos para o sino do topo (administradores)."""
    alerts = []
    pending = await pending_publications()
    if pending:
        first = pending[0]
        alerts.append({"key": "antt-nova-publicacao", "tone": "amber", "path": "/fiscal/pisos-antt",
                       "title": "ANTT: possível nova tabela de piso mínimo",
                       "description": f"{first['titulo']} ({first['data'][8:10]}/{first['data'][5:7]}/{first['data'][:4]})"
                                      + (f" e mais {len(pending) - 1}" if len(pending) > 1 else "") + " - conferir"})
    return alerts


async def run_daily_check():
    """Agendador: consulta o DOU uma vez e grava o resultado no banco de cada
    empresa (com MULTI_TENANT) ou no banco único. Falha na consulta só fica
    registrada (aparece na tela de Pisos ANTT); não derruba nada."""
    from tenancy import active_tenants, is_multi_tenant, tenant_context
    items, error = [], None
    try:
        items = await fetch_dou_publications()
    except Exception as exc:
        error = str(exc)[:300]
        logger.warning(f"Verificação de pisos ANTT no DOU falhou: {error}")
    if not is_multi_tenant():
        await store_publications(items, error)
        return
    for tenant in await active_tenants():
        with tenant_context(tenant):
            try:
                await store_publications(items, error)
            except Exception:
                logger.exception(f"Falha ao gravar a verificação ANTT da empresa {tenant['slug']}")


def new_id() -> str:
    return str(uuid.uuid4())
