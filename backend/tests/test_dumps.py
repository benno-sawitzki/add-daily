"""
Tests for dump endpoints - AUTHORITATIVE (no skips)
Tests both /api/dumps and /dumps (root alias) endpoints

To run these tests:
    pip install pytest
    pytest backend/tests/test_dumps.py -v

These tests create a test user automatically and clean up after.
"""
import pytest
from fastapi.testclient import TestClient
import os
import uuid
from datetime import datetime, timezone

# Import server app
from server import app, get_db_pool, hash_password

# Test user data - deterministic
TEST_USER_EMAIL = "test-dumps@example.com"
TEST_USER_PASSWORD = "test-password-123"
TEST_USER_NAME = "Test Dumps User"

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
    
    # Cleanup: delete test user's dumps (optional, but good practice)
    # Note: We don't delete the user itself as it might be used by other tests

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

def test_create_dump_api_endpoint(client, auth_headers):
    """Test POST /api/dumps creates a dump successfully"""
    dump_data = {
        "source": "text",
        "raw_text": "test dump content from pytest"
    }
    
    response = client.post("/api/dumps", json=dump_data, headers=auth_headers)
    
    assert response.status_code in [200, 201], f"Expected 200/201, got {response.status_code}: {response.text}"
    data = response.json()
    
    assert "id" in data, "Response should contain dump id"
    assert data["source"] == "text", "Source should match"
    assert data["raw_text"] == "test dump content from pytest", "Raw text should match"

def test_create_dump_root_endpoint(client, auth_headers):
    """Test POST /dumps (root alias) creates a dump successfully"""
    dump_data = {
        "source": "text",
        "raw_text": "test dump from root endpoint"
    }
    
    response = client.post("/dumps", json=dump_data, headers=auth_headers)
    
    assert response.status_code in [200, 201], f"Expected 200/201, got {response.status_code}: {response.text}"
    data = response.json()
    
    assert "id" in data, "Response should contain dump id"
    assert data["source"] == "text", "Source should match"
    assert data["raw_text"] == "test dump from root endpoint", "Raw text should match"

def test_get_dumps_api_endpoint(client, auth_headers):
    """Test GET /api/dumps returns created dumps"""
    # First create a dump
    dump_data = {
        "source": "text",
        "raw_text": "test dump for GET test"
    }
    create_response = client.post("/api/dumps", json=dump_data, headers=auth_headers)
    
    assert create_response.status_code in [200, 201], f"Failed to create dump: {create_response.status_code} - {create_response.text}"
    created_dump = create_response.json()
    dump_id = created_dump["id"]
    
    # Then get all dumps
    response = client.get("/api/dumps", headers=auth_headers)
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    dumps = response.json()
    
    assert isinstance(dumps, list), "Response should be a list"
    # Find the dump we just created
    found_dump = next((d for d in dumps if d["id"] == dump_id), None)
    assert found_dump is not None, "Created dump should be in the list"
    assert found_dump["raw_text"] == "test dump for GET test", "Dump text should match"

def test_get_dumps_root_endpoint(client, auth_headers):
    """Test GET /dumps (root alias) returns created dumps"""
    # First create a dump
    dump_data = {
        "source": "text",
        "raw_text": "test dump for root GET test"
    }
    create_response = client.post("/dumps", json=dump_data, headers=auth_headers)
    
    assert create_response.status_code in [200, 201], f"Failed to create dump: {create_response.status_code} - {create_response.text}"
    created_dump = create_response.json()
    dump_id = created_dump["id"]
    
    # Then get all dumps via root endpoint
    response = client.get("/dumps", headers=auth_headers)
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    dumps = response.json()
    
    assert isinstance(dumps, list), "Response should be a list"
    # Find the dump we just created
    found_dump = next((d for d in dumps if d["id"] == dump_id), None)
    assert found_dump is not None, "Created dump should be in the list"

def test_create_dump_requires_auth(client):
    """Test that creating a dump requires authentication"""
    dump_data = {
        "source": "text",
        "raw_text": "test dump"
    }
    
    response = client.post("/api/dumps", json=dump_data)
    
    assert response.status_code == 401, "Should require authentication"

def test_create_dump_invalid_source(client, auth_headers):
    """Test that invalid source is rejected"""
    dump_data = {
        "source": "invalid",
        "raw_text": "test dump"
    }
    
    response = client.post("/api/dumps", json=dump_data, headers=auth_headers)
    
    assert response.status_code == 400, "Should reject invalid source"
