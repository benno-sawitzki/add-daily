-- Migration: Add task fields to dump_items table
-- This allows dump_items to have all the same attributes as tasks (urgency, importance, energy, etc.)

-- Add task-related fields to dump_items
ALTER TABLE dump_items 
ADD COLUMN IF NOT EXISTS urgency INTEGER DEFAULT 2 CHECK (urgency >= 1 AND urgency <= 4),
ADD COLUMN IF NOT EXISTS importance INTEGER DEFAULT 2 CHECK (importance >= 1 AND importance <= 4),
ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 2 CHECK (priority >= 1 AND priority <= 4),
ADD COLUMN IF NOT EXISTS energy_required TEXT DEFAULT 'medium' CHECK (energy_required IN ('low', 'medium', 'high')),
ADD COLUMN IF NOT EXISTS scheduled_date DATE,
ADD COLUMN IF NOT EXISTS scheduled_time TEXT,
ADD COLUMN IF NOT EXISTS duration INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS description TEXT;

-- Update existing rows to have default values
UPDATE dump_items 
SET urgency = 2, importance = 2, priority = 2, energy_required = 'medium', duration = 30
WHERE urgency IS NULL OR importance IS NULL OR priority IS NULL OR energy_required IS NULL OR duration IS NULL;







