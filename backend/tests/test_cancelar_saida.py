"""Cancelar a Ordem ou excluir a EIR de Saída: o container volta ao estoque e,
se estava segregado, volta a constar como Pendente de retirada."""
import asyncio

import pytest

import scripts.fix_cancelled_order_exits as fix_script

NUMBER = "MSCU123456-6"


def _movement_body(op):
    return {
        "operation_type": op, "driver_name": "JOSE", "driver_cpf": "11144477735", "truck_plate": "AAA-1A11",
        "trailer_plate_1": "BBB-2B22", "transport_company": "T", "client_name": "Cliente Alfa",
        "container_number": NUMBER, "status": "VAZIO", "size_type": "40HC", "shipping_line": "MSC",
    }


def _order_body(status):
    return {
        "order_type": "ENTREGA", "status": status, "client_name": "Cliente Alfa", "driver_name": "JOSE",
        "driver_cpf": "11144477735", "truck_plate": "AAA-1A11", "trailer_plate": "BBB-2B22", "transport_company": "T",
        "items": [{"container_number": NUMBER, "status": "VAZIO", "size_type": "40HC", "shipping_line": "MSC"}],
    }


@pytest.fixture
def reserved(api):
    assert api.post("/api/movements", json=_movement_body("ENTRADA")).status_code == 200
    client = api.post("/api/clients", json={"name": "Cliente Alfa"}).json()
    r = api.post("/api/unit-segregations", json={"client_id": client["id"], "items": [{"container_number": NUMBER, "shipping_line": "MSC"}]})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _item(api, seg_id):
    return api.get(f"/api/unit-segregations/{seg_id}").json()["items"][0]


def _exits(api):
    return api.run(api.db.movements.find({"container_number": NUMBER, "operation_type": "SAIDA"}).to_list(None))


def _approved_order(api):
    r = api.post("/api/loading-orders", json=_order_body("APROVADA"))
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _cancel(api, order_id):
    return api.put(f"/api/loading-orders/{order_id}", json=_order_body("CANCELADA"))


def test_cancelling_order_returns_container_and_segregation_pending(api, reserved):
    order_id = _approved_order(api)
    assert _item(api, reserved)["retrieved"] is True and len(_exits(api)) == 1

    r = _cancel(api, order_id)
    assert r.status_code == 200, r.text
    assert "voltou ao estoque" in r.json()["movement_notes"][0]
    assert _exits(api) == []
    item = _item(api, reserved)
    assert item["retrieved"] is False and item["retrieved_transaction_id"] is None
    assert api.get(f"/api/unit-segregations/{reserved}").json()["retrieval_status"] == "PENDENTE"

    # Reaprovar gera a saída de novo e dá a baixa outra vez
    assert api.put(f"/api/loading-orders/{order_id}", json=_order_body("APROVADA")).status_code == 200
    assert len(_exits(api)) == 1 and _item(api, reserved)["retrieved"] is True


def test_deleting_approved_order_also_reverts_exit(api, reserved):
    order_id = _approved_order(api)
    assert api.delete(f"/api/loading-orders/{order_id}").status_code == 200
    assert _exits(api) == [] and _item(api, reserved)["retrieved"] is False


def test_billed_exit_is_kept_and_reported(api, reserved):
    order_id = _approved_order(api)
    api.run(api.db.movements.update_one({"operation_type": "SAIDA"}, {"$set": {"billed": True}}))
    notes = _cancel(api, order_id).json()["movement_notes"]
    assert "faturada" in notes[0] and len(_exits(api)) == 1 and _item(api, reserved)["retrieved"] is True


def test_exit_followed_by_new_movement_is_kept(api, reserved):
    order_id = _approved_order(api)
    assert api.post("/api/movements", json=_movement_body("ENTRADA")).status_code == 200
    notes = _cancel(api, order_id).json()["movement_notes"]
    assert "posterior" in notes[0] and len(_exits(api)) == 1


def test_coleta_cancel_keeps_entry(api):
    body = {**_order_body("APROVADA"), "order_type": "COLETA"}
    order = api.post("/api/loading-orders", json=body)
    assert order.status_code == 200, order.text
    r = api.put(f"/api/loading-orders/{order.json()['id']}", json={**body, "status": "CANCELADA"})
    assert r.json()["movement_notes"] == []
    assert api.run(api.db.movements.count_documents({"container_number": NUMBER, "operation_type": "ENTRADA"})) == 1


def test_deleting_exit_movement_returns_segregation_to_pending(api, reserved):
    movement = api.post("/api/movements", json=_movement_body("SAIDA")).json()
    assert _item(api, reserved)["retrieved"] is True
    assert api.delete(f"/api/movements/{movement['id']}").status_code == 200
    assert _item(api, reserved)["retrieved"] is False


def test_script_simulates_then_fixes_old_cancelled_order(api, reserved, capsys):
    order_id = _approved_order(api)
    # Como ficou a ordem cancelada antes da correção: saída mantida
    api.run(api.db.loading_orders.update_one({"id": order_id}, {"$set": {"status": "CANCELADA"}}))

    assert api.run(fix_script.fix_db(api.db, apply=False)) == 1
    assert len(_exits(api)) == 1
    assert api.run(fix_script.fix_db(api.db, apply=True, order_number=99999)) == 0
    assert api.run(fix_script.fix_db(api.db, apply=True)) == 1
    assert _exits(api) == [] and _item(api, reserved)["retrieved"] is False
    assert api.run(api.db[fix_script.BACKUP].count_documents({})) == 1
