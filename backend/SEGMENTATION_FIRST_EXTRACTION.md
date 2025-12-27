# Segmentation-First Task Extraction Implementation

## Summary

Implemented robust segmentation-first prompting for dump transcript → extracted dump_items. This approach deterministically segments transcripts before sending to the LLM, resulting in more reliable task extraction.

## Implementation

### 1. Deterministic Preprocessing and Segmentation

**File: `backend/task_extraction.py`**

- **`preprocess_transcript(text)`**: Normalizes whitespace and replaces separators:
  - " and then " → ". "
  - " then " → ". "
  - " later " → ". "
  - " after that " → ". "
  - ";" → ". "
  - " / " → ". "
  - Keeps commas

- **`is_filler_segment(segment)`**: Detects filler words:
  - ["ok", "okay", "alright", "cool", "nice", "yeah", "yep", "nope", "hmm", "uh", "um", "right"]

- **`segment_transcript(text)`**: 
  - Calls `preprocess_transcript`
  - Splits on "." and "\n"
  - Trims each segment
  - Drops empty segments
  - Drops filler segments
  - Returns list of clean segments

### 2. Segmentation-First LLM Call

**File: `backend/server.py`**

- **`extract_dump_items_from_transcript(transcript, provider, model)`**:
  - Segments transcript deterministically
  - Sends segments array to LLM (not single transcript)
  - LLM returns tasks with `segment_index`
  - Validates and cleans tasks
  - Optionally splits multi-action titles

**Prompt Structure:**
```
SYSTEM: Task extraction engine rules
USER: Schema + Segments JSON array
```

**Response Schema:**
```json
{
  "tasks": [
    {
      "segment_index": 0,
      "title": "string",
      "notes": "string|null",
      "due_text": "string|null",
      "duration_minutes": "number|null",
      "source_text": "string",
      "confidence": "number"
    }
  ]
}
```

### 3. Post-Processing Validation and Cleanup

**File: `backend/task_extraction.py`**

- **`normalize_title(title)`**:
  - Removes "I need to", "I have to", "I should"
  - Strips trailing punctuation
  - Collapses whitespace

- **`validate_task(task)`**:
  - Title must have ≥2 words
  - Title must be ≥6 characters
  - Title must not be filler
  - Title must be actionable (verb + object for short titles)
  - Checks action verbs and action patterns

- **`validate_and_clean_tasks(tasks)`**:
  - Normalizes all titles
  - Validates each task
  - Drops invalid tasks with reasons
  - Splits multi-action titles
  - Re-validates split tasks
  - Deduplicates

### 4. Optional Last-Mile Split Pass

**File: `backend/task_extraction.py`**

- **`split_multi_action_title(task)`**:
  - Detects " and " or comma-separated actions
  - Splits into separate tasks
  - Extracts time ("at 12") from individual parts
  - Preserves due_text/duration on appropriate tasks

### 5. Integration

**File: `backend/server.py`**

- **`extract_items_from_dump()`** updated:
  - Accepts optional `transcript` parameter
  - Uses AI extraction if transcript available
  - Falls back to text splitting if no transcript or AI fails

- **`create_dump()` endpoint**:
  - Passes `transcript` to extraction function
  - Uses segmentation-first extraction when transcript present

## Test Results

All tests pass ✅

### Test A: "Okay."
- **Segments**: [] (filler dropped)
- **Tasks**: 0 ✅

### Test B: Main Example
**Input:** "Go to the police today, then I need to get back to Tom, get back to Oliver and work on a website for two hours."

**Segments:**
1. "Go to the police today,"
2. "I need to get back to Tom, get back to Oliver and work on a website for two hours"

**Output (4 tasks):**
1. "Go to the police" (due_text: "today")
2. "Get back to Tom"
3. "Get back to Oliver"
4. "Work on a website" (duration_minutes: 120)

✅ All tasks are actionable, no fragments

### Test C: Multi-Action Split
**Input:** "do laundry and have a coffee and go to lunch at 12"

**Segments:**
1. "do laundry and have a coffee and go to lunch at 12"

**Output (3 tasks after splitting):**
1. "do laundry"
2. "have a coffee"
3. "go to lunch" (due_text: "at 12")

✅ Multi-action chain properly split

### Test D: Name-Only Fragment
**Input:** "Roberta and Oliver that takes 30 minutes"

**Segments:**
1. "Roberta and Oliver that takes 30 minutes"

**Output:** 0 tasks ✅

**Reason:** No action verb, name-only fragment correctly rejected

## Key Features

✅ **Never saves single-word tasks**
✅ **Never saves filler-only tasks** ("okay", "yeah", etc.)
✅ **Multi-action chains become separate tasks**
✅ **Name-only fragments are dropped** (unless they include action verb)
✅ **Deterministic segmentation** before LLM call
✅ **Robust validation** with clear error messages
✅ **Graceful fallback** to text splitting if AI fails

## Files Changed

1. **`backend/task_extraction.py`**:
   - Added segmentation functions
   - Added filler detection
   - Enhanced validation with action verb checking
   - Added title normalization
   - Added multi-action splitting

2. **`backend/server.py`**:
   - Added `extract_dump_items_from_transcript()` function
   - Updated `extract_items_from_dump()` to use AI when transcript available
   - Updated `create_dump()` to pass transcript

3. **`backend/tests/test_segmentation_extraction.py`** (NEW):
   - Comprehensive tests for all requirements
   - All tests pass ✅

## Usage

When creating a dump with `auto_extract=1` and a `transcript` field:

```python
POST /api/dumps?auto_extract=1
{
  "source": "voice",
  "raw_text": "...",
  "transcript": "Go to the police today, then get back to Tom..."
}
```

The system will:
1. Segment the transcript
2. Send segments to LLM
3. Extract tasks with validation
4. Create dump_items from validated tasks

If transcript is not available, falls back to simple text splitting.






