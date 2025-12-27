#!/usr/bin/env python3
"""
Check the most recent dump and its extracted items to debug missing tasks.
"""
import os
import sys
import asyncio
import asyncpg
from pathlib import Path
from dotenv import load_dotenv
import json

# Load environment variables
backend_dir = Path(__file__).parent.parent
env_path = backend_dir / '.env'
if env_path.exists():
    load_dotenv(env_path)

DATABASE_URL = os.environ.get('DATABASE_URL')
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set")
    sys.exit(1)

async def check_recent_dump():
    """Check the most recent dump and its items"""
    conn = await asyncpg.connect(DATABASE_URL)
    
    try:
        # Get the most recent dump
        dump = await conn.fetchrow("""
            SELECT id, user_id, created_at, source, raw_text, transcript, extraction_status, extraction_item_count, extraction_error
            FROM dumps
            ORDER BY created_at DESC
            LIMIT 1
        """)
        
        if not dump:
            print("No dumps found in database")
            return
        
        print("=" * 80)
        print("MOST RECENT DUMP:")
        print("=" * 80)
        print(f"ID: {dump['id']}")
        print(f"Created: {dump['created_at']}")
        print(f"Source: {dump['source']}")
        print(f"Extraction Status: {dump['extraction_status']}")
        print(f"Extraction Item Count: {dump['extraction_item_count']}")
        print(f"Extraction Error: {dump['extraction_error']}")
        print(f"\nRaw Text:\n{dump['raw_text']}")
        print(f"\nTranscript:\n{dump['transcript']}")
        
        # Get all items for this dump
        items = await conn.fetch("""
            SELECT id, text, status, created_at, created_task_id
            FROM dump_items
            WHERE dump_id = $1
            ORDER BY created_at ASC
        """, dump['id'])
        
        print("\n" + "=" * 80)
        print(f"EXTRACTED ITEMS ({len(items)}):")
        print("=" * 80)
        for i, item in enumerate(items, 1):
            print(f"{i}. [{item['status']}] {item['text']}")
            if item['created_task_id']:
                print(f"   → Created task: {item['created_task_id']}")
        
        # Check if we're missing the "work on" tasks
        raw_text_lower = (dump['raw_text'] or '').lower()
        transcript_lower = (dump['transcript'] or '').lower()
        has_work_on = 'work on' in raw_text_lower or 'work on' in transcript_lower
        
        if has_work_on:
            print("\n" + "=" * 80)
            print("ANALYSIS:")
            print("=" * 80)
            work_on_items = [item for item in items if 'work on' in item['text'].lower()]
            print(f"✓ Dump contains 'work on' pattern: YES")
            print(f"✓ Items with 'work on' in text: {len(work_on_items)}")
            if len(work_on_items) == 0:
                print("❌ PROBLEM: Dump has 'work on' pattern but NO items extracted!")
            elif len(work_on_items) < 2:
                print(f"⚠️  WARNING: Dump has 'work on X and on Y' pattern but only {len(work_on_items)} item(s) extracted (expected 2)")
            else:
                print(f"✓ Found {len(work_on_items)} 'work on' items")
                for item in work_on_items:
                    print(f"  - {item['text']}")
        
        # Check expected vs actual
        expected_tasks = [
            "go to the police",
            "call Roberta",
            "call Tom", 
            "call my mom",
            "work on the podcast for two hours",
            "work on the website for three hours"
        ]
        
        print("\n" + "=" * 80)
        print("EXPECTED vs ACTUAL:")
        print("=" * 80)
        item_texts = [item['text'].lower().strip() for item in items]
        for expected in expected_tasks:
            expected_lower = expected.lower().strip()
            found = any(expected_lower in item_text or item_text in expected_lower for item_text in item_texts)
            status = "✓" if found else "✗"
            print(f"{status} {expected}")
            if not found:
                # Check for partial matches
                partial_matches = [item['text'] for item in items if any(word in item['text'].lower() for word in expected_lower.split() if len(word) > 3)]
                if partial_matches:
                    print(f"   Partial matches: {partial_matches}")
        
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(check_recent_dump())





