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
import { CalendarIcon, Trash2 } from "lucide-react";
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
    scheduled_date: null,
    scheduled_time: "",
    status: "inbox",
  });

  useEffect(() => {
    if (task) {
      setFormData({
        title: task.title || "",
        description: task.description || "",
        urgency: String(task.urgency || 2),
        importance: String(task.importance || 2),
        scheduled_date: task.scheduled_date || null,
        scheduled_time: task.scheduled_time || "",
        status: task.status || "inbox",
      });
    }
  }, [task]);

  const handleSave = () => {
    const urgency = parseInt(formData.urgency);
    const importance = parseInt(formData.importance);
    const priority = Math.round((urgency + importance) / 2);

    onSave(task.id, {
      title: formData.title,
      description: formData.description,
      urgency,
      importance,
      priority,
      scheduled_date: formData.scheduled_date,
      scheduled_time: formData.scheduled_time,
      status: formData.scheduled_date ? "scheduled" : "inbox",
    });
    onOpenChange(false);
  };

  const handleDelete = () => {
    onDelete(task.id);
    onOpenChange(false);
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
          <DialogTitle>Edit Task</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Task Name</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
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

          {/* Urgency & Importance */}
          <div className="grid grid-cols-2 gap-4">
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
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-4">
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
                      ? format(parseISO(formData.scheduled_date), "MMM d, yyyy")
                      : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.scheduled_date ? parseISO(formData.scheduled_date) : undefined}
                    onSelect={handleDateSelect}
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
                  <SelectValue placeholder="Select time" />
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
          </div>
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          <Button
            variant="destructive"
            onClick={handleDelete}
            className="gap-2"
            data-testid="delete-task-btn"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} data-testid="save-task-btn">
              Save Changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
