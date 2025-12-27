#!/usr/bin/env python3
"""
Create golden dataset from raw exported dumps.

This script reads dumps_raw.json and creates dumps_golden.json with
the first 10 dumps as placeholders for expected tasks.

Usage:
    python scripts/make_golden_from_raw.py
"""
import json
import sys
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

RAW_FIXTURE = backend_dir / "tests" / "fixtures" / "dumps_raw.json"
GOLDEN_FIXTURE = backend_dir / "tests" / "fixtures" / "dumps_golden.json"


def make_golden():
    """Create golden dataset from raw dumps."""
    print("=" * 80)
    print("Creating Golden Dataset")
    print("=" * 80)
    print()
    
    # Check if raw fixture exists
    if not RAW_FIXTURE.exists():
        print(f"❌ ERROR: Raw fixture not found: {RAW_FIXTURE}")
        print()
        print("First export dumps:")
        print("  python scripts/export_dump_transcripts.py --limit 50")
        sys.exit(1)
    
    print(f"✓ Reading: {RAW_FIXTURE}")
    
    # Load raw dumps
    with open(RAW_FIXTURE, 'r', encoding='utf-8') as f:
        raw_dumps = json.load(f)
    
    if not raw_dumps:
        print("❌ ERROR: No dumps found in raw fixture")
        print()
        print("First seed and export dumps:")
        print("  1. python scripts/seed_dumps_local.py")
        print("  2. python scripts/export_dump_transcripts.py --limit 50")
        sys.exit(1)
    
    print(f"✓ Found {len(raw_dumps)} dumps in raw fixture")
    print()
    
    # Take first 10 (or all if less than 10)
    selected = raw_dumps[:10]
    print(f"Creating golden dataset with {len(selected)} entries...")
    print()
    
    # Create golden entries
    golden_entries = []
    for i, dump in enumerate(selected, 1):
        golden_entry = {
            "id": f"gold-{i:03d}",
            "original_id": dump.get("id"),
            "created_at": dump.get("created_at"),
            "transcript": dump.get("transcript", ""),
            "expected_tasks": []  # Empty - to be filled manually
        }
        golden_entries.append(golden_entry)
        
        preview = dump.get("transcript", "")[:60] + "..." if len(dump.get("transcript", "")) > 60 else dump.get("transcript", "")
        print(f"  {i}. {preview}")
    
    # Ensure output directory exists
    GOLDEN_FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    
    # Write golden fixture
    with open(GOLDEN_FIXTURE, 'w', encoding='utf-8') as f:
        json.dump(golden_entries, f, indent=2, ensure_ascii=False)
    
    print()
    print(f"✓ Created: {GOLDEN_FIXTURE}")
    print()
    print("=" * 80)
    print("Next Steps:")
    print("=" * 80)
    print()
    print("1. Open the golden fixture file:")
    print(f"   {GOLDEN_FIXTURE}")
    print()
    print("2. For each entry, fill in 'expected_tasks' with the correct extraction results.")
    print("   Format:")
    print("   {")
    print('     "id": "gold-001",')
    print('     "transcript": "...",')
    print('     "expected_tasks": [')
    print('       {')
    print('         "title": "Go to the police",')
    print('         "due_text": "today",')
    print('         "duration_minutes": 60')
    print('       },')
    print('       {')
    print('         "title": "Do laundry",')
    print('         "duration_minutes": 30')
    print('       }')
    print('     ]')
    print("   }")
    print()
    print("3. Once expected_tasks are filled, run regression tests:")
    print("   pytest backend/tests/test_task_extraction_golden.py -v")
    print()
    print("=" * 80)


if __name__ == "__main__":
    make_golden()






