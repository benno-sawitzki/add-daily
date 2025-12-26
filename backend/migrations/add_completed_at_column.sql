-- Migration: Add completed_at column to tasks table
-- Run this in Supabase SQL Editor

-- Add completed_at column if it doesn't exist
ALTER TABLE public.tasks 
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE NULL;

-- Add index for efficient queries on completed tasks by user
CREATE INDEX IF NOT EXISTS idx_tasks_user_id_completed_at 
ON public.tasks(user_id, completed_at) 
WHERE completed_at IS NOT NULL;

-- Optional: Add a comment for documentation
COMMENT ON COLUMN public.tasks.completed_at IS 'Timestamp when the task was completed';


