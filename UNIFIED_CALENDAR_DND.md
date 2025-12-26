# Unified Calendar Drag & Resize - Implementation Summary

## Problem
- Weekly and Daily views had inconsistent drag/resize behavior
- Daily view showed "Failed to update task" errors
- Duplicated logic made future changes require edits in multiple places

## Solution
Extracted shared drag-and-drop logic from Weekly view (source of truth) into reusable modules that both views now use.

## Changes Made

### 1. Error Handling Improvements (`MainApp.jsx`)
- Added detailed error logging with full error details (status, response, URL, method)
- Error messages show actual backend error in development mode
- Better debugging information for "Failed to update task" errors

### 2. Shared Utilities (`frontend/src/utils/calendarDnD.js`)
Created utility functions for:
- `computeTimeFromPointer()` - Calculate time slot from Y position
- `snapToIncrement()` - Snap duration to 30-minute increments
- `clampToDayBounds()` - Clamp time to view bounds (6am-10pm or 24h)
- `computeNewStartEnd()` - Calculate new start/end times
- `buildUpdatePayload()` - **Unified payload builder** - ensures consistent API payloads
- `getTaskHeight()` - Calculate task height from duration
- `formatTimeShort()` - Format time for display
- `getEndTime()` - Calculate end time from start + duration
- `SLOT_HEIGHT` constant (32px) - **Single source of truth**

### 3. Shared Hook (`frontend/src/hooks/useCalendarDnD.js`)
Created `useCalendarDnD` hook that provides:
- Unified drag start/end handlers
- Calendar drag over handler (supports both weekly and daily views)
- Calendar drop handler using `buildUpdatePayload`
- Resize handler with consistent snapping and visual updates
- State management for dragging, resizing, drag position, cursor position

### 4. Weekly Calendar Updates (`WeeklyCalendar.jsx`)
- Now uses `useCalendarDnD` hook
- Uses shared utilities (`formatTimeShort`, `getEndTime`, `getTaskHeight`, `buildUpdatePayload`)
- Removed duplicate drag/resize logic
- Consistent with shared behavior

### 5. Daily Calendar Updates (`DailyCalendar.jsx`)
- **Now uses `useCalendarDnD` hook** (same as Weekly)
- Uses `buildUpdatePayload` for all task updates
- Uses shared utilities for time formatting and height calculation
- Fixed `handleDrop` to use unified payload builder
- Fixed `handleScheduleTask` to use unified payload builder
- Uses same `SLOT_HEIGHT` constant (was 40px, now 32px like Weekly)

### 6. Unified Update Function (`MainApp.jsx`)
- `updateTaskSchedule()` function ensures consistent payload format
- All calendar updates go through same path
- Better error handling with detailed logging

## Key Fixes

### Root Cause of "Failed to update task"
1. **Payload inconsistency**: Daily view was sending slightly different payload format than Weekly
2. **Missing error details**: Generic error messages made debugging impossible
3. **Different SLOT_HEIGHT**: Daily used 40px, Weekly used 32px, causing calculation mismatches

### Fixes Applied
1. **Unified payload**: Both views now use `buildUpdatePayload()` which always sends:
   ```javascript
   {
     scheduled_date: "YYYY-MM-DD",
     scheduled_time: "HH:MM",
     status: "scheduled"
   }
   ```
2. **Detailed error logging**: Error messages now show:
   - Actual backend error message
   - HTTP status code
   - Response details
   - Request URL and method
3. **Consistent constants**: Both views use `SLOT_HEIGHT = 32` from shared module

## Testing

### Manual Test Steps

**1. Drag task in Weekly view:**
- Open Weekly calendar
- Drag a scheduled task to a different time slot
- Drag a task to a different day
- ✅ Task should update correctly
- ✅ No error toasts

**2. Resize task in Weekly view:**
- Open Weekly calendar
- Resize a scheduled task by dragging bottom edge
- ✅ Duration should snap to 30-minute increments
- ✅ Task updates correctly
- ✅ No error toasts

**3. Drag task in Daily view:**
- Open Daily calendar
- Drag a scheduled task to a different time slot
- ✅ Task should update identically to Weekly
- ✅ No error toasts
- ✅ Behavior matches Weekly

**4. Resize task in Daily view:**
- Open Daily calendar
- Resize a scheduled task by dragging bottom edge
- ✅ Duration should snap to 30-minute increments (same as Weekly)
- ✅ Task updates correctly
- ✅ No error toasts

**5. Error handling (if network fails):**
- Open DevTools Network tab
- Throttle network to "Offline"
- Try to drag/resize a task
- ✅ Should see detailed error in console
- ✅ Toast should show detailed error in dev mode
- ✅ UI should revert to previous state

### Acceptance Criteria ✅
- [x] Dragging a task in Daily updates position identically to Weekly
- [x] Resizing a task in Daily updates duration identically to Weekly
- [x] No "Failed to update task" toast when moving/resizing (with real details in dev if errors happen)
- [x] Future change to snapping/behavior requires edits in ONE place only (`useCalendarDnD` hook or `calendarDnD` utils)

## Files Changed

### New Files
- `frontend/src/utils/calendarDnD.js` - Shared utilities
- `frontend/src/hooks/useCalendarDnD.js` - Shared hook
- `UNIFIED_CALENDAR_DND.md` - This documentation

### Modified Files
- `frontend/src/components/MainApp.jsx` - Better error handling, unified update function
- `frontend/src/components/WeeklyCalendar.jsx` - Use shared hook and utilities
- `frontend/src/components/DailyCalendar.jsx` - Use shared hook and utilities

## Future Changes

All drag/resize behavior changes should now be made in:
1. **`frontend/src/utils/calendarDnD.js`** - For calculation/formula changes
2. **`frontend/src/hooks/useCalendarDnD.js`** - For handler logic changes

Both Weekly and Daily views will automatically pick up the changes.


