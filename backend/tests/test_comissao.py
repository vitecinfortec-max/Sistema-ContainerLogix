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
    assert r.json() == {"paid": 2, "advances_deducted": 0, "net": 1000, "carried_over": []}
    paid = api.get(f"/api/commission-entries/{a['id']}").json()
    assert (paid["status"], paid["payment_date"], paid["payment_notes"]) == ("PAGO", "2026-10-27", "PIX")
    # pago fica travado
    assert api.put(f"/api/commission-entries/{a['id']}", json={**{k: a[k] for k in ("client_id", "billing_date")}, "freight_value": 1}).status_code == 400
    assert api.delete(f"/api/commission-entries/{a['id']}").status_code == 400
    assert api.get("/api/commission-entries", params={"status": "PENDENTE"}).json() == []

    assert api.post("/api/commission-entries/unpay", json={"ids": [a["id"]]}).json() == {"reverted": 1, "advances_reverted": 0}
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


def test_period_of_entry(api):
    client, _ = _setup(api)
    e = _entry(api, client, period_start="2026-09-01", period_end="2026-09-30").json()
    assert (e["period_start"], e["period_end"]) == ("2026-09-01", "2026-09-30")
    assert _entry(api, client, period_start="2026-10-01", period_end="2026-09-30").status_code == 400
    assert _entry(api, client, period_start="01/09/2026").status_code == 400


def test_batch_by_representative_with_advances(api):
    client, rep = _setup(api, pct=10)
    other = api.post("/api/clients", json={"name": "Cliente Dois"}).json()
    api.post("/api/client-representative-links", json={"client_id": other["id"], "representative_id": rep["id"], "commission_percentage": 5})
    body = {"representative_id": rep["id"], "billing_date": "2026-10-31", "period_start": "2026-10-01", "period_end": "2026-10-31",
            "items": [{"client_id": client["id"], "freight_value": 10000},
                      {"client_id": other["id"], "freight_value": 4000, "document_number": "F-7", "period_start": "2026-09-15"}],
            "advances": [{"representative_id": "", "advance_date": "2026-10-10", "value": 300, "description": "PIX"}]}
    r = api.post("/api/commission-entries/batch", json=body)
    assert r.status_code == 200, r.text
    created, advances = r.json()["created"], r.json()["advances"]
    assert [(e["client_name"], e["commission_value"], e["period_start"], e["document_type"]) for e in created] == [
        ("Cliente Frete", 1000, "2026-10-01", "FATURA"), ("Cliente Dois", 200, "2026-09-15", "FATURA")]
    assert (advances[0]["representative_name"], advances[0]["value"], advances[0]["status"]) == ("Rep Comissão", 300, "PENDENTE")

    # cliente de outro representante não entra no lote (e nada é gravado)
    rep2 = api.post("/api/representatives", json={"name": "Outro Rep"}).json()
    third = api.post("/api/clients", json={"name": "Cliente Três"}).json()
    api.post("/api/client-representative-links", json={"client_id": third["id"], "representative_id": rep2["id"], "commission_percentage": 5})
    bad = {**body, "items": [{"client_id": client["id"], "freight_value": 1}, {"client_id": third["id"], "freight_value": 1}], "advances": []}
    r = api.post("/api/commission-entries/batch", json=bad)
    assert r.status_code == 400 and "outro representante" in r.json()["detail"]
    bad["items"] = [{"client_id": client["id"], "freight_value": 0}]
    assert "Cliente Frete:" in api.post("/api/commission-entries/batch", json=bad).json()["detail"]
    assert len(api.get("/api/commission-entries").json()) == 2

    # adiantamento descontado na baixa e devolvido no estorno
    ids = [e["id"] for e in created]
    adv_id = advances[0]["id"]
    too_much = api.post("/api/commission-advances", json={"representative_id": rep["id"], "advance_date": "2026-10-20", "value": 5000}).json()
    r = api.post("/api/commission-entries/pay", json={"ids": ids, "payment_date": "2026-11-05", "advance_ids": [adv_id]})
    assert r.json() == {"paid": 2, "advances_deducted": 300, "net": 900, "carried_over": []}
    adv = api.get("/api/commission-advances", params={"status": "DESCONTADO"}).json()
    assert [(a["id"], a["deducted_on"]) for a in adv] == [(adv_id, "2026-11-05")]
    assert api.delete(f"/api/commission-advances/{adv_id}").status_code == 400

    pdf = api.get("/api/commission-entries/pdf", params={"start_date": "2026-09-01", "end_date": "2026-11-30"})
    text = " ".join(extract_text(io.BytesIO(pdf.content)).split())
    assert "01/10 a 31/10/2026" in text and "Descontado" in text and "Saldo adiantado a descontar R$ 5.000,00" in text

    # estorno parcial não devolve o adiantamento; o da baixa inteira devolve
    assert api.post("/api/commission-entries/unpay", json={"ids": ids[:1]}).json() == {"reverted": 1, "advances_reverted": 0}
    assert api.post("/api/commission-entries/unpay", json={"ids": ids[1:]}).json() == {"reverted": 1, "advances_reverted": 1}
    assert api.get("/api/commission-advances", params={"status": "PENDENTE"}).json()[1]["id"] == adv_id

    r = api.delete(f"/api/representatives/{rep2['id']}")
    assert r.status_code == 400  # vínculo
    api.run(api.db.commission_entries.delete_many({}))
    api.run(api.db.client_representative_links.delete_many({}))
    r = api.delete(f"/api/representatives/{rep['id']}")
    assert r.status_code == 400 and "adiantamento(s)" in r.json()["detail"]


def test_advance_crud(api):
    _, rep = _setup(api)
    assert api.post("/api/commission-advances", json={"representative_id": rep["id"], "advance_date": "2026-10-01", "value": 0}).status_code == 400
    assert api.post("/api/commission-advances", json={"representative_id": "x", "advance_date": "2026-10-01", "value": 10}).status_code == 404
    a = api.post("/api/commission-advances", json={"representative_id": rep["id"], "advance_date": "2026-10-01", "value": 150.5}).json()
    r = api.put(f"/api/commission-advances/{a['id']}", json={"representative_id": rep["id"], "advance_date": "2026-10-02", "value": 200, "description": "Vale"})
    assert (r.json()["value"], r.json()["description"], r.json()["advance_date"]) == (200, "Vale", "2026-10-02")
    assert api.get("/api/commission-advances", params={"start_date": "2026-10-03"}).json() == []
    assert api.get("/api/commission-advances", params={"search": "vale"}).json()[0]["id"] == a["id"]
    assert api.delete(f"/api/commission-advances/{a['id']}").status_code == 200


def test_negative_balance_carried_to_next_commission(api):
    client, rep = _setup(api, pct=10)
    first = _entry(api, client, freight_value=5000).json()  # comissão 500
    adv = api.post("/api/commission-advances", json={"representative_id": rep["id"], "advance_date": "2026-10-05", "value": 800}).json()
    r = api.post("/api/commission-entries/pay", json={"ids": [first["id"]], "payment_date": "2026-10-31", "advance_ids": [adv["id"]]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["paid"], body["advances_deducted"], body["net"]) == (1, 800, 0)
    saldo = body["carried_over"][0]
    assert (saldo["value"], saldo["status"], saldo["origin"], saldo["advance_date"]) == (300, "PENDENTE", "SALDO_NEGATIVO", "2026-10-31")
    assert saldo["description"] == ("Saldo negativo da comissão paga em 31/10/2026: adiantamentos de R$ 800,00 "
                                    "maiores que a comissão de R$ 500,00")
    # é automático: não se edita nem exclui à mão
    assert api.delete(f"/api/commission-advances/{saldo['id']}").status_code == 400

    # próxima comissão desconta o saldo
    second = _entry(api, client, freight_value=20000, billing_date="2026-11-30").json()  # comissão 2000
    r = api.post("/api/commission-entries/pay", json={"ids": [second["id"]], "payment_date": "2026-11-30", "advance_ids": [saldo["id"]]})
    assert (r.json()["net"], r.json()["carried_over"]) == (1700, [])

    # a primeira baixa não pode ser estornada enquanto o saldo dela estiver descontado na segunda
    r = api.post("/api/commission-entries/unpay", json={"ids": [first["id"]]})
    assert r.status_code == 400 and "30/11/2026" in r.json()["detail"]
    api.post("/api/commission-entries/unpay", json={"ids": [second["id"]]})
    assert api.post("/api/commission-entries/unpay", json={"ids": [first["id"]]}).json() == {"reverted": 1, "advances_reverted": 1}
    left = api.get("/api/commission-advances").json()
    assert [(a["id"], a["status"]) for a in left] == [(adv["id"], "PENDENTE")]  # o saldo foi cancelado
