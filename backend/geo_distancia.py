"""Distância rodoviária aproximada entre dois municípios, para o piso mínimo
da ANTT, só com serviços gratuitos e sem cadastro:

- coordenadas: centro (centroide) do município na API de malhas do IBGE
  (servicodados.ibge.gov.br/api/v3/malhas/municipios/{código}/metadados);
- rota: servidor público do OSRM (router.project-osrm.org), que calcula o
  caminho pelas estradas do OpenStreetMap.

Cada município e cada par origem-destino ficam guardados no banco
(geo_municipios e geo_distancias): a mesma rota não é consultada de novo, o
que poupa os serviços públicos (o OSRM público pede uso moderado, sem
garantia de disponibilidade). A distância é de centro a centro do município:
é uma sugestão, que a pessoa pode corrigir na tela. Se um serviço falhar, a
tela continua aceitando a distância digitada."""
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

from shared import db

logger = logging.getLogger(__name__)

IBGE_CENTROID_URL = "https://servicodados.ibge.gov.br/api/v3/malhas/municipios/{code}/metadados"
OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}"
HEADERS = {"User-Agent": "ContainerLogix/1.0 (calculo de piso minimo de frete)"}
TIMEOUT = 20


class DistanceError(Exception):
    """Serviço de coordenadas ou de rota indisponível / sem resposta útil."""


async def municipality_centroid(code: str, client: httpx.AsyncClient) -> dict:
    cached = await db.geo_municipios.find_one({"codigo": code}, {"_id": 0})
    if cached:
        return cached
    try:
        response = await client.get(IBGE_CENTROID_URL.format(code=code))
        response.raise_for_status()
        centro = (response.json() or [{}])[0].get("centroide") or {}
        lat, lon = float(centro["latitude"]), float(centro["longitude"])
    except Exception as exc:
        raise DistanceError(f"IBGE não devolveu as coordenadas do município {code}") from exc
    doc = {"codigo": code, "latitude": lat, "longitude": lon, "fonte": "IBGE (centroide)",
           "obtido_em": datetime.now(timezone.utc).isoformat()}
    await db.geo_municipios.update_one({"codigo": code}, {"$set": doc}, upsert=True)
    return doc


async def road_distance_km(origem: str, destino: str) -> dict:
    """Distância rodoviária (km) entre dois municípios (códigos IBGE)."""
    if not (origem and destino):
        raise DistanceError("Informe os municípios de início e fim da prestação")
    if origem == destino:
        return {"origem": origem, "destino": destino, "km": 0.0, "fonte": "mesmo município", "cache": True}
    key = f"{origem}-{destino}"
    cached = await db.geo_distancias.find_one({"id": key}, {"_id": 0})
    if cached:
        return {**cached, "cache": True}
    async with httpx.AsyncClient(timeout=TIMEOUT, headers=HEADERS, follow_redirects=True) as client:
        a = await municipality_centroid(origem, client)
        b = await municipality_centroid(destino, client)
        try:
            response = await client.get(OSRM_ROUTE_URL.format(lon1=a["longitude"], lat1=a["latitude"],
                                                              lon2=b["longitude"], lat2=b["latitude"]),
                                        params={"overview": "false"})
            response.raise_for_status()
            data = response.json()
            if data.get("code") != "Ok" or not data.get("routes"):
                raise ValueError(data.get("code"))
            km = round(float(data["routes"][0]["distance"]) / 1000, 1)
        except Exception as exc:
            logger.warning(f"OSRM sem rota {key}: {exc}")
            raise DistanceError("O serviço de rotas não respondeu agora: informe a distância à mão") from exc
    doc = {"id": key, "origem": origem, "destino": destino, "km": km,
           "fonte": "OSRM / OpenStreetMap (centro a centro dos municípios)",
           "calculado_em": datetime.now(timezone.utc).isoformat()}
    await db.geo_distancias.update_one({"id": key}, {"$set": doc}, upsert=True)
    return {**doc, "cache": False}


def plain_code(value) -> Optional[str]:
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    return digits if len(digits) == 7 else None
