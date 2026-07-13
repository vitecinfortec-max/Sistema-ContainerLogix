"""
Test module for Delivery Status (Status de Entrega) API endpoints.
Tests CRUD operations and PDF generation for delivery status based on loading schedules.
"""

import pytest
import requests
import os
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestDeliveryStatusAPI:
    """Delivery Status API endpoint tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup: Get auth token and existing schedule number"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "joao.victor@jalogisticas.com",
            "password": "password123"
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        token = login_response.json().get("access_token")
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        
        yield
    
    def test_get_delivery_statuses_list(self):
        """Test GET /api/delivery-status - returns list of delivery statuses"""
        response = self.session.get(f"{BASE_URL}/api/delivery-status")
        assert response.status_code == 200, f"Failed: {response.text}"
        
        data = response.json()
        assert "items" in data, "Response should have 'items' key"
        assert "total" in data, "Response should have 'total' key"
        assert "page" in data, "Response should have 'page' key"
        assert "pages" in data, "Response should have 'pages' key"
        assert isinstance(data["items"], list), "Items should be a list"
        print(f"Found {data['total']} delivery statuses")
    
    def test_get_schedule_for_delivery_status(self):
        """Test GET /api/delivery-status/schedule/{number} - fetch schedule by number"""
        # Schedule #1 should exist based on agent context
        response = self.session.get(f"{BASE_URL}/api/delivery-status/schedule/1")
        assert response.status_code == 200, f"Failed to get schedule: {response.text}"
        
        schedule = response.json()
        assert "schedule_number" in schedule, "Schedule should have schedule_number"
        assert "destination_client_name" in schedule, "Schedule should have destination_client_name"
        assert "contracting_client_name" in schedule, "Schedule should have contracting_client_name"
        assert "items" in schedule, "Schedule should have items"
        print(f"Schedule #1 found: {schedule['destination_client_name']}")
    
    def test_get_schedule_for_delivery_status_not_found(self):
        """Test GET /api/delivery-status/schedule/{number} - 404 for non-existent schedule"""
        response = self.session.get(f"{BASE_URL}/api/delivery-status/schedule/99999")
        assert response.status_code == 404, f"Should return 404: {response.text}"
    
    def test_create_delivery_status(self):
        """Test POST /api/delivery-status - create new delivery status"""
        # First get schedule #1 data
        schedule_resp = self.session.get(f"{BASE_URL}/api/delivery-status/schedule/1")
        assert schedule_resp.status_code == 200, f"Schedule fetch failed: {schedule_resp.text}"
        schedule = schedule_resp.json()
        
        # Build items with time fields from schedule items
        items = []
        for item in schedule.get("items", []):
            items.append({
                "driver_id": item.get("driver_id"),
                "driver_name": item.get("driver_name", "Test Driver"),
                "driver_cpf": item.get("driver_cpf"),
                "cavalo_plate": item.get("cavalo_plate", "ABC1234"),
                "carreta_plate": item.get("carreta_plate"),
                "container_number": item.get("container_number"),
                "loading_location": item.get("loading_location", "Terminal A"),
                "arrival_time": "08:00",
                "loading_start_time": "08:30",
                "loading_end_time": "10:00",
                "departure_time": "10:30"
            })
        
        # If no items from schedule, create default item
        if not items:
            items = [{
                "driver_name": "TEST_Motorista Teste",
                "cavalo_plate": "TST1234",
                "loading_location": "Terminal Teste",
                "arrival_time": "08:00",
                "loading_start_time": "08:30",
                "loading_end_time": "10:00",
                "departure_time": "10:30"
            }]
        
        payload = {
            "schedule_number": 1,
            "status_date": datetime.now().strftime("%Y-%m-%d"),
            "items": items,
            "observations": "TEST_Status criado para testes automatizados"
        }
        
        response = self.session.post(f"{BASE_URL}/api/delivery-status", json=payload)
        assert response.status_code == 200, f"Create failed: {response.text}"
        
        created = response.json()
        assert "id" in created, "Response should have id"
        assert "status_number" in created, "Response should have status_number"
        assert created["schedule_number"] == 1, "Schedule number should match"
        assert "destination_client_name" in created, "Should copy destination_client_name"
        assert "contracting_client_name" in created, "Should copy contracting_client_name"
        assert len(created.get("items", [])) > 0, "Should have items"
        
        # Verify time fields
        first_item = created["items"][0]
        assert "arrival_time" in first_item, "Item should have arrival_time"
        
        print(f"Created delivery status #{created['status_number']}")
        
        # Store for cleanup
        self.created_status_id = created["id"]
        
        # Verify by GET
        get_response = self.session.get(f"{BASE_URL}/api/delivery-status/{created['id']}")
        assert get_response.status_code == 200, "Should fetch created status"
        fetched = get_response.json()
        assert fetched["id"] == created["id"], "IDs should match"
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/delivery-status/{created['id']}")
    
    def test_get_delivery_status_by_id(self):
        """Test GET /api/delivery-status/{id} - existing status #1 from seed data"""
        # First get list to find existing status
        list_response = self.session.get(f"{BASE_URL}/api/delivery-status")
        assert list_response.status_code == 200
        
        items = list_response.json().get("items", [])
        if items:
            status_id = items[0]["id"]
            response = self.session.get(f"{BASE_URL}/api/delivery-status/{status_id}")
            assert response.status_code == 200, f"Get by ID failed: {response.text}"
            
            status = response.json()
            assert status["id"] == status_id
            assert "status_number" in status
            assert "schedule_number" in status
            assert "items" in status
            print(f"Found status #{status['status_number']} with {len(status['items'])} items")
        else:
            pytest.skip("No existing delivery statuses to test GET by ID")
    
    def test_get_delivery_status_not_found(self):
        """Test GET /api/delivery-status/{id} - 404 for non-existent status"""
        response = self.session.get(f"{BASE_URL}/api/delivery-status/nonexistent-id-12345")
        assert response.status_code == 404, f"Should return 404: {response.text}"
    
    def test_update_delivery_status(self):
        """Test PUT /api/delivery-status/{id} - update existing status"""
        # First create a status to update
        schedule_resp = self.session.get(f"{BASE_URL}/api/delivery-status/schedule/1")
        if schedule_resp.status_code != 200:
            pytest.skip("Schedule #1 not found")
        
        schedule = schedule_resp.json()
        items = []
        for item in schedule.get("items", []):
            items.append({
                "driver_name": item.get("driver_name", "Test"),
                "cavalo_plate": item.get("cavalo_plate", "ABC1234"),
                "loading_location": item.get("loading_location", "Terminal"),
                "arrival_time": "09:00"
            })
        if not items:
            items = [{"driver_name": "TEST_Driver", "cavalo_plate": "TST1234", "loading_location": "Test"}]
        
        create_payload = {
            "schedule_number": 1,
            "status_date": "2025-01-01",
            "items": items,
            "observations": "TEST_Para atualização"
        }
        
        create_resp = self.session.post(f"{BASE_URL}/api/delivery-status", json=create_payload)
        if create_resp.status_code != 200:
            pytest.skip(f"Could not create status for update test: {create_resp.text}")
        
        created = create_resp.json()
        status_id = created["id"]
        
        try:
            # Update the status
            update_payload = {
                "schedule_number": 1,
                "status_date": "2025-01-15",
                "items": [{
                    "driver_name": items[0]["driver_name"],
                    "cavalo_plate": items[0]["cavalo_plate"],
                    "loading_location": items[0]["loading_location"],
                    "arrival_time": "10:00",
                    "loading_start_time": "10:30",
                    "loading_end_time": "12:00",
                    "departure_time": "12:30"
                }],
                "observations": "TEST_Status atualizado"
            }
            
            update_resp = self.session.put(f"{BASE_URL}/api/delivery-status/{status_id}", json=update_payload)
            assert update_resp.status_code == 200, f"Update failed: {update_resp.text}"
            
            updated = update_resp.json()
            assert updated["status_date"] == "2025-01-15", "Date should be updated"
            assert updated["observations"] == "TEST_Status atualizado", "Observations should be updated"
            
            # Verify persistence
            get_resp = self.session.get(f"{BASE_URL}/api/delivery-status/{status_id}")
            assert get_resp.status_code == 200
            fetched = get_resp.json()
            assert fetched["status_date"] == "2025-01-15", "Update should persist"
            
            print(f"Successfully updated delivery status #{updated['status_number']}")
        finally:
            # Cleanup
            self.session.delete(f"{BASE_URL}/api/delivery-status/{status_id}")
    
    def test_delete_delivery_status(self):
        """Test DELETE /api/delivery-status/{id}"""
        # Create status to delete
        schedule_resp = self.session.get(f"{BASE_URL}/api/delivery-status/schedule/1")
        if schedule_resp.status_code != 200:
            pytest.skip("Schedule #1 not found")
        
        schedule = schedule_resp.json()
        items = []
        for item in schedule.get("items", []):
            items.append({
                "driver_name": item.get("driver_name", "Test"),
                "cavalo_plate": item.get("cavalo_plate", "ABC1234"),
                "loading_location": item.get("loading_location", "Terminal")
            })
        if not items:
            items = [{"driver_name": "TEST_Delete", "cavalo_plate": "DEL1234", "loading_location": "Test"}]
        
        create_payload = {
            "schedule_number": 1,
            "status_date": "2025-01-20",
            "items": items,
            "observations": "TEST_Para deletar"
        }
        
        create_resp = self.session.post(f"{BASE_URL}/api/delivery-status", json=create_payload)
        if create_resp.status_code != 200:
            pytest.skip(f"Could not create status for delete test: {create_resp.text}")
        
        created = create_resp.json()
        status_id = created["id"]
        
        # Delete
        delete_resp = self.session.delete(f"{BASE_URL}/api/delivery-status/{status_id}")
        assert delete_resp.status_code == 200, f"Delete failed: {delete_resp.text}"
        
        # Verify deletion
        get_resp = self.session.get(f"{BASE_URL}/api/delivery-status/{status_id}")
        assert get_resp.status_code == 404, "Deleted status should return 404"
        
        print("Successfully deleted delivery status")
    
    def test_delete_delivery_status_not_found(self):
        """Test DELETE /api/delivery-status/{id} - 404 for non-existent status"""
        response = self.session.delete(f"{BASE_URL}/api/delivery-status/nonexistent-12345")
        assert response.status_code == 404, f"Should return 404: {response.text}"
    
    def test_generate_delivery_status_pdf(self):
        """Test GET /api/delivery-status/{id}/pdf - generate PDF"""
        # Get existing status from list
        list_response = self.session.get(f"{BASE_URL}/api/delivery-status")
        assert list_response.status_code == 200
        
        items = list_response.json().get("items", [])
        if not items:
            pytest.skip("No existing delivery statuses to test PDF generation")
        
        status_id = items[0]["id"]
        
        response = self.session.get(f"{BASE_URL}/api/delivery-status/{status_id}/pdf")
        assert response.status_code == 200, f"PDF generation failed: {response.text}"
        assert response.headers.get("content-type", "").startswith("application/pdf") or \
               response.headers.get("content-type", "").startswith("application/octet-stream"), \
               f"Should return PDF, got: {response.headers.get('content-type')}"
        
        # Check PDF content starts with %PDF
        content = response.content
        assert content[:4] == b'%PDF', "Content should be valid PDF"
        print(f"PDF generated successfully, size: {len(content)} bytes")
    
    def test_generate_pdf_not_found(self):
        """Test GET /api/delivery-status/{id}/pdf - 404 for non-existent status"""
        response = self.session.get(f"{BASE_URL}/api/delivery-status/nonexistent-pdf-12345/pdf")
        assert response.status_code == 404, f"Should return 404: {response.text}"


class TestDeliveryStatusIntegration:
    """Integration tests for delivery status with loading schedules"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup: Get auth token"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "joao.victor@jalogisticas.com",
            "password": "password123"
        })
        assert login_response.status_code == 200
        token = login_response.json().get("access_token")
        self.session.headers.update({"Authorization": f"Bearer {token}"})
    
    def test_delivery_status_inherits_schedule_data(self):
        """Test that delivery status correctly inherits data from loading schedule"""
        # Get schedule data first
        schedule_resp = self.session.get(f"{BASE_URL}/api/delivery-status/schedule/1")
        if schedule_resp.status_code != 200:
            pytest.skip("Schedule #1 not found")
        
        schedule = schedule_resp.json()
        
        # Create delivery status
        items = []
        for item in schedule.get("items", []):
            items.append({
                "driver_name": item.get("driver_name", "Test"),
                "cavalo_plate": item.get("cavalo_plate", "ABC1234"),
                "loading_location": item.get("loading_location", "Terminal")
            })
        if not items:
            items = [{"driver_name": "TEST_Integration", "cavalo_plate": "INT1234", "loading_location": "Test"}]
        
        payload = {
            "schedule_number": 1,
            "status_date": datetime.now().strftime("%Y-%m-%d"),
            "items": items
        }
        
        create_resp = self.session.post(f"{BASE_URL}/api/delivery-status", json=payload)
        assert create_resp.status_code == 200, f"Create failed: {create_resp.text}"
        
        created = create_resp.json()
        
        try:
            # Verify inherited data
            assert created["schedule_number"] == schedule["schedule_number"], "Schedule number should match"
            assert created["destination_client_name"] == schedule["destination_client_name"], "Destination client should match"
            assert created["contracting_client_name"] == schedule["contracting_client_name"], "Contracting client should match"
            
            if schedule.get("booking"):
                assert created.get("booking") == schedule["booking"], "Booking should be inherited"
            if schedule.get("voyage"):
                assert created.get("voyage") == schedule["voyage"], "Voyage should be inherited"
            
            print(f"Delivery status correctly inherits schedule data")
        finally:
            self.session.delete(f"{BASE_URL}/api/delivery-status/{created['id']}")
