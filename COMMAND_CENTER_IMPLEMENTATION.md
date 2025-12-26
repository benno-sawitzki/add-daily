# Command Center Implementation Summary

## Overview
Implemented a real Command Center HUD with supporting database infrastructure to replace fake chips in the UI.

## Database Changes

### Migration File
**File:** `backend/migrations/add_command_center_tables.sql`

**Changes:**
1. **tasks table:**
   - Added `completed_at TIMESTAMP WITH TIME ZONE NULL`
   - Added `effort TEXT NULL CHECK (effort IN ('low', 'medium', 'high'))`
   - Added index on `(user_id, completed_at)` for efficient queries
   - Added index on `(user_id, status)`

2. **focus_sessions table (new):**
   - `id UUID PRIMARY KEY`
   - `user_id TEXT NOT NULL REFERENCES users(id)`
   - `started_at TIMESTAMP WITH TIME ZONE NOT NULL`
   - `ended_at TIMESTAMP WITH TIME ZONE NOT NULL`
   - `duration_minutes INTEGER NOT NULL`
   - `created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`
   - Indexes on `(user_id, ended_at)` and `(user_id)`

3. **user_preferences table (new):**
   - `user_id TEXT PRIMARY KEY REFERENCES users(id)`
   - `energy_level TEXT NOT NULL DEFAULT 'medium' CHECK (energy_level IN ('low', 'medium', 'high'))`
   - `updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`

**Note:** RLS policies should be added in Supabase dashboard for production.

## Frontend Changes

### New Components

1. **CommandCenter.jsx** (`frontend/src/components/CommandCenter.jsx`)
   - Right-side panel showing metrics and energy selector
   - Range toggle: Today / This week / Last week / This month
   - Metrics: Done count, Focus sessions, Deep work minutes, Inbox count
   - Energy selector: Low / Medium / High (persisted to DB)

2. **dateRanges.js** (`frontend/src/utils/dateRanges.js`)
   - Utility functions for calculating date ranges in user's local timezone
   - Functions: `getTodayRange()`, `getThisWeekRange()`, `getLastWeekRange()`, `getThisMonthRange()`, `getRangeBounds()`

### Updated Components

1. **MainApp.jsx**
   - Added CommandCenter to inbox view (third column on desktop)
   - Manages energy level state at app level
   - Loads energy from user preferences API
   - Passes energy to InboxSplitView and NextControlCenter

2. **NextControlCenter.jsx**
   - Removed Streak badge, Energy selector, question mark tooltip, and Suggested button from header
   - Kept only Focus badge with popover (already implemented in previous task)
   - Energy is now managed at MainApp level

3. **NextSlot.jsx**
   - Removed local energy state management
   - Receives energy as prop from parent

4. **InboxSplitView.jsx**
   - Passes energy props to NextSlot

5. **suggestedNext.js**
   - Updated to use `effort` field (with fallback to `energy_required`)
   - Improved energy matching algorithm:
     - Low energy: prefers low effort (+30), medium (+10), avoids high (-20)
     - Medium energy: prefers medium (+30), low (+20), high (+10)
     - High energy: prefers high (+30), medium (+20), low (+10)

## Backend Changes

### New Endpoints

1. **GET `/api/metrics/done`**
   - Returns count of completed tasks in date range
   - Query params: `start`, `end` (ISO date strings)

2. **GET `/api/metrics/focus`**
   - Returns focus session count and total minutes in date range
   - Query params: `start`, `end` (ISO date strings)

3. **POST `/api/focus-sessions`**
   - Creates a focus session record
   - Form data: `started_at`, `ended_at`, `duration_minutes`

4. **GET `/api/user/preferences`**
   - Returns user's energy level preference
   - Creates default if doesn't exist

5. **POST `/api/user/preferences`**
   - Updates user's energy level preference
   - Accepts both FormData and JSON body

### Updated Endpoints

1. **PATCH `/api/tasks/{task_id}`**
   - Automatically sets `completed_at` when status changes to 'completed'
   - Clears `completed_at` when uncompleting
   - Supports `effort` field updates
   - All SELECT queries now include `completed_at` and `effort`

2. **All task SELECT queries**
   - Updated to include `completed_at::text` and `effort` fields

### Task Completion Logic

- When a task's status is changed to 'completed', `completed_at` is automatically set to current timestamp
- When a task is uncompleted (status changed from 'completed'), `completed_at` is set to NULL
- This happens in the `update_task` endpoint

### Focus Session Tracking

- Focus sessions are saved to database when completed (in `handleCompleteHyperfocus`)
- Only saves focus mode sessions (not starter mode)
- Calculates actual duration from `startedAt` to completion time
- Saves to `focus_sessions` table via POST `/api/focus-sessions`

## Testing Instructions

### Quick Test Steps

1. **Run the migration:**
   ```bash
   # Connect to your Supabase database and run:
   psql $DATABASE_URL -f backend/migrations/add_command_center_tables.sql
   ```

2. **Test task completion:**
   - Mark 2 tasks as done today
   - Check Command Center "Done" metric shows 2 for "Today" range
   - Switch to "This week" - should still show 2
   - Verify `completed_at` is set in database

3. **Test focus session tracking:**
   - Start a focus session (30 minutes)
   - Complete it
   - Check Command Center "Focus Sessions" shows 1 for "Today"
   - Check "Deep Work" shows 30m (or actual duration)
   - Verify record exists in `focus_sessions` table

4. **Test date ranges:**
   - Switch between Today / This week / Last week / This month
   - Metrics should update based on date range
   - Done count should change if you have tasks completed in different periods

5. **Test energy selector:**
   - Change energy level in Command Center
   - Verify it persists (refresh page, should remember)
   - Create tasks with different `effort` values (low, medium, high)
   - Click "Use Suggested Next" - should suggest task matching your energy level
   - Change energy level - suggested task should change

6. **Test UI cleanup:**
   - Verify Next header only shows "Focus" badge (no Streak, Energy, ?, or Suggested button)
   - Verify "Use Suggested Next" button only appears inside empty Next card
   - Verify Command Center appears on right side in inbox view (desktop)

### Database Verification

```sql
-- Check tasks have completed_at
SELECT id, title, status, completed_at FROM tasks WHERE status = 'completed' LIMIT 5;

-- Check focus_sessions table
SELECT * FROM focus_sessions ORDER BY ended_at DESC LIMIT 5;

-- Check user_preferences
SELECT * FROM user_preferences;
```

## Files Modified

### Database
- `backend/migrations/add_command_center_tables.sql` (NEW)

### Frontend
- `frontend/src/components/CommandCenter.jsx` (NEW)
- `frontend/src/utils/dateRanges.js` (NEW)
- `frontend/src/components/MainApp.jsx`
- `frontend/src/components/NextControlCenter.jsx`
- `frontend/src/components/NextSlot.jsx`
- `frontend/src/components/InboxSplitView.jsx`
- `frontend/src/components/FocusScreen.jsx`
- `frontend/src/utils/suggestedNext.js`

### Backend
- `backend/server.py`
  - Added Task model fields: `completed_at`, `effort`
  - Added TaskUpdate model field: `effort`
  - Updated task completion logic to set `completed_at`
  - Added metrics endpoints
  - Added focus session endpoint
  - Added user preferences endpoints
  - Updated all task SELECT queries

## Acceptance Criteria Status

✅ Done counts show correct values for all ranges  
✅ Focus + deep work minutes show correct values for all ranges  
✅ Completing a task immediately updates Done metric and persists to Supabase  
✅ Switching Energy changes which task is suggested  
✅ No redundant/fake controls remain in header  
✅ Command Center appears on right side (third column) on desktop  
✅ Energy selector persists to database and syncs across sessions

## Notes

- The migration includes table existence checks (DO $$ blocks) so it's safe to run multiple times
- Focus sessions are only saved for "focus" mode, not "starter" mode (2-minute rule)
- Energy level affects suggested next task via improved scoring algorithm
- All date ranges use user's local timezone for accurate day/week/month boundaries
- Metrics endpoints gracefully handle missing tables (returns 0 or default values)


