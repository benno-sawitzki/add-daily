# Extraction Improvement Loop

This document describes the golden dataset + fixture replay workflow for improving task extraction.

## Overview

The extraction improvement loop allows you to:
1. Record real LLM responses for golden dataset entries
2. Replay those fixtures in tests (no OpenAI calls)
3. Iterate on extraction logic until tests pass

## Workflow

### Step 1: Seed Local Dumps (Development Only)

```bash
cd backend
python scripts/seed_dumps_local.py
```

**Safety**: Only runs if `DATABASE_URL` points to `localhost` or `ENV=local`.

### Step 2: Export Dumps

```bash
python scripts/export_dump_transcripts.py --limit 50
```

Creates `backend/tests/fixtures/dumps_raw.json` with exported transcripts.

### Step 3: Create Golden Dataset

```bash
python scripts/make_golden_from_raw.py
```

Creates `backend/tests/fixtures/dumps_golden.json` with placeholders.

### Step 4: Label Expected Tasks

Manually edit `backend/tests/fixtures/dumps_golden.json` to fill `expected_tasks` for each entry:

```json
{
  "id": "gold-001",
  "transcript": "Okay, today first thing is I want to eat something...",
  "expected_tasks": [
    {
      "title": "Eat something",
      "due_text": "today"
    },
    {
      "title": "Have a coffee"
    },
    {
      "title": "Go to the police",
      "due_text": "today",
      "duration_minutes": 60
    }
  ]
}
```

### Step 5: Record LLM Fixtures

Record real LLM responses for labeled entries:

```bash
# Record one entry
python scripts/record_llm_fixtures.py --only gold-001 --force

# Record all labeled entries
python scripts/record_llm_fixtures.py --force

# Use different model
python scripts/record_llm_fixtures.py --model gpt-4o --force
```

This creates:
- `backend/tests/fixtures/llm_responses/<id>.json` - Raw LLM response
- `backend/tests/fixtures/llm_responses/<id>.meta.json` - Metadata (segments, prompt version, timestamp)

### Step 6: Run Regression Tests

```bash
# With pytest (if installed)
pytest tests/test_task_extraction_golden.py -v

# Or run directly (no pytest required)
python tests/test_task_extraction_golden.py
```

Tests will:
- Replay recorded fixtures (no OpenAI calls)
- Run deterministic postprocessing (validation, splitting, duration attach, cancellation, ordering)
- Compare extracted tasks to expected tasks
- Show readable diffs for mismatches

### Step 7: Iterate

If tests fail:
1. Review the diff to see what's wrong
2. Fix the extraction logic in `backend/server.py`:
   - `extract_dump_items_from_transcript()` - LLM prompt and schema
   - `postprocess_extraction_items()` - Deterministic postprocessing
3. Re-run tests to verify fix
4. If prompt changed, increment `PROMPT_VERSION` and re-record fixtures

## Files

- `backend/scripts/record_llm_fixtures.py` - Record LLM responses
- `backend/tests/test_task_extraction_golden.py` - Test harness (replays fixtures)
- `backend/tests/fixtures/dumps_golden.json` - Golden dataset (expected tasks)
- `backend/tests/fixtures/llm_responses/` - Recorded LLM fixtures (gitignored)

## Prompt Versioning

The extraction function includes `PROMPT_VERSION = "v1"` in `backend/server.py`.
When you change the prompt:
1. Increment the version (e.g., `PROMPT_VERSION = "v2"`)
2. Re-record fixtures: `python scripts/record_llm_fixtures.py --force`
3. The metadata files will track which prompt version produced each fixture

## Example: Full Loop

```bash
# 1. Seed test data
python scripts/seed_dumps_local.py

# 2. Export
python scripts/export_dump_transcripts.py --limit 50

# 3. Create golden scaffold
python scripts/make_golden_from_raw.py

# 4. Manually label expected_tasks in dumps_golden.json

# 5. Record fixtures
python scripts/record_llm_fixtures.py --only gold-001 --force

# 6. Run tests
python tests/test_task_extraction_golden.py

# 7. If tests fail, fix extraction logic and repeat from step 6
```

## Acceptance Criteria

✅ Record script produces fixture files for labeled golden entries  
✅ Golden tests replay fixtures and compare extracted tasks to expected  
✅ After prompt/logic tweaks, the messy transcript case passes:
  - Correct order
  - Durations attached
  - Website cancelled by "maybe website not"
  - No filler tasks






