"""
Unit tests for fixed dump extraction with ordering, durations, and cancellations.
Tests post-processing logic without OpenAI calls.
"""
import sys
from pathlib import Path

backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from server import postprocess_extraction_items


def test_long_transcript_extraction():
    """Test the main example transcript with correct ordering and cancellations."""
    # Simulate segments
    segments = [
        {"i": 0, "start_ms": 0, "end_ms": 5000, "text": "Okay, today first thing is I want to eat something and have a coffee and I need to go to the police that takes one hour and I need to do laundry that takes 30 minutes."},
        {"i": 1, "start_ms": 5000, "end_ms": 8000, "text": "I need to call Roberta, Tom and Oliver or message them. That takes 30 minutes."},
        {"i": 2, "start_ms": 8000, "end_ms": 10000, "text": "And work on the podcast and on the website."},
        {"i": 3, "start_ms": 10000, "end_ms": 12000, "text": "Podcast two, three hours."},
        {"i": 4, "start_ms": 12000, "end_ms": 13000, "text": "Yeah, maybe website not."}
    ]
    
    # Simulate LLM output (what we expect the model to return)
    raw_items = [
        {"segment_index": 0, "order_in_segment": 0, "type": "ignore", "title": "Okay", "source_text": "Okay"},
        {"segment_index": 0, "order_in_segment": 1, "type": "task", "title": "today first thing is I want to eat something", "due_text": "today", "source_text": "today first thing is I want to eat something"},
        {"segment_index": 0, "order_in_segment": 2, "type": "task", "title": "have a coffee", "source_text": "have a coffee"},
        {"segment_index": 0, "order_in_segment": 3, "type": "task", "title": "I need to go to the police", "source_text": "I need to go to the police"},
        {"segment_index": 0, "order_in_segment": 4, "type": "duration_attach", "duration_minutes": 60, "source_text": "that takes one hour"},
        {"segment_index": 0, "order_in_segment": 5, "type": "task", "title": "I need to do laundry", "source_text": "I need to do laundry"},
        {"segment_index": 0, "order_in_segment": 6, "type": "duration_attach", "duration_minutes": 30, "source_text": "that takes 30 minutes"},
        {"segment_index": 1, "order_in_segment": 0, "type": "task", "title": "I need to call Roberta", "source_text": "I need to call Roberta"},
        {"segment_index": 1, "order_in_segment": 1, "type": "task", "title": "message Tom", "source_text": "message Tom"},
        {"segment_index": 1, "order_in_segment": 2, "type": "task", "title": "message Oliver", "source_text": "message Oliver"},
        {"segment_index": 1, "order_in_segment": 3, "type": "duration_attach", "duration_minutes": 30, "source_text": "That takes 30 minutes"},
        {"segment_index": 2, "order_in_segment": 0, "type": "task", "title": "work on the podcast", "source_text": "work on the podcast"},
        {"segment_index": 2, "order_in_segment": 1, "type": "task", "title": "work on the website", "source_text": "work on the website"},
        {"segment_index": 3, "order_in_segment": 0, "type": "task", "title": "Work on podcast", "duration_minutes": 180, "notes": "Podcast 2", "source_text": "Podcast two, three hours"},
        # Note: segment 2 has "work on the podcast" which should be merged/deduplicated with segment 3's "Work on podcast"
        {"segment_index": 4, "order_in_segment": 0, "type": "ignore", "title": "Yeah", "source_text": "Yeah"},
        {"segment_index": 4, "order_in_segment": 1, "type": "cancel_task", "targets": ["website"], "source_text": "maybe website not"}
    ]
    
    # Post-process
    final_tasks = postprocess_extraction_items(raw_items, segments)
    
    # Extract titles in order
    titles = [t.get("title", "").lower() for t in final_tasks]
    durations = [t.get("duration_minutes") for t in final_tasks]
    
    print("\n" + "="*80)
    print("Test: Long transcript extraction")
    print("="*80)
    print(f"Final tasks ({len(final_tasks)}):")
    for i, task in enumerate(final_tasks, 1):
        title = task.get("title", "")
        duration = task.get("duration_minutes")
        due = task.get("due_text")
        print(f"  {i}. {title}" + (f" [duration: {duration}]" if duration else "") + (f" (due: {due})" if due else ""))
    
    # Assertions
    assert len(final_tasks) == 8, f"Expected 8 tasks, got {len(final_tasks)}"
    assert any("eat something" in t for t in titles), "Missing 'Eat something'"
    assert any("have a coffee" in t for t in titles), "Missing 'Have a coffee'"
    assert any("go to the police" in t for t in titles), "Missing 'Go to the police'"
    assert any("do laundry" in t for t in titles), "Missing 'Do laundry'"
    assert any("call roberta" in t for t in titles), "Missing 'Call Roberta'"
    assert any("message tom" in t for t in titles), "Missing 'Message Tom'"
    assert any("message oliver" in t for t in titles), "Missing 'Message Oliver'"
    assert any("work on podcast" in t for t in titles), "Missing 'Work on podcast'"
    assert not any("website" in t for t in titles), "Website task should be cancelled"
    
    # Check durations (allow None for tasks without duration)
    police_idx = next((i for i, t in enumerate(titles) if "police" in t), None)
    if police_idx is not None:
        assert durations[police_idx] == 60, f"Police task should have duration 60, got {durations[police_idx]}"
    
    laundry_idx = next((i for i, t in enumerate(titles) if "laundry" in t), None)
    if laundry_idx is not None:
        assert durations[laundry_idx] == 30, f"Laundry task should have duration 30, got {durations[laundry_idx]}"
    
    podcast_idx = next((i for i, t in enumerate(titles) if "podcast" in t), None)
    if podcast_idx is not None:
        assert durations[podcast_idx] == 180, f"Podcast task should have duration 180, got {durations[podcast_idx]}"
    
    print("✅ Test passed!")
    return True


def test_filler_only():
    """Test that filler-only transcripts produce no tasks."""
    segments = [{"i": 0, "start_ms": 0, "end_ms": 1000, "text": "Okay. Yeah."}]
    
    raw_items = [
        {"segment_index": 0, "order_in_segment": 0, "type": "ignore", "title": "Okay", "source_text": "Okay"},
        {"segment_index": 0, "order_in_segment": 1, "type": "ignore", "title": "Yeah", "source_text": "Yeah"}
    ]
    
    final_tasks = postprocess_extraction_items(raw_items, segments)
    
    print("\n" + "="*80)
    print("Test: Filler only")
    print("="*80)
    print(f"Final tasks: {len(final_tasks)}")
    
    assert len(final_tasks) == 0, f"Expected 0 tasks, got {len(final_tasks)}"
    print("✅ Test passed!")
    return True


def test_cancellation():
    """Test that cancellations remove tasks."""
    segments = [
        {"i": 0, "start_ms": 0, "end_ms": 2000, "text": "work on the website."},
        {"i": 1, "start_ms": 2000, "end_ms": 3000, "text": "maybe website not."}
    ]
    
    raw_items = [
        {"segment_index": 0, "order_in_segment": 0, "type": "task", "title": "work on the website", "source_text": "work on the website"},
        {"segment_index": 1, "order_in_segment": 0, "type": "cancel_task", "targets": ["website"], "source_text": "maybe website not"}
    ]
    
    final_tasks = postprocess_extraction_items(raw_items, segments)
    
    print("\n" + "="*80)
    print("Test: Cancellation")
    print("="*80)
    print(f"Final tasks: {len(final_tasks)}")
    for task in final_tasks:
        print(f"  - {task.get('title')}")
    
    assert len(final_tasks) == 0, f"Expected 0 tasks after cancellation, got {len(final_tasks)}"
    print("✅ Test passed!")
    return True


if __name__ == "__main__":
    print("Running dump extraction tests...")
    print()
    
    try:
        test_long_transcript_extraction()
        test_filler_only()
        test_cancellation()
        
        print("\n" + "="*80)
        print("✅ All tests passed!")
        print("="*80)
    except AssertionError as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

