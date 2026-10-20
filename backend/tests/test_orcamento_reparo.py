"""Terminal - Orçamento de Reparo: cálculo dos totais, validações, vínculo
com a Vistoria de Container, ciclo de status (aprovado, reprovado,
cancelado), travas de edição/exclusão, validade, sugestão de preço e o PDF."""
from datetime import datetime, timedelta, timezone


def _body(**over):
    body = {
        "container_number": "msku1234567", "client_name": "Cliente Um", "shipping_line": "Maersk", "size_type": "20DC",
        "items": [
            {"description": "Reparo de painel lateral", "quantity": 2, "unit_price": 150.5},
            {"description": "Troca de borracha da porta", "quantity": 1, "unit_price": 80},
        ],
        "discount": 31, "validity_days": 15, "execution_days": 3,
    }
    body.update(over)
    return body


def _create(api, **over):
    r = api.post("/api/repair-estimates", json=_body(**over))
    assert r.status_code == 200, r.text
    return r.json()


def test_create_computes_totals_and_starts_open(api):
    estimate = _create(api)
    assert estimate["estimate_number"] == 1
    assert estimate["container_number"] == "MSKU1234567"
    assert [i["total"] for i in estimate["items"]] == [301.0, 80.0]
    assert estimate["subtotal"] == 381.0
    assert estimate["total"] == 350.0
    assert estimate["status"] == "EM_ABERTO"
    assert [h["status"] for h in estimate["history"]] == ["EM_ABERTO"]
    assert _create(api)["estimate_number"] == 2


def test_invalid_values_are_rejected(api):
    assert api.post("/api/repair-estimates", json=_body(container_number=" ")).status_code == 400
    assert api.post("/api/repair-estimates", json=_body(items=[])).status_code == 400
    assert api.post("/api/repair-estimates", json=_body(items=[{"description": "X", "quantity": 0, "unit_price": 1}])).status_code == 400
    assert api.post("/api/repair-estimates", json=_body(items=[{"description": "X", "quantity": 1, "unit_price": -1}])).status_code == 400
    assert api.post("/api/repair-estimates", json=_body(items=[{"description": " ", "quantity": 1, "unit_price": 1}])).status_code == 400
    r = api.post("/api/repair-estimates", json=_body(discount=500))
    assert r.status_code == 400 and "subtotal" in r.json()["detail"]
    assert api.post("/api/repair-estimates", json=_body(validity_days=0)).status_code == 400
    assert api.post("/api/repair-estimates", json=_body(vistoria_id="nao-existe")).status_code == 400


def test_links_to_container_vistoria(api):
    r = api.post("/api/container-vistorias", json={"container_number": "MSKU1234567", "damage_items": ["Reparo de painel lateral"]})
    assert r.status_code == 200, r.text
    vistoria = r.json()
    estimate = _create(api, vistoria_id=vistoria["id"])
    assert estimate["vistoria_number"] == vistoria["vistoria_number"]


def test_approval_locks_edit_and_delete(api):
    estimate = _create(api)
    path = f"/api/repair-estimates/{estimate['id']}"
    assert api.put(f"{path}/status", json={"status": "APROVADO"}).status_code == 400  # sem quem respondeu
    r = api.put(f"{path}/status", json={"status": "APROVADO", "responded_by": "Fulano (Maersk)"})
    assert r.status_code == 200
    assert r.json()["responded_by"] == "Fulano (Maersk)" and r.json()["responded_at"]

    assert api.put(path, json=_body(discount=0)).status_code == 400
    assert api.delete(path).status_code == 400
    assert api.put(f"{path}/status", json={"status": "CANCELADO"}).status_code == 400

    r = api.put(f"{path}/status", json={"status": "EM_ABERTO"})
    assert r.status_code == 200 and r.json()["responded_by"] is None
    assert api.put(path, json=_body(discount=0)).json()["total"] == 381.0
    assert [h["status"] for h in api.get(path).json()["history"]] == ["EM_ABERTO", "APROVADO", "EM_ABERTO"]


def test_rejection_requires_reason_and_cancel_allows_delete(api):
    estimate = _create(api)
    path = f"/api/repair-estimates/{estimate['id']}"
    r = api.put(f"{path}/status", json={"status": "REPROVADO", "responded_by": "Fulano"})
    assert r.status_code == 400 and "motivo" in r.json()["detail"]
    r = api.put(f"{path}/status", json={"status": "REPROVADO", "responded_by": "Fulano", "note": "Valor alto"})
    assert r.status_code == 200 and r.json()["response_note"] == "Valor alto"

    other = _create(api)
    assert api.put(f"/api/repair-estimates/{other['id']}/status", json={"status": "CANCELADO"}).status_code == 200
    assert api.delete(f"/api/repair-estimates/{other['id']}").status_code == 200
    assert api.get(f"/api/repair-estimates/{other['id']}").status_code == 404


def test_expired_filter_and_summary(api):
    fresh = _create(api)
    old = _create(api, validity_days=5)
    approved = _create(api)
    api.put(f"/api/repair-estimates/{approved['id']}/status", json={"status": "APROVADO", "responded_by": "Fulano"})
    created = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    api.run(api.db.repair_estimates.update_one({"id": old["id"]}, {"$set": {"created_at": created}}))

    r = api.get("/api/repair-estimates", params={"status": "VENCIDO"}).json()
    assert [e["id"] for e in r["items"]] == [old["id"]] and r["total"] == 1
    assert api.get("/api/repair-estimates", params={"status": "EM_ABERTO"}).json()["total"] == 2

    summary = api.get("/api/repair-estimates/summary").json()
    assert summary["open"] == {"count": 1, "total": fresh["total"]}
    assert summary["expired"]["count"] == 1
    assert summary["approved"] == {"count": 1, "total": approved["total"]}


def test_search_by_number_container_and_service(api):
    first = _create(api)
    _create(api, container_number="TGHU7654321", items=[{"description": "Lavagem interna", "quantity": 1, "unit_price": 50}])
    assert [e["id"] for e in api.get("/api/repair-estimates", params={"search": "OR000001"}).json()["items"]] == [first["id"]]
    assert api.get("/api/repair-estimates", params={"search": "tghu"}).json()["total"] == 1
    assert api.get("/api/repair-estimates", params={"search": "lavagem"}).json()["total"] == 1


def test_last_prices_follow_latest_estimate(api):
    _create(api)
    _create(api, items=[{"description": "reparo de painel LATERAL", "quantity": 1, "unit_price": 175}])
    prices = api.get("/api/repair-estimates/last-prices").json()
    assert prices["reparo de painel lateral"] == 175
    assert prices["troca de borracha da porta"] == 80


def test_pdf(api):
    estimate = _create(api, observations="Fotos na vistoria")
    r = api.get(f"/api/repair-estimates/{estimate['id']}/pdf")
    assert r.status_code == 200
    assert r.content[:4] == b"%PDF"


def test_vistoria_lookup_by_number(api):
    r = api.post("/api/container-vistorias", json={"container_number": "MSKU1234567", "damage_items": ["Reparo de painel lateral"]})
    vistoria = r.json()
    code = f"VC{vistoria['vistoria_number']:06d}"
    for number in (str(vistoria["vistoria_number"]), code, code.lower()):
        found = api.get(f"/api/container-vistorias/by-number/{number}")
        assert found.status_code == 200 and found.json()["id"] == vistoria["id"]
    assert api.get("/api/container-vistorias/by-number/999").status_code == 404
    assert api.get("/api/container-vistorias/by-number/abc").status_code == 404
