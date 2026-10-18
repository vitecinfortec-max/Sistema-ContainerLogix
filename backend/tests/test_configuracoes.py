"""Grupo Configurações/Admin: login e recuperação sem diferenciar maiúsculas
no email, editar nome/email e redefinir senha de um usuário, conta do dono do
sistema protegida do admin do cliente, módulos bloqueados pelo grupo do
catálogo (não pelo prefixo da chave), Dados da Empresa validando prefixo do
Booking e arquivo do logo, e Configuração de Tanque coerente."""
import pytest

import shared
from shared import is_module_disabled


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    # os logins destes testes não podem esbarrar no limite de tentativas
    shared._rate_limit_attempts.clear()


def _user(api, email="Pessoa@Empresa.com", **over):
    r = api.post("/api/users", json={"name": "Pessoa", "email": email, "password": "segredo1",
                                      "must_change_password": False, **over})
    assert r.status_code == 200, r.text
    return r.json()


def test_login_ignores_email_case_and_spaces(api):
    _user(api)
    r = api.post("/api/auth/login", json={"email": "  pessoa@empresa.COM ", "password": "segredo1"}, as_user=None)
    assert r.status_code == 200, r.text
    # o mesmo email com outra caixa continua sendo duplicado
    assert api.post("/api/users", json={"name": "X", "email": "PESSOA@empresa.com", "password": "segredo1"}).status_code == 400
    assert api.post("/api/users", json={"name": "X", "email": "sem-arroba", "password": "segredo1"}).status_code == 400


def test_admin_edits_profile_and_resets_password(api):
    u = _user(api)
    other = _user(api, email="outra@empresa.com")
    assert api.put(f"/api/users/{u['id']}", json={"name": "Pessoa", "email": "OUTRA@empresa.com"}).status_code == 400
    r = api.put(f"/api/users/{u['id']}", json={"name": " Pessoa Nova ", "email": "nova@empresa.com"})
    assert r.status_code == 200 and r.json()["name"] == "Pessoa Nova"

    token = api.post("/api/auth/login", json={"email": "nova@empresa.com", "password": "segredo1"}, as_user=None).json()["access_token"]
    assert api.put(f"/api/users/{u['id']}/password", json={"password": "123"}).status_code == 400
    r = api.put(f"/api/users/{u['id']}/password", json={"password": "novasenha"})
    assert r.status_code == 200 and r.json()["must_change_password"] is True
    # a sessão aberta antes da redefinição foi encerrada
    assert api.get("/api/auth/me", as_user=None, headers={"Authorization": f"Bearer {token}"}).status_code == 401
    assert api.post("/api/auth/login", json={"email": "nova@empresa.com", "password": "novasenha"}, as_user=None).status_code == 200
    # a própria senha só por "Alterar senha"
    assert api.put("/api/users/admin-1/password", json={"password": "qualquer1"}).status_code == 400
    assert other["id"]


def test_owner_account_is_protected_from_client_admin(api):
    api.run(api.db.users.insert_one({
        "id": "owner-1", "name": "Dono", "email": "dono@sistema.com", "role": "admin", "active": True,
        "is_superadmin": True, "created_at": "2026-01-01T00:00:00+00:00",
    }))
    assert api.put("/api/users/owner-1/status", json={"active": False}).status_code == 403
    assert api.put("/api/users/owner-1/role", json={"role": "operator"}).status_code == 403
    assert api.put("/api/users/owner-1/password", json={"password": "trocada1"}).status_code == 403
    assert api.run(api.db.users.find_one({"id": "owner-1"}))["active"] is True


def test_module_lock_follows_catalog_group():
    # os itens de Abastecimento têm chave "frota.*"
    assert is_module_disabled("frota.abastecimento", ["abastecimento"]) is True
    assert is_module_disabled("frota.abastecimento", ["frota"]) is False
    assert is_module_disabled("frota.revisao", ["frota"]) is True
    assert is_module_disabled("terminal.movimentacoes", ["terminal"]) is True


def test_company_settings_validation(api):
    r = api.put("/api/company-settings", json={"auto_booking_prefix": " tll "})
    assert r.status_code == 200 and r.json()["auto_booking_prefix"] == "TLL"
    assert api.put("/api/company-settings", json={"auto_booking_prefix": "T L L"}).status_code == 400
    assert api.put("/api/company-settings", json={"logo_filename": "../.env"}).status_code == 400
    assert api.put("/api/company-settings", json={"email": "contato"}).status_code == 400
    # apagar o logo continua funcionando
    assert api.put("/api/company-settings", json={"logo_filename": ""}).status_code == 200


@pytest.mark.parametrize("capacity,minimum,ok", [
    (5000, 500, True), (0, 0, False), (5000, -1, False), (5000, 5000, False),
])
def test_tank_settings_validation(api, capacity, minimum, ok):
    r = api.put("/api/tank-settings", json={"capacity_liters": capacity, "minimum_alert_liters": minimum})
    assert (r.status_code == 200) is ok
