"""
Tests for dump auto_extract and promote flow.

To run these tests:
    cd backend
    pip install pytest pytest-asyncio
    pytest tests/test_dump_promote_flow.py -v
"""
import pytest
from fastapi.testclient import TestClient
import os

# Import server app
from server import app, get_db_pool

# Test user data
TEST_USER_EMAIL = "test-promote@example.com"
TEST_USER_PASSWORD = "test-password-123"
TEST_USER_NAME = "Test Promote User"

@pytest.fixture(scope="module")
def client():
    """Create a test client"""
    return TestClient(app)

@pytest.fixture(scope="module")
def test_user_id(client):
    """Create a test user and return user_id. Clean up after all tests."""
    # Create test user via signup endpoint
    signup_data = {
        "email": TEST_USER_EMAIL,
        "password": TEST_USER_PASSWORD,
        "name": TEST_USER_NAME
    }
    
    # Try to sign up (may fail if user exists)
    signup_response = client.post("/api/auth/signup", json=signup_data)
    
    if signup_response.status_code == 400 and "already registered" in signup_response.json().get("detail", ""):
        # User exists, try to login instead
        login_response = client.post("/api/auth/login", json={
            "email": TEST_USER_EMAIL,
            "password": TEST_USER_PASSWORD
        })
        if login_response.status_code != 200:
            pytest.fail(f"Test user exists but login failed: {login_response.status_code} - {login_response.text}")
        user_id = login_response.json()["user"]["id"]
    elif signup_response.status_code in [200, 201]:
        user_id = signup_response.json()["user"]["id"]
    else:
        pytest.fail(f"Failed to create test user: {signup_response.status_code} - {signup_response.text}")
    
    yield user_id

@pytest.fixture(scope="module")
def auth_token(client, test_user_id):
    """Get auth token for test user"""
    login_response = client.post("/api/auth/login", json={
        "email": TEST_USER_EMAIL,
        "password": TEST_USER_PASSWORD
    })
    
    if login_response.status_code != 200:
        pytest.fail(f"Failed to login test user: {login_response.status_code} - {login_response.text}")
    
    return login_response.json()["token"]

@pytest.fixture
def auth_headers(auth_token):
    """Create authorization headers with test token"""
    return {"Authorization": f"Bearer {auth_token}"}

def test_create_dump_with_auto_extract(client, auth_headers):
    """Test POST /api/dumps?auto_extract=1 creates dump with items"""
    dump_data = {
        "source": "text",
        "raw_text": "go home, do task 1, buy groceries"
    }
    
    response = client.post("/api/dumps?auto_extract=1", json=dump_data, headers=auth_headers)
    
    assert response.status_code in [200, 201], f"Expected 200/201, got {response.status_code}: {response.text}"
    data = response.json()
    
    assert "id" in data, "Response should contain dump id"
    assert "items" in data, "Response should contain items array"
    assert len(data["items"]) > 0, "Items array should have length > 0"
    
    # Verify items have expected structure
    first_item = data["items"][0]
    assert "id" in first_item, "Item should have id"
    assert "text" in first_item, "Item should have text"
    assert first_item["status"] == "new", "Item status should be 'new'"
    
    return data  # Return for use in next test

def test_promote_first_item_to_inbox(client, auth_headers, test_user_id):
    """Test promoting first item creates task and updates item status"""
    # First create a dump with auto_extract
    dump_data = {
        "source": "text",
        "raw_text": "go home, do task 1, buy groceries"
    }
    
    create_response = client.post("/api/dumps?auto_extract=1", json=dump_data, headers=auth_headers)
    assert create_response.status_code in [200, 201]
    dump_data = create_response.json()
    
    assert len(dump_data["items"]) > 0, "Should have items to promote"
    first_item_id = dump_data["items"][0]["id"]
    
    # Promote first item to inbox
    promote_data = {
        "target": "inbox"
    }
    
    promote_response = client.post(
        f"/api/dump-items/{first_item_id}/promote",
        json=promote_data,
        headers=auth_headers
    )
    
    assert promote_response.status_code in [200, 201], f"Expected 200/201, got {promote_response.status_code}: {promote_response.text}"
    task_data = promote_response.json()
    
    # Assert task was created
    assert "id" in task_data, "Task should have id"
    assert task_data["status"] == "inbox", "Task status should be 'inbox'"
    assert task_data["title"] == dump_data["items"][0]["text"], "Task title should match item text"
    
    # Assert item status is 'promoted' and created_task_id is set
    # Get the dump again to verify item was updated
    dump_id = dump_data["id"]
    get_dump_response = client.get(f"/api/dumps/{dump_id}", headers=auth_headers)
    assert get_dump_response.status_code == 200
    updated_dump = get_dump_response.json()
    
    # Find the promoted item
    promoted_item = next((item for item in updated_dump["items"] if item["id"] == first_item_id), None)
    assert promoted_item is not None, "Item should still exist in dump"
    assert promoted_item["status"] == "promoted", f"Item status should be 'promoted', got '{promoted_item['status']}'"
    assert promoted_item["created_task_id"] == task_data["id"], "Item should have created_task_id set to task id"

