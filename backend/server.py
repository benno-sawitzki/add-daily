from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone
from emergentintegrations.llm.chat import LlmChat, UserMessage
from emergentintegrations.llm.openai import OpenAISpeechToText
import json
import tempfile

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

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
- title: A clear, concise task title
- description: Additional details if provided
- urgency: 1-4 scale (1=not urgent, 4=extremely urgent)
- importance: 1-4 scale (1=not important, 4=very important)
- priority: Calculate as (urgency + importance) / 2, round to nearest integer

Respond ONLY with a JSON object in this exact format:
{
  "tasks": [
    {
      "title": "string",
      "description": "string",
      "urgency": number,
      "importance": number,
      "priority": number
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

# Voice processing
@api_router.post("/tasks/process-voice")
async def process_voice(voice_input: VoiceInput):
    """Process voice transcript and extract/prioritize tasks"""
    try:
        result = await get_ai_response(
            voice_input.transcript,
            voice_input.provider,
            voice_input.model
        )
        
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
            doc = task.model_dump()
            await db.tasks.insert_one(doc)
            created_tasks.append(task)
        
        return {
            "success": True,
            "tasks": [t.model_dump() for t in created_tasks],
            "summary": result.get("summary", "Tasks processed")
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

# Include the router in the main app
app.include_router(api_router)

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
