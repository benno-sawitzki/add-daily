"""
Regression tests for task extraction using golden dataset.

This test suite loads dumps_golden.json and compares extraction output
against expected tasks. Tests replay recorded LLM fixtures (no OpenAI calls).
"""
import sys
import json
from pathlib import Path
from typing import List, Dict, Any

# Add backend to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from server import postprocess_extraction_items
from task_extraction import segment_transcript_fallback

# Optional pytest import (only needed when running as pytest)
try:
    import pytest
except ImportError:
    pytest = None

GOLDEN_FIXTURE = backend_dir / "tests" / "fixtures" / "dumps_golden.json"
FIXTURES_DIR = backend_dir / "tests" / "fixtures" / "llm_responses"


def load_golden_dataset():
    """Load golden dataset from fixture file."""
    if not GOLDEN_FIXTURE.exists():
        if pytest:
            pytest.skip(f"Golden fixture not found: {GOLDEN_FIXTURE}")
        else:
            raise FileNotFoundError(f"Golden fixture not found: {GOLDEN_FIXTURE}")
    
    with open(GOLDEN_FIXTURE, 'r', encoding='utf-8') as f:
        return json.load(f)


def normalize_task_title(title: str) -> str:
    """Normalize task title for comparison."""
    title = title.lower().strip()
    # Remove punctuation
    import re
    title = re.sub(r'[.,!?;:]+', '', title)
    # Collapse whitespace
    title = re.sub(r'\s+', ' ', title).strip()
    return title


def extract_tasks_from_fixture(entry_id: str, transcript: str) -> List[Dict[str, Any]]:
    """
    Extract tasks by replaying a recorded LLM fixture.
    
    This loads the raw LLM output from fixtures/llm_responses/<id>.json
    and runs only the deterministic postprocessing (no OpenAI calls).
    """
    fixture_path = FIXTURES_DIR / f"{entry_id}.json"
    
    if not fixture_path.exists():
        error_msg = (
            f"Fixture not found for {entry_id}: {fixture_path}\n"
            f"Run: python scripts/record_llm_fixtures.py --only {entry_id}"
        )
        if pytest:
            pytest.fail(error_msg)
        else:
            raise FileNotFoundError(error_msg)
    
    # Load raw LLM output
    with open(fixture_path, 'r', encoding='utf-8') as f:
        raw_result = json.load(f)
    
    # Extract items from LLM response
    items = raw_result.get("items", [])
    if not isinstance(items, list):
        error_msg = f"Invalid fixture format for {entry_id}: items is not a list"
        if pytest:
            pytest.fail(error_msg)
        else:
            raise ValueError(error_msg)
    
    # Build segments from transcript (for postprocessing)
    segments = segment_transcript_fallback(transcript)
    
    # Run deterministic postprocessing (no LLM call)
    final_tasks = postprocess_extraction_items(items, segments)
    
    return final_tasks


def compare_tasks(expected: List[Dict[str, Any]], extracted: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Compare expected tasks with extracted tasks.
    
    Returns:
        {
            "match": bool,
            "missing": List[str],  # Expected titles not found
            "extra": List[str],    # Extracted titles not expected
            "details": List[Dict]  # Per-task comparison details
        }
    """
    # Normalize titles for comparison
    expected_titles = {normalize_task_title(t.get("title", "")): t for t in expected}
    extracted_titles = {normalize_task_title(t.get("title", "")): t for t in extracted}
    
    missing = []
    extra = []
    details = []
    
    # Check for missing expected tasks
    for exp_title, exp_task in expected_titles.items():
        found = False
        matching_extracted = None
        
        for ext_title, ext_task in extracted_titles.items():
            if exp_title in ext_title or ext_title in exp_title:
                found = True
                matching_extracted = ext_task
                break
        
        if not found:
            missing.append(exp_task.get("title", ""))
        
        # Check duration and due_text if specified
        detail = {
            "expected": exp_task.get("title", ""),
            "found": found,
            "expected_duration": exp_task.get("duration_minutes"),
            "expected_due": exp_task.get("due_text"),
        }
        
        if matching_extracted:
            detail["extracted_duration"] = matching_extracted.get("duration_minutes")
            detail["extracted_due"] = matching_extracted.get("due_text")
            
            # Check duration match
            if exp_task.get("duration_minutes") is not None:
                if matching_extracted.get("duration_minutes") != exp_task.get("duration_minutes"):
                    detail["duration_mismatch"] = True
        
        details.append(detail)
    
    # Check for extra extracted tasks
    for ext_title, ext_task in extracted_titles.items():
        found = False
        for exp_title in expected_titles.keys():
            if exp_title in ext_title or ext_title in exp_title:
                found = True
                break
        if not found:
            extra.append(ext_task.get("title", ""))
    
    match = len(missing) == 0 and len(extra) == 0
    
    return {
        "match": match,
        "missing": missing,
        "extra": extra,
        "details": details
    }


if pytest:
    @pytest.fixture(scope="module")
    def golden_dataset():
        """Load golden dataset once for all tests."""
        return load_golden_dataset()


def test_extraction_golden_entry(entry):
    """
    Test for a single golden dataset entry.
    Tests replay recorded LLM fixtures and compare postprocessed results
    to expected tasks.
    """
    transcript = entry.get("transcript", "")
    expected_tasks = entry.get("expected_tasks", [])
    entry_id = entry.get("id", "unknown")
    
    # Skip if expected_tasks is empty (not yet labeled)
    if not expected_tasks:
        if pytest:
            pytest.skip(f"Entry {entry_id} not yet labeled (expected_tasks is empty)")
        else:
            return  # Skip when running directly
    
    # Extract tasks by replaying fixture (no LLM calls)
    extracted_tasks = extract_tasks_from_fixture(entry_id, transcript)
    
    # Compare
    comparison = compare_tasks(expected_tasks, extracted_tasks)
    
    # Build failure message
    if not comparison["match"]:
        error_msg = f"\n{'='*80}\n"
        error_msg += f"Entry: {entry_id}\n"
        error_msg += f"{'='*80}\n"
        error_msg += f"Transcript: {transcript[:200]}...\n" if len(transcript) > 200 else f"Transcript: {transcript}\n"
        error_msg += f"\nExpected tasks ({len(expected_tasks)}):\n"
        for task in expected_tasks:
            title = task.get("title", "")
            duration = task.get("duration_minutes")
            due = task.get("due_text")
            error_msg += f"  - {title}"
            if duration:
                error_msg += f" [duration: {duration}]"
            if due:
                error_msg += f" (due: {due})"
            error_msg += "\n"
        
        error_msg += f"\nExtracted tasks ({len(extracted_tasks)}):\n"
        for task in extracted_tasks:
            title = task.get("title", "")
            duration = task.get("duration_minutes")
            due = task.get("due_text")
            error_msg += f"  - {title}"
            if duration:
                error_msg += f" [duration: {duration}]"
            if due:
                error_msg += f" (due: {due})"
            error_msg += "\n"
        
        if comparison["missing"]:
            error_msg += f"\nMissing expected tasks:\n"
            for title in comparison["missing"]:
                error_msg += f"  - {title}\n"
        
        if comparison["extra"]:
            error_msg += f"\nUnexpected extracted tasks:\n"
            for title in comparison["extra"]:
                error_msg += f"  - {title}\n"
        
        error_msg += f"\n{'='*80}\n"
        error_msg += f"To update fixture: python scripts/record_llm_fixtures.py --only {entry_id} --force\n"
        error_msg += f"{'='*80}\n"
        
        if pytest:
            pytest.fail(error_msg)
        else:
            raise AssertionError(error_msg)


# Pytest-specific test function
if pytest:
    @pytest.mark.parametrize("entry", [])
    def test_extraction_golden(entry):
        """Pytest wrapper for test_extraction_golden_entry."""
        test_extraction_golden_entry(entry)


def pytest_generate_tests(metafunc):
    """Dynamically generate test cases from golden dataset."""
    if pytest and "entry" in metafunc.fixturenames:
        try:
            dataset = load_golden_dataset()
            metafunc.parametrize("entry", dataset, ids=[e.get("id", f"entry-{i}") for i, e in enumerate(dataset)])
        except Exception as e:
            # If golden dataset doesn't exist or can't be loaded, skip
            pytest.skip(f"Could not load golden dataset: {e}")


if __name__ == "__main__":
    # Allow running directly for debugging (no pytest required)
    print("=" * 80)
    print("Golden Dataset Test (Direct Mode)")
    print("=" * 80)
    print()
    
    try:
        dataset = load_golden_dataset()
        print(f"Loaded {len(dataset)} entries from golden dataset")
        print()
        
        for entry in dataset:
            entry_id = entry.get("id", "unknown")
            expected = entry.get("expected_tasks", [])
            transcript = entry.get("transcript", "")
            
            print(f"{entry_id}:")
            print(f"  Transcript: {transcript[:80]}..." if len(transcript) > 80 else f"  Transcript: {transcript}")
            print(f"  Expected tasks: {len(expected)}")
            
            if expected:
                print("  Expected:")
                for task in expected:
                    title = task.get('title', '')
                    duration = task.get('duration_minutes')
                    due = task.get('due_text')
                    print(f"    - {title}" + (f" [duration: {duration}]" if duration else "") + (f" (due: {due})" if due else ""))
                
                # Try extraction from fixture
                try:
                    extracted = extract_tasks_from_fixture(entry_id, transcript)
                    print(f"  Extracted: {len(extracted)}")
                    for task in extracted:
                        title = task.get('title', '')
                        duration = task.get('duration_minutes')
                        due = task.get('due_text')
                        print(f"    - {title}" + (f" [duration: {duration}]" if duration else "") + (f" (due: {due})" if due else ""))
                    
                    # Compare
                    comparison = compare_tasks(expected, extracted)
                    if comparison["match"]:
                        print("  ✅ Match!")
                    else:
                        print(f"  ❌ Mismatch:")
                        if comparison['missing']:
                            print(f"    Missing: {comparison['missing']}")
                        if comparison['extra']:
                            print(f"    Extra: {comparison['extra']}")
                except FileNotFoundError as e:
                    print(f"  ⚠️  {e}")
                except Exception as e:
                    print(f"  ❌ Error: {e}")
                    import traceback
                    traceback.print_exc()
            else:
                print("  (Not yet labeled)")
            print()
        
        print("=" * 80)
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

