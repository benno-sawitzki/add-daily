from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, Query, Depends
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import asyncpg
import ssl
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
from emergentintegrations.llm.chat import LlmChat, UserMessage
from emergentintegrations.llm.openai import OpenAISpeechToText
import json
import tempfile
import requests
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request as GoogleRequest
from googleapiclient.discovery import build
import jwt
from passlib.context import CryptContext

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Google OAuth Config
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET')
FRONTEND_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://voicetask-8.preview.emergentagent.com')
GOOGLE_REDIRECT_URI = f"{FRONTEND_URL}/gcal"
GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/userinfo.email']

# PostgreSQL connection (Supabase)
DATABASE_URL = os.environ.get('DATABASE_URL')
db_pool = None

async def get_db_pool():
    global db_pool
    if db_pool is None:
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE
        db_pool = await asyncpg.create_pool(DATABASE_URL, ssl=ssl_ctx, min_size=1, max_size=10)
    return db_pool

# Create the main app with docs at /api/docs
app = FastAPI(docs_url="/api/docs", redoc_url="/api/redoc", openapi_url="/api/openapi.json")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

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
    status: str = Field(default="inbox")  # inbox, scheduled, completed
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

# Helper function to get AI response
async def get_ai_response(transcript: str, provider: str, model: str) -> dict:
    api_key = os.environ.get('EMERGENT_LLM_KEY')
    if not api_key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY not configured")
    
    system_message = """You are a task extraction and prioritization AI. Extract tasks from user's voice input.
    
For each task, determine:
- title: A clear, concise task title (remove any duration mentions from the title)
- description: Additional details if provided
- urgency: 1-4 scale (1=not urgent, 4=extremely urgent)
- importance: 1-4 scale (1=not important, 4=very important)
- priority: Calculate as (urgency + importance) / 2, round to nearest integer
- duration: Duration in MINUTES. Listen for phrases like:
  - "for an hour" or "one hour" or "1 hour" = 60
  - "30 minutes" or "half an hour" = 30
  - "2 hours" or "two hours" = 120
  - "15 minutes" or "quarter hour" = 15
  - "should take about X" or "takes X" = extract X
  - If no duration mentioned, use null

Respond ONLY with a JSON object in this exact format:
{
  "tasks": [
    {
      "title": "string",
      "description": "string",
      "urgency": number,
      "importance": number,
      "priority": number,
      "duration": number or null
    }
  ],
  "summary": "Brief summary of what was extracted"
}

If no tasks can be extracted, return {"tasks": [], "summary": "No tasks found"}"""
    
    chat = LlmChat(
        api_key=api_key,
        session_id=str(uuid.uuid4()),
        system_message=system_message
    )
    
    chat.with_model(provider, model)
    
    user_message = UserMessage(text=f"Extract and prioritize tasks from this voice input: {transcript}")
    response = await chat.send_message(user_message)
    
    # Parse JSON from response
    try:
        # Try to extract JSON from the response
        response_text = response.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]
        
        return json.loads(response_text.strip())
    except json.JSONDecodeError:
        logger.error(f"Failed to parse AI response: {response}")
        return {"tasks": [], "summary": "Failed to parse response"}

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
        await conn.execute(
            """INSERT INTO tasks (id, user_id, title, description, priority, urgency, importance, 
               scheduled_date, scheduled_time, duration, status, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)""",
            task.id, user["id"], task.title, task.description, task.priority, task.urgency, task.importance,
            task.scheduled_date, task.scheduled_time, task.duration, task.status, datetime.now(timezone.utc)
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
               scheduled_date::text, scheduled_time, duration, status, created_at::text
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
        # Build dynamic update query
        set_clauses = []
        values = []
        for i, (key, value) in enumerate(update_data.items(), start=1):
            set_clauses.append(f"{key} = ${i}")
            values.append(value)
        values.extend([task_id, user["id"]])
        
        query = f"UPDATE tasks SET {', '.join(set_clauses)} WHERE id = ${len(values)-1} AND user_id = ${len(values)}"
        result = await conn.execute(query, *values)
        
        if result == "UPDATE 0":
            raise HTTPException(status_code=404, detail="Task not found")
        
        row = await conn.fetchrow(
            """SELECT id, user_id, title, description, priority, urgency, importance, 
               scheduled_date::text, scheduled_time, duration, status, created_at::text
               FROM tasks WHERE id = $1""",
            task_id
        )
    return dict(row)

@api_router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, user: dict = Depends(get_current_user)):
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        result = await conn.execute("DELETE FROM tasks WHERE id = $1 AND user_id = $2", task_id, user["id"])
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "Task deleted"}

# Voice processing - Queue mode (returns tasks for review, doesn't save yet)
@api_router.post("/tasks/process-voice-queue")
async def process_voice_queue(voice_input: VoiceInput, user: dict = Depends(get_current_user)):
    """Process voice transcript and return tasks for review (not saved yet)"""
    try:
        result = await get_ai_response(
            voice_input.transcript,
            voice_input.provider,
            voice_input.model
        )
        
        # Create task objects but don't save them yet
        tasks_for_review = []
        for i, task_data in enumerate(result.get("tasks", [])):
            # Use AI-extracted duration if available, otherwise default to 30 minutes
            ai_duration = task_data.get("duration")
            duration = ai_duration if ai_duration and isinstance(ai_duration, (int, float)) and ai_duration > 0 else 30
            
            task = {
                "id": str(uuid.uuid4()),
                "title": task_data.get("title", "Untitled Task"),
                "description": task_data.get("description", ""),
                "urgency": task_data.get("urgency", 2),
                "importance": task_data.get("importance", 2),
                "priority": task_data.get("priority", 2),
                "duration": int(duration),  # AI-extracted or default 30 minutes
                "order": i,
            }
            tasks_for_review.append(task)
        
        # Sort by priority (highest first)
        tasks_for_review.sort(key=lambda t: t["priority"], reverse=True)
        
        return {
            "success": True,
            "tasks": tasks_for_review,
            "summary": result.get("summary", "Tasks extracted")
        }
    except Exception as e:
        logger.error(f"Error processing voice: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


class PushToCalendarRequest(BaseModel):
    tasks: List[dict]


# Push tasks to inbox
@api_router.post("/tasks/push-to-inbox")
async def push_to_inbox(request: PushToCalendarRequest, user: dict = Depends(get_current_user)):
    """Save tasks to inbox (not scheduled)"""
    try:
        created_tasks = []
        pool = await get_db_pool()
        
        async with pool.acquire() as conn:
            for task_data in request.tasks:
                task_id = task_data.get("id", str(uuid.uuid4()))
                await conn.execute(
                    """INSERT INTO tasks (id, user_id, title, description, priority, urgency, importance, 
                       duration, status, created_at)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)""",
                    task_id, user["id"], task_data.get("title", "Untitled Task"),
                    task_data.get("description", ""), task_data.get("priority", 2),
                    task_data.get("urgency", 2), task_data.get("importance", 2),
                    task_data.get("duration", 30), "inbox", datetime.now(timezone.utc)
                )
                created_tasks.append({
                    "id": task_id,
                    "title": task_data.get("title", "Untitled Task"),
                    "status": "inbox"
                })
        
        return {
            "success": True,
            "tasks": created_tasks,
            "message": f"{len(created_tasks)} tasks added to inbox"
        }
    except Exception as e:
        logger.error(f"Error pushing to inbox: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Push tasks to calendar
@api_router.post("/tasks/push-to-calendar")
async def push_to_calendar(request: PushToCalendarRequest, user: dict = Depends(get_current_user)):
    """Save tasks and schedule them on calendar"""
    try:
        now = datetime.now(timezone.utc)
        today = now.strftime("%Y-%m-%d")
        
        # Group tasks by date
        tasks_by_date = {}
        for task_data in request.tasks:
            date = task_data.get("scheduled_date") or today
            if date not in tasks_by_date:
                tasks_by_date[date] = []
            tasks_by_date[date].append(task_data)
        
        created_tasks = []
        
        for date, date_tasks in tasks_by_date.items():
            # Start scheduling 1 hour from now for today, 9 AM for other days
            if date == today:
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
                
                task = Task(
                    id=task_data.get("id", str(uuid.uuid4())),
                    user_id=user["id"],
                    title=task_data.get("title", "Untitled Task"),
                    description=task_data.get("description", ""),
                    urgency=task_data.get("urgency", 2),
                    importance=task_data.get("importance", 2),
                    priority=task_data.get("priority", 2),
                    duration=task_data.get("duration", 30),
                    scheduled_date=date,
                    scheduled_time=scheduled_time,
                    status="scheduled"
                )
                
                pool = await get_db_pool()
                async with pool.acquire() as conn:
                    await conn.execute(
                        """INSERT INTO tasks (id, user_id, title, description, priority, urgency, importance, 
                           scheduled_date, scheduled_time, duration, status, created_at)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)""",
                        task.id, user["id"], task.title, task.description, task.priority, task.urgency, task.importance,
                        date, scheduled_time, task.duration, task.status, datetime.now(timezone.utc)
                    )
                created_tasks.append(task)
                
                # Advance time by task duration
                duration = task_data.get("duration", 30)
                current_minute += duration
                while current_minute >= 60:
                    current_minute -= 60
                    current_hour += 1
        
        return {
            "success": True,
            "tasks": [t.model_dump() for t in created_tasks],
            "message": f"{len(created_tasks)} tasks scheduled"
        }
    except Exception as e:
        logger.error(f"Error pushing to calendar: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


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
async def transcribe_audio(audio: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """Transcribe audio using OpenAI Whisper"""
    api_key = os.environ.get('EMERGENT_LLM_KEY')
    if not api_key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY not configured")
    
    try:
        # Save uploaded file to temp location
        suffix = Path(audio.filename).suffix if audio.filename else ".webm"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await audio.read()
            tmp.write(content)
            tmp_path = tmp.name
        
        # Transcribe using Whisper
        stt = OpenAISpeechToText(api_key=api_key)
        
        with open(tmp_path, "rb") as audio_file:
            response = await stt.transcribe(
                file=audio_file,
                model="whisper-1",
                response_format="json",
                language="en"
            )
        
        # Clean up temp file
        os.unlink(tmp_path)
        
        return {"success": True, "transcript": response.text}
        
    except Exception as e:
        logger.error(f"Whisper transcription error: {str(e)}")
        # Clean up temp file on error
        if 'tmp_path' in locals():
            try:
                os.unlink(tmp_path)
            except:
                pass
        
        # Check for rate limit / quota errors
        error_str = str(e).lower()
        if "rate" in error_str and "limit" in error_str or "quota" in error_str:
            raise HTTPException(
                status_code=429, 
                detail="QUOTA_EXCEEDED: Your API quota has been exceeded. Please add credits to your Emergent LLM Key (Profile → Universal Key → Add Balance)."
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


# Include the router in the main app
app.include_router(api_router)

# Google Calendar callback route - DISABLED
@app.get("/gcal")
async def google_callback_root(code: str = Query(None)):
    """Handle Google OAuth callback - DISABLED"""
    return RedirectResponse(f"{FRONTEND_URL}?google_error=Google Calendar sync is currently disabled")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    global db_pool
    if db_pool:
        await db_pool.close()
