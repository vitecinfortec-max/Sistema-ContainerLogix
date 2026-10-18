"""Grupo Gestão de Container: vínculo Compra <-> Venda (uma compra só vira
de uma venda, excluir a venda devolve a compra pra Disponível, compra
vendida não sai), campos apagados na edição, valores negativos, Recebido
com valor, representante duplicado/em uso/renomeado e exclusão da Ordem de
Carregamento desfazendo os vínculos."""


def _purchase(api, container="ABCU1234567", **over):
    r = api.post("/api/container-purchases", json={"container_number": container, **over})
    assert r.status_code == 200, r.text
    return r.json()


def _sale(api, container="ABCU1234567", **over):
    r = api.post("/api/container-sales", json={"container_number": container, **over})
    assert r.status_code == 200, r.text
    return r.json()


def _get_purchase(api, purchase_id):
    return api.run(api.db.container_purchases.find_one({"id": purchase_id}, {"_id": 0}))


def test_purchase_validation_and_duplicate_available(api):
    assert api.post("/api/container-purchases", json={"container_number": "  "}).status_code == 400
    assert api.post("/api/container-purchases", json={"container_number": "X1", "purchase_value": -10}).status_code == 400
    _purchase(api, "abcu1234567", booking="BK1")
    r = api.post("/api/container-purchases", json={"container_number": "ABCU1234567"})
    assert r.status_code == 409
    # busca pelo booking
    assert len(api.get("/api/container-purchases", params={"container_number": "bk1"}).json()) == 1


def test_sale_links_purchase_and_delete_releases_it(api):
    purchase = _purchase(api, booking="BK1", origin_terminal="TECON")
    sale = _sale(api)
    assert sale["purchase_id"] == purchase["id"] and sale["booking"] == "BK1"
    assert _get_purchase(api, purchase["id"])["status"] == "VENDIDO"

    # compra vendida não pode ser excluída nem trocar de container
    assert api.delete(f"/api/container-purchases/{purchase['id']}").status_code == 409
    assert api.put(f"/api/container-purchases/{purchase['id']}", json={"container_number": "ZZZU0000001"}).status_code == 400

    # segunda venda do mesmo container não pega a compra já vendida
    second = _sale(api)
    assert second["purchase_id"] is None

    assert api.delete(f"/api/container-sales/{sale['id']}").status_code == 200
    released = _get_purchase(api, purchase["id"])
    assert released["status"] == "DISPONIVEL" and released["sale_id"] is None
    assert api.delete(f"/api/container-sales/{sale['id']}").status_code == 404


def test_edit_clears_fields_sent_empty(api):
    purchase = _purchase(api, purchase_value=1000, observations="obs")
    r = api.put(f"/api/container-purchases/{purchase['id']}", json={
        "container_number": "ABCU1234567", "purchase_value": None, "observations": None,
    })
    assert r.status_code == 200
    assert r.json()["purchase_value"] is None and r.json()["observations"] is None

    sale = _sale(api, "MSCU7654321", sale_value=500)
    r = api.put(f"/api/container-sales/{sale['id']}", json={"container_number": "MSCU7654321", "sale_value": None})
    assert r.status_code == 200 and r.json()["sale_value"] is None
    assert api.put(f"/api/container-sales/{sale['id']}", json={"received_value": -1}).status_code == 400


def test_received_needs_a_value(api):
    sale = _sale(api, "MSCU7654321")
    r = api.put(f"/api/container-sales/{sale['id']}/status", params={"status": "RECEBIDO"})
    assert r.status_code == 400

    api.put(f"/api/container-sales/{sale['id']}", json={"sale_value": 800})
    assert api.put(f"/api/container-sales/{sale['id']}/status", params={"status": "RECEBIDO"}).status_code == 200
    saved = api.run(api.db.container_sales.find_one({"id": sale["id"]}))
    assert saved["received_value"] == 800 and saved["status"] == "RECEBIDO"


def test_representative_rules(api):
    rep = api.post("/api/container-representatives", json={"name": "João", "cpf": "111.222.333-44"}).json()
    r = api.post("/api/container-representatives", json={"name": "Outro", "cpf": "11122233344"})
    assert r.status_code == 400 and "CPF" in r.json()["detail"]
    assert api.post("/api/container-representatives", json={"name": " "}).status_code == 400

    sale = _sale(api, "MSCU7654321", representative_id=rep["id"], representative_name="João")
    api.run(api.db.loading_orders.insert_one({"id": "lo-1", "representative_id": rep["id"], "representative_name": "João"}))

    r = api.put(f"/api/container-representatives/{rep['id']}", json={"name": "João Silva", "cpf": "111.222.333-44"})
    assert r.status_code == 200
    assert api.run(api.db.container_sales.find_one({"id": sale["id"]}))["representative_name"] == "João Silva"
    assert api.run(api.db.loading_orders.find_one({"id": "lo-1"}))["representative_name"] == "João Silva"

    r = api.delete(f"/api/container-representatives/{rep['id']}")
    assert r.status_code == 409 and "Inativo" in r.json()["detail"]

    api.put(f"/api/container-representatives/{rep['id']}", json={"name": "João Silva", "status": "INATIVO"})
    r = api.post("/api/container-sales", json={"container_number": "TGHU0000001", "representative_id": rep["id"]})
    assert r.status_code == 400


def test_deleting_loading_order_undoes_links(api):
    # compra manual vendida por uma venda nascida da ordem
    purchase = _purchase(api)
    sale = _sale(api)
    api.run(api.db.container_sales.update_one({"id": sale["id"]}, {"$set": {"loading_order_id": "lo-1"}}))
    api.run(api.db.loading_orders.insert_one({"id": "lo-1", "order_number": 1}))

    assert api.delete("/api/loading-orders/lo-1").status_code == 200
    assert api.run(api.db.container_sales.count_documents({})) == 0
    assert _get_purchase(api, purchase["id"])["status"] == "DISPONIVEL"
