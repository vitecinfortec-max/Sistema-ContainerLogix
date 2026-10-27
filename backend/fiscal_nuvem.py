"""Cliente da API da Nuvem Fiscal (emissor de CT-e / MDF-e).

A conta na Nuvem Fiscal é do dono do sistema: as credenciais ficam só nas
variáveis de ambiente do servidor (NUVEMFISCAL_CLIENT_ID e
NUVEMFISCAL_CLIENT_SECRET), nunca no banco. Cada empresa que usa o sistema é
cadastrada lá pelo CNPJ, com o próprio certificado A1 - o certificado é
repassado direto para a Nuvem Fiscal e nunca fica gravado aqui.

NUVEMFISCAL_API_URL troca o endereço da API (ex.: o sandbox
https://api.sandbox.nuvemfiscal.com.br). Produção x homologação da Sefaz é
outra coisa: vai em cada documento ("ambiente"), escolhido na Configuração
Fiscal da empresa.
"""
import os
import time

import httpx

API_URL = os.environ.get("NUVEMFISCAL_API_URL", "https://api.nuvemfiscal.com.br").rstrip("/")
AUTH_URL = os.environ.get("NUVEMFISCAL_AUTH_URL", "https://auth.nuvemfiscal.com.br/oauth/token")
SCOPES = "empresa cep cte mdfe"
TIMEOUT = httpx.Timeout(60.0, connect=15.0)

# token -> válido até (epoch); o token da Nuvem Fiscal dura 30 dias
_token_cache = {"token": None, "expires_at": 0.0, "client_id": None}


class FiscalProviderError(Exception):
    """Erro devolvido pela Nuvem Fiscal (ou falha de comunicação com ela)."""

    def __init__(self, message: str, status_code: int = 502, details=None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.details = details


def credentials():
    client_id = (os.environ.get("NUVEMFISCAL_CLIENT_ID") or "").strip()
    client_secret = (os.environ.get("NUVEMFISCAL_CLIENT_SECRET") or "").strip()
    return client_id, client_secret


def is_configured() -> bool:
    client_id, client_secret = credentials()
    return bool(client_id and client_secret)


def _error_message(response: httpx.Response) -> tuple:
    """Tira a mensagem legível do corpo de erro da Nuvem Fiscal
    ({"error": {"code", "message", "errors": [...]}})."""
    try:
        data = response.json()
    except Exception:
        return (response.text or f"HTTP {response.status_code}")[:500], None
    error = data.get("error") if isinstance(data, dict) else None
    if isinstance(error, dict):
        message = error.get("message") or error.get("code") or f"HTTP {response.status_code}"
        extra = [e.get("message") for e in (error.get("errors") or []) if isinstance(e, dict) and e.get("message")]
        if extra:
            message = f"{message}: " + "; ".join(extra)
        return message, data
    if isinstance(data, dict) and data.get("message"):
        return data["message"], data
    return f"HTTP {response.status_code}", data


async def _get_token() -> str:
    client_id, client_secret = credentials()
    if not (client_id and client_secret):
        raise FiscalProviderError(
            "Emissor fiscal não configurado no servidor (NUVEMFISCAL_CLIENT_ID / NUVEMFISCAL_CLIENT_SECRET)",
            status_code=503,
        )
    now = time.time()
    if _token_cache["token"] and _token_cache["client_id"] == client_id and _token_cache["expires_at"] > now + 60:
        return _token_cache["token"]
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(AUTH_URL, data={
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
                "scope": SCOPES,
            })
    except httpx.HTTPError as e:
        raise FiscalProviderError(f"Não foi possível conectar ao emissor fiscal: {e}")
    if response.status_code != 200:
        message, _ = _error_message(response)
        raise FiscalProviderError(f"Falha na autenticação com o emissor fiscal: {message}", status_code=502)
    data = response.json()
    _token_cache.update({
        "token": data["access_token"],
        "expires_at": now + int(data.get("expires_in") or 3600),
        "client_id": client_id,
    })
    return data["access_token"]


async def request(method: str, path: str, *, json=None, params=None, raw: bool = False, allow_404: bool = False):
    """Chama a API autenticada. raw=True devolve os bytes (PDF/XML)."""
    token = await _get_token()
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.request(
                method, f"{API_URL}{path}", json=json, params=params,
                headers={"Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError as e:
        raise FiscalProviderError(f"Não foi possível conectar ao emissor fiscal: {e}")
    if response.status_code == 401:
        _token_cache["token"] = None  # token revogado/expirado: a próxima chamada pede outro
    if allow_404 and response.status_code == 404:
        return None
    if response.status_code >= 400:
        message, data = _error_message(response)
        status = 400 if 400 <= response.status_code < 500 else 502
        raise FiscalProviderError(message, status_code=status, details=data)
    if raw:
        return response.content
    if response.status_code == 204 or not response.content:
        return {}
    return response.json()


# ---------- Empresa ----------

async def get_company(cnpj: str):
    return await request("GET", f"/empresas/{cnpj}", allow_404=True)


async def save_company(cnpj: str, payload: dict) -> dict:
    """Cria a empresa na Nuvem Fiscal, ou atualiza se ela já existir."""
    if await get_company(cnpj) is None:
        return await request("POST", "/empresas", json=payload)
    return await request("PUT", f"/empresas/{cnpj}", json=payload)


async def get_certificate(cnpj: str):
    return await request("GET", f"/empresas/{cnpj}/certificado", allow_404=True)


async def upload_certificate(cnpj: str, pfx_base64: str, password: str) -> dict:
    return await request("PUT", f"/empresas/{cnpj}/certificado",
                         json={"certificado": pfx_base64, "password": password})


async def save_cte_config(cnpj: str, crt: int, ambiente: str) -> dict:
    return await request("PUT", f"/empresas/{cnpj}/cte", json={"CRT": crt, "ambiente": ambiente})


# ---------- CT-e ----------

async def emit_cte(payload: dict) -> dict:
    return await request("POST", "/cte", json=payload)


async def get_cte(provider_id: str) -> dict:
    return await request("GET", f"/cte/{provider_id}")


async def cancel_cte(provider_id: str, justificativa: str) -> dict:
    return await request("POST", f"/cte/{provider_id}/cancelamento", json={"justificativa": justificativa})


async def sync_cte(provider_id: str) -> dict:
    return await request("POST", f"/cte/{provider_id}/sincronizar")


async def cte_pdf(provider_id: str) -> bytes:
    return await request("GET", f"/cte/{provider_id}/pdf", params={"logotipo": "true"}, raw=True)


async def cte_xml(provider_id: str) -> bytes:
    return await request("GET", f"/cte/{provider_id}/xml", raw=True)


async def cte_sefaz_status(cnpj: str) -> dict:
    """Situação do serviço da Sefaz que autoriza o CT-e da empresa (o ambiente
    é o configurado na empresa, em /empresas/{cnpj}/cte)."""
    return await request("GET", "/cte/sefaz/status", params={"cpf_cnpj": cnpj})
