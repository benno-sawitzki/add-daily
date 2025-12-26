-- Migration: Ensure minimal tasks table schema for saving tasks to inbox
-- This migration ensures ONLY the required columns exist for core functionality
-- Run this in Supabase SQL Editor

-- Required columns (must exist for saving tasks to inbox)
-- 1. Ensure status column exists with default 'inbox'
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'tasks' 
    AND column_name = 'status'
  ) THEN
    ALTER TABLE tasks ADD COLUMN status TEXT DEFAULT 'inbox';
    -- Add index for status queries
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status);
  ELSE
    -- Ensure default value is set
    ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'inbox';
  END IF;
END $$;

-- 2. Ensure created_at column exists with default now()
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'tasks' 
    AND column_name = 'created_at'
  ) THEN
    ALTER TABLE tasks ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL;
  ELSE
    -- Ensure default value is set and not null constraint
    ALTER TABLE tasks ALTER COLUMN created_at SET DEFAULT NOW();
    -- Only add NOT NULL if column allows nulls
    BEGIN
      ALTER TABLE tasks ALTER COLUMN created_at SET NOT NULL;
    EXCEPTION
      WHEN OTHERS THEN
        -- Column already has NOT NULL or has null values, skip
        NULL;
    END;
  END IF;
END $$;

-- Optional but recommended columns (won't block inserts if missing)
-- These are checked dynamically in the code

-- 3. Ensure description exists (optional)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'tasks' 
    AND column_name = 'description'
  ) THEN
    ALTER TABLE tasks ADD COLUMN description TEXT;
  END IF;
END $$;

-- 4. Ensure priority exists (optional but commonly used)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'tasks' 
    AND column_name = 'priority'
  ) THEN
    ALTER TABLE tasks ADD COLUMN priority INTEGER;
  END IF;
END $$;

-- 5. Ensure urgency exists (optional)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'tasks' 
    AND column_name = 'urgency'
  ) THEN
    ALTER TABLE tasks ADD COLUMN urgency INTEGER;
  END IF;
END $$;

-- 6. Ensure importance exists (optional)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'tasks' 
    AND column_name = 'importance'
  ) THEN
    ALTER TABLE tasks ADD COLUMN importance INTEGER;
  END IF;
END $$;

-- 7. Ensure duration exists (optional)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'tasks' 
    AND column_name = 'duration'
  ) THEN
    ALTER TABLE tasks ADD COLUMN duration INTEGER;
  END IF;
END $$;

-- Optional enhancement columns (for Command Center - don't block core flows)
-- 8. completed_at (for metrics - optional)
ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_user_id_completed_at 
ON tasks(user_id, completed_at) 
WHERE completed_at IS NOT NULL;

-- 9. effort (for energy matching - optional)
ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS effort TEXT NULL 
CHECK (effort IN ('low', 'medium', 'high'));

-- Note: These migrations do NOT create focus_sessions or user_preferences tables
-- Those are only needed for Command Center metrics and should not block task creation


