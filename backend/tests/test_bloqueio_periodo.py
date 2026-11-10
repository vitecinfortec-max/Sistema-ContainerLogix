"""Bloqueio de período financeiro (period_lock.py): com a data de fechamento
em Dados da Empresa, nada com data até esse dia é incluído, alterado ou
excluído no Financeiro, nem pelo administrador; a baixa vale pela data dela
(fatura de período fechado pode ser paga depois); reabrir o período (data
vazia) libera tudo de novo."""
from datetime import datetime, time, timedelta

from reports import BRT_TZ

TODAY = datetime.now(BRT_TZ).date()
LOCK = (TODAY - timedelta(days=10)).isoformat()


def _day(offset):
    return (TODAY + timedelta(days=offset)).isoformat()


def _stamp(offset):
    return datetime.combine(TODAY + timedelta(days=offset), time(12), BRT_TZ).isoformat()


def _close(api, day=LOCK):
    r = api.put("/api/company-settings", json={"financial_lock_date": day})
    assert r.status_code == 200, r.text
    return r


def _blocked(response):
    assert response.status_code == 400, response.text
    assert "Período financeiro fechado" in response.json()["detail"]


def _invoice(api, number, issued_offset, status="PENDENTE", paid_offset=None):
    api.run(api.db.invoices.insert_one({
        "id": f"inv-{number}", "invoice_number": number, "client_name": "Cliente Um", "movement_ids": [],
        "total_value": 100, "status": status, "created_at": _stamp(issued_offset), "created_by": "admin-1",
        "user_name": "Admin Teste", "due_date": None,
        "paid_date": _day(paid_offset) if paid_offset is not None else None,
    }))
    return f"inv-{number}"


def _check(**over):
    body = {"check_number": "000123", "bank": "Itaú", "payee": "Fornecedor Um", "amount": 100,
            "issue_date": _day(0), "due_date": _day(0)}
    body.update(over)
    return body


def test_lock_date_setting(api):
    assert _close(api).json()["financial_lock_date"] == LOCK
    assert api.put("/api/company-settings", json={"financial_lock_date": "31/10/2026"}).status_code == 400
    assert api.put("/api/company-settings", json={"financial_lock_date": LOCK}, as_user="operator").status_code == 403
    assert api.put("/api/company-settings", json={"financial_lock_date": ""}).json()["financial_lock_date"] is None


def test_invoice_in_closed_period(api):
    old = _invoice(api, 1, issued_offset=-20)
    paid_old = _invoice(api, 2, issued_offset=-30, status="PAGO", paid_offset=-25)
    _close(api)

    _blocked(api.put(f"/api/invoices/{old}", json={"observations": "x"}))
    _blocked(api.delete(f"/api/invoices/{old}"))
    _blocked(api.put(f"/api/invoices/{old}/status", params={"status": "CANCELADO"}))
    _blocked(api.put(f"/api/invoices/{old}/status", params={"status": "PAGO", "paid_date": _day(-15)}))
    # emitida em período fechado, paga hoje: a baixa é do período aberto
    assert api.put(f"/api/invoices/{old}/status", params={"status": "PAGO"}).status_code == 200
    # desfazer um recebimento de período fechado não pode
    _blocked(api.put(f"/api/invoices/{paid_old}/status", params={"status": "PENDENTE"}))

    _close(api, "")  # reaberto
    assert api.put(f"/api/invoices/{paid_old}/status", params={"status": "PENDENTE"}).status_code == 200


def test_checks(api):
    _close(api)
    _blocked(api.post("/api/checks", json=_check(issue_date=_day(-11), due_date=_day(5))))
    check = api.post("/api/checks", json=_check()).json()
    _blocked(api.put(f"/api/checks/{check['id']}", json=_check(issue_date=_day(-12))))
    # emitido em período fechado: compensar com data fechada não, hoje sim
    api.run(api.db.checks.insert_one({**_check(check_number="000999", issue_date=_day(-20), due_date=_day(-15)),
                                      "id": "ck-old", "status": "EMITIDO", "history": [], "photos": [],
                                      "created_by": "admin-1", "created_by_name": "Admin Teste", "created_at": _stamp(-20)}))
    _blocked(api.put("/api/checks/ck-old/status", json={"status": "COMPENSADO", "compensation_date": _day(-11)}))
    _blocked(api.put("/api/checks/ck-old/status", json={"status": "CANCELADO"}))
    _blocked(api.delete("/api/checks/ck-old"))
    assert api.put("/api/checks/ck-old/status", json={"status": "COMPENSADO", "compensation_date": _day(0)}).status_code == 200
    # desfazer a compensação de hoje mexe só no período aberto
    assert api.put("/api/checks/ck-old/status", json={"status": "EMITIDO"}).status_code == 200
    assert check["status"] == "EMITIDO"


def test_other_financial_records(api):
    api.run(api.db.daily_rate_requests.insert_one({
        "id": "d1", "request_number": 1, "items": [], "total_value": 10, "status": "PENDENTE", "created_at": _stamp(-20)}))
    api.run(api.db.intl_invoices.insert_one({
        "id": "x1", "invoice_number": 1, "issue_date": _day(-20), "due_date": _day(0), "status": "EMITIDA", "items": []}))
    api.run(api.db.expense_reports.insert_one({
        "id": "e1", "report_number": 1, "period_start": _day(-40), "period_end": _day(-12), "status": "CONCLUIDA",
        "deposits": [], "purchases": [], "balance": 0}))
    api.run(api.db.clients.insert_one({"id": "c1", "name": "Cliente Um"}))
    _close(api)

    _blocked(api.delete("/api/daily-rate-requests/d1"))
    _blocked(api.delete("/api/intl-invoices/x1"))
    _blocked(api.put("/api/intl-invoices/x1/status", params={"status": "CANCELADA"}))
    assert api.put("/api/intl-invoices/x1/status", params={"status": "PAGA"}).status_code == 200
    _blocked(api.put("/api/expense-reports/e1/status", params={"status": "EM_ANDAMENTO"}))
    _blocked(api.delete("/api/expense-reports/e1"))
    _blocked(api.post("/api/client-credits/entries", json={"client_id": "c1", "amount": 50, "entry_date": _day(-11)}))
    assert api.post("/api/client-credits/entries", json={"client_id": "c1", "amount": 50, "entry_date": _day(0)}).status_code == 200


def test_no_lock_by_default(api):
    old = _invoice(api, 3, issued_offset=-400)
    assert api.delete(f"/api/invoices/{old}").status_code == 200
