#!/usr/bin/env python3
"""
Clear seed dumps and their dump_items from the database.

This script deletes all dumps with source='seed' and their associated dump_items.

Usage:
    python scripts/clear_seed_dumps.py
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


async def clear_seed_dumps():
    """Delete all seed dumps and their dump_items."""
    print("=" * 80)
    print("Clear Seed Dumps")
    print("=" * 80)
    print()
    
    try:
        # Disable prepared statement cache for pgbouncer compatibility
        pool = await asyncpg.create_pool(
            DATABASE_URL,
            statement_cache_size=0
        )
        async with pool.acquire() as conn:
            print("✓ Connected to database")
            print()
            
            # Count seed dumps
            seed_count = await conn.fetchval(
                "SELECT COUNT(*) FROM dumps WHERE source = 'seed'"
            )
            
            if seed_count == 0:
                print("✓ No seed dumps found. Nothing to delete.")
                print()
                return
            
            print(f"Found {seed_count} seed dump(s)")
            print()
            
            # Count dump_items that will be deleted
            items_count = await conn.fetchval(
                """SELECT COUNT(*) FROM dump_items di
                   INNER JOIN dumps d ON di.dump_id = d.id
                   WHERE d.source = 'seed'"""
            )
            
            print(f"This will delete:")
            print(f"  - {seed_count} dump(s)")
            print(f"  - {items_count} dump_item(s)")
            print()
            
            # Confirm deletion
            response = input("Are you sure you want to delete these? (yes/no): ")
            if response.lower() != 'yes':
                print("Cancelled.")
                return
            
            print()
            print("Deleting...")
            
            # Delete dump_items first (foreign key constraint)
            deleted_items = await conn.execute(
                """DELETE FROM dump_items
                   WHERE dump_id IN (SELECT id FROM dumps WHERE source = 'seed')"""
            )
            
            # Delete dumps
            deleted_dumps = await conn.execute(
                "DELETE FROM dumps WHERE source = 'seed'"
            )
            
            print()
            print(f"✓ Deleted {deleted_dumps.split()[-1]} dump(s)")
            print(f"✓ Deleted {deleted_items.split()[-1]} dump_item(s)")
            print()
            print("=" * 80)
            print("Clear complete!")
            print("=" * 80)
        
        await pool.close()
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(clear_seed_dumps())






