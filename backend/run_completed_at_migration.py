#!/usr/bin/env python3
"""
Run the add_completed_at_column migration.
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
    migration_file = ROOT_DIR / 'migrations' / 'add_completed_at_column.sql'
    
    if not migration_file.exists():
        print(f"ERROR: Migration file not found: {migration_file}")
        exit(1)
    
    migration_sql = migration_file.read_text()
    
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE
    
    try:
        conn = await asyncpg.connect(
            DATABASE_URL,
            ssl=ssl_ctx
        )
        
        print("✓ Connected to database")
        print("Running migration: add_completed_at_column...")
        
        # Run the migration
        await conn.execute(migration_sql)
        
        print("✓ Migration completed successfully!")
        print("  - Added completed_at column to tasks table")
        print("  - Created index: idx_tasks_user_id_completed_at")
        print("\nYou can now refresh the app and the Command Center should work!")
        
        await conn.close()
        
    except Exception as e:
        print(f"✗ Migration failed: {e}")
        import traceback
        traceback.print_exc()
        exit(1)

if __name__ == "__main__":
    asyncio.run(run_migration())







