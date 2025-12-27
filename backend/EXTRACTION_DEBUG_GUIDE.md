# Extraction Debug Guide

This guide explains how to investigate dump extraction mismatches using the new debugging infrastructure.

## Quick Start

1. **Save a dump** with the problematic transcript
2. **Check logs** for structured JSON logs with `stage` field
3. **Call debug endpoint** to see full extraction details
4. **Run reproduction script** to test extraction locally

## Debug Endpoint

**URL**: `GET /api/debug/dumps/{dump_id}/extraction`

**Example**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8010/api/debug/dumps/{dump_id}/extraction
```

**Returns**:
```json
{
  "dump_id": "...",
  "trace_id": "abc12345",
  "segments": [...],
  "llm_raw": {...},
  "final_tasks": [...],
  "insert_payload": [...],
  "fallback_reason": null,
  "db_dump_items": [...],
  "db_dump_items_count": 8,
  "transcript_length": 250
}
```

## Structured Logging

All extraction stages log JSON with `stage` and `trace_id`:

### Log Stages

1. **`dump_save_received`**
   - When dump save request is received
   - Fields: `dump_id`, `trace_id`, `transcript_length`, `raw_text_length`

2. **`segments_built`**
   - After segmentation
   - Fields: `dump_id`, `trace_id`, `segment_count`, `first_3_segments`

3. **`llm_called`**
   - When LLM API is called
   - Fields: `trace_id`, `model`, `segment_count`

4. **`llm_returned`**
   - When LLM response is received
   - Fields: `dump_id`, `trace_id`, `raw_item_count`, `model`

5. **`postprocess_done`**
   - After postprocessing
   - Fields: `dump_id`, `trace_id`, `final_task_count`, `final_titles`

6. **`suspicious_low_task_count`** (ERROR)
   - When transcript > 50 chars but final_task_count <= 2
   - Fields: `dump_id`, `trace_id`, `transcript_length`, `final_task_count`, `segments_count`, `llm_raw_snippet`

7. **`db_insert_begin`**
   - Before inserting dump_items
   - Fields: `dump_id`, `trace_id`, `insert_count`

8. **`db_insert_done`**
   - After inserting dump_items
   - Fields: `dump_id`, `trace_id`, `inserted_count`, `db_confirmed_count`

9. **`triage_fetch`**
   - When To Triage endpoint fetches dump_items
   - Fields: `dump_id`, `row_count`, `first_3_titles`

10. **`extract_error`** (ERROR)
    - When extraction fails
    - Fields: `dump_id`, `trace_id`, `error`, `error_type`

11. **`fallback_text_splitting`**
    - When falling back to text splitting
    - Fields: `dump_id`, `trace_id`, `fallback_reason`

12. **`safety_split_applied`**
    - When safety split splits a bundled task
    - Fields: `dump_id`, `trace_id`, `original_title`, `split_count`, `resulting_titles`

## Extraction Debug Storage

The `extraction_debug` JSONB column in `dumps` table stores:
- `trace_id`: Unique trace ID for this extraction
- `segments`: Segments sent to LLM
- `llm_raw`: Raw LLM JSON response
- `final_tasks`: Tasks after postprocessing
- `insert_payload`: What was inserted into dump_items
- `fallback_reason`: Why fallback was used (if any)
- `suspicious_low_count`: Boolean flag if count was suspicious
- `needs_review`: Boolean flag for manual review

**Only stored when**:
- `ENV=development` OR
- `EXTRACT_DEBUG=1`

## Database Migration

Run the migration to add the `extraction_debug` column:

```bash
# Option 1: Using psql
psql $DATABASE_URL -f backend/migrations/add_extraction_debug_column.sql

# Option 2: Using Python script (if you have one)
python backend/run_migration.py add_extraction_debug_column.sql
```

## Reproduction Script

Test extraction locally without saving a dump:

```bash
cd backend
python scripts/repro_dump_extraction.py "Okay, today first thing is I want to eat something..."
```

Or from a file:
```bash
python scripts/repro_dump_extraction.py --file transcript.txt
```

This prints:
- Segments built
- LLM raw output
- Final tasks
- Items for DB insert
- After safety split

## Log Lines to Look For

### In Server Logs (stdout/stderr)

Look for JSON lines with `"stage"` field:

```bash
# Filter for extraction logs
grep '"stage"' server.log | jq .

# Filter for a specific dump
grep '"dump_id": "abc-123"' server.log | jq .

# Filter for a specific trace
grep '"trace_id": "abc12345"' server.log | jq .

# Find suspicious low counts
grep '"stage": "suspicious_low_task_count"' server.log | jq .
```

### Key Log Patterns

1. **Check if extraction ran**:
   ```
   {"stage": "dump_save_received", "dump_id": "...", "trace_id": "..."}
   ```

2. **Check segment count**:
   ```
   {"stage": "segments_built", "segment_count": 6, ...}
   ```

3. **Check LLM output**:
   ```
   {"stage": "llm_returned", "raw_item_count": 15, ...}
   ```

4. **Check final count**:
   ```
   {"stage": "postprocess_done", "final_task_count": 8, ...}
   ```

5. **Check DB insert**:
   ```
   {"stage": "db_insert_done", "inserted_count": 8, "db_confirmed_count": 8, ...}
   ```

6. **Check To Triage fetch**:
   ```
   {"stage": "triage_fetch", "dump_id": "...", "row_count": 2, ...}
   ```

## Troubleshooting

### Problem: Tests show 8 tasks but UI shows 2

1. **Check logs for trace_id**:
   ```bash
   grep '"dump_save_received"' server.log | tail -1 | jq .trace_id
   ```

2. **Check all stages for that trace**:
   ```bash
   TRACE_ID="abc12345"
   grep "\"trace_id\": \"$TRACE_ID\"" server.log | jq .
   ```

3. **Check if safety split was applied**:
   ```bash
   grep '"stage": "safety_split_applied"' server.log | jq .
   ```

4. **Check if fallback was used**:
   ```bash
   grep '"stage": "fallback_text_splitting"' server.log | jq .
   ```

5. **Call debug endpoint**:
   ```bash
   curl http://localhost:8010/api/debug/dumps/{dump_id}/extraction
   ```

6. **Compare**:
   - `final_tasks` count vs `db_dump_items_count`
   - `insert_payload` vs `db_dump_items`

### Problem: Suspicious low task count

If you see `"stage": "suspicious_low_task_count"`:

1. Check `llm_raw_snippet` - did LLM bundle tasks?
2. Check `segments_count` - were segments built correctly?
3. Check if safety split was applied
4. Run reproduction script with same transcript

### Problem: Fallback was used

If you see `"stage": "fallback_text_splitting"`:

1. Check `fallback_reason` in debug endpoint
2. Check error logs for `"stage": "extract_error"`
3. Verify `OPENAI_API_KEY` is set
4. Check if transcript is empty or too short

## Safety Split

The `postprocess_safety_split()` function runs AFTER normal postprocessing to catch bundled tasks.

It splits on:
- `. ` (sentence boundaries)
- ` Then `
- ` I need to `
- ` I want to `

Example:
```
Input: "I want to go to the gym. That takes two hours. Then I want to have lunch for one hour. I need to message Tom"

Output:
- Go to the gym (duration 120)
- Have lunch (duration 60)
- Message Tom
```

## Files

- **Debug endpoint**: `backend/server.py` line ~4397
- **Safety split**: `backend/server.py` line ~701
- **Structured logging**: Throughout `extract_items_from_dump()` and `extract_dump_items_from_transcript()`
- **Debug storage**: `extract_items_from_dump()` stores to `dumps.extraction_debug`
- **Reproduction script**: `backend/scripts/repro_dump_extraction.py`
- **Migration**: `backend/migrations/add_extraction_debug_column.sql`







