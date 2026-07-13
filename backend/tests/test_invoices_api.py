"""
Test suite for Invoice (Fatura) API endpoints
Tests: CRUD operations for invoices, unbilled movements, and invoice-movement relationships
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test user credentials
TEST_USER = {"email": "test_invoice@test.com", "password": "test123"}


@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def auth_token(api_client):
    """Get authentication token - register if user doesn't exist"""
    # Try login first
    response = api_client.post(f"{BASE_URL}/api/auth/login", json=TEST_USER)
    
    if response.status_code == 200:
        return response.json().get("access_token")
    
    # Register new user if login fails
    register_data = {
        "name": "Test Invoice User",
        "email": TEST_USER["email"],
        "password": TEST_USER["password"],
        "role": "admin"
    }
    response = api_client.post(f"{BASE_URL}/api/auth/register", json=register_data)
    if response.status_code == 200:
        return response.json().get("access_token")
    
    # Try login again after registration attempt (user might exist with different password)
    response = api_client.post(f"{BASE_URL}/api/auth/login", json=TEST_USER)
    if response.status_code == 200:
        return response.json().get("access_token")
    
    pytest.skip(f"Authentication failed: {response.text}")


@pytest.fixture(scope="module")
def authenticated_client(api_client, auth_token):
    """Session with auth header"""
    api_client.headers.update({"Authorization": f"Bearer {auth_token}"})
    return api_client


@pytest.fixture(scope="module")
def test_client(authenticated_client):
    """Create a test client for invoice tests"""
    client_data = {
        "name": f"TEST_InvoiceClient_{uuid.uuid4().hex[:8]}",
        "cnpj": "12.345.678/0001-90",
        "phone": "11999999999",
        "email": "testclient@test.com",
        "address": "Test Address"
    }
    response = authenticated_client.post(f"{BASE_URL}/api/clients", json=client_data)
    if response.status_code == 200:
        return response.json()
    return None


@pytest.fixture(scope="module")
def test_movements(authenticated_client, test_client):
    """Create test movements for invoice creation"""
    movements = []
    client_name = test_client["name"] if test_client else "TestClient"
    
    for i in range(3):
        movement_data = {
            "operation_type": "ENTRADA",
            "driver_name": f"Test Driver {i}",
            "driver_cpf": "123.456.789-00",
            "truck_plate": f"ABC{i}234",
            "trailer_plate_1": f"XYZ{i}567",
            "trailer_plate_2": None,
            "transport_company": "Test Transport Co",
            "client_name": client_name,
            "container_number": f"CONT{uuid.uuid4().hex[:8].upper()}",
            "status": "CHEIO",
            "size_type": "40HC",
            "tare": "3800",
            "shipping_line": "MSC",
            "seal": f"SEAL{i}",
            "genset": None,
            "booking": f"BK{i}123",
            "service_type": "Armazenagem",
            "invoice_number": None,
            "service_value": 150.00 + (i * 50),  # 150, 200, 250
        }
        response = authenticated_client.post(f"{BASE_URL}/api/movements", json=movement_data)
        if response.status_code == 200:
            movements.append(response.json())
    
    return movements


class TestInvoicesEndpoints:
    """Test suite for Invoice API endpoints"""
    
    def test_get_invoices_endpoint_exists(self, authenticated_client):
        """Test GET /api/invoices returns valid response"""
        response = authenticated_client.get(f"{BASE_URL}/api/invoices")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
    
    def test_get_invoices_count_endpoint(self, authenticated_client):
        """Test GET /api/invoices/count returns valid count"""
        response = authenticated_client.get(f"{BASE_URL}/api/invoices/count")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "count" in data, "Response should have 'count' field"
        assert isinstance(data["count"], int), "Count should be an integer"
    
    def test_get_unbilled_movements_endpoint(self, authenticated_client):
        """Test GET /api/movements/unbilled returns unbilled movements"""
        response = authenticated_client.get(f"{BASE_URL}/api/movements/unbilled")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
    
    def test_get_unbilled_movements_with_search(self, authenticated_client):
        """Test unbilled movements search by query"""
        response = authenticated_client.get(f"{BASE_URL}/api/movements/unbilled", params={"search": "CONT"})
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
    
    def test_get_unbilled_movements_with_client_filter(self, authenticated_client, test_client):
        """Test unbilled movements filter by client"""
        if not test_client:
            pytest.skip("No test client available")
        
        response = authenticated_client.get(
            f"{BASE_URL}/api/movements/unbilled", 
            params={"client_name": test_client["name"]}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)


class TestInvoiceCreation:
    """Test invoice creation flow"""
    
    def test_create_invoice_success(self, authenticated_client, test_movements, test_client):
        """Test POST /api/invoices creates invoice successfully"""
        if not test_movements or len(test_movements) == 0:
            pytest.skip("No test movements available")
        
        # Get unbilled movements first
        unbilled_response = authenticated_client.get(f"{BASE_URL}/api/movements/unbilled")
        unbilled = unbilled_response.json()
        
        if len(unbilled) == 0:
            pytest.skip("No unbilled movements available for testing")
        
        # Get movement IDs to include in invoice
        movement_ids = [m["id"] for m in unbilled[:2]]  # Use first 2 unbilled
        
        # Determine client name from movements
        client_name = unbilled[0].get("client_name", "TestClient")
        
        invoice_data = {
            "client_name": client_name,
            "client_cnpj": "12.345.678/0001-90",
            "movement_ids": movement_ids,
            "notes": "Test invoice notes"
        }
        
        response = authenticated_client.post(f"{BASE_URL}/api/invoices", json=invoice_data)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "id" in data, "Invoice should have 'id'"
        assert "invoice_number" in data, "Invoice should have 'invoice_number'"
        assert data["client_name"] == client_name
        assert len(data["movement_ids"]) == len(movement_ids)
        assert data["total_value"] >= 0
        
        # Store invoice ID for later tests
        TestInvoiceCreation.created_invoice_id = data["id"]
        TestInvoiceCreation.created_invoice_number = data["invoice_number"]
    
    def test_create_invoice_no_movements_fails(self, authenticated_client):
        """Test creating invoice without movements fails"""
        invoice_data = {
            "client_name": "TestClient",
            "client_cnpj": None,
            "movement_ids": [],
            "notes": None
        }
        
        response = authenticated_client.post(f"{BASE_URL}/api/invoices", json=invoice_data)
        assert response.status_code == 400, "Should fail with empty movement_ids"
    
    def test_create_invoice_already_billed_fails(self, authenticated_client):
        """Test creating invoice with already billed movements fails"""
        if not hasattr(TestInvoiceCreation, 'created_invoice_id'):
            pytest.skip("No previously created invoice")
        
        # Get the movements from the created invoice
        invoice_response = authenticated_client.get(
            f"{BASE_URL}/api/invoices/{TestInvoiceCreation.created_invoice_id}"
        )
        if invoice_response.status_code != 200:
            pytest.skip("Could not get created invoice")
        
        invoice = invoice_response.json()
        movement_ids = invoice.get("movement_ids", [])
        
        if not movement_ids:
            pytest.skip("Invoice has no movements")
        
        # Try to create another invoice with same movements
        invoice_data = {
            "client_name": "TestClient",
            "client_cnpj": None,
            "movement_ids": movement_ids,
            "notes": None
        }
        
        response = authenticated_client.post(f"{BASE_URL}/api/invoices", json=invoice_data)
        assert response.status_code == 400, "Should fail with already billed movements"


class TestInvoiceRetrieval:
    """Test invoice retrieval operations"""
    
    def test_get_invoice_by_id(self, authenticated_client):
        """Test GET /api/invoices/{id} returns invoice"""
        if not hasattr(TestInvoiceCreation, 'created_invoice_id'):
            pytest.skip("No invoice ID available")
        
        response = authenticated_client.get(
            f"{BASE_URL}/api/invoices/{TestInvoiceCreation.created_invoice_id}"
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data["id"] == TestInvoiceCreation.created_invoice_id
        assert "invoice_number" in data
        assert "client_name" in data
        assert "total_value" in data
    
    def test_get_invoice_not_found(self, authenticated_client):
        """Test getting non-existent invoice returns 404"""
        fake_id = str(uuid.uuid4())
        response = authenticated_client.get(f"{BASE_URL}/api/invoices/{fake_id}")
        assert response.status_code == 404
    
    def test_get_invoice_movements(self, authenticated_client):
        """Test GET /api/invoices/{id}/movements returns movement details"""
        if not hasattr(TestInvoiceCreation, 'created_invoice_id'):
            pytest.skip("No invoice ID available")
        
        response = authenticated_client.get(
            f"{BASE_URL}/api/invoices/{TestInvoiceCreation.created_invoice_id}/movements"
        )
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        
        if len(data) > 0:
            # Verify movement detail fields
            movement = data[0]
            assert "id" in movement
            assert "transaction_id" in movement
            assert "container_number" in movement
            assert "operation_type" in movement
    
    def test_get_invoices_with_pagination(self, authenticated_client):
        """Test GET /api/invoices with pagination parameters"""
        response = authenticated_client.get(
            f"{BASE_URL}/api/invoices",
            params={"page": 1, "per_page": 10}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) <= 10


class TestInvoiceDeletion:
    """Test invoice deletion functionality"""
    
    def test_delete_invoice_success(self, authenticated_client, test_movements):
        """Test DELETE /api/invoices/{id} deletes invoice and unbills movements"""
        # First create an invoice to delete
        # Get unbilled movements
        unbilled_response = authenticated_client.get(f"{BASE_URL}/api/movements/unbilled")
        unbilled = unbilled_response.json()
        
        if len(unbilled) == 0:
            pytest.skip("No unbilled movements available for deletion test")
        
        # Create a new invoice
        movement_ids = [unbilled[0]["id"]]
        client_name = unbilled[0].get("client_name", "TestDeleteClient")
        
        invoice_data = {
            "client_name": client_name,
            "client_cnpj": None,
            "movement_ids": movement_ids,
            "notes": "Invoice to delete"
        }
        
        create_response = authenticated_client.post(f"{BASE_URL}/api/invoices", json=invoice_data)
        if create_response.status_code != 200:
            pytest.skip(f"Could not create invoice for deletion test: {create_response.text}")
        
        invoice_id = create_response.json()["id"]
        
        # Delete the invoice
        delete_response = authenticated_client.delete(f"{BASE_URL}/api/invoices/{invoice_id}")
        assert delete_response.status_code == 200, f"Expected 200, got {delete_response.status_code}"
        
        # Verify invoice is deleted
        get_response = authenticated_client.get(f"{BASE_URL}/api/invoices/{invoice_id}")
        assert get_response.status_code == 404, "Invoice should not exist after deletion"
        
        # Verify movement is unbilled
        unbilled_after = authenticated_client.get(f"{BASE_URL}/api/movements/unbilled").json()
        unbilled_ids = [m["id"] for m in unbilled_after]
        assert movement_ids[0] in unbilled_ids, "Movement should be unbilled after invoice deletion"
    
    def test_delete_invoice_not_found(self, authenticated_client):
        """Test deleting non-existent invoice returns 404"""
        fake_id = str(uuid.uuid4())
        response = authenticated_client.delete(f"{BASE_URL}/api/invoices/{fake_id}")
        assert response.status_code == 404


class TestInvoiceAuth:
    """Test authentication requirements for invoice endpoints"""
    
    def test_get_invoices_requires_auth(self, api_client):
        """Test GET /api/invoices requires authentication"""
        # Remove auth header
        headers = {"Content-Type": "application/json"}
        response = requests.get(f"{BASE_URL}/api/invoices", headers=headers)
        assert response.status_code == 401 or response.status_code == 403
    
    def test_create_invoice_requires_auth(self, api_client):
        """Test POST /api/invoices requires authentication"""
        headers = {"Content-Type": "application/json"}
        response = requests.post(
            f"{BASE_URL}/api/invoices", 
            headers=headers,
            json={"client_name": "Test", "movement_ids": []}
        )
        assert response.status_code == 401 or response.status_code == 403


# Run tests
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
