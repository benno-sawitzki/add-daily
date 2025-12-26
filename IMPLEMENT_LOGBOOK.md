# Implement Logbook as Searchable History

## Summary
Implemented a comprehensive Logbook view that displays completed tasks, saved dump_items, and archived dumps in a searchable interface. The Logbook is not actionable by default but allows restoring items to inbox/Next Today with cap enforcement.

## Components Changed

**File:** `frontend/src/components/Logbook.jsx` (NEW)
- Replaces `SavedItems.jsx` with a comprehensive Logbook component
- Three sections: Done (completed tasks), Saved (saved dump_items), Dumps (archived dumps)
- Search functionality filters all three sections
- Action buttons: "Restore" for tasks and dumps, "Send to Next Today" for saved items
- Enforces Next Today cap of 5

**File:** `frontend/src/components/MainApp.jsx`
- Updated to use `Logbook` component instead of `SavedItems`
- Passes `completedTasks`, `onRestoreTask`, and `onRefreshTasks` props

**File:** `frontend/src/components/SavedItems.jsx`
- Replaced by `Logbook.jsx` (can be removed or kept for backward compatibility)

## Features

### 1. Done Section
- Shows completed tasks (filtered from `completedTasks` prop)
- Displays task title (strikethrough), description, completion date
- "Restore" button that calls `onRestoreTask(task.id, { status: "inbox" })`
- Searchable by title and description

### 2. Saved Section
- Shows saved dump_items (status='saved')
- Displays item text, creation date, source dump info
- "Send to Next Today" button with cap enforcement
- Checks Next Today count before allowing action
- Shows error toast if cap exceeded
- Searchable by item text

### 3. Dumps Section (Optional)
- Shows archived dumps (archived_at IS NOT NULL)
- Displays dump metadata (date, source, raw_text preview)
- "Restore" button that unarchives the dump (sets archived_at = null)
- Searchable by raw_text

### Search Implementation
- Single search input filters all three sections simultaneously
- Case-insensitive matching
- Searches:
  - Tasks: title and description
  - Saved items: text content
  - Dumps: raw_text content
- Uses `useMemo` for efficient filtering
- Shows "No results found" when search returns nothing

## API Endpoints Used

1. **GET `/api/next-today-count`** - Fetches Next Today slots info
2. **POST `/api/dump-items/{item_id}/promote-to-next`** - Sends saved item to Next Today (enforces cap)
3. **PATCH `/api/dumps/{dump_id}`** - Unarchives a dump (sets archived_at = null)
4. **GET `/api/dumps`** - Fetches dumps (with archived=true filter for archived dumps)
5. **GET `/api/dumps/{dump_id}/items`** - Fetches items for a dump

## Cap Enforcement

- Next Today cap (5 tasks) is enforced:
  - Frontend checks `nextTodayCount.remaining` before allowing action
  - Backend `/promote-to-next` endpoint also enforces cap
  - Shows clear error message if cap exceeded
  - Refreshes count after actions

## Acceptance Criteria ✅

- ✅ Done count stays correct in Command Center (uses same `completedTasks` filter)
- ✅ Saved items are visible and searchable
- ✅ Restoring or sending to Next Today respects cap of 5
- ✅ Archived dumps are visible and searchable (optional third section)
- ✅ Search works across all three sections
- ✅ Logbook is not actionable by default (items are read-only unless action button clicked)

## Files Changed

### Frontend
1. `frontend/src/components/Logbook.jsx` (NEW)
   - Main Logbook component with all three sections
   - Search functionality
   - Action buttons with cap enforcement

2. `frontend/src/components/MainApp.jsx`
   - Import and use `Logbook` instead of `SavedItems`
   - Pass `completedTasks`, `onRestoreTask`, `onRefreshTasks` props

## UI/UX Details

- Three distinct sections with icons and counts
- Search bar at top for filtering
- Empty states for each section
- Action buttons only shown when relevant
- Clear visual hierarchy
- Responsive layout
- Search results highlighted in context

## Testing

1. **Done Section:**
   - Complete a task → Appears in Done section
   - Search for task → Filters correctly
   - Click Restore → Task moves to inbox

2. **Saved Section:**
   - Save a dump item → Appears in Saved section
   - Search for item → Filters correctly
   - Click "Send to Next Today" → Moves to Next Today (if cap allows)
   - Try to send 6th item → Blocked with error message

3. **Dumps Section:**
   - Archive a dump → Appears in Dumps section
   - Search for dump → Filters correctly
   - Click Restore → Dump unarchived and returns to inbox

4. **Search:**
   - Type query → All sections filter simultaneously
   - Clear search → All items reappear
   - No results → Shows "No results found" message

5. **Cap Enforcement:**
   - Fill Next Today to 5 tasks
   - Try to send saved item → Blocked
   - Complete a Next Today task → Can send saved item


