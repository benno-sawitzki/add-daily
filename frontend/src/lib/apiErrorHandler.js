/**
 * Centralized error handling utility for API errors
 * Provides consistent error messages based on error type
 * 
 * Rules:
 * - If err.response exists: HTTP error (show status + response data snippet)
 * - Else: Network error (show "Cannot reach backend")
 */

export function handleApiError(error, defaultMessage = "Request failed") {
  // Build request URL for logging
  const requestUrl = error.config?.url || error.config?.baseURL || 'unknown';
  const method = error.config?.method?.toUpperCase() || 'UNKNOWN';
  const fullUrl = error.config?.baseURL && error.config?.url 
    ? `${error.config.baseURL}${error.config.url}`
    : requestUrl;

  // Log full error details in development
  if (process.env.NODE_ENV === 'development') {
    console.error('API Error Details:', {
      requestUrl: fullUrl,
      method: method,
      status: error.response?.status,
      statusText: error.response?.statusText,
      responseData: error.response?.data,
      message: error.message,
      code: error.code,
      hasResponse: !!error.response,
    });
  }

  // CRITICAL: Check if we got an HTTP response FIRST
  // If error.response exists, it's an HTTP error (not a network error)
  if (error.response) {
    // Server responded with an error status
    const status = error.response.status;
    const responseData = error.response.data;
    
    // Extract error message/detail from response
    const detail = responseData?.detail || responseData?.message;
    
    // Build message with status code
    let message = `Request failed (HTTP ${status})`;
    
    // Include a short snippet of response data if available
    if (detail) {
      // Use detail directly if it's a string
      message = typeof detail === 'string' 
        ? detail.length > 100 
          ? `${detail.substring(0, 100)}...`
          : detail
        : message;
    } else if (responseData && typeof responseData === 'object') {
      // If no detail, include a snippet of the response
      const dataStr = JSON.stringify(responseData);
      if (dataStr.length > 100) {
        message += `: ${dataStr.substring(0, 100)}...`;
      } else {
        message += `: ${dataStr}`;
      }
    }
    
    return message;
  }

  // No response - true network/CORS error, timeout, etc.
  // Only show "Cannot reach backend" when there's truly no response
  if (error.code === 'ECONNREFUSED' || error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
    return "Cannot reach backend";
  }

  if (error.code === 'ECONNABORTED') {
    return "Request timed out";
  }

  // Fallback to generic message
  return defaultMessage;
}

