"""Financeiro > Prestadores de Serviço (28/10/2026): cadastro, serviços,
vales, fechamento do período com saldo negativo levado ao próximo,
pagamento/estorno, recibo e relatório em PDF."""
import io

from pdfminer.high_level import extract_text


def _provider(api, **over):
    body = {"name": "João Soldador", "document": "123.456.789-09", "role": "Soldador", "payment_unit": "DIARIA",
            "default_rate": 250, "pix_key": "joao@pix", **over}
    r = api.post("/api/service-providers", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _service(api, provider, day, qty=1, value=250, **over):
    r = api.post("/api/service-provider-entries", json={"provider_id": provider["id"], "date": day, "quantity": qty,
                                                         "unit_value": value, "description": "Solda de chassi", **over})
    assert r.status_code == 200, r.text
    return r.json()


def _text(content: bytes) -> str:
    return " ".join(extract_text(io.BytesIO(content)).split())


def test_provider_crud_and_roles(api):
    roles = api.get("/api/service-provider-roles").json()
    assert roles[:5] == ["Soldador", "Pintor", "Ajudante Geral", "Vigia", "Motorista"]
    p = _provider(api, role="Eletricista")
    assert "Eletricista" in api.get("/api/service-provider-roles").json()
    assert api.post("/api/service-providers", json={"name": "", "role": "Vigia"}).status_code == 400
    assert api.post("/api/service-providers", json={"name": "X", "role": "Vigia", "payment_unit": "ANO"}).status_code == 400
    r = api.put(f"/api/service-providers/{p['id']}", json={"name": "João Silva", "role": "Soldador", "payment_unit": "HORA", "default_rate": 40})
    assert (r.json()["name"], r.json()["payment_unit"]) == ("João Silva", "HORA")
    _service(api, r.json(), "2026-10-01")
    assert "em uso" in api.delete(f"/api/service-providers/{p['id']}").json()["detail"]


def test_entries_and_advances(api):
    p = _provider(api)
    e = _service(api, p, "2026-10-02", qty=2.5)
    assert (e["unit"], e["total"], e["status"], e["role"]) == ("DIARIA", 625, "ABERTO", "Soldador")
    assert api.post("/api/service-provider-entries", json={"provider_id": p["id"], "date": "2026-10-02", "quantity": 0, "unit_value": 1}).status_code == 400
    assert api.post("/api/service-provider-entries", json={"provider_id": p["id"], "date": "02/10/2026", "unit_value": 1}).status_code == 400
    r = api.put(f"/api/service-provider-entries/{e['id']}", json={"provider_id": p["id"], "date": "2026-10-03", "quantity": 1, "unit_value": 300, "unit": "SERVICO"})
    assert (r.json()["total"], r.json()["unit"]) == (300, "SERVICO")
    assert [x["id"] for x in api.get("/api/service-provider-entries", params={"start_date": "2026-10-03", "end_date": "2026-10-03"}).json()] == [e["id"]]

    v = api.post("/api/service-provider-advances", json={"provider_id": p["id"], "date": "2026-10-05", "value": 100, "description": "Vale"}).json()
    assert (v["origin"], v["status"]) == ("VALE", "PENDENTE")
    assert api.post("/api/service-provider-advances", json={"provider_id": p["id"], "date": "2026-10-05", "value": 0}).status_code == 400
    assert api.delete(f"/api/service-provider-advances/{v['id']}").status_code == 200


def test_closing_pay_receipt_and_cancel(api):
    p = _provider(api)
    e1 = _service(api, p, "2026-10-01")
    e2 = _service(api, p, "2026-10-02", qty=2)
    vale = api.post("/api/service-provider-advances", json={"provider_id": p["id"], "date": "2026-10-03", "value": 100}).json()
    body = {"provider_id": p["id"], "period_start": "2026-10-01", "period_end": "2026-10-15",
            "entry_ids": [e1["id"], e2["id"]], "new_entries": [{"date": "2026-10-10", "description": "Pintura portão", "quantity": 1, "unit_value": 150}],
            "advance_ids": [vale["id"]], "new_advances": [{"provider_id": p["id"], "date": "2026-10-12", "value": 50, "description": "PIX"}],
            "discounts": [{"description": "Ferramenta quebrada", "value": 30}], "observations": "Primeira quinzena"}
    r = api.post("/api/service-provider-closings", json=body)
    assert r.status_code == 200, r.text
    c = r.json()
    assert (c["number"], c["gross_total"], c["advances_total"], c["discount_total"], c["net_total"], c["carried_over"]) == (1, 900, 150, 30, 720, 0)
    assert c["status"] == "FECHADO" and c["entries_count"] == 3
    # o que entrou fica travado e não entra de novo
    assert api.delete(f"/api/service-provider-entries/{e1['id']}").status_code == 400
    assert api.post("/api/service-provider-closings", json={**body, "new_entries": [], "new_advances": []}).status_code == 400

    detail = api.get(f"/api/service-provider-closings/{c['id']}").json()
    assert len(detail["entries"]) == 3 and len(detail["advances"]) == 2

    paid = api.post(f"/api/service-provider-closings/{c['id']}/pay", json={"payment_date": "2026-10-16", "payment_method": "PIX"}).json()
    assert (paid["status"], paid["payment_date"]) == ("PAGO", "2026-10-16")
    assert api.delete(f"/api/service-provider-closings/{c['id']}").status_code == 400

    pdf = api.get(f"/api/service-provider-closings/{c['id']}/receipt-pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    text = _text(pdf.content)
    assert "Recibo de Prestação de Serviço" in text and "João Soldador" in text and "R$ 720,00" in text
    assert "Setecentos e Vinte Reais" in text and "Ferramenta quebrada" in text and "Pintura portão" in text

    report = api.get("/api/service-provider-closings/pdf", params={"start_date": "2026-10-01", "end_date": "2026-10-31"})
    assert report.status_code == 200 and "Fechamentos Prestadores de Serviço" in _text(report.content)

    summary = api.get("/api/reports/financial-summary", params={"date_from": "2026-10-01", "date_to": "2026-10-31"}).json()
    outs = {x["key"]: x["total"] for x in summary["outflows"]}
    assert (outs["service_providers"], outs["service_provider_advances"]) == (720, 150)

    assert api.post(f"/api/service-provider-closings/{c['id']}/unpay").json()["status"] == "FECHADO"
    assert api.delete(f"/api/service-provider-closings/{c['id']}").status_code == 200
    assert {x["status"] for x in api.get("/api/service-provider-entries").json()} == {"ABERTO"}
    assert {x["status"] for x in api.get("/api/service-provider-advances").json()} == {"PENDENTE"}


def test_negative_balance_goes_to_next_closing(api):
    p = _provider(api, name="Pedro Vigia", role="Vigia")
    e = _service(api, p, "2026-10-01", value=200)
    vale = api.post("/api/service-provider-advances", json={"provider_id": p["id"], "date": "2026-10-02", "value": 500}).json()
    c1 = api.post("/api/service-provider-closings", json={"provider_id": p["id"], "period_start": "2026-10-01", "period_end": "2026-10-15",
                                                           "entry_ids": [e["id"]], "advance_ids": [vale["id"]]}).json()
    assert (c1["net_total"], c1["carried_over"]) == (0, 300)
    saldo = api.get("/api/service-provider-advances", params={"status": "PENDENTE"}).json()[0]
    assert (saldo["origin"], saldo["value"], saldo["date"]) == ("SALDO_NEGATIVO", 300, "2026-10-15")
    assert saldo["description"] == ("Saldo negativo do fechamento nº 1 (01/10/2026 a 15/10/2026): vales e descontos de R$ 500,00 "
                                    "maiores que os serviços de R$ 200,00")
    assert api.delete(f"/api/service-provider-advances/{saldo['id']}").status_code == 400

    e2 = _service(api, p, "2026-10-20", qty=5, value=200)
    c2 = api.post("/api/service-provider-closings", json={"provider_id": p["id"], "period_start": "2026-10-16", "period_end": "2026-10-31",
                                                           "entry_ids": [e2["id"]], "advance_ids": [saldo["id"]]}).json()
    assert (c2["gross_total"], c2["advances_total"], c2["net_total"]) == (1000, 300, 700)
    r = api.delete(f"/api/service-provider-closings/{c1['id']}")
    assert r.status_code == 400 and "nº 2" in r.json()["detail"]
    assert api.delete(f"/api/service-provider-closings/{c2['id']}").status_code == 200
    assert api.delete(f"/api/service-provider-closings/{c1['id']}").status_code == 200
    assert [a["origin"] for a in api.get("/api/service-provider-advances").json()] == ["VALE"]  # saldo cancelado
