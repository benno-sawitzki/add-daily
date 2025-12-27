/**
 * Single source of truth for API base URL
 * In development: uses relative "/api" (proxied through dev server)
 * In production: uses REACT_APP_BACKEND_URL or defaults to http://localhost:8010
 */
let base;
if (process.env.NODE_ENV === 'development') {
  // In development, use relative path (proxied through webpack dev server)
  base = '/api';
} else {
  // In production, use absolute URL
  const root = process.env.REACT_APP_BACKEND_URL || "http://localhost:8010";
  base = root.endsWith("/api") ? root : `${root}/api`;
  
  // Debug logging (only in production)
  if (process.env.NODE_ENV === 'production') {
    console.log('[apiBase] REACT_APP_BACKEND_URL:', process.env.REACT_APP_BACKEND_URL);
    console.log('[apiBase] Using API base:', base);
    
    // Warn if using default localhost URL in production
    if (!process.env.REACT_APP_BACKEND_URL || root === "http://localhost:8010") {
      console.error('[apiBase] ⚠️ WARNING: REACT_APP_BACKEND_URL is not set! Using default localhost URL which will not work in production.');
    }
  }
}

export default base;

