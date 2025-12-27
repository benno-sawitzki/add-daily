#!/usr/bin/env python3
"""
Comprehensive debug script for extraction pipeline.
Tests each stage: segmentation → LLM → postprocessing → safety split → validation
Identifies exactly where items are lost.
"""
import os
import sys
import asyncio
import json
from pathlib import Path
from dotenv import load_dotenv

# Add backend to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

# Load environment variables
env_path = backend_dir / '.env'
if env_path.exists():
    load_dotenv(env_path)

from server import (
    extract_dump_items_from_transcript,
    postprocess_extraction_items,
    postprocess_safety_split,
    deterministic_extract_tasks
)
from task_extraction import (
    segment_transcript_fallback,
    validate_task,
    normalize_title
)

# Test transcript - Updated with "work on X and on Y" pattern
TEST_TRANSCRIPT = "I need to go to the police. I need to call Roberta and Tom. I need to call my mom. I need to work on the podcast for two hours and on the website for three hours."

EXPECTED_ITEMS = [
    "go to the police",
    "call Roberta",
    "call Tom",
    "call my mom",
    "work on the podcast for two hours",
    "work on the website for three hours"
]

def print_section(title):
    print("\n" + "=" * 80)
    print(title)
    print("=" * 80)

def print_subsection(title):
    print("\n" + "-" * 80)
    print(title)
    print("-" * 80)

async def main():
    print_section("COMPREHENSIVE EXTRACTION DEBUG")
    print(f"Test transcript: {TEST_TRANSCRIPT}")
    print(f"Expected items: {len(EXPECTED_ITEMS)}")
    for i, item in enumerate(EXPECTED_ITEMS, 1):
        print(f"  {i}. {item}")
    
    # STEP 1: Segmentation
    print_section("STEP 1: SEGMENTATION")
    segments = segment_transcript_fallback(TEST_TRANSCRIPT)
    print(f"Segments created: {len(segments)}")
    for seg in segments:
        print(f"  Segment {seg['i']}: \"{seg['text']}\"")
        print(f"    Length: {len(seg['text'])} chars")
    
    if len(segments) < 3:
        print("⚠️  WARNING: Expected at least 3 segments!")
    
    # STEP 2: LLM Extraction
    print_section("STEP 2: LLM EXTRACTION")
    trace_id = "debug-comprehensive-123"
    
    try:
        result = await extract_dump_items_from_transcript(
            transcript=TEST_TRANSCRIPT,
            provider="openai",
            model="gpt-4o-mini",
            whisper_segments=None,
            trace_id=trace_id,
            temperature_override=0.1
        )
        
        debug = result.get("_debug", {})
        raw_output = debug.get("raw_model_output", {})
        raw_items = raw_output.get("items", [])
        final_tasks = debug.get("final_tasks", [])
        items = result.get("items", [])
        
        print_subsection("Raw LLM Response")
        print(f"Raw items from LLM: {len(raw_items)}")
        print("\nRaw items by segment:")
        items_by_segment = {}
        for item in raw_items:
            seg_idx = item.get('segment_index', -1)
            if seg_idx not in items_by_segment:
                items_by_segment[seg_idx] = []
            items_by_segment[seg_idx].append(item)
        
        for seg_idx in sorted(items_by_segment.keys()):
            seg_items = items_by_segment[seg_idx]
            print(f"\n  Segment {seg_idx} ({len(seg_items)} items):")
            for i, item in enumerate(seg_items, 1):
                print(f"    {i}. Order {item.get('order_in_segment', '?')}: \"{item.get('title', 'N/A')}\"")
                print(f"       Type: {item.get('type', 'N/A')}, Source: \"{item.get('source_text', '')[:60]}\"")
        
        # Check for missing segments
        print_subsection("Segment Coverage Check")
        for seg in segments:
            seg_idx = seg['i']
            seg_items = [item for item in raw_items if item.get('segment_index') == seg_idx]
            if not seg_items:
                print(f"⚠️  WARNING: Segment {seg_idx} has NO items extracted!")
                print(f"   Segment text: \"{seg['text']}\"")
                # Check if it contains action verbs
                text_lower = seg['text'].lower()
                action_verbs = ['call', 'write', 'work', 'go', 'do', 'have', 'eat']
                has_actions = any(verb in text_lower for verb in action_verbs)
                if has_actions:
                    print(f"   ⚠️  Segment contains action verbs - should have items!")
            else:
                print(f"✓ Segment {seg_idx}: {len(seg_items)} item(s)")
        
        # STEP 3: Postprocessing Analysis
        print_section("STEP 3: POSTPROCESSING ANALYSIS")
        print(f"Input to postprocess_extraction_items: {len(raw_items)} items")
        print(f"Output from postprocess_extraction_items: {len(final_tasks)} tasks")
        
        if len(raw_items) > len(final_tasks):
            print(f"⚠️  WARNING: Lost {len(raw_items) - len(final_tasks)} items in postprocessing!")
        
        print("\nFinal tasks by segment:")
        tasks_by_segment = {}
        for task in final_tasks:
            seg_idx = task.get('segment_index', -1)
            if seg_idx not in tasks_by_segment:
                tasks_by_segment[seg_idx] = []
            tasks_by_segment[seg_idx].append(task)
        
        for seg_idx in sorted(tasks_by_segment.keys()):
            seg_tasks = tasks_by_segment[seg_idx]
            print(f"\n  Segment {seg_idx} ({len(seg_tasks)} tasks):")
            for i, task in enumerate(seg_tasks, 1):
                print(f"    {i}. Order {task.get('order_in_segment', '?')}: \"{task.get('title', 'N/A')}\"")
        
        # STEP 4: Safety Split Analysis
        print_section("STEP 4: SAFETY SPLIT ANALYSIS")
        items_before_split = len(items)
        print(f"Items before safety split: {items_before_split}")
        
        # Test safety split on items
        split_items = postprocess_safety_split(items, trace_id, "test-dump-id")
        items_after_split = len(split_items)
        print(f"Items after safety split: {items_after_split}")
        
        if items_after_split > items_before_split:
            print(f"✓ Safety split created {items_after_split - items_before_split} additional items")
        elif items_after_split < items_before_split:
            print(f"⚠️  WARNING: Safety split reduced items from {items_before_split} to {items_after_split}")
        
        # STEP 5: Validation Analysis
        print_section("STEP 5: VALIDATION ANALYSIS")
        print("Testing each expected item for validation:")
        for expected in EXPECTED_ITEMS:
            normalized = normalize_title(expected)
            is_valid, error = validate_task({"title": normalized})
            status = "✓" if is_valid else "✗"
            print(f"  {status} \"{expected}\" -> \"{normalized}\"")
            if not is_valid:
                print(f"      Error: {error}")
        
        # STEP 6: Final Results
        print_section("STEP 6: FINAL RESULTS")
        final_items = split_items if items_after_split > items_before_split else items
        print(f"Final items returned: {len(final_items)}")
        print("\nFinal items:")
        for i, item in enumerate(final_items, 1):
            title = item.get('text', '') or item.get('title', 'N/A')
            print(f"  {i}. \"{title}\"")
        
        # STEP 7: Comparison
        print_section("STEP 7: EXPECTED VS ACTUAL COMPARISON")
        actual_titles = [item.get('text', '').lower().strip() or item.get('title', '').lower().strip() for item in final_items]
        expected_titles = [exp.lower().strip() for exp in EXPECTED_ITEMS]
        
        print("\nExpected items:")
        for i, exp in enumerate(EXPECTED_ITEMS, 1):
            found = any(exp.lower().strip() in actual for actual in actual_titles)
            status = "✓" if found else "✗ MISSING"
            print(f"  {i}. {status} {exp}")
        
        print("\nActual items:")
        for i, actual in enumerate(actual_titles, 1):
            found = any(actual in exp.lower().strip() for exp in expected_titles)
            status = "✓" if found else "? UNEXPECTED"
            print(f"  {i}. {status} \"{final_items[i-1].get('text', '') or final_items[i-1].get('title', 'N/A')}\"")
        
        # STEP 8: Issue Detection
        print_section("STEP 8: ISSUE DETECTION")
        issues = []
        
        if len(segments) > 1 and len(raw_items) <= 1:
            issues.append(f"LLM only extracted {len(raw_items)} item(s) from {len(segments)} segments")
        
        segment_2_items = [item for item in raw_items if item.get('segment_index') == 2]
        if not segment_2_items:
            issues.append("No items extracted from segment 2 (contains 'call Oliver and Roberta or write them per WhatsApp and work on podcast')")
        
        segment_2_tasks = [task for task in final_tasks if task.get('segment_index') == 2]
        if segment_2_items and not segment_2_tasks:
            issues.append("Items from segment 2 were extracted but filtered out in postprocessing")
        
        if len(raw_items) > len(final_tasks):
            issues.append(f"Postprocessing reduced {len(raw_items)} items to {len(final_tasks)}")
        
        if len(final_items) < len(EXPECTED_ITEMS):
            issues.append(f"Only {len(final_items)} items returned, expected {len(EXPECTED_ITEMS)}")
        
        if issues:
            print("⚠️  ISSUES DETECTED:")
            for i, issue in enumerate(issues, 1):
                print(f"  {i}. {issue}")
        else:
            print("✓ No issues detected!")
        
        # STEP 9: Full Debug Info
        print_section("STEP 9: FULL DEBUG INFO")
        print(json.dumps(debug, indent=2, default=str))
        
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())

