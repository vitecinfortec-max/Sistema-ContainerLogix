"""Custo e Faturamento por Veículo: junta por placa (com ou sem hífen) o
faturamento (Serviço Portuário, Ordem de Carregamento aprovada) e o custo
(Abastecimento, OS não cancelada, Saída de estoque para o veículo, Diária não
cancelada), respeita o período e devolve o ranking da frota sem placa."""


def _seed(api):
    db = api.db
    api.run(db.vehicles.insert_one({"id": "v1", "plate": "ABC-1D23", "brand": "Volvo", "model": "FH 540", "vehicle_type": "CAMINHÃO"}))
    api.run(db.port_services.insert_many([
        {"id": "ps1", "service_number": 1, "cavalo_plate": "ABC1D23", "service_date": "2026-10-05", "operation_value": 1500.0, "client_name": "Cliente A"},
        {"id": "ps2", "service_number": 2, "cavalo_plate": "XYZ9K88", "service_date": "2026-10-05", "operation_value": 800.0, "client_name": "Cliente B"},
        {"id": "ps3", "service_number": 3, "cavalo_plate": "abc-1d23", "service_date": "2026-08-01", "operation_value": 999.0},
    ]))
    api.run(db.loading_orders.insert_many([
        {"id": "lo1", "order_number": 10, "status": "APROVADA", "truck_plate": "ABC-1D23", "freight_value": 2000.0,
         "route_name": "Santos x Cubatão", "created_at": "2026-10-06T15:00:00+00:00"},
        {"id": "lo2", "order_number": 11, "status": "PENDENTE", "truck_plate": "ABC-1D23", "freight_value": 5000.0,
         "created_at": "2026-10-06T15:00:00+00:00"},
    ]))
    api.run(db.fuel_supplies.insert_one({
        "id": "f1", "supply_number": 5, "equipment_plate": "ABC1D23", "supply_date": "2026-10-07",
        "liters": 100, "gross_value": 600.0, "discounts": 0, "additions": 0,
    }))
    api.run(db.ordem_servico.insert_many([
        {"id": "os1", "os_number": 7, "status": "FECHADO", "equipment_plate": "ABC-1D23", "opened_at": "2026-10-08T09:00",
         "products": [{"quantity": 2, "unit_price": 100, "discount": 0}], "services": [{"quantity": 1, "unit_price": 300, "discount": 0}]},
        {"id": "os2", "os_number": 8, "status": "CANCELADO", "equipment_plate": "ABC-1D23", "opened_at": "2026-10-08T09:00",
         "products": [{"quantity": 1, "unit_price": 9999, "discount": 0}], "services": []},
    ]))
    api.run(db.stock_movements.insert_many([
        {"id": "m1", "movement_number": 3, "operation_type": "SAIDA", "purpose_type": "VEICULO", "purpose_vehicle_plate": "ABC-1D23",
         "movement_date": "2026-10-09", "items": [{"product_description": "Filtro", "quantity": 1, "unit_value": 50, "total_value": 50}]},
        {"id": "m2", "movement_number": 4, "operation_type": "SAIDA", "purpose_type": "OS", "purpose_text": "OS Nº 7",
         "movement_date": "2026-10-09", "items": [{"product_description": "Óleo", "quantity": 1, "unit_value": 80, "total_value": 80}]},
    ]))
    api.run(db.daily_rate_requests.insert_many([
        {"id": "d1", "request_number": 2, "status": "PENDENTE",
         "items": [{"driver_name": "João", "vehicle_plate": "ABC1D23", "departure_date": "2026-10-10", "total": 150.0},
                   {"driver_name": "Pedro", "vehicle_plate": "XYZ9K88", "departure_date": "2026-10-10", "total": 90.0}]},
        {"id": "d2", "request_number": 3, "status": "CANCELADO",
         "items": [{"driver_name": "João", "vehicle_plate": "ABC1D23", "departure_date": "2026-10-10", "total": 777.0}]},
    ]))


PERIOD = {"date_from": "2026-10-01", "date_to": "2026-10-31"}


def test_vehicle_detail(api):
    _seed(api)
    r = api.get("/api/reports/vehicle-results/summary", params={**PERIOD, "plate": "abc1d23"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["plate"] == "ABC-1D23" and data["vehicle"] == "Volvo FH 540"
    # 1500 (portuário) + 2000 (ordem aprovada); 600 (abast.) + 500 (OS) + 50 (saída) + 150 (diária)
    assert data["revenue"] == 3500.0
    assert data["cost"] == 1300.0
    assert data["result"] == 2200.0
    assert data["margin"] == 62.9
    cats = {c["category"]: c["value"] for c in data["by_category"]}
    assert cats == {"Serviço Portuário": 1500.0, "Ordem de Carregamento": 2000.0, "Abastecimento": 600.0,
                    "Ordem de Serviço": 500.0, "Saída de Estoque": 50.0, "Diária de Motorista": 150.0}
    assert len(data["rows"]) == 6
    assert data["monthly"] == [{"month": "2026-10", "revenue": 3500.0, "cost": 1300.0, "result": 2200.0}]


def test_fleet_ranking_without_plate(api):
    _seed(api)
    data = api.get("/api/reports/vehicle-results/summary", params=PERIOD).json()
    assert data["rows"] == []
    by_plate = {v["plate_key"]: v for v in data["vehicles"]}
    assert set(by_plate) == {"ABC1D23", "XYZ9K88"}
    assert by_plate["XYZ9K88"]["result"] == 710.0 and not by_plate["XYZ9K88"]["registered"]
    assert data["vehicles"][0]["plate"] == "ABC-1D23"  # maior resultado primeiro
    assert data["revenue"] == 4300.0


def test_period_filter_and_exports(api):
    _seed(api)
    data = api.get("/api/reports/vehicle-results/summary", params={"plate": "ABC1D23", "date_to": "2026-09-30"}).json()
    assert data["revenue"] == 999.0 and data["cost"] == 0 and data["margin"] == 100.0
    for fmt in ("pdf", "excel"):
        assert api.get(f"/api/reports/vehicle-results/{fmt}", params={**PERIOD, "plate": "ABC1D23"}).status_code == 200
        assert api.get(f"/api/reports/vehicle-results/{fmt}", params=PERIOD).status_code == 200
