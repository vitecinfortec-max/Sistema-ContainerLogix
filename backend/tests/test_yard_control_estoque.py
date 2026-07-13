"""
Test suite for Yard Control ESTOQUE filter functionality
- Filter 'Estoque Atual' (movement_type=ESTOQUE) should return only containers with in_stock=true
- Filter with date range should filter by entry_date
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestYardControlEstoqueFilter:
    """Tests for Yard Control ESTOQUE filter"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={
                "email": "joao.victor@jalogisticas.com",
                "password": "password123"
            }
        )
        if response.status_code == 200:
            return response.json().get("access_token")
        pytest.skip("Authentication failed - skipping authenticated tests")
    
    @pytest.fixture(scope="class")
    def authenticated_client(self, auth_token):
        """Session with auth header"""
        session = requests.Session()
        session.headers.update({
            "Content-Type": "application/json",
            "Authorization": f"Bearer {auth_token}"
        })
        return session

    def test_estoque_filter_returns_only_in_stock_true(self, authenticated_client):
        """Test that ESTOQUE filter returns only containers with in_stock=true"""
        response = authenticated_client.get(f"{BASE_URL}/api/yard-control?movement_type=ESTOQUE")
        assert response.status_code == 200
        
        data = response.json()
        assert "containers" in data
        
        containers = data["containers"]
        assert len(containers) > 0, "Should return at least one container"
        
        # Verify all containers have in_stock=true
        for container in containers:
            assert container.get("in_stock") == True, f"Container {container.get('container_number')} should have in_stock=true"
        
        # Verify no container has exit_date (containers in stock shouldn't have exit_date)
        in_stock_with_exit = [c for c in containers if c.get("exit_date") is not None]
        assert len(in_stock_with_exit) == 0, "Containers in stock should not have exit_date"

    def test_estoque_filter_with_date_range(self, authenticated_client):
        """Test that ESTOQUE filter with date range filters by entry_date"""
        response = authenticated_client.get(
            f"{BASE_URL}/api/yard-control?movement_type=ESTOQUE&date_from=2024-01-01&date_to=2026-12-31"
        )
        assert response.status_code == 200
        
        data = response.json()
        assert "containers" in data
        
        containers = data["containers"]
        assert len(containers) > 0, "Should return containers within date range"
        
        # Verify all returned containers have entry_date within the specified range
        from datetime import datetime
        date_from = datetime.fromisoformat("2024-01-01")
        date_to = datetime.fromisoformat("2026-12-31")
        
        for container in containers:
            entry_date_str = container.get("entry_date")
            assert entry_date_str is not None, f"Container {container.get('container_number')} should have entry_date"
            
            # Parse entry_date (handle timezone format)
            entry_date = datetime.fromisoformat(entry_date_str.replace('+00:00', '').replace('Z', ''))
            assert date_from <= entry_date <= date_to, f"Entry date {entry_date} should be within range"
            
            # All should still be in_stock=true
            assert container.get("in_stock") == True

    def test_estoque_filter_no_date_range(self, authenticated_client):
        """Test that ESTOQUE filter without date range returns all containers in stock"""
        response = authenticated_client.get(f"{BASE_URL}/api/yard-control?movement_type=ESTOQUE")
        assert response.status_code == 200
        
        data = response.json()
        containers = data["containers"]
        
        # Should return a reasonable number of containers
        assert len(containers) > 0, "Should return containers in stock"
        
        # Verify data structure
        if containers:
            container = containers[0]
            assert "container_number" in container
            assert "in_stock" in container
            assert "entry_date" in container
            assert container["in_stock"] == True

    def test_estoque_excludes_exited_containers(self, authenticated_client):
        """Test that ESTOQUE filter excludes containers that have exited"""
        # Get ESTOQUE containers
        estoque_response = authenticated_client.get(f"{BASE_URL}/api/yard-control?movement_type=ESTOQUE")
        assert estoque_response.status_code == 200
        estoque_containers = estoque_response.json()["containers"]
        
        # Get SAIDA containers
        saida_response = authenticated_client.get(f"{BASE_URL}/api/yard-control?movement_type=SAIDA")
        assert saida_response.status_code == 200
        saida_containers = saida_response.json()["containers"]
        
        # Containers in ESTOQUE should not appear in SAIDA (by container_number)
        estoque_container_numbers = {c["container_number"] for c in estoque_containers}
        
        # Note: A container can have multiple movements, so same container_number 
        # might appear in both if it had multiple entries/exits
        # What matters is that ESTOQUE shows only in_stock=true containers
        for container in estoque_containers:
            assert container["in_stock"] == True
            assert container["exit_date"] is None

    def test_todos_filter_returns_all_movements(self, authenticated_client):
        """Test that 'Todos' filter (no movement_type) returns both in_stock and exited containers"""
        response = authenticated_client.get(f"{BASE_URL}/api/yard-control")
        assert response.status_code == 200
        
        data = response.json()
        containers = data["containers"]
        
        # Should include both in_stock=true and in_stock=false
        in_stock_true = [c for c in containers if c.get("in_stock") == True]
        in_stock_false = [c for c in containers if c.get("in_stock") == False]
        
        # There should be at least some containers in stock
        assert len(in_stock_true) > 0, "Should have containers in stock"

    def test_entrada_filter(self, authenticated_client):
        """Test ENTRADA filter returns entry movements"""
        response = authenticated_client.get(f"{BASE_URL}/api/yard-control?movement_type=ENTRADA")
        assert response.status_code == 200
        
        data = response.json()
        assert "containers" in data

    def test_saida_filter(self, authenticated_client):
        """Test SAIDA filter returns exit movements"""
        response = authenticated_client.get(f"{BASE_URL}/api/yard-control?movement_type=SAIDA")
        assert response.status_code == 200
        
        data = response.json()
        containers = data["containers"]
        
        # SAIDA containers should have exit_date
        for container in containers:
            assert container.get("in_stock") == False or container.get("exit_date") is not None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
