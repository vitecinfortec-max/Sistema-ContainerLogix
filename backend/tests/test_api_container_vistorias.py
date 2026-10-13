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
