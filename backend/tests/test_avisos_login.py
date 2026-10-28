"""Avisos da tela de login (28/10/2026): o administrador cadastra, a tela de
login (sem token) vê só os ativos e dentro do período."""
from datetime import date, timedelta


def _day(n):
    return (date.today() + timedelta(days=n)).isoformat()


def test_public_list_shows_only_active_in_period(api):
    body = {"title": "Feriado dia 15", "message": "Não haverá expediente.", "link_url": "https://exemplo.com.br/aviso"}
    r = api.post("/api/login-notices", json=body)
    assert r.status_code == 200, r.text
    shown = r.json()
    assert (shown["link_label"], shown["active"]) == ("Saiba mais", True)
    api.post("/api/login-notices", json={"title": "Inativo", "active": False})
    api.post("/api/login-notices", json={"title": "Futuro", "start_date": _day(3)})
    api.post("/api/login-notices", json={"title": "Encerrado", "end_date": _day(-1)})
    api.post("/api/login-notices", json={"title": "Até hoje", "start_date": _day(-2), "end_date": _day(0)})

    public = api.get("/api/login-notices", as_user=None)
    assert public.status_code == 200
    assert {n["title"] for n in public.json()} == {"Feriado dia 15", "Até hoje"}
    assert set(public.json()[0]) == {"id", "title", "message", "link_label", "link_url"}
    assert len(api.get("/api/login-notices/manage").json()) == 5


def test_validation_and_admin_only(api):
    assert api.post("/api/login-notices", json={"title": "  "}).status_code == 400
    assert api.post("/api/login-notices", json={"title": "X", "link_url": "javascript:alert(1)"}).status_code == 400
    assert api.post("/api/login-notices", json={"title": "X", "start_date": _day(2), "end_date": _day(1)}).status_code == 400
    assert api.post("/api/login-notices", json={"title": "X" * 81}).status_code == 400
    assert api.post("/api/login-notices", json={"title": "Oi"}, as_user="operator").status_code == 403
    assert api.get("/api/login-notices/manage", as_user=None).status_code in (401, 403)

    n = api.post("/api/login-notices", json={"title": "Novo sistema", "link_url": "https://a.b", "link_label": "Ver"}).json()
    r = api.put(f"/api/login-notices/{n['id']}", json={"title": "Novo sistema no ar", "active": False})
    assert (r.json()["title"], r.json()["active"], r.json()["link_url"]) == ("Novo sistema no ar", False, None)
    assert api.get("/api/login-notices", as_user=None).json() == []
    assert api.delete(f"/api/login-notices/{n['id']}").status_code == 200
    assert api.delete(f"/api/login-notices/{n['id']}").status_code == 404
