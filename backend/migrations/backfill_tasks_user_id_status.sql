-- Backfill migration: Fix NULL user_id and status for existing tasks
-- This migration should be run after the Command Center migration

-- IMPORTANT: This is a one-time backfill for existing data
-- For Supabase: Run this in the SQL editor after confirming your user_id

-- Step 1: Check if there are tasks with NULL user_id
-- SELECT COUNT(*) FROM tasks WHERE user_id IS NULL;

-- Step 2: Backfill NULL status to 'inbox' for existing tasks
-- Only update tasks that have NULL status (don't overwrite existing values)
UPDATE tasks 
SET status = 'inbox' 
WHERE status IS NULL;

-- Step 3: For NULL user_id tasks, you need to manually assign them to a user
-- This should be done carefully - we can't auto-assign without knowing ownership
-- Example (replace with actual user_id):
-- UPDATE tasks 
-- SET user_id = 'your-user-id-here' 
-- WHERE user_id IS NULL;

-- Step 4: Add default values to prevent future NULL issues
ALTER TABLE tasks 
ALTER COLUMN status SET DEFAULT 'inbox';

-- Note: If you're using Supabase with UUID user_id from auth.users,
-- make sure your tasks.user_id column matches the type (TEXT or UUID).
-- If tasks.user_id is TEXT and auth.users.id is UUID, you may need:
-- UPDATE tasks SET user_id = user_id::uuid::text WHERE user_id IS NOT NULL;


