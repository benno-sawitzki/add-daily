"""
Unit tests for segmentation-first task extraction.
"""
import sys
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from task_extraction import (
    segment_transcript,
    is_filler_segment,
    validate_and_clean_tasks,
    normalize_title,
    split_multi_action_title
)


def test_segmentation():
    """Test transcript segmentation"""
    transcript = "Go to the police today, then I need to get back to Tom, get back to Oliver and work on a website for two hours."
    segments = segment_transcript(transcript)
    print(f"Segments: {segments}")
    assert len(segments) > 0
    assert "Go to the police today" in " ".join(segments) or any("police" in s for s in segments)


def test_filler_detection():
    """Test A) 'Okay.' -> 0 tasks"""
    transcript = "Okay."
    segments = segment_transcript(transcript)
    print(f"Segments for 'Okay.': {segments}")
    
    # Should be empty or only filler
    assert len(segments) == 0 or all(is_filler_segment(s) for s in segments)
    
    # Simulate AI returning filler as task (should be dropped)
    raw_tasks = [{"title": "Okay", "segment_index": 0}]
    result = validate_and_clean_tasks(raw_tasks)
    assert result["final_count"] == 0, f"Expected 0 tasks, got {result['final_count']}"


def test_example_transcript():
    """Test B) Main example transcript"""
    transcript = "Go to the police today, then I need to get back to Tom, get back to Oliver and work on a website for two hours."
    
    segments = segment_transcript(transcript)
    print(f"\nSegments: {segments}")
    
    # Simulate AI extraction (what we expect)
    raw_tasks = [
        {"title": "Go to the police", "due_text": "today", "segment_index": 0, "source_text": "Go to the police today"},
        {"title": "Get back to Tom", "segment_index": 1, "source_text": "get back to Tom"},
        {"title": "Get back to Oliver", "segment_index": 1, "source_text": "get back to Oliver"},
        {"title": "Work on a website", "duration_minutes": 120, "segment_index": 1, "source_text": "work on a website for two hours"}
    ]
    
    result = validate_and_clean_tasks(raw_tasks)
    
    print(f"\nResult: {result['final_count']} tasks")
    for task in result["tasks"]:
        print(f"  - {task['title']} (due: {task.get('due_text', 'N/A')}, duration: {task.get('duration_minutes', 'N/A')})")
    
    assert result["final_count"] >= 4, f"Expected at least 4 tasks, got {result['final_count']}"
    
    titles = [t["title"] for t in result["tasks"]]
    assert "Go to the police" in titles or any("police" in t.lower() for t in titles)
    assert "Reply to Tom" in titles or "Get back to Tom" in titles
    assert "Reply to Oliver" in titles or "Get back to Oliver" in titles
    assert "Work on a website" in titles or any("website" in t.lower() for t in titles)


def test_multi_action_split():
    """Test C) Multi-action title splitting"""
    transcript = "do laundry and have a coffee and go to lunch at 12"
    
    segments = segment_transcript(transcript)
    print(f"\nSegments: {segments}")
    
    # Simulate AI returning one task with multiple actions
    raw_tasks = [{
        "title": "do laundry and have a coffee and go to lunch at 12",
        "segment_index": 0,
        "source_text": transcript
    }]
    
    result = validate_and_clean_tasks(raw_tasks)
    
    print(f"\nResult: {result['final_count']} tasks after splitting")
    for task in result["tasks"]:
        print(f"  - {task['title']} (due: {task.get('due_text', 'N/A')})")
    
    assert result["final_count"] >= 3, f"Expected at least 3 tasks after splitting, got {result['final_count']}"
    
    titles = [t["title"].lower() for t in result["tasks"]]
    assert any("laundry" in t for t in titles)
    assert any("coffee" in t for t in titles)
    assert any("lunch" in t for t in titles)


def test_name_only_fragment():
    """Test D) Name-only fragment should be dropped"""
    transcript = "Roberta and Oliver that takes 30 minutes"
    
    segments = segment_transcript(transcript)
    print(f"\nSegments: {segments}")
    
    # Simulate AI returning name-only task (should be dropped)
    raw_tasks = [{
        "title": "Roberta and Oliver",
        "duration_minutes": 30,
        "segment_index": 0,
        "source_text": transcript
    }]
    
    result = validate_and_clean_tasks(raw_tasks)
    
    print(f"\nResult: {result['final_count']} tasks (should be 0)")
    print(f"Dropped: {len(result['dropped'])}")
    
    assert result["final_count"] == 0, f"Expected 0 tasks (name-only fragment), got {result['final_count']}"


def test_normalize_title():
    """Test title normalization"""
    assert normalize_title("I need to go to the store") == "go to the store"
    assert normalize_title("I have to call Tom.") == "call Tom"
    assert normalize_title("Do laundry  and  clean") == "Do laundry and clean"
    assert normalize_title("Task name!!!") == "Task name"


def test_split_multi_action():
    """Test splitting multi-action titles"""
    task = {
        "title": "Do laundry and have a coffee and go to lunch at 12",
        "segment_index": 0
    }
    
    split = split_multi_action_title(task)
    print(f"\nSplit result: {len(split)} tasks")
    for t in split:
        print(f"  - {t['title']}")
    
    assert len(split) >= 3
    titles = [t["title"].lower() for t in split]
    assert any("laundry" in t for t in titles)
    assert any("coffee" in t for t in titles)
    assert any("lunch" in t for t in titles)


if __name__ == "__main__":
    print("=" * 80)
    print("Testing Segmentation-First Extraction")
    print("=" * 80)
    
    try:
        test_segmentation()
        print("✅ Segmentation test passed")
        
        test_filler_detection()
        print("✅ Filler detection test passed")
        
        test_example_transcript()
        print("✅ Example transcript test passed")
        
        test_multi_action_split()
        print("✅ Multi-action split test passed")
        
        test_name_only_fragment()
        print("✅ Name-only fragment test passed")
        
        test_normalize_title()
        print("✅ Title normalization test passed")
        
        test_split_multi_action()
        print("✅ Split multi-action test passed")
        
        print("\n" + "=" * 80)
        print("✅ ALL TESTS PASSED")
        print("=" * 80)
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)









