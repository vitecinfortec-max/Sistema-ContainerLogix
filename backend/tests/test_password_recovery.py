"""
Test Suite: Password Recovery Features
Tests for forgot-password and change-password endpoints
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestForgotPasswordEndpoint:
    """Tests for POST /api/auth/forgot-password endpoint"""
    
    def test_forgot_password_existing_email(self):
        """Test forgot password with existing email - should return success message"""
        # First register a test user
        test_email = f"TEST_forgot_{uuid.uuid4().hex[:8]}@test.com"
        register_response = requests.post(f"{BASE_URL}/api/auth/register", json={
            "name": "Test Forgot User",
            "email": test_email,
            "password": "test123456"
        })
        assert register_response.status_code == 200, f"Failed to register: {register_response.text}"
        
        # Now test forgot password
        response = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={
            "email": test_email
        })
        
        assert response.status_code == 200, f"Forgot password failed: {response.text}"
        data = response.json()
        assert "message" in data
        # Should not reveal if email exists
        assert "Se o email estiver cadastrado" in data["message"]
        print(f"Forgot password response: {data}")
    
    def test_forgot_password_nonexistent_email(self):
        """Test forgot password with non-existent email - should still return success (security)"""
        response = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={
            "email": "nonexistent_email_xyz@test.com"
        })
        
        # Should return 200 to not reveal if email exists
        assert response.status_code == 200, f"Forgot password failed: {response.text}"
        data = response.json()
        assert "message" in data
        print(f"Forgot password (nonexistent) response: {data}")


class TestChangePasswordEndpoint:
    """Tests for POST /api/auth/change-password endpoint"""
    
    @pytest.fixture
    def test_user_with_token(self):
        """Create a test user and return credentials and token"""
        test_email = f"TEST_change_{uuid.uuid4().hex[:8]}@test.com"
        register_response = requests.post(f"{BASE_URL}/api/auth/register", json={
            "name": "Test Change User",
            "email": test_email,
            "password": "original123"
        })
        assert register_response.status_code == 200
        data = register_response.json()
        return {
            "email": test_email,
            "password": "original123",
            "token": data["access_token"]
        }
    
    def test_change_password_success(self, test_user_with_token):
        """Test successful password change"""
        response = requests.post(
            f"{BASE_URL}/api/auth/change-password",
            json={
                "current_password": test_user_with_token["password"],
                "new_password": "newpassword123"
            },
            headers={"Authorization": f"Bearer {test_user_with_token['token']}"}
        )
        
        assert response.status_code == 200, f"Change password failed: {response.text}"
        data = response.json()
        assert "message" in data
        assert "sucesso" in data["message"].lower()
        print(f"Change password success: {data}")
        
        # Verify new password works
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": test_user_with_token["email"],
            "password": "newpassword123"
        })
        assert login_response.status_code == 200, "Login with new password failed"
        print("Verified: new password works for login")
    
    def test_change_password_wrong_current(self, test_user_with_token):
        """Test change password with wrong current password"""
        response = requests.post(
            f"{BASE_URL}/api/auth/change-password",
            json={
                "current_password": "wrongpassword",
                "new_password": "newpassword123"
            },
            headers={"Authorization": f"Bearer {test_user_with_token['token']}"}
        )
        
        assert response.status_code == 400, f"Should fail with wrong current password: {response.text}"
        data = response.json()
        assert "detail" in data
        print(f"Change password wrong current: {data}")
    
    def test_change_password_unauthorized(self):
        """Test change password without auth token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/change-password",
            json={
                "current_password": "test123",
                "new_password": "newpassword123"
            }
        )
        
        # API returns 403 for unauthenticated requests
        assert response.status_code in [401, 403], f"Should be unauthorized: {response.text}"
        print("Verified: change password requires authentication")


class TestMustChangePasswordField:
    """Tests for must_change_password field in login response"""
    
    def test_login_returns_must_change_password_field(self):
        """Test that login response includes must_change_password field"""
        # Register a new test user
        test_email = f"TEST_mustchange_{uuid.uuid4().hex[:8]}@test.com"
        register_response = requests.post(f"{BASE_URL}/api/auth/register", json={
            "name": "Test MustChange User",
            "email": test_email,
            "password": "test123456"
        })
        assert register_response.status_code == 200
        
        # Login and check for must_change_password field
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": test_email,
            "password": "test123456"
        })
        
        assert login_response.status_code == 200
        data = login_response.json()
        
        # Check that user object contains must_change_password
        assert "user" in data
        assert "must_change_password" in data["user"], "must_change_password field missing from user object"
        assert isinstance(data["user"]["must_change_password"], bool)
        print(f"Login response user object: {data['user']}")
        print(f"must_change_password = {data['user']['must_change_password']}")


class TestAuthMeEndpoint:
    """Tests for /api/auth/me endpoint with must_change_password"""
    
    def test_auth_me_returns_must_change_password(self):
        """Test that /api/auth/me returns must_change_password field"""
        # Register a test user
        test_email = f"TEST_authme_{uuid.uuid4().hex[:8]}@test.com"
        register_response = requests.post(f"{BASE_URL}/api/auth/register", json={
            "name": "Test AuthMe User",
            "email": test_email,
            "password": "test123456"
        })
        assert register_response.status_code == 200
        token = register_response.json()["access_token"]
        
        # Call /api/auth/me
        me_response = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert me_response.status_code == 200
        data = me_response.json()
        assert "must_change_password" in data, "must_change_password field missing from /api/auth/me"
        print(f"Auth me response: {data}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
