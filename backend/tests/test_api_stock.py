"""
Testes de API da Movimentação de Estoque (Almoxarifado), contra o app
inteiro com banco em memória (fixture `api` em conftest.py). O foco é o
saldo: cada lançamento, edição e exclusão tem que mexer nele exatamente uma
vez, mesmo com dois pedidos concorrentes sobre o mesmo registro.
"""
import pytest

PRODUCT = {"id": "prod-1", "code": 1, "description": "Luva de raspa", "stock_quantity": 10.0, "reference_value": 5.0}


@pytest.fixture
def stock(api):
    api.run(api.db.products.insert_one(dict(PRODUCT)))
    return api


def payload(operation_type="ENTRADA", quantity=4, unit_value=5.0):
    return {
        "operation_type": operation_type, "movement_date": "2026-10-12",
        "warehouse_id": "alm-1", "warehouse_name": "Almoxarifado Central",
        "items": [{
            "product_id": "prod-1", "product_description": "Luva de raspa",
            "quantity": quantity, "unit_value": unit_value, "total_value": 0,
        }],
    }


def launch(api, **kwargs):
    response = api.post("/api/stock/movements", json=payload(**kwargs))
    assert response.status_code == 200, response.text
    return response.json()


def balance(api):
    return api.run(api.db.products.find_one({"id": "prod-1"}))["stock_quantity"]


def sync_movements(api):
    return api.db.stock_movements._AsyncMongoMockCollection__collection


class TestLaunch:
    def test_entry_and_exit_move_the_balance(self, stock):
        entry = launch(stock, quantity=4)
        assert balance(stock) == 14
        assert entry["items"][0]["total_value"] == 20
        launch(stock, operation_type="SAIDA", quantity=6)
        assert balance(stock) == 8

    def test_exit_beyond_the_balance_is_refused(self, stock):
        response = stock.post("/api/stock/movements", json=payload("SAIDA", quantity=11))
        assert response.status_code == 400
        assert balance(stock) == 10

    def test_invalid_items_are_refused(self, stock):
        assert stock.post("/api/stock/movements", json=payload(quantity=0)).status_code == 400
        assert stock.post("/api/stock/movements", json=payload(unit_value=-1)).status_code == 400
        assert balance(stock) == 10


class TestEdit:
    def test_edit_applies_only_the_difference(self, stock):
        entry = launch(stock, quantity=4)
        response = stock.put(f"/api/stock/movements/{entry['id']}", json=payload(quantity=7))
        assert response.status_code == 200, response.text
        assert balance(stock) == 17
        assert response.json()["movement_number"] == entry["movement_number"]

    def test_edit_that_would_leave_negative_balance_changes_nothing(self, stock):
        entry = launch(stock, quantity=4)
        before = stock.get(f"/api/stock/movements/{entry['id']}").json()
        response = stock.put(f"/api/stock/movements/{entry['id']}", json=payload("SAIDA", quantity=20))
        assert response.status_code == 400
        assert balance(stock) == 14
        assert stock.get(f"/api/stock/movements/{entry['id']}").json() == before

    def test_edit_over_a_stale_version_is_refused(self, stock, monkeypatch):
        # Outro pedido altera a movimentação depois de este tê-la lido: a
        # diferença de saldo calculada aqui já não vale e nada pode ser aplicado.
        from routers import stock as stock_router

        entry = launch(stock, quantity=4)
        original = stock_router._stock_movement_effect_by_product

        def effect_and_concurrent_edit(operation_type, items):
            sync_movements(stock).update_one({"id": entry["id"]}, {"$set": {"updated_at": "versao-do-outro-pedido"}})
            return original(operation_type, items)

        monkeypatch.setattr(stock_router, "_stock_movement_effect_by_product", effect_and_concurrent_edit)
        response = stock.put(f"/api/stock/movements/{entry['id']}", json=payload(quantity=9))
        assert response.status_code == 409
        assert balance(stock) == 14

    def test_two_edits_in_sequence_both_apply(self, stock):
        entry = launch(stock, quantity=4)
        assert stock.put(f"/api/stock/movements/{entry['id']}", json=payload(quantity=5)).status_code == 200
        assert stock.put(f"/api/stock/movements/{entry['id']}", json=payload(quantity=6)).status_code == 200
        assert balance(stock) == 16

    def test_edit_unknown_movement(self, stock):
        assert stock.put("/api/stock/movements/nao-existe", json=payload()).status_code == 404


class TestDelete:
    def test_delete_reverts_the_balance_once(self, stock):
        exit_movement = launch(stock, operation_type="SAIDA", quantity=3)
        assert balance(stock) == 7
        assert stock.delete(f"/api/stock/movements/{exit_movement['id']}").status_code == 200
        assert balance(stock) == 10
        # Segunda exclusão do mesmo registro: não existe mais, saldo intacto.
        assert stock.delete(f"/api/stock/movements/{exit_movement['id']}").status_code == 404
        assert balance(stock) == 10

    def test_refused_delete_keeps_the_record(self, stock):
        entry = launch(stock, quantity=4)
        launch(stock, operation_type="SAIDA", quantity=12)  # consome parte da entrada
        assert balance(stock) == 2
        response = stock.delete(f"/api/stock/movements/{entry['id']}")
        assert response.status_code == 400
        assert balance(stock) == 2
        assert stock.get(f"/api/stock/movements/{entry['id']}").status_code == 200

    def test_delete_is_recorded_in_the_audit_log(self, stock):
        entry = launch(stock, quantity=4)
        stock.delete(f"/api/stock/movements/{entry['id']}")
        log = stock.run(stock.db.stock_audit_log.find_one({"action": "MOVEMENT_DELETED"}))
        assert log["snapshot"]["id"] == entry["id"]
