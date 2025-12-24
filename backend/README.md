# ADD Daily Backend

FastAPI backend for the ADD Daily task management application.

## Setup

### 1. Install Dependencies

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
# Edit .env with your actual values
```

Required variables:
- `DATABASE_URL` - PostgreSQL connection string
- `OPENAI_API_KEY` - OpenAI API key

### 3. Create Database Schema

Run the schema SQL file on your PostgreSQL database:

```bash
# Using psql
psql $DATABASE_URL -f schema.sql

# Or using a database client, run the contents of schema.sql
```

The schema creates three tables:
- `users` - User accounts and authentication
- `tasks` - Task data
- `settings` - User preferences (AI model settings)

### 4. Start the Server

```bash
source venv/bin/activate
python -m uvicorn server:app --reload --host 127.0.0.1 --port 8010
```

## API Documentation

Once running, visit:
- Swagger UI: http://127.0.0.1:8010/api/docs
- ReDoc: http://127.0.0.1:8010/api/redoc
- OpenAPI JSON: http://127.0.0.1:8010/api/openapi.json

## Database Schema

See `schema.sql` for the complete database schema. The schema includes:
- Users table with email/password and Google OAuth support
- Tasks table with priority, scheduling, and status tracking
- Settings table for user preferences
- Indexes for query optimization

