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
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [previewOrder, setPreviewOrder] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");

  // Get the display order (preview while dragging, or actual order)
  const displayTasks = previewOrder || tasks;

  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    // Set a transparent drag image
    const img = new Image();
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    e.dataTransfer.setDragImage(img, 0, 0);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    
    // Create preview of new order
    const newOrder = [...tasks];
    const [draggedTask] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(index, 0, draggedTask);
    setPreviewOrder(newOrder);
  };

  const handleDragLeave = () => {
    // Don't clear preview on leave - only on drop or end
  };

  const handleDrop = (e, dropIndex) => {
    e.preventDefault();
    if (previewOrder) {
      onReorder(previewOrder);
    }
    setDraggedIndex(null);
    setPreviewOrder(null);
  };

  const handleDragEnd = () => {
    // If dropped outside, reset
    if (previewOrder) {
      onReorder(previewOrder);
    }
    setDraggedIndex(null);
    setPreviewOrder(null);
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

  if (tasks.length === 0) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center p-4" data-testid="task-queue">
      <div className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-border bg-card/50">
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
        <div className="p-4 max-h-[400px] overflow-y-auto">
          <div className="space-y-2">
            {tasks.map((task, index) => {
              const priorityColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[2];
              const isDragging = draggedIndex === index;
              const isDragOver = dragOverIndex === index;

              return (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-grab active:cursor-grabbing
                    ${isDragging ? "opacity-50 scale-95" : ""}
                    ${isDragOver ? "border-primary bg-primary/10" : "border-border bg-card/50 hover:bg-card"}
                  `}
                  data-testid={`queue-task-${task.id}`}
                >
                  {/* Drag Handle */}
                  <div className="flex-shrink-0 text-muted-foreground">
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
                        />
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => saveEdit(task.id)}>
                          <Check className="w-4 h-4 text-emerald-500" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={cancelEdit}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{task.title}</span>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 hover:opacity-100"
                          onClick={() => startEditing(task)}
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
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
                      <PopoverContent className="w-auto p-0" align="end">
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
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border bg-card/50">
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
                <Calendar className="w-4 h-4" />
                Push to Calendar
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
