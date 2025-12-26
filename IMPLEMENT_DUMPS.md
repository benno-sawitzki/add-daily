# Implement Dump (Transmission) System

## Summary
Implemented a new "Dump" concept as a capture session container. Inbox now shows Dump cards instead of individual tasks. Each Dump represents one capture session (voice or text) and contains items.

## Database Migrations

**File:** `backend/migrations/create_dumps_tables.sql`

Creates:
- `dumps` table: id, user_id, created_at, source (voice|text), raw_text, transcript (optional), clarified_at (optional), archived_at (optional)
- `dump_items` table: id, dump_id, created_at, text, status (new|promoted|snoozed|saved|trashed), snooze_until (optional), linked_task_id (optional)
- Indexes for performance
- RLS policies for security

## Backend API Routes

**File:** `backend/server.py`

### Dump Endpoints:
- `POST /api/dumps` - Create a new dump
- `GET /api/dumps` - List all dumps (newest first, filters by archived)
- `GET /api/dumps/{dump_id}` - Get a single dump
- `PATCH /api/dumps/{dump_id}` - Update a dump (archive, clarify, etc.)

### Dump Items Endpoints:
- `POST /api/dumps/{dump_id}/items` - Create a new item in a dump
- `GET /api/dumps/{dump_id}/items` - Get all items for a dump
- `PATCH /api/dump-items/{item_id}` - Update a dump item

## Frontend Components

### 1. DumpsList.jsx
- Main inbox screen showing list of Dump cards
- Each card shows: "Dump · Today 18:42 · Voice · 0 items"
- Clicking a card opens DumpReview
- Includes CreateDump component at top

### 2. DumpReview.jsx
- Shows dump details when a dump card is clicked
- Displays raw_text and list of items
- Shows dump metadata (date, source, item count)

### 3. CreateDump.jsx
- Text input for creating new dumps
- Cmd/Ctrl+Enter to create
- Creates dump with source="text"

## Integration

**File:** `frontend/src/components/MainApp.jsx`
- Updated inbox tab to show `DumpsList` instead of `InboxSplitView`
- Command Center remains on the right side

## Acceptance Criteria ✅

- ✅ Can create a Dump from text box (CreateDump component)
- ✅ Dump appears in Inbox as a card with timestamp and item count
- ✅ Opening a Dump shows its raw_text and item list (empty for now until items are extracted)

## Next Steps (Not Implemented Yet)

- Voice transcription integration (stubbed for now)
- Item extraction from raw_text (AI processing)
- Item status management (promote, snooze, save, trash)
- Link items to tasks

## Files Changed

### Backend
1. `backend/migrations/create_dumps_tables.sql` (NEW)
2. `backend/server.py` - Added Dump models and endpoints

### Frontend
1. `frontend/src/components/DumpsList.jsx` (NEW)
2. `frontend/src/components/DumpReview.jsx` (NEW)
3. `frontend/src/components/CreateDump.jsx` (NEW)
4. `frontend/src/components/MainApp.jsx` - Updated inbox tab

## Testing

1. Create a dump from text input → Should appear in inbox
2. Click a dump card → Should open review view showing raw_text
3. Items list should be empty (until extraction is implemented)
4. Dump cards should show correct timestamp and source


