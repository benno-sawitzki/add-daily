# Task Extraction Regression Diagnostics

## Problem
Transcript contains multiple tasks but only 1 appears in Review.

## Test Transcript
```
"I go to the gym, that takes 3 hours, then I buy an AI tool that takes 1 hour, then I go home."
```

Expected: 3 tasks extracted
- "Go to the gym" (180 minutes)
- "Buy an AI tool" (60 minutes)  
- "Go home" (default 30 minutes)

## Instrumentation Added

### Frontend (MainApp.jsx)
- **Location**: `processVoiceInput` function
- **Logs**:
  - Response structure (hasTasks, tasksType, tasksIsArray, tasksLength)
  - Full response data
  - Extracted tasks details before `setQueuedTasks`
  - Each task's index, id, title, duration, priority

### Frontend (TaskQueue.jsx)
- **Location**: `useEffect` hook
- **Logs**:
  - Tasks received as props
  - Tasks length and details
  - Each task's index, id, title, duration, priority

### Backend (server.py)
- **Location**: `get_ai_response` function
- **Logs**:
  - Raw AI response (OpenAI JSON)
  - Number of tasks in raw response
  - Response type and keys
  - Transformed tasks details
  - Final return value

- **Location**: `process_voice_queue` function
- **Logs**:
  - Tasks received from `get_ai_response`
  - Tasks added to queue
  - Final response with task count

## How to Diagnose

1. **Open browser console** (F12 → Console tab)
2. **Open backend logs** (terminal running uvicorn)
3. **Process the test transcript** via voice input
4. **Look for diagnostic logs** prefixed with `🔍 DIAGNOSTIC:`

## Expected Flow

1. **Backend receives transcript** → logs transcript preview
2. **OpenAI API called** → logs raw JSON response
3. **Tasks extracted** → logs number of tasks from AI
4. **Tasks transformed** → logs each transformation
5. **Response sent** → logs final task count
6. **Frontend receives** → logs response structure
7. **Tasks set in state** → logs extracted tasks before setState
8. **TaskQueue renders** → logs tasks received as props

## Where Tasks Could Be Lost

### A) Backend returns only 1 task
- **Check**: Backend logs show `🔍 DIAGNOSTIC: Number of tasks in raw AI response: 1`
- **Cause**: AI prompt not extracting all tasks
- **Fix**: Improve AI prompt or reduce temperature further

### B) Backend returns 3 but transformation fails
- **Check**: Backend logs show `🔍 DIAGNOSTIC: Successfully transformed X out of 3 tasks` where X < 3
- **Cause**: `transform_task_to_frontend_format` throwing errors
- **Fix**: Fix transformation function (already fixed `notes` variable bug)

### C) Backend returns 3 but frontend receives 1
- **Check**: Backend logs show 3 tasks, frontend logs show 1 task
- **Cause**: Response serialization or network issue
- **Fix**: Check response format, ensure tasks array is properly serialized

### D) Frontend receives 3 but displays 1
- **Check**: Frontend logs show 3 tasks in `setQueuedTasks`, but TaskQueue shows 1
- **Cause**: TaskQueue filtering or state issue
- **Fix**: Check TaskQueue component for any filtering/slicing

## Regression Test

Run the test:
```bash
cd backend
python test_task_extraction.py
```

The test will:
1. Call `get_ai_response` with the test transcript
2. Assert 3 tasks are extracted
3. Verify expected tasks are present (gym, AI tool, go home)
4. Verify durations are correct (180, 60, 30 minutes)

## Fix Applied

**Bug**: `notes` variable was only defined inside `if` block but used in return statement
**Fix**: Moved `notes = task_data.get("notes", "") or ""` outside the `if` block

This was causing `NameError` when AI provided `duration_minutes`, silently failing task transformation.

