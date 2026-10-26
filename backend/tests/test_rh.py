"""RH: cálculos da folha (INSS/IRRF 2026, férias, 13º, rescisão) e os fluxos
da API - cargos, admissão, folha mensal com lançamentos e ocorrências,
fechamento/pagamento, férias, 13º, desligamento, documentos, banco de horas,
painel e relatórios."""
from datetime import date

from hr_payroll import (
    DEFAULT_PAYROLL_SETTINGS as S, calc_inss, calc_irrf, compute_13th_payslip, compute_monthly_payslip, compute_termination,
    compute_vacation, months_by_fifteen, notice_days, vacation_periods,
)


# ---------------------------------------------------------------- motor de cálculo

def test_inss_progressive_2026_table_and_ceiling():
    assert calc_inss(1621, S) == 121.58
    assert calc_inss(3000, S) == 248.6
    assert calc_inss(8475.55, S) == 988.09
    assert calc_inss(20000, S) == 988.09  # teto


def test_irrf_2026_reduction_law_15270():
    # até R$ 5.000: isento
    assert calc_irrf(5000, calc_inss(5000, S), 0, 0, S)["tax"] == 0
    # R$ 6.000: imposto da tabela (564,85) menos 978,62 - 0,133145 x 6.000 (179,75)
    r = calc_irrf(6000, calc_inss(6000, S), 0, 0, S)
    assert (r["gross_tax"], r["reduction"], r["tax"]) == (564.85, 179.75, 385.10)
    # acima de R$ 7.350: sem redução; dependente deduz 189,59
    r = calc_irrf(10000, calc_inss(10000, S), 1, 0, S)
    assert r["reduction"] == 0 and r["base"] == round(10000 - 988.09 - 189.59, 2)


def test_monthly_payslip_events_and_bases():
    ctx = {"base_salary": 3000, "contract_type": "CLT", "days_worked": 30, "vt_opt_in": True, "vt_monthly_cost": 150, "irrf_dependents": 0}
    p = compute_monthly_payslip(ctx, [{"code": "HE50", "quantity": 10}, {"code": "ADIANTAMENTO", "value": 1200},
                                      {"code": "AJUDA_CUSTO", "value": 100}], S)
    codes = {e["code"]: e["value"] for e in p["events"]}
    assert codes["SALARIO"] == 3000 and codes["HE50"] == 204.55  # 3000/220 x 1,5 x 10
    assert codes["VALE_TRANSPORTE"] == 150  # 6% = 180, limitado ao custo
    assert p["inss_base"] == 3204.55  # ajuda de custo não entra
    assert p["fgts"] == round(3204.55 * 0.08, 2)
    assert p["net"] == round(p["gross"] - p["deductions"], 2)


def test_absences_reduce_bases_and_family_allowance():
    ctx = {"base_salary": 1800, "contract_type": "CLT", "days_worked": 30, "absence_days": 2, "family_children": 2}
    p = compute_monthly_payslip(ctx, [], S)
    codes = {e["code"]: e["value"] for e in p["events"]}
    assert codes["FALTAS"] == 120
    assert p["inss_base"] == 1680
    assert codes["SALARIO_FAMILIA"] == round(2 * 67.54, 2)


def test_trainee_has_no_inss_or_fgts():
    p = compute_monthly_payslip({"base_salary": 1500, "contract_type": "ESTAGIO", "days_worked": 30}, [], S)
    assert p["inss"] == 0 and p["fgts"] == 0


def test_thirteenth_parts():
    ctx = {"base_salary": 3600, "contract_type": "CLT"}
    first = compute_13th_payslip(ctx, 1, 12, 0, [], S)
    assert first["gross"] == 1800 and first["inss"] == 0 and first["fgts"] == 144
    second = compute_13th_payslip(ctx, 2, 12, 1800, [], S)
    assert second["gross"] == 3600 and second["inss"] == calc_inss(3600, S)
    assert second["fgts_base"] == 1800
    assert second["net"] == round(3600 - 1800 - second["inss"] - second["irrf"], 2)


def test_vacation_and_periods():
    v = compute_vacation({"base_salary": 3000}, 20, 10, False, S)
    assert v["vacation_pay"] == 2000 and v["one_third"] == 666.67 and v["abono"] == 1000
    assert v["inss"] == calc_inss(2666.67, S)
    periods = vacation_periods("2024-01-15", date(2026, 10, 25), {"2024-01-15": 30}, {"2025-01-15": 10})
    assert [p["status"] for p in periods] == ["QUITADO", "DISPONIVEL", "EM_AQUISICAO"]
    assert periods[1]["entitled"] == 24  # 10 faltas injustificadas
    assert periods[2]["months"] == 9


def test_termination_without_cause():
    assert notice_days(date(2023, 3, 10), date(2026, 10, 20)) == 39
    assert months_by_fifteen(date(2026, 1, 1), date(2026, 11, 28)) == 11
    t = compute_termination({"base_salary": 3000, "admission_date": "2023-03-10", "termination_date": "2026-10-20",
                             "termination_type": "SEM_JUSTA_CAUSA", "notice_type": "INDENIZADO",
                             "current_period_start": "2026-03-10", "fgts_balance": 5000}, S)
    items = {i["label"]: i["value"] for i in t["items"]}
    assert items["Saldo de salário"] == 2000 and items["Aviso prévio indenizado"] == 3900
    assert items["Férias proporcionais"] == 2250 and items["13º salário proporcional"] == 2750
    assert t["fgts_fine"] == round((5000 + t["fgts_month"]) * 0.4, 2)
    just_cause = compute_termination({"base_salary": 3000, "admission_date": "2023-03-10", "termination_date": "2026-10-20",
                                      "termination_type": "JUSTA_CAUSA", "vacation_balance_days": 30}, S)
    labels = {i["label"] for i in just_cause["items"]}
    doubled = compute_termination({"base_salary": 3000, "admission_date": "2020-01-10", "termination_date": "2026-10-20",
                                    "termination_type": "PEDIDO", "vacation_double_days": 30}, S)
    assert {i["label"]: i["value"] for i in doubled["items"]}["Férias vencidas em dobro (art. 137)"] == 6000
    assert "Férias vencidas" in labels and "13º salário proporcional" not in labels and just_cause["fgts_fine"] == 0


# ---------------------------------------------------------------- API

def _employee(api, name="Ana Souza", cpf="111.222.333-44", birth="1990-10-05"):
    r = api.post("/api/employees", json={"name": name, "cpf": cpf, "birth_date": birth})
    assert r.status_code == 200, r.text
    return r.json()


def _contract(api, person, **over):
    body = {"person_type": "FUNCIONARIO", "person_id": person["id"], "contract_type": "CLT",
            "admission_date": "2024-01-15", "base_salary": 3000, "vt_opt_in": True, "vt_monthly_cost": 150,
            "dependents": [{"name": "Filho", "birth_date": "2020-05-01", "irrf": True, "family_allowance": True}]}
    body.update(over)
    r = api.post("/api/hr/contracts", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_positions_and_contract_lifecycle(api):
    pos = api.post("/api/hr/positions", json={"name": "Operador de Empilhadeira", "department": "Pátio", "salary_min": 2500, "salary_max": 3500}).json()
    assert api.post("/api/hr/positions", json={"name": "operador de empilhadeira"}).status_code == 400
    assert api.post("/api/hr/positions", json={"name": "X", "salary_min": 5, "salary_max": 1}).status_code == 400

    emp = _employee(api)
    c = _contract(api, emp, position_id=pos["id"], experience_days=45)
    assert c["position_name"] == "Operador de Empilhadeira" and c["department"] == "Pátio"
    assert c["experience_end"] == "2024-02-28" and c["status"] == "ATIVO"
    synced = api.get("/api/employees").json()[0]
    assert synced["position"] == "Operador de Empilhadeira" and synced["admission_date"] == "2024-01-15"

    # um contrato vigente por pessoa
    assert api.post("/api/hr/contracts", json={"person_type": "FUNCIONARIO", "person_id": emp["id"], "admission_date": "2025-01-01",
                                               "base_salary": 2000}).status_code == 400
    # cargo em uso e pessoa com contrato não podem ser excluídos
    assert api.delete(f"/api/hr/positions/{pos['id']}").status_code == 400
    assert api.delete(f"/api/employees/{emp['id']}").status_code == 400
    assert api.get("/api/hr/positions").json()[0]["active_contracts"] == 1

    # renomear o cargo acompanha o contrato
    api.put(f"/api/hr/positions/{pos['id']}", json={"name": "Operador de Máquinas", "department": "Pátio"})
    assert api.get(f"/api/hr/contracts/{c['id']}").json()["position_name"] == "Operador de Máquinas"

    assert api.put(f"/api/hr/contracts/{c['id']}/status", params={"status": "AFASTADO"}).status_code == 200
    assert api.get("/api/employees").json()[0]["status"] == "AFASTADO"
    assert api.get("/api/hr/contracts/" + c["id"] + "/sheet/pdf").content.startswith(b"%PDF")


def _pdf_text(content: bytes) -> str:
    from io import StringIO
    from pdfminer.high_level import extract_text_to_fp
    out = StringIO()
    extract_text_to_fp(__import__("io").BytesIO(content), out)
    return "".join(out.getvalue().split())  # sem espaços: as quebras de linha do PDF não atrapalham


def test_work_contract_pdf(api):
    pos = api.post("/api/hr/positions", json={"name": "Auxiliar de Pátio", "cbo": "7832-25"}).json()
    c = _contract(api, _employee(api), position_id=pos["id"], contract_type="EXPERIENCIA", experience_days=45,
                  insalubridade_grade=20, work_schedule="07:00 às 17:00")
    r = api.get(f"/api/hr/contracts/{c['id']}/contract/pdf")
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    text = _pdf_text(r.content)
    assert "ContratodeTrabalhoaTítulodeExperiência" in text and "AnaSouza" in text and "AuxiliardePátio" in text
    assert "45dias" in text and "15/01/2024" in text and "28/02/2024" in text
    assert "insalubridadede20%" in text and "vale-transporte" in text and "07:00às17:00" in text
    # 45 + 45: termo de prorrogação de 29/02 a 13/04
    assert "TermodeProrrogação" in text and "29/02/2024" in text and "13/04/2024" in text

    other = _contract(api, _employee(api, name="Bruno Lima", cpf="222.333.444-55"), vt_opt_in=False)
    text = _pdf_text(api.get(f"/api/hr/contracts/{other['id']}/contract/pdf").content)
    assert "ContratoIndividualdeTrabalho" in text and "prazoindeterminado" in text
    assert "Prorrogação" not in text and "vale-transporte" not in text

    pj = _contract(api, _employee(api, name="Carla PJ", cpf="333.444.555-66"), contract_type="PJ")
    r = api.get(f"/api/hr/contracts/{pj['id']}/contract/pdf")
    assert r.status_code == 400 and "PJ" in r.json()["detail"]


def test_validation_of_contract(api):
    emp = _employee(api)
    base = {"person_type": "FUNCIONARIO", "person_id": emp["id"], "admission_date": "2024-01-15", "base_salary": 3000}
    assert api.post("/api/hr/contracts", json={**base, "base_salary": 0}).status_code == 400
    assert api.post("/api/hr/contracts", json={**base, "contract_type": "XYZ"}).status_code == 400
    assert api.post("/api/hr/contracts", json={**base, "insalubridade_grade": 15}).status_code == 400
    assert api.post("/api/hr/contracts", json={**base, "recurring_events": [{"code": "INSS", "value": 1}]}).status_code == 400
    assert api.post("/api/hr/contracts", json={**base, "person_id": "nao-existe"}).status_code == 404


def test_monthly_payroll_flow(api):
    emp = _employee(api)
    c = _contract(api, emp, recurring_events=[{"code": "PLANO_SAUDE", "value": 80}])
    late = _contract(api, _employee(api, "Bruno", "999.888.777-66"), admission_date="2026-10-16", base_salary=3000, vt_opt_in=False, dependents=[])
    pj = _contract(api, _employee(api, "Carla PJ", "555.444.333-22"), contract_type="PJ", dependents=[])
    # falta injustificada no mês desconta na folha
    api.post("/api/hr/occurrences", json={"contract_id": c["id"], "occurrence_type": "FALTA_INJUSTIFICADA", "start_date": "2026-10-07", "days": 1})

    r = api.post("/api/hr/payroll-runs", json={"competence": "2026-10", "run_type": "MENSAL"})
    assert r.status_code == 200, r.text
    run = r.json()
    assert api.post("/api/hr/payroll-runs", json={"competence": "2026-10"}).status_code == 400  # duplicada
    detail = api.get(f"/api/hr/payroll-runs/{run['id']}").json()
    slips = {p["contract_id"]: p for p in detail["payslips"]}
    assert pj["id"] not in slips and len(slips) == 2
    mine = slips[c["id"]]
    codes = {e["code"]: e["value"] for e in mine["events"]}
    assert codes["SALARIO"] == 3000 and codes["FALTAS"] == 100 and codes["PLANO_SAUDE"] == 80
    assert slips[late["id"]]["days_worked"] == 15  # admitido dia 16

    # lançamento manual recalcula
    r = api.put(f"/api/hr/payslips/{mine['id']}", json={"inputs": mine["inputs"] + [{"code": "HE50", "quantity": 10}]})
    assert r.status_code == 200, r.text
    assert {e["code"] for e in r.json()["events"]} >= {"HE50", "INSS"}
    assert api.put(f"/api/hr/payslips/{mine['id']}", json={"inputs": [{"code": "HE50", "quantity": 0}]}).status_code == 400
    run = api.get(f"/api/hr/payroll-runs/{run['id']}").json()
    assert run["totals"]["count"] == 2 and run["totals"]["net"] > 0

    # fechar trava; pagar; estornar; reabrir
    assert api.post(f"/api/hr/payroll-runs/{run['id']}/pay", json={"payment_date": "2026-11-05"}).status_code == 400
    assert api.post(f"/api/hr/payroll-runs/{run['id']}/close").status_code == 200
    assert api.put(f"/api/hr/payslips/{mine['id']}", json={"inputs": []}).status_code == 400
    assert api.delete(f"/api/hr/payroll-runs/{run['id']}").status_code == 400
    assert api.post(f"/api/hr/payroll-runs/{run['id']}/pay", json={"payment_date": "2026-11-05"}).json()["status"] == "PAGA"
    assert api.post(f"/api/hr/payroll-runs/{run['id']}/reopen").status_code == 400
    assert api.post(f"/api/hr/payroll-runs/{run['id']}/unpay").json()["status"] == "FECHADA"

    pdf = api.get("/api/hr/payslips/pdf", params={"run_id": run["id"]})
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    assert api.get("/api/hr/payslips/pdf", params={"ids": mine["id"]}).content.startswith(b"%PDF")

    summary = api.get("/api/reports/financial-summary", params={"date_from": "2026-11-01", "date_to": "2026-11-30"}).json()
    payable = {line["key"]: line["total"] for line in summary["payable"]}
    assert payable["payroll_open"] == run["totals"]["net"]


def test_thirteenth_runs(api):
    emp = _employee(api)
    c = _contract(api, emp, base_salary=3600, dependents=[])
    first = api.post("/api/hr/payroll-runs", json={"competence": "2026-11", "run_type": "DECIMO_1"}).json()
    # 2ª parcela só com a 1ª fechada
    assert api.post("/api/hr/payroll-runs", json={"competence": "2026-12", "run_type": "DECIMO_2"}).status_code == 400
    slip = api.get(f"/api/hr/payroll-runs/{first['id']}").json()["payslips"][0]
    assert slip["totals"]["gross"] == 1800
    api.post(f"/api/hr/payroll-runs/{first['id']}/close")
    second = api.post("/api/hr/payroll-runs", json={"competence": "2026-12", "run_type": "DECIMO_2"}).json()
    slip2 = api.get(f"/api/hr/payroll-runs/{second['id']}").json()["payslips"][0]
    codes = {e["code"]: e["value"] for e in slip2["events"]}
    assert codes["DECIMO"] == 3600 and codes["DECIMO_ADIANT"] == 1800
    assert slip2["contract_id"] == c["id"]
    # a 1ª parcela não reabre depois que a 2ª a descontou
    assert api.post(f"/api/hr/payroll-runs/{first['id']}/reopen").status_code == 400


def test_vacation_flow(api):
    emp = _employee(api)
    c = _contract(api, emp, dependents=[])
    balances = api.get("/api/hr/vacation-balances").json()
    periods = balances[0]["periods"]
    assert periods[0]["start"] == "2024-01-15" and periods[0]["complete"]

    body = {"contract_id": c["id"], "acquisition_start": "2024-01-15", "start_date": "2026-11-03", "days": 20, "sell_days": 10}
    preview = api.post("/api/hr/vacations/preview", json=body).json()
    assert preview["end_date"] == "2026-11-22" and preview["return_date"] == "2026-11-23"
    assert preview["payment_date"] == "2026-11-01" and preview["calc"]["abono"] == 1000
    v = api.post("/api/hr/vacations", json=body).json()
    # saldo do período esgotado (20 + 10 abono)
    assert api.post("/api/hr/vacations", json={**body, "start_date": "2026-12-01", "days": 5, "sell_days": 0}).status_code == 400
    # período em aquisição e dias inválidos
    assert api.post("/api/hr/vacations", json={**body, "acquisition_start": "2026-01-15"}).status_code == 400
    assert api.post("/api/hr/vacations", json={**body, "acquisition_start": "2025-01-15", "days": 3, "sell_days": 0}).status_code == 400

    assert api.get(f"/api/hr/vacations/{v['id']}/notice/pdf").content.startswith(b"%PDF")
    paid = api.post(f"/api/hr/vacations/{v['id']}/pay", json={"payment_date": "2026-11-01"}).json()
    assert paid["status"] == "PAGA"
    assert api.delete(f"/api/hr/vacations/{v['id']}").status_code == 400
    assert api.get(f"/api/hr/vacations/{v['id']}/receipt/pdf").content.startswith(b"%PDF")

    # dias de férias saem do salário do mês
    run = api.post("/api/hr/payroll-runs", json={"competence": "2026-11", "run_type": "MENSAL"}).json()
    slip = api.get(f"/api/hr/payroll-runs/{run['id']}").json()["payslips"][0]
    assert slip["vacation_days"] == 20 and slip["days_worked"] == 10


def test_termination_simulate_confirm_and_reinstate(api):
    emp = _employee(api)
    c = _contract(api, emp, admission_date="2023-03-10", dependents=[])
    body = {"termination_date": "2026-10-20", "termination_type": "SEM_JUSTA_CAUSA", "notice_type": "INDENIZADO", "fgts_balance": 5000}
    sim = api.post(f"/api/hr/contracts/{c['id']}/terminate", json=body).json()
    assert sim["calc"]["notice_days"] == 39 and sim["calc"]["fgts_fine"] > 2000
    assert api.get(f"/api/hr/contracts/{c['id']}").json()["status"] == "ATIVO"  # só simulou

    assert api.post(f"/api/hr/contracts/{c['id']}/terminate", json={**body, "termination_type": "XX"}).status_code == 400
    done = api.post(f"/api/hr/contracts/{c['id']}/terminate", json={**body, "confirm": True}).json()
    assert done["status"] == "DESLIGADO" and done["termination"]["calc"]["net"] > 0
    assert api.get("/api/employees").json()[0]["status"] == "DESLIGADO"
    assert api.get(f"/api/hr/contracts/{c['id']}/termination/pdf").content.startswith(b"%PDF")
    # desligado não entra na folha nem é editado
    run = api.post("/api/hr/payroll-runs", json={"competence": "2026-11"}).json()
    assert api.get(f"/api/hr/payroll-runs/{run['id']}").json()["payslips"] == []
    assert api.put(f"/api/hr/contracts/{c['id']}", json={"person_type": "FUNCIONARIO", "person_id": emp["id"],
                                                         "admission_date": "2023-03-10", "base_salary": 1}).status_code == 400
    assert api.post(f"/api/hr/contracts/{c['id']}/reinstate").json()["status"] == "ATIVO"


def test_occurrences_documents_time_bank(api):
    emp = _employee(api)
    c = _contract(api, emp, dependents=[])
    adv = api.post("/api/hr/occurrences", json={"contract_id": c["id"], "occurrence_type": "ADVERTENCIA", "start_date": "2026-10-10",
                                                "description": "Atraso recorrente"}).json()
    assert api.get(f"/api/hr/occurrences/{adv['id']}/pdf").content.startswith(b"%PDF")
    sick = api.post("/api/hr/occurrences", json={"contract_id": c["id"], "occurrence_type": "ATESTADO", "start_date": "2026-10-11",
                                                 "end_date": "2026-10-13", "cid": "J11"}).json()
    assert sick["days"] == 3
    assert api.get(f"/api/hr/occurrences/{sick['id']}/pdf").status_code == 400
    assert api.post("/api/hr/occurrences", json={"contract_id": c["id"], "occurrence_type": "ATESTADO", "start_date": "2026-10-13",
                                                 "end_date": "2026-10-11"}).status_code == 400

    api.post("/api/hr/documents", json={"contract_id": c["id"], "doc_type": "ASO_PERIODICO", "issue_date": "2025-01-01", "expiry_date": "2026-01-01"})
    api.post("/api/hr/documents", json={"contract_id": c["id"], "doc_type": "TREINAMENTO_NR", "description": "NR-11", "issue_date": "2026-01-01", "expiry_date": "2030-01-01"})
    docs = api.get("/api/hr/documents").json()
    assert [d["status"] for d in docs] == ["VENCIDO", "VALIDO"]
    assert api.get("/api/hr/documents", params={"status": "VENCIDO"}).json()[0]["doc_type"] == "ASO_PERIODICO"

    api.post("/api/hr/time-bank", json={"contract_id": c["id"], "date": "2026-10-10", "minutes": 150, "description": "Hora extra"})
    api.post("/api/hr/time-bank", json={"contract_id": c["id"], "date": "2026-10-15", "minutes": -60})
    assert api.post("/api/hr/time-bank", json={"contract_id": c["id"], "date": "2026-10-15", "minutes": 0}).status_code == 400
    bal = api.get("/api/hr/time-bank/balances").json()[0]
    assert (bal["credit"], bal["debit"], bal["balance"]) == (150, 60, 90)

    # contrato com histórico não é excluído
    assert api.delete(f"/api/hr/contracts/{c['id']}").status_code == 400


def test_dashboard_reports_and_settings(api):
    emp = _employee(api, birth="1990-10-05")
    _contract(api, emp, dependents=[])
    dash = api.get("/api/hr/dashboard").json()
    assert dash["headcount"] == 1 and dash["payroll_base"] == 3000
    meta = api.get("/api/hr/meta").json()
    assert any(e["code"] == "HE50" for e in meta["events"]) and not any(e["code"] == "INSS" for e in meta["events"])

    for kind in ("headcount", "payroll-cost", "vacations", "occurrences", "documents", "time-bank", "birthdays"):
        r = api.get(f"/api/reports/hr/{kind}", params={"month": 10})
        assert r.status_code == 200, (kind, r.text)
        assert api.get(f"/api/reports/hr/{kind}/pdf", params={"month": 10}).content.startswith(b"%PDF"), kind
        assert api.get(f"/api/reports/hr/{kind}/excel", params={"month": 10}).status_code == 200, kind
    assert api.get("/api/reports/hr/headcount").json()["summary"]["count"] == 1
    assert api.get("/api/reports/hr/xyz").status_code == 404

    settings = api.get("/api/hr/payroll-settings").json()
    assert settings["is_default"] and settings["settings"]["min_wage"] == 1621
    new = {**settings["settings"], "min_wage": 1700}
    assert api.put("/api/hr/payroll-settings", json=new).json()["settings"]["min_wage"] == 1700
    bad = {**new, "inss_brackets": [{"up_to": 2000, "rate": 7.5}, {"up_to": 1000, "rate": 9}]}
    assert api.put("/api/hr/payroll-settings", json=bad).status_code == 400
    assert api.post("/api/hr/payroll-settings/reset").json()["settings"]["min_wage"] == 1621


def test_rh_is_admin_only(api):
    for path in ("/api/hr/contracts", "/api/hr/payroll-runs", "/api/hr/dashboard", "/api/reports/hr/headcount", "/api/hr/payroll-settings"):
        assert api.get(path, as_user="operator").status_code == 403, path


def test_hr_upload_accepts_pdf(api):
    pdf = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
    r = api.post("/api/hr/uploads", files={"file": ("atestado.pdf", pdf, "application/pdf")})
    assert r.status_code == 200, r.text
    assert r.json()["url"].startswith("/api/uploads/rh_") and r.json()["url"].endswith(".pdf")
    from shared import UPLOADS_DIR
    (UPLOADS_DIR / r.json()["filename"]).unlink()  # não deixa lixo na pasta de uploads
    assert api.post("/api/hr/uploads", files={"file": ("x.exe", b"MZ", "application/octet-stream")}).status_code == 400


# ---------------------------------------------------------------- correções da auditoria (26/10/2026)

def test_inss_of_a_month_with_vacation_is_on_the_whole_competence():
    # 15 dias de férias (INSS já descontado no recibo) + 15 trabalhados
    vac = compute_vacation({"base_salary": 6000}, 15, 0, False, S)
    slip = compute_monthly_payslip({"base_salary": 6000, "contract_type": "CLT", "days_worked": 15,
                                    "other_inss_base": vac["vacation_pay"] + vac["one_third"],
                                    "other_inss_withheld": vac["inss"]}, [], S)
    total = calc_inss(vac["vacation_pay"] + vac["one_third"] + 3000, S)
    assert round(vac["inss"] + slip["inss"], 2) == total == 781.51
    assert next(e for e in slip["events"] if e["code"] == "INSS")["reference"] == "complemento (férias no mês)"


def test_early_end_of_experience_follows_art_479_and_480():
    base = {"base_salary": 3000, "contract_type": "EXPERIENCIA", "admission_date": "2026-01-05",
            "experience_end": "2026-04-04", "termination_date": "2026-02-03", "fgts_balance": 240}
    fired = compute_termination({**base, "termination_type": "SEM_JUSTA_CAUSA", "notice_type": "INDENIZADO"}, S)
    items = {i["label"]: i for i in fired["items"]}
    assert fired["early_experience"] and fired["experience_remaining_days"] == 60 and fired["notice_days"] == 0
    assert items["Indenização art. 479 CLT (metade dos dias restantes)"]["value"] == 3000
    assert "Aviso prévio indenizado" not in items
    assert items["13º salário proporcional"]["reference"] == "1/12"  # sem projeção do aviso
    assert fired["fgts_fine_rate"] == 40
    quit_ = compute_termination({**base, "termination_type": "PEDIDO", "notice_type": "NAO_CUMPRIDO"}, S)
    assert {i["label"]: i["value"] for i in quit_["items"]}["Indenização art. 480 CLT (metade dos dias restantes)"] == 3000
    assert not any(i["label"] == "Aviso prévio não cumprido" for i in quit_["items"])
    # no fim do prazo (ou depois dele) volta a ser rescisão comum
    after = compute_termination({**base, "termination_date": "2026-04-04", "termination_type": "SEM_JUSTA_CAUSA",
                                 "notice_type": "INDENIZADO"}, S)
    assert not after["early_experience"]


def test_february_on_vacation_pays_no_salary_days(api):
    c = _contract(api, _employee(api), admission_date="2024-01-15", dependents=[], vt_opt_in=False)
    v = api.post("/api/hr/vacations", json={"contract_id": c["id"], "acquisition_start": "2025-01-15",
                                            "start_date": "2027-02-01", "days": 28, "sell_days": 0})
    assert v.status_code == 200, v.text
    run = api.post("/api/hr/payroll-runs", json={"competence": "2027-02", "run_type": "MENSAL"}).json()
    slip = api.get(f"/api/hr/payroll-runs/{run['id']}").json()["payslips"][0]
    assert slip["vacation_days"] == 30 and slip["days_worked"] == 0


def test_payroll_inss_counts_the_vacation_of_the_month(api):
    c = _contract(api, _employee(api), base_salary=6000, dependents=[], vt_opt_in=False)
    v = api.post("/api/hr/vacations", json={"contract_id": c["id"], "acquisition_start": "2024-01-15",
                                            "start_date": "2026-11-16", "days": 15, "sell_days": 0}).json()
    run = api.post("/api/hr/payroll-runs", json={"competence": "2026-11", "run_type": "MENSAL"}).json()
    slip = api.get(f"/api/hr/payroll-runs/{run['id']}").json()["payslips"][0]
    assert slip["days_worked"] == 15
    assert round(slip["totals"]["inss"] + v["calc"]["inss"], 2) == calc_inss(3000 + v["calc"]["vacation_pay"] + v["calc"]["one_third"], S)


def test_open_first_13th_run_is_not_discounted_on_termination(api):
    c = _contract(api, _employee(api), admission_date="2023-03-10", base_salary=3600, dependents=[])
    api.post("/api/hr/payroll-runs", json={"competence": "2026-11", "run_type": "DECIMO_1"})  # aberta: ninguém recebeu
    body = {"termination_date": "2026-11-20", "termination_type": "SEM_JUSTA_CAUSA", "notice_type": "TRABALHADO"}
    sim = api.post(f"/api/hr/contracts/{c['id']}/terminate", json=body).json()
    assert not any("adiantamento" in i["label"] for i in sim["calc"]["items"])


def test_driver_registry_follows_the_contract(api):
    drv = api.post("/api/drivers", json={"name": "Zé Motorista", "cpf": "444.555.666-77"}).json()
    c = _contract(api, drv, person_type="MOTORISTA", dependents=[])
    status = lambda: next(d for d in api.get("/api/drivers").json() if d["id"] == drv["id"])["status"]  # noqa: E731
    api.put(f"/api/hr/contracts/{c['id']}/status", params={"status": "AFASTADO"})
    assert status() == "INATIVO"
    api.put(f"/api/hr/contracts/{c['id']}/status", params={"status": "ATIVO"})
    assert status() == "ATIVO"
    api.post(f"/api/hr/contracts/{c['id']}/terminate", json={"termination_date": "2026-10-20", "termination_type": "PEDIDO",
                                                              "notice_type": "TRABALHADO", "confirm": True})
    assert status() == "INATIVO"
    api.post(f"/api/hr/contracts/{c['id']}/reinstate")
    assert status() == "ATIVO"


def test_experience_contract_rules_and_dashboard_alert(api):
    from datetime import timedelta
    from reports import today_brt
    base = {"person_type": "FUNCIONARIO", "contract_type": "EXPERIENCIA", "admission_date": "2024-01-15", "base_salary": 3000}
    emp = _employee(api)
    assert api.post("/api/hr/contracts", json={**base, "person_id": emp["id"]}).status_code == 400  # sem os dias
    # experiência que já terminou não fica para sempre no painel
    _contract(api, emp, contract_type="EXPERIENCIA", experience_days=45, dependents=[])
    soon = (today_brt().date() - timedelta(days=40)).isoformat()
    other = _contract(api, _employee(api, "Bia", "222.333.444-55"), contract_type="EXPERIENCIA", experience_days=45,
                      admission_date=soon, dependents=[])
    alerts = api.get("/api/hr/dashboard").json()["experiences"]
    assert [a["contract_id"] for a in alerts] == [other["id"]] and alerts[0]["days_left"] == 4


def test_programmed_vacation_follows_salary_changes(api):
    emp = _employee(api)
    c = _contract(api, emp, dependents=[])
    v = api.post("/api/hr/vacations", json={"contract_id": c["id"], "acquisition_start": "2024-01-15",
                                            "start_date": "2026-12-01", "days": 30, "sell_days": 0}).json()
    assert v["calc"]["vacation_pay"] == 3000
    body = {"person_type": "FUNCIONARIO", "person_id": emp["id"], "admission_date": "2024-01-15", "base_salary": 3600}
    assert api.put(f"/api/hr/contracts/{c['id']}", json=body).status_code == 200
    assert api.get("/api/hr/vacations").json()[0]["calc"]["vacation_pay"] == 3600
    paid = api.post(f"/api/hr/vacations/{v['id']}/pay", json={"payment_date": "2026-11-28"}).json()
    assert paid["calc"]["vacation_pay"] == 3600


def test_vacations_settled_before_the_system(api):
    emp = _employee(api)
    c = _contract(api, emp, admission_date="2020-01-10", dependents=[])
    before = api.get("/api/hr/vacation-balances").json()[0]
    assert before["overdue"] >= 4
    body = {"person_type": "FUNCIONARIO", "person_id": emp["id"], "admission_date": "2020-01-10", "base_salary": 3000,
            "vacation_settled_until": "2025-01-09"}
    assert api.put(f"/api/hr/contracts/{c['id']}", json=body).status_code == 200
    after = api.get("/api/hr/vacation-balances").json()[0]
    statuses = [p["status"] for p in after["periods"]]
    assert statuses[:5] == ["QUITADO"] * 5 and after["overdue"] == 0 and after["available_days"] == 30
