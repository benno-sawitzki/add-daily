-- Add trace_id column to dumps table for extraction debugging
ALTER TABLE public.dumps
ADD COLUMN IF NOT EXISTS trace_id TEXT;

CREATE INDEX IF NOT EXISTS idx_dumps_trace_id ON public.dumps(trace_id) WHERE trace_id IS NOT NULL;

COMMENT ON COLUMN public.dumps.trace_id IS 'Unique trace ID for debugging extraction pipeline';






