"""Ordem de Abastecimento: PDF de uma ordem e de várias selecionadas (uma
ordem por folha, com as 2 vias)."""
from io import BytesIO, StringIO

from pdfminer.high_level import extract_text_to_fp
from pdfminer.pdfpage import PDFPage


def _order(api, plate, liters=100):
    r = api.post("/api/fuel-supply-orders", json={"order_date": "2026-10-01", "equipment_plate": plate, "fuel_type": "DIESEL_S10",
                                                  "supply_mode": "LITROS", "liters": liters})
    assert r.status_code == 200, r.text
    return r.json()


def _pages_and_text(content: bytes):
    out = StringIO()
    extract_text_to_fp(BytesIO(content), out)
    return len(list(PDFPage.get_pages(BytesIO(content)))), out.getvalue()


def test_single_order_pdf_still_has_two_copies(api):
    o = _order(api, "AAA1A11")
    r = api.get(f"/api/fuel-supply-orders/{o['id']}/pdf")
    pages, text = _pages_and_text(r.content)
    assert r.status_code == 200 and pages == 1 and text.count(f"Nº {o['order_number']}") == 2


def test_selected_orders_in_one_pdf_one_per_page(api):
    a, b, c = _order(api, "AAA1A11"), _order(api, "BBB2B22"), _order(api, "CCC3C33")
    r = api.get("/api/fuel-supply-orders/pdf", params={"ids": f"{c['id']},{a['id']},{b['id']}"})
    assert r.status_code == 200, r.text
    pages, text = _pages_and_text(r.content)
    assert pages == 3
    # em ordem de número, cada uma com as 2 vias
    positions = [text.index(f"Nº {x['order_number']}") for x in (a, b, c)]
    assert positions == sorted(positions) and all(text.count(f"Nº {x['order_number']}") == 2 for x in (a, b, c))
    assert f"OrdensAbastecimento_{a['order_number']}_a_{c['order_number']}.pdf" in r.headers["content-disposition"]
    assert api.get("/api/fuel-supply-orders/pdf", params={"ids": " , "}).status_code == 400
    assert api.get("/api/fuel-supply-orders/pdf", params={"ids": "nao-existe"}).status_code == 404
