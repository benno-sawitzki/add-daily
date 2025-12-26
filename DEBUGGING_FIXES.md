# Debugging Fixes for Command Center + Tasks Disappearing

## Issues Found & Fixed

### 1. **Tasks Disappearing - Root Causes**

**Problem:** Old tasks not showing up after Command Center migration.

**Root Causes:**
- Old tasks may have `NULL` status (before status column was required)
- Old tasks may have `NULL` user_id (if not properly set on creation)
- Query was filtering `WHERE user_id = $1 AND status = $2` which excluded NULL status tasks

**Fixes Applied:**
- Modified `get_tasks` endpoint to include NULL status tasks when filtering for 'inbox'
- Added auth guard checks to prevent queries with undefined user_id
- Created backfill migration to set default status='inbox' for NULL status tasks

### 2. **Metrics "Failed to load metrics" Error**

**Problem:** Generic error toast without details.

**Root Causes:**
- Missing error details in responses
- Metrics endpoints could throw and break the app
- No handling for missing tables/columns

**Fixes Applied:**
- Added detailed error logging with error.message, type, user_id, etc.
- Metrics endpoints now return 0 values instead of throwing (resilient)
- Added table/column existence checks before querying
- Frontend now catches errors gracefully and shows 0 values

### 3. **Auth Guard Issues**

**Problem:** Queries could run before user is loaded, causing "invalid uuid" errors.

**Fixes Applied:**
- Added `if (!user || !user.get("id"))` checks in all endpoints
- Frontend `fetchTasks` and `fetchMetrics` now check for `user?.id` before calling
- Added auth guards in:
  - `get_tasks`
  - `get_done_metrics`
  - `get_focus_metrics`
  - `get_user_preferences`
  - `create_task`

### 4. **RLS Policies Missing**

**Problem:** If RLS is enabled in Supabase, queries could be blocked.

**Fix:** Created migration `add_rls_policies.sql` with proper RLS policies for:
- `focus_sessions` table
- `user_preferences` table
- Policies ensure users can only access their own data

## Files Changed

### Backend (`backend/server.py`)
1. **`get_tasks`** - Added auth guard, improved NULL status handling
2. **`get_done_metrics`** - Added auth guard, error handling, table checks
3. **`get_focus_metrics`** - Added auth guard, error handling, table checks
4. **`get_user_preferences`** - Added auth guard, error handling
5. **`create_task`** - Added auth guard

### Frontend
1. **`MainApp.jsx`**
   - `fetchTasks`: Added auth guard, detailed error logging
   - `useEffect`: Only fetch when `user?.id` is available

2. **`CommandCenter.jsx`**
   - `fetchMetrics`: Made resilient - catches errors, shows 0 values
   - No blocking toasts - metrics failures don't break the app

### Migrations
1. **`backfill_tasks_user_id_status.sql`** (NEW)
   - Backfills NULL status to 'inbox'
   - Sets default status='inbox' for future tasks

2. **`add_rls_policies.sql`** (NEW)
   - Adds RLS policies for focus_sessions and user_preferences
   - Required for Supabase if RLS is enabled

## How to Test

### Step 1: Run Migrations
```bash
# In Supabase SQL Editor, run in order:
1. backend/migrations/add_command_center_tables.sql
2. backend/migrations/add_rls_policies.sql
3. backend/migrations/backfill_tasks_user_id_status.sql
```

### Step 2: Check Console for Errors
- Open browser DevTools Console
- Look for detailed error messages with:
  - Error message
  - Error type
  - User ID
  - Request details

### Step 3: Verify Tasks Load
- Login to app
- Check that old tasks appear in inbox
- Verify new tasks can be created

### Step 4: Verify Metrics
- Command Center should show metrics (or 0 if no data)
- Check console for warnings (not errors) if metrics fail
- App should still work even if metrics fail

## Expected Error Messages (Development)

### If RLS is blocking:
```
Error in get_done_metrics: {
  message: "permission denied for table tasks",
  type: "PostgresError",
  user_id: "..."
}
```

### If table missing:
```
Metrics done returned error: completed_at column not found
```

### If user_id missing:
```
get_tasks: user or user.id is missing
```

## Production vs Development

- **Development**: Detailed error messages in toasts and console
- **Production**: Generic messages, detailed logs server-side only

## Next Steps if Issues Persist

1. **Check Supabase Dashboard:**
   - Verify tables exist: `tasks`, `focus_sessions`, `user_preferences`
   - Check columns: `completed_at`, `effort` in tasks table
   - Verify RLS policies are enabled and correct

2. **Check Backend Logs:**
   - Look for detailed error logs with full stack traces
   - Check for "user or user.id is missing" messages

3. **Check Frontend Console:**
   - Look for network errors in Network tab
   - Check for auth token issues
   - Verify user object has `id` field

4. **Verify Auth:**
   - Ensure JWT token is being sent in Authorization header
   - Check that token contains correct user ID
   - Verify user exists in `users` table


