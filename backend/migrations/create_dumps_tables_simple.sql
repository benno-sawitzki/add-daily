-- Create dumps table for capture sessions
-- Simplified schema to match backend code (TEXT IDs, no RLS)
CREATE TABLE IF NOT EXISTS dumps (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('voice', 'text')),
    raw_text TEXT NOT NULL,
    transcript TEXT,
    clarified_at TIMESTAMP WITH TIME ZONE,
    archived_at TIMESTAMP WITH TIME ZONE
);

-- Create dump_items table for items within a dump
CREATE TABLE IF NOT EXISTS dump_items (
    id TEXT PRIMARY KEY,
    dump_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'promoted', 'snoozed', 'saved', 'trashed', 'converted')),
    snooze_until TIMESTAMP WITH TIME ZONE,
    linked_task_id TEXT,
    converted_task_id TEXT,
    state TEXT,
    user_id TEXT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_dumps_user_id_created_at ON dumps(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dumps_user_id_archived_at ON dumps(user_id, archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dump_items_dump_id ON dump_items(dump_id);
CREATE INDEX IF NOT EXISTS idx_dump_items_status ON dump_items(status);
CREATE INDEX IF NOT EXISTS idx_dump_items_linked_task_id ON dump_items(linked_task_id) WHERE linked_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dump_items_converted_task_id ON dump_items(converted_task_id) WHERE converted_task_id IS NOT NULL;

