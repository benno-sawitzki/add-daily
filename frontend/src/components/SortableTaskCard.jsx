import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

const PRIORITY_CONFIG = {
  4: { label: "Critical", color: "text-rose-400", bg: "bg-rose-500/10", border: "border-l-rose-500", icon: AlertCircle },
  3: { label: "High", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-l-amber-500", icon: ArrowUp },
  2: { label: "Medium", color: "text-primary", bg: "bg-primary/10", border: "border-l-primary", icon: ArrowRight },
  1: { label: "Low", color: "text-muted-foreground", bg: "bg-muted/50", border: "border-l-muted-foreground", icon: ArrowDown },
};

const ENERGY_CONFIG = {
  low: { label: "L", color: "bg-slate-500/20 text-slate-300", fullLabel: "Low" },
  medium: { label: "M", color: "bg-blue-500/20 text-blue-300", fullLabel: "Medium" },
  high: { label: "H", color: "bg-purple-500/20 text-purple-300", fullLabel: "High" },
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
  
  // Handle pointer down on drag handle for feedback (using Capture phase to avoid overriding dnd-kit)
  // CRITICAL: We use onPointerDownCapture so we observe the event WITHOUT overriding dnd-kit's listeners.
  // dnd-kit's listeners (from {...listeners}) must run normally for drag activation to work.
  // We only observe for visual feedback; we never preventDefault() or stopPropagation().
  const handlePointerDownCapture = (e) => {
    // Only start hold feedback if not already dragging
    if (isActivated || isSortableDragging) return;
    
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
    opacity: isSortableDragging ? 0.4 : 1,
  };

  const priorityConfig = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG[2];
  const PriorityIcon = priorityConfig.icon;

  // HTML5 drag handlers for cross-component dragging (e.g., inbox to calendar)
  const handleHTML5DragStart = (e) => {
    if (enableHTML5Drag) {
      // Prevent dnd-kit from handling this drag
      e.stopPropagation();
      if (e.stopImmediatePropagation) {
        e.stopImmediatePropagation();
      }
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
        ref={setNodeRef}
        {...attributes}
        className={`task-card group p-4 border-l-4 ${priorityConfig.border} bg-card/50 hover:bg-card transition-all ${
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
            {/* Drag handle - attach dnd-kit listeners here for handle-based dragging */}
            {/* CRITICAL: We use onPointerDownCapture (not onPointerDown) to observe events without overriding dnd-kit's listeners.
                dnd-kit's {...listeners} must run normally for drag activation. Our feedback is purely visual. */}
            <div className="relative inline-flex items-center justify-center">
              {/* Progress ring SVG - pointer-events-none ensures it never blocks interaction */}
              {isHolding && !isActivated && (
                <svg
                  className="absolute inset-0 w-8 h-8 pointer-events-none"
                  viewBox="0 0 32 32"
                  style={{ transform: 'translate(-6px, -6px)' }}
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
              {enableHTML5Drag ? (
                <div
                  ref={(node) => {
                    handleRef.current = node;
                    setActivatorNodeRef(node);
                  }}
                  {...listeners}
                  draggable
                  onDragStart={handleHTML5DragStart}
                  onDragEnd={handleHTML5DragEnd}
                  onPointerDownCapture={handlePointerDownCapture}
                  onMouseDown={(e) => {
                    // Prevent dnd-kit from handling drags that start on the HTML5 drag handle
                    e.stopPropagation();
                  }}
                  className={`text-muted-foreground hover:text-foreground pt-1 ${
                    isActivated ? 'cursor-grabbing' : 'cursor-grab'
                  }`}
                  title="Drag to reorder or drag to calendar"
                  onClick={(e) => e.stopPropagation()}
                >
                  <GripVertical className="w-5 h-5" />
                </div>
              ) : (
                <div
                  ref={(node) => {
                    handleRef.current = node;
                    setActivatorNodeRef(node);
                  }}
                  {...listeners}
                  onPointerDownCapture={handlePointerDownCapture}
                  className={`text-muted-foreground hover:text-foreground pt-1 ${
                    isActivated ? 'cursor-grabbing' : 'cursor-grab'
                  }`}
                  title="Drag to reorder"
                  onClick={(e) => e.stopPropagation()}
                >
                  <GripVertical className="w-5 h-5" />
                </div>
              )}
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
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                  {task.description}
                </p>
              ) : (
                <div className="h-5 mt-1" />
              )}
            </div>
            <div className="flex items-center gap-3 mt-3">
              <span className={`text-xs px-2 py-1 rounded-full ${priorityConfig.bg} ${priorityConfig.color}`}>
                {priorityConfig.label}
              </span>
              {task.energy_required && ENERGY_CONFIG[task.energy_required] && (
                <span 
                  className={`text-xs px-2 py-1 rounded-full ${ENERGY_CONFIG[task.energy_required].color} font-medium`}
                  title={`Energy: ${ENERGY_CONFIG[task.energy_required].fullLabel}`}
                >
                  {ENERGY_CONFIG[task.energy_required].label}
                </span>
              )}
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <ArrowUp className="w-3 h-3" /> Urgency: {task.urgency}
              </span>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Importance: {task.importance}
              </span>
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
                className="h-8 w-8 text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10"
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

