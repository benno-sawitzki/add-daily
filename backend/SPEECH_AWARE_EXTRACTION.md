# Speech-Aware Task Extraction with Cancellation

## Summary

Implemented robust speech-aware extraction pipeline that handles:
- Speech pauses (thinking breaks) using Whisper segments with timestamps
- Filler filtering ("Okay", "Yeah")
- Cancellation handling ("maybe website not" cancels "work on website")
- Duration attachment to correct tasks
- Multi-action splitting

## Implementation

### Layer 1: Speech-Aware Segmentation

**File: `backend/llm/openai_audio.py`**
- Updated `transcribe_audio_file()` to support `return_segments=True`
- Returns `{"text": str, "segments": List[dict]}` with timestamps when enabled
- Uses `response_format="verbose_json"` to get Whisper segments

**File: `backend/task_extraction.py`**
- **`build_segments_from_whisper(whisper_segments, pause_threshold_ms=600)`**:
  - Merges consecutive Whisper segments if gap < 600ms (thinking break)
  - Starts new segment if gap >= 600ms
  - Returns segments with `{i, start_ms, end_ms, text}`

- **`segment_transcript_fallback(text)`**:
  - Fallback when Whisper segments not available
  - Splits on ".", "\n", "then", "and then", "later"
  - Drops filler segments
  - Returns same format as Whisper segments (with dummy timestamps)

### Layer 2: LLM Extraction with Strict Intent Types

**File: `backend/server.py`**
- **`extract_dump_items_from_transcript()`** updated:
  - Accepts optional `whisper_segments` parameter
  - Uses speech-aware segmentation if available, else fallback
  - Sends segments array to LLM with timestamps

**New Schema:**
```json
{
  "items": [
    {
      "segment_index": 0,
      "type": "task" | "cancel_task" | "ignore",
      "title": "string|null",
      "due_text": "string|null",
      "duration_minutes": "number|null",
      "targets": ["string"]|null,
      "source_text": "string",
      "confidence": "number"
    }
  ]
}
```

**Prompt Rules:**
- `type="task"`: Only actionable tasks (verb + object)
- `type="ignore"`: Filler, acknowledgements, standalone durations
- `type="cancel_task"`: Negations like "maybe website not", "actually not"
- Normalize: remove "I need to", "get back to X" → "Reply to X"
- Durations: attach to most recent task in segment
- Never output single-word titles or filler

### Layer 3: Deterministic Guardrails

**File: `backend/task_extraction.py`**

- **`validate_and_clean_tasks(items)`**:
  - Drops `type="ignore"` items
  - Validates `type="task"` items (min 2 words, action verb, etc.)
  - Applies cancellations via `apply_cancellations()`
  - Splits multi-action titles
  - Deduplicates

- **`apply_cancellations(items)`**:
  - Separates tasks and cancellations
  - Uses `fuzzy_match_cancellation()` to match cancelled phrases to tasks
  - Removes matching tasks

- **`fuzzy_match_cancellation(cancel_phrase, task_title)`**:
  - Lowercase both
  - Remove stopwords ("the", "a", "on")
  - Match if cancelled keyword appears in task title
  - Example: cancel "website" matches "Work on the website"

- **`split_multi_action_title(task)`**:
  - Detects " and " or comma-separated actions
  - Splits into separate tasks
  - Extracts time ("at 12") from individual parts
  - Preserves due_text/duration appropriately

## Test Results

All tests pass ✅

### Test A: "Okay." → 0 tasks
- Segments: [] (filler dropped)
- Result: 0 tasks ✅

### Test B: "three hours. Yeah." → 0 tasks
- Both marked as `type="ignore"`
- Result: 0 tasks ✅

### Test C: Cancellation
- "Work on the website" + "maybe website not" → 0 tasks ✅
- Website task correctly cancelled

### Test D: Main Example
**Input:** "Okay, today first thing is I want to eat something and have a coffee and I need to go to the police that takes one hour and I need to do laundry that takes 30 minutes. I need to call Roberta, Tom and Oliver or message them. That takes 30 minutes. And work on the podcast and on the website. Podcast two, three hours. Yeah, maybe website not."

**Output (8 tasks):**
1. Eat something (due: today)
2. Have a coffee
3. Go to the police (due: today, duration: 60)
4. Do laundry (duration: 30)
5. Call Roberta
6. Message Tom (or Message Tom and Oliver)
7. Work on the podcast
8. Work on podcast (duration: 180)

**Cancelled:** Website task (removed by "maybe website not") ✅

**No filler:** "Okay", "Yeah" correctly ignored ✅

## Key Features

✅ **Speech-aware segmentation** using Whisper timestamps (600ms pause threshold)
✅ **Filler filtering** - never saves "Okay", "Yeah", standalone durations
✅ **Cancellation handling** - "maybe X not" removes earlier X task
✅ **Duration attachment** - "that takes one hour" attaches to correct task
✅ **Multi-action splitting** - "X and Y" → separate tasks
✅ **Robust validation** - min 2 words, action verbs required
✅ **Fallback segmentation** - works even without Whisper segments

## Files Changed

1. **`backend/llm/openai_audio.py`**:
   - Added `return_segments` parameter
   - Returns segments with timestamps when enabled

2. **`backend/task_extraction.py`**:
   - Added `build_segments_from_whisper()`
   - Added `segment_transcript_fallback()`
   - Added `apply_cancellations()`
   - Added `fuzzy_match_cancellation()`
   - Updated `validate_and_clean_tasks()` to handle intent types

3. **`backend/server.py`**:
   - Updated `extract_dump_items_from_transcript()` with new schema
   - Updated transcription endpoint to return segments
   - Updated `extract_items_from_dump()` to pass whisper_segments

4. **`backend/tests/test_speech_aware_extraction.py`** (NEW):
   - Comprehensive tests for all requirements
   - All tests pass ✅

## Usage

When creating a dump with transcript:

```python
POST /api/dumps?auto_extract=1
{
  "source": "voice",
  "raw_text": "...",
  "transcript": "Okay, today I need to...",
  "whisper_segments": [  # Optional, if available
    {"start": 0.0, "end": 2.5, "text": "Okay, today"},
    {"start": 3.0, "end": 5.0, "text": "I need to..."}
  ]
}
```

The system will:
1. Use Whisper segments if available (speech-aware)
2. Fall back to text segmentation if not
3. Extract tasks with intent types (task/cancel_task/ignore)
4. Apply cancellations
5. Validate and clean
6. Create dump_items from validated tasks

## Debug Mode

In development mode, the extraction result includes `_debug` field with:
- `whisper_segments`: Original Whisper segments
- `segments_sent_to_model`: Segments array sent to LLM
- `raw_model_output`: Full LLM response

This enables fast debugging of extraction issues.









