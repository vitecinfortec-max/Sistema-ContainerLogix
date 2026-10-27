"""Monta o pedido de emissão do MDF-e (rodoviário, emitente prestador de
serviço de transporte) no formato JSON da Focus NFe - ver
https://campos.focusnfe.com.br/mdfe/ - a partir do MDF-e salvo no sistema e
da Configuração Fiscal. Funções puras, como em fiscal_cte.py."""
import re
from datetime import datetime

from fiscal_cte import (
    PROVIDER_STATUS, UF_CODES, _dec, _municipality_ok, _text, emission_datetime, only_digits,
)

MDFE_PROVIDER_STATUS = {**PROVIDER_STATUS, "encerrado": "ENCERRADO"}
TIPO_RODADO = {"01", "02", "03", "04", "05", "06"}
TIPO_CARROCERIA = {"00", "01", "02", "03", "04", "05"}
TIPO_CARGA = {"01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11"}
TIPO_PROPRIETARIO = {"0", "1", "2"}


def _plate(value) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def _cte_key_ok(key) -> bool:
    digits = only_digits(key)
    return len(digits) == 44 and digits[20:22] == "57"


def _owner_errors(owner: dict, label: str) -> list:
    if not owner or not any(_text(v) for v in owner.values()):
        return []
    errors = []
    if len(only_digits(owner.get("cnpj_cpf"))) not in (11, 14):
        errors.append(f"{label}: CNPJ/CPF do proprietário inválido")
    if len(_text(owner.get("nome"))) < 2:
        errors.append(f"{label}: informe o nome do proprietário")
    if len(only_digits(owner.get("rntrc"))) != 8:
        errors.append(f"{label}: RNTRC do proprietário deve ter 8 dígitos")
    if not _text(owner.get("ie")):
        errors.append(f'{label}: informe a IE do proprietário (ou "ISENTO")')
    if (owner.get("uf") or "").upper() not in UF_CODES:
        errors.append(f"{label}: UF do proprietário inválida")
    if str(owner.get("tipo") or "") not in TIPO_PROPRIETARIO:
        errors.append(f"{label}: informe o tipo do proprietário (TAC agregado, TAC independente ou outros)")
    return errors


def validate(mdfe: dict, settings: dict) -> list:
    """Lista de pendências (em português) que impediriam a emissão."""
    errors = []
    if len(only_digits(settings.get("cnpj"))) != 14:
        errors.append("Configuração Fiscal: CNPJ do emitente inválido")
    if not _text(settings.get("ie")):
        errors.append("Configuração Fiscal: informe a Inscrição Estadual do emitente")
    if len(only_digits(settings.get("rntrc"))) != 8:
        errors.append("Configuração Fiscal: RNTRC do emitente deve ter 8 dígitos")
    endereco = settings.get("endereco") or {}
    if len(_text(endereco.get("cidade"))) < 2 or not _municipality_ok(endereco.get("codigo_municipio"), endereco.get("uf")):
        errors.append("Configuração Fiscal: município (código IBGE) do endereço do emitente não encontrado")

    uf_ini, uf_fim = (mdfe.get("uf_inicio") or "").upper(), (mdfe.get("uf_fim") or "").upper()
    if uf_ini not in UF_CODES:
        errors.append("Informe a UF de início (carregamento)")
    if uf_fim not in UF_CODES:
        errors.append("Informe a UF de fim (descarregamento)")

    carregamento = mdfe.get("municipios_carregamento") or []
    if not carregamento:
        errors.append("Informe ao menos um município de carregamento")
    for place in carregamento:
        if len(_text(place.get("cidade"))) < 2 or not _municipality_ok(place.get("codigo_municipio"), place.get("uf")):
            errors.append(f"Município de carregamento não encontrado: {_text(place.get('cidade')) or '-'}")
        elif (place.get("uf") or "").upper() != uf_ini:
            errors.append(f"Município de carregamento {place.get('cidade')} não é da UF de início ({uf_ini})")

    for uf in mdfe.get("percursos") or []:
        if (uf or "").upper() not in UF_CODES:
            errors.append(f"UF de percurso inválida: {uf}")
        elif (uf or "").upper() in (uf_ini, uf_fim):
            errors.append(f"UF de percurso {uf} não pode ser a de início nem a de fim")

    descarregamentos = mdfe.get("descarregamentos") or []
    if not descarregamentos:
        errors.append("Informe ao menos um município de descarregamento com os CT-es")
    for place in descarregamentos:
        cidade = _text(place.get("cidade")) or "-"
        if len(_text(place.get("cidade"))) < 2 or not _municipality_ok(place.get("codigo_municipio"), place.get("uf")):
            errors.append(f"Município de descarregamento não encontrado: {cidade}")
        elif (place.get("uf") or "").upper() != uf_fim:
            errors.append(f"Município de descarregamento {cidade} não é da UF de fim ({uf_fim})")
        if not place.get("ctes"):
            errors.append(f"Descarregamento em {cidade}: informe ao menos uma chave de CT-e")
        elif not all(_cte_key_ok(k) for k in place["ctes"]):
            errors.append(f"Descarregamento em {cidade}: chave de CT-e inválida (44 dígitos, modelo 57)")
    keys = [only_digits(k) for p in descarregamentos for k in (p.get("ctes") or [])]
    if len(keys) != len(set(keys)):
        errors.append("A mesma chave de CT-e aparece mais de uma vez")

    veiculo = mdfe.get("veiculo") or {}
    if len(_plate(veiculo.get("placa"))) != 7:
        errors.append("Veículo: placa inválida (7 caracteres)")
    if not veiculo.get("tara") or int(veiculo["tara"]) <= 0:
        errors.append("Veículo: informe a tara (kg)")
    if str(veiculo.get("tipo_rodado") or "") not in TIPO_RODADO:
        errors.append("Veículo: informe o tipo de rodado")
    if str(veiculo.get("tipo_carroceria") or "") not in TIPO_CARROCERIA:
        errors.append("Veículo: informe o tipo de carroceria")
    if (veiculo.get("uf_licenciamento") or "").upper() not in UF_CODES:
        errors.append("Veículo: informe a UF de licenciamento")
    errors += _owner_errors(veiculo.get("proprietario"), "Veículo")

    reboques = mdfe.get("reboques") or []
    if len(reboques) > 3:
        errors.append("No máximo 3 reboques")
    for i, reboque in enumerate(reboques, 1):
        label = f"Reboque {i}"
        if len(_plate(reboque.get("placa"))) != 7:
            errors.append(f"{label}: placa inválida (7 caracteres)")
        if not reboque.get("tara") or int(reboque["tara"]) <= 0:
            errors.append(f"{label}: informe a tara (kg)")
        if not reboque.get("capacidade_kg") or int(reboque["capacidade_kg"]) <= 0:
            errors.append(f"{label}: informe a capacidade (kg)")
        if str(reboque.get("tipo_carroceria") or "") not in TIPO_CARROCERIA:
            errors.append(f"{label}: informe o tipo de carroceria")
        if (reboque.get("uf_licenciamento") or "").upper() not in UF_CODES:
            errors.append(f"{label}: informe a UF de licenciamento")
        errors += _owner_errors(reboque.get("proprietario"), label)

    condutores = mdfe.get("condutores") or []
    if not condutores:
        errors.append("Informe ao menos um condutor")
    if len(condutores) > 10:
        errors.append("No máximo 10 condutores")
    for c in condutores:
        if len(_text(c.get("nome"))) < 2 or len(only_digits(c.get("cpf"))) != 11:
            errors.append(f"Condutor {_text(c.get('nome')) or '-'}: informe nome e CPF (11 dígitos)")

    for c in mdfe.get("ciots") or []:
        if len(only_digits(c.get("numero"))) != 12:
            errors.append("CIOT deve ter 12 dígitos")
        if len(only_digits(c.get("responsavel_cnpj_cpf"))) not in (11, 14):
            errors.append("CIOT: informe o CNPJ/CPF do responsável pela geração")

    for c in mdfe.get("contratantes") or []:
        if len(only_digits(c.get("cnpj_cpf"))) not in (11, 14):
            errors.append(f"Contratante {_text(c.get('nome')) or '-'}: CNPJ/CPF inválido")

    responsavel = mdfe.get("seguro_responsavel") or settings.get("seguro_responsavel")
    if responsavel not in (1, 2):
        errors.append("Seguro da carga: informe o responsável (emitente ou contratante)")
    elif responsavel == 2 and len(only_digits(mdfe.get("seguro_responsavel_cnpj_cpf"))) not in (11, 14):
        errors.append("Seguro da carga: informe o CNPJ/CPF do contratante responsável pelo seguro")
    seguradora_cnpj = only_digits(mdfe.get("seguradora_cnpj") or settings.get("seguradora_cnpj"))
    if seguradora_cnpj and len(seguradora_cnpj) != 14:
        errors.append("Seguro da carga: CNPJ da seguradora inválido")

    if str(mdfe.get("tipo_carga") or settings.get("mdfe_tipo_carga") or "") not in TIPO_CARGA:
        errors.append("Informe o tipo da carga")
    if len(_text(mdfe.get("descricao_produto") or settings.get("produto_predominante"))) < 2:
        errors.append("Informe a descrição do produto predominante")
    if not mdfe.get("valor_total_carga") or float(mdfe["valor_total_carga"]) <= 0:
        errors.append("Informe o valor total da carga")
    if not mdfe.get("peso_bruto") or float(mdfe["peso_bruto"]) <= 0:
        errors.append("Informe o peso bruto da carga")
    if mdfe.get("unidade_peso") not in ("01", "02"):
        errors.append("Unidade do peso deve ser KG ou TON")
    return errors


def _doc_field(value, cnpj_key: str, cpf_key: str) -> dict:
    digits = only_digits(value)
    return {cnpj_key if len(digits) == 14 else cpf_key: digits}


def _owner(owner: dict, suffix: str = "") -> dict:
    if not owner or not any(_text(v) for v in owner.values()):
        return {}
    ie = _text(owner.get("ie")).upper()
    out = _doc_field(owner.get("cnpj_cpf"), f"cnpj_proprietario{suffix}", f"cpf_proprietario{suffix}")
    rntrc_key = "rntrc_proprietario_veiculo" if suffix else "rntrc"
    out.update({
        rntrc_key: only_digits(owner.get("rntrc")),
        f"razao_social_proprietario{suffix}": _text(owner.get("nome"), 60),
        f"inscricao_estadual_proprietario{suffix}": "ISENTO" if ie == "ISENTO" else only_digits(ie),
        f"uf_proprietario{suffix}": (owner.get("uf") or "").upper(),
        f"tipo_proprietario{suffix}": str(owner.get("tipo")),
    })
    return out


def build_payload(mdfe: dict, settings: dict, now: datetime = None) -> dict:
    """Corpo do POST /v2/mdfe da Focus NFe. Chamar validate() antes. Série e
    número ficam com a Focus (numeração automática da empresa)."""
    endereco = settings.get("endereco") or {}
    payload = {
        "emitente": "1",  # prestador de serviço de transporte (com CT-e)
        "data_emissao": emission_datetime(now),
        "uf_inicio": (mdfe.get("uf_inicio") or "").upper(),
        "uf_fim": (mdfe.get("uf_fim") or "").upper(),
        "municipios_carregamento": [
            {"codigo": only_digits(p.get("codigo_municipio")), "nome": _text(p.get("cidade"), 60)}
            for p in mdfe.get("municipios_carregamento") or []
        ],
        "cnpj_emitente": only_digits(settings.get("cnpj")),
        "inscricao_estadual_emitente": only_digits(settings.get("ie")),
        "nome_emitente": _text(settings.get("razao_social"), 60),
        "logradouro_emitente": _text(endereco.get("logradouro"), 60),
        "numero_emitente": _text(endereco.get("numero"), 60) or "S/N",
        "bairro_emitente": _text(endereco.get("bairro"), 60),
        "codigo_municipio_emitente": only_digits(endereco.get("codigo_municipio")),
        "municipio_emitente": _text(endereco.get("cidade"), 60),
        "uf_emitente": (endereco.get("uf") or "").upper(),
    }
    if mdfe.get("percursos"):
        payload["percursos"] = [{"uf_percurso": (uf or "").upper()} for uf in mdfe["percursos"]]
    if mdfe.get("data_inicio_viagem"):
        payload["data_hora_previsto_inicio_viagem"] = f"{str(mdfe['data_inicio_viagem'])[:16]}:00-03:00" \
            if "T" in str(mdfe["data_inicio_viagem"]) else f"{str(mdfe['data_inicio_viagem'])[:10]}T00:00:00-03:00"
    if _text(settings.get("nome_fantasia")):
        payload["nome_fantasia_emitente"] = _text(settings.get("nome_fantasia"), 60)
    if _text(endereco.get("complemento")):
        payload["complemento_emitente"] = _text(endereco.get("complemento"), 60)
    if len(only_digits(endereco.get("cep"))) == 8:
        payload["cep_emitente"] = only_digits(endereco.get("cep"))
    if 6 <= len(only_digits(settings.get("fone"))) <= 14:
        payload["telefone_emitente"] = only_digits(settings.get("fone"))
    if _text(settings.get("email")):
        payload["email_emitente"] = _text(settings.get("email"), 60)

    payload["municipios_descarregamento"] = [{
        "codigo": only_digits(p.get("codigo_municipio")),
        "nome": _text(p.get("cidade"), 60),
        "conhecimentos_transporte": [{"chave_cte": only_digits(k)} for k in p.get("ctes") or []],
    } for p in mdfe.get("descarregamentos") or []]

    responsavel = mdfe.get("seguro_responsavel") or settings.get("seguro_responsavel")
    seguro = {"responsavel_seguro": str(responsavel)}
    if responsavel == 2:
        seguro.update(_doc_field(mdfe.get("seguro_responsavel_cnpj_cpf"), "cnpj_responsavel", "cpf_responsavel"))
    seguradora_nome = _text(mdfe.get("seguradora_nome") or settings.get("seguradora_nome"), 30)
    seguradora_cnpj = only_digits(mdfe.get("seguradora_cnpj") or settings.get("seguradora_cnpj"))
    apolice = _text(mdfe.get("seguro_apolice") or settings.get("seguro_apolice"), 20)
    if seguradora_nome:
        seguro["nome_seguradora"] = seguradora_nome
    if seguradora_cnpj:
        seguro["cnpj_seguradora"] = seguradora_cnpj
    if apolice:
        seguro["numero_apolice"] = apolice
    averbacoes = [_text(a, 40) for a in mdfe.get("averbacoes") or [] if _text(a)]
    if averbacoes:
        seguro["numero_averbacao"] = averbacoes
    payload["seguros_carga"] = [seguro]

    payload["tipo_carga"] = str(mdfe.get("tipo_carga") or settings.get("mdfe_tipo_carga") or "04")
    payload["descricao_produto"] = _text(mdfe.get("descricao_produto") or settings.get("produto_predominante"), 120)
    payload["quantidade_total_cte"] = str(sum(len(p.get("ctes") or []) for p in mdfe.get("descarregamentos") or []))
    payload["valor_total_carga"] = _dec(mdfe.get("valor_total_carga"))
    payload["codigo_unidade_medida_peso_bruto"] = mdfe.get("unidade_peso") or "01"
    payload["peso_bruto"] = _dec(mdfe.get("peso_bruto"), 4)
    obs = _text(mdfe.get("observacoes"), 5000)
    if obs:
        payload["informacao_complementar"] = obs

    veiculo = mdfe.get("veiculo") or {}
    rodo = {
        "registro_nacional_transporte": only_digits(settings.get("rntrc")),
        "placa_veiculo": _plate(veiculo.get("placa")),
        "tara_veiculo": str(int(veiculo.get("tara") or 0)),
        "tipo_rodado_veiculo": str(veiculo.get("tipo_rodado")),
        "tipo_carroceria_veiculo": str(veiculo.get("tipo_carroceria")),
        "uf_licenciamento_veiculo": (veiculo.get("uf_licenciamento") or "").upper(),
        "condutores": [{"nome": _text(c.get("nome"), 60), "cpf": only_digits(c.get("cpf"))}
                       for c in mdfe.get("condutores") or []],
    }
    if 9 <= len(only_digits(veiculo.get("renavam"))) <= 11:
        rodo["renavam_veiculo"] = only_digits(veiculo.get("renavam"))
    if veiculo.get("capacidade_kg"):
        rodo["capacidade_kg_veiculo"] = str(int(veiculo["capacidade_kg"]))
    rodo.update(_owner(veiculo.get("proprietario"), "_veiculo"))
    reboques = []
    for r in mdfe.get("reboques") or []:
        item = {
            "placa": _plate(r.get("placa")),
            "tara": str(int(r.get("tara") or 0)),
            "capacidade_kg": str(int(r.get("capacidade_kg") or 0)),
            "tipo_carroceria": str(r.get("tipo_carroceria")),
            "uf_licenciamento": (r.get("uf_licenciamento") or "").upper(),
        }
        if 9 <= len(only_digits(r.get("renavam"))) <= 11:
            item["renavam"] = only_digits(r.get("renavam"))
        item.update(_owner(r.get("proprietario")))
        reboques.append(item)
    if reboques:
        rodo["veiculos_reboque"] = reboques
    ciots = [{"ciot": only_digits(c.get("numero")),
              **_doc_field(c.get("responsavel_cnpj_cpf"), "cnpj_responsavel", "cpf_responsavel")}
             for c in mdfe.get("ciots") or [] if only_digits(c.get("numero"))]
    if ciots:
        rodo["ciot"] = ciots
    contratantes = []
    for c in mdfe.get("contratantes") or []:
        item = {"nome": _text(c.get("nome"), 60)} if len(_text(c.get("nome"))) >= 2 else {}
        item.update(_doc_field(c.get("cnpj_cpf"), "cnpj", "cpf"))
        contratantes.append(item)
    if contratantes:
        rodo["contratantes"] = contratantes
    payload["modal_rodoviario"] = rodo
    return payload


def provider_result(response: dict) -> dict:
    """Campos da consulta do MDF-e na Focus NFe que o sistema guarda."""
    status_focus = (response.get("status") or "").lower()
    motivo = response.get("mensagem_sefaz") or response.get("mensagem")
    codigo = response.get("status_sefaz")
    if motivo and codigo:
        motivo = f"{codigo} - {motivo}"
    result = {
        "status": MDFE_PROVIDER_STATUS.get(status_focus, "ERRO"),
        "chave": only_digits(response.get("chave")) or None,  # vem com o prefixo "MDFe"
        "protocolo": response.get("protocolo"),
        "motivo": motivo,
        "caminho_damdfe": response.get("caminho_damdfe"),
        "caminho_xml": response.get("caminho_xml"),
    }
    if response.get("numero") not in (None, ""):
        result["numero"] = int(response["numero"])
    if response.get("serie") not in (None, ""):
        result["serie"] = int(response["serie"])
    return result
