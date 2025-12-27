#!/usr/bin/env python3
"""
Export dump transcripts to a local fixture file.

This script exports the latest N dump transcripts from the database.
The storage location is auto-discovered or can be configured at the top.

Usage:
    python scripts/export_dump_transcripts.py --limit 50
    python scripts/export_dump_transcripts.py --limit 50 --out backend/tests/fixtures/dumps_raw.json
"""
import os
import sys
import asyncio
import asyncpg
import json
import argparse
from pathlib import Path
from dotenv import load_dotenv
from datetime import datetime

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
    print("   Set DATABASE_URL in backend/.env or as an environment variable")
    sys.exit(1)

# Print masked DATABASE_URL for verification (show host/db, not password)
try:
    from urllib.parse import urlparse
    parsed = urlparse(DATABASE_URL)
    masked = f"{parsed.scheme}://{parsed.hostname}:{parsed.port or 'default'}/{parsed.path.split('/')[-1]}"
    print(f"✓ DATABASE_URL found: {masked}")
except:
    print("✓ DATABASE_URL found (masked)")

# Storage location (auto-discovered, but can be manually set)
# Run find_dump_storage.py to discover these values
# Based on code analysis: INSERT INTO dumps (id, user_id, created_at, source, raw_text, transcript)
# See server.py line 2641: INSERT INTO dumps (id, user_id, created_at, source, raw_text, transcript)
DUMP_TABLE = "dumps"  # Table name storing dumps
TRANSCRIPT_COLUMN = "transcript"  # Column name storing transcript text
CREATED_COLUMN = "created_at"  # Column name for created timestamp
ID_COLUMN = "id"  # Primary key column


async def discover_storage_location(conn):
    """Auto-discover storage location if not set."""
    query = """
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_name ILIKE '%dump%'
        AND column_name ILIKE '%transcript%'
        LIMIT 1
    """
    result = await conn.fetchrow(query)
    if result:
        return result['table_name'], result['column_name']
    return None, None


async def export_transcripts(limit=50, output_path=None):
    """Export dump transcripts to JSON file."""
    if output_path is None:
        output_path = backend_dir / "tests" / "fixtures" / "dumps_raw.json"
    else:
        output_path = Path(output_path)
    
    # Ensure output directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    print("=" * 80)
    print("Exporting Dump Transcripts")
    print("=" * 80)
    print(f"Limit: {limit}")
    print(f"Output: {output_path}")
    print()
    
    try:
        # Disable prepared statement cache for pgbouncer compatibility
        pool = await asyncpg.create_pool(
            DATABASE_URL,
            statement_cache_size=0  # Disable prepared statement cache
        )
        async with pool.acquire() as conn:
            print("✓ Connected to database")
            
            # Auto-discover if needed
            table_name = DUMP_TABLE
            transcript_col = TRANSCRIPT_COLUMN
            
            # Verify table/column exist
            check_query = """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = $1 AND column_name = $2
            """
            exists = await conn.fetchrow(check_query, table_name, transcript_col)
            
            if not exists:
                print(f"⚠️  Table '{table_name}' or column '{transcript_col}' not found, attempting auto-discovery...")
                discovered_table, discovered_col = await discover_storage_location(conn)
                if discovered_table and discovered_col:
                    table_name = discovered_table
                    transcript_col = discovered_col
                    print(f"✓ Discovered: table='{table_name}', column='{transcript_col}'")
                else:
                    print("❌ Could not discover storage location. Please run find_dump_storage.py first.")
                    sys.exit(1)
            
            # Verify ID column exists
            id_check_query = """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = $1 AND column_name = $2
            """
            id_exists = await conn.fetchrow(id_check_query, table_name, ID_COLUMN)
            if not id_exists:
                print(f"⚠️  ID column '{ID_COLUMN}' not found, using row_number() instead")
                use_row_number = True
            else:
                use_row_number = False
            
            print(f"Using: table='{table_name}', column='{transcript_col}'")
            print()
            
            # Check if created column exists
            created_check_query = """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = $1 AND column_name = $2
            """
            created_exists = await conn.fetchrow(created_check_query, table_name, CREATED_COLUMN)
            
            # Build query (use string formatting for identifiers, parameterized for values)
            # Note: Table/column names are identifiers, so we format them (they're constants from config)
            if created_exists:
                if use_row_number:
                    query = f"""
                        SELECT 
                            ROW_NUMBER() OVER (ORDER BY "{CREATED_COLUMN}" DESC NULLS LAST)::text as id,
                            "{CREATED_COLUMN}" as created_at,
                            "{transcript_col}" as transcript
                        FROM "{table_name}"
                        WHERE "{transcript_col}" IS NOT NULL 
                        AND LENGTH("{transcript_col}") >= 10
                        ORDER BY "{CREATED_COLUMN}" DESC NULLS LAST
                        LIMIT $1
                    """
                else:
                    query = f"""
                        SELECT 
                            "{ID_COLUMN}" as id,
                            "{CREATED_COLUMN}" as created_at,
                            "{transcript_col}" as transcript
                        FROM "{table_name}"
                        WHERE "{transcript_col}" IS NOT NULL 
                        AND LENGTH("{transcript_col}") >= 10
                        ORDER BY "{CREATED_COLUMN}" DESC NULLS LAST
                        LIMIT $1
                    """
            else:
                print(f"⚠️  Created column '{CREATED_COLUMN}' not found, using LIMIT without ordering")
                if use_row_number:
                    query = f"""
                        SELECT 
                            ROW_NUMBER() OVER ()::text as id,
                            NULL as created_at,
                            "{transcript_col}" as transcript
                        FROM "{table_name}"
                        WHERE "{transcript_col}" IS NOT NULL 
                        AND LENGTH("{transcript_col}") >= 10
                        LIMIT $1
                    """
                else:
                    query = f"""
                        SELECT 
                            "{ID_COLUMN}" as id,
                            NULL as created_at,
                            "{transcript_col}" as transcript
                        FROM "{table_name}"
                        WHERE "{transcript_col}" IS NOT NULL 
                        AND LENGTH("{transcript_col}") >= 10
                        LIMIT $1
                    """
            
            print("Fetching transcripts...")
            rows = await conn.fetch(query, limit)
            
            if not rows:
                print("⚠️  No transcripts found")
                return
            
            print(f"✓ Found {len(rows)} transcripts")
            print()
            
            # Convert to JSON-serializable format
            exports = []
            for row in rows:
                export_item = {
                    "id": str(row['id']) if row['id'] else None,
                    "created_at": row['created_at'].isoformat() if row['created_at'] else None,
                    "transcript": row['transcript']
                }
                exports.append(export_item)
            
            # Write to file
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(exports, f, indent=2, ensure_ascii=False)
            
            print(f"✓ Exported {len(exports)} transcripts to {output_path}")
            print()
            print("Sample (first transcript, truncated to 200 chars):")
            if exports:
                sample = exports[0]['transcript']
                preview = sample[:200] + "..." if len(sample) > 200 else sample
                print(f"  {preview}")
                if exports[0]['created_at']:
                    print(f"  Created: {exports[0]['created_at']}")
            
            print()
            print("=" * 80)
            print("Export complete!")
            print("=" * 80)
        
        await pool.close()
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export dump transcripts to fixture file")
    parser.add_argument("--limit", type=int, default=50, help="Number of transcripts to export (default: 50)")
    parser.add_argument("--out", type=str, default=None, help="Output file path (default: backend/tests/fixtures/dumps_raw.json)")
    
    args = parser.parse_args()
    
    asyncio.run(export_transcripts(limit=args.limit, output_path=args.out))

