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
# Onde fica, no CT-e, o cadastro de quem paga o frete (tomador_papel)
TOMADOR_KEYS = {0: "remetente", 1: "expedidor", 2: "recebedor", 3: "destinatario", 4: "tomador"}


def payer_of(cte: dict) -> dict:
    """Participante tomador do serviço (quem paga o frete)."""
    try:
        papel = int(cte.get("tomador_papel") or 0)
    except (TypeError, ValueError):
        papel = 0
    return cte.get(TOMADOR_KEYS.get(papel, "remetente")) or {}

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


def access_key_ok(key, modelo: str = None) -> bool:
    """Chave de acesso de 44 dígitos com o dígito verificador (módulo 11) e,
    se informado, o modelo do documento (posições 21-22; NF-e = 55)."""
    digits = only_digits(key)
    if len(digits) != 44 or (modelo and digits[20:22] != modelo):
        return False
    total, weight = 0, 2
    for d in reversed(digits[:43]):
        total += int(d) * weight
        weight = 2 if weight == 9 else weight + 1
    rest = total % 11
    return int(digits[43]) == (0 if rest < 2 else 11 - rest)


def _filled(party: dict) -> bool:
    party = party or {}
    return bool(_text(party.get("nome")) or only_digits(party.get("cnpj_cpf")))


# Quantidades da carga (infQ) que a grade de documentos soma
DOC_QUANTITIES = (("peso", "01", "PESO BRUTO", "Peso"), ("quantidade", "03", "UNIDADE", "Quantidade"),
                  ("cubagem", "00", "CUBAGEM", "Cubagem"))


def document_totals(cte: dict) -> dict:
    """Totais da grade de documentos: peso (kg), quantidade, cubagem (m³) e valor."""
    totals = {"peso": 0.0, "quantidade": 0.0, "cubagem": 0.0, "valor": 0.0}
    for doc in cte.get("documentos") or []:
        for key in totals:
            totals[key] += float(doc.get(key) or 0)
    return {k: round(v, 4 if k != "valor" else 2) for k, v in totals.items()}


def cargo_quantities(cte: dict) -> list:
    """infQ: as somas da grade (KG, UNIDADE, M3) substituem as linhas manuais
    da mesma unidade; as outras unidades (TON, LITROS...) seguem como estão."""
    totals = document_totals(cte)
    from_docs = [{"unidade": unit, "tipo_medida": label, "quantidade": totals[key]}
                 for key, unit, label, _ in DOC_QUANTITIES if totals[key] > 0]
    replaced = {q["unidade"] for q in from_docs}
    manual = [q for q in cte.get("quantidades") or [] if str(q.get("unidade") or "01").zfill(2) not in replaced]
    return from_docs + manual


def cargo_value(cte: dict):
    """vCarga: soma do valor dos documentos; sem valores na grade, o informado à mão."""
    total = document_totals(cte)["valor"]
    return total if total > 0 else cte.get("valor_carga")


def predominant_product(cte: dict, settings: dict) -> str:
    """proPred: o informado no CT-e, senão a natureza da carga do primeiro documento."""
    natureza = next((_text(d.get("natureza_carga")) for d in cte.get("documentos") or [] if _text(d.get("natureza_carga"))), "")
    return _text(cte.get("produto_predominante")) or natureza or _text(settings.get("produto_predominante"))


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
    # Expedidor e recebedor são opcionais; obrigatórios quando são o tomador
    for code, label, key in ((1, "Expedidor", "expedidor"), (2, "Recebedor", "recebedor")):
        if papel == code or _filled(cte.get(key)):
            parties.append((label, key))
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

    # Piso mínimo da ANTT (antt_piso.py): com "bloquear", não emite abaixo do
    # piso nem sem o cálculo feito; com "avisar" só a tela alerta
    if (settings.get("piso_antt_modo") or "avisar") == "bloquear":
        calc = cte.get("frete_minimo_calc") or {}
        if not cte.get("frete_minimo"):
            errors.append("Piso mínimo ANTT: preencha o Cálculo do Frete Mínimo (tabela, tipo de carga, eixos e distância)")
        elif calc.get("valor_piso") is None:
            errors.append(f"Piso mínimo ANTT não calculado: {calc.get('motivo') or 'confira os dados'}")
        elif calc.get("abaixo_do_piso"):
            errors.append(f"Frete de {_brl(calc.get('valor_frete'))} (sem pedágio) abaixo do piso mínimo da ANTT de "
                          f"{_brl(calc['valor_piso'])} ({calc.get('resolucao')})")

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

    if not predominant_product(cte, settings):
        errors.append("Informe o Produto Predominante da carga (ou a natureza da carga nos documentos)")
    quantidades = cargo_quantities(cte)
    if not quantidades:
        errors.append("Informe ao menos uma quantidade da carga (ex.: peso bruto)")
    for q in quantidades:
        if float(q.get("quantidade") or 0) <= 0:
            errors.append("Quantidade da carga deve ser maior que zero")
            break

    documentos = cte.get("documentos") or []
    if not documentos:
        errors.append("Informe ao menos um documento transportado (chave da NF-e ou outro documento)")
    keys = []
    for i, doc in enumerate(documentos, start=1):
        tipo = doc.get("tipo")
        if tipo == "NFE":
            key = only_digits(doc.get("chave"))
            if not access_key_ok(key, "55"):
                errors.append(f"Documento {i}: chave de NF-e inválida (44 dígitos, confira o dígito verificador)")
            keys.append(key)
        elif tipo == "NF":
            if not _text(doc.get("numero")):
                errors.append(f"Documento {i}: informe o número da NF")
            if not _text(doc.get("serie")):
                errors.append(f"Documento {i}: informe a série da NF")
            if not doc.get("data_emissao"):
                errors.append(f"Documento {i}: informe a data de emissão da NF")
            if not re.fullmatch(r"\d{4}", only_digits(doc.get("cfop"))):
                errors.append(f"Documento {i}: informe o CFOP da NF (4 dígitos)")
            if _money(doc.get("valor")) <= 0:
                errors.append(f"Documento {i}: informe o valor da NF")
        elif tipo == "OUTROS" and not _text(doc.get("descricao")) and doc.get("tipo_outros", "99") == "99":
            errors.append(f"Documento {i}: informe a descrição do outro documento")
        pin = _text(doc.get("pin_suframa"))
        if pin and not (2 <= len(pin) <= 9):
            errors.append(f"Documento {i}: PIN SUFRAMA deve ter de 2 a 9 caracteres")
    if len(set(keys)) != len(keys):
        errors.append("A mesma chave de NF-e aparece mais de uma vez")

    motorista = cte.get("motorista") or {}
    if only_digits(motorista.get("cpf")) and len(only_digits(motorista.get("cpf"))) != 11:
        errors.append("Motorista: CPF deve ter 11 dígitos")
    if only_digits(cte.get("seguradora_cnpj")) and len(only_digits(cte.get("seguradora_cnpj"))) != 14:
        errors.append("Seguro: CNPJ da seguradora deve ter 14 dígitos")
    for vale in cte.get("vales_pedagio") or []:
        if len(only_digits(vale.get("fornecedor_cnpj"))) != 14:
            errors.append("Vale-pedágio: informe o CNPJ da fornecedora (14 dígitos)")
        if not _text(vale.get("numero_comprovante")):
            errors.append("Vale-pedágio: informe o número do comprovante")
        if _money(vale.get("valor")) <= 0:
            errors.append("Vale-pedágio: informe o valor")
    return errors


TOLL_PAYERS = {"EMITENTE": "Emitente", "REMETENTE": "Remetente", "DESTINATARIO": "Destinatário", "TOMADOR": "Tomador"}
TOLL_TYPES = {"01": "TAG", "02": "Cupom", "03": "Cartão"}


def _brl(value) -> str:
    return f"R$ {_money(value):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def trip_notes(cte: dict) -> list:
    """Motorista, placas, seguro e vale-pedágio da viagem em texto: o CT-e 4.00
    não tem esses grupos (estão no MDF-e), então vão nas observações do DACTE."""
    notes = []
    motorista = cte.get("motorista") or {}
    if _text(motorista.get("nome")):
        cpf = only_digits(motorista.get("cpf"))
        notes.append(f"Motorista: {_text(motorista['nome'])}" + (f" - CPF {cpf[:3]}.{cpf[3:6]}.{cpf[6:9]}-{cpf[9:]}" if len(cpf) == 11 else ""))
    placas = [p for p in [cte.get("veiculo_placa"), *(cte.get("reboque_placas") or [])] if _text(p)]
    if placas:
        notes.append("Placas: " + " / ".join(_text(p).upper() for p in placas))
    if _text(cte.get("seguradora_nome")) or _text(cte.get("seguro_apolice")):
        seguro = "Seguro: " + (_text(cte.get("seguradora_nome")) or "-")
        if _text(cte.get("seguro_apolice")):
            seguro += f" - Apólice {_text(cte['seguro_apolice'])}"
        if _text(cte.get("seguro_averbacao")):
            seguro += f" - Averbação {_text(cte['seguro_averbacao'])}"
        if cte.get("seguro_responsavel"):
            seguro += " - Resp.: " + ("Emitente" if int(cte["seguro_responsavel"]) == 1 else "Contratante")
        notes.append(seguro)
    for vale in cte.get("vales_pedagio") or []:
        if not _text(vale.get("numero_comprovante")) and not _money(vale.get("valor")):
            continue
        parts = [f"Vale-pedágio nº {_text(vale.get('numero_comprovante')) or '-'}", _brl(vale.get("valor"))]
        if _text(vale.get("fornecedor_nome")) or only_digits(vale.get("fornecedor_cnpj")):
            parts.append("Fornecedora " + (_text(vale.get("fornecedor_nome")) or only_digits(vale.get("fornecedor_cnpj"))))
        if vale.get("tipo") in TOLL_TYPES:
            parts.append(TOLL_TYPES[vale["tipo"]])
        if vale.get("pago_por") in TOLL_PAYERS:
            parts.append("Pago por " + TOLL_PAYERS[vale["pago_por"]])
        notes.append(" - ".join(parts))
    return notes


def _party(party: dict, suffix: str) -> dict:
    """Remetente/destinatário/tomador no formato da Focus (campo_<sufixo>)."""
    address = party.get("endereco") or {}
    doc = only_digits(party.get("cnpj_cpf"))
    out = {f"{'cnpj' if len(doc) == 14 else 'cpf'}_{suffix}": doc}
    ie = _text(party.get("ie")).upper()
    if ie:
        out[f"inscricao_estadual_{suffix}"] = "ISENTO" if ie == "ISENTO" else only_digits(ie)
    out[f"nome_{suffix}"] = _text(party.get("nome"), 60)
    # xFant só existe no leiaute para o remetente e o tomador "Outros"
    if suffix in ("remetente", "tomador") and len(_text(party.get("nome_fantasia"))) >= 2:
        out[f"nome_fantasia_{suffix}"] = _text(party.get("nome_fantasia"), 60)
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


CONTAINER_TYPE_CODES = {"DC": "DRY", "DV": "DRY", "GP": "DRY", "DRY": "DRY", "HC": "HC", "HQ": "HC",
                        "RF": "REEFER", "RH": "REEFER", "RE": "REEFER", "OT": "OPEN TOP", "FR": "FLAT RACK",
                        "PL": "FLAT RACK", "TK": "TANK", "TN": "TANK"}


def container_from_size_type(size_type) -> dict:
    """Código do Gate (20DC, 40HC, 40RF...) -> tamanho e tipo do CT-e."""
    m = re.fullmatch(r"(20|40|45)\s*([A-Z ]+)", _text(size_type).upper())
    if not m:
        return {}
    return {"tamanho": m.group(1), "tipo": CONTAINER_TYPE_CODES.get(m.group(2).strip())}


def tare_kg(value):
    """Tara gravada como texto no Gate ("3.800", "3800 kg") -> número em kg."""
    digits = re.sub(r"[^\d,]", "", str(value or "")).replace(",", ".")
    try:
        return float(digits) if digits else None
    except ValueError:
        return None


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


def _date(value) -> str:
    return str(value)[:10] if value else ""


def _document(doc: dict):
    """Um documento originário no formato da Focus: (item, grupo). Só vai o
    que o leiaute 4.00 tem para o tipo; o resto fica no sistema e no espelho.
      NFE    -> nfes (infNFe): chave, PIN, dPrev
      NF     -> nfs (infNF, modelo 01 = NF 1/1A): série, número, emissão,
                bases/valores de ICMS e ST, produtos, total, CFOP, peso, PIN, dPrev
      OUTROS -> outros_documentos (infOutros): tipo, descrição, número, emissão, valor, dPrev"""
    tipo = doc.get("tipo")
    pin = _text(doc.get("pin_suframa"), 9)
    if tipo == "NFE":
        item = {"chave_nfe": only_digits(doc.get("chave"))}
        if pin:
            item["pin_suframa"] = pin
        if _date(doc.get("data_prevista")):
            item["data_prevista"] = _date(doc.get("data_prevista"))
        return item, "nfes"
    if tipo == "NF":
        # No infNF as bases e valores são obrigatórios: sem valor, vai 0,00
        item = {
            "modelo": "01",
            "serie": _text(doc.get("serie"), 3),
            "numero": _text(doc.get("numero"), 20),
            "data_emissao": _date(doc.get("data_emissao")),
            "valor_base_calculo_icms": _dec(doc.get("icms_base_calculo")),
            "valor_total_icms": _dec(doc.get("icms_valor")),
            "valor_base_calculo_icms_st": _dec(doc.get("icms_st_base_calculo")),
            "valor_icms_st": _dec(doc.get("icms_st_valor")),
            "valor_produtos": _dec(doc.get("valor_produtos")),
            "valor": _dec(doc.get("valor")),
            "cfop": only_digits(doc.get("cfop"))[:4],
        }
        if float(doc.get("peso") or 0) > 0:
            item["peso"] = _dec(doc.get("peso"), 3)
        if pin:
            item["pin_suframa"] = pin
        if _date(doc.get("data_prevista")):
            item["previsao_entrega"] = _date(doc.get("data_prevista"))
        return item, "nfs"
    item = {"tipo_documento": str(doc.get("tipo_outros") or "99").zfill(2)}
    if _text(doc.get("descricao")):
        item["descricao_documento"] = _text(doc.get("descricao"), 100)
    if _text(doc.get("numero")):
        item["numero"] = _text(doc.get("numero"), 100)
    if _date(doc.get("data_emissao")):
        item["data_emissao"] = _date(doc.get("data_emissao"))
    if doc.get("valor") is not None:
        item["valor"] = _dec(doc.get("valor"))
    if _date(doc.get("data_prevista")):
        item["data_prevista"] = _date(doc.get("data_prevista"))
    return item, "outros_documentos"


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
    # <exped> e <receb>: opcionais, obrigatórios quando são o tomador
    for code, key in ((1, "expedidor"), (2, "recebedor")):
        if papel == code or _filled(cte.get(key)):
            payload.update(_party(cte.get(key) or {}, key))

    payload["valor_total"] = _dec(total)
    payload["valor_receber"] = _dec(receber)
    componentes = [{"nome": _text(c.get("nome"), 15).upper(), "valor": _dec(c.get("valor"))}
                   for c in cte.get("componentes") or [] if _text(c.get("nome"))]
    if componentes:
        payload["componentes_valor"] = componentes
    payload.update(_icms(cst, total, aliquota))
    payload.update(_ibs_cbs(settings, total))

    # infCarga: produto predominante, valor e quantidades somam a grade de documentos
    payload["produto_predominante"] = _text(predominant_product(cte, settings), 60)
    valor_carga = cargo_value(cte)
    if valor_carga is not None:
        payload["valor_total_carga"] = _dec(valor_carga)
    if _text(cte.get("outras_caracteristicas")):
        payload["outras_caracteristicas_carga"] = _text(cte.get("outras_caracteristicas"), 40)
    payload["quantidades"] = [{
        "codigo_unidade_medida": str(q.get("unidade") or "01").zfill(2),
        "tipo_medida": _text(q.get("tipo_medida"), 20) or "PESO BRUTO",
        "quantidade": _dec(q.get("quantidade"), 4),
    } for q in cargo_quantities(cte)]

    # Containers vão como unidades de carga do primeiro documento transportado
    units = _cargo_units(cte.get("containers"))
    groups = {"nfes": [], "nfs": [], "outros_documentos": []}
    for doc in cte.get("documentos") or []:
        item, target = _document(doc)
        if units and not any(groups.values()):
            item["unidades_carga"] = units
        groups[target].append(item)
    for target, items in groups.items():
        if items:
            payload[target] = items

    obs = _text(" | ".join(n for n in [_text(cte.get("observacoes")), *trip_notes(cte)] if n), 2000)
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
