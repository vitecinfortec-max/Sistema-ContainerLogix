"""Comercial > Comissão (27/10/2026): lançamento do frete faturado, comissão
pelo Vínculo de Clientes (com % ajustável), descontos, baixa/estorno do
pagamento, lançamento a partir de CT-es autorizados e prestação de contas."""
import io

from pdfminer.high_level import extract_text


def _setup(api, pct=5):
    client = api.post("/api/clients", json={"name": "Cliente Frete", "cnpj": "11.222.333/0001-81"}).json()
    rep = api.post("/api/representatives", json={"name": "Rep Comissão"}).json()
    r = api.post("/api/client-representative-links", json={"client_id": client["id"], "representative_id": rep["id"], "commission_percentage": pct})
    assert r.status_code == 200, r.text
    return client, rep


def _entry(api, client, **over):
    body = {"client_id": client["id"], "document_type": "CTE", "document_number": "101", "billing_date": "2026-10-10",
            "freight_value": 10000, **over}
    return api.post("/api/commission-entries", json=body)


def test_commission_uses_link_and_discounts(api):
    client, rep = _setup(api)
    r = _entry(api, client, discounts=[{"description": "Pedágio", "value": 500}, {"description": "Impostos", "value": 1000}],
               observations="Viagem Santos")
    assert r.status_code == 200, r.text
    e = r.json()
    assert (e["representative_id"], e["representative_name"]) == (rep["id"], "Rep Comissão")
    assert (e["discount_total"], e["calculation_base"]) == (1500, 8500)
    assert (e["commission_percentage"], e["commission_value"], e["percentage_overridden"]) == (5, 425, False)
    assert e["status"] == "PENDENTE"


def test_percentage_override_and_validations(api):
    client, _ = _setup(api)
    e = _entry(api, client, commission_percentage=7.5).json()
    assert (e["commission_value"], e["percentage_overridden"], e["table_percentage"]) == (750, True, 5)
    assert _entry(api, client, freight_value=0).status_code == 400
    assert _entry(api, client, discounts=[{"description": "X", "value": 20000}]).status_code == 400
    assert _entry(api, client, commission_percentage=150).status_code == 400
    assert _entry(api, client, billing_date="10/10/2026").status_code == 400
    other = api.post("/api/clients", json={"name": "Sem Representante"}).json()
    r = _entry(api, other)
    assert r.status_code == 400 and "Vínculo de Clientes" in r.json()["detail"]


def test_filters_pay_and_unpay(api):
    client, rep = _setup(api)
    a = _entry(api, client, billing_date="2026-09-30").json()
    b = _entry(api, client, document_number="102").json()
    rows = api.get("/api/commission-entries", params={"start_date": "2026-10-01", "end_date": "2026-10-31"}).json()
    assert [x["id"] for x in rows] == [b["id"]]
    assert api.get("/api/commission-entries", params={"search": "102"}).json()[0]["id"] == b["id"]

    r = api.post("/api/commission-entries/pay", json={"ids": [a["id"], b["id"]], "payment_date": "2026-10-27", "payment_notes": "PIX"})
    assert r.json() == {"paid": 2}
    paid = api.get(f"/api/commission-entries/{a['id']}").json()
    assert (paid["status"], paid["payment_date"], paid["payment_notes"]) == ("PAGO", "2026-10-27", "PIX")
    # pago fica travado
    assert api.put(f"/api/commission-entries/{a['id']}", json={**{k: a[k] for k in ("client_id", "billing_date")}, "freight_value": 1}).status_code == 400
    assert api.delete(f"/api/commission-entries/{a['id']}").status_code == 400
    assert api.get("/api/commission-entries", params={"status": "PENDENTE"}).json() == []

    assert api.post("/api/commission-entries/unpay", json={"ids": [a["id"]]}).json() == {"reverted": 1}
    assert api.delete(f"/api/commission-entries/{a['id']}").status_code == 200


def test_update_recalculates(api):
    client, _ = _setup(api)
    e = _entry(api, client).json()
    r = api.put(f"/api/commission-entries/{e['id']}", json={
        "client_id": client["id"], "document_type": "NF", "document_number": "9", "billing_date": "2026-10-11",
        "freight_value": 2000, "discounts": [{"description": "Seguro", "value": 200}]})
    assert r.status_code == 200, r.text
    assert (r.json()["calculation_base"], r.json()["commission_value"], r.json()["document_type"]) == (1800, 90, "NF")


def test_launch_from_authorized_ctes(api):
    client, _ = _setup(api, pct=10)
    party = lambda nome, doc, cid=None: {"nome": nome, "cnpj_cpf": doc, "client_id": cid}  # noqa: E731
    api.run(api.db.ctes.insert_many([
        # pagador = remetente, achado pelo CNPJ
        {"id": "c1", "numero": 501, "status": "AUTORIZADO", "tomador_papel": 0, "valor_total": 3000.0,
         "emitido_em": "2026-10-05T23:30:00+00:00", "remetente": party("Cliente Frete", "11222333000181")},
        # pagador = destinatário fora do cadastro
        {"id": "c2", "numero": 502, "status": "AUTORIZADO", "tomador_papel": 3, "valor_total": 800.0,
         "emitido_em": "2026-10-06T12:00:00+00:00", "destinatario": party("Desconhecido", "11444777000161")},
        {"id": "c3", "numero": 503, "status": "RASCUNHO", "tomador_papel": 0, "valor_total": 1.0,
         "remetente": party("Cliente Frete", "11222333000181")},
    ]))
    cands = api.get("/api/commission-entries/cte-candidates").json()
    assert [c["numero"] for c in cands] == [501, 502]
    assert cands[0]["billing_date"] == "2026-10-05"  # 23:30 UTC ainda é dia 05 em Brasília
    assert (cands[0]["client_name"], cands[0]["commission_percentage"]) == ("Cliente Frete", 10)
    assert cands[1]["client_id"] is None

    r = api.post("/api/commission-entries/from-ctes", json={"ids": ["c1", "c2"]}).json()
    assert [e["document_number"] for e in r["created"]] == ["501"]
    assert r["created"][0]["commission_value"] == 300 and r["created"][0]["cte_id"] == "c1"
    assert r["skipped"][0]["numero"] == 502 and "cadastro de clientes" in r["skipped"][0]["reason"]
    # já lançado não volta como candidato nem lança de novo
    assert [c["numero"] for c in api.get("/api/commission-entries/cte-candidates").json()] == [502]
    assert _entry(api, client, cte_id="c1").status_code == 400


def test_statement_pdf(api):
    client, _ = _setup(api)
    e = _entry(api, client, discounts=[{"description": "Pedágio", "value": 500}], observations="Viagem Santos").json()
    api.post("/api/commission-entries/pay", json={"ids": [e["id"]], "payment_date": "2026-10-27"})
    r = api.get("/api/commission-entries/pdf", params={"start_date": "2026-10-01", "end_date": "2026-10-31"})
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    text = " ".join(extract_text(io.BytesIO(r.content)).split())
    assert "Prestação de Contas Comissão" in text and "Rep Comissão" in text
    assert "Pedágio: R$ 500,00" in text and "Viagem Santos" in text
    assert api.get("/api/commission-entries/pdf", params={"status": "X"}).status_code == 400


def test_client_and_representative_in_use(api):
    client, rep = _setup(api)
    _entry(api, client)
    api.run(api.db.client_representative_links.delete_many({}))
    r = api.delete(f"/api/representatives/{rep['id']}")
    assert r.status_code == 400 and "lançamento(s) de comissão" in r.json()["detail"]
    assert api.delete(f"/api/clients/{client['id']}").status_code == 400
