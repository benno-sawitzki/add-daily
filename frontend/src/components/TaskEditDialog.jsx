import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Trash2, Inbox } from "lucide-react";
import { format, parseISO } from "date-fns";

const PRIORITY_OPTIONS = [
  { value: "1", label: "Low", color: "bg-slate-500" },
  { value: "2", label: "Medium", color: "bg-indigo-500" },
  { value: "3", label: "High", color: "bg-amber-500" },
  { value: "4", label: "Critical", color: "bg-rose-500" },
];

const TIME_OPTIONS = [];
for (let hour = 6; hour <= 22; hour++) {
  TIME_OPTIONS.push(`${hour.toString().padStart(2, "0")}:00`);
  TIME_OPTIONS.push(`${hour.toString().padStart(2, "0")}:30`);
}

export default function TaskEditDialog({ task, open, onOpenChange, onSave, onDelete }) {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    urgency: "2",
    importance: "2",
    priority: "2",
    energy_required: "medium",
    scheduled_date: null,
    scheduled_time: "",
    duration: "30",
    status: "inbox",
  });

  useEffect(() => {
    if (task) {
      setFormData({
        title: task.title || "",
        description: task.description || "",
        urgency: String(task.urgency || 2),
        importance: String(task.importance || 2),
        priority: String(task.priority || 2),
        energy_required: task.energy_required || "medium",
        scheduled_date: task.scheduled_date || null,
        scheduled_time: task.scheduled_time || "",
        duration: String(task.duration || 30),
        status: task.status || "inbox",
      });
    } else {
      // Reset form for new task
      setFormData({
        title: "",
        description: "",
        urgency: "2",
        importance: "2",
        priority: "2",
        energy_required: "medium",
        scheduled_date: null,
        scheduled_time: "",
        duration: "30",
        status: "inbox",
      });
    }
  }, [task]);

  const handleSave = () => {
    if (!formData.title.trim()) {
      return; // Don't save empty tasks
    }

    const urgency = parseInt(formData.urgency);
    const importance = parseInt(formData.importance);
    // Use priority from form, or calculate from urgency + importance if not set
    const priority = parseInt(formData.priority) || Math.round((urgency + importance) / 2);

    const taskData = {
      title: formData.title,
      description: formData.description,
      urgency,
      importance,
      priority,
      energy_required: formData.energy_required,
      scheduled_date: formData.scheduled_date || null,
      scheduled_time: formData.scheduled_time || null,
      duration: parseInt(formData.duration),
    };
    
    // Only update status for existing tasks if scheduled_date changed
    // For new tasks, set status based on whether there's a scheduled_date
    if (task) {
      // Existing task: only update status if scheduled_date is being set/cleared
      const hadDate = task.scheduled_date;
      const hasDate = formData.scheduled_date;
      if (hadDate !== hasDate) {
        // If scheduled_date was cleared, move to inbox (or preserve current status if not scheduled)
        if (hadDate && !hasDate) {
          taskData.status = task.status === "scheduled" ? "inbox" : task.status;
          taskData.scheduled_time = null;
        } else if (!hadDate && hasDate) {
          // If scheduled_date was added, move to scheduled
          taskData.status = "scheduled";
        }
      }
      // Otherwise, don't include status in update - preserve existing status
    } else {
      // New task: set status based on scheduled_date
      taskData.status = formData.scheduled_date ? "scheduled" : "inbox";
    }

    if (task) {
      // Edit existing task
      onSave(task.id, taskData);
    } else {
      // Create new task - pass null as id to indicate creation
      onSave(null, taskData);
    }
    onOpenChange(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  };

  const handleDelete = () => {
    if (task && task.id) {
      onDelete(task.id);
      onOpenChange(false);
    }
  };

  const handleDateSelect = (date) => {
    setFormData({
      ...formData,
      scheduled_date: date ? format(date, "yyyy-MM-dd") : null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]" data-testid="task-edit-dialog">
        <DialogHeader>
          <DialogTitle>{task ? "Edit Task" : "Add New Task"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Task Name</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              onKeyDown={handleKeyDown}
              placeholder="Enter task name"
              data-testid="task-title-input"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Add details..."
              className="min-h-[80px]"
              data-testid="task-description-input"
            />
          </div>

          {/* Urgency & Importance & Energy */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Urgency</Label>
              <Select
                value={formData.urgency}
                onValueChange={(value) => setFormData({ ...formData, urgency: value })}
              >
                <SelectTrigger data-testid="urgency-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded ${opt.color}`} />
                        {opt.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Importance</Label>
              <Select
                value={formData.importance}
                onValueChange={(value) => setFormData({ ...formData, importance: value })}
              >
                <SelectTrigger data-testid="importance-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded ${opt.color}`} />
                        {opt.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Energy Required</Label>
              <Select
                value={formData.energy_required}
                onValueChange={(value) => setFormData({ ...formData, energy_required: value })}
              >
                <SelectTrigger data-testid="energy-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">⚡ Low</SelectItem>
                  <SelectItem value="medium">⚡⚡ Medium</SelectItem>
                  <SelectItem value="high">⚡⚡⚡ High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Date & Time & Duration */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                    data-testid="date-picker-trigger"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.scheduled_date
                      ? format(parseISO(formData.scheduled_date), "MMM d")
                      : "Pick date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.scheduled_date ? parseISO(formData.scheduled_date) : undefined}
                    onSelect={handleDateSelect}
                    disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                    initialFocus
                  />
                  {formData.scheduled_date && (
                    <div className="p-2 border-t">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => setFormData({ ...formData, scheduled_date: null, scheduled_time: "" })}
                      >
                        Clear date
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>Time</Label>
              <Select
                value={formData.scheduled_time}
                onValueChange={(value) => setFormData({ ...formData, scheduled_time: value })}
                disabled={!formData.scheduled_date}
              >
                <SelectTrigger data-testid="time-select">
                  <SelectValue placeholder="Time" />
                </SelectTrigger>
                <SelectContent>
                  {TIME_OPTIONS.map((time) => (
                    <SelectItem key={time} value={time}>
                      {format(new Date().setHours(parseInt(time.split(":")[0]), parseInt(time.split(":")[1])), "h:mm a")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Duration</Label>
              <Select
                value={formData.duration}
                onValueChange={(value) => setFormData({ ...formData, duration: value })}
              >
                <SelectTrigger data-testid="duration-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 min</SelectItem>
                  <SelectItem value="60">1 hour</SelectItem>
                  <SelectItem value="90">1.5 hours</SelectItem>
                  <SelectItem value="120">2 hours</SelectItem>
                  <SelectItem value="150">2.5 hours</SelectItem>
                  <SelectItem value="180">3 hours</SelectItem>
                  <SelectItem value="240">4 hours</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          <div className="flex gap-2">
            {task && (
              <>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  className="gap-2"
                  data-testid="delete-task-btn"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </Button>
                {task?.status === "scheduled" && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      onSave(task.id, { 
                        status: "inbox", 
                        scheduled_date: null, 
                        scheduled_time: null 
                      });
                      onOpenChange(false);
                    }}
                    className="gap-2"
                    data-testid="move-to-inbox-btn"
                  >
                    <Inbox className="w-4 h-4" />
                    To Inbox
                  </Button>
                )}
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} data-testid="save-task-btn">
              {task ? "Save Changes" : "Add Task"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
