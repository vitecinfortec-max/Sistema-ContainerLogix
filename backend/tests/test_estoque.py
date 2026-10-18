"""Grupo Estoque: nomes repetidos em Almoxarifado/Família, código de barras
repetido no Produto, exclusão bloqueada quando o produto/serviço está numa OS
ou ainda tem saldo, data da movimentação validada, filtros da lista de
movimentações, código do produto nas entradas por NF-e do extrato e exclusão
da Entrega de EPI devolvendo o material uma vez só."""
from test_api_stock import payload


def _product(api, description, **over):
    r = api.post("/api/products", json={"description": description, **over})
    assert r.status_code == 200, r.text
    return r.json()


def test_duplicate_names_are_refused(api):
    assert api.post("/api/warehouses", json={"name": "Central"}).status_code == 200
    r = api.post("/api/warehouses", json={"name": "  central "})
    assert r.status_code == 409
    assert api.post("/api/warehouses", json={"name": "   "}).status_code == 400

    other = api.post("/api/warehouses", json={"name": "Oficina"}).json()
    assert api.put(f"/api/warehouses/{other['id']}", json={"name": "CENTRAL"}).status_code == 409
    # renomear o próprio registro mantendo o nome continua permitido
    assert api.put(f"/api/warehouses/{other['id']}", json={"name": "Oficina", "status": "INATIVO"}).status_code == 200

    assert api.post("/api/product-families", json={"name": "EPI"}).status_code == 200
    assert api.post("/api/product-families", json={"name": "epi"}).status_code == 409
    assert api.post("/api/service-families", json={"name": "Mecânica"}).status_code == 200
    assert api.post("/api/service-families", json={"name": "MECÂNICA"}).status_code == 409


def test_product_validation_and_duplicate_barcode(api):
    assert api.post("/api/products", json={"description": "  "}).status_code == 400
    assert api.post("/api/products", json={"description": "Luva", "reference_value": -1}).status_code == 400

    first = _product(api, "Luva", barcode="789123")
    r = api.post("/api/products", json={"description": "Outra luva", "barcode": " 789123 "})
    assert r.status_code == 409 and str(first["code"]) in r.json()["detail"]

    # editar o próprio produto com o mesmo código de barras continua permitido
    r = api.put(f"/api/products/{first['id']}", json={"description": "Luva de raspa", "barcode": "789123"})
    assert r.status_code == 200


def test_product_delete_is_blocked_by_os_or_balance(api):
    in_os = _product(api, "Filtro de óleo")
    api.run(api.db.ordem_servico.insert_one({"id": "os-1", "products": [{"code": str(in_os["code"]), "description": "Filtro de óleo"}]}))
    r = api.delete(f"/api/products/{in_os['id']}")
    assert r.status_code == 409 and "ordem" in r.json()["detail"]

    # produto antigo com saldo e sem nenhuma movimentação
    api.run(api.db.products.insert_one({"id": "old-1", "code": 99, "description": "Antigo", "stock_quantity": 3.0}))
    r = api.delete("/api/products/old-1")
    assert r.status_code == 409 and "saldo" in r.json()["detail"]

    free = _product(api, "Sem uso")
    assert api.delete(f"/api/products/{free['id']}").status_code == 200
    assert api.delete("/api/products/nao-existe").status_code == 404


def test_service_catalog_validation_and_delete_in_use(api):
    assert api.post("/api/service-catalog", json={"description": " "}).status_code == 400
    assert api.post("/api/service-catalog", json={"description": "Troca", "value": -5}).status_code == 400

    used = api.post("/api/service-catalog", json={"description": "Troca de óleo", "value": 50}).json()
    free = api.post("/api/service-catalog", json={"description": "Alinhamento", "value": 80}).json()
    api.run(api.db.ordem_servico.insert_one({"id": "os-1", "services": [{"code": str(used["code"]), "description": "Troca de óleo"}]}))

    r = api.delete(f"/api/service-catalog/{used['id']}")
    assert r.status_code == 409 and "Ativo" in r.json()["detail"]
    assert api.delete(f"/api/service-catalog/{free['id']}").status_code == 200


def test_movement_date_is_validated_and_list_filters(api):
    api.run(api.db.products.insert_one({"id": "prod-1", "code": 1, "description": "Luva de raspa", "stock_quantity": 10.0}))
    bad = {**payload(), "movement_date": "12/10/2026"}
    assert api.post("/api/stock/movements", json=bad).status_code == 400

    assert api.post("/api/stock/movements", json={**payload(), "movement_date": "2026-10-01"}).status_code == 200
    second = api.post("/api/stock/movements", json={**payload("SAIDA", quantity=2), "movement_date": "2026-10-20"}).json()

    in_range = api.get("/api/stock/movements", params={"date_from": "2026-10-10", "date_to": "2026-10-31"}).json()
    assert [m["id"] for m in in_range] == [second["id"]]
    by_product = api.get("/api/stock/movements", params={"search": "raspa"}).json()
    assert len(by_product) == 2
    by_number = api.get("/api/stock/movements", params={"search": f"#{second['movement_number']}"}).json()
    assert [m["id"] for m in by_number] == [second["id"]]


def test_ledger_fills_product_code_for_nfe_entries(api):
    api.run(api.db.products.insert_one({"id": "prod-1", "code": 42, "description": "Graxa", "warehouse_name": "Central"}))
    api.run(api.db.stock_entries.insert_one({
        "id": "e1", "product_id": "prod-1", "product_name": "Graxa", "quantity": 2, "total_value": 30,
        "nfe_number": "555", "nfe_issue_date": "2026-10-05", "created_at": "2026-10-05T12:00:00+00:00",
    }))
    rows = api.get("/api/stock/ledger/rows").json()
    assert rows[0]["product_code"] == 42 and rows[0]["warehouse_name"] == "Central"
    assert len(api.get("/api/stock/ledger/rows", params={"search": "42"}).json()) == 1
    assert len(api.get("/api/stock/ledger/rows", params={"search": "NF 555"}).json()) == 1


def test_epi_delivery_delete_returns_stock_once_and_is_logged(api):
    api.run(api.db.products.insert_one({"id": "epi-1", "code": 1, "description": "Capacete", "stock_quantity": 5.0}))
    driver = api.post("/api/drivers", json={"name": "Motorista Um", "cpf": "111.222.333-44"}).json()
    delivery = {
        "recipient_type": "MOTORISTA", "recipient_id": driver["id"], "delivery_date": "2026-10-12",
        "warehouse_id": "alm-1", "warehouse_name": "Central",
        "items": [{"product_id": "epi-1", "product_description": "Capacete", "quantity": 2}],
    }
    assert api.post("/api/epi-deliveries", json={**delivery, "delivery_date": "12/10/2026"}).status_code == 400
    created = api.post("/api/epi-deliveries", json=delivery)
    assert created.status_code == 200, created.text
    stock = lambda: api.run(api.db.products.find_one({"id": "epi-1"}))["stock_quantity"]  # noqa: E731
    assert stock() == 3

    assert api.delete(f"/api/epi-deliveries/{created.json()['id']}").status_code == 200
    assert stock() == 5
    assert api.delete(f"/api/epi-deliveries/{created.json()['id']}").status_code == 404
    assert stock() == 5
    assert api.run(api.db.stock_movements.count_documents({})) == 0
    log = api.run(api.db.stock_audit_log.find_one({"action": "EPI_DELIVERY_DELETED"}))
    assert log["snapshot"]["delivery"]["id"] == created.json()["id"]
