"""Configuração comum dos testes.

Os testes de test_rules_unit.py importam os módulos do backend direto (sem
servidor no ar e sem banco) - auth.py e shared.py exigem essas variáveis já
na importação. setdefault não mexe em nada que o ambiente já tenha definido;
o MONGO_URL de mentira nunca é usado, porque o cliente Mongo só conecta na
primeira consulta e esses testes não fazem nenhuma.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault("JWT_SECRET_KEY", "chave-somente-para-testes")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "containerlogix_testes_unitarios")


# ---------- Testes de API com banco em memória ----------
# Usados por test_api_*.py: o app FastAPI inteiro responde em processo (sem
# servidor no ar) e todo acesso ao banco cai num Mongo de mentira
# (mongomock-motor, ver requirements-dev.txt), criado vazio a cada teste.

import asyncio

import pytest


def _teach_mongomock_date_operators():
    """O mongomock não implementa o operador $toDate, que o Dashboard e os
    relatórios usam pra comparar created_at (gravado como texto ISO). Aqui ele
    ganha a mesma conversão que o Mongo real faz: texto ISO ou datetime ->
    datetime em UTC."""
    from datetime import datetime, timedelta, timezone

    from mongomock import aggregate

    if '$toDate' in aggregate.type_convertion_operators:
        return
    aggregate.type_convertion_operators.append('$toDate')
    original = aggregate._Parser._handle_type_convertion_operator

    def handle(self, operator, values):
        if operator != '$toDate':
            return original(self, operator, values)
        try:
            parsed = self.parse(values)
        except KeyError:
            return None
        if isinstance(parsed, str):
            parsed = datetime.fromisoformat(parsed.replace('Z', '+00:00'))
        # Como o Mongo guarda datas: UTC, sem fuso (o mongomock também
        # converte assim os datetimes que chegam na consulta).
        if isinstance(parsed, datetime) and parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed

    aggregate._Parser._handle_type_convertion_operator = handle

    # $dateToString com "timezone" (que o mongomock recusa por não implementar
    # fusos): "UTC" equivale a não informar; um deslocamento fixo como
    # "-03:00" é aplicado à data antes de formatar, como o Mongo faz.
    original_date = aggregate._Parser._handle_date_operator

    def handle_date(self, operator, values):
        if operator == '$dateToString' and isinstance(values, dict) and 'timezone' in values:
            zone = values['timezone']
            values = {k: v for k, v in values.items() if k != 'timezone'}
            if zone != 'UTC':
                sign = -1 if zone.startswith('-') else 1
                hours, minutes = zone.lstrip('+-').split(':')
                shifted = self.parse(values['date'])
                if shifted is not None:
                    values['date'] = shifted + sign * timedelta(hours=int(hours), minutes=int(minutes))
        return original_date(self, operator, values)

    aggregate._Parser._handle_date_operator = handle_date


class ApiClient:
    """Chamadas HTTP síncronas contra o app, já autenticadas como admin."""

    def __init__(self, app, db, loop, headers):
        import httpx
        self.db = db
        self._loop = loop
        self._headers = headers
        self._client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    def run(self, coroutine):
        return self._loop.run_until_complete(coroutine)

    def request(self, method, path, as_user="admin", **kwargs):
        headers = {**self._headers[as_user], **kwargs.pop("headers", {})} if as_user else kwargs.pop("headers", {})
        return self.run(self._client.request(method, path, headers=headers, **kwargs))

    def get(self, path, **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path, **kwargs):
        return self.request("POST", path, **kwargs)

    def put(self, path, **kwargs):
        return self.request("PUT", path, **kwargs)

    def delete(self, path, **kwargs):
        return self.request("DELETE", path, **kwargs)

    def close(self):
        self.run(self._client.aclose())


@pytest.fixture
def api(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient

    _teach_mongomock_date_operators()
    import server
    import shared
    from auth import create_access_token

    fake_db = AsyncMongoMockClient()["containerlogix_teste"]
    real_db = shared.db
    # Cada router fez "from shared import db" - a troca precisa alcançar a
    # referência guardada em cada módulo, não só a de shared.
    for module in list(sys.modules.values()):
        if getattr(module, "db", None) is real_db:
            monkeypatch.setattr(module, "db", fake_db)
    monkeypatch.setitem(shared._module_config_cache, "value", None)
    monkeypatch.setitem(shared._module_config_cache, "expires_at", 0)

    loop = asyncio.new_event_loop()
    users = [
        {"id": "admin-1", "name": "Admin Teste", "email": "admin@teste.local", "role": "admin", "active": True},
        {"id": "oper-1", "name": "Operador Teste", "email": "oper@teste.local", "role": "user", "active": True},
    ]
    loop.run_until_complete(fake_db.users.insert_many([dict(u) for u in users]))
    headers = {
        key: {"Authorization": "Bearer " + create_access_token({"sub": u["id"], "email": u["email"], "name": u["name"]})}
        for key, u in zip(("admin", "operator"), users)
    }
    client = ApiClient(server.app, fake_db, loop, headers)
    yield client
    client.close()
    loop.close()
