#!/usr/bin/env python3
"""
Seed local dumps table with example transcripts for testing.

This script inserts 10 example dumps with realistic messy transcripts.
ONLY runs if DATABASE_URL points to localhost to avoid seeding production.

Usage:
    python scripts/seed_dumps_local.py
"""
import os
import sys
import asyncio
import asyncpg
from pathlib import Path
from dotenv import load_dotenv
from datetime import datetime, timezone
import uuid

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

# Check if this is a local database (safety check)
from urllib.parse import urlparse
parsed = urlparse(DATABASE_URL)
is_local = (
    parsed.hostname in ['localhost', '127.0.0.1', '0.0.0.0'] or
    os.environ.get('ENV') == 'local' or
    'localhost' in DATABASE_URL.lower()
)

if not is_local:
    print("❌ ERROR: DATABASE_URL does not point to localhost")
    print(f"   Hostname: {parsed.hostname}")
    print("   This script only seeds local databases for safety.")
    print("   Set ENV=local or use a localhost DATABASE_URL to proceed.")
    sys.exit(1)

print(f"✓ Confirmed local database: {parsed.hostname}")
print()

# Example transcripts with realistic issues
EXAMPLE_DUMPS = [
    {
        "transcript": "Okay, today first thing is I want to eat something and have a coffee and I need to go to the police that takes one hour and I need to do laundry that takes 30 minutes. I need to call Roberta, Tom and Oliver or message them. That takes 30 minutes. And work on the podcast and on the website. Podcast two, three hours. Yeah, maybe website not.",
        "raw_text": "Okay, today first thing is I want to eat something and have a coffee and I need to go to the police that takes one hour and I need to do laundry that takes 30 minutes. I need to call Roberta, Tom and Oliver or message them. That takes 30 minutes. And work on the podcast and on the website. Podcast two, three hours. Yeah, maybe website not."
    },
    {
        "transcript": "three hours. Yeah.",
        "raw_text": "three hours. Yeah."
    },
    {
        "transcript": "work on the website. maybe website not.",
        "raw_text": "work on the website. maybe website not."
    },
    {
        "transcript": "Call mom at 3pm. Then go to the store and buy groceries. That takes about an hour.",
        "raw_text": "Call mom at 3pm. Then go to the store and buy groceries. That takes about an hour."
    },
    {
        "transcript": "Okay. Review the proposal. Send email to John. And schedule meeting for next week.",
        "raw_text": "Okay. Review the proposal. Send email to John. And schedule meeting for next week."
    },
    {
        "transcript": "Roberta and Oliver that takes 30 minutes",
        "raw_text": "Roberta and Oliver that takes 30 minutes"
    },
    {
        "transcript": "Do laundry and have a coffee and go to lunch at 12",
        "raw_text": "Do laundry and have a coffee and go to lunch at 12"
    },
    {
        "transcript": "Write blog post about the new feature. That should take two hours. Then update the documentation.",
        "raw_text": "Write blog post about the new feature. That should take two hours. Then update the documentation."
    },
    {
        "transcript": "Yeah, um, I need to finish the report. Actually not the report, skip that. Just prepare the presentation.",
        "raw_text": "Yeah, um, I need to finish the report. Actually not the report, skip that. Just prepare the presentation."
    },
    {
        "transcript": "Book flight to New York. Check hotel availability. And rent a car. All for next month.",
        "raw_text": "Book flight to New York. Check hotel availability. And rent a car. All for next month."
    }
]


async def seed_dumps():
    """Seed the dumps table with example data."""
    print("=" * 80)
    print("Seeding Local Dumps")
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
            
            # Check if dumps table exists
            table_check = await conn.fetchrow("""
                SELECT table_name
                FROM information_schema.tables
                WHERE table_name = 'dumps'
            """)
            
            if not table_check:
                print("❌ ERROR: 'dumps' table does not exist")
                print("   Run migrations first: backend/migrations/create_dumps_tables_simple.sql")
                sys.exit(1)
            
            # Get or create a dummy user_id for seeding
            # Try to get first user, or create a dummy one
            user_row = await conn.fetchrow("SELECT id FROM users LIMIT 1")
            if user_row:
                user_id = user_row['id']
                print(f"✓ Using existing user: {user_id[:8]}...")
            else:
                # Create a dummy user for seeding
                user_id = str(uuid.uuid4())
                await conn.execute("""
                    INSERT INTO users (id, email, name, created_at)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (id) DO NOTHING
                """, user_id, "seed@local.test", "Seed User", datetime.now(timezone.utc))
                print(f"✓ Created seed user: {user_id[:8]}...")
            
            print()
            print(f"Inserting {len(EXAMPLE_DUMPS)} example dumps...")
            print()
            
            inserted_count = 0
            for i, dump_data in enumerate(EXAMPLE_DUMPS, 1):
                dump_id = str(uuid.uuid4())
                created_at = datetime.now(timezone.utc)
                
                try:
                    await conn.execute("""
                        INSERT INTO dumps (id, user_id, created_at, source, raw_text, transcript)
                        VALUES ($1, $2, $3, $4, $5, $6)
                    """, dump_id, user_id, created_at, 'seed', dump_data['raw_text'], dump_data['transcript'])
                    
                    inserted_count += 1
                    preview = dump_data['transcript'][:60] + "..." if len(dump_data['transcript']) > 60 else dump_data['transcript']
                    print(f"  {i}. {preview}")
                    
                except Exception as e:
                    print(f"  {i}. ❌ Failed: {e}")
            
            print()
            print(f"✓ Inserted {inserted_count} dumps")
            print()
            print("=" * 80)
            print("Seeding complete!")
            print("=" * 80)
            print()
            print("Next steps:")
            print("  1. Export dumps: python scripts/export_dump_transcripts.py --limit 50")
            print("  2. Create golden: python scripts/make_golden_from_raw.py")
        
        await pool.close()
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(seed_dumps())






