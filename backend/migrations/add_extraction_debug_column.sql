-- Add extraction_debug JSONB column to dumps table for storing extraction trace data
-- This column stores debug information when ENV=development or EXTRACT_DEBUG=1

ALTER TABLE public.dumps 
ADD COLUMN IF NOT EXISTS extraction_debug JSONB NULL;

COMMENT ON COLUMN public.dumps.extraction_debug IS 'Debug information for extraction: segments, LLM raw output, final tasks, trace_id. Only populated in development mode.';






