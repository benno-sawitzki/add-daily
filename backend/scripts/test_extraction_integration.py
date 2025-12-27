#!/usr/bin/env python3
"""
Integration test for extraction that calls the actual API endpoint.
Compares expected vs actual items and reports differences.
"""
import os
import sys
import asyncio
import json
from pathlib import Path
from dotenv import load_dotenv

# Add backend to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

# Load environment variables
env_path = backend_dir / '.env'
if env_path.exists():
    load_dotenv(env_path)

# Test configuration
BASE_URL = os.environ.get("TEST_BASE_URL", "http://localhost:8000")
TEST_USER_ID = "test-user-123"  # You may need to adjust this

# Test cases
TEST_CASES = [
    {
        "name": "exact_problematic_text",
        "raw_text": "Does this actually work here? So today I want to, should I go to the police? I don't know. Go to police. Oliver, Roberta, call Oliver and Roberta or write them per WhatsApp and work on podcast",
        "transcript": "Does this actually work here? So today I want to, should I go to the police? I don't know. Go to police. Oliver, Roberta, call Oliver and Roberta or write them per WhatsApp and work on podcast",
        "expected_items": [
            "Go to police",
            "call Oliver and Roberta",
            "write them per WhatsApp",
            "work on podcast"
        ]
    }
]

async def test_extraction_via_api(test_case):
    """Test extraction via the actual API endpoint."""
    import aiohttp
    
    print(f"\n{'='*80}")
    print(f"Testing: {test_case['name']}")
    print(f"{'='*80}")
    
    # Create a dump first
    async with aiohttp.ClientSession() as session:
        # Create dump
        dump_data = {
            "source": "text",
            "raw_text": test_case["raw_text"],
            "transcript": test_case.get("transcript", test_case["raw_text"])
        }
        
        # Note: This assumes you have authentication set up
        # You may need to adjust headers/auth
        headers = {
            "Content-Type": "application/json"
        }
        
        try:
            # Create dump
            async with session.post(
                f"{BASE_URL}/api/dumps",
                json=dump_data,
                headers=headers
            ) as resp:
                if resp.status != 200:
                    print(f"❌ Failed to create dump: {resp.status}")
                    text = await resp.text()
                    print(f"   Response: {text[:200]}")
                    return False
                
                dump = await resp.json()
                dump_id = dump.get("id")
                print(f"✓ Created dump: {dump_id}")
            
            # Extract items
            async with session.post(
                f"{BASE_URL}/api/dumps/{dump_id}/extract",
                headers=headers
            ) as resp:
                if resp.status != 200:
                    print(f"❌ Failed to extract: {resp.status}")
                    text = await resp.text()
                    print(f"   Response: {text[:200]}")
                    return False
                
                result = await resp.json()
                items = result.get("items", [])
                print(f"✓ Extraction completed: {len(items)} items")
            
            # Compare results
            print(f"\nExpected items: {len(test_case['expected_items'])}")
            for i, exp in enumerate(test_case['expected_items'], 1):
                print(f"  {i}. {exp}")
            
            print(f"\nActual items: {len(items)}")
            actual_titles = []
            for i, item in enumerate(items, 1):
                title = item.get("text", "") or item.get("title", "")
                actual_titles.append(title.lower().strip())
                print(f"  {i}. {title}")
            
            # Check matches
            print(f"\nComparison:")
            expected_titles = [exp.lower().strip() for exp in test_case['expected_items']]
            matches = 0
            for exp in expected_titles:
                found = any(exp in actual or actual in exp for actual in actual_titles)
                status = "✓" if found else "✗"
                print(f"  {status} {exp}")
                if found:
                    matches += 1
            
            success = matches == len(test_case['expected_items']) and len(items) >= len(test_case['expected_items'])
            if success:
                print(f"\n✓ Test PASSED: All {matches}/{len(test_case['expected_items'])} expected items found")
            else:
                print(f"\n✗ Test FAILED: Only {matches}/{len(test_case['expected_items'])} expected items found")
                print(f"   Got {len(items)} items, expected at least {len(test_case['expected_items'])}")
            
            return success
            
        except Exception as e:
            print(f"❌ Error: {e}")
            import traceback
            traceback.print_exc()
            return False

async def main():
    print("=" * 80)
    print("EXTRACTION INTEGRATION TEST")
    print("=" * 80)
    print(f"Base URL: {BASE_URL}")
    print(f"Test cases: {len(TEST_CASES)}")
    
    results = []
    for test_case in TEST_CASES:
        result = await test_extraction_via_api(test_case)
        results.append((test_case['name'], result))
    
    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    passed = sum(1 for _, result in results if result)
    total = len(results)
    print(f"Passed: {passed}/{total}")
    
    for name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"  {status}: {name}")
    
    if passed == total:
        print("\n✓ All tests passed!")
        return 0
    else:
        print(f"\n✗ {total - passed} test(s) failed")
        return 1

if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)







