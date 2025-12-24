from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import RedirectResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
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

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Google OAuth Config
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET')
FRONTEND_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://voicetask-8.preview.emergentagent.com')
# Use shortest possible callback path (no /api prefix)
GOOGLE_REDIRECT_URI = f"{FRONTEND_URL}/gcal"
GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/userinfo.email']

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Models
class Task(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
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

# Task CRUD
@api_router.post("/tasks", response_model=Task)
async def create_task(task_input: TaskCreate):
    task = Task(**task_input.model_dump())
    doc = task.model_dump()
    await db.tasks.insert_one(doc)
    return task

@api_router.get("/tasks", response_model=List[Task])
async def get_tasks(status: Optional[str] = None):
    query = {}
    if status:
        query["status"] = status
    
    tasks = await db.tasks.find(query, {"_id": 0}).sort("priority", -1).to_list(1000)
    return tasks

@api_router.get("/tasks/{task_id}", response_model=Task)
async def get_task(task_id: str):
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task

@api_router.patch("/tasks/{task_id}", response_model=Task)
async def update_task(task_id: str, task_update: TaskUpdate):
    update_data = {k: v for k, v in task_update.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No update data provided")
    
    result = await db.tasks.update_one({"id": task_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    return task

@api_router.delete("/tasks/{task_id}")
async def delete_task(task_id: str):
    result = await db.tasks.delete_one({"id": task_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "Task deleted"}

# Voice processing - Queue mode (returns tasks for review, doesn't save yet)
@api_router.post("/tasks/process-voice-queue")
async def process_voice_queue(voice_input: VoiceInput):
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
            task = {
                "id": str(uuid.uuid4()),
                "title": task_data.get("title", "Untitled Task"),
                "description": task_data.get("description", ""),
                "urgency": task_data.get("urgency", 2),
                "importance": task_data.get("importance", 2),
                "priority": task_data.get("priority", 2),
                "duration": 30,  # Default 30 minutes
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
async def push_to_inbox(request: PushToCalendarRequest):
    """Save tasks to inbox (not scheduled)"""
    try:
        created_tasks = []
        
        for task_data in request.tasks:
            task = Task(
                id=task_data.get("id", str(uuid.uuid4())),
                title=task_data.get("title", "Untitled Task"),
                description=task_data.get("description", ""),
                urgency=task_data.get("urgency", 2),
                importance=task_data.get("importance", 2),
                priority=task_data.get("priority", 2),
                duration=task_data.get("duration", 30),
                scheduled_date=None,
                scheduled_time=None,
                status="inbox"
            )
            
            doc = task.model_dump()
            await db.tasks.insert_one(doc)
            created_tasks.append(task)
        
        return {
            "success": True,
            "tasks": [t.model_dump() for t in created_tasks],
            "message": f"{len(created_tasks)} tasks added to inbox"
        }
    except Exception as e:
        logger.error(f"Error pushing to inbox: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Push tasks to calendar
@api_router.post("/tasks/push-to-calendar")
async def push_to_calendar(request: PushToCalendarRequest):
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
                
                doc = task.model_dump()
                await db.tasks.insert_one(doc)
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


# Voice processing (legacy - direct to calendar)
@api_router.post("/tasks/process-voice")
async def process_voice(voice_input: VoiceInput):
    """Process voice transcript and extract/prioritize tasks, auto-schedule urgent ones"""
    try:
        result = await get_ai_response(
            voice_input.transcript,
            voice_input.provider,
            voice_input.model
        )
        
        # Get current time for scheduling
        now = datetime.now(timezone.utc)
        
        # Create tasks in database
        created_tasks = []
        for task_data in result.get("tasks", []):
            task = Task(
                title=task_data.get("title", "Untitled Task"),
                description=task_data.get("description", ""),
                urgency=task_data.get("urgency", 2),
                importance=task_data.get("importance", 2),
                priority=task_data.get("priority", 2)
            )
            created_tasks.append(task)
        
        # Sort tasks by priority (highest first) for scheduling
        created_tasks.sort(key=lambda t: t.priority, reverse=True)
        
        # Auto-schedule tasks based on urgency
        # Start scheduling 1 hour from now
        schedule_hour = now.hour + 1
        today = now.strftime("%Y-%m-%d")
        
        # Get tomorrow's date for overflow
        tomorrow = (now + timedelta(days=1)).strftime("%Y-%m-%d")
        
        for i, task in enumerate(created_tasks):
            # Calculate time slot: urgent tasks (priority 3-4) get scheduled today
            # Less urgent tasks (priority 1-2) stay in inbox
            if task.priority >= 3:
                # Schedule urgent/important tasks
                task_hour = schedule_hour + i
                
                if task_hour >= 22:  # Don't schedule after 10 PM
                    # Move to tomorrow morning
                    task.scheduled_date = tomorrow
                    task_hour = 9 + (task_hour - 22)
                else:
                    task.scheduled_date = today
                
                task.scheduled_time = f"{task_hour:02d}:00"
                task.status = "scheduled"
            # Lower priority tasks stay in inbox (status="inbox")
            
            # Save to database
            doc = task.model_dump()
            await db.tasks.insert_one(doc)
        
        # Count scheduled vs inbox
        scheduled_count = sum(1 for t in created_tasks if t.status == "scheduled")
        inbox_count = len(created_tasks) - scheduled_count
        
        summary_parts = []
        if scheduled_count > 0:
            summary_parts.append(f"{scheduled_count} urgent task(s) scheduled")
        if inbox_count > 0:
            summary_parts.append(f"{inbox_count} task(s) added to inbox")
        
        return {
            "success": True,
            "tasks": [t.model_dump() for t in created_tasks],
            "summary": ", ".join(summary_parts) if summary_parts else "No tasks found",
            "scheduled_count": scheduled_count,
            "should_show_calendar": scheduled_count > 0
        }
    except Exception as e:
        logger.error(f"Error processing voice: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Settings
@api_router.get("/settings", response_model=Settings)
async def get_settings():
    settings = await db.settings.find_one({"id": "user_settings"}, {"_id": 0})
    if not settings:
        default_settings = Settings()
        await db.settings.insert_one(default_settings.model_dump())
        return default_settings
    return settings

@api_router.patch("/settings", response_model=Settings)
async def update_settings(settings_update: SettingsUpdate):
    await db.settings.update_one(
        {"id": "user_settings"},
        {"$set": settings_update.model_dump()},
        upsert=True
    )
    settings = await db.settings.find_one({"id": "user_settings"}, {"_id": 0})
    return settings

# Whisper Speech-to-Text endpoint
@api_router.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
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
async def export_ical():
    """Export scheduled tasks as iCal (.ics) file"""
    try:
        # Fetch all scheduled tasks
        tasks = await db.tasks.find(
            {"status": "scheduled", "scheduled_date": {"$ne": None}},
            {"_id": 0}
        ).to_list(1000)
        
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
@api_router.get("/gcal")
async def google_callback(code: str = Query(...)):
    """Handle Google OAuth callback"""
    try:
        # Exchange code for tokens
        token_resp = requests.post('https://oauth2.googleapis.com/token', data={
            'code': code,
            'client_id': GOOGLE_CLIENT_ID,
            'client_secret': GOOGLE_CLIENT_SECRET,
            'redirect_uri': GOOGLE_REDIRECT_URI,
            'grant_type': 'authorization_code'
        }).json()
        
        if 'error' in token_resp:
            logger.error(f"Token error: {token_resp}")
            return RedirectResponse(f"{FRONTEND_URL}?google_error={token_resp.get('error_description', 'Auth failed')}")
        
        # Get user info
        user_info = requests.get(
            'https://www.googleapis.com/oauth2/v2/userinfo',
            headers={'Authorization': f'Bearer {token_resp["access_token"]}'}
        ).json()
        
        email = user_info.get('email', 'unknown')
        
        # Save tokens to database
        await db.google_auth.update_one(
            {"id": "google_connection"},
            {"$set": {
                "email": email,
                "access_token": token_resp.get('access_token'),
                "refresh_token": token_resp.get('refresh_token'),
                "expires_at": datetime.now(timezone.utc) + timedelta(seconds=token_resp.get('expires_in', 3600)),
                "connected_at": datetime.now(timezone.utc).isoformat()
            }},
            upsert=True
        )
        
        logger.info(f"Google Calendar connected for {email}")
        return RedirectResponse(f"{FRONTEND_URL}?google_connected=true&email={email}")
        
    except Exception as e:
        logger.error(f"Google callback error: {str(e)}")
        return RedirectResponse(f"{FRONTEND_URL}?google_error={str(e)}")


@api_router.get("/auth/google/status")
async def google_status():
    """Check if Google Calendar is connected"""
    connection = await db.google_auth.find_one({"id": "google_connection"}, {"_id": 0})
    if connection and connection.get('access_token'):
        return {
            "connected": True,
            "email": connection.get('email', 'unknown')
        }
    return {"connected": False}


@api_router.post("/auth/google/disconnect")
async def google_disconnect():
    """Disconnect Google Calendar"""
    await db.google_auth.delete_one({"id": "google_connection"})
    return {"success": True, "message": "Google Calendar disconnected"}


async def get_google_credentials():
    """Get valid Google credentials, refreshing if needed"""
    connection = await db.google_auth.find_one({"id": "google_connection"})
    if not connection or not connection.get('access_token'):
        return None
    
    creds = Credentials(
        token=connection['access_token'],
        refresh_token=connection.get('refresh_token'),
        token_uri='https://oauth2.googleapis.com/token',
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET
    )
    
    # Refresh if expired
    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(GoogleRequest())
            await db.google_auth.update_one(
                {"id": "google_connection"},
                {"$set": {
                    "access_token": creds.token,
                    "expires_at": datetime.now(timezone.utc) + timedelta(seconds=3600)
                }}
            )
        except Exception as e:
            logger.error(f"Token refresh failed: {e}")
            return None
    
    return creds


@api_router.post("/calendar/sync")
async def sync_to_google_calendar():
    """Sync all scheduled tasks to Google Calendar"""
    creds = await get_google_credentials()
    if not creds:
        raise HTTPException(status_code=401, detail="Google Calendar not connected")
    
    try:
        service = build('calendar', 'v3', credentials=creds)
        
        # Get all scheduled tasks
        tasks = await db.tasks.find(
            {"status": "scheduled", "scheduled_date": {"$ne": None}},
            {"_id": 0}
        ).to_list(1000)
        
        synced_count = 0
        errors = []
        
        for task in tasks:
            try:
                scheduled_date = task.get('scheduled_date')
                scheduled_time = task.get('scheduled_time', '09:00') or '09:00'
                duration = task.get('duration', 30) or 30
                
                if not scheduled_date:
                    continue
                
                # Calculate start and end times
                start_dt = f"{scheduled_date}T{scheduled_time}:00"
                
                # Calculate end time
                start_hour, start_min = map(int, scheduled_time.split(':'))
                end_min = start_min + duration
                end_hour = start_hour
                while end_min >= 60:
                    end_min -= 60
                    end_hour += 1
                end_time = f"{end_hour:02d}:{end_min:02d}"
                end_dt = f"{scheduled_date}T{end_time}:00"
                
                # Check if task already synced (by checking extended properties)
                task_id = task.get('id')
                google_event_id = task.get('google_event_id')
                
                event_body = {
                    'summary': task.get('title', 'Untitled Task'),
                    'description': task.get('description', ''),
                    'start': {
                        'dateTime': start_dt,
                        'timeZone': 'Europe/Berlin'  # You can make this configurable
                    },
                    'end': {
                        'dateTime': end_dt,
                        'timeZone': 'Europe/Berlin'
                    },
                    'extendedProperties': {
                        'private': {
                            'addDailyTaskId': task_id
                        }
                    }
                }
                
                if google_event_id:
                    # Update existing event
                    service.events().update(
                        calendarId='primary',
                        eventId=google_event_id,
                        body=event_body
                    ).execute()
                else:
                    # Create new event
                    created_event = service.events().insert(
                        calendarId='primary',
                        body=event_body
                    ).execute()
                    
                    # Save Google event ID to task
                    await db.tasks.update_one(
                        {"id": task_id},
                        {"$set": {"google_event_id": created_event['id']}}
                    )
                
                synced_count += 1
                
            except Exception as e:
                errors.append(f"Task '{task.get('title')}': {str(e)}")
                logger.error(f"Failed to sync task {task.get('id')}: {e}")
        
        return {
            "success": True,
            "synced_count": synced_count,
            "total_tasks": len(tasks),
            "errors": errors if errors else None
        }
        
    except Exception as e:
        logger.error(f"Google Calendar sync error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/calendar/sync-task/{task_id}")
async def sync_single_task(task_id: str):
    """Sync a single task to Google Calendar"""
    creds = await get_google_credentials()
    if not creds:
        raise HTTPException(status_code=401, detail="Google Calendar not connected")
    
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    if task.get('status') != 'scheduled' or not task.get('scheduled_date'):
        raise HTTPException(status_code=400, detail="Task is not scheduled")
    
    try:
        service = build('calendar', 'v3', credentials=creds)
        
        scheduled_date = task['scheduled_date']
        scheduled_time = task.get('scheduled_time', '09:00') or '09:00'
        duration = task.get('duration', 30) or 30
        
        # Calculate times
        start_dt = f"{scheduled_date}T{scheduled_time}:00"
        start_hour, start_min = map(int, scheduled_time.split(':'))
        end_min = start_min + duration
        end_hour = start_hour
        while end_min >= 60:
            end_min -= 60
            end_hour += 1
        end_dt = f"{scheduled_date}T{end_hour:02d}:{end_min:02d}:00"
        
        event_body = {
            'summary': task.get('title', 'Untitled Task'),
            'description': task.get('description', ''),
            'start': {'dateTime': start_dt, 'timeZone': 'Europe/Berlin'},
            'end': {'dateTime': end_dt, 'timeZone': 'Europe/Berlin'},
            'extendedProperties': {'private': {'addDailyTaskId': task_id}}
        }
        
        google_event_id = task.get('google_event_id')
        
        if google_event_id:
            service.events().update(calendarId='primary', eventId=google_event_id, body=event_body).execute()
        else:
            created_event = service.events().insert(calendarId='primary', body=event_body).execute()
            await db.tasks.update_one({"id": task_id}, {"$set": {"google_event_id": created_event['id']}})
        
        return {"success": True, "message": "Task synced to Google Calendar"}
        
    except Exception as e:
        logger.error(f"Single task sync error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Include the router in the main app
app.include_router(api_router)

# Add root-level Google callback (without /api prefix) for flexibility
@app.get("/gcal")
async def google_callback_root(code: str = Query(...)):
    """Handle Google OAuth callback at root level"""
    try:
        # Exchange code for tokens
        token_resp = requests.post('https://oauth2.googleapis.com/token', data={
            'code': code,
            'client_id': GOOGLE_CLIENT_ID,
            'client_secret': GOOGLE_CLIENT_SECRET,
            'redirect_uri': f"{FRONTEND_URL}/gcal",
            'grant_type': 'authorization_code'
        }).json()
        
        if 'error' in token_resp:
            logger.error(f"Token error: {token_resp}")
            return RedirectResponse(f"{FRONTEND_URL}?google_error={token_resp.get('error_description', 'Auth failed')}")
        
        # Get user info
        user_info = requests.get(
            'https://www.googleapis.com/oauth2/v2/userinfo',
            headers={'Authorization': f'Bearer {token_resp["access_token"]}'}
        ).json()
        
        email = user_info.get('email', 'unknown')
        
        # Save tokens to database
        await db.google_auth.update_one(
            {"id": "google_connection"},
            {"$set": {
                "email": email,
                "access_token": token_resp.get('access_token'),
                "refresh_token": token_resp.get('refresh_token'),
                "expires_at": datetime.now(timezone.utc) + timedelta(seconds=token_resp.get('expires_in', 3600)),
                "connected_at": datetime.now(timezone.utc).isoformat()
            }},
            upsert=True
        )
        
        logger.info(f"Google Calendar connected for {email}")
        return RedirectResponse(f"{FRONTEND_URL}?google_connected=true&email={email}")
        
    except Exception as e:
        logger.error(f"Google callback error: {str(e)}")
        return RedirectResponse(f"{FRONTEND_URL}?google_error={str(e)}")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
