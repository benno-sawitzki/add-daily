import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Sparkles, Lightbulb } from "lucide-react";
import TimerSession from "./TimerSession";
import NextTaskCard from "./NextTaskCard";
import MicroConfetti from "./MicroConfetti.tsx";
import { pickSuggestedNext } from "@/utils/suggestedNext";
import {
  loadHyperfocusSession,
  saveHyperfocusSession,
  clearHyperfocusSession,
} from "@/utils/hyperfocusStorage";
import {
  incrementFocusStats,
} from "@/lib/focusStats.ts";
import axios from "axios";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function NextControlCenter({
  task,
  inboxTasks,
  currentEnergy,
  onEnergyChange,
  onUpdateTask,
  onDeleteTask,
  onScheduleTask,
  onCompleteTask,
  onMoveToInbox,
  onEditTask,
  onMakeNext,
  onCreateTask,
  onRefreshTasks,
  onClick,
}) {
  const navigate = useNavigate();
  const [hyperfocusSession, setHyperfocusSession] = useState(null);
  const [suggestedNextId, setSuggestedNextId] = useState(null);
  const [showResumeWarning, setShowResumeWarning] = useState(false);
  const [confettiKey, setConfettiKey] = useState(0);
  const [confettiPosition, setConfettiPosition] = useState({ x: 0, y: 0 });
  const [showCompletionMessage, setShowCompletionMessage] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const doneButtonRef = useRef(null);

  // Load hyperfocus session from localStorage on mount
  useEffect(() => {
    const session = loadHyperfocusSession();
    if (session && session.nextTaskId === task?.id) {
      setHyperfocusSession(session);
    } else if (session && session.nextTaskId !== task?.id) {
      // Session exists but for different task - clear it
      clearHyperfocusSession();
      setHyperfocusSession(null);
    }
  }, [task?.id]);


  // Calculate suggested next task (uses energy level to match task effort)
  useEffect(() => {
    if (inboxTasks && inboxTasks.length > 0) {
      const suggested = pickSuggestedNext(inboxTasks, currentEnergy);
      setSuggestedNextId(suggested);
    } else {
      setSuggestedNextId(null);
    }
  }, [inboxTasks, currentEnergy]);

  // Starter handler
  const handleStartStarter = () => {
    const durationSeconds = 120; // 2 minutes
    const session = {
      nextTaskId: task.id,
      status: 'running',
      mode: "starter",
      durationSeconds,
      remainingSeconds: durationSeconds,
      endsAt: Date.now() + durationSeconds * 1000,
      remainingMs: durationSeconds * 1000, // backward compatibility
      startedAt: new Date().toISOString(), // Track when session started
    };
    setHyperfocusSession(session);
    saveHyperfocusSession(session);
    // Navigate to focus screen
    navigate("/app/focus");
  };

  // Continue from starter to focus mode
  const handleContinueFocus = (focusMinutes) => {
    const durationSeconds = focusMinutes * 60;
    const session = {
      nextTaskId: task.id,
      status: 'running',
      mode: "focus",
      durationSeconds,
      remainingSeconds: durationSeconds,
      modeMinutes: focusMinutes, // backward compatibility
      endsAt: Date.now() + durationSeconds * 1000,
      remainingMs: durationSeconds * 1000, // backward compatibility
      startedAt: new Date().toISOString(), // Track when session started
    };
    setHyperfocusSession(session);
    saveHyperfocusSession(session);
    // Navigate to focus screen
    navigate("/app/focus");
  };

  // Hyperfocus handlers
  const handleStartHyperfocus = (durationMinutes) => {
    const durationSeconds = durationMinutes * 60;
    const session = {
      nextTaskId: task.id,
      status: 'running',
      mode: "focus",
      durationSeconds,
      remainingSeconds: durationSeconds,
      modeMinutes: durationMinutes, // backward compatibility
      endsAt: Date.now() + durationSeconds * 1000,
      remainingMs: durationSeconds * 1000, // backward compatibility
      startedAt: new Date().toISOString(), // Track when session started
    };
    setHyperfocusSession(session);
    saveHyperfocusSession(session);
    // Navigate to focus screen
    navigate("/app/focus");
  };

  const handlePauseHyperfocus = () => {
    if (hyperfocusSession && hyperfocusSession.status === 'running') {
      // Calculate remaining seconds from endsAt
      const now = Date.now();
      const remainingMs = hyperfocusSession.endsAt ? Math.max(0, hyperfocusSession.endsAt - now) : (hyperfocusSession.remainingMs || 0);
      const remainingSeconds = Math.floor(remainingMs / 1000);
      
      const updated = {
        ...hyperfocusSession,
        status: 'paused',
        remainingSeconds,
        endsAt: null, // Clear endsAt when paused
        remainingMs, // backward compatibility
        // Legacy fields
        isRunning: false,
        pausedAt: Date.now(),
      };
      setHyperfocusSession(updated);
      saveHyperfocusSession(updated);
    }
  };

  const handleResumeHyperfocus = () => {
    if (hyperfocusSession && hyperfocusSession.status === 'paused') {
      // Show warning before resuming (Pomodoro methodology: restart on resume)
      setShowResumeWarning(true);
      return;
    }
    
    // If status is not 'paused' (shouldn't happen, but handle gracefully)
    if (hyperfocusSession && hyperfocusSession.status === 'idle') {
      // Start fresh if idle
      const durationSeconds = hyperfocusSession.durationSeconds || 1800;
      const updated = {
        ...hyperfocusSession,
        status: 'running',
        remainingSeconds: durationSeconds,
        endsAt: Date.now() + durationSeconds * 1000,
        remainingMs: durationSeconds * 1000,
        isRunning: true,
      };
      setHyperfocusSession(updated);
      saveHyperfocusSession(updated);
    }
  };

  const confirmResumeHyperfocus = () => {
    if (hyperfocusSession) {
      // Reset to full duration (Pomodoro methodology: restart on resume)
      const fullDurationSeconds = hyperfocusSession.durationSeconds || (hyperfocusSession.modeMinutes ? hyperfocusSession.modeMinutes * 60 : 1800);
      const fullDurationMs = fullDurationSeconds * 1000;
      const updated = {
        ...hyperfocusSession,
        status: 'running',
        remainingSeconds: fullDurationSeconds,
        endsAt: Date.now() + fullDurationMs,
        remainingMs: fullDurationMs,
        // Legacy fields
        isRunning: true,
        pausedAt: null,
      };
      setHyperfocusSession(updated);
      saveHyperfocusSession(updated);
      setShowResumeWarning(false);
      toast.info("Timer restarted from beginning (Pomodoro methodology)");
    }
  };

  const cancelResumeHyperfocus = () => {
    setShowResumeWarning(false);
  };

  const handleCompleteHyperfocus = async () => {
    // Save focus session to database before clearing (only for focus mode, not starter)
    if (hyperfocusSession && hyperfocusSession.status === 'running' && hyperfocusSession.mode === 'focus') {
      try {
        // Calculate actual start time (use stored startedAt or estimate from duration)
        const now = Date.now();
        const durationMs = (hyperfocusSession.durationSeconds || 1800) * 1000;
        const startedAt = hyperfocusSession.startedAt 
          ? new Date(hyperfocusSession.startedAt).toISOString()
          : new Date(now - durationMs).toISOString();
        const endedAt = new Date().toISOString();
        
        // Calculate actual duration in minutes (may differ if user paused/resumed)
        const actualDurationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
        const durationMinutes = Math.max(1, Math.floor(actualDurationMs / 60000));
        
        const formData = new FormData();
        formData.append('started_at', startedAt);
        formData.append('ended_at', endedAt);
        formData.append('duration_minutes', durationMinutes.toString());
        
        await axios.post(`${API}/focus-sessions`, formData);
      } catch (error) {
        console.error("Error saving focus session:", error);
        // Don't block completion if save fails
      }
    }
    
    // Clear session (status becomes 'idle' by clearing)
    setHyperfocusSession(null);
    clearHyperfocusSession();
    // Also complete the task when hyperfocus session completes
    if (task && onCompleteTask) {
      handleNextTaskCompletion();
    }
  };

  const handleStopHyperfocus = () => {
    // Stop the timer without completing the task - just clear the session
    setHyperfocusSession(null);
    clearHyperfocusSession();
  };

  const handleNextTaskCompletion = () => {
    if (!task) return;

    // Get button position for confetti - use requestAnimationFrame to ensure DOM is updated
    requestAnimationFrame(() => {
      let position = { x: 0, y: 0 };
      if (doneButtonRef.current) {
        const rect = doneButtonRef.current.getBoundingClientRect();
        const container = doneButtonRef.current.closest('[data-next-container]');
        if (container) {
          const containerRect = container.getBoundingClientRect();
          position = {
            x: rect.left + rect.width / 2 - containerRect.left,
            y: rect.top + rect.height / 2 - containerRect.top,
          };
        } else {
          // Fallback: use viewport-relative position
          position = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
        }
      } else {
        // Use a default position in the center if ref is not available
        position = { x: 200, y: 200 };
      }

      // Set confetti position and trigger animation
      setConfettiPosition(position);
      setConfettiKey(prev => prev + 1);
    });

    // Update focus stats (for Command Center metrics)
    incrementFocusStats();

    // Show completion message
    setShowCompletionMessage(true);
    setTimeout(() => {
      setShowCompletionMessage(false);
    }, 4000);

    // Show toast message
    toast.success("Next cleared. Pick the next one.", {
      duration: 3000,
    });

    // Complete the task
    if (onCompleteTask) {
      onCompleteTask(task.id);
    }
  };

  const handleCreateDistractionTask = async (text) => {
    if (!onCreateTask) return;
    try {
      await onCreateTask({
        title: text,
        description: "",
        priority: 2,
        impakt: null,
        status: "inbox",
      });
      if (onRefreshTasks) await onRefreshTasks();
    } catch (error) {
      // If inbox is full, createTask will show the modal, but we still want to inform the user
      if (error.message === "INBOX_FULL") {
        toast.error("Inbox is full (5 tasks max). Choose what to do with this task.");
      } else {
        console.error("Error creating distraction task:", error);
        toast.error("Failed to add distraction to inbox");
      }
    }
  };

  const handleSuggestedNext = async () => {
    if (!suggestedNextId) {
      console.warn("No suggested next task ID");
      return;
    }
    if (!onMakeNext) {
      console.error("onMakeNext handler not provided to NextControlCenter");
      return;
    }
    try {
      await onMakeNext(suggestedNextId);
      if (onRefreshTasks) await onRefreshTasks();
    } catch (error) {
      console.error("Error setting suggested next:", error);
      // Error is already handled in handleMakeNext, so we don't need to show another toast
    }
  };


  // Single source of truth: focus is active if session exists, matches current task, and status is not 'idle'
  const focus = hyperfocusSession;
  const focusActive = focus && focus.nextTaskId === task?.id && focus.status !== 'idle';

  return (
    <div className="flex flex-col relative">
      {/* Micro Confetti - positioned near Done button */}
      {confettiKey > 0 && (
        <div className="absolute inset-0 pointer-events-none z-[100] overflow-visible">
          <MicroConfetti triggerKey={confettiKey} position={confettiPosition} />
        </div>
      )}

      {/* Task Display or Empty State */}
      {task ? (
        <div className="space-y-4">
          {/* Exclusive rendering: Either show FocusSurface (TimerSession) OR normal NextCard, never both */}
          {focusActive ? (
            // Focus is active (running or paused): Show ONLY the TimerSession UI
            <TimerSession
              taskId={task.id}
              mode={focus.mode}
              durationSeconds={focus.durationSeconds || (focus.modeMinutes ? focus.modeMinutes * 60 : 120)}
              initialRemainingMs={focus.remainingMs || (focus.remainingSeconds ? focus.remainingSeconds * 1000 : 0)}
              isRunning={focus.status === 'running'}
              onComplete={handleCompleteHyperfocus}
              onStop={handleStopHyperfocus}
              onContinueFocus={handleContinueFocus}
              onCreateDistractionTask={handleCreateDistractionTask}
              onPause={handlePauseHyperfocus}
              onResume={handleResumeHyperfocus}
              onMoveToInbox={() => task && onMoveToInbox(task.id)}
            />
          ) : (
            // Focus is not active (idle or no session): Show ONLY the normal NextCard UI
            <NextTaskCard
              task={task}
              onClick={onClick || (() => onEditTask(task))}
              hyperfocusSession={hyperfocusSession}
              onStartHyperfocus={handleStartHyperfocus}
              onPauseHyperfocus={handlePauseHyperfocus}
              onResumeHyperfocus={handleResumeHyperfocus}
              onCompleteTask={handleNextTaskCompletion}
              onEditTask={onEditTask}
              onMoveToInbox={onMoveToInbox}
              onUpdateTask={onUpdateTask}
              doneButtonRef={doneButtonRef}
            />
          )}
        </div>
      ) : (
        <Card
          className="p-8 border-2 border-dashed flex flex-col items-center justify-center min-h-[200px] border-border bg-card/30"
          data-testid="next-slot-empty"
        >
          <div className="w-16 h-16 rounded-full bg-card flex items-center justify-center mb-4">
            <Sparkles className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No next task</h3>
          <p className="text-sm text-muted-foreground text-center max-w-xs mb-4">
            {showCompletionMessage ? (
              <span className="text-primary">Next cleared. Pick the next one.</span>
            ) : (
              "Drag a task from Inbox here to make it your priority"
            )}
          </p>
          {suggestedNextId && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSuggestedNext}
              className="gap-2"
            >
              <Lightbulb className="w-4 h-4" />
              Use Suggested Next
            </Button>
          )}
        </Card>
      )}

      {/* Resume Warning Dialog */}
      <AlertDialog open={showResumeWarning} onOpenChange={setShowResumeWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resume Hyperfocus Session</AlertDialogTitle>
            <AlertDialogDescription>
              Following Pomodoro methodology, resuming a paused session will restart the timer from the beginning ({hyperfocusSession?.modeMinutes || 30} minutes).
              <br /><br />
              This ensures you get a full, uninterrupted focus session.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelResumeHyperfocus}>Continue Anyways</AlertDialogCancel>
            <AlertDialogAction onClick={confirmResumeHyperfocus}>Restart Timer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

