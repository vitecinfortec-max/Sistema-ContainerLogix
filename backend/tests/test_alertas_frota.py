"""Alertas de vencimento no sino: documentos dos veículos ativos (inclusive o
seguro) e CNH dos motoristas ativos, para qualquer usuário, e só com o módulo
de veículos contratado para os alertas de veículo."""
from datetime import timedelta

from routers.checks import _today


def _seed(api):
    today = _today()
    day = lambda n: (today + timedelta(days=n)).isoformat()
    api.run(api.db.vehicles.insert_many([
        {"id": "v1", "plate": "AAA1A11", "status": "ATIVO", "crlv_expiry": day(-1), "insurance_expiry": day(-3)},
        {"id": "v2", "plate": "BBB2B22", "status": "ATIVO", "insurance_expiry": day(10)},
        {"id": "v3", "plate": "CCC3C33", "status": "ATIVO", "tachograph_expiry": day(31)},   # longe: sem alerta
        {"id": "v4", "plate": "DDD4D44", "status": "INATIVO", "crlv_expiry": day(-50)},     # inativo: sem alerta
        {"id": "v5", "plate": "EEE5E55", "status": "ATIVO", "licensing_expiry": day(0)},    # vence hoje: a vencer
    ]))
    api.run(api.db.drivers.insert_many([
        {"id": "d1", "name": "João", "status": "ATIVO", "cnh_expiry": day(-1)},
        {"id": "d2", "name": "Maria", "status": "ATIVO", "cnh_expiry": day(30)},
        {"id": "d3", "name": "Pedro", "status": "INATIVO", "cnh_expiry": day(-1)},
        {"id": "d4", "name": "Ana", "status": "ATIVO", "cnh_expiry": ""},
    ]))


def test_fleet_alerts(api):
    _seed(api)
    alerts = {a["key"]: a for a in api.get("/api/alerts/summary", as_user="operator").json()["fleet"]}
    assert set(alerts) == {"vehicle_docs_expired", "vehicle_docs_due_soon", "driver_cnh_expired", "driver_cnh_due_soon"}
    assert alerts["vehicle_docs_expired"]["title"] == "1 veículo com documento vencido"
    assert alerts["vehicle_docs_expired"]["description"] == "AAA1A11 (CRLV, Seguro)"
    assert alerts["vehicle_docs_due_soon"]["title"] == "2 veículos com documento vencendo em até 30 dias"
    assert "BBB2B22 (Seguro)" in alerts["vehicle_docs_due_soon"]["description"]
    assert "EEE5E55 (Licenciamento)" in alerts["vehicle_docs_due_soon"]["description"]
    assert alerts["driver_cnh_expired"]["description"] == "João"
    assert alerts["driver_cnh_due_soon"]["description"] == "Maria"
    assert alerts["driver_cnh_expired"]["path"] == "/cadastro?type=motorista"


def test_vehicle_module_disabled(api):
    _seed(api)
    api.run(api.db.module_config.insert_one({"disabled_modules": ["frota.veiculos"]}))
    keys = {a["key"] for a in api.get("/api/alerts/summary").json()["fleet"]}
    assert keys == {"driver_cnh_expired", "driver_cnh_due_soon"}


def test_vehicle_insurance_expiry_saved(api):
    created = api.post("/api/vehicles", json={"plate": "FFF6F66", "vehicle_type": "CAVALO", "insurance_expiry": "2027-01-31"}).json()
    assert created["insurance_expiry"] == "2027-01-31"
    updated = api.put(f"/api/vehicles/{created['id']}", json={"insurance_expiry": None}).json()
    assert updated["insurance_expiry"] is None
