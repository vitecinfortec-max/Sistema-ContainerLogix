"""Plano de Manutenção: itens por tipo de veículo vencendo por km ou dias (o
que chegar primeiro), execução recomeça a contagem, alertas no sino e e-mail
diário só quando há algo a avisar."""
from datetime import date, timedelta

import routers.maintenance_plans as plans_router


def _days_ago(n: int) -> str:
    return (plans_router._today() - timedelta(days=n)).isoformat()


def _seed(api):
    db = api.db
    api.run(db.vehicles.insert_many([
        {"id": "vh-1", "plate": "ABC1D23", "model": "FH 540", "vehicle_type": "CAVALO", "status": "ATIVO"},
        {"id": "vh-2", "plate": "XYZ9K87", "model": "Actros", "vehicle_type": "CAVALO", "status": "ATIVO"},
        {"id": "vh-3", "plate": "CAR0A00", "vehicle_type": "CARRETA", "status": "ATIVO"},
        {"id": "vh-4", "plate": "OLD0A00", "vehicle_type": "CAVALO", "status": "INATIVO"},
    ]))
    api.run(db.odometer_readings.insert_one({"id": "od-1", "vehicle_id": "vh-1", "km": 119_500}))


def _plan_body(**over):
    body = {
        "name": "Cavalo mecânico",
        "vehicle_types": ["CAVALO"],
        "items": [
            {"name": "Troca de óleo do motor", "interval_km": 20_000, "interval_days": 180, "alert_km": 1000, "alert_days": 15},
            {"name": "Lubrificação", "interval_days": 30, "alert_days": 5},
        ],
    }
    body.update(over)
    return body


def _execute(api, plan, item_index, vehicle_id, executed_date, km=None):
    return api.post("/api/maintenance-executions", json={
        "plan_id": plan["id"], "item_id": plan["items"][item_index]["id"], "vehicle_id": vehicle_id,
        "executed_date": executed_date, "km": km,
    })


def test_plan_validation(api):
    _seed(api)
    assert api.post("/api/maintenance-plans", json=_plan_body(vehicle_types=[])).status_code == 400
    assert api.post("/api/maintenance-plans", json=_plan_body(vehicle_types=["NAVIO"])).status_code == 400
    r = api.post("/api/maintenance-plans", json=_plan_body(items=[{"name": "Sem intervalo"}]))
    assert r.status_code == 400 and "intervalo" in r.json()["detail"]
    r = api.post("/api/maintenance-plans", json=_plan_body(items=[{"name": "Óleo", "interval_km": 1}, {"name": "óleo ", "interval_km": 2}]))
    assert r.status_code == 400 and "duas vezes" in r.json()["detail"]
    plan = api.post("/api/maintenance-plans", json=_plan_body()).json()
    assert plan["active"] is True and len(plan["items"]) == 2 and plan["items"][0]["id"]


def test_status_by_km_and_days(api):
    _seed(api)
    plan = api.post("/api/maintenance-plans", json=_plan_body()).json()

    rows = api.get("/api/maintenance-plans-status").json()
    # 2 cavalos ativos x 2 itens; carreta e inativo ficam de fora
    assert {(r["vehicle_plate"], r["status"]) for r in rows["items"]} == {
        ("ABC1D23", "NO_HISTORY"), ("XYZ9K87", "NO_HISTORY"),
    }
    assert rows["summary"]["NO_HISTORY"] == 4

    # óleo feito a 100.000 km: vence a 120.000; hodômetro em 119.500 -> faltam 500 (<= 1000) = vencendo
    assert _execute(api, plan, 0, "vh-1", _days_ago(10), km=100_000).status_code == 200
    # lubrificação há 40 dias, intervalo 30 -> vencida
    assert _execute(api, plan, 1, "vh-1", _days_ago(40)).status_code == 200
    # outro veículo: óleo em dia
    assert _execute(api, plan, 0, "vh-2", _days_ago(1), km=50_000).status_code == 200

    rows = {(r["vehicle_plate"], r["item_name"]): r for r in api.get("/api/maintenance-plans-status").json()["items"]}
    oil = rows[("ABC1D23", "Troca de óleo do motor")]
    assert oil["status"] == "DUE_SOON" and oil["due_km"] == 120_000 and oil["km_remaining"] == 500
    assert oil["days_remaining"] == 170
    lub = rows[("ABC1D23", "Lubrificação")]
    assert lub["status"] == "OVERDUE" and lub["days_remaining"] == -10 and lub["due_km"] is None
    assert rows[("XYZ9K87", "Troca de óleo do motor")]["status"] == "OK"

    # vencidos primeiro
    ordered = api.get("/api/maintenance-plans-status").json()["items"]
    assert ordered[0]["status"] == "OVERDUE"
    only = api.get("/api/maintenance-plans-status", params={"status": "DUE_SOON"}).json()["items"]
    assert [r["item_name"] for r in only] == ["Troca de óleo do motor"]

    # nova execução da lubrificação recomeça a contagem
    _execute(api, plan, 1, "vh-1", _days_ago(0))
    rows = {(r["vehicle_plate"], r["item_name"]): r for r in api.get("/api/maintenance-plans-status").json()["items"]}
    assert rows[("ABC1D23", "Lubrificação")]["status"] == "OK"

    # plano desativado sai da situação
    api.put(f"/api/maintenance-plans/{plan['id']}", json=_plan_body(active=False, items=plan["items"]))
    assert api.get("/api/maintenance-plans-status").json()["items"] == []


def test_execution_rules(api):
    _seed(api)
    plan = api.post("/api/maintenance-plans", json=_plan_body()).json()
    r = _execute(api, plan, 0, "vh-1", _days_ago(1))
    assert r.status_code == 400 and "KM" in r.json()["detail"]  # item por km exige o km
    r = _execute(api, plan, 0, "vh-3", _days_ago(1), km=10)
    assert r.status_code == 400 and "tipo" in r.json()["detail"]  # carreta fora do plano
    r = _execute(api, plan, 1, "vh-1", (plans_router._today() + timedelta(days=1)).isoformat())
    assert r.status_code == 400 and "futura" in r.json()["detail"]

    ex = _execute(api, plan, 1, "vh-1", _days_ago(2)).json()
    assert ex["item_name"] == "Lubrificação" and ex["vehicle_plate"] == "ABC1D23"
    history = api.get("/api/maintenance-executions", params={"vehicle_id": "vh-1"}).json()
    assert history["total"] == 1

    # item com execução não pode sair do plano; plano com execução não pode ser excluído
    r = api.put(f"/api/maintenance-plans/{plan['id']}", json=_plan_body(items=[plan["items"][0]]))
    assert r.status_code == 400 and "Lubrificação" in r.json()["detail"]
    assert api.delete(f"/api/maintenance-plans/{plan['id']}").status_code == 400

    # renomear o item renomeia o histórico
    renamed = [plan["items"][0], {**plan["items"][1], "name": "Lubrificação geral"}]
    assert api.put(f"/api/maintenance-plans/{plan['id']}", json=_plan_body(items=renamed)).status_code == 200
    assert api.get("/api/maintenance-executions").json()["items"][0]["item_name"] == "Lubrificação geral"

    assert api.delete(f"/api/maintenance-executions/{ex['id']}").status_code == 200
    assert api.delete(f"/api/maintenance-plans/{plan['id']}").status_code == 200


def test_alerts_in_summary(api):
    _seed(api)
    plan = api.post("/api/maintenance-plans", json=_plan_body()).json()
    _execute(api, plan, 1, "vh-1", _days_ago(40))
    _execute(api, plan, 1, "vh-2", _days_ago(28))
    fleet = api.get("/api/alerts/summary").json()["fleet"]
    by_key = {a["key"]: a for a in fleet}
    assert by_key["maintenance_plan_overdue"]["title"] == "1 item do plano de manutenção vencido"
    assert "ABC1D23 (Lubrificação)" in by_key["maintenance_plan_overdue"]["description"]
    assert by_key["maintenance_plan_due_soon"]["tone"] == "amber"
    assert by_key["maintenance_plan_due_soon"]["path"] == "/fleet/plano-manutencao?status=DUE_SOON"


def test_settings_and_email(api, monkeypatch):
    _seed(api)
    sent = []
    monkeypatch.setattr(plans_router.resend.Emails, "send", lambda params: sent.append(params))

    assert api.put("/api/maintenance-plans/settings", json={"alert_emails": "a@x.com; sem-arroba"}).status_code == 400
    assert api.put("/api/maintenance-plans/settings", json={"alert_emails": "oficina@x.com ;frota@x.com"}, as_user="operator").status_code == 403
    r = api.put("/api/maintenance-plans/settings", json={"alert_emails": "oficina@x.com ;frota@x.com"})
    assert r.json()["alert_emails"] == "oficina@x.com; frota@x.com"

    plan = api.post("/api/maintenance-plans", json=_plan_body()).json()
    # nada vencendo: não manda
    assert api.post("/api/maintenance-plans/send-alert-email").json() == {"sent": False, "reason": "nothing_due"}
    _execute(api, plan, 1, "vh-1", _days_ago(40))
    result = api.post("/api/maintenance-plans/send-alert-email").json()
    assert result["sent"] is True and result["overdue"] == 1
    assert sent[0]["to"] == ["oficina@x.com", "frota@x.com"]
    assert "ABC1D23" in sent[0]["html"] and "10 dia(s) de atraso" in sent[0]["html"]

    # agendado: uma vez por dia
    api.run(plans_router.run_maintenance_plan_email_once())
    api.run(plans_router.run_maintenance_plan_email_once())
    assert len(sent) == 2


def test_module_disabled_hides_alerts(api):
    _seed(api)
    plan = api.post("/api/maintenance-plans", json=_plan_body()).json()
    _execute(api, plan, 1, "vh-1", _days_ago(40))
    import shared
    api.run(api.db.module_config.insert_one({"disabled_modules": ["frota.plano_manutencao"]}))
    shared.invalidate_module_config_cache()
    keys = [a["key"] for a in api.get("/api/alerts/summary").json()["fleet"]]
    assert "maintenance_plan_overdue" not in keys
    assert api.get("/api/maintenance-plans").status_code == 403
