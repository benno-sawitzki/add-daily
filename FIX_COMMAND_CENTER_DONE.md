# Fix: Command Center DONE Count Updates

## Problem
Command Center "DONE" count was showing 0 even after marking tasks as completed. The issue was:
1. `/metrics/done` endpoint didn't exist
2. Task completion didn't set `completed_at` timestamp
3. Command Center didn't refresh metrics after task completion

## Solution

### 1. Backend: Task Completion Sets `completed_at`

**File:** `backend/server.py` - `update_task` endpoint

When a task's status changes to `'completed'`, we now:
- Check if `completed_at` column exists
- Set `completed_at = NOW()` when status changes to 'completed'
- Clear `completed_at = NULL` when status changes from 'completed' to another status

**Code changes:**
- Added check for current task status before updating
- Detect status changes: `status_changing_to_completed` and `status_changing_from_completed`
- Conditionally add `completed_at` to the UPDATE query when column exists

### 2. Backend: Created `/metrics/done` Endpoint

**File:** `backend/server.py`

New endpoint: `GET /api/metrics/done?start=<ISO_DATE>&end=<ISO_DATE>`

**Features:**
- Uses `completed_at` as single source of truth for "done" tasks
- Filters by `completed_at` timestamp within the provided date range
- Gracefully handles missing `completed_at` column (returns 0 with error indicator)
- Timezone-aware date parsing (handles both ISO datetime strings and YYYY-MM-DD dates)

**Query logic:**
```sql
SELECT COUNT(*) FROM tasks 
WHERE user_id = $1 
AND completed_at IS NOT NULL
AND completed_at >= $2  -- start of range
AND completed_at <= $3  -- end of range
```

### 3. Backend: Created `/metrics/focus` Endpoint

**File:** `backend/server.py`

New endpoint: `GET /api/metrics/focus?start=<ISO_DATE>&end=<ISO_DATE>`

Returns:
- `count`: Number of focus sessions in range
- `totalMinutes`: Sum of `duration_minutes` for all sessions in range

### 4. Frontend: Command Center Refreshes on Task Completion

**File:** `frontend/src/components/MainApp.jsx`

**Changes:**
- Added `metricsRefreshTrigger` state that increments when a task's status changes
- `updateTask` now triggers metrics refresh when status changes to/from 'completed'
- Pass `refreshTrigger` prop to `CommandCenter`

**File:** `frontend/src/components/CommandCenter.jsx`

**Changes:**
- Added `refreshTrigger` prop
- Added `refreshTrigger` to `useEffect` dependencies so metrics refetch when it changes
- Metrics now update immediately after task completion/uncompletion

## Database Migration

If `completed_at` column doesn't exist, run:

```sql
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_user_id_completed_at ON public.tasks(user_id, completed_at) WHERE completed_at IS NOT NULL;
```

## Testing

1. **Create a task** in Inbox
2. **Mark it as completed** (click the checkmark)
3. **Verify Command Center DONE count increments** immediately (no page refresh needed)
4. **Switch time ranges** (Today/Week/Last/Month) - counts should reflect correct date ranges
5. **Uncomplete the task** - DONE count should decrease
6. **Complete multiple tasks today** - DONE count for "Today" should show correct number

## Acceptance Criteria ✅

- ✅ Task completion sets `completed_at` timestamp
- ✅ Command Center DONE count uses `completed_at` as source of truth
- ✅ DONE count updates immediately after completing/uncompleting tasks
- ✅ Time range filters work correctly (Today/Week/Last/Month)
- ✅ Graceful degradation if `completed_at` column doesn't exist (shows 0 + inline note)
- ✅ No page refresh needed for metrics to update


