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


class TestBillingReport:
    """Tests for billing report generation and billed status"""
    
    def test_generate_billing_marks_as_billed(self, api_client):
        """Test that generating billing report marks movements as billed"""
        # Create test movements
        movement_ids = []
        for i in range(2):
            movement_data = {
                "operation_type": "ENTRADA",
                "driver_name": f"TEST_Billing Motorista {i}",
                "driver_cpf": f"00{i}.000.000-0{i}",
                "truck_plate": f"BIL-{i}000",
                "trailer_plate_1": f"BIL-{i}001",
                "transport_company": "TEST_Billing Company",
                "container_number": f"BILC123456{i}",
                "status": "CHEIO",
                "size_type": "40HC",
                "shipping_line": "Maersk",
                "service_value": 200.00 + i * 50
            }
            response = api_client.post(f"{BASE_URL}/api/movements", json=movement_data)
            assert response.status_code == 200
            movement_ids.append(response.json()["id"])
        
        # Generate billing report
        billing_response = api_client.post(
            f"{BASE_URL}/api/billing/report",
            json={"movement_ids": movement_ids}
        )
        assert billing_response.status_code == 200, f"Billing report failed: {billing_response.text}"
        
        # Verify Content-Type is Excel
        assert "spreadsheetml" in billing_response.headers.get("content-type", "")
        
        # Verify movements are marked as billed
        for mov_id in movement_ids:
            get_response = api_client.get(f"{BASE_URL}/api/movements/{mov_id}")
            assert get_response.status_code == 200
            mov_data = get_response.json()
            assert mov_data["billed"] == True, f"Movement {mov_id} should be marked as billed"
            assert mov_data["billed_at"] is not None, f"Movement {mov_id} should have billed_at timestamp"
        
        # Cleanup
        for mov_id in movement_ids:
            api_client.delete(f"{BASE_URL}/api/movements/{mov_id}")
        
        print("✓ Generate billing marks as billed: PASSED")
    
    def test_billing_report_single_movement(self, api_client):
        """Test billing report generation with single movement"""
        movement_data = {
            "operation_type": "SAIDA",
            "driver_name": "TEST_Single Billing",
            "driver_cpf": "999.888.777-66",
            "truck_plate": "SGL-1111",
            "trailer_plate_1": "SGL-2222",
            "transport_company": "TEST_Single Company",
            "container_number": "SGLB1234567",
            "status": "VAZIO",
            "size_type": "20DC",
            "shipping_line": "Hapag-Lloyd",
            "service_value": 99.99
        }
        
        create_response = api_client.post(f"{BASE_URL}/api/movements", json=movement_data)
        assert create_response.status_code == 200
        movement_id = create_response.json()["id"]
        
        # Generate billing for single movement
        billing_response = api_client.post(
            f"{BASE_URL}/api/billing/report",
            json={"movement_ids": [movement_id]}
        )
        assert billing_response.status_code == 200
        
        # Verify billed status
        get_response = api_client.get(f"{BASE_URL}/api/movements/{movement_id}")
        assert get_response.json()["billed"] == True
        
        # Cleanup
        api_client.delete(f"{BASE_URL}/api/movements/{movement_id}")
        print("✓ Single movement billing: PASSED")
    
    def test_billing_report_empty_list(self, api_client):
        """Test billing report with empty list returns 404"""
        billing_response = api_client.post(
            f"{BASE_URL}/api/billing/report",
            json={"movement_ids": []}
        )
        # Should return 404 for empty list
        assert billing_response.status_code == 404
        print("✓ Empty billing list returns 404: PASSED")
    
    def test_billing_report_invalid_ids(self, api_client):
        """Test billing report with invalid IDs returns 404"""
        billing_response = api_client.post(
            f"{BASE_URL}/api/billing/report",
            json={"movement_ids": ["invalid-id-12345", "invalid-id-67890"]}
        )
        assert billing_response.status_code == 404
        print("✓ Invalid IDs billing returns 404: PASSED")


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


class TestBillingAPIEndpoint:
    """Tests for the billing API endpoint behavior"""
    
    def test_billing_endpoint_requires_auth(self):
        """Test that billing endpoint requires authentication"""
        response = requests.post(
            f"{BASE_URL}/api/billing/report",
            json={"movement_ids": ["test-id"]}
        )
        assert response.status_code == 401 or response.status_code == 403
        print("✓ Billing endpoint requires auth: PASSED")
    
    def test_billing_endpoint_requires_movement_ids(self, api_client):
        """Test that billing endpoint requires movement_ids field"""
        response = api_client.post(
            f"{BASE_URL}/api/billing/report",
            json={}
        )
        # Should fail validation
        assert response.status_code == 422
        print("✓ Billing endpoint validates request: PASSED")
