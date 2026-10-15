"""Grupo Transporte: edição que apaga campos, Pagamento Frete acompanhando a
Ordem de Carregamento, recibo refeito ao estornar, filtros de período no
horário de Brasília e rota em uso."""
from datetime import datetime, timezone


def _route(api, value=1500.0):
    r = api.post("/api/freight-routes", json={"origin": "Pecém", "destination": "Fortaleza", "freight_value": value})
    assert r.status_code == 200, r.text
    return r.json()


def _driver(api, name="JOSE CARLOS DA SILVA", cpf="11144477735"):
    r = api.post("/api/drivers", json={"name": name, "cpf": cpf, "cnh_category": "E"})
    assert r.status_code == 200, r.text
    return r.json()


def _order(api, route, driver, status="APROVADA", container="MSCU1234565", **extra):
    body = {
        "order_type": "COLETA", "status": status,
        "items": [{"container_number": container, "status": "VAZIO", "size_type": "40HC", "shipping_line": "MSC"}],
        "truck_plate": "RTA2B34", "trailer_plate": "CRT1A11", "transport_company": "Transportes Teste",
        "route_id": route["id"], "route_name": "Pecém x Fortaleza", "freight_value": route["freight_value"],
        "driver_id": driver["id"], "driver_name": driver["name"], "driver_cpf": driver["cpf"],
        **extra,
    }
    r = api.post("/api/loading-orders", json=body)
    assert r.status_code == 200, r.text
    return r.json(), body


def _payment_of(api, order_id):
    return api.run(api.db.freight_payments.find_one({"loading_order_id": order_id}, {"_id": 0}))


def test_vehicle_edit_clears_fields(api):
    r = api.post("/api/vehicles", json={"plate": "abc1d23", "vehicle_type": "CAVALO", "renavam": "123",
                                        "crlv_expiry": "2026-12-01", "observations": "x"})
    assert r.status_code == 200, r.text
    vid = r.json()["id"]
    r = api.put(f"/api/vehicles/{vid}", json={"plate": "ABC1D23", "vehicle_type": "CAVALO", "status": None,
                                              "renavam": None, "crlv_expiry": None, "observations": None})
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["renavam"] is None and v["crlv_expiry"] is None and v["observations"] is None
    assert v["status"] == "ATIVO"  # obrigatório: null não apaga


def test_rpa_edit_clears_numeric_field(api):
    r = api.post("/api/rpa-terceiro", json={"driver_name": "JOSE", "service_value": 1000, "toll_value": 55.5})
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    r = api.put(f"/api/rpa-terceiro/{rid}", json={"driver_name": "JOSE", "service_value": 1000, "toll_value": None})
    assert r.status_code == 200, r.text
    assert r.json()["toll_value"] is None


def test_approved_order_edit_syncs_pending_payment(api):
    route, driver = _route(api), _driver(api)
    other = _driver(api, "MARCOS ANTONIO PEREIRA", "52998224725")
    order, body = _order(api, route, driver)
    assert _payment_of(api, order["id"])["freight_value"] == 1500.0

    r = api.put(f"/api/loading-orders/{order['id']}", json={**body, "freight_value": 1750.0,
                                                              "driver_id": other["id"], "driver_name": other["name"], "driver_cpf": other["cpf"]})
    assert r.status_code == 200, r.text
    fp = _payment_of(api, order["id"])
    assert fp["freight_value"] == 1750.0 and fp["driver_id"] == other["id"] and fp["status"] == "PENDENTE"

    # Virou Entrega: frete Pendente é cancelado e o valor some da ordem
    r = api.put(f"/api/loading-orders/{order['id']}", json={**body, "order_type": "ENTREGA", "route_id": "", "route_name": "", "freight_value": None})
    assert r.status_code == 200, r.text
    assert r.json()["freight_value"] is None
    assert _payment_of(api, order["id"])["status"] == "CANCELADO"


def test_deleting_approved_order_cancels_pending_payment(api):
    order, _ = _order(api, _route(api), _driver(api))
    assert api.delete(f"/api/loading-orders/{order['id']}").status_code == 200
    assert _payment_of(api, order["id"])["status"] == "CANCELADO"


def test_revert_paid_payment_leaves_batch(api):
    route, driver = _route(api), _driver(api)
    o1, _ = _order(api, route, driver)
    o2, _ = _order(api, route, driver, container="TCLU1234560", freight_value=500.0)
    p1, p2 = _payment_of(api, o1["id"]), _payment_of(api, o2["id"])
    r = api.post("/api/freight-payments/mark-paid-batch", json={"payment_ids": [p1["id"], p2["id"]]})
    assert r.status_code == 200, r.text
    batch_id = r.json()["id"]
    assert r.json()["total_value"] == 2000.0

    assert api.put(f"/api/freight-payments/{p2['id']}/status", params={"status": "PENDENTE"}).status_code == 200
    batch = api.run(api.db.freight_payment_batches.find_one({"id": batch_id}, {"_id": 0}))
    assert batch["payment_ids"] == [p1["id"]] and batch["item_count"] == 1 and batch["total_value"] == 1500.0

    assert api.put(f"/api/freight-payments/{p1['id']}/status", params={"status": "PENDENTE"}).status_code == 200
    assert api.run(api.db.freight_payment_batches.find_one({"id": batch_id})) is None


def test_period_filter_uses_brasilia_day(api):
    order, _ = _order(api, _route(api), _driver(api))
    # 22:30 de 10/10 em Brasília = 01:30 de 11/10 em UTC
    late = datetime(2026, 10, 11, 1, 30, tzinfo=timezone.utc).isoformat()
    api.run(api.db.freight_payments.update_one({"loading_order_id": order["id"]}, {"$set": {"created_at": late}}))
    rows = api.get("/api/freight-payments", params={"date_from": "2026-10-10", "date_to": "2026-10-10"}).json()
    assert len(rows) == 1
    assert api.get("/api/freight-payments", params={"date_from": "2026-10-11", "date_to": "2026-10-11"}).json() == []

    rid = api.post("/api/rpa-terceiro", json={"driver_name": "JOSE"}).json()["id"]
    api.run(api.db.rpa_terceiro.update_one({"id": rid}, {"$set": {"created_at": late}}))
    assert len(api.get("/api/rpa-terceiro", params={"date_from": "2026-10-10", "date_to": "2026-10-10"}).json()) == 1


def test_route_in_use_cannot_be_deleted(api):
    route = _route(api)
    _order(api, route, _driver(api), status="PENDENTE")
    r = api.delete(f"/api/freight-routes/{route['id']}")
    assert r.status_code == 400 and "Inativo" in r.json()["detail"]
    free = api.post("/api/freight-routes", json={"origin": "Aquiraz", "destination": "Caucaia", "freight_value": 900}).json()
    assert api.delete(f"/api/freight-routes/{free['id']}").status_code == 200
    names = [r["origin"] for r in api.get("/api/freight-routes").json()]
    assert names == sorted(names)
