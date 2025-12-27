import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle,
  ArrowUp,
  ArrowRight,
  ArrowDown,
  Play,
  Pause,
  CheckCircle2,
  Check,
  Pencil,
  ArrowLeft,
} from "lucide-react";

const PRIORITY_CONFIG = {
  4: { label: "Critical", color: "text-rose-400", bg: "bg-rose-500/10", border: "border-l-rose-500", icon: AlertCircle },
  3: { label: "High", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-l-amber-500", icon: ArrowUp },
  2: { label: "Medium", color: "text-primary", bg: "bg-primary/10", border: "border-l-primary", icon: ArrowRight },
  1: { label: "Low", color: "text-muted-foreground", bg: "bg-muted/50", border: "border-l-muted-foreground", icon: ArrowDown },
};

const ENERGY_CONFIG = {
  low: { label: "Low", color: "bg-slate-500/20 text-slate-300" },
  medium: { label: "Medium", color: "bg-blue-500/20 text-blue-300" },
  high: { label: "High", color: "bg-purple-500/20 text-purple-300" },
};

export default function NextTaskCard({ 
  task, 
  onClick,
  hyperfocusSession,
  onStartHyperfocus,
  onPauseHyperfocus,
  onResumeHyperfocus,
  onCompleteTask,
  onEditTask,
  onMoveToInbox,
  doneButtonRef,
}) {
  const [duration, setDuration] = useState(hyperfocusSession?.modeMinutes || 30);
  const [isCompleting, setIsCompleting] = useState(false);

  const priorityConfig = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG[2];
  const PriorityIcon = priorityConfig.icon;
  const energyConfig = task.energy_required ? ENERGY_CONFIG[task.energy_required] : null;

  // Use status enum for single source of truth
  const focusStatus = hyperfocusSession?.status;
  const isHyperfocusRunning = focusStatus === 'running' && hyperfocusSession?.mode === "focus";
  const isHyperfocusPaused = focusStatus === 'paused' && hyperfocusSession?.mode === "focus";

  const handleDurationChange = (value) => {
    if (value) {
      const newDuration = parseInt(value);
      setDuration(newDuration);
    }
  };

  const handleToggleDuration = () => {
    setDuration(duration === 30 ? 60 : 30);
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
    <Card
      className={`p-6 border-l-4 ${priorityConfig.border} bg-card/90 hover:bg-card transition-all shadow-lg hover:shadow-xl border-2 ${
        priorityConfig.border.includes('rose') ? 'border-rose-500/30 ring-2 ring-rose-500/20' : 
        priorityConfig.border.includes('amber') ? 'border-amber-500/30 ring-2 ring-amber-500/20' :
        'border-primary/30 ring-2 ring-primary/20'
      }`}
    >
      {/* Task Content */}
      <div className="flex items-start gap-4 mb-4" onClick={onClick} style={{ cursor: 'pointer' }}>
        {/* Priority indicator - larger for Next */}
        <div className={`flex-shrink-0 w-12 h-12 rounded-lg ${priorityConfig.bg} flex items-center justify-center`}>
          <PriorityIcon className={`w-6 h-6 ${priorityConfig.color}`} />
        </div>

        {/* Task content */}
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-foreground mb-2" data-testid={`next-task-title-${task.id}`}>
            {task.title}
          </h3>
          {task.description && (
            <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
              {task.description}
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={`${priorityConfig.bg} ${priorityConfig.color} border-current/20`}>
              {priorityConfig.label}
            </Badge>
            {energyConfig && (
              <Badge variant="outline" className={`${energyConfig.color} text-xs`}>
                {energyConfig.label}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Footer Controls */}
      <div className="border-t border-border/50 pt-4" onClick={(e) => e.stopPropagation()}>
        {/* Primary Row: Hyperfocus button + Duration toggle + Done + Edit + Back to Inbox */}
        <div className="flex items-center gap-3">
          <Button
            onClick={handleHyperfocusToggle}
            size="lg"
            className="flex-1 gap-2"
            variant={isHyperfocusRunning || isHyperfocusPaused ? "outline" : "default"}
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
                Hyperfokus
              </>
            )}
          </Button>

          {/* Duration Toggle - only show when no timer is running */}
          <div className="w-[100px]">
            {!isHyperfocusRunning && !isHyperfocusPaused && (
              <button
                onClick={handleToggleDuration}
                className="relative inline-flex items-center rounded-lg bg-slate-900/80 border border-primary/30 p-0.5 shadow-lg backdrop-blur-sm cursor-pointer w-full"
                aria-label={`Toggle duration: ${duration === 30 ? 'Switch to 60 minutes' : 'Switch to 30 minutes'}`}
              >
                {/* Glow effect */}
                <div className="absolute inset-0 rounded-lg bg-primary/20 blur-sm opacity-0 transition-opacity duration-300 hover:opacity-100" />
                
                {/* Sliding background indicator */}
                <div
                  className="absolute inset-y-0.5 rounded-md bg-gradient-to-r from-primary via-primary/90 to-primary shadow-lg shadow-primary/50 transition-all duration-300 ease-in-out"
                  style={{
                    left: duration === 30 ? "0.125rem" : "calc(50% + 0.125rem)",
                    width: "calc(50% - 0.25rem)",
                  }}
                />
                
                {/* Toggle labels */}
                <span
                  className={`relative z-10 px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 flex-1 text-center ${
                    duration === 30
                      ? "text-white"
                      : "text-muted-foreground"
                  }`}
                >
                  30m
                </span>
                <span
                  className={`relative z-10 px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 flex-1 text-center ${
                    duration === 60
                      ? "text-white"
                      : "text-muted-foreground"
                  }`}
                >
                  60m
                </span>
              </button>
            )}
          </div>

          {/* Done button - same width as toggle */}
          <motion.div
            layout
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="w-[100px]"
          >
            <Button
              ref={doneButtonRef}
              onClick={() => {
                setIsCompleting(true);
                setTimeout(() => {
                  if (onCompleteTask) onCompleteTask();
                  setTimeout(() => {
                    setIsCompleting(false);
                  }, 900);
                }, 300);
              }}
              variant={isCompleting ? "default" : "outline"}
              size="sm"
              className="gap-2 justify-center w-full"
              disabled={isCompleting}
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

          {/* Edit and Back to Inbox buttons */}
          <Button
            onClick={() => onEditTask && onEditTask(task)}
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Edit"
          >
            <Pencil className="w-4 h-4" />
          </Button>

          <Button
            onClick={() => onMoveToInbox && onMoveToInbox(task.id)}
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Back to Inbox"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
