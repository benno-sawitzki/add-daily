import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_BACKEND_URL;

// Validate API URL is set
if (!API) {
  console.error('REACT_APP_BACKEND_URL is not set! Authentication will not work.');
}

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
      const response = await axios.get(`${API}/api/auth/me`, {
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
    if (!API) {
      throw new Error('Backend URL is not configured. Please set REACT_APP_BACKEND_URL environment variable.');
    }
    try {
      const response = await axios.post(`${API}/api/auth/signup`, {
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
      if (error.code === 'ERR_NETWORK' || error.message.includes('Network Error')) {
        throw new Error('Cannot connect to backend server. Please check that the backend is running and REACT_APP_BACKEND_URL is set correctly.');
      }
      throw error;
    }
  };

  const login = async (email, password) => {
    if (!API) {
      throw new Error('Backend URL is not configured. Please set REACT_APP_BACKEND_URL environment variable.');
    }
    try {
      const response = await axios.post(`${API}/api/auth/login`, {
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
      if (error.code === 'ERR_NETWORK' || error.message.includes('Network Error')) {
        throw new Error('Cannot connect to backend server. Please check that the backend is running and REACT_APP_BACKEND_URL is set correctly.');
      }
      throw error;
    }
  };

  const googleLogin = async (code, redirectUri) => {
    const response = await axios.post(`${API}/api/auth/google`, {
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
    const response = await axios.get(`${API}/api/auth/google/url`, {
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
