"""Fiscal / CT-e: Configuração Fiscal, rascunho a partir da Ordem de
Carregamento, emissão pela Focus NFe (simulada), rejeição, cancelamento,
travas e conferência dos campos contra a lista oficial da Focus."""
import json
from pathlib import Path

import httpx
import pytest

import fiscal_cte
import fiscal_focus
from routers import fiscal as fiscal_router


class FakeFocus:
    """Focus NFe de mentira: guarda o que recebeu e responde o combinado."""

    def __init__(self):
        self.calls = []
        self.result = "autorizado"  # autorizado | erro_autorizacao | processando_autorizacao
        self.processing_polls = 0  # quantas consultas ainda respondem "processando"
        self.emit_error = None
        self.cancel_status = "cancelado"
        self.numero = 0
        self.by_ref = {}

    async def save_company(self, cnpj, payload, company_id=None):
        self.calls.append(("save_company", cnpj, payload, company_id))
        company = {"id": company_id or 777, "cnpj": cnpj, "token_homologacao": "tok-h", "token_producao": "tok-p",
                   "proximo_numero_cte_homologacao": payload.get("proximo_numero_cte_homologacao", 1),
                   "proximo_numero_cte_producao": payload.get("proximo_numero_cte_producao", 1)}
        if payload.get("arquivo_certificado_base64"):
            company.update({"certificado_valido_de": "2026-01-01T00:00:00-03:00",
                            "certificado_valido_ate": "2027-10-01T00:00:00-03:00", "certificado_cnpj": cnpj})
        return company

    async def emit_cte(self, ambiente, token, ref, payload):
        self.calls.append(("emit_cte", ambiente, token, ref, payload))
        if self.emit_error:
            raise self.emit_error
        self.numero += 1
        self.by_ref[ref] = self.numero
        return {"cnpj_emitente": payload["cnpj_emitente"], "ref": ref, "status": "processando_autorizacao"}

    async def get_cte(self, ambiente, token, ref):
        self.calls.append(("get_cte", ambiente, token, ref))
        if self.processing_polls > 0:
            self.processing_polls -= 1
            return {"ref": ref, "status": "processando_autorizacao"}
        numero = self.by_ref.get(ref, 1)
        if self.result == "erro_autorizacao":
            return {"ref": ref, "status": "erro_autorizacao", "status_sefaz": "539",
                    "mensagem_sefaz": "Rejeição: Duplicidade de CT-e"}
        return {"ref": ref, "status": "autorizado", "status_sefaz": "100", "mensagem_sefaz": "Autorizado o uso do CT-e",
                "chave": "CTe2326101122233300018157001" + str(numero).zfill(19), "numero": str(numero), "serie": "1",
                "protocolo": f"32326000000000{numero}",
                "caminho_dacte": f"https://focusnfe.s3.sa-east-1.amazonaws.com/x/{ref}.pdf",
                "caminho_xml": f"/arquivos/{ref}-cte.xml"}

    async def cancel_cte(self, ambiente, token, ref, justificativa):
        self.calls.append(("cancel_cte", ambiente, token, ref, justificativa))
        if self.cancel_status == "cancelado":
            return {"status": "cancelado", "status_sefaz": "135", "mensagem_sefaz": "Evento registrado e vinculado a CT-e",
                    "caminho_xml_cancelamento": "/arquivos/cancel.xml"}
        return {"status": "erro_cancelamento", "status_sefaz": "220",
                "mensagem_sefaz": "Rejeicao: CT-e autorizada ha mais de 7 dias"}

    async def download(self, path, ambiente, token):
        self.calls.append(("download", path, ambiente, token))
        return b"%PDF-1.4 dacte" if path.endswith(".pdf") else b"<cteProc/>"

    def emissions(self):
        return [c for c in self.calls if c[0] == "emit_cte"]


@pytest.fixture
def provider(monkeypatch, api):
    # Fiscal é "sob contratação": nasce desligado, o teste liga na empresa
    api.run(api.db.module_config.replace_one({}, {"disabled_modules": [], "enabled_opt_in": ["fiscal"]}, upsert=True))
    fake = FakeFocus()
    for name in ("save_company", "emit_cte", "get_cte", "cancel_cte", "download"):
        monkeypatch.setattr(fiscal_focus, name, getattr(fake, name))
    monkeypatch.setattr(fiscal_focus, "is_configured", lambda: True)
    monkeypatch.setattr(fiscal_router, "POLL_INTERVAL", 0)
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
    data = api.get("/api/fiscal/settings").json()
    assert data["ambiente"] == "homologacao"
    assert data["provider_configured"] is True
    assert data["has_emission_token"] is False


def test_sync_registers_company_and_keeps_tokens_secret(api, provider):
    api.put("/api/fiscal/settings", json={"cnpj": "11222333000181"})
    r = api.post("/api/fiscal/settings/sync")
    assert r.status_code == 400 and "Razão Social" in r.json()["detail"]

    data = _configure(api, provider)
    assert data["endereco"]["codigo_municipio"] == "2304400"  # resolvido pelo nome da cidade
    assert data["provider_synced_at"] and data["has_emission_token"] is True
    assert "focus_token_homologacao" not in data and "tok-h" not in json.dumps(data)
    _, cnpj, payload, company_id = next(c for c in provider.calls if c[0] == "save_company")
    assert cnpj == "11222333000181" and company_id is None
    assert payload["inscricao_estadual"] == "061234567" and payload["cep"] == "60000000"
    assert payload["habilita_cte"] is True and payload["serie_cte_homologacao"] == 1
    stored = api.run(api.db.fiscal_settings.find_one({}, {"_id": 0}))
    assert stored["focus_token_homologacao"] == "tok-h" and stored["focus_empresa_id"] == 777
    # O próximo envio atualiza a mesma empresa
    api.post("/api/fiscal/settings/sync")
    assert [c[3] for c in provider.calls if c[0] == "save_company"][-1] == 777


def test_certificate_is_forwarded_not_stored(api, provider):
    api.put("/api/fiscal/settings", json=SETTINGS)
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
    _, _, payload, company_id = [c for c in provider.calls if c[0] == "save_company"][-1]
    assert company_id == 777
    assert payload == {"arquivo_certificado_base64": "UEZYREFUQQ==", "senha_certificado": "segredo"}
    stored = api.run(api.db.fiscal_settings.find_one({}, {"_id": 0}))
    assert "segredo" not in str(stored) and "UEZYREFUQQ" not in str(stored)


def test_next_number_goes_to_focus_and_never_back(api, provider):
    _configure(api, provider)
    r = api.put("/api/fiscal/settings", json={"cte_proximo_numero": 150})
    assert r.status_code == 200 and r.json()["cte_proximo_numero"] == 150
    api.post("/api/fiscal/settings/sync")
    payload = [c for c in provider.calls if c[0] == "save_company"][-1][2]
    assert payload["proximo_numero_cte_homologacao"] == 150
    assert api.get("/api/fiscal/settings").json()["cte_proximo_numero"] == 150
    r = api.put("/api/fiscal/settings", json={"cte_proximo_numero": 10, "razao_social": "Não grava"})
    assert r.status_code == 400
    assert api.get("/api/fiscal/settings").json()["razao_social"] != "Não grava"
    # Sem mudança, o próximo envio não mexe na numeração da Focus
    api.post("/api/fiscal/settings/sync")
    assert "proximo_numero_cte_homologacao" not in [c for c in provider.calls if c[0] == "save_company"][-1][2]


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
    draft = api.get(f"/api/ctes/from-loading-order/{order['id']}").json()
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
    assert provider.emissions() == []
    assert api.get(f"/api/ctes/{cte['id']}").json()["status"] == "RASCUNHO"


def test_emit_authorized_and_locks(api, provider):
    _configure(api, provider)
    first = _create(api)
    r = api.post(f"/api/ctes/{first['id']}/emitir")
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["status"] == "AUTORIZADO"
    assert doc["numero"] == 1 and doc["serie"] == 1 and doc["ambiente"] == "homologacao"
    assert doc["protocolo"] == "323260000000001"
    assert doc["chave"].isdigit() and len(doc["chave"]) == 44  # sem o prefixo "CTe"
    assert doc["origem"]["codigo_municipio"] == "2312403"

    _, ambiente, token, ref, payload = provider.emissions()[0]
    assert (ambiente, token) == ("homologacao", "tok-h")
    assert ref == first["id"].replace("-", "") + "t1"
    assert payload["tomador"] == "0" and payload["cfop"] == "5353" and payload["modal"] == "01"
    assert payload["codigo_municipio_inicio"] == "2312403" and payload["codigo_municipio_fim"] == "2304400"
    assert payload["cnpj_emitente"] == "11222333000181" and payload["inscricao_estadual_emitente"] == "061234567"
    assert payload["inscricao_estadual_remetente"] == "ISENTO" and payload["cnpj_destinatario"] == "11444777000161"
    assert (payload["icms_situacao_tributaria"], payload["icms_base_calculo"], payload["icms_aliquota"],
            payload["icms_valor"]) == ("00", "1500.00", "12.00", "180.00")
    assert payload["nfes"][0]["unidades_carga"] == [
        {"tipo": "1", "identificacao": "MSCU1234565", "lacres": [{"numero_lacre": "L123"}]}]
    assert payload["modal_rodoviario"] == {"rntrc": "12345678"}
    assert "numero" not in payload and "serie" not in payload  # numeração é da Focus

    second = _create(api)
    assert api.post(f"/api/ctes/{second['id']}/emitir").json()["numero"] == 2

    # Autorizado não volta a ser transmitido, editado nem excluído
    assert api.post(f"/api/ctes/{first['id']}/emitir").status_code == 400
    assert api.put(f"/api/ctes/{first['id']}", json=_cte_body()).status_code == 400
    assert api.delete(f"/api/ctes/{first['id']}").status_code == 400
    assert len(provider.emissions()) == 2


def test_production_uses_production_token(api, provider):
    _configure(api, provider, ambiente="producao")
    cte = _create(api)
    assert api.post(f"/api/ctes/{cte['id']}/emitir").json()["ambiente"] == "producao"
    assert provider.emissions()[0][1:3] == ("producao", "tok-p")


def test_rejected_cte_can_be_fixed_and_resent(api, provider):
    _configure(api, provider)
    cte = _create(api)
    provider.result = "erro_autorizacao"
    doc = api.post(f"/api/ctes/{cte['id']}/emitir").json()
    assert doc["status"] == "REJEITADO" and doc["motivo"] == "539 - Rejeição: Duplicidade de CT-e"
    assert api.put(f"/api/ctes/{cte['id']}", json=_cte_body(valor_total=1600.0,
                   componentes=[{"nome": "FRETE", "valor": 1600.0}])).status_code == 200
    provider.result = "autorizado"
    doc = api.post(f"/api/ctes/{cte['id']}/emitir").json()
    assert doc["status"] == "AUTORIZADO" and doc["tentativas"] == 2 and doc["motivo"] == "100 - Autorizado o uso do CT-e"
    second = provider.emissions()[1]
    assert second[3] == cte["id"].replace("-", "") + "t2" and second[4]["valor_total"] == "1600.00"


def test_provider_error_marks_error_and_is_reported(api, provider):
    _configure(api, provider)
    cte = _create(api)
    provider.emit_error = fiscal_focus.FiscalProviderError("CNPJ do emitente não autorizado.", status_code=400)
    r = api.post(f"/api/ctes/{cte['id']}/emitir")
    assert r.status_code == 400 and "não autorizado" in r.json()["detail"]
    assert api.get(f"/api/ctes/{cte['id']}").json()["status"] == "ERRO"
    assert api.delete(f"/api/ctes/{cte['id']}").status_code == 200  # nunca chegou à Sefaz


def test_pending_then_refresh(api, provider):
    _configure(api, provider)
    cte = _create(api)
    provider.processing_polls = 99
    doc = api.post(f"/api/ctes/{cte['id']}/emitir").json()
    assert doc["status"] == "PENDENTE"
    assert len([c for c in provider.calls if c[0] == "get_cte"]) == fiscal_router.POLL_ATTEMPTS
    provider.processing_polls = 0
    r = api.post(f"/api/ctes/{cte['id']}/atualizar")
    assert r.status_code == 200 and r.json()["status"] == "AUTORIZADO"


def test_emit_refuses_without_server_token_or_sync(api, provider, monkeypatch):
    api.put("/api/fiscal/settings", json=SETTINGS)
    cte = _create(api)
    r = api.post(f"/api/ctes/{cte['id']}/emitir")
    assert r.status_code == 400 and "cadastro da empresa" in r.json()["detail"]
    monkeypatch.setattr(fiscal_focus, "is_configured", lambda: False)
    assert api.post(f"/api/ctes/{cte['id']}/emitir").status_code == 503


def test_cte_being_sent_cannot_be_sent_again(api, provider):
    _configure(api, provider)
    cte = _create(api)
    api.run(api.db.ctes.update_one({"id": cte["id"]}, {"$set": {"status": "ENVIANDO"}}))
    assert api.post(f"/api/ctes/{cte['id']}/emitir").status_code == 400
    assert provider.emissions() == []


def test_cancel_and_documents(api, provider):
    _configure(api, provider)
    cte = _create(api)
    r = api.post(f"/api/ctes/{cte['id']}/cancelar", json={"justificativa": "erro de digitação no valor"})
    assert r.status_code == 400  # ainda não autorizado
    api.post(f"/api/ctes/{cte['id']}/emitir")

    r = api.get(f"/api/ctes/{cte['id']}/pdf")
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    assert api.get(f"/api/ctes/{cte['id']}/xml").content == b"<cteProc/>"
    downloads = [c for c in provider.calls if c[0] == "download"]
    assert downloads[1][1:] == (f"/arquivos/{cte['id'].replace('-', '')}t1-cte.xml", "homologacao", "tok-h")

    assert api.post(f"/api/ctes/{cte['id']}/cancelar", json={"justificativa": "curta"}).status_code == 400
    provider.cancel_status = "erro_cancelamento"
    r = api.post(f"/api/ctes/{cte['id']}/cancelar", json={"justificativa": "erro de digitação no valor"})
    assert r.status_code == 400 and "mais de 7 dias" in r.json()["detail"]
    assert api.get(f"/api/ctes/{cte['id']}").json()["status"] == "AUTORIZADO"

    provider.cancel_status = "cancelado"
    r = api.post(f"/api/ctes/{cte['id']}/cancelar", json={"justificativa": "erro de digitação no valor"})
    assert r.status_code == 200
    doc = r.json()
    assert doc["status"] == "CANCELADO" and doc["cancelamento"]["motivo"].startswith("135")


def test_list_search(api, provider):
    _configure(api, provider)
    _create(api)
    _create(api, remetente={"nome": "Outro Cliente", "cnpj_cpf": "11222333000181", "endereco": _address()})
    assert len(api.get("/api/ctes").json()) == 2
    assert len(api.get("/api/ctes", params={"search": "outro"}).json()) == 1
    assert len(api.get("/api/ctes", params={"search": "MSCU1234565"}).json()) == 2
    assert len(api.get("/api/ctes", params={"status": "AUTORIZADO"}).json()) == 0


def test_fiscal_is_opt_in_per_company(api, monkeypatch):
    """Nasce desligado (inclusive em empresa com módulos já configurados) e o
    dono liga/desliga pela mesma lista de desligados de sempre."""
    monkeypatch.setattr(fiscal_focus, "is_configured", lambda: True)
    assert api.get("/api/ctes").status_code == 403
    assert "fiscal" in api.get("/api/module-config").json()["disabled_modules"]
    api.run(api.db.module_config.replace_one({}, {"disabled_modules": ["rh"]}, upsert=True))
    assert api.get("/api/fiscal/settings").status_code == 403

    api.run(api.db.users.update_one({"id": "admin-1"}, {"$set": {"is_superadmin": True}}))
    # Salvar a tela sem mexer (a lista efetiva já traz "fiscal") mantém desligado
    current = api.get("/api/module-config").json()["disabled_modules"]
    assert sorted(current) == ["fiscal", "rh"]
    assert api.put("/api/module-config", json={"disabled_modules": current}).status_code == 200
    assert api.get("/api/ctes").status_code == 403
    # Ligar = tirar da lista de desligados
    r = api.put("/api/module-config", json={"disabled_modules": ["rh"]})
    assert r.json()["disabled_modules"] == ["rh"]
    assert api.get("/api/ctes").status_code == 200
    stored = api.run(api.db.module_config.find_one({}, {"_id": 0}))
    assert stored == {"disabled_modules": ["rh"], "enabled_opt_in": ["fiscal"]}
    # Um item do grupo continua podendo ser desligado sozinho
    api.put("/api/module-config", json={"disabled_modules": ["fiscal.cte"]})
    assert api.get("/api/ctes").status_code == 403 and api.get("/api/fiscal/settings").status_code == 200
    # Desligar de novo
    api.put("/api/module-config", json={"disabled_modules": ["fiscal"]})
    assert api.get("/api/fiscal/settings").status_code == 403


def _full_settings(**extra):
    return {**SETTINGS, "produto_predominante": "CONTAINER", "fone": "(85) 3333-4444",
            "endereco": {**SETTINGS["endereco"], "codigo_municipio": "2304400"}, **extra}


def _full_body(**extra):
    place = {"cidade": "Fortaleza", "uf": "CE", "codigo_municipio": "2304400"}
    addr = {**_address(), "codigo_municipio": "2304400", "complemento": "Galpão 2"}
    body = dict(
        origem=place, destino=place, tomador_papel=4, valor_carga=50000, outras_caracteristicas="CONTAINER 40HC",
        observacoes="teste",
        tomador={"nome": "Armador X", "cnpj_cpf": "11444777000161", "ie": "isento", "endereco": addr},
        remetente={"nome": "Remetente", "cnpj_cpf": "11144477735", "fone": "(85) 3333-4444",
                   "email": "a@b.com; c@d.com", "endereco": addr},
        destinatario={"nome": "Destinatário", "cnpj_cpf": "11222333000181", "ie": "123", "endereco": addr},
    )
    body.update(extra)
    return _cte_body(**body)


def test_builder_icms_ibs_cbs_and_tomador_outros():
    settings = _full_settings()
    body = _full_body(remetente={"nome": "R", "cnpj_cpf": "11144477735", "endereco": _address()})
    assert "Remetente: informe o nome / razão social" in fiscal_cte.validate(body, settings)
    body = _full_body()
    assert fiscal_cte.validate(body, settings) == []
    payload = fiscal_cte.build_payload(body, settings)
    assert payload["tomador"] == "4" and payload["inscricao_estadual_tomador"] == "ISENTO"
    assert payload["codigo_municipio_tomador"] == "2304400" and payload["cpf_remetente"] == "11144477735"
    assert payload["email_remetente"] == "a@b.com"
    sn = fiscal_cte.build_payload({**body, "icms_cst": "SN"}, settings)
    assert sn["icms_situacao_tributaria"] == "90_simples_nacional" and sn["icms_indicador_simples_nacional"] == "1"
    st = fiscal_cte.build_payload({**body, "icms_cst": "60"}, settings)
    assert (st["icms_base_calculo_retido_st"], st["icms_valor_retido_st"]) == ("1500.00", "180.00")
    isento = fiscal_cte.build_payload({**body, "icms_cst": "41"}, settings)
    assert "icms_base_calculo" not in isento and isento["icms_situacao_tributaria"] == "41"
    # IBS/CBS só vai quando configurado; CST e classificação andam juntos
    assert not any(k.startswith(("ibs_", "cbs_")) for k in payload)
    partial = _full_settings(ibs_cbs_cst="000")
    assert any("IBS/CBS" in e for e in fiscal_cte.validate(body, partial))
    reform = _full_settings(ibs_cbs_cst="000", ibs_cbs_classificacao="000001", ibs_uf_aliquota=0.1, cbs_aliquota=0.9)
    assert fiscal_cte.validate(body, reform) == []
    rp = fiscal_cte.build_payload(body, reform)
    assert (rp["ibs_cbs_situacao_tributaria"], rp["ibs_cbs_classificacao_tributaria"], rp["ibs_cbs_base_calculo"]) == \
        ("000", "000001", "1500.00")
    assert (rp["ibs_uf_valor"], rp["ibs_valor_total"], rp["cbs_valor"]) == ("1.50", "1.50", "13.50")
    assert "ibs_mun_aliquota" not in rp
    # Município de outra UF é recusado (código IBGE começa pelo código da UF)
    wrong = {**body, "destino": {"cidade": "Fortaleza", "uf": "SP", "codigo_municipio": "2304400"}}
    assert any("Término" in e for e in fiscal_cte.validate(wrong, settings))


def _check_fields(payload, spec, path=""):
    """Todo campo enviado existe na lista oficial da Focus (e respeita a lista de valores)."""
    problems = []
    for key, value in payload.items():
        where = f"{path}{key}"
        if key not in spec:
            problems.append(f"campo desconhecido: {where}")
            continue
        node = spec[key]
        if node.get("enum") and str(value) not in node["enum"]:
            problems.append(f"valor fora da lista em {where}: {value}")
        if isinstance(value, list):
            for i, item in enumerate(value):
                problems += _check_fields(item, node.get("items", {}), f"{where}[{i}].")
        elif isinstance(value, dict):
            problems += _check_fields(value, node.get("object", {}), f"{where}.")
    return problems


def test_payload_fields_exist_in_focus_documentation():
    spec = json.loads((Path(__file__).parent / "data" / "focusnfe_cte_fields.json").read_text(encoding="utf-8"))["fields"]
    reform = _full_settings(ibs_cbs_cst="000", ibs_cbs_classificacao="000001", ibs_uf_aliquota=0.1,
                            ibs_mun_aliquota=0, cbs_aliquota=0.9, nome_fantasia="Fantasia",
                            endereco={**SETTINGS["endereco"], "codigo_municipio": "2304400", "complemento": "Sala 1"})
    for papel in (0, 3, 4):
        for cst in ("00", "41", "51", "60", "90", "SN"):
            for doc in ({"tipo": "NFE", "chave": "2" * 44},
                        {"tipo": "OUTROS", "tipo_outros": "99", "descricao": "Container vazio", "numero": "7",
                         "data_emissao": "2026-10-26", "valor": 10}):
                body = _full_body(tomador_papel=papel, icms_cst=cst, icms_aliquota=12, documentos=[doc])
                assert fiscal_cte.validate(body, reform) == []
                problems = _check_fields(fiscal_cte.build_payload(body, reform), spec)
                assert not problems, (papel, cst, doc["tipo"], problems)
    # A conferência pega campo fora da documentação
    assert _check_fields({"campo_inventado": 1}, spec)


def test_provider_error_message_parsing():
    response = httpx.Response(422, json={"codigo": "requisicao_invalida", "mensagem": "Dados inválidos",
                                         "erros": [{"numero_correcao": 1, "erros": ["CNPJ inválido"]}]})
    assert fiscal_focus._error_message(response)[0] == "Dados inválidos: CNPJ inválido"
    assert fiscal_focus._error_message(httpx.Response(401, text="HTTP Basic: Access denied"))[0].startswith("Token")
    assert fiscal_focus._error_message(httpx.Response(500, text="boom"))[0] == "boom"
    assert fiscal_focus.base_url("producao").startswith("https://api.")
    assert "homologacao" in fiscal_focus.base_url("homologacao")


def test_municipality_codes_come_from_local_ibge_table(api, provider):
    rows = {m["nome"]: m["codigo"] for m in api.get("/api/fiscal/municipios/ce").json()}
    assert rows["Fortaleza"] == "2304400" and rows["São Gonçalo do Amarante"] == "2312403"
    assert len(api.get("/api/fiscal/municipios/SP").json()) == 645
    assert api.get("/api/fiscal/municipios/XX").status_code == 400
