# API Routes Audit: Tasks and Dumps

## Backend Routes (backend/server.py)

### Tasks Routes (table: `tasks`)

| HTTP Method | URL | Handler Function | DB Table | Description |
|------------|-----|-----------------|----------|-------------|
| GET | `/api/tasks` | `get_tasks` | `tasks` | Fetch all tasks for user (optionally filtered by status) |
| GET | `/api/tasks/{task_id}` | `get_task` | `tasks` | Get single task by ID |
| POST | `/api/tasks` | `create_task` | `tasks` | Create new task |
| PATCH | `/api/tasks/{task_id}` | `update_task` | `tasks` | Update task fields |
| DELETE | `/api/tasks/{task_id}` | `delete_task` | `tasks` | Delete task |
| POST | `/api/tasks/batch-update-sort-order` | `batch_update_sort_order` | `tasks` | Batch update sort_order for multiple tasks |
| POST | `/api/tasks/process-voice-queue` | `process_voice_queue` | N/A (AI only) | Process voice transcript → extract tasks (returns JSON, doesn't write to DB) |
| POST | `/api/tasks/push-to-inbox` | `push_to_inbox` | `tasks` | Create tasks with status='inbox' |
| POST | `/api/tasks/push-to-calendar` | `push_to_calendar` | `tasks` | Create tasks with scheduled_date/time (status='scheduled') |
| POST | `/api/tasks/{task_id}/make-next` | `make_task_next` | `tasks` | Set task status='next' (NEXT_TODAY), enforces cap 5 |
| POST | `/api/tasks/{task_id}/move-to-inbox` | `move_task_to_inbox` | `tasks` | Change task status to 'inbox' |
| POST | `/api/tasks/{task_id}/move-to-later` | `move_task_to_later` | `tasks` | Change task status to 'later' (legacy) |
| GET | `/api/tasks/export/ical` | `export_ical` | `tasks` | Export tasks as iCal file |

### Dumps Routes

| HTTP Method | URL | Handler Function | DB Tables | Description |
|------------|-----|-----------------|-----------|-------------|
| GET | `/api/dumps` | `get_dumps` | `dumps` | List all dumps for user (optionally filtered by archived) |
| GET | `/api/dumps/{dump_id}` | `get_dump` | `dumps` | Get single dump by ID |
| POST | `/api/dumps` | `create_dump` | `dumps` | Create new dump (capture session) |
| PATCH | `/api/dumps/{dump_id}` | `update_dump` | `dumps` | Update dump (e.g., archived_at, clarified_at) |
| GET | `/api/dumps/{dump_id}/items` | `get_dump_items` | `dump_items` | Get all items for a dump |
| POST | `/api/dumps/{dump_id}/items` | `create_dump_item` | `dump_items` | Create item in dump |
| POST | `/api/dumps/{dump_id}/clarify` | `clarify_dump` | `dump_items`, `dumps` | Parse dump.raw_text into dump_items, sets clarified_at |
| PATCH | `/api/dump-items/{item_id}` | `update_dump_item` | `dump_items` | Update dump item fields |
| POST | `/api/dump-items/{item_id}/promote-to-next` | `promote_item_to_next` | `dump_items`, `tasks` | Create task from item (status='next'), updates item.status='promoted' |
| PATCH | `/api/dump-items/{item_id}/snooze` | `snooze_dump_item` | `dump_items` | Set item status='snoozed', set snooze_until |
| PATCH | `/api/dump-items/{item_id}/save` | `save_dump_item` | `dump_items` | Set item status='saved' |
| PATCH | `/api/dump-items/{item_id}/trash` | `trash_dump_item` | `dump_items` | Set item status='trashed' |

### Counts/Metrics Routes

| HTTP Method | URL | Handler Function | DB Table | Description |
|------------|-----|-----------------|----------|-------------|
| GET | `/api/next-today-count` | `get_next_today_count` | `tasks` | Returns count of tasks with status='next', cap (5), and remaining slots |

### Root-level Aliases (backward compatibility)

| HTTP Method | URL | Handler Function | Description |
|------------|-----|-----------------|-------------|
| GET | `/health` | `health_root` | Health check (alias for /api/health) |
| GET | `/dumps` | `get_dumps_root` | List dumps (alias for /api/dumps) |

## Frontend Component → API Calls Mapping

### MainApp.jsx
- `GET /tasks` - Fetch all tasks (used for all views)
- `PATCH /tasks/{id}` - Update task (status, fields, etc.)
- `POST /tasks` - Create task
- `DELETE /tasks/{id}` - Delete task
- `POST /tasks/process-voice-queue` - Process voice input (braindump)
- `POST /tasks/push-to-calendar` - Schedule tasks from queue
- `POST /tasks/push-to-inbox` - Add tasks to inbox from queue
- `POST /tasks/{id}/make-next` - Set task as Next Today
- `POST /tasks/{id}/move-to-inbox` - Move task back to inbox

### InboxSplitView.jsx (Inbox tab - when dumps disabled)
- `POST /tasks/{id}/make-next` - Drag task to Next Today
- `POST /tasks/{id}/move-to-inbox` - Drag task back to inbox

### DumpsList.jsx (Inbox tab - when dumps enabled)
- `GET /dumps` - List all dumps (archived=false)
- `GET /dumps/{id}` - Get dump details
- `GET /dumps/{id}/items` - Get items for dump (to check if needs review)

### DumpReview.jsx (Dump triage/review UI)
- `GET /next-today-count` - Check remaining slots before promoting
- `GET /dumps/{id}/items` - Get items to display
- `POST /dumps/{id}/clarify` - Parse dump raw_text into items
- `POST /dump-items/{id}/promote-to-next` - Send item to Next Today (creates task)
- `PATCH /dump-items/{id}/snooze` - Snooze item until date
- `PATCH /dump-items/{id}/save` - Save item to logbook (status='saved')
- `PATCH /dump-items/{id}/trash` - Trash item (status='trashed')

### CreateDump.jsx
- `POST /dumps` - Create new dump from text input

### Logbook.jsx
- `GET /next-today-count` - Check slots before promoting saved items
- `GET /dumps` - Get dumps (to find saved items)
- `GET /dumps/{id}/items` - Get items (filter for status='saved')
- `POST /dump-items/{id}/promote-to-next` - Send saved item to Next Today
- `PATCH /dumps/{id}` - Update dump (archive/restore)
- `POST /dumps` - Create dump from legacy task migration
- `DELETE /tasks/{id}` - Delete legacy task after migration

### DailyCalendar.jsx (Daily view)
- Uses `MainApp.updateTask()` which calls `PATCH /tasks/{id}` - Updates task scheduling
- Uses `MainApp.deleteTask()` which calls `DELETE /tasks/{id}` - Deletes task
- Fetches tasks via parent `MainApp.fetchTasks()` → `GET /tasks`

### WeeklyCalendar.jsx (Weekly view)
- Uses `MainApp.updateTask()` which calls `PATCH /tasks/{id}` - Updates task scheduling
- Uses `MainApp.deleteTask()` which calls `DELETE /tasks/{id}` - Deletes task
- Fetches tasks via parent `MainApp.fetchTasks()` → `GET /tasks`

## Complete Mapping Table: UI Action → HTTP → URL → Handler → DB Table

| UI Action | HTTP Method | URL | Backend Handler | DB Table(s) | Component |
|-----------|-------------|-----|-----------------|-------------|-----------|
| Load inbox tasks | GET | `/api/tasks` | `get_tasks` | `tasks` | MainApp, InboxSplitView |
| Load daily/weekly tasks | GET | `/api/tasks` | `get_tasks` | `tasks` | MainApp (shared) |
| Update task (drag/resize) | PATCH | `/api/tasks/{id}` | `update_task` | `tasks` | DailyCalendar, WeeklyCalendar |
| Delete task | DELETE | `/api/tasks/{id}` | `delete_task` | `tasks` | MainApp, DailyCalendar, WeeklyCalendar |
| Create task | POST | `/api/tasks` | `create_task` | `tasks` | MainApp |
| Set task as Next Today | POST | `/api/tasks/{id}/make-next` | `make_task_next` | `tasks` | MainApp, InboxSplitView |
| Move task to inbox | POST | `/api/tasks/{id}/move-to-inbox` | `move_task_to_inbox` | `tasks` | MainApp, InboxSplitView |
| Batch update sort order | POST | `/api/tasks/batch-update-sort-order` | `batch_update_sort_order` | `tasks` | (internal, drag-drop) |
| Process voice (braindump) | POST | `/api/tasks/process-voice-queue` | `process_voice_queue` | N/A (AI only) | MainApp, VoiceOverlay |
| Push tasks to calendar | POST | `/api/tasks/push-to-calendar` | `push_to_calendar` | `tasks` | MainApp, TaskQueue |
| Push tasks to inbox | POST | `/api/tasks/push-to-inbox` | `push_to_inbox` | `tasks` | MainApp, TaskQueue |
| Load dumps list | GET | `/api/dumps` | `get_dumps` | `dumps` | DumpsList |
| Get dump details | GET | `/api/dumps/{id}` | `get_dump` | `dumps` | DumpsList, DumpReview |
| Create dump | POST | `/api/dumps` | `create_dump` | `dumps` | CreateDump, Logbook (migration) |
| Update dump | PATCH | `/api/dumps/{id}` | `update_dump` | `dumps` | Logbook (archive/restore) |
| Get dump items | GET | `/api/dumps/{id}/items` | `get_dump_items` | `dump_items` | DumpReview, DumpsList, Logbook |
| Clarify dump | POST | `/api/dumps/{id}/clarify` | `clarify_dump` | `dump_items`, `dumps` | DumpReview |
| Promote item to Next Today | POST | `/api/dump-items/{id}/promote-to-next` | `promote_item_to_next` | `dump_items`, `tasks` | DumpReview, Logbook |
| Snooze item | PATCH | `/api/dump-items/{id}/snooze` | `snooze_dump_item` | `dump_items` | DumpReview |
| Save item | PATCH | `/api/dump-items/{id}/save` | `save_dump_item` | `dump_items` | DumpReview |
| Trash item | PATCH | `/api/dump-items/{id}/trash` | `trash_dump_item` | `dump_items` | DumpReview |
| Get Next Today count | GET | `/api/next-today-count` | `get_next_today_count` | `tasks` | DumpReview, Logbook |

## Notes

1. **Duplicate Routes**: There appear to be duplicate dump routes defined (lines 1814-2316 and 2462-2694). These should be deduplicated.

2. **Tasks Source of Truth**: All task operations use the `tasks` table. Tasks can have status: 'inbox', 'next', 'completed', 'focus', 'scheduled', 'later' (legacy).

3. **Dumps Flow**: 
   - Create dump → `dumps` table
   - Clarify dump → creates `dump_items` from raw_text
   - Triage items → update `dump_items.status` ('promoted', 'saved', 'snoozed', 'trashed')
   - Promote to Next → creates task in `tasks` table, links via `dump_items.linked_task_id`

4. **Inbox View**: Currently switches between:
   - DumpsList (when `REACT_APP_ENABLE_DUMPS=true`) - shows dumps
   - InboxSplitView (when dumps disabled) - shows tasks with status='inbox'

5. **Next Today Cap**: Enforced in:
   - `POST /tasks/{id}/make-next` - checks count before updating
   - `POST /dump-items/{id}/promote-to-next` - checks count before creating task


