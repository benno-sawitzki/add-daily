# Implement Dump Clarification and Triage Actions

## Summary
Implemented clarification and triage actions for Dumps. Users can clarify dumps into items, then promote items to Next Today (with cap enforcement), snooze them, save them to Logbook, or trash them.

## Backend Changes

**File:** `backend/server.py`

### New Endpoints:

1. **POST `/api/dumps/{dump_id}/clarify`**
   - Parses dump raw_text into dump_items
   - Stub parser: splits by newlines and bullet points (-, *, •, etc.)
   - Creates dump_items with status='new'
   - Sets dumps.clarified_at timestamp
   - Returns dump and created items

2. **POST `/api/dump-items/{item_id}/promote-to-next`**
   - Creates a task with status='next'
   - Sets dump_item.status='promoted' and linked_task_id
   - Enforces Next Today cap (5 tasks max)
   - Returns updated item and created task

3. **PATCH `/api/dump-items/{item_id}/snooze`**
   - Sets dump_item.status='snoozed' and snooze_until
   - Accepts SnoozeRequest body with snooze_until (ISO datetime)

4. **PATCH `/api/dump-items/{item_id}/save`**
   - Sets dump_item.status='saved'
   - Saved items appear in Logbook

5. **PATCH `/api/dump-items/{item_id}/trash`**
   - Sets dump_item.status='trashed'

6. **GET `/api/next-today-count`**
   - Returns count of Next Today tasks, cap, and remaining slots

### Models:
- Added `SnoozeRequest` model for snooze endpoint

## Frontend Changes

**File:** `frontend/src/components/DumpReview.jsx`
- Added "Clarify" button (only shown if dump not yet clarified)
- Added Next Today slots counter display
- Added action buttons for each item (Next, Snooze, Save, Trash)
- Filters snoozed items (only shows if snooze_until <= now)
- Filters trashed items (never shown)
- Shows item status badges
- Shows "✓ In Next Today" indicator for promoted items

**File:** `frontend/src/components/SavedItems.jsx` (NEW)
- New component for Logbook view
- Shows all saved items from all dumps
- Displays dump source and date
- Allows removing items from Logbook (trash)

**File:** `frontend/src/components/MainApp.jsx`
- Added Logbook tab to navigation
- Imports SavedItems component
- Renders SavedItems in logbook tab

## Features

### Clarification
- Parses raw_text into multiple items
- Supports newlines and bullet points (-, *, •, —, –)
- If parsing fails, creates single item with full text
- Sets clarified_at timestamp

### Triage Actions
1. **Promote to Next Today**
   - Creates task with status='next'
   - Enforces 5-task cap
   - Shows error if cap exceeded
   - Updates item status to 'promoted'
   - Links item to created task

2. **Snooze**
   - Calendar picker for snooze date
   - Items hidden until snooze_until <= now
   - Auto-resurface when due

3. **Save**
   - Moves item to Logbook
   - Appears in SavedItems component

4. **Trash**
   - Marks item as trashed
   - Hides from view

### UI Features
- Next Today slots counter: "X/5 remaining"
- Action buttons only shown for 'new' status items
- Status badges for all items
- "In Next Today" indicator for promoted items
- Snooze date display for snoozed items

## Acceptance Criteria ✅

- ✅ Clarify produces multiple dump_items (parsed from raw_text)
- ✅ Can promote up to 5 items into Next Today
- ✅ 6th promotion is blocked with clear error message
- ✅ Snoozed items are hidden until snooze_until <= now
- ✅ Saved items show in Logbook tab
- ✅ Trashed items are hidden from view

## Files Changed

### Backend
1. `backend/server.py`
   - Added clarify endpoint
   - Added promote-to-next endpoint (with cap)
   - Added snooze, save, trash endpoints
   - Added next-today-count endpoint
   - Added SnoozeRequest model

### Frontend
1. `frontend/src/components/DumpReview.jsx`
   - Added Clarify button and logic
   - Added Next Today slots counter
   - Added item action buttons
   - Added filtering for snoozed/trashed items

2. `frontend/src/components/SavedItems.jsx` (NEW)
   - Logbook view for saved items

3. `frontend/src/components/MainApp.jsx`
   - Added Logbook tab
   - Integrated SavedItems component

## Testing

1. **Clarification:**
   - Create dump with multi-line text
   - Click "Clarify"
   - Verify items are created (one per line/bullet)
   - Verify clarified_at is set

2. **Promote to Next Today:**
   - Clarify a dump with 6+ items
   - Promote first 5 items → Should work
   - Try to promote 6th item → Should be blocked with error
   - Complete a Next Today task → Should allow promoting again

3. **Snooze:**
   - Snooze an item for tomorrow
   - Verify it disappears from list
   - Wait until tomorrow → Should reappear

4. **Save:**
   - Save an item
   - Navigate to Logbook tab
   - Verify item appears there

5. **Trash:**
   - Trash an item
   - Verify it disappears from list


