"""Parser de XML de Nota Fiscal Eletrônica (NF-e) - extrai emitente e itens
pra alimentar a importação de Entradas de Estoque (backend/routers/stock.py).
Usa só a biblioteca padrão (xml.etree.ElementTree), sem dependência nova.

Aceita tanto o XML completo autorizado (<nfeProc><NFe>...) quanto o <NFe>
puro - em ambos os casos localiza o <infNFe> navegando a árvore inteira,
sem depender do wrapper específico. Ignora namespace ao comparar nomes de
tag (NF-e sempre usa o namespace "http://www.portalfiscal.inf.br/nfe",
mas comparar por sufixo evita depender do prefixo exato declarado)."""
import xml.etree.ElementTree as ET


def _local(tag: str) -> str:
    """Remove o prefixo de namespace de uma tag XML: '{http://...}NFe' -> 'NFe'."""
    return tag.split('}', 1)[1] if '}' in tag else tag


def _find(elem, path: str):
    current = elem
    for tag in path.split('/'):
        found = None
        for child in current:
            if _local(child.tag) == tag:
                found = child
                break
        if found is None:
            return None
        current = found
    return current


def _text(elem, path: str, default: str = '') -> str:
    node = _find(elem, path)
    return (node.text or default).strip() if node is not None and node.text else default


def _to_float(value: str) -> float:
    try:
        return float(value) if value else 0.0
    except ValueError:
        return 0.0


def parse_nfe_xml(content: bytes) -> dict:
    """Extrai emitente + itens de um XML de NF-e. Levanta ValueError com
    mensagem amigável se a estrutura não for reconhecida."""
    try:
        root = ET.fromstring(content)
    except ET.ParseError as e:
        raise ValueError(f"Arquivo XML inválido: {e}")

    inf_nfe = None
    for elem in root.iter():
        if _local(elem.tag) == 'infNFe':
            inf_nfe = elem
            break
    if inf_nfe is None:
        raise ValueError("Não foi possível encontrar os dados da Nota Fiscal (infNFe) neste XML")

    ide = _find(inf_nfe, 'ide')
    emit = _find(inf_nfe, 'emit')
    if ide is None or emit is None:
        raise ValueError("XML de Nota Fiscal incompleto (faltam dados de identificação ou emitente)")

    nfe_key_raw = inf_nfe.attrib.get('Id') or ''
    nfe_key = nfe_key_raw[3:] if nfe_key_raw.startswith('NFe') else nfe_key_raw

    issue_date_raw = _text(ide, 'dhEmi') or _text(ide, 'dEmi')

    items = []
    for det in inf_nfe:
        if _local(det.tag) != 'det':
            continue
        prod = _find(det, 'prod')
        if prod is None:
            continue
        barcode = _text(prod, 'cEAN')
        if barcode.strip().upper() in ('SEM GTIN', ''):
            # "SEM GTIN" é o valor padrão da NF-e pra "sem código de barras" -
            # não é um código real, não deve virar barcode de produto nem
            # servir pra casar com outro item que também não tenha um.
            barcode = ''
        items.append({
            'supplier_code': _text(prod, 'cProd'),
            'barcode': barcode,
            'description': _text(prod, 'xProd'),
            'ncm': _text(prod, 'NCM'),
            'cfop': _text(prod, 'CFOP'),
            'unit': _text(prod, 'uCom'),
            'quantity': _to_float(_text(prod, 'qCom')),
            'unit_value': _to_float(_text(prod, 'vUnCom')),
            'total_value': _to_float(_text(prod, 'vProd')),
        })

    if not items:
        raise ValueError("Nenhum item de produto encontrado nesta Nota Fiscal")

    return {
        'nfe_number': _text(ide, 'nNF'),
        'nfe_key': nfe_key,
        'nfe_issue_date': issue_date_raw[:10] if issue_date_raw else '',
        'supplier_cnpj': _text(emit, 'CNPJ'),
        'supplier_name': _text(emit, 'xNome'),
        'items': items,
    }
