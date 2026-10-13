"""
Testes de API da Vistoria de Container, contra o app inteiro com banco em
memória e a pasta de uploads trocada por uma pasta temporária.
"""
import pytest

from routers import container_vistorias

PNG = bytes.fromhex("89504e470d0a1a0a") + b"x" * 32

VISTORIA = {
    "container_number": "ABCU1234567", "client_name": "Cliente Um", "shipping_line": "Armador Um",
    "truck_plate": "AAA0A00", "trailer_plate": "BBB0B00", "transport_company": "Transportadora Um",
    "driver_name": "Motorista Um", "size_type": "40HC", "tare": "3800", "no_damage": True,
}


@pytest.fixture
def vistorias(api, tmp_path, monkeypatch):
    monkeypatch.setattr(container_vistorias, "UPLOADS_DIR", tmp_path)
    return api


def create(api, **overrides):
    response = api.post("/api/container-vistorias", json={**VISTORIA, **overrides})
    assert response.status_code == 200, response.text
    return response.json()


def upload(api, vistoria_id, photo_type):
    return api.post(
        f"/api/container-vistorias/{vistoria_id}/upload-photo", params={"type": photo_type},
        files={"file": ("foto.png", PNG, "image/png")},
    )


class TestDriverName:
    def test_driver_name_is_stored_and_returned(self, vistorias):
        created = create(vistorias)
        fetched = vistorias.get(f"/api/container-vistorias/{created['id']}").json()
        assert created["driver_name"] == fetched["driver_name"] == "Motorista Um"

    def test_driver_name_is_optional(self, vistorias):
        assert create(vistorias, driver_name=None)["driver_name"] is None

    def test_driver_name_can_be_edited(self, vistorias):
        created = create(vistorias)
        edited = vistorias.put(f"/api/container-vistorias/{created['id']}", json={"driver_name": "Motorista Dois"})
        assert edited.status_code == 200, edited.text
        assert edited.json()["driver_name"] == "Motorista Dois"
        assert edited.json()["truck_plate"] == "AAA0A00"


class TestCscPlatePhoto:
    def test_csc_plate_photo_is_accepted(self, vistorias):
        created = create(vistorias)
        response = upload(vistorias, created["id"], "csc_plate")
        assert response.status_code == 200, response.text
        photos = vistorias.get(f"/api/container-vistorias/{created['id']}").json()["photos"]
        assert [p["type"] for p in photos] == ["csc_plate"]

    def test_unknown_photo_type_is_still_refused(self, vistorias):
        created = create(vistorias)
        assert upload(vistorias, created["id"], "qualquer").status_code == 422


class TestEntryEirLink:
    def test_new_vistoria_has_no_eir(self, vistorias):
        created = create(vistorias)
        assert created["movement_id"] is None and created["movement_transaction_id"] is None

    def test_generated_eir_is_recorded_on_the_vistoria(self, vistorias):
        created = create(vistorias)
        linked = vistorias.put(
            f"/api/container-vistorias/{created['id']}", json={"movement_id": "mov-1", "movement_transaction_id": 42}
        ).json()
        assert linked["movement_id"] == "mov-1" and linked["movement_transaction_id"] == 42
        # Editar a vistoria depois não apaga o vínculo
        edited = vistorias.put(f"/api/container-vistorias/{created['id']}", json={"tare": "3900"}).json()
        assert edited["movement_id"] == "mov-1" and edited["tare"] == "3900"


class TestPreRegistration:
    """Salvar a vistoria cria o pré-cadastro do que ainda não existe."""
    NEW = {"driver_cpf": "111.222.333-44"}

    def cadastros(self, api):
        vehicles = api.get("/api/vehicles", params={"per_page": 1000}).json()["items"]
        return {
            "drivers": api.get("/api/drivers").json(),
            "companies": api.get("/api/transport-companies").json(),
            "vehicles": {v["plate"]: v["vehicle_type"] for v in vehicles},
        }

    def test_cpf_is_stored(self, vistorias):
        created = create(vistorias, **self.NEW)
        assert vistorias.get(f"/api/container-vistorias/{created['id']}").json()["driver_cpf"] == "111.222.333-44"

    def test_missing_cadastros_are_created(self, vistorias):
        created = create(vistorias, **self.NEW)
        assert created["pre_registered"] == ["Transportadora", "Motorista", "Cavalo", "Carreta"]
        found = self.cadastros(vistorias)
        assert [(d["name"], d["cpf"], d["transport_company"]) for d in found["drivers"]] == [
            ("Motorista Um", "111.222.333-44", "Transportadora Um")
        ]
        assert [c["name"] for c in found["companies"]] == ["Transportadora Um"]
        assert found["vehicles"] == {"AAA0A00": "CAVALO", "BBB0B00": "CARRETA"}
        assert "VC000001" in found["drivers"][0]["observations"]

    def test_existing_cadastros_are_left_alone(self, vistorias):
        create(vistorias, **self.NEW)
        # Mesmos dados com outra grafia: nada novo, nada alterado
        again = create(
            vistorias, driver_name="motorista um", driver_cpf="11122233344", truck_plate="aaa-0a00",
            trailer_plate="BBB0B00", transport_company=" TRANSPORTADORA UM ",
        )
        assert again["pre_registered"] == []
        found = self.cadastros(vistorias)
        assert len(found["drivers"]) == 1 and found["drivers"][0]["cpf"] == "111.222.333-44"
        assert len(found["companies"]) == 1 and len(found["vehicles"]) == 2

    def test_driver_without_cpf_is_not_registered(self, vistorias):
        created = create(vistorias)
        assert created["pre_registered"] == ["Transportadora", "Cavalo", "Carreta"]
        assert self.cadastros(vistorias)["drivers"] == []

    def test_empty_vistoria_registers_nothing(self, vistorias):
        created = vistorias.post("/api/container-vistorias", json={"container_number": "ABCU1234567"}).json()
        assert created["pre_registered"] == []

    def test_editing_registers_what_was_added_later(self, vistorias):
        created = vistorias.post("/api/container-vistorias", json={"container_number": "ABCU1234567"}).json()
        edited = vistorias.put(
            f"/api/container-vistorias/{created['id']}", json={"driver_name": "Motorista Dois", "driver_cpf": "999.888.777-66"}
        ).json()
        assert edited["pre_registered"] == ["Motorista"]
        assert [d["name"] for d in self.cadastros(vistorias)["drivers"]] == ["Motorista Dois"]
