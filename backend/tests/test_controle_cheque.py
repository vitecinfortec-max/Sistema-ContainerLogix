"""Financeiro - Controle de Cheque: validações do cadastro, folha repetida,
travas de edição/exclusão, ciclo de status (compensado, devolvido,
cancelado), filtro de vencidos, indicadores e o relatório em PDF."""
from datetime import timedelta

from routers.checks import _today


def _day(offset=0):
    return (_today() + timedelta(days=offset)).isoformat()


def _body(**over):
    body = {"check_number": "000123", "bank": "Banco do Brasil", "agency": "1234", "account": "56789-0",
            "payee": "Fornecedor Um", "amount": 1500.5, "issue_date": _day(-5), "due_date": _day(10),
            "description": "NF 987"}
    body.update(over)
    return body


def _create(api, **over):
    r = api.post("/api/checks", json=_body(**over))
    assert r.status_code == 200, r.text
    return r.json()


def test_create_starts_issued_with_history(api):
    check = _create(api)
    assert check["status"] == "EMITIDO"
    assert check["amount"] == 1500.5
    assert [h["status"] for h in check["history"]] == ["EMITIDO"]
    assert api.get(f"/api/checks/{check['id']}").json()["payee"] == "Fornecedor Um"


def test_invalid_values_are_rejected(api):
    assert api.post("/api/checks", json=_body(amount=0)).status_code == 400
    assert api.post("/api/checks", json=_body(amount=-10)).status_code == 400
    assert api.post("/api/checks", json=_body(payee="  ")).status_code == 400
    assert api.post("/api/checks", json=_body(check_number="")).status_code == 400
    assert api.post("/api/checks", json=_body(due_date="31/12/2026")).status_code == 400
    r = api.post("/api/checks", json=_body(issue_date=_day(0), due_date=_day(-1)))
    assert r.status_code == 400 and "vencimento" in r.json()["detail"]


def test_same_sheet_cannot_be_registered_twice(api):
    first = _create(api)
    r = api.post("/api/checks", json=_body(bank="BANCO DO BRASIL"))
    assert r.status_code == 400 and "já está cadastrado" in r.json()["detail"]
    # outra conta ou outro número pode
    _create(api, account="11111-1")
    other = _create(api, check_number="000124")
    # editar sem trocar o número não acusa a si mesmo; trocar para um existente acusa
    assert api.put(f"/api/checks/{first['id']}", json=_body(amount=99)).status_code == 200
    assert api.put(f"/api/checks/{other['id']}", json=_body()).status_code == 400


def test_compensation_locks_edit_and_delete(api):
    check = _create(api)
    r = api.put(f"/api/checks/{check['id']}/status", json={"status": "COMPENSADO"})
    assert r.status_code == 400  # sem data de compensação
    r = api.put(f"/api/checks/{check['id']}/status", json={"status": "COMPENSADO", "compensation_date": _day(1)})
    assert r.status_code == 400 and "futuro" in r.json()["detail"]
    r = api.put(f"/api/checks/{check['id']}/status", json={"status": "COMPENSADO", "compensation_date": _day(-6)})
    assert r.status_code == 400 and "emissão" in r.json()["detail"]

    r = api.put(f"/api/checks/{check['id']}/status", json={"status": "COMPENSADO", "compensation_date": _day(0)})
    assert r.status_code == 200 and r.json()["compensation_date"] == _day(0)

    assert api.put(f"/api/checks/{check['id']}", json=_body(amount=1)).status_code == 400
    assert api.delete(f"/api/checks/{check['id']}").status_code == 400
    r = api.put(f"/api/checks/{check['id']}/status", json={"status": "CANCELADO"})
    assert r.status_code == 400

    # engano: volta para Emitido, limpa a compensação e libera a edição
    back = api.put(f"/api/checks/{check['id']}/status", json={"status": "EMITIDO"}).json()
    assert back["compensation_date"] is None
    assert [h["status"] for h in back["history"]] == ["EMITIDO", "COMPENSADO", "EMITIDO"]
    assert api.put(f"/api/checks/{check['id']}", json=_body(amount=1)).status_code == 200


def test_returned_needs_reason_and_can_be_compensated_later(api):
    check = _create(api)
    assert api.put(f"/api/checks/{check['id']}/status", json={"status": "DEVOLVIDO"}).status_code == 400
    r = api.put(f"/api/checks/{check['id']}/status", json={"status": "DEVOLVIDO", "return_reason": "Alínea 11"})
    assert r.status_code == 200 and r.json()["return_reason"] == "Alínea 11"
    assert api.delete(f"/api/checks/{check['id']}").status_code == 400
    r = api.put(f"/api/checks/{check['id']}/status", json={"status": "COMPENSADO", "compensation_date": _day(0)})
    assert r.status_code == 200 and r.json()["return_reason"] is None


def test_cancelled_can_be_deleted(api):
    check = _create(api)
    assert api.put(f"/api/checks/{check['id']}/status", json={"status": "CANCELADO"}).status_code == 200
    assert api.delete(f"/api/checks/{check['id']}").status_code == 200
    assert api.get(f"/api/checks/{check['id']}").status_code == 404


def test_filters_overdue_and_summary(api):
    _create(api, check_number="1", amount=100, issue_date=_day(-20), due_date=_day(-2))   # vencido
    _create(api, check_number="2", amount=200, due_date=_day(3))                         # vence em breve
    _create(api, check_number="3", amount=300, due_date=_day(30))                        # em aberto
    returned = _create(api, check_number="4", amount=400)
    api.put(f"/api/checks/{returned['id']}/status", json={"status": "DEVOLVIDO", "return_reason": "Sem fundos"})

    overdue = api.get("/api/checks", params={"status": "VENCIDO"}).json()
    assert [c["check_number"] for c in overdue["items"]] == ["1"]
    period = api.get("/api/checks", params={"date_from": _day(0), "date_to": _day(15)}).json()
    assert sorted(c["check_number"] for c in period["items"]) == ["2", "4"]
    assert api.get("/api/checks", params={"search": "nf 987"}).json()["total"] == 4
    assert api.get("/api/checks", params={"status": "XPTO"}).status_code == 422

    s = api.get("/api/checks/summary").json()
    assert s["open"] == {"count": 3, "total": 600}
    assert s["overdue"] == {"count": 1, "total": 100}
    assert s["due_soon"] == {"count": 1, "total": 200}
    assert s["returned"] == {"count": 1, "total": 400}
    assert s["default_account"] == {"bank": "Banco do Brasil", "agency": "1234", "account": "56789-0",
                                    "source": "last_check", "last_check_number": "4"}


def test_pdf_report_and_admin_only(api):
    _create(api)
    r = api.get("/api/checks/report/pdf", params={"status": "EMITIDO"})
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
    assert api.get("/api/checks/report/pdf", params={"status": "COMPENSADO"}).content[:4] == b"%PDF"
    assert api.get("/api/checks", as_user="operator").status_code == 403
    assert api.post("/api/checks", json=_body(check_number="9"), as_user="operator").status_code == 403


def test_default_account_comes_from_company_bank_details(api):
    assert api.get("/api/checks/summary").json()["default_account"] is None
    company = {"name": "Empresa", "bank_name": "Itaú", "bank_agency": "0001", "bank_account": "12345-6"}
    assert api.put("/api/company-settings", json=company).status_code == 200
    s = api.get("/api/checks/summary").json()
    assert s["default_account"] == {"bank": "Itaú", "agency": "0001", "account": "12345-6",
                                    "source": "company", "last_check_number": None}
    # a última folha é a da conta da empresa, não a do último cheque de outra conta
    _create(api, check_number="000050", bank="ITAÚ", agency="0001", account="12345-6")
    _create(api, check_number="900", bank="Bradesco", agency="9", account="9")
    assert api.get("/api/checks/summary").json()["default_account"]["last_check_number"] == "000050"
