-- Add expires_at column to tasks table
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

-- Create index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_tasks_expires_at ON tasks(expires_at) WHERE expires_at IS NOT NULL;

-- Cleanup expired 'later' tasks (run this periodically or on startup)
-- DELETE FROM tasks WHERE status = 'later' AND expires_at < NOW();

