import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, Outlet } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "sonner";
import LandingPage from "@/components/LandingPage";
import MainApp from "@/components/MainApp";
import FocusScreen from "@/components/FocusScreen";
import AuthCallback from "@/components/AuthCallback";
import DumpsListPage from "@/components/DumpsListPage";
import DumpDetailPage from "@/components/DumpDetailPage";
import ProcessingPage from "@/components/ProcessingPage";
import SettingsPage from "@/components/SettingsPage";
import { Loader2 } from "lucide-react";
import axios from "axios";
import "@/App.css";

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return children;
};

// Public Route - redirects to app if authenticated
const PublicRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/app" replace />;
  }

  return children;
};

// FocusScreen wrapper that loads task data
const FocusScreenWrapper = () => {
  const { user } = useAuth();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  
  useEffect(() => {
    const loadTask = async () => {
      try {
        const session = JSON.parse(localStorage.getItem('hyperfocus_session') || 'null');
        if (!session || !session.nextTaskId) {
          navigate("/app");
          return;
        }

        const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
        const response = await axios.get(`${API}/tasks/${session.nextTaskId}`);
        setTask(response.data);
      } catch (error) {
        console.error("Error loading task for focus screen:", error);
        navigate("/app");
      } finally {
        setLoading(false);
      }
    };

    loadTask();
  }, [navigate]);

  const handleCompleteTask = async (taskId) => {
    try {
      const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
      await axios.patch(`${API}/tasks/${taskId}`, { status: "completed" });
      
      // Dispatch event to notify MainApp to refresh metrics
      // This ensures Command Center updates even when task is completed from FocusScreen
      window.dispatchEvent(new CustomEvent('task-completed', { 
        detail: { taskId } 
      }));
      
      if (process.env.NODE_ENV === 'development') {
        console.log('[FocusScreen] Task completed, dispatched event:', { taskId });
      }
    } catch (error) {
      console.error("Error completing task:", error);
      // Still dispatch event even on error, so UI can refresh
      window.dispatchEvent(new CustomEvent('task-completed', { 
        detail: { taskId } 
      }));
    }
  };

  const handleCreateTask = async (taskData) => {
    try {
      const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
      await axios.post(`${API}/tasks`, taskData);
    } catch (error) {
      console.error("Error creating task:", error);
      throw error;
    }
  };

  const handleRefreshTasks = async () => {
    // No-op for focus screen
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!task) {
    return null;
  }

  return (
    <FocusScreen
      task={task}
      onCompleteTask={handleCompleteTask}
      onCreateTask={handleCreateTask}
      onRefreshTasks={handleRefreshTasks}
    />
  );
};

// Dumps pages wrapper that provides user context
const DumpsListWrapper = () => {
  const { user } = useAuth();
  return <DumpsListPage userId={user?.id} />;
};

const DumpDetailWrapper = () => {
  const { user } = useAuth();
  return <DumpDetailPage userId={user?.id} />;
};

const ProcessingWrapper = () => {
  const { user } = useAuth();
  return <ProcessingPage userId={user?.id} />;
};

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <PublicRoute>
            <LandingPage />
          </PublicRoute>
        }
      />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <MainApp />
          </ProtectedRoute>
        }
      >
        {/* Nested routes under /app - these render inside MainApp via Outlet */}
        {/* Views that render via TabsContent in MainApp (no separate component needed) */}
        <Route path="inbox" element={null} />
        <Route path="weekly" element={null} />
        <Route path="daily" element={null} />
        <Route path="completed" element={null} />
        <Route path="process" element={<ProcessingWrapper />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="dumps" element={<DumpsListWrapper />} />
        <Route path="dumps/:id" element={<DumpDetailWrapper />} />
      </Route>
      <Route
        path="/app/focus"
        element={
          <ProtectedRoute>
            <FocusScreenWrapper />
          </ProtectedRoute>
        }
      />
      {/* Catch all - redirect to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="app-theme">
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
          <Toaster 
            position="bottom-right" 
            richColors 
            duration={2000}
            toastOptions={{
              style: {
                fontSize: '14px',
                padding: '12px 16px',
              }
            }}
          />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
