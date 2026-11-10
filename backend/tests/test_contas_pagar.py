"""Contas a Pagar: plano de contas e centros de custo padrão, parcelas,
baixa (uma ou várias), estorno, cancelamento, anexos, fechamento de período,
alertas do sino, Resumo Financeiro e as duplicatas da NF-e de entrada."""
from datetime import timedelta

import routers.payables as payables_router

NFE_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe35261100000000000100550010000012341000012345">
<ide><nNF>1234</nNF><dhEmi>2026-11-03T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>11222333000144</CNPJ><xNome>Auto Pecas Exemplo Ltda</xNome></emit>
<det nItem="1"><prod><cProd>F1</cProd><cEAN>SEM GTIN</cEAN><xProd>Filtro de oleo</xProd><NCM>84212300</NCM><CFOP>5102</CFOP>
<uCom>UN</uCom><qCom>4</qCom><vUnCom>50.00</vUnCom><vProd>200.00</vProd></prod></det>
<total><ICMSTot><vNF>210.00</vNF></ICMSTot></total>
<cobr><dup><nDup>001</nDup><dVenc>2026-12-03</dVenc><vDup>105.00</vDup></dup>
<dup><nDup>002</nDup><dVenc>2027-01-03</dVenc><vDup>105.00</vDup></dup></cobr>
</infNFe></NFe></nfeProc>"""


def _day(n: int) -> str:
    return (payables_router.datetime.now(payables_router.BRT_TZ).date() + timedelta(days=n)).isoformat()


def _accounts(api):
    accounts = api.get("/api/chart-accounts").json()
    centers = api.get("/api/cost-centers").json()
    return {a["code"]: a for a in accounts}, {c["name"]: c for c in centers}


def _body(**over):
    body = {
        "description": "Aluguel do pátio", "supplier_name": "Imobiliária Exemplo", "issue_date": _day(-5),
        "recurrence": "UNICA", "installments": [{"due_date": _day(-1), "amount": 1500}],
    }
    body.update(over)
    return body


def test_defaults_and_cadastros(api):
    accounts, centers = _accounts(api)
    assert accounts["2.01"]["name"] == "Combustível" and accounts["1.01"]["kind"] == "RECEITA"
    codes = [a["code"] for a in api.get("/api/chart-accounts").json()]
    assert codes.index("2.09") < codes.index("2.10")  # ordem numérica, não de texto
    assert "Oficina" in centers
    assert api.post("/api/chart-accounts", json={"code": "2.01", "name": "Outra"}).status_code == 400
    new = api.post("/api/chart-accounts", json={"code": "2.13", "name": "Fretes de terceiros"}).json()
    assert api.get("/api/chart-accounts", as_user="operator").status_code == 403

    p = api.post("/api/payables", json=_body(account_id=new["id"], cost_center_id=centers["Oficina"]["id"])).json()[0]
    assert p["account_name"] == "2.13 Fretes de terceiros" and p["cost_center_name"] == "Oficina"
    api.put(f"/api/chart-accounts/{new['id']}", json={"code": "2.13", "name": "Fretes terceirizados"})
    assert api.get(f"/api/payables/{p['id']}").json()["account_name"] == "2.13 Fretes terceirizados"
    assert api.delete(f"/api/chart-accounts/{new['id']}").status_code == 400  # já usada
    assert api.delete(f"/api/cost-centers/{centers['Oficina']['id']}").status_code == 400


def test_create_installments_list_and_summary(api):
    r = api.post("/api/payables", json=_body(recurrence="UNICA", installments=[{"due_date": _day(1), "amount": 1}, {"due_date": _day(2), "amount": 1}]))
    assert r.status_code == 400  # única com duas parcelas
    assert api.post("/api/payables", json=_body(supplier_name="")).status_code == 400

    single = api.post("/api/payables", json=_body()).json()
    assert single[0]["payable_number"] == 1 and single[0]["installment"] == 1
    group = api.post("/api/payables", json=_body(
        description="Pneus", recurrence="PARCELADA",
        installments=[{"due_date": _day(0), "amount": 800}, {"due_date": _day(30), "amount": 800}, {"due_date": _day(60), "amount": 800}],
    )).json()
    assert [g["installment"] for g in group] == [1, 2, 3] and {g["payable_number"] for g in group} == {2}

    listing = api.get("/api/payables").json()
    assert listing["total"] == 4 and listing["sums"]["open"] == 3900
    assert listing["items"][0]["overdue"] is True  # aluguel venceu ontem
    assert api.get("/api/payables", params={"status": "VENCIDO"}).json()["total"] == 1
    assert api.get("/api/payables", params={"search": "pneus"}).json()["total"] == 3
    assert api.get("/api/payables", params={"search": "2"}).json()["total"] == 3  # pelo número
    assert api.get("/api/payables", params={"date_from": _day(1), "date_to": _day(40)}).json()["total"] == 1

    summary = api.get("/api/payables/summary").json()
    assert summary["overdue"] == {"count": 1, "total": 1500}
    assert summary["today"] == {"count": 1, "total": 800}
    detail = api.get(f"/api/payables/{group[1]['id']}").json()
    assert len(detail["group"]) == 3


def test_pay_unpay_cancel_delete(api):
    p = api.post("/api/payables", json=_body()).json()[0]
    g = api.post("/api/payables", json=_body(recurrence="RECORRENTE", installments=[
        {"due_date": _day(10), "amount": 100}, {"due_date": _day(40), "amount": 100}])).json()

    bad = {"ids": [p["id"]], "paid_date": _day(0), "payment_method": "OUTRO"}
    assert api.post("/api/payables/pay", json=bad).status_code == 400
    assert api.post("/api/payables/pay", json={**bad, "payment_method": "PIX", "paid_date": _day(1)}).status_code == 400  # futura
    r = api.post("/api/payables/pay", json={"ids": [g[0]["id"], g[1]["id"]], "paid_date": _day(0), "payment_method": "PIX", "interest": 5})
    assert r.status_code == 400 and "uma conta por vez" in r.json()["detail"]

    assert api.post("/api/payables/pay", json={"ids": [p["id"]], "paid_date": _day(0), "payment_method": "BOLETO",
                                                "interest": 30, "discount": 10}).json() == {"paid": 1}
    paid = api.get(f"/api/payables/{p['id']}").json()
    assert paid["status"] == "PAGO" and paid["paid_amount"] == 1520 and paid["payment_method"] == "BOLETO"
    assert api.put(f"/api/payables/{p['id']}", json={**_body(), "due_date": _day(3), "amount": 10}).status_code == 400
    assert api.delete(f"/api/payables/{p['id']}").status_code == 400  # paga
    assert api.post("/api/payables/pay", json={"ids": [p["id"]], "paid_date": _day(0), "payment_method": "PIX"}).status_code == 400

    unpaid = api.post(f"/api/payables/{p['id']}/unpay").json()
    assert unpaid["status"] == "ABERTO" and unpaid["paid_amount"] is None

    # baixa em lote
    assert api.post("/api/payables/pay", json={"ids": [g[0]["id"], g[1]["id"]], "paid_date": _day(0), "payment_method": "PIX"}).json() == {"paid": 2}

    edited = api.put(f"/api/payables/{p['id']}", json={**_body(description="Aluguel nov"), "due_date": _day(3), "amount": 1600}).json()
    assert edited["amount"] == 1600 and edited["description"] == "Aluguel nov"

    assert api.post(f"/api/payables/{p['id']}/cancel", json={"cancelled": True}).json()["status"] == "CANCELADO"
    assert api.post(f"/api/payables/{p['id']}/cancel", json={"cancelled": True}).status_code == 400
    assert api.post(f"/api/payables/{p['id']}/cancel", json={"cancelled": False}).json()["status"] == "ABERTO"

    assert api.delete(f"/api/payables/{g[0]['id']}", params={"whole_group": True}).status_code == 400  # grupo tem paga
    assert api.delete(f"/api/payables/{p['id']}").json() == {"deleted": 1}


def test_period_lock(api):
    p = api.post("/api/payables", json=_body(issue_date="2026-10-10")).json()[0]
    api.put("/api/company-settings", json={"financial_lock_date": "2026-10-31"})
    assert api.post("/api/payables", json=_body(issue_date="2026-10-20")).status_code == 400
    r = api.put(f"/api/payables/{p['id']}", json={**_body(issue_date="2026-11-05"), "due_date": _day(3), "amount": 5})
    assert r.status_code == 400 and "fechado" in r.json()["detail"]
    assert api.delete(f"/api/payables/{p['id']}").status_code == 400
    # documento em período fechado ainda pode ser pago hoje
    assert api.post("/api/payables/pay", json={"ids": [p["id"]], "paid_date": _day(0), "payment_method": "PIX"}).status_code == 200
    assert api.post("/api/payables/pay", json={"ids": [p["id"]], "paid_date": "2026-10-30", "payment_method": "PIX"}).status_code == 400


def test_attachments(api):
    p = api.post("/api/payables", json=_body()).json()[0]
    r = api.post(f"/api/payables/{p['id']}/attachments", files={"file": ("boleto.pdf", b"%PDF-1.4 teste", "application/pdf")})
    assert r.status_code == 200
    att = r.json()["attachments"][0]
    assert att["name"] == "boleto.pdf" and att["url"].startswith("/api/uploads/payables/")
    bad = api.post(f"/api/payables/{p['id']}/attachments", files={"file": ("x.exe", b"MZ", "application/octet-stream")})
    assert bad.status_code == 400
    assert api.delete(f"/api/payables/{p['id']}/attachments/{att['id']}").json()["attachments"] == []


def test_report_alerts_and_summary(api):
    accounts, centers = _accounts(api)
    api.post("/api/payables", json=_body(account_id=accounts["2.07"]["id"], cost_center_id=centers["Administrativo"]["id"]))
    p2 = api.post("/api/payables", json=_body(description="Diesel", installments=[{"due_date": _day(2), "amount": 300}],
                                              account_id=accounts["2.01"]["id"])).json()[0]
    api.post("/api/payables", json=_body(description="Pago", installments=[{"due_date": _day(0), "amount": 50}]))
    paid_id = api.get("/api/payables", params={"search": "Pago"}).json()["items"][0]["id"]
    api.post("/api/payables/pay", json={"ids": [paid_id], "paid_date": _day(0), "payment_method": "DINHEIRO"})

    report = api.get("/api/reports/payables").json()
    assert report["summary"]["open"] == 1800 and report["summary"]["overdue"] == 1500 and report["summary"]["paid"] == 50
    assert [a["name"] for a in report["by_account"]][:2] == ["2.01 Combustível", "2.07 Aluguel"]
    pdf = api.get("/api/reports/payables/pdf")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    assert api.get("/api/reports/payables/excel").status_code == 200

    alerts = {a["key"]: a for a in api.get("/api/alerts/summary").json()["financial"]}
    assert alerts["payables_overdue"]["title"] == "1 conta a pagar vencida"
    assert alerts["payables_due_soon"]["description"] == "Total de R$ 300,00"
    assert api.get("/api/alerts/summary", as_user="operator").json()["financial"] == []

    month = _day(0)[:8] + "01"
    summary = api.get("/api/reports/financial-summary", params={"date_from": month, "date_to": _day(0)}).json()
    out = {l["key"]: l for l in summary["outflows"]}
    pay = {l["key"]: l for l in summary["payable"]}
    assert out["payables"]["total"] == 50 and pay["payables_open"]["total"] == 1800
    assert p2["status"] == "ABERTO"


def test_nfe_duplicatas_become_payables(api):
    accounts, _ = _accounts(api)
    parsed = api.post("/api/stock/nfe-import/parse", files={"file": ("nota.xml", NFE_XML, "text/xml")}).json()
    assert parsed["total_value"] == 210 and [i["amount"] for i in parsed["installments"]] == [105, 105]
    assert parsed["installments"][0]["due_date"] == "2026-12-03"

    body = {k: parsed[k] for k in ("nfe_number", "nfe_key", "nfe_issue_date", "supplier_cnpj", "supplier_name")}
    body["items"] = [{k: i[k] for k in ("description", "ncm", "cfop", "unit", "quantity", "unit_value", "total_value")} for i in parsed["items"]]
    body["payables"] = {"installments": [{"due_date": i["due_date"], "amount": i["amount"]} for i in parsed["installments"]],
                        "account_id": accounts["2.11"]["id"]}
    assert api.post("/api/stock/nfe-import/confirm", json=body, as_user="operator").status_code == 403
    result = api.post("/api/stock/nfe-import/confirm", json=body).json()
    assert result["payables_created"] == 2

    items = api.get("/api/payables", params={"search": "NF-e 1234"}).json()["items"]
    assert len(items) == 2 and items[0]["supplier_name"] == "Auto Pecas Exemplo Ltda" and items[0]["supplier_id"]
    assert items[0]["origin"] == "NFE" and items[0]["account_name"] == "2.11 Materiais e almoxarifado"
    assert api.delete(f"/api/payables/{items[0]['id']}").status_code == 400  # só pelo estorno da nota

    entry = api.get("/api/stock/entries").json()[0]
    api.post("/api/payables/pay", json={"ids": [items[0]["id"]], "paid_date": _day(0), "payment_method": "PIX"})
    r = api.post(f"/api/stock/entries/{entry['id']}/reverse")
    assert r.status_code == 409 and "já foi paga" in r.json()["detail"]
    api.post(f"/api/payables/{items[0]['id']}/unpay")
    r = api.post(f"/api/stock/entries/{entry['id']}/reverse").json()
    assert r["payables_removed"] == 2
    assert api.get("/api/payables").json()["total"] == 0


def test_nfe_without_payables_and_module_disabled(api):
    parsed = api.post("/api/stock/nfe-import/parse", files={"file": ("nota.xml", NFE_XML, "text/xml")}).json()
    body = {k: parsed[k] for k in ("nfe_number", "nfe_key", "nfe_issue_date", "supplier_cnpj", "supplier_name")}
    body["items"] = [{k: i[k] for k in ("description", "quantity", "unit_value", "total_value")} for i in parsed["items"]]
    import shared
    api.run(api.db.module_config.insert_one({"disabled_modules": ["financeiro.contas_pagar"]}))
    shared.invalidate_module_config_cache()
    with_payables = {**body, "payables": {"installments": [{"due_date": "2026-12-03", "amount": 210}]}}
    assert api.post("/api/stock/nfe-import/confirm", json=with_payables).status_code == 400
    assert api.post("/api/stock/nfe-import/confirm", json=body).json()["payables_created"] == 0
    assert api.get("/api/payables").status_code == 403
