#!/usr/bin/env python3
"""
Reproduce dump extraction for a single transcript (no UI, CLI only).

This script isolates the extraction pipeline from the frontend and database,
allowing us to test extraction logic in isolation.

Usage:
    python scripts/repro_extraction_once.py --transcript "I need to go to the gym. That takes two hours."
    python scripts/repro_extraction_once.py --file transcript.txt
"""
import os
import sys
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

# Import after path setup
from server import extract_dump_items_from_transcript

async def main():
    parser = argparse.ArgumentParser(description="Reproduce dump extraction for a single transcript.")
    parser.add_argument("--transcript", type=str, help="The transcript string to process.")
    parser.add_argument("--file", type=str, help="Path to a file containing the transcript.")
    parser.add_argument("--model", type=str, default="gpt-4o-mini", help="OpenAI model to use.")
    parser.add_argument("--provider", type=str, default="openai", help="AI provider.")
    args = parser.parse_args()
    
    # Get transcript
    transcript = None
    if args.file:
        with open(args.file, 'r') as f:
            transcript = f.read().strip()
    elif args.transcript:
        transcript = args.transcript
    else:
        print("❌ ERROR: Must provide either --transcript or --file")
        sys.exit(1)
    
    if not transcript:
        print("❌ ERROR: Transcript is empty")
        sys.exit(1)
    
    print("=" * 80)
    print("Reproduce Extraction")
    print("=" * 80)
    print()
    print(f"Transcript length: {len(transcript)}")
    print(f"Transcript preview: {transcript[:100]}...")
    print()
    print(f"Model: {args.model}")
    print(f"Provider: {args.provider}")
    print()
    
    # Check API key
    has_key = bool(os.environ.get('OPENAI_API_KEY'))
    print(f"Has OpenAI API key: {has_key}")
    if not has_key:
        print("⚠️  WARNING: OPENAI_API_KEY not set. Extraction will fail.")
    print()
    
    # Generate trace_id
    import uuid
    trace_id = uuid.uuid4().hex[:8]
    print(f"Trace ID: {trace_id}")
    print()
    
    try:
        # Call extraction function
        print("Calling extract_dump_items_from_transcript...")
        print("-" * 80)
        
        result = await extract_dump_items_from_transcript(
            transcript=transcript,
            provider=args.provider,
            model=args.model,
            whisper_segments=None,
            trace_id=trace_id,
            temperature_override=0.0  # Deterministic
        )
        
        print()
        print("=" * 80)
        print("Results")
        print("=" * 80)
        print()
        
        segments = result.get("segments", [])
        items = result.get("items", [])
        debug = result.get("_debug", {})
        
        print(f"Segments count: {len(segments)}")
        if segments:
            print("First 3 segments:")
            for i, seg in enumerate(segments[:3], 1):
                print(f"  {i}. {seg.get('text', '')[:80]}")
        print()
        
        print(f"Items before postprocess: {len(debug.get('raw_model_output', {}).get('items', []))}")
        print(f"Items after postprocess: {len(items)}")
        print()
        
        print("Final titles:")
        for i, item in enumerate(items, 1):
            title = item.get("text", "") or item.get("title", "")
            duration = item.get("duration_minutes")
            duration_str = f" ({duration} min)" if duration else ""
            print(f"  {i}. {title}{duration_str}")
        print()
        
        # Check for blobs
        from server import is_blob_title
        has_blob = False
        for item in items:
            title = item.get("text", "") or item.get("title", "")
            if is_blob_title(title):
                has_blob = True
                print(f"⚠️  BLOB DETECTED: {title[:100]}")
        
        if not has_blob and len(items) > 0:
            print("✓ No blobs detected")
        
        print()
        print("=" * 80)
        print("Debug Info")
        print("=" * 80)
        print()
        print(f"LLM called: {bool(debug.get('raw_model_output'))}")
        if debug.get('raw_model_output'):
            raw_items = debug.get('raw_model_output', {}).get('items', [])
            print(f"Raw items from LLM: {len(raw_items)}")
            if raw_items:
                print("First 3 raw items:")
                for i, item in enumerate(raw_items[:3], 1):
                    print(f"  {i}. {item.get('title', 'N/A')[:80]}")
        
    except Exception as e:
        print()
        print("=" * 80)
        print("ERROR")
        print("=" * 80)
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())







