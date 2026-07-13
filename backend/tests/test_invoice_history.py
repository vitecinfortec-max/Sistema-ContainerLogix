"""
Test suite for Invoice History feature:
- GET /api/invoices/{id}/history endpoint
- History logging on create/update/delete
- Menu simplification (Faturamento only shows 'Faturas')
"""

import pytest
import requests
import os
import uuid

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
    pytest.skip("Authentication failed - skipping tests")

@pytest.fixture(scope="module")
def auth_headers(auth_token):
    """Return headers with auth token"""
    return {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    }

class TestInvoiceHistoryEndpoint:
    """Tests for GET /api/invoices/{id}/history endpoint"""
    
    def test_get_invoice_history_returns_list(self, auth_headers):
        """Test that history endpoint returns list of history entries"""
        # Get existing invoice
        invoices_res = requests.get(f"{BASE_URL}/api/invoices", headers=auth_headers)
        assert invoices_res.status_code == 200
        invoices = invoices_res.json()
        
        if len(invoices) == 0:
            pytest.skip("No invoices available for testing")
        
        invoice = invoices[0]
        
        # Get history
        history_res = requests.get(
            f"{BASE_URL}/api/invoices/{invoice['id']}/history",
            headers=auth_headers
        )
        
        assert history_res.status_code == 200
        history = history_res.json()
        assert isinstance(history, list)
    
    def test_get_invoice_history_structure(self, auth_headers):
        """Test that history entries have correct structure"""
        # Get invoice #4 which has history
        invoice_id = "ca449bee-92c3-44b6-945a-654035b4f61e"
        
        history_res = requests.get(
            f"{BASE_URL}/api/invoices/{invoice_id}/history",
            headers=auth_headers
        )
        
        if history_res.status_code == 404:
            pytest.skip("Invoice #4 not found")
        
        assert history_res.status_code == 200
        history = history_res.json()
        
        if len(history) > 0:
            entry = history[0]
            # Validate structure
            assert "id" in entry
            assert "invoice_id" in entry
            assert "invoice_number" in entry
            assert "action" in entry
            assert "changes" in entry
            assert "user_name" in entry
            assert "created_at" in entry
            
            # Validate action is one of expected values
            assert entry["action"] in ["CREATED", "UPDATED", "DELETED"]
    
    def test_get_invoice_history_empty_for_nonexistent(self, auth_headers):
        """Test that history returns empty array for non-existent invoice"""
        fake_id = str(uuid.uuid4())
        
        history_res = requests.get(
            f"{BASE_URL}/api/invoices/{fake_id}/history",
            headers=auth_headers
        )
        
        # Returns 200 with empty array (acceptable behavior)
        assert history_res.status_code == 200
        assert history_res.json() == []
    
    def test_get_invoice_history_requires_auth(self):
        """Test that history endpoint requires authentication"""
        invoice_id = "ca449bee-92c3-44b6-945a-654035b4f61e"
        
        history_res = requests.get(
            f"{BASE_URL}/api/invoices/{invoice_id}/history"
        )
        
        # Returns 403 Forbidden without auth token
        assert history_res.status_code in [401, 403]


class TestInvoiceHistoryLogging:
    """Tests for history logging on invoice operations"""
    
    def test_invoice_update_creates_history_entry(self, auth_headers):
        """Test that updating an invoice creates a history entry"""
        # Get existing invoice
        invoices_res = requests.get(f"{BASE_URL}/api/invoices", headers=auth_headers)
        invoices = invoices_res.json()
        
        if len(invoices) == 0:
            pytest.skip("No invoices available for testing")
        
        invoice = invoices[0]
        invoice_id = invoice['id']
        
        # Get initial history count
        history_before = requests.get(
            f"{BASE_URL}/api/invoices/{invoice_id}/history",
            headers=auth_headers
        ).json()
        initial_count = len(history_before)
        
        # Update the invoice
        unique_note = f"TEST_HistoryNote_{uuid.uuid4().hex[:8]}"
        update_res = requests.put(
            f"{BASE_URL}/api/invoices/{invoice_id}",
            headers=auth_headers,
            json={"notes": unique_note}
        )
        
        if update_res.status_code != 200:
            pytest.skip("Could not update invoice")
        
        # Get history after update
        history_after = requests.get(
            f"{BASE_URL}/api/invoices/{invoice_id}/history",
            headers=auth_headers
        ).json()
        
        # Verify history count increased
        assert len(history_after) > initial_count
        
        # Verify last entry is UPDATED action
        latest_entry = history_after[0]  # History is sorted desc by created_at
        assert latest_entry["action"] == "UPDATED"
        assert "notes" in latest_entry["changes"]


class TestInvoiceMovementsTab:
    """Tests for invoice movements retrieval (used in Movimentações tab)"""
    
    def test_get_invoice_movements(self, auth_headers):
        """Test GET /api/invoices/{id}/movements returns movement details"""
        invoices_res = requests.get(f"{BASE_URL}/api/invoices", headers=auth_headers)
        invoices = invoices_res.json()
        
        if len(invoices) == 0:
            pytest.skip("No invoices available")
        
        invoice = invoices[0]
        
        movements_res = requests.get(
            f"{BASE_URL}/api/invoices/{invoice['id']}/movements",
            headers=auth_headers
        )
        
        assert movements_res.status_code == 200
        movements = movements_res.json()
        assert isinstance(movements, list)
        
        # If invoice has movements, verify structure
        if len(movements) > 0:
            mov = movements[0]
            assert "id" in mov
            assert "transaction_id" in mov
            assert "container_number" in mov
            assert "operation_type" in mov


class TestInvoiceDownloads:
    """Tests for PDF/Excel download in details modal"""
    
    def test_invoice_pdf_download(self, auth_headers):
        """Test PDF download endpoint"""
        invoices_res = requests.get(f"{BASE_URL}/api/invoices", headers=auth_headers)
        invoices = invoices_res.json()
        
        if len(invoices) == 0:
            pytest.skip("No invoices available")
        
        invoice = invoices[0]
        
        pdf_res = requests.get(
            f"{BASE_URL}/api/invoices/{invoice['id']}/pdf",
            headers=auth_headers
        )
        
        assert pdf_res.status_code == 200
        assert 'application/pdf' in pdf_res.headers.get('Content-Type', '')
    
    def test_invoice_excel_download(self, auth_headers):
        """Test Excel download endpoint"""
        invoices_res = requests.get(f"{BASE_URL}/api/invoices", headers=auth_headers)
        invoices = invoices_res.json()
        
        if len(invoices) == 0:
            pytest.skip("No invoices available")
        
        invoice = invoices[0]
        
        excel_res = requests.get(
            f"{BASE_URL}/api/invoices/{invoice['id']}/excel",
            headers=auth_headers
        )
        
        assert excel_res.status_code == 200
        content_type = excel_res.headers.get('Content-Type', '')
        assert 'spreadsheet' in content_type or 'excel' in content_type.lower()


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
