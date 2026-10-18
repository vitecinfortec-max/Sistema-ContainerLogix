"""
Test cases for billing features:
- service_value field in movements
- billed and billed_at fields 
- Billing report generation marks movements as billed
"""
import pytest
import requests
import os
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def auth_token():
    """Register/login and get auth token"""
    # Try to register, if fails try login
    test_email = f"billing_test_{int(datetime.now().timestamp())}@test.com"
    test_password = "Test123456"
    
    response = requests.post(f"{BASE_URL}/api/auth/register", json={
        "name": "Billing Test User",
        "email": test_email,
        "password": test_password,
        "role": "admin"
    })
    
    if response.status_code == 200:
        return response.json()["access_token"]
    
    # If registration fails, try with existing user
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "test@teste.com",
        "password": "teste123"
    })
    
    if response.status_code == 200:
        return response.json()["access_token"]
    
    pytest.skip("Authentication failed")

@pytest.fixture
def api_client(auth_token):
    """Requests session with auth header"""
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {auth_token}"
    })
    return session


class TestServiceValueField:
    """Tests for service_value field in movements"""
    
    def test_create_movement_with_service_value(self, api_client):
        """Test creating a movement with service_value field"""
        movement_data = {
            "operation_type": "ENTRADA",
            "driver_name": "TEST_Motorista Valor",
            "driver_cpf": "123.456.789-00",
            "truck_plate": "ABC-1234",
            "trailer_plate_1": "DEF-5678",
            "transport_company": "TEST_Transportadora Valor",
            "container_number": "TESV1234567",
            "status": "CHEIO",
            "size_type": "40HC",
            "shipping_line": "MSC",
            "service_value": 150.50
        }
        
        response = api_client.post(f"{BASE_URL}/api/movements", json=movement_data)
        assert response.status_code == 200, f"Failed to create movement: {response.text}"
        
        data = response.json()
        assert "id" in data
        assert data["service_value"] == 150.50
        assert data["billed"] == False
        assert data["billed_at"] is None
        
        # Cleanup
        api_client.delete(f"{BASE_URL}/api/movements/{data['id']}")
        print("✓ Create movement with service_value: PASSED")
    
    def test_create_movement_without_service_value(self, api_client):
        """Test creating a movement without service_value (should be null)"""
        movement_data = {
            "operation_type": "SAIDA",
            "driver_name": "TEST_Motorista Sem Valor",
            "driver_cpf": "987.654.321-00",
            "truck_plate": "XYZ-9999",
            "trailer_plate_1": "UVW-8888",
            "transport_company": "TEST_Transportadora",
            "container_number": "TESN9876543",
            "status": "VAZIO",
            "size_type": "20DC",
            "shipping_line": "CMA CGM"
        }
        
        response = api_client.post(f"{BASE_URL}/api/movements", json=movement_data)
        assert response.status_code == 200, f"Failed to create movement: {response.text}"
        
        data = response.json()
        assert data["service_value"] is None
        assert data["billed"] == False
        
        # Cleanup
        api_client.delete(f"{BASE_URL}/api/movements/{data['id']}")
        print("✓ Create movement without service_value: PASSED")
    
    def test_update_movement_service_value(self, api_client):
        """Test updating a movement's service_value"""
        # Create movement
        movement_data = {
            "operation_type": "ENTRADA",
            "driver_name": "TEST_Update Valor",
            "driver_cpf": "111.222.333-44",
            "truck_plate": "UPD-1111",
            "trailer_plate_1": "UPD-2222",
            "transport_company": "TEST_Update Transport",
            "container_number": "UPDT1234567",
            "status": "CHEIO",
            "size_type": "40HC",
            "shipping_line": "ONE",
            "service_value": 100.00
        }
        
        response = api_client.post(f"{BASE_URL}/api/movements", json=movement_data)
        assert response.status_code == 200
        movement_id = response.json()["id"]
        
        # Update service_value
        movement_data["service_value"] = 250.75
        update_response = api_client.put(f"{BASE_URL}/api/movements/{movement_id}", json=movement_data)
        assert update_response.status_code == 200
        
        updated_data = update_response.json()
        assert updated_data["service_value"] == 250.75
        
        # Verify with GET
        get_response = api_client.get(f"{BASE_URL}/api/movements/{movement_id}")
        assert get_response.status_code == 200
        assert get_response.json()["service_value"] == 250.75
        
        # Cleanup
        api_client.delete(f"{BASE_URL}/api/movements/{movement_id}")
        print("✓ Update movement service_value: PASSED")


class TestBillingReportRemoved:
    """POST /api/billing/report foi removida: marcava movimentações como
    faturadas sem gerar fatura. O faturamento é feito pela Fatura."""

    def test_billing_report_route_no_longer_exists(self, api_client):
        response = api_client.post(f"{BASE_URL}/api/billing/report", json={"movement_ids": []})
        assert response.status_code in (404, 405)


class TestMovementResponseFields:
    """Tests for verifying all movement response fields"""
    
    def test_movement_response_has_billing_fields(self, api_client):
        """Test that movement response includes billed and billed_at fields"""
        movement_data = {
            "operation_type": "ENTRADA",
            "driver_name": "TEST_Fields Check",
            "driver_cpf": "555.444.333-22",
            "truck_plate": "FLD-1234",
            "trailer_plate_1": "FLD-5678",
            "transport_company": "TEST_Fields Company",
            "container_number": "FLDC1234567",
            "status": "CHEIO",
            "size_type": "40HC",
            "shipping_line": "MSC",
            "service_value": 175.25
        }
        
        response = api_client.post(f"{BASE_URL}/api/movements", json=movement_data)
        assert response.status_code == 200
        
        data = response.json()
        
        # Verify all expected fields exist
        expected_fields = [
            "id", "transaction_id", "operation_type", "driver_name", "driver_cpf",
            "truck_plate", "trailer_plate_1", "transport_company", "container_number",
            "status", "size_type", "shipping_line", "service_value", "billed", "billed_at",
            "created_at", "user_name"
        ]
        
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"
        
        # Verify field types
        assert isinstance(data["service_value"], (int, float)) or data["service_value"] is None
        assert isinstance(data["billed"], bool)
        assert data["billed_at"] is None or isinstance(data["billed_at"], str)
        
        # Cleanup
        api_client.delete(f"{BASE_URL}/api/movements/{data['id']}")
        print("✓ Movement response has billing fields: PASSED")
    
    def test_movements_list_includes_billing_fields(self, api_client):
        """Test that movements list endpoint includes billing fields"""
        response = api_client.get(f"{BASE_URL}/api/movements")
        assert response.status_code == 200
        
        movements = response.json()
        if len(movements) > 0:
            movement = movements[0]
            assert "service_value" in movement
            assert "billed" in movement
            assert "billed_at" in movement
        
        print("✓ Movements list includes billing fields: PASSED")
