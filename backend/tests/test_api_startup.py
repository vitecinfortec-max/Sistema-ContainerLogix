"""
Inicialização e encerramento do app (lifespan em server.py), contra o banco
em memória: contadores, índices e agendador sobem, e tudo é liberado ao sair.
"""
import scheduled_reports
import server


class _FakeMongoClient:
    closed = False

    def close(self):
        self.closed = True


def test_lifespan_prepares_and_releases_everything(api, monkeypatch):
    fake_client = _FakeMongoClient()
    monkeypatch.setattr(server, "client", fake_client)
    state = {}

    async def run_lifespan():
        async with server.app.router.lifespan_context(server.app):
            state["scheduler_running"] = scheduled_reports._scheduler is not None and scheduled_reports._scheduler.running
            state["uploads_dir_exists"] = server.UPLOADS_DIR.is_dir()
            state["movement_indexes"] = await api.db.movements.index_information()
            state["lock_indexes"] = await api.db.movement_locks.index_information()
            state["counter"] = await api.db.counters.find_one({"_id": "transaction_id"})

    api.run(run_lifespan())

    assert state["scheduler_running"] is True
    assert state["uploads_dir_exists"] is True
    indexed_fields = {key[0][0] for key in (info["key"] for info in state["movement_indexes"].values())}
    assert {"id", "container_number", "created_at", "transaction_id", "updated_at"} <= indexed_fields
    assert any("expireAfterSeconds" in info for info in state["lock_indexes"].values())
    assert state["counter"] is not None

    # Encerramento: agendador parado e conexão com o banco fechada.
    assert scheduled_reports._scheduler is None
    assert fake_client.closed is True


def test_health_route_answers_without_authentication(api):
    response = api.get("/api/", as_user=None)
    assert response.status_code == 200
    assert response.json() == {"message": "ContainerLogix API"}
