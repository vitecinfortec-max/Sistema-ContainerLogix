"""Grupo Operacional: fatura portuária cancelada é definitiva, serviço
faturado travado, um Status de Entrega por Programação, exclusões que
mantêm a Programação coerente e os indicadores/filtros das listas."""


def _client(api, name):
    r = api.post("/api/clients", json={"name": name})
    assert r.status_code == 200, r.text
    return r.json()


def _port_service(api, client, value=500.0, day="2026-10-10", exit_time="18:00", turno="DIA"):
    r = api.post("/api/port-services", json={
        "client_id": client["id"], "client_name": client["name"], "driver_name": "JOSE", "cavalo_plate": "AAA1A11",
        "service_date": day, "turno": turno, "entry_time": "08:00", "exit_time": exit_time, "operation_value": value,
    })
    assert r.status_code == 200, r.text
    return r.json()


def _batch(api, client, services):
    r = api.post("/api/port-services/billing-batches", json={
        "client_id": client["id"], "client_name": client["name"], "service_ids": [s["id"] for s in services],
    })
    assert r.status_code == 200, r.text
    return r.json()


def _schedule(api, alfa):
    r = api.post("/api/loading-schedules", json={
        "destination_client_id": alfa["id"], "destination_client_name": alfa["name"],
        "contracting_client_id": alfa["id"], "contracting_client_name": alfa["name"],
        "items": [{"driver_name": "JOSE", "cavalo_plate": "AAA1A11", "loading_location": "Pecém", "loading_date": "2026-10-14"}],
    })
    assert r.status_code == 200, r.text
    return r.json()


def _delivery(api, schedule, done=True):
    return api.post("/api/delivery-status", json={
        "schedule_number": schedule["schedule_number"], "status_date": "2026-10-14",
        "items": [{"driver_name": "JOSE", "cavalo_plate": "AAA1A11", "loading_location": "Pecém",
                   "delivery_completed": "17:00" if done else None}],
    })


def test_cancelled_port_batch_cannot_reopen(api):
    alfa = _client(api, "Cliente Alfa")
    s = _port_service(api, alfa)
    batch = _batch(api, alfa, [s])
    assert api.put(f"/api/port-services/billing-batches/{batch['id']}/status", params={"status": "CANCELADO"}).status_code == 200
    r = api.put(f"/api/port-services/billing-batches/{batch['id']}/status", params={"status": "PENDENTE"})
    assert r.status_code == 400 and "reaberta" in r.json()["detail"]
    # o serviço liberado pode entrar numa nova fatura
    assert _batch(api, alfa, [s])["item_count"] == 1


def test_billed_port_service_locks_value_client_and_delete(api):
    alfa, beta = _client(api, "Cliente Alfa"), _client(api, "Cliente Beta")
    s = _port_service(api, alfa)
    batch = _batch(api, alfa, [s])
    body = {k: s[k] for k in ("client_id", "client_name", "driver_name", "cavalo_plate", "service_date", "turno", "entry_time", "exit_time", "operation_value")}

    r = api.put(f"/api/port-services/{s['id']}", json={**body, "operation_value": 999})
    assert r.status_code == 400 and f"Nº {batch['batch_number']}" in r.json()["detail"]
    assert api.put(f"/api/port-services/{s['id']}", json={**body, "client_id": beta["id"], "client_name": beta["name"]}).status_code == 400
    assert api.delete(f"/api/port-services/{s['id']}").status_code == 400
    # outros campos continuam editáveis
    assert api.put(f"/api/port-services/{s['id']}", json={**body, "observations": "ok"}).status_code == 200


def test_port_service_list_filters_stats_and_batch_number(api):
    alfa = _client(api, "Cliente Alfa")
    a = _port_service(api, alfa, 100, "2026-10-01")
    _port_service(api, alfa, 200, "2026-10-05", exit_time=None, turno="NOITE")
    _port_service(api, alfa, 300, "2026-10-09")
    batch = _batch(api, alfa, [a])

    data = api.get("/api/port-services").json()
    assert data["stats"] == {"count": 3, "total_value": 600.0, "in_progress": 1, "unbilled": 2}
    billed_row = next(i for i in data["items"] if i["id"] == a["id"])
    assert billed_row["billing_batch_number"] == batch["batch_number"]

    assert api.get("/api/port-services", params={"situacao": "EM_ANDAMENTO"}).json()["total"] == 1
    assert api.get("/api/port-services", params={"situacao": "CONCLUIDO"}).json()["total"] == 2
    assert api.get("/api/port-services", params={"billed": "false"}).json()["total"] == 2
    assert api.get("/api/port-services", params={"turno": "NOITE"}).json()["total"] == 1
    assert api.get("/api/port-services", params={"date_from": "2026-10-05", "date_to": "2026-10-09"}).json()["total"] == 2


def test_one_delivery_status_per_schedule_and_deletes(api):
    alfa = _client(api, "Cliente Alfa")
    sched = _schedule(api, alfa)
    first = _delivery(api, sched)
    assert first.status_code == 200, first.text
    assert api.get(f"/api/loading-schedules/{sched['id']}").json()["status"] == "CONCLUIDO"

    second = _delivery(api, sched, done=False)
    assert second.status_code == 400 and "já tem o Status de Entrega" in second.json()["detail"]

    # Programação com Status de Entrega não pode ser excluída
    r = api.delete(f"/api/loading-schedules/{sched['id']}")
    assert r.status_code == 400 and "Status de Entrega" in r.json()["detail"]

    # Excluir o Status de Entrega devolve a Programação pra Ativa
    assert api.delete(f"/api/delivery-status/{first.json()['id']}").status_code == 200
    assert api.get(f"/api/loading-schedules/{sched['id']}").json()["status"] == "ATIVO"
    assert api.delete(f"/api/loading-schedules/{sched['id']}").status_code == 200


def test_cancelled_delivery_status_allows_new_one_and_status_repeat_ok(api):
    alfa = _client(api, "Cliente Alfa")
    sched = _schedule(api, alfa)
    first = _delivery(api, sched, done=False).json()
    assert api.put(f"/api/delivery-status/{first['id']}/update-status", params={"new_status": "CANCELADO"}).status_code == 200
    # repetir o mesmo status não é 404
    assert api.put(f"/api/delivery-status/{first['id']}/update-status", params={"new_status": "CANCELADO"}).status_code == 200
    assert _delivery(api, sched).status_code == 200

    assert api.put(f"/api/loading-schedules/{sched['id']}/update-status", params={"new_status": "CANCELADO"}).status_code == 200
    assert api.put(f"/api/loading-schedules/{sched['id']}/update-status", params={"new_status": "CANCELADO"}).status_code == 200

    stats = api.get("/api/loading-schedules").json()["stats"]
    assert stats == {"ATIVO": 0, "CONCLUIDO": 0, "CANCELADO": 1}
    ds = api.get("/api/delivery-status", params={"search": "jose"}).json()
    assert ds["total"] == 2 and ds["stats"]["CANCELADO"] == 1 and ds["stats"]["CONCLUIDO"] == 1
