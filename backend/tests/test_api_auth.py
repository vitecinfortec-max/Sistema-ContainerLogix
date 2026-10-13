"""
Testes de API de login, recuperação e troca de senha, contra o app inteiro
com banco em memória (fixture `api` em conftest.py). O envio de e-mail é
substituído por um dublê que guarda a mensagem.
"""
import re

import pytest

import shared
from auth import get_password_hash
from routers import auth as auth_router

EMAIL = "maria@teste.local"
PASSWORD = "senha-original"


@pytest.fixture
def account(api, monkeypatch):
    """Usuária comum com senha conhecida, caixa de e-mail falsa e limite de
    tentativas zerado."""
    api.run(api.db.users.insert_one({
        "id": "maria-1", "name": "Maria", "email": EMAIL, "role": "user", "active": True,
        "password": get_password_hash(PASSWORD), "created_at": "2026-01-01T00:00:00+00:00",
    }))
    api.outbox = []
    monkeypatch.setattr(auth_router.resend.Emails, "send", lambda params: api.outbox.append(params))
    shared._rate_limit_attempts.clear()
    return api


def login(api, password, email=EMAIL):
    return api.post("/api/auth/login", json={"email": email, "password": password}, as_user=None)


def bearer(response):
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def temp_password_from(api):
    html = api.outbox[-1]["html"]
    return re.search(r"letter-spacing: 2px;\">\s*(\w+)\s*<", html).group(1)


def forgot(api, email=EMAIL):
    return api.post("/api/auth/forgot-password", json={"email": email}, as_user=None)


class TestLogin:
    def test_login_and_me(self, account):
        response = login(account, PASSWORD)
        assert response.status_code == 200
        me = account.get("/api/auth/me", as_user=None, headers=bearer(response))
        assert me.json()["email"] == EMAIL

    def test_wrong_password(self, account):
        assert login(account, "errada").status_code == 401

    def test_unknown_email(self, account):
        assert login(account, PASSWORD, email="ninguem@teste.local").status_code == 401

    def test_deactivated_account(self, account):
        account.run(account.db.users.update_one({"id": "maria-1"}, {"$set": {"active": False}}))
        assert login(account, PASSWORD).status_code == 403


class TestForgotPassword:
    def test_request_does_not_touch_the_current_password(self, account):
        assert forgot(account).status_code == 200
        assert len(account.outbox) == 1
        # Quem pediu a recuperação não era necessariamente a dona da conta:
        # a senha atual continua valendo.
        assert login(account, PASSWORD).status_code == 200

    def test_unknown_email_gets_the_same_answer_and_no_email(self, account):
        known, unknown = forgot(account), forgot(account, "ninguem@teste.local")
        assert known.json() == unknown.json()
        assert len(account.outbox) == 1

    def test_failed_email_stores_nothing(self, account, monkeypatch):
        def broken_send(params):
            raise RuntimeError("serviço de e-mail fora do ar")

        monkeypatch.setattr(auth_router.resend.Emails, "send", broken_send)
        assert forgot(account).status_code == 200
        user = account.run(account.db.users.find_one({"id": "maria-1"}))
        assert "temp_password_hash" not in user
        assert login(account, PASSWORD).status_code == 200

    def test_temp_password_logs_in_and_forces_the_change(self, account):
        old_session = bearer(login(account, PASSWORD))
        forgot(account)
        temp = temp_password_from(account)

        response = login(account, temp)
        assert response.status_code == 200
        assert response.json()["user"]["must_change_password"] is True
        session = bearer(response)

        # Entrar com a provisória encerra a sessão antiga e a senha antiga.
        assert account.get("/api/auth/me", as_user=None, headers=old_session).status_code == 401
        assert login(account, PASSWORD).status_code == 401

        # Até trocar a senha, só o necessário pra trocá-la responde.
        assert account.get("/api/auth/me", as_user=None, headers=session).status_code == 200
        assert account.get("/api/module-config", as_user=None, headers=session).status_code == 200
        assert account.get("/api/movements", as_user=None, headers=session).status_code == 403

        changed = account.post(
            "/api/auth/change-password", as_user=None, headers=session,
            json={"current_password": temp, "new_password": "senha-nova-1"},
        )
        assert changed.status_code == 200, changed.text
        new_session = bearer(changed)
        assert account.get("/api/movements", as_user=None, headers=new_session).status_code == 200
        assert login(account, "senha-nova-1").status_code == 200
        assert login(account, temp).status_code == 401

    def test_expired_temp_password_is_refused(self, account):
        forgot(account)
        temp = temp_password_from(account)
        account.run(account.db.users.update_one(
            {"id": "maria-1"}, {"$set": {"temp_password_expires_at": "2020-01-01T00:00:00+00:00"}}
        ))
        assert login(account, temp).status_code == 401
        assert login(account, PASSWORD).status_code == 200


class TestChangePassword:
    def test_change_ends_other_sessions_and_keeps_this_one(self, account):
        this_device = bearer(login(account, PASSWORD))
        other_device = bearer(login(account, PASSWORD))
        changed = account.post(
            "/api/auth/change-password", as_user=None, headers=this_device,
            json={"current_password": PASSWORD, "new_password": "senha-nova-1"},
        )
        assert changed.status_code == 200, changed.text
        assert account.get("/api/auth/me", as_user=None, headers=bearer(changed)).status_code == 200
        assert account.get("/api/auth/me", as_user=None, headers=other_device).status_code == 401
        assert account.get("/api/auth/me", as_user=None, headers=this_device).status_code == 401

    def test_wrong_current_password(self, account):
        session = bearer(login(account, PASSWORD))
        response = account.post(
            "/api/auth/change-password", as_user=None, headers=session,
            json={"current_password": "errada", "new_password": "senha-nova-1"},
        )
        assert response.status_code == 400

    def test_new_password_minimum_length(self, account):
        session = bearer(login(account, PASSWORD))
        response = account.post(
            "/api/auth/change-password", as_user=None, headers=session,
            json={"current_password": PASSWORD, "new_password": "123"},
        )
        assert response.status_code == 400


def test_token_without_password_version_keeps_working_until_a_password_change(api):
    # Sessões abertas antes desta versão não têm "pv" no token: continuam
    # válidas, e só deixam de valer se a conta trocar de senha.
    from datetime import datetime, timedelta, timezone

    from jose import jwt

    import auth

    legacy = jwt.encode(
        {"sub": "admin-1", "email": "admin@teste.local", "name": "Admin Teste",
         "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        auth.SECRET_KEY, algorithm=auth.ALGORITHM,
    )
    headers = {"Authorization": f"Bearer {legacy}"}
    assert api.get("/api/movements", as_user=None, headers=headers).status_code == 200
    api.run(api.db.users.update_one({"id": "admin-1"}, {"$set": {"password_version": 1}}))
    assert api.get("/api/movements", as_user=None, headers=headers).status_code == 401
