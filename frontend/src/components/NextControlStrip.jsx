import { useState, forwardRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Play,
  Pause,
  CheckCircle2,
  Check,
  Pencil,
  ArrowLeft,
  Zap,
} from "lucide-react";

export default function NextControlStrip({
  task,
  hyperfocusSession,
  onStartHyperfocus,
  onStartStarter,
  onPauseHyperfocus,
  onResumeHyperfocus,
  onCompleteHyperfocus,
  onCompleteTask,
  onEditTask,
  onMoveToInbox,
  onDurationChange,
  doneButtonRef,
}) {
  const [duration, setDuration] = useState(hyperfocusSession?.modeMinutes || 30);
  const [isCompleting, setIsCompleting] = useState(false);

  const isHyperfocusRunning = hyperfocusSession?.isRunning || false;
  const isHyperfocusPaused = hyperfocusSession && !hyperfocusSession.isRunning;
  const isStarterMode = hyperfocusSession?.mode === "starter";
  const isStarterRunning = isStarterMode && hyperfocusSession?.isRunning;
  const isStarterPaused = isStarterMode && hyperfocusSession && !hyperfocusSession.isRunning;

  const handleDurationChange = (value) => {
    if (value) {
      const newDuration = parseInt(value);
      setDuration(newDuration);
      if (onDurationChange) {
        onDurationChange(newDuration);
      }
    }
  };

  const handleHyperfocusToggle = () => {
    if (isHyperfocusRunning) {
      if (onPauseHyperfocus) onPauseHyperfocus();
    } else if (isHyperfocusPaused) {
      if (onResumeHyperfocus) onResumeHyperfocus();
    } else {
      if (onStartHyperfocus) onStartHyperfocus(duration);
    }
  };

  return (
    <div className="mt-4 space-y-3">
      {/* Primary Actions: 2-min Starter and Hyperfocus */}
      <div className="flex items-center gap-2">
        {/* 2-min Starter Button */}
        <Button
          onClick={handleStarterToggle}
          size="lg"
          variant={isStarterRunning || isStarterPaused ? "default" : "outline"}
          className="gap-2"
          disabled={isHyperfocusRunning || isHyperfocusPaused}
        >
          {isStarterRunning ? (
            <>
              <Pause className="w-4 h-4" />
              <span className="hidden sm:inline">Pause</span>
            </>
          ) : isStarterPaused ? (
            <>
              <Play className="w-4 h-4" />
              <span className="hidden sm:inline">Resume</span>
            </>
          ) : (
            <>
              <Zap className="w-4 h-4" />
              <span className="hidden sm:inline">2-min starter</span>
              <span className="sm:hidden">2m</span>
            </>
          )}
        </Button>

        {/* Hyperfocus Button */}
        <Button
          onClick={handleHyperfocusToggle}
          size="lg"
          className={`flex-1 gap-2 ${
            isHyperfocusRunning || isHyperfocusPaused 
              ? "" 
              : "bg-primary/80 hover:bg-primary/70 text-primary-foreground dark:bg-primary dark:hover:bg-primary/90"
          }`}
          variant={isHyperfocusRunning || isHyperfocusPaused ? "outline" : "default"}
          disabled={isStarterRunning || isStarterPaused}
        >
          {isHyperfocusRunning ? (
            <>
              <Pause className="w-4 h-4" />
              Pause
            </>
          ) : isHyperfocusPaused ? (
            <>
              <Play className="w-4 h-4" />
              Resume
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Hyperfocus
            </>
          )}
        </Button>

        {/* Duration Toggle - only show when no timer is running */}
        {!isHyperfocusRunning && !isHyperfocusPaused && !isStarterRunning && !isStarterPaused && (
          <ToggleGroup
            type="single"
            value={String(duration)}
            onValueChange={handleDurationChange}
            className="border rounded-md"
          >
            <ToggleGroupItem value="30" aria-label="30 minutes" className="px-3">
              30m
            </ToggleGroupItem>
            <ToggleGroupItem value="60" aria-label="60 minutes" className="px-3">
              60m
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      {/* Secondary Actions */}
      <div className="flex items-center gap-2">
        <motion.div
          layout
          className="flex-1"
          transition={{ duration: 0.3, ease: "easeInOut" }}
        >
          <Button
            ref={doneButtonRef}
            onClick={() => {
              setIsCompleting(true);
              // Morph for 300ms, then trigger completion
              setTimeout(() => {
                onCompleteTask(task.id);
                // Reset after confetti animation completes (800ms confetti + buffer)
                setTimeout(() => {
                  setIsCompleting(false);
                }, 900);
              }, 300);
            }}
            variant={isCompleting ? "default" : "outline"}
            size="sm"
            className="flex-1 gap-2 justify-center min-w-[80px]"
            disabled={isCompleting}
            asChild={false}
          >
            <AnimatePresence mode="wait" initial={false}>
              {isCompleting ? (
                <motion.div
                  key="check"
                  initial={{ scale: 0.5, opacity: 0, rotate: -180 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.34, 1.56, 0.64, 1] }}
                  className="flex items-center justify-center"
                >
                  <Check className="w-5 h-5 text-white" />
                </motion.div>
              ) : (
                <motion.div
                  key="done"
                  initial={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeIn" }}
                  className="flex items-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Done</span>
                </motion.div>
              )}
            </AnimatePresence>
          </Button>
        </motion.div>

        {/* Small Actions */}
        <Button
          onClick={() => onEditTask(task)}
          variant="ghost"
          size="icon"
          title="Edit"
        >
          <Pencil className="w-4 h-4" />
        </Button>

        <Button
          onClick={() => onMoveToInbox(task.id)}
          variant="ghost"
          size="icon"
          title="Back to Inbox"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

