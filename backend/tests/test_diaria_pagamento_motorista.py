"""Solicitação de Diária: cada motorista (item) é marcado como pago à parte; a
solicitação fica Paga quando todos estão pagos, e o relatório separa o pago e
o pendente por período (saída ou pagamento)."""


def _request(api, *drivers):
    body = {"items": [{"driver_name": d, "vehicle_plate": "AAA1A11", "client_name": "Cli", "departure_date": day,
                       "daily_rate_quantity": 1, "daily_rate_value": value} for d, day, value in drivers]}
    return api.post("/api/daily-rate-requests", json=body).json()


def _pay(api, req, indexes, paid=True):
    return api.put(f"/api/daily-rate-requests/{req['id']}/paid-items", json={"indexes": indexes, "paid": paid})


def _stored(api, req):
    return api.run(api.db.daily_rate_requests.find_one({"id": req["id"]}, {"_id": 0}))


def test_pay_driver_by_driver(api):
    req = _request(api, ("JOSE", "2026-10-05", 100), ("MARIA", "2026-10-06", 80))
    assert [i["paid"] for i in req["items"]] == [False, False]

    res = _pay(api, req, [1])
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "PENDENTE" and [i["paid"] for i in body["items"]] == [False, True]
    maria_paid_at = body["items"][1]["paid_at"]
    assert maria_paid_at

    body = _pay(api, req, [0]).json()
    assert body["status"] == "PAGO" and all(i["paid"] for i in body["items"])
    assert body["items"][1]["paid_at"] == maria_paid_at  # já pago mantém a data
    assert _stored(api, req)["paid_at"]

    body = _pay(api, req, [0], paid=False).json()
    assert body["status"] == "PENDENTE" and body["items"][0]["paid_at"] is None
    assert _stored(api, req)["paid_at"] is None


def test_whole_request_status_still_pays_everyone(api):
    req = _request(api, ("JOSE", "2026-10-05", 100), ("MARIA", "2026-10-06", 80))
    _pay(api, req, [0])
    api.put(f"/api/daily-rate-requests/{req['id']}/update-status", params={"new_status": "PAGO"})
    stored = _stored(api, req)
    assert stored["status"] == "PAGO" and all(i["paid"] for i in stored["items"])

    api.put(f"/api/daily-rate-requests/{req['id']}/update-status", params={"new_status": "PENDENTE"})
    assert not any(i["paid"] for i in _stored(api, req)["items"])


def test_paid_driver_blocks_edit_and_invalid_calls(api):
    req = _request(api, ("JOSE", "2026-10-05", 100), ("MARIA", "2026-10-06", 80))
    _pay(api, req, [0])
    edit = api.put(f"/api/daily-rate-requests/{req['id']}", json={"items": req["items"]})
    assert edit.status_code == 400 and "pago" in edit.json()["detail"]
    assert _pay(api, req, [5]).status_code == 400
    assert _pay(api, req, []).status_code == 400
    assert api.put("/api/daily-rate-requests/nao-existe/paid-items", json={"indexes": [0], "paid": True}).status_code == 404
    api.put(f"/api/daily-rate-requests/{req['id']}/update-status", params={"new_status": "CANCELADO"})
    assert _pay(api, req, [1]).status_code == 400


def test_report_splits_paid_and_pending_per_driver(api):
    req = _request(api, ("JOSE", "2026-09-28", 100), ("MARIA", "2026-10-06", 80))
    _pay(api, req, [0])
    api.run(api.db.daily_rate_requests.update_one(
        {"id": req["id"]}, {"$set": {"items.0.paid_at": "2026-10-10T15:00:00+00:00"}}))

    data = api.get("/api/reports/daily-rates").json()
    assert data["summary"]["paid"] == 100 and data["summary"]["pending"] == 80
    by_driver = {d["driver_name"]: (d["paid"], d["pending"]) for d in data["drivers"]}
    assert by_driver == {"JOSE": (100, 0), "MARIA": (0, 80)}
    assert [i["paid_at"] for i in data["items"]] == ["2026-10-10", None]

    pending = api.get("/api/reports/daily-rates", params={"status": "PENDENTE"}).json()
    assert [i["driver_name"] for i in pending["items"]] == ["MARIA"]

    # Saída em setembro, paga em outubro: entra no período de outubro pelo pagamento
    october = {"date_from": "2026-10-01", "date_to": "2026-10-31"}
    assert [i["driver_name"] for i in api.get("/api/reports/daily-rates", params=october).json()["items"]] == ["MARIA"]
    by_payment = api.get("/api/reports/daily-rates", params={**october, "period_by": "payment"}).json()
    assert [i["driver_name"] for i in by_payment["items"]] == ["JOSE"]
    assert api.get("/api/reports/daily-rates/pdf", params={**october, "period_by": "payment"}).content[:4] == b"%PDF"
    assert api.get("/api/reports/daily-rates", params={"period_by": "x"}).status_code == 422


def test_legacy_paid_request_counts_items_as_paid(api):
    api.run(api.db.daily_rate_requests.insert_one({
        "id": "old", "request_number": 99, "status": "PAGO", "created_by": "u", "created_by_name": "U",
        "created_at": "2026-10-01T12:00:00+00:00", "paid_at": "2026-10-02T12:00:00+00:00", "total_value": 150,
        "items": [{"driver_name": "A", "vehicle_plate": "P", "client_name": "C", "departure_date": "2026-10-01", "total": 100},
                  {"driver_name": "B", "vehicle_plate": "P", "client_name": "C", "departure_date": "2026-10-01", "total": 50}],
    }))
    assert api.get("/api/reports/daily-rates").json()["summary"]["paid"] == 150

    body = _pay(api, {"id": "old"}, [1], paid=False).json()
    assert body["status"] == "PENDENTE"
    assert [i["paid"] for i in body["items"]] == [True, False]
    assert body["items"][0]["paid_at"] == "2026-10-02T12:00:00+00:00"
