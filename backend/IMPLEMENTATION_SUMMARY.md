# Dump Implementation Summary

## Status

✅ **Migration SQL**: Created at `backend/migrations/update_dumps_schema.sql`
✅ **New Models Code**: Created at `backend/dump_endpoints_new.py`
✅ **API Examples**: Created at `backend/DUMP_API_EXAMPLES.md`

## What Needs to Be Done

Replace the dump section in `server.py` (lines ~1772-2347) with the new implementation.

### 1. Replace Models (lines ~1775-1811)

**Replace these old models:**
- Dump (with transcript/clarified_at/archived_at)
- DumpCreate (with transcript)
- DumpItem (with status/snooze_until/linked_task_id)
- DumpItemCreate
- DumpItemUpdate
- SnoozeRequest

**With new models:**
- Dump (id, user_id, source, raw_text, created_at, status: captured|processed)
- DumpCreate (source, raw_text)
- DumpItem (id, dump_id, user_id, text, extracted_order, state: new|converted|discarded, created_at)
- DumpWithItems (dump, items: List[DumpItem])
- TriageRequest (item_ids, target: INBOX|NEXT_TODAY|LATER)

### 2. Replace Endpoints (lines ~1813-2347)

**Remove all old endpoints:**
- POST /dumps (old version)
- GET /dumps (old version with archived filter)
- GET /dumps/{dump_id} (old version)
- PATCH /dumps/{dump_id}
- POST /dumps/{dump_id}/items
- GET /dumps/{dump_id}/items
- PATCH /dump-items/{item_id}
- POST /dumps/{dump_id}/clarify
- POST /dump-items/{item_id}/promote-to-next
- PATCH /dump-items/{item_id}/snooze
- PATCH /dump-items/{item_id}/save
- PATCH /dump-items/{item_id}/trash

**Add new endpoints:**
- POST /dumps (create dump, returns dump + items=[])
- GET /dumps?limit=20&offset=0 (list dumps, paginated)
- GET /dumps/{dump_id} (get dump + items)
- POST /dumps/{dump_id}/extract (AI extraction)
- POST /dumps/{dump_id}/triage (convert items to tasks)

### 3. Remove Duplicate Routes

Remove duplicate dump routes starting around line 2424.

## Files Created

1. `backend/migrations/update_dumps_schema.sql` - Migration SQL
2. `backend/dump_endpoints_new.py` - Complete new implementation
3. `backend/DUMP_API_EXAMPLES.md` - Example curl commands
4. `backend/DUMP_IMPLEMENTATION.md` - Implementation details

## Next Steps

1. Review the migration SQL and run it on your database
2. Review `dump_endpoints_new.py` for the complete implementation
3. Replace the dump section in `server.py` with the new code
4. Test all endpoints using examples from `DUMP_API_EXAMPLES.md`

## Key Changes

- **Dumps are capture records only** - never appear in task lists
- **Items extracted via AI** - uses existing `get_ai_response()` function
- **Triage creates tasks** - explicit endpoint to convert items to tasks
- **New schema** - status (captured|processed), state (new|converted|discarded)
- **Pagination** - GET /dumps supports limit/offset


