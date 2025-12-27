-- Migration: Rename importance to impakt and remove urgency
-- This migration:
-- 1. Adds impakt column (nullable TEXT: 'low', 'medium', 'high', or NULL)
-- 2. Migrates existing importance values (1=low, 2=medium, 3=high, 4=critical -> high)
-- 3. Drops urgency column (or marks it as unused)
-- 4. Drops importance column after migration

-- Step 1: Add impakt column
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS impakt TEXT;

-- Step 2: Migrate existing importance values to impakt
-- Map: 1=low, 2=medium, 3=high, 4=critical -> high
UPDATE tasks 
SET impakt = CASE 
    WHEN importance = 1 THEN 'low'
    WHEN importance = 2 THEN 'medium'
    WHEN importance = 3 THEN 'high'
    WHEN importance = 4 THEN 'high'  -- Critical maps to high
    ELSE NULL
END
WHERE impakt IS NULL AND importance IS NOT NULL;

-- Step 3: Drop urgency column (if it exists and you can drop it)
-- Note: If you need to keep it for backwards compatibility temporarily, comment this out
-- ALTER TABLE tasks DROP COLUMN IF EXISTS urgency;

-- Step 4: Drop importance column after migration is verified
-- Note: Uncomment this after verifying the migration worked correctly
-- ALTER TABLE tasks DROP COLUMN IF EXISTS importance;



