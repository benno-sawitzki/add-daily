-- Add missing columns to tasks table
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS energy_required TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;
