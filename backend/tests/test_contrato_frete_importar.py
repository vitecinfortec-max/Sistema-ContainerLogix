"""Contrato de Frete: puxar dados da Ordem de Coleta e do CT-e, aviso de
duplicidade e impressão dos dados no PDF."""
import io

import pytest
from pypdf import PdfReader

ORDER = {
    "id": "ord-1", "order_number": 77, "order_type": "COLETA", "status": "APROVADA", "client_name": "Cliente Alfa",
    "route_id": "rota-1", "route_name": "Santos x Campinas", "freight_value": 1500.0,
    "driver_id": "mot-1", "driver_name": "JOSE DA SILVA", "driver_cpf": "11144477735",
    "transport_company": "Transp & Cia", "truck_plate": "ABC1D23", "trailer_plate": "DEF-4G56",
    "items": [
        {"container_number": "MSCU123456-5", "size_type": "40HC", "gross_weight": "28.500"},
        {"container_number": "AAAU111111-3", "size_type": "20DV", "gross_weight": "10000"},
    ],
    "created_at": "2026-10-30T10:00:00+00:00",
}

CTE = {
    "id": "cte-1", "numero": 321, "status": "AUTORIZADO", "tomador_papel": 3, "loading_order_id": "ord-1",
    "remetente": {"nome": "Remetente SA"}, "destinatario": {"nome": "Destino Ltda"},
    "origem": {"cidade": "Santos", "uf": "SP"}, "destino": {"cidade": "Goiania", "uf": "GO"},
    "valor_total": 9999.0, "valor_carga": 50000.0, "produto_predominante": "CAFE",
    "quantidades": [{"unidade": "02", "quantidade": 12.5}],
    "documentos": [{"tipo": "NFE", "chave": "35261012345678000190550010000012341000012345", "valor": 50000.0}],
    "containers": [{"numero": "ZZZU999999-1"}],
    "motorista": {"nome": "OUTRO MOTORISTA", "cpf": "22233344405"}, "veiculo_placa": "XYZ1A23", "reboque_placas": ["QQQ1B22"],
    "created_at": "2026-10-30T11:00:00+00:00",
}


@pytest.fixture
def sources(api):
    api.run(api.db.loading_orders.insert_one(dict(ORDER)))
    api.run(api.db.ctes.insert_one(dict(CTE)))
    api.run(api.db.freight_routes.insert_one({"id": "rota-1", "origin": "Santos/SP", "destination": "Campinas/SP"}))
    api.run(api.db.drivers.insert_one({"id": "mot-1", "name": "JOSE DA SILVA", "cpf": "11144477735", "phone": "13999990000"}))
    api.run(api.db.vehicles.insert_one({"id": "v1", "plate": "ABC-1D23", "renavam": "123", "transport_company": "Dono", "vehicle_type": "CAVALO"}))
    api.run(api.db.transport_companies.insert_one({"id": "t1", "name": "Transp & Cia", "pix_key": "pix@x"}))


def test_draft_from_loading_order(api, sources):
    r = api.get("/api/rpa-terceiro/from-loading-order/ord-1")
    assert r.status_code == 200, r.text
    d = r.json()["draft"]
    assert d["driver_phone"] == "13999990000" and d["truck_plate"] == "ABC-1D23" and d["truck_renavam"] == "123"
    assert d["trailer_plate"] == "DEF-4G56"
    assert d["contratado_id"] == "t1" and d["bank_pix"] == "pix@x"
    assert d["origin"] == "Santos/SP" and d["destination"] == "Campinas/SP"
    assert d["service_value"] == 1500.0 and d["services"][0]["description"] == "FRETE - Santos x Campinas"
    assert d["container_number"] == "MSCU123456-5, AAAU111111-3" and len(d["cargo_items"]) == 2
    assert d["collection_weight"] == 38500.0 and d["weight"] == "38.500,00"


def test_draft_from_cte_prevails_over_order_but_keeps_order_freight(api, sources):
    d = api.get("/api/rpa-terceiro/from-cte/cte-1").json()["draft"]
    assert d["cte"] == "321" and d["cte_id"] == "cte-1" and d["loading_order_id"] == "ord-1"
    assert d["client_name"] == "Destino Ltda"
    assert d["origin"] == "Santos/SP" and d["destination"] == "Goiania/GO"
    assert d["driver_name"] == "OUTRO MOTORISTA" and d["truck_plate"] == "XYZ1A23" and d["trailer_plate"] == "QQQ1B22"
    assert d["container_number"] == "ZZZU999999-1"
    assert d["collection_weight"] == 12500
    assert d["cargo_items"] == [{"nf_number": "1234", "fiscal_date": None, "nature": "CAFE", "value": 50000.0}]
    # O valor do CT-e é o que o cliente paga: nunca vira o Frete do contratado
    assert d["service_value"] == 1500.0
    assert "Coleta Nº 77" in d["documents_list"] and "CT-e Nº 321" in d["documents_list"]


def test_cte_without_order_leaves_freight_blank(api, sources):
    api.run(api.db.ctes.update_one({"id": "cte-1"}, {"$unset": {"loading_order_id": ""}}))
    assert "service_value" not in api.get("/api/rpa-terceiro/from-cte/cte-1").json()["draft"]


def test_sources_hide_cancelled_and_used_in_warns_duplicate(api, sources):
    api.run(api.db.loading_orders.insert_one({**ORDER, "id": "ord-2", "order_number": 78, "status": "CANCELADA"}))
    api.run(api.db.ctes.insert_one({**CTE, "id": "cte-2", "numero": 322, "status": "CANCELADO"}))
    data = api.get("/api/rpa-terceiro/sources").json()
    assert [o["id"] for o in data["orders"]] == ["ord-1"] and "Coleta Nº 77" in data["orders"][0]["label"]
    assert [c["id"] for c in data["ctes"]] == ["cte-1"] and data["ctes"][0]["label"].startswith("CT-e Nº 321 · Destino Ltda")

    assert api.get("/api/rpa-terceiro/from-loading-order/ord-1").json()["used_in"] == []
    saved = api.post("/api/rpa-terceiro", json={"driver_name": "JOSE", "loading_order_id": "ord-1"}).json()
    assert saved["loading_order_id"] == "ord-1"
    assert api.get("/api/rpa-terceiro/from-loading-order/ord-1").json()["used_in"] == [saved["rpa_number"]]
    # O CT-e da mesma ordem também avisa
    assert api.get("/api/rpa-terceiro/from-cte/cte-1").json()["used_in"] == [saved["rpa_number"]]


def test_unknown_sources_are_404(api):
    assert api.get("/api/rpa-terceiro/from-loading-order/nao-existe").status_code == 404
    assert api.get("/api/rpa-terceiro/from-cte/nao-existe").status_code == 404


def test_pdf_prints_contract_data_and_special_characters(api):
    rid = api.post("/api/rpa-terceiro", json={
        "driver_name": "JOSE", "client_name": "T&L Log", "cte": "321", "container_number": "MSCU123456-5",
        "ciot": "998877", "observations": "peso <3 kg & lacre",
    }).json()["id"]
    r = api.get(f"/api/rpa-terceiro/{rid}/pdf")
    assert r.status_code == 200, r.text
    reader = PdfReader(io.BytesIO(r.content))
    assert len(reader.pages) == 5  # uma folha por via
    text = reader.pages[0].extract_text()
    for expected in ("T&L Log", "321", "MSCU123456-5", "998877", "peso <3 kg & lacre"):
        assert expected in text, expected
    assert "T&L;" not in text


def test_pdf_keeps_one_sheet_per_via_with_lots_of_cargo(api):
    rid = api.post("/api/rpa-terceiro", json={
        "driver_name": "JOSE", "observations": "linha longa " * 120,
        "cargo_items": [{"nf_number": str(i), "nature": "CAFE", "value": 10} for i in range(25)],
    }).json()["id"]
    assert len(PdfReader(io.BytesIO(api.get(f"/api/rpa-terceiro/{rid}/pdf").content)).pages) == 5
