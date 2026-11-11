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
        {"id": "vh-1", "plate": "ABC1D23", "brand": "VOLVO", "model": "FH 540", "vehicle_type": "CAVALO", "status": "ATIVO", "in_maintenance_plan": True},
        {"id": "vh-2", "plate": "XYZ9K87", "model": "Actros", "vehicle_type": "CAVALO", "status": "ATIVO", "in_maintenance_plan": True},
        {"id": "vh-3", "plate": "CAR0A00", "vehicle_type": "CARRETA", "status": "ATIVO", "in_maintenance_plan": True},
        {"id": "vh-4", "plate": "OLD0A00", "vehicle_type": "CAVALO", "status": "INATIVO", "in_maintenance_plan": True},
        # agregado/terceiro: do tipo do plano, mas fora da frota acompanhada
        {"id": "vh-5", "plate": "AGR0A00", "vehicle_type": "CAVALO", "status": "ATIVO",
         "created_by": "admin-1", "created_by_name": "Admin", "created_at": "2026-01-01T00:00:00+00:00"},
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


def test_only_fleet_vehicles(api):
    _seed(api)
    plan = api.post("/api/maintenance-plans", json=_plan_body()).json()
    data = api.get("/api/maintenance-plans-status").json()
    plates = {r["vehicle_plate"] for r in data["items"]}
    assert plates == {"ABC1D23", "XYZ9K87"}  # sem o agregado (não marcado) e sem o inativo
    assert data["vehicles_not_in_plan"] == 1
    fleet = api.get("/api/maintenance-plans-fleet").json()
    assert {v["plate"] for v in fleet} == {"ABC1D23", "XYZ9K87", "CAR0A00"}
    assert [i["item_name"] for i in next(v for v in fleet if v["plate"] == "ABC1D23")["items"]] == ["Troca de óleo do motor", "Lubrificação"]
    assert next(v for v in fleet if v["plate"] == "CAR0A00")["items"] == []  # carreta sem plano
    r = _execute(api, plan, 1, "vh-5", _days_ago(1))
    assert r.status_code == 400 and "não participa" in r.json()["detail"]
    # marcar no cadastro coloca o veículo no plano
    assert api.put("/api/vehicles/vh-5", json={"in_maintenance_plan": True}).json()["in_maintenance_plan"] is True
    assert "AGR0A00" in {r["vehicle_plate"] for r in api.get("/api/maintenance-plans-status").json()["items"]}


def _record_body(plan, **over):
    body = {
        "vehicle_id": "vh-1", "executed_date": _days_ago(0), "km": 119_900, "maintenance_type": "PREVENTIVA",
        "items": [{"plan_id": plan["id"], "item_id": plan["items"][0]["id"]}, {"plan_id": plan["id"], "item_id": plan["items"][1]["id"]}],
        "other_services": "Revisão do freio", "workshop": "Oficina Central",
        "parts": [{"description": "Filtro de óleo", "quantity": 2, "unit_value": 45.5}, {"description": "", "quantity": 1}],
        "labor_value": 150, "notes": "Cliente & motorista acompanharam",
    }
    body.update(over)
    return body


def test_record_numbering_and_status(api):
    import asyncio
    import routers.maintenance_plans as mp
    _seed(api)
    plan = api.post("/api/maintenance-plans", json=_plan_body()).json()
    rec = api.post("/api/maintenance-records", json=_record_body(plan)).json()
    assert rec["record_code"] == "MAN-000001" and rec["record_number"] == 1
    assert rec["parts"] == [{"description": "Filtro de óleo", "quantity": 2, "unit_value": 45.5, "total": 91.0}]
    assert rec["total_value"] == 241 and rec["vehicle_name"] == "VOLVO FH 540"
    rows = {r["item_name"]: r for r in api.get("/api/maintenance-plans-status", params={"vehicle_id": "vh-1"}).json()["items"]}
    assert rows["Troca de óleo do motor"]["status"] == "OK" and rows["Troca de óleo do motor"]["due_km"] == 139_900
    assert rows["Lubrificação"]["last_date"] == _days_ago(0)

    # sem KM com item por km, sem nada executado, veículo fora da frota
    assert api.post("/api/maintenance-records", json=_record_body(plan, km=None)).status_code == 400
    assert api.post("/api/maintenance-records", json=_record_body(plan, items=[], other_services="", parts=[])).status_code == 400
    assert api.post("/api/maintenance-records", json=_record_body(plan, vehicle_id="vh-5")).status_code == 400
    corrective = api.post("/api/maintenance-records", json=_record_body(plan, items=[], km=None, maintenance_type="CORRETIVA")).json()
    assert corrective["record_code"] == "MAN-000002" and corrective["items"] == []

    # dois salvando ao mesmo tempo: números diferentes
    async def two_at_once():
        return await asyncio.gather(mp._next_record_number(), mp._next_record_number(), mp._next_record_number())
    assert len(set(api.run(two_at_once()))) == 3

    # busca pelo número digitado ou lido pelo leitor
    for term in ("MAN-000001", "man-1", "000001", "1"):
        found = api.get("/api/maintenance-records", params={"search": term}).json()["items"]
        assert [f["record_code"] for f in found] == ["MAN-000001"], term
    assert api.get("/api/maintenance-records", params={"search": "abc-1d23"}).json()["total"] == 2

    # excluir o registro desfaz as execuções dele
    removed = api.delete(f"/api/maintenance-records/{rec['id']}").json()
    assert removed["executions_removed"] == 2
    rows = {r["item_name"]: r for r in api.get("/api/maintenance-plans-status", params={"vehicle_id": "vh-1"}).json()["items"]}
    assert rows["Lubrificação"]["status"] == "NO_HISTORY"


def test_record_and_plan_pdfs(api):
    import fitz
    _seed(api)
    plan = api.post("/api/maintenance-plans", json=_plan_body()).json()
    rec = api.post("/api/maintenance-records", json=_record_body(plan)).json()
    r = api.get(f"/api/maintenance-records/{rec['id']}/pdf")
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
    text = fitz.open(stream=r.content, filetype="pdf")[0].get_text()
    for expected in ("Registro de Manutenção", "MAN-000001", "VOLVO FH 540", "Oficina Central", "Itens do plano executados",
                     "139.900 km", "Peças e valores", "R$ 241,00", "Cliente & motorista", "ASSINATURA DO RESPONSÁVEL"):
        assert expected in text, expected

    plan_pdf = api.get("/api/maintenance-plans-status/vehicle/vh-1/pdf")
    assert plan_pdf.status_code == 200
    text = fitz.open(stream=plan_pdf.content, filetype="pdf")[0].get_text()
    for expected in ("Plano de Manutenção Preventiva", "Hodômetro atual (KM):", "Itens de troca obrigatória", "139.900", "Troca de óleo do motor"):
        assert expected in text, expected
    assert api.get("/api/maintenance-plans-status/vehicle/vh-5/pdf").status_code == 400  # fora da frota


def test_batch_current_km_matches_single(api):
    """O KM de todos os veículos de uma vez (usado pela Situação e pelo sino)
    é o mesmo da busca veículo a veículo, inclusive com a placa da revisão
    gravada com traço ou minúscula."""
    from routers.frota import get_vehicle_current_km, get_vehicles_current_km
    _seed(api)
    db = api.db
    api.run(db.fuel_supplies.insert_many([
        {"id": "fs1", "equipment_id": "vh-1", "reading": 120_100}, {"id": "fs2", "equipment_id": "vh-2", "reading": None},
        {"id": "fs3", "equipment_id": "vh-2", "reading": 30_000},
    ]))
    api.run(db.vehicle_revisions.insert_many([
        {"id": "rv1", "vehicle_plate": "xyz-9k87", "current_km": 45_000}, {"id": "rv2", "vehicle_plate": "ABC1D23", "current_km": 1},
    ]))
    vehicles = api.run(db.vehicles.find({}, {"_id": 0}).to_list(None))
    batch = api.run(get_vehicles_current_km(vehicles))
    for v in vehicles:
        assert batch[v["id"]] == api.run(get_vehicle_current_km(v["id"], v.get("plate"))), v["plate"]
    assert batch["vh-1"] == 120_100 and batch["vh-2"] == 45_000
