# Local Development Guide (macOS)

Step-by-step instructions to run the ADD Daily project locally on macOS.

## Prerequisites

- Python 3.11+ (check with `python3 --version`)
- Node.js 18+ and npm (check with `node --version` and `npm --version`)
- PostgreSQL database (or Supabase connection string)

## Backend Setup

### 1. Create Virtual Environment

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure Environment Variables

```bash
# Copy the example file
cp .env.example .env

# Edit .env and add your values:
# - OPENAI_API_KEY: Your OpenAI API key
# - DATABASE_URL: Your PostgreSQL connection string
```

Required environment variables:
- `OPENAI_API_KEY` - Get from https://platform.openai.com/api-keys
- `DATABASE_URL` - PostgreSQL connection string (e.g., `postgresql://user:password@host:port/database`)

See `backend/.env.example` for all available options.

### 3.5. Create Database Schema

**IMPORTANT:** You must create the database tables before the app will work.

```bash
# Using psql command line
psql $DATABASE_URL -f backend/schema.sql

# Or connect to your database and run the SQL from backend/schema.sql
```

The schema creates three tables: `users`, `tasks`, and `settings`. Without these tables, the app will fail when trying to create users or tasks.

### 4. Start the Backend Server

```bash
# Make sure venv is activated
source venv/bin/activate

# Start the server on port 8010
python -m uvicorn server:app --reload --host 127.0.0.1 --port 8010
```

The server will start and you should see:
```
INFO:     Uvicorn running on http://127.0.0.1:8010 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

### 5. Verify Backend is Running

- Visit http://127.0.0.1:8010 - should redirect to API docs
- API Documentation: http://127.0.0.1:8010/api/docs
- OpenAPI JSON: http://127.0.0.1:8010/api/openapi.json
- Health Check: http://127.0.0.1:8010/api/health

## Frontend Setup

### 1. Install Dependencies

```bash
cd frontend
npm install
```

### 2. Configure Environment

The frontend needs to know the backend URL. Check `frontend/.env` or create it:

```bash
REACT_APP_BACKEND_URL=http://127.0.0.1:8010
```

### 3. Start the Frontend

```bash
npm start
# or
npm run dev  # if available
```

The frontend will typically start on http://localhost:3000

## Important Notes

### API Routes

All API routes are under the `/api` prefix:
- ✅ API docs: http://127.0.0.1:8010/api/docs
- ✅ OpenAPI: http://127.0.0.1:8010/api/openapi.json
- ✅ Health: http://127.0.0.1:8010/api/health
- ❌ `/docs` or `/openapi.json` will return 404 (use `/api/docs` and `/api/openapi.json`)

The root path `/` redirects to `/api/docs` in development mode.

### Port Conflicts

If you get an error that the port is already in use:

**Backend (port 8010):**
```bash
# Find what's using port 8010
lsof -i :8010

# Kill the process (replace PID with the actual process ID)
kill -9 PID
```

**Frontend (port 3000):**
```bash
# Find what's using port 3000
lsof -i :3000

# Kill the process
kill -9 PID
```

**Alternative: Use different ports**

Backend:
```bash
python -m uvicorn server:app --reload --host 127.0.0.1 --port 8011
```

Frontend: Update `REACT_APP_BACKEND_URL` in frontend/.env to match your backend port.

## Troubleshooting

### Backend won't start

1. **Missing environment variables**: Check that `OPENAI_API_KEY` and `DATABASE_URL` are set in `backend/.env`
2. **Database connection error**: Verify your `DATABASE_URL` is correct and the database is accessible
3. **Port already in use**: See "Port Conflicts" section above

### Frontend can't connect to backend

1. **CORS errors**: Make sure `CORS_ORIGINS` in backend `.env` includes your frontend URL (e.g., `http://localhost:3000`)
2. **Backend not running**: Verify backend is running on the expected port
3. **Wrong backend URL**: Check `REACT_APP_BACKEND_URL` in frontend environment

### Virtual Environment Issues

If you get "command not found" errors:
```bash
# Make sure venv is activated (you should see (venv) in your prompt)
source backend/venv/bin/activate

# If that doesn't work, recreate the venv
cd backend
rm -rf venv
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Development Workflow

1. Start backend: `cd backend && source venv/bin/activate && python -m uvicorn server:app --reload --host 127.0.0.1 --port 8010`
2. Start frontend: `cd frontend && npm start`
3. Backend auto-reloads on code changes (thanks to `--reload`)
4. Frontend hot-reloads on code changes

## Quick Reference

**Backend:**
```bash
cd backend
source venv/bin/activate
python -m uvicorn server:app --reload --host 127.0.0.1 --port 8010
```

**Frontend:**
```bash
cd frontend
npm start
```

**API Docs:** http://127.0.0.1:8010/api/docs

