"""Ordem de Serviço - Porto x Cliente: não gera EIR nem movimentação de pátio,
container livre (só aviso ISO 6346), frete obrigatório, status e totais dos
relatórios iguais na listagem, no PDF e no Excel."""
import io

from openpyxl import load_workbook

from reports import format_currency

# Coleções que a operação Porto x Cliente pode tocar; qualquer outra mudança
# (movements, unit_segregations, freight_payments, estoque...) é erro.
ALLOWED = {"port_client_orders", "counters", "audit_log"}


def _body(**extra):
    body = {
        "operation_type": "ENTREGA", "client_name": "CLIENTE ALFA LTDA", "port_terminal_name": "Porto do Pecém",
        "client_address": "Rua A, 100 - Fortaleza/CE", "container_number": "CSQU3054383",
        "container_size": "40", "container_type": "HC", "freight_value": 1500.0,
        "driver_name": "JOSE CARLOS DA SILVA", "truck_plate": "rta2b34", "trailer_plate": "CRT1A11",
        "scheduled_at": "2026-10-05T08:00",
    }
    body.update(extra)
    return body


def _create(api, **extra):
    r = api.post("/api/port-client-orders", json=_body(**extra))
    assert r.status_code == 200, r.text
    return r.json()


def _snapshot(api):
    async def run():
        names = await api.db.list_collection_names()
        return {n: await api.db[n].count_documents({}) for n in names if n not in ALLOWED}
    return api.run(run())


def test_no_eir_or_yard_movement(api):
    before = _snapshot(api)
    order = _create(api)
    for status in ("EM_TRANSITO", "CONCLUIDA"):
        r = api.put(f"/api/port-client-orders/{order['id']}", json={"status": status})
        assert r.status_code == 200, r.text
    other = _create(api, operation_type="COLETA", status="CANCELADA")
    assert api.get(f"/api/port-client-orders/{order['id']}/pdf").status_code == 200
    for kind in ("periodo", "faturamento-cliente", "producao", "em-aberto", "resumo-mensal"):
        assert api.get(f"/api/reports/port-client-orders/{kind}/pdf").status_code == 200
        assert api.get(f"/api/reports/port-client-orders/{kind}/excel").status_code == 200
    assert api.delete(f"/api/port-client-orders/{other['id']}").status_code == 200

    after = _snapshot(api)
    changed = {n: (before.get(n, 0), after.get(n, 0)) for n in set(before) | set(after) if before.get(n, 0) != after.get(n, 0)}
    assert changed == {}, f"Coleções alteradas indevidamente: {changed}"
    assert api.run(api.db.movements.count_documents({})) == 0


def test_container_free_text_only_warns(api):
    bad = _create(api, container_number="abc123")
    assert bad["container_number"] == "ABC123"
    assert "ISO 6346" in bad["container_warning"]

    good = _create(api, container_number="csqu 3054383")
    assert good["container_number"] == "CSQU305438-3"
    assert good["container_warning"] is None

    wrong_digit = _create(api, container_number="CSQU3054384")
    assert "verificador" in wrong_digit["container_warning"]
    assert good["container_condition"] == "CHEIO"
    assert good["truck_plate"] == "RTA-2B34"


def test_freight_value_is_required(api):
    body = _body()
    body.pop("freight_value")
    assert api.post("/api/port-client-orders", json=body).status_code == 422
    r = api.post("/api/port-client-orders", json=_body(freight_value=0))
    assert r.status_code == 400 and "Frete" in r.json()["detail"]
    order = _create(api)
    r = api.put(f"/api/port-client-orders/{order['id']}", json={"freight_value": -5})
    assert r.status_code == 400


def test_status_flow(api):
    order = _create(api)
    assert order["status"] == "ABERTA"
    r = api.put(f"/api/port-client-orders/{order['id']}", json={"status": "CONCLUIDA"})
    assert r.status_code == 200
    assert r.json()["completed_at"]
    r = api.put(f"/api/port-client-orders/{order['id']}", json={"status": "ABERTA"})
    assert r.status_code == 400
    # editar outros campos de uma ordem concluída continua permitido
    r = api.put(f"/api/port-client-orders/{order['id']}", json={"observations": "ok"})
    assert r.status_code == 200


def _seed(api):
    _create(api, client_name="CLIENTE ALFA LTDA", freight_value=1500.0, scheduled_at="2026-09-10T08:00", status="CONCLUIDA")
    _create(api, client_name="CLIENTE ALFA LTDA", operation_type="COLETA", freight_value=980.55, scheduled_at="2026-10-02T09:30")
    _create(api, client_name="CLIENTE BETA SA", freight_value=2200.10, scheduled_at="2026-10-15T14:00", status="EM_TRANSITO",
            driver_name="MARIA SOUZA", truck_plate="ABC1D23")
    _create(api, client_name="CLIENTE BETA SA", operation_type="COLETA", freight_value=700.0, scheduled_at="2026-10-20T10:00",
            status="CANCELADA")
    _create(api, client_name="CLIENTE GAMA", freight_value=333.33, scheduled_at="2026-11-01T07:00", driver_name=None, truck_plate=None)


def _excel_total(content, label_prefix="TOTAL"):
    wb = load_workbook(io.BytesIO(content))
    ws = wb.worksheets[0]
    for row in ws.iter_rows():
        for i, cell in enumerate(row):
            if isinstance(cell.value, str) and cell.value.startswith(label_prefix):
                return [c.value for c in row[i + 1:] if c.value is not None]
    return None


def _pdf_text(content):
    from pdfminer.high_level import extract_text
    return extract_text(io.BytesIO(content))


def test_report_totals_match_listing_pdf_and_excel(api):
    _seed(api)
    listing = api.get("/api/port-client-orders", params={"per_page": 100}).json()
    expected = round(1500.0 + 980.55 + 2200.10 + 333.33, 2)  # cancelada fica fora do frete
    assert listing["stats"]["freight_total"] == expected
    assert listing["stats"]["count"] == 5

    for kind in ("periodo", "faturamento-cliente", "producao", "resumo-mensal"):
        report = api.get(f"/api/reports/port-client-orders/{kind}").json()
        money_box = [v for label, v, t in report["totals"] if t == "money"][-1]
        assert round(money_box, 2) == expected, kind
        excel = api.get(f"/api/reports/port-client-orders/{kind}/excel")
        assert excel.status_code == 200
        total_row = [round(v, 2) for v in _excel_total(excel.content) if isinstance(v, (int, float))]
        assert expected in total_row, (kind, total_row)
        pdf = api.get(f"/api/reports/port-client-orders/{kind}/pdf")
        assert format_currency(expected) in _pdf_text(pdf.content), kind

    # filtro por cliente + operação: listagem e relatório usam a mesma consulta
    params = {"client_name": "CLIENTE ALFA", "operation_type": "ENTREGA"}
    listing = api.get("/api/port-client-orders", params=params).json()
    report = api.get("/api/reports/port-client-orders/periodo", params=params).json()
    assert listing["stats"]["freight_total"] == report["sections"][0]["total"][-1] == 1500.0
    assert "Cliente: CLIENTE ALFA" in report["filters_text"] and "Operação: Entrega" in report["filters_text"]

    # período: só outubro
    params = {"date_from": "2026-10-01", "date_to": "2026-10-31"}
    listing = api.get("/api/port-client-orders", params=params).json()
    report = api.get("/api/reports/port-client-orders/periodo", params=params).json()
    assert listing["stats"]["count"] == len(report["sections"][0]["rows"]) == 3
    assert listing["stats"]["freight_total"] == report["sections"][0]["total"][-1] == round(980.55 + 2200.10, 2)


def test_billing_report_subtotals_by_type(api):
    _seed(api)
    report = api.get("/api/reports/port-client-orders/faturamento-cliente").json()
    rows = {r[0]: r for r in report["sections"][0]["rows"]}
    assert rows["CLIENTE ALFA LTDA"][1:] == [1, 1500.0, 1, 980.55, 2, 2480.55]
    assert rows["CLIENTE BETA SA"][1:] == [1, 2200.10, 0, 0, 1, 2200.10]


def test_pending_report_only_open_and_in_transit(api):
    _seed(api)
    report = api.get("/api/reports/port-client-orders/em-aberto").json()
    statuses = {r[10] for r in report["sections"][0]["rows"]}
    assert statuses <= {"Aberta", "Em trânsito"}
    assert len(report["sections"][0]["rows"]) == 3


def test_monthly_summary(api):
    _seed(api)
    report = api.get("/api/reports/port-client-orders/resumo-mensal").json()
    months = {r[0]: r for r in report["sections"][0]["rows"]}
    assert set(months) == {"2026-09", "2026-10", "2026-11"}
    assert months["2026-10"][3] == 2  # cancelada não conta
    assert months["2026-10"][6] == round(980.55 + 2200.10, 2)
    assert months["2026-09"][7] is None


def test_production_by_driver_and_vehicle(api):
    _seed(api)
    report = api.get("/api/reports/port-client-orders/producao").json()
    drivers = {r[0]: r for r in report["sections"][0]["rows"]}
    assert drivers["JOSE CARLOS DA SILVA"][1] == 2
    assert drivers["MARIA SOUZA"][4] == 2200.10
    assert "(sem motorista)" in drivers
    vehicles = {r[0]: r for r in report["sections"][1]["rows"]}
    assert vehicles["RTA-2B34"][2] == 2
