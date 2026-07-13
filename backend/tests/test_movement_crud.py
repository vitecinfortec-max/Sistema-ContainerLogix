"""
Backend tests for ContainerLogix - Movement CRUD operations
Specifically testing: PUT /movements/{id} - preserving transaction_id

Test credentials: test@teste.com / teste123
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "test@teste.com"
TEST_PASSWORD = "teste123"


class TestAuth:
    """Authentication endpoint tests"""
    
    def test_login_success(self):
        """Test login with valid credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "access_token" in data
        assert "user" in data
        print(f"Login successful for {data['user']['email']}")


class TestMovementCRUD:
    """Movement CRUD tests - specifically testing PUT endpoint preserves transaction_id"""
    
    @pytest.fixture
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        if response.status_code == 200:
            return response.json().get("access_token")
        pytest.skip("Authentication failed - skipping authenticated tests")
    
    @pytest.fixture
    def auth_headers(self, auth_token):
        """Get auth headers"""
        return {"Authorization": f"Bearer {auth_token}"}
    
    def test_create_and_get_movement(self, auth_headers):
        """Test creating a movement and retrieving it"""
        # Create movement
        movement_data = {
            "operation_type": "ENTRADA",
            "driver_name": "TEST_Motorista Teste",
            "driver_cpf": "123.456.789-00",
            "truck_plate": "ABC-1234",
            "trailer_plate_1": "DEF-5678",
            "trailer_plate_2": "",
            "transport_company": "Transportadora Teste",
            "container_number": "TESTEDIT12345",
            "status": "CHEIO",
            "size_type": "40HC",
            "tare": "3800",
            "shipping_line": "CMA CGM",
            "seal": "SEAL123",
            "genset": "",
            "booking": "BOOK123"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/movements",
            json=movement_data,
            headers=auth_headers
        )
        assert response.status_code == 200, f"Create movement failed: {response.text}"
        created = response.json()
        assert "id" in created
        assert "transaction_id" in created
        assert created["container_number"] == "TESTEDIT12345"
        print(f"Created movement with id={created['id']}, transaction_id={created['transaction_id']}")
        
        movement_id = created["id"]
        original_transaction_id = created["transaction_id"]
        
        # GET to verify
        get_response = requests.get(
            f"{BASE_URL}/api/movements/{movement_id}",
            headers=auth_headers
        )
        assert get_response.status_code == 200
        fetched = get_response.json()
        assert fetched["transaction_id"] == original_transaction_id
        print(f"GET verified - transaction_id preserved: {original_transaction_id}")
        
        return movement_id, original_transaction_id
    
    def test_update_movement_preserves_transaction_id(self, auth_headers):
        """
        CRITICAL TEST: Test that PUT /movements/{id} preserves transaction_id
        This was the reported bug - editing movements lost transaction_id
        """
        # First create a movement
        movement_data = {
            "operation_type": "ENTRADA",
            "driver_name": "TEST_Motorista Update",
            "driver_cpf": "111.222.333-44",
            "truck_plate": "XYZ-9999",
            "trailer_plate_1": "UVW-8888",
            "trailer_plate_2": "",
            "transport_company": "Transportadora Update Teste",
            "container_number": "TESTUPD999999",
            "status": "CHEIO",
            "size_type": "20DC",
            "tare": "2200",
            "shipping_line": "MSC",
            "seal": "",
            "genset": "",
            "booking": ""
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/movements",
            json=movement_data,
            headers=auth_headers
        )
        assert create_response.status_code == 200, f"Create failed: {create_response.text}"
        created = create_response.json()
        
        movement_id = created["id"]
        original_transaction_id = created["transaction_id"]
        print(f"Created movement: id={movement_id}, transaction_id={original_transaction_id}")
        
        # Now UPDATE the movement - changing driver name and status
        updated_data = {
            "operation_type": "ENTRADA",
            "driver_name": "TEST_Motorista Atualizado",  # Changed
            "driver_cpf": "111.222.333-44",
            "truck_plate": "XYZ-9999",
            "trailer_plate_1": "UVW-8888",
            "trailer_plate_2": "ABC-1111",  # Added
            "transport_company": "Transportadora Update Teste",
            "container_number": "TESTUPD999999",
            "status": "VAZIO",  # Changed from CHEIO to VAZIO
            "size_type": "20DC",
            "tare": "2200",
            "shipping_line": "MSC",
            "seal": "NEWSEAL123",  # Added
            "genset": "",
            "booking": "NEWBOOKING"  # Added
        }
        
        update_response = requests.put(
            f"{BASE_URL}/api/movements/{movement_id}",
            json=updated_data,
            headers=auth_headers
        )
        assert update_response.status_code == 200, f"Update failed: {update_response.text}"
        updated = update_response.json()
        
        # CRITICAL ASSERTION: transaction_id must be preserved after update
        assert updated["transaction_id"] == original_transaction_id, \
            f"BUG: transaction_id changed! Original: {original_transaction_id}, After update: {updated.get('transaction_id')}"
        
        # Verify other fields were updated
        assert updated["driver_name"] == "TEST_Motorista Atualizado"
        assert updated["status"] == "VAZIO"
        assert updated["seal"] == "NEWSEAL123"
        assert updated["trailer_plate_2"] == "ABC-1111"
        
        print(f"UPDATE SUCCESS: transaction_id preserved as {original_transaction_id}")
        
        # GET to double-verify persistence
        get_response = requests.get(
            f"{BASE_URL}/api/movements/{movement_id}",
            headers=auth_headers
        )
        assert get_response.status_code == 200
        fetched = get_response.json()
        
        assert fetched["transaction_id"] == original_transaction_id, \
            f"GET after UPDATE shows wrong transaction_id: {fetched.get('transaction_id')}"
        assert fetched["driver_name"] == "TEST_Motorista Atualizado"
        assert fetched["status"] == "VAZIO"
        
        print(f"GET after UPDATE verified - transaction_id={fetched['transaction_id']}, status={fetched['status']}")
        
        # Cleanup - delete test movement
        delete_response = requests.delete(
            f"{BASE_URL}/api/movements/{movement_id}",
            headers=auth_headers
        )
        assert delete_response.status_code == 200
        print(f"Cleanup: Deleted test movement {movement_id}")
    
    def test_get_movements_list(self, auth_headers):
        """Test getting list of movements"""
        response = requests.get(
            f"{BASE_URL}/api/movements",
            headers=auth_headers
        )
        assert response.status_code == 200
        movements = response.json()
        assert isinstance(movements, list)
        print(f"Found {len(movements)} movements")
    
    def test_delete_movement(self, auth_headers):
        """Test deleting a movement"""
        # Create a movement to delete
        movement_data = {
            "operation_type": "SAIDA",
            "driver_name": "TEST_Motorista Delete",
            "driver_cpf": "999.888.777-66",
            "truck_plate": "DEL-1234",
            "trailer_plate_1": "DEL-5678",
            "trailer_plate_2": "",
            "transport_company": "Transportadora Delete",
            "container_number": "TESTDEL000000",
            "status": "VAZIO",
            "size_type": "40DRY",
            "tare": "",
            "shipping_line": "Maersk",
            "seal": "",
            "genset": "",
            "booking": ""
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/movements",
            json=movement_data,
            headers=auth_headers
        )
        assert create_response.status_code == 200
        created = create_response.json()
        movement_id = created["id"]
        
        # Delete
        delete_response = requests.delete(
            f"{BASE_URL}/api/movements/{movement_id}",
            headers=auth_headers
        )
        assert delete_response.status_code == 200
        
        # Verify deleted - should return 404
        get_response = requests.get(
            f"{BASE_URL}/api/movements/{movement_id}",
            headers=auth_headers
        )
        assert get_response.status_code == 404
        print(f"Movement {movement_id} deleted and verified")


class TestDashboard:
    """Dashboard endpoint tests"""
    
    @pytest.fixture
    def auth_headers(self):
        """Get auth headers"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        if response.status_code == 200:
            return {"Authorization": f"Bearer {response.json()['access_token']}"}
        pytest.skip("Authentication failed")
    
    def test_get_dashboard_stats(self, auth_headers):
        """Test dashboard endpoint returns proper stats"""
        response = requests.get(
            f"{BASE_URL}/api/dashboard",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify required fields
        assert "total_movements" in data
        assert "entries_today" in data
        assert "exits_today" in data
        assert "full_containers" in data
        assert "empty_containers" in data
        assert "current_stock" in data
        assert "recent_movements" in data
        
        print(f"Dashboard: total={data['total_movements']}, stock={data['current_stock']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
