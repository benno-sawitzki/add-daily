#!/usr/bin/env bash
set -e

# kill old ports (ignore errors)
lsof -ti :8010 | xargs kill -9 2>/dev/null || true
lsof -ti :3000 | xargs kill -9 2>/dev/null || true

# start backend
cd ~/Projects/add-daily/backend
source venv/bin/activate
python -m uvicorn server:app --reload --host 127.0.0.1 --port 8010 &
BACK_PID=$!

# start frontend
cd ~/Projects/add-daily/frontend
npm start

# if frontend stops, stop backend
kill $BACK_PID 2>/dev/null || true
