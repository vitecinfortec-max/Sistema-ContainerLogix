"""Fiscal / MDF-e: rascunho a partir dos CT-es autorizados (com veículo,
carreta e motorista da Ordem de Carregamento), emissão pela Focus NFe
(simulada), encerramento, inclusão de condutor, cancelamento e conferência
dos campos contra a lista oficial da Focus."""
import json
from pathlib import Path

import pytest

import fiscal_focus
import fiscal_mdfe
from routers import fiscal as fiscal_router
from routers import mdfe as mdfe_router


class FakeFocus:
    def __init__(self):
        self.calls = []
        self.result = "autorizado"
        self.event_status = None  # força um status de evento (ex.: erro)

    async def save_company(self, cnpj, payload, company_id=None):
        self.calls.append(("save_company", payload))
        return {"id": 777, "token_homologacao": "tok-h", "token_producao": "tok-p"}

    async def emit_mdfe(self, ambiente, token, ref, payload):
        self.calls.append(("emit_mdfe", ambiente, token, ref, payload))
        return {"ref": ref, "status": "processando_autorizacao"}

    async def get_mdfe(self, ambiente, token, ref):
        if self.result == "erro_autorizacao":
            return {"ref": ref, "status": "erro_autorizacao", "status_sefaz": "611",
                    "mensagem_sefaz": "Rejeição: Existe MDF-e não encerrado para esta placa"}
        return {"ref": ref, "status": "autorizado", "status_sefaz": "100", "mensagem_sefaz": "Autorizado o uso do MDF-e",
                "chave": "MDFe23261011222333000181580010000000071000000070", "numero": 7, "serie": 1,
                "caminho_damdfe": "https://s3/damdfe.pdf", "caminho_xml": "https://s3/mdfe.xml"}

    async def close_mdfe(self, ambiente, token, ref, data, uf, municipio):
        self.calls.append(("close_mdfe", ref, data, uf, municipio))
        return {"status": self.event_status or "encerrado", "status_sefaz": "135",
                "mensagem_sefaz": "Evento registrado e vinculado a MDF-e"}

    async def add_driver_mdfe(self, ambiente, token, ref, nome, cpf):
        self.calls.append(("add_driver_mdfe", ref, nome, cpf))
        return {"status": self.event_status or "incluido", "status_sefaz": "135", "mensagem_sefaz": "Evento registrado"}

    async def cancel_mdfe(self, ambiente, token, ref, justificativa):
        self.calls.append(("cancel_mdfe", ref, justificativa))
        return {"status": self.event_status or "cancelado"}

    async def download(self, path, ambiente, token):
        return b"%PDF-1.4 damdfe" if path.endswith(".pdf") else b"<mdfeProc/>"

    def emissions(self):
        return [c for c in self.calls if c[0] == "emit_mdfe"]


@pytest.fixture
def provider(monkeypatch, api):
    api.run(api.db.module_config.replace_one({}, {"disabled_modules": [], "enabled_opt_in": ["fiscal"]}, upsert=True))
    fake = FakeFocus()
    for name in ("save_company", "emit_mdfe", "get_mdfe", "close_mdfe", "add_driver_mdfe", "cancel_mdfe", "download"):
        monkeypatch.setattr(fiscal_focus, name, getattr(fake, name))
    monkeypatch.setattr(fiscal_focus, "is_configured", lambda: True)
    monkeypatch.setattr(fiscal_router, "POLL_INTERVAL", 0)
    return fake


SETTINGS = {
    "ambiente": "homologacao", "cnpj": "11222333000181", "ie": "061234567", "razao_social": "Transportes Teste Ltda",
    "email": "fiscal@teste.local", "crt": 3, "rntrc": "12345678",
    "endereco": {"logradouro": "Av. Portuária", "numero": "100", "bairro": "Centro", "cep": "60000000",
                 "cidade": "Fortaleza", "uf": "CE"},
    "seguro_responsavel": 1, "seguradora_nome": "Seguradora X", "seguradora_cnpj": "11444777000161",
    "seguro_apolice": "AP-123",
}


def _configure(api):
    assert api.put("/api/fiscal/settings", json=SETTINGS).status_code == 200
    assert api.post("/api/fiscal/settings/sync").status_code == 200


def _key(n):
    return f"2326101122233300018157001{str(n).zfill(19)}"


def _seed_ctes(api, ambiente="homologacao"):
    api.run(api.db.vehicles.insert_many([
        {"id": "v1", "plate": "RTA-2B34", "renavam": "12345678901", "tare_weight": "8.500 kg", "load_capacity": "45 t",
         "category": "TRACAO", "vehicle_type": "CAMINHÃO", "status": "ATIVO", "created_by": "x"},
        {"id": "v2", "plate": "CRT1A11", "tare_weight": "6800", "load_capacity": "30.000", "category": "CARGA",
         "vehicle_type": "CARRETA", "status": "ATIVO", "created_by": "x"},
    ]))
    api.run(api.db.drivers.insert_one({"id": "d1", "name": "JOSE CARLOS DA SILVA", "cpf": "111.444.777-35",
                                       "status": "ATIVO", "created_by": "x"}))
    api.run(api.db.loading_orders.insert_one({"id": "lo1", "order_number": 42, "truck_plate": "RTA2B34",
                                              "trailer_plate": "CRT1A11", "driver_id": "d1", "items": [],
                                              "created_by": "x", "created_by_name": "x"}))
    base = {"status": "AUTORIZADO", "ambiente": ambiente, "tomador_papel": 0,
            "origem": {"cidade": "São Gonçalo do Amarante", "uf": "CE", "codigo_municipio": "2312403"},
            "quantidades": [{"unidade": "01", "tipo_medida": "PESO BRUTO", "quantidade": 20000}],
            "produto_predominante": "CONTAINER"}
    ctes = [
        {**base, "id": "c1", "numero": 1, "chave": _key(1), "loading_order_id": "lo1", "valor_carga": 50000,
         "remetente": {"nome": "Armazéns Pecém SA", "cnpj_cpf": "11.444.777/0001-61"},
         "destino": {"cidade": "Fortaleza", "uf": "CE", "codigo_municipio": "2304400"}},
        {**base, "id": "c2", "numero": 2, "chave": _key(2), "valor_carga": 30000,
         "remetente": {"nome": "Armazéns Pecém SA", "cnpj_cpf": "11444777000161"},
         "destino": {"cidade": "Maracanaú", "uf": "CE", "codigo_municipio": "2307650"}},
        {**base, "id": "c3", "numero": 3, "chave": _key(3), "valor_carga": 10000,
         "remetente": {"nome": "Outro Cliente", "cnpj_cpf": "11222333000181"},
         "destino": {"cidade": "Fortaleza", "uf": "CE", "codigo_municipio": "2304400"}},
    ]
    api.run(api.db.ctes.insert_many([dict(c) for c in ctes]))


def _draft(api, ids="c1,c2,c3"):
    r = api.get("/api/mdfes/from-ctes", params={"ids": ids})
    assert r.status_code == 200, r.text
    return r.json()


def _create(api, body):
    r = api.post("/api/mdfes", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_draft_from_authorized_ctes(api, provider):
    _configure(api)
    _seed_ctes(api)
    draft = _draft(api)
    assert draft["cte_ids"] == ["c1", "c2", "c3"]
    assert (draft["uf_inicio"], draft["uf_fim"]) == ("CE", "CE")
    assert draft["municipios_carregamento"] == [{"cidade": "São Gonçalo do Amarante", "uf": "CE", "codigo_municipio": "2312403"}]
    unloading = {d["cidade"]: d["ctes"] for d in draft["descarregamentos"]}
    assert unloading == {"Fortaleza": [_key(1), _key(3)], "Maracanaú": [_key(2)]}
    assert draft["veiculo"] == {"vehicle_id": "v1", "placa": "RTA2B34", "renavam": "12345678901", "tara": 8500,
                                "capacidade_kg": 45000, "tipo_rodado": "03", "tipo_carroceria": "00",
                                "uf_licenciamento": "CE", "proprietario": None}
    assert draft["reboques"][0]["placa"] == "CRT1A11" and draft["reboques"][0]["capacidade_kg"] == 30000
    assert draft["reboques"][0]["tipo_carroceria"] == "04"
    assert draft["condutores"] == [{"driver_id": "d1", "nome": "JOSE CARLOS DA SILVA", "cpf": "11144477735"}]
    assert sorted(c["cnpj_cpf"] for c in draft["contratantes"]) == ["11222333000181", "11444777000161"]
    assert (draft["valor_total_carga"], draft["peso_bruto"]) == (90000.0, 60000.0)
    assert draft["seguradora_cnpj"] == "11444777000161" and draft["tipo_carga"] == "04"


def test_draft_refuses_unauthorized_or_mixed_ctes(api, provider):
    _configure(api)
    _seed_ctes(api)
    api.run(api.db.ctes.insert_one({"id": "c9", "numero": 9, "status": "RASCUNHO", "ambiente": "homologacao"}))
    r = api.get("/api/mdfes/from-ctes", params={"ids": "c1,c9"})
    assert r.status_code == 400 and "autorizado" in r.json()["detail"]
    api.run(api.db.ctes.update_one({"id": "c2"}, {"$set": {"ambiente": "producao"}}))
    assert api.get("/api/mdfes/from-ctes", params={"ids": "c1,c2"}).status_code == 400


def test_emit_validates_before_sending(api, provider):
    _configure(api)
    _seed_ctes(api)
    body = _draft(api)
    body.update({"veiculo": None, "condutores": [], "percursos": ["CE"]})
    mdfe = _create(api, body)
    r = api.post(f"/api/mdfes/{mdfe['id']}/emitir")
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert "placa" in detail and "condutor" in detail and "percurso" in detail
    assert provider.emissions() == []


def test_emit_authorized_links_ctes(api, provider):
    _configure(api)
    _seed_ctes(api)
    mdfe = _create(api, _draft(api))
    r = api.post(f"/api/mdfes/{mdfe['id']}/emitir")
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["status"] == "AUTORIZADO" and doc["numero"] == 7 and doc["chave"].isdigit() and len(doc["chave"]) == 44
    _, ambiente, token, ref, payload = provider.emissions()[0]
    assert (ambiente, token, ref) == ("homologacao", "tok-h", mdfe["id"].replace("-", "") + "m1")
    assert payload["emitente"] == "1" and payload["quantidade_total_cte"] == "3"
    assert payload["municipios_carregamento"] == [{"codigo": "2312403", "nome": "São Gonçalo do Amarante"}]
    descarga = {d["nome"]: [c["chave_cte"] for c in d["conhecimentos_transporte"]] for d in payload["municipios_descarregamento"]}
    assert descarga == {"Fortaleza": [_key(1), _key(3)], "Maracanaú": [_key(2)]}
    assert payload["seguros_carga"] == [{"responsavel_seguro": "1", "nome_seguradora": "Seguradora X",
                                         "cnpj_seguradora": "11444777000161", "numero_apolice": "AP-123"}]
    rodo = payload["modal_rodoviario"]
    assert (rodo["placa_veiculo"], rodo["tara_veiculo"], rodo["tipo_rodado_veiculo"]) == ("RTA2B34", "8500", "03")
    assert rodo["registro_nacional_transporte"] == "12345678"
    assert rodo["condutores"] == [{"nome": "JOSE CARLOS DA SILVA", "cpf": "11144477735"}]
    assert rodo["veiculos_reboque"][0]["placa"] == "CRT1A11"
    assert "numero" not in payload and "serie" not in payload
    linked = api.run(api.db.ctes.find({"mdfe_id": mdfe["id"]}, {"_id": 0, "id": 1, "mdfe_numero": 1}).to_list(None))
    assert sorted(c["id"] for c in linked) == ["c1", "c2", "c3"] and linked[0]["mdfe_numero"] == 7
    # Autorizado não volta a ser transmitido, editado nem excluído
    assert api.post(f"/api/mdfes/{mdfe['id']}/emitir").status_code == 400
    assert api.put(f"/api/mdfes/{mdfe['id']}", json=_draft(api)).status_code == 400
    assert api.delete(f"/api/mdfes/{mdfe['id']}").status_code == 400


def test_rejected_mdfe_can_be_resent(api, provider):
    _configure(api)
    _seed_ctes(api)
    mdfe = _create(api, _draft(api))
    provider.result = "erro_autorizacao"
    doc = api.post(f"/api/mdfes/{mdfe['id']}/emitir").json()
    assert doc["status"] == "REJEITADO" and doc["motivo"].startswith("611 - ")
    provider.result = "autorizado"
    doc = api.post(f"/api/mdfes/{mdfe['id']}/emitir").json()
    assert doc["status"] == "AUTORIZADO" and provider.emissions()[1][3].endswith("m2")


def test_close_add_driver_and_documents(api, provider):
    _configure(api)
    _seed_ctes(api)
    mdfe = _create(api, _draft(api))
    assert api.post(f"/api/mdfes/{mdfe['id']}/encerrar", json={"cidade": "Fortaleza", "uf": "CE"}).status_code == 400  # não autorizado
    api.post(f"/api/mdfes/{mdfe['id']}/emitir")

    assert api.get(f"/api/mdfes/{mdfe['id']}/pdf").content.startswith(b"%PDF")
    assert api.get(f"/api/mdfes/{mdfe['id']}/xml").content == b"<mdfeProc/>"

    r = api.post(f"/api/mdfes/{mdfe['id']}/incluir-condutor", json={"nome": "José", "cpf": "111.444.777-35"})
    assert r.status_code == 400  # já está no manifesto
    r = api.post(f"/api/mdfes/{mdfe['id']}/incluir-condutor", json={"nome": "Maria Souza", "cpf": "52998224725"})
    assert r.status_code == 200 and [c["nome"] for c in r.json()["condutores"]] == ["JOSE CARLOS DA SILVA", "Maria Souza"]

    assert api.post(f"/api/mdfes/{mdfe['id']}/encerrar", json={"cidade": "Cidade Inventada", "uf": "CE"}).status_code == 400
    provider.event_status = "erro"
    r = api.post(f"/api/mdfes/{mdfe['id']}/encerrar", json={"cidade": "Fortaleza", "uf": "CE", "data": "2026-10-27"})
    assert r.status_code == 400 and api.get(f"/api/mdfes/{mdfe['id']}").json()["status"] == "AUTORIZADO"
    provider.event_status = None
    r = api.post(f"/api/mdfes/{mdfe['id']}/encerrar", json={"cidade": "Fortaleza", "uf": "ce", "data": "2026-10-27"})
    assert r.status_code == 200 and r.json()["status"] == "ENCERRADO"
    assert [c for c in provider.calls if c[0] == "close_mdfe"][-1][2:] == ("2026-10-27", "CE", "Fortaleza")
    # Encerrado não cancela nem inclui condutor
    assert api.post(f"/api/mdfes/{mdfe['id']}/cancelar", json={"justificativa": "viagem não realizada"}).status_code == 400
    assert api.post(f"/api/mdfes/{mdfe['id']}/incluir-condutor", json={"nome": "Ana", "cpf": "39053344705"}).status_code == 400


def test_cancel_frees_ctes(api, provider):
    _configure(api)
    _seed_ctes(api)
    mdfe = _create(api, _draft(api))
    api.post(f"/api/mdfes/{mdfe['id']}/emitir")
    assert api.post(f"/api/mdfes/{mdfe['id']}/cancelar", json={"justificativa": "curta"}).status_code == 400
    r = api.post(f"/api/mdfes/{mdfe['id']}/cancelar", json={"justificativa": "viagem não realizada pelo cliente"})
    assert r.status_code == 200 and r.json()["status"] == "CANCELADO"
    assert api.run(api.db.ctes.count_documents({"mdfe_id": {"$exists": True}})) == 0


def test_company_sync_sets_mdfe_series(api, provider):
    _configure(api)
    payload = [c for c in provider.calls if c[0] == "save_company"][-1][1]
    assert payload["habilita_mdfe"] is True and payload["serie_mdfe_homologacao"] == 1


def test_mdfe_module_gate(api, monkeypatch):
    import shared
    assert api.get("/api/mdfes").status_code == 403  # Fiscal nasce desligado
    api.run(api.db.module_config.replace_one({}, {"disabled_modules": ["fiscal.mdfe"], "enabled_opt_in": ["fiscal"]},
                                             upsert=True))
    shared.invalidate_module_config_cache()
    assert api.get("/api/mdfes").status_code == 403 and api.get("/api/ctes").status_code == 200


def _full():
    settings = {**SETTINGS, "nome_fantasia": "Fantasia", "fone": "(85) 3333-4444",
                "endereco": {**SETTINGS["endereco"], "codigo_municipio": "2304400", "complemento": "Sala 1"}}
    owner = {"cnpj_cpf": "11144477735", "nome": "Motorista Dono", "rntrc": "87654321", "ie": "isento", "uf": "CE", "tipo": "1"}
    mdfe = {
        "uf_inicio": "CE", "uf_fim": "SP", "percursos": ["PE", "BA", "MG"], "data_inicio_viagem": "2026-10-27T08:00",
        "municipios_carregamento": [{"cidade": "Fortaleza", "uf": "CE", "codigo_municipio": "2304400"}],
        "descarregamentos": [{"cidade": "São Paulo", "uf": "SP", "codigo_municipio": "3550308", "ctes": [_key(1), _key(2)]}],
        "veiculo": {"placa": "RTA2B34", "renavam": "12345678901", "tara": 8500, "capacidade_kg": 45000, "tipo_rodado": "03",
                    "tipo_carroceria": "00", "uf_licenciamento": "CE", "proprietario": owner},
        "reboques": [{"placa": "CRT1A11", "renavam": "123456789", "tara": 6800, "capacidade_kg": 30000,
                      "tipo_carroceria": "04", "uf_licenciamento": "CE", "proprietario": owner}],
        "condutores": [{"nome": "José", "cpf": "11144477735"}],
        "ciots": [{"numero": "123456789012", "responsavel_cnpj_cpf": "11222333000181"}],
        "contratantes": [{"nome": "Cliente", "cnpj_cpf": "11444777000161"}, {"cnpj_cpf": "11144477735"}],
        "seguro_responsavel": 2, "seguro_responsavel_cnpj_cpf": "11444777000161", "averbacoes": ["AV1", "AV2"],
        "tipo_carga": "04", "descricao_produto": "CONTAINER", "valor_total_carga": 80000, "unidade_peso": "01",
        "peso_bruto": 40000, "observacoes": "teste",
    }
    return mdfe, settings


def test_builder_owner_ciot_and_insurance():
    mdfe, settings = _full()
    assert fiscal_mdfe.validate(mdfe, settings) == []
    payload = fiscal_mdfe.build_payload(mdfe, settings)
    rodo = payload["modal_rodoviario"]
    assert rodo["cpf_proprietario_veiculo"] == "11144477735" and rodo["rntrc_proprietario_veiculo"] == "87654321"
    assert rodo["inscricao_estadual_proprietario_veiculo"] == "ISENTO" and rodo["tipo_proprietario_veiculo"] == "1"
    reboque = rodo["veiculos_reboque"][0]
    assert reboque["cpf_proprietario"] == "11144477735" and reboque["rntrc"] == "87654321"
    assert rodo["ciot"] == [{"ciot": "123456789012", "cnpj_responsavel": "11222333000181"}]
    assert rodo["contratantes"] == [{"nome": "Cliente", "cnpj": "11444777000161"}, {"cpf": "11144477735"}]
    assert payload["seguros_carga"][0]["cnpj_responsavel"] == "11444777000161"
    assert payload["seguros_carga"][0]["numero_averbacao"] == ["AV1", "AV2"]
    assert payload["percursos"] == [{"uf_percurso": "PE"}, {"uf_percurso": "BA"}, {"uf_percurso": "MG"}]
    assert payload["data_hora_previsto_inicio_viagem"] == "2026-10-27T08:00:00-03:00"
    # Regras: descarregamento na UF de fim, proprietário completo, chave modelo 57
    bad = {**mdfe, "descarregamentos": [{"cidade": "Fortaleza", "uf": "CE", "codigo_municipio": "2304400",
                                         "ctes": ["1" * 44]}],
           "veiculo": {**mdfe["veiculo"], "proprietario": {"nome": "Só nome"}}}
    errors = " | ".join(fiscal_mdfe.validate(bad, settings))
    assert "UF de fim" in errors and "modelo 57" in errors and "RNTRC do proprietário" in errors


def _check_fields(payload, spec, path=""):
    problems = []
    for key, value in payload.items():
        where = f"{path}{key}"
        if key not in spec:
            problems.append(f"campo desconhecido: {where}")
            continue
        node = spec[key]
        if node.get("enum") and not isinstance(value, (list, dict)) and str(value) not in node["enum"]:
            problems.append(f"valor fora da lista em {where}: {value}")
        if isinstance(value, list):
            for i, item in enumerate(value):
                if isinstance(item, dict):
                    problems += _check_fields(item, node.get("items", {}), f"{where}[{i}].")
        elif isinstance(value, dict):
            problems += _check_fields(value, node.get("object", {}), f"{where}.")
    return problems


def test_payload_fields_exist_in_focus_documentation():
    spec = json.loads((Path(__file__).parent / "data" / "focusnfe_mdfe_fields.json").read_text(encoding="utf-8"))["fields"]
    # data_emissao não está na página de campos, mas a especificação da API
    # (doc.focusnfe.com.br/reference/emitir_mdfe, MdfeRequest) o exige
    spec = {**spec, "data_emissao": {}}
    mdfe, settings = _full()
    for responsavel in (1, 2):
        body = {**mdfe, "seguro_responsavel": responsavel}
        problems = _check_fields(fiscal_mdfe.build_payload(body, {**settings, "seguro_responsavel": responsavel}), spec)
        assert not problems, problems
    assert _check_fields({"campo_inventado": 1}, spec)


def test_weight_parsing():
    assert mdfe_router._kg("8.500 kg") == 8500
    assert mdfe_router._kg("45 t") == 45000
    assert mdfe_router._kg("24,5 t") == 24500
    assert mdfe_router._kg("30.000") == 30000
    assert mdfe_router._kg("") is None and mdfe_router._kg("abc") is None
