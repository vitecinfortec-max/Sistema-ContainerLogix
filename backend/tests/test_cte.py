"""Fiscal / CT-e: Configuração Fiscal, rascunho a partir da Ordem de
Carregamento, emissão pela Nuvem Fiscal (simulada), numeração, rejeição,
cancelamento e travas."""
import httpx
import pytest

import fiscal_cte
import fiscal_nuvem


class FakeProvider:
    """Nuvem Fiscal de mentira: guarda o que recebeu e responde o combinado."""

    def __init__(self):
        self.calls = []
        self.emit_status = "autorizado"
        self.emit_error = None
        self.cancel_status = "registrado"
        self.counter = 0

    async def save_company(self, cnpj, payload):
        self.calls.append(("save_company", cnpj, payload))
        return payload

    async def save_cte_config(self, cnpj, crt, ambiente):
        self.calls.append(("save_cte_config", cnpj, crt, ambiente))
        return {"CRT": crt, "ambiente": ambiente}

    async def get_certificate(self, cnpj):
        return None

    async def upload_certificate(self, cnpj, pfx_base64, password):
        self.calls.append(("upload_certificate", cnpj, pfx_base64, password))
        return {"subject_name": "EMPRESA TESTE:11222333000181", "not_valid_after": "2027-10-01T00:00:00Z",
                "cpf_cnpj": cnpj, "issuer_name": "AC TESTE"}

    async def emit_cte(self, payload):
        self.calls.append(("emit_cte", payload))
        if self.emit_error:
            raise self.emit_error
        self.counter += 1
        ide = payload["infCte"]["ide"]
        response = {"id": f"cte_{self.counter}", "status": self.emit_status, "numero": ide["nCT"],
                    "chave": "23261011222333000181570010000000011000000010",
                    "autorizacao": {"codigo_status": 100, "motivo_status": "Autorizado o uso do CT-e",
                                    "numero_protocolo": "323260000000001"}}
        if self.emit_status == "rejeitado":
            response["chave"] = None
            response["autorizacao"] = {"codigo_status": 539, "motivo_status": "Duplicidade de CT-e"}
        return response

    async def get_cte(self, provider_id):
        return {"id": provider_id, "status": "autorizado", "chave": "2" * 44,
                "autorizacao": {"codigo_status": 100, "motivo_status": "Autorizado", "numero_protocolo": "9"}}

    async def sync_cte(self, provider_id):
        return {}

    async def cancel_cte(self, provider_id, justificativa):
        self.calls.append(("cancel_cte", provider_id, justificativa))
        return {"status": self.cancel_status, "numero_protocolo": "323260000000099",
                "motivo_status": "Evento registrado" if self.cancel_status == "registrado" else "Prazo excedido"}

    async def cte_pdf(self, provider_id):
        return b"%PDF-1.4 dacte"

    async def cte_xml(self, provider_id):
        return b"<cteProc/>"

    def emitted_payloads(self):
        return [c[1] for c in self.calls if c[0] == "emit_cte"]


@pytest.fixture
def provider(monkeypatch):
    fake = FakeProvider()
    for name in ("save_company", "save_cte_config", "get_certificate", "upload_certificate", "emit_cte",
                 "get_cte", "sync_cte", "cancel_cte", "cte_pdf", "cte_xml"):
        monkeypatch.setattr(fiscal_nuvem, name, getattr(fake, name))
    monkeypatch.setattr(fiscal_nuvem, "is_configured", lambda: True)
    return fake


SETTINGS = {
    "ambiente": "homologacao", "cnpj": "11.222.333/0001-81", "ie": "06.123.456-7", "razao_social": "Empresa Teste Ltda",
    "email": "fiscal@teste.local", "crt": 3, "rntrc": "12345678", "cte_serie": 1,
    "endereco": {"logradouro": "Av. Portuária", "numero": "100", "bairro": "Centro", "cep": "60000-000",
                 "cidade": "Fortaleza", "uf": "CE"},
    "icms_cst": "00", "icms_aliquota": 12,
}


def _address(city="Fortaleza"):
    return {"logradouro": "Rua A", "numero": "10", "bairro": "Centro", "cep": "60000000", "cidade": city, "uf": "CE"}


def _cte_body(**extra):
    body = {
        "cfop": "5353", "natureza_operacao": "PRESTACAO DE SERVICO DE TRANSPORTE",
        "tomador_papel": 0, "indicador_ie_tomador": 1,
        "remetente": {"nome": "Cliente Remetente SA", "cnpj_cpf": "11222333000181", "ie": "ISENTO", "endereco": _address()},
        "destinatario": {"nome": "Destinatário Ltda", "cnpj_cpf": "11444777000161", "endereco": _address("Maracanaú")},
        "origem": {"cidade": "São Gonçalo do Amarante", "uf": "CE"},
        "destino": {"cidade": "Fortaleza", "uf": "CE"},
        "valor_total": 1500.0, "componentes": [{"nome": "FRETE", "valor": 1500.0}],
        "quantidades": [{"unidade": "01", "tipo_medida": "PESO BRUTO", "quantidade": 25000}],
        "documentos": [{"tipo": "NFE", "chave": "2" * 44}],
        "containers": [{"numero": "MSCU1234565", "lacre": "L123"}],
    }
    body.update(extra)
    return body


def _configure(api, provider, **extra):
    r = api.put("/api/fiscal/settings", json={**SETTINGS, **extra})
    assert r.status_code == 200, r.text
    r = api.post("/api/fiscal/settings/sync")
    assert r.status_code == 200, r.text
    return r.json()


def _create(api, **extra):
    r = api.post("/api/ctes", json=_cte_body(**extra))
    assert r.status_code == 200, r.text
    return r.json()


def test_settings_are_admin_only_and_keep_defaults(api, provider):
    assert api.get("/api/fiscal/settings", as_user="operator").status_code == 403
    assert api.get("/api/ctes", as_user="operator").status_code == 403
    r = api.get("/api/fiscal/settings")
    assert r.status_code == 200
    data = r.json()
    assert data["ambiente"] == "homologacao"
    assert data["cte_proximo_numero"] == 1
    assert data["provider_configured"] is True


def test_sync_sends_company_with_ibge_code(api, provider):
    r = api.put("/api/fiscal/settings", json={"cnpj": "11222333000181"})
    assert r.status_code == 200
    r = api.post("/api/fiscal/settings/sync")
    assert r.status_code == 400
    assert "Razão Social" in r.json()["detail"]

    data = _configure(api, provider)
    assert data["endereco"]["codigo_municipio"] == "2304400"  # resolvido pelo nome da cidade
    assert data["provider_synced_at"]
    company = next(c for c in provider.calls if c[0] == "save_company")
    assert company[1] == "11222333000181"
    assert company[2]["endereco"]["codigo_municipio"] == "2304400"
    assert company[2]["endereco"]["cep"] == "60000000"
    assert company[2]["inscricao_estadual"] == "061234567"
    assert ("save_cte_config", "11222333000181", 3, "homologacao") in provider.calls


def test_certificate_is_forwarded_not_stored(api, provider):
    r = api.put("/api/fiscal/settings", json=SETTINGS)
    files = {"file": ("cert.pfx", b"PFXDATA", "application/x-pkcs12")}
    r = api.post("/api/fiscal/settings/certificate", files=files, data={"password": "segredo"})
    assert r.status_code == 400  # cadastro da empresa ainda não enviado
    _configure(api, provider)
    r = api.post("/api/fiscal/settings/certificate", files={"file": ("cert.txt", b"x", "text/plain")},
                 data={"password": "segredo"})
    assert r.status_code == 400
    r = api.post("/api/fiscal/settings/certificate", files=files, data={"password": "segredo"})
    assert r.status_code == 200, r.text
    assert r.json()["certificate"]["not_valid_after"].startswith("2027-10-01")
    upload = next(c for c in provider.calls if c[0] == "upload_certificate")
    assert upload[2] == "UEZYREFUQQ==" and upload[3] == "segredo"
    stored = api.run(api.db.fiscal_settings.find_one({}, {"_id": 0}))
    assert "segredo" not in str(stored) and "UEZYREFUQQ" not in str(stored)


def test_next_number_can_move_forward_only(api, provider):
    r = api.put("/api/fiscal/settings", json={"cte_proximo_numero": 150})
    assert r.status_code == 200
    assert r.json()["cte_proximo_numero"] == 150
    r = api.put("/api/fiscal/settings", json={"cte_proximo_numero": 10, "razao_social": "Não grava"})
    assert r.status_code == 400
    assert api.get("/api/fiscal/settings").json().get("razao_social") != "Não grava"
    # Produção tem numeração própria
    r = api.put("/api/fiscal/settings", json={"ambiente": "producao"})
    assert r.json()["cte_proximo_numero"] == 1


def test_draft_from_loading_order(api, provider):
    api.post("/api/clients", json={
        "name": "Cliente Remetente SA", "cnpj": "11.222.333/0001-81", "state_registration": "123",
        "address_details": {"street": "Rua B", "number": "5", "neighborhood": "Mucuripe", "zip": "60180000",
                            "city": "Fortaleza", "state": "CE"},
    })
    r = api.post("/api/loading-orders", json={
        "order_type": "COLETA", "status": "PENDENTE", "client_name": "cliente remetente sa", "booking": "BK1",
        "freight_value": 1800.0, "truck_plate": "RTA2B34", "driver_name": "José",
        "items": [{"container_number": "MSCU1234565", "seal": "L9", "gross_weight": "25.000"},
                  {"container_number": "TGHU1234560", "gross_weight": "3800"}],
    })
    assert r.status_code == 200, r.text
    order = r.json()
    r = api.get(f"/api/ctes/from-loading-order/{order['id']}")
    assert r.status_code == 200, r.text
    draft = r.json()
    assert draft["loading_order_number"] == order["order_number"]
    assert draft["remetente"]["cnpj_cpf"] == "11.222.333/0001-81"
    assert draft["remetente"]["endereco"]["bairro"] == "Mucuripe"
    assert draft["valor_total"] == 1800.0
    assert [c["numero"] for c in draft["containers"]] == ["MSCU1234565", "TGHU1234560"]
    assert draft["quantidades"][0]["quantidade"] == 28800.0
    assert "BK1" in draft["observacoes"]


def test_emit_validates_before_sending(api, provider):
    _configure(api, provider)
    cte = _create(api, documentos=[], valor_total=0, cfop="12")
    r = api.post(f"/api/ctes/{cte['id']}/emitir")
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert "CFOP" in detail and "Valor Total" in detail and "documento transportado" in detail
    assert provider.emitted_payloads() == []
    assert api.get(f"/api/ctes/{cte['id']}").json()["numero"] is None  # nenhum número gasto


def test_emit_authorized_numbers_and_locks(api, provider):
    _configure(api, provider)
    first = _create(api)
    r = api.post(f"/api/ctes/{first['id']}/emitir")
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["status"] == "AUTORIZADO"
    assert doc["numero"] == 1 and doc["serie"] == 1 and doc["ambiente"] == "homologacao"
    assert doc["protocolo"] == "323260000000001"
    assert doc["origem"]["codigo_municipio"] == "2312403"

    payload = provider.emitted_payloads()[0]
    inf = payload["infCte"]
    assert payload["ambiente"] == "homologacao" and payload["referencia"] == f"{first['id']}-1"
    assert inf["ide"]["nCT"] == 1 and inf["ide"]["cUF"] == 23 and inf["ide"]["toma3"] == {"toma": 0}
    assert inf["ide"]["cMunIni"] == "2312403" and inf["ide"]["cMunFim"] == "2304400"
    assert inf["emit"] == {"CNPJ": "11222333000181", "IE": "061234567", "CRT": 3}
    assert inf["imp"]["ICMS"]["ICMS00"] == {"CST": "00", "vBC": 1500.0, "pICMS": 12.0, "vICMS": 180.0}
    unit = inf["infCTeNorm"]["infDoc"]["infNFe"][0]["infUnidCarga"][0]
    assert unit == {"tpUnidCarga": 1, "idUnidCarga": "MSCU1234565", "lacUnidCarga": [{"nLacre": "L123"}]}
    assert inf["infCTeNorm"]["infModal"]["rodo"]["RNTRC"] == "12345678"

    second = _create(api)
    assert api.post(f"/api/ctes/{second['id']}/emitir").json()["numero"] == 2

    # Autorizado não volta a ser transmitido, editado nem excluído
    assert api.post(f"/api/ctes/{first['id']}/emitir").status_code == 400
    assert api.put(f"/api/ctes/{first['id']}", json=_cte_body()).status_code == 400
    assert api.delete(f"/api/ctes/{first['id']}").status_code == 400
    assert len(provider.emitted_payloads()) == 2


def test_rejected_cte_keeps_its_number_on_retry(api, provider):
    _configure(api, provider)
    cte = _create(api)
    provider.emit_status = "rejeitado"
    doc = api.post(f"/api/ctes/{cte['id']}/emitir").json()
    assert doc["status"] == "REJEITADO" and doc["numero"] == 1
    assert doc["motivo"] == "539 - Duplicidade de CT-e"
    # Corrige e transmite de novo: mesmo número, nova referência
    assert api.put(f"/api/ctes/{cte['id']}", json=_cte_body(valor_total=1600.0,
                   componentes=[{"nome": "FRETE", "valor": 1600.0}])).status_code == 200
    provider.emit_status = "autorizado"
    doc = api.post(f"/api/ctes/{cte['id']}/emitir").json()
    assert doc["status"] == "AUTORIZADO" and doc["numero"] == 1 and doc["tentativas"] == 2
    second = provider.emitted_payloads()[1]
    assert second["infCte"]["ide"]["nCT"] == 1 and second["referencia"] == f"{cte['id']}-2"
    assert second["infCte"]["vPrest"]["vTPrest"] == 1600.0
    assert api.get("/api/fiscal/settings").json()["cte_proximo_numero"] == 2


def test_provider_error_marks_error_and_is_reported(api, provider):
    _configure(api, provider)
    cte = _create(api)
    provider.emit_error = fiscal_nuvem.FiscalProviderError("Certificado digital não cadastrado", status_code=400)
    r = api.post(f"/api/ctes/{cte['id']}/emitir")
    assert r.status_code == 400
    assert "Certificado" in r.json()["detail"]
    doc = api.get(f"/api/ctes/{cte['id']}").json()
    assert doc["status"] == "ERRO" and doc["numero"] == 1
    # Pode excluir (nunca chegou à Sefaz)
    assert api.delete(f"/api/ctes/{cte['id']}").status_code == 200


def test_emit_refuses_without_server_credentials_or_sync(api, provider, monkeypatch):
    api.put("/api/fiscal/settings", json=SETTINGS)
    cte = _create(api)
    r = api.post(f"/api/ctes/{cte['id']}/emitir")
    assert r.status_code == 400 and "cadastro da empresa" in r.json()["detail"]
    monkeypatch.setattr(fiscal_nuvem, "is_configured", lambda: False)
    assert api.post(f"/api/ctes/{cte['id']}/emitir").status_code == 503


def test_cte_being_sent_cannot_be_sent_again(api, provider):
    _configure(api, provider)
    cte = _create(api)
    api.run(api.db.ctes.update_one({"id": cte["id"]}, {"$set": {"status": "ENVIANDO"}}))
    assert api.post(f"/api/ctes/{cte['id']}/emitir").status_code == 400
    assert provider.emitted_payloads() == []


def test_cancel_and_documents(api, provider):
    _configure(api, provider)
    cte = _create(api)
    r = api.post(f"/api/ctes/{cte['id']}/cancelar", json={"justificativa": "erro de digitação no valor"})
    assert r.status_code == 400  # ainda não autorizado
    api.post(f"/api/ctes/{cte['id']}/emitir")

    r = api.get(f"/api/ctes/{cte['id']}/pdf")
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    assert api.get(f"/api/ctes/{cte['id']}/xml").content == b"<cteProc/>"

    assert api.post(f"/api/ctes/{cte['id']}/cancelar", json={"justificativa": "curta"}).status_code == 400
    provider.cancel_status = "rejeitado"
    r = api.post(f"/api/ctes/{cte['id']}/cancelar", json={"justificativa": "erro de digitação no valor"})
    assert r.status_code == 400 and "Prazo excedido" in r.json()["detail"]
    assert api.get(f"/api/ctes/{cte['id']}").json()["status"] == "AUTORIZADO"

    provider.cancel_status = "registrado"
    r = api.post(f"/api/ctes/{cte['id']}/cancelar", json={"justificativa": "erro de digitação no valor"})
    assert r.status_code == 200
    doc = r.json()
    assert doc["status"] == "CANCELADO"
    assert doc["cancelamento"]["protocolo"] == "323260000000099"


def test_refresh_pending_cte(api, provider):
    _configure(api, provider)
    cte = _create(api)
    provider.emit_status = "pendente"
    assert api.post(f"/api/ctes/{cte['id']}/emitir").json()["status"] == "PENDENTE"
    r = api.post(f"/api/ctes/{cte['id']}/atualizar")
    assert r.status_code == 200
    assert r.json()["status"] == "AUTORIZADO" and r.json()["protocolo"] == "9"


def test_list_search(api, provider):
    _configure(api, provider)
    _create(api)
    _create(api, remetente={"nome": "Outro Cliente", "cnpj_cpf": "11222333000181", "endereco": _address()})
    assert len(api.get("/api/ctes").json()) == 2
    assert len(api.get("/api/ctes", params={"search": "outro"}).json()) == 1
    assert len(api.get("/api/ctes", params={"search": "MSCU1234565"}).json()) == 2
    assert len(api.get("/api/ctes", params={"status": "AUTORIZADO"}).json()) == 0


def test_module_disabled_blocks_routes(api, provider):
    api.run(api.db.module_config.insert_one({"disabled_modules": ["fiscal"]}))
    assert api.get("/api/ctes").status_code == 403
    assert api.get("/api/fiscal/settings").status_code == 403


def test_builder_icms_variants_and_tomador_outros():
    settings = {**SETTINGS, "produto_predominante": "CONTAINER",
                "endereco": {**SETTINGS["endereco"], "codigo_municipio": "2304400"}}
    place = {"cidade": "Fortaleza", "uf": "CE", "codigo_municipio": "2304400"}
    addr = {**_address(), "codigo_municipio": "2304400"}
    body = _cte_body(origem=place, destino=place, tomador_papel=4,
                     tomador={"nome": "Armador X", "cnpj_cpf": "11444777000161", "ie": "isento", "endereco": addr},
                     remetente={"nome": "R", "cnpj_cpf": "11144477735", "endereco": addr},
                     destinatario={"nome": "D", "cnpj_cpf": "11222333000181", "endereco": addr})
    # Nome com 1 letra o layout recusa
    assert fiscal_cte.validate(body, settings) == ["Remetente: informe o nome / razão social",
                                                   "Destinatário: informe o nome / razão social"]
    body["remetente"]["nome"], body["destinatario"]["nome"] = "Remetente", "Destinatário"
    assert fiscal_cte.validate(body, settings) == []
    payload = fiscal_cte.build_payload(body, settings, 5, "r")
    toma4 = payload["infCte"]["ide"]["toma4"]
    assert toma4["toma"] == 4 and toma4["IE"] == "ISENTO" and toma4["enderToma"]["cMun"] == "2304400"
    assert payload["infCte"]["rem"]["CPF"] == "11144477735"
    for cst, key in (("41", "ICMS45"), ("SN", "ICMSSN"), ("60", "ICMS60"), ("90", "ICMS90")):
        icms = fiscal_cte.build_payload({**body, "icms_cst": cst}, settings, 5, "r")["infCte"]["imp"]["ICMS"]
        assert list(icms) == [key]
    assert fiscal_cte.build_payload({**body, "icms_cst": "60"}, settings, 5, "r")["infCte"]["imp"]["ICMS"]["ICMS60"]["vICMSSTRet"] == 180.0
    # Município de outra UF é recusado (código IBGE começa pelo código da UF)
    wrong = {**body, "destino": {"cidade": "Fortaleza", "uf": "SP", "codigo_municipio": "2304400"}}
    assert any("Término" in e for e in fiscal_cte.validate(wrong, settings))


def test_provider_error_message_parsing():
    response = httpx.Response(400, json={"error": {"code": "ValidationFailed", "message": "Dados inválidos",
                                                   "errors": [{"message": "CNPJ inválido"}]}})
    message, _ = fiscal_nuvem._error_message(response)
    assert message == "Dados inválidos: CNPJ inválido"
    assert fiscal_nuvem._error_message(httpx.Response(500, text="boom"))[0] == "boom"


def _schema_validator():
    """Definições do pedido de emissão de CT-e copiadas do swagger da Nuvem
    Fiscal (tests/data). Campo fora do layout também é recusado."""
    import json
    from pathlib import Path
    import jsonschema

    spec = json.loads((Path(__file__).parent / "data" / "nuvemfiscal_cte_schema.json").read_text(encoding="utf-8"))

    def strict(node):
        if isinstance(node, dict):
            if "properties" in node:
                node.setdefault("additionalProperties", False)
            for value in node.values():
                strict(value)
    strict(spec["definitions"])
    return jsonschema.Draft4Validator({"$ref": "#/definitions/CtePedidoEmissao", "definitions": spec["definitions"]})


def test_payload_matches_provider_schema():
    validator = _schema_validator()
    settings = {**SETTINGS, "produto_predominante": "CONTAINER",
                "endereco": {**SETTINGS["endereco"], "codigo_municipio": "2304400"}}
    place = {"cidade": "Fortaleza", "uf": "CE", "codigo_municipio": "2304400"}
    addr = {**_address(), "codigo_municipio": "2304400"}
    parties = {
        "remetente": {"nome": "Remetente", "cnpj_cpf": "11144477735", "fone": "(85) 3333-4444", "email": "a@b.com; c@d.com", "endereco": addr},
        "destinatario": {"nome": "Destinatário", "cnpj_cpf": "11222333000181", "ie": "123", "endereco": addr},
        "tomador": {"nome": "Tomador", "cnpj_cpf": "11444777000161", "endereco": addr},
    }
    for papel in (0, 3, 4):
        for cst in ("00", "41", "51", "60", "90", "SN"):
            for doc in ({"tipo": "NFE", "chave": "2" * 44},
                        {"tipo": "OUTROS", "tipo_outros": "99", "descricao": "Container vazio", "numero": "7",
                         "data_emissao": "2026-10-26", "valor": 10}):
                body = _cte_body(origem=place, destino=place, tomador_papel=papel, icms_cst=cst, icms_aliquota=12,
                                 documentos=[doc], valor_carga=50000, outras_caracteristicas="CONTAINER 40HC",
                                 observacoes="teste", **parties)
                assert fiscal_cte.validate(body, settings) == []
                payload = fiscal_cte.build_payload(body, settings, 1, "ref")
                errors = sorted(validator.iter_errors(payload), key=lambda e: list(e.absolute_path))
                assert not errors, (papel, cst, doc["tipo"], [(list(e.absolute_path), e.message) for e in errors])
    # O validador pega campo fora do layout
    payload["infCte"]["ide"]["campoInventado"] = 1
    assert list(validator.iter_errors(payload))


def test_municipality_codes_come_from_local_ibge_table(api):
    r = api.get("/api/fiscal/municipios/ce")
    assert r.status_code == 200
    rows = {m["nome"]: m["codigo"] for m in r.json()}
    assert rows["Fortaleza"] == "2304400" and rows["São Gonçalo do Amarante"] == "2312403"
    assert len(api.get("/api/fiscal/municipios/SP").json()) == 645
    assert api.get("/api/fiscal/municipios/XX").status_code == 400
