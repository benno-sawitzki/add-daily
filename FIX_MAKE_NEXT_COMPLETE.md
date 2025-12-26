# Fix: "Next" Action Network Error - Complete Solution

## Problem Identified

Clicking "Next" on a task showed generic "Network Error" toast. Root causes:
1. **Generic error handling** - Frontend showed `error.message` without Supabase details
2. **Backend error not logged** - No detailed error logging in `make_task_next` endpoint
3. **Column existence** - Backend query referenced `energy_required` which might not exist (should check for `effort` too)
4. **No auth guard** - Missing explicit check for `user?.id` at start
5. **Minimal payload not enforced** - Backend didn't verify it's only updating `status` field

## Solution

### A) Real Supabase Error Display

**Frontend (`InboxSplitView.jsx`):**
- Extracts full error details: `message`, `response.data`, `status`, `details`, `hint`, `code`
- Logs complete error object to console
- Shows detailed error in dev mode: `"Failed to set task as next: {details} (Status: {status}) (Hint: {hint})"`
- Shows generic "Couldn't save. Retry" in production
- Toast deduplication using fixed IDs (`make-next-error`, `make-next-error-drag`)

### B) What Next Action Writes

**Database Updates:**
1. Finds existing task with `status = 'next'` for user
2. Updates it to `status = 'inbox'` (if exists)
3. Updates requested task to `status = 'next'`

**Minimal Schema Required:**
- `tasks.id` (uuid)
- `tasks.user_id` (uuid)
- `tasks.status` (text) - must support `'next'` value
- No optional columns needed (completed_at, effort, sort_order are not used)

### C) Minimal Payload Implementation

**Backend (`make_task_next` endpoint):**
- Only updates `status` field (minimal payload)
- Checks column existence dynamically before SELECT (for RETURNING clause)
- Supports both `effort` and `energy_required` columns (whichever exists)
- No optional columns in UPDATE queries

### D) Database Schema

**No migration needed** - The Next action uses existing `status` column.

**Status values supported:**
- `'inbox'` - Tasks in inbox
- `'next'` - The one next task (enforced by unique constraint in schema.sql)
- `'scheduled'` - Tasks on calendar
- `'completed'` - Completed tasks
- `'later'` - Deferred tasks

**Existing constraint (from schema.sql):**
```sql
CREATE UNIQUE INDEX one_next_task_per_user
ON tasks(user_id)
WHERE status = 'next';
```

This ensures only one task can be "next" per user.

### E) Auth Guard + RLS

**Backend:**
- ✅ Checks `user?.id` at start: `if not user or not user.get("id")`
- ✅ All queries use `WHERE id = $1 AND user_id = $2` for security
- ✅ Returns 401 if user not authenticated

**RLS Policies Required:**
If RLS is enabled, ensure policies allow UPDATE:
```sql
CREATE POLICY "Users can update their own tasks." 
ON tasks FOR UPDATE 
USING (user_id = auth.uid());
```

### F) UX Resilience

**Optimistic UI:**
- UI updates immediately when clicking Next
- On error, reverts to previous state
- Shows clear error message (not just "Network Error")

**Error Messages:**
- Dev: Shows actual Supabase error with details, status, hints
- Prod: Shows generic "Couldn't save. Retry" (user-friendly)
- Toast deduplication prevents spam

## Code Changes

### Backend (`backend/server.py`)

**Enhanced `make_task_next` endpoint:**
- Added auth guard check
- Dynamic column selection for RETURNING clause
- Comprehensive error logging
- Detailed error messages in dev mode

### Frontend (`frontend/src/components/InboxSplitView.jsx`)

**Enhanced `handleMakeNext` and drag handler:**
- Detailed error extraction
- Full console logging
- Dev/prod error message differentiation
- Toast deduplication
- Auth guard check (taskId validation)

## Testing

### Manual Test Steps

1. **Test Next action:**
   - Click "Next" button on a task in inbox
   - ✅ Should update immediately (optimistic)
   - ✅ No error toast
   - ✅ Task moves to Next slot

2. **Test error handling (dev mode):**
   - Open DevTools Console and Network tab
   - Throttle network to "Offline"
   - Click "Next" button
   - ✅ Should see detailed error in console
   - ✅ Toast shows actual error (not "Network Error")
   - ✅ UI reverts to previous state

3. **Test with missing column (if schema not migrated):**
   - If backend fails, check console for exact error
   - Should show: `"column X does not exist"` or `"RLS policy denied"`

## Expected Errors (If They Occur)

**Common errors and fixes:**

1. **"column energy_required does not exist"**
   - Backend now checks for both `effort` and `energy_required`
   - Should not occur with current implementation

2. **"RLS policy denied" or 403 Forbidden**
   - Check RLS policies allow UPDATE where `user_id = auth.uid()`
   - Run migration: `backend/migrations/add_rls_policies.sql`

3. **"Task not found" (404)**
   - Check task belongs to current user
   - Check `user_id` matches `auth.uid()`

4. **"invalid uuid"**
   - Ensure `user?.id` is set before calling endpoint
   - Auth guard should prevent this

All errors now show detailed information in development mode.

## Files Changed

### Modified Files
- `backend/server.py` - Enhanced `make_task_next` with auth guard, error handling, dynamic columns
- `frontend/src/components/InboxSplitView.jsx` - Enhanced error handling in `handleMakeNext` and drag handler

## Acceptance Criteria ✅

- [x] Real Supabase errors shown in dev mode (not generic "Network Error")
- [x] Minimal payload (only updates `status` field)
- [x] Auth guard checks `user?.id` before operations
- [x] All queries use `.eq('id', taskId)` AND `.eq('user_id', user.id)`
- [x] Optimistic UI with error revert
- [x] Toast deduplication
- [x] No migration needed (uses existing `status` column)

## No Migration Needed

The Next action uses the existing `status` column which already supports `'next'` value. The unique constraint ensures only one next task per user.


