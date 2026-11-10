"""CT-e (10/11/2026): Expedidor e Recebedor (exped/receb, inclusive como
tomador) e a grade de documentos originários com NF-e, NF modelo 1/1A e
outros, somando peso, quantidade, cubagem e valor no infCarga."""
import io
import json
from pathlib import Path

from pdfminer.high_level import extract_text

import fiscal_cte
from test_cte import NFE_KEY, _address, _check_fields, _full_body, _full_settings
from test_mdfe import provider  # noqa: F401  (fixture)

SPEC = json.loads((Path(__file__).parent / "data" / "focusnfe_cte_fields.json").read_text(encoding="utf-8"))["fields"]
ADDR = {**_address(), "codigo_municipio": "2304400"}
EXPEDIDOR = {"nome": "APM Terminals Pecem", "nome_fantasia": "APM", "cnpj_cpf": "11222333000181", "ie": "123",
             "fone": "(85) 3333-0000", "endereco": ADDR}
RECEBEDOR = {"nome": "Armazém Recebedor Ltda", "cnpj_cpf": "11444777000161", "endereco": ADDR}
NF_1A = {"tipo": "NF", "numero": "155309", "serie": "1", "data_emissao": "2026-11-05", "cfop": "5102",
         "natureza_carga": "PLASTIFICANTE", "peso": 12500.1234, "quantidade": 10, "cubagem": 30.5, "especie": "CAIXA",
         "marca": "SKY", "valor_produtos": 1000, "icms_base_calculo": 1000, "icms_valor": 120, "icms_st_base_calculo": 0,
         "icms_st_valor": 0, "valor_outros": 5, "valor": 1005, "pin_suframa": "12345", "data_prevista": "2026-11-12"}


def test_access_key_check_digit():
    assert fiscal_cte.access_key_ok(NFE_KEY)
    assert not fiscal_cte.access_key_ok("2" * 44)
    assert not fiscal_cte.access_key_ok("123")
    # Dígito certo mas modelo errado (não é 55): não serve como NF-e
    assert fiscal_cte.access_key_ok("2" * 43 + "4") and not fiscal_cte.access_key_ok("2" * 43 + "4", "55")
    assert fiscal_cte.access_key_ok(NFE_KEY, "55")


def test_expedidor_and_recebedor_as_tomador():
    settings = _full_settings()
    # Tomador expedidor sem o bloco preenchido: pendência, não envia vazio
    body = _full_body(tomador_papel=1, tomador=None)
    assert any(e.startswith("Expedidor:") for e in fiscal_cte.validate(body, settings))
    for papel, key, party in ((1, "expedidor", EXPEDIDOR), (2, "recebedor", RECEBEDOR)):
        body = _full_body(tomador_papel=papel, tomador=None, **{key: party})
        assert fiscal_cte.validate(body, settings) == []
        payload = fiscal_cte.build_payload(body, settings)
        assert payload["tomador"] == str(papel)
        assert payload[f"nome_{key}"] == party["nome"]
        assert payload[f"cnpj_{key}"] == party["cnpj_cpf"]
        assert payload[f"codigo_municipio_{key}"] == "2304400"
        assert fiscal_cte.payer_of(body)["nome"] == party["nome"]
        assert not _check_fields(payload, SPEC), _check_fields(payload, SPEC)
    # O leiaute não tem nome fantasia para o expedidor: fica só no sistema
    payload = fiscal_cte.build_payload(_full_body(tomador_papel=1, tomador=None, expedidor=EXPEDIDOR), settings)
    assert "nome_fantasia_expedidor" not in payload


def test_optional_parties_go_only_when_filled():
    settings = _full_settings()
    payload = fiscal_cte.build_payload(_full_body(), settings)
    assert not any(k.endswith(("_expedidor", "_recebedor")) for k in payload)
    body = _full_body(expedidor=EXPEDIDOR, recebedor=RECEBEDOR)
    assert fiscal_cte.validate(body, settings) == []
    payload = fiscal_cte.build_payload(body, settings)
    assert payload["tomador"] == "4" and payload["nome_expedidor"] and payload["nome_recebedor"]
    # Preenchido pela metade: aponta o que falta
    half = _full_body(recebedor={"nome": "Só o nome"})
    assert any(e.startswith("Recebedor: CNPJ/CPF") for e in fiscal_cte.validate(half, settings))


def test_nf_model_1a_goes_to_infnf():
    settings = _full_settings()
    body = _full_body(documentos=[NF_1A])
    assert fiscal_cte.validate(body, settings) == []
    payload = fiscal_cte.build_payload(body, settings)
    nf = payload["nfs"][0]
    assert nf["modelo"] == "01" and (nf["serie"], nf["numero"], nf["data_emissao"]) == ("1", "155309", "2026-11-05")
    assert (nf["valor_base_calculo_icms"], nf["valor_total_icms"], nf["valor_produtos"], nf["valor"]) == \
        ("1000.00", "120.00", "1000.00", "1005.00")
    assert (nf["valor_base_calculo_icms_st"], nf["valor_icms_st"]) == ("0.00", "0.00")
    assert (nf["cfop"], nf["peso"], nf["pin_suframa"], nf["previsao_entrega"]) == ("5102", "12500.123", "12345", "2026-11-12")
    # Espécie, marca, cubagem, quantidade, outros e natureza não têm tag no infNF
    for missing in ("especie", "marca", "cubagem", "quantidade", "valor_outros", "natureza_carga"):
        assert missing not in nf
    assert "nfes" not in payload and not _check_fields(payload, SPEC)
    # Containers como unidades de carga do primeiro documento
    assert nf["unidades_carga"][0]["identificacao"] == "MSCU1234565"


def test_nf_model_1a_required_fields():
    errors = fiscal_cte.validate(_full_body(documentos=[{"tipo": "NF"}]), _full_settings())
    for text in ("número da NF", "série da NF", "data de emissão", "CFOP da NF", "valor da NF"):
        assert any(text in e for e in errors), text


def test_nfe_and_outros_mapping_and_duplicates():
    settings = _full_settings()
    nfe = {"tipo": "NFE", "chave": NFE_KEY, "numero": "1", "serie": "1", "pin_suframa": "9988", "data_prevista": "2026-11-20",
           "peso": 100, "valor": 500, "especie": "PALETE"}
    outro = {"tipo": "OUTROS", "tipo_outros": "99", "descricao": "Declaração", "numero": "7", "data_emissao": "2026-11-01",
             "valor": 10, "data_prevista": "2026-11-21"}
    payload = fiscal_cte.build_payload(_full_body(documentos=[nfe, outro]), settings)
    assert payload["nfes"] == [{"chave_nfe": NFE_KEY, "pin_suframa": "9988", "data_prevista": "2026-11-20",
                                "unidades_carga": payload["nfes"][0]["unidades_carga"]}]
    assert payload["outros_documentos"][0]["data_prevista"] == "2026-11-21"
    assert not _check_fields(payload, SPEC)
    dup = fiscal_cte.validate(_full_body(documentos=[nfe, dict(nfe)]), settings)
    assert "A mesma chave de NF-e aparece mais de uma vez" in dup
    bad = fiscal_cte.validate(_full_body(documentos=[{"tipo": "NFE", "chave": "2" * 44}]), settings)
    assert any("dígito verificador" in e for e in bad)


def test_grid_totals_fill_infcarga():
    settings = _full_settings()
    second = {**NF_1A, "numero": "155310", "peso": 0.0001, "quantidade": 5, "cubagem": 0, "valor": 995}
    body = _full_body(documentos=[NF_1A, second], valor_carga=1, produto_predominante="",
                      quantidades=[{"unidade": "01", "tipo_medida": "PESO BRUTO", "quantidade": 1},
                                   {"unidade": "02", "tipo_medida": "TONELADA", "quantidade": 12.5}])
    assert fiscal_cte.document_totals(body) == {"peso": 12500.1235, "quantidade": 15.0, "cubagem": 30.5, "valor": 2000.0}
    payload = fiscal_cte.build_payload(body, settings)
    assert payload["valor_total_carga"] == "2000.00"
    assert payload["quantidades"] == [
        {"codigo_unidade_medida": "01", "tipo_medida": "PESO BRUTO", "quantidade": "12500.1235"},
        {"codigo_unidade_medida": "03", "tipo_medida": "UNIDADE", "quantidade": "15.0000"},
        {"codigo_unidade_medida": "00", "tipo_medida": "CUBAGEM", "quantidade": "30.5000"},
        {"codigo_unidade_medida": "02", "tipo_medida": "TONELADA", "quantidade": "12.5000"},  # manual de outra unidade
    ]
    # Sem produto predominante, vale a natureza da carga do primeiro documento
    assert payload["produto_predominante"] == "PLASTIFICANTE"
    # Grade sem peso/valor: continua valendo o que foi informado à mão
    manual = fiscal_cte.build_payload(_full_body(), settings)
    assert manual["valor_total_carga"] == "50000.00" and manual["quantidades"][0]["quantidade"] == "25000.0000"


def test_payload_fields_for_every_role_and_document_type():
    settings = _full_settings()
    for papel in (0, 1, 2, 3, 4):
        for doc in ({"tipo": "NFE", "chave": NFE_KEY}, NF_1A,
                    {"tipo": "OUTROS", "tipo_outros": "00", "numero": "1", "valor": 1}):
            body = _full_body(tomador_papel=papel, expedidor=EXPEDIDOR, recebedor=RECEBEDOR, documentos=[doc])
            assert fiscal_cte.validate(body, settings) == [], (papel, doc["tipo"])
            problems = _check_fields(fiscal_cte.build_payload(body, settings), SPEC)
            assert not problems, (papel, doc["tipo"], problems)


def test_api_saves_new_fields_and_preview_shows_them(api, provider):  # noqa: F811
    body = _full_body(tomador_papel=2, tomador=None, expedidor=EXPEDIDOR, recebedor=RECEBEDOR,
                      documentos=[NF_1A, {"tipo": "NFE", "chave": NFE_KEY, "numero": "77", "serie": "2", "valor": 10}])
    created = api.post("/api/ctes", json=body)
    assert created.status_code == 200, created.text
    cte = created.json()
    assert cte["expedidor"]["nome_fantasia"] == "APM" and cte["documentos"][0]["especie"] == "CAIXA"
    assert cte["documentos"][0]["peso"] == 12500.1234
    r = api.get(f"/api/ctes/{cte['id']}/preview-pdf")
    assert r.status_code == 200, r.text
    text = " ".join(extract_text(io.BytesIO(r.content)).split())
    assert "APM Terminals Pecem" in text and "Armazém Recebedor Ltda" in text
    assert "155309" in text and "CAIXA" in text and "SKY" in text
    # Tomador recebedor aparece no quadro do tomador
    assert "TOMADOR DO SERVIÇO Armazém Recebedor Ltda" in text


def test_old_cte_without_new_fields_still_opens(api, provider):  # noqa: F811
    old = _full_body()
    created = api.post("/api/ctes", json=old).json()
    api.run(api.db.ctes.update_one({"id": created["id"]}, {"$unset": {"expedidor": "", "recebedor": ""},
                                                          "$set": {"documentos": [{"tipo": "NFE", "chave": NFE_KEY}]}}))
    assert api.get(f"/api/ctes/{created['id']}").status_code == 200
    assert api.get(f"/api/ctes/{created['id']}/preview-pdf").status_code == 200
