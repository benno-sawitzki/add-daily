#!/usr/bin/env python3
"""
Run a SQL migration file against the database.

Usage:
    python scripts/run_migration.py backend/migrations/add_extraction_status_columns.sql
"""
import os
import sys
import asyncio
import asyncpg
from pathlib import Path
from dotenv import load_dotenv

# Add backend to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

# Load environment variables
env_path = backend_dir / '.env'
if env_path.exists():
    load_dotenv(env_path)
    print(f"✓ Loaded environment from {env_path}")
else:
    print(f"⚠️  No .env file found at {env_path}, using system environment")

DATABASE_URL = os.environ.get('DATABASE_URL')
if not DATABASE_URL:
    print("❌ ERROR: DATABASE_URL not found in environment")
    sys.exit(1)

async def run_migration(migration_file: str):
    """Run a SQL migration file."""
    migration_path = Path(migration_file)
    if not migration_path.exists():
        print(f"❌ ERROR: Migration file not found: {migration_file}")
        sys.exit(1)
    
    print("=" * 80)
    print(f"Running Migration: {migration_path.name}")
    print("=" * 80)
    print()
    
    # Read migration SQL
    with open(migration_path, 'r') as f:
        sql = f.read()
    
    try:
        # Disable prepared statement cache for pgbouncer compatibility
        pool = await asyncpg.create_pool(
            DATABASE_URL,
            statement_cache_size=0
        )
        async with pool.acquire() as conn:
            print("✓ Connected to database")
            print()
            print("Executing migration SQL...")
            print()
            
            # Execute the migration
            await conn.execute(sql)
            
            print("✓ Migration completed successfully")
            print()
        
        await pool.close()
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/run_migration.py <migration_file.sql>")
        sys.exit(1)
    
    asyncio.run(run_migration(sys.argv[1]))






