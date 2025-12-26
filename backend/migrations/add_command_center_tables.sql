-- Migration: Add Command Center support
-- Adds completed_at, effort to tasks, creates focus_sessions and user_preferences tables

-- 1. Add completed_at column to tasks if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tasks' AND column_name = 'completed_at'
  ) THEN
    ALTER TABLE tasks ADD COLUMN completed_at TIMESTAMP WITH TIME ZONE NULL;
  END IF;
END $$;

-- 2. Add effort column to tasks if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tasks' AND column_name = 'effort'
  ) THEN
    ALTER TABLE tasks ADD COLUMN effort TEXT NULL 
      CHECK (effort IN ('low', 'medium', 'high'));
  END IF;
END $$;

-- 3. Add indexes for completed_at queries
CREATE INDEX IF NOT EXISTS idx_tasks_user_completed_at 
  ON tasks(user_id, completed_at) 
  WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_user_status 
  ON tasks(user_id, status);

-- 4. Create focus_sessions table
CREATE TABLE IF NOT EXISTS focus_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ended_at TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_minutes INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Create indexes for focus_sessions
CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_ended_at 
  ON focus_sessions(user_id, ended_at);

CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_id 
  ON focus_sessions(user_id);

-- 6. Create user_preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  energy_level TEXT NOT NULL DEFAULT 'medium' 
    CHECK (energy_level IN ('low', 'medium', 'high')),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Note: RLS policies should be added in Supabase dashboard or via separate migration
-- For Supabase, you would add:
-- ALTER TABLE focus_sessions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
-- 
-- CREATE POLICY "Users can view own focus_sessions" ON focus_sessions
--   FOR SELECT USING (user_id = auth.uid()::text);
-- CREATE POLICY "Users can insert own focus_sessions" ON focus_sessions
--   FOR INSERT WITH CHECK (user_id = auth.uid()::text);
-- CREATE POLICY "Users can update own focus_sessions" ON focus_sessions
--   FOR UPDATE USING (user_id = auth.uid()::text);
-- CREATE POLICY "Users can delete own focus_sessions" ON focus_sessions
--   FOR DELETE USING (user_id = auth.uid()::text);
--
-- CREATE POLICY "Users can view own preferences" ON user_preferences
--   FOR SELECT USING (user_id = auth.uid()::text);
-- CREATE POLICY "Users can insert own preferences" ON user_preferences
--   FOR INSERT WITH CHECK (user_id = auth.uid()::text);
-- CREATE POLICY "Users can update own preferences" ON user_preferences
--   FOR UPDATE USING (user_id = auth.uid()::text);


