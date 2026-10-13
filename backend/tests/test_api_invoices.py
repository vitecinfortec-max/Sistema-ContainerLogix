"""
Testes de API do faturamento (faturas e seu vínculo com as movimentações),
contra o app inteiro com banco em memória (fixture `api` em conftest.py).
Cobrem as regras de integridade: uma movimentação só pode estar em uma
fatura, e uma edição recusada não pode deixar nada alterado pela metade.
"""
from test_api_movements import MOVEMENT


def movement(api, container, value=100.0):
    response = api.post("/api/movements", json={**MOVEMENT, "container_number": container, "service_value": value})
    assert response.status_code == 200, response.text
    return response.json()


def invoice(api, *movement_ids, expected=200):
    response = api.post("/api/invoices", json={"client_name": "Cliente Um", "movement_ids": list(movement_ids)})
    assert response.status_code == expected, response.text
    return response.json()


def stored(api, movement_id):
    return api.run(api.db.movements.find_one({"id": movement_id}, {"_id": 0}))


def stored_invoice(api, invoice_id):
    return api.run(api.db.invoices.find_one({"id": invoice_id}, {"_id": 0}))


class TestCreateInvoice:
    def test_creates_and_bills_the_movements(self, api):
        a, b = movement(api, "ABCU1111111", 100), movement(api, "ABCU2222222", 50.5)
        created = invoice(api, a["id"], b["id"])
        assert created["invoice_number"] == 1
        assert created["total_value"] == 150.5
        assert created["movement_ids"] == [a["id"], b["id"]]
        for mov in (a, b):
            doc = stored(api, mov["id"])
            assert doc["billed"] is True and doc["invoice_id"] == created["id"]

    def test_repeated_ids_count_once(self, api):
        a = movement(api, "ABCU1111111", 100)
        created = invoice(api, a["id"], a["id"])
        assert created["movement_ids"] == [a["id"]]
        assert created["total_value"] == 100

    def test_empty_selection(self, api):
        invoice(api, expected=400)

    def test_unknown_movement_blocks_the_whole_invoice(self, api):
        a = movement(api, "ABCU1111111")
        invoice(api, a["id"], "nao-existe", expected=404)
        assert stored(api, a["id"])["billed"] is False
        assert api.run(api.db.invoices.count_documents({})) == 0

    def test_already_billed_movement_is_rejected(self, api):
        a, b = movement(api, "ABCU1111111"), movement(api, "ABCU2222222")
        first = invoice(api, a["id"])
        invoice(api, a["id"], b["id"], expected=400)
        assert stored(api, a["id"])["invoice_id"] == first["id"]
        assert stored(api, b["id"])["billed"] is False

    def test_losing_a_race_releases_what_was_reserved(self, api, monkeypatch):
        # Simula a outra fatura ganhando a corrida entre a checagem e a
        # reserva: "b" passa a estar faturada logo depois de ter sido lida
        # como livre (o cálculo do total acontece entre os dois passos).
        a, b = movement(api, "ABCU1111111"), movement(api, "ABCU2222222")
        import routers.invoices as invoices_router

        sync_movements = api.db.movements._AsyncMongoMockCollection__collection
        original = invoices_router.round_money

        def round_and_steal(value):
            sync_movements.update_one({"id": b["id"]}, {"$set": {"billed": True, "invoice_id": "outra-fatura"}})
            return original(value)

        monkeypatch.setattr(invoices_router, "round_money", round_and_steal)
        invoice(api, a["id"], b["id"], expected=409)
        assert stored(api, a["id"])["billed"] is False
        assert stored(api, b["id"])["invoice_id"] == "outra-fatura"
        assert api.run(api.db.invoices.count_documents({})) == 0


class TestUpdateInvoice:
    def test_add_and_remove(self, api):
        a, b, c = movement(api, "ABCU1111111", 100), movement(api, "ABCU2222222", 50), movement(api, "ABCU3333333", 30)
        created = invoice(api, a["id"], b["id"])
        response = api.put(f"/api/invoices/{created['id']}", json={
            "movement_ids_to_add": [c["id"]], "movement_ids_to_remove": [a["id"]],
        })
        assert response.status_code == 200, response.text
        updated = response.json()
        assert updated["movement_ids"] == [b["id"], c["id"]]
        assert updated["total_value"] == 80
        assert stored(api, a["id"])["billed"] is False
        assert stored(api, c["id"])["invoice_id"] == created["id"]

    def test_cannot_remove_a_movement_of_another_invoice(self, api):
        a, b = movement(api, "ABCU1111111"), movement(api, "ABCU2222222")
        first, second = invoice(api, a["id"]), invoice(api, b["id"])
        response = api.put(f"/api/invoices/{first['id']}", json={"movement_ids_to_remove": [b["id"]]})
        assert response.status_code == 400
        assert stored(api, b["id"])["billed"] is True
        assert stored(api, b["id"])["invoice_id"] == second["id"]

    def test_rejected_edit_changes_nothing(self, api):
        a, b, c = movement(api, "ABCU1111111"), movement(api, "ABCU2222222"), movement(api, "ABCU3333333")
        first = invoice(api, a["id"], b["id"])
        invoice(api, c["id"])
        # Remover "a" seria válido, mas "c" já é de outra fatura: nada pode mudar.
        response = api.put(f"/api/invoices/{first['id']}", json={
            "movement_ids_to_remove": [a["id"]], "movement_ids_to_add": [c["id"]],
        })
        assert response.status_code == 400
        assert stored(api, a["id"])["billed"] is True
        assert stored_invoice(api, first["id"])["movement_ids"] == [a["id"], b["id"]]

    def test_cannot_leave_the_invoice_empty(self, api):
        a = movement(api, "ABCU1111111")
        created = invoice(api, a["id"])
        response = api.put(f"/api/invoices/{created['id']}", json={"movement_ids_to_remove": [a["id"]]})
        assert response.status_code == 400
        assert stored(api, a["id"])["billed"] is True

    def test_adding_unknown_movement(self, api):
        a = movement(api, "ABCU1111111")
        created = invoice(api, a["id"])
        response = api.put(f"/api/invoices/{created['id']}", json={"movement_ids_to_add": ["nao-existe"]})
        assert response.status_code == 404

    def test_basic_fields_and_history(self, api):
        a = movement(api, "ABCU1111111")
        created = invoice(api, a["id"])
        response = api.put(f"/api/invoices/{created['id']}", json={"client_name": "Cliente Novo", "notes": "nota"})
        assert response.json()["client_name"] == "Cliente Novo"
        history = api.get(f"/api/invoices/{created['id']}/history").json()
        assert [h["action"] for h in history] == ["UPDATED", "CREATED"] or [h["action"] for h in history] == ["CREATED", "UPDATED"]


class TestDeleteInvoice:
    def test_delete_releases_the_movements(self, api):
        a = movement(api, "ABCU1111111")
        created = invoice(api, a["id"])
        assert api.delete(f"/api/invoices/{created['id']}").status_code == 200
        assert stored(api, a["id"])["billed"] is False
        assert api.get(f"/api/invoices/{created['id']}").status_code == 404


class TestBilledMovementChanges:
    def test_editing_keeps_the_invoice_link_and_updates_the_total(self, api):
        a, b = movement(api, "ABCU1111111", 100), movement(api, "ABCU2222222", 50)
        created = invoice(api, a["id"], b["id"])
        response = api.put(f"/api/movements/{a['id']}", json={
            **MOVEMENT, "container_number": "ABCU1111111", "service_value": 300,
        })
        assert response.status_code == 200, response.text
        doc = stored(api, a["id"])
        assert doc["billed"] is True and doc["invoice_id"] == created["id"]
        assert stored_invoice(api, created["id"])["total_value"] == 350

    def test_deleting_removes_it_from_the_invoice(self, api):
        a, b = movement(api, "ABCU1111111", 100), movement(api, "ABCU2222222", 50)
        created = invoice(api, a["id"], b["id"])
        assert api.delete(f"/api/movements/{a['id']}").status_code == 200
        doc = stored_invoice(api, created["id"])
        assert doc["movement_ids"] == [b["id"]]
        assert doc["total_value"] == 50

    def test_cannot_delete_the_only_movement_of_an_invoice(self, api):
        a = movement(api, "ABCU1111111")
        created = invoice(api, a["id"])
        response = api.delete(f"/api/movements/{a['id']}")
        assert response.status_code == 400
        assert "Fatura" in response.json()["detail"]
        assert stored(api, a["id"]) is not None
        assert stored_invoice(api, created["id"])["movement_ids"] == [a["id"]]

    def test_invoice_exports_still_work(self, api):
        a = movement(api, "ABCU1111111")
        created = invoice(api, a["id"])
        assert api.get(f"/api/invoices/{created['id']}/pdf").content.startswith(b"%PDF")
        assert api.get(f"/api/invoices/{created['id']}/excel").content.startswith(b"PK")
        assert len(api.get(f"/api/invoices/{created['id']}/movements").json()) == 1
