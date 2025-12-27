import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

// Use proxy in development, REACT_APP_BACKEND_URL in production
const getApiBase = () => {
  if (process.env.NODE_ENV === 'development') {
    // In development, use proxy: requests to /api/* are proxied to backend
    return '';
  }
  // In production, use REACT_APP_BACKEND_URL
  const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8010';
  
  // Debug logging (only in production, will be stripped in minified builds)
  if (process.env.NODE_ENV === 'production') {
    console.log('[AuthContext] NODE_ENV:', process.env.NODE_ENV);
    console.log('[AuthContext] REACT_APP_BACKEND_URL:', process.env.REACT_APP_BACKEND_URL);
    console.log('[AuthContext] Using API_BASE:', backendUrl);
    
    // Warn if using default localhost URL in production
    if (!process.env.REACT_APP_BACKEND_URL || backendUrl === 'http://localhost:8010') {
      console.error('[AuthContext] ⚠️ WARNING: REACT_APP_BACKEND_URL is not set! Using default localhost URL which will not work in production.');
      console.error('[AuthContext] Please set REACT_APP_BACKEND_URL in Vercel environment variables and redeploy.');
    }
  }
  
  return backendUrl;
};

const API_BASE = getApiBase();

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('auth_token'));
  const [loading, setLoading] = useState(true);

  // Set up axios interceptor for auth header
  useEffect(() => {
    const interceptor = axios.interceptors.request.use((config) => {
      const storedToken = localStorage.getItem('auth_token');
      if (storedToken) {
        config.headers.Authorization = `Bearer ${storedToken}`;
      }
      return config;
    });

    return () => axios.interceptors.request.eject(interceptor);
  }, []);

  // Verify token on mount
  const verifyToken = useCallback(async () => {
    const storedToken = localStorage.getItem('auth_token');
    if (!storedToken) {
      setLoading(false);
      return;
    }

    try {
      const url = API_BASE ? `${API_BASE}/api/auth/me` : '/api/auth/me';
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${storedToken}` }
      });
      setUser(response.data);
      setToken(storedToken);
    } catch (error) {
      console.error('Token verification failed:', error);
      localStorage.removeItem('auth_token');
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    verifyToken();
  }, [verifyToken]);

  const signup = async (email, password, name) => {
    try {
      const url = API_BASE ? `${API_BASE}/api/auth/signup` : '/api/auth/signup';
      const response = await axios.post(url, {
        email,
        password,
        name
      });
      const { token: newToken, user: userData } = response.data;
      localStorage.setItem('auth_token', newToken);
      setToken(newToken);
      setUser(userData);
      return userData;
    } catch (error) {
      console.error('Signup error:', error);
      // Check for HTTP response first (not a network error)
      if (error.response) {
        const status = error.response.status;
        const detail = error.response.data?.detail || error.response.data?.message;
        throw new Error(detail || `Request failed (HTTP ${status})`);
      }
      // True network error (no response)
      if (error.code === 'ERR_NETWORK' || error.code === 'ECONNREFUSED' || error.message === 'Network Error') {
        throw new Error('Cannot connect to backend server. Please check that the backend is running and REACT_APP_BACKEND_URL is set correctly.');
      }
      throw error;
    }
  };

  const login = async (email, password) => {
    try {
      const url = API_BASE ? `${API_BASE}/api/auth/login` : '/api/auth/login';
      const response = await axios.post(url, {
        email,
        password
      });
      const { token: newToken, user: userData } = response.data;
      localStorage.setItem('auth_token', newToken);
      setToken(newToken);
      setUser(userData);
      return userData;
    } catch (error) {
      console.error('Login error:', error);
      // Check for HTTP response first (not a network error)
      if (error.response) {
        const status = error.response.status;
        const detail = error.response.data?.detail || error.response.data?.message;
        throw new Error(detail || `Request failed (HTTP ${status})`);
      }
      // True network error (no response)
      if (error.code === 'ERR_NETWORK' || error.code === 'ECONNREFUSED' || error.message === 'Network Error') {
        throw new Error('Cannot connect to backend server. Please check that the backend is running and REACT_APP_BACKEND_URL is set correctly.');
      }
      throw error;
    }
  };

  const googleLogin = async (code, redirectUri) => {
    const url = API_BASE ? `${API_BASE}/api/auth/google` : '/api/auth/google';
    const response = await axios.post(url, {
      code,
      redirect_uri: redirectUri
    });
    const { token: newToken, user: userData } = response.data;
    localStorage.setItem('auth_token', newToken);
    setToken(newToken);
    setUser(userData);
    return userData;
  };

  const getGoogleAuthUrl = async (redirectUri) => {
    const url = API_BASE ? `${API_BASE}/api/auth/google/url` : '/api/auth/google/url';
    const response = await axios.get(url, {
      params: { redirect_uri: redirectUri }
    });
    return response.data.url;
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    setToken(null);
    setUser(null);
  };

  const value = {
    user,
    token,
    loading,
    isAuthenticated: !!user,
    signup,
    login,
    googleLogin,
    getGoogleAuthUrl,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
