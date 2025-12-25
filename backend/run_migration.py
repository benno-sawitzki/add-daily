#!/usr/bin/env python3
"""
Run the add_next_status migration.
This script uses the same database connection logic as server.py
"""
import asyncio
import asyncpg
import ssl
import os
from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent

# Load .env file if it exists
ENV = os.environ.get('ENV', 'development')
if ENV != 'production':
    env_path = ROOT_DIR / '.env'
    if env_path.exists():
        load_dotenv(env_path)
        print(f"✓ Loaded environment variables from {env_path}")
    else:
        print(f"⚠ .env file not found at {env_path}. Using system environment variables.")

DATABASE_URL = os.environ.get('DATABASE_URL')

if not DATABASE_URL:
    print("ERROR: DATABASE_URL environment variable is not set.")
    print("Please set it in your .env file or as an environment variable.")
    exit(1)

async def run_migration():
    """Run the migration SQL"""
    migration_sql = """
    -- 1. Update any invalid statuses to 'inbox' (safe default)
    UPDATE tasks SET status='inbox' WHERE status NOT IN ('inbox','scheduled','completed','next');

    -- 2. Create unique partial index: only one 'next' task per user
    CREATE UNIQUE INDEX IF NOT EXISTS one_next_task_per_user
    ON tasks(user_id)
    WHERE status = 'next';
    """
    
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE
    
    try:
        conn = await asyncpg.connect(
            DATABASE_URL,
            ssl=ssl_ctx
        )
        
        print("✓ Connected to database")
        print("Running migration: add_next_status...")
        
        # Run the migration
        await conn.execute(migration_sql)
        
        print("✓ Migration completed successfully!")
        print("  - Updated invalid statuses to 'inbox'")
        print("  - Created unique index: one_next_task_per_user")
        
        await conn.close()
        
    except Exception as e:
        print(f"✗ Migration failed: {e}")
        exit(1)

if __name__ == "__main__":
    asyncio.run(run_migration())

