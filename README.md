# ADD Daily - AI-Powered Voice Task Inbox

## Backend Setup

### Environment Variables

The backend requires environment variables to be configured. Create a `.env` file in the `backend/` directory:

```bash
cd backend
cp .env.example .env
# Edit .env with your actual values
```

### Required Environment Variables

- **`OPENAI_API_KEY`** (required): Your OpenAI API key for task extraction and transcription
- **`DATABASE_URL`** (required): PostgreSQL connection string (e.g., `postgresql://user:password@host:port/database`)

### Optional Environment Variables

- **`JWT_SECRET`**: Secret key for JWT token signing (defaults to a development key)
- **`GOOGLE_CLIENT_ID`**: Google OAuth client ID (for Google login)
- **`GOOGLE_CLIENT_SECRET`**: Google OAuth client secret
- **`REACT_APP_BACKEND_URL`**: Backend URL (defaults to `http://localhost:8001`)
- **`CORS_ORIGINS`**: Comma-separated list of allowed CORS origins
- **`ENV`**: Environment mode - set to `production` to disable `.env` file loading and API docs (defaults to `development`)

### Running the Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --reload --host 127.0.0.1 --port 8001
```

### API Documentation

In development mode, API documentation is available at:
- **Swagger UI**: http://127.0.0.1:8001/docs
- **ReDoc**: http://127.0.0.1:8001/redoc
- **OpenAPI JSON**: http://127.0.0.1:8001/openapi.json

In production mode (when `ENV=production`), API docs are disabled for security.
