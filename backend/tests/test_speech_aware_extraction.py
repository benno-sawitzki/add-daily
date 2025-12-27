"""
Unit tests for speech-aware task extraction with cancellation handling.
"""
import sys
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from task_extraction import (
    build_segments_from_whisper,
    segment_transcript_fallback,
    validate_and_clean_tasks,
    apply_cancellations,
    fuzzy_match_cancellation
)


def test_filler_only():
    """Test A: 'Okay.' => 0 tasks"""
    transcript = "Okay."
    
    segments = segment_transcript_fallback(transcript)
    print(f"\nTest A: 'Okay.'")
    print(f"Segments: {segments}")
    
    # Simulate AI returning ignore
    raw_items = [
        {"type": "ignore", "title": "Okay", "segment_index": 0, "source_text": "Okay"}
    ]
    
    result = validate_and_clean_tasks(raw_items)
    print(f"Result: {result['final_count']} tasks")
    
    assert result["final_count"] == 0, f"Expected 0 tasks, got {result['final_count']}"


def test_duration_fragment():
    """Test B: 'three hours. Yeah.' => 0 tasks"""
    transcript = "three hours. Yeah."
    
    segments = segment_transcript_fallback(transcript)
    print(f"\nTest B: 'three hours. Yeah.'")
    print(f"Segments: {segments}")
    
    # Simulate AI returning ignore for both
    raw_items = [
        {"type": "ignore", "title": "three hours", "segment_index": 0, "source_text": "three hours"},
        {"type": "ignore", "title": "Yeah", "segment_index": 1, "source_text": "Yeah"}
    ]
    
    result = validate_and_clean_tasks(raw_items)
    print(f"Result: {result['final_count']} tasks")
    
    assert result["final_count"] == 0, f"Expected 0 tasks, got {result['final_count']}"


def test_cancellation():
    """Test C: 'maybe website not' after 'work on the website' cancels it"""
    print(f"\nTest C: Cancellation")
    
    # Simulate: first task, then cancellation
    raw_items = [
        {
            "type": "task",
            "title": "Work on the website",
            "segment_index": 0,
            "source_text": "work on the website"
        },
        {
            "type": "cancel_task",
            "title": "website",
            "segment_index": 1,
            "source_text": "maybe website not",
            "targets": ["website"]
        }
    ]
    
    result = validate_and_clean_tasks(raw_items)
    print(f"Result: {result['final_count']} tasks")
    for task in result["tasks"]:
        print(f"  - {task['title']}")
    
    assert result["final_count"] == 0, f"Expected 0 tasks (cancelled), got {result['final_count']}"


def test_main_example():
    """Test D: Main example with all requirements"""
    transcript = "Okay, today first thing is I want to eat something and have a coffee and I need to go to the police that takes one hour and I need to do laundry that takes 30 minutes. I need to call Roberta, Tom and Oliver or message them. That takes 30 minutes. And work on the podcast and on the website. Podcast two, three hours. Yeah, maybe website not."
    
    print(f"\nTest D: Main example")
    print(f"Transcript: {transcript[:100]}...")
    
    segments = segment_transcript_fallback(transcript)
    print(f"Segments: {len(segments)}")
    for i, seg in enumerate(segments[:5]):  # Show first 5
        print(f"  {i}: {seg.get('text', '')[:60]}")
    
    # Simulate AI extraction (what we expect)
    raw_items = [
        {"type": "ignore", "title": "Okay", "segment_index": 0, "source_text": "Okay"},
        {"type": "task", "title": "Eat something", "due_text": "today", "segment_index": 1, "source_text": "today first thing is I want to eat something"},
        {"type": "task", "title": "Have a coffee", "segment_index": 1, "source_text": "have a coffee"},
        {"type": "task", "title": "Go to the police", "due_text": "today", "duration_minutes": 60, "segment_index": 1, "source_text": "go to the police that takes one hour"},
        {"type": "task", "title": "Do laundry", "duration_minutes": 30, "segment_index": 1, "source_text": "do laundry that takes 30 minutes"},
        {"type": "task", "title": "Call Roberta", "segment_index": 2, "source_text": "call Roberta"},
        {"type": "task", "title": "Message Tom and Oliver", "duration_minutes": 30, "segment_index": 2, "source_text": "message them. That takes 30 minutes"},
        {"type": "task", "title": "Work on the podcast", "segment_index": 3, "source_text": "work on the podcast"},
        {"type": "task", "title": "Work on the website", "segment_index": 3, "source_text": "work on the website"},
        {"type": "task", "title": "Work on podcast", "duration_minutes": 180, "segment_index": 3, "source_text": "Podcast two, three hours"},
        {"type": "ignore", "title": "Yeah", "segment_index": 4, "source_text": "Yeah"},
        {"type": "cancel_task", "title": "website", "segment_index": 4, "source_text": "maybe website not", "targets": ["website"]}
    ]
    
    result = validate_and_clean_tasks(raw_items)
    
    print(f"\nResult: {result['final_count']} tasks")
    for task in result["tasks"]:
        title = task['title']
        due = task.get('due_text', '')
        duration = task.get('duration_minutes', '')
        print(f"  - {title}" + (f" (due: {due})" if due else "") + (f" [duration: {duration}]" if duration else ""))
    
    # Expected tasks (after cancellation):
    # - Eat something (due: today)
    # - Have a coffee
    # - Go to the police (due: today, duration: 60)
    # - Do laundry (duration: 30)
    # - Call Roberta OR Message Tom and Oliver (duration: 30) - choose one consistent behavior
    # - Work on the podcast (duration: 180) - or Work on podcast (Podcast 2)
    # - NO website task (cancelled)
    
    assert result["final_count"] >= 6, f"Expected at least 6 tasks, got {result['final_count']}"
    
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
    assert not any(t == "okay" or t == "yeah" for t in titles), "Filler items should not be present"


def test_fuzzy_match_cancellation():
    """Test fuzzy matching for cancellations"""
    assert fuzzy_match_cancellation("website", "Work on the website") == True
    assert fuzzy_match_cancellation("website", "Website task") == True
    assert fuzzy_match_cancellation("website", "Go to the store") == False
    assert fuzzy_match_cancellation("podcast", "Work on podcast") == True


def test_whisper_segments():
    """Test building segments from Whisper segments with timestamps"""
    whisper_segments = [
        {"start": 0.0, "end": 2.5, "text": "Okay, today first thing"},
        {"start": 2.6, "end": 5.0, "text": "is I want to eat something"},  # Gap 0.1s - should merge
        {"start": 5.8, "end": 8.0, "text": "and have a coffee"},  # Gap 0.8s - should start new segment
        {"start": 8.1, "end": 10.0, "text": "and I need to go to the police"}  # Gap 0.1s - should merge
    ]
    
    segments = build_segments_from_whisper(whisper_segments, pause_threshold_ms=600)
    
    print(f"\nWhisper segments test:")
    print(f"Input: {len(whisper_segments)} Whisper segments")
    print(f"Output: {len(segments)} merged segments")
    for seg in segments:
        print(f"  [{seg['start_ms']}ms-{seg['end_ms']}ms]: {seg['text'][:50]}")
    
    # Should have 2 segments (first two merge, last two merge)
    assert len(segments) == 2, f"Expected 2 segments, got {len(segments)}"
    assert segments[0]["text"] == "Okay, today first thing is I want to eat something"
    assert segments[1]["text"] == "and have a coffee and I need to go to the police"


if __name__ == "__main__":
    print("=" * 80)
    print("Testing Speech-Aware Extraction with Cancellation")
    print("=" * 80)
    
    try:
        test_filler_only()
        print("✅ Filler-only test passed")
        
        test_duration_fragment()
        print("✅ Duration fragment test passed")
        
        test_cancellation()
        print("✅ Cancellation test passed")
        
        test_fuzzy_match_cancellation()
        print("✅ Fuzzy match cancellation test passed")
        
        test_whisper_segments()
        print("✅ Whisper segments test passed")
        
        test_main_example()
        print("✅ Main example test passed")
        
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







