import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  Inbox,
  RefreshCw,
  ArrowUp,
  ArrowDown
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { format, parseISO } from "date-fns";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { suggestTodayPlan } from "@/utils/todayPlan";
import TodayPlanModal from "./TodayPlanModal";
import { Lightbulb } from "lucide-react";
import {
  DndContext,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import axios from "axios";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

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

function SortableQueueItem({ 
  task, 
  index,
  totalTasks,
  editingId,
  editTitle,
  setEditTitle,
  startEditing,
  saveEdit,
  cancelEdit,
  handleDurationChange,
  handleDateChange,
  handleDelete,
  routing,
  onRoutingChange,
  onMoveUp,
  onMoveDown,
  isDragging = false,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ 
    id: task.id,
    disabled: editingId === task.id, // Disable dragging when editing
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.5 : 1,
  };

  const priorityColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[2];

  const handleMoveUpClick = (e) => {
    e.stopPropagation();
    if (onMoveUp) onMoveUp(task.id);
  };

  const handleMoveDownClick = (e) => {
    e.stopPropagation();
    if (onMoveDown) onMoveDown(task.id);
  };

  // Determine border color based on priority
  const borderColor = {
    4: "border-l-rose-500",
    3: "border-l-amber-500",
    2: "border-l-indigo-500",
    1: "border-l-slate-500",
  }[task.priority] || "border-l-indigo-500";

  return (
    <div ref={setNodeRef} style={style} className="mb-3">
      <Card
        {...attributes}
        {...listeners}
        className={`task-card group p-4 border-l-4 ${borderColor} bg-card/50 hover:bg-card transition-all cursor-grab active:cursor-grabbing ${
          isSortableDragging ? "border-dashed border-primary/50 bg-primary/5" : ""
        }`}
        data-testid={`queue-task-${task.id}`}
      >
        <div className="flex items-start gap-3">
          {/* Drag handle and move arrows */}
          <div className="flex flex-col items-center gap-1 flex-shrink-0 h-[72px] justify-center">
            {/* Move Up Arrow */}
            {index > 0 && onMoveUp ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/50"
                onClick={handleMoveUpClick}
                title="Move up"
              >
                <ArrowUp className="w-4 h-4" />
              </Button>
            ) : (
              <div className="h-8 w-8" />
            )}
            {/* Drag handle - visual only */}
            <div className="text-muted-foreground hover:text-foreground pt-1 pointer-events-none">
              <GripVertical className="w-5 h-5" />
            </div>
            {/* Move Down Arrow */}
            {index < totalTasks - 1 && onMoveDown ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/50"
                onClick={handleMoveDownClick}
                title="Move down"
              >
                <ArrowDown className="w-4 h-4" />
              </Button>
            ) : (
              <div className="h-8 w-8" />
            )}
          </div>

          {/* Order Number */}
          <div className={`flex-shrink-0 w-10 h-10 rounded-lg ${priorityColor} flex items-center justify-center text-white text-sm font-bold`}>
            {index + 1}
          </div>

          {/* Task content */}
          <div className="flex-1 min-w-0 min-h-[72px] flex flex-col justify-between">
            <div>
              {/* Task Title */}
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
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <h3 
                        className="font-medium text-foreground truncate cursor-pointer group/title"
                        onClick={() => startEditing(task)}
                      >
                        {task.title}
                        <Pencil className="w-3 h-3 opacity-0 group-hover/title:opacity-50 inline-block ml-2" />
                      </h3>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">{task.title}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {task.description ? (
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                  {task.description}
                </p>
              ) : (
                <div className="h-5 mt-1" />
              )}
            </div>
            
            {/* Controls: Priority chip + Duration + Date + Routing + Delete */}
            <div className="flex items-center gap-3 mt-3">
              {/* Priority Chip */}
              <span className={`text-xs px-2 py-0.5 rounded-full ${priorityColor} text-white`}>
                {PRIORITY_LABELS[task.priority] || "Medium"}
              </span>

              {/* Duration */}
              <Select
                value={String(task.duration || 30)}
                onValueChange={(value) => handleDurationChange(task.id, value)}
              >
                <SelectTrigger className="w-24 h-8 flex-shrink-0 text-xs" onClick={(e) => e.stopPropagation()}>
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
                <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button variant="outline" className="w-28 h-8 flex-shrink-0 text-xs">
                    <CalendarIcon className="w-3 h-3 mr-1" />
                    {task.scheduled_date ? format(parseISO(task.scheduled_date), "MMM d") : "No date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={task.scheduled_date ? parseISO(task.scheduled_date) : undefined}
                    onSelect={(date) => handleDateChange(task.id, date)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>

              {/* Routing Toggle */}
              <ToggleGroup
                type="single"
                value={routing || "inbox"}
                onValueChange={(value) => {
                  if (value && onRoutingChange) {
                    onRoutingChange(task.id, value);
                  }
                }}
                className="border rounded-md"
                onClick={(e) => e.stopPropagation()}
              >
                <ToggleGroupItem value="inbox" aria-label="Inbox" className="px-2 text-xs h-8">
                  <Inbox className="w-3 h-3 mr-1" />
                  Inbox
                </ToggleGroupItem>
                <ToggleGroupItem value="calendar" aria-label="Calendar" className="px-2 text-xs h-8">
                  <CalendarIcon className="w-3 h-3 mr-1" />
                  Calendar
                </ToggleGroupItem>
              </ToggleGroup>

              {/* Delete */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex-shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(task.id);
                }}
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

export default function TaskQueue({ 
  tasks, 
  transcript,
  onReorder, 
  onUpdateTask, 
  onDeleteTask, 
  onPushToCalendar,
  onPushToInbox,
  onReprocess,
  onClose 
}) {
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [editedTranscript, setEditedTranscript] = useState(transcript || "");
  const [taskRouting, setTaskRouting] = useState({}); // { taskId: "inbox" | "calendar" }
  const [showTodayPlanModal, setShowTodayPlanModal] = useState(false);
  const [localTasks, setLocalTasks] = useState(tasks);
  const [isReordering, setIsReordering] = useState(false);

  // Update local tasks when props change (but not during reordering)
  useEffect(() => {
    if (!isReordering) {
      setLocalTasks(tasks);
    }
  }, [tasks, isReordering]);

  // Diagnostic logging
  useEffect(() => {
    console.log("🔍 DIAGNOSTIC: TaskQueue received tasks:", {
      tasksLength: tasks?.length,
      tasks: tasks,
      tasksDetails: tasks?.map((t, i) => ({
        index: i,
        id: t.id,
        title: t.title,
        duration: t.duration,
        priority: t.priority
      }))
    });
  }, [tasks]);

  // Initialize routing defaults when tasks change
  useEffect(() => {
    const routing = {};
    localTasks.forEach(task => {
      if (!taskRouting[task.id]) {
        // Default routing: Calendar if has scheduled_date, else Inbox
        routing[task.id] = (task.scheduled_date && task.scheduled_time) ? "calendar" : "inbox";
      } else {
        routing[task.id] = taskRouting[task.id];
      }
    });
    if (Object.keys(routing).length > 0) {
      setTaskRouting(prev => ({ ...prev, ...routing }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localTasks]);

  // Initialize edited transcript when transcript prop changes
  useEffect(() => {
    if (transcript) {
      setEditedTranscript(transcript);
    }
  }, [transcript]);

  // Check if transcript was edited
  const isTranscriptEdited = editedTranscript !== transcript;

  // Handle reprocess
  const handleReprocess = async () => {
    if (onReprocess && editedTranscript.trim()) {
      await onReprocess(editedTranscript);
    }
  };

  // Handle routing change
  const handleRoutingChange = (taskId, routing) => {
    setTaskRouting(prev => ({ ...prev, [taskId]: routing }));
  };

  // Bulk actions
  const handleAllToInbox = () => {
    const routing = {};
    localTasks.forEach(task => {
      routing[task.id] = "inbox";
    });
    setTaskRouting(routing);
  };

  const handleAllToCalendar = () => {
    const routing = {};
    localTasks.forEach(task => {
      routing[task.id] = "calendar";
    });
    setTaskRouting(routing);
  };

  const handleApplyDefaults = () => {
    const routing = {};
    localTasks.forEach(task => {
      routing[task.id] = (task.scheduled_date && task.scheduled_time) ? "calendar" : "inbox";
    });
    setTaskRouting(routing);
  };

  // Handle Today Plan modal
  const handleOpenTodayPlan = () => {
    setShowTodayPlanModal(true);
  };

  // Handle accepting the plan
  const handleAcceptPlan = async ({ nextTaskId, todayTaskIds }) => {
    try {
      // Find the Next task object
      const nextTask = localTasks.find(t => t.id === nextTaskId);
      if (!nextTask) {
        toast.error("Next task not found");
        return;
      }
      
      // Separate tasks into: next task, today tasks, and the rest
      const todayTasks = localTasks.filter(t => todayTaskIds.includes(t.id));
      const restTasks = localTasks.filter(t => t.id !== nextTaskId && !todayTaskIds.includes(t.id));
      
      // First, save the Next task to inbox to get a real database ID
      const nextTaskForInbox = {
        ...nextTask,
        status: "inbox", // Will be changed to "next" status after saving
      };
      
      // Save Next task to inbox to get a real ID
      const nextTaskResponse = await axios.post(`${API}/tasks/push-to-inbox`, {
        tasks: [nextTaskForInbox],
      });
      
      if (!nextTaskResponse.data.tasks || nextTaskResponse.data.tasks.length === 0) {
        throw new Error("Failed to save Next task");
      }
      
      const savedNextTask = nextTaskResponse.data.tasks[0];
      const savedNextTaskId = savedNextTask.id;
      
      // Now set it as Next status
      await axios.post(`${API}/tasks/${savedNextTaskId}/make-next`);
      
      // Schedule Today tasks for today
      if (todayTasks.length > 0) {
        const today = new Date().toISOString().split('T')[0];
        const todayTasksWithDate = todayTasks.map(task => ({
          ...task,
          scheduled_date: today,
          scheduled_time: task.scheduled_time || "09:00", // Default to 9 AM if no time
        }));
        
        if (onPushToCalendar) {
          await onPushToCalendar(todayTasksWithDate);
        }
      }
      
      // Save rest to inbox
      const restInboxTasks = restTasks.filter(t => (taskRouting[t.id] || "inbox") === "inbox");
      
      if (restInboxTasks.length > 0 && onPushToInbox) {
        await onPushToInbox(restInboxTasks);
      }
      
      // Close the queue modal
      onClose();
      toast.success("Plan accepted! Tasks scheduled.");
    } catch (error) {
      console.error("Error accepting plan:", error);
      const errorMessage = error.response?.data?.detail || error.message || "Failed to accept plan";
      toast.error(errorMessage);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    })
  );

  // Helper function to reorder tasks and update priorities
  // For queued tasks (not yet in database), we just update local state
  const reorderTasksAndUpdatePriorities = async (newTasks) => {
    // Prevent useEffect from resetting local state during reorder
    setIsReordering(true);
    
    // Calculate what priorities should be based on new position
    const tasksWithUpdatedPriorities = newTasks.map((task, idx) => {
      // More accurate priority calculation
      // For 1 task: priority 4
      // For 2 tasks: [4, 1]
      // For 3 tasks: [4, 2, 1]
      // For 4+ tasks: [4, 3, 2, 1] (distributed evenly)
      let newPriority;
      if (newTasks.length === 1) {
        newPriority = 4;
      } else if (newTasks.length === 2) {
        newPriority = idx === 0 ? 4 : 1;
      } else if (newTasks.length === 3) {
        newPriority = idx === 0 ? 4 : (idx === 1 ? 2 : 1);
      } else {
        // 4+ tasks: distribute evenly from 4 to 1
        newPriority = Math.max(1, Math.min(4, Math.ceil(4 - (idx * 3 / (newTasks.length - 1)))));
      }
      
      return {
        ...task,
        priority: newPriority
      };
    });

    // Update local state with new order and priorities
    setLocalTasks(tasksWithUpdatedPriorities);
    
    // For queued tasks (not yet in database), we just update local state via onReorder
    // onReorder will update MainApp's queuedTasks state with the new order and priorities
    onReorder(tasksWithUpdatedPriorities);
    
    // Allow useEffect to sync with props again
    setIsReordering(false);
  };

  const handleMoveUp = async (taskId) => {
    const currentIndex = localTasks.findIndex((t) => String(t.id) === String(taskId));
    if (currentIndex <= 0) return; // Already at top or not found

    const newTasks = arrayMove(localTasks, currentIndex, currentIndex - 1);
    await reorderTasksAndUpdatePriorities(newTasks);
  };

  const handleMoveDown = async (taskId) => {
    const currentIndex = localTasks.findIndex((t) => String(t.id) === String(taskId));
    if (currentIndex < 0 || currentIndex >= localTasks.length - 1) return; // Already at bottom or not found

    const newTasks = arrayMove(localTasks, currentIndex, currentIndex + 1);
    await reorderTasksAndUpdatePriorities(newTasks);
  };

  const handleDragStart = (event) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Check if this is a task being reordered
    const activeTask = localTasks.find((t) => String(t.id) === activeId);
    const overTask = localTasks.find((t) => String(t.id) === overId);
    
    if (activeTask && (overTask || overId === "queue-dropzone")) {
      // Reordering within queue
      const oldIndex = localTasks.findIndex((t) => String(t.id) === activeId);
      let newIndex;

      if (overId === "queue-dropzone") {
        // Dropped on queue zone itself, move to top
        newIndex = 0;
      } else {
        // Dropped on another task
        newIndex = localTasks.findIndex((t) => String(t.id) === overId);
        if (newIndex === -1) {
          console.warn(`Could not find target task with id: ${overId}`);
          return;
        }
      }

      // Only proceed if we have a valid new position
      if (oldIndex !== newIndex && newIndex !== -1) {
        const newTasks = arrayMove(localTasks, oldIndex, newIndex);
        reorderTasksAndUpdatePriorities(newTasks);
      }
    }
  };

  const handleDelete = (taskId) => {
    if (onDeleteTask) {
      onDeleteTask(taskId);
    }
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
    return localTasks.reduce((sum, task) => sum + (task.duration || 30), 0);
  };

  const formatDuration = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins} min`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  };

  const activeTask = activeId ? localTasks.find((t) => String(t.id) === String(activeId)) : null;

  if (localTasks.length === 0) return null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
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

          {/* Transcript Accordion */}
          {transcript && (
            <div className="px-6 pt-4 border-b border-border">
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="transcript">
                  <AccordionTrigger>Transcript</AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2">
                      <Textarea
                        value={editedTranscript}
                        onChange={(e) => setEditedTranscript(e.target.value)}
                        className="min-h-[100px] text-sm"
                        placeholder="Edit transcript..."
                      />
                      {isTranscriptEdited && (
                        <Button
                          onClick={handleReprocess}
                          size="sm"
                          variant="outline"
                          className="w-full"
                        >
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Reprocess
                        </Button>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          )}

        {/* Task List - Fixed height container */}
        <div 
          className="p-4 overflow-y-auto flex-1" 
          style={{ minHeight: `${Math.min(localTasks.length * 100 + 16, 400)}px` }}
        >
            <SortableContext
              items={localTasks.map((t) => String(t.id))}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-3" id="queue-dropzone">
                {localTasks.map((task, index) => (
                  <SortableQueueItem
                  key={task.id}
                    task={task}
                    index={index}
                    totalTasks={localTasks.length}
                    editingId={editingId}
                    editTitle={editTitle}
                    setEditTitle={setEditTitle}
                    startEditing={startEditing}
                    saveEdit={saveEdit}
                    cancelEdit={cancelEdit}
                    handleDurationChange={handleDurationChange}
                    handleDateChange={handleDateChange}
                    handleDelete={handleDelete}
                    routing={taskRouting[task.id]}
                    onRoutingChange={handleRoutingChange}
                    onMoveUp={handleMoveUp}
                    onMoveDown={handleMoveDown}
                  />
                ))}
                  </div>
            </SortableContext>
                  </div>

        {/* Footer */}
        <div className="p-6 border-t border-border bg-card/50 flex-shrink-0 space-y-4">
          {/* Bulk Actions */}
                      <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Bulk actions:</span>
            <Button
              onClick={handleAllToInbox}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
            >
              All to Inbox
                        </Button>
            <Button
              onClick={handleAllToCalendar}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
            >
              All to Calendar
                      </Button>
                  <Button
              onClick={handleApplyDefaults}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
            >
              Apply defaults
                  </Button>
          </div>
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-muted-foreground">
              <span className="font-medium">{localTasks.length}</span> tasks · Total duration: <span className="font-medium">{formatDuration(getTotalDuration())}</span>
            </div>
            </div>
            <div className="flex gap-3">
            <Button
              onClick={async () => {
                const calendarTasks = localTasks.filter(t => (taskRouting[t.id] || "inbox") === "calendar");
                const inboxTasks = localTasks.filter(t => (taskRouting[t.id] || "inbox") === "inbox");
                
                // Save calendar tasks
                if (calendarTasks.length > 0 && onPushToCalendar) {
                  await onPushToCalendar(calendarTasks);
                }
                
                // Save inbox tasks
                if (inboxTasks.length > 0 && onPushToInbox) {
                  await onPushToInbox(inboxTasks);
                }
                
                // Close queue if all tasks saved
                if (calendarTasks.length + inboxTasks.length === localTasks.length) {
                  onClose();
                }
              }}
              className="flex-1"
              size="lg"
            >
              <Check className="w-4 h-4 mr-2" />
              Save All ({localTasks.filter(t => (taskRouting[t.id] || "inbox") === "calendar").length} calendar, {localTasks.filter(t => (taskRouting[t.id] || "inbox") === "inbox").length} inbox)
              </Button>
            <Button
              onClick={handleOpenTodayPlan}
              variant="outline"
              size="lg"
              className="gap-2"
            >
              <Lightbulb className="w-4 h-4" />
              Plan my day
              </Button>
          </div>
        </div>
      </div>

      {/* Drag Overlay */}
      <DragOverlay>
        {activeTask ? (
          <div className="opacity-90">
            <SortableQueueItem
              task={activeTask}
              index={localTasks.findIndex((t) => String(t.id) === String(activeId))}
              totalTasks={localTasks.length}
              editingId={null}
              editTitle=""
              setEditTitle={() => {}}
              startEditing={() => {}}
              saveEdit={() => {}}
              cancelEdit={() => {}}
              handleDurationChange={() => {}}
              handleDateChange={() => {}}
              handleDelete={() => {}}
              routing={taskRouting[activeTask.id]}
              onRoutingChange={() => {}}
              onMoveUp={null}
              onMoveDown={null}
              isDragging={true}
            />
          </div>
        ) : null}
      </DragOverlay>

      {/* Today Plan Modal */}
      {showTodayPlanModal && (
        <TodayPlanModal
          tasks={localTasks}
          taskRouting={taskRouting}
          onClose={() => setShowTodayPlanModal(false)}
          onAccept={handleAcceptPlan}
        />
      )}
    </div>
    </DndContext>
  );
}
