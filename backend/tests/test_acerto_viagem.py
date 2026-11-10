"""Acerto da Viagem: abastecimento interno e externo pago pela empresa entram
na viagem mas não no saldo do motorista; resultado (lucro/prejuízo) batendo
com o cálculo manual; acertos antigos abrindo e imprimindo; relatório."""
import io

from openpyxl import load_workbook


def _seed(api):
    db = api.db
    api.run(db.drivers.insert_many([{"id": "dr-1", "name": "João Motorista"}, {"id": "dr-9", "name": "Operador Pátio"}]))
    api.run(db.vehicles.insert_many([{"id": "vh-1", "plate": "ABC-1D23"}, {"id": "vh-2", "plate": "XYZ-9B88"}]))
    base = {"equipment_id": "vh-1", "equipment_plate": "ABC-1D23", "driver_id": "dr-1"}
    api.run(db.fuel_supplies.insert_many([
        # interno (tanque próprio), lançado pelo operador do pátio: 100 L x R$ 5,00
        {**base, "id": "fs-int", "supply_number": 1, "supply_date": "2026-11-03", "driver_id": "dr-9",
         "source": "TANQUE_PROPRIO", "payment_type": "SEM_PROGRAMACAO", "liters": 100, "unit_price": 5, "gross_value": 500, "reading": 1000},
        # externo pago pela empresa (faturado/cartão)
        {**base, "id": "fs-emp", "supply_number": 2, "supply_date": "2026-11-04", "source": "POSTO_EXTERNO",
         "payment_type": "JA_PROGRAMADO", "liters": 50, "unit_price": 6, "gross_value": 300, "supplier_name": "Posto Frota"},
        # externo pago pelo motorista
        {**base, "id": "fs-mot", "supply_number": 3, "supply_date": "2026-11-05", "source": "POSTO_EXTERNO",
         "payment_type": "PAGO_MOTORISTA", "liters": 66.67, "unit_price": 6, "gross_value": 400, "supplier_name": "Posto Estrada"},
        # fora do período da viagem
        {**base, "id": "fs-old", "supply_number": 4, "supply_date": "2026-10-01", "source": "POSTO_EXTERNO",
         "payment_type": "PAGO_MOTORISTA", "liters": 10, "gross_value": 60},
        # de outro motorista e outro veículo
        {"id": "fs-other", "supply_number": 5, "supply_date": "2026-11-04", "driver_id": "dr-9", "equipment_id": "vh-2",
         "payment_type": "PAGO_MOTORISTA", "liters": 10, "gross_value": 60},
    ]))
    api.run(db.loading_orders.insert_one(
        {"id": "lo-1", "order_number": 7, "status": "APROVADA", "driver_id": "dr-1", "truck_plate": "ABC-1D23",
         "route_name": "Pecém x Fortaleza", "freight_value": 2000.0, "created_at": "2026-11-03T12:00:00+00:00"}))
    api.run(db.port_client_orders.insert_one(
        {"id": "os-1", "order_number": 1, "status": "CONCLUIDA", "operation_type": "ENTREGA", "driver_id": "dr-1",
         "truck_plate": "ABC-1D23", "client_name": "CLIENTE", "port_terminal_name": "Porto", "freight_value": 1000.0,
         "scheduled_at": "2026-11-04T08:00", "containers": [{"container_number": "CSQU305438-3"}]}))


def _body(**over):
    body = {
        "driver_id": "dr-1", "vehicle_id": "vh-1", "settlement_date": "2026-11-08",
        "trip_start": "2026-11-03", "trip_end": "2026-11-06",
        "fuel_supply_ids": ["fs-int", "fs-emp", "fs-mot"],
        "trips": [{"loading_order_id": "lo-1", "km_start": 1000, "km_end": 1300},
                  {"port_client_order_id": "os-1", "km_start": 1300, "km_end": 1500}],
        "expenses": [{"description": "Pedágio", "category": "PEDAGIO", "paid_by": "MOTORISTA", "quantity": 1, "unit_value": 100},
                     {"description": "Comissão", "category": "COMISSAO", "paid_by": "EMPRESA", "quantity": 1, "unit_value": 150}],
        "advances": [{"kind": "ADIANTAMENTO", "amount": 500}],
    }
    body.update(over)
    return body


def test_candidates_bring_internal_and_company_fuel_in_trip_period(api):
    _seed(api)
    cand = api.get("/api/driver-settlements/candidates", params={
        "driver_id": "dr-1", "vehicle_id": "vh-1", "date_from": "2026-11-03", "date_to": "2026-11-06"}).json()
    fuel = {f["id"]: f for f in cand["fuel_supplies"]}
    assert set(fuel) == {"fs-int", "fs-emp", "fs-mot"}  # fora do período e de outro veículo ficam de fora
    assert (fuel["fs-int"]["origin"], fuel["fs-int"]["paid_by"], fuel["fs-int"]["unit_price"]) == ("INTERNO", "EMPRESA", 5)
    assert (fuel["fs-emp"]["origin"], fuel["fs-emp"]["paid_by"]) == ("EXTERNO", "EMPRESA")
    assert (fuel["fs-mot"]["origin"], fuel["fs-mot"]["paid_by"]) == ("EXTERNO", "MOTORISTA")
    assert {t.get("freight_value") for t in cand["trips"]} == {2000.0, 1000.0}


def test_two_accounts_match_manual_calculation(api):
    _seed(api)
    r = api.post("/api/driver-settlements", json=_body())
    assert r.status_code == 200, r.text
    s = r.json()
    # Saldo com o motorista = 400 (posto pago por ele) + 100 (pedágio dele) - 500 (adiantamento) = 0
    assert s["fuel_driver_total"] == 400 and s["expenses_driver_total"] == 100
    assert s["balance"] == 0
    # Resultado = 3.000 (frete) - 1.200 (combustível: 500 interno + 300 empresa + 400 motorista) - 250 (despesas) = 1.550
    assert s["revenue"] == 3000 and s["fuel_total"] == 1200
    assert s["fuel_internal_total"] == 500 and s["fuel_external_total"] == 700
    assert s["expenses_total"] == 250 and s["cost_total"] == 1450
    assert s["result"] == 1550 and s["margin"] == 51.7
    assert s["km_total"] == 500 and s["km_per_liter"] == round(500 / 216.67, 2)

    # interno e externo pago pela empresa NÃO mudam o saldo do motorista
    only_driver = api.put(f"/api/driver-settlements/{s['id']}", json=_body(fuel_supply_ids=["fs-mot"])).json()
    assert only_driver["balance"] == s["balance"] == 0
    assert only_driver["result"] == 3000 - 400 - 250  # mas mudam o resultado da viagem


def test_loss_and_company_paid_fuel_with_other_operator(api):
    _seed(api)
    s = api.post("/api/driver-settlements", json=_body(trips=[{"port_client_order_id": "os-1"}])).json()
    assert s["revenue"] == 1000 and s["result"] == 1000 - 1200 - 250 and s["margin"] == -45.0
    # sem veículo, o abastecimento interno lançado pelo operador (dr-9) não é do motorista
    r = api.post("/api/driver-settlements", json=_body(vehicle_id=None, fuel_supply_ids=["fs-other"], trips=[]))
    assert r.status_code == 400 and "outro motorista e de outro veículo" in r.json()["detail"]


def test_settlement_pdf_has_both_accounts(api):
    _seed(api)
    s = api.post("/api/driver-settlements", json=_body()).json()
    from pdfminer.high_level import extract_text
    text = extract_text(io.BytesIO(api.get(f"/api/driver-settlements/{s['id']}/pdf").content))
    for expected in ("Acerto da Viagem", "Saldo com o motorista", "Resultado da viagem", "Lucro de R$ 1.550,00 (51,7%)",
                     "Tanque próprio", "Interno", "Empresa", "OC 7", "OS-C 1", "R$ 3.000,00"):
        assert expected in text, expected


def test_old_settlement_still_opens_and_prints(api):
    _seed(api)
    # gravado antes desta mudança: sem origem/pagamento no abastecimento, sem
    # pago-por na despesa, sem frete na viagem e sem receita/resultado
    api.run(api.db.driver_settlements.insert_one({
        "id": "old-1", "settlement_number": 1, "driver_id": "dr-1", "driver_name": "João Motorista",
        "vehicle_id": "vh-1", "vehicle_plate": "ABC-1D23", "settlement_date": "2026-10-20", "status": "FECHADO",
        "closed_at": "2026-10-21", "closed_by_name": "Admin",
        "fuel_supplies": [{"id": "fs-legacy", "supply_number": 9, "supply_date": "2026-10-18", "supplier_name": "Posto A",
                           "plate": "ABC-1D23", "liters": 100, "reading": 900, "total": 610}],
        "trips": [{"loading_order_id": "lo-1", "order_number": 7, "order_date": "2026-10-18", "km_start": 0, "km_end": 305, "km": 305}],
        "expenses": [{"id": "e1", "description": "Pedágio", "quantity": 2, "unit_value": 15.5, "total": 31}],
        "advances": [{"id": "a1", "kind": "ADIANTAMENTO", "amount": 500}, {"id": "a2", "kind": "DEVOLUCAO", "amount": 50}],
        "fuel_total": 610, "expenses_total": 31, "advances_total": 500, "returns_total": 50, "balance": 191,
        "km_total": 305, "fuel_liters": 100, "created_at": "2026-10-20T12:00:00+00:00",
    }))
    s = api.get("/api/driver-settlements/old-1").json()
    assert s["balance"] == 191  # saldo antigo não muda (tudo era do motorista)
    assert s["revenue"] == 2000 and s["result"] == 2000 - 610 - 31  # frete buscado na ordem
    listed = api.get("/api/driver-settlements").json()["items"][0]
    assert listed["id"] == "old-1" and listed["result"] == s["result"]
    pdf = api.get("/api/driver-settlements/old-1/pdf")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    stored = api.run(api.db.driver_settlements.find_one({"id": "old-1"}, {"_id": 0}))
    assert "revenue" not in stored  # a leitura não grava nada


def test_report_pdf_and_excel(api):
    _seed(api)
    api.post("/api/driver-settlements", json=_body())
    params = {"date_from": "2026-11-01", "date_to": "2026-11-30"}
    pdf = api.get("/api/driver-settlements/report/pdf", params=params)
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    from pdfminer.high_level import extract_text
    text = extract_text(io.BytesIO(pdf.content))
    for expected in ("Relatório de Acertos da Viagem", "Receita", "Custo Total", "Resultado", "Margem %", "R$ 1.550,00", "51,7%"):
        assert expected in text, expected
    xlsx = api.get("/api/driver-settlements/report/excel", params=params)
    ws = load_workbook(io.BytesIO(xlsx.content)).worksheets[0]
    headers = [c.value for c in ws[8]]
    for column in ("Receita", "Custo Total", "Resultado", "Margem %"):
        assert column in headers
    row = [c.value for c in ws[9]]
    assert row[headers.index("Receita")] == 3000 and row[headers.index("Custo Total")] == 1450
    assert row[headers.index("Resultado")] == 1550 and row[headers.index("Margem %")] == "51,7%"
    assert ws.cell(row=9, column=headers.index("Receita") + 1).number_format == "R$ #,##0.00"
