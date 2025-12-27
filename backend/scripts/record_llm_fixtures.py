#!/usr/bin/env python3
"""
Record LLM responses for golden dataset entries.

This script runs the real extraction pipeline for each golden entry
and saves the raw LLM responses as fixtures for replay in tests.

Usage:
    python scripts/record_llm_fixtures.py
    python scripts/record_llm_fixtures.py --only gold-001
    python scripts/record_llm_fixtures.py --model gpt-4o-mini --force
"""
import os
import sys
import json
import asyncio
import argparse
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

# Add backend to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

# Load environment variables
env_path = backend_dir / '.env'
if env_path.exists():
    load_dotenv(env_path)
    print(f"✓ Loaded environment from {env_path}")
else:
    print(f"⚠️  No .env file found at {env_path}, using system environment")

DATABASE_URL = os.environ.get('DATABASE_URL')
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')

if not DATABASE_URL:
    print("⚠️  DATABASE_URL not found (not needed for recording, but may be used)")
if not OPENAI_API_KEY:
    print("❌ ERROR: OPENAI_API_KEY not found in environment")
    print("   Set OPENAI_API_KEY in backend/.env or as an environment variable")
    sys.exit(1)

# Import extraction function
from server import extract_dump_items_from_transcript

# Prompt version (increment when prompt changes)
PROMPT_VERSION = "v1"

GOLDEN_FIXTURE = backend_dir / "tests" / "fixtures" / "dumps_golden.json"
FIXTURES_DIR = backend_dir / "tests" / "fixtures" / "llm_responses"


async def record_fixture(entry_id: str, transcript: str, model: str = "gpt-4o-mini", force: bool = False):
    """
    Record LLM response for a single golden entry.
    
    Returns:
        dict with recording results
    """
    fixture_path = FIXTURES_DIR / f"{entry_id}.json"
    meta_path = FIXTURES_DIR / f"{entry_id}.meta.json"
    
    # Check if fixture exists
    if fixture_path.exists() and not force:
        print(f"  ⏭️  Fixture already exists: {fixture_path}")
        print(f"     Use --force to overwrite")
        return {
            "id": entry_id,
            "skipped": True,
            "reason": "fixture_exists"
        }
    
    print(f"  🔄 Recording LLM response for {entry_id}...")
    
    try:
        # Run real extraction (this calls OpenAI)
        # Use temperature_override=0.0 for deterministic output when recording fixtures
        result = await extract_dump_items_from_transcript(
            transcript=transcript,
            provider="openai",
            model=model,
            whisper_segments=None,  # No Whisper segments for now
            trace_id=f"record-{entry_id}",
            temperature_override=0.0,  # Enforce temperature=0 for deterministic fixture recording
            model_override=None  # Use model from args
        )
        
        # Extract raw model output from debug info
        raw_model_output = result.get("_debug", {}).get("raw_model_output")
        segments_sent = result.get("_debug", {}).get("segments_sent_to_model", [])
        
        if not raw_model_output:
            print(f"  ⚠️  No raw model output in result (check debug mode)")
            # Try to reconstruct from items
            items = result.get("items", [])
            raw_model_output = {"items": items}
        
        # Validate LLM response structure
        if not isinstance(raw_model_output, dict):
            print(f"  ❌ ERROR: LLM response is not a dict: {type(raw_model_output)}")
            print(f"  Raw response: {raw_model_output}")
            return {
                "id": entry_id,
                "success": False,
                "error": f"Invalid response type: {type(raw_model_output)}"
            }
        
        # Validate expected top-level keys
        if "items" not in raw_model_output:
            print(f"  ❌ ERROR: LLM response missing 'items' key")
            print(f"  Raw response keys: {list(raw_model_output.keys())}")
            print(f"  Raw response: {json.dumps(raw_model_output, indent=2)}")
            return {
                "id": entry_id,
                "success": False,
                "error": "Missing 'items' key in LLM response"
            }
        
        if not isinstance(raw_model_output.get("items"), list):
            print(f"  ❌ ERROR: LLM response 'items' is not a list: {type(raw_model_output.get('items'))}")
            print(f"  Raw response:")
            print(json.dumps(raw_model_output, indent=2))
            return {
                "id": entry_id,
                "success": False,
                "error": f"'items' is not a list: {type(raw_model_output.get('items'))}"
            }
        
        # Validate each item in response["items"]
        items = raw_model_output.get("items", [])
        for i, item in enumerate(items):
            if not isinstance(item, dict):
                print(f"  ❌ ERROR: Item {i} is not a dict: {type(item)}")
                print(f"  Raw response:")
                print(json.dumps(raw_model_output, indent=2))
                return {
                    "id": entry_id,
                    "success": False,
                    "error": f"Item {i} is not a dict: {type(item)}"
                }
            
            # Validate title: non-empty string
            title = item.get("title")
            if not isinstance(title, str) or not title.strip():
                print(f"  ❌ ERROR: Item {i} has invalid title: {title}")
                print(f"  Raw response:")
                print(json.dumps(raw_model_output, indent=2))
                return {
                    "id": entry_id,
                    "success": False,
                    "error": f"Item {i} has invalid title (must be non-empty string): {title}"
                }
            
            # Validate duration_minutes: int or None
            duration_min = item.get("duration_minutes")
            if duration_min is not None and not isinstance(duration_min, int):
                print(f"  ❌ ERROR: Item {i} has invalid duration_minutes: {duration_min} (type: {type(duration_min)})")
                print(f"  Raw response:")
                print(json.dumps(raw_model_output, indent=2))
                return {
                    "id": entry_id,
                    "success": False,
                    "error": f"Item {i} has invalid duration_minutes (must be int or None): {duration_min}"
                }
            
            # Validate due_text: str or None
            due_text = item.get("due_text")
            if due_text is not None and not isinstance(due_text, str):
                print(f"  ❌ ERROR: Item {i} has invalid due_text: {due_text} (type: {type(due_text)})")
                print(f"  Raw response:")
                print(json.dumps(raw_model_output, indent=2))
                return {
                    "id": entry_id,
                    "success": False,
                    "error": f"Item {i} has invalid due_text (must be str or None): {due_text}"
                }
        
        # Validation passed - proceed to save
        # Ensure fixtures directory exists
        FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
        
        # Save raw LLM response
        with open(fixture_path, 'w', encoding='utf-8') as f:
            json.dump(raw_model_output, f, indent=2, ensure_ascii=False)
        
        # Save metadata
        meta = {
            "id": entry_id,
            "transcript": transcript,
            "model": model,
            "prompt_version": PROMPT_VERSION,
            "recorded_at": datetime.now(timezone.utc).isoformat(),
            "segments_sent_to_model": segments_sent,
            "extracted_count": len(result.get("items", [])),
            "final_count": result.get("final_count", 0)
        }
        
        with open(meta_path, 'w', encoding='utf-8') as f:
            json.dump(meta, f, indent=2, ensure_ascii=False)
        
        print(f"  ✓ Saved: {fixture_path}")
        print(f"  ✓ Saved: {meta_path}")
        print(f"     Extracted {result.get('final_count', 0)} tasks")
        
        return {
            "id": entry_id,
            "success": True,
            "fixture_path": str(fixture_path),
            "meta_path": str(meta_path),
            "extracted_count": result.get("final_count", 0)
        }
        
    except Exception as e:
        print(f"  ❌ Error recording {entry_id}: {e}")
        import traceback
        traceback.print_exc()
        return {
            "id": entry_id,
            "success": False,
            "error": str(e)
        }


async def record_all_fixtures(model: str = "gpt-4o-mini", only_id: str = None, force: bool = False):
    """
    Record LLM fixtures for all labeled golden entries.
    """
    print("=" * 80)
    print("Recording LLM Fixtures for Golden Dataset")
    print("=" * 80)
    print()
    
    # Load golden dataset
    if not GOLDEN_FIXTURE.exists():
        print(f"❌ ERROR: Golden fixture not found: {GOLDEN_FIXTURE}")
        print()
        print("First create the golden dataset:")
        print("  1. python scripts/seed_dumps_local.py")
        print("  2. python scripts/export_dump_transcripts.py --limit 50")
        print("  3. python scripts/make_golden_from_raw.py")
        print("  4. Manually fill expected_tasks in dumps_golden.json")
        sys.exit(1)
    
    with open(GOLDEN_FIXTURE, 'r', encoding='utf-8') as f:
        golden_data = json.load(f)
    
    # Filter entries
    if only_id:
        entries = [e for e in golden_data if e.get("id") == only_id]
        if not entries:
            print(f"❌ ERROR: Entry '{only_id}' not found in golden dataset")
            sys.exit(1)
    else:
        # Only record entries with expected_tasks filled
        entries = [e for e in golden_data if e.get("expected_tasks")]
    
    if not entries:
        print("⚠️  No entries to record (expected_tasks is empty for all entries)")
        print()
        print("Fill expected_tasks in dumps_golden.json first, then run this script.")
        sys.exit(0)
    
    print(f"Found {len(entries)} entries to record")
    print(f"Model: {model}")
    print(f"Prompt version: {PROMPT_VERSION}")
    print()
    
    # Record each entry
    results = []
    for i, entry in enumerate(entries, 1):
        entry_id = entry.get("id", f"entry-{i}")
        transcript = entry.get("transcript", "")
        
        if not transcript:
            print(f"  ⚠️  Skipping {entry_id}: no transcript")
            continue
        
        print(f"[{i}/{len(entries)}] {entry_id}")
        result = await record_fixture(entry_id, transcript, model, force)
        results.append(result)
        print()
    
    # Summary
    print("=" * 80)
    print("Summary")
    print("=" * 80)
    successful = [r for r in results if r.get("success")]
    skipped = [r for r in results if r.get("skipped")]
    failed = [r for r in results if r.get("success") == False]
    
    print(f"✓ Recorded: {len(successful)}")
    print(f"⏭️  Skipped: {len(skipped)}")
    if failed:
        print(f"❌ Failed: {len(failed)}")
        for r in failed:
            print(f"   - {r.get('id')}: {r.get('error')}")
    
    print()
    print("Next steps:")
    print("  pytest tests/test_task_extraction_golden.py -v")
    print("  python scripts/run_golden_report.py")
    print()
    
    # Exit with non-zero if any failed
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Record LLM responses for golden dataset")
    parser.add_argument("--only", type=str, help="Record only this entry ID (e.g., gold-001)")
    parser.add_argument("--model", type=str, default="gpt-4o-mini", help="OpenAI model to use")
    parser.add_argument("--force", action="store_true", help="Overwrite existing fixtures")
    
    args = parser.parse_args()
    
    asyncio.run(record_all_fixtures(
        model=args.model,
        only_id=args.only,
        force=args.force
    ))

