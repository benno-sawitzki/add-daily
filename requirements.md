# TaskFlow - AI-Powered Voice Task Inbox

## Original Problem Statement
Build an app where I talk to the app, talk to an AI. Tell her my tasks and it sorts the tasks. Prioritizes. It's like inbox. Inbox for my tasks. And then I get a list with the most important tasks, and they get put in a calendar so I can see it and move it around.

## Architecture

### Tech Stack
- **Frontend**: React with Tailwind CSS, Shadcn UI components
- **Backend**: FastAPI (Python)
- **Database**: MongoDB
- **AI Integration**: OpenAI GPT-5.2 / Gemini 3 Flash via Emergent LLM Key
- **Voice Input**: Browser SpeechRecognition API

### Features Implemented
1. **Voice Input**: Browser-based speech recognition to capture tasks
2. **AI Task Extraction**: GPT/Gemini extracts tasks from voice transcript
3. **Priority Scoring**: AI assigns urgency (1-4) and importance (1-4) levels
4. **Task Inbox**: List view sorted by priority with visual indicators
5. **Weekly Calendar**: Drag-and-drop scheduling of tasks
6. **Daily Calendar**: Timeline view with hourly slots
7. **Model Switching**: Toggle between OpenAI GPT and Google Gemini models

### API Endpoints
- `GET /api/tasks` - List all tasks
- `POST /api/tasks` - Create task
- `PATCH /api/tasks/{id}` - Update task
- `DELETE /api/tasks/{id}` - Delete task
- `POST /api/tasks/process-voice` - Process voice input with AI
- `GET /api/settings` - Get AI model settings
- `PATCH /api/settings` - Update AI model settings

## Next Tasks / Enhancements
1. **OpenAI Whisper Integration**: Add option for more accurate voice transcription
2. **Recurring Tasks**: Support for repeating tasks (daily, weekly, monthly)
3. **Task Categories/Tags**: Organize tasks by project or context
4. **Due Dates & Reminders**: Set deadlines with notification support
5. **Voice Commands**: "Complete task", "Delete task" voice shortcuts
6. **Export/Sync**: Google Calendar integration, export to other apps
