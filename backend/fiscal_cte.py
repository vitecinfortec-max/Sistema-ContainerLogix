"""Monta o pedido de emissão do CT-e (layout 4.00 da Sefaz, no formato JSON
"plano" da Focus NFe - ver https://campos.focusnfe.com.br/cte_cteos/) a partir
do CT-e salvo no sistema e da Configuração Fiscal.

Funções puras (sem banco e sem rede) - os códigos IBGE dos municípios já
chegam resolvidos (ver resolve_municipalities em routers/fiscal.py).
"""
import re
from datetime import datetime, timedelta, timezone

BRT = timezone(timedelta(hours=-3))

UF_CODES = {
    "RO": 11, "AC": 12, "AM": 13, "RR": 14, "PA": 15, "AP": 16, "TO": 17,
    "MA": 21, "PI": 22, "CE": 23, "RN": 24, "PB": 25, "PE": 26, "AL": 27, "SE": 28, "BA": 29,
    "MG": 31, "ES": 32, "RJ": 33, "SP": 35,
    "PR": 41, "SC": 42, "RS": 43,
    "MS": 50, "MT": 51, "GO": 52, "DF": 53,
}

TOMADOR_LABELS = {0: "Remetente", 1: "Expedidor", 2: "Recebedor", 3: "Destinatário", 4: "Outros"}

# Status da Focus NFe -> status do CT-e no sistema
PROVIDER_STATUS = {
    "processando_autorizacao": "PENDENTE",
    "autorizado": "AUTORIZADO",
    "erro_autorizacao": "REJEITADO",
    "denegado": "DENEGADO",
    "cancelado": "CANCELADO",
}

# CST do sistema -> icms_situacao_tributaria da Focus
ICMS_CST_FOCUS = {"00": "00", "40": "40", "41": "41", "51": "51", "60": "60", "90": "90", "SN": "90_simples_nacional"}


def only_digits(value) -> str:
    return re.sub(r"\D", "", str(value or ""))


def _text(value, limit=None) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit] if limit else text


def _money(value) -> float:
    return round(float(value or 0), 2)


def _dec(value, places=2) -> str:
    return f"{float(value or 0):.{places}f}"


def _first_email(value):
    for part in re.split(r"[;,]", str(value or "")):
        if part.strip():
            return part.strip()
    return None


def _municipality_ok(code, uf) -> bool:
    code = only_digits(code)
    return len(code) == 7 and UF_CODES.get((uf or "").upper()) == int(code[:2])


def validate(cte: dict, settings: dict) -> list:
    """Lista de pendências (em português) que impediriam a emissão."""
    errors = []
    if len(only_digits(settings.get("cnpj"))) != 14:
        errors.append("Configuração Fiscal: CNPJ do emitente inválido")
    if not _text(settings.get("ie")):
        errors.append("Configuração Fiscal: informe a Inscrição Estadual do emitente")
    if not settings.get("crt"):
        errors.append("Configuração Fiscal: informe o Regime Tributário (CRT)")
    if len(only_digits(settings.get("rntrc"))) != 8:
        errors.append("Configuração Fiscal: RNTRC do emitente deve ter 8 dígitos")
    endereco = settings.get("endereco") or {}
    if len(_text(endereco.get("cidade"))) < 2 or not _municipality_ok(endereco.get("codigo_municipio"), endereco.get("uf")):
        errors.append("Configuração Fiscal: município (código IBGE) do endereço do emitente não encontrado")

    if not re.fullmatch(r"[1-7]\d{3}", only_digits(cte.get("cfop"))):
        errors.append("CFOP inválido (4 dígitos)")
    if not _text(cte.get("natureza_operacao")):
        errors.append("Informe a Natureza da Operação")

    papel = cte.get("tomador_papel")
    if papel not in (0, 1, 2, 3, 4):
        errors.append("Tomador do serviço inválido")
    if cte.get("indicador_ie_tomador") not in (1, 2, 9):
        errors.append("Indicador de IE do tomador inválido")

    parties = [("Remetente", "remetente"), ("Destinatário", "destinatario")]
    if papel == 4:
        parties.append(("Tomador", "tomador"))
    elif papel in (1, 2):
        errors.append("Tomador Expedidor/Recebedor ainda não é suportado: use Remetente, Destinatário ou Outros")
    for label, key in parties:
        party = cte.get(key) or {}
        if len(_text(party.get("nome"))) < 2:
            errors.append(f"{label}: informe o nome / razão social")
        if len(only_digits(party.get("cnpj_cpf"))) not in (11, 14):
            errors.append(f"{label}: CNPJ/CPF inválido")
        address = party.get("endereco") or {}
        # O layout exige ao menos 2 caracteres em logradouro, bairro e município
        for field, field_label, minimo in (("logradouro", "logradouro", 2), ("numero", "número", 1),
                                           ("bairro", "bairro", 2)):
            if len(_text(address.get(field))) < minimo:
                errors.append(f"{label}: informe o {field_label} do endereço")
        if len(_text(address.get("cidade"))) < 2 or not _municipality_ok(address.get("codigo_municipio"), address.get("uf")):
            errors.append(f"{label}: município do endereço não encontrado (confira CEP, cidade e UF)")

    for label, key in (("Início da prestação", "origem"), ("Término da prestação", "destino")):
        place = cte.get(key) or {}
        if len(_text(place.get("cidade"))) < 2 or not _municipality_ok(place.get("codigo_municipio"), place.get("uf")):
            errors.append(f"{label}: município não encontrado (confira cidade e UF)")

    total = _money(cte.get("valor_total"))
    if total <= 0:
        errors.append("Informe o Valor Total da Prestação")
    receber = cte.get("valor_receber")
    if receber is not None and (_money(receber) < 0 or _money(receber) > total):
        errors.append("Valor a Receber não pode ser negativo nem maior que o Valor Total")
    componentes = cte.get("componentes") or []
    if componentes and abs(sum(_money(c.get("valor")) for c in componentes) - total) > 0.009:
        errors.append("A soma dos componentes do valor deve ser igual ao Valor Total da Prestação")

    cst = cte.get("icms_cst") or settings.get("icms_cst")
    if cst not in ("00", "40", "41", "51", "60", "90", "SN"):
        errors.append("Informe a situação tributária do ICMS (CST)")
    elif cst in ("00", "60", "90"):
        aliquota = cte.get("icms_aliquota")
        if aliquota is None:
            aliquota = settings.get("icms_aliquota")
        if aliquota is None or not (0 < float(aliquota) <= 100):
            errors.append("Informe a alíquota do ICMS")

    # Reforma Tributária (IBS/CBS): opcional, mas CST e classificação andam juntos
    ibs_cst, ibs_class = _text(settings.get("ibs_cbs_cst")), _text(settings.get("ibs_cbs_classificacao"))
    if (ibs_cst or ibs_class) and not (re.fullmatch(r"\d{3}", ibs_cst) and re.fullmatch(r"\d{6}", ibs_class)):
        errors.append("Configuração Fiscal: IBS/CBS exige CST (3 dígitos) e Classificação Tributária (6 dígitos)")

    if not _text(cte.get("produto_predominante") or settings.get("produto_predominante")):
        errors.append("Informe o Produto Predominante da carga")
    if not cte.get("quantidades"):
        errors.append("Informe ao menos uma quantidade da carga (ex.: peso bruto)")
    for q in cte.get("quantidades") or []:
        if float(q.get("quantidade") or 0) <= 0:
            errors.append("Quantidade da carga deve ser maior que zero")
            break

    documentos = cte.get("documentos") or []
    if not documentos:
        errors.append("Informe ao menos um documento transportado (chave da NF-e ou outro documento)")
    for doc in documentos:
        if doc.get("tipo") == "NFE" and len(only_digits(doc.get("chave"))) != 44:
            errors.append("Chave de NF-e deve ter 44 dígitos")
        if doc.get("tipo") == "OUTROS" and not _text(doc.get("descricao")) and doc.get("tipo_outros", "99") == "99":
            errors.append("Outro documento: informe a descrição")
    return errors


def _party(party: dict, suffix: str) -> dict:
    """Remetente/destinatário/tomador no formato da Focus (campo_<sufixo>)."""
    address = party.get("endereco") or {}
    doc = only_digits(party.get("cnpj_cpf"))
    out = {f"{'cnpj' if len(doc) == 14 else 'cpf'}_{suffix}": doc}
    ie = _text(party.get("ie")).upper()
    if ie:
        out[f"inscricao_estadual_{suffix}"] = "ISENTO" if ie == "ISENTO" else only_digits(ie)
    out[f"nome_{suffix}"] = _text(party.get("nome"), 60)
    fone = only_digits(party.get("fone"))
    if 6 <= len(fone) <= 14:
        out[f"telefone_{suffix}"] = fone
    out.update({
        f"logradouro_{suffix}": _text(address.get("logradouro"), 255),
        f"numero_{suffix}": _text(address.get("numero"), 60) or "S/N",
        f"bairro_{suffix}": _text(address.get("bairro"), 60),
        f"codigo_municipio_{suffix}": only_digits(address.get("codigo_municipio")),
        f"municipio_{suffix}": _text(address.get("cidade"), 60),
        f"uf_{suffix}": (address.get("uf") or "").upper(),
        f"codigo_pais_{suffix}": "1058",
        f"pais_{suffix}": "BRASIL",
    })
    if _text(address.get("complemento")):
        out[f"complemento_{suffix}"] = _text(address.get("complemento"), 60)
    cep = only_digits(address.get("cep"))
    if len(cep) == 8:
        out[f"cep_{suffix}"] = cep
    email = _first_email(party.get("email"))
    if email:
        out[f"email_{suffix}"] = email[:60]
    return out


def _icms(cst: str, total: float, aliquota) -> dict:
    out = {"icms_situacao_tributaria": ICMS_CST_FOCUS[cst]}
    if cst in ("00", "90"):
        out.update({"icms_base_calculo": _dec(total), "icms_aliquota": _dec(aliquota),
                    "icms_valor": _dec(_money(total * float(aliquota) / 100))})
    elif cst == "60":
        out.update({"icms_base_calculo_retido_st": _dec(total), "icms_aliquota_retido_st": _dec(aliquota),
                    "icms_valor_retido_st": _dec(_money(total * float(aliquota) / 100))})
    elif cst == "SN":
        out["icms_indicador_simples_nacional"] = "1"
    return out


def _ibs_cbs(settings: dict, total: float) -> dict:
    """Grupo IBS/CBS da Reforma Tributária, só quando configurado (CST +
    classificação definidos pelo contador). Alíquota vazia = não informada."""
    cst, classificacao = _text(settings.get("ibs_cbs_cst")), _text(settings.get("ibs_cbs_classificacao"))
    if not (cst and classificacao):
        return {}
    out = {"ibs_cbs_situacao_tributaria": cst, "ibs_cbs_classificacao_tributaria": classificacao,
           "ibs_cbs_base_calculo": _dec(total)}
    ibs_total, has_ibs = 0.0, False
    for key, field in (("ibs_uf_aliquota", "ibs_uf"), ("ibs_mun_aliquota", "ibs_mun")):
        if settings.get(key) is not None:
            valor = _money(total * float(settings[key]) / 100)
            ibs_total += valor
            has_ibs = True
            out[f"{field}_aliquota"] = _dec(settings[key])
            out[f"{field}_valor"] = _dec(valor)
    if has_ibs:
        out["ibs_valor_total"] = _dec(ibs_total)
    if settings.get("cbs_aliquota") is not None:
        out["cbs_aliquota"] = _dec(settings["cbs_aliquota"])
        out["cbs_valor"] = _dec(_money(total * float(settings["cbs_aliquota"]) / 100))
    return out


def _cargo_units(containers: list) -> list:
    units = []
    for c in containers or []:
        number = _text(c.get("numero")).upper()
        if not number:
            continue
        unit = {"tipo": "1", "identificacao": number[:20]}
        if _text(c.get("lacre")):
            unit["lacres"] = [{"numero_lacre": _text(c.get("lacre"), 20)}]
        units.append(unit)
    return units


def emission_datetime(now: datetime = None) -> str:
    now = (now or datetime.now(timezone.utc)).astimezone(BRT)
    return now.strftime("%Y-%m-%dT%H:%M:%S-03:00")


def build_payload(cte: dict, settings: dict, now: datetime = None) -> dict:
    """Corpo do POST /v2/cte da Focus NFe. Chamar validate() antes. Série e
    número ficam com a Focus (numeração automática da empresa cadastrada lá)."""
    endereco = settings.get("endereco") or {}
    origem = cte.get("origem") or {}
    destino = cte.get("destino") or {}
    papel = cte.get("tomador_papel", 0)
    total = _money(cte.get("valor_total"))
    receber = total if cte.get("valor_receber") is None else _money(cte.get("valor_receber"))
    cst = cte.get("icms_cst") or settings.get("icms_cst")
    aliquota = cte.get("icms_aliquota")
    if aliquota is None:
        aliquota = settings.get("icms_aliquota")

    payload = {
        "cfop": only_digits(cte.get("cfop")),
        "natureza_operacao": _text(cte.get("natureza_operacao"), 60),
        "data_emissao": emission_datetime(now),
        "tipo_documento": "0",
        "modal": "01",
        "tipo_servico": "0",
        "codigo_municipio_envio": only_digits(endereco.get("codigo_municipio")),
        "municipio_envio": _text(endereco.get("cidade"), 60),
        "uf_envio": (endereco.get("uf") or "").upper(),
        "codigo_municipio_inicio": only_digits(origem.get("codigo_municipio")),
        "municipio_inicio": _text(origem.get("cidade"), 60),
        "uf_inicio": (origem.get("uf") or "").upper(),
        "codigo_municipio_fim": only_digits(destino.get("codigo_municipio")),
        "municipio_fim": _text(destino.get("cidade"), 60),
        "uf_fim": (destino.get("uf") or "").upper(),
        "retirar_mercadoria": "1",
        "indicador_inscricao_estadual_tomador": str(int(cte.get("indicador_ie_tomador") or 1)),
        "tomador": str(papel),
        # Emitente
        "cnpj_emitente": only_digits(settings.get("cnpj")),
        "inscricao_estadual_emitente": only_digits(settings.get("ie")),
        "nome_emitente": _text(settings.get("razao_social"), 60),
        "logradouro_emitente": _text(endereco.get("logradouro"), 60),
        "numero_emitente": _text(endereco.get("numero"), 60) or "S/N",
        "bairro_emitente": _text(endereco.get("bairro"), 60),
        "codigo_municipio_emitente": only_digits(endereco.get("codigo_municipio")),
        "municipio_emitente": _text(endereco.get("cidade"), 60),
        "uf_emitente": (endereco.get("uf") or "").upper(),
        "regime_tributario_emitente": str(int(settings.get("crt") or 3)),
    }
    if _text(settings.get("nome_fantasia")):
        payload["nome_fantasia_emitente"] = _text(settings.get("nome_fantasia"), 60)
    if _text(endereco.get("complemento")):
        payload["complemento_emitente"] = _text(endereco.get("complemento"), 60)
    if len(only_digits(endereco.get("cep"))) == 8:
        payload["cep_emitente"] = only_digits(endereco.get("cep"))
    if 6 <= len(only_digits(settings.get("fone"))) <= 14:
        payload["telefone_emitente"] = only_digits(settings.get("fone"))

    payload.update(_party(cte.get("remetente") or {}, "remetente"))
    payload.update(_party(cte.get("destinatario") or {}, "destinatario"))
    if papel == 4:
        payload.update(_party(cte.get("tomador") or {}, "tomador"))

    payload["valor_total"] = _dec(total)
    payload["valor_receber"] = _dec(receber)
    componentes = [{"nome": _text(c.get("nome"), 15).upper(), "valor": _dec(c.get("valor"))}
                   for c in cte.get("componentes") or [] if _text(c.get("nome"))]
    if componentes:
        payload["componentes_valor"] = componentes
    payload.update(_icms(cst, total, aliquota))
    payload.update(_ibs_cbs(settings, total))

    payload["produto_predominante"] = _text(cte.get("produto_predominante") or settings.get("produto_predominante"), 60)
    if cte.get("valor_carga") is not None:
        payload["valor_total_carga"] = _dec(cte.get("valor_carga"))
    if _text(cte.get("outras_caracteristicas")):
        payload["outras_caracteristicas_carga"] = _text(cte.get("outras_caracteristicas"), 40)
    payload["quantidades"] = [{
        "codigo_unidade_medida": str(q.get("unidade") or "01").zfill(2),
        "tipo_medida": _text(q.get("tipo_medida"), 20) or "PESO BRUTO",
        "quantidade": _dec(q.get("quantidade"), 4),
    } for q in cte.get("quantidades") or []]

    # Containers vão como unidades de carga do primeiro documento transportado
    units = _cargo_units(cte.get("containers"))
    nfes, outros = [], []
    for doc in cte.get("documentos") or []:
        if doc.get("tipo") == "NFE":
            item, target = {"chave_nfe": only_digits(doc.get("chave"))}, nfes
        else:
            item, target = {"tipo_documento": str(doc.get("tipo_outros") or "99").zfill(2)}, outros
            if _text(doc.get("descricao")):
                item["descricao_documento"] = _text(doc.get("descricao"), 100)
            if _text(doc.get("numero")):
                item["numero"] = _text(doc.get("numero"), 100)
            if doc.get("data_emissao"):
                item["data_emissao"] = str(doc["data_emissao"])[:10]
            if doc.get("valor") is not None:
                item["valor"] = _dec(doc.get("valor"))
        if units and not nfes and not outros:
            item["unidades_carga"] = units
        target.append(item)
    if nfes:
        payload["nfes"] = nfes
    if outros:
        payload["outros_documentos"] = outros

    obs = _text(cte.get("observacoes"), 2000)
    if obs:
        payload["observacao"] = obs
    payload["modal_rodoviario"] = {"rntrc": only_digits(settings.get("rntrc"))}
    return payload


def provider_result(response: dict) -> dict:
    """Campos da consulta do CT-e na Focus NFe que o sistema guarda."""
    status_focus = (response.get("status") or "").lower()
    motivo = response.get("mensagem_sefaz") or response.get("mensagem")
    codigo = response.get("status_sefaz")
    if motivo and codigo:
        motivo = f"{codigo} - {motivo}"
    result = {
        "status": PROVIDER_STATUS.get(status_focus, "ERRO"),
        "chave": only_digits(response.get("chave")) or None,  # às vezes vem com o prefixo "CTe"
        "protocolo": response.get("protocolo"),
        "motivo": motivo,
        "caminho_dacte": response.get("caminho_dacte"),
        "caminho_xml": response.get("caminho_xml"),
    }
    if response.get("numero") not in (None, ""):
        result["numero"] = int(response["numero"])
    if response.get("serie") not in (None, ""):
        result["serie"] = int(response["serie"])
    return result
