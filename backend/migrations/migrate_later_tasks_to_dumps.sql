-- Migration: Convert Later tasks to Dumps
-- This preserves existing user data by converting each Later task into a Dump
-- with one saved dump_item, then marks the original task as completed

-- Step 1: Create dumps from Later tasks
-- For each task with status='later', create a dump and a saved item
INSERT INTO public.dumps (id, user_id, created_at, source, raw_text, clarified_at, archived_at)
SELECT 
    gen_random_uuid(),
    user_id,
    created_at,
    'text'::text,
    COALESCE(title || E'\n' || description, title, description, 'Migrated from Later') AS raw_text,
    now() AS clarified_at, -- Mark as clarified since we're creating the item
    NULL
FROM public.tasks
WHERE status = 'later'
ON CONFLICT DO NOTHING;

-- Step 2: Create saved dump_items for each migrated task
INSERT INTO public.dump_items (id, dump_id, created_at, text, status)
SELECT 
    gen_random_uuid(),
    d.id AS dump_id,
    t.created_at,
    COALESCE(t.title || E'\n' || t.description, t.title, t.description, 'Migrated item') AS text,
    'saved'::text AS status
FROM public.tasks t
JOIN public.dumps d ON (
    d.user_id = t.user_id 
    AND d.source = 'text'
    AND d.raw_text = COALESCE(t.title || E'\n' || t.description, t.title, t.description, 'Migrated from Later')
    AND d.created_at = t.created_at
)
WHERE t.status = 'later';

-- Step 3: Mark original Later tasks as completed (preserve in history via Logbook)
UPDATE public.tasks
SET 
    status = 'completed',
    completed_at = now()
WHERE status = 'later';

-- Note: This migration assumes:
-- 1. dumps and dump_items tables exist (run create_dumps_tables.sql first)
-- 2. tasks table has status column with 'later' value
-- 3. tasks table has completed_at column (for marking as done)


