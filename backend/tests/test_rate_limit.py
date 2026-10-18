"""Limites de requisições: regra por tipo de rota, limite geral por usuário
(gravações e PDF/Excel), troca de senha, IP real atrás do proxy e limpeza
das chaves antigas da memória."""
from types import SimpleNamespace

import shared
from shared import rate_limit_rule


def test_rules_by_route():
    assert rate_limit_rule("GET", "/api/clients") is None
    assert rate_limit_rule("OPTIONS", "/api/clients") is None
    assert rate_limit_rule("POST", "/api/auth/login") is None  # limite próprio
    assert rate_limit_rule("GET", "/api/reports/billing/excel")[0] == "export"
    assert rate_limit_rule("GET", "/api/yard-control/pdf")[0] == "export"
    assert rate_limit_rule("GET", "/api/stock/ledger/pdf")[0] == "export"
    assert rate_limit_rule("GET", "/api/freight-payments/report/excel")[0] == "export"
    # Documento de um registro só: o download em lote pede um por vez
    assert rate_limit_rule("GET", "/api/invoices/abc/pdf")[0] == "document"
    assert rate_limit_rule("GET", "/api/container-vistorias/abc/pdf")[0] == "document"
    assert rate_limit_rule("GET", "/api/container-inspections/abc/pdf")[0] == "document"
    assert rate_limit_rule("POST", "/api/movements/pdf")[0] == "document"
    assert rate_limit_rule("POST", "/api/upload-photo")[0] == "upload"
    assert rate_limit_rule("DELETE", "/api/clients/1")[0] == "write"
    assert rate_limit_rule("GET", "/") is None


def test_exports_are_limited_per_user(api, monkeypatch):
    monkeypatch.setattr(shared, "rate_limit_rule", lambda method, path: ("export", 2, 60) if path.endswith("/pdf") else None)
    import server
    monkeypatch.setattr(server, "rate_limit_rule", shared.rate_limit_rule)

    assert api.get("/api/stock/movements/nao-existe/pdf").status_code == 404
    assert api.get("/api/stock/movements/nao-existe/pdf").status_code == 404
    blocked = api.get("/api/stock/movements/nao-existe/pdf")
    assert blocked.status_code == 429
    # outro usuário tem o próprio limite
    assert api.get("/api/stock/movements/nao-existe/pdf", as_user="operator").status_code == 404


def test_batch_of_documents_is_not_blocked(api):
    # Download em lote de 40 vistorias marcadas: passava do limite de 30 dos
    # relatórios e os últimos PDFs ficavam de fora do .zip
    for _ in range(40):
        assert api.get("/api/container-vistorias/nao-existe/pdf").status_code == 404


def test_change_password_attempts_are_limited(api):
    from auth import get_password_hash
    api.run(api.db.users.update_one({"id": "admin-1"}, {"$set": {
        "password": get_password_hash("certa123"), "created_at": "2026-01-01T00:00:00+00:00",
    }}))
    for _ in range(5):
        r = api.post("/api/auth/change-password", json={"current_password": "errada", "new_password": "novasenha"})
        assert r.status_code == 400
    r = api.post("/api/auth/change-password", json={"current_password": "certa123", "new_password": "novasenha"})
    assert r.status_code == 429


def _request(host, forwarded=None):
    headers = {"x-forwarded-for": forwarded} if forwarded else {}
    return SimpleNamespace(client=SimpleNamespace(host=host), headers=headers)


def test_client_ip_behind_proxy(monkeypatch):
    monkeypatch.setattr(shared, "_TRUST_PROXY_HEADERS", True)
    # o último IP é o que o proxy acrescentou; o primeiro pode ser inventado
    assert shared.client_ip(_request("10.0.0.1", "1.1.1.1, 200.10.20.30")) == "200.10.20.30"
    assert shared.client_ip(_request("10.0.0.1")) == "10.0.0.1"
    monkeypatch.setattr(shared, "_TRUST_PROXY_HEADERS", False)
    assert shared.client_ip(_request("10.0.0.1", "200.10.20.30")) == "10.0.0.1"


def test_old_keys_are_swept(monkeypatch):
    shared._rate_limit_attempts.clear()
    shared._rate_limit_attempts["login:email:velho@x.com"] = [0.0]
    monkeypatch.setitem(shared._rate_limit_last_sweep, "at", 0.0)
    assert shared.rate_limit_exceeded("login:email:novo@x.com", 5, 300) is False
    assert "login:email:velho@x.com" not in shared._rate_limit_attempts
    assert "login:email:novo@x.com" in shared._rate_limit_attempts
