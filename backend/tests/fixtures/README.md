# Test Fixtures

This directory contains test fixtures for development and testing.

## ⚠️ Warning: Personal Data

**These fixtures may contain personal data from real dumps.**
- Do NOT commit fixture files to git
- Keep fixtures local only
- Fixtures are automatically ignored by `.gitignore`

## Workflow: Building a Golden Dataset

### Step 1: Seed Local Dumps (Development Only)

Seed the local database with example dumps for testing:

```bash
cd backend
python scripts/seed_dumps_local.py
```

**Safety**: This script only runs if:
- `DATABASE_URL` points to `localhost` or `127.0.0.1`, OR
- `ENV=local` is set

This prevents accidentally seeding production databases.

The script inserts 10 example dumps with realistic messy transcripts containing:
- Filler words ("okay", "yeah")
- Thinking breaks
- Durations ("takes 30 minutes", "two hours")
- Cancellations ("maybe website not")

### Step 2: Export Dumps

Export the latest N dump transcripts to a fixture file:

```bash
cd backend
python scripts/export_dump_transcripts.py --limit 50
```

Options:
- `--limit N`: Number of transcripts to export (default: 50)
- `--out PATH`: Output file path (default: `backend/tests/fixtures/dumps_raw.json`)

This creates `dumps_raw.json` with exported transcripts.

### Step 3: Create Golden Dataset

Scaffold the golden dataset from raw exports:

```bash
cd backend
python scripts/make_golden_from_raw.py
```

This creates `dumps_golden.json` with the first 10 dumps as placeholders.
Each entry has an empty `expected_tasks` array that you need to fill manually.

**Next**: Open `backend/tests/fixtures/dumps_golden.json` and fill in `expected_tasks` for each entry:

```json
{
  "id": "gold-001",
  "transcript": "...",
  "expected_tasks": [
    {
      "title": "Go to the police",
      "due_text": "today",
      "duration_minutes": 60
    },
    {
      "title": "Do laundry",
      "duration_minutes": 30
    }
  ]
}
```

### Step 4: Record LLM Fixtures

Record real LLM responses for labeled entries:

```bash
cd backend
python scripts/record_llm_fixtures.py --only gold-001 --force
```

Or record all labeled entries:

```bash
python scripts/record_llm_fixtures.py --force
```

Options:
- `--only <id>`: Record only this entry
- `--model <model>`: OpenAI model to use (default: gpt-4o-mini)
- `--force`: Overwrite existing fixtures

This creates fixture files in `tests/fixtures/llm_responses/`:
- `<id>.json`: Raw LLM response
- `<id>.meta.json`: Metadata (segments, prompt version, timestamp)

### Step 5: Run Regression Tests

Once fixtures are recorded, run the regression test suite:

```bash
cd backend
pytest tests/test_task_extraction_golden.py -v
```

**Note**: 
- Tests are automatically skipped for entries where `expected_tasks` is empty
- Tests will fail if `expected_tasks` is filled but fixture is missing (run record script first)

The tests:
- Replay recorded LLM fixtures (no OpenAI calls)
- Run deterministic postprocessing (validation, splitting, duration attach, cancellation, ordering)
- Compare extracted tasks against expected tasks
- Show readable diffs for mismatches
- Check duration and due_text when specified

## Available Scripts

### 1. Find Dump Storage Location

Discover where dump transcripts are stored in the database:

```bash
cd backend
python scripts/find_dump_storage.py
```

This script will:
- Search the database schema for dump-related tables/columns
- Show candidate storage locations with sample data
- Recommend the best match

### 2. Seed Local Dumps

```bash
cd backend
python scripts/seed_dumps_local.py
```

Inserts 10 example dumps into the local database (safety checks included).

### 3. Export Dump Transcripts

```bash
cd backend
python scripts/export_dump_transcripts.py --limit 50
```

Exports transcripts to `dumps_raw.json`.

### 4. Create Golden Dataset

```bash
cd backend
python scripts/make_golden_from_raw.py
```

Scaffolds `dumps_golden.json` from raw exports.

## Storage Location

Based on code analysis:
- **Table**: `dumps`
- **Transcript column**: `transcript`
- **Created column**: `created_at`
- **ID column**: `id`

The export script auto-discovers this location, but you can verify with `find_dump_storage.py`.

## File Formats

### dumps_raw.json

Exported transcripts with metadata:

```json
[
  {
    "id": "uuid-string",
    "created_at": "2024-01-01T12:00:00+00:00",
    "transcript": "Full transcript text here..."
  }
]
```

### dumps_golden.json

Golden dataset with expected extraction results:

```json
[
  {
    "id": "gold-001",
    "original_id": "uuid-string",
    "created_at": "2024-01-01T12:00:00+00:00",
    "transcript": "Full transcript text here...",
    "expected_tasks": [
      {
        "title": "Task title",
        "due_text": "today",
        "duration_minutes": 60
      }
    ]
  }
]
```

## Usage

These fixtures can be used for:
- Testing task extraction pipelines
- Building golden datasets for regression testing
- Debugging extraction issues
- Training/validating extraction models

