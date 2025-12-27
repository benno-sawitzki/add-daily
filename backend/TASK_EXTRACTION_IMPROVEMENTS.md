# Task Extraction Improvements

## Summary

Improved task extraction from dump transcripts to reliably output clean, actionable tasks and prevent single-word or fragmented tasks.

## Changes Made

### 1. New Module: `backend/task_extraction.py`

Added utilities for preprocessing, validation, and post-processing:

- **`preprocess_transcript()`**: Normalizes whitespace and splits on separators ("then", "and then", "later", ";", "/")
- **`validate_task()`**: Validates tasks meet requirements (min 2 words, min 6 chars, actionable)
- **`deduplicate_tasks()`**: Removes duplicate tasks (case-insensitive)
- **`postprocess_tasks()`**: Orchestrates validation and deduplication, returns dropped tasks with reasons

### 2. Updated `get_ai_response()` in `backend/server.py`

**Preprocessing:**
- Transcript is preprocessed before sending to AI to improve splitting accuracy

**Updated Prompt:**
- Stricter rules: Never output single-word tasks
- Title must be actionable (verb + object)
- Must be 3-80 characters, minimum 2 words
- Normalize "get back to X" → "Reply to X" or "Get back to X"
- Parse time cues: "today", "tomorrow", "next week" → `due_text` field
- Parse durations: "for 2 hours" → `duration_minutes: 120`
- Split on: "then", "and then", "later", "after that", commas, repeated phrases
- Avoid filler words: "I think", "you know", "basically"

**Post-processing:**
- All extracted tasks are validated
- Invalid tasks are dropped with reasons logged
- Deduplication removes near-identical tasks
- Retry mechanism if all tasks fail validation
- Debug logging in development mode

**New Schema:**
```json
{
  "tasks": [
    {
      "title": "string (3-80 chars, min 2 words, actionable)",
      "notes": "string or null",
      "due_text": "today | tomorrow | next week | null",
      "duration_minutes": number or null,
      "source_text": "exact phrase from transcript",
      "confidence": 0.0-1.0
    }
  ]
}
```

### 3. Updated `transform_task_to_frontend_format()`

- Handles new `due_text` field (appends to notes)
- Backward compatible with `due_date` field
- Preserves `duration_minutes` from AI extraction

### 4. Tests: `backend/tests/test_task_extraction.py`

Unit tests covering:
- Preprocessing (whitespace, separators)
- Validation (valid tasks, fragments, stopwords)
- Deduplication
- Example transcript (4 tasks expected)
- Test cases A, B, C from requirements

## Example Output

**Input:**
```
"Go to the police today, then I need to get back to Tom, get back to Oliver and work on a website for two hours."
```

**Output (4 tasks):**
1. "Go to the police" (due: today)
2. "Get back to Tom"
3. "Get back to Oliver"
4. "Work on a website" (duration: 120 minutes)

## Validation Rules

Tasks are rejected if:
- Title has fewer than 2 words
- Title is shorter than 6 characters
- Title is a single stopword ("police", "Tom", "website", etc.)
- Title is a single word (even if not in stopwords)

## Error Handling

- If all tasks fail validation, system retries once with stricter prompt
- If retry also fails, returns empty list with error message and debug info
- Debug logging in development mode shows raw AI response when validation fails

## Files Changed

1. `backend/task_extraction.py` (NEW) - Extraction utilities
2. `backend/server.py` - Updated `get_ai_response()` and `transform_task_to_frontend_format()`
3. `backend/tests/test_task_extraction.py` (NEW) - Unit tests
4. `backend/test_extraction_simple.py` (NEW) - Simple test script (no pytest required)

## Testing

Run tests:
```bash
python3 backend/test_extraction_simple.py
```

Or with pytest:
```bash
pytest backend/tests/test_task_extraction.py -v
```

## Acceptance Criteria ✅

- ✅ Example transcript produces exactly 4 clean tasks
- ✅ No single-word tasks are saved
- ✅ Titles are actionable (verb + object)
- ✅ System handles validation failures gracefully
- ✅ Debug logging for failed extractions
- ✅ Unit tests cover all requirements









