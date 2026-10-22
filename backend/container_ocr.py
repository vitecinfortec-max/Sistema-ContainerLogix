"""Leitura do número do container (e do código de tamanho/tipo ISO 6346) a
partir de uma foto, usada na Auditoria de Estoque. A imagem vai para a API da
Anthropic (Claude); o dígito verificador lido é conferido aqui, porque é ele
que denuncia uma letra ou número lido errado.

A chamada fica em claude_reader.py; o modelo pode ser trocado pela variável
de ambiente CONTAINER_OCR_MODEL.
"""
import re
from typing import Optional

from claude_reader import read_structured

_LETTER_VALUES = {
    'A': 10, 'B': 12, 'C': 13, 'D': 14, 'E': 15, 'F': 16, 'G': 17, 'H': 18, 'I': 19, 'J': 20,
    'K': 21, 'L': 23, 'M': 24, 'N': 25, 'O': 26, 'P': 27, 'Q': 28, 'R': 29, 'S': 30, 'T': 31,
    'U': 32, 'V': 34, 'W': 35, 'X': 36, 'Y': 37, 'Z': 38,
}

_PROMPT = (
    "This photo was taken in a container yard during a stock audit. Read the ISO 6346 "
    "identification painted on the shipping container: the owner code + category letter "
    "(4 letters, the 4th is usually U), the 6-digit serial number and the check digit "
    "(often shown inside a box), and the 4-character size/type code (e.g. 22G1, 45G1, 42R1). "
    "The text may be vertical, split across lines, dirty or at an angle. Report exactly what "
    "is painted; do not correct the check digit yourself. Use an empty string for anything "
    "you cannot read with confidence, and set container_found to false if no container "
    "identification is visible."
)

_SCHEMA = {
    "type": "object",
    "properties": {
        "container_found": {"type": "boolean"},
        "owner_and_category": {"type": "string", "description": "4 letters, e.g. MSCU"},
        "serial_number": {"type": "string", "description": "6 digits"},
        "check_digit": {"type": "string", "description": "1 digit, empty if not visible"},
        "size_type_code": {"type": "string", "description": "e.g. 45G1, empty if not visible"},
    },
    "required": ["container_found", "owner_and_category", "serial_number", "check_digit", "size_type_code"],
    "additionalProperties": False,
}


def container_check_digit(first10: str) -> int:
    total = sum(
        (int(ch) if ch.isdigit() else _LETTER_VALUES[ch]) * (2 ** i)
        for i, ch in enumerate(first10)
    )
    remainder = total % 11
    return 0 if remainder == 10 else remainder


def format_container_number(raw: Optional[str]) -> str:
    """Mesmo padrão de lib/containerNumber.js no frontend: "XXXX999999-9",
    com o dígito verificador sempre calculado. Fora do padrão, devolve só o
    texto limpo em maiúsculas."""
    clean = re.sub(r'[^A-Z0-9]', '', (raw or '').upper())
    first10 = clean[:10]
    if not re.fullmatch(r'[A-Z]{4}[0-9]{6}', first10):
        return clean
    return f"{first10}-{container_check_digit(first10)}"


def size_type_from_iso(code: Optional[str]) -> Optional[str]:
    """Converte o código ISO (22G1, 45G1, 42R1...) para o Tamanho/Tipo usado
    no sistema (20DC, 40HC, 40RF...). None quando não há equivalente."""
    code = re.sub(r'[^A-Z0-9]', '', (code or '').upper())
    if len(code) < 3:
        return None
    length = {'2': '20', '4': '40', 'L': '40'}.get(code[0])
    if not length:
        return None
    group = code[2]
    if group == 'G':
        if length == '20':
            return '20DC'
        return '40HC' if code[1] == '5' else '40DRY'
    suffix = {'R': 'RF', 'U': 'OT', 'P': 'FR'}.get(group)
    return f"{length}{suffix}" if suffix else None


async def read_container_photo(content: bytes, file_ext: str) -> dict:
    data = await read_structured(
        content, file_ext, _PROMPT, _SCHEMA, model_env='CONTAINER_OCR_MODEL',
        feature="Leitura por foto", unreadable="Não foi possível ler a foto, digite o número",
    )

    raw = f"{data.get('owner_and_category') or ''}{data.get('serial_number') or ''}"
    number = format_container_number(raw)
    complete = bool(re.fullmatch(r'[A-Z]{4}[0-9]{6}-[0-9]', number))
    read_digit = re.sub(r'[^0-9]', '', data.get('check_digit') or '')[:1]
    size_code = re.sub(r'[^A-Z0-9]', '', (data.get('size_type_code') or '').upper())
    return {
        "found": bool(data.get("container_found")) and complete,
        "container_number": number if complete else raw.upper(),
        "read_check_digit": read_digit or None,
        # False = o dígito pintado não bate com o calculado: algum caractere
        # foi lido errado (ou o container está com a pintura errada)
        "check_digit_ok": (read_digit == number[-1]) if complete and read_digit else None,
        "size_type_code": size_code or None,
        "size_type": size_type_from_iso(size_code),
    }
