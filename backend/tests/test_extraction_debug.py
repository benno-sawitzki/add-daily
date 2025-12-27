"""
Test cases for extraction debugging and edge cases.
"""
import pytest
import asyncio
from server import extract_dump_items_from_transcript
from task_extraction import segment_transcript_fallback, validate_task, normalize_title

# Test cases
TEST_CASES = [
    {
        "name": "exact_problematic_text",
        "transcript": "Does this actually work here? So today I want to, should I go to the police? I don't know. Go to police. Oliver, Roberta, call Oliver and Roberta or write them per WhatsApp and work on podcast",
        "expected_items": [
            "Go to police",
            "call Oliver and Roberta",
            "write them per WhatsApp",
            "work on podcast"
        ]
    },
    {
        "name": "or_pattern",
        "transcript": "call Tom or write him an email",
        "expected_items": [
            "call Tom",
            "write him an email"
        ]
    },
    {
        "name": "and_pattern",
        "transcript": "work on website and call the client",
        "expected_items": [
            "work on website",
            "call the client"
        ]
    },
    {
        "name": "nested_or_and",
        "transcript": "call Alice or message Bob and work on project",
        "expected_items": [
            "call Alice",
            "message Bob",
            "work on project"
        ]
    },
    {
        "name": "multiple_segments",
        "transcript": "Go to the store. Buy groceries. Call mom and dad.",
        "expected_items": [
            "Go to the store",
            "Buy groceries",
            "Call mom and dad"
        ]
    },
    {
        "name": "call_multiple_names",
        "transcript": "call Tom, Alice and Bob",
        "expected_items": [
            "call Tom",
            "call Alice",
            "call Bob"
        ]
    }
]

@pytest.mark.asyncio
async def test_exact_problematic_text():
    """Test the exact problematic text that's failing."""
    test_case = TEST_CASES[0]
    result = await extract_dump_items_from_transcript(
        transcript=test_case["transcript"],
        provider="openai",
        model="gpt-4o-mini",
        whisper_segments=None,
        trace_id="test-exact-problematic"
    )
    
    items = result.get("items", [])
    item_titles = [item.get("text", "").lower().strip() for item in items]
    expected_titles = [exp.lower().strip() for exp in test_case["expected_items"]]
    
    # Check that we got at least the expected number of items
    assert len(items) >= len(test_case["expected_items"]), \
        f"Expected at least {len(test_case['expected_items'])} items, got {len(items)}"
    
    # Check that each expected item is present (fuzzy match)
    for expected in expected_titles:
        found = any(expected in actual or actual in expected for actual in item_titles)
        assert found, f"Expected item '{expected}' not found in {item_titles}"

@pytest.mark.asyncio
async def test_or_pattern():
    """Test 'or' pattern extraction."""
    test_case = TEST_CASES[1]
    result = await extract_dump_items_from_transcript(
        transcript=test_case["transcript"],
        provider="openai",
        model="gpt-4o-mini",
        whisper_segments=None,
        trace_id="test-or-pattern"
    )
    
    items = result.get("items", [])
    assert len(items) >= 2, f"Expected at least 2 items for 'or' pattern, got {len(items)}"

@pytest.mark.asyncio
async def test_and_pattern():
    """Test 'and' pattern extraction."""
    test_case = TEST_CASES[2]
    result = await extract_dump_items_from_transcript(
        transcript=test_case["transcript"],
        provider="openai",
        model="gpt-4o-mini",
        whisper_segments=None,
        trace_id="test-and-pattern"
    )
    
    items = result.get("items", [])
    assert len(items) >= 2, f"Expected at least 2 items for 'and' pattern, got {len(items)}"

def test_segmentation():
    """Test that segmentation works correctly."""
    transcript = "Go to police. call Oliver and Roberta or write them per WhatsApp and work on podcast"
    segments = segment_transcript_fallback(transcript)
    
    assert len(segments) >= 2, f"Expected at least 2 segments, got {len(segments)}"
    
    # Check that segment 2 contains the problematic text
    segment_2 = next((s for s in segments if s.get('i') == 2), None)
    if segment_2:
        text = segment_2.get('text', '').lower()
        assert 'call' in text or 'write' in text or 'work' in text, \
            f"Segment 2 should contain action verbs, got: {segment_2.get('text', '')}"

def test_validation():
    """Test that expected items pass validation."""
    expected_items = [
        "Go to police",
        "call Oliver and Roberta",
        "write them per WhatsApp",
        "work on podcast"
    ]
    
    for expected in expected_items:
        normalized = normalize_title(expected)
        is_valid, error = validate_task({"title": normalized})
        assert is_valid, f"'{expected}' -> '{normalized}' failed validation: {error}"

def test_normalization():
    """Test that normalization works correctly."""
    test_cases = [
        ("call Oliver and Roberta", "call Oliver and Roberta"),
        ("write them per WhatsApp", "write them per WhatsApp"),
        ("work on podcast", "work on podcast"),
    ]
    
    for input_text, expected in test_cases:
        normalized = normalize_title(input_text)
        assert normalized == expected, f"Normalization failed: '{input_text}' -> '{normalized}', expected '{expected}'"

if __name__ == "__main__":
    pytest.main([__file__, "-v"])




