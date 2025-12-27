#!/usr/bin/env python3
"""Run migration to add energy_required column to tasks table"""
import asyncio
import asyncpg
import ssl
import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
ROOT_DIR = Path(__file__).parent
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
    print("ERROR: DATABASE_URL not found in environment variables")
    exit(1)

async def run_migration():
    """Add energy_required column to tasks table if it doesn't exist"""
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE
    
    conn = await asyncpg.connect(DATABASE_URL, ssl=ssl_ctx)
    
    try:
        # Check if column exists
        column_exists = await conn.fetchval(
            """SELECT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'tasks' 
                AND column_name = 'energy_required'
            )"""
        )
        
        if column_exists:
            print("✓ Column 'energy_required' already exists in tasks table")
        else:
            print("Adding 'energy_required' column to tasks table...")
            await conn.execute(
                "ALTER TABLE tasks ADD COLUMN energy_required TEXT"
            )
            print("✓ Successfully added 'energy_required' column to tasks table")
        
        # Also check/add expires_at
        expires_at_exists = await conn.fetchval(
            """SELECT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'tasks' 
                AND column_name = 'expires_at'
            )"""
        )
        
        if expires_at_exists:
            print("✓ Column 'expires_at' already exists in tasks table")
        else:
            print("Adding 'expires_at' column to tasks table...")
            await conn.execute(
                "ALTER TABLE tasks ADD COLUMN expires_at TIMESTAMP WITH TIME ZONE"
            )
            print("✓ Successfully added 'expires_at' column to tasks table")
        
        print("\nMigration completed successfully!")
        
    except Exception as e:
        print(f"ERROR: Migration failed: {e}")
        raise
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(run_migration())

