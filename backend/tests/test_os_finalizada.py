"""Ordem de Serviço de manutenção: histórico com data e hora de cada
gravação, OS finalizada (Fechada ou Cancelada) sem edição nem exclusão, e
saída de estoque recusada para OS finalizada (pedido de 14/11/2026)."""
from test_api_stock import payload


def _os(api, **over):
    r = api.post("/api/ordem-servico", json={"category": "PREVENTIVA", "person_name": "JOSE", **over})
    assert r.status_code == 200, r.text
    return r.json()


def _exit_for(os_doc, quantity=1):
    return {
        **payload("SAIDA", quantity=quantity),
        "purpose_type": "OS", "purpose_text": f"OS Nº {os_doc['os_number']}",
        "purpose_os_id": os_doc["id"], "purpose_os_number": os_doc["os_number"],
    }


def test_history_records_each_change_with_date_and_user(api):
    os_doc = _os(api)
    assert [h["action"] for h in os_doc["history"]] == ["CRIADA"]
    assert os_doc["history"][0]["at"] and os_doc["history"][0]["user_name"]

    r = api.put(f"/api/ordem-servico/{os_doc['id']}", json={
        **os_doc, "status": "ANDAMENTO", "description": "Troca de pastilha",
        "products": [{"description": "Pastilha", "quantity": 2, "unit": "UN", "unit_price": 50}],
    })
    assert r.status_code == 200, r.text
    last = r.json()["history"][-1]
    assert last["action"] == "ALTERADA"
    changes = {c["field"]: c for c in last["changes"]}
    assert changes["status"]["old"] == "Aberto" and changes["status"]["new"] == "Em Andamento"
    assert changes["description"]["new"] == "Troca de pastilha"
    assert changes["products"]["new"] == "Pastilha - 2 UN x R$ 50"

    # Salvar de novo sem mudar nada não cria entrada nova
    again = api.put(f"/api/ordem-servico/{os_doc['id']}", json=r.json()).json()
    assert len(again["history"]) == 2


def test_closed_os_cannot_be_edited_or_deleted(api):
    os_doc = _os(api)
    r = api.put(f"/api/ordem-servico/{os_doc['id']}", json={**os_doc, "status": "FECHADO"})
    assert r.status_code == 200, r.text
    closed = r.json()
    assert closed["history"][-1]["action"] == "FINALIZADA"
    assert closed["closed_at"]  # preenchido na hora de fechar

    r = api.put(f"/api/ordem-servico/{os_doc['id']}", json={**closed, "status": "ANDAMENTO"})
    assert r.status_code == 409
    assert "fechada" in r.json()["detail"]
    assert api.delete(f"/api/ordem-servico/{os_doc['id']}").status_code == 409
    assert api.get(f"/api/ordem-servico/{os_doc['id']}").json()["status"] == "FECHADO"

    cancelled = _os(api, status="CANCELADO")
    assert [h["action"] for h in cancelled["history"]] == ["CRIADA", "CANCELADA"]
    assert api.put(f"/api/ordem-servico/{cancelled['id']}", json={**cancelled, "observations": "x"}).status_code == 409


def test_stock_exit_refused_for_closed_os_and_linked_movement_frozen(api):
    api.run(api.db.products.insert_one({"id": "prod-1", "code": 1, "description": "Luva de raspa", "stock_quantity": 10.0}))
    os_doc = _os(api)

    r = api.post("/api/stock/movements", json=_exit_for(os_doc))
    assert r.status_code == 200, r.text
    movement = r.json()
    assert movement["purpose_os_closed"] is False

    api.put(f"/api/ordem-servico/{os_doc['id']}", json={**os_doc, "status": "FECHADO"})

    r = api.post("/api/stock/movements", json=_exit_for(os_doc))
    assert r.status_code == 409
    assert "não aceita mais saída" in r.json()["detail"]

    listed = api.get("/api/stock/movements").json()
    assert [m["purpose_os_closed"] for m in listed] == [True]
    assert api.get(f"/api/stock/movements/{movement['id']}").json()["purpose_os_closed"] is True

    assert api.put(f"/api/stock/movements/{movement['id']}", json=_exit_for(os_doc, quantity=3)).status_code == 409
    assert api.delete(f"/api/stock/movements/{movement['id']}").status_code == 409
    assert api.run(api.db.products.find_one({"id": "prod-1"}))["stock_quantity"] == 9.0

    # Outra movimentação também não pode ser trocada para a OS fechada
    other = api.post("/api/stock/movements", json=payload("SAIDA", quantity=1)).json()
    assert api.put(f"/api/stock/movements/{other['id']}", json=_exit_for(os_doc)).status_code == 409
