import { useState, useEffect, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import { Toaster, toast } from "sonner";
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
  Zap,
  ChevronDown,
  Brain,
  Sparkles,
  RefreshCw,
  Unlink,
} from "lucide-react";
import TaskInbox from "@/components/TaskInbox";
import WeeklyCalendar from "@/components/WeeklyCalendar";
import DailyCalendar from "@/components/DailyCalendar";
import VoiceOverlay from "@/components/VoiceOverlay";
import TaskQueue from "@/components/TaskQueue";
import CompletedTasks from "@/components/CompletedTasks";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const AI_MODELS = {
  openai: [
    { id: "gpt-5.2", name: "GPT-5.2", icon: "sparkles" },
    { id: "gpt-4o", name: "GPT-4o", icon: "sparkles" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", icon: "brain" },
  ],
  gemini: [
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", icon: "zap" },
  ],
};

function App() {
  const [tasks, setTasks] = useState([]);
  const [activeView, setActiveView] = useState("inbox");
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [settings, setSettings] = useState({
    ai_provider: "openai",
    ai_model: "gpt-5.2",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [queuedTasks, setQueuedTasks] = useState([]);
  const [showTaskQueue, setShowTaskQueue] = useState(false);
  const [googleCalendar, setGoogleCalendar] = useState({ connected: false, email: null });
  const [isSyncing, setIsSyncing] = useState(false);

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

  const fetchGoogleStatus = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/auth/google/status`);
      setGoogleCalendar(response.data);
    } catch (error) {
      console.error("Error fetching Google status:", error);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchSettings();
    fetchGoogleStatus();
    
    // Check URL params for Google auth callback
    const params = new URLSearchParams(window.location.search);
    if (params.get('google_connected') === 'true') {
      toast.success(`Google Calendar connected: ${params.get('email')}`);
      fetchGoogleStatus();
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('google_error')) {
      toast.error(`Google auth failed: ${params.get('google_error')}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [fetchTasks, fetchSettings, fetchGoogleStatus]);

  const connectGoogleCalendar = async () => {
    try {
      const response = await axios.get(`${API}/auth/google/login`);
      window.location.href = response.data.authorization_url;
    } catch (error) {
      console.error("Error starting Google auth:", error);
      toast.error("Failed to start Google authentication");
    }
  };

  const disconnectGoogleCalendar = async () => {
    try {
      await axios.post(`${API}/auth/google/disconnect`);
      setGoogleCalendar({ connected: false, email: null });
      toast.success("Google Calendar disconnected");
    } catch (error) {
      console.error("Error disconnecting:", error);
      toast.error("Failed to disconnect");
    }
  };

  const syncToGoogleCalendar = async () => {
    if (!googleCalendar.connected) {
      toast.error("Please connect Google Calendar first");
      return;
    }
    
    setIsSyncing(true);
    try {
      const response = await axios.post(`${API}/calendar/sync`);
      toast.success(`Synced ${response.data.synced_count} tasks to Google Calendar`);
      if (response.data.errors?.length > 0) {
        console.warn("Sync errors:", response.data.errors);
      }
    } catch (error) {
      console.error("Sync error:", error);
      toast.error("Failed to sync to Google Calendar");
    } finally {
      setIsSyncing(false);
    }
  };

  const updateTask = async (taskId, updates) => {
    try {
      await axios.patch(`${API}/tasks/${taskId}`, updates);
      await fetchTasks();
      toast.success("Task updated");
    } catch (error) {
      console.error("Error updating task:", error);
      toast.error("Failed to update task");
    }
  };

  const deleteTask = async (taskId) => {
    try {
      await axios.delete(`${API}/tasks/${taskId}`);
      await fetchTasks();
      toast.success("Task deleted");
    } catch (error) {
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
      const response = await axios.post(`${API}/tasks/process-voice-queue`, {
        transcript,
        model: settings.ai_model,
        provider: settings.ai_provider,
      });
      
      // Show task queue instead of pushing directly to calendar
      if (response.data.tasks && response.data.tasks.length > 0) {
        setQueuedTasks(response.data.tasks);
        setShowTaskQueue(true);
        setIsVoiceActive(false);
      } else {
        toast.info("No tasks found in your input");
      }
      
      return response.data;
    } catch (error) {
      console.error("Error processing voice:", error);
      toast.error("Failed to process voice input");
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // Push queued tasks to calendar
  const pushToCalendar = async () => {
    try {
      const response = await axios.post(`${API}/tasks/push-to-calendar`, {
        tasks: queuedTasks,
      });
      
      await fetchTasks();
      setShowTaskQueue(false);
      setQueuedTasks([]);
      setActiveView("weekly");
      toast.success(`${queuedTasks.length} tasks scheduled!`);
    } catch (error) {
      console.error("Error pushing to calendar:", error);
      toast.error("Failed to push tasks to calendar");
    }
  };

  // Push queued tasks to inbox
  const pushToInbox = async () => {
    try {
      const response = await axios.post(`${API}/tasks/push-to-inbox`, {
        tasks: queuedTasks,
      });
      
      await fetchTasks();
      setShowTaskQueue(false);
      setQueuedTasks([]);
      setActiveView("inbox");
      toast.success(`${queuedTasks.length} tasks added to inbox!`);
    } catch (error) {
      console.error("Error pushing to inbox:", error);
      toast.error("Failed to push tasks to inbox");
    }
  };

  const cancelTaskQueue = () => {
    setShowTaskQueue(false);
    setQueuedTasks([]);
  };

  const updateSettings = async (provider, model) => {
    try {
      await axios.patch(`${API}/settings`, {
        ai_provider: provider,
        ai_model: model,
      });
      setSettings({ ai_provider: provider, ai_model: model });
      toast.success(`Switched to ${model}`);
    } catch (error) {
      console.error("Error updating settings:", error);
      toast.error("Failed to update settings");
    }
  };

  const inboxTasks = tasks.filter((t) => t.status === "inbox");
  const completedTasks = tasks.filter((t) => t.status === "completed");

  const getModelDisplayName = () => {
    const allModels = [...AI_MODELS.openai, ...AI_MODELS.anthropic, ...AI_MODELS.gemini];
    const model = allModels.find((m) => m.id === settings.ai_model);
    return model?.name || settings.ai_model;
  };

  const getModelColor = () => {
    if (settings.ai_provider === "openai") return "text-[#10A37F]";
    if (settings.ai_provider === "anthropic") return "text-[#D97706]";
    return "text-[#4E80EE]";
  };

  return (
    <div className="app-container" data-testid="app-container">
      <Toaster 
        position="top-right" 
        richColors 
        duration={1500}
        gap={8}
        toastOptions={{
          style: {
            padding: '10px 14px',
            fontSize: '13px',
            minWidth: 'auto',
            maxWidth: '280px',
          },
        }}
      />
      
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-xl sticky top-0 z-30" data-testid="app-header">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <Brain className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">ADD Daily</h1>
              <p className="text-sm text-muted-foreground">AI-powered task inbox</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Model Selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2" data-testid="model-selector">
                  {settings.ai_provider === "openai" ? (
                    <Sparkles className={`w-4 h-4 ${getModelColor()}`} />
                  ) : (
                    <Zap className={`w-4 h-4 ${getModelColor()}`} />
                  )}
                  <span className={getModelColor()}>{getModelDisplayName()}</span>
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>OpenAI</DropdownMenuLabel>
                {AI_MODELS.openai.map((model) => (
                  <DropdownMenuItem
                    key={model.id}
                    onClick={() => updateSettings("openai", model.id)}
                    className="gap-2"
                    data-testid={`model-option-${model.id}`}
                  >
                    <Sparkles className="w-4 h-4 text-[#10A37F]" />
                    {model.name}
                    {settings.ai_model === model.id && (
                      <CheckCircle2 className="w-4 h-4 ml-auto text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Anthropic</DropdownMenuLabel>
                {AI_MODELS.anthropic.map((model) => (
                  <DropdownMenuItem
                    key={model.id}
                    onClick={() => updateSettings("anthropic", model.id)}
                    className="gap-2"
                    data-testid={`model-option-${model.id}`}
                  >
                    <Brain className="w-4 h-4 text-[#D97706]" />
                    {model.name}
                    {settings.ai_model === model.id && (
                      <CheckCircle2 className="w-4 h-4 ml-auto text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Google</DropdownMenuLabel>
                {AI_MODELS.gemini.map((model) => (
                  <DropdownMenuItem
                    key={model.id}
                    onClick={() => updateSettings("gemini", model.id)}
                    className="gap-2"
                    data-testid={`model-option-${model.id}`}
                  >
                    <Zap className="w-4 h-4 text-[#4E80EE]" />
                    {model.name}
                    {settings.ai_model === model.id && (
                      <CheckCircle2 className="w-4 h-4 ml-auto text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Google Calendar */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="outline" 
                  className={`gap-2 ${googleCalendar.connected ? 'border-green-500/50' : ''}`}
                  data-testid="google-calendar-btn"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <path d="M19.5 3.5H4.5C3.4 3.5 2.5 4.4 2.5 5.5V19.5C2.5 20.6 3.4 21.5 4.5 21.5H19.5C20.6 21.5 21.5 20.6 21.5 19.5V5.5C21.5 4.4 20.6 3.5 19.5 3.5Z" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M2.5 9.5H21.5" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M8.5 2.5V5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    <path d="M15.5 2.5V5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  {googleCalendar.connected ? (
                    <span className="text-green-500 text-xs">Connected</span>
                  ) : (
                    <span className="text-xs">Google Calendar</span>
                  )}
                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {googleCalendar.connected ? (
                  <>
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">Connected as</span>
                        <span className="text-sm truncate">{googleCalendar.email}</span>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={syncToGoogleCalendar} disabled={isSyncing} className="gap-2">
                      <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                      {isSyncing ? 'Syncing...' : 'Sync All Tasks'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={disconnectGoogleCalendar} className="gap-2 text-destructive focus:text-destructive">
                      <Unlink className="w-4 h-4" />
                      Disconnect
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem onClick={connectGoogleCalendar} className="gap-2">
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Connect Google Calendar
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Voice Button */}
            <Button
              onClick={() => setIsVoiceActive(true)}
              className="gap-2 rounded-full bg-primary hover:bg-primary/90 glow-effect"
              data-testid="voice-button"
            >
              <Mic className="w-4 h-4" />
              Add Tasks
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6" data-testid="main-content">
        <Tabs value={activeView} onValueChange={setActiveView} className="w-full">
          <TabsList className="mb-6 bg-card/50 p-1" data-testid="view-tabs">
            <TabsTrigger value="inbox" className="gap-2" data-testid="tab-inbox">
              <Inbox className="w-4 h-4" />
              Inbox
              {inboxTasks.length > 0 && (
                <span className="ml-1 px-2 py-0.5 text-xs bg-primary/20 text-primary rounded-full">
                  {inboxTasks.length}
                </span>
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

          <TabsContent value="inbox" data-testid="inbox-view">
            <TaskInbox
              tasks={inboxTasks}
              onUpdateTask={updateTask}
              onDeleteTask={deleteTask}
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
            />
          </TabsContent>

          <TabsContent value="completed" data-testid="completed-view">
            <CompletedTasks
              tasks={completedTasks}
              onRestoreTask={updateTask}
              onDeleteTask={deleteTask}
            />
          </TabsContent>
        </Tabs>
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
          onReorder={reorderQueuedTasks}
          onUpdateTask={updateQueuedTask}
          onDeleteTask={deleteQueuedTask}
          onPushToCalendar={pushToCalendar}
          onPushToInbox={pushToInbox}
          onClose={cancelTaskQueue}
        />
      )}
    </div>
  );
}

export default App;
