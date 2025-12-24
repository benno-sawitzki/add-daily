import requests
import sys
import json
from datetime import datetime

class TaskFlowAPITester:
    def __init__(self, base_url="https://tasksorter-1.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def log_test(self, name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
        
        result = {
            "test": name,
            "success": success,
            "details": details,
            "timestamp": datetime.now().isoformat()
        }
        self.test_results.append(result)
        
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} - {name}")
        if details:
            print(f"    Details: {details}")

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.api_url}/{endpoint}"
        if headers is None:
            headers = {'Content-Type': 'application/json'}

        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)
            elif method == 'PATCH':
                response = requests.patch(url, json=data, headers=headers, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=10)

            success = response.status_code == expected_status
            details = f"Status: {response.status_code}, Expected: {expected_status}"
            
            if not success:
                try:
                    error_detail = response.json()
                    details += f", Response: {error_detail}"
                except:
                    details += f", Response: {response.text[:200]}"
            
            self.log_test(name, success, details)
            
            if success:
                try:
                    return True, response.json()
                except:
                    return True, response.text
            else:
                return False, {}

        except Exception as e:
            self.log_test(name, False, f"Exception: {str(e)}")
            return False, {}

    def test_health_endpoints(self):
        """Test basic health endpoints"""
        print("\n🔍 Testing Health Endpoints...")
        
        # Test root endpoint
        self.run_test("Root Endpoint", "GET", "", 200)
        
        # Test health endpoint
        self.run_test("Health Check", "GET", "health", 200)

    def test_task_crud(self):
        """Test task CRUD operations"""
        print("\n🔍 Testing Task CRUD Operations...")
        
        # Test get all tasks (empty initially)
        success, tasks = self.run_test("Get All Tasks", "GET", "tasks", 200)
        
        # Test create task
        task_data = {
            "title": "Test Task",
            "description": "This is a test task",
            "priority": 3,
            "urgency": 2,
            "importance": 4
        }
        success, created_task = self.run_test("Create Task", "POST", "tasks", 200, task_data)
        
        if success and created_task:
            task_id = created_task.get('id')
            
            # Test get specific task
            self.run_test("Get Specific Task", "GET", f"tasks/{task_id}", 200)
            
            # Test update task
            update_data = {
                "title": "Updated Test Task",
                "status": "scheduled",
                "scheduled_date": "2025-01-15"
            }
            self.run_test("Update Task", "PATCH", f"tasks/{task_id}", 200, update_data)
            
            # Test get tasks with status filter
            self.run_test("Get Scheduled Tasks", "GET", "tasks?status=scheduled", 200)
            
            # Test delete task
            self.run_test("Delete Task", "DELETE", f"tasks/{task_id}", 200)
            
            # Verify task is deleted
            self.run_test("Verify Task Deleted", "GET", f"tasks/{task_id}", 404)
        else:
            self.log_test("Skipped Task Operations", False, "Task creation failed")

    def test_voice_processing(self):
        """Test voice processing endpoint"""
        print("\n🔍 Testing Voice Processing...")
        
        voice_data = {
            "transcript": "I need to call the dentist tomorrow, it's urgent. Also buy groceries this weekend.",
            "model": "gpt-5.2",
            "provider": "openai"
        }
        
        success, result = self.run_test("Process Voice Input", "POST", "tasks/process-voice", 200, voice_data)
        
        if success:
            # Check if tasks were created
            success, tasks = self.run_test("Verify Voice Tasks Created", "GET", "tasks", 200)
            if success and tasks:
                voice_tasks = [t for t in tasks if "dentist" in t.get("title", "").lower() or "groceries" in t.get("title", "").lower()]
                if voice_tasks:
                    self.log_test("Voice Tasks Found in Database", True, f"Found {len(voice_tasks)} tasks")
                else:
                    self.log_test("Voice Tasks Found in Database", False, "No voice-generated tasks found")

    def test_settings(self):
        """Test settings endpoints"""
        print("\n🔍 Testing Settings...")
        
        # Test get settings
        success, settings = self.run_test("Get Settings", "GET", "settings", 200)
        
        # Test update settings
        new_settings = {
            "ai_provider": "gemini",
            "ai_model": "gemini-3-flash-preview"
        }
        self.run_test("Update Settings", "PATCH", "settings", 200, new_settings)
        
        # Verify settings updated
        success, updated_settings = self.run_test("Verify Settings Updated", "GET", "settings", 200)
        if success and updated_settings:
            if updated_settings.get("ai_provider") == "gemini":
                self.log_test("Settings Provider Updated", True)
            else:
                self.log_test("Settings Provider Updated", False, f"Expected gemini, got {updated_settings.get('ai_provider')}")

    def test_error_handling(self):
        """Test error handling"""
        print("\n🔍 Testing Error Handling...")
        
        # Test invalid task ID
        self.run_test("Invalid Task ID", "GET", "tasks/invalid-id", 404)
        
        # Test invalid endpoint
        self.run_test("Invalid Endpoint", "GET", "invalid-endpoint", 404)
        
        # Test empty task creation
        self.run_test("Empty Task Creation", "POST", "tasks", 422, {})

    def run_all_tests(self):
        """Run all tests"""
        print("🚀 Starting TaskFlow API Tests...")
        print(f"Testing against: {self.api_url}")
        
        self.test_health_endpoints()
        self.test_task_crud()
        self.test_voice_processing()
        self.test_settings()
        self.test_error_handling()
        
        # Print summary
        print(f"\n📊 Test Summary:")
        print(f"Tests Run: {self.tests_run}")
        print(f"Tests Passed: {self.tests_passed}")
        print(f"Tests Failed: {self.tests_run - self.tests_passed}")
        print(f"Success Rate: {(self.tests_passed/self.tests_run)*100:.1f}%")
        
        return self.tests_passed == self.tests_run

def main():
    tester = TaskFlowAPITester()
    success = tester.run_all_tests()
    
    # Save detailed results
    with open('/app/backend_test_results.json', 'w') as f:
        json.dump({
            'summary': {
                'tests_run': tester.tests_run,
                'tests_passed': tester.tests_passed,
                'success_rate': (tester.tests_passed/tester.tests_run)*100 if tester.tests_run > 0 else 0
            },
            'results': tester.test_results
        }, f, indent=2)
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())