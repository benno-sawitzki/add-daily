import { useState, useEffect, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import { toast } from "sonner";
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
} from "lucide-react";
import InboxSplitView from "@/components/InboxSplitView";
import WeeklyCalendar from "@/components/WeeklyCalendar";
import DailyCalendar from "@/components/DailyCalendar";
import VoiceOverlay from "@/components/VoiceOverlay";
import TaskQueue from "@/components/TaskQueue";
import CompletedTasks from "@/components/CompletedTasks";
import InboxFullModal from "@/components/InboxFullModal";
import LaterModal from "@/components/LaterModal";
import CarryoverModal from "@/components/CarryoverModal";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// AI_MODELS constant removed - model is always GPT 5.2

function MainApp() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [activeView, setActiveView] = useState("inbox");
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
  const [showLaterModal, setShowLaterModal] = useState(false);
  const [showCarryoverModal, setShowCarryoverModal] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/tasks`);
      setTasks(response.data);
    } catch (error) {
      console.error("Error fetching tasks:", error);
      toast.error("Failed to fetch tasks");
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/settings`);
      setSettings(response.data);
    } catch (error) {
      console.error("Error fetching settings:", error);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchSettings();
  }, [fetchTasks, fetchSettings]);

  const updateTask = async (taskId, updates) => {
    // Optimistic update: update UI immediately for better UX
    setTasks(prevTasks => 
      prevTasks.map(task => 
        task.id === taskId ? { ...task, ...updates } : task
      )
    );
    
    try {
      const response = await axios.patch(`${API}/tasks/${taskId}`, updates);
      // Update with server response (more accurate, includes computed fields)
      setTasks(prevTasks => 
        prevTasks.map(task => 
          task.id === taskId ? response.data : task
        )
      );
      // Don't show toast for drag-and-drop updates (too noisy)
      // toast.success("Task updated");
    } catch (error) {
      // Revert optimistic update on error
      await fetchTasks();
      console.error("Error updating task:", error);
      toast.error("Failed to update task");
    }
  };

  const createTask = async (taskData) => {
    const currentInboxCount = tasks.filter((t) => t.status === "inbox").length;
    
    // Check inbox cap (7 tasks max) - only for inbox status
    if ((taskData.status === "inbox" || !taskData.status) && currentInboxCount >= 7) {
      // Inbox is full - show modal
      setPendingTask(taskData);
      setShowInboxFullModal(true);
      throw new Error("INBOX_FULL"); // Signal to caller that action is pending
    }
    
    // Can add directly
    try {
      const response = await axios.post(`${API}/tasks`, {
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
    // Optimistic update: remove from UI immediately
    const deletedTask = tasks.find(t => t.id === taskId);
    setTasks(prevTasks => prevTasks.filter(t => t.id !== taskId));
    
    try {
      await axios.delete(`${API}/tasks/${taskId}`);
      // Don't show toast for every delete (too noisy)
      // toast.success("Task deleted");
    } catch (error) {
      // Revert optimistic update on error
      if (deletedTask) {
        setTasks(prevTasks => [...prevTasks, deletedTask]);
      }
      console.error("Error deleting task:", error);
      toast.error("Failed to delete task");
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
      
      const response = await axios.post(`${API}/tasks/process-voice-queue`, {
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
      const response = await axios.post(`${API}/tasks/push-to-calendar`, {
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
    const availableSlots = 7 - currentInboxCount;
    
    // Check inbox cap
    if (availableSlots <= 0) {
      // No slots available - show modal for all tasks
      toast.warning(`Inbox is full (7 tasks). Please choose what to do with ${taskCount} task${taskCount > 1 ? 's' : ''}.`);
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
        const response = await axios.post(`${API}/tasks/push-to-inbox`, {
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
        toast.error("Failed to add some tasks to inbox");
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
      const response = await axios.post(`${API}/tasks/push-to-inbox`, {
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
      const errorMessage = error.response?.data?.detail || error.message || "Failed to push tasks to inbox";
      toast.error(errorMessage);
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
      const response = await axios.post(`${API}/tasks/process-voice-queue`, {
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

  const inboxTasks = tasks.filter((t) => t.status === "inbox");
  const nextTask = tasks.find((t) => t.status === "next") || null;
  const completedTasks = tasks.filter((t) => t.status === "completed");
  const laterTasks = tasks.filter((t) => t.status === "later");
  
  // Handlers for InboxFullModal
  const handleSetAsNext = async () => {
    if (!pendingTask) return;
    
    const currentInboxCount = tasks.filter((t) => t.status === "inbox").length;
    const hasNextTask = nextTask !== null;
    
    // If inbox is full (7 tasks) and there's no existing Next task to swap with,
    // we need to create the task directly with "next" status instead of going through inbox
    if (currentInboxCount >= 7 && !hasNextTask) {
      try {
        // Create task directly with "next" status (bypassing inbox)
        const response = await axios.post(`${API}/tasks`, {
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
        console.error("Error creating task as next:", error);
        const errorMessage = error.response?.data?.detail || error.message || "Failed to set task as next";
        toast.error(errorMessage);
      }
    } else {
      // Normal flow: save to inbox first, then set as next (swap will handle inbox cap)
      try {
        // Save task to inbox first to get a real ID, then set as next
        const response = await axios.post(`${API}/tasks/push-to-inbox`, {
          tasks: [pendingTask],
        });
        
        if (!response.data.tasks || response.data.tasks.length === 0) {
          throw new Error("Failed to save task");
        }
        
        const savedTask = response.data.tasks[0];
        
        // Set as next (will swap if next already exists, keeping inbox at 7)
        await axios.post(`${API}/tasks/${savedTask.id}/make-next`);
        
        await fetchTasks();
        toast.success("Task set as Next!");
        
        // Process next pending task if any
        processNextPendingTask();
      } catch (error) {
        console.error("Error setting task as next:", error);
        const errorMessage = error.response?.data?.detail || error.message || "Failed to set task as next";
        toast.error(errorMessage);
      }
    }
  };
  
  const handleSendToLater = async () => {
    if (!pendingTask) return;
    
    try {
      // Save task to inbox first, then move to later
      const response = await axios.post(`${API}/tasks/push-to-inbox`, {
        tasks: [{ ...pendingTask, status: "inbox" }],
      });
      
      if (!response.data.tasks || response.data.tasks.length === 0) {
        throw new Error("Failed to save task");
      }
      
      const savedTask = response.data.tasks[0];
      
      // Move to later with expiration
      await axios.post(`${API}/tasks/${savedTask.id}/move-to-later`);
      
      await fetchTasks();
      toast.success("Task moved to Later (expires in 14 days)");
      
      // Process next pending task if any
      processNextPendingTask();
    } catch (error) {
      console.error("Error moving task to later:", error);
      const errorMessage = error.response?.data?.detail || error.message || "Failed to move task to later";
      toast.error(errorMessage);
    }
  };
  
  const handleReplaceTask = async (replaceTaskId) => {
    if (!pendingTask) return;
    
    try {
      // Delete the task to replace
      await axios.delete(`${API}/tasks/${replaceTaskId}`);
      
      // Create new task
      const response = await axios.post(`${API}/tasks/push-to-inbox`, {
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

  const handleCarryoverKeepSelected = async ({ keepTasks, moveToLater }) => {
    try {
      // Move unselected tasks to Later
      const movePromises = moveToLater.map(task =>
        axios.post(`${API}/tasks/${task.id}/move-to-later`)
      );

      await Promise.all(movePromises);
      
      // Refresh tasks
      await fetchTasks();
      
      const keptCount = keepTasks.length;
      const movedCount = moveToLater.length;
      
      if (movedCount > 0) {
        toast.success(`${movedCount} task${movedCount === 1 ? '' : 's'} moved to Later. ${keptCount} task${keptCount === 1 ? '' : 's'} kept.`);
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
              <TabsTrigger value="inbox" className="gap-2" data-testid="tab-inbox">
                <Inbox className="w-4 h-4" />
                Inbox
                {inboxTasks.length > 0 && (
                  <span className="ml-1 px-2 py-0.5 text-xs bg-primary/20 text-primary rounded-full">
                    {inboxTasks.length}
                  </span>
                )}
                {laterTasks.length > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowLaterModal(true);
                    }}
                    className="ml-1 text-xs text-muted-foreground hover:text-foreground"
                    title="Later tasks"
                  >
                    Later ({laterTasks.length})
                  </button>
                )}
              </TabsTrigger>
              <TabsTrigger value="weekly" className="gap-2" data-testid="tab-weekly">
                <Calendar className="w-4 h-4" />
                Weekly
              </TabsTrigger>
              <TabsTrigger value="daily" className="gap-2" data-testid="tab-daily">
                <CalendarDays className="w-4 h-4" />
                Daily
              </TabsTrigger>
              <TabsTrigger value="completed" className="gap-2" data-testid="tab-completed">
                <CheckCircle2 className="w-4 h-4" />
                Done
                {completedTasks.length > 0 && (
                  <span className="ml-1 px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-500 rounded-full">
                    {completedTasks.length}
                  </span>
                )}
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
            <InboxSplitView
              inboxTasks={inboxTasks}
              nextTask={nextTask}
              onUpdateTask={updateTask}
              onCreateTask={createTask}
              onDeleteTask={deleteTask}
              onRefreshTasks={fetchTasks}
            />
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
      </main>

      {/* Voice Overlay */}
      {isVoiceActive && (
        <VoiceOverlay
          onClose={() => setIsVoiceActive(false)}
          onProcess={processVoiceInput}
          isLoading={isLoading}
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

      {/* Later Modal */}
      <LaterModal
        open={showLaterModal}
        onOpenChange={setShowLaterModal}
        laterTasks={laterTasks}
        onMoveToInbox={async (taskId) => {
          const currentInboxCount = tasks.filter((t) => t.status === "inbox").length;
          if (currentInboxCount >= 7) {
            toast.error("Inbox is full (7 tasks max). Please remove a task first.");
            return;
          }
          try {
            await axios.post(`${API}/tasks/${taskId}/move-to-inbox`);
            await fetchTasks();
            toast.success("Task moved to Inbox");
          } catch (error) {
            console.error("Error moving task to inbox:", error);
            toast.error("Failed to move task to inbox");
          }
        }}
        onDeleteTask={deleteTask}
      />

      {/* Inbox Full Modal */}
      <InboxFullModal
        open={showInboxFullModal}
        onOpenChange={setShowInboxFullModal}
        taskToAdd={pendingTask}
        existingInboxTasks={inboxTasks}
        onSetAsNext={handleSetAsNext}
        onSendToLater={handleSendToLater}
        onReplaceTask={handleReplaceTask}
        onCancel={handleCancelPendingTask}
      />

      {/* Carryover Modal */}
      <CarryoverModal
        open={showCarryoverModal}
        onOpenChange={setShowCarryoverModal}
        nextTask={nextTask}
        inboxTasks={inboxTasks}
        onKeepSelected={handleCarryoverKeepSelected}
        onSkipToday={handleCarryoverSkipToday}
      />
    </Tabs>
  );
}

export default MainApp;
