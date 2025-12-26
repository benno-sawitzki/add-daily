#!/bin/bash

# Doctor script - runs health checks and tests
# Usage: ./doctor.sh
# Exits with non-zero code if any check fails or test skips

set -e

echo "🏥 Running Doctor Checks..."
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

FAILED=0

# Check if backend is running
echo "1️⃣  Checking backend health endpoints..."

HEALTH_ROOT=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8010/health || echo "000")
HEALTH_API=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8010/api/health || echo "000")

if [ "$HEALTH_ROOT" = "200" ]; then
    echo -e "${GREEN}✅ GET /health → 200${NC}"
else
    echo -e "${RED}❌ GET /health → $HEALTH_ROOT${NC}"
    echo "   Make sure backend is running on http://localhost:8010"
    FAILED=1
fi

if [ "$HEALTH_API" = "200" ]; then
    echo -e "${GREEN}✅ GET /api/health → 200${NC}"
else
    echo -e "${RED}❌ GET /api/health → $HEALTH_API${NC}"
    FAILED=1
fi

echo ""

# Check if /api/docs is accessible
echo "2️⃣  Checking API documentation..."

DOCS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8010/api/docs || echo "000")
if [ "$DOCS_STATUS" = "200" ]; then
    echo -e "${GREEN}✅ GET /api/docs → 200${NC}"
else
    echo -e "${RED}❌ GET /api/docs → $DOCS_STATUS${NC}"
    FAILED=1
fi

# Check if dumps endpoints exist in OpenAPI spec
echo "3️⃣  Verifying dumps endpoints exist in OpenAPI spec..."
OPENAPI_JSON=$(curl -s http://localhost:8010/api/openapi.json || echo "")
if echo "$OPENAPI_JSON" | grep -q '"/api/dumps"'; then
    echo -e "${GREEN}✅ /api/dumps endpoint found in OpenAPI spec${NC}"
else
    echo -e "${RED}❌ /api/dumps endpoint NOT found in OpenAPI spec${NC}"
    FAILED=1
fi

if echo "$OPENAPI_JSON" | grep -q '"/api/dumps/{dump_id}"'; then
    echo -e "${GREEN}✅ /api/dumps/{dump_id} endpoint found in OpenAPI spec${NC}"
else
    echo -e "${RED}❌ /api/dumps/{dump_id} endpoint NOT found in OpenAPI spec${NC}"
    FAILED=1
fi

if echo "$OPENAPI_JSON" | grep -q '"/api/dumps/{dump_id}/extract"'; then
    echo -e "${GREEN}✅ /api/dumps/{dump_id}/extract endpoint found in OpenAPI spec${NC}"
else
    echo -e "${RED}❌ /api/dumps/{dump_id}/extract endpoint NOT found in OpenAPI spec${NC}"
    FAILED=1
fi

echo ""

# Test POST dump endpoint (will fail auth, but route should work)
echo "4️⃣  Testing dump endpoint routes (should return 401 without auth)..."

DUMP_API=$(curl -s -X POST http://localhost:8010/api/dumps \
    -H "Content-Type: application/json" \
    -d '{"source":"text","raw_text":"test"}' \
    -o /dev/null -w "%{http_code}" || echo "000")

# Should return 401 (unauthorized) which means the route works
if [ "$DUMP_API" = "401" ]; then
    echo -e "${GREEN}✅ POST /api/dumps → 401 (route exists, auth required)${NC}"
elif [ "$DUMP_API" = "400" ]; then
    echo -e "${YELLOW}⚠️  POST /api/dumps → 400 (route exists but validation failed)${NC}"
elif [ "$DUMP_API" = "201" ] || [ "$DUMP_API" = "200" ]; then
    echo -e "${GREEN}✅ POST /api/dumps → $DUMP_API (route works)${NC}"
else
    echo -e "${RED}❌ POST /api/dumps → $DUMP_API (route may not exist)${NC}"
    FAILED=1
fi

# If AUTH_TOKEN is set, test creating a dump
if [ -n "$AUTH_TOKEN" ]; then
    echo ""
    echo "5️⃣  Testing dump creation with auth token..."
    
    CREATE_RESPONSE=$(curl -s -X POST http://localhost:8010/api/dumps \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        -d '{"source":"text","raw_text":"doctor test dump"}' || echo "")
    
    CREATE_STATUS=$(echo "$CREATE_RESPONSE" | python3 -c "import sys, json; data = json.load(sys.stdin) if sys.stdin.read() else {}; print(data.get('id', 'NO_ID'))" 2>/dev/null || echo "ERROR")
    
    if [ "$CREATE_STATUS" != "ERROR" ] && [ "$CREATE_STATUS" != "NO_ID" ]; then
        echo -e "${GREEN}✅ Created dump with ID: $CREATE_STATUS${NC}"
        
        # Test listing dumps
        LIST_RESPONSE=$(curl -s -X GET http://localhost:8010/api/dumps \
            -H "Authorization: Bearer $AUTH_TOKEN" || echo "")
        
        if echo "$LIST_RESPONSE" | python3 -c "import sys, json; data = json.load(sys.stdin); print('OK' if isinstance(data, list) else 'NOT_LIST')" 2>/dev/null | grep -q "OK"; then
            echo -e "${GREEN}✅ GET /api/dumps returns list${NC}"
        else
            echo -e "${RED}❌ GET /api/dumps did not return a list${NC}"
            FAILED=1
        fi
    else
        echo -e "${RED}❌ Failed to create dump with auth token${NC}"
        FAILED=1
    fi
else
    echo ""
    echo "5️⃣  Skipping authenticated dump test (AUTH_TOKEN not set)"
fi

echo ""

# Test CORS preflight for /api/dumps
echo "6️⃣  Testing CORS preflight for /api/dumps..."

CORS_RESPONSE=$(curl -i -X OPTIONS \
    -H "Origin: http://localhost:3000" \
    -H "Access-Control-Request-Method: POST" \
    http://localhost:8010/api/dumps 2>&1 || echo "")

if echo "$CORS_RESPONSE" | grep -qi "access-control-allow-origin"; then
    echo -e "${GREEN}✅ PASS: CORS headers present in /api/dumps preflight response${NC}"
else
    echo -e "${RED}❌ FAIL: CORS headers missing in /api/dumps preflight response${NC}"
    echo "   Expected: access-control-allow-origin header"
    echo "   Response:"
    echo "$CORS_RESPONSE" | head -20
    FAILED=1
fi

echo ""

# Run backend tests
echo "7️⃣  Running backend tests..."
cd backend
if command -v pytest &> /dev/null; then
    # Run pytest and capture output (don't fail on error yet, we need to check for skips)
    set +e
    TEST_OUTPUT=$(pytest tests/test_dumps.py -v --tb=short 2>&1)
    TEST_EXIT_CODE=$?
    set -e
    
    # Check for skips in output (must check before exit code)
    if echo "$TEST_OUTPUT" | grep -qi "SKIPPED\|SKIP\|skip"; then
        echo -e "${RED}❌ Backend tests contain SKIPS (not allowed)${NC}"
        echo "$TEST_OUTPUT" | grep -i "skip" || true
        FAILED=1
    fi
    
    # Check exit code
    if [ $TEST_EXIT_CODE -ne 0 ]; then
        echo -e "${RED}❌ Backend tests failed${NC}"
        echo "$TEST_OUTPUT"
        FAILED=1
    else
        echo -e "${GREEN}✅ Backend tests passed (no skips)${NC}"
    fi
else
    echo -e "${RED}❌ pytest not found. Install with: pip install pytest${NC}"
    FAILED=1
fi
cd ..

echo ""

# Run frontend E2E tests
echo "8️⃣  Running frontend E2E tests..."
cd frontend
if [ -d "node_modules/@playwright" ]; then
    # Run Playwright and capture output (don't fail on error yet, we need to check for skips)
    set +e
    E2E_OUTPUT=$(npm run test:e2e 2>&1)
    E2E_EXIT_CODE=$?
    set -e
    
    # Check for skips in output (must check before exit code)
    if echo "$E2E_OUTPUT" | grep -qi "skip\|skipped"; then
        echo -e "${RED}❌ E2E tests contain SKIPS (not allowed)${NC}"
        echo "$E2E_OUTPUT" | grep -i "skip" || true
        FAILED=1
    fi
    
    # Check exit code
    if [ $E2E_EXIT_CODE -ne 0 ]; then
        echo -e "${RED}❌ E2E tests failed${NC}"
        echo "$E2E_OUTPUT"
        FAILED=1
    elif echo "$E2E_OUTPUT" | grep -qi "passed\|PASS"; then
        echo -e "${GREEN}✅ E2E tests passed (no skips)${NC}"
    fi
else
    echo -e "${RED}❌ Playwright not installed. Run: npm install${NC}"
    FAILED=1
fi
cd ..

echo ""

# Final summary
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All checks passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some checks failed or tests were skipped${NC}"
    exit 1
fi
