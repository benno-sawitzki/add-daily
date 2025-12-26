-- Migration: Add sort_order column to tasks table for proper task ordering
-- Run this in Supabase SQL Editor

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
  -- Higher priority first, then older tasks first
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
  
  -- For other statuses, set sort_order based on created_at
  UPDATE public.tasks
  SET sort_order = subq.row_num - 1
  FROM (
    SELECT 
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, status 
        ORDER BY created_at ASC NULLS LAST
      ) as row_num
    FROM public.tasks
    WHERE status != 'inbox' AND sort_order IS NULL
  ) subq
  WHERE tasks.id = subq.id;
END $$;

-- Optional: Add comment for documentation
COMMENT ON COLUMN public.tasks.sort_order IS 'Display order for tasks (0-based index, lower = higher in list). Used for drag-and-drop reordering.';


