#!/usr/bin/env python3
"""
Find where dump transcripts are stored in the database.

This script introspects the database schema to discover:
- Table name that stores dumps
- Column name that stores transcripts
- Sample data to confirm

Usage:
    python scripts/find_dump_storage.py
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
    print("   Set DATABASE_URL in backend/.env or as an environment variable")
    sys.exit(1)

# Print masked DATABASE_URL for verification
try:
    from urllib.parse import urlparse
    parsed = urlparse(DATABASE_URL)
    masked = f"{parsed.scheme}://{parsed.hostname}:{parsed.port or 'default'}/{parsed.path.split('/')[-1]}"
    print(f"✓ DATABASE_URL found: {masked}")
except:
    print("✓ DATABASE_URL found (masked)")


async def find_dump_storage():
    """Discover where dump transcripts are stored."""
    print("=" * 80)
    print("Finding Dump Storage Location")
    print("=" * 80)
    print()
    
    # Connect to database
    try:
        # Disable prepared statement cache for pgbouncer compatibility
        pool = await asyncpg.create_pool(
            DATABASE_URL,
            statement_cache_size=0  # Disable prepared statement cache
        )
        async with pool.acquire() as conn:
            print("✓ Connected to database")
            print()
            
            # Find candidate tables and columns
            print("Searching for candidate tables/columns...")
            print()
            
            # Query for tables matching dump-related patterns
            table_query = """
                SELECT table_name, column_name, data_type
                FROM information_schema.columns
                WHERE (
                    table_name ILIKE ANY(ARRAY['%dump%', '%capture%', '%inbox%', '%record%', '%note%'])
                    OR column_name ILIKE ANY(ARRAY['%dump%', '%transcript%', '%content%', '%text%', '%raw%'])
                )
                ORDER BY 
                    CASE 
                        WHEN table_name ILIKE '%dump%' THEN 1
                        WHEN column_name ILIKE '%transcript%' THEN 2
                        WHEN column_name ILIKE '%dump%' THEN 3
                        ELSE 4
                    END,
                    table_name,
                    column_name
            """
            
            candidates = await conn.fetch(table_query)
            
            if not candidates:
                print("❌ No candidate tables/columns found")
                return
            
            print(f"Found {len(candidates)} candidate columns:")
            print()
            
            # Group by table
            tables = {}
            for row in candidates:
                table_name = row['table_name']
                if table_name not in tables:
                    tables[table_name] = []
                tables[table_name].append({
                    'column': row['column_name'],
                    'type': row['data_type']
                })
            
            # Rank and display candidates
            ranked_tables = []
            for table_name, columns in tables.items():
                score = 0
                transcript_col = None
                created_col = None
                
                for col in columns:
                    col_name = col['column'].lower()
                    if 'transcript' in col_name:
                        score += 10
                        transcript_col = col['column']
                    elif 'dump' in col_name:
                        score += 5
                    elif col_name in ['raw_text', 'content', 'text']:
                        score += 3
                    elif col_name in ['created_at', 'created', 'inserted_at', 'timestamp']:
                        created_col = col['column']
                
                if transcript_col:
                    ranked_tables.append({
                        'table': table_name,
                        'transcript_col': transcript_col,
                        'created_col': created_col,
                        'score': score,
                        'columns': columns
                    })
            
            # Sort by score
            ranked_tables.sort(key=lambda x: x['score'], reverse=True)
            
            print("Top candidates:")
            print()
            
            for i, candidate in enumerate(ranked_tables[:10], 1):
                print(f"{i}. Table: {candidate['table']}")
                print(f"   Transcript column: {candidate['transcript_col']}")
                if candidate['created_col']:
                    print(f"   Created column: {candidate['created_col']}")
                print(f"   Score: {candidate['score']}")
                print()
                
                # Try to get sample data
                try:
                    transcript_col = candidate['transcript_col']
                    created_col = candidate['created_col']
                    table_name = candidate['table']
                    
                    # Build query
                    if created_col:
                        query = f"""
                            SELECT {transcript_col}, {created_col}
                            FROM {table_name}
                            WHERE {transcript_col} IS NOT NULL 
                            AND LENGTH({transcript_col}) > 10
                            ORDER BY {created_col} DESC NULLS LAST
                            LIMIT 3
                        """
                    else:
                        query = f"""
                            SELECT {transcript_col}
                            FROM {table_name}
                            WHERE {transcript_col} IS NOT NULL 
                            AND LENGTH({transcript_col}) > 10
                            LIMIT 3
                        """
                    
                    samples = await conn.fetch(query)
                    
                    if samples:
                        print(f"   Sample rows ({len(samples)}):")
                        for j, sample in enumerate(samples, 1):
                            transcript_val = sample[transcript_col]
                            if transcript_val:
                                preview = transcript_val[:140] + "..." if len(transcript_val) > 140 else transcript_val
                                print(f"      {j}. {preview}")
                                if created_col and sample.get(created_col):
                                    print(f"         Created: {sample[created_col]}")
                        print()
                    else:
                        print("   No sample data found")
                        print()
                        
                except Exception as e:
                    print(f"   ⚠️  Error querying samples: {e}")
                    print()
            
            # Identify the best candidate
            if ranked_tables:
                best = ranked_tables[0]
                print("=" * 80)
                print("RECOMMENDED STORAGE LOCATION:")
                print("=" * 80)
                print(f"Table: {best['table']}")
                print(f"Transcript column: {best['transcript_col']}")
                if best['created_col']:
                    print(f"Created column: {best['created_col']}")
                print()
                print("Use these values in export_dump_transcripts.py")
                print("=" * 80)
            
        await pool.close()
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(find_dump_storage())

