# Dump Sessions + Dump Items Implementation

This document describes the new dump implementation following the contract.

## Migration

Run the migration first:
```sql
-- See backend/migrations/update_dumps_schema.sql
```

This updates:
- `dumps` table: removes `transcript`, `clarified_at`, `archived_at`; adds `status` (captured|processed)
- `dump_items` table: removes `status`, `snooze_until`, `linked_task_id`; adds `extracted_order`, `state` (new|converted|discarded), `user_id`

## New Models

```python
class Dump(BaseModel):
    id: str
    user_id: str
    source: str  # 'voice' or 'text'
    raw_text: str
    created_at: str
    status: str  # 'captured' or 'processed'

class DumpCreate(BaseModel):
    source: str
    raw_text: str

class DumpItem(BaseModel):
    id: str
    dump_id: str
    user_id: str
    text: str
    extracted_order: int
    state: str  # 'new', 'converted', or 'discarded'
    created_at: str

class DumpWithItems(BaseModel):
    dump: Dump
    items: List[DumpItem] = []

class TriageRequest(BaseModel):
    item_ids: List[str]
    target: str  # 'INBOX', 'NEXT_TODAY', or 'LATER'
```

## New Endpoints

1. **POST /api/dumps**
   - Creates dump with status='captured'
   - Returns dump + items = []

2. **GET /api/dumps?limit=20&offset=0**
   - Lists dumps (no tasks)
   - Paginated with limit/offset

3. **GET /api/dumps/{dump_id}**
   - Returns dump + dump_items

4. **POST /api/dumps/{dump_id}/extract**
   - Runs AI extraction using existing `get_ai_response()`
   - Creates dump_items with extracted_order
   - Sets dump.status = 'processed'

5. **POST /api/dumps/{dump_id}/triage**
   - Converts dump_items to tasks
   - Marks items.state = 'converted'
   - Target: INBOX → status='inbox', NEXT_TODAY → status='next', LATER → status='later'

## Changes to server.py

Replace lines 1772-2347 (dump section) with new implementation.

Keep:
- Existing task endpoints (unchanged)
- CORS middleware (already configured for localhost:3000)
- get_current_user dependency (already scopes by user_id)

Remove:
- Old dump endpoints (clarify, promote-to-next, snooze, save, trash, etc.)
- Duplicate dump routes (lines 2424+)
- Old dump models (DumpItemCreate, DumpItemUpdate, SnoozeRequest)


