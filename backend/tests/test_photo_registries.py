"""
Backend tests for Photo Registries (Registro Fotográfico) feature
Tests CRUD operations and photo upload/delete endpoints
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "joao.victor@jalogisticas.com"
TEST_PASSWORD = "password123"

class TestPhotoRegistries:
    """Photo Registries API tests"""
    
    token = None
    created_registry_id = None
    
    @classmethod
    def get_auth_token(cls):
        """Get authentication token"""
        if cls.token:
            return cls.token
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        if response.status_code == 200:
            cls.token = response.json().get("access_token")
            return cls.token
        return None
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test fixtures"""
        self.token = self.get_auth_token()
        if not self.token:
            pytest.skip("Authentication failed - skipping tests")
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }
    
    # Test login
    def test_01_auth_login(self):
        """Test authentication for Photo Registries"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "access_token" in data
        assert "user" in data
        print(f"Login successful for: {data['user']['name']}")
    
    # Test GET /api/photo-registries (list)
    def test_02_list_photo_registries(self):
        """Test listing photo registries"""
        response = requests.get(
            f"{BASE_URL}/api/photo-registries",
            headers=self.headers
        )
        assert response.status_code == 200, f"List failed: {response.text}"
        data = response.json()
        assert "items" in data
        assert "total" in data
        assert "page" in data
        assert "page_size" in data
        assert "pages" in data
        print(f"Found {data['total']} photo registries")
    
    # Test POST /api/photo-registries (create)
    def test_03_create_photo_registry(self):
        """Test creating a new photo registry"""
        response = requests.post(
            f"{BASE_URL}/api/photo-registries",
            headers=self.headers,
            json={
                "container_number": "TEST_ABCD1234567",
                "booking": "TEST_BK-2024-PYTEST"
            }
        )
        assert response.status_code == 200, f"Create failed: {response.text}"
        data = response.json()
        
        # Validate response structure
        assert "id" in data
        assert "registry_number" in data
        assert "container_number" in data
        assert "booking" in data
        assert "created_by" in data
        assert "created_by_name" in data
        assert "created_at" in data
        
        # Validate data values
        assert data["container_number"] == "TEST_ABCD1234567"
        assert data["booking"] == "TEST_BK-2024-PYTEST"
        assert isinstance(data["registry_number"], int)
        
        # Save for later tests
        TestPhotoRegistries.created_registry_id = data["id"]
        print(f"Created photo registry #{data['registry_number']} with ID: {data['id']}")
    
    # Test GET /api/photo-registries/{id} (get single)
    def test_04_get_photo_registry(self):
        """Test getting a specific photo registry"""
        if not TestPhotoRegistries.created_registry_id:
            pytest.skip("No registry created to test")
        
        response = requests.get(
            f"{BASE_URL}/api/photo-registries/{TestPhotoRegistries.created_registry_id}",
            headers=self.headers
        )
        assert response.status_code == 200, f"Get failed: {response.text}"
        data = response.json()
        
        assert data["id"] == TestPhotoRegistries.created_registry_id
        assert data["container_number"] == "TEST_ABCD1234567"
        print(f"Retrieved registry: #{data['registry_number']} - {data['container_number']}")
    
    # Test GET /api/photo-registries/{id} with invalid ID
    def test_05_get_photo_registry_not_found(self):
        """Test getting non-existent photo registry returns 404"""
        response = requests.get(
            f"{BASE_URL}/api/photo-registries/non-existent-id-12345",
            headers=self.headers
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("Correctly returned 404 for non-existent registry")
    
    # Test PUT /api/photo-registries/{id} (update)
    def test_06_update_photo_registry(self):
        """Test updating a photo registry"""
        if not TestPhotoRegistries.created_registry_id:
            pytest.skip("No registry created to test")
        
        response = requests.put(
            f"{BASE_URL}/api/photo-registries/{TestPhotoRegistries.created_registry_id}",
            headers=self.headers,
            json={
                "container_number": "TEST_UPDATED1234567",
                "booking": "TEST_BK-UPDATED-PYTEST"
            }
        )
        assert response.status_code == 200, f"Update failed: {response.text}"
        data = response.json()
        
        assert data["container_number"] == "TEST_UPDATED1234567"
        assert data["booking"] == "TEST_BK-UPDATED-PYTEST"
        assert data["updated_at"] is not None
        print(f"Updated registry to: {data['container_number']}, {data['booking']}")
    
    # Test GET verify update persisted
    def test_07_verify_update_persisted(self):
        """Verify update was persisted in database"""
        if not TestPhotoRegistries.created_registry_id:
            pytest.skip("No registry created to test")
        
        response = requests.get(
            f"{BASE_URL}/api/photo-registries/{TestPhotoRegistries.created_registry_id}",
            headers=self.headers
        )
        assert response.status_code == 200
        data = response.json()
        
        assert data["container_number"] == "TEST_UPDATED1234567"
        assert data["booking"] == "TEST_BK-UPDATED-PYTEST"
        print("Update verified in database")
    
    # Test GET with search filter
    def test_08_search_photo_registries(self):
        """Test searching photo registries by container number"""
        response = requests.get(
            f"{BASE_URL}/api/photo-registries",
            headers=self.headers,
            params={"search": "TEST_UPDATED"}
        )
        assert response.status_code == 200, f"Search failed: {response.text}"
        data = response.json()
        
        # Should find at least our test registry
        assert data["total"] >= 1
        found = any(r["container_number"] == "TEST_UPDATED1234567" for r in data["items"])
        assert found, "Test registry not found in search results"
        print(f"Search found {data['total']} results including our test registry")
    
    # Test GET without auth returns 403
    def test_09_list_without_auth(self):
        """Test that listing without auth returns 403"""
        response = requests.get(f"{BASE_URL}/api/photo-registries")
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print("Correctly requires authentication")
    
    # Test DELETE /api/photo-registries/{id}
    def test_10_delete_photo_registry(self):
        """Test deleting a photo registry"""
        if not TestPhotoRegistries.created_registry_id:
            pytest.skip("No registry created to test")
        
        response = requests.delete(
            f"{BASE_URL}/api/photo-registries/{TestPhotoRegistries.created_registry_id}",
            headers=self.headers
        )
        assert response.status_code == 200, f"Delete failed: {response.text}"
        
        # Verify deletion
        verify_response = requests.get(
            f"{BASE_URL}/api/photo-registries/{TestPhotoRegistries.created_registry_id}",
            headers=self.headers
        )
        assert verify_response.status_code == 404, "Registry should not exist after deletion"
        print("Registry deleted and verified")
    
    # Test pagination
    def test_11_pagination(self):
        """Test pagination parameters work correctly"""
        response = requests.get(
            f"{BASE_URL}/api/photo-registries",
            headers=self.headers,
            params={"page": 1, "page_size": 5}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert data["page"] == 1
        assert data["page_size"] == 5
        assert len(data["items"]) <= 5
        print(f"Pagination working: page {data['page']}, size {data['page_size']}, items {len(data['items'])}")


class TestExistingPhotoRegistry:
    """Test existing photo registry mentioned in review request"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test fixtures"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        if response.status_code != 200:
            pytest.skip("Authentication failed")
        self.token = response.json().get("access_token")
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }
    
    def test_existing_registry_search(self):
        """Test searching for existing test registry (MSKU1234567)"""
        response = requests.get(
            f"{BASE_URL}/api/photo-registries",
            headers=self.headers,
            params={"search": "MSKU1234567"}
        )
        assert response.status_code == 200
        data = response.json()
        print(f"Search for MSKU1234567: found {data['total']} results")
        
        if data["total"] > 0:
            registry = data["items"][0]
            print(f"Found registry #{registry.get('registry_number')}: {registry['container_number']}")
            print(f"  Booking: {registry.get('booking')}")
            print(f"  Created by: {registry.get('created_by_name')}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
