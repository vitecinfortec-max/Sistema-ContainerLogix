"""Auditoria geral (18/10/2026): saldo do Tanque Próprio, números negativos,
campos apagados na edição do Abastecimento e da Ordem de Abastecimento, e
exclusão de Veículo em uso."""
import pytest

SUPPLY = {
    "equipment_plate": "ABC1D23", "supply_date": "2026-10-15", "entry_date": "2026-10-15", "reading": 1000,
    "source": "POSTO_EXTERNO", "supplier_id": "sup-1", "supplier_name": "Posto X", "city": "Santos", "state": "SP",
    "fuel_type": "DIESEL_S10", "liters": 100, "unit_price": 6, "gross_value": 600,
}


def tank_with(api, liters):
    api.put("/api/tank-settings", json={"capacity_liters": 5000, "minimum_alert_liters": 500})
    r = api.post("/api/tank-refills", json={"refill_date": "2026-10-15", "liters": liters})
    assert r.status_code == 200, r.text


def tank_level(api):
    return api.get("/api/tank-level").json()["current_liters"]


# ---------- Tanque Próprio ----------

def test_supply_from_tank_cannot_exceed_balance(api):
    tank_with(api, 100)
    r = api.post("/api/fuel-supplies", json={**SUPPLY, "source": "TANQUE_PROPRIO", "liters": 300})
    assert r.status_code == 400
    assert "100 L disponíveis" in r.json()["detail"]
    assert tank_level(api) == 100
    # o saldo exato passa
    assert api.post("/api/fuel-supplies", json={**SUPPLY, "source": "TANQUE_PROPRIO", "liters": 100}).status_code == 200
    assert tank_level(api) == 0


def test_editing_tank_supply_counts_its_own_liters(api):
    tank_with(api, 100)
    s = api.post("/api/fuel-supplies", json={**SUPPLY, "source": "TANQUE_PROPRIO", "liters": 80}).json()
    # 20 no tanque + os 80 que este lançamento já tirava = 100 disponíveis
    assert api.put(f"/api/fuel-supplies/{s['id']}", json={**SUPPLY, "source": "TANQUE_PROPRIO", "liters": 100}).status_code == 200
    r = api.put(f"/api/fuel-supplies/{s['id']}", json={**SUPPLY, "source": "TANQUE_PROPRIO", "liters": 101})
    assert r.status_code == 400
    assert tank_level(api) == 0


def test_external_supply_does_not_touch_tank(api):
    tank_with(api, 10)
    assert api.post("/api/fuel-supplies", json={**SUPPLY, "liters": 500}).status_code == 200
    s = api.post("/api/fuel-supplies", json={**SUPPLY, "liters": 500}).json()
    # trocar um posto externo para o tanque confere o saldo
    r = api.put(f"/api/fuel-supplies/{s['id']}", json={**SUPPLY, "source": "TANQUE_PROPRIO", "liters": 500})
    assert r.status_code == 400


def test_tank_refill_must_be_positive(api):
    api.put("/api/tank-settings", json={"capacity_liters": 5000, "minimum_alert_liters": 500})
    for liters in (-1000, 0):
        r = api.post("/api/tank-refills", json={"refill_date": "2026-10-15", "liters": liters})
        assert r.status_code == 400, liters


# ---------- Campos apagados na edição ----------

def test_switching_supply_to_tank_clears_supplier(api):
    tank_with(api, 500)
    s = api.post("/api/fuel-supplies", json=SUPPLY).json()
    r = api.put(f"/api/fuel-supplies/{s['id']}", json={
        **SUPPLY, "source": "TANQUE_PROPRIO", "supplier_id": None, "supplier_name": None, "city": None, "state": None,
    })
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["source"] == "TANQUE_PROPRIO"
    assert d.get("supplier_name") is None and d.get("city") is None and d.get("state") is None


def test_switching_order_mode_clears_previous_amount(api):
    base = {"order_date": "2026-10-15", "equipment_plate": "ABC1D23", "fuel_type": "DIESEL_S10",
            "supply_mode": "LITROS", "liters": 200}
    o = api.post("/api/fuel-supply-orders", json=base).json()
    r = api.put(f"/api/fuel-supply-orders/{o['id']}", json={**base, "supply_mode": "VALOR", "liters": None, "estimated_value": 500})
    assert r.status_code == 200, r.text
    assert r.json()["liters"] is None
    assert r.json()["estimated_value"] == 500


# ---------- Números negativos ----------

@pytest.mark.parametrize("field", ["liters", "unit_price", "gross_value", "discounts", "additions", "reading"])
def test_fuel_supply_refuses_negative(api, field):
    r = api.post("/api/fuel-supplies", json={**SUPPLY, field: -50})
    assert r.status_code == 400
    assert "não pode ser negativo" in r.json()["detail"]


def test_fuel_order_refuses_negative(api):
    base = {"order_date": "2026-10-15", "equipment_plate": "ABC1D23", "fuel_type": "DIESEL_S10", "supply_mode": "LITROS"}
    assert api.post("/api/fuel-supply-orders", json={**base, "liters": -10}).status_code == 400
    assert api.post("/api/fuel-supply-orders", json={**base, "supply_mode": "VALOR", "estimated_value": -10}).status_code == 400


def test_port_service_refuses_negative_value(api):
    body = {"service_date": "2026-10-15", "client_id": "c1", "client_name": "Cliente", "driver_name": "Motorista",
            "cavalo_plate": "ABC1D23", "turno": "DIA", "operation_value": -900}
    r = api.post("/api/port-services", json=body)
    assert r.status_code == 400
    ok = api.post("/api/port-services", json={**body, "operation_value": 900})
    assert ok.status_code == 200, ok.text
    assert api.put(f"/api/port-services/{ok.json()['id']}", json=body).status_code == 400


def test_freight_route_refuses_negative_value(api):
    r = api.post("/api/freight-routes", json={"origin": "Santos", "destination": "Cubatão", "freight_value": -100})
    assert r.status_code == 400


def test_rpa_refuses_negative_inputs_but_allows_computed_negative_result(api):
    base = {"driver_name": "Motorista", "rpa_type": "terceiro"}
    assert api.post("/api/rpa-terceiro", json={**base, "irrf_discount": -10}).status_code == 400
    assert api.post("/api/rpa-terceiro", json={**base, "service_value": -10}).status_code == 400
    # resultado calculado pode ser negativo (adiantamento maior que o frete)
    r = api.post("/api/rpa-terceiro", json={**base, "service_value": 100, "advance": 300, "result": -200})
    assert r.status_code == 200, r.text


def test_km_fields_refuse_negative(api):
    v = api.post("/api/vehicles", json={"plate": "KMM1A11", "vehicle_type": "CAVALO"}).json()
    r = api.post("/api/odometer-readings", json={"vehicle_id": v["id"], "vehicle_plate": "KMM1A11", "km": -5, "reading_date": "2026-10-15"})
    assert r.status_code == 400
    r = api.post("/api/ordem-servico", json={"reading_initial": -1})
    assert r.status_code == 400
    r = api.post("/api/ordem-servico", json={"products": [{"description": "Peça", "quantity": 1, "unit_price": -10}]})
    assert r.status_code == 400


def test_product_tax_rates_refuse_negative(api):
    r = api.post("/api/products", json={"description": "Óleo", "icms_rate": -1})
    assert r.status_code == 400


# ---------- Exclusão de Veículo ----------

def test_vehicle_with_history_cannot_be_deleted(api):
    v = api.post("/api/vehicles", json={"plate": "XYZ9A88", "vehicle_type": "CAVALO"}).json()
    r = api.post("/api/odometer-readings", json={"vehicle_id": v["id"], "vehicle_plate": "XYZ9A88", "km": 5000, "reading_date": "2026-10-15"})
    assert r.status_code == 200, r.text
    r = api.delete(f"/api/vehicles/{v['id']}")
    assert r.status_code == 409
    assert "leitura(s) de hodômetro" in r.json()["detail"] and "Inativo" in r.json()["detail"]
    assert api.run(api.db.vehicles.count_documents({"id": v["id"]})) == 1


def test_vehicle_used_by_plate_in_fuel_supply_cannot_be_deleted(api):
    v = api.post("/api/vehicles", json={"plate": "ABC1D23", "vehicle_type": "CAVALO"}).json()
    api.post("/api/fuel-supplies", json=SUPPLY)
    r = api.delete(f"/api/vehicles/{v['id']}")
    assert r.status_code == 409
    assert "abastecimento(s)" in r.json()["detail"]


def test_vehicle_without_history_is_deleted(api):
    v = api.post("/api/vehicles", json={"plate": "NEW1A11", "vehicle_type": "CAVALO"}).json()
    assert api.delete(f"/api/vehicles/{v['id']}").status_code == 200
