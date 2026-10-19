"""Filtro por período (dia de Brasília) nas listas paginadas no servidor e a
busca da Auditoria de Container feita no banco."""
import pytest

PERIOD = {"date_from": "2026-10-01", "date_to": "2026-10-31"}
# 01/11 às 01:00 UTC ainda é 31/10 em Brasília; 01/10 às 02:00 UTC é 30/09
DATES = ["2026-10-10T15:00:00+00:00", "2026-11-01T01:00:00+00:00", "2026-10-01T02:00:00+00:00", "2026-11-05T15:00:00+00:00"]


def _seed(api, collection, extra=lambda i: {}):
    api.run(api.db[collection].insert_many([{"id": f"{collection}-{i}", "created_at": d, **extra(i)} for i, d in enumerate(DATES)]))


def _count(response, key):
    data = response.json()
    return len(data) if isinstance(data, list) else data[key]


@pytest.mark.parametrize("path,collection,key,extra", [
    ("/api/container-audits", "container_audits", "total", lambda i: {"audit_code": f"A{i}", "client_name": "C", "audit_seq": i}),
    ("/api/daily-rate-requests", "daily_rate_requests", "total", lambda i: {"request_number": i, "items": []}),
    ("/api/unit-segregations", "unit_segregations", "total", lambda i: {"items": []}),
    ("/api/intl-invoices", "intl_invoices", "total", lambda i: {}),
    ("/api/expense-reports", "expense_reports", "total", lambda i: {"deposits": [], "purchases": []}),
    ("/api/vehicle-checklists", "vehicle_checklists", "total", lambda i: {"checklist_number": i}),
])
def test_period_filter(api, path, collection, key, extra):
    _seed(api, collection, extra)
    assert _count(api.get(path), key) == 4
    assert _count(api.get(path, params=PERIOD), key) == 2
    assert _count(api.get(path, params={"date_from": "2026-11-01"}), key) == 1
    assert api.get(path, params={"date_to": "31/10/2026"}).status_code == 400


def test_delivery_status_uses_status_date(api):
    days = ["2026-10-01", "2026-10-31", "2026-09-30", "2026-11-01"]
    api.run(api.db.delivery_statuses.insert_many([{"id": f"d{i}", "status_number": i, "status": "ATIVO", "items": [],
                                                   "status_date": d, "created_at": "2026-12-01T12:00:00+00:00"} for i, d in enumerate(days)]))
    assert api.get("/api/delivery-status", params=PERIOD).json()["total"] == 2
    assert api.get("/api/delivery-status", params={"date_to": "2026-09-30"}).json()["total"] == 1


def test_invoices_list_and_count(api):
    _seed(api, "invoices", lambda i: {"invoice_number": i, "client_name": "C", "status": "PENDENTE", "total_value": 1})
    assert api.get("/api/invoices/count", params=PERIOD).json()["count"] == 2
    assert api.get("/api/invoices/count", params={**PERIOD, "status": "PAGO"}).json()["count"] == 0


def test_container_audit_search_runs_on_database(api):
    _seed(api, "container_audits", lambda i: {"audit_code": f"2026{i}", "client_name": f"CLIENTE {i}", "audit_seq": i,
                                              "status": "CONCLUIDA" if i else "EM_ANDAMENTO",
                                              "items": [{"container_number": f"ABCU{i}"}]})
    get = lambda **p: api.get("/api/container-audits", params={"per_page": 1, **p}).json()["total"]
    assert get(search="cliente 3") == 1
    assert get(search="abcu2") == 1
    assert get(status="CONCLUIDA") == 3
