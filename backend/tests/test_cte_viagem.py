"""CT-e (27/10/2026): motorista, veículos, seguro e vale-pedágio da viagem.
O leiaute 4.00 do CT-e não tem esses grupos (ficaram no MDF-e): saem nas
observações do DACTE e preenchem o MDF-e gerado a partir do CT-e."""
import fiscal_cte
from test_cte import _full_body, _full_settings
from test_mdfe import _configure, _draft, _seed_ctes, provider  # noqa: F401  (fixture)

TRIP = {
    "motorista": {"driver_id": "d9", "nome": "MARIA SOUZA", "cpf": "529.982.247-25"},
    "veiculo_placa": "abc1d23",
    "reboque_placas": ["XYZ9A99", "QWE1R23"],
    "seguro_responsavel": 1, "seguradora_nome": "ALLIANZ SEGUROS S.A", "seguradora_cnpj": "61573796000166",
    "seguro_apolice": "5177202662550002010", "seguro_averbacao": "AV-77",
    "vales_pedagio": [{"pago_por": "REMETENTE", "tipo": "01", "fornecedor_nome": "SEM PARAR",
                       "fornecedor_cnpj": "04088208000165", "numero_comprovante": "998877", "valor": 1234.5}],
}


def test_trip_data_goes_to_dacte_observations():
    payload = fiscal_cte.build_payload(_full_body(**TRIP), _full_settings())
    obs = payload["observacao"]
    assert obs.startswith("teste | ")
    assert "Motorista: MARIA SOUZA - CPF 529.982.247-25" in obs
    assert "Placas: ABC1D23 / XYZ9A99 / QWE1R23" in obs
    assert "Seguro: ALLIANZ SEGUROS S.A - Apólice 5177202662550002010 - Averbação AV-77 - Resp.: Emitente" in obs
    assert "Vale-pedágio nº 998877 - R$ 1.234,50 - Fornecedora SEM PARAR - TAG - Pago por Remetente" in obs
    # o CT-e rodoviário continua só com o RNTRC (não existe grupo de veículo/seguro no leiaute 4.00)
    assert payload["modal_rodoviario"] == {"rntrc": "12345678"}


def test_without_trip_data_observations_are_unchanged():
    payload = fiscal_cte.build_payload(_full_body(), _full_settings())
    assert payload["observacao"] == "teste"


def test_validation_of_trip_data():
    settings = _full_settings()
    ok = fiscal_cte.validate(_full_body(**TRIP), settings)
    assert not [e for e in ok if "Motorista" in e or "Seguro" in e or "Vale-pedágio" in e]
    bad = fiscal_cte.validate(_full_body(
        motorista={"nome": "X", "cpf": "123"}, seguradora_cnpj="123",
        vales_pedagio=[{"fornecedor_cnpj": "1", "numero_comprovante": "", "valor": 0}],
    ), settings)
    assert "Motorista: CPF deve ter 11 dígitos" in bad
    assert "Seguro: CNPJ da seguradora deve ter 14 dígitos" in bad
    assert {"Vale-pedágio: informe o CNPJ da fornecedora (14 dígitos)", "Vale-pedágio: informe o número do comprovante",
            "Vale-pedágio: informe o valor"} <= set(bad)


def test_trip_fields_are_saved(api, provider):  # noqa: F811
    r = api.post("/api/ctes", json=_full_body(**TRIP))
    assert r.status_code == 200, r.text
    saved = api.get(f"/api/ctes/{r.json()['id']}").json()
    assert saved["motorista"]["nome"] == "MARIA SOUZA"
    assert saved["reboque_placas"] == ["XYZ9A99", "QWE1R23"]
    assert saved["vales_pedagio"][0]["numero_comprovante"] == "998877"


def test_draft_from_loading_order_fills_trip(api, provider):  # noqa: F811
    _configure(api)
    _seed_ctes(api)
    draft = api.get("/api/ctes/from-loading-order/lo1").json()
    assert draft["motorista"] == {"driver_id": "d1", "nome": "JOSE CARLOS DA SILVA", "cpf": "111.444.777-35"}
    assert (draft["veiculo_placa"], draft["reboque_placas"]) == ("RTA2B34", ["CRT1A11"])
    assert (draft["seguradora_nome"], draft["seguro_apolice"]) == ("Seguradora X", "AP-123")
    assert "Motorista" not in draft["observacoes"]


def test_mdfe_draft_uses_trip_from_cte(api, provider):  # noqa: F811
    _configure(api)
    _seed_ctes(api)
    api.run(api.db.ctes.update_one({"id": "c2"}, {"$set": {
        "motorista": {"driver_id": None, "nome": "MARIA SOUZA", "cpf": "529.982.247-25"},
        "veiculo_placa": "CRT1A11", "reboque_placas": [],
        "seguro_responsavel": 2, "seguradora_nome": "ALLIANZ", "seguradora_cnpj": "61573796000166",
        "seguro_apolice": "AP-9", "seguro_averbacao": "AV-77", "vales_pedagio": TRIP["vales_pedagio"],
    }}))
    draft = _draft(api)
    # o CT-e com a viagem informada vence a Ordem de Carregamento do c1
    assert draft["condutores"] == [{"driver_id": None, "nome": "MARIA SOUZA", "cpf": "52998224725"}]
    assert draft["veiculo"]["placa"] == "CRT1A11" and draft["reboques"] == []
    assert (draft["seguradora_nome"], draft["seguro_apolice"], draft["seguro_responsavel"]) == ("ALLIANZ", "AP-9", 2)
    assert draft["averbacoes"] == ["AV-77"]
    assert "Vale-pedágio nº 998877" in draft["observacoes"]


def test_mdfe_draft_without_trip_keeps_order_and_settings(api, provider):  # noqa: F811
    _configure(api)
    _seed_ctes(api)
    draft = _draft(api)
    assert draft["condutores"][0]["nome"] == "JOSE CARLOS DA SILVA"
    assert draft["seguradora_nome"] == "Seguradora X" and draft["averbacoes"] == []
    assert draft["observacoes"] == "CT-e nº 1, 2, 3"
