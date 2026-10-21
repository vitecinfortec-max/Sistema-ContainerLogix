"""Análise do Abastecimento (21/10/2026): o Controle de Média ignora ARLA e
usa o método de tanque cheio a tanque cheio; o lançamento confere campos
obrigatórios, Ordem de Abastecimento já usada e Leitura fora de ordem; o
Nível do Tanque informa o custo do litro da última recarga de NF-e."""


def _vehicle(api, plate="ABC1D23"):
    api.run(api.db.vehicles.insert_one({
        "id": f"v-{plate}", "plate": plate, "model": "FH 540", "vehicle_type": "CAVALO", "status": "ATIVO",
    }))
    return f"v-{plate}"


def _supply(api, vid, date, reading, liters, fuel="DIESEL_S10", full=True, **extra):
    body = {
        "equipment_id": vid, "equipment_plate": "ABC1D23", "supply_date": date, "entry_date": date,
        "reading": reading, "source": "POSTO_EXTERNO", "supplier_name": "Posto X", "fuel_type": fuel,
        "liters": liters, "unit_price": 6, "gross_value": liters * 6, "full_tank": full, **extra,
    }
    return api.post("/api/fuel-supplies", json=body)


def _history(api):
    return api.get("/api/fuel-supplies/consumption-history").json()


# ---------- Controle de Média ----------

def test_arla_does_not_enter_average(api):
    vid = _vehicle(api)
    assert _supply(api, vid, "2026-10-01", 10000, 400).status_code == 200
    assert _supply(api, vid, "2026-10-02", 11000, 40, fuel="ARLA_32").status_code == 200
    assert _supply(api, vid, "2026-10-03", 12000, 800).status_code == 200
    history = _history(api)
    assert len(history) == 1
    assert history[0]["km_traveled"] == 2000 and history[0]["liters"] == 800
    assert history[0]["average"] == 2.5


def test_partial_fills_add_up_until_next_full_tank(api):
    vid = _vehicle(api)
    _supply(api, vid, "2026-10-01", 10000, 500)
    _supply(api, vid, "2026-10-02", 10600, 100, full=False)
    _supply(api, vid, "2026-10-03", 11500, 500)
    history = _history(api)
    # 1.500 km com 600 L (parcial de 100 + cheio de 500), não 900 km / 500 L
    assert len(history) == 1
    assert history[0]["previous_reading"] == 10000 and history[0]["km_traveled"] == 1500
    assert history[0]["liters"] == 600 and history[0]["partial_count"] == 1
    assert history[0]["average"] == 2.5
    summary = api.get("/api/fuel-supplies/consumption-summary").json()
    assert summary[0]["current_average"] == 2.5


def test_old_supplies_without_full_tank_flag_count_as_full(api):
    vid = _vehicle(api)
    for n, (date, reading) in enumerate((("2026-10-01", 1000), ("2026-10-02", 1500)), start=1):
        api.run(api.db.fuel_supplies.insert_one({
            "id": f"old{n}", "supply_number": n, "equipment_id": vid, "supply_date": date,
            "created_at": f"{date}T10:00:00", "reading": reading, "liters": 200, "fuel_type": "DIESEL_S10",
        }))
    history = _history(api)
    assert [h["average"] for h in history] == [2.5]


# ---------- Lançamento ----------

def test_required_fields_checked_by_api(api):
    vid = _vehicle(api)
    r = _supply(api, vid, "2026-10-01", 1000, 0)
    assert r.status_code == 400 and "Litros" in r.json()["detail"]
    r = api.post("/api/fuel-supplies", json={"supply_date": "2026-10-01", "fuel_type": "DIESEL_S10", "liters": 10})
    assert r.status_code == 400 and "Equipamento" in r.json()["detail"]


def test_order_cannot_be_launched_twice(api):
    vid = _vehicle(api)
    order = api.post("/api/fuel-supply-orders", json={
        "order_date": "2026-10-01", "equipment_plate": "ABC1D23", "fuel_type": "DIESEL_S10", "supply_mode": "LITROS", "liters": 100,
    }).json()
    first = _supply(api, vid, "2026-10-01", 1000, 100, fuel_supply_order_id=order["id"])
    assert first.status_code == 200
    r = _supply(api, vid, "2026-10-02", 1500, 100, fuel_supply_order_id=order["id"])
    assert r.status_code == 400 and "já foi lançada" in r.json()["detail"]
    # editar o próprio abastecimento da ordem continua valendo
    supply = first.json()
    r = api.put(f"/api/fuel-supplies/{supply['id']}", json={**supply, "liters": 90, "gross_value": 540})
    assert r.status_code == 200, r.text


def test_reading_out_of_order_asks_confirmation(api):
    vid = _vehicle(api)
    _supply(api, vid, "2026-10-01", 10000, 100)
    _supply(api, vid, "2026-10-10", 12000, 100)
    r = _supply(api, vid, "2026-10-05", 9000, 100)
    assert r.status_code == 409 and "menor" in r.json()["detail"]
    r = _supply(api, vid, "2026-10-05", 13000, 100)
    assert r.status_code == 409 and "maior" in r.json()["detail"]
    # no mesmo dia não confere (diesel e ARLA com a mesma leitura)
    assert _supply(api, vid, "2026-10-10", 12000, 20, fuel="ARLA_32").status_code == 200
    # confirmado pelo usuário, grava (e o campo não é salvo)
    r = _supply(api, vid, "2026-10-05", 9000, 100, confirm_reading=True)
    assert r.status_code == 200
    assert "confirm_reading" not in api.run(api.db.fuel_supplies.find_one({"id": r.json()["id"]}))


# ---------- Tanque Próprio ----------

def test_tank_level_reports_last_nfe_unit_cost(api):
    api.put("/api/tank-settings", json={"capacity_liters": 5000, "minimum_alert_liters": 500})
    assert api.get("/api/tank-level").json()["last_unit_cost"] is None
    api.run(api.db.stock_entries.insert_one({"id": "e1", "unit_value": 5.89}))
    api.run(api.db.tank_refills.insert_one({
        "id": "r1", "refill_number": 1, "refill_date": "2026-10-10", "liters": 1000, "stock_entry_id": "e1",
        "created_at": "2026-10-10T10:00:00",
    }))
    assert api.get("/api/tank-level").json()["last_unit_cost"] == 5.89
