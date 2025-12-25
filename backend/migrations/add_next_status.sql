-- Migration: Add 'next' status and unique constraint
-- Run this after deploying the backend changes

-- 1. Update any invalid statuses to 'inbox' (safe default)
UPDATE tasks SET status='inbox' WHERE status NOT IN ('inbox','scheduled','completed','next');

-- 2. Create unique partial index: only one 'next' task per user
CREATE UNIQUE INDEX IF NOT EXISTS one_next_task_per_user
ON tasks(user_id)
WHERE status = 'next';

