#!/usr/bin/env python3
"""
Reproduction helper for dump extraction.

Takes a transcript string and runs the same extraction function used in Save Dump,
printing segments, LLM raw output, final tasks, and insert payload count.

Usage:
    python scripts/repro_dump_extraction.py "Okay, today first thing is I want to eat something..."
    python scripts/repro_dump_extraction.py --file transcript.txt
"""
import os
import sys
import json
import asyncio
import argparse
from pathlib import Path
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

OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')
if not OPENAI_API_KEY:
    print("❌ ERROR: OPENAI_API_KEY not found in environment")
    sys.exit(1)

from server import extract_dump_items_from_transcript, postprocess_safety_split
from task_extraction import segment_transcript_fallback


async def reproduce_extraction(transcript: str):
    """Reproduce the extraction flow for a transcript."""
    trace_id = "repro-" + os.urandom(4).hex()
    
    print("=" * 80)
    print("Reproducing Dump Extraction")
    print("=" * 80)
    print(f"Trace ID: {trace_id}")
    print(f"Transcript length: {len(transcript)}")
    print(f"Transcript: {transcript[:200]}..." if len(transcript) > 200 else f"Transcript: {transcript}")
    print()
    
    try:
        # Step 1: Extract using the same function as Save Dump
        result = await extract_dump_items_from_transcript(
            transcript=transcript,
            provider="openai",
            model="gpt-4o-mini",
            whisper_segments=None,
            trace_id=trace_id
        )
        
        # Extract debug info
        segments = result.get("segments", [])
        raw_model_output = result.get("_debug", {}).get("raw_model_output")
        final_tasks = result.get("_debug", {}).get("final_tasks", [])
        items = result.get("items", [])
        
        print("=" * 80)
        print("Segments Built")
        print("=" * 80)
        print(f"Count: {len(segments)}")
        for i, seg in enumerate(segments[:10]):  # First 10
            print(f"  {i}: {seg.get('text', '')[:100]}")
        if len(segments) > 10:
            print(f"  ... and {len(segments) - 10} more")
        print()
        
        print("=" * 80)
        print("LLM Raw Output")
        print("=" * 80)
        if raw_model_output:
            items_count = len(raw_model_output.get("items", []))
            print(f"Items count: {items_count}")
            print("First 3 items:")
            for i, item in enumerate(raw_model_output.get("items", [])[:3]):
                print(f"  {i}: {json.dumps(item, indent=2)}")
            if items_count > 3:
                print(f"  ... and {items_count - 3} more")
        else:
            print("No raw model output in debug info")
        print()
        
        print("=" * 80)
        print("Final Tasks (After Postprocessing)")
        print("=" * 80)
        print(f"Count: {len(final_tasks)}")
        for i, task in enumerate(final_tasks[:10]):  # First 10
            title = task.get("title", "")
            duration = task.get("duration_minutes")
            due = task.get("due_text")
            print(f"  {i}: {title}" + (f" [duration: {duration}]" if duration else "") + (f" (due: {due})" if due else ""))
        if len(final_tasks) > 10:
            print(f"  ... and {len(final_tasks) - 10} more")
        print()
        
        print("=" * 80)
        print("Items for DB Insert")
        print("=" * 80)
        print(f"Count: {len(items)}")
        for i, item in enumerate(items[:10]):  # First 10
            text = item.get("text", "")
            print(f"  {i}: {text[:100]}")
        if len(items) > 10:
            print(f"  ... and {len(items) - 10} more")
        print()
        
        # Apply safety split
        safety_split_items = postprocess_safety_split(items, trace_id, "repro-dump-id")
        
        if len(safety_split_items) != len(items):
            print("=" * 80)
            print("After Safety Split")
            print("=" * 80)
            print(f"Count: {len(safety_split_items)} (was {len(items)})")
            for i, item in enumerate(safety_split_items[:10]):
                text = item.get("text", "")
                print(f"  {i}: {text[:100]}")
            if len(safety_split_items) > 10:
                print(f"  ... and {len(safety_split_items) - 10} more")
            print()
        
        print("=" * 80)
        print("Summary")
        print("=" * 80)
        print(f"Segments: {len(segments)}")
        print(f"LLM items: {len(raw_model_output.get('items', [])) if raw_model_output else 0}")
        print(f"Final tasks: {len(final_tasks)}")
        print(f"Items for insert: {len(items)}")
        print(f"After safety split: {len(safety_split_items)}")
        print()
        
        if len(transcript) > 50 and len(safety_split_items) <= 2:
            print("⚠️  WARNING: Suspicious low task count!")
            print(f"   Transcript length: {len(transcript)}")
            print(f"   Final items: {len(safety_split_items)}")
        else:
            print("✅ Extraction looks reasonable")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reproduce dump extraction for debugging")
    parser.add_argument("transcript", nargs="?", help="Transcript text to extract from")
    parser.add_argument("--file", type=str, help="Read transcript from file")
    
    args = parser.parse_args()
    
    if args.file:
        with open(args.file, 'r', encoding='utf-8') as f:
            transcript = f.read().strip()
    elif args.transcript:
        transcript = args.transcript
    else:
        print("❌ ERROR: Provide transcript as argument or --file")
        sys.exit(1)
    
    asyncio.run(reproduce_extraction(transcript))









