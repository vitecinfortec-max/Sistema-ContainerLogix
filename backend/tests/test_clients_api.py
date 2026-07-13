"""
Backend tests for Clients API - CRUD operations
Tests: GET, POST, PUT, DELETE for /api/clients endpoints
"""

import pytest
import requests
import os
import uuid

# Get the base URL from environment
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://container-mvmt-sys.preview.emergentagent.com').rstrip('/')

# Test user credentials
TEST_USER = {
    "email": f"test_client_api_{uuid.uuid4().hex[:6]}@test.com",
    "password": "testpass123",
    "name": "Test Client API User"
}


@pytest.fixture(scope="module")
def api_session():
    """Create a requests session for all tests"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def auth_token(api_session):
    """Register and get authentication token"""
    # Register new user
    response = api_session.post(f"{BASE_URL}/api/auth/register", json=TEST_USER)
    if response.status_code == 200:
        token = response.json().get("access_token")
        return token
    elif response.status_code == 400 and "já cadastrado" in response.json().get("detail", ""):
        # If user exists, try login
        login_response = api_session.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_USER["email"],
            "password": TEST_USER["password"]
        })
        if login_response.status_code == 200:
            return login_response.json().get("access_token")
    pytest.skip("Could not authenticate for tests")


@pytest.fixture(scope="module")
def authenticated_session(api_session, auth_token):
    """Session with authentication header"""
    api_session.headers.update({"Authorization": f"Bearer {auth_token}"})
    return api_session


class TestClientsAPI:
    """Test CRUD operations for Clients API"""
    
    created_client_ids = []  # Track created clients for cleanup
    
    def test_create_client_with_all_fields(self, authenticated_session):
        """Test creating a client with all fields including CNPJ and phone"""
        client_data = {
            "name": "TEST_Cliente Teste Completo",
            "cnpj": "12.345.678/0001-99",
            "phone": "(11) 98765-4321",
            "email": "cliente@teste.com",
            "address": "Rua Teste, 123 - São Paulo/SP"
        }
        
        response = authenticated_session.post(f"{BASE_URL}/api/clients", json=client_data)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["name"] == client_data["name"]
        assert data["cnpj"] == client_data["cnpj"]
        assert data["phone"] == client_data["phone"]
        assert data["email"] == client_data["email"]
        assert data["address"] == client_data["address"]
        assert "id" in data
        assert "created_at" in data
        
        self.created_client_ids.append(data["id"])
        print(f"✓ Created client with ID: {data['id']}")
    
    def test_create_client_minimal(self, authenticated_session):
        """Test creating a client with only required fields"""
        client_data = {
            "name": "TEST_Cliente Simples"
        }
        
        response = authenticated_session.post(f"{BASE_URL}/api/clients", json=client_data)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["name"] == client_data["name"]
        assert "id" in data
        
        self.created_client_ids.append(data["id"])
        print(f"✓ Created minimal client with ID: {data['id']}")
    
    def test_get_all_clients(self, authenticated_session):
        """Test getting all clients"""
        response = authenticated_session.get(f"{BASE_URL}/api/clients")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list)
        
        # Verify our created clients are in the list
        client_names = [c["name"] for c in data]
        assert any("TEST_" in name for name in client_names), "Test clients should be in the list"
        
        print(f"✓ Retrieved {len(data)} clients")
    
    def test_update_client(self, authenticated_session):
        """Test updating a client"""
        # First create a client to update
        create_data = {
            "name": "TEST_Cliente Para Atualizar",
            "cnpj": "00.000.000/0001-00",
            "phone": "(00) 00000-0000"
        }
        
        create_response = authenticated_session.post(f"{BASE_URL}/api/clients", json=create_data)
        assert create_response.status_code == 200
        client_id = create_response.json()["id"]
        self.created_client_ids.append(client_id)
        
        # Now update the client
        update_data = {
            "name": "TEST_Cliente Atualizado",
            "cnpj": "11.111.111/0001-11",
            "phone": "(11) 11111-1111",
            "email": "atualizado@teste.com",
            "address": "Rua Atualizada, 456"
        }
        
        update_response = authenticated_session.put(f"{BASE_URL}/api/clients/{client_id}", json=update_data)
        
        assert update_response.status_code == 200, f"Expected 200, got {update_response.status_code}: {update_response.text}"
        
        data = update_response.json()
        assert data["name"] == update_data["name"]
        assert data["cnpj"] == update_data["cnpj"]
        assert data["phone"] == update_data["phone"]
        assert data["email"] == update_data["email"]
        assert data["address"] == update_data["address"]
        
        # Verify persistence with GET
        get_response = authenticated_session.get(f"{BASE_URL}/api/clients")
        assert get_response.status_code == 200
        clients = get_response.json()
        updated_client = next((c for c in clients if c["id"] == client_id), None)
        assert updated_client is not None
        assert updated_client["name"] == update_data["name"]
        
        print(f"✓ Updated client {client_id}")
    
    def test_update_nonexistent_client(self, authenticated_session):
        """Test updating a client that doesn't exist"""
        fake_id = str(uuid.uuid4())
        update_data = {
            "name": "TEST_Nonexistent"
        }
        
        response = authenticated_session.put(f"{BASE_URL}/api/clients/{fake_id}", json=update_data)
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print(f"✓ Correctly returned 404 for nonexistent client")
    
    def test_delete_client(self, authenticated_session):
        """Test deleting a client"""
        # First create a client to delete
        create_data = {
            "name": "TEST_Cliente Para Deletar"
        }
        
        create_response = authenticated_session.post(f"{BASE_URL}/api/clients", json=create_data)
        assert create_response.status_code == 200
        client_id = create_response.json()["id"]
        
        # Delete the client
        delete_response = authenticated_session.delete(f"{BASE_URL}/api/clients/{client_id}")
        
        assert delete_response.status_code == 200, f"Expected 200, got {delete_response.status_code}: {delete_response.text}"
        
        data = delete_response.json()
        assert "deletado" in data.get("message", "").lower() or "success" in data.get("message", "").lower()
        
        # Verify deletion - client should not be in the list
        get_response = authenticated_session.get(f"{BASE_URL}/api/clients")
        assert get_response.status_code == 200
        clients = get_response.json()
        client_ids = [c["id"] for c in clients]
        assert client_id not in client_ids, "Deleted client should not be in the list"
        
        print(f"✓ Deleted client {client_id}")
    
    def test_delete_nonexistent_client(self, authenticated_session):
        """Test deleting a client that doesn't exist"""
        fake_id = str(uuid.uuid4())
        
        response = authenticated_session.delete(f"{BASE_URL}/api/clients/{fake_id}")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print(f"✓ Correctly returned 404 for nonexistent client deletion")
    
    @pytest.fixture(autouse=True, scope="class")
    def cleanup(self, authenticated_session):
        """Cleanup test data after all tests"""
        yield
        
        # Clean up created clients
        for client_id in self.created_client_ids:
            try:
                authenticated_session.delete(f"{BASE_URL}/api/clients/{client_id}")
                print(f"Cleaned up client: {client_id}")
            except Exception as e:
                print(f"Could not clean up client {client_id}: {e}")


class TestMovementsWithClientField:
    """Test movements API with client_name field"""
    
    created_movement_ids = []
    
    def test_create_movement_with_client(self, authenticated_session):
        """Test creating a movement with client_name field"""
        movement_data = {
            "operation_type": "ENTRADA",
            "driver_name": "TEST_Motorista Teste",
            "driver_cpf": "111.111.111-11",
            "truck_plate": "ABC1234",
            "trailer_plate_1": "DEF5678",
            "transport_company": "TEST_Transportadora",
            "client_name": "TEST_Cliente da Movimentação",
            "container_number": "TESTCNT001",
            "status": "CHEIO",
            "size_type": "20DC",
            "shipping_line": "CMA CGM",
            "service_value": 150.50
        }
        
        response = authenticated_session.post(f"{BASE_URL}/api/movements", json=movement_data)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["client_name"] == movement_data["client_name"]
        assert data["service_value"] == movement_data["service_value"]
        assert "id" in data
        
        self.created_movement_ids.append(data["id"])
        print(f"✓ Created movement with client_name: {data['id']}")
    
    def test_create_movement_without_client(self, authenticated_session):
        """Test creating a movement without client_name (optional field)"""
        movement_data = {
            "operation_type": "SAIDA",
            "driver_name": "TEST_Motorista Sem Cliente",
            "driver_cpf": "222.222.222-22",
            "truck_plate": "GHI9012",
            "trailer_plate_1": "JKL3456",
            "transport_company": "TEST_Transportadora 2",
            "container_number": "TESTCNT002",
            "status": "VAZIO",
            "size_type": "40HC",
            "shipping_line": "MSC"
        }
        
        response = authenticated_session.post(f"{BASE_URL}/api/movements", json=movement_data)
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["client_name"] is None or data["client_name"] == ""
        
        self.created_movement_ids.append(data["id"])
        print(f"✓ Created movement without client_name: {data['id']}")
    
    def test_get_movement_with_client(self, authenticated_session):
        """Test getting a movement and verifying client_name is present"""
        # Create a movement first
        movement_data = {
            "operation_type": "ENTRADA",
            "driver_name": "TEST_Motorista Get",
            "driver_cpf": "333.333.333-33",
            "truck_plate": "MNO4567",
            "trailer_plate_1": "PQR8901",
            "transport_company": "TEST_Transportadora Get",
            "client_name": "TEST_Cliente Get",
            "container_number": "TESTCNT003",
            "status": "CHEIO",
            "size_type": "20RF",
            "shipping_line": "ONE"
        }
        
        create_response = authenticated_session.post(f"{BASE_URL}/api/movements", json=movement_data)
        assert create_response.status_code == 200
        movement_id = create_response.json()["id"]
        self.created_movement_ids.append(movement_id)
        
        # Get the movement
        get_response = authenticated_session.get(f"{BASE_URL}/api/movements/{movement_id}")
        
        assert get_response.status_code == 200, f"Expected 200, got {get_response.status_code}: {get_response.text}"
        
        data = get_response.json()
        assert data["client_name"] == movement_data["client_name"]
        
        print(f"✓ Retrieved movement with client_name: {movement_id}")
    
    def test_update_movement_client_field(self, authenticated_session):
        """Test updating a movement's client_name field"""
        # Create a movement first
        movement_data = {
            "operation_type": "ENTRADA",
            "driver_name": "TEST_Motorista Update",
            "driver_cpf": "444.444.444-44",
            "truck_plate": "STU2345",
            "trailer_plate_1": "VWX6789",
            "transport_company": "TEST_Transportadora Update",
            "client_name": "TEST_Cliente Original",
            "container_number": "TESTCNT004",
            "status": "VAZIO",
            "size_type": "40RF",
            "shipping_line": "Maersk"
        }
        
        create_response = authenticated_session.post(f"{BASE_URL}/api/movements", json=movement_data)
        assert create_response.status_code == 200
        movement_id = create_response.json()["id"]
        self.created_movement_ids.append(movement_id)
        
        # Update the movement with a different client
        update_data = movement_data.copy()
        update_data["client_name"] = "TEST_Cliente Atualizado"
        
        update_response = authenticated_session.put(f"{BASE_URL}/api/movements/{movement_id}", json=update_data)
        
        assert update_response.status_code == 200, f"Expected 200, got {update_response.status_code}: {update_response.text}"
        
        data = update_response.json()
        assert data["client_name"] == "TEST_Cliente Atualizado"
        
        print(f"✓ Updated movement client_name: {movement_id}")
    
    @pytest.fixture(autouse=True, scope="class")
    def cleanup(self, authenticated_session):
        """Cleanup test data after all tests"""
        yield
        
        # Clean up created movements
        for movement_id in self.created_movement_ids:
            try:
                authenticated_session.delete(f"{BASE_URL}/api/movements/{movement_id}")
                print(f"Cleaned up movement: {movement_id}")
            except Exception as e:
                print(f"Could not clean up movement {movement_id}: {e}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
