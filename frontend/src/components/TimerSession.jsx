import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Play, Pause, CheckCircle2, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { saveHyperfocusSession } from "@/utils/hyperfocusStorage";

const STORAGE_KEY = 'hyperfocus_session';

export default function TimerSession({ 
  taskId, 
  mode, // "starter" | "focus"
  durationSeconds,
  onComplete,
  onStop, // Called when user wants to stop without completing
  onCreateDistractionTask,
  onPause,
  onResume,
  onContinueFocus, // Called when user clicks "Continue for 30m/60m" after starter
  initialRemainingMs,
  isRunning: initialIsRunning,
}) {
  const [remainingMs, setRemainingMs] = useState(initialRemainingMs || durationSeconds * 1000);
  const [isRunning, setIsRunning] = useState(initialIsRunning || false);
  const [distractionText, setDistractionText] = useState("");
  const [isCompleted, setIsCompleted] = useState(false);
  const intervalRef = useRef(null);
  const endsAtRef = useRef(null);

  const totalMs = durationSeconds * 1000;
  const progress = ((totalMs - remainingMs) / totalMs) * 100;
  const isStarterMode = mode === "starter";

  // Sync internal state when props change (e.g., when timer is restarted)
  useEffect(() => {
    const newRemainingMs = initialRemainingMs || durationSeconds * 1000;
    const newIsRunning = initialIsRunning || false;
    
    // Only update if values actually changed (to avoid unnecessary re-renders)
    if (remainingMs !== newRemainingMs) {
      setRemainingMs(newRemainingMs);
      // Reset endsAtRef when remaining time changes (e.g., restart)
      if (newIsRunning) {
        endsAtRef.current = Date.now() + newRemainingMs;
      } else {
        endsAtRef.current = null;
      }
    }
    
    if (isRunning !== newIsRunning) {
      setIsRunning(newIsRunning);
      // Reset endsAtRef when resuming
      if (newIsRunning && !endsAtRef.current) {
        endsAtRef.current = Date.now() + newRemainingMs;
      } else if (!newIsRunning) {
        endsAtRef.current = null;
      }
    }
    
    // Reset completion state if timer restarts (full duration restored)
    if (isCompleted && newRemainingMs === durationSeconds * 1000) {
      setIsCompleted(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRemainingMs, initialIsRunning, durationSeconds]);

  // Format time display
  const formatTime = (ms) => {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Save session to localStorage
  const saveSession = (remaining, running) => {
    const remainingSeconds = Math.floor(remaining / 1000);
    const session = {
      nextTaskId: taskId,
      status: running ? 'running' : 'paused',
      mode: mode,
      durationSeconds: durationSeconds,
      remainingSeconds,
      endsAt: running ? Date.now() + remaining : null,
      remainingMs: remaining, // backward compatibility
      // Legacy fields for backward compatibility
      isRunning: running,
      modeMinutes: mode === "focus" ? durationSeconds / 60 : undefined,
    };
    saveHyperfocusSession(session);
  };

  // Handle pause/resume
  const handlePause = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
    saveSession(remainingMs, false);
    if (onPause) onPause();
  };

  const handleResume = () => {
    setIsRunning(true);
    endsAtRef.current = Date.now() + remainingMs;
    saveSession(remainingMs, true);
    if (onResume) onResume();
  };

  // Handle complete
  const handleComplete = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    localStorage.removeItem(STORAGE_KEY);
    if (onComplete) onComplete();
  };

  // Handle stop (cancel without completing)
  const handleStop = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    // Don't clear localStorage here - let parent component handle cleanup
    // This allows parent to show confirmation dialog first
    if (onStop) onStop();
  };

  // Handle distraction capture
  const handleDistractionSubmit = (e) => {
    e.preventDefault();
    if (!distractionText.trim()) return;
    
    if (onCreateDistractionTask) {
      onCreateDistractionTask(distractionText.trim());
    }
    setDistractionText("");
  };

  // Timer effect
  useEffect(() => {
    if (!isRunning) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Initialize endsAt if starting
    if (!endsAtRef.current) {
      endsAtRef.current = Date.now() + remainingMs;
    }

    // Update every 100ms for smooth countdown
    intervalRef.current = setInterval(() => {
      const now = Date.now();
      const remaining = Math.max(0, endsAtRef.current - now);
      
      setRemainingMs(remaining);
      saveSession(remaining, true);

      // Check if timer completed
      if (remaining <= 0) {
        setIsCompleted(true);
        setIsRunning(false);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        // For starter mode, don't auto-complete - wait for user action
        // For focus mode, trigger completion
        if (!isStarterMode && onComplete) {
          handleComplete();
        }
      }
    }, 100);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRunning, isStarterMode, onComplete]);

  // Handle continue to focus mode
  const handleContinueFocus = (focusMinutes) => {
    if (onContinueFocus) {
      onContinueFocus(focusMinutes);
    }
  };

  // Show completion prompt for starter mode
  if (isStarterMode && isCompleted) {
    return (
      <Card className="p-6 border-2 border-primary/20 bg-card/50">
        <div className="space-y-4">
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-2">2 minutes up!</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Ready to keep going?
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Button
              onClick={() => handleContinueFocus(30)}
              size="lg"
              className="w-full"
            >
              Continue for 30m
            </Button>
            <Button
              onClick={() => handleContinueFocus(60)}
              variant="outline"
              size="lg"
              className="w-full"
            >
              Continue for 60m
            </Button>
            <div className="flex gap-2 mt-2">
              <Button
                onClick={handleComplete}
                variant="outline"
                size="sm"
                className="flex-1"
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Done
              </Button>
              {onMoveToInbox && (
                <Button
                  onClick={() => {
                    handleComplete(); // Clear timer first
                    onMoveToInbox();
                  }}
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                >
                  Back to Inbox
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 border-2 border-primary/20 bg-card/50">
      <div className="space-y-4">
        {/* Timer Display */}
        <div className="text-center">
          <div className="text-5xl font-mono font-bold mb-2 text-primary">
            {formatTime(remainingMs)}
          </div>
          {isStarterMode && (
            <p className="text-sm text-muted-foreground mb-4">
              Just start. Don't optimize.
            </p>
          )}
        </div>

        {/* Progress Bar */}
        <Progress value={progress} className="h-2" />

        {/* Controls */}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            {isRunning ? (
              <Button
                onClick={handlePause}
                variant="outline"
                size="lg"
                className="flex-1 gap-2"
              >
                <Pause className="w-4 h-4" />
                Pause
              </Button>
            ) : (
              <Button
                onClick={handleResume}
                size="lg"
                className="flex-1 gap-2"
              >
                <Play className="w-4 h-4" />
                Resume
              </Button>
            )}
            <Button
              onClick={handleComplete}
              variant="outline"
              size="lg"
              className="gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              Complete
            </Button>
          </div>
          {onStop && (
            <Button
              onClick={handleStop}
              variant="ghost"
              size="sm"
              className="w-full gap-2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
              Stop
            </Button>
          )}
        </div>

        {/* Distraction Capture */}
        {onCreateDistractionTask && (
          <form onSubmit={handleDistractionSubmit} className="space-y-2">
            <Input
              value={distractionText}
              onChange={(e) => setDistractionText(e.target.value)}
              placeholder="Capture distraction..."
              className="text-sm"
            />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="w-full text-xs"
            >
              Add to inbox
            </Button>
          </form>
        )}
      </div>
    </Card>
  );
}

