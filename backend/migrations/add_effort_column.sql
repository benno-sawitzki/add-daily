-- Migration: Add effort column to tasks table
-- Run this in Supabase SQL Editor

-- Add effort column if it doesn't exist
ALTER TABLE public.tasks 
ADD COLUMN IF NOT EXISTS effort TEXT NULL 
CHECK (effort IN ('low', 'medium', 'high'));

-- Optional: Add a comment for documentation
COMMENT ON COLUMN public.tasks.effort IS 'Energy/effort level required for the task (low, medium, high)';


