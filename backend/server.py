from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, Query, Depends
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
from typing import List, Optional
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


# Helper function to get AI response
async def get_ai_response(transcript: str, provider: str, model: str) -> dict:
    """
    Extract tasks from transcript using AI with strict JSON schema.
    
    Returns tasks in the format expected by the frontend.
    """
    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")
    
    system_message = """You are a task extraction AI. Extract ALL tasks from user's voice input.

CRITICAL RULE: You MUST extract EVERY task mentioned in the input as a separate task object. If the user says multiple things, each one is a separate task.

EXAMPLES OF MULTIPLE TASKS:
Input: "Go to the gym for hours. Grocery shopping, that's very important, that's 90 minutes. And then meet parents, that's three hours in the evening, that's also very important."
Output: 3 tasks:
1. "Go to the gym" (duration: estimate based on "for hours" or use default)
2. "Grocery shopping" (priority: high, duration: 90 minutes)
3. "Meet parents" (priority: high, duration: 180 minutes, notes: "in the evening")

Input: "Call the dentist tomorrow, urgent. Buy groceries this weekend. Also schedule a meeting."
Output: 3 tasks:
1. "Call the dentist" (due_date: tomorrow, priority: high)
2. "Buy groceries" (due_date: this weekend)
3. "Schedule a meeting"

Input: "I need to do X, Y, and Z"
Output: 3 tasks: X, Y, Z
    
For each task, determine:
- title: A clear, concise task title (required) - extract from the spoken text
- due_date: Date in YYYY-MM-DD format if mentioned, otherwise null
- notes: Additional details, context, or notes about the task (can be null)
- priority: One of "low", "medium", "high", or null if not specified. If user says "important", "urgent", "critical" → use "high"
- duration_minutes: Duration in minutes if mentioned. Examples:
  * "2 hours" or "two hours" → 120
  * "3 hours" or "three hours" → 180
  * "30 minutes" or "half an hour" → 30
  * "90 minutes" or "90 mins" → 90
  * "an hour" or "one hour" → 60
  * "for hours" (vague) → null or estimate (e.g., 60)
  If not mentioned, use null.

SEPARATION RULES - These indicate separate tasks:
- Periods (.) between sentences
- "And then", "Also", "And", "Then"
- Commas followed by new context
- Numbered lists ("first", "second", "task 1", etc.)

Respond ONLY with a JSON object in this exact format (no markdown, no code blocks):
{
  "tasks": [
    {
      "title": "string",
      "due_date": "string or null",
      "notes": "string or null",
      "priority": "low" | "medium" | "high" | null,
      "duration_minutes": number or null
    }
  ],
  "summary": "Brief summary of what was extracted"
}

If no tasks can be extracted, return {"tasks": [], "summary": "No tasks found"}

IMPORTANT: Return ONLY valid JSON. Do not wrap in markdown code blocks. Extract ALL tasks mentioned - count them carefully."""
    
    # Map provider/model to OpenAI model
    openai_model = get_model_for_provider(provider, model)
    
    user_prompt = f"""Extract ALL tasks from this voice transcript. Count how many distinct tasks are mentioned and extract EVERY one as a separate task object.

Look for:
- Sentences separated by periods
- Phrases connected by "and", "also", "then", "and then"
- Each distinct activity or action mentioned

Duration patterns to extract:
- "X hours" or "X hour" → duration_minutes: X * 60
- "X minutes" or "X mins" → duration_minutes: X
- "for hours" (vague) → estimate or null

Priority indicators:
- "important", "very important", "urgent", "critical" → priority: "high"
- "not urgent", "low priority" → priority: "low"

Transcript: {transcript}

IMPORTANT: Count the number of tasks first, then extract each one. If you see 3 distinct activities, return 3 task objects."""
    
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
        
        logger.info(f"Extracted {len(tasks)} tasks from AI response")
        
        if len(tasks) == 0:
            logger.warning(f"No tasks extracted from transcript: {transcript[:200]}")
            return {
                "tasks": [],
                "summary": raw_result.get("summary", "No tasks found in transcript")
            }
        
        # Transform each task to frontend format
        transformed_tasks = []
        for i, task_data in enumerate(tasks):
            if not isinstance(task_data, dict):
                logger.warning(f"Skipping invalid task {i} (not a dict): {task_data}")
                continue
            
            try:
                logger.info(f"Transforming task {i+1}: {json.dumps(task_data, indent=2)}")
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
        if status:
            rows = await conn.fetch(
                """SELECT id, user_id, title, description, priority, urgency, importance, 
                   scheduled_date::text, scheduled_time, duration, status, created_at::text
                   FROM tasks WHERE user_id = $1 AND status = $2 ORDER BY priority DESC""",
                user["id"], status
            )
        else:
            rows = await conn.fetch(
                """SELECT id, user_id, title, description, priority, urgency, importance, 
                   scheduled_date::text, scheduled_time, duration, status, created_at::text
                   FROM tasks WHERE user_id = $1 ORDER BY priority DESC""",
                user["id"]
            )
    return [dict(row) for row in rows]

@api_router.get("/tasks/{task_id}", response_model=Task)
async def get_task(task_id: str, user: dict = Depends(get_current_user)):
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT id, user_id, title, description, priority, urgency, importance, 
               scheduled_date::text, scheduled_time, duration, status, expires_at::text, created_at::text
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
        # Build dynamic update query with proper parameterization
        # Only allow updating specific fields that exist in the database
        allowed_fields = {'title', 'description', 'priority', 'urgency', 'importance', 
                         'scheduled_date', 'scheduled_time', 'duration', 'status', 'expires_at', 'sort_order', 'energy_required'}
        filtered_data = {k: v for k, v in update_data.items() if k in allowed_fields}
        
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
        energy_required_exists = await conn.fetchval(
            """SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'energy_required')"""
        )
        
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
            if 'urgency' in filtered_data or 'importance' in filtered_data:
                logger.info(f"  Urgency: {filtered_data.get('urgency')}, Importance: {filtered_data.get('importance')}")
            row = await conn.fetchrow(query, *values)
            
            if not row:
                raise HTTPException(status_code=404, detail="Task not found or you don't have permission")
            
            return dict(row)
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
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        result = await conn.execute("DELETE FROM tasks WHERE id = $1 AND user_id = $2", task_id, user["id"])
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
            return {
                "count": 0,
                "_error": "completed_at column does not exist. Please run migration: ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE NULL;"
            }
        
        try:
            # Parse ISO date strings to timestamps for range query
            # Start: beginning of start date
            start_dt = datetime.fromisoformat(start.replace('Z', '+00:00')) if 'T' in start else datetime.strptime(start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            # End: end of end date (23:59:59.999)
            end_dt = datetime.fromisoformat(end.replace('Z', '+00:00')) if 'T' in end else datetime.strptime(end, "%Y-%m-%d").replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=timezone.utc)
            
            # Query tasks with completed_at within range
            count = await conn.fetchval(
                """SELECT COUNT(*) FROM tasks 
                   WHERE user_id = $1 
                   AND completed_at IS NOT NULL
                   AND completed_at >= $2 
                   AND completed_at <= $3""",
                user["id"], start_dt, end_dt
            )
            
            return {"count": count or 0}
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
        
        # Transcribe using OpenAI Whisper
        transcript_text = await transcribe_audio_file(
            audio_file_path=tmp_path,
                model="whisper-1",
                language="en"
            )
        
        # Clean up temp file
        os.unlink(tmp_path)
        tmp_path = None
        
        return {"success": True, "transcript": transcript_text}
        
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
    status: str = Field(default="new", description="Status: 'new', 'promoted', 'dismissed'")
    created_task_id: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class Dump(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    source: str = Field(..., description="Source type: 'voice' or 'text'")
    raw_text: str
    transcript: Optional[str] = None
    clarified_at: Optional[str] = None
    archived_at: Optional[str] = None
    items: Optional[List[DumpItem]] = Field(default_factory=list, description="Extracted items")

class DumpCreate(BaseModel):
    source: str = Field(..., description="Source type: 'voice' or 'text'")
    raw_text: str
    transcript: Optional[str] = None

class DumpItemCreate(BaseModel):
    text: str
    status: Optional[str] = Field(default="new")
    snooze_until: Optional[str] = None

class DumpItemUpdate(BaseModel):
    text: Optional[str] = None
    status: Optional[str] = None
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

# Helper function to extract items from raw_text
async def extract_items_from_dump(dump_id: str, raw_text: str, user_id: str, pool) -> list:
    """Extract items from raw_text and create dump_items. Returns list of created items."""
    items_text = []
    
    # Split by commas first
    comma_split = [item.strip() for item in raw_text.split(',') if item.strip()]
    
    # Then split each by newlines
    for item in comma_split:
        lines = [line.strip() for line in item.split('\n') if line.strip()]
        items_text.extend(lines)
    
    # Handle bullet points (split each line that starts with bullet markers)
    final_items = []
    for line in items_text:
        # Check for bullet points (-, *, •, etc.)
        for marker in ['- ', '* ', '• ', '— ', '– ']:
            if line.startswith(marker):
                item_text = line[len(marker):].strip()
                if item_text:
                    final_items.append(item_text)
                break
        else:
            # Regular line
            final_items.append(line)
    
    # Dedupe (preserve order)
    seen = set()
    deduped_items = []
    for item in final_items:
        if item and item.lower() not in seen:
            seen.add(item.lower())
            deduped_items.append(item)
    
    # If we got no items from parsing, create one item with the full text
    if not deduped_items:
        deduped_items = [raw_text] if raw_text else []
    
    # Create dump_items with status='new'
    created_items = []
    created_at = datetime.now(timezone.utc)
    
    async with pool.acquire() as conn:
        for item_text in deduped_items:
            item_id = str(uuid.uuid4())
            await conn.execute(
                """INSERT INTO dump_items (id, dump_id, user_id, text, status, created_at)
                   VALUES ($1, $2, $3, $4, 'new', $5)""",
                item_id, dump_id, user_id, item_text, created_at
            )
            
            row = await conn.fetchrow(
                """SELECT id, dump_id, user_id, text, status, created_task_id, created_at::text
                   FROM dump_items WHERE id = $1""",
                item_id
            )
            created_items.append(dict(row))
        
        # Set clarified_at on dump
        await conn.execute(
            "UPDATE dumps SET clarified_at = $1 WHERE id = $2",
            created_at, dump_id
        )
    
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
    async with pool.acquire() as conn:
        dump_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc)
        
        await conn.execute(
            """INSERT INTO dumps (id, user_id, created_at, source, raw_text, transcript)
               VALUES ($1, $2, $3, $4, $5, $6)""",
            dump_id, user["id"], created_at, dump_data.source, dump_data.raw_text, dump_data.transcript
        )
        
        dump_row = await conn.fetchrow(
            """SELECT id, user_id, created_at::text, source, raw_text, transcript, 
                      clarified_at::text, archived_at::text
               FROM dumps WHERE id = $1""",
            dump_id
        )
    
    dump_dict = dict(dump_row)
    
    # Auto-extract if requested
    items = []
    if auto_extract == 1:
        items = await extract_items_from_dump(dump_id, dump_data.raw_text, user["id"], pool)
    
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
                    """SELECT id, user_id, created_at::text, source, raw_text, transcript,
                              clarified_at::text, archived_at::text
                       FROM dumps 
                       WHERE user_id = $1 AND archived_at IS NULL
                       ORDER BY created_at DESC""",
                    user["id"]
                )
            else:
                rows = await conn.fetch(
                    """SELECT id, user_id, created_at::text, source, raw_text, transcript,
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
        allowed_fields = {'transcript', 'clarified_at', 'archived_at'}
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
                    RETURNING id, user_id, created_at::text, source, raw_text, transcript,
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
                      snooze_until::text, linked_task_id
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
        
        rows = await conn.fetch(
            """SELECT id, dump_id, created_at::text, text, status,
                      snooze_until::text, linked_task_id
               FROM dump_items 
               WHERE dump_id = $1
               ORDER BY created_at ASC""",
            dump_id
        )
    
    return [dict(row) for row in rows]

@api_router.patch("/dump-items/{item_id}", response_model=DumpItem)
async def update_dump_item(item_id: str, item_update: DumpItemUpdate, user: dict = Depends(get_current_user)):
    """Update a dump item"""
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
        
        update_data = {k: v for k, v in item_update.model_dump().items() if v is not None}
        if not update_data:
            raise HTTPException(status_code=400, detail="No update data provided")
        
        set_clauses = []
        values = []
        param_num = 1
        
        for key, value in update_data.items():
            if key == 'snooze_until':
                if value:
                    set_clauses.append(f"{key} = ${param_num}")
                    values.append(datetime.fromisoformat(value.replace('Z', '+00:00')))
                else:
                    set_clauses.append(f"{key} = NULL")
                param_num += 1 if value else 0
            else:
                set_clauses.append(f"{key} = ${param_num}")
                values.append(value)
                param_num += 1
        
        where_clause = f"id = ${param_num}"
        values.append(item_id)
        
        query = f"""UPDATE dump_items SET {', '.join(set_clauses)} 
                    WHERE {where_clause}
                    RETURNING id, dump_id, created_at::text, text, status,
                              snooze_until::text, linked_task_id"""
        
        row = await conn.fetchrow(query, *values)
    
    return dict(row)

@api_router.post("/dumps/{dump_id}/extract")
async def extract_dump(dump_id: str, user: dict = Depends(get_current_user)):
    """Extract items from dump.raw_text into dump_items (does NOT create tasks)"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Verify dump belongs to user
        dump = await conn.fetchrow(
            """SELECT id, raw_text FROM dumps 
               WHERE id = $1 AND user_id = $2""",
            dump_id, user["id"]
        )
        if not dump:
            raise HTTPException(status_code=404, detail="Dump not found or you don't have permission")
        
        raw_text = dump.get('raw_text', '')
    
    # Use shared extraction logic
    items = await extract_items_from_dump(dump_id, raw_text, user["id"], pool)
    
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
            """SELECT id, text, status FROM dump_items
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
        
        # Create task
        task_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc)
        
        await conn.execute(
            """INSERT INTO tasks (id, user_id, title, status, created_at, priority, urgency, importance, duration)
               VALUES ($1, $2, $3, $4, $5, 2, 2, 2, 30)""",
            task_id, user["id"], item.get('text', 'Untitled Task'), task_status, created_at
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
            f"""SELECT id, text, status FROM dump_items
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
            await conn.execute(
                """INSERT INTO tasks (id, user_id, title, status, created_at, priority, urgency, importance, duration)
                   VALUES ($1, $2, $3, $4, $5, 2, 2, 2, 30)""",
                task_id, user["id"], item.get('text', 'Untitled Task'), task_status, created_at
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
    user: dict = Depends(get_current_user)
):
    """Get dump_items for the current user, optionally filtered by status"""
    if not user or not user.get("id"):
        raise HTTPException(status_code=401, detail="User authentication required")
    
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        if status:
            rows = await conn.fetch(
                """SELECT id, dump_id, user_id, text, status, created_task_id, created_at::text
                   FROM dump_items
                   WHERE user_id = $1 AND status = $2
                   ORDER BY created_at DESC""",
                user["id"], status
            )
        else:
            rows = await conn.fetch(
                """SELECT id, dump_id, user_id, text, status, created_task_id, created_at::text
                   FROM dump_items
                   WHERE user_id = $1
                   ORDER BY created_at DESC""",
                user["id"]
            )
    
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

class DumpItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    dump_id: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    text: str
    status: str = Field(default="new", description="Status: 'new', 'promoted', 'snoozed', 'saved', 'trashed'")
    snooze_until: Optional[str] = None
    linked_task_id: Optional[str] = None

class DumpItemCreate(BaseModel):
    text: str
    status: Optional[str] = Field(default="new")
    snooze_until: Optional[str] = None

class DumpItemUpdate(BaseModel):
    text: Optional[str] = None
    status: Optional[str] = None
    snooze_until: Optional[str] = None
    linked_task_id: Optional[str] = None

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
                    """SELECT id, user_id, created_at::text, source, raw_text, transcript,
                              clarified_at::text, archived_at::text
                       FROM dumps 
                       WHERE user_id = $1 AND archived_at IS NULL
                       ORDER BY created_at DESC""",
                    user["id"]
                )
            else:
                rows = await conn.fetch(
                    """SELECT id, user_id, created_at::text, source, raw_text, transcript,
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
            """SELECT id, user_id, created_at::text, source, raw_text, transcript,
                      clarified_at::text, archived_at::text
               FROM dumps
               WHERE id = $1 AND user_id = $2""",
            dump_id, user["id"]
        )
    
    if not dump_row:
        raise HTTPException(status_code=404, detail="Dump not found")
    
    # Get items for this dump
    async with pool.acquire() as conn:
        item_rows = await conn.fetch(
            """SELECT id, dump_id, user_id, text, status, created_task_id, created_at::text
               FROM dump_items
               WHERE dump_id = $1
               ORDER BY created_at ASC""",
            dump_id
        )
    
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
        allowed_fields = {'transcript', 'clarified_at', 'archived_at'}
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
                    RETURNING id, user_id, created_at::text, source, raw_text, transcript,
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
                      snooze_until::text, linked_task_id
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
        
        rows = await conn.fetch(
            """SELECT id, dump_id, created_at::text, text, status,
                      snooze_until::text, linked_task_id
               FROM dump_items 
               WHERE dump_id = $1
               ORDER BY created_at ASC""",
            dump_id
        )
    
    return [dict(row) for row in rows]

@api_router.patch("/dump-items/{item_id}", response_model=DumpItem)
async def update_dump_item(item_id: str, item_update: DumpItemUpdate, user: dict = Depends(get_current_user)):
    """Update a dump item"""
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
        
        update_data = {k: v for k, v in item_update.model_dump().items() if v is not None}
        if not update_data:
            raise HTTPException(status_code=400, detail="No update data provided")
        
        set_clauses = []
        values = []
        param_num = 1
        
        for key, value in update_data.items():
            if key == 'snooze_until':
                if value:
                    set_clauses.append(f"{key} = ${param_num}")
                    values.append(datetime.fromisoformat(value.replace('Z', '+00:00')))
                else:
                    set_clauses.append(f"{key} = NULL")
                param_num += 1 if value else 0
            else:
                set_clauses.append(f"{key} = ${param_num}")
                values.append(value)
                param_num += 1
        
        where_clause = f"id = ${param_num}"
        values.append(item_id)
        
        query = f"""UPDATE dump_items SET {', '.join(set_clauses)} 
                    WHERE {where_clause}
                    RETURNING id, dump_id, created_at::text, text, status,
                              snooze_until::text, linked_task_id"""
        
        row = await conn.fetchrow(query, *values)
    
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
        items_query = f"""SELECT di.id, di.text, COALESCE(di.state, di.status, 'new') as item_state, di.user_id
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
            await conn.execute(
                """INSERT INTO tasks (id, user_id, title, status, created_at, priority, urgency, importance, duration)
                   VALUES ($1, $2, $3, $4, $5, 2, 2, 2, 30)""",
                task_id, user["id"], item.get('text', 'Untitled Task'), task_status, created_at
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
