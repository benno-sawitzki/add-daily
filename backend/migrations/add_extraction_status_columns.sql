-- Add extraction status columns to dumps table
ALTER TABLE public.dumps
ADD COLUMN IF NOT EXISTS extraction_status TEXT,
ADD COLUMN IF NOT EXISTS extraction_item_count INTEGER,
ADD COLUMN IF NOT EXISTS extraction_error TEXT;

COMMENT ON COLUMN public.dumps.extraction_status IS 'Status of extraction: success, error, or null if not extracted';
COMMENT ON COLUMN public.dumps.extraction_item_count IS 'Number of dump_items created from this dump';
COMMENT ON COLUMN public.dumps.extraction_error IS 'Error message if extraction failed';






