"""
/api/health, usado pelo monitor externo: responde sem login e sem empresa,
200 com o banco no ar e 503 quando o banco não responde.
"""
import server


class _Admin:
    def __init__(self, ok):
        self.ok = ok

    async def command(self, name):
        if not self.ok:
            raise ConnectionError("banco fora do ar")
        return {"ok": 1}


class _FakeClient:
    def __init__(self, ok):
        self.admin = _Admin(ok)


def test_health_ok_without_login_or_tenant(api, monkeypatch):
    monkeypatch.setattr(server, "client", _FakeClient(ok=True))
    monkeypatch.setattr(server, "is_multi_tenant", lambda: True)

    response = api.get("/api/health", as_user=None, headers={})

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": True}


def test_health_reports_database_down(api, monkeypatch):
    monkeypatch.setattr(server, "client", _FakeClient(ok=False))

    response = api.get("/api/health", as_user=None)

    assert response.status_code == 503
    assert response.json()["database"] is False
