# Backend Changes Needed for WIP-Limited Workflow

## 1. Schema Changes (run migration)
- Add `expires_at TIMESTAMP WITH TIME ZONE` column to tasks table
- Run: `backend/migrations/add_later_status.sql`

## 2. Model Changes
- Update Task model: add `expires_at: Optional[str] = None`
- Update Task model comment: `status: str = Field(default="inbox")  # inbox, next, scheduled, completed, later`

## 3. SELECT Queries
- Add `expires_at::text` to all SELECT queries that return tasks
- Locations:
  - `get_tasks()` - both status-filtered and all tasks queries
  - `get_task()` - single task query
  - `update_task()` - RETURNING clause
  - `make_task_next()` - RETURNING clause  
  - `move_task_to_inbox()` - RETURNING clause
  - `move_task_to_later()` - RETURNING clause (new endpoint)
  - `push_to_inbox()` - RETURNING clause
  - `push_to_calendar()` - INSERT statements

## 4. INSERT/UPDATE Queries
- Add `expires_at` column to INSERT statements:
  - `create_task()` - add NULL for expires_at
  - `push_to_inbox()` - add NULL for expires_at (change param_num from 12 to 13)
  - `push_to_calendar()` - add NULL for expires_at

## 5. UPDATE allowed_fields
- Add `'expires_at'` to allowed_fields in `update_task()`

## 6. Cleanup Logic
- Add cleanup in `get_tasks()`:
  ```python
  await conn.execute(
      "DELETE FROM tasks WHERE user_id = $1 AND status = 'later' AND expires_at < NOW()",
      user["id"]
  )
  ```

## 7. New Endpoint
- Add `POST /tasks/{task_id}/move-to-later` endpoint (see implementation in earlier attempt)

