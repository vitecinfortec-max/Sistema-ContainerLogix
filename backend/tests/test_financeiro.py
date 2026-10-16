"""Grupo Financeiro: fatura cancelada devolve as movimentações e é
definitiva, exclusão que não mexe em outra fatura, filtro/indicadores das
Faturas, rota antiga de "faturar sem fatura" removida, status repetido sem
404, travas de edição (Diária paga, Invoice cancelada, recibos de
Prestação concluída), validação/arredondamento da Invoice Internacional e
a prévia do Relatório de Faturamento."""
from test_api_invoices import movement, invoice, stored, stored_invoice


def _intl_body(**over):
    body = {
        "payer_company": "ACME LTD", "payer_address": "1 Main St", "issue_date": "2026-10-16",
        "due_date": "2026-11-16", "currency": "USD",
        "items": [{"description": "Storage", "quantity": 3, "unit_price": 0.1, "total": 0}],
    }
    body.update(over)
    return body


def _daily_body(**item_over):
    item = {"driver_name": "JOSE", "vehicle_plate": "AAA1A11", "client_name": "Cliente Um",
            "departure_date": "2026-10-16", "daily_rate_quantity": 2, "daily_rate_value": 80}
    item.update(item_over)
    return {"items": [item]}


# ---------------- Faturas ----------------

def test_cancelled_invoice_releases_movements_and_is_final(api):
    a, b = movement(api, "ABCU1111111", 100), movement(api, "ABCU2222222", 50)
    inv = invoice(api, a["id"], b["id"])

    assert api.put(f"/api/invoices/{inv['id']}/status", params={"status": "CANCELADO"}).status_code == 200
    for mov in (a, b):
        doc = stored(api, mov["id"])
        assert doc["billed"] is False and doc.get("invoice_id") is None

    r = api.put(f"/api/invoices/{inv['id']}/status", params={"status": "PENDENTE"})
    assert r.status_code == 400 and "reaberta" in r.json()["detail"]
    r = api.put(f"/api/invoices/{inv['id']}", json={"notes": "x"})
    assert r.status_code == 400 and "cancelada" in r.json()["detail"]

    # as movimentações liberadas entram numa fatura nova
    novo = invoice(api, a["id"], b["id"])
    assert novo["total_value"] == 150


def test_deleting_cancelled_invoice_keeps_the_new_invoice_billing(api):
    a = movement(api, "ABCU1111111", 100)
    velha = invoice(api, a["id"])
    api.put(f"/api/invoices/{velha['id']}/status", params={"status": "CANCELADO"})
    nova = invoice(api, a["id"])

    assert api.delete(f"/api/invoices/{velha['id']}").status_code == 200
    doc = stored(api, a["id"])
    assert doc["billed"] is True and doc["invoice_id"] == nova["id"]


def test_movement_edit_syncs_the_active_invoice_not_the_cancelled_one(api):
    a, b = movement(api, "ABCU1111111", 100), movement(api, "ABCU2222222", 50)
    velha = invoice(api, a["id"], b["id"])
    api.put(f"/api/invoices/{velha['id']}/status", params={"status": "CANCELADO"})
    nova = invoice(api, a["id"], b["id"])

    found = api.get("/api/movements/find-for-invoice", params={"search": "ABCU1111111"}).json()
    assert found[0]["billed_invoice_number"] == nova["invoice_number"]


def test_invoice_status_filter_and_stats(api):
    a, b, c = (movement(api, n, v) for n, v in (("ABCU1111111", 100), ("ABCU2222222", 50), ("ABCU3333333", 30)))
    i1, i2, i3 = invoice(api, a["id"]), invoice(api, b["id"]), invoice(api, c["id"])
    api.put(f"/api/invoices/{i2['id']}/status", params={"status": "PAGO"})
    api.put(f"/api/invoices/{i3['id']}/status", params={"status": "CANCELADO"})
    # fatura antiga, sem o campo status, conta como pendente
    api.run(api.db.invoices.update_one({"id": i1["id"]}, {"$unset": {"status": ""}}))

    pend = api.get("/api/invoices", params={"status": "PENDENTE"}).json()
    assert [i["id"] for i in pend] == [i1["id"]]
    assert api.get("/api/invoices/count", params={"status": "PAGO"}).json() == {"count": 1}

    stats = api.get("/api/invoices/stats").json()
    assert stats["PENDENTE"] == {"count": 1, "total": 100}
    assert stats["PAGO"] == {"count": 1, "total": 50}
    assert stats["CANCELADO"] == {"count": 1, "total": 30}


def test_legacy_bill_without_invoice_route_is_gone(api):
    a = movement(api, "ABCU1111111")
    r = api.post("/api/billing/report", json={"movement_ids": [a["id"]]})
    assert r.status_code in (404, 405)
    assert stored(api, a["id"])["billed"] is False


# ---------------- Status repetido não é 404 ----------------

def test_repeating_status_is_not_not_found(api):
    intl = api.post("/api/intl-invoices", json=_intl_body()).json()
    for _ in range(2):
        assert api.put(f"/api/intl-invoices/{intl['id']}/status", params={"status": "PAGA"}).status_code == 200

    daily = api.post("/api/daily-rate-requests", json=_daily_body()).json()
    for _ in range(2):
        assert api.put(f"/api/daily-rate-requests/{daily['id']}/update-status", params={"new_status": "PAGO"}).status_code == 200

    rep = api.post("/api/expense-reports", json={"period_start": "2026-10-01", "period_end": "2026-10-15",
                                                  "deposits": [], "purchases": []}).json()
    for _ in range(2):
        assert api.put(f"/api/expense-reports/{rep['id']}/status", params={"status": "CONCLUIDA"}).status_code == 200

    assert api.put("/api/intl-invoices/nao-existe/status", params={"status": "PAGA"}).status_code == 404


# ---------------- Invoice Internacional ----------------

def test_intl_invoice_rounds_and_validates(api):
    r = api.post("/api/intl-invoices", json=_intl_body())
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["items"][0]["total"] == 0.3 and inv["total"] == 0.3

    assert api.post("/api/intl-invoices", json=_intl_body(items=[])).status_code == 400
    bad_qty = [{"description": "X", "quantity": 0, "unit_price": 10, "total": 0}]
    assert api.post("/api/intl-invoices", json=_intl_body(items=bad_qty)).status_code == 400
    bad_price = [{"description": "X", "quantity": 1, "unit_price": -5, "total": 0}]
    assert api.post("/api/intl-invoices", json=_intl_body(items=bad_price)).status_code == 400
    # validação recusada não consome número
    assert api.post("/api/intl-invoices", json=_intl_body()).json()["invoice_number"] == inv["invoice_number"] + 1


def test_cancelled_intl_invoice_is_not_editable(api):
    inv = api.post("/api/intl-invoices", json=_intl_body()).json()
    api.put(f"/api/intl-invoices/{inv['id']}/status", params={"status": "CANCELADA"})
    r = api.put(f"/api/intl-invoices/{inv['id']}", json=_intl_body(notes="x"))
    assert r.status_code == 400 and "cancelada" in r.json()["detail"]


# ---------------- Solicitação de Diária ----------------

def test_paid_daily_rate_is_locked_and_negatives_rejected(api):
    req = api.post("/api/daily-rate-requests", json=_daily_body()).json()
    assert req["total_value"] == 160

    api.put(f"/api/daily-rate-requests/{req['id']}/update-status", params={"new_status": "PAGO"})
    r = api.put(f"/api/daily-rate-requests/{req['id']}", json=_daily_body(daily_rate_value=999))
    assert r.status_code == 400 and "pendente" in r.json()["detail"].lower()

    api.put(f"/api/daily-rate-requests/{req['id']}/update-status", params={"new_status": "PENDENTE"})
    assert api.put(f"/api/daily-rate-requests/{req['id']}", json=_daily_body(daily_rate_value=90)).json()["total_value"] == 180

    assert api.post("/api/daily-rate-requests", json=_daily_body(lunch_value=-50)).status_code == 400
    assert api.post("/api/daily-rate-requests", json={"items": []}).status_code == 400


# ---------------- Prestação de Contas ----------------

def test_concluded_expense_report_locks_receipts(api):
    rep = api.post("/api/expense-reports", json={
        "period_start": "2026-10-01", "period_end": "2026-10-15", "deposits": [],
        "purchases": [{"description": "Pneu", "amount": 100, "purchase_date": "2026-10-02"}],
    })
    assert rep.status_code == 200, rep.text
    rep = rep.json()
    item_id = rep["purchases"][0]["item_id"]
    api.put(f"/api/expense-reports/{rep['id']}/status", params={"status": "CONCLUIDA"})

    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    r = api.post(f"/api/expense-reports/{rep['id']}/purchases/{item_id}/upload-receipt",
                 files={"file": ("r.png", png, "image/png")})
    assert r.status_code == 400 and "Reabra" in r.json()["detail"]
    r = api.delete(f"/api/expense-reports/{rep['id']}/purchases/{item_id}/receipt/qualquer")
    assert r.status_code == 400


# ---------------- Relatório de Faturamento ----------------

def test_billing_report_preview_and_period_validation(api):
    a, b = movement(api, "ABCU1111111", 100), movement(api, "ABCU2222222", 40.5)
    invoice(api, a["id"])

    data = api.get("/api/reports/billing/preview").json()
    assert data["total"] == 2
    s = data["stats"]
    assert (s["billed_count"], s["unbilled_count"]) == (1, 1)
    assert (s["billed_value"], s["unbilled_value"]) == (100, 40.5)

    only_unbilled = api.get("/api/reports/billing/preview", params={"billed_filter": "unbilled"}).json()
    assert [m["id"] for m in only_unbilled["items"]] == [b["id"]]

    r = api.get("/api/reports/billing/preview", params={"date_from": "2026-10-20", "date_to": "2026-10-01"})
    assert r.status_code == 400 and "data inicial" in r.json()["detail"]
    assert api.get("/api/reports/billing/pdf", params={"date_from": "2026-10-20", "date_to": "2026-10-01"}).status_code == 400
