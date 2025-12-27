"""
Unit tests for strict task extraction guardrails.
Tests the real failing transcript and edge cases.
"""
import sys
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from task_extraction import (
    normalize_title,
    validate_task,
    detect_cancel_intent,
    segment_transcript_fallback,
    validate_and_clean_tasks,
    split_multi_action_title
)


def test_normalize_title():
    """Test title normalization with new lead-in phrases"""
    assert normalize_title("I want to eat something") == "eat something"
    assert normalize_title("I would like to call Tom") == "call Tom"
    assert normalize_title("Today first thing is go to store") == "go to store"
    assert normalize_title("First thing today is work") == "work"
    assert normalize_title("Today I want to eat") == "eat"
    assert normalize_title("Okay, go to store") == "go to store"
    assert normalize_title("Yeah, call mom") == "call mom"
    print("✅ Title normalization test passed")


def test_validate_task_strict():
    """Test strict validation - require action for ALL titles"""
    # Should pass - has action verb
    assert validate_task({"title": "Go to store"})[0] == True
    assert validate_task({"title": "Eat something"})[0] == True
    assert validate_task({"title": "Have a coffee"})[0] == True
    
    # Should fail - no action verb
    assert validate_task({"title": "Tom and Oliver"})[0] == False
    assert validate_task({"title": "Podcast two"})[0] == False
    assert validate_task({"title": "Today first thing"})[0] == False
    
    # Should fail - standalone duration
    assert validate_task({"title": "three hours"})[0] == False
    assert validate_task({"title": "30 minutes"})[0] == False
    assert validate_task({"title": "one hour"})[0] == False
    
    print("✅ Strict validation test passed")


def test_detect_cancel_intent():
    """Test cancellation intent detection"""
    assert detect_cancel_intent("maybe website not") == "website"
    assert detect_cancel_intent("maybe not website") == "website"
    assert detect_cancel_intent("not the website") == "website"
    assert detect_cancel_intent("skip the podcast") == "podcast"
    assert detect_cancel_intent("no website") == "website"
    assert detect_cancel_intent("actually not website") == "website"
    assert detect_cancel_intent("go to store") is None
    print("✅ Cancel intent detection test passed")


def test_filler_only():
    """Test: 'Okay.' => 0 tasks"""
    transcript = "Okay."
    segments = segment_transcript_fallback(transcript)
    
    raw_items = [
        {"title": "Okay", "segment_index": 0, "source_text": "Okay"}
    ]
    
    result = validate_and_clean_tasks(raw_items)
    print(f"\nTest: 'Okay.'")
    print(f"Result: {result['final_count']} tasks")
    
    assert result["final_count"] == 0, f"Expected 0 tasks, got {result['final_count']}"
    print("✅ Filler-only test passed")


def test_duration_fragment():
    """Test: 'three hours. Yeah.' => 0 tasks"""
    transcript = "three hours. Yeah."
    segments = segment_transcript_fallback(transcript)
    
    raw_items = [
        {"title": "three hours", "segment_index": 0, "source_text": "three hours"},
        {"title": "Yeah", "segment_index": 1, "source_text": "Yeah"}
    ]
    
    result = validate_and_clean_tasks(raw_items)
    print(f"\nTest: 'three hours. Yeah.'")
    print(f"Result: {result['final_count']} tasks")
    
    assert result["final_count"] == 0, f"Expected 0 tasks, got {result['final_count']}"
    print("✅ Duration fragment test passed")


def test_cancellation():
    """Test: 'work on the website. maybe website not.' => 0 tasks after cancellation"""
    transcript = "work on the website. maybe website not."
    segments = segment_transcript_fallback(transcript)
    
    raw_items = [
        {"title": "work on the website", "segment_index": 0, "source_text": "work on the website"},
        {"title": "maybe website not", "segment_index": 1, "source_text": "maybe website not"}
    ]
    
    result = validate_and_clean_tasks(raw_items)
    print(f"\nTest: Cancellation")
    print(f"Result: {result['final_count']} tasks")
    for task in result["tasks"]:
        print(f"  - {task['title']}")
    
    assert result["final_count"] == 0, f"Expected 0 tasks (cancelled), got {result['final_count']}"
    print("✅ Cancellation test passed")


def test_main_example():
    """Test: Main failing transcript"""
    transcript = "Okay, today first thing is I want to eat something and have a coffee and I need to go to the police that takes one hour and I need to do laundry that takes 30 minutes. I need to call Roberta, Tom and Oliver or message them. That takes 30 minutes. And work on the podcast and on the website. Podcast two, three hours. Yeah, maybe website not."
    
    print(f"\n{'='*80}")
    print("Test: Main failing transcript")
    print(f"{'='*80}")
    
    # Segment
    segments = segment_transcript_fallback(transcript)
    print(f"\nSegmented into {len(segments)} parts:")
    for i, seg in enumerate(segments[:10]):  # Show first 10
        print(f"  {i}: {seg.get('text', '')[:70]}")
    
    # Simulate AI extraction (what we expect)
    # Note: The AI should ideally normalize these, but we test with raw titles to ensure our normalization works
    raw_items = [
        {"type": "ignore", "title": "Okay", "segment_index": 0, "source_text": "Okay"},
        {"type": "task", "title": "today first thing is I want to eat something", "due_text": "today", "segment_index": 1, "source_text": "today first thing is I want to eat something"},
        {"type": "task", "title": "have a coffee", "segment_index": 1, "source_text": "have a coffee"},
        {"type": "task", "title": "I need to go to the police that takes one hour", "due_text": "today", "segment_index": 1, "source_text": "I need to go to the police that takes one hour"},
        {"type": "task", "title": "I need to do laundry that takes 30 minutes", "segment_index": 1, "source_text": "I need to do laundry that takes 30 minutes"},
        {"type": "task", "title": "I need to call Roberta, Tom and Oliver", "segment_index": 2, "source_text": "I need to call Roberta, Tom and Oliver"},
        {"type": "task", "title": "message them. That takes 30 minutes", "segment_index": 2, "source_text": "message them. That takes 30 minutes"},
        {"type": "task", "title": "work on the podcast and on the website", "segment_index": 3, "source_text": "work on the podcast and on the website"},
        # "Podcast two, three hours" should be interpreted as duration for podcast, not a separate task
        # The AI should ideally attach this to the podcast task, but if it comes as separate, it will be dropped (no action verb)
        # For testing, we'll simulate it being attached to podcast task via duration
        {"type": "task", "title": "work on podcast", "duration_minutes": 180, "notes": "Podcast 2", "segment_index": 3, "source_text": "Podcast two, three hours"},
        {"type": "ignore", "title": "Yeah", "segment_index": 4, "source_text": "Yeah"},
        {"type": "task", "title": "maybe website not", "segment_index": 4, "source_text": "maybe website not"}
    ]
    
    result = validate_and_clean_tasks(raw_items)
    
    print(f"\nResult: {result['final_count']} tasks")
    print(f"Dropped: {len(result['dropped'])} items")
    
    print(f"\nFinal tasks:")
    for task in result["tasks"]:
        title = task['title']
        due = task.get('due_text', '')
        duration = task.get('duration_minutes', '')
        print(f"  - {title}" + (f" (due: {due})" if due else "") + (f" [duration: {duration}]" if duration else ""))
    
    # Expected tasks:
    # - "Eat something" (due: today)
    # - "Have a coffee"
    # - "Go to the police" (due: today, duration: 60)
    # - "Do laundry" (duration: 30)
    # - "Call Roberta" (or split)
    # - "Message Tom and Oliver" (duration: 30) or split
    # - "Work on the podcast" (duration: 180, notes: Podcast 2)
    # - NO website task (cancelled)
    
    titles = [t["title"].lower() for t in result["tasks"]]
    
    # Check required tasks exist
    assert any("eat" in t for t in titles), "Missing 'Eat something'"
    assert any("coffee" in t for t in titles), "Missing 'Have a coffee'"
    assert any("police" in t for t in titles), "Missing 'Go to the police'"
    assert any("laundry" in t for t in titles), "Missing 'Do laundry'"
    assert any("podcast" in t for t in titles), "Missing 'Work on podcast'"
    
    # Check website is NOT present (cancelled)
    assert not any("website" in t for t in titles), "Website task should be cancelled but is present"
    
    # Check no filler
    assert not any(t in ["okay", "yeah"] for t in titles), "Filler items should not be present"
    
    # Check no standalone durations
    assert not any("three hours" in t or "30 minutes" in t for t in titles if len(t.split()) <= 3), "Standalone durations should not be present"
    
    print("\n✅ Main example test passed")


def test_split_with_duration():
    """Test splitting with 'that takes X' pattern"""
    task = {
        "title": "go to the police that takes one hour",
        "segment_index": 0
    }
    
    split = split_multi_action_title(task)
    print(f"\nTest: Split with duration")
    print(f"Input: {task['title']}")
    print(f"Output: {len(split)} tasks")
    for t in split:
        print(f"  - {t['title']} (duration: {t.get('duration_minutes', 'N/A')})")
    
    assert len(split) == 1, "Should not split single action"
    assert split[0].get("duration_minutes") == 60, "Duration should be extracted"
    assert "that takes" not in split[0]["title"].lower(), "Duration phrase should be removed from title"
    
    print("✅ Split with duration test passed")


if __name__ == "__main__":
    print("=" * 80)
    print("Testing Strict Task Extraction Guardrails")
    print("=" * 80)
    
    try:
        test_normalize_title()
        test_validate_task_strict()
        test_detect_cancel_intent()
        test_filler_only()
        test_duration_fragment()
        test_cancellation()
        test_split_with_duration()
        test_main_example()
        
        print("\n" + "=" * 80)
        print("✅ ALL TESTS PASSED")
        print("=" * 80)
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

