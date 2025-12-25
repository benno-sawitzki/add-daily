# Next Task Implementation

## Overview
Backend support for a single "Next task" per user has been implemented. This allows users to mark one task as their priority task at a time.

## Status Enum
Task status values: `inbox`, `next`, `scheduled`, `completed`

## Database Schema

### Unique Index
A partial unique index enforces only one 'next' task per user:

```sql
CREATE UNIQUE INDEX one_next_task_per_user
ON tasks(user_id)
WHERE status = 'next';
```

This index is included in:
- `backend/schema.sql` (base schema)
- `backend/migrations/add_next_status.sql` (migration for existing databases)

## API Endpoints

### 1. POST `/api/tasks/{task_id}/make-next`
Sets a task as 'next' and automatically moves any existing next task back to inbox.

**Authentication**: Required (via `get_current_user` dependency)

**Behavior**:
- Validates task exists and belongs to user
- If task is already 'next', returns success (no-op)
- In a transaction:
  1. Moves any existing 'next' task for the user back to 'inbox'
  2. Sets the specified task status to 'next'
- Returns the updated task object

**Response**: Full task object with `status: "next"`

**Example**:
```bash
POST /api/tasks/abc123/make-next
Authorization: Bearer <token>

Response: {
  "id": "abc123",
  "user_id": "user123",
  "title": "Important task",
  "status": "next",
  ...
}
```

### 2. POST `/api/tasks/{task_id}/move-to-inbox`
Moves a task back to inbox status.

**Authentication**: Required (via `get_current_user` dependency)

**Behavior**:
- Validates task exists and belongs to user
- Updates task status to 'inbox'
- Returns the updated task object

**Response**: Full task object with `status: "inbox"`

**Example**:
```bash
POST /api/tasks/abc123/move-to-inbox
Authorization: Bearer <token>

Response: {
  "id": "abc123",
  "user_id": "user123",
  "title": "Important task",
  "status": "inbox",
  ...
}
```

### 3. GET `/api/tasks?status=next`
Retrieves tasks filtered by status. Supports `status=next` to get the user's next task.

**Authentication**: Required (via `get_current_user` dependency)

**Query Parameters**:
- `status` (optional): Filter by status (`inbox`, `next`, `scheduled`, `completed`)

**Response**: Array of task objects

**Example**:
```bash
GET /api/tasks?status=next
Authorization: Bearer <token>

Response: [
  {
    "id": "abc123",
    "user_id": "user123",
    "title": "Important task",
    "status": "next",
    ...
  }
]
```

## Security

All endpoints enforce authentication:
- Uses `get_current_user` dependency which validates JWT token
- All queries include `user_id = $1` to ensure users can only access/modify their own tasks
- Task existence checks verify `user_id` matches authenticated user

## Pydantic Models

The `Task` model has been updated to document the 'next' status:

```python
class Task(BaseModel):
    status: str = Field(default="inbox")  # inbox, next, scheduled, completed
```

## Migration

### For New Databases
Run `backend/schema.sql` which includes the unique index.

### For Existing Databases
Run `backend/migrations/add_next_status.sql` which:
1. Updates any invalid statuses to 'inbox' (safe default)
2. Creates the unique partial index

Or use the Python migration script:
```bash
cd backend
python3 run_migration.py
```

## Testing

Test templates are available in `backend/tests/test_next_task.py`. To implement full tests:

1. Install test dependencies:
   ```bash
   pip install pytest pytest-asyncio httpx
   ```

2. Set up test fixtures with:
   - Test database
   - Authentication mocks
   - Test data

3. Run tests:
   ```bash
   pytest backend/tests/test_next_task.py -v
   ```

## Implementation Details

### Transaction Safety
The `make-next` endpoint uses a database transaction to ensure atomicity:
- If setting a task to 'next' fails, the swap of existing 'next' task is rolled back
- Prevents race conditions where multiple tasks could be 'next' simultaneously

### Index Enforcement
The unique partial index at the database level prevents:
- Multiple 'next' tasks per user (even if application logic fails)
- Race conditions in concurrent requests

### Error Handling
- 404: Task not found or doesn't belong to user
- 401: Authentication required
- Database constraint violations are caught and returned as 500 errors

## Files Modified

1. `backend/server.py`:
   - Added `POST /tasks/{task_id}/make-next` endpoint
   - Added `POST /tasks/{task_id}/move-to-inbox` endpoint
   - Updated `Task` model comment to include 'next' status
   - `GET /tasks` already supports `status=next` filtering

2. `backend/schema.sql`:
   - Added unique partial index for 'next' status

3. `backend/migrations/add_next_status.sql`:
   - Migration script for existing databases

4. `backend/tests/test_next_task.py`:
   - Test templates (to be implemented)

