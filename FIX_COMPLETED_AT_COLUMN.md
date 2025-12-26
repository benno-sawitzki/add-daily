# Fix for "column 'completed_at' does not exist" Error

## SQL Migration (Run in Supabase SQL Editor)

```sql
-- Add completed_at column if it doesn't exist
ALTER TABLE public.tasks 
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE NULL;

-- Add index for efficient queries on completed tasks by user
CREATE INDEX IF NOT EXISTS idx_tasks_user_id_completed_at 
ON public.tasks(user_id, completed_at) 
WHERE completed_at IS NOT NULL;

-- Optional: Add comment for documentation
COMMENT ON COLUMN public.tasks.completed_at IS 'Timestamp when the task was completed';
```

## Changes Made

### 1. Backend (`backend/server.py`)
- **Made `get_tasks` endpoint resilient**: Now checks if `completed_at` and `effort` columns exist before querying
- If columns don't exist, returns `NULL` for those fields instead of throwing an error
- Tasks can now load even if the migration hasn't been run yet

### 2. Frontend (`frontend/src/components/MainApp.jsx`)
- **Improved error handling in `fetchTasks`**:
  - Added toast deduplication using `toast.error` with a fixed `id: 'fetch-tasks-error'`
  - Added debounce mechanism (5 seconds) to prevent spam
  - Shows helpful error message if `completed_at` column is missing
  - **Does NOT clear existing tasks on error** - keeps UI usable
  - Added `useRef` import for tracking last error toast

### 3. Error Messages
- Development: Shows detailed error message including column name if missing
- Production: Shows generic "Failed to fetch tasks" message
- Special case: If error mentions "completed_at", shows migration instruction

## How It Works

1. **First Time**: If `completed_at` doesn't exist, backend returns `NULL` for that field, tasks load successfully
2. **After Migration**: Once migration is run, backend uses the actual column, full functionality restored
3. **Error Handling**: If query still fails for other reasons, frontend shows one toast (deduplicated) and keeps existing tasks visible

## Testing

1. **Before migration**: Tasks should still load (with `completed_at` as `NULL`)
2. **After migration**: Full functionality restored
3. **Error scenarios**: Multiple rapid fetches should only show one toast


