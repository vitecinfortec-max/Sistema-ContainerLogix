"""
Test suite for CRUD operations including UPDATE endpoints:
- PUT /api/drivers/{id} - Update driver
- PUT /api/transport-companies/{id} - Update transport company
- PUT /api/shipping-lines/{id} - Update shipping line
- POST /api/billing/report - Generate billing Excel report
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuthAndSetup:
    """Get authentication token for tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Register or login to get auth token"""
        unique_id = str(uuid.uuid4())[:8]
        
        # Try to register new user
        register_data = {
            "name": f"Test User {unique_id}",
            "email": f"testuser_{unique_id}@test.com",
            "password": "testpassword123",
            "role": "admin"
        }
        
        response = requests.post(f"{BASE_URL}/api/auth/register", json=register_data)
        
        if response.status_code == 200:
            return response.json()["access_token"]
        elif response.status_code == 400:
            # Try login with existing credentials
            login_data = {
                "email": "test@teste.com",
                "password": "teste123"
            }
            login_response = requests.post(f"{BASE_URL}/api/auth/login", json=login_data)
            if login_response.status_code == 200:
                return login_response.json()["access_token"]
        
        pytest.skip("Could not authenticate")
    
    @pytest.fixture(scope="class")
    def auth_headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}


class TestDriversCRUD(TestAuthAndSetup):
    """Test CRUD operations for Drivers including PUT endpoint"""
    
    def test_create_driver(self, auth_headers):
        """Test creating a new driver"""
        unique_id = str(uuid.uuid4())[:8]
        driver_data = {
            "name": f"TEST_Driver_{unique_id}",
            "cpf": "123.456.789-00",
            "phone": "(11) 99999-9999"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/drivers", 
            json=driver_data, 
            headers=auth_headers
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "id" in data
        assert data["name"] == driver_data["name"]
        assert data["cpf"] == driver_data["cpf"]
        assert data["phone"] == driver_data["phone"]
        
        return data["id"]
    
    def test_get_drivers(self, auth_headers):
        """Test getting list of drivers"""
        response = requests.get(f"{BASE_URL}/api/drivers", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
    
    def test_update_driver(self, auth_headers):
        """Test PUT endpoint to update driver"""
        # First create a driver
        unique_id = str(uuid.uuid4())[:8]
        create_data = {
            "name": f"TEST_DriverUpdate_{unique_id}",
            "cpf": "111.222.333-44",
            "phone": "(21) 88888-8888"
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/drivers",
            json=create_data,
            headers=auth_headers
        )
        assert create_response.status_code == 200
        driver_id = create_response.json()["id"]
        
        # Now update the driver
        update_data = {
            "name": f"TEST_DriverUpdated_{unique_id}",
            "cpf": "999.888.777-66",
            "phone": "(31) 77777-7777"
        }
        
        update_response = requests.put(
            f"{BASE_URL}/api/drivers/{driver_id}",
            json=update_data,
            headers=auth_headers
        )
        
        assert update_response.status_code == 200, f"PUT failed: {update_response.text}"
        updated = update_response.json()
        assert updated["id"] == driver_id
        assert updated["name"] == update_data["name"]
        assert updated["cpf"] == update_data["cpf"]
        assert updated["phone"] == update_data["phone"]
        
        # Verify persistence with GET
        get_response = requests.get(f"{BASE_URL}/api/drivers", headers=auth_headers)
        assert get_response.status_code == 200
        drivers = get_response.json()
        found = [d for d in drivers if d["id"] == driver_id]
        assert len(found) == 1
        assert found[0]["name"] == update_data["name"]
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/drivers/{driver_id}", headers=auth_headers)
    
    def test_update_nonexistent_driver(self, auth_headers):
        """Test PUT on non-existent driver returns 404"""
        fake_id = str(uuid.uuid4())
        update_data = {
            "name": "Ghost Driver",
            "cpf": "000.000.000-00",
            "phone": ""
        }
        
        response = requests.put(
            f"{BASE_URL}/api/drivers/{fake_id}",
            json=update_data,
            headers=auth_headers
        )
        
        assert response.status_code == 404
    
    def test_delete_driver(self, auth_headers):
        """Test deleting a driver"""
        # Create a driver to delete
        unique_id = str(uuid.uuid4())[:8]
        create_data = {
            "name": f"TEST_DriverDelete_{unique_id}",
            "cpf": "555.444.333-22",
            "phone": ""
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/drivers",
            json=create_data,
            headers=auth_headers
        )
        driver_id = create_response.json()["id"]
        
        # Delete it
        delete_response = requests.delete(
            f"{BASE_URL}/api/drivers/{driver_id}",
            headers=auth_headers
        )
        
        assert delete_response.status_code == 200
        
        # Verify it's gone
        get_response = requests.get(f"{BASE_URL}/api/drivers", headers=auth_headers)
        drivers = get_response.json()
        found = [d for d in drivers if d["id"] == driver_id]
        assert len(found) == 0


class TestTransportCompaniesCRUD(TestAuthAndSetup):
    """Test CRUD operations for Transport Companies including PUT endpoint"""
    
    def test_create_transport_company(self, auth_headers):
        """Test creating a new transport company"""
        unique_id = str(uuid.uuid4())[:8]
        company_data = {
            "name": f"TEST_Company_{unique_id}",
            "cnpj": "12.345.678/0001-90",
            "phone": "(11) 3333-4444"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/transport-companies",
            json=company_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "id" in data
        assert data["name"] == company_data["name"]
        assert data["cnpj"] == company_data["cnpj"]
        
        return data["id"]
    
    def test_get_transport_companies(self, auth_headers):
        """Test getting list of transport companies"""
        response = requests.get(f"{BASE_URL}/api/transport-companies", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
    
    def test_update_transport_company(self, auth_headers):
        """Test PUT endpoint to update transport company"""
        # Create a company
        unique_id = str(uuid.uuid4())[:8]
        create_data = {
            "name": f"TEST_CompanyUpdate_{unique_id}",
            "cnpj": "11.111.111/0001-11",
            "phone": "(21) 2222-2222"
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/transport-companies",
            json=create_data,
            headers=auth_headers
        )
        assert create_response.status_code == 200
        company_id = create_response.json()["id"]
        
        # Update the company
        update_data = {
            "name": f"TEST_CompanyUpdated_{unique_id}",
            "cnpj": "99.999.999/0001-99",
            "phone": "(31) 5555-5555"
        }
        
        update_response = requests.put(
            f"{BASE_URL}/api/transport-companies/{company_id}",
            json=update_data,
            headers=auth_headers
        )
        
        assert update_response.status_code == 200, f"PUT failed: {update_response.text}"
        updated = update_response.json()
        assert updated["id"] == company_id
        assert updated["name"] == update_data["name"]
        assert updated["cnpj"] == update_data["cnpj"]
        assert updated["phone"] == update_data["phone"]
        
        # Verify persistence
        get_response = requests.get(f"{BASE_URL}/api/transport-companies", headers=auth_headers)
        companies = get_response.json()
        found = [c for c in companies if c["id"] == company_id]
        assert len(found) == 1
        assert found[0]["name"] == update_data["name"]
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/transport-companies/{company_id}", headers=auth_headers)
    
    def test_update_nonexistent_company(self, auth_headers):
        """Test PUT on non-existent company returns 404"""
        fake_id = str(uuid.uuid4())
        update_data = {
            "name": "Ghost Company",
            "cnpj": "",
            "phone": ""
        }
        
        response = requests.put(
            f"{BASE_URL}/api/transport-companies/{fake_id}",
            json=update_data,
            headers=auth_headers
        )
        
        assert response.status_code == 404
    
    def test_delete_transport_company(self, auth_headers):
        """Test deleting a transport company"""
        unique_id = str(uuid.uuid4())[:8]
        create_data = {
            "name": f"TEST_CompanyDelete_{unique_id}",
            "cnpj": "",
            "phone": ""
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/transport-companies",
            json=create_data,
            headers=auth_headers
        )
        company_id = create_response.json()["id"]
        
        delete_response = requests.delete(
            f"{BASE_URL}/api/transport-companies/{company_id}",
            headers=auth_headers
        )
        
        assert delete_response.status_code == 200


class TestShippingLinesCRUD(TestAuthAndSetup):
    """Test CRUD operations for Shipping Lines including PUT endpoint"""
    
    def test_create_shipping_line(self, auth_headers):
        """Test creating a new shipping line"""
        unique_id = str(uuid.uuid4())[:8]
        line_data = {
            "name": f"TEST_ShippingLine_{unique_id}",
            "code": f"TS{unique_id[:4].upper()}"
        }
        
        response = requests.post(
            f"{BASE_URL}/api/shipping-lines",
            json=line_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "id" in data
        assert data["name"] == line_data["name"]
        assert data["code"] == line_data["code"]
        
        return data["id"]
    
    def test_get_shipping_lines(self, auth_headers):
        """Test getting list of shipping lines"""
        response = requests.get(f"{BASE_URL}/api/shipping-lines", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
    
    def test_update_shipping_line(self, auth_headers):
        """Test PUT endpoint to update shipping line"""
        # Create a shipping line
        unique_id = str(uuid.uuid4())[:8]
        create_data = {
            "name": f"TEST_LineUpdate_{unique_id}",
            "code": "UPDT"
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/shipping-lines",
            json=create_data,
            headers=auth_headers
        )
        assert create_response.status_code == 200
        line_id = create_response.json()["id"]
        
        # Update the shipping line
        update_data = {
            "name": f"TEST_LineUpdated_{unique_id}",
            "code": "UPDD"
        }
        
        update_response = requests.put(
            f"{BASE_URL}/api/shipping-lines/{line_id}",
            json=update_data,
            headers=auth_headers
        )
        
        assert update_response.status_code == 200, f"PUT failed: {update_response.text}"
        updated = update_response.json()
        assert updated["id"] == line_id
        assert updated["name"] == update_data["name"]
        assert updated["code"] == update_data["code"]
        
        # Verify persistence
        get_response = requests.get(f"{BASE_URL}/api/shipping-lines", headers=auth_headers)
        lines = get_response.json()
        found = [l for l in lines if l["id"] == line_id]
        assert len(found) == 1
        assert found[0]["name"] == update_data["name"]
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/shipping-lines/{line_id}", headers=auth_headers)
    
    def test_update_nonexistent_shipping_line(self, auth_headers):
        """Test PUT on non-existent shipping line returns 404"""
        fake_id = str(uuid.uuid4())
        update_data = {
            "name": "Ghost Line",
            "code": "GHST"
        }
        
        response = requests.put(
            f"{BASE_URL}/api/shipping-lines/{fake_id}",
            json=update_data,
            headers=auth_headers
        )
        
        assert response.status_code == 404
    
    def test_delete_shipping_line(self, auth_headers):
        """Test deleting a shipping line"""
        unique_id = str(uuid.uuid4())[:8]
        create_data = {
            "name": f"TEST_LineDelete_{unique_id}",
            "code": "DEL"
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/shipping-lines",
            json=create_data,
            headers=auth_headers
        )
        line_id = create_response.json()["id"]
        
        delete_response = requests.delete(
            f"{BASE_URL}/api/shipping-lines/{line_id}",
            headers=auth_headers
        )
        
        assert delete_response.status_code == 200


class TestBillingReport(TestAuthAndSetup):
    """Test billing report generation endpoint"""
    
    def test_generate_billing_report(self, auth_headers):
        """Test POST /api/billing/report endpoint"""
        # First, create a movement to include in billing
        unique_id = str(uuid.uuid4())[:8]
        movement_data = {
            "operation_type": "ENTRADA",
            "driver_name": f"Test Driver {unique_id}",
            "driver_cpf": "123.456.789-00",
            "truck_plate": "ABC1234",
            "trailer_plate_1": "DEF5678",
            "trailer_plate_2": "",
            "transport_company": "Test Company",
            "container_number": f"TESTBILL{unique_id}",
            "status": "CHEIO",
            "size_type": "40HC",
            "tare": "4200",
            "shipping_line": "Maersk",
            "seal": "SEAL123",
            "genset": "",
            "booking": "BK123456"
        }
        
        create_response = requests.post(
            f"{BASE_URL}/api/movements",
            json=movement_data,
            headers=auth_headers
        )
        assert create_response.status_code == 200
        movement_id = create_response.json()["id"]
        
        # Now generate billing report
        billing_data = {
            "movement_ids": [movement_id]
        }
        
        billing_response = requests.post(
            f"{BASE_URL}/api/billing/report",
            json=billing_data,
            headers=auth_headers
        )
        
        assert billing_response.status_code == 200, f"Billing report failed: {billing_response.text}"
        assert billing_response.headers.get("content-type") == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        assert len(billing_response.content) > 0
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/movements/{movement_id}", headers=auth_headers)
    
    def test_billing_report_empty_list(self, auth_headers):
        """Test billing report with empty movement list returns 404"""
        billing_data = {
            "movement_ids": []
        }
        
        response = requests.post(
            f"{BASE_URL}/api/billing/report",
            json=billing_data,
            headers=auth_headers
        )
        
        # Empty list should return 404 as no movements found
        assert response.status_code == 404
    
    def test_billing_report_invalid_ids(self, auth_headers):
        """Test billing report with invalid IDs returns 404"""
        billing_data = {
            "movement_ids": [str(uuid.uuid4()), str(uuid.uuid4())]
        }
        
        response = requests.post(
            f"{BASE_URL}/api/billing/report",
            json=billing_data,
            headers=auth_headers
        )
        
        # Non-existent IDs should return 404
        assert response.status_code == 404
    
    def test_billing_report_multiple_movements(self, auth_headers):
        """Test billing report with multiple movements"""
        unique_id = str(uuid.uuid4())[:8]
        movement_ids = []
        
        # Create 3 movements
        for i in range(3):
            movement_data = {
                "operation_type": "ENTRADA" if i % 2 == 0 else "SAIDA",
                "driver_name": f"Test Driver {unique_id}_{i}",
                "driver_cpf": "123.456.789-00",
                "truck_plate": f"ABC{i}234",
                "trailer_plate_1": f"DEF{i}678",
                "trailer_plate_2": "",
                "transport_company": "Test Company",
                "container_number": f"BILL{unique_id}{i}",
                "status": "CHEIO" if i % 2 == 0 else "VAZIO",
                "size_type": "40HC",
                "tare": "4200",
                "shipping_line": "MSC",
                "seal": f"SEAL{i}",
                "genset": "",
                "booking": f"BK{unique_id}{i}"
            }
            
            response = requests.post(
                f"{BASE_URL}/api/movements",
                json=movement_data,
                headers=auth_headers
            )
            assert response.status_code == 200
            movement_ids.append(response.json()["id"])
        
        # Generate billing report with multiple IDs
        billing_data = {
            "movement_ids": movement_ids
        }
        
        billing_response = requests.post(
            f"{BASE_URL}/api/billing/report",
            json=billing_data,
            headers=auth_headers
        )
        
        assert billing_response.status_code == 200
        assert len(billing_response.content) > 0
        
        # Cleanup
        for mid in movement_ids:
            requests.delete(f"{BASE_URL}/api/movements/{mid}", headers=auth_headers)


class TestReportsDownload(TestAuthAndSetup):
    """Test report download endpoints"""
    
    def test_download_pdf_report(self, auth_headers):
        """Test GET /api/reports/pdf endpoint"""
        response = requests.get(
            f"{BASE_URL}/api/reports/pdf",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        assert response.headers.get("content-type") == "application/pdf"
    
    def test_download_excel_report(self, auth_headers):
        """Test GET /api/reports/excel endpoint"""
        response = requests.get(
            f"{BASE_URL}/api/reports/excel",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        assert response.headers.get("content-type") == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    
    def test_pdf_report_with_filters(self, auth_headers):
        """Test PDF report with operation_type filter"""
        response = requests.get(
            f"{BASE_URL}/api/reports/pdf",
            params={"operation_type": "ENTRADA"},
            headers=auth_headers
        )
        
        assert response.status_code == 200
    
    def test_excel_report_with_filters(self, auth_headers):
        """Test Excel report with operation_type filter"""
        response = requests.get(
            f"{BASE_URL}/api/reports/excel",
            params={"operation_type": "SAIDA"},
            headers=auth_headers
        )
        
        assert response.status_code == 200


# Cleanup function to remove TEST_ prefixed data
@pytest.fixture(scope="session", autouse=True)
def cleanup_test_data():
    """Cleanup test data after all tests complete"""
    yield
    
    # Try to login and cleanup TEST_ prefixed data
    try:
        login_data = {"email": "test@teste.com", "password": "teste123"}
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json=login_data)
        if login_response.status_code != 200:
            return
        
        token = login_response.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        
        # Cleanup drivers
        drivers_response = requests.get(f"{BASE_URL}/api/drivers", headers=headers)
        if drivers_response.status_code == 200:
            for driver in drivers_response.json():
                if driver["name"].startswith("TEST_"):
                    requests.delete(f"{BASE_URL}/api/drivers/{driver['id']}", headers=headers)
        
        # Cleanup companies
        companies_response = requests.get(f"{BASE_URL}/api/transport-companies", headers=headers)
        if companies_response.status_code == 200:
            for company in companies_response.json():
                if company["name"].startswith("TEST_"):
                    requests.delete(f"{BASE_URL}/api/transport-companies/{company['id']}", headers=headers)
        
        # Cleanup shipping lines
        lines_response = requests.get(f"{BASE_URL}/api/shipping-lines", headers=headers)
        if lines_response.status_code == 200:
            for line in lines_response.json():
                if line["name"].startswith("TEST_"):
                    requests.delete(f"{BASE_URL}/api/shipping-lines/{line['id']}", headers=headers)
        
        # Cleanup movements
        movements_response = requests.get(f"{BASE_URL}/api/movements", headers=headers)
        if movements_response.status_code == 200:
            for movement in movements_response.json():
                if movement.get("container_number", "").startswith("TEST") or movement.get("container_number", "").startswith("BILL"):
                    requests.delete(f"{BASE_URL}/api/movements/{movement['id']}", headers=headers)
    
    except Exception as e:
        print(f"Cleanup error (non-fatal): {e}")
