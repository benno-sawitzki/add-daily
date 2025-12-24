import { useState } from "react";
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
  Check,
  Inbox
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

const ITEM_HEIGHT = 72; // Height of each task item including margin

export default function TaskQueue({ 
  tasks, 
  onReorder, 
  onUpdateTask, 
  onDeleteTask, 
  onPushToCalendar,
  onPushToInbox,
  onClose 
}) {
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");

  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex !== null && index !== draggedIndex) {
      setOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    // Don't clear overIndex on leave - only clear when dropping or ending
  };

  const handleDragEnd = () => {
    if (draggedIndex !== null && overIndex !== null && draggedIndex !== overIndex) {
      // Create new order
      const newTasks = [...tasks];
      const [removed] = newTasks.splice(draggedIndex, 1);
      newTasks.splice(overIndex, 0, removed);
      onReorder(newTasks);
    }
    setDraggedIndex(null);
    setOverIndex(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    handleDragEnd();
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
    return visualTasks.reduce((sum, task) => sum + (task.duration || 30), 0);
  };

  const formatDuration = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins} min`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  };

  if (visualTasks.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center p-4" data-testid="task-queue">
      <div className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl flex flex-col" style={{ height: "auto", maxHeight: "85vh" }}>
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

        {/* Task List - Fixed height container */}
        <div className="p-4 overflow-y-auto flex-1" style={{ minHeight: `${Math.min(visualTasks.length * 68 + 16, 340)}px` }}>
          <div className="relative">
            {visualTasks.map((task, index) => {
              const priorityColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[2];
              const isDragging = draggedIndex === index;

              return (
                <div
                  key={task.id}
                  draggable={editingId !== task.id}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center gap-3 p-3 rounded-xl border mb-2 select-none
                    ${isDragging 
                      ? "opacity-50 border-primary bg-primary/10 shadow-lg" 
                      : "border-border bg-card/50 hover:bg-card cursor-grab active:cursor-grabbing"
                    }
                  `}
                  data-testid={`queue-task-${task.id}`}
                >
                  {/* Drag Handle */}
                  <div className="flex-shrink-0 text-muted-foreground hover:text-foreground">
                    <GripVertical className="w-5 h-5" />
                  </div>

                  {/* Order Number */}
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full ${priorityColor} flex items-center justify-center text-white text-sm font-bold`}>
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
                          onClick={(e) => e.stopPropagation()}
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
                        <Pencil className="w-3 h-3 opacity-0 group-hover/title:opacity-50" />
                      </div>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${priorityColor} text-white inline-block mt-1`}>
                      {PRIORITY_LABELS[task.priority] || "Medium"}
                    </span>
                  </div>

                  {/* Duration */}
                  <Select
                    value={String(task.duration || 30)}
                    onValueChange={(value) => handleDurationChange(task.id, value)}
                  >
                    <SelectTrigger className="w-24 h-9 flex-shrink-0">
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

                  {/* Date */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-28 h-9 flex-shrink-0 justify-start font-normal">
                        <CalendarIcon className="w-3 h-3 mr-1" />
                        {task.scheduled_date ? format(parseISO(task.scheduled_date), "MMM d") : "Today"}
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

                  {/* Delete */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="flex-shrink-0 h-9 w-9 text-muted-foreground hover:text-destructive"
                    onClick={() => onDeleteTask(task.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border bg-card flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{visualTasks.length} tasks</span>
              <span className="mx-2">·</span>
              <span>Total: {formatDuration(getTotalDuration())}</span>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="secondary" onClick={onPushToInbox} className="gap-2">
                <Inbox className="w-4 h-4" />
                To Inbox
              </Button>
              <Button onClick={onPushToCalendar} className="gap-2">
                <CalendarIcon className="w-4 h-4" />
                To Calendar
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
