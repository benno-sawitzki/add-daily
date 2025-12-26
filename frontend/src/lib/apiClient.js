import axios from 'axios';
import API_BASE from './apiBase';

// Use single source of truth for API base URL
const API_BASE_URL = API_BASE;

// Export for debug panel
export const getApiBaseUrl = () => API_BASE_URL;

// Re-export API_BASE for convenience
export { default as API_BASE } from './apiBase';

// Log API base URL in dev mode for debugging
if (process.env.NODE_ENV === 'development') {
  console.log('🔧 API Client initialized with baseURL:', API_BASE_URL);
  console.log('🔧 In development, requests are proxied through webpack dev server');
  console.log('🔧 Browser requests will go to:', window.location.origin + API_BASE_URL);
}

// Create a centralized axios instance with default configuration
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000, // 10 seconds
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add request interceptor to include Authorization header and guardrails
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    // Dev-only guardrails: Warn if task views call dump endpoints or vice versa
    if (process.env.NODE_ENV === 'development') {
      const url = config.url || '';
      const isDumpEndpoint = url.includes('/dumps');
      const isTaskEndpoint = url.includes('/tasks');
      
      // Get stack trace to detect component context (rough heuristic)
      const stack = new Error().stack || '';
      const isTaskViewComponent = stack.includes('InboxSplitView') || 
                                   stack.includes('WeeklyCalendar') || 
                                   stack.includes('DailyCalendar') || 
                                   stack.includes('NextControlCenter') || 
                                   stack.includes('CommandCenter') ||
                                   stack.includes('TaskQueue') ||
                                   stack.includes('CompletedTasks');
      const isDumpViewComponent = stack.includes('DumpsListPage') || 
                                  stack.includes('DumpDetailPage') || 
                                  stack.includes('DumpsList') ||
                                  stack.includes('DumpReview');
      
      if (isTaskViewComponent && isDumpEndpoint) {
        console.warn(
          `⚠️ GUARDRAIL: Task view component is calling a dump endpoint: ${url}\n` +
          `Task views (Inbox/Next/Focus/Daily/Weekly) should ONLY call /tasks endpoints, not /dumps.`
        );
      }
      
      if (isDumpViewComponent && isTaskEndpoint) {
        console.warn(
          `⚠️ GUARDRAIL: Dump view component is calling a task endpoint: ${url}\n` +
          `Dump views should ONLY call /dumps endpoints, not /tasks.`
        );
      }
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Global debug interceptor - logs all requests and responses
const DEBUG_MODE = process.env.NODE_ENV === 'development' || process.env.REACT_APP_DEBUG_API === 'true';

// Request interceptor - log outgoing requests
apiClient.interceptors.request.use(
  (config) => {
      // Always log the final resolved URL in dev mode
      // Resolve relative URLs to full browser URL for display
      let fullUrl = config.baseURL && config.url 
        ? `${config.baseURL}${config.url}`
        : config.url || 'unknown';
      
      // If URL is relative, resolve it relative to current origin for logging
      if (fullUrl.startsWith('/') && typeof window !== 'undefined') {
        fullUrl = window.location.origin + fullUrl;
      }
    
    if (DEBUG_MODE || process.env.NODE_ENV === 'development') {
      console.log('🔵 API Request - Final URL:', fullUrl);
      console.log('🔵 API Request - Base URL:', config.baseURL);
      console.log('🔵 API Request - Path:', config.url);
      
      const headers = { ...config.headers };
      if (headers.Authorization) {
        headers.Authorization = '[REDACTED]';
      }
      
      console.log('🔵 API Request:', {
        method: config.method?.toUpperCase() || 'UNKNOWN',
        url: fullUrl,
        headers,
        body: config.data ? (typeof config.data === 'string' ? config.data : JSON.stringify(config.data)) : undefined,
      });
      
      // Update debug panel
      if (window.updateLastApiCall) {
        window.updateLastApiCall({
          method: config.method?.toUpperCase() || 'UNKNOWN',
          url: fullUrl,
          status: null,
          responseData: null,
          error: null,
        });
      }
    }
    return config;
  },
  (error) => {
    if (DEBUG_MODE) {
      console.error('🔴 API Request Error:', error);
      if (window.updateLastApiCall) {
        window.updateLastApiCall({
          error: error.message || 'Request failed',
        });
      }
    }
    return Promise.reject(error);
  }
);

// Response interceptor - log responses and errors
apiClient.interceptors.response.use(
  (response) => {
    if (DEBUG_MODE) {
      // Resolve relative URLs to full browser URL for display
      let fullUrl = response.config?.baseURL && response.config?.url 
        ? `${response.config.baseURL}${response.config.url}`
        : response.config?.url || 'unknown';
      
      // If URL is relative, resolve it relative to current origin
      if (fullUrl.startsWith('/') && typeof window !== 'undefined') {
        fullUrl = window.location.origin + fullUrl;
      }
      
      console.log('🟢 API Response:', {
        method: response.config?.method?.toUpperCase() || 'UNKNOWN',
        url: fullUrl,
        status: response.status,
        statusText: response.statusText,
        data: response.data,
      });
      
      // Update debug panel
      if (window.updateLastApiCall) {
        window.updateLastApiCall({
          method: response.config?.method?.toUpperCase() || 'UNKNOWN',
          url: fullUrl,
          status: response.status,
          statusText: response.statusText,
          responseData: response.data,
          error: null,
        });
      }
    }
    return response;
  },
  (error) => {
    if (DEBUG_MODE) {
      // Resolve relative URLs to full browser URL for display
      let fullUrl = error.config?.baseURL && error.config?.url 
        ? `${error.config.baseURL}${error.config.url}`
        : error.config?.url || 'unknown';
      
      // If URL is relative, resolve it relative to current origin
      if (fullUrl.startsWith('/') && typeof window !== 'undefined') {
        fullUrl = window.location.origin + fullUrl;
      }
      
      console.error('🔴 API Error:', {
        method: error.config?.method?.toUpperCase() || 'UNKNOWN',
        url: fullUrl,
        message: error.message,
        code: error.code,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data,
        hasResponse: !!error.response,
      });
      
      // Update debug panel
      if (window.updateLastApiCall) {
        window.updateLastApiCall({
          method: error.config?.method?.toUpperCase() || 'UNKNOWN',
          url: fullUrl,
          status: error.response?.status || null,
          statusText: error.response?.statusText || null,
          responseData: error.response?.data || null,
          error: error.message || (error.response?.data?.detail || error.response?.data?.message || 'Network error'),
        });
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;

