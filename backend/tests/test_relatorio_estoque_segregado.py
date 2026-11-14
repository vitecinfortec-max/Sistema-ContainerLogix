"""Relatório de Movimentação, filtro Estoque Atual: observação "SEGREGADO"
nos containers reservados numa Segregação de Unidade ativa e ainda não
retirados (pedido de 14/11/2026), na prévia, no PDF e no Excel."""
import io

from openpyxl import load_workbook

from test_terminal import _mov


def _seed(api):
    api.run(api.db.movements.insert_many([
        _mov(1, "SEGU1234567", "ENTRADA", 5),
        _mov(2, "LIVR7654321", "ENTRADA", 4),
        _mov(3, "RETI1111111", "ENTRADA", 3),
        _mov(4, "CANC2222222", "ENTRADA", 2),
    ]))
    api.run(api.db.unit_segregations.insert_many([
        # Reserva digitada com o traço do dígito verificador
        {"id": "s1", "segregation_number": 7, "client_name": "CLIENTE BETA", "status": "ATIVO",
         "items": [{"container_number": "SEGU123456-7", "shipping_line": "MSC"},
                   {"container_number": "RETI1111111", "shipping_line": "MSC", "retrieved": True}]},
        {"id": "s2", "segregation_number": 8, "client_name": "CLIENTE GAMA", "status": "CANCELADO",
         "items": [{"container_number": "CANC2222222", "shipping_line": "MSC"}]},
    ]))


def test_stock_preview_marks_segregated(api):
    _seed(api)
    r = api.get("/api/reports/movements/preview", params={"operation_type": "ESTOQUE"})
    assert r.status_code == 200, r.text
    body = r.json()
    notes = {i["container_number"]: i["segregation_note"] for i in body["items"]}
    assert notes == {
        "SEGU1234567": "SEGREGADO - CLIENTE BETA (Nº 7)",
        "LIVR7654321": None, "RETI1111111": None, "CANC2222222": None,
    }
    assert body["stats"]["segregated"] == 1

    # Fora do Estoque Atual não marca nada
    other = api.get("/api/reports/movements/preview").json()
    assert all(i["segregation_note"] is None for i in other["items"])


def test_stock_pdf_and_excel_have_observation(api):
    _seed(api)
    pdf = api.get("/api/reports/pdf", params={"operation_type": "ESTOQUE"})
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"

    xlsx = api.get("/api/reports/excel", params={"operation_type": "ESTOQUE"})
    assert xlsx.status_code == 200
    ws = load_workbook(io.BytesIO(xlsx.content)).active
    assert ws.cell(row=8, column=18).value == "Observação"
    rows = {ws.cell(row=r, column=5).value: ws.cell(row=r, column=18).value for r in range(9, 13)}
    assert rows["SEGU1234567"] == "SEGREGADO - CLIENTE BETA (Nº 7)"
    assert not rows["LIVR7654321"]

    # Relatório comum continua com 16 colunas
    ws = load_workbook(io.BytesIO(api.get("/api/reports/excel").content)).active
    assert ws.cell(row=8, column=18).value in (None, "")
