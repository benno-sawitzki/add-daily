# Deployment Configuration Guide

## Frontend (Vercel) Environment Variables

The frontend needs to know where the backend is deployed. Set this environment variable in Vercel:

### Required Environment Variable

**`REACT_APP_BACKEND_URL`**: The full URL of your backend API (without trailing slash)

Example:
```
REACT_APP_BACKEND_URL=https://your-backend.railway.app
```

### How to Set in Vercel

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add a new variable:
   - **Name**: `REACT_APP_BACKEND_URL`
   - **Value**: Your backend URL (e.g., `https://your-backend.railway.app`)
   - **Environment**: Select all environments (Production, Preview, Development) or just Production
4. Click **Save**
5. **Redeploy** your frontend for the changes to take effect

## Backend (Railway) Environment Variables

The backend needs to allow CORS requests from your frontend domain.

### Required Environment Variable

**`CORS_ORIGINS`**: Comma-separated list of allowed frontend origins

Example:
```
CORS_ORIGINS=https://your-app.vercel.app,https://your-app-git-main.vercel.app
```

**Note**: Include both your production domain and any preview/PR deployment domains you want to allow.

### How to Set in Railway

1. Go to your Railway project dashboard
2. Select your backend service
3. Navigate to **Variables** tab
4. Add a new variable:
   - **Key**: `CORS_ORIGINS`
   - **Value**: Your frontend URLs, comma-separated (e.g., `https://your-app.vercel.app,https://your-app-git-main.vercel.app`)
5. Click **Add**
6. Railway will automatically redeploy when you add environment variables

## Quick Checklist

- [ ] Set `REACT_APP_BACKEND_URL` in Vercel to your backend URL
- [ ] Set `CORS_ORIGINS` in Railway to include your Vercel frontend URL(s)
- [ ] Redeploy both frontend and backend after setting environment variables
- [ ] Test the connection by visiting your deployed frontend

## Troubleshooting

### "Cannot connect to backend server" Error

1. **Check `REACT_APP_BACKEND_URL` is set**: 
   - In Vercel, go to Settings → Environment Variables
   - Verify `REACT_APP_BACKEND_URL` exists and has the correct backend URL

2. **Check backend is accessible**:
   - Visit `https://your-backend.railway.app/api/health` in your browser
   - Should return `{"status":"ok"}`

3. **Check CORS configuration**:
   - Open browser DevTools → Network tab
   - Look for CORS errors (red requests with CORS-related error messages)
   - Verify your frontend URL is included in `CORS_ORIGINS` on the backend

4. **Verify environment variables are applied**:
   - After setting variables, make sure to redeploy
   - Environment variables are only available at build time for React apps
   - You may need to trigger a new deployment

### CORS Errors

If you see CORS errors in the browser console:

1. Check that `CORS_ORIGINS` in Railway includes your exact frontend URL
2. Make sure there are no trailing slashes in the URLs
3. Include both `https://your-app.vercel.app` and any preview URLs you use
4. After updating `CORS_ORIGINS`, wait for Railway to redeploy

## Example Configuration

### Frontend (Vercel)
```
REACT_APP_BACKEND_URL=https://add-daily-backend.railway.app
```

### Backend (Railway)
```
CORS_ORIGINS=https://add-daily.vercel.app,https://add-daily-git-main.vercel.app
```

