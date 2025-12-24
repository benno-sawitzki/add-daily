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
    const allModels = [...AI_MODELS.openai, ...AI_MODELS.gemini];
    const model = allModels.find((m) => m.id === settings.ai_model);
    return model?.name || settings.ai_model;
  };

  const getModelColor = () => {
    return settings.ai_provider === "openai" ? "text-[#10A37F]" : "text-[#4E80EE]";
  };

  return (
    <div className="app-container" data-testid="app-container">
      <Toaster position="top-right" richColors />
      
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-xl sticky top-0 z-30" data-testid="app-header">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <Brain className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">TaskFlow</h1>
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
          onClose={cancelTaskQueue}
        />
      )}
    </div>
  );
}

export default App;
