import { useState, useEffect, useCallback, useRef } from "react";
import "@/App.css";
import { toast } from "sonner";
import apiClient from "@/lib/apiClient";
import { handleApiError } from "@/lib/apiErrorHandler";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Mic,
  Inbox,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Sparkles,
  LogOut,
  User,
  ChevronDown,
  Brain,
  BookOpen,
  Archive,
} from "lucide-react";
import InboxSplitView from "@/components/InboxSplitView";
import Logbook from "@/components/Logbook";
import WeeklyCalendar from "@/components/WeeklyCalendar";
import DailyCalendar from "@/components/DailyCalendar";
import VoiceOverlay from "@/components/VoiceOverlay";
import TaskQueue from "@/components/TaskQueue";
import CompletedTasks from "@/components/CompletedTasks";
import InboxFullModal from "@/components/InboxFullModal";
import CarryoverModal from "@/components/CarryoverModal";
import CommandCenter from "@/components/CommandCenter";
import DebugPanel from "@/components/DebugPanel";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useLocation, Outlet } from "react-router-dom";

// API client is now centralized in @/lib/apiClient

// AI_MODELS constant removed - model is always GPT 5.2

function MainApp() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [tasks, setTasks] = useState([]);
  
  // Sync activeView with current route
  const getActiveViewFromRoute = () => {
    if (location.pathname.startsWith('/app/process')) {
      return 'process';
    }
    if (location.pathname.startsWith('/app/dumps')) {
      return 'dumps';
    }
    if (location.pathname === '/app' || location.pathname === '/app/inbox') {
      return 'inbox'; // Default to inbox for /app or /app/inbox
    }
    // For other routes, extract from pathname or default to inbox
    const pathParts = location.pathname.split('/');
    if (pathParts[2]) {
      const view = pathParts[2]; // e.g., /app/weekly -> 'weekly'
      // Only allow valid tab values, default to inbox for unknown routes
      const validViews = ['inbox', 'weekly', 'daily', 'completed', 'logbook', 'process', 'dumps'];
      return validViews.includes(view) ? view : 'inbox';
    }
    return 'inbox';
  };
  
  const [activeView, setActiveView] = useState(getActiveViewFromRoute());
  
  // Sync activeView when route changes
  useEffect(() => {
    const view = getActiveViewFromRoute();
    setActiveView(view);
  }, [location.pathname]);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [settings, setSettings] = useState({
    ai_provider: "openai",
    ai_model: "gpt-5.2",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [queuedTasks, setQueuedTasks] = useState([]);
  const [queuedTranscript, setQueuedTranscript] = useState("");
  const [showTaskQueue, setShowTaskQueue] = useState(false);
  const [showInboxFullModal, setShowInboxFullModal] = useState(false);
  const [pendingTask, setPendingTask] = useState(null);
  const [pendingTasks, setPendingTasks] = useState([]); // For batch operations
  const [showCarryoverModal, setShowCarryoverModal] = useState(false);
  const [currentEnergy, setCurrentEnergy] = useState("medium");
  const [metricsRefreshTrigger, setMetricsRefreshTrigger] = useState(0);

  // Track last shown error toast to prevent duplicates
  const lastErrorToastRef = useRef({ message: null, timestamp: 0 });
  const TOAST_DEBOUNCE_MS = 5000; // Don't show same error within 5 seconds

  const fetchTasks = useCallback(async () => {
    if (!user?.id) {
      console.log("fetchTasks: User not available yet, skipping");
      return;
    }
    
    try {
      const response = await apiClient.get('/tasks');
      setTasks(response.data || []);
      // Clear error state on success
      lastErrorToastRef.current = { message: null, timestamp: 0 };
    } catch (error) {
      const errorDetails = {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        statusText: error.response?.statusText,
        user_id: user?.id,
      };
      console.error("Error fetching tasks:", errorDetails);
      
      // Extract error message
      const errorMessage = error.response?.data?.detail || error.message || "Unknown error";
      const errorMsg = errorMessage.includes("completed_at") 
        ? "Database schema issue: Please run the migration to add completed_at column"
        : process.env.NODE_ENV === 'development' 
          ? `Failed to fetch tasks: ${errorMessage}`
          : "Failed to fetch tasks";
      
      // Deduplicate toast: only show if different message or enough time passed
      const now = Date.now();
      const shouldShowToast = 
        lastErrorToastRef.current.message !== errorMsg ||
        (now - lastErrorToastRef.current.timestamp) > TOAST_DEBOUNCE_MS;
      
      if (shouldShowToast) {
        toast.error(errorMsg, {
          id: 'fetch-tasks-error', // Use fixed ID to deduplicate
          duration: 5000,
        });
        lastErrorToastRef.current = { message: errorMsg, timestamp: now };
      }
      
      // Don't clear tasks on error - keep existing UI usable
      // If this is the first fetch and we have no tasks yet, keep empty array
      // UI will show empty state gracefully
    }
  }, [user]);

  const fetchSettings = useCallback(async () => {
    try {
      const response = await apiClient.get('/settings');
      setSettings(response.data);
    } catch (error) {
      console.error("Error fetching settings:", error);
    }
  }, []);

  // Fetch user preferences (energy level)
  const fetchUserPreferences = useCallback(async () => {
    try {
      const response = await apiClient.get('/user/preferences');
      if (response.data.energy_level) {
        setCurrentEnergy(response.data.energy_level);
      }
    } catch (error) {
      console.error("Error fetching user preferences:", error);
      // Fallback to localStorage
      try {
        const stored = localStorage.getItem('user_energy');
        if (stored) setCurrentEnergy(stored);
      } catch {}
    }
  }, []);

  const handleEnergyChange = async (energy) => {
    setCurrentEnergy(energy);
    // Persist to backend
    try {
      const formData = new FormData();
      formData.append('energy_level', energy);
      await apiClient.post('/user/preferences', formData);
    } catch (error) {
      console.error("Error saving energy preference:", error);
      // Fallback to localStorage
      try {
        localStorage.setItem('user_energy', energy);
      } catch {}
    }
  };

  useEffect(() => {
    // Only fetch when user is available
    if (user?.id) {
      fetchTasks();
      fetchSettings();
      fetchUserPreferences();
    }
  }, [user?.id, fetchTasks, fetchSettings, fetchUserPreferences]);

  // Refetch tasks when navigating to inbox or process view (to catch tasks created elsewhere)
  useEffect(() => {
    if (user?.id && (location.pathname === '/app' || location.pathname === '/app/inbox' || location.pathname === '/app/process')) {
      fetchTasks();
    }
  }, [location.pathname, user?.id, fetchTasks]);

  // Listen for task refresh events from ProcessingPage (when tasks are promoted)
  useEffect(() => {
    const handleTaskRefresh = () => {
      if (user?.id) {
        fetchTasks();
      }
    };

    window.addEventListener('refresh-tasks', handleTaskRefresh);
    return () => {
      window.removeEventListener('refresh-tasks', handleTaskRefresh);
    };
  }, [user?.id, fetchTasks]);

  /**
   * Unified task update function - used by all views
   * Handles optimistic updates and error recovery
   */
  const updateTask = async (taskId, updates) => {
    // Find the task to check if status is actually changing
    const currentTask = tasks.find(t => t.id === taskId);
    const statusChanged = updates.status && currentTask?.status !== updates.status;
    
    // Optimistic update: update UI immediately for better UX
    setTasks(prevTasks => 
      prevTasks.map(task => 
        task.id === taskId ? { ...task, ...updates } : task
      )
    );
    
    try {
      const response = await apiClient.patch(`/tasks/${taskId}`, updates);
      // Update with server response (more accurate, includes computed fields)
      setTasks(prevTasks => 
        prevTasks.map(task => 
          task.id === taskId ? response.data : task
        )
      );
      
      // If status changed (e.g., to/from completed, inbox, next), refetch to ensure badge counts are accurate
      if (statusChanged) {
        // Refetch tasks to ensure badge counts match the actual task list
        await fetchTasks();
      }
      
      // Refresh Command Center metrics if status changed to/from completed
      // This ensures done task count is updated in Command Center
      // Do this regardless of statusChanged to ensure metrics always refresh
      if (updates.status === 'completed' || currentTask?.status === 'completed') {
        setMetricsRefreshTrigger(prev => prev + 1);
      }
      
      // Don't show toast for drag-and-drop updates (too noisy)
      // toast.success("Task updated");
    } catch (error) {
      // Revert optimistic update on error
      await fetchTasks();
      
      // handleApiError already shows HTTP status and response body snippet
      const errorMessage = handleApiError(error, "Failed to update task");
      toast.error(errorMessage);
    }
  };

  /**
   * Unified task schedule update - used by calendar views
   * Normalizes payload to ensure consistent format
   */
  const updateTaskSchedule = async (taskId, { scheduled_date, scheduled_time, duration = null }) => {
    const payload = {
      scheduled_date,
      scheduled_time,
      status: "scheduled",
    };
    
    if (duration !== null && duration !== undefined) {
      payload.duration = duration;
    }
    
    return updateTask(taskId, payload);
  };

  const createTask = async (taskData) => {
    const currentInboxCount = tasks.filter((t) => t.status === "inbox").length;
    
    // Check inbox cap (5 tasks max) - only for inbox status
    if ((taskData.status === "inbox" || !taskData.status) && currentInboxCount >= 5) {
      // Inbox is full - show modal
      setPendingTask(taskData);
      setShowInboxFullModal(true);
      throw new Error("INBOX_FULL"); // Signal to caller that action is pending
    }
    
    // Can add directly
    try {
      const response = await apiClient.post('/tasks', {
        ...taskData,
        status: taskData.status || "inbox",
      });
      
      // Add new task to UI
      setTasks(prevTasks => [...prevTasks, response.data]);
      toast.success("Task added!");
      return response.data;
    } catch (error) {
      if (error.message === "INBOX_FULL") {
        throw error; // Re-throw to avoid showing error toast
      }
      console.error("Error creating task:", error);
      toast.error("Failed to create task");
      throw error;
    }
  };

  const deleteTask = async (taskId) => {
    // Find the task to delete
    const deletedTask = tasks.find(t => t.id === taskId);
    if (!deletedTask) {
      console.warn("[DELETE] Task not found in local state:", taskId);
      return;
    }
    
    const remainingTasks = tasks.filter(t => t.id !== taskId);
    const remainingInboxTasks = remainingTasks.filter(t => t.status === "inbox");
    const isLastInboxTask = remainingInboxTasks.length === 0 && deletedTask.status === "inbox";
    const wasNextTask = deletedTask.status === "next";
    
    console.log("[DELETE] Starting deletion:", {
      taskId,
      deletedTaskTitle: deletedTask.title,
      deletedTaskStatus: deletedTask.status,
      remainingInboxCount: remainingInboxTasks.length,
      isLastInboxTask,
      wasNextTask,
      totalTasksBefore: tasks.length,
      totalTasksAfter: remainingTasks.length
    });
    
    // Optimistic update: remove from UI immediately
    setTasks(prevTasks => prevTasks.filter(t => t.id !== taskId));
    
    try {
      await apiClient.delete(`/tasks/${taskId}`);
      // Refetch tasks to ensure UI is in sync with server state
      // This ensures badge counts match the actual task list
      await fetchTasks();
    } catch (error) {
      // Revert optimistic update on error
      await fetchTasks();
      
      // Enhanced error logging
      const errorDetails = {
        taskId,
        errorMessage: error.message,
        errorResponse: error.response?.data,
        errorStatus: error.response?.status,
        errorStatusText: error.response?.statusText,
        isLastInboxTask,
        wasNextTask,
        deletedTaskStatus: deletedTask.status,
        requestUrl: `/tasks/${taskId}`,
        requestMethod: 'DELETE'
      };
      
      console.error("[DELETE] Error deleting task:", errorDetails);
      
      if (process.env.NODE_ENV === 'development') {
        console.error("[DELETE] Full error object:", error);
        console.error("[DELETE] Error stack:", error.stack);
      }
      
      // handleApiError already shows HTTP status and response body snippet
      const errorMessage = handleApiError(error, "Failed to delete task");
      toast.error(errorMessage);
      
      // Re-throw for caller to handle if needed
      throw error;
    }
  };

  // Delete a queued task (before pushing to calendar)
  const deleteQueuedTask = (taskId) => {
    setQueuedTasks(prev => prev.filter(t => t.id !== taskId));
  };

  // Update a queued task (before pushing to calendar)
  const updateQueuedTask = (taskId, updates) => {
    setQueuedTasks(prev => prev.map(t => 
      t.id === taskId ? { ...t, ...updates } : t
    ));
  };

  // Reorder queued tasks
  const reorderQueuedTasks = (newOrder) => {
    setQueuedTasks(newOrder);
  };

  const processVoiceInput = async (transcript) => {
    setIsLoading(true);
    try {
      console.log("Processing voice input:", { 
        transcriptLength: transcript.length, 
        transcriptPreview: transcript.substring(0, 100),
        model: settings.ai_model, 
        provider: settings.ai_provider 
      });
      
      const response = await apiClient.post('/tasks/process-voice-queue', {
        transcript,
        model: settings.ai_model,
        provider: settings.ai_provider,
      });
      
      console.log("Voice processing response:", response.data);
      console.log("🔍 DIAGNOSTIC: Response structure:", {
        hasTasks: !!response.data.tasks,
        tasksType: typeof response.data.tasks,
        tasksIsArray: Array.isArray(response.data.tasks),
        tasksLength: response.data.tasks?.length,
        tasks: response.data.tasks,
        fullResponse: response.data
      });
      
      // Show task queue instead of pushing directly to calendar
      if (response.data.tasks && response.data.tasks.length > 0) {
        const extractedTasks = response.data.tasks;
        console.log("🔍 DIAGNOSTIC: About to setQueuedTasks:", {
          extractedTasksLength: extractedTasks.length,
          extractedTasks: extractedTasks,
          extractedTasksDetails: extractedTasks.map((t, i) => ({
            index: i,
            id: t.id,
            title: t.title,
            duration: t.duration,
            priority: t.priority
          }))
        });
        setQueuedTasks(extractedTasks);
        setQueuedTranscript(transcript); // Store transcript for display/editing
        setShowTaskQueue(true);
        setIsVoiceActive(false);
      } else {
        console.warn("🔍 DIAGNOSTIC: No tasks found in response:", response.data);
        toast.info("No tasks found in your input");
      }
      
      return response.data;
    } catch (error) {
      console.error("Error processing voice:", error);
      console.error("Error details:", {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      // Check for quota exceeded error
      if (error.response?.status === 429 || error.response?.data?.detail?.includes("QUOTA_EXCEEDED")) {
        toast.error("API quota exceeded. Please add credits to your OpenAI account at https://platform.openai.com/account/billing");
      } else {
        const errorMessage = error.response?.data?.detail || error.message || "Failed to process voice input";
        toast.error(errorMessage);
      }
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // Push queued tasks to calendar
  const pushToCalendar = async (tasksToPushOverride = null) => {
    const tasksToPush = tasksToPushOverride || queuedTasks;
    const taskCount = tasksToPush.length;
    // Save tasks before clearing (needed for error recovery)
    
    // Optimistic update: add tasks to UI immediately
    const optimisticTasks = tasksToPush.map(task => ({
      ...task,
      status: "scheduled",
      user_id: user?.id,
      created_at: new Date().toISOString()
    }));
    setTasks(prevTasks => [...prevTasks, ...optimisticTasks]);
      if (!tasksToPushOverride) {
        setShowTaskQueue(false);
        setQueuedTasks([]);
      }
      setActiveView("weekly");
    
    try {
      const response = await apiClient.post('/tasks/push-to-calendar', {
        tasks: tasksToPush,
      });
      
      // Replace optimistic tasks with server response (more accurate, includes scheduling)
      if (response.data.tasks && response.data.tasks.length > 0) {
        setTasks(prevTasks => {
          // Remove optimistic tasks and add server tasks
          const withoutOptimistic = prevTasks.filter(
            t => !optimisticTasks.some(ot => ot.id === t.id)
          );
          return [...withoutOptimistic, ...response.data.tasks];
        });
      }
      
      toast.success(`${taskCount} tasks scheduled!`);
    } catch (error) {
      // Revert optimistic update on error
      setTasks(prevTasks => 
        prevTasks.filter(t => !optimisticTasks.some(ot => ot.id === t.id))
      );
      console.error("Error pushing to calendar:", error);
      const errorMessage = error.response?.data?.detail || error.message || "Failed to push tasks to calendar";
      toast.error(errorMessage);
      // Restore queue on error (only if not using override)
      if (!tasksToPushOverride) {
        setQueuedTasks(tasksToPush);
        setShowTaskQueue(true);
      }
    }
  };

  // Push queued tasks to inbox
  const pushToInbox = async (tasksToPushOverride = null) => {
    const tasksToPush = tasksToPushOverride || queuedTasks;
    const taskCount = tasksToPush.length;
    const currentInboxCount = tasks.filter((t) => t.status === "inbox").length;
    const availableSlots = 5 - currentInboxCount;
    
    // Check inbox cap
    if (availableSlots <= 0) {
      // No slots available - show modal for all tasks
      toast.warning(`Inbox is full (5 tasks). Please choose what to do with ${taskCount} task${taskCount > 1 ? 's' : ''}.`);
      setPendingTasks(tasksToPush);
      if (tasksToPush.length > 0) {
        setPendingTask(tasksToPush[0]);
        setShowInboxFullModal(true);
      }
      return;
    } else if (taskCount > availableSlots) {
      // Partial fit - add what fits, show modal for overflow
      const tasksThatFit = tasksToPush.slice(0, availableSlots);
      const overflowTasks = tasksToPush.slice(availableSlots);
      
      // Add tasks that fit
      const tasksToFit = [...tasksThatFit];
      try {
        const response = await apiClient.post('/tasks/push-to-inbox', {
          tasks: tasksToFit,
        });
        
        if (response.data.tasks && response.data.tasks.length > 0) {
          setTasks(prevTasks => [...prevTasks, ...response.data.tasks]);
          await fetchTasks(); // Refresh to get accurate count
        }
        
        toast.success(`${availableSlots} tasks added to inbox!`);
        
        // Show modal for overflow
        if (overflowTasks.length > 0) {
          toast.warning(`Inbox is now full. Please choose what to do with ${overflowTasks.length} remaining task${overflowTasks.length > 1 ? 's' : ''}.`);
          setPendingTasks(overflowTasks);
          setPendingTask(overflowTasks[0]);
          setShowInboxFullModal(true);
          
          // Update queued tasks if not using override
          if (!tasksToPushOverride) {
            setQueuedTasks(overflowTasks);
          }
        }
        return;
      } catch (error) {
        console.error("Error pushing tasks to inbox:", error);
        const errorDetail = error.response?.data?.detail || error.message || "Unknown error";
        let errorMessage = "Failed to add some tasks to inbox";
        
        // Extract exact missing column/table info from error message
        if (errorDetail.includes("Missing") || errorDetail.includes("column") || errorDetail.includes("does not exist")) {
          // Use the exact error message from backend (it now includes column names)
          errorMessage = errorDetail;
        } else if (process.env.NODE_ENV === 'development') {
          errorMessage = `Failed to add tasks: ${errorDetail}`;
        }
        
        toast.error(errorMessage, {
          id: 'push-to-inbox-partial-error',
          duration: 7000, // Longer duration for migration messages
        });
        return;
      }
    }
    
    // All tasks fit - proceed normally (or use override)
    
    // Optimistic update: add tasks to UI immediately
    const optimisticTasks = tasksToPush.map(task => ({
      ...task,
      status: "inbox",
      user_id: user?.id,
      created_at: new Date().toISOString()
    }));
      setTasks(prevTasks => [...prevTasks, ...optimisticTasks]);
      if (!tasksToPushOverride) {
        setShowTaskQueue(false);
        setQueuedTasks([]);
      }
      setActiveView("inbox");
    
    try {
      const response = await apiClient.post('/tasks/push-to-inbox', {
        tasks: tasksToPush,
      });
      
      // Replace optimistic tasks with server response (more accurate)
      if (response.data.tasks && response.data.tasks.length > 0) {
        setTasks(prevTasks => {
          // Remove optimistic tasks and add server tasks
          const withoutOptimistic = prevTasks.filter(
            t => !optimisticTasks.some(ot => ot.id === t.id)
          );
          return [...withoutOptimistic, ...response.data.tasks];
        });
      }
      
      toast.success(`${taskCount} tasks added to inbox!`);
    } catch (error) {
      // Revert optimistic update on error
      setTasks(prevTasks => 
        prevTasks.filter(t => !optimisticTasks.some(ot => ot.id === t.id))
      );
      console.error("Error pushing to inbox:", error);
      
      // Extract and show helpful error message
      const errorDetail = error.response?.data?.detail || error.message || "Unknown error";
      let errorMessage = "Failed to push tasks to inbox";
      
      // Extract exact missing column/table info from error message
      if (errorDetail.includes("Missing") || errorDetail.includes("column") || errorDetail.includes("does not exist")) {
        // Use the exact error message from backend (it now includes column names)
        errorMessage = errorDetail;
      } else if (process.env.NODE_ENV === 'development') {
        errorMessage = `Failed to push tasks to inbox: ${errorDetail}`;
      }
      
      toast.error(errorMessage, {
        id: 'push-to-inbox-error', // Deduplicate
        duration: 7000, // Longer duration for migration messages
      });
      
      // Restore queue on error (only if not using override)
      if (!tasksToPushOverride) {
        setQueuedTasks(tasksToPush);
        setShowTaskQueue(true);
      }
    }
  };

  const cancelTaskQueue = () => {
    setShowTaskQueue(false);
    setQueuedTasks([]);
    setQueuedTranscript("");
  };

  // Reprocess transcript (when user edits it in TaskQueue)
  const reprocessTranscript = async (editedTranscript) => {
    setIsLoading(true);
    try {
      const response = await apiClient.post('/tasks/process-voice-queue', {
        transcript: editedTranscript,
        model: settings.ai_model,
        provider: settings.ai_provider,
      });
      
      if (response.data.tasks && response.data.tasks.length > 0) {
        setQueuedTasks(response.data.tasks);
        setQueuedTranscript(editedTranscript);
      } else {
        toast.info("No tasks found in your input");
      }
      
      return response.data;
    } catch (error) {
      console.error("Error reprocessing transcript:", error);
      toast.error("Failed to reprocess transcript");
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // Settings are now fixed to GPT 5.2
  // updateSettings function removed - model is always GPT 5.2

  // Compute filtered task lists from the same source of truth (tasks state)
  // These are computed values that update when tasks state changes
  const inboxTasks = tasks.filter((t) => t.status === "inbox");
  const nextTasks = tasks.filter((t) => t.status === "next"); // Next Today tasks (cap: 1)
  const completedTasks = tasks.filter((t) => t.status === "completed");
  const focusTasks = tasks.filter((t) => t.status === "focus");
  
  // Debug logging (dev only) to track task counts and badge counts
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[TASK COUNTS DEBUG]', {
        totalTasks: tasks.length,
        inboxTasks: inboxTasks.length,
        completedTasks: completedTasks.length,
        nextTasks: nextTasks.length,
        focusTasks: focusTasks.length,
        endpoint: '/tasks',
        source: 'MainApp tasks state (from GET /tasks)',
        timestamp: new Date().toISOString(),
      });
    }
  }, [tasks, inboxTasks.length, completedTasks.length, nextTasks.length, focusTasks.length]);
  
  // Handlers for InboxFullModal
  const handleSetAsNext = async () => {
    if (!pendingTask) return;
    
    const nextTasksCount = nextTasks.length;
    const NEXT_TODAY_CAP = 1;
    
    // Check Next Today cap
    if (nextTasksCount >= NEXT_TODAY_CAP) {
      toast.error(`Next Today is full (${NEXT_TODAY_CAP}). Finish or move something out first.`);
      return;
    }
    
    // Create task directly with "next" status (NEXT_TODAY)
    // No inbox cap checks - Next Today is independent of inbox
    try {
      const response = await apiClient.post('/tasks', {
        ...pendingTask,
        status: "next",
      });
      
      if (!response.data || !response.data.id) {
        throw new Error("Failed to create task");
      }
      
      await fetchTasks();
      toast.success("Task set as Next!");
      
      // Process next pending task if any
      processNextPendingTask();
    } catch (error) {
      // handleApiError already shows HTTP status and response body snippet
      const errorMessage = handleApiError(error, "Failed to set task as next");
      toast.error(errorMessage, {
        id: 'create-next-error', // Deduplicate
        duration: 5000,
      });
    }
  };
  
  
  const handleReplaceTask = async (replaceTaskId) => {
    if (!pendingTask) return;
    
    try {
      // Delete the task to replace
      await apiClient.delete(`/tasks/${replaceTaskId}`);
      
      // Create new task
      const response = await apiClient.post('/tasks/push-to-inbox', {
        tasks: [{ ...pendingTask, status: "inbox" }],
      });
      
      await fetchTasks();
      toast.success("Task replaced!");
      
      // Process next pending task if any
      processNextPendingTask();
    } catch (error) {
      console.error("Error replacing task:", error);
      const errorMessage = error.response?.data?.detail || error.message || "Failed to replace task";
      toast.error(errorMessage);
    }
  };
  
  // Process next pending task (for batch handling)
  const processNextPendingTask = () => {
    if (pendingTasks.length > 1) {
      // Remove the first task (just processed) from pendingTasks
      const remainingTasks = pendingTasks.slice(1);
      setPendingTasks(remainingTasks);
      if (remainingTasks.length > 0) {
        setPendingTask(remainingTasks[0]);
        // Keep modal open for next task
      } else {
        // No more pending tasks
        setPendingTask(null);
        setShowInboxFullModal(false);
      }
    } else {
      // Last task processed
      setPendingTask(null);
      setPendingTasks([]);
      setShowInboxFullModal(false);
    }
  };
  
  const handleCancelPendingTask = () => {
    setPendingTask(null);
    setPendingTasks([]);
    setShowInboxFullModal(false);
  };

  const handleCarryoverKeepSelected = async ({ keepTasks, moveToRemove }) => {
    try {
      // Move unselected tasks back to inbox (removed from Next Today)
      const movePromises = moveToRemove.map(task =>
        apiClient.post(`/tasks/${task.id}/move-to-inbox`)
      );

      await Promise.all(movePromises);
      
      // Refresh tasks
      await fetchTasks();
      
      const keptCount = keepTasks.length;
      const removedCount = moveToRemove.length;
      
      if (removedCount > 0) {
        toast.success(`${removedCount} task${removedCount === 1 ? '' : 's'} removed from Next Today. ${keptCount} task${keptCount === 1 ? '' : 's'} kept.`);
      } else {
        toast.success("All tasks kept for tomorrow");
      }
    } catch (error) {
      console.error("Error processing carryover:", error);
      toast.error("Failed to process carryover");
    }
  };

  const handleCarryoverSkipToday = () => {
    // Just close the modal, don't do anything
    setShowCarryoverModal(false);
  };

  // Model display functions removed - model is always GPT 5.2

  return (
    <Tabs value={activeView} onValueChange={setActiveView} className="app-container" data-testid="app-container">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-xl sticky top-0 z-30" data-testid="app-header">
        <div className="grid grid-cols-3 items-center px-6 py-4">
          {/* Left: Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <Brain className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">ADD Daily</h1>
              <p className="text-sm text-muted-foreground">AI-powered task inbox</p>
            </div>
          </div>

          {/* Center: Navigation Tabs */}
          <div className="flex justify-center">
            <TabsList className="bg-card/50 p-1" data-testid="view-tabs">
              <TabsTrigger value="inbox" className="gap-2" data-testid="tab-inbox" onClick={() => navigate('/app/inbox')}>
                <Inbox className="w-4 h-4" />
                Inbox
                {inboxTasks.length > 0 && (
                  <span className="ml-1 px-2 py-0.5 text-xs bg-primary/20 text-primary rounded-full">
                    {inboxTasks.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="weekly" className="gap-2" data-testid="tab-weekly" onClick={() => navigate('/app/weekly')}>
                <Calendar className="w-4 h-4" />
                Weekly
              </TabsTrigger>
              <TabsTrigger value="daily" className="gap-2" data-testid="tab-daily" onClick={() => navigate('/app/daily')}>
                <CalendarDays className="w-4 h-4" />
                Daily
              </TabsTrigger>
              <TabsTrigger value="completed" className="gap-2" data-testid="tab-completed" onClick={() => navigate('/app/completed')}>
                <CheckCircle2 className="w-4 h-4" />
                Done
                {completedTasks.length > 0 && (
                  <span className="ml-1 px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-500 rounded-full">
                    {completedTasks.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="dumps" className="gap-2" data-testid="tab-dumps" onClick={() => navigate('/app/dumps')}>
                <Archive className="w-4 h-4" />
                Dumps
              </TabsTrigger>
              <TabsTrigger value="logbook" className="gap-2" data-testid="tab-logbook" onClick={() => navigate('/app/logbook')}>
                <BookOpen className="w-4 h-4" />
                Logbook
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Right: Controls */}
          <div className="flex items-center gap-4 justify-end">
            {/* Model Indicator */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/50 border border-border/50" data-testid="model-indicator">
              <Sparkles className="w-4 h-4 text-[#10A37F]" />
              <span className="text-sm text-[#10A37F] font-medium">GPT 5.2</span>
            </div>

            {/* Voice Button */}
            <Button
              onClick={() => setIsVoiceActive(true)}
              className="gap-2 rounded-full bg-primary hover:bg-primary/90 glow-effect"
              data-testid="voice-button"
            >
              <Mic className="w-4 h-4" />
              Braindump
            </Button>

            {/* User Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 text-muted-foreground hover:text-foreground">
                  {user?.avatar_url ? (
                    <img src={user.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                      <User className="w-3 h-3 text-primary" />
                    </div>
                  )}
                  <span className="hidden sm:inline max-w-[100px] truncate">{user?.name || user?.email}</span>
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium">{user?.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => { logout(); navigate('/'); }} className="gap-2 text-red-500 focus:text-red-500">
                  <LogOut className="w-4 h-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6 w-full" data-testid="main-content">
        <TabsContent value="inbox" data-testid="inbox-view">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Tasks List (8 columns) */}
            <div className="lg:col-span-8">
              <InboxSplitView
                inboxTasks={inboxTasks}
                nextTasks={nextTasks}
                onUpdateTask={updateTask}
                onCreateTask={createTask}
                onDeleteTask={deleteTask}
                onRefreshTasks={fetchTasks}
                currentEnergy={currentEnergy}
                onEnergyChange={handleEnergyChange}
              />
            </div>
            {/* Right: Command Center (4 columns) */}
            <div className="lg:col-span-4">
              <CommandCenter
                nextTasks={nextTasks}
                focusTasks={focusTasks}
                currentEnergy={currentEnergy}
                onEnergyChange={handleEnergyChange}
                userId={user?.id}
                refreshTrigger={metricsRefreshTrigger}
              />
            </div>
          </div>
        </TabsContent>

          <TabsContent value="weekly" data-testid="weekly-view">
            <WeeklyCalendar
              tasks={tasks}
              onUpdateTask={updateTask}
              onDeleteTask={deleteTask}
            />
          </TabsContent>

          <TabsContent value="daily" data-testid="daily-view">
            <DailyCalendar
              tasks={tasks}
              onUpdateTask={updateTask}
              onDeleteTask={deleteTask}
              onRefreshTasks={fetchTasks}
            />
          </TabsContent>

          <TabsContent value="completed" data-testid="completed-view">
            <CompletedTasks
              tasks={completedTasks}
              onRestoreTask={updateTask}
              onDeleteTask={deleteTask}
            />
          </TabsContent>

            <TabsContent value="logbook" data-testid="logbook-view">
              <Logbook 
                userId={user?.id}
                completedTasks={completedTasks}
                onRestoreTask={updateTask}
                onRefreshTasks={fetchTasks}
                allTasks={tasks}
              />
            </TabsContent>

            {/* Process route renders directly (no tab trigger) */}
            {activeView === 'process' && (
              <div data-testid="process-view">
                <Outlet />
              </div>
            )}
            {/* Dumps routes render via TabsContent (has tab trigger) */}
            <TabsContent value="dumps" data-testid="dumps-view">
              <Outlet />
            </TabsContent>
      </main>

      {/* Voice Overlay */}
      {isVoiceActive && (
        <VoiceOverlay
          onClose={() => setIsVoiceActive(false)}
        />
      )}

      {/* Task Queue */}
      {showTaskQueue && (
        <TaskQueue
          tasks={queuedTasks}
          transcript={queuedTranscript}
          onReorder={reorderQueuedTasks}
          onUpdateTask={updateQueuedTask}
          onDeleteTask={deleteQueuedTask}
          onPushToCalendar={pushToCalendar}
          onPushToInbox={pushToInbox}
          onReprocess={reprocessTranscript}
          onClose={cancelTaskQueue}
        />
      )}


      {/* Inbox Full Modal */}
      <InboxFullModal
        open={showInboxFullModal}
        onOpenChange={setShowInboxFullModal}
        taskToAdd={pendingTask}
        existingInboxTasks={inboxTasks}
        onSetAsNext={handleSetAsNext}
        onReplaceTask={handleReplaceTask}
        onCancel={handleCancelPendingTask}
      />

      {/* Carryover Modal */}
      <CarryoverModal
        open={showCarryoverModal}
        onOpenChange={setShowCarryoverModal}
        nextTask={nextTasks.length > 0 ? nextTasks[0] : null}
        inboxTasks={inboxTasks}
        onKeepSelected={handleCarryoverKeepSelected}
        onSkipToday={handleCarryoverSkipToday}
      />
      
      {/* Debug Panel - shows API calls in dev mode */}
      <DebugPanel />
    </Tabs>
  );
}

export default MainApp;
