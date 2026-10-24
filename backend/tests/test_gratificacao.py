"""Financeiro - Controle de Gratificação: funções padrão já cadastradas,
lançamento para Motorista ou Funcionário, pagamento, estorno, travas de
edição/exclusão, recibo só de gratificações pagas de uma mesma pessoa e o
relatório do período."""
from models import DEFAULT_GRATIFICATION_ROLES


def _people(api):
    driver = api.post("/api/drivers", json={"name": "Zé Motorista", "cpf": "111.222.333-44"}).json()
    employee = api.post("/api/employees", json={"name": "Ana Frentista", "cpf": "555.666.777-88", "position": "Frentista"}).json()
    return driver, employee


def _create(api, person, person_type="MOTORISTA", **over):
    body = {"person_type": person_type, "person_id": person["id"], "role": "Motorista",
            "reference_date": "2026-10-10", "amount": 250, "description": "Meta de outubro"}
    body.update(over)
    r = api.post("/api/gratifications", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _pay(api, *items, day="2026-10-20"):
    r = api.post("/api/gratifications/pay", json={"ids": [g["id"] for g in items], "payment_date": day, "payment_method": "PIX"})
    assert r.status_code == 200, r.text


def test_default_roles_come_preloaded_and_cannot_be_deleted(api):
    roles = api.get("/api/gratification-roles").json()
    assert {r["name"] for r in roles} == set(DEFAULT_GRATIFICATION_ROLES)
    assert len(api.get("/api/gratification-roles").json()) == len(DEFAULT_GRATIFICATION_ROLES)  # não duplica
    default = roles[0]
    r = api.delete(f"/api/gratification-roles/{default['id']}")
    assert r.status_code == 400

    created = api.post("/api/gratification-roles", json={"name": "Soldador"}).json()
    assert created["is_default"] is False
    assert api.post("/api/gratification-roles", json={"name": "soldador"}).status_code == 400
    assert api.delete(f"/api/gratification-roles/{created['id']}").status_code == 200


def test_role_in_use_cannot_be_deleted(api):
    driver, _ = _people(api)
    role = api.post("/api/gratification-roles", json={"name": "Lavador"}).json()
    _create(api, driver, role="lavador")
    assert api.delete(f"/api/gratification-roles/{role['id']}").status_code == 400


def test_create_validates_person_role_and_amount(api):
    driver, employee = _people(api)
    g = _create(api, employee, "FUNCIONARIO", role="frentista")
    assert g["status"] == "PENDENTE" and g["role"] == "Frentista"
    assert g["person_name"] == "Ana Frentista" and g["person_cpf"] == "555.666.777-88"
    second = _create(api, driver)
    assert second["gratification_number"] == g["gratification_number"] + 1

    base = {"person_type": "MOTORISTA", "person_id": driver["id"], "role": "Motorista", "reference_date": "2026-10-10", "amount": 100}
    assert api.post("/api/gratifications", json={**base, "amount": 0}).status_code == 400
    assert api.post("/api/gratifications", json={**base, "role": "Astronauta"}).status_code == 400
    assert api.post("/api/gratifications", json={**base, "person_id": "nao-existe"}).status_code == 404
    assert api.post("/api/gratifications", json={**base, "person_type": "FUNCIONARIO"}).status_code == 404
    assert api.post("/api/gratifications", json={**base, "reference_date": "10/10/2026"}).status_code == 400


def test_pay_locks_edit_delete_and_cancel_until_reversed(api):
    driver, _ = _people(api)
    g = _create(api, driver)
    _pay(api, g)
    paid = api.get("/api/gratifications", params={"status": "PAGO"}).json()
    assert [x["id"] for x in paid] == [g["id"]]
    assert paid[0]["payment_date"] == "2026-10-20" and paid[0]["payment_method"] == "PIX"

    body = {"person_type": "MOTORISTA", "person_id": driver["id"], "role": "Motorista", "reference_date": "2026-10-10", "amount": 999}
    assert api.put(f"/api/gratifications/{g['id']}", json=body).status_code == 400
    assert api.delete(f"/api/gratifications/{g['id']}").status_code == 400
    assert api.put(f"/api/gratifications/{g['id']}/status", params={"status": "CANCELADO"}).status_code == 400
    r = api.post("/api/gratifications/pay", json={"ids": [g["id"]], "payment_date": "2026-10-21"})
    assert r.status_code == 400  # já paga

    assert api.put(f"/api/gratifications/{g['id']}/status", params={"status": "PENDENTE"}).status_code == 200
    back = api.get("/api/gratifications").json()[0]
    assert back["status"] == "PENDENTE" and back["payment_date"] is None
    assert api.put(f"/api/gratifications/{g['id']}", json=body).json()["amount"] == 999
    assert api.delete(f"/api/gratifications/{g['id']}").status_code == 200


def test_receipt_only_for_paid_gratifications_of_one_person(api):
    driver, employee = _people(api)
    a = _create(api, driver, amount=100)
    b = _create(api, driver, amount=150.5, reference_date="2026-10-15")
    c = _create(api, employee, "FUNCIONARIO", role="Frentista")

    r = api.get("/api/gratifications/receipt/pdf", params={"ids": a["id"]})
    assert r.status_code == 400 and "Pagas" in r.json()["detail"]

    _pay(api, a, b, c)
    r = api.get("/api/gratifications/receipt/pdf", params={"ids": f"{a['id']},{c['id']}"})
    assert r.status_code == 400 and "única pessoa" in r.json()["detail"]

    r = api.get("/api/gratifications/receipt/pdf", params={"ids": f"{a['id']},{b['id']}"})
    assert r.status_code == 200
    assert r.content.startswith(b"%PDF")
    assert api.get("/api/gratifications/receipt/pdf", params={"ids": c["id"]}).status_code == 200


def test_period_report_by_person_and_role(api):
    driver, employee = _people(api)
    a = _create(api, driver, amount=100)
    _create(api, driver, amount=50, reference_date="2026-10-12")
    _create(api, employee, "FUNCIONARIO", role="Frentista", amount=80)
    cancelled = _create(api, employee, "FUNCIONARIO", role="Frentista", amount=999)
    api.put(f"/api/gratifications/{cancelled['id']}/status", params={"status": "CANCELADO"})
    _create(api, driver, amount=70, reference_date="2026-09-30")  # fora do período
    _pay(api, a)

    params = {"date_from": "2026-10-01", "date_to": "2026-10-31"}
    data = api.get("/api/reports/gratifications", params=params).json()
    assert data["summary"] == {"count": 3, "paid": 100, "pending": 130, "total": 230, "people": 2}
    by_person = {p["person_name"]: p for p in data["people"]}
    assert by_person["Zé Motorista"]["paid"] == 100 and by_person["Zé Motorista"]["pending"] == 50
    assert {r["role"]: r["total"] for r in data["roles"]} == {"Motorista": 150, "Frentista": 80}

    by_payment = api.get("/api/reports/gratifications", params={**params, "period_by": "payment"}).json()
    assert by_payment["summary"]["count"] == 1
    only_role = api.get("/api/reports/gratifications", params={**params, "role": "frentista"}).json()
    assert only_role["summary"]["total"] == 80

    assert api.get("/api/reports/gratifications/pdf", params=params).content.startswith(b"%PDF")
    assert api.get("/api/reports/gratifications/excel", params=params).status_code == 200


def test_person_with_gratification_cannot_be_deleted(api):
    driver, employee = _people(api)
    _create(api, driver)
    _create(api, employee, "FUNCIONARIO", role="Frentista")
    assert api.delete(f"/api/drivers/{driver['id']}").status_code == 400
    assert api.delete(f"/api/employees/{employee['id']}").status_code == 400
