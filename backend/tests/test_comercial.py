"""Grupo Comercial: Relatório de Comissão (R$ e US$ separados, período em
dias de Brasília, prévia), status editável sem reativar sozinho, preço único
duplicado, Representante em uso/renomeado, validações e situação da
Proposta Comercial."""
import pytest


def _setup(api):
    client = api.post("/api/clients", json={"name": "Cliente Um"}).json()
    service = api.post("/api/service-types", json={"name": "Armazenagem"}).json()
    rep = api.post("/api/representatives", json={"name": "Rep Um"}).json()
    return client, service, rep


def _entry(api, client, service, **over):
    body = {"client_id": client["id"], "service_type_id": service["id"], "value": 100, **over}
    return api.post("/api/service-price-entries", json=body)


def _link(api, client, rep, **over):
    body = {"client_id": client["id"], "representative_id": rep["id"], "commission_percentage": 10, **over}
    return api.post("/api/client-representative-links", json=body)


def _billed_movement(api, mid, value, created_at, currency="BRL"):
    api.run(api.db.movements.insert_one({
        "id": mid, "client_name": "Cliente Um", "service_type": "Armazenagem", "service_value": value,
        "currency": currency, "billed": True, "created_at": created_at,
    }))


def test_commission_splits_brl_and_usd(api):
    client, service, rep = _setup(api)
    assert _entry(api, client, service).status_code == 200
    assert _link(api, client, rep).status_code == 200
    _billed_movement(api, "m1", 1000, "2026-09-10T12:00:00+00:00")
    _billed_movement(api, "m2", 500, "2026-09-11T12:00:00+00:00", currency="USD")

    data = api.get("/api/reports/commission").json()
    cl = data["representatives"][0]["clients"][0]
    assert cl["total_billed"] == 1000 and cl["commission_value"] == 100
    assert cl["total_billed_usd"] == 500 and cl["commission_value_usd"] == 50
    assert data["grand_total"] == 100 and data["grand_total_usd"] == 50
    pdf = api.get("/api/reports/commission/pdf")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"


def test_commission_period_uses_brasilia_days(api):
    client, service, rep = _setup(api)
    _entry(api, client, service)
    _link(api, client, rep)
    # 30/09 às 23:30 em Brasília = 01/10 02:30 UTC
    _billed_movement(api, "m1", 1000, "2026-10-01T02:30:00+00:00")

    sept = api.get("/api/reports/commission", params={"start_date": "2026-09-01", "end_date": "2026-09-30"}).json()
    octo = api.get("/api/reports/commission", params={"start_date": "2026-10-01", "end_date": "2026-10-31"}).json()
    assert sept["representatives"][0]["clients"][0]["total_billed"] == 1000
    assert octo["representatives"][0]["clients"][0]["total_billed"] == 0

    r = api.get("/api/reports/commission", params={"start_date": "2026-10-10", "end_date": "2026-10-01"})
    assert r.status_code == 400


def test_status_is_kept_and_editable(api):
    client, service, rep = _setup(api)
    entry = _entry(api, client, service, status="INATIVO").json()
    assert entry["status"] == "INATIVO"
    # duplicado só conta entre ativos: um novo ativo pode substituir o inativo
    active = _entry(api, client, service).json()
    r = _entry(api, client, service)
    assert r.status_code == 400 and "preço ativo" in r.json()["detail"]
    r = api.put(f"/api/service-price-entries/{entry['id']}", json={
        "client_id": client["id"], "service_type_id": service["id"], "value": 120, "status": "ATIVO"})
    assert r.status_code == 400  # reativar duplicaria o ativo
    r = api.put(f"/api/service-price-entries/{active['id']}", json={
        "client_id": client["id"], "service_type_id": service["id"], "value": 130, "status": "INATIVO"})
    assert r.status_code == 200 and r.json()["status"] == "INATIVO"

    link = _link(api, client, rep, status="INATIVO").json()
    assert link["status"] == "INATIVO"
    assert _link(api, client, rep).status_code == 200  # o inativo não bloqueia um ativo novo


def test_representative_in_use_and_rename(api):
    client, service, rep = _setup(api)
    link = _link(api, client, rep).json()
    r = api.delete(f"/api/representatives/{rep['id']}")
    assert r.status_code == 400 and "Inativo" in r.json()["detail"]
    assert api.put(f"/api/representatives/{rep['id']}", json={"name": "Rep Renomeado"}).status_code == 200
    stored = api.run(api.db.client_representative_links.find_one({"id": link["id"]}))
    assert stored["representative_name"] == "Rep Renomeado"


@pytest.mark.parametrize("body,fragment", [
    ({"value": -1}, "negativo"),
    ({"currency": "EUR"}, "Moeda"),
    ({"billing_type": "DIARIA", "free_time_days": -2}, "Free time"),
    ({"status": "QUALQUER"}, "Status"),
])
def test_price_entry_validation(api, body, fragment):
    client, service, _ = _setup(api)
    r = _entry(api, client, service, **body)
    assert r.status_code == 400 and fragment in r.json()["detail"]


@pytest.mark.parametrize("pct", [-1, 100.5])
def test_link_percentage_validation(api, pct):
    client, _, rep = _setup(api)
    r = _link(api, client, rep, commission_percentage=pct)
    assert r.status_code == 400 and "entre 0 e 100" in r.json()["detail"]


def test_proposal_validation_status_and_number(api):
    base = {"recipient_name": "Prospect", "items": [{"description": "Armazenagem", "value": 10.005}]}
    for bad in ({"items": []}, {"items": [{"description": "X", "value": -1}]}, {"validity_days": 0}, {"currency": "EUR"}):
        assert api.post("/api/commercial-proposals", json={**base, **bad}).status_code == 400
    p = api.post("/api/commercial-proposals", json=base).json()
    assert p["status"] == "EM_ABERTO" and p["proposal_number"].endswith("0001")  # recusadas não gastaram número
    assert p["items"][0]["value"] == 10.01

    r = api.put(f"/api/commercial-proposals/{p['id']}/status", params={"status": "ACEITA"})
    assert r.status_code == 200 and r.json()["status"] == "ACEITA"
    # editar sem mandar status mantém a situação
    r = api.put(f"/api/commercial-proposals/{p['id']}", json={**base, "subject": "Novo assunto"})
    assert r.status_code == 200 and r.json()["status"] == "ACEITA"
    assert api.put(f"/api/commercial-proposals/{p['id']}/status", params={"status": "X"}).status_code == 400
