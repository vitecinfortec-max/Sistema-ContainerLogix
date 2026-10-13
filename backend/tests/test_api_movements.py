"""
Testes de API das rotas de movimentação, Controle de Pátio, Dashboard e
relatórios, contra o app inteiro com banco em memória (fixture `api` em
conftest.py). Rodam com `pytest tests/test_api_movements.py`, sem servidor
nem Mongo no ar.

Servem de rede de segurança pra mexer na organização desses routers: fixam o
comportamento visível pela API (status, campos e regras), não a forma do
código.
"""

MOVEMENT = dict(
    operation_type="ENTRADA", driver_name="Motorista Um", driver_cpf="11122233344", truck_plate="AAA0A00",
    trailer_plate_1="BBB0B00", transport_company="Transportadora Um", client_name="Cliente Um",
    container_number="ABCU1234567", status="CHEIO", size_type="20DC", shipping_line="Armador Um",
    service_type="Armazenagem", service_value=150.0, currency="BRL", observations="obs de teste",
)


def create(api, **overrides):
    response = api.post("/api/movements", json={**MOVEMENT, **overrides})
    assert response.status_code == 200, response.text
    return response.json()


def seed_yard(api):
    """Dois containers em estoque e um que já saiu."""
    create(api)
    create(api, container_number="ABCU2222222", status="VAZIO", client_name="Cliente Dois")
    create(api, container_number="ABCU3333333")
    create(api, container_number="ABCU3333333", operation_type="SAIDA")


# ---------- Autenticação ----------

def test_requires_authentication(api):
    assert api.get("/api/movements", as_user=None).status_code in (401, 403)


def test_admin_only_routes_reject_common_user(api):
    assert api.get("/api/reports/billing/pdf", as_user="operator").status_code == 403


# ---------- Emissão de EIR ----------

class TestMovementCrud:
    def test_create_returns_and_stores_the_movement(self, api):
        created = create(api, container_number=" abcu1234567 ")
        assert created["container_number"] == "ABCU1234567"
        assert created["transaction_id"] == 1
        assert created["user_name"] == "Admin Teste"
        assert created["billed"] is False

        fetched = api.get(f"/api/movements/{created['id']}").json()
        for field in ("container_number", "client_name", "service_value", "currency", "observations", "driver_cpf"):
            assert fetched[field] == created[field], field

    def test_transaction_id_is_sequential(self, api):
        first = create(api)
        second = create(api, container_number="ABCU2222222")
        assert second["transaction_id"] == first["transaction_id"] + 1

    def test_second_entry_in_a_row_is_blocked(self, api):
        create(api)
        response = api.post("/api/movements", json=MOVEMENT)
        assert response.status_code == 400
        assert "duplicidade" in response.json()["detail"]

    def test_exit_after_entry_is_allowed(self, api):
        create(api)
        assert create(api, operation_type="SAIDA")["operation_type"] == "SAIDA"

    def test_invalid_payload_is_rejected(self, api):
        assert api.post("/api/movements", json={**MOVEMENT, "service_value": -5}).status_code == 422
        assert api.post("/api/movements", json={**MOVEMENT, "currency": "EUR"}).status_code == 422

    def test_update_keeps_identity_and_changes_fields(self, api):
        created = create(api)
        response = api.put(f"/api/movements/{created['id']}", json={**MOVEMENT, "seal": "LACRE9", "service_value": 200})
        assert response.status_code == 200, response.text
        updated = response.json()
        assert updated["seal"] == "LACRE9"
        assert updated["service_value"] == 200
        assert updated["transaction_id"] == created["transaction_id"]
        assert updated["created_at"] == created["created_at"]

    def test_update_unknown_movement(self, api):
        assert api.put("/api/movements/nao-existe", json=MOVEMENT).status_code == 404

    def test_delete(self, api):
        created = create(api)
        assert api.delete(f"/api/movements/{created['id']}").status_code == 200
        assert api.get(f"/api/movements/{created['id']}").status_code == 404
        assert api.delete(f"/api/movements/{created['id']}").status_code == 404

    def test_billed_movement_is_locked_for_common_user(self, api):
        created = create(api)
        api.run(api.db.movements.update_one({"id": created["id"]}, {"$set": {"billed": True}}))
        assert api.put(f"/api/movements/{created['id']}", json=MOVEMENT, as_user="operator").status_code == 403
        assert api.delete(f"/api/movements/{created['id']}", as_user="operator").status_code == 403
        assert api.put(f"/api/movements/{created['id']}", json=MOVEMENT).status_code == 200


class TestMovementQueries:
    def test_list_all(self, api):
        seed_yard(api)
        movements = api.get("/api/movements").json()
        assert len(movements) == 4
        assert {"buyer_name", "observations", "loading_order_id"} <= set(movements[0])

    def test_list_filters(self, api):
        seed_yard(api)
        assert len(api.get("/api/movements", params={"operation_type": "SAIDA"}).json()) == 1
        assert len(api.get("/api/movements", params={"status_filter": "VAZIO"}).json()) == 1
        assert len(api.get("/api/movements", params={"container_number": "abcu3333"}).json()) == 2
        assert len(api.get("/api/movements", params={"client_name": "dois"}).json()) == 1
        assert len(api.get("/api/movements", params={"transaction_id": "2"}).json()) == 1
        assert api.get("/api/movements", params={"transaction_id": "abc"}).json() == []

    def test_list_paginated(self, api):
        seed_yard(api)
        page = api.get("/api/movements", params={"page": 2, "per_page": 3}).json()
        assert (page["total"], page["pages"], page["page"], len(page["items"])) == (4, 2, 2, 1)

    def test_list_rejects_bad_pagination_and_dates(self, api):
        assert api.get("/api/movements", params={"per_page": 5000}).status_code == 422
        assert api.get("/api/movements", params={"page": 0}).status_code == 422
        assert api.get("/api/movements", params={"date_from": "12/10/2026"}).status_code == 400

    def test_current_stock_filter(self, api):
        seed_yard(api)
        in_stock = api.get("/api/movements", params={"operation_type": "ESTOQUE"}).json()
        assert sorted(m["container_number"] for m in in_stock) == ["ABCU1234567", "ABCU2222222"]

    def test_unbilled(self, api):
        seed_yard(api)
        first = api.get("/api/movements").json()[0]
        api.run(api.db.movements.update_one({"id": first["id"]}, {"$set": {"billed": True}}))
        unbilled = api.get("/api/movements/unbilled").json()
        assert len(unbilled) == 3
        assert all(m["billed"] is False for m in unbilled)

    def test_last_for_container_and_open_entry(self, api):
        seed_yard(api)
        last = api.get("/api/movements/last-for-container/ABCU3333333").json()["movement"]
        assert last["operation_type"] == "SAIDA"
        assert api.get("/api/movements/last-for-container/ZZZU0000000").json() == {"movement": None}
        assert api.get("/api/movements/open-entry/ABCU1234567").status_code == 200

    def test_find_for_invoice(self, api):
        seed_yard(api)
        assert api.get("/api/movements/find-for-invoice", params={"search": "ABCU2222222"}).status_code == 200

    def test_sync_state_changes_on_create_edit_and_delete(self, api):
        empty = api.get("/api/movements/sync-state").json()
        assert empty == {"count": 0, "last_created_at": None, "last_updated_at": None}

        created = create(api)
        after_create = api.get("/api/movements/sync-state").json()
        assert after_create["count"] == 1 and after_create["last_created_at"]

        api.put(f"/api/movements/{created['id']}", json=MOVEMENT)
        after_edit = api.get("/api/movements/sync-state").json()
        assert after_edit["last_updated_at"] and after_edit != after_create

        api.delete(f"/api/movements/{created['id']}")
        assert api.get("/api/movements/sync-state").json()["count"] == 0

    def test_voucher_pdf(self, api):
        created = create(api)
        response = api.post("/api/movements/pdf", json={"movement_ids": [created["id"]], "via": "MOTORISTA"})
        assert response.status_code == 200
        assert response.content.startswith(b"%PDF")


# ---------- Dashboard, busca e atalhos ----------

class TestDashboard:
    def test_dashboard_stats(self, api):
        seed_yard(api)
        response = api.get("/api/dashboard")
        assert response.status_code == 200, response.text
        stats = response.json()
        assert len(stats["recent_movements"]) == 4
        assert stats["recent_movements"][0]["client_name"]

    def test_dashboard_survives_legacy_quick_exit_document(self, api):
        seed_yard(api)
        api.run(api.db.movements.insert_one({
            "id": "legado-1", "transaction_id": 900, "operation_type": "SAIDA", "container_number": "ABCU1234567",
            "status": "CHEIO", "size_type": "20DC", "shipping_line": "Armador Um", "driver_name": None,
            "vehicle_plate": "CCC0C00", "transport_company_name": "Transportadora Dois",
            "created_by": "admin-1", "created_by_name": "Admin Teste",
            "created_at": "2099-01-01T00:00:00+00:00", "updated_at": None,
        }))
        response = api.get("/api/dashboard")
        assert response.status_code == 200, response.text
        assert response.json()["recent_movements"][0]["truck_plate"] == "CCC0C00"

    def test_search(self, api):
        seed_yard(api)
        assert api.get("/api/search", params={"q": "ABCU2222"}).status_code == 200

    def test_alerts_summary(self, api):
        seed_yard(api)
        summary = api.get("/api/alerts/summary").json()
        assert summary["yard_over_30_days"] == 0

    def test_user_shortcuts_roundtrip(self, api):
        assert api.get("/api/user/shortcuts").status_code == 200
        assert api.put("/api/user/shortcuts", json={"shortcuts": ["movements", "billing"]}).status_code == 200
        assert "movements" in str(api.get("/api/user/shortcuts").json())


# ---------- Controle de Pátio ----------

class TestYardControl:
    def test_yard_lists_stock_and_exits(self, api):
        seed_yard(api)
        data = api.get("/api/yard-control").json()
        in_stock = sorted(c["container_number"] for c in data["containers"] if c["in_stock"])
        exited = [c["container_number"] for c in data["containers"] if not c["in_stock"]]
        assert in_stock == ["ABCU1234567", "ABCU2222222"]
        assert exited == ["ABCU3333333"]

    def test_yard_filters(self, api):
        seed_yard(api)
        only_stock = api.get("/api/yard-control", params={"movement_type": "ESTOQUE"}).json()["containers"]
        assert len(only_stock) == 2
        only_exits = api.get("/api/yard-control", params={"movement_type": "SAIDA"}).json()["containers"]
        assert [c["container_number"] for c in only_exits] == ["ABCU3333333"]
        by_client = api.get("/api/yard-control", params={"client_name": "cliente dois"}).json()["containers"]
        assert [c["container_number"] for c in by_client] == ["ABCU2222222"]
        assert api.get("/api/yard-control", params={"date_from": "ontem"}).status_code == 400

    def test_yard_exports(self, api):
        seed_yard(api)
        assert api.get("/api/yard-control/pdf").content.startswith(b"%PDF")
        assert api.get("/api/yard-control/excel").content.startswith(b"PK")

    def test_quick_exit(self, api):
        entry = create(api)
        api.run(api.db.drivers.insert_one({"id": "d1", "name": "Motorista Dois", "cpf": "99988877766"}))
        response = api.post("/api/yard-control/quick-exit", json={
            "entry_movement_id": entry["id"], "driver_id": "d1", "driver_name": "Motorista Dois",
            "vehicle_plate": "DDD0D00", "transport_company_name": "Transportadora Dois",
        })
        assert response.status_code == 200, response.text
        exit_movement = api.get("/api/movements", params={"operation_type": "SAIDA"}).json()[0]
        assert exit_movement["truck_plate"] == "DDD0D00"
        assert exit_movement["driver_cpf"] == "99988877766"
        assert exit_movement["client_name"] == "Cliente Um"
        assert exit_movement["transaction_id"] == response.json()["transaction_id"]

        again = api.post("/api/yard-control/quick-exit", json={"entry_movement_id": entry["id"]})
        assert again.status_code == 400

    def test_quick_exit_unknown_entry(self, api):
        assert api.post("/api/yard-control/quick-exit", json={"entry_movement_id": "nao-existe"}).status_code == 404

    def test_quick_exit_respects_unit_segregation(self, api):
        entry = create(api)
        api.run(api.db.unit_segregations.insert_one({
            "id": "seg-1", "status": "ATIVO", "client_name": "Outro Cliente",
            "items": [{"container_number": "ABCU1234567", "retrieved": False}],
        }))
        response = api.post("/api/yard-control/quick-exit", json={"entry_movement_id": entry["id"]})
        assert response.status_code == 400
        assert "segregado" in response.json()["detail"]


# ---------- Relatórios ----------

class TestReports:
    def test_movement_reports(self, api):
        seed_yard(api)
        assert api.get("/api/reports/pdf").content.startswith(b"%PDF")
        assert api.get("/api/reports/excel").content.startswith(b"PK")
        assert api.get("/api/reports/pdf", params={"operation_type": "ESTOQUE"}).content.startswith(b"%PDF")
        period = {"date_from": "2020-01-01", "date_to": "2099-12-31"}
        assert api.get("/api/reports/excel", params=period).content.startswith(b"PK")
        assert api.get("/api/reports/pdf", params={"date_from": "invalida"}).status_code == 400

    def test_billing_reports(self, api):
        seed_yard(api)
        assert api.get("/api/reports/billing/pdf").content.startswith(b"%PDF")
        assert api.get("/api/reports/billing/excel").content.startswith(b"PK")
        assert api.get("/api/reports/billing/daily-chart").status_code == 200
        ids = [m["id"] for m in api.get("/api/movements").json()]
        assert api.post("/api/billing/report", json={"movement_ids": ids}).content.startswith(b"PK")

    def test_storage_overage_reports(self, api):
        seed_yard(api)
        assert api.get("/api/reports/storage-overage/pdf").content.startswith(b"%PDF")
        assert api.get("/api/reports/storage-overage/excel").content.startswith(b"PK")

    def test_storage_overage_counts_from_the_brasilia_entry_day(self, api):
        # Entrada em 01/10 às 22:30 de Brasília (já é 02/10 em UTC), free time de 5 dias.
        api.run(api.db.movements.insert_one({
            **MOVEMENT, "id": "diaria-1", "transaction_id": 500,
            "created_at": "2026-10-02T01:30:00+00:00", "created_by": "admin-1", "user_name": "Admin Teste",
        }))
        api.run(api.db.service_price_entries.insert_one({
            "id": "tab-1", "billing_type": "DIARIA", "status": "ATIVO", "client_name": "Cliente Um",
            "service_type_name": "Diária de Armazenagem", "free_time_days": 5, "value": 10.0, "currency": "BRL",
        }))
        from datetime import date

        from routers.movement_reports import _compute_storage_overage_charges
        charges = api.run(_compute_storage_overage_charges(None, None, None, date(2026, 10, 12)))
        assert [c["container_number"] for c in charges] == ["ABCU1234567"]
        # 01/10 + 5 dias de free time = 06/10; de 06/10 a 12/10 são 6 diárias.
        assert charges[0]["extra_days"] == 6
        assert charges[0]["service_value"] == 60.0
