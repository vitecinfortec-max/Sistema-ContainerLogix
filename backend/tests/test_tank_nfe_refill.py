"""Reabastecer Tanque puxando de NF-e importada do almoxarifado do posto: a
nota só aparece/serve se o produto for desse almoxarifado, dá baixa no
estoque com uma Saída travada, não pode ser usada duas vezes, e excluir o
reabastecimento devolve o diesel e libera a nota."""


def _setup(api, stock=10000.0, nfe_qty=5000.0):
    posto = api.post("/api/warehouses", json={"name": "Posto"}).json()
    other = api.post("/api/warehouses", json={"name": "Oficina"}).json()
    r = api.put("/api/tank-settings", json={
        "capacity_liters": 15000, "minimum_alert_liters": 2000, "fuel_warehouse_id": posto["id"],
    })
    assert r.status_code == 200, r.text
    assert r.json()["fuel_warehouse_name"] == "Posto"

    def product(pid, description, warehouse, qty):
        api.run(api.db.products.insert_one({
            "id": pid, "code": 1, "description": description, "unit": "LITRO",
            "warehouse_id": warehouse["id"], "warehouse_name": warehouse["name"], "stock_quantity": qty,
        }))

    product("diesel", "Óleo Diesel S10", posto, stock)
    product("oleo", "Óleo 15W40", other, 50.0)

    def entry(eid, pid, qty, nfe):
        api.run(api.db.stock_entries.insert_one({
            "id": eid, "product_id": pid, "product_name": pid, "quantity": qty, "unit_value": 6.0,
            "total_value": qty * 6.0, "supplier_name": "Distribuidora X", "nfe_number": nfe,
            "nfe_issue_date": "2026-10-10", "created_by": "admin-1", "created_by_name": "Admin",
            "created_at": "2026-10-10T10:00:00+00:00",
        }))

    entry("e-diesel", "diesel", nfe_qty, "1234")
    entry("e-oleo", "oleo", 20.0, "999")
    return posto


def _stock(api, pid):
    return api.run(api.db.products.find_one({"id": pid}))["stock_quantity"]


def test_options_list_only_posto_notes(api):
    _setup(api)
    data = api.get("/api/tank-refills/nfe-options").json()
    assert data["warehouse_name"] == "Posto"
    assert [i["stock_entry_id"] for i in data["items"]] == ["e-diesel"]
    assert data["items"][0]["nfe_number"] == "1234" and data["items"][0]["quantity"] == 5000.0


def test_options_empty_without_warehouse(api):
    api.put("/api/tank-settings", json={"capacity_liters": 1000, "minimum_alert_liters": 100})
    data = api.get("/api/tank-refills/nfe-options").json()
    assert data["warehouse_id"] is None and data["items"] == []


def test_refill_from_nfe_writes_off_stock_and_locks_note(api):
    _setup(api)
    r = api.post("/api/tank-refills", json={"refill_date": "2026-10-11", "liters": 5000, "stock_entry_id": "e-diesel"})
    assert r.status_code == 200, r.text
    refill = r.json()
    assert refill["nfe_number"] == "1234" and refill["supplier_name"] == "Distribuidora X"
    assert _stock(api, "diesel") == 5000.0
    assert api.get("/api/tank-level").json()["current_liters"] == 5000.0

    movement = api.run(api.db.stock_movements.find_one({"id": refill["stock_movement_id"]}))
    assert movement["operation_type"] == "SAIDA" and movement["origin"] == "TANQUE"
    # a Saída só muda pelo tanque
    assert api.delete(f"/api/stock/movements/{movement['id']}").status_code == 409
    # a importação da nota não pode ser estornada enquanto estiver em uso
    r = api.post("/api/stock/entries/e-diesel/reverse")
    assert r.status_code == 409 and "Reabastecimento" in r.json()["detail"]

    # a mesma nota não serve de novo e sai da lista
    r = api.post("/api/tank-refills", json={"refill_date": "2026-10-11", "liters": 10, "stock_entry_id": "e-diesel"})
    assert r.status_code == 409
    assert api.get("/api/tank-refills/nfe-options").json()["items"] == []

    # excluir devolve o diesel e libera a nota
    assert api.delete(f"/api/tank-refills/{refill['id']}").status_code == 200
    assert _stock(api, "diesel") == 10000.0
    assert api.run(api.db.stock_movements.find_one({"id": movement["id"]})) is None
    assert len(api.get("/api/tank-refills/nfe-options").json()["items"]) == 1
    r = api.post("/api/tank-refills", json={"refill_date": "2026-10-12", "liters": 4000, "stock_entry_id": "e-diesel"})
    assert r.status_code == 200, r.text


def test_refill_from_nfe_refusals(api):
    _setup(api, stock=100.0)
    # nota de produto de outro almoxarifado
    r = api.post("/api/tank-refills", json={"refill_date": "2026-10-11", "liters": 10, "stock_entry_id": "e-oleo"})
    assert r.status_code == 400
    # mais litros que a nota
    r = api.post("/api/tank-refills", json={"refill_date": "2026-10-11", "liters": 5001, "stock_entry_id": "e-diesel"})
    assert r.status_code == 400
    # sem saldo no almoxarifado: nada é gravado e a nota continua livre
    r = api.post("/api/tank-refills", json={"refill_date": "2026-10-11", "liters": 500, "stock_entry_id": "e-diesel"})
    assert r.status_code == 400 and "Saldo insuficiente" in r.json()["detail"]
    assert api.run(api.db.tank_refills.count_documents({})) == 0
    assert _stock(api, "diesel") == 100.0
    assert len(api.get("/api/tank-refills/nfe-options").json()["items"]) == 1


def test_manual_refill_still_works(api):
    _setup(api)
    r = api.post("/api/tank-refills", json={"refill_date": "2026-10-11", "liters": 300, "supplier_name": "Avulso"})
    assert r.status_code == 200 and r.json()["stock_entry_id"] is None
    assert _stock(api, "diesel") == 10000.0
    assert api.delete(f"/api/tank-refills/{r.json()['id']}").status_code == 200


def test_settings_reject_unknown_warehouse(api):
    r = api.put("/api/tank-settings", json={"capacity_liters": 1000, "minimum_alert_liters": 100, "fuel_warehouse_id": "x"})
    assert r.status_code == 400
