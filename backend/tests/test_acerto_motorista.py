"""Acerto da Viagem (antes Acerto de Motorista): abastecimentos pagos pelo motorista + despesas +
viagens com km - adiantamentos + devoluções = saldo; cada abastecimento/viagem
em um acerto só; Fechado trava; só administrador; fechamento de período."""


def _seed(api):
    db = api.db
    api.run(db.drivers.insert_many([{"id": "dr-1", "name": "João Motorista"}, {"id": "dr-2", "name": "Pedro"}]))
    api.run(db.vehicles.insert_one({"id": "vh-1", "plate": "ABC1D23"}))
    api.run(db.fuel_supplies.insert_many([
        {"id": "fs-1", "supply_number": 10, "supply_date": "2026-11-03", "driver_id": "dr-1", "equipment_id": "vh-1",
         "equipment_plate": "ABC1D23", "payment_type": "PAGO_MOTORISTA", "liters": 100, "gross_value": 600,
         "discounts": 10, "additions": 0, "has_other_expenses": True, "other_expenses_value": 20, "supplier_name": "Posto A"},
        {"id": "fs-2", "supply_number": 11, "supply_date": "2026-11-04", "driver_id": "dr-1", "equipment_id": "vh-1",
         "payment_type": "FATURADO", "liters": 50, "gross_value": 300},
        {"id": "fs-3", "supply_number": 12, "supply_date": "2026-11-04", "driver_id": "dr-2",
         "payment_type": "PAGO_MOTORISTA", "liters": 40, "gross_value": 240},
    ]))
    api.run(db.loading_orders.insert_many([
        {"id": "lo-1", "order_number": 7, "status": "APROVADA", "driver_id": "dr-1", "truck_plate": "ABC1D23",
         "route_name": "Santos x Campinas", "booking": "BK1", "created_at": "2026-11-02T15:00:00+00:00"},
        {"id": "lo-2", "order_number": 8, "status": "PENDENTE", "driver_id": "dr-1"},
    ]))


def _body(**over):
    body = {
        "driver_id": "dr-1", "vehicle_id": "vh-1", "settlement_date": "2026-11-08",
        "fuel_supply_ids": ["fs-1"],
        "trips": [{"loading_order_id": "lo-1", "km_start": 1000, "km_end": 1305}],
        "expenses": [{"description": "Pedágio", "quantity": 2, "unit_value": 15.5}],
        "advances": [{"kind": "ADIANTAMENTO", "amount": 500, "number": "R-1"},
                     {"kind": "DEVOLUCAO", "amount": 50}],
    }
    body.update(over)
    return body


def test_candidates_create_and_totals(api):
    _seed(api)
    cand = api.get("/api/driver-settlements/candidates", params={"driver_id": "dr-1"}).json()
    # todos os abastecimentos do veículo/motorista (pago pelo motorista e faturado), não os de outro motorista
    assert sorted(f["id"] for f in cand["fuel_supplies"]) == ["fs-1", "fs-2"]
    assert next(f for f in cand["fuel_supplies"] if f["id"] == "fs-1")["total"] == 610  # 600 - 10 + 20 (outras despesas)
    assert [t["loading_order_id"] for t in cand["trips"]] == ["lo-1"]  # só aprovadas

    s = api.post("/api/driver-settlements", json=_body()).json()
    assert s["settlement_number"] == 1 and s["status"] == "ABERTO"
    assert s["driver_name"] == "João Motorista" and s["vehicle_plate"] == "ABC1D23"
    assert s["fuel_total"] == 610 and s["expenses_total"] == 31
    assert s["trips"][0]["km"] == 305 and s["trips"][0]["order_date"] == "2026-11-02"
    assert s["km_per_liter"] == 3.05
    assert s["balance"] == 610 + 31 - 500 + 50

    # já usados não aparecem mais pra outro acerto, mas aparecem pro próprio
    left = api.get("/api/driver-settlements/candidates", params={"driver_id": "dr-1"}).json()
    assert [f["id"] for f in left["fuel_supplies"]] == ["fs-2"] and left["trips"] == []
    own = api.get("/api/driver-settlements/candidates", params={"driver_id": "dr-1", "settlement_id": s["id"]}).json()
    assert len(own["fuel_supplies"]) == 2 and len(own["trips"]) == 1  # o do acerto + o faturado ainda livre
    r = api.post("/api/driver-settlements", json=_body(trips=[], expenses=[], advances=[]))
    assert r.status_code == 400 and "Acerto nº 1" in r.json()["detail"]


def test_validation(api):
    _seed(api)
    cases = [
        _body(fuel_supply_ids=["fs-3"]),  # de outro motorista
        _body(trips=[{"loading_order_id": "lo-2"}]),  # não aprovada
        _body(trips=[{"loading_order_id": "lo-1", "km_start": 500, "km_end": 400}]),
        _body(expenses=[{"description": "  ", "unit_value": 1}]),
        _body(advances=[{"kind": "X", "amount": 1}]),
        _body(driver_id="nope"),
        _body(settlement_date="08/11/2026"),
    ]
    for body in cases:
        assert api.post("/api/driver-settlements", json=body).status_code in (400, 422), body


def test_close_locks_and_source_guards(api):
    _seed(api)
    s = api.post("/api/driver-settlements", json=_body()).json()

    # abastecimento/ordem acertados não podem ser apagados nem desaprovados
    r = api.delete("/api/fuel-supplies/fs-1")
    assert r.status_code == 400 and "Acerto da Viagem nº 1" in r.json()["detail"]
    assert api.delete("/api/loading-orders/lo-1").status_code == 400
    assert api.put("/api/loading-orders/lo-1", json={"status": "CANCELADA"}).status_code == 400

    closed = api.put(f"/api/driver-settlements/{s['id']}/close", json={"closed": True, "date": "2026-11-09"}).json()
    assert closed["status"] == "FECHADO" and closed["closed_at"] == "2026-11-09"
    assert api.put(f"/api/driver-settlements/{s['id']}", json=_body()).status_code == 400
    assert api.delete(f"/api/driver-settlements/{s['id']}").status_code == 400
    pdf = api.get(f"/api/driver-settlements/{s['id']}/pdf")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"

    reopened = api.put(f"/api/driver-settlements/{s['id']}/close", json={"closed": False}).json()
    assert reopened["status"] == "ABERTO" and reopened["closed_at"] is None
    # tirar o abastecimento do acerto libera a exclusão
    api.put(f"/api/driver-settlements/{s['id']}", json=_body(fuel_supply_ids=[]))
    assert api.delete("/api/fuel-supplies/fs-1").status_code == 200
    assert api.delete(f"/api/driver-settlements/{s['id']}").status_code == 200


def test_list_filters_admin_only_and_period_lock(api):
    _seed(api)
    s = api.post("/api/driver-settlements", json=_body()).json()
    assert api.get("/api/driver-settlements", params={"search": "joão"}).json()["total"] == 1
    assert api.get("/api/driver-settlements", params={"search": "#1"}).json()["total"] == 1
    assert api.get("/api/driver-settlements", params={"status": "FECHADO"}).json()["total"] == 0
    assert api.get("/api/driver-settlements", as_user="operator").status_code == 403

    assert api.put("/api/company-settings", json={"financial_lock_date": "2026-11-08"}).status_code == 200
    r = api.put(f"/api/driver-settlements/{s['id']}", json=_body())
    assert r.status_code == 400 and "Período financeiro fechado" in r.json()["detail"]
    assert api.post("/api/driver-settlements", json=_body(fuel_supply_ids=[], trips=[], settlement_date="2026-11-01")).status_code == 400
    assert api.post("/api/driver-settlements", json=_body(fuel_supply_ids=[], trips=[], settlement_date="2026-11-09")).status_code == 200
