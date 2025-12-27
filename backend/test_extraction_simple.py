#!/usr/bin/env python3
"""
Simple test script for task extraction (no pytest required).
"""
import sys
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from task_extraction import preprocess_transcript, validate_task, postprocess_tasks

def test_example():
    """Test the main example transcript"""
    transcript = "Go to the police today, then I need to get back to Tom, get back to Oliver and work on a website for two hours."
    
    print("=" * 80)
    print("TEST: Example Transcript")
    print("=" * 80)
    print(f"Input: {transcript}\n")
    
    # Preprocess
    preprocessed = preprocess_transcript(transcript)
    print(f"Preprocessed: {preprocessed}\n")
    
    # Simulate AI extraction (what we expect)
    raw_tasks = [
        {"title": "Go to the police", "due_text": "today", "source_text": "Go to the police today"},
        {"title": "Get back to Tom", "source_text": "get back to Tom"},
        {"title": "Get back to Oliver", "source_text": "get back to Oliver"},
        {"title": "Work on a website", "duration_minutes": 120, "source_text": "work on a website for two hours"}
    ]
    
    print(f"Raw AI tasks: {len(raw_tasks)}")
    for i, task in enumerate(raw_tasks, 1):
        print(f"  {i}. {task['title']} (due: {task.get('due_text', 'N/A')}, duration: {task.get('duration_minutes', 'N/A')})")
    print()
    
    # Post-process
    result = postprocess_tasks(raw_tasks, transcript)
    
    print(f"Post-processing results:")
    print(f"  Raw count: {result['raw_count']}")
    print(f"  Final count: {result['final_count']}")
    print(f"  Dropped: {len(result['dropped'])}")
    
    if result['dropped']:
        print("\n  Dropped tasks:")
        for dropped in result['dropped']:
            print(f"    - {dropped['task'].get('title', 'N/A')}: {dropped['reason']}")
    
    print(f"\n  Valid tasks ({len(result['tasks'])}):")
    for i, task in enumerate(result['tasks'], 1):
        print(f"    {i}. {task['title']}")
        if task.get('due_text'):
            print(f"       Due: {task['due_text']}")
        if task.get('duration_minutes'):
            print(f"       Duration: {task['duration_minutes']} minutes")
        if task.get('source_text'):
            print(f"       Source: {task['source_text']}")
    
    # Validation
    assert result['final_count'] == 4, f"Expected 4 tasks, got {result['final_count']}"
    assert len(result['dropped']) == 0, f"Expected 0 dropped tasks, got {len(result['dropped'])}"
    
    titles = [t['title'] for t in result['tasks']]
    assert "Go to the police" in titles
    assert "Get back to Tom" in titles
    assert "Get back to Oliver" in titles
    assert "Work on a website" in titles
    
    print("\n✅ All assertions passed!")
    return True

def test_filters_fragments():
    """Test that fragments are filtered out"""
    print("\n" + "=" * 80)
    print("TEST: Filter Fragments")
    print("=" * 80)
    
    raw_tasks = [
        {"title": "Go to the store"},
        {"title": "Tom"},  # Should be dropped
        {"title": "police"},  # Should be dropped
        {"title": "website"},  # Should be dropped
        {"title": "Reply to Sarah"}
    ]
    
    result = postprocess_tasks(raw_tasks, "test")
    
    print(f"Input: {len(raw_tasks)} tasks (including fragments)")
    print(f"Output: {result['final_count']} valid tasks")
    print(f"Dropped: {len(result['dropped'])}")
    
    titles = [t['title'] for t in result['tasks']]
    assert "Go to the store" in titles
    assert "Reply to Sarah" in titles
    assert "Tom" not in titles
    assert "police" not in titles
    assert "website" not in titles
    
    print("✅ Fragment filtering works!")
    return True

if __name__ == "__main__":
    try:
        test_example()
        test_filters_fragments()
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









