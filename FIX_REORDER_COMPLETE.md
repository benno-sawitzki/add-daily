# Fix: Task Reordering with sort_order - Complete Solution

## Problem Identified

Reordering tasks showed "Failed to save task order" toast. Root causes:
1. **Using `priority` for ordering** - Priority is for urgency/importance, not display order
2. **No `sort_order` column** - Database schema missing dedicated ordering column
3. **Generic error messages** - Couldn't see actual Supabase errors
4. **Multiple updates instead of batch** - Caused race conditions and double-move bugs
5. **No resilience** - Errors broke the UI

## Solution

### A) Migration SQL

Run this in Supabase SQL Editor:

```sql
-- Migration: Add sort_order column to tasks table for proper task ordering
-- See: backend/migrations/add_sort_order_column.sql

-- Add sort_order column if it doesn't exist
ALTER TABLE public.tasks 
ADD COLUMN IF NOT EXISTS sort_order INTEGER NULL;

-- Create index for efficient queries on sort_order by user
CREATE INDEX IF NOT EXISTS tasks_user_sort_order_idx 
ON public.tasks(user_id, sort_order) 
WHERE sort_order IS NOT NULL;

-- Optional: Backfill sort_order for existing tasks based on current priority and created_at
-- This gives existing tasks a reasonable initial order
DO $$
BEGIN
  -- For inbox tasks, set sort_order based on priority (desc) and created_at (asc)
  UPDATE public.tasks
  SET sort_order = subq.row_num - 1
  FROM (
    SELECT 
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, status 
        ORDER BY priority DESC NULLS LAST, created_at ASC NULLS LAST
      ) as row_num
    FROM public.tasks
    WHERE status = 'inbox' AND sort_order IS NULL
  ) subq
  WHERE tasks.id = subq.id;
END $$;
```

### B) Backend Changes

**1. Added `sort_order` to TaskUpdate model:**
```python
class TaskUpdate(BaseModel):
    # ... existing fields ...
    sort_order: Optional[int] = None  # Display order (0-based index)
```

**2. Added `sort_order` to allowed_fields in update_task endpoint**

**3. Created batch update endpoint (`/tasks/batch-update-sort-order`):**
- Single SQL query with CASE WHEN for efficiency
- Updates only tasks belonging to current user
- Checks for column existence before updating
- Detailed error logging

**4. Enhanced error logging:**
- Logs full error details (message, type, user_id, query)
- Development mode shows detailed error messages
- Production shows generic messages

### C) Frontend Changes

**1. New utility: `reorderWithSortOrder.js`**
- `persistSortOrder()` - Batch update using `/tasks/batch-update-sort-order`
- `persistWithRetry()` - Retry logic with exponential backoff
- Detailed error extraction from Supabase responses
- Toast error messages with deduplication

**2. Updated `InboxSplitView.jsx`:**
- `reorderTasksAndUpdateSortOrder()` replaces `reorderTasksAndUpdatePriorities()`
- Uses `arrayMove` result as single source of truth
- Assigns `sort_order` sequentially (0, 1, 2, ...)
- Optimistic UI updates
- Resilient error handling (keeps UI order even if persistence fails)

### D) Key Fixes

**1. Single source of truth:**
- `arrayMove` result is used directly - no recalculation
- No double-move bugs because we use the exact result from dnd-kit

**2. Batch update:**
- Single API call updates all tasks
- Atomic transaction in database
- No race conditions

**3. Detailed error logging:**
```javascript
const errorDetails = {
  message: error.message,
  response: error.response?.data,
  status: error.response?.status,
  details: error.response?.data?.detail,
  hint: error.response?.data?.hint,
  code: error.response?.data?.code,
};
```

**4. Resilience:**
- UI keeps optimistic order even if persistence fails
- Error toast shows actual error in dev mode
- Retry logic (1 retry with 1s delay)
- Toast deduplication by context

**5. RLS/Auth guards:**
- Backend checks `user?.id` before any operations
- All queries use `WHERE user_id = $X` AND `id = $Y`
- Batch update only updates tasks for current user

## Testing

### Manual Test Steps

1. **Run migration:**
   - Copy SQL from `backend/migrations/add_sort_order_column.sql`
   - Run in Supabase SQL Editor

2. **Test reordering:**
   - Open Inbox view
   - Drag a task to reorder
   - ✅ Should update immediately (optimistic)
   - ✅ No error toast
   - ✅ Order persists after refresh

3. **Test error handling (dev mode):**
   - Open DevTools Console
   - Throttle network to "Offline"
   - Try to reorder
   - ✅ Should see detailed error in console
   - ✅ Toast shows actual error message
   - ✅ UI order is preserved (doesn't revert)

4. **Test double-move bug:**
   - Reorder task from position 2 to position 0
   - ✅ Should move exactly 1 step (not 2)
   - ✅ Other tasks shift correctly

## Expected Errors (If Migration Not Run)

If you see:
- `"sort_order column does not exist"` → Run the migration SQL
- `"RLS policy denied"` → Check RLS policies allow UPDATE where `user_id = auth.uid()`
- `"invalid uuid"` → Ensure `user?.id` is set before querying

All errors now show detailed information in development mode.

## Files Changed

### New Files
- `backend/migrations/add_sort_order_column.sql` - Migration SQL
- `frontend/src/utils/reorderWithSortOrder.js` - New reorder utility
- `FIX_REORDER_COMPLETE.md` - This documentation

### Modified Files
- `backend/server.py` - Added sort_order support and batch update endpoint
- `frontend/src/components/InboxSplitView.jsx` - Uses sort_order instead of priority

## Acceptance Criteria ✅

- [x] Single `sort_order` column in DB and code
- [x] Migration SQL provided
- [x] No double-move bugs (uses arrayMove result as source of truth)
- [x] Batch update for efficiency
- [x] Detailed error logging with Supabase details
- [x] Resilient UI (keeps order on error)
- [x] RLS/auth guards in place
- [x] Deduplicated error toasts


