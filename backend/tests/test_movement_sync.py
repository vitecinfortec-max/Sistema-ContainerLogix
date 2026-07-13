"""
Test Suite for Container Movement Synchronization Features
Tests: Create, Delete, Page Refresh, Cross-user sync, Sequential numbering
"""
import pytest
import requests
import os
import time
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestMovementCRUD:
    """Test movement creation and deletion with persistence verification"""
    
    @pytest.fixture(scope="class")
    def auth_token_user1(self):
        """Get auth token for user1 (test@teste.com)"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "test@teste.com",
            "password": "teste123"
        })
        if response.status_code == 200:
            return response.json().get("access_token")
        pytest.skip("User1 authentication failed")
    
    @pytest.fixture(scope="class")
    def auth_token_user2(self):
        """Get auth token for user2 (user2@teste.com)"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "user2@teste.com",
            "password": "teste123"
        })
        if response.status_code == 200:
            return response.json().get("access_token")
        pytest.skip("User2 authentication failed")
    
    @pytest.fixture
    def authenticated_client_user1(self, auth_token_user1):
        """Requests session with user1 auth header"""
        session = requests.Session()
        session.headers.update({
            "Content-Type": "application/json",
            "Authorization": f"Bearer {auth_token_user1}"
        })
        return session
    
    @pytest.fixture
    def authenticated_client_user2(self, auth_token_user2):
        """Requests session with user2 auth header"""
        session = requests.Session()
        session.headers.update({
            "Content-Type": "application/json",
            "Authorization": f"Bearer {auth_token_user2}"
        })
        return session
    
    def test_api_health(self):
        """Test API is accessible"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        print(f"API health check: {response.json()}")
    
    def test_login_user1(self):
        """Test user1 login"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "test@teste.com",
            "password": "teste123"
        })
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "user" in data
        print(f"User1 logged in: {data['user']['name']}")
    
    def test_login_user2(self):
        """Test user2 login"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "user2@teste.com",
            "password": "teste123"
        })
        if response.status_code == 200:
            data = response.json()
            assert "access_token" in data
            print(f"User2 logged in: {data['user']['name']}")
        elif response.status_code == 401:
            # User2 may need to be registered
            print("User2 not found - skipping cross-user tests")
            pytest.skip("User2 not registered")
    
    def test_create_movement_and_verify_persistence(self, authenticated_client_user1):
        """Test: Criar movimentação - verificar se salva corretamente e aparece na lista"""
        # Create a test movement
        unique_container = f"TESTSYNC{uuid.uuid4().hex[:6].upper()}"
        movement_data = {
            "operation_type": "ENTRADA",
            "driver_name": "Test Driver Sync",
            "driver_cpf": "12345678901",
            "truck_plate": "TST1234",
            "trailer_plate_1": "TST5678",
            "trailer_plate_2": None,
            "transport_company": "Test Transport Co",
            "container_number": unique_container,
            "status": "CHEIO",
            "size_type": "40HC",
            "tare": "4000",
            "shipping_line": "MSC",
            "seal": "SEAL123",
            "genset": None,
            "booking": "BOOK123"
        }
        
        # Create movement
        response = authenticated_client_user1.post(f"{BASE_URL}/api/movements", json=movement_data)
        assert response.status_code == 200, f"Create failed: {response.text}"
        created = response.json()
        
        # Verify response structure
        assert "id" in created
        assert "transaction_id" in created
        assert created["container_number"] == unique_container
        assert created["driver_name"] == "Test Driver Sync"
        print(f"Created movement: id={created['id']}, transaction_id={created['transaction_id']}")
        
        movement_id = created["id"]
        
        # Verify persistence: GET to check if it's in the list
        get_response = authenticated_client_user1.get(f"{BASE_URL}/api/movements")
        assert get_response.status_code == 200
        
        movements = get_response.json()
        found = any(m["id"] == movement_id for m in movements)
        assert found, f"Created movement {movement_id} not found in movements list"
        print(f"Movement {movement_id} verified in list")
        
        # Cleanup: Delete the test movement
        delete_response = authenticated_client_user1.delete(f"{BASE_URL}/api/movements/{movement_id}")
        assert delete_response.status_code == 200
        print(f"Cleanup: Movement {movement_id} deleted")
    
    def test_delete_movement_and_verify_removal(self, authenticated_client_user1):
        """Test: Deletar movimentação - verificar se desaparece imediatamente da lista"""
        # First create a movement to delete
        unique_container = f"TESTDEL{uuid.uuid4().hex[:6].upper()}"
        movement_data = {
            "operation_type": "SAIDA",
            "driver_name": "Test Delete Driver",
            "driver_cpf": "98765432100",
            "truck_plate": "DEL1234",
            "trailer_plate_1": "DEL5678",
            "trailer_plate_2": None,
            "transport_company": "Delete Test Co",
            "container_number": unique_container,
            "status": "VAZIO",
            "size_type": "20DC",
            "tare": "2200",
            "shipping_line": "CMA CGM",
            "seal": None,
            "genset": None,
            "booking": None
        }
        
        # Create movement
        create_response = authenticated_client_user1.post(f"{BASE_URL}/api/movements", json=movement_data)
        assert create_response.status_code == 200
        created = create_response.json()
        movement_id = created["id"]
        print(f"Created movement for deletion test: {movement_id}")
        
        # Verify it's in the list before delete
        get_before = authenticated_client_user1.get(f"{BASE_URL}/api/movements")
        assert get_before.status_code == 200
        movements_before = get_before.json()
        found_before = any(m["id"] == movement_id for m in movements_before)
        assert found_before, "Movement not found in list before delete"
        
        # Delete the movement
        delete_response = authenticated_client_user1.delete(f"{BASE_URL}/api/movements/{movement_id}")
        assert delete_response.status_code == 200
        print(f"Delete API returned success")
        
        # Verify removal: GET to check it's no longer in the list
        get_after = authenticated_client_user1.get(f"{BASE_URL}/api/movements")
        assert get_after.status_code == 200
        movements_after = get_after.json()
        found_after = any(m["id"] == movement_id for m in movements_after)
        assert not found_after, f"Deleted movement {movement_id} still appears in list"
        print(f"Verified: Movement {movement_id} no longer in list after delete")
        
        # Also verify direct GET returns 404
        get_single = authenticated_client_user1.get(f"{BASE_URL}/api/movements/{movement_id}")
        assert get_single.status_code == 404, "Deleted movement should return 404"
        print("Verified: Direct GET returns 404 for deleted movement")
    
    def test_double_delete_returns_404(self, authenticated_client_user1):
        """Test: Double delete should return 404"""
        # Create movement
        unique_container = f"TESTDD{uuid.uuid4().hex[:6].upper()}"
        movement_data = {
            "operation_type": "ENTRADA",
            "driver_name": "Double Delete Test",
            "driver_cpf": "11111111111",
            "truck_plate": "DD1234",
            "trailer_plate_1": "DD5678",
            "trailer_plate_2": None,
            "transport_company": "DD Test Co",
            "container_number": unique_container,
            "status": "CHEIO",
            "size_type": "40HC",
            "tare": "3800",
            "shipping_line": "Maersk",
            "seal": None,
            "genset": None,
            "booking": None
        }
        
        create_response = authenticated_client_user1.post(f"{BASE_URL}/api/movements", json=movement_data)
        assert create_response.status_code == 200
        movement_id = create_response.json()["id"]
        
        # First delete - should succeed
        delete1 = authenticated_client_user1.delete(f"{BASE_URL}/api/movements/{movement_id}")
        assert delete1.status_code == 200
        print("First delete succeeded")
        
        # Second delete - should return 404
        delete2 = authenticated_client_user1.delete(f"{BASE_URL}/api/movements/{movement_id}")
        assert delete2.status_code == 404, "Second delete should return 404"
        print("Second delete correctly returned 404")
    
    def test_sequential_transaction_id_after_deletes(self, authenticated_client_user1):
        """Test: Numeração sequencial - verificar se transaction_id mantém sequência após deletes"""
        # Create first movement
        unique_container1 = f"TESTSEQ1{uuid.uuid4().hex[:4].upper()}"
        movement_data1 = {
            "operation_type": "ENTRADA",
            "driver_name": "Seq Test Driver 1",
            "driver_cpf": "22222222222",
            "truck_plate": "SEQ1111",
            "trailer_plate_1": "SEQ2222",
            "trailer_plate_2": None,
            "transport_company": "Seq Test Co",
            "container_number": unique_container1,
            "status": "CHEIO",
            "size_type": "40HC",
            "tare": "4000",
            "shipping_line": "MSC",
            "seal": None,
            "genset": None,
            "booking": None
        }
        
        create1 = authenticated_client_user1.post(f"{BASE_URL}/api/movements", json=movement_data1)
        assert create1.status_code == 200
        movement1 = create1.json()
        transaction_id_1 = movement1["transaction_id"]
        print(f"First movement transaction_id: {transaction_id_1}")
        
        # Delete first movement
        delete1 = authenticated_client_user1.delete(f"{BASE_URL}/api/movements/{movement1['id']}")
        assert delete1.status_code == 200
        print("Deleted first movement")
        
        # Create second movement - should have higher transaction_id (not reuse deleted)
        unique_container2 = f"TESTSEQ2{uuid.uuid4().hex[:4].upper()}"
        movement_data2 = {
            "operation_type": "ENTRADA",
            "driver_name": "Seq Test Driver 2",
            "driver_cpf": "33333333333",
            "truck_plate": "SEQ3333",
            "trailer_plate_1": "SEQ4444",
            "trailer_plate_2": None,
            "transport_company": "Seq Test Co",
            "container_number": unique_container2,
            "status": "VAZIO",
            "size_type": "20DC",
            "tare": "2200",
            "shipping_line": "Hapag-Lloyd",
            "seal": None,
            "genset": None,
            "booking": None
        }
        
        create2 = authenticated_client_user1.post(f"{BASE_URL}/api/movements", json=movement_data2)
        assert create2.status_code == 200
        movement2 = create2.json()
        transaction_id_2 = movement2["transaction_id"]
        print(f"Second movement transaction_id: {transaction_id_2}")
        
        # Verify transaction_id is sequential (greater than previous)
        assert transaction_id_2 > transaction_id_1, f"transaction_id should be sequential: {transaction_id_2} should be > {transaction_id_1}"
        print(f"PASS: transaction_id sequence maintained ({transaction_id_1} -> {transaction_id_2})")
        
        # Cleanup
        authenticated_client_user1.delete(f"{BASE_URL}/api/movements/{movement2['id']}")
        print("Cleanup completed")
    
    def test_list_consistency_after_refresh(self, authenticated_client_user1):
        """Test: Atualizar página (F5) - verificar se lista mantém consistência após refresh"""
        # Create a movement
        unique_container = f"TESTREF{uuid.uuid4().hex[:6].upper()}"
        movement_data = {
            "operation_type": "ENTRADA",
            "driver_name": "Refresh Test Driver",
            "driver_cpf": "44444444444",
            "truck_plate": "REF1234",
            "trailer_plate_1": "REF5678",
            "trailer_plate_2": None,
            "transport_company": "Refresh Test Co",
            "container_number": unique_container,
            "status": "CHEIO",
            "size_type": "40HC",
            "tare": "4000",
            "shipping_line": "ONE",
            "seal": "REFSEAL",
            "genset": None,
            "booking": "REFBOOK"
        }
        
        create_response = authenticated_client_user1.post(f"{BASE_URL}/api/movements", json=movement_data)
        assert create_response.status_code == 200
        created = create_response.json()
        movement_id = created["id"]
        print(f"Created test movement: {movement_id}")
        
        # Simulate multiple "refresh" calls (GET requests)
        for i in range(3):
            time.sleep(0.3)
            response = authenticated_client_user1.get(f"{BASE_URL}/api/movements")
            assert response.status_code == 200
            movements = response.json()
            found = any(m["id"] == movement_id for m in movements)
            assert found, f"Movement not found on refresh attempt {i+1}"
            print(f"Refresh {i+1}: Movement found in list")
        
        # Cleanup
        delete_response = authenticated_client_user1.delete(f"{BASE_URL}/api/movements/{movement_id}")
        assert delete_response.status_code == 200
        
        # Verify deletion persists across "refreshes"
        for i in range(3):
            time.sleep(0.3)
            response = authenticated_client_user1.get(f"{BASE_URL}/api/movements")
            assert response.status_code == 200
            movements = response.json()
            found = any(m["id"] == movement_id for m in movements)
            assert not found, f"Deleted movement still found on refresh attempt {i+1}"
            print(f"Post-delete refresh {i+1}: Movement correctly not in list")
        
        print("PASS: List consistency maintained across refreshes")


class TestCrossUserSync:
    """Test synchronization between users"""
    
    @pytest.fixture(scope="class")
    def auth_token_user1(self):
        """Get auth token for user1"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "test@teste.com",
            "password": "teste123"
        })
        if response.status_code == 200:
            return response.json().get("access_token")
        pytest.skip("User1 authentication failed")
    
    @pytest.fixture(scope="class")
    def auth_token_user2(self):
        """Get auth token for user2"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "user2@teste.com",
            "password": "teste123"
        })
        if response.status_code == 200:
            return response.json().get("access_token")
        pytest.skip("User2 not registered - skipping cross-user sync tests")
    
    def test_cross_user_movement_visibility(self, auth_token_user1, auth_token_user2):
        """Test: Sincronização entre usuários - verificar se movimentação criada por user1 aparece para user2"""
        headers_user1 = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {auth_token_user1}"
        }
        headers_user2 = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {auth_token_user2}"
        }
        
        # User1 creates movement
        unique_container = f"CROSSU{uuid.uuid4().hex[:6].upper()}"
        movement_data = {
            "operation_type": "ENTRADA",
            "driver_name": "Cross User Test Driver",
            "driver_cpf": "55555555555",
            "truck_plate": "CRS1234",
            "trailer_plate_1": "CRS5678",
            "trailer_plate_2": None,
            "transport_company": "Cross User Test Co",
            "container_number": unique_container,
            "status": "CHEIO",
            "size_type": "40HC",
            "tare": "4000",
            "shipping_line": "MSC",
            "seal": "CROSSSEAL",
            "genset": None,
            "booking": "CROSSBOOK"
        }
        
        create_response = requests.post(f"{BASE_URL}/api/movements", json=movement_data, headers=headers_user1)
        assert create_response.status_code == 200
        created = create_response.json()
        movement_id = created["id"]
        print(f"User1 created movement: {movement_id}")
        
        # Small delay to ensure propagation
        time.sleep(0.5)
        
        # User2 should see the movement
        user2_response = requests.get(f"{BASE_URL}/api/movements", headers=headers_user2)
        assert user2_response.status_code == 200
        user2_movements = user2_response.json()
        found_by_user2 = any(m["id"] == movement_id for m in user2_movements)
        assert found_by_user2, f"Movement created by User1 not visible to User2"
        print(f"PASS: User2 can see movement {movement_id} created by User1")
        
        # Verify specific fields
        movement_for_user2 = next((m for m in user2_movements if m["id"] == movement_id), None)
        assert movement_for_user2["container_number"] == unique_container
        assert movement_for_user2["driver_name"] == "Cross User Test Driver"
        print("PASS: Movement data is correct for User2")
        
        # Cleanup: User1 deletes
        delete_response = requests.delete(f"{BASE_URL}/api/movements/{movement_id}", headers=headers_user1)
        assert delete_response.status_code == 200
        
        # Small delay
        time.sleep(0.5)
        
        # User2 should NOT see the deleted movement
        user2_response_after = requests.get(f"{BASE_URL}/api/movements", headers=headers_user2)
        assert user2_response_after.status_code == 200
        user2_movements_after = user2_response_after.json()
        found_after_delete = any(m["id"] == movement_id for m in user2_movements_after)
        assert not found_after_delete, f"Deleted movement still visible to User2"
        print(f"PASS: Movement deleted by User1 no longer visible to User2")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
