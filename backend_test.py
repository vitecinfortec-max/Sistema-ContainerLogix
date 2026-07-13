import requests
import sys
import json
from datetime import datetime, timezone

class ContainerLogixAPITester:
    def __init__(self, base_url="https://container-mvmt-sys.preview.emergentagent.com"):
        self.base_url = base_url
        self.token = None
        self.user_data = None
        self.tests_run = 0
        self.tests_passed = 0
        self.created_driver_id = None
        self.created_company_id = None
        self.created_movement_id = None

    def run_test(self, name, method, endpoint, expected_status, data=None, files=None):
        """Run a single API test"""
        url = f"{self.base_url}/api/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    return success, response.json() if response.text else {}
                except:
                    return success, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    error_detail = response.json()
                    print(f"   Error detail: {error_detail}")
                except:
                    print(f"   Response text: {response.text[:200]}")

            return success, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_api_root(self):
        """Test API root endpoint"""
        return self.run_test("API Root", "GET", "", 200)

    def test_register(self):
        """Test user registration"""
        test_user_data = {
            "name": "Test User",
            "email": f"test_user_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "testpass123",
            "role": "admin"
        }
        
        success, response = self.run_test(
            "User Registration",
            "POST",
            "auth/register",
            200,
            data=test_user_data
        )
        
        if success and 'access_token' in response:
            self.token = response['access_token']
            self.user_data = response['user']
            print(f"   Registered user: {self.user_data['name']} ({self.user_data['email']})")
            return True
        return False

    def test_login(self):
        """Test user login with registered credentials"""
        if not self.user_data:
            print("❌ Cannot test login - no user data available")
            return False
            
        login_data = {
            "email": self.user_data['email'],
            "password": "testpass123"
        }
        
        # Reset token to test fresh login
        old_token = self.token
        self.token = None
        
        success, response = self.run_test(
            "User Login",
            "POST", 
            "auth/login",
            200,
            data=login_data
        )
        
        if success and 'access_token' in response:
            self.token = response['access_token']
            print(f"   Logged in user: {response['user']['name']}")
            return True
        else:
            self.token = old_token  # Restore token if login failed
            return False

    def test_get_current_user(self):
        """Test getting current user info"""
        success, response = self.run_test(
            "Get Current User",
            "GET",
            "auth/me",
            200
        )
        
        if success:
            print(f"   Current user: {response.get('name')} - {response.get('role')}")
        return success

    def test_create_driver(self):
        """Test creating a driver"""
        driver_data = {
            "name": "João Silva",
            "cpf": "123.456.789-00",
            "phone": "(11) 99999-9999"
        }
        
        success, response = self.run_test(
            "Create Driver",
            "POST",
            "drivers",
            200,
            data=driver_data
        )
        
        if success and 'id' in response:
            self.created_driver_id = response['id']
            print(f"   Created driver: {response['name']} (ID: {self.created_driver_id})")
        return success

    def test_get_drivers(self):
        """Test getting all drivers"""
        success, response = self.run_test(
            "Get Drivers",
            "GET",
            "drivers",
            200
        )
        
        if success:
            print(f"   Found {len(response)} drivers")
        return success

    def test_create_transport_company(self):
        """Test creating a transport company"""
        company_data = {
            "name": "Transportes ABC Ltda",
            "cnpj": "12.345.678/0001-90",
            "phone": "(11) 3333-4444"
        }
        
        success, response = self.run_test(
            "Create Transport Company",
            "POST",
            "transport-companies",
            200,
            data=company_data
        )
        
        if success and 'id' in response:
            self.created_company_id = response['id']
            print(f"   Created company: {response['name']} (ID: {self.created_company_id})")
        return success

    def test_get_transport_companies(self):
        """Test getting all transport companies"""
        success, response = self.run_test(
            "Get Transport Companies",
            "GET",
            "transport-companies",
            200
        )
        
        if success:
            print(f"   Found {len(response)} transport companies")
        return success

    def test_create_movement(self):
        """Test creating a container movement"""
        movement_data = {
            "operation_type": "ENTRADA",
            "driver_name": "João Silva",
            "driver_cpf": "123.456.789-00",
            "truck_plate": "ABC-1234",
            "trailer_plate_1": "XYZ-5678",
            "trailer_plate_2": "DEF-9012",
            "transport_company": "Transportes ABC Ltda",
            "container_number": "ABCD1234567",
            "status": "CHEIO",
            "size_type": "40HC",
            "tare": "3500kg",
            "shipping_line": "Maersk",
            "seal": "SEAL123",
            "genset": "GEN456",
            "booking": "BOOK789"
        }
        
        success, response = self.run_test(
            "Create Container Movement",
            "POST",
            "movements",
            200,
            data=movement_data
        )
        
        if success and 'id' in response:
            self.created_movement_id = response['id']
            print(f"   Created movement: {response['container_number']} - {response['operation_type']} (ID: {self.created_movement_id})")
        return success

    def test_get_movements(self):
        """Test getting all movements"""
        success, response = self.run_test(
            "Get Movements",
            "GET",
            "movements",
            200
        )
        
        if success:
            print(f"   Found {len(response)} movements")
        return success

    def test_get_movements_with_filters(self):
        """Test getting movements with filters"""
        success, response = self.run_test(
            "Get Movements with Filter (ENTRADA)",
            "GET",
            "movements?operation_type=ENTRADA",
            200
        )
        
        if success:
            print(f"   Found {len(response)} ENTRADA movements")
        return success

    def test_get_dashboard_stats(self):
        """Test getting dashboard statistics"""
        success, response = self.run_test(
            "Get Dashboard Stats",
            "GET",
            "dashboard",
            200
        )
        
        if success:
            print(f"   Stats: {response.get('total_movements', 0)} total, {response.get('entries_today', 0)} entries today, {response.get('exits_today', 0)} exits today")
            print(f"   Containers: {response.get('full_containers', 0)} full, {response.get('empty_containers', 0)} empty")
            print(f"   Recent movements: {len(response.get('recent_movements', []))}")
        return success

    def test_pdf_report(self):
        """Test PDF report generation"""
        url = f"{self.base_url}/api/reports/pdf"
        headers = {}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'

        self.tests_run += 1
        print(f"\n🔍 Testing PDF Report Generation...")
        
        try:
            response = requests.get(url, headers=headers)
            success = response.status_code == 200
            
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                print(f"   Content-Type: {response.headers.get('Content-Type')}")
                print(f"   Content-Length: {len(response.content)} bytes")
            else:
                print(f"❌ Failed - Status: {response.status_code}")
            
            return success
            
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False

    def test_excel_report(self):
        """Test Excel report generation"""
        url = f"{self.base_url}/api/reports/excel"
        headers = {}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'

        self.tests_run += 1
        print(f"\n🔍 Testing Excel Report Generation...")
        
        try:
            response = requests.get(url, headers=headers)
            success = response.status_code == 200
            
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                print(f"   Content-Type: {response.headers.get('Content-Type')}")
                print(f"   Content-Length: {len(response.content)} bytes")
            else:
                print(f"❌ Failed - Status: {response.status_code}")
            
            return success
            
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False

    def test_delete_movement(self):
        """Test deleting a movement"""
        if not self.created_movement_id:
            print("❌ Cannot test delete movement - no movement ID available")
            return False
            
        success, response = self.run_test(
            "Delete Movement",
            "DELETE",
            f"movements/{self.created_movement_id}",
            200
        )
        return success

    def test_delete_driver(self):
        """Test deleting a driver"""
        if not self.created_driver_id:
            print("❌ Cannot test delete driver - no driver ID available")
            return False
            
        success, response = self.run_test(
            "Delete Driver",
            "DELETE",
            f"drivers/{self.created_driver_id}",
            200
        )
        return success

    def test_delete_company(self):
        """Test deleting a transport company"""
        if not self.created_company_id:
            print("❌ Cannot test delete company - no company ID available")
            return False
            
        success, response = self.run_test(
            "Delete Transport Company",
            "DELETE",
            f"transport-companies/{self.created_company_id}",
            200
        )
        return success

def main():
    print("🚢 ContainerLogix API Testing Started")
    print("=" * 50)
    
    tester = ContainerLogixAPITester()
    
    # Test sequence
    tests = [
        tester.test_api_root,
        tester.test_register,
        tester.test_login,
        tester.test_get_current_user,
        tester.test_create_driver,
        tester.test_get_drivers,
        tester.test_create_transport_company,
        tester.test_get_transport_companies,
        tester.test_create_movement,
        tester.test_get_movements,
        tester.test_get_movements_with_filters,
        tester.test_get_dashboard_stats,
        tester.test_pdf_report,
        tester.test_excel_report,
        tester.test_delete_movement,
        tester.test_delete_driver,
        tester.test_delete_company
    ]
    
    print(f"Running {len(tests)} API tests...")
    
    for test in tests:
        test()
    
    # Print results
    print("\n" + "=" * 50)
    print(f"📊 Test Results: {tester.tests_passed}/{tester.tests_run} tests passed")
    success_rate = (tester.tests_passed / tester.tests_run * 100) if tester.tests_run > 0 else 0
    print(f"📈 Success Rate: {success_rate:.1f}%")
    
    if tester.tests_passed == tester.tests_run:
        print("🎉 All tests passed!")
        return 0
    else:
        print("⚠️  Some tests failed!")
        return 1

if __name__ == "__main__":
    sys.exit(main())