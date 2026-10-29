"""Recibo de pagamento da fatura (Faturamento > Recibo): só para fatura
paga, com o valor recebido por extenso, os serviços cobrados e o desconto
do crédito do cliente quando houver."""
import io

from pdfminer.high_level import extract_text

from test_api_invoices import movement, invoice


def _text(response):
    assert response.status_code == 200, response.text
    assert response.content.startswith(b"%PDF")
    return " ".join(extract_text(io.BytesIO(response.content)).split())


def test_receipt_only_for_paid_invoice(api):
    inv = invoice(api, movement(api, "ABCU1111111", 150)["id"], movement(api, "ABCU2222222", 100)["id"])
    r = api.get(f"/api/invoices/{inv['id']}/receipt-pdf")
    assert r.status_code == 400 and "paga" in r.json()["detail"]

    assert api.put(f"/api/invoices/{inv['id']}/status", params={"status": "PAGO"}).status_code == 200
    r = api.get(f"/api/invoices/{inv['id']}/receipt-pdf")
    assert f'recibo_fatura_{inv["invoice_number"]}.pdf' in r.headers["content-disposition"]
    text = _text(r)
    assert "Recibo de Pagamento" in text
    assert "Recebemos de Cliente Um" in text
    assert "R$ 250,00" in text
    assert "Duzentos e Cinquenta Reais" in text
    assert f"Fatura nº {inv['invoice_number']}" in text
    assert "plena e geral quitação" in text


def test_receipt_missing_invoice(api):
    assert api.get("/api/invoices/nao-existe/receipt-pdf").status_code == 404


def test_receipt_discounts_client_credit(api):
    api.run(api.db.invoices.insert_one({
        "id": "inv-credito", "invoice_number": 77, "client_name": "Cliente Crédito", "client_cnpj": "12.345.678/0001-99",
        "movement_ids": [], "total_value": 500.0, "credit_applied": 200.0, "status": "PAGO",
        "created_at": "2026-10-01T12:00:00-03:00", "paid_date": "2026-10-10", "user_name": "Admin",
    }))
    text = _text(api.get("/api/invoices/inv-credito/receipt-pdf"))
    assert "(-) Crédito do cliente" in text
    assert "R$ 300,00" in text and "Trezentos Reais" in text
    assert "já descontado o crédito" in text
    assert "10/10/2026" in text


def test_receipt_invoice_paid_entirely_by_credit(api):
    api.run(api.db.invoices.insert_one({
        "id": "inv-so-credito", "invoice_number": 78, "client_name": "Cliente Crédito", "movement_ids": [],
        "total_value": 400.0, "credit_applied": 400.0, "paid_by_credit": True, "status": "PAGO",
        "created_at": "2026-10-01T12:00:00-03:00", "paid_date": "2026-10-02", "user_name": "Admin",
    }))
    text = _text(api.get("/api/invoices/inv-so-credito/receipt-pdf"))
    assert "quitada integralmente com o crédito do cliente" in text
