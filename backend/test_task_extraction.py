"""
Regression test for task extraction from transcript.
Tests that multiple tasks in a transcript are all extracted correctly.
"""
import asyncio
import json
import sys
import os

# Add backend directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from server import get_ai_response

async def test_task_extraction():
    """Test that transcript with 3 tasks extracts all 3 tasks"""
    transcript = "I go to the gym, that takes 3 hours, then I buy an AI tool that takes 1 hour, then I go home."
    
    print("=" * 80)
    print("REGRESSION TEST: Task Extraction")
    print("=" * 80)
    print(f"Transcript: {transcript}")
    print()
    
    try:
        result = await get_ai_response(
            transcript=transcript,
            provider="openai",
            model="gpt-4o-mini"
        )
        
        tasks = result.get("tasks", [])
        print(f"✅ Extracted {len(tasks)} tasks")
        print()
        
        # Assert we got 3 tasks
        assert len(tasks) == 3, f"Expected 3 tasks, got {len(tasks)}"
        print("✅ PASS: Correct number of tasks extracted")
        
        # Print task details
        for i, task in enumerate(tasks, 1):
            print(f"Task {i}:")
            print(f"  Title: {task.get('title')}")
            print(f"  Duration: {task.get('duration')} minutes")
            print(f"  Priority: {task.get('priority')}")
            print()
        
        # Verify expected tasks are present
        titles = [t.get('title', '').lower() for t in tasks]
        assert any('gym' in title for title in titles), "Gym task not found"
        assert any('ai tool' in title or 'buy' in title for title in titles), "AI tool task not found"
        assert any('home' in title or 'go home' in title for title in titles), "Go home task not found"
        print("✅ PASS: All expected tasks found")
        
        # Verify durations
        gym_task = next((t for t in tasks if 'gym' in t.get('title', '').lower()), None)
        if gym_task:
            assert gym_task.get('duration') == 180, f"Gym task should be 180 minutes (3 hours), got {gym_task.get('duration')}"
            print("✅ PASS: Gym task duration correct (180 minutes)")
        
        ai_tool_task = next((t for t in tasks if 'ai tool' in t.get('title', '').lower() or 'buy' in t.get('title', '').lower()), None)
        if ai_tool_task:
            assert ai_tool_task.get('duration') == 60, f"AI tool task should be 60 minutes (1 hour), got {ai_tool_task.get('duration')}"
            print("✅ PASS: AI tool task duration correct (60 minutes)")
        
        print()
        print("=" * 80)
        print("✅ ALL TESTS PASSED")
        print("=" * 80)
        return True
        
    except AssertionError as e:
        print()
        print("=" * 80)
        print(f"❌ TEST FAILED: {e}")
        print("=" * 80)
        return False
    except Exception as e:
        print()
        print("=" * 80)
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        print("=" * 80)
        return False

if __name__ == "__main__":
    # Set up environment
    if not os.environ.get("OPENAI_API_KEY"):
        print("ERROR: OPENAI_API_KEY environment variable not set")
        sys.exit(1)
    
    # Run test
    success = asyncio.run(test_task_extraction())
    sys.exit(0 if success else 1)

