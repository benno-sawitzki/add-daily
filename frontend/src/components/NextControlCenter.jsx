import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Sparkles, Lightbulb, HelpCircle } from "lucide-react";
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
  getFocusStats,
  initFocusStatsForToday,
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
  const [focusStats, setFocusStats] = useState(() => initFocusStatsForToday());
  const [confettiKey, setConfettiKey] = useState(0);
  const [confettiPosition, setConfettiPosition] = useState({ x: 0, y: 0 });
  const [showCompletionMessage, setShowCompletionMessage] = useState(false);
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

  // Initialize focus stats on mount and when day changes
  useEffect(() => {
    const stats = initFocusStatsForToday();
    setFocusStats(stats);
  }, []);

  // Calculate suggested next task
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

  const handleCompleteHyperfocus = () => {
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

    // Update focus stats
    const updatedStats = incrementFocusStats();
    setFocusStats(updatedStats);

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
        urgency: 2,
        importance: 2,
        status: "inbox",
      });
      if (onRefreshTasks) await onRefreshTasks();
    } catch (error) {
      // If inbox is full, createTask will show the modal, but we still want to inform the user
      if (error.message === "INBOX_FULL") {
        toast.error("Inbox is full (7 tasks max). Choose what to do with this task.");
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
    <div className="flex flex-col">
      {/* Header with Energy Selector and Suggested Next - wrapped to match Inbox header height */}
      <div className="mb-4 relative">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold">Next</h2>
            {/* Focus Count Badge */}
            {focusStats.todayCount > 0 && (
              <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
                Focus {focusStats.todayCount}
              </Badge>
            )}
            {/* Streak Badge */}
            {focusStats.streak > 0 && (
              <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-500 border-amber-500/20">
                Streak {focusStats.streak}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Energy Selector */}
            <Select value={currentEnergy || "medium"} onValueChange={onEnergyChange}>
              <SelectTrigger className="w-48 h-8 text-sm">
                <SelectValue>
                  ⚡ Energy now: {currentEnergy === "low" ? "Low" : currentEnergy === "medium" ? "Medium" : "High"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">⚡ Low</SelectItem>
                <SelectItem value="medium">⚡⚡ Medium</SelectItem>
                <SelectItem value="high">⚡⚡⚡ High</SelectItem>
              </SelectContent>
            </Select>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="inline-flex items-center p-0 border-0 bg-transparent cursor-help">
                    <HelpCircle className="w-4 h-4 text-muted-foreground" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Used for suggestions and filtering based on your current energy.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Suggested Next Button */}
            {(!task || suggestedNextId) && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSuggestedNext}
                className="gap-2 h-8"
                title="Set suggested next task"
              >
                <Lightbulb className="w-3.5 h-3.5" />
                {task ? null : "Suggested"}
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {showCompletionMessage ? (
            <span className="text-primary animate-pulse">Next cleared. Pick the next one.</span>
          ) : (
            "Your priority task for right now"
          )}
        </p>
        {/* Micro Confetti - positioned near Done button */}
        {confettiKey > 0 && (
          <div className="absolute inset-0 pointer-events-none z-[100] overflow-visible">
            <MicroConfetti triggerKey={confettiKey} position={confettiPosition} />
          </div>
        )}
      </div>

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

