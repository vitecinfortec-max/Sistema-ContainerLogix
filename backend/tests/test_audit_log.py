"""Log de auditoria geral (audit.py + routers/audit_log.py): criação,
alteração campo a campo e exclusão com cópia do que foi apagado, sem senhas
no log, filtros da consulta e acesso só para administradores."""
from datetime import timedelta

from routers.checks import _today


def _check(**over):
    body = {"check_number": "000123", "bank": "Itaú", "payee": "Fornecedor Um", "amount": 100,
            "issue_date": _today().isoformat(), "due_date": _today().isoformat()}
    body.update(over)
    return body


def _log(api, **params):
    r = api.get("/api/audit-log", params=params)
    assert r.status_code == 200, r.text
    return r.json()["items"]


def test_create_update_delete_are_logged(api):
    check = api.post("/api/checks", json=_check()).json()
    api.put(f"/api/checks/{check['id']}", json=_check(amount=250.5, payee="Fornecedor Dois"))
    api.delete(f"/api/checks/{check['id']}")

    rows = _log(api)
    assert [r["action"] for r in rows] == ["delete", "update", "create"]
    assert {r["user_name"] for r in rows} == {"Admin Teste"}
    assert {r["area"] for r in rows} == {"Controle de Cheque"}
    assert {r["label"] for r in rows} == {"000123"}
    assert rows[1]["changed_fields"] == ["amount", "payee"]

    update = api.get(f"/api/audit-log/{rows[1]['id']}").json()
    assert update["changes"]["amount"] == {"from": 100, "to": 250.5}
    assert "updated_at" not in update["changes"]

    deleted = api.get(f"/api/audit-log/{rows[0]['id']}").json()
    assert deleted["data"]["payee"] == "Fornecedor Dois" and deleted["data"]["amount"] == 250.5
    assert deleted["method"] == "DELETE" and deleted["path"] == f"/api/checks/{check['id']}"

    history = api.get(f"/api/audit-log/record/{check['id']}").json()
    assert [h["action"] for h in history] == ["create", "update", "delete"]


def test_unchanged_save_and_internal_writes_are_not_logged(api):
    check = api.post("/api/checks", json=_check()).json()
    api.put(f"/api/checks/{check['id']}", json=_check())  # nada mudou além de updated_at
    # gravação sem usuário (rotina do sistema, preparação do teste) não entra
    api.run(api.db.checks.insert_one({"id": "x", "check_number": "999"}))
    assert [r["action"] for r in _log(api)] == ["create"]
    # contadores internos também não
    assert all(r["collection"] != "counters" for r in _log(api))


def test_passwords_never_reach_the_log(api):
    r = api.post("/api/users", json={"name": "Maria Souza", "email": "maria@teste.local", "password": "Senha@12345", "role": "operator"})
    assert r.status_code == 200, r.text
    entry_id = _log(api, action="create")[0]["id"]
    data = api.get(f"/api/audit-log/{entry_id}").json()["data"]
    assert data["email"] == "maria@teste.local"
    secrets = {k: v for k, v in data.items() if "password" in k or "hash" in k}
    assert secrets and set(secrets.values()) == {"***"}
    assert "Senha@12345" not in str(data)


def test_filters_and_admin_only(api):
    api.post("/api/checks", json=_check())
    api.post("/api/checks", json=_check(check_number="000124"))
    today = _today().isoformat()
    tomorrow = (_today() + timedelta(days=1)).isoformat()

    assert len(_log(api, date_from=today, date_to=today)) == 2
    assert _log(api, date_from=tomorrow) == []
    assert len(_log(api, user_id="admin-1")) == 2
    assert _log(api, user_id="oper-1") == []
    assert len(_log(api, area="financeiro.controle_cheque")) == 2
    assert [r["label"] for r in _log(api, search="124")] == ["000124"]
    assert api.get("/api/audit-log", params={"action": "xpto"}).status_code == 422

    filters = api.get("/api/audit-log/filters").json()
    assert filters["users"] == [{"id": "admin-1", "name": "Admin Teste"}]
    assert {"key": "financeiro.controle_cheque", "label": "Controle de Cheque"} in filters["areas"]

    assert api.get("/api/audit-log", as_user="operator").status_code == 403
