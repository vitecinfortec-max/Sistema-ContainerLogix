"""Chamada à API da Anthropic (Claude) que lê uma imagem ou PDF e devolve os
campos pedidos num JSON com formato fixo. Usada pela leitura do container por
foto (Auditoria de Estoque) e pela importação de documentos nos cadastros
(CNH, RG e CRLV).

Configuração (variáveis de ambiente):
- ANTHROPIC_API_KEY: sem ela a leitura fica desligada (503 com aviso na tela)
- a variável de modelo de cada uso (CONTAINER_OCR_MODEL, DOCUMENT_OCR_MODEL):
  modelo usado, padrão claude-opus-5-5
"""
import base64
import json
import logging
import os

from fastapi import HTTPException

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-opus-5-5"
_FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}

_IMAGE_MEDIA_TYPES = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'}


def _content_block(content: bytes, file_ext: str) -> dict:
    data = base64.standard_b64encode(content).decode('ascii')
    if file_ext == '.pdf':
        return {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": data}}
    return {"type": "image", "source": {
        "type": "base64", "media_type": _IMAGE_MEDIA_TYPES.get(file_ext, 'image/jpeg'), "data": data,
    }}


async def read_structured(content: bytes, file_ext: str, prompt: str, schema: dict, *,
                          model_env: str, feature: str, unreadable: str) -> dict:
    """Manda o arquivo e o pedido ao Claude e devolve o JSON lido.
    `feature` nomeia o recurso nas mensagens de erro ("Leitura por foto");
    `unreadable` é a mensagem quando o arquivo não pôde ser lido."""
    api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail=f"{feature} não configurada: defina ANTHROPIC_API_KEY no servidor",
        )
    import anthropic

    service = feature[0].lower() + feature[1:]
    model = os.environ.get(model_env, '').strip() or DEFAULT_MODEL
    # Recusa indevida do modelo principal é refeita em outro modelo - só os
    # modelos abaixo aceitam esse parâmetro (o Haiku, por exemplo, recusa)
    fallback = (
        {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
        if model in _FALLBACK_MODELS else {}
    )
    client = anthropic.AsyncAnthropic(api_key=api_key, timeout=90.0)
    try:
        response = await client.beta.messages.create(
            model=model,
            max_tokens=4000,
            **fallback,
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
            messages=[{
                "role": "user",
                "content": [_content_block(content, file_ext), {"type": "text", "text": prompt}],
            }],
        )
    except anthropic.AuthenticationError:
        raise HTTPException(status_code=503, detail=f"Chave da API de {service} inválida")
    except anthropic.RateLimitError:
        raise HTTPException(status_code=503, detail=f"{feature} sobrecarregada, tente de novo em instantes")
    except anthropic.APIConnectionError:
        raise HTTPException(status_code=503, detail=f"Sem conexão com o serviço de {service}")
    except anthropic.BadRequestError as error:
        # PDF protegido por senha, corrompido ou com páginas demais
        logger.warning("%s recusada: %s", feature, error.message)
        raise HTTPException(status_code=422, detail=unreadable)
    except anthropic.APIStatusError as error:
        logger.warning("%s falhou: %s %s", feature, error.status_code, error.message)
        raise HTTPException(status_code=502, detail=f"O serviço de {service} falhou, tente de novo")

    if response.stop_reason != "end_turn":
        logger.warning("%s parou com %s", feature, response.stop_reason)
        raise HTTPException(status_code=422, detail=unreadable)
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        return json.loads(text)
    except ValueError:
        raise HTTPException(status_code=422, detail=unreadable)
