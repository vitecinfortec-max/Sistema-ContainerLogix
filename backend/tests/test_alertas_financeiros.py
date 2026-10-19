"""Alertas financeiros no sino: cheques vencidos/vencendo/devolvidos e faturas
vencidas, só para administradores e só dos módulos contratados."""
from datetime import timedelta

from routers.checks import _today


def _seed(api):
    today = _today()
    day = lambda n: (today + timedelta(days=n)).isoformat()
    api.run(api.db.checks.insert_many([
        {"id": "c1", "status": "EMITIDO", "amount": 100, "due_date": day(-2)},
        {"id": "c2", "status": "EMITIDO", "amount": 50, "due_date": day(3)},
        {"id": "c3", "status": "EMITIDO", "amount": 70, "due_date": day(30)},   # longe: sem alerta
        {"id": "c4", "status": "DEVOLVIDO", "amount": 40, "due_date": day(-10)},
        {"id": "c5", "status": "COMPENSADO", "amount": 999, "due_date": day(-5)},
    ]))
    api.run(api.db.invoices.insert_many([
        {"id": "i1", "status": "PENDENTE", "total_value": 300, "due_date": day(-15)},
        {"id": "i2", "status": "PENDENTE", "total_value": 200, "due_date": day(-1)},
        {"id": "i3", "status": "PENDENTE", "total_value": 500},                       # sem vencimento
        {"id": "i4", "status": "PAGO", "total_value": 800, "due_date": day(-20)},
    ]))


def test_admin_sees_financial_alerts(api):
    _seed(api)
    alerts = {a["key"]: a for a in api.get("/api/alerts/summary").json()["financial"]}
    assert set(alerts) == {"checks_overdue", "checks_due_soon", "checks_returned", "invoices_overdue"}
    assert alerts["checks_overdue"]["title"] == "1 cheque vencido sem compensar"
    assert "R$ 100,00" in alerts["checks_overdue"]["description"]
    assert alerts["invoices_overdue"]["title"] == "2 faturas vencidas sem recebimento"
    assert "R$ 500,00" in alerts["invoices_overdue"]["description"] and "15 dias" in alerts["invoices_overdue"]["description"]


def test_operator_and_disabled_modules(api):
    _seed(api)
    assert api.get("/api/alerts/summary", as_user="operator").json()["financial"] == []
    api.run(api.db.module_config.insert_one({"disabled_modules": ["financeiro.controle_cheque"]}))
    keys = [a["key"] for a in api.get("/api/alerts/summary").json()["financial"]]
    assert keys == ["invoices_overdue"]


def test_freight_and_expense_alerts(api):
    today = _today()
    ts = lambda n: f"{(today - timedelta(days=n)).isoformat()}T15:00:00+00:00"
    api.run(api.db.loading_orders.insert_many([
        {"id": "o1", "order_number": 1, "order_type": "COLETA", "status": "APROVADA", "route_id": "r1", "freight_value": 100, "created_at": ts(5)},
        {"id": "o2", "order_number": 2, "order_type": "COLETA", "status": "APROVADA", "route_id": "r1", "freight_value": 100, "created_at": ts(200)},
    ]))
    api.run(api.db.expense_reports.insert_many([
        {"id": "e1", "status": "EM_ANDAMENTO", "created_at": ts(31)},
        {"id": "e2", "status": "EM_ANDAMENTO", "created_at": ts(30)},  # exatamente 30 dias: ainda não
        {"id": "e3", "status": "CONCLUIDA", "created_at": ts(90)},
    ]))
    alerts = {a["key"]: a for a in api.get("/api/alerts/summary").json()["financial"]}
    assert alerts["freight_issues"]["title"] == "1 divergência entre Ordens e Pagamento Frete"  # a ordem de 200 dias fica fora
    assert alerts["expenses_open"]["title"] == "1 prestação de contas aberta há mais de 30 dias"
