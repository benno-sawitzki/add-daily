import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { 
  GripVertical, 
  Calendar as CalendarIcon, 
  Clock, 
  Trash2, 
  X,
  Pencil,
  Check
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { format, parseISO } from "date-fns";

const PRIORITY_COLORS = {
  4: "bg-rose-500",
  3: "bg-amber-500",
  2: "bg-indigo-500",
  1: "bg-slate-500",
};

const PRIORITY_LABELS = {
  4: "Critical",
  3: "High",
  2: "Medium",
  1: "Low",
};

export default function TaskQueue({ 
  tasks, 
  onReorder, 
  onUpdateTask, 
  onDeleteTask, 
  onPushToCalendar, 
  onClose 
}) {
  const [draggedId, setDraggedId] = useState(null);
  const [placeholderIndex, setPlaceholderIndex] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const draggedTaskRef = useRef(null);
  const listRef = useRef(null);

  const handleDragStart = (e, task, index) => {
    setDraggedId(task.id);
    draggedTaskRef.current = { task, index };
    
    // Create custom drag image
    const ghost = e.target.cloneNode(true);
    ghost.style.position = 'absolute';
    ghost.style.top = '-1000px';
    ghost.style.opacity = '0.9';
    ghost.style.transform = 'rotate(2deg)';
    ghost.style.width = `${e.target.offsetWidth}px`;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 20, 20);
    setTimeout(() => document.body.removeChild(ghost), 0);
    
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    
    if (draggedTaskRef.current && index !== placeholderIndex) {
      setPlaceholderIndex(index);
    }
  };

  const handleDragEnd = () => {
    if (draggedTaskRef.current && placeholderIndex !== null) {
      const fromIndex = tasks.findIndex(t => t.id === draggedId);
      if (fromIndex !== -1 && fromIndex !== placeholderIndex) {
        const newTasks = [...tasks];
        const [removed] = newTasks.splice(fromIndex, 1);
        newTasks.splice(placeholderIndex > fromIndex ? placeholderIndex : placeholderIndex, 0, removed);
        onReorder(newTasks);
      }
    }
    
    setDraggedId(null);
    setPlaceholderIndex(null);
    draggedTaskRef.current = null;
  };

  const handleDurationChange = (taskId, duration) => {
    onUpdateTask(taskId, { duration: parseInt(duration) });
  };

  const handleDateChange = (taskId, date) => {
    onUpdateTask(taskId, { scheduled_date: date ? format(date, "yyyy-MM-dd") : null });
  };

  const startEditing = (task) => {
    setEditingId(task.id);
    setEditTitle(task.title);
  };

  const saveEdit = (taskId) => {
    if (editTitle.trim()) {
      onUpdateTask(taskId, { title: editTitle.trim() });
    }
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTitle("");
  };

  const getTotalDuration = () => {
    return tasks.reduce((sum, task) => sum + (task.duration || 30), 0);
  };

  const formatDuration = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins} min`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  };

  // Build the display list with placeholder
  const getDisplayList = () => {
    if (draggedId === null || placeholderIndex === null) {
      return tasks.map((task, i) => ({ type: 'task', task, index: i }));
    }

    const list = [];
    const draggedIndex = tasks.findIndex(t => t.id === draggedId);
    let taskIndex = 0;

    for (let i = 0; i <= tasks.length; i++) {
      if (i === placeholderIndex && draggedIndex > placeholderIndex) {
        list.push({ type: 'placeholder', index: i });
      }
      
      if (taskIndex < tasks.length) {
        const task = tasks[taskIndex];
        if (task.id !== draggedId) {
          list.push({ type: 'task', task, index: taskIndex });
        }
        taskIndex++;
      }
      
      if (i === placeholderIndex && draggedIndex <= placeholderIndex) {
        list.push({ type: 'placeholder', index: i });
      }
    }

    return list;
  };

  if (tasks.length === 0) {
    return null;
  }

  const displayList = getDisplayList();
  let displayIndex = 0;

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center p-4" data-testid="task-queue">
      <div className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-border bg-card/50 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Review Your Tasks</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Drag to reorder, adjust durations, then push to calendar
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Task List */}
        <div className="p-4 overflow-y-auto flex-1" ref={listRef}>
          <div className="space-y-2">
            {tasks.map((task, index) => {
              const priorityColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[2];
              const isDragging = draggedId === task.id;
              const showPlaceholderBefore = placeholderIndex === index && draggedId !== null && tasks.findIndex(t => t.id === draggedId) > index;
              const showPlaceholderAfter = placeholderIndex === index + 1 && draggedId !== null && tasks.findIndex(t => t.id === draggedId) <= index;

              // Calculate display number
              let displayNum = index + 1;
              if (draggedId !== null && placeholderIndex !== null) {
                const draggedIndex = tasks.findIndex(t => t.id === draggedId);
                if (task.id === draggedId) {
                  displayNum = placeholderIndex + 1;
                } else if (draggedIndex < placeholderIndex) {
                  if (index > draggedIndex && index <= placeholderIndex) {
                    displayNum = index;
                  }
                } else if (draggedIndex > placeholderIndex) {
                  if (index >= placeholderIndex && index < draggedIndex) {
                    displayNum = index + 2;
                  }
                }
              }

              return (
                <div key={task.id}>
                  {/* Placeholder before */}
                  {showPlaceholderBefore && (
                    <div className="h-16 mb-2 rounded-xl border-2 border-dashed border-primary/50 bg-primary/5 flex items-center justify-center">
                      <span className="text-sm text-primary/70">Drop here</span>
                    </div>
                  )}
                  
                  <div
                    draggable
                    onDragStart={(e) => handleDragStart(e, task, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition-all duration-150 select-none
                      ${isDragging 
                        ? "opacity-40 scale-[0.98] border-dashed border-primary/30 bg-primary/5" 
                        : "border-border bg-card/50 hover:bg-card cursor-grab active:cursor-grabbing hover:shadow-md"
                      }
                    `}
                    data-testid={`queue-task-${task.id}`}
                  >
                    {/* Drag Handle */}
                    <div className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                      <GripVertical className="w-5 h-5" />
                    </div>

                    {/* Order Number */}
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full ${priorityColor} flex items-center justify-center text-white text-sm font-bold shadow-sm`}>
                      {index + 1}
                    </div>

                    {/* Task Title */}
                    <div className="flex-1 min-w-0">
                      {editingId === task.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit(task.id);
                              if (e.key === "Escape") cancelEdit();
                            }}
                            className="h-8"
                            autoFocus
                          />
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => saveEdit(task.id)}>
                            <Check className="w-4 h-4 text-emerald-500" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={cancelEdit}>
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : (
                        <div 
                          className="flex items-center gap-2 cursor-pointer group/title"
                          onClick={() => startEditing(task)}
                        >
                          <span className="font-medium truncate">{task.title}</span>
                          <Pencil className="w-3 h-3 opacity-0 group-hover/title:opacity-50 transition-opacity" />
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${priorityColor} text-white`}>
                          {PRIORITY_LABELS[task.priority] || "Medium"}
                        </span>
                      </div>
                    </div>

                    {/* Duration Selector */}
                    <div className="flex-shrink-0">
                      <Select
                        value={String(task.duration || 30)}
                        onValueChange={(value) => handleDurationChange(task.id, value)}
                      >
                        <SelectTrigger className="w-24 h-9">
                          <Clock className="w-3 h-3 mr-1" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="30">30 min</SelectItem>
                          <SelectItem value="60">1 hour</SelectItem>
                          <SelectItem value="90">1.5 hrs</SelectItem>
                          <SelectItem value="120">2 hours</SelectItem>
                          <SelectItem value="150">2.5 hrs</SelectItem>
                          <SelectItem value="180">3 hours</SelectItem>
                          <SelectItem value="240">4 hours</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Date Picker */}
                    <div className="flex-shrink-0">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-28 h-9 justify-start text-left font-normal">
                            <CalendarIcon className="w-3 h-3 mr-1" />
                            {task.scheduled_date 
                              ? format(parseISO(task.scheduled_date), "MMM d")
                              : "Today"
                            }
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 z-[100]" align="end" side="top">
                          <Calendar
                            mode="single"
                            selected={task.scheduled_date ? parseISO(task.scheduled_date) : new Date()}
                            onSelect={(date) => handleDateChange(task.id, date)}
                            disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>

                    {/* Delete Button */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="flex-shrink-0 h-9 w-9 text-muted-foreground hover:text-destructive"
                      onClick={() => onDeleteTask(task.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Placeholder after */}
                  {showPlaceholderAfter && (
                    <div className="h-16 mt-2 rounded-xl border-2 border-dashed border-primary/50 bg-primary/5 flex items-center justify-center">
                      <span className="text-sm text-primary/70">Drop here</span>
                    </div>
                  )}
                </div>
              );
            })}
            
            {/* Placeholder at end */}
            {placeholderIndex === tasks.length && draggedId !== null && (
              <div className="h-16 rounded-xl border-2 border-dashed border-primary/50 bg-primary/5 flex items-center justify-center">
                <span className="text-sm text-primary/70">Drop here</span>
              </div>
            )}
          </div>
          
          {/* Drop zone at bottom */}
          <div 
            className="h-8"
            onDragOver={(e) => handleDragOver(e, tasks.length)}
          />
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border bg-card flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{tasks.length} tasks</span>
              <span className="mx-2">·</span>
              <span>Total: {formatDuration(getTotalDuration())}</span>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={onPushToCalendar} className="gap-2">
                <CalendarIcon className="w-4 h-4" />
                Push to Calendar
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
