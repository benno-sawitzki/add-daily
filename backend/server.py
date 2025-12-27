from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, Query, Depends, Request
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware
import asyncpg
import ssl
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta, date
from llm.openai_client import generate_json, get_model_for_provider
from llm.openai_audio import transcribe_audio_file
import json
import re
import tempfile
import requests
import jwt
from passlib.context import CryptContext

ROOT_DIR = Path(__file__).parent

# Load .env file only in development (when ENV is not set to 'production')
# This is a safe default - production should set env vars directly
ENV = os.environ.get('ENV', 'development')
if ENV != 'production':
    env_path = ROOT_DIR / '.env'
    if env_path.exists():
        load_dotenv(env_path)
        print(f"✓ Loaded environment variables from {env_path}")
    else:
        print(f"⚠ .env file not found at {env_path}. Using system environment variables.")

# Extraction mode configuration
# Options: "llm_first" (default), "deterministic_first", "llm_only"
EXTRACTION_MODE = os.environ.get("EXTRACTION_MODE", "llm_first")

# Model upgrade mapping for retry logic
MODEL_UPGRADE_MAP = {
    "gpt-4o-mini": "gpt-4o",
    "gpt-4o": "gpt-4o",  # Already at max
    "gpt-3.5-turbo": "gpt-4o-mini",
    # Add other models as needed
}

# Google OAuth Config
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET')
# Frontend URL for OAuth redirects (should be your Vercel frontend URL, not the backend URL)
FRONTEND_URL = os.environ.get('FRONTEND_URL', os.environ.get('REACT_APP_FRONTEND_URL', 'http://localhost:3000'))
GOOGLE_REDIRECT_URI = f"{FRONTEND_URL}/gcal"
GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/userinfo.email']

# PostgreSQL connection (Supabase)
# DATABASE_URL will be validated in validate_required_env_vars() below
DATABASE_URL = os.environ.get('DATABASE_URL')
db_pool = None

async def get_db_pool():
    global db_pool
    if db_pool is None:
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE
        db_pool = await asyncpg.create_pool(
            DATABASE_URL, 
            ssl=ssl_ctx, 
            min_size=1, 
            max_size=10,
            statement_cache_size=0  # Required for Supabase transaction pooler
        )
    return db_pool

# Create the main app with docs enabled in development, disabled in production
# In development: docs at /api/docs, openapi at /api/openapi.json
# In production: docs disabled for security
if ENV == 'production':
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
else:
    app = FastAPI(docs_url="/api/docs", redoc_url="/api/redoc", openapi_url="/api/openapi.json")

# CORS configuration - MUST be added BEFORE routes are defined
# Note: When allow_credentials=True, you cannot use allow_origins=['*']
# Must specify exact origins. Default includes common development URLs.
default_origins = ['http://localhost:3000', 'http://127.0.0.1:3000']
cors_origins_str = os.environ.get('CORS_ORIGINS', ','.join(default_origins))

if cors_origins_str == '*':
    # If '*' is specified, disable credentials (security requirement)
    cors_origins = ['*']
    allow_creds = False
else:
    # Parse comma-separated origins
    cors_origins = [origin.strip() for origin in cors_origins_str.split(',') if origin.strip()]
    allow_creds = True

# Add CORS middleware to main app - applies to ALL routes including /api/*
# Must be added BEFORE routes are defined
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["authorization", "content-type", "accept", "origin", "x-requested-with"],
    expose_headers=["*"],
    max_age=600,  # Cache preflight for 10 minutes
)

# Request logging middleware (dev only) - MUST be after CORS middleware
if ENV != 'production':
    @app.middleware("http")
    async def log_requests(request, call_next):
        """Log all requests in development mode"""
        import time
        start_time = time.time()
        response = await call_next(request)
        process_time = time.time() - start_time
        logger.info(
            f"{request.method} {request.url.path} → {response.status_code} "
            f"({process_time:.3f}s)"
        )
        return response

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ============ VALIDATE REQUIRED ENVIRONMENT VARIABLES ============
def validate_required_env_vars():
    """Validate that all required environment variables are set at startup."""
    required_vars = {
        'DATABASE_URL': 'PostgreSQL connection string (e.g., postgresql://user:password@host:port/database)',
        'OPENAI_API_KEY': 'OpenAI API key for task extraction and transcription (get from https://platform.openai.com/api-keys)',
    }
    
    missing_vars = []
    for var_name, description in required_vars.items():
        if not os.environ.get(var_name):
            missing_vars.append(f"  - {var_name}: {description}")
    
    if missing_vars:
        error_msg = (
            "\n" + "="*80 + "\n"
            "ERROR: Missing required environment variables:\n"
            + "\n".join(missing_vars) + "\n\n"
            "Please set these in your .env file (backend/.env) or as environment variables.\n"
            "Copy backend/.env.example to backend/.env and fill in the values.\n"
            "="*80 + "\n"
        )
        logger.error(error_msg)
        raise ValueError(error_msg)

# Validate required environment variables at startup
validate_required_env_vars()

# ============ AUTH CONFIG ============
JWT_SECRET = os.environ.get('JWT_SECRET', 'add-daily-secret-key-change-in-production')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24 * 7  # 7 days

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# HTTP Bearer for JWT
security = HTTPBearer(auto_error=False)

# Google OAuth for login (different from calendar sync)
GOOGLE_AUTH_REDIRECT_URI = f"{FRONTEND_URL}/api/auth/google/callback"

# ============ AUTH MODELS ============
class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: str
    name: str = ""
    hashed_password: Optional[str] = None
    google_id: Optional[str] = None
    avatar_url: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class UserSignup(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1)

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class GoogleAuthRequest(BaseModel):
    code: str
    redirect_uri: Optional[str] = None

class AuthResponse(BaseModel):
    token: str
    user: dict

class UserPublic(BaseModel):
    id: str
    email: str
    name: str
    avatar_url: Optional[str] = None

# ============ AUTH HELPERS ============
def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_jwt_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS),
        "iat": datetime.now(timezone.utc)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_jwt_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    payload = decode_jwt_token(credentials.credentials)
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, email, name, google_id, avatar_url, created_at FROM users WHERE id = $1",
            payload["sub"]
        )
    if not row:
        raise HTTPException(status_code=401, detail="User not found")
    return dict(row)

async def get_optional_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> Optional[dict]:
    """Get current user if authenticated, otherwise return None"""
    if not credentials:
        return None
    try:
        payload = decode_jwt_token(credentials.credentials)
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id, email, name, google_id, avatar_url, created_at FROM users WHERE id = $1",
                payload["sub"]
            )
        return dict(row) if row else None
    except:
        return None

# Models
class Task(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: Optional[str] = None  # Owner of the task
    title: str
    description: Optional[str] = ""
    priority: int = Field(default=2, ge=1, le=4)  # 1=Low, 2=Medium, 3=High, 4=Critical
    urgency: int = Field(default=2, ge=1, le=4)
    importance: int = Field(default=2, ge=1, le=4)
    scheduled_date: Optional[str] = None  # ISO date string
    scheduled_time: Optional[str] = None  # HH:MM format
    duration: int = Field(default=30)  # Duration in minutes (30, 60, 90, etc.)
    status: str = Field(default="inbox")  # inbox, next, scheduled, completed, later
    expires_at: Optional[str] = None  # ISO datetime string for 'later' tasks
    energy_required: Optional[str] = None  # low, medium, high
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    priority: Optional[int] = 2
    urgency: Optional[int] = 2
    importance: Optional[int] = 2
    scheduled_date: Optional[str] = None
    scheduled_time: Optional[str] = None
    status: Optional[str] = "inbox"

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[int] = None
    urgency: Optional[int] = None
    importance: Optional[int] = None
    scheduled_date: Optional[str] = None
    scheduled_time: Optional[str] = None
    duration: Optional[int] = None
    status: Optional[str] = None
    sort_order: Optional[int] = None  # Display order (0-based index)
    energy_required: Optional[str] = None  # low, medium, high

class VoiceInput(BaseModel):
    transcript: str
    model: Optional[str] = "gpt-5.2"
    provider: Optional[str] = "openai"

class Settings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = "user_settings"
    ai_provider: str = "openai"
    ai_model: str = "gpt-5.2"

class SettingsUpdate(BaseModel):
    ai_provider: str
    ai_model: str

def transform_task_to_frontend_format(task_data: dict) -> dict:
    """
    Transform task from new schema (title, due_date, notes, priority) 
    to frontend-expected format (title, description, urgency, importance, priority, duration).
    
    Args:
        task_data: Task with new schema fields
    
    Returns:
        Task in frontend format
    """
    # Map priority string to numeric values
    priority_map = {
        "high": 4,
        "medium": 2,
        "low": 1,
        None: 2,  # Default to medium if null
    }
    
    priority_str = task_data.get("priority", "medium")
    if priority_str not in priority_map:
        priority_str = "medium"
    
    priority_num = priority_map[priority_str]
    
    # Calculate urgency and importance from priority
    # High priority (4) = high urgency (4) + high importance (4)
    # Medium priority (2) = medium urgency (2) + medium importance (2)
    # Low priority (1) = low urgency (1) + low importance (1)
    urgency = priority_num
    importance = priority_num
    
    # Get notes for description (always needed)
    notes = task_data.get("notes", "") or ""
    
    # Handle due_text (new schema) - append to notes if present
    due_text = task_data.get("due_text")
    if due_text:
        if notes:
            notes = f"{notes} (due: {due_text})"
        else:
            notes = f"Due: {due_text}"
    
    # Also check legacy due_date field for backward compatibility
    due_date = task_data.get("due_date")
    if due_date and not due_text:
        if notes:
            notes = f"{notes} (due: {due_date})"
        else:
            notes = f"Due: {due_date}"
    
    # Extract duration - prefer AI-extracted duration_minutes, fallback to parsing notes/title
    duration = task_data.get("duration_minutes")
    
    # If AI didn't extract duration, try to parse from notes and title
    if duration is None or not isinstance(duration, (int, float)) or duration <= 0:
        duration = 30  # Default
        import re
        
        # Check both notes and title for duration mentions
        title = task_data.get("title", "") or ""
        text_to_search = f"{title} {notes}".lower()
        
        # Look for duration mentions (both numeric and written-out numbers)
        duration_patterns = [
            # Numeric patterns
            (r"(\d+)\s*hours?", lambda m: int(m.group(1)) * 60),
            (r"(\d+)\s*hrs?", lambda m: int(m.group(1)) * 60),
            (r"(\d+)\s*h\b", lambda m: int(m.group(1)) * 60),
            (r"(\d+)\s*minutes?", lambda m: int(m.group(1))),
            (r"(\d+)\s*mins?", lambda m: int(m.group(1))),
            (r"(\d+)\s*m\b", lambda m: int(m.group(1))),
            # Written-out numbers (common patterns)
            (r"one\s*hour", lambda m: 60),
            (r"two\s*hours?", lambda m: 120),
            (r"three\s*hours?", lambda m: 180),
            (r"four\s*hours?", lambda m: 240),
            (r"five\s*hours?", lambda m: 300),
            (r"half\s*an?\s*hour", lambda m: 30),
            (r"quarter\s*hour", lambda m: 15),
            # "takes X hours" pattern (handles "that takes two hours")
            (r"takes?\s+(\d+)\s*hours?", lambda m: int(m.group(1)) * 60),
            (r"takes?\s+two\s*hours?", lambda m: 120),
            (r"takes?\s+one\s*hour", lambda m: 60),
            (r"that\s+takes?\s+two\s*hours?", lambda m: 120),
            (r"that\s+takes?\s+(\d+)\s*hours?", lambda m: int(m.group(1)) * 60),
        ]
        
        for pattern, converter in duration_patterns:
            match = re.search(pattern, text_to_search)
            if match:
                duration = converter(match)
                break
    
    return {
        "title": task_data.get("title", "Untitled Task"),
        "description": notes or "",  # Use notes as description
        "urgency": urgency,
        "importance": importance,
        "priority": priority_num,
        "duration": duration,
    }


# Retry wrapper for LLM extraction with model upgrades
async def extract_with_retries(
    transcript: str,
    provider: str,
    model: str,
    whisper_segments: Optional[List[Dict[str, Any]]] = None,
    trace_id: Optional[str] = None,
    temperature_override: Optional[float] = None,
    use_simple_prompt: bool = False
) -> dict:
    """
    Extract items with retry logic:
    1. Try primary model with full prompt
    2. If 0 items: Try upgraded model with full prompt
    3. If still 0 items: Try upgraded model with simpler prompt
    
    Returns dict with extraction result and logging info about which method succeeded.
    """
    logger.info(f"🔄 Starting LLM extraction with retries (model: {model}, simple_prompt: {use_simple_prompt}, trace_id: {trace_id})")
    
    # Attempt 1: Primary model with configured prompt
    try:
        result = await extract_dump_items_from_transcript(
            transcript=transcript,
            provider=provider,
            model=model,
            whisper_segments=whisper_segments,
            trace_id=trace_id,
            temperature_override=temperature_override,
            use_simple_prompt=use_simple_prompt
        )
        items = result.get("items", [])
        
        if len(items) > 0:
            logger.info(f"✅ Primary model ({model}) succeeded with {len(items)} items (attempt: 1/3)")
            result["_extraction_method"] = f"llm_primary_{model}"
            result["_retry_count"] = 0
            return result
        else:
            logger.warning(f"⚠️  Primary model ({model}) returned 0 items, trying upgrade... (attempt: 1/3 failed)")
    except Exception as e:
        logger.warning(f"⚠️  Primary model ({model}) failed: {e}, trying upgrade... (attempt: 1/3 failed)")
        result = {"items": []}
    
    # Attempt 2: Upgraded model with full prompt
    upgraded_model = MODEL_UPGRADE_MAP.get(model, model)
    if upgraded_model != model:
        try:
            logger.info(f"🔄 Retry attempt 1: Upgrading to {upgraded_model} with full prompt")
            result = await extract_dump_items_from_transcript(
                transcript=transcript,
                provider=provider,
                model=upgraded_model,
                whisper_segments=whisper_segments,
                trace_id=trace_id,
                temperature_override=temperature_override,
                use_simple_prompt=False
            )
            items = result.get("items", [])
            
            if len(items) > 0:
                logger.info(f"✅ Upgraded model ({upgraded_model}) succeeded with {len(items)} items (attempt: 2/3)")
                result["_extraction_method"] = f"llm_upgraded_{upgraded_model}"
                result["_retry_count"] = 1
                return result
            else:
                logger.warning(f"⚠️  Upgraded model ({upgraded_model}) returned 0 items, trying simpler prompt... (attempt: 2/3 failed)")
        except Exception as e:
            logger.warning(f"⚠️  Upgraded model ({upgraded_model}) failed: {e}, trying simpler prompt... (attempt: 2/3 failed)")
    
    # Attempt 3: Upgraded model with simpler prompt
    if upgraded_model != model:
        try:
            logger.info(f"🔄 Retry attempt 2: Using {upgraded_model} with simpler prompt")
            result = await extract_dump_items_from_transcript(
                transcript=transcript,
                provider=provider,
                model=upgraded_model,
                whisper_segments=whisper_segments,
                trace_id=trace_id,
                temperature_override=temperature_override,
                use_simple_prompt=True
            )
            items = result.get("items", [])
            
            if len(items) > 0:
                logger.info(f"✅ Upgraded model ({upgraded_model}) with simpler prompt succeeded with {len(items)} items (attempt: 3/3)")
                result["_extraction_method"] = f"llm_upgraded_simple_{upgraded_model}"
                result["_retry_count"] = 2
                return result
            else:
                logger.error(f"❌ All LLM retry attempts failed, returning empty result (attempt: 3/3 failed)")
                result["_extraction_method"] = "llm_all_failed"
                result["_retry_count"] = 3
        except Exception as e:
            logger.error(f"❌ Upgraded model ({upgraded_model}) with simpler prompt failed: {e} (attempt: 3/3 failed)")
            result["_extraction_method"] = "llm_all_failed"
            result["_retry_count"] = 3
    
    # All retries failed
    result["_extraction_method"] = "llm_all_failed"
    result["_retry_count"] = 3
    return result


# Helper function for speech-aware extraction from dump transcripts
async def extract_dump_items_from_transcript(
    transcript: str, 
    provider: str, 
    model: str,
    whisper_segments: Optional[List[Dict[str, Any]]] = None,
    trace_id: Optional[str] = None,
    temperature_override: Optional[float] = None,
    model_override: Optional[str] = None,
    use_simple_prompt: bool = False
) -> dict:
    """
    Extract dump_items from transcript with correct ordering, duration handling, and cancellations.
    
    Steps:
    1. Build segments from Whisper segments (with timestamps) or fallback to text segmentation
    2. Send segments array to LLM with explicit ordering schema (task/cancel_task/ignore/duration_attach)
    3. LLM returns items with segment_index, order_in_segment, and type
    4. Post-process: attach durations, expand targets, apply cancellations, validate, preserve order
    
    Args:
        transcript: Full transcript text
        provider: AI provider
        model: AI model
        whisper_segments: Optional list of Whisper segments with timestamps
    
    Returns:
        {
            "items": List[validated_dump_items in correct order],
            "dropped": List[dropped_items_with_reasons],
            "segments": List[segments_used],
            "raw_count": int,
            "final_count": int,
            "_debug": dict with raw model output (dev mode)
        }
    """
    try:
        from task_extraction import (
            build_segments_from_whisper,
            segment_transcript_fallback,
            validate_task,
            normalize_title,
            detect_cancel_intent
        )
    except ImportError:
        import sys
        from pathlib import Path
        backend_dir = Path(__file__).parent
        sys.path.insert(0, str(backend_dir))
        from task_extraction import (
            build_segments_from_whisper,
            segment_transcript_fallback,
            validate_task,
            normalize_title,
            detect_cancel_intent
        )
    
    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")
    
    # Step 1: Build segments (speech-aware if Whisper segments available, else fallback)
    if whisper_segments and len(whisper_segments) > 0:
        logger.info(f"🔍 Using Whisper segments for speech-aware segmentation: {len(whisper_segments)} segments")
        segments = build_segments_from_whisper(whisper_segments, pause_threshold_ms=600)
    else:
        logger.info("🔍 No Whisper segments available, using fallback text segmentation")
        segments = segment_transcript_fallback(transcript)
    
    logger.info(f"🔍 Built {len(segments)} segments for extraction")
    
    # Detailed segmentation logging
    logger.info("=" * 80)
    logger.info("SEGMENTATION DEBUG")
    logger.info("=" * 80)
    logger.info(f"Total segments: {len(segments)}")
    for seg in segments:
        logger.info(f"  Segment {seg.get('i', '?')}: \"{seg.get('text', '')[:100]}\" (length: {len(seg.get('text', ''))} chars)")
    logger.info("=" * 80)
    
    if not segments:
        return {
            "items": [],
            "dropped": [],
            "segments": [],
            "raw_count": 0,
            "final_count": 0,
            "summary": "No valid segments found after preprocessing"
        }
    
    # Step 2: Prepare segments for LLM (format: {i, start_ms, end_ms, text})
    segments_for_llm = [
        {
            "i": seg.get("i", i),
            "start_ms": seg.get("start_ms", 0),
            "end_ms": seg.get("end_ms", 0),
            "text": seg.get("text", "")
        }
        for i, seg in enumerate(segments)
    ]
    segments_json = json.dumps(segments_for_llm, indent=2)
    
    # Debug logging: segments sent to model
    if ENV == 'development':
        logger.info(f"🔍 Segments sent to model ({len(segments_for_llm)}): {json.dumps(segments_for_llm, indent=2)}")
    
    # Choose prompt based on use_simple_prompt flag
    if use_simple_prompt:
        # Simpler, more direct prompt for retry attempts
        system_message = """You are a task extraction assistant. Extract actionable tasks from transcript segments.

Your job:
1. Read each segment
2. Identify actionable tasks (things someone wants/needs to do)
3. Extract them as clean task titles
4. Include durations if mentioned (e.g., "takes one hour" = 60 minutes)
5. Return JSON with items array

Rules:
- Extract tasks with action verbs: go, call, buy, clean, do, work on, etc.
- Normalize titles: remove "I want to", "I need to", "This time the first task is"
- If you see "It takes X hours" after a task, set duration_minutes on that task
- Split on "or" and "and" when they connect different actions
- Each task gets its own item with order_in_segment

Return valid JSON matching the schema."""
    else:
        # Full prompt with detailed rules
        system_message = """You are a task-extraction engine for a productivity app.
You will receive a list of transcript segments with timestamps and indices.
Extract intended TODO tasks, cancellations, durations, and filter out filler.

CRITICAL RULES:
- Process EVERY segment. Do NOT skip segments.
- Only output actionable tasks as type="task" (verb + object, never single-word).
- type="ignore" for filler, acknowledgements, thinking noises ("okay", "yeah", "hmm").
- type="cancel_task" when the speaker negates or retracts a previous task:
  Examples: "maybe website not", "actually not", "skip the website", "not the website".
  Set targets=["website"] to indicate what is being cancelled.
- type="duration_attach" for standalone duration phrases like "that takes 30 minutes" or "three hours"
  that should attach to the most recent task. Set duration_minutes but no title.
- Normalize task titles:
  - Remove "I need to", "I have to", "I want to", "today first thing is", "This time the first task is" from titles
  - "This time the first task is I want to clean my flat" => "clean my flat"
  - "I want to clean my flat" => "clean my flat"
  - "Then I want to go to the police" => "go to the police"
  - "get back to X" => "Reply to X"
  - "message them" => expand to "Message <names>" if names are present in the segment
- Durations:
  - If duration is part of a task (e.g., "work on website for two hours"), extract it as duration_minutes AND remove the duration phrase from the title
  - Example: "go to the gym for 4 hours" → title: "go to the gym", duration_minutes: 240
  - Example: "have lunch for one hour" → title: "have lunch", duration_minutes: 60
  - Patterns to remove: "for X hours/minutes", "takes X hours/minutes"
  - If duration is standalone (e.g., "that takes 30 minutes"), output as type="duration_attach"
- Splitting (CRITICAL - extract ALL distinct tasks from EVERY segment):
  - "Call Roberta, Tom and Oliver" => split into separate tasks with order_in_segment: 0, 1, 2
  - "work on podcast and on website" => split into separate tasks
  - "work on the podcast for two hours and on the website for three hours" => MUST extract 2 tasks: "work on the podcast" (duration_minutes: 120) and "work on the website" (duration_minutes: 180) - remove "for X hours" from titles
  - "call Oliver and Roberta or write them per WhatsApp" => extract BOTH: "call Oliver and Roberta" AND "write them per WhatsApp" (order_in_segment: 0, 1)
  - "call X or write X and work on Y" => extract ALL THREE tasks: "call X", "write X", "work on Y" (order_in_segment: 0, 1, 2)
  - When you see "or", extract BOTH options as separate tasks unless they're clearly mutually exclusive alternatives
  - When you see "and", split into separate tasks if they represent distinct actions
  - When you see "and on" after "work on X for Y", this indicates a continuation: "work on X for Y and on Z for W" = 2 separate tasks
  - IMPORTANT: A single segment can contain MULTIPLE tasks. Extract ALL of them, not just one.
  - IMPORTANT: If a segment contains names followed by actions (e.g., "Oliver, Roberta, call Oliver and Roberta..."), extract the tasks, not the names.
- Ordering:
  - Set order_in_segment to preserve order within each segment (0, 1, 2, ...)
  - Tasks must stay in the same order as spoken
  - Each distinct task gets its own order_in_segment value
- Never output single-word titles.
- Never output "Okay", "Yeah", "three hours" as tasks.

Return ONLY valid JSON matching the schema provided."""
    
    user_prompt = f"""Schema:
{{
  "items": [
    {{
      "segment_index": 0,
      "order_in_segment": 0,
      "type": "task" | "cancel_task" | "ignore" | "duration_attach",
      "title": "string|null",
      "due_text": "string|null",
      "duration_minutes": "number|null",
      "targets": ["string"]|null,
      "source_text": "string",
      "confidence": "number"
    }}
  ]
}}

FEW-SHOT EXAMPLES:

Example 1 - Segment with "or" and "and":
Input segment: {{"i": 2, "text": "call Oliver and Roberta or write them per WhatsApp and work on podcast"}}
Expected output (MUST extract 3 tasks):
{{
  "items": [
    {{"segment_index": 2, "order_in_segment": 0, "type": "task", "title": "call Oliver and Roberta", "source_text": "call Oliver and Roberta", "confidence": 0.9}},
    {{"segment_index": 2, "order_in_segment": 1, "type": "task", "title": "write them per WhatsApp", "source_text": "write them per WhatsApp", "confidence": 0.9}},
    {{"segment_index": 2, "order_in_segment": 2, "type": "task", "title": "work on podcast", "source_text": "work on podcast", "confidence": 0.9}}
  ]
}}

Example 2 - Multiple segments:
Input segments:
[
  {{"i": 0, "text": "Does this actually work here? So today I want to, should I go to the police? I don't know"}},
  {{"i": 1, "text": "Go to police"}},
  {{"i": 2, "text": "Oliver, Roberta, call Oliver and Roberta or write them per WhatsApp and work on podcast"}}
]
Expected output (MUST extract from segments 1 and 2):
{{
  "items": [
    {{"segment_index": 1, "order_in_segment": 0, "type": "task", "title": "Go to police", "source_text": "Go to police", "confidence": 0.9}},
    {{"segment_index": 2, "order_in_segment": 0, "type": "task", "title": "call Oliver and Roberta", "source_text": "call Oliver and Roberta", "confidence": 0.9}},
    {{"segment_index": 2, "order_in_segment": 1, "type": "task", "title": "write them per WhatsApp", "source_text": "write them per WhatsApp", "confidence": 0.9}},
    {{"segment_index": 2, "order_in_segment": 2, "type": "task", "title": "work on podcast", "source_text": "work on podcast", "confidence": 0.9}}
  ]
}}

Example 3 - "work on X for Y and on Z for W" pattern (CRITICAL):
Input segment: {{"i": 3, "text": "I need to work on the podcast for two hours and on the website for three hours"}}
Expected output (MUST extract 2 tasks with durations):
{{
  "items": [
    {{"segment_index": 3, "order_in_segment": 0, "type": "task", "title": "work on the podcast", "source_text": "work on the podcast for two hours", "duration_minutes": 120, "confidence": 0.9}},
    {{"segment_index": 3, "order_in_segment": 1, "type": "task", "title": "work on the website", "source_text": "work on the website for three hours", "duration_minutes": 180, "confidence": 0.9}}
  ]
}}

Example 4 - Multiple tasks with durations and importance (CRITICAL):
Input segments:
[
  {{"i": 0, "text": "This time the first task is I want to clean my flat. It takes one hour."}},
  {{"i": 1, "text": "Then I want to go to the police."}},
  {{"i": 2, "text": "Then I want to buy a new phone. It takes two hours. It's very important."}},
  {{"i": 3, "text": "And then I want to do the laundry. This is medium important and takes three hours."}}
]
Expected output (MUST extract 4 tasks):
{{
  "items": [
    {{"segment_index": 0, "order_in_segment": 0, "type": "task", "title": "clean my flat", "source_text": "This time the first task is I want to clean my flat. It takes one hour.", "duration_minutes": 60, "confidence": 0.9}},
    {{"segment_index": 1, "order_in_segment": 0, "type": "task", "title": "go to the police", "source_text": "Then I want to go to the police.", "confidence": 0.9}},
    {{"segment_index": 2, "order_in_segment": 0, "type": "task", "title": "buy a new phone", "source_text": "Then I want to buy a new phone. It takes two hours. It's very important.", "duration_minutes": 120, "confidence": 0.9}},
    {{"segment_index": 3, "order_in_segment": 0, "type": "task", "title": "do the laundry", "source_text": "And then I want to do the laundry. This is medium important and takes three hours.", "duration_minutes": 180, "confidence": 0.9}}
  ]
}}

Segments (with timestamps and indices):
{segments_json}

Extract items from these segments."""
    
    # Simplified user prompt for retry attempts (only if use_simple_prompt is True)
    if use_simple_prompt:
        user_prompt = f"""Extract tasks from these segments:

{segments_json}

Return JSON with items array. Each task should have:
- segment_index: which segment it came from
- order_in_segment: order within that segment (0, 1, 2...)
- type: "task"
- title: clean task title (remove "I want to", etc.)
- duration_minutes: number if duration mentioned
- source_text: original text
- confidence: 0.9"""
    else:
        # Full user prompt (only used if not simple)
        user_prompt = f"""Schema:
{{
  "items": [
    {{
      "segment_index": 0,
      "order_in_segment": 0,
      "type": "task" | "cancel_task" | "ignore" | "duration_attach",
      "title": "string|null",
      "due_text": "string|null",
      "duration_minutes": "number|null",
      "targets": ["string"]|null,
      "source_text": "string",
      "confidence": "number"
    }}
  ]
}}

FEW-SHOT EXAMPLES:

Example 1 - Segment with "or" and "and":
Input segment: {{"i": 2, "text": "call Oliver and Roberta or write them per WhatsApp and work on podcast"}}
Expected output (MUST extract 3 tasks):
{{
  "items": [
    {{"segment_index": 2, "order_in_segment": 0, "type": "task", "title": "call Oliver and Roberta", "source_text": "call Oliver and Roberta", "confidence": 0.9}},
    {{"segment_index": 2, "order_in_segment": 1, "type": "task", "title": "write them per WhatsApp", "source_text": "write them per WhatsApp", "confidence": 0.9}},
    {{"segment_index": 2, "order_in_segment": 2, "type": "task", "title": "work on podcast", "source_text": "work on podcast", "confidence": 0.9}}
  ]
}}

Example 2 - Multiple segments:
Input segments:
[
  {{"i": 0, "text": "Does this actually work here? So today I want to, should I go to the police? I don't know"}},
  {{"i": 1, "text": "Go to police"}},
  {{"i": 2, "text": "Oliver, Roberta, call Oliver and Roberta or write them per WhatsApp and work on podcast"}}
]
Expected output (MUST extract from segments 1 and 2):
{{
  "items": [
    {{"segment_index": 1, "order_in_segment": 0, "type": "task", "title": "Go to police", "source_text": "Go to police", "confidence": 0.9}},
    {{"segment_index": 2, "order_in_segment": 0, "type": "task", "title": "call Oliver and Roberta", "source_text": "call Oliver and Roberta", "confidence": 0.9}},
    {{"segment_index": 2, "order_in_segment": 1, "type": "task", "title": "write them per WhatsApp", "source_text": "write them per WhatsApp", "confidence": 0.9}},
    {{"segment_index": 2, "order_in_segment": 2, "type": "task", "title": "work on podcast", "source_text": "work on podcast", "confidence": 0.9}}
  ]
}}

Example 3 - "work on X for Y and on Z for W" pattern (CRITICAL):
Input segment: {{"i": 3, "text": "I need to work on the podcast for two hours and on the website for three hours"}}
Expected output (MUST extract 2 tasks with durations):
{{
  "items": [
    {{"segment_index": 3, "order_in_segment": 0, "type": "task", "title": "work on the podcast", "source_text": "work on the podcast for two hours", "duration_minutes": 120, "confidence": 0.9}},
    {{"segment_index": 3, "order_in_segment": 1, "type": "task", "title": "work on the website", "source_text": "work on the website for three hours", "duration_minutes": 180, "confidence": 0.9}}
  ]
}}

Example 4 - Multiple tasks with durations and importance (CRITICAL):
Input segments:
[
  {{"i": 0, "text": "This time the first task is I want to clean my flat. It takes one hour."}},
  {{"i": 1, "text": "Then I want to go to the police."}},
  {{"i": 2, "text": "Then I want to buy a new phone. It takes two hours. It's very important."}},
  {{"i": 3, "text": "And then I want to do the laundry. This is medium important and takes three hours."}}
]
Expected output (MUST extract 4 tasks):
{{
  "items": [
    {{"segment_index": 0, "order_in_segment": 0, "type": "task", "title": "clean my flat", "source_text": "This time the first task is I want to clean my flat. It takes one hour.", "duration_minutes": 60, "confidence": 0.9}},
    {{"segment_index": 1, "order_in_segment": 0, "type": "task", "title": "go to the police", "source_text": "Then I want to go to the police.", "confidence": 0.9}},
    {{"segment_index": 2, "order_in_segment": 0, "type": "task", "title": "buy a new phone", "source_text": "Then I want to buy a new phone. It takes two hours. It's very important.", "duration_minutes": 120, "confidence": 0.9}},
    {{"segment_index": 3, "order_in_segment": 0, "type": "task", "title": "do the laundry", "source_text": "And then I want to do the laundry. This is medium important and takes three hours.", "duration_minutes": 180, "confidence": 0.9}}
  ]
}}

Segments (with timestamps and indices):
{segments_json}

Extract items from these segments. 

CRITICAL INSTRUCTIONS - READ CAREFULLY:
1. Extract ALL distinct tasks from EACH segment. Do NOT skip any tasks.
2. A single segment can contain MULTIPLE tasks - you MUST extract ALL of them.
3. When you see "or", extract BOTH sides as separate tasks with consecutive order_in_segment values.
4. When you see "and" connecting distinct actions (different verbs), split into separate tasks.
5. "call X and Y" where X and Y are names = 1 task (single action, multiple objects)
6. "call X and work on Y" = 2 tasks (different actions: "call" vs "work on")
7. "call X or write X" = 2 tasks (both options must be extracted)
8. If a segment contains "A or B and C", extract ALL THREE: A, B, and C as separate tasks.
9. "work on X for Y and on Z for W" = 2 tasks (CRITICAL: "and on" indicates continuation, extract both with durations)
10. When you see "work on X for Y hours and on Z for W hours", you MUST extract 2 separate tasks, each with its duration_minutes set. Remove "for Y hours" from the title (e.g., "work on podcast for two hours" → title: "work on podcast", duration_minutes: 120).
11. CRITICAL: "This time the first task is I want to clean my flat. It takes one hour." MUST extract "clean my flat" as a task with duration_minutes: 60. Remove the prefix "This time the first task is" when normalizing.
12. CRITICAL: "I want to clean my flat. It takes one hour." MUST extract "clean my flat" with duration_minutes: 60.
13. CRITICAL: "Then I want to..." indicates a new task - extract it as a separate item with a new order_in_segment.
14. CRITICAL: "It takes X hours" or "takes X hours" after a task description should be included as duration_minutes on that task. ALWAYS remove duration phrases ("for X hours/minutes", "takes X hours/minutes") from the title when extracting durations.
15. CRITICAL: "It's very important" or "This is medium important" should be noted but does NOT prevent task extraction.
16. YOU MUST RETURN AT LEAST ONE ITEM if any segment contains an actionable task. Returning 0 items is a failure and indicates you did not understand the input.
13. CRITICAL: "It takes X hours" or "takes X hours" after a task description should be included as duration_minutes on that task.
14. CRITICAL: "It's very important" or "This is medium important" should be noted but does not prevent task extraction.
15. YOU MUST RETURN AT LEAST ONE ITEM if any segment contains an actionable task. Returning 0 items is a failure.

CRITICAL EXAMPLES - FOLLOW THESE EXACTLY:

Example: Segment 2 = "call Oliver and Roberta or write them per WhatsApp and work on podcast"
You MUST return 3 items:
1. {{"segment_index": 2, "order_in_segment": 0, "type": "task", "title": "call Oliver and Roberta", ...}}
2. {{"segment_index": 2, "order_in_segment": 1, "type": "task", "title": "write them per WhatsApp", ...}}
3. {{"segment_index": 2, "order_in_segment": 2, "type": "task", "title": "work on podcast", ...}}

Do NOT return just 1 item with the full text. Split on "or" first, then split the second part on "and".

IMPORTANT: 
- If you see a segment like "call Oliver and Roberta or write them per WhatsApp and work on podcast"
  You MUST return 3 items, not 1. Split on "or" first, then split the second part on "and".
- Do NOT combine multiple tasks into a single item.
- Each actionable phrase gets its own item with its own order_in_segment.
- Process EVERY segment - do not skip segment 2 or any other segment.

Rules:
- Reference segment_index=i for each item
- Set order_in_segment to preserve order (0, 1, 2, ... within each segment)
- Each distinct actionable task MUST be a separate item
- Return ONLY valid JSON matching the schema above."""
    
    # Map provider/model to OpenAI model
    # Use model_override if provided, otherwise use provider/model
    if model_override is not None:
        openai_model = model_override
    else:
        openai_model = get_model_for_provider(provider, model)
    
    # Step 3: Call LLM with segments
    try:
        # Use temperature_override if provided, otherwise default to 0.1
        temperature = temperature_override if temperature_override is not None else 0.1
        
        raw_result = await generate_json(
            system_prompt=system_message,
            user_prompt=user_prompt,
            model=openai_model,
            temperature=temperature
        )
        
        logger.info(f"🔍 Raw AI response: {json.dumps(raw_result, indent=2)}")
        
        # Validate response structure
        if not isinstance(raw_result, dict):
            raise HTTPException(status_code=500, detail="AI returned invalid response format")
        
        items = raw_result.get("items", [])
        if not isinstance(items, list):
            raise HTTPException(status_code=500, detail="AI returned invalid items format")
        
        logger.info(f"🔍 Extracted {len(items)} raw items from AI response")
        
        # CRITICAL: If LLM returns 0 items, log the full response for debugging
        if len(items) == 0:
            logger.error("=" * 80)
            logger.error("❌ CRITICAL: LLM returned 0 items!")
            logger.error(f"   Segments sent to LLM: {len(segments)}")
            logger.error(f"   Raw LLM response: {json.dumps(raw_result, indent=2)}")
            logger.error(f"   First 3 segments:")
            for i, seg in enumerate(segments[:3]):
                logger.error(f"     Segment {i}: \"{seg.get('text', '')[:200]}\"")
            logger.error("=" * 80)
        
        # Check if LLM returned suspiciously few items for a multi-segment input
        if len(segments) > 1 and len(items) <= 1:
            logger.warning(f"⚠️ LLM returned only {len(items)} item(s) for {len(segments)} segments. This might indicate missing extractions.")
            # Log the raw items for debugging
            for i, item in enumerate(items):
                logger.warning(f"  Raw item {i}: {item.get('title', 'N/A')[:100]}")
        
        # Check for segments with "work on" patterns that might be missing items
        work_on_segments_missing_items = []
        for seg in segments:
            seg_idx = seg.get('i', -1)
            seg_text = seg.get('text', '').lower()
            # Check if segment contains "work on" pattern
            if 'work on' in seg_text and 'and on' in seg_text:
                seg_items = [item for item in items if item.get('segment_index') == seg_idx]
                if not seg_items:
                    logger.error(f"❌ CRITICAL: Segment {seg_idx} contains 'work on X and on Y' pattern but has NO items extracted!")
                    logger.error(f"   Segment text: \"{seg.get('text', '')[:100]}\"")
                    work_on_segments_missing_items.append((seg_idx, seg.get('text', '')))
                elif len(seg_items) == 1:
                    # Check if the single item contains both tasks (should be split)
                    item_title = seg_items[0].get('title', '').lower()
                    if 'and on' in item_title:
                        logger.warning(f"⚠️ Segment {seg_idx} contains 'work on X and on Y' pattern but only 1 item extracted (should be 2):")
                        logger.warning(f"   Extracted item: \"{seg_items[0].get('title', '')[:100]}\"")
                        logger.warning(f"   This should be split into 2 separate tasks in postprocessing.")
                else:
                    logger.info(f"✓ Segment {seg_idx} with 'work on X and on Y' pattern has {len(seg_items)} items extracted")
        
        # Log summary of missing "work on" items
        if work_on_segments_missing_items:
            logger.error(f"❌ CRITICAL: {len(work_on_segments_missing_items)} segment(s) with 'work on X and on Y' pattern have NO items extracted!")
            logger.error(f"   Fallback pattern detection in postprocessing will attempt to create these items.")
        
        # Step 4: Post-process with ordering, duration attachment, target expansion, cancellations
        final_tasks = postprocess_extraction_items(items, segments)
        
        logger.info(f"🔍 Post-processing: {len(items)} raw -> {len(final_tasks)} final tasks")
        
        # Check if postprocessing lost items
        if len(items) > len(final_tasks) and len(final_tasks) <= 1:
            logger.warning(f"⚠️ Post-processing reduced {len(items)} items to {len(final_tasks)}. This might indicate filtering issues.")
            for i, task in enumerate(final_tasks):
                logger.warning(f"  Final task {i}: {task.get('title', 'N/A')[:100]}")
        
        # Convert tasks to dump_items format (preserve order)
        dump_items = []
        logger.info(f"🔍 Converting {len(final_tasks)} final tasks to dump_items format")
        for idx, task in enumerate(final_tasks):
            task_title = task.get("title", "")
            task_duration = task.get("duration_minutes")
            task_source = task.get("source_text", task_title)
            
            # CRITICAL: Ensure text is never empty - use source_text or title as fallback
            if not task_title or not task_title.strip():
                task_title = task_source if task_source and task_source.strip() else f"Task {idx + 1}"
                logger.warning(f"  ⚠️  Task {idx + 1} had empty title, using source_text: '{task_title[:80]}'")
            
            item = {
                "text": task_title,  # This MUST be non-empty
                "segment_index": task.get("segment_index", 0),
                "order_in_segment": task.get("order_in_segment", 0),
                "source_text": task_source,
                "due_text": task.get("due_text"),
                "duration_minutes": task_duration,
                "notes": task.get("notes"),
                "confidence": task.get("confidence", 0.8)
            }
            dump_items.append(item)
            logger.info(f"  Dump item {idx + 1}: text='{task_title[:80]}', duration_minutes={task_duration}, has_text={bool(task_title)}, text_length={len(task_title)}")
        
        logger.info(f"🔍 Created {len(dump_items)} dump_items from {len(final_tasks)} final tasks")
        
        # Verify all items have non-empty text
        items_with_empty_text = [i for i, item in enumerate(dump_items) if not item.get("text") or not item.get("text").strip()]
        if items_with_empty_text:
            logger.error(f"  ✗ ERROR: {len(items_with_empty_text)} dump_items have empty text! Indices: {items_with_empty_text}")
            for idx in items_with_empty_text:
                logger.error(f"    Item {idx + 1} structure: {json.dumps(dump_items[idx], indent=2, default=str)}")
        
        result = {
            "items": dump_items,
            "dropped": [],  # TODO: track dropped items
            "segments": [seg.get("text", "") for seg in segments],
            "raw_count": len(items),
            "final_count": len(final_tasks),
            "summary": f"Extracted {len(final_tasks)} tasks from {len(segments)} segments"
        }
        
        # Add debug info in development mode
        if ENV == 'development':
            result["_debug"] = {
                "whisper_segments": whisper_segments,
                "segments_sent_to_model": segments_for_llm,
                "raw_model_output": raw_result,
                "final_tasks": final_tasks,
                "prompt_version": "v1"  # PROMPT_VERSION constant defined in extract_dump_items_from_transcript
            }
            logger.info(f"🔍 Final tasks (ordered): {json.dumps([{'title': t.get('title'), 'segment': t.get('segment_index'), 'order': t.get('order_in_segment'), 'duration': t.get('duration_minutes')} for t in final_tasks], indent=2)}")
        
        return result
        
    except json.JSONDecodeError as e:
        logger.error(f"JSON parsing failed: {str(e)}")
        # Retry once with stricter prompt
        logger.warning("Retrying with stricter JSON-only prompt...")
        try:
            retry_prompt = f"""Return ONLY valid JSON. No markdown, no code blocks.

Segments:
{segments_json}

Extract items. Schema: {{"items": [{{"segment_index": 0, "type": "task"|"cancel_task"|"ignore", "title": "string", ...}}]}}"""
            
            raw_result = await generate_json(
                system_prompt=system_message + "\n\nRETRY: Return ONLY valid JSON. No markdown wrapping.",
                user_prompt=retry_prompt,
                model=openai_model,
                temperature=0.0
            )
            
            items = raw_result.get("items", [])
            # Use the same postprocessing as the main path
            final_tasks = postprocess_extraction_items(items, segments)
            
            # Convert to dump_items format
            dump_items = []
            for task in final_tasks:
                item = {
                    "text": task.get("title", ""),
                    "segment_index": task.get("segment_index", 0),
                    "order_in_segment": task.get("order_in_segment", 0),
                    "source_text": task.get("source_text", task.get("title", "")),
                    "due_text": task.get("due_text"),
                    "duration_minutes": task.get("duration_minutes"),
                    "notes": task.get("notes"),
                    "confidence": task.get("confidence", 0.8)
                }
                dump_items.append(item)
            
            result = {
                "items": dump_items,
                "dropped": [],
                "segments": [seg.get("text", "") for seg in segments],
                "raw_count": len(items),
                "final_count": len(final_tasks),
                "summary": f"Extracted {len(final_tasks)} tasks from {len(segments)} segments (retry)"
            }
            
            if ENV == 'development':
                result["_debug"] = {
                    "whisper_segments": whisper_segments,
                    "segments_sent_to_model": segments_for_llm,
                    "raw_model_output": raw_result,
                    "final_tasks": final_tasks
                }
            
            return result
            
        except Exception as retry_error:
            logger.error(f"Retry also failed: {retry_error}")
            raise HTTPException(
                status_code=400,
                detail="Failed to parse AI response as JSON after retry. Please try again."
            )
    except Exception as e:
        logger.error(f"Error in extract_dump_items_from_transcript: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to extract tasks: {str(e)}")


def is_blob_title(title: str) -> bool:
    """
    Check if a title is a blob (multi-sentence transcript that should never be stored as a single dump_item).
    
    Returns True if:
    - title contains ". " OR contains more than 1 sentence boundary (.!?)
    - OR title length > 140 chars
    - OR title contains 3+ occurrences of " I need to " / " I want to " / " Then "
    """
    if not title or not isinstance(title, str):
        return False
    
    # Check for sentence boundaries
    sentence_boundaries = len(re.findall(r'[.!?]\s+', title))
    if sentence_boundaries > 1 or ". " in title:
        return True
    
    # Check length
    if len(title) > 140:
        return True
    
    # Check for multiple intent phrases
    intent_phrases = [
        r'\s+I\s+need\s+to\s+',
        r'\s+I\s+want\s+to\s+',
        r'\s+Then\s+',
        r'\s+And\s+I\s+need\s+to\s+',
        r'\s+And\s+I\s+want\s+to\s+'
    ]
    total_intents = sum(len(re.findall(pattern, title, re.IGNORECASE)) for pattern in intent_phrases)
    if total_intents >= 3:
        return True
    
    return False


def deterministic_extract_tasks(transcript: str) -> List[Dict[str, Any]]:
    """
    Deterministic task extraction from transcript as fallback when LLM returns a blob.
    
    Splits transcript into sentences, filters filler, normalizes, and extracts actionable tasks.
    """
    import re
    from task_extraction import normalize_title, validate_task
    
    if not transcript or not isinstance(transcript, str):
        return []
    
    # Step 1: Split into sentences on .!? keeping order
    sentences = re.split(r'([.!?]\s+)', transcript)
    # Reconstruct sentences with their punctuation
    reconstructed = []
    for i in range(0, len(sentences), 2):
        if i + 1 < len(sentences):
            reconstructed.append((sentences[i] + sentences[i+1]).strip())
        elif sentences[i].strip():
            reconstructed.append(sentences[i].strip())
    
    sentences = [s.strip() for s in reconstructed if s.strip()]
    
    # Step 2: Drop filler sentences
    filler_patterns = [
        r'^that\'s\s+very\s+important',
        r'^okay\s*\.?$',
        r'^yeah\s*\.?$',
        r'^um\s*\.?$',
        r'^uh\s*\.?$',
        r'^three\s+hours\s*\.?$',
        r'^that\s+takes?\s+',
        r'^that\s+might\s+take\s+',
    ]
    filtered_sentences = []
    for sent in sentences:
        is_filler = any(re.match(pattern, sent, re.IGNORECASE) for pattern in filler_patterns)
        if not is_filler:
            filtered_sentences.append(sent)
    
    # Step 3: Normalize and extract tasks
    tasks = []
    pending_duration = None
    
    action_verbs = [
        r'go\s+to',
        r'call',
        r'message',
        r'email',
        r'work\s+on',
        r'do',
        r'buy',
        r'pay',
        r'book',
        r'schedule',
        r'eat',
        r'have',
        r'finish',
        r'write',
        r'review',
        r'send',
        r'check',
        r'rent',
        r'prepare',
        r'clean',  # Added: clean my flat, clean the house, etc.
        r'visit',  # Added: visit X
        r'meet',   # Added: meet X
        r'read',   # Added: read X
        r'watch',  # Added: watch X
        r'listen', # Added: listen to X
        r'learn',  # Added: learn X
        r'study',  # Added: study X
        r'practice', # Added: practice X
        r'play',   # Added: play X
        r'cook',   # Added: cook X
        r'wash',   # Added: wash X
        r'laundry', # Added: do laundry (handled by 'do' but explicit)
    ]
    
    # Step 3.5: Handle "or" and "and" patterns in sentences before processing
    # CRITICAL: Check for "work on X for Y and on Z for W" pattern FIRST, before generic "and" splitting
    # This pattern must be split into 2 separate tasks
    work_on_pattern = r'work\s+on\s+(.+?)\s+for\s+(\d+|one|two|three|four|five)\s+(hours?|hour|minutes?|minute)\s+and\s+on\s+(.+?)\s+for\s+(\d+|one|two|three|four|five)\s+(hours?|hour|minutes?|minute)'
    expanded_sentences = []
    for sent in filtered_sentences:
        # FIRST: Check for "work on X for Y and on Z for W" pattern (highest priority)
        match = re.search(work_on_pattern, sent, re.IGNORECASE)
        if match:
            # Split into 2 sentences - don't process further
            first_object = match.group(1).strip()
            first_duration_value = match.group(2)
            first_duration_unit = match.group(3).lower()
            second_object = match.group(4).strip()
            second_duration_value = match.group(5)
            second_duration_unit = match.group(6).lower()
            
            first_sent = f"work on {first_object} for {first_duration_value} {first_duration_unit}"
            second_sent = f"work on {second_object} for {second_duration_value} {second_duration_unit}"
            expanded_sentences.append(first_sent)
            expanded_sentences.append(second_sent)
            continue  # Skip generic "or"/"and" processing for this sentence
        
        # Check for "or" patterns
        if " or " in sent.lower():
            # Split on "or"
            or_parts = re.split(r'\s+or\s+', sent, flags=re.IGNORECASE)
            for or_part in or_parts:
                or_part = or_part.strip()
                if not or_part:
                    continue
                # Check if this part has "and" that should be split
                if " and " in or_part.lower():
                    # Split on "and" if it connects different actions
                    and_parts = re.split(r'\s+and\s+(?=on\s+|to\s+|work\s+|call\s+|go\s+|do\s+|have\s+|eat\s+|write\s+|message\s+|email\s+|text\s+|reply\s+)', or_part, flags=re.IGNORECASE)
                    if len(and_parts) > 1:
                        expanded_sentences.extend([p.strip() for p in and_parts if p.strip()])
                    else:
                        expanded_sentences.append(or_part)
                else:
                    expanded_sentences.append(or_part)
        # Check for "and" patterns (if no "or")
        elif " and " in sent.lower():
            # CRITICAL FIX: Only split on "and" if it connects clearly different actions
            # Don't split if "and" is followed by continuation words (tell, about, what, then, etc.)
            # These indicate the same task, not a new task
            
            # Check for continuation patterns that indicate same task
            continuation_patterns = [
                r'\s+and\s+tell\s+',
                r'\s+and\s+about\s+',
                r'\s+and\s+what\s+',
                r'\s+and\s+then\s+',
                r'\s+and\s+him\s+',
                r'\s+and\s+her\s+',
                r'\s+and\s+them\s+',
                r'\s+and\s+that\s+',
                r'\s+and\s+the\s+',
            ]
            
            is_continuation = any(re.search(pattern, sent, re.IGNORECASE) for pattern in continuation_patterns)
            
            if is_continuation:
                # This is a continuation, not a new task - keep as one sentence
                expanded_sentences.append(sent)
            else:
                # Check if "and" connects different action verbs
                # Extract the action verb before "and" and after "and"
                before_and_match = re.search(r'(\w+)\s+and\s+', sent, re.IGNORECASE)
                after_and_match = re.search(r'\s+and\s+(\w+)', sent, re.IGNORECASE)
                
                if before_and_match and after_and_match:
                    before_verb = before_and_match.group(1).lower()
                    after_verb = after_and_match.group(1).lower()
                    
                    # Action verbs that indicate different tasks
                    action_verbs_list = ['work', 'call', 'go', 'do', 'have', 'eat', 'write', 'message', 'email', 'text', 'reply', 'buy', 'pay', 'book', 'schedule', 'finish', 'review', 'send', 'check', 'rent', 'prepare']
                    
                    # Only split if both are action verbs AND they're different
                    if before_verb in action_verbs_list and after_verb in action_verbs_list and before_verb != after_verb:
                        # Different actions - split
                        and_parts = re.split(r'\s+and\s+(?=on\s+|to\s+|work\s+|call\s+|go\s+|do\s+|have\s+|eat\s+|write\s+|message\s+|email\s+|text\s+|reply\s+|buy\s+|pay\s+|book\s+|schedule\s+|finish\s+|review\s+|send\s+|check\s+|rent\s+|prepare\s+)', sent, flags=re.IGNORECASE)
                        if len(and_parts) > 1:
                            expanded_sentences.extend([p.strip() for p in and_parts if p.strip()])
                        else:
                            expanded_sentences.append(sent)
                    else:
                        # Same verb or not both action verbs - keep as one task
                        expanded_sentences.append(sent)
                else:
                    # Can't determine - be conservative and keep as one task
                    expanded_sentences.append(sent)
        else:
            expanded_sentences.append(sent)
    
    # Use expanded sentences instead of filtered_sentences
    filtered_sentences = expanded_sentences
    
    for i, sent in enumerate(filtered_sentences):
        # Check if this sentence contains "work on X for Y hours" pattern - extract duration inline
        work_on_duration_match = re.search(r'work\s+on\s+.+?\s+for\s+(\d+|one|two|three|four|five)\s+(hours?|hour|minutes?|minute)', sent, re.IGNORECASE)
        duration_min = None
        if work_on_duration_match:
            duration_value = work_on_duration_match.group(1)
            duration_unit = work_on_duration_match.group(2).lower()
            if duration_unit.startswith('hour'):
                if duration_value.isdigit():
                    duration_min = int(duration_value) * 60
                elif duration_value.lower() == 'one': duration_min = 60
                elif duration_value.lower() == 'two': duration_min = 120
                elif duration_value.lower() == 'three': duration_min = 180
                elif duration_value.lower() == 'four': duration_min = 240
                elif duration_value.lower() == 'five': duration_min = 300
            elif duration_unit.startswith('minute'):
                if duration_value.isdigit():
                    duration_min = int(duration_value)
        
        # Check if this sentence is a standalone duration phrase (attach to previous task)
        if not duration_min:
            # Match "It takes X hours", "takes X hours", "for X hours", etc.
            duration_match = re.search(r'(?:it\s+)?(?:that\s+)?(?:might\s+)?takes?\s+(?:me\s+)?(\d+|\w+)\s*(minutes?|hours?|minute|hour)(?:\s+each)?', sent, re.IGNORECASE)
        if duration_match and tasks:
            # Attach to previous task
            duration_value = duration_match.group(1)
            duration_unit = duration_match.group(2).lower()
            if duration_unit.startswith('hour'):
                if duration_value.isdigit():
                    duration_min = int(duration_value) * 60
                elif duration_value.lower() == 'one': duration_min = 60
                elif duration_value.lower() == 'two': duration_min = 120
                elif duration_value.lower() == 'three': duration_min = 180
                elif duration_value.lower() == 'four': duration_min = 240
                elif duration_value.lower() == 'five': duration_min = 300
            elif duration_unit.startswith('minute'):
                if duration_value.isdigit():
                    duration_min = int(duration_value)
            if duration_min:
                tasks[-1]["duration_minutes"] = duration_min
            continue
        
        # Extract duration from "work on X for Y hours" pattern if present
        task_duration = None
        work_on_duration_match = re.search(r'work\s+on\s+.+?\s+for\s+(\d+|one|two|three|four|five)\s+(hours?|hour|minutes?|minute)', sent, re.IGNORECASE)
        if work_on_duration_match:
            duration_value = work_on_duration_match.group(1)
            duration_unit = work_on_duration_match.group(2).lower()
            if duration_unit.startswith('hour'):
                if duration_value.isdigit():
                    task_duration = int(duration_value) * 60
                elif duration_value.lower() == 'one': task_duration = 60
                elif duration_value.lower() == 'two': task_duration = 120
                elif duration_value.lower() == 'three': task_duration = 180
                elif duration_value.lower() == 'four': task_duration = 240
                elif duration_value.lower() == 'five': task_duration = 300
            elif duration_unit.startswith('minute'):
                if duration_value.isdigit():
                    task_duration = int(duration_value)
        
        # Normalize: remove leading phrases
        normalized = sent
        # Remove prefixes like "This time the first task is", "The first task is", etc.
        normalized = re.sub(r'^(?:This\s+time\s+the\s+first\s+task\s+is\s+|The\s+first\s+task\s+is\s+|First\s+task\s+is\s+)', '', normalized, flags=re.IGNORECASE)
        # Remove "Then I want to", "And then I want to", "I want to", etc.
        normalized = re.sub(r'^(?:Then\s+|And\s+then\s+)?(?:I\s+(?:need|want|have)\s+to\s+|And\s+I\s+(?:need|want|have)\s+to\s+)', '', normalized, flags=re.IGNORECASE)
        # Remove remaining "Then" or "And" at start
        normalized = re.sub(r'^(?:Then\s+|And\s+)', '', normalized, flags=re.IGNORECASE)
        normalized = normalize_title(normalized) if normalized else ""
        
        if not normalized:
            continue
        
        # Check if sentence contains an action verb
        has_action = any(re.search(pattern, normalized, re.IGNORECASE) for pattern in action_verbs)
        if not has_action:
            continue
        
        # Validate task
        temp_task = {"title": normalized}
        is_valid, _ = validate_task(temp_task)
        if not is_valid:
            continue
        
            # Check for contact list expansion (also handle "want to call" pattern)
            contact_match = re.match(r'^(call|message|text|email)\s+(.+)$', normalized, re.IGNORECASE)
            if not contact_match:
                # Also check for "want to call", "need to call", etc.
                contact_match = re.match(r'^(?:want|need|have)\s+to\s+(call|message|text|email)\s+(.+)$', normalized, re.IGNORECASE)
                if contact_match:
                    verb = contact_match.group(1).lower()
                    contact_list = contact_match.group(2).strip()
                else:
                    verb = None
                    contact_list = None
            else:
                verb = contact_match.group(1).lower()
                contact_list = contact_match.group(2).strip()
            
            if verb and contact_list:
                # Split contact list
                names = re.split(r',\s*|\s+and\s+', contact_list, flags=re.IGNORECASE)
                names = [n.strip() for n in names if n.strip()]
                if 2 <= len(names) <= 6:
                    # Create one task per name
                    for name in names:
                        tasks.append({
                            "text": f"{verb.capitalize()} {name}",
                            "title": f"{verb.capitalize()} {name}",
                            "duration_minutes": pending_duration
                        })
                    pending_duration = None
                    continue
        
        # Regular task - use task_duration if extracted from "work on X for Y" pattern, otherwise pending_duration
        tasks.append({
            "text": normalized,
            "title": normalized,
            "duration_minutes": task_duration if task_duration else pending_duration
        })
        pending_duration = None
    
    return tasks


def postprocess_safety_split(items: List[Dict[str, Any]], trace_id: Optional[str] = None, dump_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Safety split: Deterministically split bundled task titles even if LLM didn't.
    
    This runs AFTER postprocess_extraction_items to catch cases where the LLM
    bundled multiple actions into a single task title.
    
    Splits on:
    - Sentence boundaries (. ! ? \n)
    - Intent restarts (safe patterns only, not generic "and")
    - Duration continuation patterns
    
    Does NOT split on commas (to preserve contact lists).
    """
    if not items or not isinstance(items, list):
        return items or []
    
    # Log entry for debugging
    if trace_id:
        import json
        logger.info(json.dumps({
            "stage": "safety_split_entered",
            "dump_id": dump_id,
            "trace_id": trace_id,
            "input_item_count": len(items),
            "first_item_title_length": len(items[0].get("text", "") or items[0].get("title", "")) if items else 0
        }))
    
    try:
        from task_extraction import normalize_title, validate_task
    except ImportError:
        import sys
        from pathlib import Path
        backend_dir = Path(__file__).parent
        sys.path.insert(0, str(backend_dir))
        from task_extraction import normalize_title, validate_task
    
    split_items = []
    for item in items:
        title = item.get("text", "") or item.get("title", "")
        if not title:
            continue
        
        # Step 1: Split on sentence boundaries and intent restarts (safe patterns only)
        # Sentence boundaries: . ! ? \n
        # Intent restarts (case-insensitive):
        #   - " and i wanna "
        #   - " and i want to "
        #   - " and i need to "
        #   - " and i have to "
        #   - " and then i "
        #   - " & i want to " / "& i wanna"
        # Do NOT split on generic "and"
        sentence_pattern = r'[.!?]\s+|\n+'
        intent_restart_pattern = r'\s+and\s+i\s+(wanna|want\s+to|need\s+to|have\s+to)\s+|\s+and\s+then\s+i\s+|\s*&\s*i\s+(wanna|want\s+to)\s+|,\s+and\s+i\s+(want|need|have)\s+to\s+'
        split_pattern = f'({sentence_pattern}|{intent_restart_pattern})'
        
        # Step 2: Also handle duration continuation pattern
        # "work on a podcast for two hours and for two hours on the website"
        # Also handle "and on X for Y hours" pattern (reverse order)
        duration_continuation_pattern = r'\s+and\s+for\s+(\d+|one|two|three|four)\s+(hours|hour|minutes|minute)\s+on\s+'
        duration_continuation_reverse_pattern = r'\s+and\s+on\s+(.+?)\s+for\s+(\d+|one|two|three|four|five)\s+(hours?|hour|minutes?|minute)'
        
        # ALWAYS split on sentence boundaries if they exist (this is critical!)
        # Check if title contains patterns that need splitting
        has_sentence_boundary = bool(re.search(sentence_pattern, title, re.IGNORECASE))
        has_intent_restart = bool(re.search(intent_restart_pattern, title, re.IGNORECASE))
        has_duration_continuation = bool(re.search(duration_continuation_pattern, title, re.IGNORECASE))
        has_duration_continuation_reverse = bool(re.search(duration_continuation_reverse_pattern, title, re.IGNORECASE))
        
        # CRITICAL: Always split on sentence boundaries if they exist (even if title is long)
        # This prevents one big item from the LLM
        if has_sentence_boundary:
            # Split on sentence boundaries first (most important)
            # Use a simple split that definitely works
            parts = re.split(r'[.!?]\s+', title)
            parts = [p.strip() for p in parts if p.strip()]
            
            # DEBUG: Log if we're about to split
            if trace_id and len(parts) > 1:
                logger.info(json.dumps({
                    "stage": "safety_split_splitting",
                    "dump_id": dump_id,
                    "trace_id": trace_id,
                    "original_title_length": len(title),
                    "parts_count": len(parts),
                    "first_3_parts": [p[:50] for p in parts[:3]]
                }))
            
            # Handle standalone duration phrases - attach to previous part
            # Example: "I need to go to the gym. That takes two hours."
            # Should become: "I need to go to the gym" (with duration) + (drop "That takes two hours")
            merged_parts = []
            for i, p in enumerate(parts):
                # Check if this part is a standalone duration phrase
                duration_only_patterns = [
                    r'^that\s+takes?\s+(\d+|\w+)\s*(minutes?|hours?|minute|hour)',
                    r'^that\s+might\s+take\s+(\d+|\w+)\s*(minutes?|hours?|minute|hour)',
                    r'^takes?\s+(\d+|\w+)\s*(minutes?|hours?|minute|hour)',
                    r'^that\'s\s+very\s+important',  # Filter out "That's very important"
                ]
                is_duration_only = False
                is_filler = False
                for pattern in duration_only_patterns:
                    if re.match(pattern, p, re.IGNORECASE):
                        is_duration_only = True
                        break
                
                # Also check for filler phrases
                if re.match(r'^that\'s\s+very\s+important', p, re.IGNORECASE):
                    is_filler = True
                
                if is_duration_only and merged_parts:
                    # Attach duration to previous part by keeping it in the text
                    # We'll extract it later in the processing loop
                    prev_part = merged_parts[-1]
                    merged_parts[-1] = f"{prev_part}. {p}"  # Keep it for duration extraction
                elif is_filler:
                    # Skip filler phrases
                    continue
                elif is_duration_only and not merged_parts:
                    # First part is duration-only - skip it (invalid)
                    continue
                else:
                    merged_parts.append(p)
            parts = merged_parts
            
            # If we got multiple parts, continue with processing
            if len(parts) > 1:
                # Clean up parts - remove empty or fragment parts like "want to"
                cleaned_parts = []
                for p in parts:
                    p = p.strip()
                    if not p:
                        continue
                    # Skip fragments that are just verbs without objects (e.g., "want to", "need to")
                    if re.match(r'^(want|need|have|wanna)\s+to\s*$', p, re.IGNORECASE):
                        continue
                    cleaned_parts.append(p)
                parts = cleaned_parts
                
                # Now check each part for additional intent restarts
                expanded_parts = []
                for p in parts:
                    if re.search(intent_restart_pattern, p, re.IGNORECASE):
                        # Split this part on intent restarts
                        sub_parts = re.split(intent_restart_pattern, p, flags=re.IGNORECASE)
                        # Clean sub_parts
                        cleaned_sub_parts = []
                        for sp in sub_parts:
                            sp = sp.strip()
                            if not sp:
                                continue
                            # Skip verb fragments
                            if re.match(r'^(want|need|have|wanna)\s+to\s*$', sp, re.IGNORECASE):
                                continue
                            # Skip if it matches the intent restart pattern itself
                            if re.match(intent_restart_pattern, sp, re.IGNORECASE):
                                continue
                            cleaned_sub_parts.append(sp)
                        expanded_parts.extend(cleaned_sub_parts)
                    else:
                        expanded_parts.append(p)
                parts = expanded_parts
        elif has_intent_restart:
            # Split on intent restarts only
            parts = re.split(intent_restart_pattern, title, flags=re.IGNORECASE)
            # Clean up parts - remove empty and filter out verb fragments
            cleaned_parts = []
            for p in parts:
                p = p.strip()
                if not p:
                    continue
                # Skip fragments that are just verbs without objects (e.g., "want to", "need to")
                if re.match(r'^(want|need|have|wanna)\s+to\s*$', p, re.IGNORECASE):
                    continue
                # Skip if it matches the intent restart pattern itself
                if re.match(intent_restart_pattern, p, re.IGNORECASE):
                    continue
                cleaned_parts.append(p)
            parts = cleaned_parts
        else:
            # Check for "or" and "and" patterns that indicate multiple tasks
            # This catches cases like "call X or write X and work on Y"
            # Check "or" FIRST (before sentence boundaries) as it's higher priority
            has_or = " or " in title.lower()
            has_and = " and " in title.lower()
            
            if has_or or has_and:
                logger.info(f"  Checking 'or'/'and' patterns in: '{title[:60]}'")
                # Split on "or" first, then "and" within each part
                if has_or:
                    logger.info(f"    Splitting on 'or' pattern")
                    or_parts = re.split(r'\s+or\s+', title, flags=re.IGNORECASE)
                    logger.info(f"      After 'or' split: {len(or_parts)} parts: {[p[:40] for p in or_parts]}")
                    all_parts = []
                    for or_idx, or_part in enumerate(or_parts):
                        or_part = or_part.strip()
                        if not or_part:
                            continue
                        logger.info(f"      Processing 'or' part {or_idx}: '{or_part[:60]}'")
                        # Check if this part has "and" that connects different actions
                        if " and " in or_part.lower():
                            # Split on "and" if it's followed by a new action verb
                            # IMPORTANT: This regex only matches "and" followed by action verbs
                            # "call Oliver and Roberta" should NOT match because "Roberta" is not an action verb
                            and_parts = re.split(r'\s+and\s+(?=on\s+|to\s+|work\s+|call\s+|go\s+|do\s+|have\s+|eat\s+|write\s+|message\s+|email\s+|text\s+|reply\s+)', or_part, flags=re.IGNORECASE)
                            logger.info(f"        'And' check: regex returned {len(and_parts)} parts for '{or_part[:40]}'")
                            if len(and_parts) > 1:
                                logger.info(f"        ✓ Splitting 'and' in 'or' part: {len(and_parts)} parts")
                                all_parts.extend([p.strip() for p in and_parts if p.strip()])
                            else:
                                logger.info(f"        ✗ 'And' connects objects, keeping as one part: '{or_part[:40]}'")
                                all_parts.append(or_part)
                        else:
                            logger.info(f"        No 'and' in this part, keeping as-is")
                            all_parts.append(or_part)
                    logger.info(f"      Final parts after 'or'/'and' processing: {len(all_parts)}")
                elif has_and:
                    logger.info(f"    Checking 'and' pattern in: '{title[:60]}'")
                    # Split on "and" if it connects different actions
                    # IMPORTANT: Only split if "and" is followed by an action verb
                    # "call Oliver and Roberta" should NOT split because "Roberta" is not an action verb
                    and_parts = re.split(r'\s+and\s+(?=on\s+|to\s+|work\s+|call\s+|go\s+|do\s+|have\s+|eat\s+|write\s+|message\s+|email\s+|text\s+|reply\s+)', title, flags=re.IGNORECASE)
                    logger.info(f"      'And' regex check: {len(and_parts)} parts for '{title[:40]}'")
                    if len(and_parts) > 1:
                        logger.info(f"      ✓ Split into {len(and_parts)} parts (and connects actions)")
                        all_parts = [p.strip() for p in and_parts if p.strip()]
                    else:
                        # "and" connects objects, not actions - keep as-is
                        logger.info(f"      ✗ 'And' connects objects, NOT splitting - keeping as single task")
                        split_items.append(item)
                        continue
                else:
                    all_parts = [title]
                
                # If we got multiple parts, process them
                if len(all_parts) > 1:
                    logger.info(f"    ✓ Splitting into {len(all_parts)} parts")
                    parts = all_parts
                else:
                    # No splitting patterns found, keep as-is
                    logger.info(f"    ✗ No split needed, keeping as-is")
                    split_items.append(item)
                    continue
            else:
                # No "or" or "and" patterns found, keep as-is
                split_items.append(item)
                continue
        
        # Additional split: Handle "work on X for Y and on Z for W" pattern FIRST (before other patterns)
        # This is a critical pattern that must be detected early
        work_on_continuation_pattern = r'work\s+on\s+(.+?)\s+for\s+(\d+|one|two|three|four|five)\s+(hours?|hour|minutes?|minute)\s+and\s+on\s+(.+?)\s+for\s+(\d+|one|two|three|four|five)\s+(hours?|hour|minutes?|minute)'
        work_on_parts = []
        work_on_durations_map = {}  # Map original part index to list of (new_part_index, duration) tuples
        new_part_index = 0
        
        for orig_idx, part in enumerate(parts):
            match = re.search(work_on_continuation_pattern, part, re.IGNORECASE)
            if match:
                logger.info(f"  🔍 Detected 'work on X for Y and on Z for W' pattern in: '{part[:80]}'")
                # Extract both tasks
                first_object = match.group(1).strip()
                first_duration_value = match.group(2)
                first_duration_unit = match.group(3).lower()
                second_object = match.group(4).strip()
                second_duration_value = match.group(5)
                second_duration_unit = match.group(6).lower()
                
                # Parse durations
                def parse_duration(value, unit):
                    if unit.startswith('hour'):
                        if value.isdigit():
                            return int(value) * 60
                        elif value.lower() == 'one':
                            return 60
                        elif value.lower() == 'two':
                            return 120
                        elif value.lower() == 'three':
                            return 180
                        elif value.lower() == 'four':
                            return 240
                        elif value.lower() == 'five':
                            return 300
                    elif unit.startswith('minute'):
                        if value.isdigit():
                            return int(value)
                    return None
                
                first_duration = parse_duration(first_duration_value, first_duration_unit)
                second_duration = parse_duration(second_duration_value, second_duration_unit)
                
                # Create two separate parts
                first_task = f"work on {first_object} for {first_duration_value} {first_duration_unit}"
                second_task = f"work on {second_object} for {second_duration_value} {second_duration_unit}"
                
                logger.info(f"    ✓ Split into 2 tasks:")
                logger.info(f"      1. '{first_task}' (duration: {first_duration} min)")
                logger.info(f"      2. '{second_task}' (duration: {second_duration} min)")
                
                # Store durations for later extraction
                work_on_parts.append(first_task)
                work_on_durations_map[new_part_index] = first_duration
                new_part_index += 1
                
                work_on_parts.append(second_task)
                work_on_durations_map[new_part_index] = second_duration
                new_part_index += 1
            else:
                work_on_parts.append(part)
                new_part_index += 1
        
        parts = work_on_parts
        
        # Additional split: Handle "X and I want to Y" patterns in each part
        # This catches cases like "work on website and I want to call Tom"
        # Should ALWAYS split this pattern, regardless of what X is
        final_parts = []
        final_durations_map = {}  # Track duration indices after this split
        final_part_idx = 0
        for orig_idx, part in enumerate(parts):
            # Pattern: "X and I want/need/have to Y"
            # This should ALWAYS split - it's two separate actions
            multi_action_pattern = r'^(.+?)\s+and\s+i\s+(need|want|have)\s+to\s+(.+)$'
            match = re.match(multi_action_pattern, part, re.IGNORECASE)
            if match:
                # Always split this pattern - it's two separate actions
                before_and = match.group(1).strip()
                verb = match.group(2)
                after = match.group(3).strip()
                task_part = f"{verb} to {after}"
                
                # Add both parts
                if before_and:
                    final_parts.append(before_and)
                    # Preserve duration if it was set for this original part
                    if orig_idx in work_on_durations_map:
                        final_durations_map[final_part_idx] = work_on_durations_map[orig_idx]
                    final_part_idx += 1
                if task_part:
                    final_parts.append(task_part)
                    final_part_idx += 1
            else:
                final_parts.append(part)
                # Preserve duration if it was set for this original part
                if orig_idx in work_on_durations_map:
                    final_durations_map[final_part_idx] = work_on_durations_map[orig_idx]
                final_part_idx += 1
        parts = final_parts
        # Merge work_on_durations into part_durations for later use
        work_on_durations = final_durations_map
        
        # Handle duration continuation: if pattern found, split and extract duration
        part_durations = {}  # Map part index to duration
        # Merge work_on_durations into part_durations if it exists
        if 'work_on_durations' in locals() and work_on_durations:
            part_durations.update(work_on_durations)
            logger.info(f"  📅 Merged {len(work_on_durations)} durations from 'work on X and on Y' pattern into part_durations")
        
        if has_duration_continuation:
            new_parts = []
            for part in parts:
                # Check if this part contains duration continuation
                match = re.search(duration_continuation_pattern, part, re.IGNORECASE)
                if match:
                    # Split at the continuation
                    before = part[:match.start()].strip()
                    duration_value = match.group(1)
                    duration_unit = match.group(2).lower()
                    after = part[match.end():].strip()
                    
                    # Parse duration
                    duration_min = None
                    if duration_unit.startswith('hour'):
                        if duration_value.isdigit():
                            duration_min = int(duration_value) * 60
                        elif duration_value.lower() == 'one':
                            duration_min = 60
                        elif duration_value.lower() == 'two':
                            duration_min = 120
                        elif duration_value.lower() == 'three':
                            duration_min = 180
                        elif duration_value.lower() == 'four':
                            duration_min = 240
                    elif duration_unit.startswith('minute'):
                        if duration_value.isdigit():
                            duration_min = int(duration_value)
                    
                    if before:
                        new_parts.append(before)
                    if after:
                        # Infer verb from previous part if available
                        if new_parts:
                            prev_part = new_parts[-1]
                            if 'work on' in prev_part.lower():
                                # Extract what we're working on from "work on X"
                                work_match = re.search(r'work\s+on\s+(.+)', prev_part, re.IGNORECASE)
                                if work_match:
                                    # New part should be "work on <after>"
                                    after = f"work on {after}"
                        new_parts.append(after)
                        # Store duration for the continuation part (last index)
                        if duration_min:
                            part_durations[len(new_parts) - 1] = duration_min
                else:
                    new_parts.append(part)
            parts = new_parts
        
        # CRITICAL: If we still have only one part after all splitting attempts, 
        # but the original title had sentence boundaries, force split anyway
        if len(parts) <= 1:
            if has_sentence_boundary and len(title) > 50:
                # Force split on sentence boundaries even if regex didn't work
                # This is a fallback for edge cases
                forced_parts = re.split(r'[.!?]\s+', title)
                forced_parts = [p.strip() for p in forced_parts if p.strip()]
                # Filter out duration-only and filler parts
                filtered_forced = []
                for p in forced_parts:
                    is_duration = any(re.match(pattern, p, re.IGNORECASE) for pattern in [
                        r'^that\s+takes?\s+(\d+|\w+)\s*(minutes?|hours?|minute|hour)',
                        r'^that\s+might\s+take\s+(\d+|\w+)\s*(minutes?|hours?|minute|hour)',
                    ])
                    is_filler = bool(re.match(r'^that\'s\s+very\s+important', p, re.IGNORECASE))
                    if is_duration and filtered_forced:
                        # Attach to previous
                        filtered_forced[-1] = f"{filtered_forced[-1]}. {p}"
                    elif not is_duration and not is_filler:
                        filtered_forced.append(p)
                if len(filtered_forced) > 1:
                    parts = filtered_forced
                else:
                    split_items.append(item)
                    continue
            else:
                split_items.append(item)
                continue
        
        # Step 3: Process each part and apply contact list expansion
        segment_index = item.get("segment_index", 0)
        base_order = item.get("order_in_segment", 0)
        
        processed_parts = []
        for i, part in enumerate(parts):
            # Check if this part has a duration from duration continuation
            extracted_duration = part_durations.get(i)
            # Extract duration from "that takes X", "takes me X", or "for X hours" pattern (if not already set)
            if extracted_duration is None:
                duration_match = re.search(r'(?:that\s+takes?\s+|takes?\s+me\s+|for\s+)(\d+|\w+)\s*(minutes?|hours?|minute|hour)', part, re.IGNORECASE)
                if duration_match:
                    duration_value = duration_match.group(1)
                    duration_unit = duration_match.group(2).lower()
                    if duration_unit.startswith('hour'):
                        if duration_value.isdigit():
                            extracted_duration = int(duration_value) * 60
                        elif duration_value.lower() == 'one':
                            extracted_duration = 60
                        elif duration_value.lower() == 'two':
                            extracted_duration = 120
                        elif duration_value.lower() == 'three':
                            extracted_duration = 180
                        elif duration_value.lower() == 'four':
                            extracted_duration = 240
                    elif duration_unit.startswith('minute'):
                        if duration_value.isdigit():
                            extracted_duration = int(duration_value)
                    # Remove duration from part
                    part = re.sub(r'(?:that\s+(?:might\s+)?takes?\s+|takes?\s+me\s+|for\s+)(\d+|\w+)\s*(minutes?|hours?|minute|hour)(?:\s+each)?', '', part, flags=re.IGNORECASE).strip()
            
            # Normalize the part
            normalized = normalize_title(part)
            if not normalized:
                continue
            
            # Step 4: Filler filtering - drop fragments that are clearly not tasks
            normalized_lower = normalized.lower()
            filler_patterns = [
                r'^i\'?m\s+',
                r'^im\s+',
                r'^yeah',
                r'something\s+really',
                r'getting\s+bored'
            ]
            is_filler = any(re.match(pattern, normalized_lower) for pattern in filler_patterns)
            if is_filler:
                continue
            
            # Validate
            temp_task = {"title": normalized}
            is_valid, error_msg = validate_task(temp_task)
            if not is_valid:
                continue
            
            # Step 5: Contact list expansion (controlled)
            # IMPORTANT: Only expand if the task contains multiple distinct actions or explicit separators
            # Do NOT expand "call X and Y" - that's one action with multiple objects
            # Only expand if there are commas or if it's clearly multiple distinct actions
            
            # Check if this matches "call <list>" or "message <list>" etc.
            # But be conservative - only expand if there are commas (explicit list) or multiple verbs
            contact_verb_pattern = r'^(call|message|text|email)\s+(.+)$'
            contact_match = re.match(contact_verb_pattern, normalized, re.IGNORECASE)
            
            verb = None
            contact_list = None
            should_expand = False
            
            if contact_match:
                verb = contact_match.group(1).lower()
                contact_list = contact_match.group(2).strip()
                
                # CRITICAL: Only expand if there are commas (explicit list)
                # Do NOT expand "call X and Y" - that's one action with multiple objects
                # The pattern "call Oliver and Roberta" should stay as ONE task
                if ',' in contact_list:
                    # Explicit comma-separated list like "call Tom, Oliver, and Roberta" - safe to expand
                    should_expand = True
                    logger.info(f"        Contact list has commas - will expand")
                else:
                    # No commas - this is "call X and Y" which is ONE task, not a list
                    # Do NOT expand - keep as single task
                    should_expand = False
                    logger.info(f"        Contact list has NO commas - keeping as single task: '{verb} {contact_list}'")
            else:
                # Check original part for "I want to call", "I need to call", etc.
                original_contact_pattern = r'^(?:I\s+(?:want|need|have)\s+to\s+)?(call|message|text|email)\s+(.+)$'
                original_match = re.match(original_contact_pattern, part, re.IGNORECASE)
                if original_match:
                    verb = original_match.group(1).lower()
                    contact_list = original_match.group(2).strip()
                    # Normalize the contact list part (remove trailing punctuation, etc.)
                    contact_list = normalize_title(contact_list)
                    # Only expand if there are commas
                    if ',' in contact_list:
                        should_expand = True
                else:
                    # Check if this is a name-only fragment (e.g., "Tom and Oliver")
                    # Look for pattern: "Name and Name" or "Name, Name and Name"
                    # Must be capitalized names (proper nouns) separated by "and"
                    name_only_pattern = r'^[A-Z][a-z]+(?:\s+and\s+[A-Z][a-z]+)+$'
                    if re.match(name_only_pattern, normalized):
                        # This looks like a contact list fragment - try to infer verb from context
                        # For now, default to "call" if it's just names
                        names = re.split(r'\s+and\s+', normalized, flags=re.IGNORECASE)
                        if 2 <= len(names) <= 6:
                            # All parts look like names (capitalized, single words)
                            if all(re.match(r'^[A-Z][a-z]+$', n.strip()) for n in names):
                                verb = "call"  # Default to "call" for name-only fragments
                                contact_list = normalized
                                # Clean up the names
                                names = [n.strip() for n in names if n.strip()]
                                contact_list = " and ".join(names)
                                # Only expand name-only fragments if they have commas
                                should_expand = ',' in contact_list
            
            if verb and contact_list:
                logger.info(f"      Contact list detected: verb='{verb}', list='{contact_list}', should_expand={should_expand}")
                if should_expand:
                # Split contact list by comma and " and " ONLY
                    # This is safe because we're inside a verb pattern and we've confirmed it's a list
                    logger.info(f"        Expanding contact list: '{contact_list}'")
                names = re.split(r',\s*|\s+and\s+', contact_list, flags=re.IGNORECASE)
                names = [n.strip() for n in names if n.strip()]
                
                # Guardrail: only expand if 2 <= count <= 6
                if 2 <= len(names) <= 6:
                    logger.info(f"        Creating {len(names)} separate tasks from contact list")
                    # Create one item per name
                    for j, name in enumerate(names):
                        expanded_title = f"{verb.capitalize()} {name}"
                        processed_parts.append({
                            "title": expanded_title,
                            "duration": extracted_duration,
                            "order_offset": j
                        })
                    continue
                else:
                    logger.info(f"        NOT expanding - keeping as single task: '{verb} {contact_list}'")
            
            # Not a contact list, add as single item
            processed_parts.append({
                "title": normalized,
                "duration": extracted_duration,
                "order_offset": 0
            })
        
        # Step 6: Create items from processed parts
        for i, part_info in enumerate(processed_parts):
            new_item = item.copy()
            new_item["text"] = part_info["title"]
            new_item["title"] = part_info["title"]  # For compatibility
            new_item["segment_index"] = segment_index
            new_item["order_in_segment"] = base_order + i
            if part_info["duration"]:
                new_item["duration_minutes"] = part_info["duration"]
            
            split_items.append(new_item)
        
        # If we split, log it
        if trace_id and len(processed_parts) > 1:
            logger.info(json.dumps({
                "stage": "safety_split_applied",
                "dump_id": dump_id,
                "trace_id": trace_id,
                "original_title": title[:100],
                "split_count": len(processed_parts),
                "resulting_titles": [p["title"][:50] for p in processed_parts]
            }))
        elif trace_id and len(title) > 50 and has_sentence_boundary and len(processed_parts) <= 1:
            # Log when we should have split but didn't
            logger.warning(json.dumps({
                "stage": "safety_split_should_have_split",
                "dump_id": dump_id,
                "trace_id": trace_id,
                "original_title": title[:100],
                "title_length": len(title),
                "has_sentence_boundary": has_sentence_boundary,
                "processed_parts_count": len(processed_parts),
                "parts_after_initial_split": len(parts) if 'parts' in locals() else 0
            }))
    
    # Log exit for debugging
    logger.info("=" * 80)
    logger.info("SAFETY SPLIT DEBUG - EXIT")
    logger.info("=" * 80)
    logger.info(f"Output items: {len(split_items)}")
    logger.info(f"Items changed: {len(items)} -> {len(split_items)} ({len(split_items) - len(items):+d})")
    for i, item in enumerate(split_items):
        title = item.get("text", "") or item.get("title", "")
        logger.info(f"  Output {i}: \"{title[:80]}\"")
    logger.info("=" * 80)
    
    if trace_id:
        logger.info(json.dumps({
            "stage": "safety_split_exited",
            "dump_id": dump_id,
            "trace_id": trace_id,
            "input_item_count": len(items),
            "output_item_count": len(split_items)
        }))
    
    return split_items


def postprocess_extraction_items(items: List[Dict[str, Any]], segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Post-process extraction items with:
    - Duration attachment (duration_attach -> most recent task)
    - Target expansion (e.g., "Call Roberta, Tom and Oliver" -> separate tasks)
    - Cancellation application (remove cancelled tasks)
    - Validation (drop invalid tasks)
    - Ordering (by segment_index, then order_in_segment)
    
    Args:
        items: Raw items from LLM
        segments: Segments used for extraction
    
    Returns:
        List of validated tasks in correct order
    """
    try:
        from task_extraction import validate_task, normalize_title, detect_cancel_intent
    except ImportError:
        import sys
        from pathlib import Path
        backend_dir = Path(__file__).parent
        sys.path.insert(0, str(backend_dir))
        from task_extraction import validate_task, normalize_title, detect_cancel_intent
    
    # Log entry
    logger.info("=" * 80)
    logger.info("POSTPROCESSING DEBUG - ENTRY")
    logger.info("=" * 80)
    logger.info(f"Input items: {len(items)}")
    for i, item in enumerate(items):
        logger.info(f"  Input {i}: segment={item.get('segment_index')}, order={item.get('order_in_segment')}, type={item.get('type')}, title=\"{item.get('title', 'N/A')[:80]}\"")
    logger.info("=" * 80)
    
    # Step 1: Filter out ignore items and collect cancellations
    filtered_items = []
    cancelled_targets = set()
    
    for item in items:
        item_type = item.get("type", "")
        if item_type == "ignore":
            continue
        elif item_type == "cancel_task":
            # Collect cancellation targets immediately
            targets = item.get("targets", [])
            if targets:
                cancelled_targets.update([t.lower().strip() for t in targets])
            else:
                # Try to detect cancellation from title/source_text
                cancel_target = detect_cancel_intent(item.get("title", "") or item.get("source_text", ""))
                if cancel_target:
                    cancelled_targets.add(cancel_target.lower().strip())
            # Don't add cancel_task items to filtered_items - we've already extracted their targets
        else:
            filtered_items.append(item)
    
    logger.debug(f"🔍 Cancelled targets: {cancelled_targets}")
    
    # Step 2: Attach durations (duration_attach -> most recent task in same segment)
    tasks_by_segment = {}  # segment_index -> list of tasks
    duration_attachments = []  # (segment_index, duration_minutes, order_in_segment)
    
    for item in filtered_items:
        seg_idx = item.get("segment_index", 0)
        if seg_idx not in tasks_by_segment:
            tasks_by_segment[seg_idx] = []
        
        if item.get("type") == "duration_attach":
            duration = item.get("duration_minutes")
            order = item.get("order_in_segment", 0)
            if duration:
                duration_attachments.append((seg_idx, duration, order))
        elif item.get("type") == "task":
            tasks_by_segment[seg_idx].append(item)
    
    # Attach durations to most recent task in segment (by order_in_segment, BEFORE the duration_attach item)
    for seg_idx, duration, order in duration_attachments:
        if seg_idx in tasks_by_segment and tasks_by_segment[seg_idx]:
            # Find the task with the highest order_in_segment that is still < this duration's order
            candidate_tasks = [t for t in tasks_by_segment[seg_idx] if t.get("order_in_segment", 0) < order]
            if candidate_tasks:
                most_recent = max(candidate_tasks, key=lambda t: t.get("order_in_segment", 0))
                if "duration_minutes" not in most_recent or most_recent.get("duration_minutes") is None:
                    most_recent["duration_minutes"] = duration
                    logger.debug(f"🔍 Attached duration {duration} to task '{most_recent.get('title')}' in segment {seg_idx} (order {most_recent.get('order_in_segment')} < {order})")
    
    # Step 2.5: Check for segments with "work on X and on Y" pattern that have NO tasks at all
    # This must run BEFORE expansion to catch cases where LLM completely missed the segment
    logger.info("\n  Pre-expansion Fallback: Checking for missing 'work on' patterns")
    work_on_pattern_pre = r'work\s+on\s+(.+?)\s+for\s+(\d+|one|two|three|four|five)\s+(hours?|hour|minutes?|minute)\s+and\s+on\s+(.+?)\s+for\s+(\d+|one|two|three|four|five)\s+(hours?|hour|minutes?|minute)'
    for seg in segments:
        seg_idx = seg.get('i', -1)
        seg_text = seg.get('text', '')
        seg_text_lower = seg_text.lower()
        
        # Check if segment has "work on X and on Y" pattern
        if 'work on' in seg_text_lower and 'and on' in seg_text_lower:
            # Check if we have ANY tasks for this segment
            if seg_idx not in tasks_by_segment or not tasks_by_segment[seg_idx]:
                # Segment has pattern but NO tasks - create them now
                logger.warning(f"  ⚠️  PRE-EXPANSION FALLBACK: Segment {seg_idx} has 'work on X and on Y' pattern but NO tasks extracted!")
                match = re.search(work_on_pattern_pre, seg_text, re.IGNORECASE)
                if match:
                    logger.warning(f"     Creating 2 tasks deterministically from pattern")
                    
                    first_object = match.group(1).strip()
                    first_duration_value = match.group(2)
                    first_duration_unit = match.group(3).lower()
                    second_object = match.group(4).strip()
                    second_duration_value = match.group(5)
                    second_duration_unit = match.group(6).lower()
                    
                    # Parse durations
                    def parse_duration_pre(value, unit):
                        if unit.startswith('hour'):
                            if value.isdigit():
                                return int(value) * 60
                            elif value.lower() == 'one': return 60
                            elif value.lower() == 'two': return 120
                            elif value.lower() == 'three': return 180
                            elif value.lower() == 'four': return 240
                            elif value.lower() == 'five': return 300
                        elif unit.startswith('minute'):
                            if value.isdigit():
                                return int(value)
                        return None
                    
                    first_duration = parse_duration_pre(first_duration_value, first_duration_unit)
                    second_duration = parse_duration_pre(second_duration_value, second_duration_unit)
                    
                    # Initialize segment if needed
                    if seg_idx not in tasks_by_segment:
                        tasks_by_segment[seg_idx] = []
                    
                    # Create first task
                    first_title = f"work on {first_object} for {first_duration_value} {first_duration_unit}"
                    first_task = {
                        "title": first_title,
                        "source_text": seg_text,
                        "segment_index": seg_idx,
                        "order_in_segment": 0,
                        "duration_minutes": first_duration,
                        "type": "task",
                        "confidence": 0.8
                    }
                    tasks_by_segment[seg_idx].append(first_task)
                    logger.info(f"    ✓ Pre-expansion: Created task 1: '{first_title}' (duration: {first_duration} min)")
                    
                    # Create second task
                    second_title = f"work on {second_object} for {second_duration_value} {second_duration_unit}"
                    second_task = {
                        "title": second_title,
                        "source_text": seg_text,
                        "segment_index": seg_idx,
                        "order_in_segment": 1,
                        "duration_minutes": second_duration,
                        "type": "task",
                        "confidence": 0.8
                    }
                    tasks_by_segment[seg_idx].append(second_task)
                    logger.info(f"    ✓ Pre-expansion: Created task 2: '{second_title}' (duration: {second_duration} min)")
    
    # Step 3: Expand targets and filter cancellations (e.g., "Call Roberta, Tom and Oliver" -> separate tasks)
    expanded_tasks = []
    for seg_idx, tasks in tasks_by_segment.items():
        for task in tasks:
            title = task.get("title", "")
            task_duration = task.get("duration_minutes")
            
            # CRITICAL FIX: Never skip tasks with duration_minutes, even if title is empty
            # Tasks with durations are valid and must be preserved
            if not title:
                if task_duration is not None:
                    # Task has duration but missing title - reconstruct from source_text
                    title = task.get("source_text", "") or f"Task with duration {task_duration} minutes"
                    task["title"] = title
                    logger.warning(f"  ⚠️  Task in segment {seg_idx} had empty title but has duration_minutes={task_duration}, using reconstructed title: '{title[:80]}'")
                else:
                    logger.warning(f"  ⚠️  Skipping task in segment {seg_idx}: empty title and no duration")
                continue
            
            # Check if task is cancelled BEFORE expansion
            title_lower = title.lower().strip()
            source_lower = (task.get("source_text", "") or "").lower().strip()
            is_cancelled = False
            for cancelled in cancelled_targets:
                if cancelled in title_lower or cancelled in source_lower:
                    is_cancelled = True
                    logger.debug(f"🔍 Cancelled task '{title}' (contains '{cancelled}')")
                    break
            
            if is_cancelled:
                continue  # Skip cancelled tasks
            
            # Check if title contains multiple names/objects that should be split
            # Handle "or" patterns: "call X or write X" => extract both as separate tasks
            # Handle "and" patterns: "call X and work on Y" => extract both as separate tasks
            # Handle nested patterns: "call X or write X and work on Y" => 3 tasks
            has_or = " or " in title.lower()
            has_and = " and " in title.lower()
            has_comma = "," in title
            
            if has_or or has_and or has_comma:
                # Step 1: Split on "or" first (highest priority)
                if has_or:
                    logger.info(f"    Splitting on 'or': '{title[:60]}'")
                    or_parts = re.split(r'\s+or\s+', title, flags=re.IGNORECASE)
                    logger.info(f"      After 'or' split: {len(or_parts)} parts")
                    # Step 2: For each part after "or" split, also split on "and" if it connects different actions
                    all_parts = []
                    for or_idx, or_part in enumerate(or_parts):
                        or_part = or_part.strip()
                        if not or_part:
                            continue
                        
                        logger.info(f"      Processing 'or' part {or_idx}: '{or_part[:60]}'")
                        # Check if this part has "and" that should be split
                        # Only split if "and" connects different actions (different verbs)
                        if " and " in or_part.lower():
                            # Check if "and" is followed by a new action verb (different action)
                            # Pattern: "verb1 X and verb2 Y" or "verb1 X and on Y" (preposition indicates new action)
                            and_parts = re.split(r'\s+and\s+(?=on\s+|to\s+|work\s+|call\s+|go\s+|do\s+|have\s+|eat\s+|write\s+|message\s+|email\s+|text\s+|reply\s+)', or_part, flags=re.IGNORECASE)
                            if len(and_parts) > 1:
                                # "and" connects different actions - split
                                logger.info(f"        Splitting 'and' in 'or' part: {len(and_parts)} parts")
                                all_parts.extend([p.strip() for p in and_parts if p.strip()])
                            else:
                                # "and" connects objects of same action - don't split
                                logger.info(f"        'And' connects objects, not splitting")
                                all_parts.append(or_part)
                        else:
                            all_parts.append(or_part)
                    
                    logger.info(f"      Final parts after 'or'/'and' split: {len(all_parts)}")
                    for i, part in enumerate(all_parts):
                        logger.info(f"        Part {i}: '{part[:60]}'")
                elif has_and:
                    # CRITICAL FIX: Don't split on "and" if it's followed by continuation words
                    # Patterns like "message X and tell him about Y" should NOT split
                    continuation_patterns = [
                        r'\s+and\s+tell\s+',
                        r'\s+and\s+about\s+',
                        r'\s+and\s+what\s+',
                        r'\s+and\s+then\s+',
                        r'\s+and\s+him\s+',
                        r'\s+and\s+her\s+',
                        r'\s+and\s+them\s+',
                    ]
                    
                    is_continuation = any(re.search(pattern, title, re.IGNORECASE) for pattern in continuation_patterns)
                    
                    if is_continuation:
                        # This is a continuation, not a new task - keep as one task
                        logger.info(f"    'And' followed by continuation word - keeping as single task: '{title[:60]}'")
                        expanded_tasks.append(task)
                        continue
                    
                    # Split on "and" only if it connects different actions
                    and_parts = re.split(r'\s+and\s+(?=on\s+|to\s+|work\s+|call\s+|go\s+|do\s+|have\s+|eat\s+|write\s+)', title, flags=re.IGNORECASE)
                    if len(and_parts) == 1:
                        # Try generic split but check if it's actually different actions
                        and_parts = re.split(r'\s+and\s+', title, flags=re.IGNORECASE)
                        # If split, verify both parts are different actions
                        if len(and_parts) > 1:
                            first_verb = and_parts[0].strip().split()[0].lower() if and_parts[0].strip().split() else ""
                            second_verb = and_parts[1].strip().split()[0].lower() if and_parts[1].strip().split() else ""
                            action_verbs_list = ['work', 'call', 'go', 'do', 'have', 'eat', 'write', 'message', 'email', 'text', 'reply', 'buy', 'pay', 'book', 'schedule', 'finish', 'review', 'send', 'check', 'rent', 'prepare']
                            
                            # Only split if both are action verbs AND they're different
                            if first_verb in action_verbs_list and second_verb in action_verbs_list and first_verb != second_verb:
                                # Different actions - split
                                pass  # Keep the split
                            else:
                                # Not different actions - don't split
                                and_parts = [title]
                    all_parts = [p.strip() for p in and_parts if p.strip()]
                else:
                    # Split on comma only
                    all_parts = [p.strip() for p in title.split(',') if p.strip()]
                
                if len(all_parts) > 1:
                    # Check if first part has an action verb
                    first_part = all_parts[0].strip()
                    action_verbs = ["call", "message", "email", "text", "reply", "write", "work", "go", "do", "have", "eat"]
                    has_action = any(first_part.lower().startswith(verb + " ") for verb in action_verbs)
                    
                    if has_action:
                        # Split into separate tasks
                        action = first_part.split()[0] if first_part.split() else ""
                        for i, part in enumerate(all_parts):
                            part = part.strip()
                            if not part:
                                continue
                            
                            # If part doesn't start with action verb, check if it needs one
                            part_has_action = any(part.lower().startswith(verb + " ") for verb in action_verbs)
                            if not part_has_action and action:
                                # Prepend action if part looks like it needs one
                                # But be careful: "write them per WhatsApp" already has "write"
                                if not any(part.lower().startswith(verb + " ") for verb in action_verbs):
                                    part = f"{action} {part}"
                            
                            new_task = task.copy()
                            new_task["title"] = normalize_title(part)
                            new_task["order_in_segment"] = task.get("order_in_segment", 0) + i
                            # Preserve original source_text if it contains the part with duration
                            # If source_text has the original text with duration, keep it for duration extraction
                            original_source = task.get("source_text", "")
                            if original_source and part.lower() in original_source.lower():
                                # source_text contains this part, keep it
                                new_task["source_text"] = original_source
                            else:
                                # Set source_text to the part itself (might contain duration)
                                new_task["source_text"] = part
                            expanded_tasks.append(new_task)
                        continue
            
            expanded_tasks.append(task)
    
    # Step 3.5: Merge tasks that were incorrectly split (e.g., "message X" and "tell him about Y" should be one task)
    # This fixes cases where the LLM or expansion logic split a single task into multiple parts
    logger.info("\n  Merging incorrectly split tasks:")
    merged_tasks = []
    i = 0
    while i < len(expanded_tasks):
        current_task = expanded_tasks[i]
        current_title = current_task.get("title", "").lower()
        current_seg = current_task.get("segment_index", -1)
        
        # Check if this task should be merged with the next one
        should_merge = False
        merge_with_next = None
        
        if i + 1 < len(expanded_tasks):
            next_task = expanded_tasks[i + 1]
            next_title = next_task.get("title", "").lower()
            next_seg = next_task.get("segment_index", -1)
            
            # Same segment and consecutive order
            if current_seg == next_seg:
                # Pattern 1: "message X" followed by "tell him about Y" or "tell her about Y"
                if ("message" in current_title or "text" in current_title or "email" in current_title) and \
                   ("tell" in next_title and ("him" in next_title or "her" in next_title or "them" in next_title)):
                    should_merge = True
                    merge_with_next = next_task
                
                # Pattern 2: "message X" followed by "about Y" or "what he asked"
                elif ("message" in current_title or "text" in current_title or "email" in current_title) and \
                     (next_title.startswith("about ") or "what he" in next_title or "what she" in next_title):
                    should_merge = True
                    merge_with_next = next_task
        
        if should_merge and merge_with_next:
            # Merge the tasks
            merged_title = f"{current_task.get('title', '')} and {merge_with_next.get('title', '')}"
            merged_task = current_task.copy()
            merged_task["title"] = merged_title
            # Use source_text from either task if available
            merged_source = current_task.get("source_text") or merge_with_next.get("source_text") or merged_title
            merged_task["source_text"] = merged_source
            merged_tasks.append(merged_task)
            logger.info(f"    ✓ Merged: '{current_task.get('title', '')[:50]}' + '{merge_with_next.get('title', '')[:50]}' → '{merged_title[:80]}'")
            i += 2  # Skip both tasks
        else:
            merged_tasks.append(current_task)
            i += 1
    
    final_tasks = merged_tasks
    
    # Step 4.5: Fallback detection for "work on X and on Y" pattern if LLM missed it
    # Check segments for "work on X and on Y" pattern and create items if missing
    logger.info("\n  Fallback Pattern Detection:")
    work_on_pattern = r'work\s+on\s+(.+?)\s+for\s+(\d+|one|two|three|four|five)\s+(hours?|hour|minutes?|minute)\s+and\s+on\s+(.+?)\s+for\s+(\d+|one|two|three|four|five)\s+(hours?|hour|minutes?|minute)'
    
    for seg in segments:
        seg_idx = seg.get('i', -1)
        seg_text = seg.get('text', '')
        seg_text_lower = seg_text.lower()
        
        # Check if segment has "work on X and on Y" pattern
        if 'work on' in seg_text_lower and 'and on' in seg_text_lower:
            # Check if we already have items for this segment
            existing_items = [t for t in final_tasks if t.get('segment_index') == seg_idx]
            
            # Check if pattern exists in segment text
            match = re.search(work_on_pattern, seg_text, re.IGNORECASE)
            if match and len(existing_items) < 2:
                # Pattern found but LLM didn't extract both tasks - create them deterministically
                logger.warning(f"  ⚠️  Fallback: Segment {seg_idx} has 'work on X and on Y' pattern but only {len(existing_items)} item(s) extracted")
                logger.warning(f"     Creating missing items deterministically from pattern")
                
                first_object = match.group(1).strip()
                first_duration_value = match.group(2)
                first_duration_unit = match.group(3).lower()
                second_object = match.group(4).strip()
                second_duration_value = match.group(5)
                second_duration_unit = match.group(6).lower()
                
                # Parse durations
                def parse_duration(value, unit):
                    if unit.startswith('hour'):
                        if value.isdigit():
                            return int(value) * 60
                        elif value.lower() == 'one':
                            return 60
                        elif value.lower() == 'two':
                            return 120
                        elif value.lower() == 'three':
                            return 180
                        elif value.lower() == 'four':
                            return 240
                        elif value.lower() == 'five':
                            return 300
                    elif unit.startswith('minute'):
                        if value.isdigit():
                            return int(value)
                    return None
                
                first_duration = parse_duration(first_duration_value, first_duration_unit)
                second_duration = parse_duration(second_duration_value, second_duration_unit)
                
                # Create first task if missing
                first_title = f"work on {first_object} for {first_duration_value} {first_duration_unit}"
                first_exists = any(t.get('title', '').lower() == first_title.lower() for t in existing_items)
                if not first_exists:
                    first_task = {
                        "title": first_title,
                        "source_text": seg_text,
                        "segment_index": seg_idx,
                        "order_in_segment": len(existing_items),
                        "duration_minutes": first_duration,
                        "type": "task",
                        "confidence": 0.8
                    }
                    final_tasks.append(first_task)
                    logger.info(f"    ✓ Created fallback task 1: '{first_title}' (duration: {first_duration} min)")
                
                # Create second task if missing
                second_title = f"work on {second_object} for {second_duration_value} {second_duration_unit}"
                # Check against all tasks in final_tasks (including ones we just added)
                second_exists = any(t.get('title', '').lower() == second_title.lower() for t in final_tasks if t.get('segment_index') == seg_idx)
                if not second_exists:
                    # Get current count of items for this segment (including first task we might have just added)
                    current_seg_items = [t for t in final_tasks if t.get('segment_index') == seg_idx]
                    second_task = {
                        "title": second_title,
                        "source_text": seg_text,
                        "segment_index": seg_idx,
                        "order_in_segment": len(current_seg_items),
                        "duration_minutes": second_duration,
                        "type": "task",
                        "confidence": 0.8
                    }
                    final_tasks.append(second_task)
                    logger.info(f"    ✓ Created fallback task 2: '{second_title}' (duration: {second_duration} min)")
                else:
                    logger.info(f"    ℹ️  Second task already exists: '{second_title}'")
            
            # Also check if we need to create items even if pattern didn't match exactly
            # This handles cases where LLM completely missed the segment
            if len(existing_items) == 0 and 'work on' in seg_text_lower:
                logger.warning(f"  ⚠️  Segment {seg_idx} contains 'work on' but has NO items at all - attempting fallback extraction")
                # Try a simpler pattern match
                simple_match = re.search(r'work\s+on\s+(.+?)(?:\s+for\s+(\d+|one|two|three|four|five)\s+(hours?|hour|minutes?|minute))?', seg_text, re.IGNORECASE)
                if simple_match:
                    object_name = simple_match.group(1).strip()
                    duration_val = simple_match.group(2)
                    duration_unit = simple_match.group(3)
                    if duration_val and duration_unit:
                        # Parse duration
                        def parse_duration_simple(val, unit):
                            if unit and unit.startswith('hour'):
                                if val.isdigit():
                                    return int(val) * 60
                                elif val.lower() == 'one': return 60
                                elif val.lower() == 'two': return 120
                                elif val.lower() == 'three': return 180
                                elif val.lower() == 'four': return 240
                                elif val.lower() == 'five': return 300
                            elif unit and unit.startswith('minute'):
                                if val.isdigit():
                                    return int(val)
                            return None
                        duration = parse_duration_simple(duration_val, duration_unit.lower())
                        fallback_title = f"work on {object_name} for {duration_val} {duration_unit}"
                        fallback_task = {
                            "title": fallback_title,
                            "source_text": seg_text,
                            "segment_index": seg_idx,
                            "order_in_segment": 0,
                            "duration_minutes": duration,
                            "type": "task",
                            "confidence": 0.7
                        }
                        final_tasks.append(fallback_task)
                        logger.info(f"    ✓ Created simple fallback task: '{fallback_title}' (duration: {duration} min)")
    
    # Step 4.6: Extract durations from task titles, source_text and adjacent segments (for cases where periods split the duration)
    logger.info("\n  Duration Extraction from Task Titles, Source Text and Adjacent Segments:")
    def extract_duration_from_text(text: str) -> Optional[int]:
        """Extract duration in minutes from text using various patterns.
        
        Handles patterns like:
        - "for 4 hours" / "for four hours"
        - "for 30 minutes"
        - "It takes 3 hours" / "takes three hours"
        - "that takes 2 hours"
        
        If multiple durations are found, returns the LAST one (most specific/relevant).
        """
        if not text:
            return None
        
        # Word to number mapping
        word_to_number = {
            "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
            "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10
        }
        
        # Find ALL matches and use the LAST one (most specific/relevant to this task)
        all_matches = []
        
        # Pattern 1: "for X hours" / "for X minutes" (most common in task titles)
        for_pattern_hours = r'for\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(hours?|hour)'
        for match in re.finditer(for_pattern_hours, text, re.IGNORECASE):
            duration_value = match.group(1)
            if duration_value.isdigit():
                duration_hours = int(duration_value)
            else:
                duration_hours = word_to_number.get(duration_value.lower())
            if duration_hours:
                all_matches.append((match.end(), duration_hours * 60, "for hours"))
        
        for_pattern_minutes = r'for\s+(\d+)\s+(minutes?|minute)'
        for match in re.finditer(for_pattern_minutes, text, re.IGNORECASE):
            duration_minutes = int(match.group(1))
            all_matches.append((match.end(), duration_minutes, "for minutes"))
        
        # Pattern 2: "It takes X hours", "takes X hours", "that takes X hours", "It will take X hours", "That will take X hours", "will take X hours"
        hours_pattern = r'(?:it\s+|that\s+)?(?:will\s+)?takes?\s+(?:me\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(hours?|hour)'
        for match in re.finditer(hours_pattern, text, re.IGNORECASE):
            duration_value = match.group(1)
            if duration_value.isdigit():
                duration_hours = int(duration_value)
            else:
                duration_hours = word_to_number.get(duration_value.lower())
            if duration_hours:
                all_matches.append((match.end(), duration_hours * 60, "takes hours"))
        
        # Pattern 3: "takes X minutes", "will take X minutes"
        minutes_pattern = r'(?:it\s+|that\s+)?(?:will\s+)?takes?\s+(?:me\s+)?(\d+)\s+(minutes?|minute)'
        for match in re.finditer(minutes_pattern, text, re.IGNORECASE):
            duration_minutes = int(match.group(1))
            all_matches.append((match.end(), duration_minutes, "takes minutes"))
        
        # Return the LAST match (closest to end of text, most specific to this task)
        if all_matches:
            # Sort by position (end of match) and take the last one
            all_matches.sort(key=lambda x: x[0])
            last_match_pos, duration_minutes, pattern_type = all_matches[-1]
            logger.info(f"    ✓ Extracted duration {duration_minutes} min from '{pattern_type}' pattern (last match at position {last_match_pos}): '{text[:80]}'")
            return duration_minutes
        
        return None
    
    # Build segment map for easy lookup
    segment_map = {seg.get('i', -1): seg.get('text', '') for seg in segments}
    
    # Extract durations for tasks - Check source_text FIRST (it has original text), then title
    # source_text usually contains the original transcript text with durations, while title may be cleaned
    for task in final_tasks:
        title = task.get("title", "")
        source_text = task.get("source_text", "")
        seg_idx = task.get("segment_index", -1)
        existing_duration = task.get("duration_minutes")
        
        # First priority: Extract from source_text (original transcript text, likely has durations)
        # source_text should contain the original text like "go to the gym for 4 hours"
        if source_text:
            # Extract duration from source_text, but find the one closest to the title
            # (If multiple durations exist, pick the first one that has title words before it)
            title_lower = title.lower() if title else ""
            source_lower = source_text.lower()
            title_words = set(word for word in title_lower.split() if len(word) > 2)  # Get meaningful words
            
            # Find ALL duration matches
            word_to_number = {
                "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
                "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10
            }
            all_duration_matches = []
            
            # Pattern 1: "for X hours" / "for X minutes"
            for_pattern_hours = r'for\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(hours?|hour)'
            for match in re.finditer(for_pattern_hours, source_lower):
                duration_value = match.group(1)
                if duration_value.isdigit():
                    duration_hours = int(duration_value)
                else:
                    duration_hours = word_to_number.get(duration_value.lower())
                if duration_hours:
                    all_duration_matches.append((match.start(), match.end(), duration_hours * 60, "for hours"))
            
            for_pattern_minutes = r'for\s+(\d+)\s+(minutes?|minute)'
            for match in re.finditer(for_pattern_minutes, source_lower):
                duration_minutes = int(match.group(1))
                all_duration_matches.append((match.start(), match.end(), duration_minutes, "for minutes"))
            
            # Pattern 2: "It takes X hours", "takes X hours", "It will take X hours", "That will take X hours", "will take X hours"
            hours_pattern = r'(?:it\s+|that\s+)?(?:will\s+)?takes?\s+(?:me\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(hours?|hour)'
            for match in re.finditer(hours_pattern, source_lower):
                duration_value = match.group(1)
                if duration_value.isdigit():
                    duration_hours = int(duration_value)
                else:
                    duration_hours = word_to_number.get(duration_value.lower())
                if duration_hours:
                    all_duration_matches.append((match.start(), match.end(), duration_hours * 60, "takes hours"))
            
            # Pattern 3: "takes X minutes", "will take X minutes"
            minutes_pattern = r'(?:it\s+|that\s+)?(?:will\s+)?takes?\s+(?:me\s+)?(\d+)\s+(minutes?|minute)'
            for match in re.finditer(minutes_pattern, source_lower):
                duration_minutes = int(match.group(1))
                all_duration_matches.append((match.start(), match.end(), duration_minutes, "takes minutes"))
            
            # Now find the duration that has title words CLOSE BEFORE it (most relevant to this task)
            duration = None
            if all_duration_matches and title_words:
                # Sort by position (start of match)
                all_duration_matches.sort(key=lambda x: x[0])
                # Try each duration match - use the FIRST one that has title words close before it
                for match_start, match_end, duration_minutes, pattern_type in all_duration_matches:
                    # Check if this duration pattern starts with a reference word ("That", "It")
                    # If so, we can be more lenient because reference words indicate this duration belongs to the previous task
                    # Check the text at the match start position to see if it starts with "that" or "it"
                    text_at_match = source_lower[max(0, match_start - 5):match_start + 20]
                    is_reference_pattern = bool(re.search(r'\b(that|it)\s+(?:will\s+)?takes?\s', text_at_match, re.IGNORECASE))
                    
                    # Check a window of text immediately before the duration (max 150 chars for reference patterns, 80 otherwise)
                    # Reference patterns like "That takes" or "It takes" refer back to the previous task, so we need a larger window
                    window_size = 150 if is_reference_pattern else 80
                    window_start = max(0, match_start - window_size)
                    text_window = source_lower[window_start:match_start]
                    
                    # Check if title words appear in this window before the duration
                    found_title_word = any(word in text_window for word in title_words if len(word) > 2)
                    
                    # If it's a reference pattern ("That takes", "It takes"), accept it if title words are found in the larger window
                    # Reference patterns are safer because they explicitly refer to the previous statement
                    if found_title_word:
                        duration = duration_minutes
                        reason = "reference pattern with title words" if is_reference_pattern else "title words found in window"
                        logger.info(f"    ✓ Found duration {duration} min from '{pattern_type}' pattern ({reason} before duration at position {match_start}): '{source_text[:80]}'")
                        break
                # If no match found with title words in window or reference pattern, DON'T use any duration
                # (This prevents matching durations from other tasks in the same segment)
                if duration is None:
                    logger.info(f"    ⚠ No duration match found with title words in window for '{title[:40]}' - skipping duration extraction (source_text: '{source_text[:100]}')")
            elif all_duration_matches:
                # No title words to validate - this is risky, but if title is very short we might not have meaningful words
                # Only use duration if there's exactly ONE match (less ambiguity)
                if len(all_duration_matches) == 1:
                    match_start, match_end, duration_minutes, pattern_type = all_duration_matches[0]
                    duration = duration_minutes
                    logger.info(f"    ⚠ Extracted duration {duration} min from '{pattern_type}' pattern (single match, no title words to validate): '{source_text[:80]}'")
                else:
                    logger.info(f"    ⚠ Multiple duration matches found ({len(all_duration_matches)}) but no title words to validate - skipping duration extraction for '{title[:40]}'")
            else:
                # Fallback to old function if no matches found (shouldn't happen, but just in case)
                duration = extract_duration_from_text(source_text)
            
            if duration:
                task["duration_minutes"] = duration
                if existing_duration and existing_duration != duration:
                    logger.info(f"    ↻ Overrode duration {existing_duration} with {duration} from source_text: '{source_text[:80]}'")
                elif not existing_duration:
                    logger.info(f"    ✓ Extracted duration {duration} min from source_text: '{source_text[:80]}'")
                continue
        
        # Second priority: Extract from title if source_text didn't have it (title might still have duration if LLM didn't clean it)
        if title and existing_duration is None:
            duration = extract_duration_from_text(title)
            if duration:
                task["duration_minutes"] = duration
                logger.info(f"    ✓ Extracted duration {duration} min from title: '{title[:80]}'")
                continue
        
        # Third priority: Check the original segment text if we still don't have a duration
        # BUT: Only if this is the only task in the segment, to avoid extracting wrong durations
        # when multiple tasks share the same segment (e.g., "watch movie for 3h, walk for 1h")
        # The segment text has the original transcript text, which should have durations
        # This is a fallback if source_text didn't have a duration (maybe LLM cleaned it)
        if task.get("duration_minutes") is None and seg_idx in segment_map:
            # Count how many tasks are in this segment
            tasks_in_segment = [t for t in final_tasks if t.get("segment_index") == seg_idx]
            # Only check segment text if there's only one task (to avoid wrong matches)
            if len(tasks_in_segment) == 1:
                seg_text = segment_map[seg_idx]
                duration = extract_duration_from_text(seg_text)
                if duration:
                    task["duration_minutes"] = duration
                    logger.info(f"    ✓ Extracted duration {duration} min from segment text (single task in segment): '{seg_text[:80]}'")
                    continue
            else:
                logger.info(f"    ⚠ Skipping segment text check for task '{title[:40]}' because {len(tasks_in_segment)} tasks share segment {seg_idx}")
        
        # Fourth priority: Check adjacent segments only if we still don't have a duration
        # This handles cases like: segment N="have lunch with my parents." segment N+1="It takes three hours..."
        if task.get("duration_minutes") is None:
            next_seg_idx = seg_idx + 1
            max_lookahead = 2  # Check up to 2 segments ahead
            
            for lookahead in range(1, max_lookahead + 1):
                check_seg_idx = seg_idx + lookahead
                if check_seg_idx in segment_map:
                    next_seg_text = segment_map[check_seg_idx]
                    # Check if this looks like a duration phrase (starts with "It takes", "takes", "That takes", "will take", etc.)
                    duration_match = re.search(r'^(?:it\s+|that\s+)?(?:will\s+)?takes?\s+', next_seg_text.strip(), re.IGNORECASE)
                    if duration_match:
                        duration = extract_duration_from_text(next_seg_text)
                        if duration:
                            task["duration_minutes"] = duration
                            logger.info(f"    ✓ Extracted duration {duration} min from adjacent segment {check_seg_idx}: '{next_seg_text[:80]}'")
                            break
    
    # Log summary of duration extraction
    tasks_with_durations = [t for t in final_tasks if t.get("duration_minutes") is not None]
    logger.info(f"\n  Duration Extraction Summary: {len(tasks_with_durations)}/{len(final_tasks)} tasks have durations")
    for i, task in enumerate(final_tasks):
        title = task.get("title", "")
        source_text = task.get("source_text", "")
        duration = task.get("duration_minutes")
        seg_idx = task.get("segment_index", -1)
        order = task.get("order_in_segment", -1)
        if duration:
            logger.info(f"    ✓ Task {i+1} (seg={seg_idx}, order={order}): '{title[:50]}' | source_text='{source_text[:100]}' → {duration} min")
        else:
            logger.info(f"    ✗ Task {i+1} (seg={seg_idx}, order={order}): '{title[:50]}' | source_text='{source_text[:100]}' → no duration (will use default 30 min)")
    
    # Step 4.7: Remove duration phrases from titles (safety net if LLM didn't clean them)
    logger.info("\n  Removing Duration Phrases from Titles:")
    def remove_duration_from_title(title: str) -> str:
        """Remove duration phrases from title if present."""
        if not title:
            return title
        
        # Remove "for X hours/minutes" patterns
        title = re.sub(r'\s+for\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(hours?|hour|minutes?|minute)', '', title, flags=re.IGNORECASE)
        
        # Remove "takes X hours/minutes" patterns (less common in titles but possible)
        title = re.sub(r'\s+takes\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(hours?|hour|minutes?|minute)', '', title, flags=re.IGNORECASE)
        
        return title.strip()
    
    for task in final_tasks:
        if task.get("title"):
            original_title = task.get("title")
            cleaned_title = remove_duration_from_title(original_title)
            if cleaned_title != original_title:
                task["title"] = cleaned_title
                logger.info(f"    ✓ Removed duration phrase from title: '{original_title[:80]}' → '{cleaned_title[:80]}'")
    
    # Step 5: Normalize and validate
    logger.info("\n  Normalization and Validation:")
    validated_tasks = []
    dropped_tasks = []
    for task in final_tasks:
        title = task.get("title", "")
        task_duration = task.get("duration_minutes")
        
        # CRITICAL FIX: Never drop tasks with duration_minutes, even if title is empty
        if not title:
            if task_duration is not None:
                # Task has duration but missing title - reconstruct from source_text
                title = task.get("source_text", "") or f"Task with duration {task_duration} minutes"
                task["title"] = title
                logger.warning(f"    ⚠️  Task had empty title but has duration_minutes={task_duration}, using reconstructed title: '{title[:60]}'")
            else:
                dropped_tasks.append({"task": task, "reason": "Empty title"})
                logger.warning(f"    ✗ Dropped: Empty title")
            continue
        
        # Normalize title
        normalized = normalize_title(title)
        
        # Safety check: Extract duration from normalized title if we still don't have one
        # (in case normalization changed something or we missed it earlier)
        if task_duration is None:
            def extract_duration_simple(text: str) -> Optional[int]:
                """Quick duration extraction for normalized titles."""
                if not text:
                    return None
                word_to_number = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
                # Pattern: "for X hours"
                match = re.search(r'for\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(hours?|hour)', text, re.IGNORECASE)
                if match:
                    val = match.group(1)
                    hours = int(val) if val.isdigit() else word_to_number.get(val.lower())
                    return hours * 60 if hours else None
                # Pattern: "for X minutes"
                match = re.search(r'for\s+(\d+)\s+(minutes?|minute)', text, re.IGNORECASE)
                if match:
                    return int(match.group(1))
                return None
            
            duration_from_normalized = extract_duration_simple(normalized)
            if duration_from_normalized:
                task_duration = duration_from_normalized
                task["duration_minutes"] = task_duration
                logger.info(f"    ✓ Extracted duration {task_duration} min from normalized title: '{normalized[:60]}'")
        
        if not normalized:
            # CRITICAL FIX: Never drop tasks with duration_minutes, even if normalization fails
            if task_duration is not None:
                # Task has duration but normalization failed - use original title or source_text
                normalized = title or task.get("source_text", "") or f"Task with duration {task_duration} minutes"
                logger.warning(f"    ⚠️  Normalization failed but task has duration_minutes={task_duration}, using: '{normalized[:60]}'")
            else:
                dropped_tasks.append({"task": task, "reason": "Normalization resulted in empty string"})
                logger.warning(f"    ✗ Dropped: Normalization resulted in empty - original: '{title[:60]}'")
            continue
        
        task["title"] = normalized
        
        # Validate
        is_valid, error_msg = validate_task(task)
        if not is_valid:
            # Check if this is a borderline case - if it has action verbs in the original text, be more lenient
            original_title = task.get("title", "") or title
            original_lower = original_title.lower()
            action_indicators = ['call', 'write', 'work', 'go', 'do', 'have', 'eat', 'message', 'email', 'text']
            has_action_indicator = any(indicator in original_lower for indicator in action_indicators)
            
            # CRITICAL FIX: Never drop tasks with duration_minutes, even if validation fails
            if task_duration is not None:
                # Task has duration - always keep it, even if validation fails
                logger.warning(f"    ⚠️  Validation failed but task has duration_minutes={task_duration}, keeping: '{normalized[:60]}'")
                validated_tasks.append(task)
            elif has_action_indicator and len(normalized) >= 6 and len(normalized.split()) >= 2:
                # Borderline case - has action indicators and meets basic requirements
                # Log warning but keep it
                logger.warning(f"    ⚠️  Borderline (keeping): {error_msg} - '{normalized[:60]}' (has action indicators)")
                validated_tasks.append(task)
            else:
                dropped_tasks.append({"task": task, "reason": error_msg})
                logger.warning(f"    ✗ Dropped: {error_msg} - '{normalized[:60]}'")
                continue
        else:
            logger.info(f"    ✓ Valid: '{normalized[:60]}'")
        validated_tasks.append(task)
    
    if dropped_tasks:
        logger.warning(f"\n  Dropped {len(dropped_tasks)} tasks during validation:")
        for dropped in dropped_tasks:
            logger.warning(f"    - {dropped['reason']}: '{dropped['task'].get('title', 'N/A')[:60]}'")
    
    # Step 6: Deduplicate (case-insensitive exact title matching only - be conservative)
    logger.info("\n  Deduplication:")
    seen_titles = {}
    deduplicated_tasks = []
    for task in validated_tasks:
        title_lower = task.get("title", "").lower().strip()
        if not title_lower:
            continue
        
        # Use exact title match only (no article removal, no fuzzy matching)
        # This is more conservative to avoid removing valid distinct tasks
        title_key = title_lower
        
        if title_key not in seen_titles:
            seen_titles[title_key] = task
            deduplicated_tasks.append(task)
            logger.info(f"    ✓ Kept: '{task.get('title')[:60]}'")
        else:
            # Only merge if titles are EXACTLY the same (case-insensitive)
            existing = seen_titles[title_key]
            if task.get("duration_minutes") and not existing.get("duration_minutes"):
                # Replace existing with task that has duration
                deduplicated_tasks.remove(existing)
                deduplicated_tasks.append(task)
                seen_titles[title_key] = task
                logger.info(f"    ↻ Replaced (has duration): '{task.get('title')[:60]}'")
            elif task.get("notes") and not existing.get("notes"):
                # Replace existing with task that has notes
                deduplicated_tasks.remove(existing)
                deduplicated_tasks.append(task)
                seen_titles[title_key] = task
                logger.info(f"    ↻ Replaced (has notes): '{task.get('title')[:60]}'")
            else:
                logger.info(f"    ✗ Dropped duplicate: '{task.get('title')[:60]}' (exact match with existing)")
    
    # Step 7: Sort by segment_index, then order_in_segment (preserve spoken order)
    deduplicated_tasks.sort(key=lambda t: (
        t.get("segment_index", 0),
        t.get("order_in_segment", 0)
    ))
    
    # Log exit
    logger.info("=" * 80)
    logger.info("POSTPROCESSING DEBUG - EXIT")
    logger.info("=" * 80)
    logger.info(f"Output tasks: {len(deduplicated_tasks)}")
    logger.info(f"Items lost: {len(items)} -> {len(deduplicated_tasks)} (lost {len(items) - len(deduplicated_tasks)})")
    for i, task in enumerate(deduplicated_tasks):
        logger.info(f"  Final {i}: segment={task.get('segment_index')}, order={task.get('order_in_segment')}, title=\"{task.get('title', 'N/A')[:80]}\"")
    logger.info("=" * 80)
    
    return deduplicated_tasks


# Helper function to get AI response
async def get_ai_response(transcript: str, provider: str, model: str) -> dict:
    """
    Extract tasks from transcript using AI with strict JSON schema.
    Includes preprocessing and post-processing validation.
    
    Returns tasks in the format expected by the frontend.
    """
    # Import task extraction utilities
    try:
        from task_extraction import preprocess_transcript, postprocess_tasks
    except ImportError:
        # Fallback if import fails (shouldn't happen in normal operation)
        import sys
        from pathlib import Path
        backend_dir = Path(__file__).parent
        sys.path.insert(0, str(backend_dir))
        from task_extraction import preprocess_transcript, postprocess_tasks
    
    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")
    
    # Preprocess transcript to improve extraction
    preprocessed = preprocess_transcript(transcript)
    logger.info(f"Preprocessed transcript: '{transcript[:100]}...' -> '{preprocessed[:100]}...'")
    
    system_message = """You are a task extraction AI. Extract ALL actionable tasks from the user's input.

CRITICAL RULES:
1. NEVER output single-word tasks (e.g., "Tom", "Police", "Website" are INVALID)
2. Every task title MUST be an actionable phrase with a verb + object (e.g., "Reply to Tom", "Go to the police", "Work on a website")
3. Title must be 3-80 characters, contain at least 2 words, and start with an action verb when possible
4. Preserve proper nouns exactly (Tom, Oliver, project names)
5. Split multi-action sentences into separate tasks when you see: "then", "and then", "later", "after that", commas, or repeated action phrases

TITLE RULES:
- Must start with a verb in base form when possible: Go, Call, Reply, Send, Work, Review, Book, Pay, Buy, Schedule, Get, Meet, Visit
- If transcript says "get back to X", normalize to "Reply to X" or "Get back to X" (be consistent)
- If transcript says "work on X for two hours", set duration_minutes=120 and title="Work on X"
- Minimum 2 words, minimum 6 characters
- Must be actionable (verb + object)

TIME CUES:
- "today" → due_text: "today" (do NOT convert to date, keep as text)
- "tomorrow" → due_text: "tomorrow"
- "next week" → due_text: "next week"
- Store in due_text field, not due_date

DURATION:
- "for 2 hours" or "for two hours" → duration_minutes: 120
- "for 30 minutes" → duration_minutes: 30
- "for X hours" → duration_minutes: X * 60
- "for X minutes" → duration_minutes: X

SEPARATION INDICATORS (split into separate tasks):
- "then", "and then", "later", "after that" → separate tasks
- Commas separating distinct actions → separate tasks
- Repeated action phrases (e.g., "get back to Tom, get back to Oliver") → separate tasks

AVOID:
- Do NOT create tasks from filler words: "I think", "you know", "basically", "it was good at..."
- Do NOT invent tasks not clearly implied
- Do NOT output single words or fragments

Respond ONLY with a JSON object in this exact format (no markdown, no code blocks):
{
  "tasks": [
    {
      "title": "string (3-80 chars, min 2 words, actionable)",
      "notes": "string or null",
      "due_text": "today | tomorrow | next week | null",
      "duration_minutes": number or null,
      "source_text": "exact phrase from transcript",
      "confidence": 0.0-1.0
    }
  ]
}

If no valid tasks can be extracted, return {"tasks": [], "summary": "No tasks found"}

IMPORTANT: Return ONLY valid JSON. Every task title must be actionable (verb + object), never a single word."""
    
    # Map provider/model to OpenAI model
    openai_model = get_model_for_provider(provider, model)
    
    user_prompt = f"""Extract ALL actionable tasks from this transcript. 

Example: "Go to the police today, then I need to get back to Tom, get back to Oliver and work on a website for two hours."
Expected: 4 tasks:
1. {{"title": "Go to the police", "due_text": "today", "source_text": "Go to the police today"}}
2. {{"title": "Get back to Tom", "source_text": "get back to Tom"}}
3. {{"title": "Get back to Oliver", "source_text": "get back to Oliver"}}
4. {{"title": "Work on a website", "duration_minutes": 120, "source_text": "work on a website for two hours"}}

Transcript: {preprocessed}

CRITICAL: 
- Count distinct actions first
- Each task must have a verb + object (never single words)
- Split on "then", "and then", commas, repeated phrases
- Include source_text showing the exact phrase you extracted"""
    
    try:
        # Get response from AI with strict JSON
        # Very low temperature for more consistent and complete extraction
        raw_result = await generate_json(
            system_prompt=system_message,
            user_prompt=user_prompt,
            model=openai_model,
            temperature=0.1  # Very low temperature for deterministic, complete task extraction
        )
        
        logger.info(f"🔍 DIAGNOSTIC: Raw AI response (OpenAI JSON): {json.dumps(raw_result, indent=2)}")
        logger.info(f"🔍 DIAGNOSTIC: Number of tasks in raw AI response: {len(raw_result.get('tasks', []))}")
        logger.info(f"🔍 DIAGNOSTIC: Raw response type: {type(raw_result)}")
        logger.info(f"🔍 DIAGNOSTIC: Raw response keys: {raw_result.keys() if isinstance(raw_result, dict) else 'Not a dict'}")
        
        # Validate and transform tasks
        if not isinstance(raw_result, dict):
            logger.error(f"AI response is not a dict: {type(raw_result)}")
            raise HTTPException(
                status_code=500, 
                detail="AI returned invalid response format"
            )
        
        tasks = raw_result.get("tasks", [])
        if not isinstance(tasks, list):
            logger.error(f"Tasks field is not a list: {type(tasks)}")
            raise HTTPException(
                status_code=500,
                detail="AI returned invalid tasks format"
            )
        
        logger.info(f"Extracted {len(tasks)} tasks from AI response (raw)")
        
        if len(tasks) == 0:
            logger.warning(f"No tasks extracted from transcript: {transcript[:200]}")
            return {
                "tasks": [],
                "summary": raw_result.get("summary", "No tasks found in transcript")
            }
        
        # Post-process: validate, filter, and deduplicate
        postprocessed = postprocess_tasks(tasks, transcript)
        validated_tasks = postprocessed["tasks"]
        dropped_tasks = postprocessed["dropped"]
        
        logger.info(f"Post-processing: {postprocessed['raw_count']} raw -> {postprocessed['final_count']} valid tasks")
        if dropped_tasks:
            logger.warning(f"Dropped {len(dropped_tasks)} invalid tasks: {[d['reason'] for d in dropped_tasks]}")
            # Log raw model response for debugging if validation failed
            if ENV == 'development':
                logger.error("=" * 80)
                logger.error("VALIDATION FAILED - Raw model output:")
                logger.error(json.dumps(raw_result, indent=2))
                logger.error("=" * 80)
        
        if len(validated_tasks) == 0:
            # Try once more with a stricter prompt if all tasks were dropped
            logger.warning("All tasks failed validation, attempting retry with stricter prompt...")
            retry_prompt = f"""Extract tasks from: {preprocessed}

STRICT RULES:
- Every task MUST have a verb + object (e.g., "Go to X", "Call Y", "Work on Z")
- NEVER output single words
- Split on: "then", "and then", commas, repeated phrases
- Title: 3-80 chars, min 2 words, must be actionable

Return JSON with tasks array. Each task must have: title (actionable phrase), source_text, due_text (if mentioned), duration_minutes (if mentioned)."""
            
            try:
                retry_result = await generate_json(
                    system_prompt=system_message + "\n\nRETRY MODE: Be extra strict. Only extract clearly actionable tasks with verbs.",
                    user_prompt=retry_prompt,
                    model=openai_model,
                    temperature=0.0  # Even lower temperature for retry
                )
                retry_tasks = retry_result.get("tasks", [])
                if retry_tasks:
                    postprocessed_retry = postprocess_tasks(retry_tasks, transcript)
                    validated_tasks = postprocessed_retry["tasks"]
                    logger.info(f"Retry extracted {len(validated_tasks)} valid tasks")
            except Exception as e:
                logger.error(f"Retry failed: {e}")
        
        if len(validated_tasks) == 0:
            logger.error(f"No valid tasks after validation. Dropped: {len(dropped_tasks)}")
            return {
                "tasks": [],
                "summary": "No valid tasks could be extracted. Please ensure each task is an actionable phrase (verb + object).",
                "_error": "All extracted tasks failed validation",
                "_debug": {
                    "raw_count": postprocessed['raw_count'],
                    "dropped": dropped_tasks,
                    "raw_response": raw_result if ENV == 'development' else None
                }
            }
        
        # Transform each validated task to frontend format
        transformed_tasks = []
        for i, task_data in enumerate(validated_tasks):
            try:
                logger.info(f"Transforming validated task {i+1}: {json.dumps(task_data, indent=2)}")
                transformed = transform_task_to_frontend_format(task_data)
                transformed_tasks.append(transformed)
                logger.info(f"Successfully transformed task {i+1}: {transformed.get('title', 'Untitled')} (duration: {transformed.get('duration', 'N/A')}, priority: {transformed.get('priority', 'N/A')})")
            except Exception as e:
                logger.error(f"Error transforming task {i} {json.dumps(task_data)}: {e}", exc_info=True)
                continue
        
        logger.info(f"🔍 DIAGNOSTIC: Successfully transformed {len(transformed_tasks)} out of {len(tasks)} tasks")
        logger.info(f"🔍 DIAGNOSTIC: Transformed tasks details: {json.dumps([{'title': t.get('title'), 'duration': t.get('duration'), 'priority': t.get('priority')} for t in transformed_tasks], indent=2)}")
        
        if len(transformed_tasks) == 0:
            logger.error(f"🔍 DIAGNOSTIC: All tasks failed to transform! Original tasks: {json.dumps(tasks, indent=2)}")
            raise HTTPException(
                status_code=500,
                detail="Failed to transform any tasks. Please try again or rephrase your input."
            )
        
        result = {
            "tasks": transformed_tasks,
            "summary": raw_result.get("summary", "Tasks extracted")
        }
        logger.info(f"🔍 DIAGNOSTIC: Returning from get_ai_response: {len(result['tasks'])} tasks")
        return result
        
    except json.JSONDecodeError as e:
        logger.error(f"JSON parsing failed in get_ai_response: {str(e)}")
        raise HTTPException(
            status_code=400,
            detail="Failed to parse AI response as JSON. Please try again or rephrase your input."
        )
    except ValueError as e:
        logger.error(f"Value error in get_ai_response: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to get AI response: {str(e)}")
        # Check for rate limit / quota errors
        error_str = str(e).lower()
        if any(keyword in error_str for keyword in ["rate", "limit", "quota", "insufficient", "billing", "payment"]):
            raise HTTPException(
                status_code=429,
                detail="QUOTA_EXCEEDED: Your OpenAI API quota has been exceeded. Please add credits to your OpenAI account at https://platform.openai.com/account/billing"
            )
        raise HTTPException(status_code=500, detail=f"AI processing failed: {str(e)}")

# Routes
@api_router.get("/")
async def root():
    return {"message": "Task Sorter API"}

@api_router.get("/health")
async def health():
    return {"status": "healthy"}

# ============ AUTH ROUTES ============
@api_router.post("/auth/signup", response_model=AuthResponse)
async def signup(user_data: UserSignup):
    """Register a new user with email and password"""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Check if user exists
        existing = await conn.fetchrow("SELECT id FROM users WHERE email = $1", user_data.email.lower())
        if existing:
            raise HTTPException(status_code=400, detail="Email already registered")
        
        # Create user
        user_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc)
        await conn.execute(
            """INSERT INTO users (id, email, name, hashed_password, created_at) 
               VALUES ($1, $2, $3, $4, $5)""",
            user_id, user_data.email.lower(), user_data.name, hash_password(user_data.password), created_at
        )
    
    # Generate token
    token = create_jwt_token(user_id, user_data.email.lower())
    
    return AuthResponse(
        token=token,
        user={"id": user_id, "email": user_data.email.lower(), "name": user_data.name, "avatar_url": None}
    )

@api_router.post("/auth/login", response_model=AuthResponse)
async def login(credentials: UserLogin):
    """Login with email and password"""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id, email, name, hashed_password, avatar_url FROM users WHERE email = $1",
            credentials.email.lower()
        )
    
    if not user or not user["hashed_password"]:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if not verify_password(credentials.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    token = create_jwt_token(user["id"], user["email"])
    
    return AuthResponse(
        token=token,
        user={"id": user["id"], "email": user["email"], "name": user["name"] or "", "avatar_url": user["avatar_url"]}
    )

@api_router.get("/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    """Get current authenticated user"""
    return user

@api_router.get("/auth/google/url")
async def get_google_auth_url(redirect_uri: Optional[str] = None):
    """Get Google OAuth URL for login"""
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google OAuth not configured")
    
    # Use provided redirect_uri or default
    callback_uri = redirect_uri or GOOGLE_AUTH_REDIRECT_URI
    
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": callback_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "consent"
    }
    
    from urllib.parse import urlencode
    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    return {"url": auth_url}

@api_router.post("/auth/google", response_model=AuthResponse)
async def google_auth(auth_data: GoogleAuthRequest):
    """Exchange Google auth code for user token"""
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="Google OAuth not configured")
    
    # Use provided redirect_uri or default
    callback_uri = auth_data.redirect_uri or GOOGLE_AUTH_REDIRECT_URI
    
    # Exchange code for tokens
    token_response = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "code": auth_data.code,
            "grant_type": "authorization_code",
            "redirect_uri": callback_uri
        }
    )
    
    if token_response.status_code != 200:
        logger.error(f"Google token exchange failed: {token_response.text}")
        raise HTTPException(status_code=400, detail="Failed to authenticate with Google")
    
    tokens = token_response.json()
    access_token = tokens.get("access_token")
    
    # Get user info from Google
    user_info_response = requests.get(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        headers={"Authorization": f"Bearer {access_token}"}
    )
    
    if user_info_response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to get user info from Google")
    
    google_user = user_info_response.json()
    google_id = google_user.get("id")
    email = google_user.get("email", "").lower()
    name = google_user.get("name", "")
    avatar_url = google_user.get("picture")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Check if user exists by google_id or email
        existing_user = await conn.fetchrow(
            "SELECT id, email, name, avatar_url FROM users WHERE google_id = $1 OR email = $2",
            google_id, email
        )
        
        if existing_user:
            # Update Google info
            await conn.execute(
                "UPDATE users SET google_id = $1, avatar_url = COALESCE($2, avatar_url), name = COALESCE(NULLIF(name, ''), $3) WHERE id = $4",
                google_id, avatar_url, name, existing_user["id"]
            )
            user_id = existing_user["id"]
            user_email = existing_user["email"]
            user_name = existing_user["name"] or name
            user_avatar = avatar_url or existing_user["avatar_url"]
        else:
            # Create new user
            user_id = str(uuid.uuid4())
            created_at = datetime.now(timezone.utc)
            await conn.execute(
                """INSERT INTO users (id, email, name, google_id, avatar_url, created_at) 
                   VALUES ($1, $2, $3, $4, $5, $6)""",
                user_id, email, name, google_id, avatar_url, created_at
            )
            user_email = email
            user_name = name
            user_avatar = avatar_url
    
    # Generate JWT token
    token = create_jwt_token(user_id, user_email)
    
    return AuthResponse(
        token=token,
        user={"id": user_id, "email": user_email, "name": user_name, "avatar_url": user_avatar}
    )

# Task CRUD
@api_router.post("/tasks", response_model=Task)
async def create_task(task_input: TaskCreate, user: dict = Depends(get_current_user)):
    task = Task(**task_input.model_dump(), user_id=user["id"])
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Convert expires_at string to datetime if provided
        expires_at_value = None
        if task.expires_at:
            try:
                expires_at_value = datetime.fromisoformat(task.expires_at.replace('Z', '+00:00'))
            except (ValueError, AttributeError):
                expires_at_value = None
        
        await conn.execute(
            """INSERT INTO tasks (id, user_id, title, description, priority, urgency, importance, 
               scheduled_date, scheduled_time, duration, status, expires_at, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)""",
            task.id, user["id"], task.title, task.description, task.priority, task.urgency, task.importance,
            task.scheduled_date, task.scheduled_time, task.duration, task.status, expires_at_value, datetime.now(timezone.utc)
        )
    return task

@api_router.get("/tasks", response_model=List[Task])
async def get_tasks(status: Optional[str] = None, user: dict = Depends(get_current_user)):
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Check if energy_required column exists
        energy_required_exists = await conn.fetchval(
            """SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'energy_required')"""
        )
        
        # Build SELECT clause dynamically
        base_select = """id, user_id, title, description, priority, urgency, importance, 
                   scheduled_date::text, scheduled_time, duration, status, created_at::text"""
        energy_select = ", energy_required" if energy_required_exists else ""
        select_clause = base_select + energy_select
        
        if status:
            rows = await conn.fetch(
                f"""SELECT {select_clause}
                   FROM tasks WHERE user_id = $1 AND status = $2 ORDER BY priority DESC""",
                user["id"], status
            )
        else:
            rows = await conn.fetch(
                f"""SELECT {select_clause}
                   FROM tasks WHERE user_id = $1 ORDER BY priority DESC""",
                user["id"]
            )
    
    result = [dict(row) for row in rows]
    # Log if energy_required is in the response
    logger.info(f"[get_tasks] energy_required_exists: {energy_required_exists}, select_clause includes energy: {'energy_required' in select_clause}")
    if result:
        sample_task = result[0]
        logger.info(f"[get_tasks] Returning {len(result)} tasks, energy_required in response: {'energy_required' in sample_task}, sample keys: {list(sample_task.keys())}")
        if 'energy_required' in sample_task:
            logger.info(f"[get_tasks] Sample task energy_required value: {sample_task.get('energy_required')}")
    return result

@api_router.get("/tasks/{task_id}", response_model=Task)
async def get_task(task_id: str, user: dict = Depends(get_current_user)):
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Check if energy_required column exists
        energy_required_exists = await conn.fetchval(
            """SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'energy_required')"""
        )
        
        # Build SELECT clause dynamically
        base_select = """id, user_id, title, description, priority, urgency, importance, 
               scheduled_date::text, scheduled_time, duration, status, expires_at::text, created_at::text"""
        energy_select = ", energy_required" if energy_required_exists else ""
        select_clause = base_select + energy_select
        
        row = await conn.fetchrow(
            f"""SELECT {select_clause}
               FROM tasks WHERE id = $1 AND user_id = $2""",
            task_id, user["id"]
        )
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    return dict(row)

@api_router.patch("/tasks/{task_id}", response_model=Task)
async def update_task(task_id: str, task_update: TaskUpdate, user: dict = Depends(get_current_user)):
    update_data = {k: v for k, v in task_update.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No update data provided")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Check if energy_required column exists before filtering
        energy_required_exists = await conn.fetchval(
            """SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'energy_required')"""
        )
        
        # Build dynamic update query with proper parameterization
        # Only allow updating specific fields that exist in the database
        allowed_fields = {'title', 'description', 'priority', 'urgency', 'importance', 
                         'scheduled_date', 'scheduled_time', 'duration', 'status', 'expires_at', 'sort_order'}
        if energy_required_exists:
            allowed_fields.add('energy_required')
        
        logger.info(f"[update_task] energy_required_exists: {energy_required_exists}, update_data keys: {list(update_data.keys())}, allowed_fields: {sorted(allowed_fields)}")
        
        filtered_data = {k: v for k, v in update_data.items() if k in allowed_fields}
        
        if 'energy_required' in update_data and 'energy_required' not in filtered_data:
            logger.warning(f"[update_task] energy_required was in update_data but filtered out - column exists: {energy_required_exists}")
        
        if not filtered_data:
            raise HTTPException(status_code=400, detail="No valid fields to update")
        
        # Check current status before updating (to detect status changes)
        current_task = await conn.fetchrow("SELECT status FROM tasks WHERE id = $1 AND user_id = $2", task_id, user["id"])
        if not current_task:
            raise HTTPException(status_code=404, detail="Task not found or you don't have permission")
        
        current_status = current_task.get('status')
        new_status = filtered_data.get('status')
        
        # Enforce Next Today cap (1 task max) when changing status to 'next'
        if new_status == 'next' and current_status != 'next':
            next_count = await conn.fetchval(
                "SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND status = 'next'",
                user["id"]
            )
            NEXT_TODAY_CAP = 1
            if next_count >= NEXT_TODAY_CAP:
                raise HTTPException(
                    status_code=400,
                    detail=f"Next Today is full ({NEXT_TODAY_CAP}). Finish or move something out first."
                )
        
        # Check if status is being changed to 'completed' or from 'completed'
        status_changing_to_completed = new_status == 'completed' and current_status != 'completed'
        status_changing_from_completed = current_status == 'completed' and new_status and new_status != 'completed'
        
        set_clauses = []
        values = []
        param_num = 1
        for key, value in filtered_data.items():
            # Double-check that energy_required column exists if we're trying to update it
            if key == 'energy_required' and not energy_required_exists:
                logger.warning(f"Skipping update to energy_required - column does not exist")
                continue
            
            logger.info(f"[update_task] Adding SET clause: {key} = ${param_num} (value: {value}, type: {type(value).__name__})")
            set_clauses.append(f"{key} = ${param_num}")
            # Convert date strings to date objects for asyncpg
            if key == 'scheduled_date' and isinstance(value, str):
                try:
                    # Parse YYYY-MM-DD format string to date object
                    value = datetime.strptime(value, "%Y-%m-%d").date()
                except ValueError:
                    raise HTTPException(status_code=400, detail=f"Invalid date format for scheduled_date: {value}. Expected YYYY-MM-DD")
            values.append(value)
            param_num += 1
        
        # Set completed_at when marking as completed, clear it when uncompleting
        completed_at_exists = await conn.fetchval(
            """SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'completed_at')"""
        )
        
        if completed_at_exists:
            if status_changing_to_completed:
                set_clauses.append(f"completed_at = ${param_num}")
                values.append(datetime.now(timezone.utc))
                param_num += 1
            elif status_changing_from_completed:
                set_clauses.append(f"completed_at = ${param_num}")
                values.append(None)
                param_num += 1
        
        # Add task_id and user_id as final parameters
        where_clause = f"id = ${param_num} AND user_id = ${param_num + 1}"
        values.extend([task_id, user["id"]])
        
        # Check if sort_order column exists (completed_at already checked above)
        sort_order_exists = await conn.fetchval(
            """SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'sort_order')"""
        )
        # energy_required_exists already checked above
        
        # Build RETURNING clause dynamically
        base_returning = "id, user_id, title, description, priority, urgency, importance, scheduled_date::text, scheduled_time, duration, status, expires_at::text"
        completed_at_returning = ", completed_at::text" if completed_at_exists else ""
        sort_order_returning = ", sort_order" if sort_order_exists else ""
        energy_required_returning = ", energy_required" if energy_required_exists else ""
        created_at_returning = ", created_at::text"
        returning_clause = base_returning + completed_at_returning + sort_order_returning + energy_required_returning + created_at_returning
        
        # Use RETURNING to get updated row in a single query (much faster)
        query = f"""UPDATE tasks SET {', '.join(set_clauses)} 
                    WHERE {where_clause}
                    RETURNING {returning_clause}"""
        
        try:
            logger.info(f"Updating task {task_id} with {len(filtered_data)} fields: {list(filtered_data.keys())}")
            logger.info(f"  energy_required column exists: {energy_required_exists}")
            if 'energy_required' in filtered_data:
                logger.info(f"  energy_required value: {filtered_data.get('energy_required')}")
            if 'urgency' in filtered_data or 'importance' in filtered_data:
                logger.info(f"  Urgency: {filtered_data.get('urgency')}, Importance: {filtered_data.get('importance')}")
            row = await conn.fetchrow(query, *values)
            
            if not row:
                raise HTTPException(status_code=404, detail="Task not found or you don't have permission")
            
            # Verify the update actually persisted in the database
            if 'energy_required' in filtered_data:
                verify_row = await conn.fetchrow(
                    "SELECT energy_required FROM tasks WHERE id = $1 AND user_id = $2",
                    task_id, user["id"]
                )
                if verify_row:
                    logger.info(f"  [VERIFY] Database value after update: energy_required = {verify_row.get('energy_required')}")
                else:
                    logger.warning(f"  [VERIFY] Could not find task {task_id} to verify update")
            
            result = dict(row)
            logger.info(f"[update_task] Response data keys: {list(result.keys())}")
            if 'energy_required' in result:
                logger.info(f"[update_task] Response energy_required value: {result.get('energy_required')}")
            else:
                logger.warning(f"[update_task] energy_required NOT in response! Returning clause was: {returning_clause}")
            
            return result
        except HTTPException:
            raise
        except Exception as e:
            error_details = {
                "message": str(e),
                "type": type(e).__name__,
                "task_id": task_id,
                "user_id": user.get("id"),
                "query": query[:200] if len(query) > 200 else query,
            }
            logger.error(f"Error updating task {task_id}: {error_details}", exc_info=True)
            error_msg = f"Failed to update task: {str(e)}"
            if ENV == 'development':
                error_msg += f" (Type: {type(e).__name__})"
            raise HTTPException(status_code=500, detail=error_msg)

@api_router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, user: dict = Depends(get_current_user)):
    logger.info(f"Delete task request: task_id={task_id}, user_id={user.get('id')}")
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # First check if task exists
        task = await conn.fetchrow(
            "SELECT id, title, status FROM tasks WHERE id = $1 AND user_id = $2",
            task_id, user["id"]
        )
        if not task:
            logger.warning(f"Task not found for deletion: task_id={task_id}, user_id={user.get('id')}")
            raise HTTPException(status_code=404, detail="Task not found")
        
        # Delete the task
        result = await conn.execute("DELETE FROM tasks WHERE id = $1 AND user_id = $2", task_id, user["id"])
        logger.info(f"Task deleted: task_id={task_id}, title={task.get('title')}, result={result}")
    
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "Task deleted"}

# Metrics endpoints
@api_router.get("/metrics/done")
async def get_done_metrics(
    start: str = Query(..., description="Start date (ISO format: YYYY-MM-DD)"),
    end: str = Query(..., description="End date (ISO format: YYYY-MM-DD)"),
    user: dict = Depends(get_current_user)
):
    """
    Get count of completed tasks within a date range.
    Uses completed_at timestamp (single source of truth for "done").
    
    Migration SQL if completed_at doesn't exist:
    ```
    ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE NULL;
    CREATE INDEX IF NOT EXISTS idx_tasks_user_id_completed_at ON public.tasks(user_id, completed_at) WHERE completed_at IS NOT NULL;
    ```
    """
    # Auth guard
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Check if completed_at column exists
        completed_at_exists = await conn.fetchval(
            """SELECT EXISTS (
               SELECT 1 FROM information_schema.columns 
               WHERE table_schema = 'public' 
               AND table_name = 'tasks' 
               AND column_name = 'completed_at'
            )"""
        )
        
        if not completed_at_exists:
            # Return 0 count with error indicator (non-blocking)
            # Also log prominently so it's visible
            logger.error("❌ completed_at column does not exist! Run migration: backend/migrations/add_completed_at_column.sql")
            return {
                "count": 0,
                "_error": "completed_at column does not exist. Please run: python backend/run_completed_at_migration.py or run the SQL in backend/migrations/add_completed_at_column.sql"
            }
        
        try:
            # Parse ISO date strings to timestamps for range query
            # The frontend sends YYYY-MM-DD dates extracted from local timezone ISO strings
            # We need to interpret these as the full day in UTC to match completed_at (which is stored in UTC)
            # Strategy: Parse as UTC dates, but use a wider range to account for timezone differences
            # Since completed_at is stored in UTC, we query UTC ranges
            
            if 'T' in start:
                # Full ISO datetime string - parse as-is
                start_dt = datetime.fromisoformat(start.replace('Z', '+00:00'))
            else:
                # YYYY-MM-DD format - treat as start of day in UTC
                start_dt = datetime.strptime(start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            
            if 'T' in end:
                # Full ISO datetime string - parse as-is
                end_dt = datetime.fromisoformat(end.replace('Z', '+00:00'))
            else:
                # YYYY-MM-DD format - treat as end of day in UTC (23:59:59.999)
                end_dt = datetime.strptime(end, "%Y-%m-%d").replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=timezone.utc)
            
            # First, backfill completed_at for any completed tasks that don't have it set
            # Use created_at as the completion time for old tasks
            backfill_result = await conn.execute(
                """UPDATE tasks 
                   SET completed_at = created_at 
                   WHERE user_id = $1 
                   AND status = 'completed' 
                   AND completed_at IS NULL""",
                user["id"]
            )
            
            # Debug: Check what tasks exist
            all_completed_tasks = await conn.fetch(
                """SELECT id, title, status, completed_at, created_at 
                   FROM tasks 
                   WHERE user_id = $1 
                   AND status = 'completed'
                   ORDER BY created_at DESC
                   LIMIT 10""",
                user["id"]
            )
            
            # Query tasks with completed_at within range
            # Note: completed_at is stored in UTC, so we compare UTC to UTC
            count = await conn.fetchval(
                """SELECT COUNT(*) FROM tasks 
                   WHERE user_id = $1 
                   AND completed_at IS NOT NULL
                   AND completed_at >= $2 
                   AND completed_at <= $3""",
                user["id"], start_dt, end_dt
            )
            
            # Debug: Also check total completed tasks for this user (regardless of date)
            # Do this BEFORE the fallback check so we can use it there
            total_completed = await conn.fetchval(
                """SELECT COUNT(*) FROM tasks 
                   WHERE user_id = $1 
                   AND status = 'completed'""",
                user["id"]
            )
            
            # If count is 0 but we have completed tasks, check if this is a "today" query
            # and if so, use a more lenient query that includes tasks without completed_at
            # (fallback for old tasks or timezone edge cases)
            if count == 0 and total_completed > 0:
                # Check if the date range is roughly "today" (within last 2 days to account for timezone)
                now_utc = datetime.now(timezone.utc)
                days_diff_start = abs((start_dt - now_utc).days)
                days_diff_end = abs((end_dt - now_utc).days)
                
                # If the range is close to today, also count tasks with status='completed' 
                # that were created or updated recently (within the date range)
                if days_diff_start <= 1 and days_diff_end <= 1:
                    count_fallback = await conn.fetchval(
                        """SELECT COUNT(*) FROM tasks 
                           WHERE user_id = $1 
                           AND status = 'completed'
                           AND (
                               (completed_at IS NOT NULL AND completed_at >= $2 AND completed_at <= $3)
                               OR (completed_at IS NULL AND created_at >= $2 AND created_at <= $3)
                           )""",
                        user["id"], start_dt, end_dt
                    )
                    if count_fallback > 0:
                        logger.info(f"Using fallback count for 'today' range: {count_fallback}")
                        count = count_fallback
            
            # Debug: Check how many have completed_at set
            completed_with_timestamp = await conn.fetchval(
                """SELECT COUNT(*) FROM tasks 
                   WHERE user_id = $1 
                   AND status = 'completed'
                   AND completed_at IS NOT NULL""",
                user["id"]
            )
            
            # Debug: Check tasks in the date range
            tasks_in_range = await conn.fetch(
                """SELECT id, title, completed_at 
                   FROM tasks 
                   WHERE user_id = $1 
                   AND completed_at IS NOT NULL
                   AND completed_at >= $2 
                   AND completed_at <= $3""",
                user["id"], start_dt, end_dt
            )
            
            logger.info(f"Done metrics query: user={user['id']}, start={start_dt}, end={end_dt}, count={count}, total_completed={total_completed}, completed_with_timestamp={completed_with_timestamp}, backfill_result={backfill_result}")
            logger.info(f"All completed tasks sample: {[(t['id'], t['title'], str(t['completed_at']), str(t['created_at'])) for t in all_completed_tasks]}")
            logger.info(f"Tasks in range: {[(t['id'], t['title'], str(t['completed_at'])) for t in tasks_in_range]}")
            
            # Return debug info in development
            debug_info = {}
            if ENV == 'development':
                debug_info = {
                    "total_completed": total_completed,
                    "completed_with_timestamp": completed_with_timestamp,
                    "backfill_result": str(backfill_result),
                    "start_dt": str(start_dt),
                    "end_dt": str(end_dt),
                    "tasks_in_range_count": len(tasks_in_range),
                    "sample_tasks": [(t['id'], t['title'], str(t['completed_at'])) for t in tasks_in_range[:3]]
                }
            
            result = {"count": count or 0}
            if ENV == 'development' and debug_info:
                result["_debug"] = debug_info
            return result
        except Exception as e:
            error_details = {
                "message": str(e),
                "type": type(e).__name__,
                "user_id": user.get("id"),
                "start": start,
                "end": end,
            }
            logger.error(f"Error fetching done metrics: {error_details}", exc_info=True)
            # Return 0 with error indicator (non-blocking)
            return {
                "count": 0,
                "_error": f"Failed to fetch done metrics: {str(e)}"
            }

@api_router.get("/metrics/focus")
async def get_focus_metrics(
    start: str = Query(..., description="Start date (ISO format: YYYY-MM-DD)"),
    end: str = Query(..., description="End date (ISO format: YYYY-MM-DD)"),
    user: dict = Depends(get_current_user)
):
    """
    Get focus session count and total deep work minutes within a date range.
    Uses focus_sessions table (ended_at timestamp).
    """
    # Auth guard
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Check if focus_sessions table exists
        table_exists = await conn.fetchval(
            """SELECT EXISTS (
               SELECT 1 FROM information_schema.tables 
               WHERE table_schema = 'public' 
               AND table_name = 'focus_sessions'
            )"""
        )
        
        if not table_exists:
            # Return 0 values with error indicator (non-blocking)
            return {
                "count": 0,
                "totalMinutes": 0,
                "_error": "focus_sessions table does not exist. Please run migration to create it."
            }
        
        try:
            # Parse ISO date strings to timestamps
            start_dt = datetime.fromisoformat(start.replace('Z', '+00:00')) if 'T' in start else datetime.strptime(start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            end_dt = datetime.fromisoformat(end.replace('Z', '+00:00')) if 'T' in end else datetime.strptime(end, "%Y-%m-%d").replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=timezone.utc)
            
            # Query focus sessions within range (by ended_at)
            result = await conn.fetchrow(
                """SELECT COUNT(*) as count, COALESCE(SUM(duration_minutes), 0) as total_minutes
                   FROM focus_sessions 
                   WHERE user_id = $1 
                   AND ended_at >= $2 
                   AND ended_at <= $3""",
                user["id"], start_dt, end_dt
            )
            
            return {
                "count": result["count"] or 0,
                "totalMinutes": int(result["total_minutes"] or 0)
            }
        except Exception as e:
            error_details = {
                "message": str(e),
                "type": type(e).__name__,
                "user_id": user.get("id"),
            }
            logger.error(f"Error fetching focus metrics: {error_details}", exc_info=True)
            # Return 0 with error indicator (non-blocking)
            return {
                "count": 0,
                "totalMinutes": 0,
                "_error": f"Failed to fetch focus metrics: {str(e)}"
            }

@api_router.post("/focus-sessions")
async def create_focus_session(
    started_at: str = Form(...),
    ended_at: str = Form(...),
    duration_minutes: int = Form(...),
    user: dict = Depends(get_current_user)
):
    """
    Create a focus session record.
    Accepts FormData with started_at, ended_at, and duration_minutes.
    """
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Check if focus_sessions table exists
        table_exists = await conn.fetchval(
            """SELECT EXISTS (
               SELECT 1 FROM information_schema.tables 
               WHERE table_schema = 'public' 
               AND table_name = 'focus_sessions'
            )"""
        )
        
        if not table_exists:
            logger.warning("focus_sessions table does not exist. Please run migration.")
            # Return success but log warning (non-blocking)
            return {
                "id": None,
                "message": "Focus session logged (table not set up)",
                "_warning": "focus_sessions table does not exist"
            }
        
        try:
            # Parse ISO datetime strings
            started_dt = datetime.fromisoformat(started_at.replace('Z', '+00:00'))
            ended_dt = datetime.fromisoformat(ended_at.replace('Z', '+00:00'))
            
            # Generate UUID for the session
            session_id = str(uuid.uuid4())
            
            # Insert focus session
            await conn.execute(
                """INSERT INTO focus_sessions (id, user_id, started_at, ended_at, duration_minutes, created_at)
                   VALUES ($1, $2, $3, $4, $5, NOW())""",
                session_id, user["id"], started_dt, ended_dt, duration_minutes
            )
            
            logger.info(f"Focus session created: user={user['id']}, duration={duration_minutes} minutes")
            
            return {
                "id": session_id,
                "message": "Focus session saved"
            }
        except Exception as e:
            error_details = {
                "message": str(e),
                "type": type(e).__name__,
                "user_id": user.get("id"),
            }
            logger.error(f"Error creating focus session: {error_details}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Failed to save focus session: {str(e)}")

# User preferences endpoints
@api_router.get("/user/preferences")
async def get_user_preferences(user: dict = Depends(get_current_user)):
    """
    Get user's preferences (energy level, etc.).
    Creates default preferences if they don't exist.
    """
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Check if user_preferences table exists
        table_exists = await conn.fetchval(
            """SELECT EXISTS (
               SELECT 1 FROM information_schema.tables 
               WHERE table_schema = 'public' 
               AND table_name = 'user_preferences'
            )"""
        )
        
        if not table_exists:
            # Return default if table doesn't exist
            return {"energy_level": "medium"}
        
        # Get user preferences or create default
        prefs = await conn.fetchrow(
            "SELECT energy_level FROM user_preferences WHERE user_id = $1",
            user["id"]
        )
        
        if not prefs:
            # Create default preferences
            await conn.execute(
                """INSERT INTO user_preferences (user_id, energy_level, updated_at)
                   VALUES ($1, 'medium', NOW())
                   ON CONFLICT (user_id) DO NOTHING""",
                user["id"]
            )
            return {"energy_level": "medium"}
        
        return {"energy_level": prefs["energy_level"] or "medium"}

@api_router.post("/user/preferences")
async def update_user_preferences(
    req: Request,
    energy_level: Optional[str] = Form(None),
    user: dict = Depends(get_current_user)
):
    """
    Update user's preferences (energy level).
    Accepts both JSON body and FormData.
    """
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    # Handle both JSON body and FormData
    energy = None
    if energy_level:
        # FormData (from Form())
        energy = energy_level
    else:
        # Try to parse JSON body
        try:
            body = await req.json()
            if isinstance(body, dict):
                energy = body.get("energy_level")
        except:
            # Not JSON, try form data
            form_data = await req.form()
            if "energy_level" in form_data:
                energy = form_data["energy_level"]
    
    if not energy:
        raise HTTPException(status_code=400, detail="energy_level is required")
    
    # Validate energy level
    if energy not in ["low", "medium", "high"]:
        raise HTTPException(status_code=400, detail="energy_level must be 'low', 'medium', or 'high'")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Check if user_preferences table exists
        table_exists = await conn.fetchval(
            """SELECT EXISTS (
               SELECT 1 FROM information_schema.tables 
               WHERE table_schema = 'public' 
               AND table_name = 'user_preferences'
            )"""
        )
        
        if not table_exists:
            logger.warning("user_preferences table does not exist. Please run migration.")
            # Return success but log warning
            return {"energy_level": energy, "_warning": "Preferences table does not exist"}
        
        # Upsert user preferences
        await conn.execute(
            """INSERT INTO user_preferences (user_id, energy_level, updated_at)
               VALUES ($1, $2, NOW())
               ON CONFLICT (user_id) 
               DO UPDATE SET energy_level = $2, updated_at = NOW()""",
            user["id"], energy
        )
        
        return {"energy_level": energy}

# Batch update endpoint for sort_order
@api_router.post("/tasks/batch-update-sort-order")
async def batch_update_sort_order(
    request: dict,  # {updates: List[{task_id: str, sort_order: int}]}
    user: dict = Depends(get_current_user)
):
    """
    Batch update sort_order for multiple tasks.
    Used for drag-and-drop reordering.
    
    Migration SQL (run in Supabase - see backend/migrations/add_sort_order_column.sql):
    ```
    ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS sort_order INTEGER NULL;
    CREATE INDEX IF NOT EXISTS tasks_user_sort_order_idx ON public.tasks(user_id, sort_order) WHERE sort_order IS NOT NULL;
    ```
    """
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    updates = request.get("updates", [])
    if not updates:
        return {"success": True, "updated": 0}
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Check if sort_order column exists
        sort_order_exists = await conn.fetchval(
            """SELECT EXISTS (
               SELECT 1 FROM information_schema.columns 
               WHERE table_schema = 'public' 
               AND table_name = 'tasks' 
               AND column_name = 'sort_order'
            )"""
        )
        
        if not sort_order_exists:
            error_msg = "sort_order column does not exist. Please run migration: ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS sort_order INTEGER NULL;"
            logger.error(error_msg)
            raise HTTPException(status_code=500, detail=error_msg)
        
        try:
            async with conn.transaction():
                # Use a single batch update with CASE WHEN for efficiency
                task_ids = [str(update['task_id']) for update in updates]
                case_clauses = []
                params = []
                param_num = 1
                
                for update in updates:
                    task_id = str(update['task_id'])
                    sort_order = int(update['sort_order'])
                    case_clauses.append(f"WHEN ${param_num}::text THEN ${param_num + 1}::integer")
                    params.extend([task_id, sort_order])
                    param_num += 2
                
                # Build the query - only update tasks that belong to the current user
                query = f"""
                    UPDATE tasks 
                    SET sort_order = CASE id
                        {' '.join(case_clauses)}
                        ELSE sort_order
                    END
                    WHERE id = ANY(${param_num}::text[]) 
                    AND user_id = ${param_num + 1}::text
                """
                params.extend([task_ids, user["id"]])
                
                result = await conn.execute(query, *params)
                
                # Check if all tasks were updated
                updated_count = int(result.split()[-1])  # "UPDATE N" -> N
                
                if updated_count < len(updates):
                    logger.warning(f"Only {updated_count} of {len(updates)} tasks updated. Some tasks may not exist or belong to another user.")
                
                return {
                    "success": True,
                    "updated": updated_count,
                    "requested": len(updates)
                }
                
        except HTTPException:
            raise
        except Exception as e:
            error_details = {
                "message": str(e),
                "type": type(e).__name__,
                "user_id": user.get("id"),
                "update_count": len(updates),
            }
            logger.error(f"Error batch updating sort_order: {error_details}", exc_info=True)
            error_msg = f"Failed to update task order: {str(e)}"
            if ENV == 'development':
                error_msg += f" (Error type: {type(e).__name__})"
            raise HTTPException(status_code=500, detail=error_msg)

# Voice processing - Queue mode (returns tasks for review, doesn't save yet)
@api_router.post("/tasks/process-voice-queue")
async def process_voice_queue(voice_input: VoiceInput, user: dict = Depends(get_current_user)):
    """Process voice transcript and return tasks for review (not saved yet)"""
    try:
        logger.info(f"Processing voice input: transcript length={len(voice_input.transcript)}, provider={voice_input.provider}, model={voice_input.model}")
        logger.info(f"Transcript preview: {voice_input.transcript[:200]}")
        
        result = await get_ai_response(
            voice_input.transcript,
            voice_input.provider,
            voice_input.model
        )
        
        logger.info(f"AI response received: {len(result.get('tasks', []))} tasks found")
        logger.info(f"Result structure: {json.dumps(result, indent=2, default=str)}")
        
        if len(result.get("tasks", [])) == 0:
            logger.warning(f"No tasks extracted from transcript: {voice_input.transcript[:200]}")
            return {
                "success": False,
                "tasks": [],
                "summary": result.get("summary", "No tasks found in your input"),
                "error": "No tasks could be extracted from the transcript"
            }
        
        # get_ai_response already returns tasks in frontend format
        # Just add id and order fields for the queue
        tasks_for_review = []
        for i, task_data in enumerate(result.get("tasks", [])):
            logger.info(f"Processing task {i+1} for queue: {json.dumps(task_data, default=str)}")
            
            # Ensure duration is valid
            duration = task_data.get("duration", 30)
            if not isinstance(duration, (int, float)) or duration <= 0:
                logger.warning(f"Invalid duration for task {i+1}: {duration}, using default 30")
                duration = 30
            
            task = {
                "id": str(uuid.uuid4()),
                "title": task_data.get("title", "Untitled Task"),
                "description": task_data.get("description", ""),
                "urgency": task_data.get("urgency", 2),
                "importance": task_data.get("importance", 2),
                "priority": task_data.get("priority", 2),
                "duration": int(duration),
                "order": i,
            }
            tasks_for_review.append(task)
            logger.info(f"Added task {i+1} to queue: {task['title']} (duration: {task['duration']}, priority: {task['priority']})")
        
        # Sort by priority (highest first)
        tasks_for_review.sort(key=lambda t: t["priority"], reverse=True)
        
        logger.info(f"🔍 DIAGNOSTIC: Returning {len(tasks_for_review)} tasks for review from process_voice_queue")
        logger.info(f"🔍 DIAGNOSTIC: Tasks for review details: {json.dumps([{'title': t.get('title'), 'duration': t.get('duration'), 'priority': t.get('priority')} for t in tasks_for_review], indent=2)}")
        
        response = {
            "success": True,
            "tasks": tasks_for_review,
            "summary": result.get("summary", "Tasks extracted")
        }
        logger.info(f"🔍 DIAGNOSTIC: Final response from process_voice_queue: {len(response['tasks'])} tasks")
        return response
    except HTTPException:
        # Re-raise HTTP exceptions (already properly formatted)
        raise
    except Exception as e:
        logger.error(f"Error processing voice: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to process voice input: {str(e)}")


class PushToCalendarRequest(BaseModel):
    tasks: List[dict]


# Push tasks to inbox
@api_router.post("/tasks/push-to-inbox")
async def push_to_inbox(request: PushToCalendarRequest, user: dict = Depends(get_current_user)):
    """Save tasks to inbox (not scheduled)"""
    try:
        if not request.tasks:
            return {"success": True, "tasks": [], "message": "No tasks to add"}
        
        pool = await get_db_pool()
        created_at = datetime.now(timezone.utc)
        
        async with pool.acquire() as conn:
            # Use a transaction for atomicity
            async with conn.transaction():
                # Build batch insert using VALUES with multiple rows
                # This is much faster than individual INSERTs
                values_list = []
                params = []
                param_num = 1
                
                for task_data in request.tasks:
                    task_id = task_data.get("id", str(uuid.uuid4()))
                    values_list.append(
                        f"(${param_num}, ${param_num+1}, ${param_num+2}, ${param_num+3}, "
                        f"${param_num+4}, ${param_num+5}, ${param_num+6}, ${param_num+7}, "
                        f"${param_num+8}, ${param_num+9}, ${param_num+10}, ${param_num+11}, "
                        f"${param_num+12}, ${param_num+13})"
                    )
                    params.extend([
                        task_id,
                        user["id"],
                        task_data.get("title", "Untitled Task"),
                        task_data.get("description", ""),
                        task_data.get("priority", 2),
                        task_data.get("urgency", 2),
                        task_data.get("importance", 2),
                        task_data.get("energy_required", "medium"),  # energy_required
                        None,  # scheduled_date (NULL for inbox tasks)
                        None,  # scheduled_time (NULL for inbox tasks)
                        task_data.get("duration", 30),
                        "inbox",  # status
                        None,  # expires_at (NULL for inbox tasks)
                        created_at
                    ])
                    param_num += 14
                
                # Single batch INSERT with RETURNING - much faster!
                query = f"""
                    INSERT INTO tasks (id, user_id, title, description, priority, urgency, importance, energy_required,
                                     scheduled_date, scheduled_time, duration, status, expires_at, created_at)
                    VALUES {', '.join(values_list)}
                    RETURNING id, user_id, title, description, priority, urgency, importance, energy_required,
                              scheduled_date::text, scheduled_time, duration, status, expires_at::text, created_at::text
                """
                
                rows = await conn.fetch(query, *params)
                created_tasks = [dict(row) for row in rows]
        
        return {
            "success": True,
            "tasks": created_tasks,
            "message": f"{len(created_tasks)} tasks added to inbox"
        }
    except Exception as e:
        logger.error(f"Error pushing to inbox: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to push tasks to inbox: {str(e)}")


# Push tasks to calendar
@api_router.post("/tasks/push-to-calendar")
async def push_to_calendar(request: PushToCalendarRequest, user: dict = Depends(get_current_user)):
    """Save tasks and schedule them on calendar"""
    try:
        now = datetime.now(timezone.utc)
        today = now.strftime("%Y-%m-%d")
        
        # If it's after 10 PM (22:00), default to tomorrow instead of today
        if now.hour >= 22:
            tomorrow = (now + timedelta(days=1)).strftime("%Y-%m-%d")
            default_date = tomorrow
        else:
            default_date = today
        
        # Group tasks by date
        tasks_by_date = {}
        for task_data in request.tasks:
            date_str = task_data.get("scheduled_date") or default_date
            if date_str not in tasks_by_date:
                tasks_by_date[date_str] = []
            tasks_by_date[date_str].append(task_data)
        
        created_tasks = []
        pool = await get_db_pool()
        
        async with pool.acquire() as conn:
            for date_str, date_tasks in tasks_by_date.items():
                # Convert date string to date object for asyncpg (always a string from dict key)
                try:
                    date_obj = datetime.strptime(date_str, "%Y-%m-%d").date()
                except ValueError:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid date format for scheduled_date: {date_str}. Expected YYYY-MM-DD"
                    )
                
                # Start scheduling: 1 hour from now if it's today (and before 10 PM), otherwise 9 AM
                if date_str == today and now.hour < 22:
                    current_hour = now.hour + 1
                else:
                    current_hour = 9
                current_minute = 0
            
            for task_data in date_tasks:
                # Wrap to next day if past 10 PM
                if current_hour >= 22:
                    current_hour = 9
                    current_minute = 0
                
                scheduled_time = f"{current_hour:02d}:{current_minute:02d}"
                
                # Ensure all required fields have defaults
                task_id = task_data.get("id") or str(uuid.uuid4())
                title = task_data.get("title") or "Untitled Task"
                description = task_data.get("description") or ""
                urgency = task_data.get("urgency", 2)
                importance = task_data.get("importance", 2)
                priority = task_data.get("priority", 2)
                duration = task_data.get("duration", 30)
                
                # Validate priority, urgency, importance are in valid range
                priority = max(1, min(4, priority))
                urgency = max(1, min(4, urgency))
                importance = max(1, min(4, importance))
                
                created_at = datetime.now(timezone.utc)
                
                try:
                    await conn.execute(
                        """INSERT INTO tasks (id, user_id, title, description, priority, urgency, importance, 
                               scheduled_date, scheduled_time, duration, status, expires_at, created_at)
                               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)""",
                        task_id, user["id"], title, description, priority, urgency, importance,
                        date_obj, scheduled_time, duration, "scheduled", None, created_at
                    )
                    
                    created_tasks.append({
                        "id": task_id,
                        "title": title,
                        "description": description,
                        "priority": priority,
                        "urgency": urgency,
                        "importance": importance,
                        "scheduled_date": date_obj.strftime("%Y-%m-%d"),  # Convert back to string for response
                        "scheduled_time": scheduled_time,
                        "duration": duration,
                        "status": "scheduled",
                        "expires_at": None
                    })
                except Exception as db_error:
                        logger.error(f"Database error inserting task {task_id}: {str(db_error)}")
                        raise HTTPException(
                            status_code=500,
                            detail=f"Failed to save task '{title}': {str(db_error)}"
                        )
                
                # Advance time by task duration
                current_minute += duration
                while current_minute >= 60:
                    current_minute -= 60
                    current_hour += 1
        
        return {
            "success": True,
            "tasks": created_tasks,
            "message": f"{len(created_tasks)} tasks scheduled"
        }
    except HTTPException:
        # Re-raise HTTP exceptions (already properly formatted)
        raise
    except Exception as e:
        logger.error(f"Error pushing to calendar: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to push tasks to calendar: {str(e)}")


# Voice processing (legacy - disabled, use /tasks/process-voice-queue instead)
# @api_router.post("/tasks/process-voice")
# async def process_voice(voice_input: VoiceInput):
#     """Legacy endpoint - deprecated"""
#     pass

# Settings
@api_router.get("/settings", response_model=Settings)
async def get_settings(user: dict = Depends(get_current_user)):
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT id, ai_provider, ai_model FROM settings WHERE id = $1", f"settings_{user['id']}")
        if not row:
            # Create default settings
            await conn.execute(
                "INSERT INTO settings (id, ai_provider, ai_model) VALUES ($1, $2, $3)",
                f"settings_{user['id']}", "openai", "gpt-5.2"
            )
            return Settings(id=f"settings_{user['id']}")
    return dict(row)

@api_router.patch("/settings", response_model=Settings)
async def update_settings(settings_update: SettingsUpdate, user: dict = Depends(get_current_user)):
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO settings (id, ai_provider, ai_model) VALUES ($1, $2, $3)
               ON CONFLICT (id) DO UPDATE SET ai_provider = $2, ai_model = $3""",
            f"settings_{user['id']}", settings_update.ai_provider, settings_update.ai_model
        )
        row = await conn.fetchrow("SELECT id, ai_provider, ai_model FROM settings WHERE id = $1", f"settings_{user['id']}")
    return dict(row)

# Whisper Speech-to-Text endpoint
@api_router.post("/transcribe")
async def transcribe_audio_endpoint(audio: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """Transcribe audio using OpenAI Whisper"""
    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")
    
    tmp_path = None
    try:
        # Save uploaded file to temp location
        suffix = Path(audio.filename).suffix if audio.filename else ".webm"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await audio.read()
            tmp.write(content)
            tmp_path = tmp.name
        
        # Transcribe using OpenAI Whisper (with segments)
        try:
            transcript_result = await transcribe_audio_file(
            audio_file_path=tmp_path,
                model="whisper-1",
                language="en",
                return_segments=True
            )
        except Exception as transcribe_error:
            logger.error(f"Transcription error: {str(transcribe_error)}", exc_info=True)
            # Clean up temp file
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except:
                    pass
            raise HTTPException(
                status_code=500,
                detail=f"Transcription failed: {str(transcribe_error)}"
            )
        
        # Clean up temp file
        os.unlink(tmp_path)
        tmp_path = None
        
        # Return transcript text and segments
        if isinstance(transcript_result, dict):
            return {
                "success": True,
                "transcript": transcript_result.get("text", ""),
                "segments": transcript_result.get("segments", [])
            }
        else:
            # Fallback for old format (string)
            return {
                "success": True,
                "transcript": str(transcript_result),
                "segments": []  # No segments available
            }
        
    except Exception as e:
        logger.error(f"Whisper transcription error: {str(e)}")
        # Clean up temp file on error
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except:
                pass
        
        # Check for rate limit / quota errors
        error_str = str(e).lower()
        if "rate" in error_str and "limit" in error_str or "quota" in error_str:
            raise HTTPException(
                status_code=429, 
                detail="QUOTA_EXCEEDED: Your OpenAI API quota has been exceeded. Please add credits to your OpenAI account."
            )
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")


# iCal Export endpoint
from fastapi.responses import Response

@api_router.get("/tasks/export/ical")
async def export_ical(user: dict = Depends(get_current_user)):
    """Export scheduled tasks as iCal (.ics) file"""
    try:
        # Fetch all scheduled tasks for this user
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT id, title, description, priority, scheduled_date::text, scheduled_time, duration 
                   FROM tasks WHERE user_id = $1 AND status = 'scheduled' AND scheduled_date IS NOT NULL""",
                user["id"]
            )
        tasks = [dict(row) for row in rows]
        
        # Generate iCal content
        ical_lines = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//ADD Daily//Task Manager//EN",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
            "X-WR-CALNAME:ADD Daily Tasks",
        ]
        
        for task in tasks:
            scheduled_date = task.get("scheduled_date")
            scheduled_time = task.get("scheduled_time", "09:00") or "09:00"
            
            if not scheduled_date:
                continue
                
            # Parse date and time
            date_str = scheduled_date.replace("-", "")
            time_str = scheduled_time.replace(":", "") + "00"
            
            # Calculate end time based on duration
            duration_mins = task.get("duration", 30) or 30
            time_parts = scheduled_time.split(":")
            start_hour = int(time_parts[0]) if len(time_parts) > 0 else 9
            start_min = int(time_parts[1]) if len(time_parts) > 1 else 0
            
            end_min = start_min + duration_mins
            end_hour = start_hour
            while end_min >= 60:
                end_min -= 60
                end_hour += 1
            
            end_time_str = f"{end_hour:02d}{end_min:02d}00"
            
            # Create unique ID
            uid = task.get("id", str(uuid.uuid4()))
            
            # Escape special characters in text
            title = (task.get("title") or "Untitled").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")
            description = (task.get("description") or "").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")
            
            # Priority mapping (iCal: 1=high, 5=medium, 9=low)
            priority_map = {4: 1, 3: 3, 2: 5, 1: 9}
            ical_priority = priority_map.get(task.get("priority", 2), 5)
            
            # Add event
            ical_lines.extend([
                "BEGIN:VEVENT",
                f"UID:{uid}@adddaily.app",
                f"DTSTAMP:{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}",
                f"DTSTART:{date_str}T{time_str}",
                f"DTEND:{date_str}T{end_time_str}",
                f"SUMMARY:{title}",
                f"DESCRIPTION:{description}",
                f"PRIORITY:{ical_priority}",
                "STATUS:CONFIRMED",
                "END:VEVENT",
            ])
        
        ical_lines.append("END:VCALENDAR")
        
        # Join with CRLF as per iCal spec
        ical_content = "\r\n".join(ical_lines)
        
        # Return as downloadable file
        return Response(
            content=ical_content,
            media_type="text/calendar",
            headers={
                "Content-Disposition": "attachment; filename=add-daily-tasks.ics"
            }
        )
        
    except Exception as e:
        logger.error(f"Error exporting iCal: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Task status management endpoints
@api_router.post("/tasks/{task_id}/make-next")
async def make_task_next(task_id: str, user: dict = Depends(get_current_user)):
    """
    Set a task as 'next' (Next Today). Enforces hard cap of 1 task max.
    
    This endpoint uses minimal schema - only updates 'status' field.
    No optional columns (completed_at, effort, sort_order) are required.
    
    Cap enforcement:
    - Next Today hard cap = 1 task
    - If task is already 'next', allow (no-op if within cap)
    - If adding would exceed 1, return 400 with clear message
    """
    # Auth guard
    if not user or not user.get("id"):
        logger.error("make_task_next: user or user.id is missing")
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                # Check if task exists and belongs to user
                task = await conn.fetchrow(
                    "SELECT id, status FROM tasks WHERE id = $1 AND user_id = $2",
                    task_id, user["id"]
                )
                if not task:
                    raise HTTPException(status_code=404, detail="Task not found or you don't have permission")
                
                # Count existing 'next' tasks (excluding the current task if it's already 'next')
                count_query = "SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND status = 'next'"
                if task.get('status') == 'next':
                    # Task is already 'next', exclude it from count
                    count_query += " AND id != $2"
                    next_count = await conn.fetchval(count_query, user["id"], task_id)
                else:
                    next_count = await conn.fetchval(count_query, user["id"])
                
                # Enforce hard cap of 1 task
                NEXT_TODAY_CAP = 1
                if next_count >= NEXT_TODAY_CAP:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Next Today is full ({NEXT_TODAY_CAP}). Finish or move something out first."
                    )
                
                # Set the requested task as 'next' (minimal update - only status)
                await conn.execute(
                    "UPDATE tasks SET status = 'next' WHERE id = $1 AND user_id = $2",
                    task_id, user["id"]
                )
                
                # Return the updated task with dynamic column selection
                # Check which columns exist for graceful degradation
                effort_exists = await conn.fetchval(
                    """SELECT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'effort')"""
                )
                energy_required_exists = await conn.fetchval(
                    """SELECT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'energy_required')"""
                )
                completed_at_exists = await conn.fetchval(
                    """SELECT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'completed_at')"""
                )
                sort_order_exists = await conn.fetchval(
                    """SELECT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'sort_order')"""
                )
                
                # Build SELECT clause dynamically
                base_fields = "id, user_id, title, description, priority, urgency, importance, scheduled_date::text, scheduled_time, duration, status, expires_at::text"
                
                # Add optional fields only if they exist
                optional_fields = []
                if effort_exists:
                    optional_fields.append("effort")
                elif energy_required_exists:
                    optional_fields.append("energy_required")
                
                if completed_at_exists:
                    optional_fields.append("completed_at::text")
                
                if sort_order_exists:
                    optional_fields.append("sort_order")
                
                optional_fields.append("created_at::text")
                
                select_fields = base_fields + (", " + ", ".join(optional_fields) if optional_fields else "")
                
                updated_task = await conn.fetchrow(
                    f"SELECT {select_fields} FROM tasks WHERE id = $1 AND user_id = $2",
                    task_id, user["id"]
                )
        
        return dict(updated_task)
    except HTTPException:
        raise
    except Exception as e:
        error_details = {
            "message": str(e),
            "type": type(e).__name__,
            "task_id": task_id,
            "user_id": user.get("id"),
        }
        logger.error(f"Error in make_task_next: {error_details}", exc_info=True)
        error_msg = f"Failed to set task as next: {str(e)}"
        if ENV == 'development':
            error_msg += f" (Type: {type(e).__name__})"
        raise HTTPException(status_code=500, detail=error_msg)


@api_router.post("/tasks/{task_id}/move-to-inbox")
async def move_task_to_inbox(task_id: str, user: dict = Depends(get_current_user)):
    """Move a task back to 'inbox' status"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        # Check if task exists and belongs to user
        task = await conn.fetchrow(
            "SELECT id FROM tasks WHERE id = $1 AND user_id = $2",
            task_id, user["id"]
        )
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        
        # Update status to inbox
        await conn.execute(
            "UPDATE tasks SET status = 'inbox' WHERE id = $1 AND user_id = $2",
            task_id, user["id"]
        )
        
        # Return the updated task
        updated_task = await conn.fetchrow(
            """SELECT id, user_id, title, description, priority, urgency, importance, energy_required,
               scheduled_date::text, scheduled_time, duration, status, expires_at::text, created_at::text
               FROM tasks WHERE id = $1 AND user_id = $2""",
            task_id, user["id"]
        )
    
    return dict(updated_task)


@api_router.post("/tasks/{task_id}/move-to-later")
async def move_task_to_later(task_id: str, user: dict = Depends(get_current_user)):
    """Move a task to 'later' status with 14-day expiration"""
    pool = await get_db_pool()
    
    # Calculate expiration: now + 14 days
    expires_at = datetime.now(timezone.utc) + timedelta(days=14)
    
    async with pool.acquire() as conn:
        # Check if task exists and belongs to user
        task = await conn.fetchrow(
            "SELECT id FROM tasks WHERE id = $1 AND user_id = $2",
            task_id, user["id"]
        )
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        
        # Update status to later and set expires_at
        await conn.execute(
            "UPDATE tasks SET status = 'later', expires_at = $1 WHERE id = $2 AND user_id = $3",
            expires_at, task_id, user["id"]
        )
        
        # Return the updated task
        updated_task = await conn.fetchrow(
            """SELECT id, user_id, title, description, priority, urgency, importance, energy_required,
               scheduled_date::text, scheduled_time, duration, status, expires_at::text, created_at::text
               FROM tasks WHERE id = $1 AND user_id = $2""",
            task_id, user["id"]
        )
    
    return dict(updated_task)


# ===== Dump (Transmission) System =====

# Dump models
class DumpItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    dump_id: str
    user_id: str
    text: str
    description: Optional[str] = None
    status: str = Field(default="new", description="Status: 'new', 'promoted', 'dismissed'")
    created_task_id: Optional[str] = None
    # Task attributes - same as Task model
    urgency: int = Field(default=2, ge=1, le=4)
    importance: int = Field(default=2, ge=1, le=4)
    priority: int = Field(default=2, ge=1, le=4)
    energy_required: Optional[str] = Field(default="medium")  # low, medium, high
    scheduled_date: Optional[str] = None  # ISO date string
    scheduled_time: Optional[str] = None  # HH:MM format
    duration: int = Field(default=30)  # Duration in minutes
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class Dump(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    source: str = Field(..., description="Source type: 'voice' or 'text'")
    raw_text: str
    transcript: Optional[str] = None
    title: Optional[str] = None
    clarified_at: Optional[str] = None
    archived_at: Optional[str] = None
    items: Optional[List[DumpItem]] = Field(default_factory=list, description="Extracted items")

class DumpCreate(BaseModel):
    source: str = Field(..., description="Source type: 'voice' or 'text'")
    raw_text: str
    transcript: Optional[str] = None
    title: Optional[str] = None

class DumpItemCreate(BaseModel):
    text: str
    status: Optional[str] = Field(default="new")
    snooze_until: Optional[str] = None

class DumpItemUpdate(BaseModel):
    text: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    urgency: Optional[int] = None
    importance: Optional[int] = None
    priority: Optional[int] = None
    energy_required: Optional[str] = None
    scheduled_date: Optional[str] = None
    scheduled_time: Optional[str] = None
    duration: Optional[int] = None
    snooze_until: Optional[str] = None
    linked_task_id: Optional[str] = None

class SnoozeRequest(BaseModel):
    snooze_until: str  # ISO datetime string

class PromoteRequest(BaseModel):
    target: str = Field(..., description="Target: 'inbox', 'next_today', or 'later'")

class PromoteBulkRequest(BaseModel):
    item_ids: List[str] = Field(..., description="List of dump_item IDs to promote")
    target: str = Field(..., description="Target: 'inbox', 'next_today', or 'later'")

class TriageRequest(BaseModel):
    target: str = Field(..., description="Target: 'INBOX', 'NEXT_TODAY', or 'LATER'")
    item_ids: Optional[List[str]] = None  # Optional list of item IDs to triage

# Helper function to extract items from dump (uses AI if transcript available)
async def extract_items_from_dump(dump_id: str, raw_text: str, user_id: str, pool, transcript: Optional[str] = None, provider: str = "openai", model: str = "gpt-4o-mini", trace_id: Optional[str] = None) -> list:
    """
    Extract items from dump. Uses segmentation-first AI extraction if transcript is available,
    otherwise falls back to simple text splitting.
    
    Args:
        dump_id: Dump ID
        raw_text: Raw text input
        user_id: User ID
        pool: Database pool
        transcript: Optional transcript (if available, uses AI extraction)
        provider: AI provider (default: openai)
        model: AI model (default: gpt-4o-mini)
        trace_id: Optional trace ID for debugging
    """
    if not trace_id:
        trace_id = uuid.uuid4().hex[:8]
    
    created_at = datetime.now(timezone.utc)
    created_items = []
    
    # Initialize comprehensive debug payload
    debug_payload = {
        "trace_id": trace_id,
        "transcript_len": len(transcript) if transcript else 0,
        "raw_text_len": len(raw_text) if raw_text else 0,
        "env_flags": {
            "has_openai_key": bool(os.environ.get('OPENAI_API_KEY')),
            "env": ENV,
            "extract_debug": os.environ.get('EXTRACT_DEBUG') == '1'
        },
        "segments_count": 0,
        "segments_first_3": [],
        "llm_called": False,
        "llm_model": None,
        "llm_http_status": None,
        "llm_raw_text": None,
        "llm_parsed_json": None,
        "llm_parse_error": None,
        "items_before_postprocess_count": 0,
        "items_after_postprocess_count": 0,
        "final_titles": [],
        "db_insert_attempt_count": 0,
        "db_inserted_count": 0,
        "db_dump_items_sample": []
    }
    
    # Legacy extraction_debug for backward compatibility
    extraction_debug = {
        "trace_id": trace_id,
        "transcript_length": len(transcript) if transcript else 0,
        "raw_text_length": len(raw_text) if raw_text else 0,
        "fallback_reason": None,
        "segments": None,
        "llm_raw": None,
        "final_tasks": None,
        "insert_payload": []
    }
    
    # Check extraction mode from environment variable
    extraction_mode = os.environ.get("EXTRACTION_MODE", "llm_first")
    logger.info(f"🔧 Extraction mode: {extraction_mode}")
    
    # If transcript is available, use segmentation-first AI extraction
    if transcript and transcript.strip():
        # Feature flag: deterministic_first mode skips LLM
        if extraction_mode == "deterministic_first":
            logger.info(f"🔧 Using deterministic extraction (feature flag: deterministic_first)")
            fallback_items = deterministic_extract_tasks(transcript)
            items = []
            for item in fallback_items:
                item_text = item.get("text", "") or item.get("title", "")
                if item_text:
                    items.append({
                        "text": item_text,
                        "duration_minutes": item.get("duration_minutes"),
                        "source_text": item_text,
                        "segment_index": 0,
                        "order_in_segment": len(items),
                        "type": "task",
                        "confidence": 0.7
                    })
            extraction_result = {
                "items": items, 
                "segments": [], 
                "raw_count": len(items), 
                "final_count": len(items),
                "_extraction_method": "deterministic_first",
                "_retry_count": 0
            }
        else:
            try:
                # Log: dump_save_received
                logger.info(json.dumps({
                    "stage": "dump_save_received",
                    "dump_id": dump_id,
                    "trace_id": trace_id,
                    "transcript_length": len(transcript),
                    "raw_text_length": len(raw_text),
                    "extraction_mode": extraction_mode
                }))
                
                # Extract whisper_segments if available (for now, use fallback)
                whisper_segments = None  # TODO: Store/retrieve whisper_segments from dump if available
                
                # Use retry wrapper if llm_first mode, otherwise direct call
                if extraction_mode == "llm_first":
                    extraction_result = await extract_with_retries(
                        transcript=transcript,
                        provider=provider,
                        model=model,
                        whisper_segments=whisper_segments,
                        trace_id=trace_id
                    )
                else:  # llm_only mode
                    extraction_result = await extract_dump_items_from_transcript(
                        transcript, 
                        provider, 
                        model,
                        whisper_segments=whisper_segments,
                        trace_id=trace_id
                    )
                    extraction_result["_extraction_method"] = "llm_direct"
                    extraction_result["_retry_count"] = 0
                
                # Log extraction method used
                extraction_method = extraction_result.get("_extraction_method", "unknown")
                retry_count = extraction_result.get("_retry_count", 0)
                logger.info(f"📊 Extraction method: {extraction_method}, retries: {retry_count}")
                
                # Extract debug info
                segments = extraction_result.get("segments", [])
                raw_model_output = extraction_result.get("_debug", {}).get("raw_model_output")
                final_tasks = extraction_result.get("_debug", {}).get("final_tasks", [])
                
                # Log: segments_built
                logger.info(json.dumps({
                    "stage": "segments_built",
                    "dump_id": dump_id,
                    "trace_id": trace_id,
                    "segment_count": len(segments),
                    "first_3_segments": [s.get("text", "")[:100] for s in segments[:3]] if segments else []
                }))
                
                extraction_debug["segments"] = segments
                extraction_debug["llm_raw"] = raw_model_output
                extraction_debug["final_tasks"] = final_tasks
                
                items = extraction_result.get("items", [])
                if not isinstance(items, list):
                    items = []
                
                # Log items structure for debugging
                logger.info(f"🔍 Extracted {len(items)} items from extraction_result")
                for idx, item in enumerate(items):
                    item_text = item.get("text", "")
                    item_duration = item.get("duration_minutes")
                    logger.info(f"  Item {idx + 1}: text='{item_text[:80]}', duration_minutes={item_duration}, has_text={bool(item_text)}")
                
                # Capture items before postprocess
                debug_payload["items_before_postprocess_count"] = len(items)
                
                # Log: llm_returned
                logger.info(json.dumps({
                    "stage": "llm_returned",
                    "dump_id": dump_id,
                    "trace_id": trace_id,
                    "raw_item_count": len(raw_model_output.get("items", [])) if raw_model_output else 0,
                    "model": model
                }))
                
                # Apply safety split if needed
                try:
                    if items:
                        items_before_split = len(items)
                        items = postprocess_safety_split(items, trace_id, dump_id)
                        items_after_split = len(items)
                        logger.info(json.dumps({
                            "stage": "safety_split_completed",
                            "dump_id": dump_id,
                            "trace_id": trace_id,
                            "items_before": items_before_split,
                            "items_after": items_after_split
                        }))
                except Exception as split_error:
                    logger.error(json.dumps({
                        "stage": "safety_split_error",
                        "dump_id": dump_id,
                        "trace_id": trace_id,
                        "error": str(split_error)
                    }), exc_info=True)
                    # Continue with items as-is if safety split fails
                    pass
                
                # Log: postprocess_done
                final_titles = [item.get("text", "") for item in items]
                logger.info(json.dumps({
                    "stage": "postprocess_done",
                    "dump_id": dump_id,
                    "trace_id": trace_id,
                    "final_task_count": len(items),
                    "final_titles": final_titles[:10]  # First 10 titles
                }))
                
                # Log detailed item info after safety split
                logger.info(f"🔍 After safety split: {len(items)} items")
                for idx, item in enumerate(items):
                    item_text = item.get("text", "")
                    item_duration = item.get("duration_minutes")
                    logger.info(f"  Item {idx + 1}: text='{item_text[:80]}', duration_minutes={item_duration}, has_text={bool(item_text)}")
                
                # GUARD: Check for blob invariant violation
                items_before_guard = len(items)
                has_blob = False
                if items_before_guard <= 1:
                    # Single item - check if it's a blob
                    if items and is_blob_title(items[0].get("text", "") or items[0].get("title", "")):
                        has_blob = True
                        logger.warning(json.dumps({
                            "stage": "blob_detected_single_item",
                            "dump_id": dump_id,
                            "trace_id": trace_id,
                            "item_title_length": len(items[0].get("text", "") or items[0].get("title", "")),
                            "using_deterministic_extraction": True
                        }))
                else:
                    # Multiple items - check each one
                    for item in items:
                        title = item.get("text", "") or item.get("title", "")
                        if is_blob_title(title):
                            has_blob = True
                            logger.warning(json.dumps({
                                "stage": "blob_detected_in_items",
                                "dump_id": dump_id,
                                "trace_id": trace_id,
                                "blob_title": title[:100],
                                "using_deterministic_extraction": True
                            }))
                
                # If blob detected or suspiciously low count, use deterministic extraction
                # Also check if segments with actions have no items
                segments_with_actions_missing = []
                for seg in segments:
                    seg_idx = seg.get('i', -1)
                    seg_text = seg.get('text', '').lower()
                    action_verbs = ['call', 'write', 'work', 'go', 'do', 'have', 'eat', 'message', 'email', 'text']
                    has_actions = any(verb in seg_text for verb in action_verbs)
                    if has_actions:
                        seg_items = [item for item in items if item.get('segment_index') == seg_idx]
                        if not seg_items:
                            segments_with_actions_missing.append(seg_idx)
                
                if has_blob or (len(transcript) > 50 and items_before_guard <= 2) or segments_with_actions_missing:
                    reason = "blob_detected" if has_blob else ("low_item_count" if items_before_guard <= 2 else "missing_segments")
                logger.info(json.dumps({
                    "stage": "deterministic_extraction_triggered",
                    "dump_id": dump_id,
                    "trace_id": trace_id,
                    "reason": reason,
                    "items_before": items_before_guard,
                    "missing_segments": segments_with_actions_missing
                }))
                
                # Try segment-level deterministic extraction for missing segments
                deterministic_items = []
                if segments_with_actions_missing:
                    logger.info(f"Running deterministic extraction on segments: {segments_with_actions_missing}")
                    for seg_idx in segments_with_actions_missing:
                        seg = next((s for s in segments if s.get('i') == seg_idx), None)
                        if seg:
                            seg_text = seg.get('text', '')
                            seg_deterministic = deterministic_extract_tasks(seg_text)
                            # Add segment_index to deterministic items
                            for det_item in seg_deterministic:
                                det_item['segment_index'] = seg_idx
                                det_item['order_in_segment'] = len([i for i in deterministic_items if i.get('segment_index') == seg_idx])
                            deterministic_items.extend(seg_deterministic)
                
                # Also try full transcript deterministic extraction
                full_deterministic = deterministic_extract_tasks(transcript)
                
                # Combine: prefer existing items, add deterministic items that don't duplicate
                existing_titles = {item.get('text', '').lower().strip() or item.get('title', '').lower().strip() for item in items}
                for det_item in deterministic_items + full_deterministic:
                    det_title = det_item.get('title', '').lower().strip()
                    if det_title and det_title not in existing_titles:
                        # Convert to dump_item format
                        items.append({
                            "text": det_item.get('title', ''),
                            "segment_index": det_item.get('segment_index', 0),
                            "order_in_segment": det_item.get('order_in_segment', len([i for i in items if i.get('segment_index') == det_item.get('segment_index', 0)])),
                            "source_text": det_item.get('title', ''),
                            "confidence": 0.7  # Lower confidence for deterministic
                        })
                        existing_titles.add(det_title)
                
                    extraction_debug["fallback_reason"] = reason
                    extraction_debug["deterministic_extraction_used"] = True
                    extraction_debug["deterministic_items_added"] = len(deterministic_items) + len(full_deterministic)
                
                items_after_guard = len(items)
                
                # Log: db_insert_begin
                logger.info(json.dumps({
                    "stage": "db_insert_begin",
                    "dump_id": dump_id,
                    "trace_id": trace_id,
                    "items_before_guard": items_before_guard,
                    "items_after_guard": items_after_guard,
                    "insert_count": items_after_guard
                }))
                
                # Delete existing dump_items for this dump before insert
                async with pool.acquire() as conn:
                    deleted_count = await conn.execute(
                        "DELETE FROM dump_items WHERE dump_id = $1",
                        dump_id
                    )
                    logger.info(json.dumps({
                        "stage": "dump_items_deleted",
                        "dump_id": dump_id,
                        "trace_id": trace_id,
                    "deleted_count": deleted_count.split()[-1] if deleted_count else "0"
                }))
                
                # Create dump_items from extracted items
                inserted_count = 0
                extraction_status = "success"
                extraction_error = None
                
                try:
                    debug_payload["db_insert_attempt_count"] = len(items)
                    logger.info(f"🔍 Database insertion: Processing {len(items)} items")
                    for idx, item_data in enumerate(items):
                        item_id = str(uuid.uuid4())
                        item_text = item_data.get("text", "")
                        item_duration = item_data.get("duration_minutes")
                        
                        # Log full item structure for debugging
                        logger.info(f"  Item {idx + 1}/{len(items)} full structure: {json.dumps({k: str(v)[:100] for k, v in item_data.items()}, indent=2)}")
                        logger.info(f"  Item {idx + 1}/{len(items)}: text='{item_text[:80]}', duration_minutes={item_duration}, has_text={bool(item_text)}")
                        
                        # CRITICAL FIX: Never skip items with duration_minutes, even if text seems empty
                        # Items with durations are valid tasks and must be inserted
                        if not item_text:
                            # Check if this item has duration_minutes - if so, it's a valid task that should be inserted
                            if item_duration is not None:
                                # This is a task with duration but missing text - try to reconstruct from source_text or title
                                item_text = item_data.get("source_text") or item_data.get("title") or f"Task with duration {item_duration} minutes"
                                logger.warning(f"  ⚠️  Item {idx + 1} had empty text but has duration_minutes={item_duration}, using reconstructed text: '{item_text[:80]}'")
                            else:
                                logger.warning(f"  ⚠️  Skipping item {idx + 1}: empty text and no duration")
                            continue
                        
                        # Additional validation: ensure text is not just whitespace
                        if not item_text.strip():
                            if item_duration is not None:
                                item_text = item_data.get("source_text") or item_data.get("title") or f"Task with duration {item_duration} minutes"
                                logger.warning(f"  ⚠️  Item {idx + 1} had whitespace-only text but has duration_minutes={item_duration}, using reconstructed text: '{item_text[:80]}'")
                            else:
                                logger.warning(f"  ⚠️  Skipping item {idx + 1}: text is only whitespace")
                                continue
                        
                        # Log before insertion
                        logger.info(f"  ✓ Inserting item {idx + 1}: '{item_text[:80]}' (duration: {item_duration})")
                        
                        # Use default 30 if duration is None (database has DEFAULT 30, but we'll pass it explicitly)
                        duration_value = item_duration if item_duration is not None else 30
                        
                        await conn.execute(
                            """INSERT INTO dump_items (id, dump_id, user_id, text, status, duration, created_at)
                               VALUES ($1, $2, $3, $4, 'new', $5, $6)""",
                            item_id, dump_id, user_id, item_text, duration_value, created_at
                        )
                        
                        extraction_debug["insert_payload"].append({
                            "item_id": item_id,
                            "text": item_text[:100]  # Truncate for storage
                        })
                        
                        row = await conn.fetchrow(
                            """SELECT id, dump_id, user_id, text, status, created_task_id, duration, created_at::text
                               FROM dump_items WHERE id = $1""",
                            item_id
                        )
                        if row:
                            created_items.append(dict(row))
                            inserted_count += 1
                            logger.info(f"  ✓ Successfully inserted item {idx + 1} (ID: {item_id[:8]}...): text='{row.get('text', '')[:80]}'")
                        else:
                            logger.error(f"  ✗ FAILED to verify insertion of item {idx + 1} (ID: {item_id[:8]}...) - row is None!")
                            logger.error(f"    Item data was: text='{item_text[:80]}', duration={item_duration}")
                    
                    logger.info(f"🔍 Database insertion complete: {inserted_count}/{len(items)} items inserted")
                    debug_payload["db_inserted_count"] = inserted_count
                    
                    if inserted_count < len(items):
                        logger.warning(f"⚠️  WARNING: Only {inserted_count} items inserted out of {len(items)} total items!")
                        skipped_count = len(items) - inserted_count
                        logger.warning(f"  {skipped_count} items were skipped (likely due to empty text)")
                    
                    # Get sample of inserted items from DB
                    db_sample = await conn.fetch(
                        """SELECT text FROM dump_items WHERE dump_id = $1 ORDER BY created_at ASC LIMIT 5""",
                        dump_id
                    )
                    debug_payload["db_dump_items_sample"] = [row["text"][:100] for row in db_sample]
                    
                    # Verify inserted count
                    db_count = await conn.fetchval(
                        "SELECT COUNT(*) FROM dump_items WHERE dump_id = $1",
                        dump_id
                    )
                    
                    # Update extraction status in dumps table
                    await conn.execute(
                        """UPDATE dumps 
                           SET extraction_status = $1, extraction_item_count = $2, extraction_error = $3
                           WHERE id = $4""",
                        extraction_status, inserted_count, extraction_error, dump_id
                    )
                    
                    # Log: db_insert_done
                    logger.info(json.dumps({
                        "stage": "db_insert_done",
                        "dump_id": dump_id,
                        "trace_id": trace_id,
                        "transcript_len": len(transcript),
                        "items_before_guard": items_before_guard,
                        "items_after_guard": items_after_guard,
                        "rows_inserted": inserted_count,
                        "db_confirmed_count": db_count
                    }))
                except Exception as insert_error:
                    extraction_status = "error"
                    extraction_error = str(insert_error)
                    logger.error(json.dumps({
                        "stage": "db_insert_error",
                        "dump_id": dump_id,
                        "trace_id": trace_id,
                        "error": extraction_error
                    }), exc_info=True)
                    # Update extraction status even on error
                    await conn.execute(
                        """UPDATE dumps 
                           SET extraction_status = $1, extraction_item_count = $2, extraction_error = $3
                           WHERE id = $4""",
                        extraction_status, inserted_count, extraction_error, dump_id
                    )
                    raise
                
                # Store extraction_debug if enabled
                if ENV == 'development' or os.environ.get('EXTRACT_DEBUG') == '1':
                    try:
                        # Check if extraction_debug column exists
                        debug_col_exists = await conn.fetchval(
                            """SELECT EXISTS (SELECT 1 FROM information_schema.columns 
                               WHERE table_schema = 'public' AND table_name = 'dumps' AND column_name = 'extraction_debug')"""
                        )
                        if debug_col_exists:
                            await conn.execute(
                                "UPDATE dumps SET extraction_debug = $1 WHERE id = $2",
                                json.dumps(extraction_debug), dump_id
                            )
                    except Exception as debug_err:
                        logger.warning(f"Failed to store extraction_debug: {debug_err}")
                
                # Set clarified_at on dump
                await conn.execute(
                    "UPDATE dumps SET clarified_at = $1 WHERE id = $2",
                    created_at, dump_id
                )
                
                return created_items
            except Exception as e:
                logger.error(json.dumps({
                    "stage": "extract_error",
                    "dump_id": dump_id,
                    "trace_id": trace_id,
                    "error": str(e),
                    "error_type": type(e).__name__
                }))
                logger.error(f"AI extraction failed, falling back to text splitting: {e}", exc_info=True)
                extraction_debug["fallback_reason"] = str(e)
                # Fall through to text splitting
                
                # Fallback: Use deterministic extraction (never create blobs)
                logger.info(f"Using deterministic extraction fallback for dump {dump_id}")
                fallback_items = deterministic_extract_tasks(transcript)
    else:
        # No transcript available - use extraction on raw_text
        logger.info(f"No transcript available, using extraction on raw_text for dump {dump_id} (mode: {extraction_mode})")
        
        # Feature flag: deterministic_first mode skips LLM
        if extraction_mode == "deterministic_first":
            logger.info(f"🔧 Using deterministic extraction (feature flag: deterministic_first)")
            fallback_items = deterministic_extract_tasks(raw_text)
            items = []
            for item in fallback_items:
                item_text = item.get("text", "") or item.get("title", "")
                if item_text:
                    items.append({
                        "text": item_text,
                        "duration_minutes": item.get("duration_minutes"),
                        "source_text": item_text,
                        "segment_index": 0,
                        "order_in_segment": len(items),
                        "type": "task",
                        "confidence": 0.7
                    })
            extraction_result = {
                "items": items, 
                "segments": [], 
                "raw_count": len(items), 
                "final_count": len(items),
                "_extraction_method": "deterministic_first",
                "_retry_count": 0
            }
        else:
            try:
                # Use retry wrapper if llm_first mode, otherwise direct call
                if extraction_mode == "llm_first":
                    extraction_result = await extract_with_retries(
                        transcript=raw_text,
                        provider=provider,
                        model=model,
                        whisper_segments=None,
                        trace_id=trace_id
                    )
                    # Log extraction method used
                    extraction_method = extraction_result.get("_extraction_method", "unknown")
                    retry_count = extraction_result.get("_retry_count", 0)
                    logger.info(f"📊 Extraction method: {extraction_method}, retries: {retry_count}")
                else:  # llm_only mode
                    extraction_result = await extract_dump_items_from_transcript(
                        raw_text,  # Use raw_text as transcript
                        provider,
                        model,
                        whisper_segments=None,
                        trace_id=trace_id
                    )
                    extraction_result["_extraction_method"] = "llm_direct"
                    extraction_result["_retry_count"] = 0
                
                items = extraction_result.get("items", [])
                if not isinstance(items, list):
                    items = []
                
                logger.info(f"🔍 LLM extraction on raw_text returned {len(items)} items")
                
                # If LLM extraction returned 0 items and not in llm_only mode, fall back to deterministic extraction
                if len(items) == 0 and extraction_mode != "llm_only":
                    logger.error(f"❌ LLM extraction returned 0 items for raw_text: '{raw_text[:200]}'")
                    logger.warning(f"⚠️  Falling back to deterministic extraction")
                    try:
                        fallback_items = deterministic_extract_tasks(raw_text)
                        logger.info(f"🔍 Deterministic extraction returned {len(fallback_items)} items")
                        
                        # Convert deterministic items to dump_items format
                        items = []
                        for item in fallback_items:
                            item_text = item.get("text", "") or item.get("title", "")
                            if item_text:
                                items.append({
                                    "text": item_text,
                                    "duration_minutes": item.get("duration_minutes"),
                                    "source_text": item_text,
                                    "segment_index": 0,
                                    "order_in_segment": len(items),
                                    "type": "task",
                                    "confidence": 0.7
                                })
                        logger.info(f"🔍 Converted {len(items)} deterministic items to dump_items format")
                        extraction_result = {
                            "items": items, 
                            "segments": [], 
                            "raw_count": len(items), 
                            "final_count": len(items),
                            "_extraction_method": "deterministic_fallback",
                            "_retry_count": 0
                        }
                        
                        if len(items) == 0:
                            logger.error(f"❌ CRITICAL: Both LLM and deterministic extraction returned 0 items!")
                            logger.error(f"   Raw text was: '{raw_text[:500]}'")
                    except Exception as fallback_error:
                        logger.error(f"❌ Deterministic extraction failed: {fallback_error}", exc_info=True)
                        items = []
                        extraction_result = {"items": [], "segments": [], "raw_count": 0, "final_count": 0}
            except Exception as e:
                logger.error(f"❌ LLM extraction failed: {e}", exc_info=True)
                # Fall back to deterministic if not in llm_only mode
                if extraction_mode != "llm_only":
                    logger.warning(f"⚠️  Falling back to deterministic extraction after LLM error")
                    try:
                        fallback_items = deterministic_extract_tasks(raw_text)
                        items = []
                        for item in fallback_items:
                            item_text = item.get("text", "") or item.get("title", "")
                            if item_text:
                                items.append({
                                    "text": item_text,
                                    "duration_minutes": item.get("duration_minutes"),
                                    "source_text": item_text,
                                    "segment_index": 0,
                                    "order_in_segment": len(items),
                                    "type": "task",
                                    "confidence": 0.7
                                })
                        extraction_result = {"items": items, "segments": [], "raw_count": len(items), "final_count": len(items)}
                    except Exception as fallback_error:
                        logger.error(f"❌ Deterministic extraction also failed: {fallback_error}", exc_info=True)
                        extraction_result = {"items": [], "segments": [], "raw_count": 0, "final_count": 0}
                else:
                    extraction_result = {"items": [], "segments": [], "raw_count": 0, "final_count": 0}
            
            # Apply safety split if needed
            if items:
                items = postprocess_safety_split(items, trace_id, dump_id)
            
            # Continue with normal processing flow (same as transcript path)
            # Process items through the same database insertion logic as transcript path
            items_after_guard = len(items)
            
            # Delete existing dump_items for this dump before insert
            async with pool.acquire() as conn:
                deleted_count = await conn.execute(
                    "DELETE FROM dump_items WHERE dump_id = $1",
                    dump_id
                )
                
                # Create dump_items from extracted items
                inserted_count = 0
                extraction_status = "success"
                extraction_error = None
                
                try:
                    for idx, item_data in enumerate(items):
                        item_id = str(uuid.uuid4())
                        item_text = item_data.get("text", "")
                        item_duration = item_data.get("duration_minutes")
                        
                        # CRITICAL FIX: Never skip items with duration_minutes, even if text seems empty
                        if not item_text:
                            if item_duration is not None:
                                item_text = item_data.get("source_text") or item_data.get("title") or f"Task with duration {item_duration} minutes"
                            else:
                                continue
                        
                        if not item_text.strip():
                            if item_duration is not None:
                                item_text = item_data.get("source_text") or item_data.get("title") or f"Task with duration {item_duration} minutes"
                            else:
                                continue
                        
                        # Use default 30 if duration is None (database has DEFAULT 30, but we'll pass it explicitly)
                        duration_value = item_duration if item_duration is not None else 30
                        
                        await conn.execute(
                            """INSERT INTO dump_items (id, dump_id, user_id, text, status, duration, created_at)
                               VALUES ($1, $2, $3, $4, 'new', $5, $6)""",
                            item_id, dump_id, user_id, item_text, duration_value, created_at
                        )
                        
                        row = await conn.fetchrow(
                            """SELECT id, dump_id, user_id, text, status, created_task_id, duration, created_at::text
                               FROM dump_items WHERE id = $1""",
                            item_id
                        )
                        if row:
                            created_items.append(dict(row))
                            inserted_count += 1
                    
                    # Update extraction status
                    await conn.execute(
                        """UPDATE dumps 
                           SET extraction_status = $1, extraction_item_count = $2, extraction_error = $3
                           WHERE id = $4""",
                        extraction_status, inserted_count, extraction_error, dump_id
                    )
                    
                    # Set clarified_at on dump
                    await conn.execute(
                        "UPDATE dumps SET clarified_at = $1 WHERE id = $2",
                        created_at, dump_id
                    )
                except Exception as insert_error:
                    extraction_status = "error"
                    extraction_error = str(insert_error)
                    logger.error(f"Database insertion error: {extraction_error}", exc_info=True)
                    await conn.execute(
                        """UPDATE dumps 
                           SET extraction_status = $1, extraction_item_count = $2, extraction_error = $3
                           WHERE id = $4""",
                        extraction_status, inserted_count, extraction_error, dump_id
                    )
                    raise
                
                return created_items

# Dump endpoints
@api_router.post("/dumps")
async def create_dump(
    dump_data: DumpCreate, 
    user: dict = Depends(get_current_user),
    auto_extract: Optional[int] = Query(0, description="Auto-extract items (1=true, 0=false)")
):
    """Create a new dump (capture session). If auto_extract=1, also extracts items."""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    if dump_data.source not in ['voice', 'text']:
        raise HTTPException(status_code=400, detail="Source must be 'voice' or 'text'")
    
    pool = await get_db_pool()
    # Generate trace_id for this dump
    trace_id = uuid.uuid4().hex[:8]
    
    async with pool.acquire() as conn:
        dump_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc)
        
        await conn.execute(
            """INSERT INTO dumps (id, user_id, created_at, source, raw_text, transcript, title, trace_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)""",
            dump_id, user["id"], created_at, dump_data.source, dump_data.raw_text, dump_data.transcript, dump_data.title, trace_id
        )
        
        dump_row = await conn.fetchrow(
            """SELECT id, user_id, created_at::text, source, raw_text, transcript, title,
                      clarified_at::text, archived_at::text
               FROM dumps WHERE id = $1""",
            dump_id
        )
    
    dump_dict = dict(dump_row)
    
    # Auto-extract if requested
    items = []
    if auto_extract == 1:
        try:
            items = await extract_items_from_dump(
                dump_id, 
                dump_data.raw_text, 
                user["id"], 
                pool,
                transcript=dump_data.transcript,  # Pass transcript for AI extraction
                provider="openai",
                model="gpt-4o-mini",
                trace_id=trace_id
            )
        except Exception as e:
            logger.error(f"Error in extract_items_from_dump for dump {dump_id}: {str(e)}", exc_info=True)
            # Return dump without items rather than failing completely
            dump_dict["items"] = []
            dump_dict["extraction_error"] = str(e)
            return dump_dict
    
    dump_dict["items"] = items
    
    return dump_dict

@api_router.get("/dumps", response_model=List[Dump])
async def get_dumps(archived: Optional[bool] = Query(None, description="Filter by archived status"), 
                    user: dict = Depends(get_current_user)):
    """Get all dumps for the current user, newest first. Returns [] if table doesn't exist (dev mode)."""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        try:
            # Check if dumps table exists - if not, return empty list (graceful degradation)
            table_exists = await conn.fetchval(
                """SELECT EXISTS (
                   SELECT 1 FROM information_schema.tables 
                   WHERE table_schema = 'public' 
                   AND table_name = 'dumps'
                )"""
            )
            
            if not table_exists:
                logger.warning(f"dumps table does not exist for user {user['id']}. Returning empty list.")
                return []
        except Exception as e:
            logger.error(f"Error checking for dumps table: {e}")
            # In dev mode, return empty list instead of crashing
            if ENV != 'production':
                return []
            raise HTTPException(status_code=500, detail="Database error")
        
        try:
            if archived is None:
                # Get non-archived dumps by default
                rows = await conn.fetch(
                    """SELECT id, user_id, created_at::text, source, raw_text, transcript, title,
                              clarified_at::text, archived_at::text
                       FROM dumps 
                       WHERE user_id = $1 AND archived_at IS NULL
                       ORDER BY created_at DESC""",
                    user["id"]
                )
            else:
                rows = await conn.fetch(
                    """SELECT id, user_id, created_at::text, source, raw_text, transcript, title,
                              clarified_at::text, archived_at::text
                       FROM dumps 
                       WHERE user_id = $1 AND (archived_at IS NULL) = $2
                       ORDER BY created_at DESC""",
                    user["id"], not archived
                )
            
            return [dict(row) for row in rows]
        except Exception as e:
            error_str = str(e).lower()
            if "does not exist" in error_str or "relation" in error_str or "table" in error_str or "column" in error_str:
                logger.warning(f"Database schema issue with dumps table: {e}. Returning empty list.")
                # In dev mode, return empty list instead of crashing
                if ENV != 'production':
                    return []
                raise HTTPException(
                    status_code=500,
                    detail=f"Database schema error: {str(e)}"
                )
            logger.error(f"Error fetching dumps: {e}", exc_info=True)
            raise HTTPException(
                status_code=500,
                detail=f"Error fetching dumps: {str(e)}"
            )

@api_router.patch("/dumps/{dump_id}", response_model=Dump)
async def update_dump(dump_id: str, dump_update: dict, user: dict = Depends(get_current_user)):
    """Update a dump (e.g., archive, clarify)"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Build update query dynamically
        allowed_fields = {'transcript', 'title', 'clarified_at', 'archived_at'}
        update_data = {k: v for k, v in dump_update.items() if k in allowed_fields}
        
        if not update_data:
            raise HTTPException(status_code=400, detail="No valid fields to update")
        
        set_clauses = []
        values = []
        param_num = 1
        
        for key, value in update_data.items():
            if key == 'clarified_at' or key == 'archived_at':
                if value:
                    set_clauses.append(f"{key} = ${param_num}")
                    values.append(datetime.fromisoformat(value.replace('Z', '+00:00')) if isinstance(value, str) else value)
                else:
                    set_clauses.append(f"{key} = NULL")
                param_num += 1 if value else 0
            else:
                set_clauses.append(f"{key} = ${param_num}")
                values.append(value)
                param_num += 1
        
        where_clause = f"id = ${param_num} AND user_id = ${param_num + 1}"
        values.extend([dump_id, user["id"]])
        
        query = f"""UPDATE dumps SET {', '.join(set_clauses)} 
                    WHERE {where_clause}
                    RETURNING id, user_id, created_at::text, source, raw_text, transcript, title,
                              clarified_at::text, archived_at::text"""
        
        row = await conn.fetchrow(query, *values)
        
        if not row:
            raise HTTPException(status_code=404, detail="Dump not found or you don't have permission")
    
    return dict(row)

@api_router.delete("/dumps/{dump_id}")
async def delete_dump(dump_id: str, user: dict = Depends(get_current_user)):
    """Delete a dump and its items (cascade delete)"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Verify dump belongs to user (authorization check)
        dump = await conn.fetchrow(
            "SELECT id FROM dumps WHERE id = $1 AND user_id = $2",
            dump_id, user["id"]
        )
        
        if not dump:
            raise HTTPException(status_code=404, detail="Dump not found or you don't have permission")
        
        # Delete dump (cascade will delete dump_items automatically due to ON DELETE CASCADE)
        result = await conn.execute(
            "DELETE FROM dumps WHERE id = $1 AND user_id = $2",
            dump_id, user["id"]
        )
        
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Dump not found or you don't have permission")
    
    return {"message": "Dump deleted successfully"}

# Dump Items endpoints
@api_router.post("/dumps/{dump_id}/items", response_model=DumpItem)
async def create_dump_item(dump_id: str, item_data: DumpItemCreate, user: dict = Depends(get_current_user)):
    """Create a new item in a dump"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Verify dump belongs to user
        dump = await conn.fetchrow(
            "SELECT id FROM dumps WHERE id = $1 AND user_id = $2",
            dump_id, user["id"]
        )
        if not dump:
            raise HTTPException(status_code=404, detail="Dump not found or you don't have permission")
        
        item_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc)
        status = item_data.status or "new"
        
        snooze_until_value = None
        if item_data.snooze_until:
            snooze_until_value = datetime.fromisoformat(item_data.snooze_until.replace('Z', '+00:00'))
        
        await conn.execute(
            """INSERT INTO dump_items (id, dump_id, created_at, text, status, snooze_until)
               VALUES ($1, $2, $3, $4, $5, $6)""",
            item_id, dump_id, created_at, item_data.text, status, snooze_until_value
        )
        
        row = await conn.fetchrow(
            """SELECT id, dump_id, created_at::text, text, status, 
                      snooze_until::text, linked_task_id, duration
               FROM dump_items WHERE id = $1""",
            item_id
        )
    
    return dict(row)

@api_router.get("/dumps/{dump_id}/items", response_model=List[DumpItem])
async def get_dump_items(dump_id: str, user: dict = Depends(get_current_user)):
    """Get all items for a dump"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Verify dump belongs to user
        dump = await conn.fetchrow(
            "SELECT id FROM dumps WHERE id = $1 AND user_id = $2",
            dump_id, user["id"]
        )
        if not dump:
            raise HTTPException(status_code=404, detail="Dump not found or you don't have permission")
        
        # Get all existing columns in dump_items table
        existing_columns = await get_dump_items_existing_columns(conn)
        
        # Build SELECT query dynamically based on existing columns
        select_parts = []
        
        # Required columns (should always exist)
        if 'id' in existing_columns:
            select_parts.append('id')
        if 'dump_id' in existing_columns:
            select_parts.append('dump_id')
        if 'user_id' in existing_columns:
            select_parts.append('user_id')
        if 'created_at' in existing_columns:
            select_parts.append('created_at::text')
        if 'text' in existing_columns:
            select_parts.append('text')
        if 'status' in existing_columns:
            select_parts.append('status')
        
        # Optional columns (only if they exist)
        if 'duration' in existing_columns:
            select_parts.append('duration')
        if 'description' in existing_columns:
            select_parts.append('description')
        if 'urgency' in existing_columns:
            select_parts.append('urgency')
        if 'importance' in existing_columns:
            select_parts.append('importance')
        if 'priority' in existing_columns:
            select_parts.append('priority')
        if 'energy_required' in existing_columns:
            select_parts.append('energy_required')
        if 'scheduled_date' in existing_columns:
            select_parts.append('scheduled_date::text')
        if 'scheduled_time' in existing_columns:
            select_parts.append('scheduled_time')
        if 'linked_task_id' in existing_columns:
            select_parts.append('linked_task_id')
        if 'snooze_until' in existing_columns:
            select_parts.append('snooze_until::text')
        
        select_clause = ', '.join(select_parts)
        
        rows = await conn.fetch(
            f"""SELECT {select_clause}
               FROM dump_items 
               WHERE dump_id = $1
               ORDER BY created_at ASC""",
            dump_id
        )
        
        # Log duration values for debugging
        for row in rows:
            if 'duration' in row:
                logger.info(f"GET dump_items: item {row.get('id', 'unknown')} has duration = {row.get('duration')}")
    
    return [dict(row) for row in rows]

async def check_dump_items_column_exists(conn, column_name: str) -> bool:
    """Check if a column exists in dump_items table"""
    return await conn.fetchval(
        """SELECT EXISTS (
           SELECT 1 FROM information_schema.columns 
           WHERE table_schema = 'public' 
           AND table_name = 'dump_items' 
           AND column_name = $1
        )""",
        column_name
    )

async def get_dump_items_existing_columns(conn) -> set:
    """Get set of all existing column names in dump_items table"""
    rows = await conn.fetch(
        """SELECT column_name FROM information_schema.columns 
           WHERE table_schema = 'public' 
           AND table_name = 'dump_items'"""
    )
    return {row['column_name'] for row in rows}

@api_router.patch("/dump-items/{item_id}", response_model=DumpItem)
async def update_dump_item(item_id: str, item_update: DumpItemUpdate, user: dict = Depends(get_current_user)):
    """Update a dump item"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        try:
            # Verify item belongs to user's dump
            item = await conn.fetchrow(
                """SELECT dump_items.id FROM dump_items
                   JOIN dumps ON dump_items.dump_id = dumps.id
                   WHERE dump_items.id = $1 AND dumps.user_id = $2""",
                item_id, user["id"]
            )
            if not item:
                raise HTTPException(status_code=404, detail="Dump item not found or you don't have permission")
            
            # Get all existing columns in dump_items table
            existing_columns = await get_dump_items_existing_columns(conn)
            logger.info(f"Existing columns in dump_items: {sorted(existing_columns)}")
            
            # Base fields that should always exist
            base_fields = {'text', 'status'}
            
            # Optional fields that might exist in the database
            optional_fields = {
                'duration', 'description', 'urgency', 'importance', 
                'priority', 'energy_required', 'scheduled_date', 
                'scheduled_time', 'snooze_until', 'linked_task_id'
            }
            
            # Combine only fields that actually exist in the database
            allowed_fields = base_fields | {f for f in optional_fields if f in existing_columns}
            
            # Log which fields are allowed for updating
            logger.info(f"Allowed fields for update: {sorted(allowed_fields)}")
            
            # Filter update data: only include fields that are in allowed_fields
            # Also filter out None values (but keep empty strings and 0 values)
            raw_update = item_update.model_dump()
            logger.info(f"Raw update data from request: {raw_update}")
            
            update_data = {k: v for k, v in raw_update.items() if v is not None and k in allowed_fields}
            logger.info(f"Update data (filtered by allowed_fields): {update_data}")
            
            if not update_data:
                raise HTTPException(status_code=400, detail="No update data provided")
            
            set_clauses = []
            values = []
            param_num = 1
            
            for key, value in update_data.items():
                # Double-check that the column exists (safety check)
                if key not in existing_columns:
                    logger.warning(f"Skipping update to non-existent column: {key}")
                    continue
                
                set_clauses.append(f"{key} = ${param_num}")
                # Handle special cases: date/datetime parsing
                if key == 'scheduled_date' and isinstance(value, str):
                    try:
                        # Parse YYYY-MM-DD format string to date object
                        value = datetime.strptime(value, "%Y-%m-%d").date()
                    except ValueError:
                        raise HTTPException(status_code=400, detail=f"Invalid date format for scheduled_date: {value}. Expected YYYY-MM-DD")
                elif key == 'snooze_until' and isinstance(value, str):
                    # Parse ISO datetime string
                    value = datetime.fromisoformat(value.replace('Z', '+00:00'))
                
                values.append(value)
                param_num += 1
            
            # Check if we have any SET clauses (shouldn't happen due to earlier check, but safety)
            if not set_clauses:
                logger.error(f"No SET clauses after filtering - this should not happen. update_data was: {update_data}, allowed_fields: {allowed_fields}")
                raise HTTPException(status_code=400, detail="No valid fields to update after filtering")
            
            where_clause = f"id = ${param_num}"
            values.append(item_id)
            
            # Build RETURNING clause dynamically - only include columns that exist
            returning_parts = []
            
            # Required columns (should always exist)
            if 'id' in existing_columns:
                returning_parts.append('id')
            if 'dump_id' in existing_columns:
                returning_parts.append('dump_id')
            if 'user_id' in existing_columns:
                returning_parts.append('user_id')
            if 'created_at' in existing_columns:
                returning_parts.append('created_at::text')
            if 'text' in existing_columns:
                returning_parts.append('text')
            if 'status' in existing_columns:
                returning_parts.append('status')
            
            # Optional columns (only if they exist)
            if 'duration' in existing_columns:
                returning_parts.append('duration')
            if 'description' in existing_columns:
                returning_parts.append('description')
            if 'urgency' in existing_columns:
                returning_parts.append('urgency')
            if 'importance' in existing_columns:
                returning_parts.append('importance')
            if 'priority' in existing_columns:
                returning_parts.append('priority')
            if 'energy_required' in existing_columns:
                returning_parts.append('energy_required')
            if 'scheduled_date' in existing_columns:
                returning_parts.append('scheduled_date::text')
            if 'scheduled_time' in existing_columns:
                returning_parts.append('scheduled_time')
            if 'linked_task_id' in existing_columns:
                returning_parts.append('linked_task_id')
            if 'snooze_until' in existing_columns:
                returning_parts.append('snooze_until::text')
            
            returning_clause = ', '.join(returning_parts)
            logger.info(f"RETURNING clause: {returning_clause}")
            
            query = f"""UPDATE dump_items SET {', '.join(set_clauses)} 
                        WHERE {where_clause}
                        RETURNING {returning_clause}"""
            
            set_clause_names = [clause.split('=')[0].strip() for clause in set_clauses]
            logger.info(f"Executing UPDATE query with {len(set_clauses)} SET clauses: {', '.join(set_clause_names)}")
            logger.info(f"Query: {query}")
            logger.info(f"Values: {values}")
            
            try:
                row = await conn.fetchrow(query, *values)
            except Exception as query_error:
                logger.error(f"Database query error: {type(query_error).__name__}: {str(query_error)}")
                logger.error(f"Query that failed: {query}")
                logger.error(f"Values that failed: {values}")
                raise HTTPException(status_code=500, detail=f"Database error: {type(query_error).__name__}: {str(query_error)}")
            
            if not row:
                raise HTTPException(status_code=404, detail="Item not found after update")
            
            result = dict(row)
            logger.info(f"Update successful, returning {len(result)} fields: {list(result.keys())}")
            if 'duration' in result:
                logger.info(f"Update successful: duration value in response = {result.get('duration')} (type: {type(result.get('duration'))})")
            return result
        except HTTPException:
            raise
        except Exception as e:
            import traceback
            error_msg = str(e)
            error_type = type(e).__name__
            full_traceback = traceback.format_exc()
            logger.error(f"Error updating dump item {item_id}: {error_type}: {error_msg}")
            logger.error(full_traceback)
            # Include more detail in the error message for debugging - limit message length
            detail_msg = f"{error_type}: {error_msg}"[:200]  # Limit to 200 chars
            raise HTTPException(status_code=500, detail=detail_msg)

@api_router.post("/dumps/{dump_id}/extract")
async def extract_dump(dump_id: str, user: dict = Depends(get_current_user)):
    """Extract items from dump.raw_text into dump_items (does NOT create tasks)"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Verify dump belongs to user
        dump = await conn.fetchrow(
            """SELECT id, raw_text, transcript FROM dumps 
               WHERE id = $1 AND user_id = $2""",
            dump_id, user["id"]
        )
        if not dump:
            raise HTTPException(status_code=404, detail="Dump not found or you don't have permission")
        
        raw_text = dump.get('raw_text', '')
        transcript = dump.get('transcript')
    
    # Use shared extraction logic (with AI if transcript available)
    items = await extract_items_from_dump(
        dump_id, 
        raw_text, 
        user["id"], 
        pool,
        transcript=transcript,
        provider="openai",
        model="gpt-4o-mini"
    )
    
    return {"items": items}

@api_router.post("/dump-items/{item_id}/promote", response_model=Task)
async def promote_dump_item(item_id: str, promote_request: PromoteRequest, user: dict = Depends(get_current_user)):
    """Promote a dump_item to a task (creates task)"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    if promote_request.target not in ['inbox', 'next_today', 'later']:
        raise HTTPException(status_code=400, detail="Target must be 'inbox', 'next_today', or 'later'")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Verify item belongs to user (authorization check)
        item = await conn.fetchrow(
            """SELECT id, text, status, duration FROM dump_items
               WHERE id = $1 AND user_id = $2""",
            item_id, user["id"]
        )
        if not item:
            raise HTTPException(status_code=404, detail="Dump item not found or you don't have permission")
        
        # Check if already promoted
        if item.get('status') == 'promoted':
            raise HTTPException(status_code=400, detail="Dump item already promoted")
        
        # Map target to task status
        task_status = 'inbox' if promote_request.target == 'inbox' else ('next' if promote_request.target == 'next_today' else 'later')
        
        # Check Inbox cap if target is inbox
        if task_status == 'inbox':
            inbox_count = await conn.fetchval(
                "SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND status = 'inbox'",
                user["id"]
            )
            INBOX_CAP = 5
            if inbox_count >= INBOX_CAP:
                raise HTTPException(
                    status_code=409,
                    detail="Inbox is full. Promote to Later or Next Today."
                )
        
        # Check Next Today cap if target is next_today
        if task_status == 'next':
            next_count = await conn.fetchval(
                "SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND status = 'next'",
                user["id"]
            )
            NEXT_TODAY_CAP = 1
            if next_count >= NEXT_TODAY_CAP:
                raise HTTPException(
                    status_code=400,
                    detail=f"Next Today is full ({NEXT_TODAY_CAP}). Finish or move something out first."
                )
        
        # Create task - use duration from dump_item, default to 30 if not set
        task_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc)
        item_duration = item.get('duration', 30)
        
        logger.info(f"Promoting dump_item {item_id} to task with duration: {item_duration} minutes")
        
        await conn.execute(
            """INSERT INTO tasks (id, user_id, title, status, created_at, priority, urgency, importance, duration)
               VALUES ($1, $2, $3, $4, $5, 2, 2, 2, $6)""",
            task_id, user["id"], item.get('text', 'Untitled Task'), task_status, created_at, item_duration
        )
        
        # Update dump_item: status='promoted', created_task_id=task_id
        await conn.execute(
            """UPDATE dump_items 
               SET status = 'promoted', created_task_id = $1
               WHERE id = $2""",
            task_id, item_id
        )
        
        # Fetch created task
        task_row = await conn.fetchrow(
            """SELECT id, user_id, title, description, priority, urgency, importance, 
                      scheduled_date::text, scheduled_time, duration, status, created_at::text
               FROM tasks WHERE id = $1""",
            task_id
        )
    
    return dict(task_row)

@api_router.post("/dump-items/promote-bulk")
async def promote_dump_items_bulk(promote_request: PromoteBulkRequest, user: dict = Depends(get_current_user)):
    """Promote multiple dump_items to tasks"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    if promote_request.target not in ['inbox', 'next_today', 'later']:
        raise HTTPException(status_code=400, detail="Target must be 'inbox', 'next_today', or 'later'")
    
    if not promote_request.item_ids:
        raise HTTPException(status_code=400, detail="item_ids cannot be empty")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Verify all items belong to user (authorization check)
        item_ids_placeholder = ','.join(f'${i+1}' for i in range(len(promote_request.item_ids)))
        items = await conn.fetch(
            f"""SELECT id, text, status, duration FROM dump_items
               WHERE id IN ({item_ids_placeholder}) AND user_id = ${len(promote_request.item_ids) + 1}""",
            *promote_request.item_ids, user["id"]
        )
        
        if len(items) != len(promote_request.item_ids):
            raise HTTPException(status_code=404, detail="Some dump items not found or you don't have permission")
        
        # Filter out already promoted items
        items_to_promote = [item for item in items if item.get('status') != 'promoted']
        
        if not items_to_promote:
            raise HTTPException(status_code=400, detail="All selected items are already promoted")
        
        # Map target to task status
        task_status = 'inbox' if promote_request.target == 'inbox' else ('next' if promote_request.target == 'next_today' else 'later')
        
        # Check Next Today cap if target is next_today
        if task_status == 'next':
            next_count = await conn.fetchval(
                "SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND status = 'next'",
                user["id"]
            )
            NEXT_TODAY_CAP = 1
            available_slots = NEXT_TODAY_CAP - next_count
            
            if available_slots <= 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Next Today is full ({NEXT_TODAY_CAP}). Finish or move something out first."
                )
            
            if len(items_to_promote) > available_slots:
                raise HTTPException(
                    status_code=400,
                    detail=f"Next Today only has {available_slots} slot(s) available. Can only promote {available_slots} item(s)."
                )
        
        # Create tasks for each item
        created_tasks = []
        created_at = datetime.now(timezone.utc)
        
        for item in items_to_promote:
            task_id = str(uuid.uuid4())
            item_duration = item.get('duration', 30)
            logger.info(f"Promoting dump_item {item.get('id')} to task with duration: {item_duration} minutes")
            
            await conn.execute(
                """INSERT INTO tasks (id, user_id, title, status, created_at, priority, urgency, importance, duration)
                   VALUES ($1, $2, $3, $4, $5, 2, 2, 2, $6)""",
                task_id, user["id"], item.get('text', 'Untitled Task'), task_status, created_at, item_duration
            )
            
            # Update dump_item: status='promoted', created_task_id=task_id
            await conn.execute(
                """UPDATE dump_items 
                   SET status = 'promoted', created_task_id = $1
                   WHERE id = $2""",
                task_id, item['id']
            )
            
            # Fetch created task
            task_row = await conn.fetchrow(
                """SELECT id, user_id, title, description, priority, urgency, importance, 
                          scheduled_date::text, scheduled_time, duration, status, created_at::text
                   FROM tasks WHERE id = $1""",
                task_id
            )
            created_tasks.append(dict(task_row))
    
    return {"tasks": created_tasks}

@api_router.get("/dump-items")
async def get_dump_items(
    status: Optional[str] = Query(None, description="Filter by status: 'new', 'promoted', 'dismissed'"),
    include_seed: Optional[int] = Query(0, description="Include seed dumps (0=no, 1=yes). Default: exclude in development."),
    user: dict = Depends(get_current_user)
):
    """Get dump_items for the current user, optionally filtered by status (To Triage endpoint)"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # In development, exclude seed dumps by default unless include_seed=1
        exclude_seed = (ENV == 'development' and include_seed != 1)
        
        # Debug logging for triage fetch
        debug_mode = os.environ.get('EXTRACT_DEBUG') == '1' or ENV == 'development'
        sql_query = None
        field_read = "dump_items.text"  # We read from dump_items.text, not dumps.transcript
        
        if status:
            if exclude_seed:
                sql_query = """SELECT di.id, di.dump_id, di.user_id, di.text, di.status, di.created_task_id, di.duration, di.created_at::text
                               FROM dump_items di
                               INNER JOIN dumps d ON di.dump_id = d.id
                               WHERE di.user_id = $1 AND di.status = $2 AND (d.source != 'seed' OR d.source IS NULL)
                               ORDER BY di.created_at DESC"""
                rows = await conn.fetch(sql_query, user["id"], status)
            else:
                sql_query = """SELECT id, dump_id, user_id, text, status, created_task_id, duration, created_at::text
                   FROM dump_items
                   WHERE user_id = $1 AND status = $2
                               ORDER BY created_at DESC"""
                rows = await conn.fetch(sql_query, user["id"], status)
        else:
            if exclude_seed:
                sql_query = """SELECT di.id, di.dump_id, di.user_id, di.text, di.status, di.created_task_id, di.duration, di.created_at::text
                               FROM dump_items di
                               INNER JOIN dumps d ON di.dump_id = d.id
                               WHERE di.user_id = $1 AND (d.source != 'seed' OR d.source IS NULL)
                               ORDER BY di.created_at DESC"""
                rows = await conn.fetch(sql_query, user["id"])
            else:
                sql_query = """SELECT id, dump_id, user_id, text, status, created_task_id, duration, created_at::text
                   FROM dump_items
                   WHERE user_id = $1
                               ORDER BY created_at DESC"""
                rows = await conn.fetch(sql_query, user["id"])
    
    # Group by dump_id for logging
    dump_counts = {}
    for row in rows:
        dump_id = row.get("dump_id")
        if dump_id:
            dump_counts[dump_id] = dump_counts.get(dump_id, 0) + 1
    
    # Log: triage_fetch (first 5 dumps to avoid log spam)
    for dump_id, row_count in list(dump_counts.items())[:5]:
        dump_items = [r for r in rows if r.get("dump_id") == dump_id]
        first_3_titles = [r.get("text", "")[:50] for r in dump_items[:3]]
        logger.info(json.dumps({
            "stage": "triage_fetch",
            "dump_id": dump_id,
            "row_count": row_count,
            "first_3_titles": first_3_titles,
            "sql_query": sql_query[:200] if sql_query else None,
            "field_read": field_read
        }))
    
    # Add debug info to response if requested
    result = [dict(row) for row in rows]
    if debug_mode and len(result) > 0:
        # Add debug metadata to first item (temporary, for debugging)
        if result:
            result[0]["_debug"] = {
                "sql_query": sql_query[:200] if sql_query else None,
                "field_read": field_read,
                "total_rows": len(rows)
            }
    
    return result

@api_router.get("/debug/dumps/{dump_id}/items")
async def debug_get_dump_items(dump_id: str, user: dict = Depends(get_current_user)):
    """Debug endpoint: Get all dump_items for a dump with full details"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Verify dump belongs to user
        dump = await conn.fetchrow(
            "SELECT id, user_id FROM dumps WHERE id = $1 AND user_id = $2",
            dump_id, user["id"]
        )
        if not dump:
            raise HTTPException(status_code=404, detail="Dump not found or you don't have permission")
        
        # Get all items with full details
        rows = await conn.fetch(
            """SELECT id, dump_id, user_id, text, status, created_task_id, duration, created_at::text
               FROM dump_items 
               WHERE dump_id = $1
               ORDER BY created_at ASC""",
            dump_id
        )
        
        logger.info(f"🔍 DEBUG: Found {len(rows)} dump_items for dump_id={dump_id}")
        for idx, row in enumerate(rows):
            logger.info(f"  Item {idx + 1}: id={row.get('id', '')[:8]}..., text='{row.get('text', '')[:80]}', status={row.get('status')}")
    
    return [dict(row) for row in rows]

@api_router.post("/dump-items/{item_id}/dismiss")
async def dismiss_dump_item(item_id: str, user: dict = Depends(get_current_user)):
    """Dismiss a dump_item (sets status to 'dismissed')"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Verify item belongs to user (authorization check)
        item = await conn.fetchrow(
            """SELECT id, status FROM dump_items
               WHERE id = $1 AND user_id = $2""",
            item_id, user["id"]
        )
        if not item:
            raise HTTPException(status_code=404, detail="Dump item not found or you don't have permission")
        
        # Check if already dismissed or promoted
        if item.get('status') == 'dismissed':
            raise HTTPException(status_code=400, detail="Dump item already dismissed")
        if item.get('status') == 'promoted':
            raise HTTPException(status_code=400, detail="Cannot dismiss promoted item")
        
        # Update status to dismissed
        await conn.execute(
            """UPDATE dump_items 
               SET status = 'dismissed'
               WHERE id = $1""",
            item_id
        )
        
        # Fetch updated item
        updated_row = await conn.fetchrow(
            """SELECT id, dump_id, user_id, text, status, created_task_id, created_at::text
               FROM dump_items WHERE id = $1""",
            item_id
        )
    
    return dict(updated_row)

@api_router.post("/dump-items/dismiss-bulk")
async def dismiss_dump_items_bulk(
    request: dict,  # {item_ids: string[]}
    user: dict = Depends(get_current_user)
):
    """Dismiss multiple dump_items"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    item_ids = request.get("item_ids", [])
    if not item_ids:
        raise HTTPException(status_code=400, detail="item_ids cannot be empty")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Verify all items belong to user (authorization check)
        item_ids_placeholder = ','.join(f'${i+1}' for i in range(len(item_ids)))
        items = await conn.fetch(
            f"""SELECT id, status FROM dump_items
               WHERE id IN ({item_ids_placeholder}) AND user_id = ${len(item_ids) + 1}""",
            *item_ids, user["id"]
        )
        
        if len(items) != len(item_ids):
            raise HTTPException(status_code=404, detail="Some dump items not found or you don't have permission")
        
        # Filter out already dismissed or promoted items
        items_to_dismiss = [item for item in items if item.get('status') not in ['dismissed', 'promoted']]
        
        if not items_to_dismiss:
            raise HTTPException(status_code=400, detail="All selected items are already dismissed or promoted")
        
        # Update status to dismissed
        item_ids_to_dismiss = [item['id'] for item in items_to_dismiss]
        item_ids_placeholder_dismiss = ','.join(f'${i+1}' for i in range(len(item_ids_to_dismiss)))
        await conn.execute(
            f"""UPDATE dump_items 
               SET status = 'dismissed'
               WHERE id IN ({item_ids_placeholder_dismiss}) AND user_id = ${len(item_ids_to_dismiss) + 1}""",
            *item_ids_to_dismiss, user["id"]
        )
    
    return {"dismissed_count": len(items_to_dismiss)}

@api_router.patch("/dump-items/{item_id}/snooze")
async def snooze_dump_item(item_id: str, snooze_request: SnoozeRequest, user: dict = Depends(get_current_user)):
    """Snooze a dump_item until a specific date"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Verify item belongs to user's dump
        item = await conn.fetchrow(
            """SELECT dump_items.id FROM dump_items
               JOIN dumps ON dump_items.dump_id = dumps.id
               WHERE dump_items.id = $1 AND dumps.user_id = $2""",
            item_id, user["id"]
        )
        if not item:
            raise HTTPException(status_code=404, detail="Dump item not found or you don't have permission")
        
        snooze_until_dt = datetime.fromisoformat(snooze_request.snooze_until.replace('Z', '+00:00'))
        
        await conn.execute(
            """UPDATE dump_items 
               SET status = 'snoozed', snooze_until = $1
               WHERE id = $2""",
            snooze_until_dt, item_id
        )
        
        updated_item = await conn.fetchrow(
            """SELECT id, dump_id, created_at::text, text, status,
                      snooze_until::text, linked_task_id
               FROM dump_items WHERE id = $1""",
            item_id
        )
    
    return dict(updated_item)

@api_router.patch("/dump-items/{item_id}/save")
async def save_dump_item(item_id: str, user: dict = Depends(get_current_user)):
    """Save a dump_item to Logbook"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Verify item belongs to user's dump
        item = await conn.fetchrow(
            """SELECT dump_items.id FROM dump_items
               JOIN dumps ON dump_items.dump_id = dumps.id
               WHERE dump_items.id = $1 AND dumps.user_id = $2""",
            item_id, user["id"]
        )
        if not item:
            raise HTTPException(status_code=404, detail="Dump item not found or you don't have permission")
        
        await conn.execute(
            "UPDATE dump_items SET status = 'saved' WHERE id = $1",
            item_id
        )
        
        updated_item = await conn.fetchrow(
            """SELECT id, dump_id, created_at::text, text, status,
                      snooze_until::text, linked_task_id
               FROM dump_items WHERE id = $1""",
            item_id
        )
    
    return dict(updated_item)

@api_router.patch("/dump-items/{item_id}/trash")
async def trash_dump_item(item_id: str, user: dict = Depends(get_current_user)):
    """Trash a dump_item"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Verify item belongs to user's dump
        item = await conn.fetchrow(
            """SELECT dump_items.id FROM dump_items
               JOIN dumps ON dump_items.dump_id = dumps.id
               WHERE dump_items.id = $1 AND dumps.user_id = $2""",
            item_id, user["id"]
        )
        if not item:
            raise HTTPException(status_code=404, detail="Dump item not found or you don't have permission")
        
        await conn.execute(
            "UPDATE dump_items SET status = 'trashed' WHERE id = $1",
            item_id
        )
        
        updated_item = await conn.fetchrow(
            """SELECT id, dump_id, created_at::text, text, status,
                      snooze_until::text, linked_task_id
               FROM dump_items WHERE id = $1""",
            item_id
        )
    
    return dict(updated_item)

@api_router.delete("/dump-items/{item_id}")
async def delete_dump_item(item_id: str, user: dict = Depends(get_current_user)):
    """Delete a dump_item permanently"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Verify item belongs to user's dump
        item = await conn.fetchrow(
            """SELECT dump_items.id FROM dump_items
               JOIN dumps ON dump_items.dump_id = dumps.id
               WHERE dump_items.id = $1 AND dumps.user_id = $2""",
            item_id, user["id"]
        )
        if not item:
            raise HTTPException(status_code=404, detail="Dump item not found or you don't have permission")
        
        await conn.execute(
            "DELETE FROM dump_items WHERE id = $1",
            item_id
        )
    
    return {"success": True}

@api_router.get("/next-today-count")
async def get_next_today_count(user: dict = Depends(get_current_user)):
    """Get count of tasks in Next Today and available slots"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND status = 'next'",
            user["id"]
        )
    
    NEXT_TODAY_CAP = 1
    return {
        "count": count or 0,
        "cap": NEXT_TODAY_CAP,
        "remaining": max(0, NEXT_TODAY_CAP - (count or 0))
    }


# ===== Google Calendar Integration =====

@api_router.get("/auth/google/login")
async def google_login():
    """Start Google OAuth flow"""
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google OAuth not configured")
    
    auth_url = (
        "https://accounts.google.com/o/oauth2/v2/auth?"
        f"client_id={GOOGLE_CLIENT_ID}&"
        f"redirect_uri={GOOGLE_REDIRECT_URI}&"
        "response_type=code&"
        f"scope={' '.join(GOOGLE_SCOPES)}&"
        "access_type=offline&"
        "prompt=consent"
    )
    return {"authorization_url": auth_url}


@api_router.get("/auth/google/callback")
async def google_callback(code: str = Query(None)):
    """Handle Google OAuth callback - DISABLED for Calendar sync"""
    return RedirectResponse(f"{FRONTEND_URL}?google_error=Google Calendar sync is currently disabled")


@api_router.get("/auth/google/status")
async def google_status():
    """Check if Google Calendar is connected - DISABLED: pending Supabase migration"""
    return {"connected": False, "message": "Google Calendar sync is currently disabled"}


@api_router.post("/auth/google/disconnect")
async def google_disconnect():
    """Disconnect Google Calendar - DISABLED: pending Supabase migration"""
    return {"success": True, "message": "Google Calendar sync is currently disabled"}


async def get_google_credentials():
    """Get valid Google credentials - DISABLED"""
    return None


@api_router.post("/calendar/sync")
async def sync_to_google_calendar():
    """Sync all scheduled tasks to Google Calendar - DISABLED"""
    raise HTTPException(status_code=503, detail="Google Calendar sync is currently disabled")


@api_router.post("/calendar/sync-task/{task_id}")
async def sync_single_task(task_id: str):
    """Sync a single task to Google Calendar - DISABLED"""
    raise HTTPException(status_code=503, detail="Google Calendar sync is currently disabled")


# Dump models and endpoints are defined above, starting around line 1749
# Duplicate removed here - see # ===== Dump (Transmission) System ===== section above
# (This comment is just to prevent accidental re-addition)
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    source: str = Field(..., description="Source type: 'voice' or 'text'")
    raw_text: str
    transcript: Optional[str] = None
    clarified_at: Optional[str] = None
    archived_at: Optional[str] = None

class DumpCreate(BaseModel):
    source: str = Field(..., description="Source type: 'voice' or 'text'")
    raw_text: str
    transcript: Optional[str] = None
    title: Optional[str] = None

# Dump endpoints
@api_router.get("/dumps", response_model=List[Dump])
async def get_dumps(archived: Optional[bool] = Query(None, description="Filter by archived status"), 
                    user: dict = Depends(get_current_user)):
    """Get all dumps for the current user, newest first. Returns [] if table doesn't exist (dev mode)."""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        try:
            # Check if dumps table exists - if not, return empty list (graceful degradation)
            table_exists = await conn.fetchval(
                """SELECT EXISTS (
                   SELECT 1 FROM information_schema.tables 
                   WHERE table_schema = 'public' 
                   AND table_name = 'dumps'
                )"""
            )
            
            if not table_exists:
                logger.warning(f"dumps table does not exist for user {user['id']}. Returning empty list.")
                return []
        except Exception as e:
            logger.error(f"Error checking for dumps table: {e}")
            # In dev mode, return empty list instead of crashing
            if ENV != 'production':
                return []
            raise HTTPException(status_code=500, detail="Database error")
        
        try:
            if archived is None:
                # Get non-archived dumps by default
                rows = await conn.fetch(
                    """SELECT id, user_id, created_at::text, source, raw_text, transcript, title,
                              clarified_at::text, archived_at::text
                       FROM dumps 
                       WHERE user_id = $1 AND archived_at IS NULL
                       ORDER BY created_at DESC""",
                    user["id"]
                )
            else:
                rows = await conn.fetch(
                    """SELECT id, user_id, created_at::text, source, raw_text, transcript, title,
                              clarified_at::text, archived_at::text
                       FROM dumps 
                       WHERE user_id = $1 AND (archived_at IS NULL) = $2
                       ORDER BY created_at DESC""",
                    user["id"], not archived
                )
            
            return [dict(row) for row in rows]
        except Exception as e:
            error_str = str(e).lower()
            if "does not exist" in error_str or "relation" in error_str or "table" in error_str or "column" in error_str:
                logger.warning(f"Database schema issue with dumps table: {e}. Returning empty list.")
                # In dev mode, return empty list instead of crashing
                if ENV != 'production':
                    return []
                raise HTTPException(
                    status_code=500,
                    detail=f"Database schema error: {str(e)}"
                )
            logger.error(f"Error fetching dumps: {e}", exc_info=True)
            raise HTTPException(
                status_code=500,
                detail=f"Error fetching dumps: {str(e)}"
            )

@api_router.get("/dumps/{dump_id}")
async def get_dump(dump_id: str, user: dict = Depends(get_current_user)):
    """Get a single dump by ID with its items"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Get dump
        dump_row = await conn.fetchrow(
            """SELECT id, user_id, created_at::text, source, raw_text, transcript, title,
                      clarified_at::text, archived_at::text
               FROM dumps
               WHERE id = $1 AND user_id = $2""",
            dump_id, user["id"]
        )
    
    if not dump_row:
        raise HTTPException(status_code=404, detail="Dump not found")
    
    # Get items for this dump
    async with pool.acquire() as conn:
        # Get all existing columns in dump_items table
        existing_columns = await get_dump_items_existing_columns(conn)
        
        # Build SELECT query dynamically based on existing columns
        select_parts = []
        
        # Required columns (should always exist)
        if 'id' in existing_columns:
            select_parts.append('id')
        if 'dump_id' in existing_columns:
            select_parts.append('dump_id')
        if 'user_id' in existing_columns:
            select_parts.append('user_id')
        if 'created_at' in existing_columns:
            select_parts.append('created_at::text')
        if 'text' in existing_columns:
            select_parts.append('text')
        if 'status' in existing_columns:
            select_parts.append('status')
        if 'created_task_id' in existing_columns:
            select_parts.append('created_task_id')
        
        # Optional columns (only if they exist)
        if 'duration' in existing_columns:
            select_parts.append('duration')
        if 'description' in existing_columns:
            select_parts.append('description')
        if 'urgency' in existing_columns:
            select_parts.append('urgency')
        if 'importance' in existing_columns:
            select_parts.append('importance')
        if 'priority' in existing_columns:
            select_parts.append('priority')
        if 'energy_required' in existing_columns:
            select_parts.append('energy_required')
        if 'scheduled_date' in existing_columns:
            select_parts.append('scheduled_date::text')
        if 'scheduled_time' in existing_columns:
            select_parts.append('scheduled_time')
        if 'linked_task_id' in existing_columns:
            select_parts.append('linked_task_id')
        if 'snooze_until' in existing_columns:
            select_parts.append('snooze_until::text')
        
        select_clause = ', '.join(select_parts)
        
        item_rows = await conn.fetch(
            f"""SELECT {select_clause}
               FROM dump_items
               WHERE dump_id = $1
               ORDER BY created_at ASC""",
            dump_id
        )
        
        # Log duration values for debugging
        for row in item_rows:
            if 'duration' in row:
                logger.info(f"GET dump: item {row.get('id', 'unknown')} has duration = {row.get('duration')}")
    
    dump_dict = dict(dump_row)
    dump_dict["items"] = [dict(row) for row in item_rows]
    
    return dump_dict

@api_router.patch("/dumps/{dump_id}", response_model=Dump)
async def update_dump(dump_id: str, dump_update: dict, user: dict = Depends(get_current_user)):
    """Update a dump (e.g., archive, clarify)"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Build update query dynamically
        allowed_fields = {'transcript', 'title', 'clarified_at', 'archived_at'}
        update_data = {k: v for k, v in dump_update.items() if k in allowed_fields}
        
        if not update_data:
            raise HTTPException(status_code=400, detail="No valid fields to update")
        
        set_clauses = []
        values = []
        param_num = 1
        
        for key, value in update_data.items():
            if key == 'clarified_at' or key == 'archived_at':
                if value:
                    set_clauses.append(f"{key} = ${param_num}")
                    values.append(datetime.fromisoformat(value.replace('Z', '+00:00')) if isinstance(value, str) else value)
                else:
                    set_clauses.append(f"{key} = NULL")
                param_num += 1 if value else 0
            else:
                set_clauses.append(f"{key} = ${param_num}")
                values.append(value)
                param_num += 1
        
        where_clause = f"id = ${param_num} AND user_id = ${param_num + 1}"
        values.extend([dump_id, user["id"]])
        
        query = f"""UPDATE dumps SET {', '.join(set_clauses)} 
                    WHERE {where_clause}
                    RETURNING id, user_id, created_at::text, source, raw_text, transcript, title,
                              clarified_at::text, archived_at::text"""
        
        row = await conn.fetchrow(query, *values)
        
        if not row:
            raise HTTPException(status_code=404, detail="Dump not found or you don't have permission")
    
    return dict(row)

# Dump Items endpoints
@api_router.post("/dumps/{dump_id}/items", response_model=DumpItem)
async def create_dump_item(dump_id: str, item_data: DumpItemCreate, user: dict = Depends(get_current_user)):
    """Create a new item in a dump"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Verify dump belongs to user
        dump = await conn.fetchrow(
            "SELECT id FROM dumps WHERE id = $1 AND user_id = $2",
            dump_id, user["id"]
        )
        if not dump:
            raise HTTPException(status_code=404, detail="Dump not found or you don't have permission")
        
        item_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc)
        status = item_data.status or "new"
        
        snooze_until_value = None
        if item_data.snooze_until:
            snooze_until_value = datetime.fromisoformat(item_data.snooze_until.replace('Z', '+00:00'))
        
        await conn.execute(
            """INSERT INTO dump_items (id, dump_id, created_at, text, status, snooze_until)
               VALUES ($1, $2, $3, $4, $5, $6)""",
            item_id, dump_id, created_at, item_data.text, status, snooze_until_value
        )
        
        row = await conn.fetchrow(
            """SELECT id, dump_id, created_at::text, text, status, 
                      snooze_until::text, linked_task_id, duration
               FROM dump_items WHERE id = $1""",
            item_id
        )
    
    return dict(row)

@api_router.post("/dumps/{dump_id}/triage")
async def triage_dump_items(dump_id: str, triage_request: TriageRequest, user: dict = Depends(get_current_user)):
    """Convert dump_items to tasks. Enforces Next Today cap of 1."""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    if triage_request.target not in ['INBOX', 'NEXT_TODAY', 'LATER']:
        raise HTTPException(status_code=400, detail="Target must be 'INBOX', 'NEXT_TODAY', or 'LATER'")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Verify dump belongs to user
        dump = await conn.fetchrow(
            "SELECT id FROM dumps WHERE id = $1 AND user_id = $2",
            dump_id, user["id"]
        )
        if not dump:
            raise HTTPException(status_code=404, detail="Dump not found or you don't have permission")
        
        # Get dump_items (verify they belong to this dump and user)
        # Use COALESCE to handle both state and status columns (migration transition)
        item_ids_placeholder = ','.join(f'${i+1}' for i in range(len(triage_request.item_ids)))
        items_query = f"""SELECT di.id, di.text, COALESCE(di.state, di.status, 'new') as item_state, di.user_id, di.duration
                          FROM dump_items di
                          WHERE di.id IN ({item_ids_placeholder}) 
                            AND di.dump_id = $${len(triage_request.item_ids) + 1}
                            AND di.user_id = $${len(triage_request.item_ids) + 2}"""
        
        items = await conn.fetch(
            items_query,
            *triage_request.item_ids, dump_id, user["id"]
        )
        
        if len(items) != len(triage_request.item_ids):
            raise HTTPException(status_code=400, detail="Some dump items not found or don't belong to this dump")
        
        # Check Next Today cap if target is NEXT_TODAY
        if triage_request.target == 'NEXT_TODAY':
            next_count = await conn.fetchval(
                "SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND status = 'next'",
                user["id"]
            )
            NEXT_TODAY_CAP = 1
            available_slots = NEXT_TODAY_CAP - next_count
            
            if available_slots <= 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Next Today is full ({NEXT_TODAY_CAP}). Convert remaining to Inbox or Later."
                )
            
            # If trying to add more items than available slots, only convert what fits
            if len(items) > available_slots:
                raise HTTPException(
                    status_code=400,
                    detail=f"Next Today is full ({NEXT_TODAY_CAP}). Only {available_slots} slot(s) available. Convert remaining to Inbox or Later."
                )
        
        # Map target to task status
        task_status = 'inbox' if triage_request.target == 'INBOX' else ('next' if triage_request.target == 'NEXT_TODAY' else 'later')
        
        # Create tasks from dump_items
        created_tasks = []
        created_at = datetime.now(timezone.utc)
        
        for item in items:
            # Skip if already converted (check item_state which uses COALESCE)
            if item.get('item_state') == 'converted' or item.get('item_state') == 'promoted':
                continue
            
            task_id = str(uuid.uuid4())
            item_duration = item.get('duration', 30)
            logger.info(f"Triaging dump_item {item.get('id')} to task with duration: {item_duration} minutes")
            
            await conn.execute(
                """INSERT INTO tasks (id, user_id, title, status, created_at, priority, urgency, importance, duration)
                   VALUES ($1, $2, $3, $4, $5, 2, 2, 2, $6)""",
                task_id, user["id"], item.get('text', 'Untitled Task'), task_status, created_at, item_duration
            )
            
            # Mark dump_item as converted (try state first, fallback to status for migration transition)
            try:
                await conn.execute(
                    "UPDATE dump_items SET state = 'converted' WHERE id = $1",
                    item['id']
                )
            except Exception:
                # Fallback: if state column doesn't exist, use status
                try:
                    await conn.execute(
                        "UPDATE dump_items SET status = 'converted' WHERE id = $1",
                        item['id']
                    )
                except Exception as e:
                    logger.warning(f"Failed to update dump_item state/status: {e}")
            
            # Fetch created task
            task = await conn.fetchrow(
                """SELECT id, user_id, title, description, priority, urgency, importance,
                      scheduled_date::text, scheduled_time, duration, status, created_at::text
                   FROM tasks WHERE id = $1""",
                task_id
            )
            if task:
                created_tasks.append(dict(task))
    
    return {"tasks": created_tasks}

# Include the router in the main app
app.include_router(api_router)

# ============ BACKWARD COMPATIBILITY: Root-level route aliases ============
# Add root-level aliases for key endpoints (health, dumps) for backward compatibility
# These delegate to the same handlers as /api routes

@app.get("/health")
async def health_root():
    """Root-level health endpoint (alias for /api/health)"""
    return {"status": "healthy"}

# Root-level dump endpoint aliases (for backward compatibility)
# These delegate to the handlers defined in api_router
# Both /dumps and /api/dumps routes work for all dump operations

@app.post("/dumps", response_model=Dump)
async def create_dump_root(dump_data: DumpCreate, user: dict = Depends(get_current_user)):
    """Root-level POST /dumps endpoint (alias for /api/dumps)"""
    # Delegate to the existing create_dump handler (defined above in api_router)
    return await create_dump(dump_data, user)

@app.get("/dumps", response_model=List[Dump])
async def get_dumps_root(
    archived: Optional[bool] = Query(None, description="Filter by archived status"), 
    user: dict = Depends(get_current_user)
):
    """Root-level GET /dumps endpoint (alias for /api/dumps) - returns [] if not authenticated or table missing"""
    # Delegate to the existing get_dumps handler (defined above in api_router)
    # This will handle authentication and graceful degradation for missing tables
    try:
        return await get_dumps(archived, user)
    except HTTPException as e:
        # Re-raise HTTP exceptions (401, 500, etc.) as-is
        raise
    except Exception as e:
        # Catch any other unexpected errors and return empty list in dev mode
        logger.error(f"Unexpected error in get_dumps_root: {e}", exc_info=True)
        if ENV != 'production':
            return []
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/dumps/{dump_id}", response_model=Dump)
async def get_dump_root(dump_id: str, user: dict = Depends(get_current_user)):
    """Root-level GET /dumps/{dump_id} endpoint (alias for /api/dumps/{dump_id})"""
    # Delegate to the existing get_dump handler (defined above in api_router)
    return await get_dump(dump_id, user)

@app.post("/dumps/{dump_id}/extract")
async def extract_dump_root(dump_id: str, user: dict = Depends(get_current_user)):
    """Root-level POST /dumps/{dump_id}/extract endpoint (alias for /api/dumps/{dump_id}/extract)"""
    # Delegate to the extract_dump handler (which itself delegates to clarify_dump)
    return await extract_dump(dump_id, user)

@app.post("/dumps/{dump_id}/triage")
async def triage_dump_root(dump_id: str, triage_request: TriageRequest, user: dict = Depends(get_current_user)):
    """Root-level POST /dumps/{dump_id}/triage endpoint (alias for /api/dumps/{dump_id}/triage)"""
    # Delegate to the existing triage_dump_items handler
    return await triage_dump_items(dump_id, triage_request, user)


# Debug endpoint for extraction investigation
@api_router.get("/debug/dumps/{dump_id}/extraction")
async def get_extraction_debug(dump_id: str, user: dict = Depends(get_current_user)):
    """
    Debug endpoint to inspect extraction details for a dump.
    
    Returns:
        - segments sent to LLM
        - raw LLM output
        - final tasks after postprocessing
        - dump_items in DB
    """
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Verify dump belongs to user
        dump = await conn.fetchrow(
            "SELECT id, user_id, transcript, extraction_debug FROM dumps WHERE id = $1 AND user_id = $2",
            dump_id, user["id"]
        )
        if not dump:
            raise HTTPException(status_code=404, detail="Dump not found or you don't have permission")
        
        # Get extraction_debug from DB
        extraction_debug = None
        if dump.get("extraction_debug"):
            try:
                extraction_debug = json.loads(dump.get("extraction_debug"))
            except:
                extraction_debug = dump.get("extraction_debug")
        
        # Get dump_items from DB
        db_dump_items = await conn.fetch(
            """SELECT id, dump_id, text, status, created_at::text
               FROM dump_items
               WHERE dump_id = $1
               ORDER BY created_at ASC""",
            dump_id
        )
        
        return {
            "dump_id": dump_id,
            "trace_id": extraction_debug.get("trace_id") if extraction_debug else None,
            "segments": extraction_debug.get("segments") if extraction_debug else None,
            "llm_raw": extraction_debug.get("llm_raw") if extraction_debug else None,
            "final_tasks": extraction_debug.get("final_tasks") if extraction_debug else None,
            "insert_payload": extraction_debug.get("insert_payload") if extraction_debug else None,
            "fallback_reason": extraction_debug.get("fallback_reason") if extraction_debug else None,
            "db_dump_items": [dict(row) for row in db_dump_items],
            "db_dump_items_count": len(db_dump_items),
            "transcript_length": len(dump.get("transcript", "") or "")
        }


# Google Calendar callback route - DISABLED
@app.get("/gcal")
async def google_callback_root(code: str = Query(None)):
    """Handle Google OAuth callback - DISABLED"""
    return RedirectResponse(f"{FRONTEND_URL}?google_error=Google Calendar sync is currently disabled")

# CORS middleware already added above (before routes)

# Root redirect to API docs in development
@app.get("/")
async def root():
    """Redirect root to API documentation"""
    if ENV == 'production':
        return {"message": "ADD Daily API", "docs": "API documentation is disabled in production"}
    return RedirectResponse(url="/api/docs")

@app.on_event("shutdown")
async def shutdown_db_client():
    global db_pool
    if db_pool:
        await db_pool.close()
