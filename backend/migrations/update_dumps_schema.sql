-- Migration to update dumps and dump_items schema to match new contract
-- This migration updates the schema to use status (captured|processed) and state (new|converted|discarded)

-- ===== DUMPS TABLE =====
-- Update dumps table: remove transcript, clarified_at, archived_at; add status

-- Add status column if it doesn't exist
ALTER TABLE public.dumps ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'captured' CHECK (status IN ('captured', 'processed'));

-- Update existing rows to set status based on clarified_at (if clarified_at exists, set to 'processed')
UPDATE public.dumps SET status = 'processed' WHERE clarified_at IS NOT NULL AND status = 'captured';

-- Make status NOT NULL after setting defaults
ALTER TABLE public.dumps ALTER COLUMN status SET NOT NULL;

-- Remove old columns (if they exist, allow NULLs first then drop)
ALTER TABLE public.dumps ALTER COLUMN transcript DROP NOT NULL;
ALTER TABLE public.dumps DROP COLUMN IF EXISTS transcript;
ALTER TABLE public.dumps DROP COLUMN IF EXISTS clarified_at;
ALTER TABLE public.dumps DROP COLUMN IF EXISTS archived_at;

-- ===== DUMP_ITEMS TABLE =====
-- Update dump_items table: remove status, snooze_until, linked_task_id; add extracted_order, state, user_id

-- Add new columns
ALTER TABLE public.dump_items ADD COLUMN IF NOT EXISTS extracted_order INTEGER;
ALTER TABLE public.dump_items ADD COLUMN IF NOT EXISTS state TEXT DEFAULT 'new' CHECK (state IN ('new', 'converted', 'discarded'));
ALTER TABLE public.dump_items ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Set user_id from parent dump if it's NULL
UPDATE public.dump_items 
SET user_id = dumps.user_id 
FROM public.dumps 
WHERE dump_items.dump_id = dumps.id 
  AND dump_items.user_id IS NULL;

-- Set extracted_order based on created_at (order by creation time)
WITH ordered_items AS (
    SELECT 
        id,
        ROW_NUMBER() OVER (PARTITION BY dump_id ORDER BY created_at ASC) - 1 AS row_num
    FROM public.dump_items
)
UPDATE public.dump_items 
SET extracted_order = ordered_items.row_num
FROM ordered_items
WHERE dump_items.id = ordered_items.id
  AND dump_items.extracted_order IS NULL;

-- Migrate old status values to new state values
-- promoted -> converted, saved/snoozed/trashed -> discarded, new -> new
UPDATE public.dump_items SET state = 'converted' WHERE status IN ('promoted') AND state = 'new';
UPDATE public.dump_items SET state = 'discarded' WHERE status IN ('saved', 'snoozed', 'trashed') AND state = 'new';

-- Make state NOT NULL after setting defaults
ALTER TABLE public.dump_items ALTER COLUMN state SET NOT NULL;

-- Make user_id NOT NULL after backfilling
ALTER TABLE public.dump_items ALTER COLUMN user_id SET NOT NULL;

-- Remove old columns
ALTER TABLE public.dump_items DROP COLUMN IF EXISTS status;
ALTER TABLE public.dump_items DROP COLUMN IF EXISTS snooze_until;
ALTER TABLE public.dump_items DROP COLUMN IF EXISTS linked_task_id;

-- ===== INDEXES =====
-- Add index for extracted_order if needed
CREATE INDEX IF NOT EXISTS idx_dump_items_dump_id_order ON public.dump_items(dump_id, extracted_order);
CREATE INDEX IF NOT EXISTS idx_dump_items_user_id ON public.dump_items(user_id);
CREATE INDEX IF NOT EXISTS idx_dump_items_state ON public.dump_items(state);

-- Remove old indexes that may no longer be relevant
DROP INDEX IF EXISTS public.idx_dump_items_status;
DROP INDEX IF EXISTS public.idx_dump_items_linked_task_id;
DROP INDEX IF EXISTS public.idx_dumps_user_id_archived_at;

-- ===== RLS POLICIES =====
-- Update RLS policies to match new schema
-- Note: These policies should already exist, but we ensure they work with new columns

-- Dump_items RLS: user_id is now directly on dump_items, so we can simplify policies
-- Drop old policies
DROP POLICY IF EXISTS "Users can view dump_items for their dumps" ON public.dump_items;
DROP POLICY IF EXISTS "Users can create dump_items for their dumps" ON public.dump_items;
DROP POLICY IF EXISTS "Users can update dump_items for their dumps" ON public.dump_items;
DROP POLICY IF EXISTS "Users can delete dump_items for their dumps" ON public.dump_items;

-- Create new simpler policies using user_id directly
CREATE POLICY "Users can view their own dump_items"
    ON public.dump_items FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can create their own dump_items"
    ON public.dump_items FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own dump_items"
    ON public.dump_items FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own dump_items"
    ON public.dump_items FOR DELETE
    USING (user_id = auth.uid());


