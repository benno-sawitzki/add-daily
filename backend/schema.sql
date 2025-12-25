-- Database Schema for ADD Daily
-- Run this script on your PostgreSQL database to create the required tables

-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    hashed_password TEXT,
    google_id TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Tasks table for task management
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    priority INTEGER,
    urgency INTEGER,
    importance INTEGER,
    energy_required TEXT, -- low, medium, high
    scheduled_date DATE,
    scheduled_time TEXT,
    duration INTEGER,
    status TEXT,
    expires_at TIMESTAMP WITH TIME ZONE, -- For 'later' tasks (auto-delete after 14 days)
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Settings table for user preferences
CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    ai_provider TEXT NOT NULL,
    ai_model TEXT NOT NULL
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- Unique constraint: only one 'next' task per user
CREATE UNIQUE INDEX IF NOT EXISTS one_next_task_per_user
ON tasks(user_id)
WHERE status = 'next';

