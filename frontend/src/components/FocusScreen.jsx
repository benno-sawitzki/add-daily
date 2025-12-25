import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Play, Pause, CheckCircle2, X, Inbox } from "lucide-react";
import TimerSession from "./TimerSession";
import {
  loadHyperfocusSession,
  saveHyperfocusSession,
  clearHyperfocusSession,
} from "@/utils/hyperfocusStorage";
import { toast } from "sonner";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function FocusScreen({ 
  task, 
  onCompleteTask, 
  onCreateTask,
  onRefreshTasks 
}) {
  const navigate = useNavigate();
  const [hyperfocusSession, setHyperfocusSession] = useState(null);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [distractionText, setDistractionText] = useState("");
  const distractionInputRef = useRef(null);

  // Load hyperfocus session on mount and sync with timer
  useEffect(() => {
    const session = loadHyperfocusSession();
    if (session && session.nextTaskId === task?.id) {
      // Update remaining time if session is running
      if (session.status === 'running' && session.endsAt) {
        const now = Date.now();
        const remainingMs = Math.max(0, session.endsAt - now);
        session.remainingMs = remainingMs;
        session.remainingSeconds = Math.floor(remainingMs / 1000);
      }
      setHyperfocusSession(session);
    } else if (session && session.nextTaskId !== task?.id) {
      // Session exists but for different task - clear it and redirect
      clearHyperfocusSession();
      navigate("/app");
    } else if (!session) {
      // No session - redirect to app
      navigate("/app");
    }
  }, [task?.id, navigate]);

  // Sync session state periodically when running
  useEffect(() => {
    if (!hyperfocusSession || hyperfocusSession.status !== 'running') return;

    const interval = setInterval(() => {
      const session = loadHyperfocusSession();
      if (session && session.status === 'running' && session.endsAt) {
        const now = Date.now();
        const remainingMs = Math.max(0, session.endsAt - now);
        if (remainingMs === 0) {
          // Timer completed
          handleTimerComplete();
        } else {
          const updated = {
            ...session,
            remainingMs,
            remainingSeconds: Math.floor(remainingMs / 1000),
          };
          setHyperfocusSession(updated);
        }
      }
    }, 1000); // Update every second

    return () => clearInterval(interval);
  }, [hyperfocusSession]);

  // Disable body scroll when component mounts
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Add beforeunload warning for active sessions
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hyperfocusSession && (hyperfocusSession.status === 'running' || hyperfocusSession.status === 'paused')) {
        e.preventDefault();
        e.returnValue = "You have an active focus session. Are you sure you want to leave?";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hyperfocusSession]);

  // Handle timer completion
  const handleTimerComplete = () => {
    handleCompleteHyperfocus();
  };

  // Handle timer stop
  const handleTimerStop = () => {
    setShowStopConfirm(true);
  };

  // Handle pause/resume
  const handlePause = () => {
    if (hyperfocusSession && hyperfocusSession.status === 'running') {
      const now = Date.now();
      const remainingMs = hyperfocusSession.endsAt ? Math.max(0, hyperfocusSession.endsAt - now) : (hyperfocusSession.remainingMs || 0);
      const remainingSeconds = Math.floor(remainingMs / 1000);
      
      const updated = {
        ...hyperfocusSession,
        status: 'paused',
        remainingSeconds,
        endsAt: null,
        remainingMs,
        isRunning: false,
        pausedAt: Date.now(),
      };
      setHyperfocusSession(updated);
      saveHyperfocusSession(updated);
    }
  };

  const handleResume = () => {
    if (hyperfocusSession && hyperfocusSession.status === 'paused') {
      const remainingMs = (hyperfocusSession.remainingSeconds || 0) * 1000;
      const updated = {
        ...hyperfocusSession,
        status: 'running',
        endsAt: Date.now() + remainingMs,
        remainingMs,
        isRunning: true,
        pausedAt: null,
      };
      setHyperfocusSession(updated);
      saveHyperfocusSession(updated);
    }
  };

  // Handle complete
  const handleCompleteHyperfocus = () => {
    setHyperfocusSession(null);
    clearHyperfocusSession();
    if (task && onCompleteTask) {
      onCompleteTask(task.id);
    }
    navigate("/app");
  };

  // Handle stop (with confirmation)
  const handleStopHyperfocus = () => {
    setHyperfocusSession(null);
    clearHyperfocusSession();
    setShowStopConfirm(false);
    navigate("/app");
  };

  // Handle distraction capture
  // This is called from TimerSession with the distraction text
  const handleAddDistraction = async (text) => {
    if (!text || !text.trim()) return;
    
    if (onCreateTask) {
      try {
        await onCreateTask({
          title: text.trim(),
          description: "",
          priority: 2,
          urgency: 2,
          importance: 2,
          duration: 30,
          status: "inbox",
        });
        if (onRefreshTasks) {
          await onRefreshTasks();
        }
        toast.success("Distraction added to inbox");
      } catch (error) {
        console.error("Error creating distraction task:", error);
        toast.error("Failed to add distraction to inbox");
      }
    }
  };

  if (!hyperfocusSession || !task) {
    return null; // Will redirect
  }

  const isRunning = hyperfocusSession.status === 'running';
  const isPaused = hyperfocusSession.status === 'paused';
  const remainingMs = hyperfocusSession.remainingMs || (hyperfocusSession.remainingSeconds || 0) * 1000;

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-auto">
      {/* Blurred/dimmed background overlay */}
      <div 
        className="absolute inset-0 backdrop-blur-lg bg-black/50"
        style={{ pointerEvents: 'none' }}
      />
      
      {/* Focus card - centered */}
      <div className="relative z-10 h-full flex items-center justify-center p-6">
        <Card className="w-full max-w-2xl bg-background/95 backdrop-blur-sm border-2 shadow-2xl">
          <div className="p-8 space-y-6">
            {/* Task title */}
            <div className="text-center">
              <h1 className="text-3xl font-bold mb-2">{task.title}</h1>
              {task.description && (
                <p className="text-muted-foreground text-lg">{task.description}</p>
              )}
            </div>

            {/* Timer */}
            <div className="flex justify-center">
              <TimerSession
                taskId={task.id}
                mode={hyperfocusSession.mode || "focus"}
                durationSeconds={hyperfocusSession.durationSeconds || 1800}
                onComplete={handleTimerComplete}
                onStop={handleTimerStop}
                onCreateDistractionTask={handleAddDistraction}
                onPause={handlePause}
                onResume={handleResume}
                initialRemainingMs={remainingMs}
                isRunning={isRunning}
              />
            </div>
          </div>
        </Card>
      </div>

      {/* Stop confirmation dialog - rendered outside main container for proper z-index */}
      <AlertDialog open={showStopConfirm} onOpenChange={setShowStopConfirm}>
        <AlertDialogContent className="z-[10000]">
          <AlertDialogHeader>
            <AlertDialogTitle>Stop focus session?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to stop this focus session and return to the app? Your progress will not be saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowStopConfirm(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleStopHyperfocus}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Stop & Exit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

