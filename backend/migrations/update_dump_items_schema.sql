-- Migration: Update dump_items table to clean triage schema
-- This migration recreates dump_items with the clean contract:
-- - Dump = capture record only
-- - DumpItem = extracted task candidate (triage object)
-- - Task = only created when DumpItem is promoted

-- Note: Uses TEXT IDs to match existing dumps and users tables

-- Drop existing dump_items table (if you have data to preserve, back it up first)
DROP TABLE IF EXISTS dump_items CASCADE;

-- Create dump_items table with clean schema
CREATE TABLE dump_items (
    id TEXT PRIMARY KEY,
    dump_id TEXT NOT NULL REFERENCES dumps(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'promoted', 'dismissed')),
    created_task_id TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Indexes for performance
CREATE INDEX idx_dump_items_user_id_status ON dump_items(user_id, status);
CREATE INDEX idx_dump_items_dump_id ON dump_items(dump_id);
CREATE INDEX idx_dump_items_created_task_id ON dump_items(created_task_id) WHERE created_task_id IS NOT NULL;

