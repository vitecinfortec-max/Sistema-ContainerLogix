import logging
import re

import requests
from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool

from shared import get_current_active_user

logger = logging.getLogger(__name__)

api_router = APIRouter(prefix="/api")

# Busca de endereço/dados de empresa em serviços públicos externos, pra
# agilizar o preenchimento dos cadastros (Transportadora/Fornecedor/
# Seguradora/Cliente/Terminal). Sem chave de API - ambos os serviços usados
# (ViaCEP, BrasilAPI) são gratuitos e não exigem autenticação.
#
# requests.get é síncrono/bloqueante - rodado via run_in_threadpool pra não
# travar o event loop (single worker) inteiro enquanto espera o serviço
# externo responder, o que congelaria a API pra todos os outros usuários
# durante esse tempo (confirmado na prática: uma consulta CNPJ lenta
# atrasou visivelmente uma consulta CEP concorrente até rodar essa correção).


@api_router.get("/lookup/cep/{cep}")
async def lookup_cep(cep: str, current_user: dict = Depends(get_current_active_user)):
    digits = re.sub(r"\D", "", cep)
    if len(digits) != 8:
        raise HTTPException(status_code=400, detail="CEP inválido")
    try:
        response = await run_in_threadpool(requests.get, f"https://viacep.com.br/ws/{digits}/json/", timeout=8)
        data = response.json()
    except Exception as e:
        logger.error(f"Erro ao consultar CEP {digits}: {e}")
        raise HTTPException(status_code=502, detail="Não foi possível consultar o CEP no momento")
    if not response.ok or data.get("erro"):
        raise HTTPException(status_code=404, detail="CEP não encontrado")
    return {
        "street": data.get("logradouro") or "",
        "neighborhood": data.get("bairro") or "",
        "city": data.get("localidade") or "",
        "state": data.get("uf") or "",
    }


@api_router.get("/lookup/cnpj/{cnpj}")
async def lookup_cnpj(cnpj: str, current_user: dict = Depends(get_current_active_user)):
    digits = re.sub(r"\D", "", cnpj)
    if len(digits) != 14:
        raise HTTPException(status_code=400, detail="CNPJ inválido")
    try:
        response = await run_in_threadpool(requests.get, f"https://brasilapi.com.br/api/cnpj/v1/{digits}", timeout=10)
    except Exception as e:
        logger.error(f"Erro ao consultar CNPJ {digits}: {e}")
        raise HTTPException(status_code=502, detail="Não foi possível consultar o CNPJ no momento")
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="CNPJ não encontrado")
    if not response.ok:
        logger.error(f"Consulta de CNPJ {digits} retornou {response.status_code}: {response.text[:200]}")
        raise HTTPException(status_code=502, detail="Não foi possível consultar o CNPJ no momento")
    data = response.json()
    return {
        "name": data.get("razao_social") or "",
        "trade_name": data.get("nome_fantasia") or "",
        "street": data.get("logradouro") or "",
        "number": data.get("numero") or "",
        "neighborhood": data.get("bairro") or "",
        "zip": data.get("cep") or "",
        "city": data.get("municipio") or "",
        "state": data.get("uf") or "",
        "phone": data.get("ddd_telefone_1") or "",
        "email": data.get("email") or "",
    }
