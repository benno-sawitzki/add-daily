#!/usr/bin/env python3
"""
Golden regression report for task extraction.

Loads golden dataset, replays fixtures, runs postprocessing, and compares
extracted tasks vs expected tasks. Prints a concise report with pass/fail status.

Usage:
    python scripts/run_golden_report.py
    python scripts/run_golden_report.py --only gold-001
"""
import sys
import json
import argparse
from pathlib import Path
from typing import List, Dict, Any

# Add backend to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from server import postprocess_extraction_items
from task_extraction import segment_transcript_fallback

GOLDEN_FIXTURE = backend_dir / "tests" / "fixtures" / "dumps_golden.json"
FIXTURES_DIR = backend_dir / "tests" / "fixtures" / "llm_responses"


def normalize_task_title(title: str) -> str:
    """Normalize task title for comparison."""
    import re
    title = title.lower().strip()
    # Remove punctuation
    title = re.sub(r'[.,!?;:]+', '', title)
    # Collapse whitespace
    title = re.sub(r'\s+', ' ', title).strip()
    return title


def compare_tasks(expected: List[Dict[str, Any]], extracted: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Compare expected tasks with extracted tasks.
    
    Returns:
        {
            "match": bool,
            "missing": List[str],  # Expected titles not found
            "extra": List[str],    # Extracted titles not expected
            "field_diffs": List[Dict]  # Tasks that match but have field differences
        }
    """
    # Normalize titles for comparison
    expected_titles = {normalize_task_title(t.get("title", "")): t for t in expected}
    extracted_titles = {normalize_task_title(t.get("title", "")): t for t in extracted}
    
    missing = []
    extra = []
    field_diffs = []
    
    # Check for missing expected tasks
    for exp_title, exp_task in expected_titles.items():
        found = False
        matching_extracted = None
        
        for ext_title, ext_task in extracted_titles.items():
            # Fuzzy match: check if titles overlap
            if exp_title in ext_title or ext_title in exp_title:
                found = True
                matching_extracted = ext_task
                break
        
        if not found:
            missing.append(exp_task.get("title", ""))
        else:
            # Check field differences
            diffs = {}
            if exp_task.get("duration_minutes") is not None:
                if matching_extracted.get("duration_minutes") != exp_task.get("duration_minutes"):
                    diffs["duration_minutes"] = {
                        "expected": exp_task.get("duration_minutes"),
                        "got": matching_extracted.get("duration_minutes")
                    }
            if exp_task.get("due_text"):
                if matching_extracted.get("due_text") != exp_task.get("due_text"):
                    diffs["due_text"] = {
                        "expected": exp_task.get("due_text"),
                        "got": matching_extracted.get("due_text")
                    }
            if diffs:
                field_diffs.append({
                    "title": exp_task.get("title", ""),
                    "diffs": diffs
                })
    
    # Check for extra extracted tasks
    for ext_title, ext_task in extracted_titles.items():
        found = False
        for exp_title in expected_titles.keys():
            if exp_title in ext_title or ext_title in exp_title:
                found = True
                break
        if not found:
            extra.append(ext_task.get("title", ""))
    
    match = len(missing) == 0 and len(extra) == 0 and len(field_diffs) == 0
    
    return {
        "match": match,
        "missing": missing,
        "extra": extra,
        "field_diffs": field_diffs
    }


def test_golden_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    """Test a single golden entry and return result."""
    entry_id = entry.get("id", "unknown")
    transcript = entry.get("transcript", "")
    expected_tasks = entry.get("expected_tasks", [])
    
    if not expected_tasks:
        return {
            "id": entry_id,
            "status": "skipped",
            "reason": "no expected_tasks"
        }
    
    # Load fixture
    fixture_path = FIXTURES_DIR / f"{entry_id}.json"
    if not fixture_path.exists():
        return {
            "id": entry_id,
            "status": "error",
            "error": f"Fixture not found: {fixture_path}"
        }
    
    try:
        with open(fixture_path, 'r', encoding='utf-8') as f:
            raw_result = json.load(f)
        
        items = raw_result.get("items", [])
        if not isinstance(items, list):
            return {
                "id": entry_id,
                "status": "error",
                "error": "Fixture 'items' is not a list"
            }
        
        # Build segments from transcript
        segments = segment_transcript_fallback(transcript)
        
        # Run deterministic postprocessing (same as test)
        final_tasks = postprocess_extraction_items(items, segments)
        
        # Compare
        comparison = compare_tasks(expected_tasks, final_tasks)
        
        return {
            "id": entry_id,
            "status": "pass" if comparison["match"] else "fail",
            "expected_count": len(expected_tasks),
            "extracted_count": len(final_tasks),
            "missing": comparison["missing"],
            "extra": comparison["extra"],
            "field_diffs": comparison["field_diffs"]
        }
        
    except Exception as e:
        return {
            "id": entry_id,
            "status": "error",
            "error": str(e)
        }


def main():
    parser = argparse.ArgumentParser(description="Run golden regression report")
    parser.add_argument("--only", type=str, help="Test only this entry ID")
    
    args = parser.parse_args()
    
    # Load golden dataset
    if not GOLDEN_FIXTURE.exists():
        print(f"❌ ERROR: Golden fixture not found: {GOLDEN_FIXTURE}")
        sys.exit(1)
    
    with open(GOLDEN_FIXTURE, 'r', encoding='utf-8') as f:
        golden_data = json.load(f)
    
    # Filter entries
    if args.only:
        entries = [e for e in golden_data if e.get("id") == args.only]
        if not entries:
            print(f"❌ ERROR: Entry '{args.only}' not found")
            sys.exit(1)
    else:
        entries = golden_data
    
    # Test each entry
    results = []
    for entry in entries:
        result = test_golden_entry(entry)
        results.append(result)
    
    # Print report
    print("=" * 80)
    print("Golden Regression Report")
    print("=" * 80)
    print()
    
    passed = [r for r in results if r.get("status") == "pass"]
    failed = [r for r in results if r.get("status") == "fail"]
    errors = [r for r in results if r.get("status") == "error"]
    skipped = [r for r in results if r.get("status") == "skipped"]
    
    for result in results:
        entry_id = result.get("id")
        status = result.get("status")
        
        if status == "pass":
            print(f"✅ {entry_id}: {result.get('extracted_count')} tasks match expected")
        elif status == "fail":
            print(f"❌ {entry_id}: Mismatch")
            print(f"   Expected: {result.get('expected_count')}, Got: {result.get('extracted_count')}")
            if result.get("missing"):
                print(f"   Missing: {', '.join(result['missing'])}")
            if result.get("extra"):
                print(f"   Extra: {', '.join(result['extra'])}")
            if result.get("field_diffs"):
                for diff in result["field_diffs"]:
                    title = diff["title"]
                    for field, values in diff["diffs"].items():
                        print(f"   {title}: {field} expected {values['expected']}, got {values['got']}")
        elif status == "error":
            print(f"⚠️  {entry_id}: ERROR - {result.get('error')}")
        elif status == "skipped":
            print(f"⏭️  {entry_id}: Skipped (no expected_tasks)")
        print()
    
    # Summary
    print("=" * 80)
    print("Summary")
    print("=" * 80)
    print(f"Total: {len(results)}")
    print(f"✅ Passed: {len(passed)}")
    print(f"❌ Failed: {len(failed)}")
    print(f"⚠️  Errors: {len(errors)}")
    print(f"⏭️  Skipped: {len(skipped)}")
    print()
    
    # Exit code
    if failed or errors:
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()









