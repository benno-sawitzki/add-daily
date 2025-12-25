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
import { useState } from "react";

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
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: task.id });

  const [scheduleMenuOpen, setScheduleMenuOpen] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.5 : 1,
  };

  const priorityConfig = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG[2];
  const PriorityIcon = priorityConfig.icon;

  // HTML5 drag handlers for cross-component dragging (e.g., inbox to calendar)
  const handleHTML5DragStart = (e) => {
    if (enableHTML5Drag) {
      // Prevent dnd-kit from handling this drag
      e.stopPropagation();
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

  // Determine props based on drag mode
  // Always use dnd-kit for reordering, HTML5 drag handle is separate for calendar dragging
  const cardProps = {
    ref: setNodeRef,
    ...attributes,
    ...listeners,
  };

  return (
    <div ref={setNodeRef} style={style} className="mb-3">
      <Card
        {...cardProps}
        className={`task-card group p-4 border-l-4 ${priorityConfig.border} bg-card/50 hover:bg-card transition-all cursor-grab active:cursor-grabbing ${
          isSortableDragging ? "border-dashed border-primary/50 bg-primary/5" : ""
        }`}
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
            {/* Drag handle - HTML5 drag for calendar if enabled, otherwise visual only */}
            {enableHTML5Drag ? (
              <div
                draggable
                onDragStart={handleHTML5DragStart}
                onDragEnd={handleHTML5DragEnd}
                className="text-muted-foreground hover:text-foreground pt-1 cursor-move"
                title="Drag to calendar"
                onClick={(e) => e.stopPropagation()}
              >
                <GripVertical className="w-5 h-5" />
              </div>
            ) : (
              <div className="text-muted-foreground hover:text-foreground pt-1 pointer-events-none">
                <GripVertical className="w-5 h-5" />
              </div>
            )}
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

