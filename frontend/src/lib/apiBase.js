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
}

export default base;

