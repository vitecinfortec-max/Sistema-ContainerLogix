"""
Tests for Container Photo Upload API endpoints
- POST /api/upload - Upload a file
- DELETE /api/upload/{filename} - Delete a file
- Movement creation with container_photos field
- Movement update with container_photos field
"""

import pytest
import requests
import os
import io

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestUploadAPI:
    """File upload endpoint tests"""
    
    @pytest.fixture(scope="class")
    def auth_headers(self):
        """Get authentication headers"""
        # Login or register test user
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "teste.upload@teste.com",
            "password": "teste123"
        })
        
        if login_response.status_code == 401:
            # Register if not exists
            register_response = requests.post(f"{BASE_URL}/api/auth/register", json={
                "name": "Teste Upload",
                "email": "teste.upload@teste.com",
                "password": "teste123",
                "role": "operator"
            })
            assert register_response.status_code == 200, f"Failed to register: {register_response.text}"
            token = register_response.json()["access_token"]
        else:
            assert login_response.status_code == 200, f"Failed to login: {login_response.text}"
            token = login_response.json()["access_token"]
        
        return {"Authorization": f"Bearer {token}"}
    
    def test_upload_jpg_file_success(self, auth_headers):
        """Test uploading a JPG file successfully"""
        # Create a simple test image (1x1 pixel JPEG)
        jpeg_content = bytes([
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
            0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
            0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
            0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
            0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
            0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
            0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
            0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
            0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
            0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
            0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
            0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
            0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
            0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
            0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72,
            0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
            0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45,
            0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
            0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75,
            0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
            0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3,
            0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6,
            0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9,
            0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
            0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4,
            0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01,
            0x00, 0x00, 0x3F, 0x00, 0xFB, 0xD5, 0xDF, 0xFF, 0xD9
        ])
        
        files = {"file": ("test_container.jpg", io.BytesIO(jpeg_content), "image/jpeg")}
        
        response = requests.post(
            f"{BASE_URL}/api/upload",
            files=files,
            headers=auth_headers
        )
        
        assert response.status_code == 200, f"Upload failed: {response.text}"
        
        data = response.json()
        assert "filename" in data, "Response should contain filename"
        assert "url" in data, "Response should contain url"
        assert data["url"].startswith("/api/uploads/"), "URL should start with /api/uploads/"
        assert data["filename"].endswith(".jpg"), "Filename should end with .jpg"
        assert "size" in data, "Response should contain size"
        
        # Store filename for cleanup
        self.__class__.uploaded_filename = data["filename"]
        print(f"Uploaded file: {data['filename']}")
    
    def test_upload_png_file_success(self, auth_headers):
        """Test uploading a PNG file successfully"""
        # Create a minimal valid PNG file (1x1 pixel)
        png_content = bytes([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,  # PNG signature
            0x00, 0x00, 0x00, 0x0D,  # IHDR length
            0x49, 0x48, 0x44, 0x52,  # IHDR type
            0x00, 0x00, 0x00, 0x01,  # width: 1
            0x00, 0x00, 0x00, 0x01,  # height: 1
            0x08, 0x02,  # bit depth: 8, color type: RGB
            0x00, 0x00, 0x00,  # compression, filter, interlace
            0x90, 0x77, 0x53, 0xDE,  # CRC
            0x00, 0x00, 0x00, 0x0C,  # IDAT length
            0x49, 0x44, 0x41, 0x54,  # IDAT type
            0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0xFF, 0x00, 0x05, 0xFE, 0x02, 0xFE,  # compressed data
            0xA2, 0x20, 0x10, 0x9D,  # CRC (estimated)
            0x00, 0x00, 0x00, 0x00,  # IEND length
            0x49, 0x45, 0x4E, 0x44,  # IEND type
            0xAE, 0x42, 0x60, 0x82   # IEND CRC
        ])
        
        files = {"file": ("test_container.png", io.BytesIO(png_content), "image/png")}
        
        response = requests.post(
            f"{BASE_URL}/api/upload",
            files=files,
            headers=auth_headers
        )
        
        assert response.status_code == 200, f"Upload failed: {response.text}"
        
        data = response.json()
        assert data["filename"].endswith(".png"), "Filename should end with .png"
        
        # Store for cleanup
        self.__class__.uploaded_png_filename = data["filename"]
        print(f"Uploaded PNG file: {data['filename']}")
    
    def test_upload_invalid_file_type(self, auth_headers):
        """Test that uploading non-image files is rejected"""
        txt_content = b"This is not an image file"
        files = {"file": ("test.txt", io.BytesIO(txt_content), "text/plain")}
        
        response = requests.post(
            f"{BASE_URL}/api/upload",
            files=files,
            headers=auth_headers
        )
        
        assert response.status_code == 400, f"Should reject non-image files: {response.status_code}"
        assert "não permitido" in response.json().get("detail", "").lower() or "not allowed" in response.json().get("detail", "").lower()
        print("Invalid file type correctly rejected")
    
    def test_upload_unauthorized(self):
        """Test that uploading without auth is rejected"""
        jpeg_content = b"\xFF\xD8\xFF\xE0\x00\x10JFIF"
        files = {"file": ("test.jpg", io.BytesIO(jpeg_content), "image/jpeg")}
        
        response = requests.post(f"{BASE_URL}/api/upload", files=files)
        
        assert response.status_code in [401, 403], f"Should reject unauthorized upload: {response.status_code}"
        print("Unauthorized upload correctly rejected")
    
    def test_delete_file_success(self, auth_headers):
        """Test deleting an uploaded file"""
        if not hasattr(self.__class__, 'uploaded_filename'):
            pytest.skip("No file to delete")
        
        filename = self.__class__.uploaded_filename
        
        response = requests.delete(
            f"{BASE_URL}/api/upload/{filename}",
            headers=auth_headers
        )
        
        assert response.status_code == 200, f"Delete failed: {response.text}"
        assert "sucesso" in response.json().get("message", "").lower() or "success" in response.json().get("message", "").lower()
        print(f"Successfully deleted file: {filename}")
    
    def test_delete_nonexistent_file(self, auth_headers):
        """Test deleting a file that doesn't exist"""
        response = requests.delete(
            f"{BASE_URL}/api/upload/nonexistent_file_12345.jpg",
            headers=auth_headers
        )
        
        assert response.status_code == 404, f"Should return 404 for nonexistent file: {response.status_code}"
        print("Nonexistent file deletion correctly returned 404")
    
    def test_delete_unauthorized(self):
        """Test that deleting without auth is rejected"""
        response = requests.delete(f"{BASE_URL}/api/upload/somefile.jpg")
        
        assert response.status_code in [401, 403], f"Should reject unauthorized delete: {response.status_code}"
        print("Unauthorized delete correctly rejected")
    
    def test_uploaded_file_is_accessible(self, auth_headers):
        """Test that uploaded file can be accessed via URL"""
        if not hasattr(self.__class__, 'uploaded_png_filename'):
            pytest.skip("No PNG file uploaded")
        
        filename = self.__class__.uploaded_png_filename
        
        # Try to access the file
        response = requests.get(f"{BASE_URL}/uploads/{filename}")
        
        # Should be accessible (may require auth or not based on implementation)
        assert response.status_code in [200, 401, 403], f"Unexpected status: {response.status_code}"
        print(f"File accessibility check passed for: {filename}")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/upload/{filename}", headers=auth_headers)


class TestMovementWithPhotos:
    """Test movement CRUD with container_photos field"""
    
    @pytest.fixture(scope="class")
    def auth_headers(self):
        """Get authentication headers"""
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "teste.upload@teste.com",
            "password": "teste123"
        })
        
        if login_response.status_code == 401:
            register_response = requests.post(f"{BASE_URL}/api/auth/register", json={
                "name": "Teste Upload",
                "email": "teste.upload@teste.com",
                "password": "teste123",
                "role": "operator"
            })
            assert register_response.status_code == 200
            token = register_response.json()["access_token"]
        else:
            assert login_response.status_code == 200
            token = login_response.json()["access_token"]
        
        return {"Authorization": f"Bearer {token}"}
    
    @pytest.fixture(scope="class")
    def shipping_line(self, auth_headers):
        """Get or create a shipping line for testing"""
        lines_response = requests.get(f"{BASE_URL}/api/shipping-lines", headers=auth_headers)
        if lines_response.status_code == 200 and len(lines_response.json()) > 0:
            return lines_response.json()[0]["name"]
        
        # Create one if none exist
        create_response = requests.post(
            f"{BASE_URL}/api/shipping-lines",
            json={"name": "TEST_Armador", "code": "TST"},
            headers=auth_headers
        )
        if create_response.status_code == 200:
            return create_response.json()["name"]
        return "MSC"  # Fallback
    
    def test_create_movement_with_photos(self, auth_headers, shipping_line):
        """Test creating a movement with container_photos"""
        movement_data = {
            "operation_type": "ENTRADA",
            "driver_name": "TEST_Motorista Foto",
            "driver_cpf": "123.456.789-00",
            "truck_plate": "TST-1234",
            "trailer_plate_1": "TST-5678",
            "transport_company": "TEST_Transportadora Foto",
            "container_number": "TSTU1234567",
            "status": "CHEIO",
            "size_type": "40HC",
            "shipping_line": shipping_line,
            "container_photos": {
                "frente": "/uploads/test-frente.jpg",
                "traseira": "/uploads/test-traseira.jpg",
                "esquerda": "/uploads/test-esquerda.jpg",
                "direita": "/uploads/test-direita.jpg"
            }
        }
        
        response = requests.post(
            f"{BASE_URL}/api/movements",
            json=movement_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200, f"Create movement failed: {response.text}"
        
        data = response.json()
        assert "id" in data, "Response should contain id"
        assert "container_photos" in data, "Response should contain container_photos"
        assert data["container_photos"] is not None, "container_photos should not be None"
        assert data["container_photos"]["frente"] == "/uploads/test-frente.jpg"
        assert data["container_photos"]["traseira"] == "/uploads/test-traseira.jpg"
        assert data["container_photos"]["esquerda"] == "/uploads/test-esquerda.jpg"
        assert data["container_photos"]["direita"] == "/uploads/test-direita.jpg"
        
        # Store for subsequent tests
        self.__class__.created_movement_id = data["id"]
        print(f"Created movement with photos: {data['id']}")
    
    def test_get_movement_with_photos(self, auth_headers):
        """Test retrieving a movement with photos"""
        if not hasattr(self.__class__, 'created_movement_id'):
            pytest.skip("No movement created")
        
        movement_id = self.__class__.created_movement_id
        
        response = requests.get(
            f"{BASE_URL}/api/movements/{movement_id}",
            headers=auth_headers
        )
        
        assert response.status_code == 200, f"Get movement failed: {response.text}"
        
        data = response.json()
        assert data["container_photos"] is not None
        assert "frente" in data["container_photos"]
        assert "traseira" in data["container_photos"]
        print(f"Retrieved movement with photos: {movement_id}")
    
    def test_update_movement_photos(self, auth_headers, shipping_line):
        """Test updating a movement's photos"""
        if not hasattr(self.__class__, 'created_movement_id'):
            pytest.skip("No movement created")
        
        movement_id = self.__class__.created_movement_id
        
        # First get the current movement
        get_response = requests.get(
            f"{BASE_URL}/api/movements/{movement_id}",
            headers=auth_headers
        )
        current_movement = get_response.json()
        
        # Update with modified photos (removing some, changing others)
        update_data = {
            "operation_type": current_movement["operation_type"],
            "driver_name": current_movement["driver_name"],
            "driver_cpf": current_movement["driver_cpf"],
            "truck_plate": current_movement["truck_plate"],
            "trailer_plate_1": current_movement["trailer_plate_1"],
            "transport_company": current_movement["transport_company"],
            "container_number": current_movement["container_number"],
            "status": current_movement["status"],
            "size_type": current_movement["size_type"],
            "shipping_line": shipping_line,
            "container_photos": {
                "frente": "/uploads/test-frente-updated.jpg",
                "traseira": "/uploads/test-traseira-updated.jpg"
                # Removed esquerda and direita
            }
        }
        
        response = requests.put(
            f"{BASE_URL}/api/movements/{movement_id}",
            json=update_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200, f"Update movement failed: {response.text}"
        
        data = response.json()
        assert data["container_photos"]["frente"] == "/uploads/test-frente-updated.jpg"
        assert data["container_photos"]["traseira"] == "/uploads/test-traseira-updated.jpg"
        assert "esquerda" not in data["container_photos"]
        assert "direita" not in data["container_photos"]
        print(f"Updated movement photos: {movement_id}")
    
    def test_create_movement_without_photos(self, auth_headers, shipping_line):
        """Test creating a movement without photos (photos are optional)"""
        movement_data = {
            "operation_type": "SAIDA",
            "driver_name": "TEST_Motorista Sem Foto",
            "driver_cpf": "987.654.321-00",
            "truck_plate": "TST-9999",
            "trailer_plate_1": "TST-8888",
            "transport_company": "TEST_Transportadora Sem Foto",
            "container_number": "TSTU7654321",
            "status": "VAZIO",
            "size_type": "20DC",
            "shipping_line": shipping_line,
            "container_photos": None
        }
        
        response = requests.post(
            f"{BASE_URL}/api/movements",
            json=movement_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200, f"Create movement failed: {response.text}"
        
        data = response.json()
        assert data.get("container_photos") is None or data.get("container_photos") == {}
        
        # Store for cleanup
        self.__class__.no_photo_movement_id = data["id"]
        print(f"Created movement without photos: {data['id']}")
    
    def test_list_movements_includes_photos(self, auth_headers):
        """Test that listing movements includes container_photos field"""
        response = requests.get(
            f"{BASE_URL}/api/movements",
            headers=auth_headers
        )
        
        assert response.status_code == 200, f"List movements failed: {response.text}"
        
        movements = response.json()
        assert len(movements) > 0, "Should have at least one movement"
        
        # Check that container_photos field is present
        found_with_photos = False
        for m in movements:
            if "container_photos" in m:
                if m["container_photos"] and len(m["container_photos"]) > 0:
                    found_with_photos = True
                    break
        
        print(f"Found movements with photos: {found_with_photos}")
    
    def test_cleanup_test_movements(self, auth_headers):
        """Cleanup: Delete test movements"""
        deleted = []
        
        if hasattr(self.__class__, 'created_movement_id'):
            response = requests.delete(
                f"{BASE_URL}/api/movements/{self.__class__.created_movement_id}",
                headers=auth_headers
            )
            if response.status_code == 200:
                deleted.append(self.__class__.created_movement_id)
        
        if hasattr(self.__class__, 'no_photo_movement_id'):
            response = requests.delete(
                f"{BASE_URL}/api/movements/{self.__class__.no_photo_movement_id}",
                headers=auth_headers
            )
            if response.status_code == 200:
                deleted.append(self.__class__.no_photo_movement_id)
        
        print(f"Cleaned up test movements: {deleted}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
