import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
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
import { CalendarIcon, Trash2, Inbox, ChevronDown, CheckCircle2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

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
    impakt: null, // low, medium, high, or null
    priority: "2",
    energy_required: "medium",
    scheduled_date: null,
    scheduled_time: "",
    duration: "30",
    status: "inbox",
  });
  const [isSaving, setIsSaving] = useState(false);

  // Reset saving state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setIsSaving(false);
    }
  }, [open]);

  useEffect(() => {
    if (task) {
      // Handle migration: convert old importance integer to impakt string
      let impaktValue = task.impakt;
      if (!impaktValue && task.importance !== undefined) {
        const impaktMap = {1: 'low', 2: 'medium', 3: 'high', 4: 'high'};
        impaktValue = impaktMap[task.importance] || null;
      }
      
      setFormData({
        title: task.title || "",
        description: task.description || "",
        impakt: impaktValue || null,
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
        impakt: null,
        priority: "2",
        energy_required: "medium",
        scheduled_date: null,
        scheduled_time: "",
        duration: "30",
        status: "inbox",
      });
    }
  }, [task]);

  // Update priority when impakt changes (for visual feedback)
  useEffect(() => {
    if (formData.impakt) {
      // Map impakt to priority: high=3, medium=2, low=1
      const impaktToPriority = {
        'high': 3,
        'medium': 2,
        'low': 1
      };
      const newPriority = impaktToPriority[formData.impakt] || 2;
      if (String(newPriority) !== formData.priority) {
        setFormData(prev => ({ ...prev, priority: String(newPriority) }));
      }
    }
  }, [formData.impakt, formData.priority]);

  const handleSave = useCallback(async () => {
    console.log('[TaskEditDialog.handleSave] Called', { isSaving, hasTitle: !!formData.title?.trim(), formData });
    
    // Prevent multiple simultaneous saves
    if (isSaving) {
      console.log('[TaskEditDialog.handleSave] Already saving, returning');
      return;
    }

    if (!formData.title?.trim()) {
      console.log('[TaskEditDialog.handleSave] Title is empty, returning');
      toast.error("Task title is required");
      return; // Don't save empty tasks
    }

    console.log('[TaskEditDialog.handleSave] Starting save...');
    setIsSaving(true);

    try {
      // Derive priority from impakt if impakt is set, otherwise use existing priority or default
      let priority;
      if (formData.impakt) {
        // Map impakt to priority: high=3, medium=2, low=1
        const impaktToPriority = {
          'high': 3,
          'medium': 2,
          'low': 1
        };
        priority = impaktToPriority[formData.impakt] || 2;
      } else {
        // If impakt is not set, use existing priority from task or default to 2
        priority = task?.priority || parseInt(formData.priority) || 2;
      }
      
      const taskData = {
        title: formData.title,
        description: formData.description ?? "", // Always include description, even if empty (use ?? to handle null/undefined)
        impakt: formData.impakt || null, // low, medium, high, or null
        priority: priority,
        energy_required: formData.energy_required,
        scheduled_date: formData.scheduled_date || null,
        scheduled_time: formData.scheduled_time || null,
        duration: parseInt(formData.duration) || 30, // Ensure we always have a valid number
        status: formData.status, // Use the status from the form
      };
      
      // Debug logging for description
      console.log('[TaskEditDialog] Saving task with description:', {
        taskId: task?.id,
        description: taskData.description,
        descriptionType: typeof taskData.description,
        descriptionLength: taskData.description?.length,
        formDataDescription: formData.description,
        formDataDescriptionType: typeof formData.description,
      });
      
      // If status is "scheduled" but no date is set, clear scheduled_date and scheduled_time
      if (taskData.status === "scheduled" && !formData.scheduled_date) {
        taskData.scheduled_date = null;
        taskData.scheduled_time = null;
      }
      
      // If status is not "scheduled", clear scheduled_date and scheduled_time
      if (taskData.status !== "scheduled") {
        taskData.scheduled_date = null;
        taskData.scheduled_time = null;
      }

      // Call onSave - don't await, close dialog immediately for better UX
      const result = onSave(task ? task.id : null, taskData);
      
      // Close dialog immediately - don't wait for async operation
      onOpenChange(false);
      
      // Handle errors in background (don't block dialog closing)
      if (result && typeof result.then === 'function') {
        result.catch((error) => {
          toast.error(error?.message || "Failed to save task");
        });
      }
    } catch (error) {
      // Only catch synchronous errors
      toast.error(error?.message || "Failed to save task");
    } finally {
      setIsSaving(false);
    }
  }, [formData, task, onSave, onOpenChange, isSaving]);

  // Handle Enter in inputs - Cmd+Enter saves, plain Enter in title saves
  const handleKeyDown = (e) => {
    // Cmd+Enter or Ctrl+Enter: Save (works in all inputs)
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      console.log('[TaskEditDialog.handleKeyDown] Cmd+Enter detected in input');
      e.preventDefault();
      e.stopPropagation();
      handleSave();
      return;
    }
    // Plain Enter (without modifiers) in title field: Save
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && e.target.id === "title") {
      console.log('[TaskEditDialog.handleKeyDown] Plain Enter detected in title field');
      e.preventDefault();
      handleSave();
    }
  };

  // Global keyboard shortcuts: Cmd+Enter to save, Esc to cancel
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyboardShortcut = (e) => {
      // Cmd+Enter or Ctrl+Enter: Save (works everywhere in dialog, including inputs)
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        console.log('[TaskEditDialog.handleKeyboardShortcut] Cmd+Enter detected', { target: e.target });
        const target = e.target;
        const isInput = target.tagName === 'INPUT' || 
                       target.tagName === 'TEXTAREA' || 
                       target.isContentEditable;
        
        // Always prevent default and stop propagation for Cmd+Enter
        e.preventDefault();
        e.stopPropagation();
        
        // Call handleSave regardless of whether we're in an input
        // The handleKeyDown on inputs should also work, but this ensures it works everywhere
        handleSave();
        return;
      }

      // Esc: Close modal (only if not in an input)
      if (e.key === "Escape") {
        const target = e.target;
        const isInput = target.tagName === 'INPUT' || 
                       target.tagName === 'TEXTAREA' || 
                       target.isContentEditable;
        if (!isInput) {
          e.preventDefault();
          onOpenChange(false);
        }
        return;
      }
    };

    // Use capture phase to catch events early
    document.addEventListener("keydown", handleKeyboardShortcut, true);

    return () => {
      document.removeEventListener("keydown", handleKeyboardShortcut, true);
    };
  }, [open, handleSave, onOpenChange]);

  const handleDelete = () => {
    if (task && task.id) {
      onDelete(task.id);
      onOpenChange(false);
    }
  };

  const handleComplete = () => {
    if (task && task.id) {
      // Mark task as completed
      onSave(task.id, { status: "completed" });
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
              onKeyDown={handleKeyDown}
              placeholder="Add details..."
              className="min-h-[80px]"
              data-testid="task-description-input"
            />
          </div>

          {/* Energy Required */}
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

          {/* Status */}
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={formData.status}
              onValueChange={(value) => setFormData({ ...formData, status: value })}
            >
              <SelectTrigger data-testid="status-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inbox">Inbox</SelectItem>
                <SelectItem value="next">Next Today</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="backlog">Backlog</SelectItem>
                <SelectItem value="roadmap">Roadmap</SelectItem>
                <SelectItem value="later">Later</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
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

          {/* More Options Accordion */}
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="more-options">
              <AccordionTrigger className="text-sm text-muted-foreground">
                More options
              </AccordionTrigger>
              <AccordionContent className="space-y-4 pt-2">
                {/* Impakt */}
                <div className="space-y-2">
                  <Label>Impakt</Label>
                  <Select
                    value={formData.impakt || "none"}
                    onValueChange={(value) => setFormData({ ...formData, impakt: value === "none" ? null : value })}
                  >
                    <SelectTrigger data-testid="impakt-select">
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not set</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        <DialogFooter className="flex justify-between sm:justify-between relative z-10">
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
            {task && task.status !== "completed" && (
              <Button
                variant="outline"
                onClick={handleComplete}
                className="gap-2 text-emerald-600 dark:text-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-emerald-500/20 dark:hover:bg-emerald-500/10 border-emerald-500/30 dark:border-emerald-500/30"
                data-testid="complete-task-btn"
              >
                <CheckCircle2 className="w-4 h-4" />
                Done
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button 
              onClick={(e) => {
                console.log('[TaskEditDialog] Save button clicked', { 
                  isSaving, 
                  hasTitle: !!formData.title?.trim(),
                  formData,
                  event: e 
                });
                e?.preventDefault?.();
                e?.stopPropagation?.();
                handleSave();
              }} 
              data-testid="save-task-btn"
              disabled={isSaving || !formData.title?.trim()}
              type="button"
              className="relative z-50 pointer-events-auto"
            >
              {isSaving ? "Saving..." : (task ? "Save Changes" : "Add Task")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
