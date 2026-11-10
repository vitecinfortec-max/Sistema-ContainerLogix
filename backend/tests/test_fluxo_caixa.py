"""Fluxo de Caixa: saldo informado + realizado (mesmas linhas do Resumo
Financeiro) + previsto pelo vencimento (atrasado entra hoje); o que não tem
vencimento fica à parte, fora do saldo."""
from datetime import timedelta

import routers.cash_flow as cash_flow


def _d(n: int) -> str:
    return (cash_flow._today() + timedelta(days=n)).isoformat()


def _seed(api):
    db = api.db
    api.run(db.invoices.insert_many([
        {"id": "i1", "invoice_number": 10, "client_name": "Cliente Pago", "total_value": 500, "status": "PAGO", "paid_date": _d(-5), "due_date": _d(-6)},
        {"id": "i2", "invoice_number": 11, "client_name": "Cliente Futuro", "total_value": 300, "status": "PENDENTE", "due_date": _d(5)},
        {"id": "i3", "invoice_number": 12, "client_name": "Cliente Atrasado", "total_value": 100, "status": "PENDENTE", "due_date": _d(-2)},
        {"id": "i4", "invoice_number": 13, "client_name": "Sem Vencimento", "total_value": 70, "status": "PENDENTE"},
    ]))
    api.run(db.payables.insert_many([
        {"id": "p1", "payable_number": 1, "installment": 1, "installments_total": 1, "supplier_name": "Posto", "description": "Diesel",
         "status": "PAGO", "amount": 200, "paid_amount": 200, "paid_date": _d(-3), "due_date": _d(-3), "issue_date": _d(-10)},
        {"id": "p2", "payable_number": 2, "installment": 1, "installments_total": 2, "supplier_name": "Pneus SA", "description": "Pneus",
         "status": "ABERTO", "amount": 400, "due_date": _d(2), "issue_date": _d(-1)},
    ]))
    api.run(db.checks.insert_one({"id": "c1", "check_number": "000123", "payee": "Oficina", "amount": 50, "status": "EMITIDO",
                                  "issue_date": _d(-1), "due_date": _d(1), "bank": "001"}))
    api.run(db.freight_payments.insert_one({"id": "f1", "status": "PENDENTE", "freight_value": 80}))


def test_balance_realized_and_forecast(api):
    _seed(api)
    assert api.put("/api/cash-flow/settings", json={"opening_date": _d(1), "opening_balance": 1}).status_code == 400  # futura
    assert api.put("/api/cash-flow/settings", json={"opening_date": _d(-10), "opening_balance": 1000}, as_user="operator").status_code == 403
    api.put("/api/cash-flow/settings", json={"opening_date": _d(-10), "opening_balance": 1000})

    data = api.get("/api/cash-flow", params={"date_from": _d(-7), "date_to": _d(7)}).json()
    s = data["summary"]
    assert s["opening_balance"] == 1000
    assert s["balance_today"] == 1300  # +500 fatura recebida, -200 conta paga
    assert s["realized_in"] == 500 and s["realized_out"] == 200
    assert s["forecast_in"] == 400 and s["forecast_out"] == 450  # 300 + 100 atrasada / 400 conta + 50 cheque
    assert s["overdue_in"] == 100 and s["overdue_out"] == 0
    assert s["closing_balance"] == 1250
    assert s["lowest_balance"] == 950 and s["lowest_balance_date"] == _d(2)

    by_day = {r["start"]: r for r in data["rows"]}
    assert len(data["rows"]) == 15
    assert by_day[_d(0)]["forecast_in"] == 100 and by_day[_d(0)]["balance_end"] == 1400  # a atrasada entra hoje
    assert by_day[_d(2)]["forecast_out"] == 400 and by_day[_d(2)]["balance_end"] == 950
    assert by_day[_d(-3)]["realized_out"] == 200 and by_day[_d(-3)]["projected"] is False

    overdue = [e for e in data["events"] if e["overdue"]]
    assert overdue[0]["description"] == "Nº 12 · Cliente Atrasado" and overdue[0]["date"] == _d(0)
    assert any(e["source"] == "Contas a Pagar" and e["description"].startswith("Nº 2 - 1/2") for e in data["events"])

    undated = data["undated"]
    assert undated["receivable"] == [{"label": "Faturas em aberto sem vencimento", "count": 1, "total": 70}]
    assert {"label": "Fretes a pagar", "count": 1, "total": 80} in undated["payable"]
    assert all(u["label"] != "Cheques emitidos a compensar" for u in undated["payable"])  # já no previsto

    # Saldo no começo de outros períodos (antes e depois da data informada)
    assert api.get("/api/cash-flow", params={"date_from": _d(-2), "date_to": _d(0)}).json()["summary"]["opening_balance"] == 1300
    assert api.get("/api/cash-flow", params={"date_from": _d(-12), "date_to": _d(-11)}).json()["summary"]["opening_balance"] == 1000

    # Agrupado por semana e mês: os totais não mudam
    for group in ("week", "month"):
        g = api.get("/api/cash-flow", params={"date_from": _d(-7), "date_to": _d(7), "group": group}).json()
        assert g["summary"]["closing_balance"] == 1250 and sum(r["forecast_out"] for r in g["rows"]) == 450


def test_without_balance_validation_and_files(api):
    _seed(api)
    data = api.get("/api/cash-flow", params={"date_from": _d(-3), "date_to": _d(3)}).json()
    assert data["summary"]["has_balance"] is False and data["summary"]["closing_balance"] is None
    assert data["summary"]["forecast_out"] == 450  # o fluxo aparece mesmo sem saldo
    assert api.get("/api/cash-flow", params={"date_from": _d(3), "date_to": _d(-3)}).status_code == 400
    assert api.get("/api/cash-flow", params={"date_from": _d(0), "date_to": _d(500)}).status_code == 400
    assert api.get("/api/cash-flow", params={"date_from": _d(0), "date_to": _d(1), "group": "ano"}).status_code == 400
    assert api.get("/api/cash-flow", params={"date_from": _d(0), "date_to": _d(1)}, as_user="operator").status_code == 403
    pdf = api.get("/api/cash-flow/pdf", params={"date_from": _d(-3), "date_to": _d(3)})
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    assert api.get("/api/cash-flow/excel", params={"date_from": _d(-3), "date_to": _d(3), "group": "week"}).status_code == 200


def test_disabled_modules(api):
    import shared
    _seed(api)
    api.run(api.db.module_config.insert_one({"disabled_modules": ["financeiro.contas_pagar"]}))
    shared.invalidate_module_config_cache()
    data = api.get("/api/cash-flow", params={"date_from": _d(-7), "date_to": _d(7)}).json()
    assert data["summary"]["forecast_out"] == 50 and data["summary"]["realized_out"] == 0  # sem Contas a Pagar
    api.run(api.db.module_config.update_one({}, {"$set": {"disabled_modules": ["financeiro.fluxo_caixa"]}}))
    shared.invalidate_module_config_cache()
    assert api.get("/api/cash-flow", params={"date_from": _d(0), "date_to": _d(1)}).status_code == 403
