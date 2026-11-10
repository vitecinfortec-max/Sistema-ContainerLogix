"""Ocorrências de Transporte: tipos padrão criados na primeira consulta,
cadastro com ligação opcional à Ordem de Carregamento (placa e motorista vêm
dela), situação Aberta/Resolvida, fotos, filtros e relatório PDF/Excel."""


def _type_id(api, name="Avaria na carga"):
    types = api.get("/api/transport-occurrence-types").json()
    return next(t["id"] for t in types if t["name"] == name)


def _body(api, **over):
    body = {"type_id": _type_id(api), "occurred_date": "2026-11-05", "occurred_time": "14:30",
            "location": "BR-101 km 20", "description": "Container amassado na lateral"}
    body.update(over)
    return body


def test_default_types_and_type_rules(api):
    names = [t["name"] for t in api.get("/api/transport-occurrence-types").json()]
    assert "Avaria na carga" in names and "Outros" in names
    assert len(api.get("/api/transport-occurrence-types").json()) == len(names)  # não duplica

    created = api.post("/api/transport-occurrence-types", json={"name": "  Pneu   furado "}).json()
    assert created["name"] == "Pneu furado"
    assert api.post("/api/transport-occurrence-types", json={"name": "pneu furado"}).status_code == 400

    api.post("/api/transport-occurrences", json=_body(api, type_id=created["id"]))
    r = api.delete(f"/api/transport-occurrence-types/{created['id']}")
    assert r.status_code == 400 and "desative" in r.json()["detail"]
    api.put(f"/api/transport-occurrence-types/{created['id']}", json={"name": "Pneu estourado", "active": False})
    assert api.get("/api/transport-occurrences").json()["items"][0]["type_name"] == "Pneu estourado"


def test_create_with_loading_order_and_resolve(api):
    api.run(api.db.loading_orders.insert_one({
        "id": "lo-1", "order_number": 42, "truck_plate": "ABC1D23", "driver_id": "dr-1", "driver_name": "João"}))
    occ = api.post("/api/transport-occurrences", json=_body(api, loading_order_id="lo-1", cost=350.456)).json()
    assert occ["occurrence_number"] == 1 and occ["loading_order_number"] == 42
    assert occ["vehicle_plate"] == "ABC1D23" and occ["driver_name"] == "João"
    assert occ["cost"] == 350.46 and occ["status"] == "ABERTA" and occ["resolved_at"] is None

    resolved = api.put(f"/api/transport-occurrences/{occ['id']}",
                       json=_body(api, loading_order_id="lo-1", status="RESOLVIDA", resolution="Seguro acionado")).json()
    assert resolved["resolved_at"] and resolved["resolution"] == "Seguro acionado"
    again = api.put(f"/api/transport-occurrences/{occ['id']}", json=_body(api, status="RESOLVIDA")).json()
    assert again["resolved_at"] == resolved["resolved_at"]  # continua a data da primeira resolução
    assert again["loading_order_id"] is None and again["vehicle_plate"] is None
    reopened = api.put(f"/api/transport-occurrences/{occ['id']}", json=_body(api)).json()
    assert reopened["resolved_at"] is None


def test_validation(api):
    assert api.post("/api/transport-occurrences", json=_body(api, description="  ")).status_code == 400
    assert api.post("/api/transport-occurrences", json=_body(api, occurred_time="25:00")).status_code == 400
    assert api.post("/api/transport-occurrences", json=_body(api, type_id="nope")).status_code == 400
    assert api.post("/api/transport-occurrences", json=_body(api, vehicle_id="nope")).status_code == 400
    assert api.post("/api/transport-occurrences", json=_body(api, status="X")).status_code == 400


def test_filters_photos_and_report(api):
    api.post("/api/transport-occurrences", json=_body(api, cost=100))
    second = api.post("/api/transport-occurrences", json=_body(api, type_id=_type_id(api, "Atraso na coleta/entrega"),
                                                                 occurred_date="2026-10-01", description="Atraso no porto",
                                                                 status="RESOLVIDA")).json()
    assert api.get("/api/transport-occurrences", params={"status": "ABERTA"}).json()["total"] == 1
    assert api.get("/api/transport-occurrences", params={"date_from": "2026-11-01"}).json()["total"] == 1
    assert api.get("/api/transport-occurrences", params={"search": "porto"}).json()["items"][0]["id"] == second["id"]
    assert api.get("/api/transport-occurrences", params={"search": "#2"}).json()["items"][0]["id"] == second["id"]

    photo = api.post(f"/api/transport-occurrences/{second['id']}/photos",
                     files={"file": ("foto.jpg", b"\xff\xd8\xff\xe0fake", "image/jpeg")})
    assert photo.status_code == 200, photo.text
    photo_id = photo.json()["photos"][0]["id"]
    assert api.delete(f"/api/transport-occurrences/{second['id']}/photos/{photo_id}").json()["photos"] == []

    report = api.get("/api/reports/transport-occurrences").json()
    assert report["summary"] == {"total": 2, "open": 1, "resolved": 1, "cost": 100.0}
    assert api.get("/api/reports/transport-occurrences/pdf").status_code == 200
    assert api.get("/api/reports/transport-occurrences/excel").status_code == 200

    assert api.delete(f"/api/transport-occurrences/{second['id']}").status_code == 200
    assert api.get(f"/api/transport-occurrences/{second['id']}").status_code == 404
