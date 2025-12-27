import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  Trash2,
  Clock,
  Calendar,
  AlertCircle,
  ArrowUp,
  ArrowRight,
  ArrowDown,
  ArrowLeft,
  GripVertical,
  Sparkles,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { computeUrgency, getUrgencyBadgeClasses } from "@/utils/urgency";

const PRIORITY_CONFIG = {
  4: { 
    label: "Critical", 
    color: "text-rose-600 dark:text-rose-400", 
    bg: "bg-rose-100 dark:bg-rose-500/10", 
    border: "border-l-rose-500", 
    icon: AlertCircle 
  },
  3: { 
    label: "High", 
    color: "text-amber-900 dark:text-amber-400", 
    bg: "bg-amber-200 dark:bg-amber-500/10", 
    border: "border-l-amber-500", 
    icon: ArrowUp 
  },
  2: { 
    label: "Medium", 
    color: "text-primary dark:text-primary", 
    bg: "bg-primary/15 dark:bg-primary/10", 
    border: "border-l-primary", 
    icon: ArrowRight 
  },
  1: { 
    label: "Low", 
    color: "text-slate-600 dark:text-muted-foreground", 
    bg: "bg-slate-100 dark:bg-muted/50", 
    border: "border-l-muted-foreground", 
    icon: ArrowDown 
  },
};

const ENERGY_CONFIG = {
  low: { 
    label: "⚡", 
    color: "bg-slate-200 dark:bg-slate-500/20 text-slate-800 dark:text-slate-300 border border-slate-400 dark:border-slate-500/30 font-semibold", 
    fullLabel: "Low" 
  },
  medium: { 
    label: "⚡⚡", 
    color: "bg-blue-300 dark:bg-blue-500/20 text-blue-900 dark:text-blue-300 border border-blue-400 dark:border-blue-500/30 font-semibold", 
    fullLabel: "Medium" 
  },
  high: { 
    label: "⚡⚡⚡", 
    color: "bg-purple-300 dark:bg-purple-500/20 text-purple-900 dark:text-purple-300 border border-purple-400 dark:border-purple-500/30 font-semibold", 
    fullLabel: "High" 
  },
};

// Activation delay constants - must match activationConstraint in dndConfig.js
// Note: This delay (300ms) matches the PointerSensor activationConstraint delay.
// The progress ring fills over this duration, and the pulse happens at ~150ms (halfway).
const ACTIVATION_DELAY_MS = 300;
const PULSE_DELAY_MS = 150;
const MOVEMENT_TOLERANCE_PX = 5;

export default function SortableTaskCard({ 
  task, 
  onUpdateTask, 
  onDeleteTask, 
  onScheduleTask,
  onCompleteTask,
  onMakeNext,
  onMoveToInbox,
  onMoveUp,
  onMoveDown,
  index = 0,
  totalTasks = 1,
  onClick,
  isDragging = false,
  enableHTML5Drag = false, // Enable HTML5 drag for cross-component dragging (e.g., inbox to calendar)
  activeId = null, // ID of currently dragging task (from parent DndContext)
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: String(task.id) });

  const [scheduleMenuOpen, setScheduleMenuOpen] = useState(false);
  
  // Hold feedback state
  const [isHolding, setIsHolding] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [showPulse, setShowPulse] = useState(false);
  
  // Refs for tracking hold
  const holdStartTimeRef = useRef(null);
  const holdAnimationFrameRef = useRef(null);
  const pointerStartPosRef = useRef({ x: 0, y: 0 });
  const cardRef = useRef(null);
  const handleRef = useRef(null);
  
  const isActivated = activeId === String(task.id) && isSortableDragging;
  
  // Reset hold feedback when drag activates
  useEffect(() => {
    if (isActivated) {
      cancelHoldFeedback();
    }
  }, [isActivated]);
  
  // Cancel hold feedback helper
  const cancelHoldFeedback = () => {
    setIsHolding(false);
    setHoldProgress(0);
    setShowPulse(false);
    if (holdAnimationFrameRef.current) {
      cancelAnimationFrame(holdAnimationFrameRef.current);
      holdAnimationFrameRef.current = null;
    }
    holdStartTimeRef.current = null;
    pointerStartPosRef.current = { x: 0, y: 0 };
  };
  
  // Update hold progress via requestAnimationFrame
  const updateHoldProgress = () => {
    if (!holdStartTimeRef.current || isActivated) {
      cancelHoldFeedback();
      return;
    }
    
    const elapsed = Date.now() - holdStartTimeRef.current;
    const progress = Math.min(elapsed / ACTIVATION_DELAY_MS, 1);
    
    setHoldProgress(progress);
    
    // Show pulse at ~150ms (halfway point)
    if (elapsed >= PULSE_DELAY_MS) {
      setShowPulse(true);
    }
    
    // Continue animation if still holding and not activated
    if (progress < 1 && !isActivated && holdStartTimeRef.current) {
      holdAnimationFrameRef.current = requestAnimationFrame(updateHoldProgress);
    } else if (progress >= 1) {
      // Progress complete - drag should activate now
      cancelHoldFeedback();
    }
  };
  
  // Handle pointer down on card for feedback (using Capture phase to avoid overriding dnd-kit)
  // CRITICAL: We use onPointerDownCapture so we observe the event WITHOUT overriding dnd-kit's listeners.
  // dnd-kit's listeners (from {...listeners}) must run normally for drag activation to work.
  // We only observe for visual feedback; we never preventDefault() or stopPropagation().
  const handlePointerDownCapture = (e) => {
    // Only start hold feedback if not already dragging
    if (isActivated || isSortableDragging) return;
    
    // Don't start drag feedback if clicking on interactive elements
    if (e.target.closest('button') || e.target.closest('[role="combobox"]') || e.target.closest('input') || e.target.closest('select')) {
      return;
    }
    
    holdStartTimeRef.current = Date.now();
    pointerStartPosRef.current = { x: e.clientX, y: e.clientY };
    setIsHolding(true);
    setHoldProgress(0);
    setShowPulse(false);
    
    // Start progress animation
    holdAnimationFrameRef.current = requestAnimationFrame(updateHoldProgress);
    
    // Add global listeners for cancel scenarios (use named functions so we can remove them)
    const handlePointerMove = (moveEvent) => {
      if (!holdStartTimeRef.current) return;
      
      const dx = Math.abs(moveEvent.clientX - pointerStartPosRef.current.x);
      const dy = Math.abs(moveEvent.clientY - pointerStartPosRef.current.y);
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // Cancel if moved beyond tolerance
      if (distance > MOVEMENT_TOLERANCE_PX) {
        cancelHoldFeedback();
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
        document.removeEventListener('pointercancel', handlePointerCancel);
      }
    };
    
    const handlePointerUp = () => {
      cancelHoldFeedback();
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerCancel);
    };
    
    const handlePointerCancel = () => {
      cancelHoldFeedback();
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerCancel);
    };
    
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerCancel);
  };
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelHoldFeedback();
    };
  }, []);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0 : 1, // Completely hide when dragging to avoid conflicts with DragOverlay
  };

  const priorityConfig = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG[2];
  const PriorityIcon = priorityConfig.icon;
  
  // Compute urgency from scheduled_date/time
  const urgency = computeUrgency(task);

  // HTML5 drag handlers for cross-component dragging (e.g., inbox to calendar)
  // Note: We enable HTML5 drag alongside dnd-kit. dnd-kit handles reordering within the inbox,
  // while HTML5 drag handles dragging to the calendar. They can coexist because:
  // - dnd-kit uses pointer events (onPointerDown, etc.)
  // - HTML5 drag uses drag events (onDragStart, etc.)
  // However, when HTML5 drag starts, we need to cancel dnd-kit's drag if it's active
  const handleHTML5DragStart = (e) => {
    if (enableHTML5Drag) {
      // Don't start HTML5 drag if clicking on interactive elements
      if (e.target.closest('button') || e.target.closest('[role="combobox"]') || e.target.closest('input') || e.target.closest('select')) {
        e.preventDefault();
        return false;
      }
      
      // Cancel any active dnd-kit drag (by canceling the hold feedback)
      cancelHoldFeedback();
      
      // Don't prevent dnd-kit from handling the drag - let both work
      // dnd-kit will handle reordering within the inbox, HTML5 drag will handle calendar drops
      // We just set up the HTML5 drag data
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("taskId", task.id);
      // Create a custom drag image from the card element
      const cardElement = e.currentTarget.closest('.task-card') || e.currentTarget;
      if (cardElement) {
        // Clone the card for the drag image
        const dragImage = cardElement.cloneNode(true);
        dragImage.style.width = `${cardElement.offsetWidth}px`;
        dragImage.style.opacity = '0.8';
        dragImage.style.position = 'absolute';
        dragImage.style.top = '-1000px';
        dragImage.style.left = '-1000px';
        dragImage.style.pointerEvents = 'none';
        document.body.appendChild(dragImage);
        const rect = cardElement.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        e.dataTransfer.setDragImage(dragImage, x, y);
        // Clean up after a short delay
        setTimeout(() => {
          if (document.body.contains(dragImage)) {
            document.body.removeChild(dragImage);
          }
        }, 0);
      }
    }
  };

  const handleHTML5DragEnd = () => {
    // Cleanup if needed
  };

  const handleScheduleTask = (date) => {
    const now = new Date();
    let hours = now.getHours();
    let minutes = now.getMinutes();
    
    if (minutes > 0 && minutes <= 30) {
      minutes = 30;
    } else if (minutes > 30) {
      minutes = 0;
      hours += 1;
    }
    
    if (hours < 6) hours = 9;
    if (hours > 22) hours = 9;
    
    const defaultTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    
    onScheduleTask(task.id, date, defaultTime);
  };

  const handleCompleteTask = (e) => {
    e.stopPropagation();
    e.preventDefault();
    onCompleteTask(task.id);
  };

  const handleDeleteTask = (e) => {
    e.stopPropagation();
    e.preventDefault();
    onDeleteTask(task.id);
  };

  const handleMakeNext = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (onMakeNext) {
      onMakeNext(task.id);
    }
  };

  const handleMoveToInbox = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (onMoveToInbox) {
      onMoveToInbox(task.id);
    }
  };

  const handleMoveUpClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (onMoveUp) {
      onMoveUp(task.id);
    }
  };

  const handleMoveDownClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (onMoveDown) {
      onMoveDown(task.id);
    }
  };

  return (
    <div style={style} className="mb-3">
      <Card
        ref={(node) => {
          setNodeRef(node);
          cardRef.current = node;
          // Set activator node ref to the card itself for drag-from-anywhere
          // Only set if not in drag overlay (isDragging prop)
          if (!isDragging) {
            setActivatorNodeRef(node);
          }
        }}
        {...(!isDragging ? attributes : {})}
        {...(!isDragging ? listeners : {})}
        draggable={false}
        onPointerDownCapture={!isDragging ? handlePointerDownCapture : undefined}
        className={`task-card group p-4 border-l-4 ${priorityConfig.border} bg-card/50 hover:bg-card transition-all ${
          isDragging ? "cursor-grabbing" : "cursor-grab active:cursor-grabbing"
        } ${
          isSortableDragging ? "border-dashed border-primary/50 bg-primary/5" : ""
        } ${showPulse && !isActivated ? "hold-pulse" : ""}`}
        data-testid={`task-card-${task.id}`}
        onClick={onClick}
      >
        <div className="flex items-start gap-3">
          {/* Drag handle and move arrows - fixed height to ensure consistent card heights */}
          <div className="flex flex-col items-center gap-1 flex-shrink-0 h-[72px] justify-center">
            {/* Move Up Arrow - always reserve space */}
            <div className={index > 0 && onMoveUp ? "" : "h-8 w-8"}>
              {index > 0 && onMoveUp && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  onClick={handleMoveUpClick}
                  title="Move up"
                >
                  <ArrowUp className="w-4 h-4" />
                </Button>
              )}
            </div>
            {/* Drag handle icon (visual only - drag now works from entire card) */}
            <div className="relative inline-flex items-center justify-center">
              <div
                ref={(node) => {
                  if (node) {
                    handleRef.current = node;
                  }
                }}
                className="relative text-muted-foreground hover:text-foreground pt-1 flex items-center justify-center"
                title="Drag from anywhere on the card to reorder"
              >
                {/* Progress ring SVG - positioned at the drag handle icon, pointer-events-none ensures it never blocks interaction */}
                {isHolding && !isActivated && (
                  <svg
                    className="absolute left-1/2 w-8 h-8 pointer-events-none"
                    viewBox="0 0 32 32"
                    style={{ 
                      top: 'calc(0.25rem + 0.625rem)', // pt-1 (4px) + half icon height (10px) = icon center at 14px
                      transform: 'translate(-50%, -50%)',
                    }}
                  >
                    <circle
                      cx="16"
                      cy="16"
                      r="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="text-primary/20"
                    />
                    <circle
                      cx="16"
                      cy="16"
                      r="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeDasharray={`${2 * Math.PI * 14}`}
                      strokeDashoffset={`${2 * Math.PI * 14 * (1 - holdProgress)}`}
                      strokeLinecap="round"
                      className="text-primary transition-none"
                      style={{
                        transform: 'rotate(-90deg)',
                        transformOrigin: '16px 16px',
                      }}
                    />
                  </svg>
                )}
                <GripVertical className="w-5 h-5" />
              </div>
            </div>
            {/* Move Down Arrow - always reserve space */}
            <div className={index < totalTasks - 1 && onMoveDown ? "" : "h-8 w-8"}>
              {index < totalTasks - 1 && onMoveDown && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  onClick={handleMoveDownClick}
                  title="Move down"
                >
                  <ArrowDown className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Priority indicator */}
          <div className={`flex-shrink-0 w-10 h-10 rounded-lg ${priorityConfig.bg} flex items-center justify-center`}>
            <PriorityIcon className={`w-5 h-5 ${priorityConfig.color}`} />
          </div>

          {/* Task content */}
          <div className="flex-1 min-w-0 min-h-[72px] flex flex-col justify-between">
            <div>
              <h3 className="font-medium text-foreground truncate" data-testid={`task-title-${task.id}`}>
                {task.title}
              </h3>
              {task.description ? (
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2 whitespace-pre-line">
                  {task.description}
                </p>
              ) : (
                <div className="h-5 mt-1" />
              )}
            </div>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {/* Impakt (Priority) - Badge style */}
              <Badge variant="outline" className={`${priorityConfig.bg} ${priorityConfig.color} border-current/20 text-xs`}>
                {priorityConfig.label}
              </Badge>
              {/* Urgency - Badge style */}
              {urgency.label && (
                <Badge variant="outline" className={`${getUrgencyBadgeClasses(urgency.status)} text-xs`}>
                  {urgency.label}
                </Badge>
              )}
              {/* Energy - Selector with lightning bolts */}
              <Select
                key={`energy-${task.id}-${task.energy_required || 'medium'}`}
                value={task.energy_required || "medium"}
                onValueChange={(value) => {
                  if (onUpdateTask) {
                    onUpdateTask(task.id, { energy_required: value });
                  }
                }}
              >
                <SelectTrigger 
                  className="h-auto p-1.5 border border-border/50 shadow-none hover:opacity-80 focus:ring-0 focus:ring-offset-0 bg-transparent w-auto min-w-0 text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <SelectValue>
                    {(() => {
                      const energyValue = task.energy_required || "medium";
                      if (energyValue === "low") return "⚡ Low";
                      if (energyValue === "medium") return "⚡⚡ Medium";
                      if (energyValue === "high") return "⚡⚡⚡ High";
                      return "⚡⚡ Medium";
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent onClick={(e) => e.stopPropagation()}>
                  <SelectItem value="low">⚡ Low</SelectItem>
                  <SelectItem value="medium">⚡⚡ Medium</SelectItem>
                  <SelectItem value="high">⚡⚡⚡ High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
            {/* First row: Calendar and Next */}
            <div className="flex items-center gap-1">
              <Popover open={scheduleMenuOpen} onOpenChange={setScheduleMenuOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    title="Schedule task"
                  >
                    <Calendar className="w-4 h-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent 
                  className="w-40 p-1"
                  align="start"
                >
                  <Button
                    variant="ghost"
                    className="w-full justify-start h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleScheduleTask(new Date().toISOString().split("T")[0]);
                      setScheduleMenuOpen(false);
                    }}
                  >
                    <Calendar className="w-3.5 h-3.5 mr-2" />
                    Today
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full justify-start h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      const tomorrow = new Date();
                      tomorrow.setDate(tomorrow.getDate() + 1);
                      handleScheduleTask(tomorrow.toISOString().split("T")[0]);
                      setScheduleMenuOpen(false);
                    }}
                  >
                    <Clock className="w-3.5 h-3.5 mr-2" />
                    Tomorrow
                  </Button>
                </PopoverContent>
              </Popover>

              {task.status === 'next' && onMoveToInbox ? (
                <>
                  <div className="w-px h-5 bg-border mx-1" />

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={handleMoveToInbox}
                    title="Move back to Inbox"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                    Inbox
                  </Button>
                </>
              ) : onMakeNext && task.status !== 'next' && (
                <>
                  <div className="w-px h-5 bg-border mx-1" />

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-primary hover:text-primary hover:bg-primary/10"
                    onClick={handleMakeNext}
                    title="Set as Next"
                  >
                    <Sparkles className="w-3.5 h-3.5 mr-1" />
                    Next
                  </Button>
                </>
              )}
            </div>

            {/* Second row: Done and Delete */}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-emerald-600 dark:text-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-emerald-500/20 dark:hover:bg-emerald-500/10"
                onClick={handleCompleteTask}
                data-testid={`complete-task-${task.id}`}
                title="Mark as done"
              >
                <CheckCircle2 className="w-4 h-4" />
              </Button>

              <div className="w-px h-5 bg-border mx-1" />

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={handleDeleteTask}
                data-testid={`delete-task-${task.id}`}
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

