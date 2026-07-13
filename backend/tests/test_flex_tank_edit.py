"""
Tests for Flex Tank Edit functionality
Tests the PUT /api/flex-tank/movements/:id endpoint and related operations
"""
import pytest
import requests
import os
from datetime import datetime

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
    if response.status_code == 200:
        return response.json().get("access_token")
    pytest.skip("Authentication failed - skipping tests")


@pytest.fixture(scope="module")
def authenticated_session(auth_token):
    """Create session with auth header"""
    session = requests.Session()
    session.headers.update({
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json"
    })
    return session


class TestFlexTankEndpoints:
    """Tests for Flex Tank movements endpoints"""
    
    def test_get_flex_tank_movements_list(self, authenticated_session):
        """Test GET /api/flex-tank/movements - List all movements"""
        response = authenticated_session.get(f"{BASE_URL}/api/flex-tank/movements")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "items" in data, "Response should have 'items' key"
        assert "total" in data, "Response should have 'total' key"
        print(f"✓ GET /api/flex-tank/movements returns {data['total']} movements")
        
    def test_get_single_flex_tank_movement(self, authenticated_session):
        """Test GET /api/flex-tank/movements/:id - Get single movement"""
        # First get list to find an existing movement
        list_response = authenticated_session.get(f"{BASE_URL}/api/flex-tank/movements")
        assert list_response.status_code == 200
        
        data = list_response.json()
        if data['total'] == 0:
            pytest.skip("No Flex Tank movements exist to test")
        
        movement_id = data['items'][0]['id']
        
        # Get single movement
        response = authenticated_session.get(f"{BASE_URL}/api/flex-tank/movements/{movement_id}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        movement = response.json()
        assert movement['id'] == movement_id, "Returned movement ID should match requested ID"
        assert 'bag_number' in movement, "Movement should have bag_number"
        assert 'movement_type' in movement, "Movement should have movement_type"
        print(f"✓ GET /api/flex-tank/movements/{movement_id} returns movement #{movement.get('movement_number')}")


class TestFlexTankEditEndpoint:
    """Tests for PUT /api/flex-tank/movements/:id endpoint"""
    
    def test_update_flex_tank_movement_bag_number(self, authenticated_session):
        """Test updating bag_number via PUT endpoint"""
        # Get list to find an existing movement
        list_response = authenticated_session.get(f"{BASE_URL}/api/flex-tank/movements")
        assert list_response.status_code == 200
        
        data = list_response.json()
        if data['total'] == 0:
            pytest.skip("No Flex Tank movements exist to test")
        
        movement_id = data['items'][0]['id']
        original_movement = data['items'][0]
        
        # Update with new bag number
        new_bag_number = f"TEST-FT-{datetime.now().strftime('%H%M%S')}"
        update_data = {
            "bag_number": new_bag_number,
            "bag_size": original_movement.get('bag_size', '16.000L'),
            "movement_date": original_movement.get('movement_date'),
            "movement_type": original_movement.get('movement_type', 'ENTRADA')
        }
        
        response = authenticated_session.put(
            f"{BASE_URL}/api/flex-tank/movements/{movement_id}",
            json=update_data
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        updated = response.json()
        assert updated['bag_number'] == new_bag_number, "Bag number should be updated"
        print(f"✓ PUT /api/flex-tank/movements/{movement_id} successfully updated bag_number to {new_bag_number}")
        
        # Verify with GET
        verify_response = authenticated_session.get(f"{BASE_URL}/api/flex-tank/movements/{movement_id}")
        assert verify_response.status_code == 200
        verified = verify_response.json()
        assert verified['bag_number'] == new_bag_number, "GET should return updated bag_number"
        print(f"✓ GET verification confirms bag_number updated to {new_bag_number}")
        
        # Restore original bag number
        restore_data = {
            "bag_number": original_movement.get('bag_number', 'FT-001'),
            "bag_size": original_movement.get('bag_size', '16.000L'),
            "movement_date": original_movement.get('movement_date'),
            "movement_type": original_movement.get('movement_type', 'ENTRADA')
        }
        authenticated_session.put(f"{BASE_URL}/api/flex-tank/movements/{movement_id}", json=restore_data)

    def test_update_flex_tank_movement_type(self, authenticated_session):
        """Test updating movement_type via PUT endpoint"""
        list_response = authenticated_session.get(f"{BASE_URL}/api/flex-tank/movements")
        assert list_response.status_code == 200
        
        data = list_response.json()
        if data['total'] == 0:
            pytest.skip("No Flex Tank movements exist to test")
        
        movement_id = data['items'][0]['id']
        original_movement = data['items'][0]
        original_type = original_movement.get('movement_type', 'ENTRADA')
        
        # Toggle type
        new_type = 'SAIDA' if original_type == 'ENTRADA' else 'ENTRADA'
        
        update_data = {
            "bag_number": original_movement.get('bag_number'),
            "bag_size": original_movement.get('bag_size', '16.000L'),
            "movement_date": original_movement.get('movement_date'),
            "movement_type": new_type
        }
        
        response = authenticated_session.put(
            f"{BASE_URL}/api/flex-tank/movements/{movement_id}",
            json=update_data
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        updated = response.json()
        assert updated['movement_type'] == new_type, "Movement type should be updated"
        print(f"✓ PUT updated movement_type from {original_type} to {new_type}")
        
        # Restore original type
        restore_data = {
            "bag_number": original_movement.get('bag_number'),
            "bag_size": original_movement.get('bag_size', '16.000L'),
            "movement_date": original_movement.get('movement_date'),
            "movement_type": original_type
        }
        authenticated_session.put(f"{BASE_URL}/api/flex-tank/movements/{movement_id}", json=restore_data)

    def test_update_flex_tank_movement_observations(self, authenticated_session):
        """Test updating observations via PUT endpoint"""
        list_response = authenticated_session.get(f"{BASE_URL}/api/flex-tank/movements")
        assert list_response.status_code == 200
        
        data = list_response.json()
        if data['total'] == 0:
            pytest.skip("No Flex Tank movements exist to test")
        
        movement_id = data['items'][0]['id']
        original_movement = data['items'][0]
        
        # Update with test observation
        test_observation = f"Test observation at {datetime.now().isoformat()}"
        
        update_data = {
            "bag_number": original_movement.get('bag_number'),
            "bag_size": original_movement.get('bag_size', '16.000L'),
            "movement_date": original_movement.get('movement_date'),
            "movement_type": original_movement.get('movement_type', 'ENTRADA'),
            "observations": test_observation
        }
        
        response = authenticated_session.put(
            f"{BASE_URL}/api/flex-tank/movements/{movement_id}",
            json=update_data
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        updated = response.json()
        assert updated['observations'] == test_observation, "Observations should be updated"
        print(f"✓ PUT updated observations successfully")
        
        # Restore original observations
        restore_data = {
            "bag_number": original_movement.get('bag_number'),
            "bag_size": original_movement.get('bag_size', '16.000L'),
            "movement_date": original_movement.get('movement_date'),
            "movement_type": original_movement.get('movement_type', 'ENTRADA'),
            "observations": original_movement.get('observations')
        }
        authenticated_session.put(f"{BASE_URL}/api/flex-tank/movements/{movement_id}", json=restore_data)

    def test_update_nonexistent_flex_tank_movement(self, authenticated_session):
        """Test PUT on nonexistent movement returns 404"""
        fake_id = "nonexistent-movement-id-12345"
        
        update_data = {
            "bag_number": "TEST-FT-FAKE",
            "bag_size": "16.000L",
            "movement_date": datetime.now().isoformat(),
            "movement_type": "ENTRADA"
        }
        
        response = authenticated_session.put(
            f"{BASE_URL}/api/flex-tank/movements/{fake_id}",
            json=update_data
        )
        
        assert response.status_code == 404, f"Expected 404 for nonexistent movement, got {response.status_code}"
        print(f"✓ PUT on nonexistent movement correctly returns 404")

    def test_update_flex_tank_without_auth(self):
        """Test PUT without authentication returns 401/403"""
        # Get a movement ID first (with auth)
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        
        # Login to get a movement ID
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        
        if login_response.status_code != 200:
            pytest.skip("Cannot login to get movement ID")
        
        token = login_response.json().get("access_token")
        session.headers.update({"Authorization": f"Bearer {token}"})
        
        list_response = session.get(f"{BASE_URL}/api/flex-tank/movements")
        if list_response.status_code != 200 or list_response.json()['total'] == 0:
            pytest.skip("No movements to test")
        
        movement_id = list_response.json()['items'][0]['id']
        
        # Now try without auth
        no_auth_session = requests.Session()
        no_auth_session.headers.update({"Content-Type": "application/json"})
        
        update_data = {
            "bag_number": "UNAUTHORIZED",
            "bag_size": "16.000L",
            "movement_date": datetime.now().isoformat(),
            "movement_type": "ENTRADA"
        }
        
        response = no_auth_session.put(
            f"{BASE_URL}/api/flex-tank/movements/{movement_id}",
            json=update_data
        )
        
        assert response.status_code in [401, 403], f"Expected 401/403 without auth, got {response.status_code}"
        print(f"✓ PUT without authentication correctly returns {response.status_code}")


class TestFlexTankFullCRUD:
    """Test full CRUD operations including edit"""
    
    def test_create_read_update_delete_flow(self, authenticated_session):
        """Test complete CRUD flow for Flex Tank movement"""
        # CREATE
        create_data = {
            "bag_number": "TEST-CRUD-001",
            "bag_size": "20.000L",
            "movement_date": datetime.now().isoformat(),
            "movement_type": "ENTRADA",
            "observations": "Test CRUD creation"
        }
        
        create_response = authenticated_session.post(
            f"{BASE_URL}/api/flex-tank/movements",
            json=create_data
        )
        
        assert create_response.status_code == 200 or create_response.status_code == 201, \
            f"CREATE failed: {create_response.status_code}: {create_response.text}"
        
        created = create_response.json()
        movement_id = created['id']
        print(f"✓ CREATE: Movement #{created.get('movement_number')} created with ID {movement_id}")
        
        # READ
        read_response = authenticated_session.get(f"{BASE_URL}/api/flex-tank/movements/{movement_id}")
        assert read_response.status_code == 200, f"READ failed: {read_response.status_code}"
        
        read_data = read_response.json()
        assert read_data['bag_number'] == "TEST-CRUD-001"
        print(f"✓ READ: Movement retrieved successfully")
        
        # UPDATE
        update_data = {
            "bag_number": "TEST-CRUD-UPDATED",
            "bag_size": "22.000L",
            "movement_date": datetime.now().isoformat(),
            "movement_type": "SAIDA",
            "observations": "Test CRUD updated"
        }
        
        update_response = authenticated_session.put(
            f"{BASE_URL}/api/flex-tank/movements/{movement_id}",
            json=update_data
        )
        
        assert update_response.status_code == 200, f"UPDATE failed: {update_response.status_code}: {update_response.text}"
        
        updated = update_response.json()
        assert updated['bag_number'] == "TEST-CRUD-UPDATED", "Bag number not updated"
        assert updated['bag_size'] == "22.000L", "Bag size not updated"
        assert updated['movement_type'] == "SAIDA", "Movement type not updated"
        print(f"✓ UPDATE: Movement updated successfully")
        
        # Verify update persisted
        verify_response = authenticated_session.get(f"{BASE_URL}/api/flex-tank/movements/{movement_id}")
        assert verify_response.status_code == 200
        verified = verify_response.json()
        assert verified['bag_number'] == "TEST-CRUD-UPDATED"
        print(f"✓ VERIFY: Update persisted in database")
        
        # DELETE
        delete_response = authenticated_session.delete(f"{BASE_URL}/api/flex-tank/movements/{movement_id}")
        assert delete_response.status_code == 200, f"DELETE failed: {delete_response.status_code}"
        print(f"✓ DELETE: Movement deleted successfully")
        
        # Verify deletion
        verify_delete_response = authenticated_session.get(f"{BASE_URL}/api/flex-tank/movements/{movement_id}")
        assert verify_delete_response.status_code == 404, "Deleted movement should return 404"
        print(f"✓ VERIFY DELETE: Movement no longer exists")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
