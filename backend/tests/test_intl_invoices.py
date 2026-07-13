"""
Test suite for International Invoice API endpoints.
Tests:
- GET /api/intl-invoices - List invoices with pagination and filters
- GET /api/intl-invoices/receiver-data - Get receiver data
- POST /api/intl-invoices - Create new invoice
- GET /api/intl-invoices/{id} - Get single invoice
- PUT /api/intl-invoices/{id}/status - Update invoice status
- DELETE /api/intl-invoices/{id} - Delete invoice
- GET /api/intl-invoices/{id}/pdf - Generate PDF
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "joao.victor@jalogisticas.com",
        "password": "password123"
    })
    if response.status_code == 200:
        return response.json().get("access_token")
    pytest.skip("Authentication failed - skipping authenticated tests")

@pytest.fixture
def auth_headers(auth_token):
    """Get headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}

@pytest.fixture(scope="module")
def created_invoice_id(auth_token):
    """Create a test invoice for testing and cleanup after"""
    headers = {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}
    
    payload = {
        "payer_client_id": None,
        "payer_company": "TEST_International Client Corp",
        "payer_address": "123 Test Street, New York, NY, USA",
        "issue_date": datetime.now().strftime('%Y-%m-%d'),
        "due_date": (datetime.now() + timedelta(days=30)).strftime('%Y-%m-%d'),
        "currency": "USD",
        "notes": "Test invoice for automated testing",
        "items": [
            {
                "description": "Container handling service",
                "quantity": 2,
                "unit_price": 150.00,
                "total": 300.00
            },
            {
                "description": "Storage fee",
                "quantity": 5,
                "unit_price": 50.00,
                "total": 250.00
            }
        ]
    }
    
    response = requests.post(f"{BASE_URL}/api/intl-invoices", json=payload, headers=headers)
    if response.status_code in [200, 201]:
        invoice_id = response.json().get("id")
        yield invoice_id
        # Cleanup: Delete the test invoice
        requests.delete(f"{BASE_URL}/api/intl-invoices/{invoice_id}", headers=headers)
    else:
        pytest.skip(f"Failed to create test invoice: {response.status_code} - {response.text}")


class TestReceiverData:
    """Test receiver data endpoint"""
    
    def test_get_receiver_data(self, auth_headers):
        """GET /api/intl-invoices/receiver-data returns company info"""
        response = requests.get(f"{BASE_URL}/api/intl-invoices/receiver-data", headers=auth_headers)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "company" in data, "Response should contain 'company'"
        assert "email" in data, "Response should contain 'email'"
        assert "address" in data, "Response should contain 'address'"
        assert "city_state" in data, "Response should contain 'city_state'"
        assert "zip" in data, "Response should contain 'zip'"
        
        # Verify data is from J.A Logística
        assert "J.A" in data["company"], "Company should be J.A Logística"
        print(f"✓ Receiver data retrieved: {data['company']}")


class TestListInvoices:
    """Test list invoices endpoint"""
    
    def test_list_invoices_without_auth(self):
        """GET /api/intl-invoices without auth returns 401/403"""
        response = requests.get(f"{BASE_URL}/api/intl-invoices")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("✓ Unauthorized access blocked")
    
    def test_list_invoices_success(self, auth_headers):
        """GET /api/intl-invoices returns paginated list"""
        response = requests.get(f"{BASE_URL}/api/intl-invoices", headers=auth_headers)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "items" in data, "Response should contain 'items'"
        assert "total" in data, "Response should contain 'total'"
        assert "page" in data, "Response should contain 'page'"
        assert "per_page" in data, "Response should contain 'per_page'"
        print(f"✓ Listed invoices: {data['total']} total, page {data['page']}")
    
    def test_list_invoices_filter_by_status(self, auth_headers, created_invoice_id):
        """GET /api/intl-invoices?status=EMITIDA returns filtered list"""
        response = requests.get(f"{BASE_URL}/api/intl-invoices?status=EMITIDA", headers=auth_headers)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        # All items should have status EMITIDA
        for item in data.get("items", []):
            assert item.get("status") == "EMITIDA", f"Expected status EMITIDA, got {item.get('status')}"
        print(f"✓ Filtered by status EMITIDA: {len(data.get('items', []))} items")
    
    def test_list_invoices_filter_by_currency(self, auth_headers, created_invoice_id):
        """GET /api/intl-invoices?currency=USD returns filtered list"""
        response = requests.get(f"{BASE_URL}/api/intl-invoices?currency=USD", headers=auth_headers)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        # All items should have currency USD
        for item in data.get("items", []):
            assert item.get("currency") == "USD", f"Expected currency USD, got {item.get('currency')}"
        print(f"✓ Filtered by currency USD: {len(data.get('items', []))} items")


class TestCreateInvoice:
    """Test create invoice endpoint"""
    
    def test_create_invoice_success(self, auth_headers):
        """POST /api/intl-invoices creates a new invoice"""
        payload = {
            "payer_client_id": None,
            "payer_company": "TEST_Create Invoice Co",
            "payer_address": "456 Create Street, London, UK",
            "issue_date": datetime.now().strftime('%Y-%m-%d'),
            "due_date": (datetime.now() + timedelta(days=15)).strftime('%Y-%m-%d'),
            "currency": "EUR",
            "notes": "Test creation",
            "items": [
                {
                    "description": "Service A",
                    "quantity": 1,
                    "unit_price": 100.00,
                    "total": 100.00
                }
            ]
        }
        
        response = requests.post(f"{BASE_URL}/api/intl-invoices", json=payload, headers=auth_headers)
        
        assert response.status_code in [200, 201], f"Expected 200/201, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Response should contain 'id'"
        assert "invoice_number" in data, "Response should contain 'invoice_number'"
        assert data["payer_company"] == payload["payer_company"], "Payer company should match"
        assert data["currency"] == "EUR", "Currency should be EUR"
        assert data["status"] == "EMITIDA", "Initial status should be EMITIDA"
        assert data["total"] == 100.00, "Total should be 100.00"
        
        invoice_id = data["id"]
        print(f"✓ Invoice created: #{data['invoice_number']} with ID {invoice_id}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/intl-invoices/{invoice_id}", headers=auth_headers)
    
    def test_create_invoice_brl_currency(self, auth_headers):
        """POST /api/intl-invoices with BRL currency"""
        payload = {
            "payer_client_id": None,
            "payer_company": "TEST_BRL Company",
            "payer_address": "Rua Teste, 123, São Paulo, SP, Brazil",
            "issue_date": datetime.now().strftime('%Y-%m-%d'),
            "due_date": (datetime.now() + timedelta(days=30)).strftime('%Y-%m-%d'),
            "currency": "BRL",
            "notes": None,
            "items": [
                {
                    "description": "Serviço de movimentação",
                    "quantity": 3,
                    "unit_price": 500.00,
                    "total": 1500.00
                }
            ]
        }
        
        response = requests.post(f"{BASE_URL}/api/intl-invoices", json=payload, headers=auth_headers)
        
        assert response.status_code in [200, 201], f"Expected 200/201, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["currency"] == "BRL", "Currency should be BRL"
        assert data["total"] == 1500.00, "Total should be 1500.00"
        
        invoice_id = data["id"]
        print(f"✓ BRL invoice created: #{data['invoice_number']}, total R$ {data['total']}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/intl-invoices/{invoice_id}", headers=auth_headers)


class TestGetSingleInvoice:
    """Test get single invoice endpoint"""
    
    def test_get_invoice_success(self, auth_headers, created_invoice_id):
        """GET /api/intl-invoices/{id} returns invoice details"""
        response = requests.get(f"{BASE_URL}/api/intl-invoices/{created_invoice_id}", headers=auth_headers)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["id"] == created_invoice_id, "Invoice ID should match"
        assert "invoice_number" in data, "Should have invoice_number"
        assert "receiver_company" in data, "Should have receiver_company"
        assert "payer_company" in data, "Should have payer_company"
        assert "items" in data, "Should have items"
        assert len(data["items"]) == 2, "Should have 2 items"
        print(f"✓ Retrieved invoice #{data['invoice_number']}: {data['payer_company']}")
    
    def test_get_invoice_not_found(self, auth_headers):
        """GET /api/intl-invoices/{invalid_id} returns 404"""
        response = requests.get(f"{BASE_URL}/api/intl-invoices/invalid-uuid-12345", headers=auth_headers)
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Non-existent invoice returns 404")


class TestUpdateInvoiceStatus:
    """Test update invoice status endpoint"""
    
    def test_update_status_to_paga(self, auth_headers, created_invoice_id):
        """PUT /api/intl-invoices/{id}/status?status=PAGA updates status"""
        response = requests.put(
            f"{BASE_URL}/api/intl-invoices/{created_invoice_id}/status?status=PAGA",
            headers=auth_headers
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        # Verify status was updated
        get_response = requests.get(f"{BASE_URL}/api/intl-invoices/{created_invoice_id}", headers=auth_headers)
        invoice = get_response.json()
        assert invoice["status"] == "PAGA", f"Status should be PAGA, got {invoice['status']}"
        print(f"✓ Updated status to PAGA for invoice #{invoice['invoice_number']}")
    
    def test_update_status_to_cancelada(self, auth_headers):
        """PUT /api/intl-invoices/{id}/status?status=CANCELADA updates status"""
        # Create a temporary invoice
        payload = {
            "payer_client_id": None,
            "payer_company": "TEST_Cancel Company",
            "payer_address": "123 Cancel Street",
            "issue_date": datetime.now().strftime('%Y-%m-%d'),
            "due_date": (datetime.now() + timedelta(days=10)).strftime('%Y-%m-%d'),
            "currency": "USD",
            "items": [{"description": "Test", "quantity": 1, "unit_price": 10.00, "total": 10.00}]
        }
        create_resp = requests.post(f"{BASE_URL}/api/intl-invoices", json=payload, headers=auth_headers)
        invoice_id = create_resp.json()["id"]
        
        # Update to CANCELADA
        response = requests.put(
            f"{BASE_URL}/api/intl-invoices/{invoice_id}/status?status=CANCELADA",
            headers=auth_headers
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        # Verify
        get_response = requests.get(f"{BASE_URL}/api/intl-invoices/{invoice_id}", headers=auth_headers)
        invoice = get_response.json()
        assert invoice["status"] == "CANCELADA", "Status should be CANCELADA"
        print(f"✓ Updated status to CANCELADA")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/intl-invoices/{invoice_id}", headers=auth_headers)
    
    def test_update_status_invalid(self, auth_headers, created_invoice_id):
        """PUT /api/intl-invoices/{id}/status with invalid status returns 400"""
        response = requests.put(
            f"{BASE_URL}/api/intl-invoices/{created_invoice_id}/status?status=INVALID",
            headers=auth_headers
        )
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("✓ Invalid status returns 400")


class TestDeleteInvoice:
    """Test delete invoice endpoint"""
    
    def test_delete_invoice_success(self, auth_headers):
        """DELETE /api/intl-invoices/{id} removes the invoice"""
        # Create a temporary invoice to delete
        payload = {
            "payer_client_id": None,
            "payer_company": "TEST_Delete Company",
            "payer_address": "123 Delete Street",
            "issue_date": datetime.now().strftime('%Y-%m-%d'),
            "due_date": (datetime.now() + timedelta(days=5)).strftime('%Y-%m-%d'),
            "currency": "USD",
            "items": [{"description": "To delete", "quantity": 1, "unit_price": 5.00, "total": 5.00}]
        }
        create_resp = requests.post(f"{BASE_URL}/api/intl-invoices", json=payload, headers=auth_headers)
        invoice_id = create_resp.json()["id"]
        invoice_number = create_resp.json()["invoice_number"]
        
        # Delete
        response = requests.delete(f"{BASE_URL}/api/intl-invoices/{invoice_id}", headers=auth_headers)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        # Verify it's gone
        get_response = requests.get(f"{BASE_URL}/api/intl-invoices/{invoice_id}", headers=auth_headers)
        assert get_response.status_code == 404, "Deleted invoice should return 404"
        print(f"✓ Invoice #{invoice_number} deleted successfully")
    
    def test_delete_invoice_not_found(self, auth_headers):
        """DELETE /api/intl-invoices/{invalid_id} returns 404"""
        response = requests.delete(f"{BASE_URL}/api/intl-invoices/invalid-uuid-12345", headers=auth_headers)
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Delete non-existent invoice returns 404")


class TestDownloadPDF:
    """Test PDF generation endpoint"""
    
    def test_download_pdf_success(self, auth_headers, created_invoice_id):
        """GET /api/intl-invoices/{id}/pdf returns PDF blob"""
        response = requests.get(
            f"{BASE_URL}/api/intl-invoices/{created_invoice_id}/pdf",
            headers=auth_headers
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        # Check content type is PDF
        content_type = response.headers.get('content-type', '')
        assert 'pdf' in content_type.lower() or response.content[:4] == b'%PDF', \
            f"Response should be PDF, got content-type: {content_type}"
        
        # Check PDF has content
        assert len(response.content) > 1000, "PDF should have substantial content"
        print(f"✓ PDF downloaded: {len(response.content)} bytes")
    
    def test_download_pdf_not_found(self, auth_headers):
        """GET /api/intl-invoices/{invalid_id}/pdf returns 404"""
        response = requests.get(
            f"{BASE_URL}/api/intl-invoices/invalid-uuid-12345/pdf",
            headers=auth_headers
        )
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ PDF for non-existent invoice returns 404")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
