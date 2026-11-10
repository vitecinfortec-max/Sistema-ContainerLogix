"""Densidade da tela por usuário (10/11/2026): Compacto / Normal / Confortável,
salva no perfil e devolvida no /auth/me."""
import pytest


@pytest.fixture(autouse=True)
def _created_at(api):
    # Os usuários da fixture não têm created_at, que o /auth/me exige
    api.run(api.db.users.update_many({}, {"$set": {"created_at": "2026-01-01T00:00:00+00:00"}}))


def test_density_defaults_to_normal(api):
    me = api.get("/api/auth/me")
    assert me.status_code == 200, me.text
    assert me.json()["density"] == "normal"


def test_density_is_saved_per_user(api):
    r = api.put("/api/auth/me/preferences", json={"density": "compact"})
    assert r.status_code == 200, r.text
    assert r.json() == {"density": "compact"}
    assert api.get("/api/auth/me").json()["density"] == "compact"
    # outra pessoa não é afetada
    assert api.get("/api/auth/me", as_user="operator").json()["density"] == "normal"


def test_density_rejects_unknown_value(api):
    assert api.put("/api/auth/me/preferences", json={"density": "gigante"}).status_code == 422
