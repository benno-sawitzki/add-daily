-- RLS Policies for Supabase
-- Run this migration in Supabase SQL editor after running add_command_center_tables.sql

-- Enable RLS on focus_sessions
ALTER TABLE focus_sessions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (idempotent)
DROP POLICY IF EXISTS "Users can view own focus_sessions" ON focus_sessions;
DROP POLICY IF EXISTS "Users can insert own focus_sessions" ON focus_sessions;
DROP POLICY IF EXISTS "Users can update own focus_sessions" ON focus_sessions;
DROP POLICY IF EXISTS "Users can delete own focus_sessions" ON focus_sessions;

-- Create RLS policies for focus_sessions
CREATE POLICY "Users can view own focus_sessions" 
  ON focus_sessions FOR SELECT 
  USING (user_id::text = auth.uid()::text);

CREATE POLICY "Users can insert own focus_sessions" 
  ON focus_sessions FOR INSERT 
  WITH CHECK (user_id::text = auth.uid()::text);

CREATE POLICY "Users can update own focus_sessions" 
  ON focus_sessions FOR UPDATE 
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

CREATE POLICY "Users can delete own focus_sessions" 
  ON focus_sessions FOR DELETE 
  USING (user_id::text = auth.uid()::text);

-- Enable RLS on user_preferences
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (idempotent)
DROP POLICY IF EXISTS "Users can view own preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users can insert own preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users can update own preferences" ON user_preferences;

-- Create RLS policies for user_preferences
CREATE POLICY "Users can view own preferences" 
  ON user_preferences FOR SELECT 
  USING (user_id::text = auth.uid()::text);

CREATE POLICY "Users can insert own preferences" 
  ON user_preferences FOR INSERT 
  WITH CHECK (user_id::text = auth.uid()::text);

CREATE POLICY "Users can update own preferences" 
  ON user_preferences FOR UPDATE 
  USING (user_id::text = auth.uid()::text)
  WITH CHECK (user_id::text = auth.uid()::text);

-- Note: If your tasks table also needs RLS, uncomment below:
-- ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
-- 
-- DROP POLICY IF EXISTS "Users can view own tasks" ON tasks;
-- DROP POLICY IF EXISTS "Users can insert own tasks" ON tasks;
-- DROP POLICY IF EXISTS "Users can update own tasks" ON tasks;
-- DROP POLICY IF EXISTS "Users can delete own tasks" ON tasks;
-- 
-- CREATE POLICY "Users can view own tasks" 
--   ON tasks FOR SELECT 
--   USING (user_id::text = auth.uid()::text);
-- 
-- CREATE POLICY "Users can insert own tasks" 
--   ON tasks FOR INSERT 
--   WITH CHECK (user_id::text = auth.uid()::text);
-- 
-- CREATE POLICY "Users can update own tasks" 
--   ON tasks FOR UPDATE 
--   USING (user_id::text = auth.uid()::text)
--   WITH CHECK (user_id::text = auth.uid()::text);
-- 
-- CREATE POLICY "Users can delete own tasks" 
--   ON tasks FOR DELETE 
--   USING (user_id::text = auth.uid()::text);


