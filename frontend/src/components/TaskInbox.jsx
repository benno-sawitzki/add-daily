import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CheckCircle2,
  Trash2,
  Clock,
  MoreVertical,
  Calendar,
  AlertCircle,
  ArrowUp,
  ArrowRight,
  ArrowDown,
  Inbox,
  GripVertical,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import TaskEditDialog from "./TaskEditDialog";

const PRIORITY_CONFIG = {
  4: { label: "Critical", color: "text-rose-400", bg: "bg-rose-500/10", border: "border-l-rose-500", icon: AlertCircle },
  3: { label: "High", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-l-amber-500", icon: ArrowUp },
  2: { label: "Medium", color: "text-primary", bg: "bg-primary/10", border: "border-l-primary", icon: ArrowRight },
  1: { label: "Low", color: "text-muted-foreground", bg: "bg-muted/50", border: "border-l-muted-foreground", icon: ArrowDown },
};

const ITEM_HEIGHT = 100; // Approximate height of each task card

export default function TaskInbox({ tasks, onUpdateTask, onDeleteTask }) {
  const [editingTask, setEditingTask] = useState(null);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const [localTasks, setLocalTasks] = useState(null);
  
  // Use local tasks during drag, otherwise use sorted tasks from props
  const displayTasks = localTasks || [...tasks].sort((a, b) => b.priority - a.priority);

  const handleScheduleTask = (taskId, date) => {
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
    
    onUpdateTask(taskId, {
      scheduled_date: date,
      scheduled_time: defaultTime,
      status: "scheduled",
    });
  };

  const handleCompleteTask = (e, taskId) => {
    e.stopPropagation();
    e.preventDefault();
    onUpdateTask(taskId, { status: "completed" });
  };

  const handleDeleteTask = (e, taskId) => {
    e.stopPropagation();
    e.preventDefault();
    onDeleteTask(taskId);
  };

  // Drag and drop handlers
  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    setLocalTasks([...displayTasks]);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex !== null && index !== draggedIndex) {
      setOverIndex(index);
    }
  };

  const handleDragEnd = () => {
    if (draggedIndex !== null && overIndex !== null && draggedIndex !== overIndex) {
      // Reorder the tasks
      const newTasks = [...displayTasks];
      const [removed] = newTasks.splice(draggedIndex, 1);
      newTasks.splice(overIndex, 0, removed);
      setLocalTasks(newTasks);
      
      // Update priorities based on new order (higher index = lower priority)
      newTasks.forEach((task, idx) => {
        const newPriority = Math.max(1, 4 - Math.floor(idx / Math.ceil(newTasks.length / 4)));
        if (task.priority !== newPriority) {
          onUpdateTask(task.id, { priority: newPriority });
        }
      });
    }
    
    setDraggedIndex(null);
    setOverIndex(null);
    // Clear local tasks after a short delay to allow animations
    setTimeout(() => setLocalTasks(null), 100);
  };

  // Calculate transform for visual slot opening effect
  const getTransform = (index) => {
    if (draggedIndex === null || overIndex === null) return "";
    if (index === draggedIndex) return "";
    
    if (draggedIndex < overIndex) {
      if (index > draggedIndex && index <= overIndex) {
        return `translateY(-${ITEM_HEIGHT}px)`;
      }
    } else {
      if (index >= overIndex && index < draggedIndex) {
        return `translateY(${ITEM_HEIGHT}px)`;
      }
    }
    return "";
  };

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20" data-testid="inbox-empty">
        <div className="w-20 h-20 rounded-full bg-card flex items-center justify-center mb-6">
          <Inbox className="w-10 h-10 text-muted-foreground" />
        </div>
        <h3 className="text-xl font-semibold mb-2">Your inbox is empty</h3>
        <p className="text-muted-foreground text-center max-w-md">
          Click the "Add Tasks" button and speak to add tasks. The AI will help prioritize them for you.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="task-inbox">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Task Inbox</h2>
        <p className="text-muted-foreground">{tasks.length} tasks · drag to reorder</p>
      </div>

      <div className="relative">
        <AnimatePresence mode="popLayout">
          {displayTasks.map((task, index) => {
            const priorityConfig = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG[2];
            const PriorityIcon = priorityConfig.icon;
            const isDragging = draggedIndex === index;
            const transform = getTransform(index);

            return (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -100 }}
                transition={{ delay: index * 0.03 }}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                style={{
                  transform: transform,
                  transition: draggedIndex !== null ? "transform 200ms ease" : "none",
                }}
                className={`mb-3 ${isDragging ? "opacity-40" : ""}`}
              >
                <Card
                  className={`task-card group p-4 border-l-4 ${priorityConfig.border} bg-card/50 hover:bg-card transition-all cursor-pointer ${isDragging ? "border-dashed border-primary/50" : ""}`}
                  data-testid={`task-card-${task.id}`}
                  onClick={() => !isDragging && setEditingTask(task)}
                >
                  <div className="flex items-start gap-3">
                    {/* Drag handle */}
                    <div 
                      className="flex-shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground pt-1"
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <GripVertical className="w-5 h-5" />
                    </div>

                    {/* Priority indicator */}
                    <div className={`flex-shrink-0 w-10 h-10 rounded-lg ${priorityConfig.bg} flex items-center justify-center`}>
                      <PriorityIcon className={`w-5 h-5 ${priorityConfig.color}`} />
                    </div>

                    {/* Task content */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-foreground truncate" data-testid={`task-title-${task.id}`}>
                        {task.title}
                      </h3>
                      {task.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {task.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-3">
                        <span className={`text-xs px-2 py-1 rounded-full ${priorityConfig.bg} ${priorityConfig.color}`}>
                          {priorityConfig.label}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <ArrowUp className="w-3 h-3" /> Urgency: {task.urgency}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> Importance: {task.importance}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleScheduleTask(task.id, new Date().toISOString().split("T")[0]);
                        }}
                        title="Schedule for Today"
                      >
                        <Calendar className="w-3.5 h-3.5 mr-1" />
                        Today
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          const tomorrow = new Date();
                          tomorrow.setDate(tomorrow.getDate() + 1);
                          handleScheduleTask(task.id, tomorrow.toISOString().split("T")[0]);
                        }}
                        title="Schedule for Tomorrow"
                      >
                        <Clock className="w-3.5 h-3.5 mr-1" />
                        Tomorrow
                      </Button>

                      <div className="w-px h-5 bg-border mx-1" />

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                        onClick={(e) => handleCompleteTask(e, task.id)}
                        data-testid={`complete-task-${task.id}`}
                        title="Mark as done"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </Button>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={(e) => handleDeleteTask(e, task.id)}
                        data-testid={`delete-task-${task.id}`}
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Edit Dialog */}
      <TaskEditDialog
        task={editingTask}
        open={!!editingTask}
        onOpenChange={(open) => !open && setEditingTask(null)}
        onSave={onUpdateTask}
        onDelete={onDeleteTask}
      />
    </div>
  );
}
