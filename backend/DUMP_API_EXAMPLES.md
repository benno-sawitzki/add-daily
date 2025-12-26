# Dump API Examples

## Example curl commands for testing dump endpoints

### 1. Create Dump

```bash
# Create a text dump
curl -X POST http://localhost:8010/api/dumps \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "source": "text",
    "raw_text": "Buy groceries, Call dentist, Schedule meeting"
  }'

# Response:
# {
#   "dump": {
#     "id": "...",
#     "user_id": "...",
#     "source": "text",
#     "raw_text": "Buy groceries, Call dentist, Schedule meeting",
#     "created_at": "2024-01-01T12:00:00Z",
#     "status": "captured"
#   },
#   "items": []
# }
```

### 2. List Dumps

```bash
# Get first 20 dumps
curl -X GET "http://localhost:8010/api/dumps?limit=20&offset=0" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Get next page
curl -X GET "http://localhost:8010/api/dumps?limit=20&offset=20" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Response:
# [
#   {
#     "id": "...",
#     "user_id": "...",
#     "source": "text",
#     "raw_text": "...",
#     "created_at": "2024-01-01T12:00:00Z",
#     "status": "captured"
#   },
#   ...
# ]
```

### 3. Get Dump with Items

```bash
curl -X GET http://localhost:8010/api/dumps/{dump_id} \
  -H "Authorization: Bearer YOUR_TOKEN"

# Response:
# {
#   "dump": {
#     "id": "...",
#     "user_id": "...",
#     "source": "text",
#     "raw_text": "Buy groceries, Call dentist, Schedule meeting",
#     "created_at": "2024-01-01T12:00:00Z",
#     "status": "processed"
#   },
#   "items": [
#     {
#       "id": "...",
#       "dump_id": "...",
#       "user_id": "...",
#       "text": "Buy groceries",
#       "extracted_order": 0,
#       "state": "new",
#       "created_at": "2024-01-01T12:01:00Z"
#     },
#     {
#       "id": "...",
#       "dump_id": "...",
#       "user_id": "...",
#       "text": "Call dentist",
#       "extracted_order": 1,
#       "state": "new",
#       "created_at": "2024-01-01T12:01:00Z"
#     },
#     ...
#   ]
# }
```

### 4. Extract Dump Items (AI)

```bash
curl -X POST http://localhost:8010/api/dumps/{dump_id}/extract \
  -H "Authorization: Bearer YOUR_TOKEN"

# Response:
# {
#   "dump": {
#     "id": "...",
#     "status": "processed",
#     ...
#   },
#   "items": [
#     {
#       "id": "...",
#       "text": "Buy groceries",
#       "extracted_order": 0,
#       "state": "new",
#       ...
#     },
#     ...
#   ]
# }
```

### 5. Triage Items to Tasks

```bash
# Send items to INBOX
curl -X POST http://localhost:8010/api/dumps/{dump_id}/triage \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "item_ids": ["item_id_1", "item_id_2"],
    "target": "INBOX"
  }'

# Send items to NEXT_TODAY
curl -X POST http://localhost:8010/api/dumps/{dump_id}/triage \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "item_ids": ["item_id_1"],
    "target": "NEXT_TODAY"
  }'

# Send items to LATER
curl -X POST http://localhost:8010/api/dumps/{dump_id}/triage \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "item_ids": ["item_id_1"],
    "target": "LATER"
  }'

# Response:
# {
#   "tasks": [
#     {
#       "id": "...",
#       "user_id": "...",
#       "title": "Buy groceries",
#       "status": "inbox",  // or "next" or "later"
#       ...
#     },
#     ...
#   ],
#   "message": "Created 2 tasks with status 'inbox'"
# }
```

## Notes

- All endpoints require authentication (Bearer token)
- Dumps never appear in task lists
- Items are converted to tasks via `/triage` endpoint only
- NEXT_TODAY target enforces cap of 5 tasks
- Extraction uses existing `get_ai_response()` function


