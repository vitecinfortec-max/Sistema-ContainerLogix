"""Monta o pedido de emissão do CT-e (layout 4.00 da Sefaz, no formato JSON da
Nuvem Fiscal) a partir do CT-e salvo no sistema e da Configuração Fiscal.

Funções puras (sem banco e sem rede) - os códigos IBGE dos municípios já
chegam resolvidos (ver resolve_municipalities em routers/fiscal.py).
"""
import re
from datetime import datetime, timedelta, timezone

VERSAO_LEIAUTE = "4.00"
VERSAO_PROCESSO = "ContainerLogix 1.0"
BRT = timezone(timedelta(hours=-3))

UF_CODES = {
    "RO": 11, "AC": 12, "AM": 13, "RR": 14, "PA": 15, "AP": 16, "TO": 17,
    "MA": 21, "PI": 22, "CE": 23, "RN": 24, "PB": 25, "PE": 26, "AL": 27, "SE": 28, "BA": 29,
    "MG": 31, "ES": 32, "RJ": 33, "SP": 35,
    "PR": 41, "SC": 42, "RS": 43,
    "MS": 50, "MT": 51, "GO": 52, "DF": 53,
}

TOMADOR_LABELS = {0: "Remetente", 1: "Expedidor", 2: "Recebedor", 3: "Destinatário", 4: "Outros"}

# Status da Nuvem Fiscal -> status do CT-e no sistema
PROVIDER_STATUS = {
    "pendente": "PENDENTE",
    "autorizado": "AUTORIZADO",
    "rejeitado": "REJEITADO",
    "denegado": "DENEGADO",
    "cancelado": "CANCELADO",
    "erro": "ERRO",
}


def only_digits(value) -> str:
    return re.sub(r"\D", "", str(value or ""))


def _text(value, limit=None) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit] if limit else text


def _money(value) -> float:
    return round(float(value or 0), 2)


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


def _address(address: dict) -> dict:
    out = {
        "xLgr": _text(address.get("logradouro"), 255),
        "nro": _text(address.get("numero"), 60) or "S/N",
        "xBairro": _text(address.get("bairro"), 60),
        "cMun": only_digits(address.get("codigo_municipio")),
        "xMun": _text(address.get("cidade"), 60),
        "UF": (address.get("uf") or "").upper(),
    }
    if _text(address.get("complemento")):
        out["xCpl"] = _text(address.get("complemento"), 60)
    cep = only_digits(address.get("cep"))
    if len(cep) == 8:
        out["CEP"] = cep
    return out


def _party(party: dict, address_key: str) -> dict:
    doc = only_digits(party.get("cnpj_cpf"))
    out = {"CNPJ" if len(doc) == 14 else "CPF": doc}
    ie = _text(party.get("ie")).upper()
    if ie:
        out["IE"] = "ISENTO" if ie == "ISENTO" else only_digits(ie)
    out["xNome"] = _text(party.get("nome"), 60)
    fone = only_digits(party.get("fone"))
    if 6 <= len(fone) <= 14:
        out["fone"] = fone
    out[address_key] = _address(party.get("endereco") or {})
    email = _first_email(party.get("email"))
    if email:
        out["email"] = email[:60]
    return out


def _icms(cst: str, total: float, aliquota) -> dict:
    if cst == "00":
        return {"ICMS00": {"CST": "00", "vBC": total, "pICMS": float(aliquota),
                           "vICMS": _money(total * float(aliquota) / 100)}}
    if cst in ("40", "41", "51"):
        return {"ICMS45": {"CST": cst}}
    if cst == "60":
        return {"ICMS60": {"CST": "60", "vBCSTRet": total, "pICMSSTRet": float(aliquota),
                           "vICMSSTRet": _money(total * float(aliquota) / 100)}}
    if cst == "90":
        return {"ICMS90": {"CST": "90", "vBC": total, "pICMS": float(aliquota),
                           "vICMS": _money(total * float(aliquota) / 100)}}
    return {"ICMSSN": {"CST": "90", "indSN": 1}}


def _cargo_units(containers: list) -> list:
    units = []
    for c in containers or []:
        number = _text(c.get("numero")).upper()
        if not number:
            continue
        unit = {"tpUnidCarga": 1, "idUnidCarga": number[:20]}
        if _text(c.get("lacre")):
            unit["lacUnidCarga"] = [{"nLacre": _text(c.get("lacre"), 20)}]
        units.append(unit)
    return units


def emission_datetime(now: datetime = None) -> str:
    now = (now or datetime.now(timezone.utc)).astimezone(BRT)
    return now.strftime("%Y-%m-%dT%H:%M:%S-03:00")


def build_payload(cte: dict, settings: dict, numero: int, referencia: str, now: datetime = None) -> dict:
    """Pedido de emissão (POST /cte da Nuvem Fiscal). Chamar validate() antes."""
    endereco = settings.get("endereco") or {}
    uf_emit = (endereco.get("uf") or "").upper()
    origem = cte.get("origem") or {}
    destino = cte.get("destino") or {}
    papel = cte.get("tomador_papel", 0)
    total = _money(cte.get("valor_total"))
    receber = total if cte.get("valor_receber") is None else _money(cte.get("valor_receber"))
    cst = cte.get("icms_cst") or settings.get("icms_cst")
    aliquota = cte.get("icms_aliquota")
    if aliquota is None:
        aliquota = settings.get("icms_aliquota")

    ide = {
        "cUF": UF_CODES[uf_emit],
        "CFOP": only_digits(cte.get("cfop")),
        "natOp": _text(cte.get("natureza_operacao"), 60),
        "mod": 57,
        "serie": int(settings.get("cte_serie") or 1),
        "nCT": int(numero),
        "dhEmi": emission_datetime(now),
        "tpImp": 1,
        "tpEmis": 1,
        "tpAmb": 1 if settings.get("ambiente") == "producao" else 2,
        "tpCTe": 0,
        "procEmi": 0,
        "verProc": VERSAO_PROCESSO,
        "cMunEnv": only_digits(endereco.get("codigo_municipio")),
        "xMunEnv": _text(endereco.get("cidade"), 60),
        "UFEnv": uf_emit,
        "modal": "01",
        "tpServ": 0,
        "cMunIni": only_digits(origem.get("codigo_municipio")),
        "xMunIni": _text(origem.get("cidade"), 60),
        "UFIni": (origem.get("uf") or "").upper(),
        "cMunFim": only_digits(destino.get("codigo_municipio")),
        "xMunFim": _text(destino.get("cidade"), 60),
        "UFFim": (destino.get("uf") or "").upper(),
        "retira": 1,
        "indIEToma": int(cte.get("indicador_ie_tomador") or 1),
    }
    if papel == 4:
        tomador = _party(cte.get("tomador") or {}, "enderToma")
        ide["toma4"] = {"toma": 4, **tomador}
    else:
        ide["toma3"] = {"toma": papel}

    inf_cte = {
        "versao": VERSAO_LEIAUTE,
        "ide": ide,
        # O resto do emitente (nome, endereço) vem do cadastro da empresa na Nuvem Fiscal
        "emit": {
            "CNPJ": only_digits(settings.get("cnpj")),
            "IE": only_digits(settings.get("ie")),
            "CRT": int(settings.get("crt")),
        },
        "rem": _party(cte.get("remetente") or {}, "enderReme"),
        "dest": _party(cte.get("destinatario") or {}, "enderDest"),
        "vPrest": {"vTPrest": total, "vRec": receber},
        "imp": {"ICMS": _icms(cst, total, aliquota)},
    }
    componentes = [{"xNome": _text(c.get("nome"), 15).upper(), "vComp": _money(c.get("valor"))}
                   for c in cte.get("componentes") or [] if _text(c.get("nome"))]
    if componentes:
        inf_cte["vPrest"]["Comp"] = componentes

    compl = {}
    obs = _text(cte.get("observacoes"), 2000)
    if obs:
        compl["xObs"] = obs
    if compl:
        inf_cte["compl"] = compl

    carga = {
        "proPred": _text(cte.get("produto_predominante") or settings.get("produto_predominante"), 60),
        "infQ": [{
            "cUnid": str(q.get("unidade") or "01").zfill(2),
            "tpMed": _text(q.get("tipo_medida"), 20) or "PESO BRUTO",
            "qCarga": round(float(q.get("quantidade") or 0), 4),
        } for q in cte.get("quantidades") or []],
    }
    if cte.get("valor_carga") is not None:
        carga["vCarga"] = _money(cte.get("valor_carga"))
    if _text(cte.get("outras_caracteristicas")):
        carga["xOutCat"] = _text(cte.get("outras_caracteristicas"), 30)

    # Containers vão como unidades de carga do primeiro documento transportado
    units = _cargo_units(cte.get("containers"))
    inf_nfe, inf_outros = [], []
    for doc in cte.get("documentos") or []:
        if doc.get("tipo") == "NFE":
            item = {"chave": only_digits(doc.get("chave"))}
            target = inf_nfe
        else:
            item = {"tpDoc": str(doc.get("tipo_outros") or "99").zfill(2)}
            if _text(doc.get("descricao")):
                item["descOutros"] = _text(doc.get("descricao"), 100)
            if _text(doc.get("numero")):
                item["nDoc"] = _text(doc.get("numero"), 20)
            if doc.get("data_emissao"):
                item["dEmi"] = str(doc["data_emissao"])[:10]
            if doc.get("valor") is not None:
                item["vDocFisc"] = _money(doc.get("valor"))
            target = inf_outros
        if units and not inf_nfe and not inf_outros:
            item["infUnidCarga"] = units
        target.append(item)
    inf_doc = {}
    if inf_nfe:
        inf_doc["infNFe"] = inf_nfe
    if inf_outros:
        inf_doc["infOutros"] = inf_outros

    inf_cte["infCTeNorm"] = {
        "infCarga": carga,
        "infDoc": inf_doc,
        "infModal": {"versaoModal": VERSAO_LEIAUTE, "rodo": {"RNTRC": only_digits(settings.get("rntrc"))}},
    }

    return {
        "infCte": inf_cte,
        "ambiente": "producao" if settings.get("ambiente") == "producao" else "homologacao",
        "referencia": referencia,
    }


def provider_result(response: dict) -> dict:
    """Campos do retorno da Nuvem Fiscal (Dfe) que o sistema guarda."""
    autorizacao = response.get("autorizacao") or {}
    motivo = autorizacao.get("motivo_status") or autorizacao.get("mensagem")
    codigo = autorizacao.get("codigo_status")
    if motivo and codigo:
        motivo = f"{codigo} - {motivo}"
    return {
        "status": PROVIDER_STATUS.get((response.get("status") or "").lower(), "ERRO"),
        "provider_id": response.get("id"),
        "chave": response.get("chave"),
        "protocolo": autorizacao.get("numero_protocolo"),
        "motivo": motivo,
        "data_emissao": response.get("data_emissao"),
    }
