"""Acerto de Motorista puxando viagens também da Ordem de Serviço - Cliente:
candidatas (em trânsito/concluídas, do motorista, filtro pela placa com ou
sem traço), cópia no acerto, uma OS em um acerto só, proteção da OS e PDF."""
import io


def _seed(api):
    db = api.db
    api.run(db.drivers.insert_many([{"id": "dr-1", "name": "João Motorista"}, {"id": "dr-2", "name": "Pedro"}]))
    api.run(db.vehicles.insert_many([{"id": "vh-1", "plate": "ABC1D23"}, {"id": "vh-2", "plate": "XYZ9B88"}]))
    api.run(db.loading_orders.insert_one(
        {"id": "lo-1", "order_number": 7, "status": "APROVADA", "driver_id": "dr-1", "truck_plate": "ABC1D23",
         "route_name": "Santos x Campinas", "booking": "BK1", "created_at": "2026-11-02T15:00:00+00:00"}))


def _os(api, **extra):
    body = {
        "operation_type": "ENTREGA", "client_name": "CLIENTE ALFA", "port_terminal_name": "Porto do Pecém",
        "containers": [{"container_number": "CSQU3054383"}], "freight_value": 900.0,
        "driver_id": "dr-1", "driver_name": "João Motorista", "truck_plate": "abc1d23",
        "scheduled_at": "2026-11-05T08:00", "status": "CONCLUIDA",
    }
    body.update(extra)
    r = api.post("/api/port-client-orders", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_candidates_include_client_os(api):
    _seed(api)
    done = _os(api)
    transit = _os(api, status="EM_TRANSITO", operation_type="COLETA")
    _os(api, status="ABERTA")  # ainda não saiu: fica de fora
    _os(api, status="CANCELADA")  # cancelada: fica de fora
    _os(api, driver_id="dr-2", driver_name="Pedro")  # outro motorista
    _os(api, truck_plate="XYZ9B88")  # outro veículo

    cand = api.get("/api/driver-settlements/candidates", params={"driver_id": "dr-1"}).json()
    os_ids = {t["port_client_order_id"] for t in cand["trips"] if t.get("port_client_order_id")}
    assert len(os_ids) == 3  # concluída, em trânsito e a do outro veículo (sem filtro de veículo)
    assert any(t.get("loading_order_id") == "lo-1" for t in cand["trips"])

    # com veículo: placa ABC1D23 no cadastro acha a OS gravada como ABC-1D23
    cand = api.get("/api/driver-settlements/candidates", params={"driver_id": "dr-1", "vehicle_id": "vh-1"}).json()
    os_trips = {t["port_client_order_id"]: t for t in cand["trips"] if t.get("port_client_order_id")}
    assert set(os_trips) == {done["id"], transit["id"]}
    t = os_trips[transit["id"]]
    assert t["source"] == "OS_CLIENTE" and t["order_date"] == "2026-11-05"
    assert t["route_name"] == "CLIENTE ALFA → Porto do Pecém"  # coleta: cliente -> porto


def test_settlement_with_loading_order_and_client_os(api):
    _seed(api)
    os1 = _os(api)
    body = {
        "driver_id": "dr-1", "vehicle_id": "vh-1", "settlement_date": "2026-11-08",
        "trips": [{"loading_order_id": "lo-1", "km_start": 1000, "km_end": 1300},
                  {"port_client_order_id": os1["id"], "km_start": 1300, "km_end": 1420}],
    }
    r = api.post("/api/driver-settlements", json=body)
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["km_total"] == 420
    assert {t["source"] for t in s["trips"]} == {"ORDEM_CARREGAMENTO", "OS_CLIENTE"}

    # a OS não aparece mais para outro acerto e não entra em dois acertos
    cand = api.get("/api/driver-settlements/candidates", params={"driver_id": "dr-1"}).json()
    assert not [t for t in cand["trips"] if t.get("port_client_order_id") == os1["id"]]
    r = api.post("/api/driver-settlements", json={**body, "trips": [{"port_client_order_id": os1["id"]}]})
    assert r.status_code == 400 and "Acerto nº 1" in r.json()["detail"]

    # OS no acerto: não pode ser excluída, cancelada nem trocar de motorista
    assert api.delete(f"/api/port-client-orders/{os1['id']}").status_code == 400
    r = api.put(f"/api/port-client-orders/{os1['id']}", json={"driver_id": "dr-2", "driver_name": "Pedro"})
    assert r.status_code == 400 and "Acerto da Viagem" in r.json()["detail"]
    # outros campos continuam editáveis
    assert api.put(f"/api/port-client-orders/{os1['id']}", json={"observations": "ok"}).status_code == 200

    # PDF identifica a origem de cada viagem
    from pdfminer.high_level import extract_text
    text = extract_text(io.BytesIO(api.get(f"/api/driver-settlements/{s['id']}/pdf").content))
    assert "OC 7" in text and f"OS-C {os1['order_number']}" in text

    # tirando a OS do acerto, ela volta a poder ser excluída
    r = api.put(f"/api/driver-settlements/{s['id']}", json={**body, "trips": body["trips"][:1]})
    assert r.status_code == 200, r.text
    assert api.delete(f"/api/port-client-orders/{os1['id']}").status_code == 200


def test_client_os_trip_validation(api):
    _seed(api)
    aberta = _os(api, status="ABERTA")
    outro = _os(api, driver_id="dr-2", driver_name="Pedro")
    ok = _os(api)
    base = {"driver_id": "dr-1", "settlement_date": "2026-11-08"}
    cases = [
        ([{"port_client_order_id": aberta["id"]}], "aberta"),
        ([{"port_client_order_id": outro["id"]}], "outro motorista"),
        ([{"port_client_order_id": ok["id"], "km_start": 500, "km_end": 400}], "km final"),
        ([{"port_client_order_id": "nao-existe"}], "não encontrada"),
        ([{}], "Ordem de Carregamento ou uma Ordem de Serviço"),
        ([{"loading_order_id": "lo-1", "port_client_order_id": ok["id"]}], "Ordem de Carregamento ou uma Ordem de Serviço"),
    ]
    for trips, message in cases:
        r = api.post("/api/driver-settlements", json={**base, "trips": trips})
        assert r.status_code == 400 and message in r.json()["detail"], (trips, r.text)
