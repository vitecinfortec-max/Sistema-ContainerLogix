"""Cliente da API da Focus NFe (emissor de CT-e / MDF-e).

A conta na Focus NFe é do dono do sistema: o token master dela fica só na
variável de ambiente FOCUSNFE_TOKEN do servidor, nunca no banco. Com ele o
sistema cadastra cada empresa emitente (com o próprio certificado A1, que é
repassado direto para a Focus e nunca fica gravado aqui). Cada empresa
cadastrada recebe da Focus um token de homologação e um de produção, usados
nas emissões dela - esses ficam na Configuração Fiscal da empresa e nunca
são devolvidos para o navegador.

Autenticação: HTTP Basic com o token como usuário e senha vazia.
"""
import os

import httpx

PRODUCTION_URL = os.environ.get("FOCUSNFE_API_URL", "https://api.focusnfe.com.br").rstrip("/")
HOMOLOGATION_URL = os.environ.get("FOCUSNFE_HOMOLOGACAO_URL", "https://homologacao.focusnfe.com.br").rstrip("/")
TIMEOUT = httpx.Timeout(60.0, connect=15.0)


class FiscalProviderError(Exception):
    """Erro devolvido pela Focus NFe (ou falha de comunicação com ela)."""

    def __init__(self, message: str, status_code: int = 502, details=None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.details = details


def master_token() -> str:
    return (os.environ.get("FOCUSNFE_TOKEN") or "").strip()


def is_configured() -> bool:
    return bool(master_token())


def base_url(ambiente: str) -> str:
    return PRODUCTION_URL if ambiente == "producao" else HOMOLOGATION_URL


def _error_message(response: httpx.Response) -> tuple:
    """Mensagem legível do erro da Focus ({"codigo", "mensagem", "erros": [...]})."""
    try:
        data = response.json()
    except Exception:
        text = (response.text or "").strip()
        if response.status_code == 401 or "Access denied" in text:
            return "Token do emissor fiscal recusado (acesso negado)", None
        return (text or f"HTTP {response.status_code}")[:500], None
    if isinstance(data, dict):
        message = data.get("mensagem") or data.get("codigo") or f"HTTP {response.status_code}"
        extra = []
        for item in data.get("erros") or []:
            if isinstance(item, dict):
                extra.extend(str(e) for e in (item.get("erros") or []))
                if item.get("mensagem"):
                    extra.append(str(item["mensagem"]))
            elif item:
                extra.append(str(item))
        if extra:
            message = f"{message}: " + "; ".join(extra)
        return message, data
    return f"HTTP {response.status_code}", data


async def request(method: str, url: str, token: str, *, json=None, params=None, allow_404: bool = False):
    if not token:
        raise FiscalProviderError("Emissor fiscal não configurado no servidor (FOCUSNFE_TOKEN)", status_code=503)
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
            response = await client.request(method, url, json=json, params=params, auth=(token, ""))
    except httpx.HTTPError as e:
        raise FiscalProviderError(f"Não foi possível conectar ao emissor fiscal: {e}")
    if allow_404 and response.status_code == 404:
        return None
    if response.status_code >= 400:
        message, data = _error_message(response)
        status = 400 if 400 <= response.status_code < 500 else 502
        raise FiscalProviderError(message, status_code=status, details=data)
    if response.status_code == 204 or not response.content:
        return {}
    return response.json()


async def download(url: str, ambiente: str, token: str) -> bytes:
    """Baixa o DACTE/XML. Os caminhos da Focus podem vir completos (S3) ou
    relativos ao servidor - os relativos exigem o token."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
            if url.startswith("http"):
                response = await client.get(url)
            else:
                response = await client.get(f"{base_url(ambiente)}{url}", auth=(token, ""))
    except httpx.HTTPError as e:
        raise FiscalProviderError(f"Não foi possível baixar o arquivo do emissor fiscal: {e}")
    if response.status_code >= 400:
        raise FiscalProviderError(f"Arquivo indisponível no emissor fiscal (HTTP {response.status_code})")
    return response.content


# ---------- Empresa (token master, sempre no servidor de produção) ----------

async def find_company(cnpj: str):
    rows = await request("GET", f"{PRODUCTION_URL}/v2/empresas", master_token(), params={"cnpj": cnpj})
    if isinstance(rows, list) and rows:
        return rows[0]
    return None


async def save_company(cnpj: str, payload: dict, company_id=None) -> dict:
    """Cria a empresa na Focus NFe, ou atualiza se ela já existir."""
    if not company_id:
        existing = await find_company(cnpj)
        company_id = existing.get("id") if existing else None
    if company_id:
        return await request("PUT", f"{PRODUCTION_URL}/v2/empresas/{company_id}", master_token(), json=payload)
    return await request("POST", f"{PRODUCTION_URL}/v2/empresas", master_token(), json=payload)


# ---------- CT-e (token da empresa, servidor do ambiente) ----------

async def emit_cte(ambiente: str, token: str, ref: str, payload: dict) -> dict:
    return await request("POST", f"{base_url(ambiente)}/v2/cte", token, params={"ref": ref}, json=payload)


async def get_cte(ambiente: str, token: str, ref: str) -> dict:
    return await request("GET", f"{base_url(ambiente)}/v2/cte/{ref}", token)


async def cancel_cte(ambiente: str, token: str, ref: str, justificativa: str) -> dict:
    return await request("DELETE", f"{base_url(ambiente)}/v2/cte/{ref}", token, json={"justificativa": justificativa})
