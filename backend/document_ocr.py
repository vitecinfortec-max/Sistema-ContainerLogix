"""Leitura de documentos (CNH, RG/CIN e CRLV) para preencher os cadastros de
Motorista, Funcionário e Veículo. Os valores lidos são passados para o
formato dos cadastros e conferidos (dígitos do CPF e do RENAVAM, formato da
placa e do chassi), porque é isso que denuncia um caractere lido errado.

- CRLV-e em PDF (o da Carteira Digital de Trânsito) traz o texto embutido:
  é lido aqui mesmo, pela posição de cada rótulo, sem custo e sem chave.
- CNH-e em PDF traz a frente da CNH como imagem gerada pelo sistema (nítida e
  sempre igual): passa por um OCR local (RapidOCR, em ocr_worker.py) e os
  campos são achados pela posição de cada rótulo, também sem custo e sem chave.
- Foto, PDF escaneado e RG vão para a API da Anthropic (Claude) - precisa de
  ANTHROPIC_API_KEY. A chamada fica em claude_reader.py; o modelo pode ser
  trocado por DOCUMENT_OCR_MODEL.
"""
import asyncio
import io
import json
import logging
import os
import re
import sys
import unicodedata
from pathlib import Path
from datetime import date, datetime
from typing import Optional

from fastapi import HTTPException

from claude_reader import read_structured

logger = logging.getLogger(__name__)

_TEXT = {"type": "string"}

_PERSON_FIELDS = {
    "document_found": {"type": "boolean"},
    "full_name": _TEXT,
    "cpf": _TEXT,
    "rg_number": {"type": "string", "description": "identity card (RG) number only, without issuer or state"},
    "rg_issuer": {"type": "string", "description": "issuing agency of the RG, e.g. SSP, SDS, DETRAN"},
    "rg_uf": {"type": "string", "description": "2-letter Brazilian state of the RG, e.g. SP"},
    "birth_date": {"type": "string", "description": "DD/MM/YYYY"},
}

_CNH_FIELDS = {
    **_PERSON_FIELDS,
    "cnh_registration_number": {"type": "string", "description": "Nº REGISTRO, 11 digits"},
    "cnh_category": {"type": "string", "description": "CAT. HAB., e.g. AE, D, B"},
    "cnh_expiry": {"type": "string", "description": "VALIDADE, DD/MM/YYYY"},
}

_CRLV_FIELDS = {
    "document_found": {"type": "boolean"},
    "plate": _TEXT,
    "renavam": {"type": "string", "description": "CÓDIGO RENAVAM"},
    "chassis": _TEXT,
    "brand_model": {"type": "string", "description": "MARCA/MODELO/VERSÃO exactly as printed"},
    "manufacture_year": {"type": "string", "description": "ANO FABRICAÇÃO"},
    "model_year": {"type": "string", "description": "ANO MODELO"},
    "color": {"type": "string", "description": "COR PREDOMINANTE"},
    "fuel": {"type": "string", "description": "COMBUSTÍVEL"},
    "species_type": {"type": "string", "description": "ESPÉCIE / TIPO, e.g. CARGA / CAMINHAO TRATOR"},
    "body_type": {"type": "string", "description": "CARROCERIA"},
    "power_displacement": {"type": "string", "description": "POTÊNCIA/CILINDRADA"},
    "gross_weight": {"type": "string", "description": "PESO BRUTO TOTAL"},
    "axles": {"type": "string", "description": "EIXOS"},
    "load_capacity": {"type": "string", "description": "CAPACIDADE"},
    "crv_number": {"type": "string", "description": "NÚMERO DO CRV"},
    "licensing_year": {"type": "string", "description": "EXERCÍCIO"},
    "owner_name": {"type": "string", "description": "NOME of the owner"},
    "owner_document": {"type": "string", "description": "CPF/CNPJ of the owner"},
}


def _schema(fields: dict) -> dict:
    return {"type": "object", "properties": fields, "required": list(fields), "additionalProperties": False}


_COMMON_RULES = (
    "Report exactly what is printed, without correcting or completing anything. Use an empty "
    "string for any field that is missing or that you cannot read with confidence, and set "
    "document_found to false if the file is not this kind of document."
)

DOCUMENT_KINDS = {
    "cnh": {
        "label": "CNH",
        # Da CNH só os dados vão para o cadastro; o arquivo não é guardado
        "keep_file": False,
        "schema": _schema(_CNH_FIELDS),
        "prompt": (
            "This file is a Brazilian driver's license (CNH, printed card or the digital CNH-e PDF). "
            "Read the holder's data. The field 'DOC. IDENTIDADE / ÓRG. EMISSOR / UF' holds the RG "
            "number, the issuing agency and the state: split them into rg_number, rg_issuer and rg_uf. "
            + _COMMON_RULES
        ),
    },
    "rg": {
        "label": "RG",
        "schema": _schema(_PERSON_FIELDS),
        "prompt": (
            "This file is a Brazilian identity card: the older RG (Registro Geral) or the new "
            "Carteira de Identidade Nacional (CIN). It may show front and back sides. Read the "
            "holder's data. On the CIN the CPF is also the registration number; then use it for "
            "both cpf and rg_number. "
            + _COMMON_RULES
        ),
    },
    "crlv": {
        "label": "CRLV",
        "schema": _schema(_CRLV_FIELDS),
        "prompt": (
            "This file is a Brazilian vehicle registration and licensing document (CRLV or the "
            "digital CRLV-e PDF). Read the vehicle data. "
            + _COMMON_RULES
        ),
    },
}


def _clean(value) -> str:
    return ' '.join(str(value or '').split()).strip()


def _plain(value) -> str:
    """Maiúsculas sem acento, para comparar textos do documento."""
    text = unicodedata.normalize('NFKD', _clean(value).upper())
    return ''.join(ch for ch in text if not unicodedata.combining(ch))


def _digits(value) -> str:
    return re.sub(r'\D', '', str(value or ''))


def cpf_is_valid(digits: str) -> bool:
    if not re.fullmatch(r'\d{11}', digits or '') or digits == digits[0] * 11:
        return False
    for size in (9, 10):
        total = sum(int(d) * (size + 1 - i) for i, d in enumerate(digits[:size]))
        check = (total * 10) % 11 % 10
        if check != int(digits[size]):
            return False
    return True


def format_cpf(digits: str) -> str:
    return f"{digits[:3]}.{digits[3:6]}.{digits[6:9]}-{digits[9:]}" if len(digits) == 11 else digits


def renavam_is_valid(digits: str) -> bool:
    if not re.fullmatch(r'\d{11}', digits or ''):
        return False
    total = sum(int(d) * w for d, w in zip(digits[:10], (3, 2, 9, 8, 7, 6, 5, 4, 3, 2)))
    check = (total * 10) % 11
    return (0 if check == 10 else check) == int(digits[10])


def _date(value) -> Optional[str]:
    """DD/MM/AAAA do documento -> AAAA-MM-DD do formulário."""
    match = re.search(r'(\d{1,2})\D(\d{1,2})\D(\d{4})', _clean(value))
    if not match:
        return None
    day, month, year = (int(g) for g in match.groups())
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def _year(value) -> Optional[int]:
    match = re.search(r'\b(19|20)\d{2}\b', _clean(value))
    return int(match.group()) if match else None


def _br(iso: str) -> str:
    return datetime.strptime(iso, '%Y-%m-%d').strftime('%d/%m/%Y')


def _person_fields(data: dict, warnings: list) -> dict:
    fields = {"name": _clean(data.get("full_name")).upper() or None}
    cpf = _digits(data.get("cpf"))
    if cpf:
        fields["cpf"] = format_cpf(cpf)
        if not cpf_is_valid(cpf):
            warnings.append(f"O CPF lido ({format_cpf(cpf)}) não confere com os dígitos verificadores: confira no documento")
    rg = re.sub(r'[^0-9A-Za-z.\-]', '', _clean(data.get("rg_number")))
    fields["rg"] = rg.upper() or None
    fields["rg_issuer"] = re.sub(r'[^A-Z/ ]', '', _plain(data.get("rg_issuer"))).strip() or None
    uf = re.sub(r'[^A-Z]', '', _plain(data.get("rg_uf")))
    fields["rg_uf"] = uf if len(uf) == 2 else None
    fields["birth_date"] = _date(data.get("birth_date"))
    return fields


def _cnh_fields(data: dict, warnings: list) -> dict:
    fields = _person_fields(data, warnings)
    number = _digits(data.get("cnh_registration_number"))
    if number:
        fields["cnh_number"] = number
        if len(number) != 11:
            warnings.append(f"O nº de registro da CNH lido ({number}) não tem 11 dígitos: confira no documento")
    category = re.sub(r'[^A-E]', '', _plain(data.get("cnh_category")))
    fields["cnh_category"] = category or None
    expiry = _date(data.get("cnh_expiry"))
    fields["cnh_expiry"] = expiry
    if expiry and expiry < date.today().isoformat():
        warnings.append(f"CNH vencida em {_br(expiry)}")
    return fields


_FUEL = [('DIESEL', 'DIESEL'), ('ELETRIC', 'ELETRICO'), ('GLP', 'GLP'),
         ('GASOL', 'GASOLINA'), ('ALCOOL', 'GASOLINA'), ('ETANOL', 'GASOLINA'), ('FLEX', 'GASOLINA')]


def _fuel(value) -> Optional[str]:
    text = _plain(value)
    return next((system for key, system in _FUEL if key in text), None)


def _vehicle_type(species_type) -> tuple:
    """ESPÉCIE/TIPO do CRLV -> (Tipo, Categoria) do cadastro de veículo."""
    text = _plain(species_type).replace('-', ' ')
    if 'REBOQUE' in text or 'SEMIRREBOQUE' in text:
        return 'CARRETA', 'CARGA'
    if 'TRATOR' in text:
        return 'CAVALO', 'TRACAO'
    if 'CAMINHAO' in text:
        return 'CAMINHÃO', 'CARGA'
    if 'FURGAO' in text or 'VAN' in text.split():
        return 'VAN', None
    return None, None


def _not_applicable(value) -> bool:
    text = _plain(value)
    return not text or text.startswith('NAO ') or text in ('NAO', '*', '-', 'N/A')


def _crlv_fields(data: dict, warnings: list) -> dict:
    fields = {}
    plate = re.sub(r'[^A-Z0-9]', '', _plain(data.get("plate")))
    if plate:
        fields["plate"] = plate
        if not re.fullmatch(r'[A-Z]{3}[0-9][A-Z0-9][0-9]{2}', plate):
            warnings.append(f"A placa lida ({plate}) está fora do padrão: confira no documento")
    renavam = _digits(data.get("renavam"))
    if renavam:
        renavam = renavam.zfill(11)  # RENAVAM antigo, de 9 dígitos
        fields["renavam"] = renavam
        if not renavam_is_valid(renavam):
            warnings.append(f"O RENAVAM lido ({renavam}) não confere com o dígito verificador: confira no documento")
    chassis = re.sub(r'[^A-Z0-9]', '', _plain(data.get("chassis")))
    if chassis:
        fields["chassis"] = chassis
        if not re.fullmatch(r'[A-HJ-NPR-Z0-9]{17}', chassis):
            warnings.append(f"O chassi lido ({chassis}) está fora do padrão de 17 caracteres: confira no documento")

    # I/ = importado; SR/ e R/ = semirreboque e reboque
    brand_model = re.sub(r'^(I|IMP|SR|R)\s*/\s*', '', _clean(data.get("brand_model")).upper())
    if brand_model:
        # Sem "/" (ex.: "RANDON SR CS 3E"), a marca é a primeira palavra
        brand, _, model = brand_model.partition('/') if '/' in brand_model else brand_model.partition(' ')
        fields["brand"] = brand.strip() or None
        fields["model"] = model.replace('/', ' ').strip() or None
    fields["year"] = _year(data.get("manufacture_year"))
    fields["model_year"] = _year(data.get("model_year"))
    fields["color"] = _clean(data.get("color")).upper() or None
    fields["fuel_type"] = _fuel(data.get("fuel"))
    fields["vehicle_type"], fields["category"] = _vehicle_type(data.get("species_type"))
    body = data.get("body_type")
    fields["body_type"] = None if _not_applicable(body) else _clean(body).upper()
    # "540CV/12800"; a cilindrada vem como "****" quando não informada
    power = re.sub(r'/\s*\**$', '', _clean(data.get("power_displacement")))
    fields["engine_power"] = None if _not_applicable(power) or re.fullmatch(r'0+\s*CV', power.upper()) else power.upper()
    gross = data.get("gross_weight")
    fields["gross_weight"] = None if _not_applicable(gross) else _clean(gross)
    capacity = data.get("load_capacity")
    fields["load_capacity"] = None if _not_applicable(capacity) else _clean(capacity)
    axles = _digits(data.get("axles"))
    fields["axle_count"] = int(axles) if axles and 0 < int(axles) < 20 else None
    fields["crlv_number"] = _digits(data.get("crv_number")) or None
    return fields


def _crlv_info(data: dict) -> dict:
    """Dados que não têm campo no cadastro, mostrados para conferência."""
    owner_document = _digits(data.get("owner_document"))
    return {
        "licensing_year": _year(data.get("licensing_year")),
        "owner_name": _clean(data.get("owner_name")).upper() or None,
        "owner_document": format_cpf(owner_document) if len(owner_document) == 11 else (_clean(data.get("owner_document")) or None),
    }


# Rótulo do CRLV-e (sem acento e sem espaços) -> campo da leitura
_CRLV_PDF_LABELS = {
    "CODIGORENAVAM": "renavam", "PLACA": "plate", "EXERCICIO": "licensing_year",
    "ANOFABRICACAO": "manufacture_year", "ANOMODELO": "model_year", "NUMERODOCRV": "crv_number",
    "MARCA/MODELO/VERSAO": "brand_model", "ESPECIE/TIPO": "species_type", "CHASSI": "chassis",
    "CORPREDOMINANTE": "color", "COMBUSTIVEL": "fuel", "CAPACIDADE": "load_capacity",
    "POTENCIA/CILINDRADA": "power_displacement", "PESOBRUTOTOTAL": "gross_weight", "EIXOS": "axles",
    "CARROCERIA": "body_type", "NOME": "owner_name", "CPF/CNPJ": "owner_document",
}


def _pdf_text_lines(content: bytes) -> list:
    """(topo, esquerda, tamanho da fonte, texto) de cada linha de texto da
    1ª página. Vazio quando o PDF não tem texto (só imagem) ou não abre."""
    import io
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LAParams, LTChar, LTTextLine

    lines = []

    def walk(obj, height):
        if isinstance(obj, LTTextLine):
            text = obj.get_text().strip()
            sizes = [c.size for c in obj if isinstance(c, LTChar)]
            if text and sizes:
                lines.append((height - obj.y1, obj.x0, max(sizes), text))
        elif hasattr(obj, '__iter__'):
            for child in obj:
                walk(child, height)

    try:
        for page in extract_pages(io.BytesIO(content), maxpages=1,
                                  laparams=LAParams(char_margin=1.0, line_margin=0.1, boxes_flow=None)):
            walk(page, page.height)
    except Exception as error:  # PDF corrompido, protegido etc. - segue para a leitura pelo Claude
        logger.info("PDF sem texto legível: %s", error)
        return []
    return lines


def crlv_from_pdf_text(content: bytes) -> Optional[dict]:
    """Lê o CRLV-e pelo texto embutido: cada rótulo (fonte pequena) tem o
    valor logo abaixo, na mesma coluna. None se o PDF não for um CRLV-e com
    texto - aí a leitura vai para o Claude."""
    lines = _pdf_text_lines(content)
    if not any('LICENCIAMENTO DE VEICULO' in _plain(t) for _, _, _, t in lines):
        return None
    labels = [(top, left, _CRLV_PDF_LABELS.get(re.sub(r'\s', '', _plain(t)))) for top, left, size, t in lines if size < 7.5]
    values = [(top, left, t) for top, left, size, t in lines if size >= 8.5]
    data = {key: "" for key in _CRLV_FIELDS}
    for top, left, key in labels:
        if not key or data[key]:
            continue
        below = [(v_top - top, text) for v_top, v_left, text in values
                 if abs(v_left - left) <= 4 and 0 < v_top - top <= 22]
        if below:
            text = min(below)[1]
            # "*", "***", "*.*" = campo não se aplica / não informado
            data[key] = '' if not re.sub(r'[*.\s]', '', text) else text
    if not (data["plate"] or data["renavam"]):
        return None
    data["document_found"] = True
    return data


_OCR_WORKER = Path(__file__).with_name("ocr_worker.py")
_OCR_TIMEOUT = 120
# Uma leitura por vez: cada OCR soma uns 230 MB ao servidor
_ocr_slot = asyncio.Semaphore(1)


async def _ocr_lines(image: bytes) -> Optional[list]:
    """Trechos lidos pelo OCR local ([esquerda, topo, altura, texto, confiança]).
    None se o OCR não está instalado, falhou ou demorou demais."""
    async with _ocr_slot:
        try:
            process = await asyncio.create_subprocess_exec(
                sys.executable, str(_OCR_WORKER),
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
        except OSError as error:
            logger.warning("OCR local não iniciou: %s", error)
            return None
        try:
            out, err = await asyncio.wait_for(process.communicate(image), timeout=_OCR_TIMEOUT)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            logger.warning("OCR local passou de %ss", _OCR_TIMEOUT)
            return None
    if process.returncode != 0:
        logger.warning("OCR local falhou: %s", err.decode(errors="replace")[-500:])
        return None
    try:
        return json.loads(out)
    except ValueError:
        return None


def _pdf_card_images(content: bytes) -> list:
    """Imagens do tamanho e formato de um cartão (frente/verso da CNH-e) na
    1ª página do PDF, na ordem em que aparecem."""
    from pypdf import PdfReader

    try:
        page = PdfReader(io.BytesIO(content)).pages[0]
        images = []
        for image in page.images:
            width, height = image.image.size
            if width >= 600 and 1.3 <= width / height <= 1.6:
                images.append(image.data)
        return images
    except Exception as error:  # PDF corrompido, protegido etc.
        logger.info("PDF sem imagem de cartão: %s", error)
        return []


def _label_key(text: str) -> str:
    return re.sub(r'[^A-Z]', '', _plain(text))


# Rótulo da CNH (só letras, sem acento) -> campo da leitura
_CNH_LABELS = [
    (lambda k: k == "NOME", "full_name"),
    (lambda k: k.startswith("DOCIDENTIDADE"), "rg_composite"),
    (lambda k: k == "CPF", "cpf"),
    (lambda k: k == "DATANASCIMENTO", "birth_date"),
    (lambda k: k.startswith("CATHAB"), "cnh_category"),
    (lambda k: k.endswith("REGISTRO") and len(k) <= 12, "cnh_registration_number"),
    (lambda k: k == "VALIDADE", "cnh_expiry"),
]


def _split_rg(value: str) -> tuple:
    """"12345678 SSP SP" (ou colado, "12345678SSPSP") -> (RG, órgão, UF)."""
    text = _plain(value)
    match = re.match(r'^([0-9X.\-/]+?)\s*([A-Z][A-Z/ ]*?)\s*([A-Z]{2})$', text)
    if not match:
        return text, '', ''
    return match.group(1), match.group(2).replace(' ', ''), match.group(3)


def cnh_from_ocr_lines(lines: list) -> Optional[dict]:
    """Campos da CNH pela posição: o valor fica logo abaixo do rótulo, na
    mesma coluna. None se a imagem não for a frente de uma CNH."""
    if not any('HABILITA' in _plain(line[3]) for line in lines):
        return None
    found = []
    for left, top, height, text, score in lines:
        key = _label_key(text)
        field = next((f for test, f in _CNH_LABELS if test(key)), None)
        found.append((left, top, text, field))
    data = {key: "" for key in _CNH_FIELDS}
    taken = set()
    for left, top, _, field in found:
        if not field or field in taken:
            continue
        below = [(v_top - top, text) for v_left, v_top, text, v_field in found
                 if not v_field and abs(v_left - left) <= 30 and 0 < v_top - top <= 50]
        if not below:
            continue
        taken.add(field)
        value = min(below)[1]
        if field == "rg_composite":
            data["rg_number"], data["rg_issuer"], data["rg_uf"] = _split_rg(value)
        else:
            data[field] = value
    if not (data["cpf"] or data["cnh_registration_number"]):
        return None
    data["document_found"] = True
    return data


async def cnh_from_pdf(content: bytes) -> Optional[dict]:
    """CNH-e em PDF lida pelo OCR local; tenta a frente e, se não for, o verso
    (a ordem das imagens no PDF pode mudar). None se não deu para ler."""
    for image in (await asyncio.to_thread(_pdf_card_images, content))[:2]:
        lines = await _ocr_lines(image)
        if lines is None:
            return None
        data = cnh_from_ocr_lines(lines)
        if data:
            return data
    return None


def _no_api_key_message(kind: str) -> str:
    if kind == "crlv":
        return ("Este arquivo precisa da leitura automática (ANTHROPIC_API_KEY não configurada no servidor). "
                "Sem ela, só o CRLV-e em PDF baixado da Carteira Digital de Trânsito é lido. Preencha os campos.")
    if kind == "cnh":
        return ("Este arquivo precisa da leitura automática (ANTHROPIC_API_KEY não configurada no servidor). "
                "Sem ela, só a CNH-e em PDF baixada da Carteira Digital de Trânsito é lida. Preencha os campos.")
    return (f"A leitura da {DOCUMENT_KINDS[kind]['label']} precisa da leitura automática "
            "(ANTHROPIC_API_KEY não configurada no servidor). Preencha os campos.")


async def read_document(kind: str, content: bytes, file_ext: str) -> dict:
    spec = DOCUMENT_KINDS[kind]
    data = None
    if kind == "crlv" and file_ext == ".pdf":
        data = await asyncio.to_thread(crlv_from_pdf_text, content)
    elif kind == "cnh" and file_ext == ".pdf":
        data = await cnh_from_pdf(content)
    if data is None:
        if not os.environ.get('ANTHROPIC_API_KEY', '').strip():
            raise HTTPException(status_code=503, detail=_no_api_key_message(kind))
        data = await read_structured(
            content, file_ext, spec["prompt"], spec["schema"], model_env='DOCUMENT_OCR_MODEL',
            feature="Leitura de documento", unreadable="Não foi possível ler o documento, preencha os campos",
        )
    warnings = []
    if kind == "crlv":
        fields, info = _crlv_fields(data, warnings), _crlv_info(data)
    else:
        fields = (_cnh_fields if kind == "cnh" else _person_fields)(data, warnings)
        info = {}
    fields = {k: v for k, v in fields.items() if v not in (None, '')}
    return {
        "kind": kind,
        "found": bool(data.get("document_found")) and bool(fields),
        "fields": fields,
        "info": {k: v for k, v in info.items() if v not in (None, '')},
        "warnings": warnings,
    }
