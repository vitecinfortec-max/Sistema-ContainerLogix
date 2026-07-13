"""
Tests for Invoice Update (PUT /api/invoices/{invoice_id}) functionality
Tests the ability to edit existing invoices: update client info, add/remove movements
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "joao.victor@jalogisticas.com"
TEST_PASSWORD = "password123"


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    return response.json()["access_token"]


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    """Return headers with auth token"""
    return {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }


class TestInvoicesList:
    """Test that invoices list endpoint works"""
    
    def test_get_invoices_list(self, auth_headers):
        """GET /api/invoices - should return list of invoices"""
        response = requests.get(f"{BASE_URL}/api/invoices", headers=auth_headers)
        assert response.status_code == 200, f"Failed to get invoices: {response.text}"
        invoices = response.json()
        assert isinstance(invoices, list), "Response should be a list"
        print(f"Found {len(invoices)} invoices")
        return invoices
    
    def test_get_invoices_count(self, auth_headers):
        """GET /api/invoices/count - should return count"""
        response = requests.get(f"{BASE_URL}/api/invoices/count", headers=auth_headers)
        assert response.status_code == 200, f"Failed to get count: {response.text}"
        data = response.json()
        assert "count" in data, "Response should have count field"
        print(f"Total invoices: {data['count']}")


class TestInvoiceUpdate:
    """Test PUT /api/invoices/{invoice_id} endpoint"""
    
    def test_update_invoice_client_name(self, auth_headers):
        """Update invoice client name"""
        # First get an existing invoice
        response = requests.get(f"{BASE_URL}/api/invoices", headers=auth_headers)
        assert response.status_code == 200
        invoices = response.json()
        
        if len(invoices) == 0:
            pytest.skip("No invoices available to test update")
        
        invoice = invoices[0]
        invoice_id = invoice['id']
        original_name = invoice['client_name']
        
        # Update with a test name
        test_name = f"TEST_CLIENT_{int(time.time())}"
        update_response = requests.put(
            f"{BASE_URL}/api/invoices/{invoice_id}",
            headers=auth_headers,
            json={"client_name": test_name}
        )
        assert update_response.status_code == 200, f"Update failed: {update_response.text}"
        
        updated = update_response.json()
        assert updated['client_name'] == test_name, "Client name was not updated"
        print(f"Updated client name from '{original_name}' to '{test_name}'")
        
        # Restore original name
        restore_response = requests.put(
            f"{BASE_URL}/api/invoices/{invoice_id}",
            headers=auth_headers,
            json={"client_name": original_name}
        )
        assert restore_response.status_code == 200, "Failed to restore original name"
        print(f"Restored client name to '{original_name}'")

    def test_update_invoice_notes(self, auth_headers):
        """Update invoice notes"""
        response = requests.get(f"{BASE_URL}/api/invoices", headers=auth_headers)
        assert response.status_code == 200
        invoices = response.json()
        
        if len(invoices) == 0:
            pytest.skip("No invoices available to test update")
        
        invoice = invoices[0]
        invoice_id = invoice['id']
        original_notes = invoice.get('notes', '')
        
        # Update notes
        test_notes = f"TEST_NOTE_{int(time.time())}"
        update_response = requests.put(
            f"{BASE_URL}/api/invoices/{invoice_id}",
            headers=auth_headers,
            json={"notes": test_notes}
        )
        assert update_response.status_code == 200, f"Update failed: {update_response.text}"
        
        updated = update_response.json()
        assert updated['notes'] == test_notes, "Notes were not updated"
        print(f"Updated notes to: {test_notes}")
        
        # Restore original notes
        restore_response = requests.put(
            f"{BASE_URL}/api/invoices/{invoice_id}",
            headers=auth_headers,
            json={"notes": original_notes if original_notes else None}
        )
        assert restore_response.status_code == 200

    def test_update_invoice_not_found(self, auth_headers):
        """Test update non-existent invoice returns 404"""
        response = requests.put(
            f"{BASE_URL}/api/invoices/non-existent-id-12345",
            headers=auth_headers,
            json={"client_name": "Test"}
        )
        assert response.status_code == 404, "Should return 404 for non-existent invoice"
        print("Correctly returned 404 for non-existent invoice")


class TestInvoiceMovements:
    """Test invoice movement operations (add/remove)"""
    
    def test_get_invoice_movements(self, auth_headers):
        """GET /api/invoices/{id}/movements - get movements in an invoice"""
        response = requests.get(f"{BASE_URL}/api/invoices", headers=auth_headers)
        assert response.status_code == 200
        invoices = response.json()
        
        if len(invoices) == 0:
            pytest.skip("No invoices available")
        
        invoice = invoices[0]
        invoice_id = invoice['id']
        
        movements_response = requests.get(
            f"{BASE_URL}/api/invoices/{invoice_id}/movements",
            headers=auth_headers
        )
        assert movements_response.status_code == 200, f"Failed: {movements_response.text}"
        
        movements = movements_response.json()
        assert isinstance(movements, list), "Should return list of movements"
        print(f"Invoice {invoice['invoice_number']} has {len(movements)} movements")
        
        # Verify movement structure
        if len(movements) > 0:
            mov = movements[0]
            assert 'id' in mov, "Movement should have id"
            assert 'transaction_id' in mov, "Movement should have transaction_id"
            assert 'container_number' in mov, "Movement should have container_number"
            assert 'operation_type' in mov, "Movement should have operation_type"
            print(f"First movement: #{mov['transaction_id']} - {mov['container_number']}")
    
    def test_get_unbilled_movements(self, auth_headers):
        """GET /api/movements/unbilled - get movements not yet billed"""
        response = requests.get(
            f"{BASE_URL}/api/movements/unbilled",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        
        movements = response.json()
        assert isinstance(movements, list), "Should return list"
        print(f"Found {len(movements)} unbilled movements")
        
        # Verify none are billed
        for mov in movements:
            assert mov.get('billed', False) == False, "Unbilled movements should have billed=False"


class TestInvoiceUpdateWithMovements:
    """Test adding/removing movements from invoices"""
    
    def test_cannot_leave_invoice_without_movements(self, auth_headers):
        """Test that removing all movements from invoice is not allowed"""
        response = requests.get(f"{BASE_URL}/api/invoices", headers=auth_headers)
        assert response.status_code == 200
        invoices = response.json()
        
        if len(invoices) == 0:
            pytest.skip("No invoices available")
        
        invoice = invoices[0]
        invoice_id = invoice['id']
        movement_ids = invoice['movement_ids']
        
        if len(movement_ids) == 0:
            pytest.skip("Invoice has no movements to remove")
        
        # Try to remove all movements
        update_response = requests.put(
            f"{BASE_URL}/api/invoices/{invoice_id}",
            headers=auth_headers,
            json={"movement_ids_to_remove": movement_ids}
        )
        
        # Should fail with 400 - cannot leave invoice without movements
        assert update_response.status_code == 400, f"Should fail when removing all movements: {update_response.text}"
        error_detail = update_response.json().get('detail', '')
        assert "pelo menos uma movimentação" in error_detail.lower() or "at least one" in error_detail.lower(), \
            f"Error should mention minimum movements requirement: {error_detail}"
        print("Correctly prevented removing all movements from invoice")


class TestInvoiceDocuments:
    """Test invoice PDF and Excel download"""
    
    def test_download_invoice_pdf(self, auth_headers):
        """GET /api/invoices/{id}/pdf - download PDF"""
        response = requests.get(f"{BASE_URL}/api/invoices", headers=auth_headers)
        assert response.status_code == 200
        invoices = response.json()
        
        if len(invoices) == 0:
            pytest.skip("No invoices available")
        
        invoice = invoices[0]
        invoice_id = invoice['id']
        
        pdf_response = requests.get(
            f"{BASE_URL}/api/invoices/{invoice_id}/pdf",
            headers=auth_headers
        )
        assert pdf_response.status_code == 200, f"PDF download failed: {pdf_response.text}"
        assert 'application/pdf' in pdf_response.headers.get('content-type', '')
        print(f"PDF downloaded successfully, size: {len(pdf_response.content)} bytes")
    
    def test_download_invoice_excel(self, auth_headers):
        """GET /api/invoices/{id}/excel - download Excel"""
        response = requests.get(f"{BASE_URL}/api/invoices", headers=auth_headers)
        assert response.status_code == 200
        invoices = response.json()
        
        if len(invoices) == 0:
            pytest.skip("No invoices available")
        
        invoice = invoices[0]
        invoice_id = invoice['id']
        
        excel_response = requests.get(
            f"{BASE_URL}/api/invoices/{invoice_id}/excel",
            headers=auth_headers
        )
        assert excel_response.status_code == 200, f"Excel download failed: {excel_response.text}"
        content_type = excel_response.headers.get('content-type', '')
        assert 'spreadsheet' in content_type or 'excel' in content_type.lower() or 'octet-stream' in content_type
        print(f"Excel downloaded successfully, size: {len(excel_response.content)} bytes")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
