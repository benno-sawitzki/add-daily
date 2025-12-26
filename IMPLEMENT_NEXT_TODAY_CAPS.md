# Implement Next Today and Focus Caps

## Summary
Implemented hard caps for "Next Today" (5 tasks) and "Focus" (1 task), and renamed all "Queue" terminology to "Next Today".

## Changes Made

### 1. Terminology: Queue → Next Today
- Updated TaskQueue.jsx description text to mention "Next Today"
- All UI labels now use "Next Today" terminology

### 2. Backend: Next Today Cap (5 tasks)
**File:** `backend/server.py`

**Changes:**
- `make_task_next` endpoint: Now checks count of existing 'next' tasks before adding. Blocks if count >= 5.
- `update_task` endpoint: Enforces cap when status changes to 'next'.
- Error message: "Next Today is full (5). Finish or move something out first."

### 3. Backend: Focus Cap (1 task)
**File:** `frontend/src/components/NextControlCenter.jsx`

**Behavior:** Focus is enforced client-side via localStorage (hyperfocusSession). When starting Focus on a different task, the existing session is automatically cleared (replaced). This is the simplest behavior matching existing UI patterns.

**Implementation:**
- Only one hyperfocusSession can exist at a time (stored in localStorage)
- Starting Focus on a new task clears the old session
- No backend changes needed (Focus is client-side state)

### 4. Frontend: Multiple Next Today Tasks
**Files:** 
- `frontend/src/components/MainApp.jsx`
- `frontend/src/components/InboxSplitView.jsx`

**Changes:**
- Changed from single `nextTask` to array `nextTasks`
- Updated all references to support multiple tasks
- UI now displays a list of Next Today tasks (up to 5)
- Shows count: "X/5 tasks"
- Drag-and-drop supports adding multiple tasks to Next Today
- Frontend validation checks cap before API calls

### 5. Command Center: Completed Tasks Count
**Status:** Already implemented in previous changes - completed tasks update Command Center DONE count via `metricsRefreshTrigger`.

## Files Changed

### Backend
1. `backend/server.py`
   - `make_task_next` endpoint: Added cap validation (5 tasks max)
   - `update_task` endpoint: Added cap validation when changing status to 'next'

### Frontend
1. `frontend/src/components/MainApp.jsx`
   - Changed `nextTask` to `nextTasks` (array)
   - Added cap check in `handleSetAsNext`

2. `frontend/src/components/InboxSplitView.jsx`
   - Changed from single `localNextTask` to `localNextTasks` array
   - Updated drag-and-drop to support multiple Next Today tasks
   - Updated `handleMakeNext` to check cap and support multiple tasks
   - UI now renders list of Next Today tasks with header showing "X/5 tasks"

3. `frontend/src/components/TaskQueue.jsx`
   - Updated description text to mention "Next Today"

4. `frontend/src/components/NextControlCenter.jsx`
   - Focus behavior already enforces single task (clears old session when starting new one)

## Testing

### Next Today Cap (5 tasks)
1. ✅ Try to add 6th task to Next Today → Should be blocked with toast message
2. ✅ Try via drag-and-drop → Should be blocked
3. ✅ Try via "Next" button → Should be blocked
4. ✅ Try via API call → Backend returns 400 error
5. ✅ Complete a Next Today task → Should allow adding new one (count goes back down)

### Focus Cap (1 task)
1. ✅ Start Focus on a task → Focus session starts
2. ✅ Start Focus on a different task → Old session clears, new one starts
3. ✅ Only one task can be in Focus at any moment

### Terminology
1. ✅ All UI labels use "Next Today" (no "Queue" mentions)
2. ✅ Next Today header shows count: "X/5 tasks"

## Acceptance Criteria ✅

- ✅ Next Today cap = 5 tasks (hard limit everywhere)
- ✅ Focus cap = 1 task (existing behavior: replaces on new start)
- ✅ UI terminology: "Queue" → "Next Today"
- ✅ Command Center DONE count updates correctly
- ✅ Clear error messages when caps are reached
- ✅ Frontend and backend both enforce caps

## Notes

- No database migrations needed (uses existing `status='next'` column)
- Focus is client-side (localStorage) so no backend changes needed
- Backward compatible: Existing single Next task works, now supports up to 5


