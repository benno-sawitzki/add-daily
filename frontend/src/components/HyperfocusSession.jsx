import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Play, Pause, CheckCircle2, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";

const STORAGE_KEY = 'hyperfocus_session';

export default function HyperfocusSession({ 
  taskId, 
  durationMinutes, 
  onComplete,
  onCreateDistractionTask,
  onPause,
  onResume,
  initialRemainingMs,
  isRunning: initialIsRunning,
}) {
  const [remainingMs, setRemainingMs] = useState(initialRemainingMs || durationMinutes * 60 * 1000);
  const [isRunning, setIsRunning] = useState(initialIsRunning || false);
  const [distractionText, setDistractionText] = useState("");
  const intervalRef = useRef(null);
  const endsAtRef = useRef(null);

  const totalMs = durationMinutes * 60 * 1000;
  const progress = ((totalMs - remainingMs) / totalMs) * 100;

  // Format time display
  const formatTime = (ms) => {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Save session to localStorage
  const saveSession = (remaining, running) => {
    const session = {
      nextTaskId: taskId,
      modeMinutes: durationMinutes,
      isRunning: running,
      endsAt: running ? Date.now() + remaining : null,
      remainingMs: remaining,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
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

    intervalRef.current = setInterval(() => {
      const now = Date.now();
      const remaining = endsAtRef.current - now;

      if (remaining <= 0) {
        // Timer completed
        setRemainingMs(0);
        setIsRunning(false);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        localStorage.removeItem(STORAGE_KEY);
        if (onComplete) onComplete();
      } else {
        setRemainingMs(remaining);
        saveSession(remaining, true);
      }
    }, 100);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRunning, taskId, durationMinutes, onComplete]);

  // Check for expired session on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const session = JSON.parse(stored);
        if (session.endsAt && Date.now() >= session.endsAt) {
          // Session expired
          localStorage.removeItem(STORAGE_KEY);
          setRemainingMs(0);
          setIsRunning(false);
          if (onComplete) onComplete();
        }
      } catch (error) {
        console.error('Error checking session:', error);
      }
    }
  }, []);

  const isCompleted = remainingMs <= 0;

  return (
    <Card className="p-6 border-2 border-primary/20 bg-card/80">
      {/* Timer Display */}
      <div className="flex flex-col items-center mb-6">
        <div className="text-6xl font-bold mb-2 tabular-nums">
          {formatTime(remainingMs)}
        </div>
        <div className="w-full max-w-xs mb-4">
          <Progress value={progress} className="h-2" />
        </div>
        {isCompleted && (
          <div className="text-lg font-semibold text-primary mb-2">
            Session Complete! 🎉
          </div>
        )}
      </div>

      {/* Control Buttons */}
      <div className="flex gap-3 justify-center mb-6">
        {!isCompleted && (
          <>
            {isRunning ? (
              <Button
                onClick={handlePause}
                variant="outline"
                size="lg"
                className="gap-2"
              >
                <Pause className="w-5 h-5" />
                Pause
              </Button>
            ) : (
              <Button
                onClick={handleResume}
                size="lg"
                className="gap-2"
              >
                <Play className="w-5 h-5" />
                Resume
              </Button>
            )}
          </>
        )}
        <Button
          onClick={handleComplete}
          variant={isCompleted ? "default" : "outline"}
          size="lg"
          className="gap-2"
        >
          <CheckCircle2 className="w-5 h-5" />
          Complete
        </Button>
      </div>

      {/* Distraction Capture */}
      {isRunning && !isCompleted && (
        <div className="border-t pt-4">
          <form onSubmit={handleDistractionSubmit} className="flex gap-2">
            <Input
              value={distractionText}
              onChange={(e) => setDistractionText(e.target.value)}
              placeholder="Capture distraction..."
              className="flex-1"
            />
            <Button type="submit" size="sm" variant="outline">
              Add
            </Button>
          </form>
        </div>
      )}
    </Card>
  );
}

