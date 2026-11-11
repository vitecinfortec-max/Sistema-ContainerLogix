"""Contas a Receber: títulos avulsos (parcelas, baixa, estorno, cancelamento,
exclusão), o painel que junta Faturas, Faturamento Portuário, Venda de
Container e títulos, conta/centro de custo nas Faturas, alertas do sino,
Resumo Financeiro e Fluxo de Caixa."""
from datetime import datetime, time, timedelta

import shared
from reports import BRT_TZ

TODAY = datetime.now(BRT_TZ).date()


def _day(n: int) -> str:
    return (TODAY + timedelta(days=n)).isoformat()


def _stamp(n: int) -> str:
    return datetime.combine(TODAY + timedelta(days=n), time(12), BRT_TZ).isoformat()


def _body(**over):
    body = {
        "description": "Aluguel de área do pátio", "client_name": "Locatário Exemplo", "issue_date": _day(-5),
        "recurrence": "UNICA", "installments": [{"due_date": _day(-1), "amount": 1500}],
    }
    body.update(over)
    return body


def _receita(api):
    return {a["code"]: a for a in api.get("/api/chart-accounts").json()}["1.02"]


def test_titles_lifecycle(api):
    assert api.post("/api/receivable-titles", json=_body(client_name="")).status_code == 400
    assert api.post("/api/receivable-titles", json=_body(), as_user="operator").status_code == 403

    account = _receita(api)
    center = api.get("/api/cost-centers").json()[0]
    api.run(api.db.clients.insert_one({"id": "cli-1", "name": "Cliente Cadastrado"}))
    parcels = api.post("/api/receivable-titles", json=_body(
        client_id="cli-1", client_name="ignorado", recurrence="PARCELADA", account_id=account["id"], cost_center_id=center["id"],
        installments=[{"due_date": _day(10), "amount": 100}, {"due_date": _day(40), "amount": 100}],
    )).json()
    assert [p["installment"] for p in parcels] == [1, 2] and parcels[0]["client_name"] == "Cliente Cadastrado"
    assert parcels[0]["account_name"] == "1.02 Receita de armazenagem" and parcels[0]["receivable_number"] == 1
    single = api.post("/api/receivable-titles", json=_body()).json()[0]
    assert single["receivable_number"] == 2

    listed = api.get("/api/receivable-titles", params={"status": "VENCIDO"}).json()
    assert [i["id"] for i in listed["items"]] == [single["id"]] and listed["items"][0]["overdue"] is True
    assert api.get("/api/receivable-titles", params={"search": "1"}).json()["total"] == 2  # pelo número

    # baixa: juros só com um título; data futura recusada
    assert api.post("/api/receivable-titles/receive", json={"ids": [p["id"] for p in parcels], "paid_date": _day(0),
                                                            "payment_method": "PIX", "interest": 5}).status_code == 400
    assert api.post("/api/receivable-titles/receive", json={"ids": [single["id"]], "paid_date": _day(1),
                                                            "payment_method": "PIX"}).status_code == 400
    r = api.post("/api/receivable-titles/receive", json={"ids": [single["id"]], "paid_date": _day(0), "payment_method": "PIX",
                                                         "interest": 30, "discount": 10})
    assert r.json() == {"received": 1}
    got = api.get(f"/api/receivable-titles/{single['id']}").json()
    assert got["status"] == "RECEBIDO" and got["paid_amount"] == 1520 and got["label"] == "Nº 2"

    # recebido não altera nem exclui; estornar reabre
    assert api.put(f"/api/receivable-titles/{single['id']}", json={**_body(), "due_date": _day(3), "amount": 1}).status_code == 400
    assert api.delete(f"/api/receivable-titles/{single['id']}").status_code == 400
    assert api.post(f"/api/receivable-titles/{single['id']}/unreceive").json()["status"] == "ABERTO"

    edited = api.put(f"/api/receivable-titles/{single['id']}", json={**_body(description="Aluguel corrigido"),
                                                                     "due_date": _day(3), "amount": 1600}).json()
    assert edited["amount"] == 1600 and edited["description"] == "Aluguel corrigido"
    assert api.post(f"/api/receivable-titles/{single['id']}/cancel", json={"cancelled": True}).json()["status"] == "CANCELADO"
    assert api.post(f"/api/receivable-titles/{single['id']}/cancel", json={"cancelled": False}).json()["status"] == "ABERTO"

    # conta em uso por título não pode ser excluída
    r = api.delete(f"/api/chart-accounts/{account['id']}")
    assert r.status_code == 400 and "contas a receber" in r.json()["detail"]
    assert api.delete(f"/api/receivable-titles/{parcels[0]['id']}", params={"whole_group": True}).json() == {"deleted": 2}
    assert api.get("/api/receivable-titles").json()["total"] == 1


def test_panel_merges_sources(api):
    api.run(api.db.invoices.insert_many([
        {"id": "inv-1", "invoice_number": 7, "client_name": "Alfa", "movement_ids": [], "total_value": 300, "status": "PENDENTE",
         "created_at": _stamp(-40), "due_date": _day(-10), "user_name": "Admin", "created_by": "admin-1"},
        {"id": "inv-2", "invoice_number": 8, "client_name": "Alfa", "movement_ids": [], "total_value": 50, "status": "PAGO",
         "created_at": _stamp(-20), "paid_date": _day(-15), "user_name": "Admin", "created_by": "admin-1"},
    ]))
    api.run(api.db.port_service_billing_batches.insert_one({
        "id": "pb-1", "batch_number": 3, "client_id": "c", "client_name": "Beta Portos", "service_ids": [], "total_value": 500,
        "discount_value": 100, "net_total": 400, "status": "PENDENTE", "created_at": _stamp(-70),
    }))
    api.run(api.db.container_sales.insert_many([
        {"id": "cs-1", "container_number": "ABCU1234567", "representative_name": "Gama Containers", "sale_value": 9000,
         "received_value": 1000, "status": "PENDENTE", "created_at": _stamp(-5)},
        {"id": "cs-2", "container_number": "ABCU7654321", "sale_value": None, "status": "PENDENTE", "created_at": _stamp(-5)},
    ]))
    title = api.post("/api/receivable-titles", json=_body(client_name="Alfa", installments=[{"due_date": _day(5), "amount": 250}])).json()[0]

    data = api.get("/api/reports/receivables").json()
    by_source = {}
    for row in data["rows"]:
        by_source.setdefault(row["source"], []).append(row)
    assert set(by_source) == {"FATURA", "PORTUARIO", "VENDA", "TITULO"}
    assert len(by_source["VENDA"]) == 1  # venda sem valor combinado fica de fora
    assert by_source["VENDA"][0]["open_value"] == 8000 and by_source["VENDA"][0]["aging_from_issue"] is True
    assert by_source["PORTUARIO"][0]["open_value"] == 400 and by_source["PORTUARIO"][0]["aging"] == "d61_90"
    assert by_source["TITULO"][0]["number_label"] == "Nº 1" and by_source["TITULO"][0]["aging"] == "current"

    s = data["summary"]
    assert s["open_total"] == 300 + 400 + 8000 + 250 and s["paid_total"] == 50
    assert s["overdue_total"] == 300 + 400 + 8000  # fatura vencida há 10 dias, portuário e venda contam da emissão
    alfa = {c["client_name"]: c for c in data["clients"]}["Alfa"]
    assert alfa["open"] == 550 and alfa["paid"] == 50 and alfa["count"] == 3
    # mais atrasado primeiro
    assert [r["id"] for r in data["rows"]][:2] == ["pb-1", "inv-1"]

    only_titles = api.get("/api/reports/receivables", params={"source": "TITULO"}).json()
    assert [r["id"] for r in only_titles["rows"]] == [title["id"]]
    assert api.get("/api/reports/receivables", params={"source": "OUTRO"}).status_code == 422
    assert [r["source"] for r in api.get("/api/reports/receivables", params={"client_name": "gama"}).json()["rows"]] == ["VENDA"]

    # recebido entra como recebido; módulo desligado some do painel
    api.post("/api/receivable-titles/receive", json={"ids": [title["id"]], "paid_date": _day(0), "payment_method": "PIX"})
    paid = api.get("/api/reports/receivables", params={"status": "PAGO", "source": "TITULO"}).json()["rows"]
    assert paid[0]["status"] == "PAGO" and paid[0]["total_value"] == 250

    for path in ("/api/reports/receivables/pdf", "/api/reports/receivables/excel"):
        r = api.get(path)
        assert r.status_code == 200 and len(r.content) > 1000

    api.run(api.db.module_config.insert_one({"disabled_modules": ["gestao_container.venda"]}))
    shared.invalidate_module_config_cache()
    assert "VENDA" not in {r["source"] for r in api.get("/api/reports/receivables").json()["rows"]}


def test_invoice_account_and_cost_center(api):
    from test_api_invoices import movement
    account = _receita(api)
    center = {c["name"]: c for c in api.get("/api/cost-centers").json()}["Terminal"]
    inv = api.post("/api/invoices", json={"client_name": "Cliente Um", "movement_ids": [movement(api, "ABCU1111111")["id"]],
                                          "account_id": account["id"], "cost_center_id": center["id"]}).json()
    assert inv["account_name"] == "1.02 Receita de armazenagem" and inv["cost_center_name"] == "Terminal"
    assert api.post("/api/invoices", json={"client_name": "X", "movement_ids": [movement(api, "ABCU2222222")["id"]],
                                           "account_id": "nao-existe"}).status_code == 400

    # renomear a conta vale para a fatura; conta usada não pode ser excluída
    api.put(f"/api/chart-accounts/{account['id']}", json={"code": "1.02", "name": "Armazenagem", "kind": "RECEITA"})
    assert api.get(f"/api/invoices/{inv['id']}").json()["account_name"] == "1.02 Armazenagem"
    r = api.delete(f"/api/chart-accounts/{account['id']}")
    assert r.status_code == 400 and "faturas" in r.json()["detail"]

    # None mantém, "" tira; a troca fica no histórico
    kept = api.put(f"/api/invoices/{inv['id']}", json={"notes": "x"}).json()
    assert kept["account_id"] == account["id"]
    cleared = api.put(f"/api/invoices/{inv['id']}", json={"account_id": ""}).json()
    assert cleared["account_id"] is None and cleared["cost_center_name"] == "Terminal"
    history = api.get(f"/api/invoices/{inv['id']}/history").json()
    assert any("account_name" in h["changes"] for h in history)
    assert api.get("/api/reports/receivables", params={"source": "FATURA"}).json()["rows"][0]["cost_center_name"] == "Terminal"


def test_alerts_summary_and_cash_flow(api):
    api.post("/api/receivable-titles", json=_body(installments=[{"due_date": _day(-2), "amount": 100}]))
    api.post("/api/receivable-titles", json=_body(installments=[{"due_date": _day(2), "amount": 40}]))
    alerts = {a["key"]: a for a in api.get("/api/alerts/summary").json()["financial"]}
    assert alerts["receivable_titles_overdue"]["title"] == "1 título a receber vencido"
    assert alerts["receivable_titles_overdue"]["tone"] == "red"
    assert alerts["receivable_titles_due_soon"]["description"] == "Total de R$ 40,00"

    summary = api.get("/api/reports/financial-summary", params={"date_from": _day(-30), "date_to": _day(0)}).json()
    assert {r["key"]: r["total"] for r in summary["receivable"]}["receivable_titles_open"] == 140

    data = api.get("/api/cash-flow", params={"date_from": _day(-3), "date_to": _day(3)}).json()
    events = [e for e in data["events"] if e["source"] == "Contas a Receber"]
    assert sorted(e["amount"] for e in events) == [40, 100]
    assert next(e for e in events if e["amount"] == 100)["date"] == _day(0)  # atrasado entra hoje
    assert not any("avulsas" in u["label"] for u in data["undated"]["receivable"])  # tem vencimento: não é "sem data"

    api.run(api.db.module_config.insert_one({"disabled_modules": ["financeiro.contas_receber"]}))
    shared.invalidate_module_config_cache()
    keys = [a["key"] for a in api.get("/api/alerts/summary").json()["financial"]]
    assert not any(k.startswith("receivable_titles") for k in keys)
    assert api.get("/api/receivable-titles").status_code == 403
