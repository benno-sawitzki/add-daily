import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ChevronLeft, ChevronRight, CheckCircle2, Trash2, Inbox } from "lucide-react";
import { format, addDays, subDays, isToday } from "date-fns";
import TaskEditDialog from "./TaskEditDialog";
import SortableTaskCard from "./SortableTaskCard";
import { getCalendarViewMode, setCalendarViewMode, generateTimeSlots, STORAGE_EVENT } from "@/utils/calendarSettings";
import {
  DndContext,
  closestCorners,
  DragOverlay,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import axios from "axios";
import { toast } from "sonner";
import { usePremiumSensors, premiumDropAnimation, dragOverlayStyles } from "@/utils/dndConfig";
import { debouncedPersistReorder } from "@/utils/reorderPersistence";
import { useCalendarDnD } from "@/hooks/useCalendarDnD";
import { 
  SLOT_HEIGHT, 
  formatTimeShort, 
  getEndTime,
  getTaskHeight,
  buildUpdatePayload 
} from "@/utils/calendarDnD";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Use inline style colors for dynamic priority coloring
const PRIORITY_STYLES = {
  4: { backgroundColor: "#f43f5e", color: "white" }, // rose-500
  3: { backgroundColor: "#f59e0b", color: "white" }, // amber-500
  2: { backgroundColor: "#6366f1", color: "white" }, // indigo-500
  1: { backgroundColor: "#64748b", color: "white" }, // slate-500
};

const PRIORITY_COLORS = {
  4: "bg-rose-500 text-white",
  3: "bg-amber-500 text-white",
  2: "bg-indigo-500 text-white",
  1: "bg-slate-500 text-white",
};

// Sortable task component for reordering within a time slot
function SortableTaskInSlot({ task, index, total, resizing, onTaskClick, onComplete, onDelete, onResizeStart, dateStr, onUpdateTask, onHTML5DragStart, onHTML5DragEnd }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ 
    id: task.id,
    disabled: resizing === task.id,
  });

  const priority = Number(task.priority) || 2;
  const clampedPriority = Math.max(1, Math.min(4, priority));
  const priorityStyle = PRIORITY_STYLES[clampedPriority] || PRIORITY_STYLES[2];
  const duration = task.duration || 30;
  const taskHeight = getTaskHeight(duration);
  const width = `calc((100% - 4px) / ${total})`;
  const left = `calc(2px + (100% - 4px) * ${index} / ${total})`;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    height: `${taskHeight}px`,
    top: '2px',
    width: width,
    left: left,
    position: 'absolute',
    ...priorityStyle,
  };

  // Handle HTML5 drag start for moving between time slots
  const handleDragStart = (e) => {
    if (resizing) {
      e.preventDefault();
      return false;
    }
    // Don't start HTML5 drag if clicking on resize handle
    if (e.target.closest('[data-resize-handle]')) {
      e.preventDefault();
      return false;
    }
    
    // Stop dnd-kit from handling this drag (we want HTML5 drag for moving between slots)
    e.stopPropagation();
    if (e.stopImmediatePropagation) {
      e.stopImmediatePropagation();
    }
    
    if (onHTML5DragStart) {
      onHTML5DragStart(e, task);
    }
    
    return true;
  };

  // We want HTML5 drag for moving between time slots (vertical movement)
  // dnd-kit listeners are for horizontal reordering within a slot
  // To avoid conflicts, we'll not spread listeners on the main element
  // Instead, we'll use HTML5 drag for the main drag functionality
  
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      draggable={!resizing}
      onDragStart={handleDragStart}
      onDragEnd={onHTML5DragEnd}
      onClick={(e) => onTaskClick(e, task)}
      className="group rounded font-medium cursor-grab active:cursor-grabbing z-10 select-none overflow-hidden"
    >
      <div className="p-2 h-full flex flex-col overflow-hidden pointer-events-auto">
        <div className="flex items-center justify-between overflow-hidden">
          <span className="truncate text-sm block flex-1 min-w-0 pointer-events-none">{task.title}</span>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 flex-shrink-0 ml-2" onMouseDown={(e) => e.stopPropagation()}>
            <button
              onClick={(e) => onComplete(e, task.id)}
              onMouseDown={(e) => e.stopPropagation()}
              className="p-1 hover:bg-white/30 rounded"
            >
              <CheckCircle2 className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => onDelete(e, task.id)}
              onMouseDown={(e) => e.stopPropagation()}
              className="p-1 hover:bg-white/30 rounded"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      
      {/* Resize handle */}
      <div
        data-resize-handle
        onMouseDown={(e) => onResizeStart(e, task)}
        className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize hover:bg-white/20 flex items-center justify-center pointer-events-auto"
        style={{ zIndex: 1 }}
      >
        <div className="w-12 h-1 rounded-full bg-white/40" />
      </div>
    </div>
  );
}

export default function DailyCalendar({ tasks, onUpdateTask, onDeleteTask, onRefreshTasks }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dropTarget, setDropTarget] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [viewMode, setViewMode] = useState(() => getCalendarViewMode()); // 'day' or '24h'
  const [activeId, setActiveId] = useState(null);
  const [slotTaskOrders, setSlotTaskOrders] = useState({}); // { timeSlot: [taskId1, taskId2, ...] }
  const [localInboxTasks, setLocalInboxTasks] = useState([]);
  const [isReordering, setIsReordering] = useState(false);
  const timeLineRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const previousOrdersKeyRef = useRef(null); // Track previous orders to prevent unnecessary updates

  const dateStr = format(currentDate, "yyyy-MM-dd");

  // Generate time slots based on view mode (memoized to prevent infinite loops)
  const TIME_SLOTS = useMemo(() => generateTimeSlots(viewMode), [viewMode]);

  // Use shared DnD hook for drag/resize
  const {
    draggingTask,
    dragPosition,
    cursorPosition,
    resizing,
    handleDragStart,
    handleDragEnd: handleDragEndShared,
    handleCalendarDragOver: handleDragOverShared,
    handleCalendarDrop: handleDropShared,
    handleResizeStart,
  } = useCalendarDnD({
    view: 'daily',
    onUpdateTask,
    timeSlots: TIME_SLOTS,
    viewMode,
    dateStr,
  });

  // Inbox droppable zone component (same as InboxSplitView)
  function InboxDropzone({ children, className = "" }) {
    const { setNodeRef, isOver } = useDroppable({
      id: "inbox-dropzone",
    });

    return (
      <div
        ref={setNodeRef}
        className={`min-h-[400px] ${className} ${isOver ? "bg-primary/5" : ""}`}
      >
        {children}
      </div>
    );
  }

  const sensors = usePremiumSensors();


  // Update current time every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // Listen for view mode changes from other components (e.g., WeeklyCalendar)
  useEffect(() => {
    const handleViewModeChange = (event) => {
      const newMode = event.detail.viewMode;
      setViewMode(newMode);
    };

    window.addEventListener(STORAGE_EVENT, handleViewModeChange);
    return () => {
      window.removeEventListener(STORAGE_EVENT, handleViewModeChange);
    };
  }, []);

  // Handle view mode change
  const handleViewModeChange = (checked) => {
    const newMode = checked ? '24h' : 'day';
    setViewMode(newMode);
    setCalendarViewMode(newMode);
  };

  // Auto-scroll to current time on mount (with 1 hour buffer)
  useEffect(() => {
    if (scrollContainerRef.current && isToday(currentDate)) {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMin = now.getMinutes();
      
      // Calculate scroll position: current time minus 1 hour buffer
      const bufferHours = 1;
      let targetHour = currentHour - bufferHours;
      let slotsFromTop;
      
      if (viewMode === 'day') {
        // Day view: clamp to 6am-10pm
        targetHour = Math.max(6, Math.min(22, targetHour));
        slotsFromTop = (targetHour - 6) * 2 + Math.floor(currentMin / 30);
      } else {
        // 24h view: allow any hour
        targetHour = Math.max(0, Math.min(23, targetHour));
        slotsFromTop = targetHour * 2 + Math.floor(currentMin / 30);
      }
      
      const scrollPosition = Math.max(0, slotsFromTop * SLOT_HEIGHT);
      
      scrollContainerRef.current.scrollTo({
        top: scrollPosition,
        behavior: "smooth"
      });
    }
  }, [currentDate, viewMode]);

  // Memoize dayTasks to prevent infinite loops
  const dayTasks = useMemo(() => {
    return tasks.filter(
    (t) => t.scheduled_date === dateStr && t.status === "scheduled"
  );
  }, [tasks, dateStr]);

  // Initialize slot orders from tasks
  useEffect(() => {
    const orders = {};
    const timeSlots = generateTimeSlots(viewMode); // Generate inside effect to avoid dependency on TIME_SLOTS
    
    timeSlots.forEach((time) => {
      const slotTasks = dayTasks.filter((t) => {
      if (!t.scheduled_time) return false;
        // Match exact time (HH:MM format)
        return t.scheduled_time.startsWith(time);
      });
      
      // Sort by scheduled_time, then by id for consistent ordering
      const sorted = [...slotTasks].sort((a, b) => {
        if (a.scheduled_time !== b.scheduled_time) {
          return a.scheduled_time.localeCompare(b.scheduled_time);
        }
        return a.id.localeCompare(b.id);
      });
      
      orders[time] = sorted.map((t) => t.id);
    });
    
    // Only update if the orders actually changed (compare JSON strings)
    const newOrdersKey = JSON.stringify(orders);
    
    if (newOrdersKey !== previousOrdersKeyRef.current) {
      previousOrdersKeyRef.current = newOrdersKey;
      setSlotTaskOrders(orders);
    }
  }, [dayTasks, viewMode]); // dayTasks is memoized, so this should be stable

  // Memoize filtered tasks to prevent unnecessary recalculations
  const completedTasks = useMemo(() => {
    return tasks.filter(
      (t) => t.scheduled_date === dateStr && t.status === "completed"
    );
  }, [tasks, dateStr]);

  const inboxTasks = useMemo(() => {
    return tasks.filter((t) => t.status === "inbox");
  }, [tasks]);

  // Update local inbox tasks when props change (but not during reordering)
  // Only reconcile if server order differs AND we can do it without visible jumping
  useEffect(() => {
    if (!isReordering) {
      // Check if the order actually changed to avoid unnecessary updates
      const currentIds = localInboxTasks.map(t => t.id).join(',');
      const newIds = inboxTasks.map(t => t.id).join(',');
      
      // Only update if IDs differ (new tasks added/removed) or if order changed significantly
      if (currentIds !== newIds) {
        // Check if it's just a reorder of the same tasks (avoid double-apply)
        const currentIdSet = new Set(localInboxTasks.map(t => t.id));
        const newIdSet = new Set(inboxTasks.map(t => t.id));
        const idsMatch = currentIdSet.size === newIdSet.size && 
                        [...currentIdSet].every(id => newIdSet.has(id));
        
        if (idsMatch) {
          // Same tasks, just reordered - only update if priorities changed
          // This prevents double-apply of reorder
          const prioritiesChanged = localInboxTasks.some((task, idx) => {
            const newTask = inboxTasks.find(t => t.id === task.id);
            return newTask && newTask.priority !== task.priority;
          });
          
          if (prioritiesChanged) {
            setLocalInboxTasks(inboxTasks);
          }
        } else {
          // Different tasks (added/removed) - always update
          setLocalInboxTasks(inboxTasks);
        }
      }
    }
  }, [inboxTasks, isReordering, localInboxTasks]);

  // Memoize getTasksForSlot to prevent recreation on every render
  const getTasksForSlot = useCallback((time) => {
    const slotTaskIds = slotTaskOrders[time] || [];
    // Return tasks in the order specified by slotTaskOrders
    return slotTaskIds
      .map((id) => dayTasks.find((t) => t.id === id))
      .filter(Boolean);
  }, [dayTasks, slotTaskOrders]);

  // Calculate position for overlapping tasks - memoize to prevent recreation
  const getTaskPosition = useCallback((task, slotTasks = null) => {
    const tasksInSlot = slotTasks || getTasksForSlot(task.scheduled_time?.substring(0, 5) || '');
    const index = tasksInSlot.findIndex((t) => t.id === task.id);
    const total = tasksInSlot.length;
    return { index: index >= 0 ? index : 0, total: total || 1 };
  }, [getTasksForSlot]);

  // Calculate current time position
  const getCurrentTimePosition = () => {
    const hours = currentTime.getHours();
    const minutes = currentTime.getMinutes();
    
    // Check if current time is within visible range
    if (viewMode === 'day' && (hours < 6 || hours > 22)) return null;
    
    let slotIndex;
    if (viewMode === 'day') {
      slotIndex = (hours - 6) * 2 + (minutes >= 30 ? 1 : 0);
    } else {
      slotIndex = hours * 2 + (minutes >= 30 ? 1 : 0);
    }
    
    const minuteOffset = (minutes % 30) / 30 * SLOT_HEIGHT;
    return slotIndex * SLOT_HEIGHT + minuteOffset;
  };

  // Helper function to reorder tasks and update priorities with optimistic updates
  const reorderTasksAndUpdatePriorities = (newTasks) => {
    // Prevent useEffect from resetting local state during reorder
    setIsReordering(true);
    
    // Save original order and priorities before making changes (for error recovery)
    const originalOrder = [...localInboxTasks];
    const originalPriorities = new Map(originalOrder.map(t => [t.id, t.priority]));
    
    // OPTIMISTIC UPDATE: Update local state immediately
    setLocalInboxTasks(newTasks);

    // Calculate what priorities should be based on new position
    const priorityUpdates = [];
    newTasks.forEach((task, idx) => {
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
      
      const originalPriority = originalPriorities.get(task.id);
      if (originalPriority !== newPriority) {
        priorityUpdates.push({ taskId: task.id, originalPriority, newPriority });
      }
    });

    // Update priorities optimistically in local state
    if (priorityUpdates.length > 0) {
      setLocalInboxTasks(prev => prev.map(task => {
        const update = priorityUpdates.find(u => u.taskId === task.id);
        return update ? { ...task, priority: update.newPriority } : task;
      }));
    }

    // DEBOUNCED PERSISTENCE: Persist to backend in background (debounced)
    if (priorityUpdates.length > 0) {
      debouncedPersistReorder(
        'daily-calendar-inbox',
        async () => {
          // Update priorities directly via API
          await Promise.all(
            priorityUpdates.map(({ taskId, newPriority }) =>
              axios.patch(`${API}/tasks/${taskId}`, { priority: newPriority }).catch((error) => {
                console.error(`Failed to update priority for task ${taskId}:`, error);
                throw error;
              })
            )
          );
          
          // Sync with server (but don't overwrite optimistic state if it matches)
          if (onRefreshTasks) {
            await onRefreshTasks();
          }
          
          // Allow useEffect to sync with props again
          setIsReordering(false);
        },
        (error) => {
          // On error: revert to original order and priorities
          const restoredTasks = originalOrder.map(task => ({
            ...task,
            priority: originalPriorities.get(task.id) ?? task.priority
          }));
          setLocalInboxTasks(restoredTasks);
          setIsReordering(false);
          
          console.error("Failed to update task priorities:", error);
          toast.error("Failed to save task order");
        }
      );
    } else {
      // No priority updates needed, just allow sync
      setIsReordering(false);
    }
  };

  const handleMoveUp = (taskId) => {
    const currentIndex = localInboxTasks.findIndex((t) => String(t.id) === String(taskId));
    if (currentIndex <= 0) return; // Already at top or not found

    const newTasks = arrayMove(localInboxTasks, currentIndex, currentIndex - 1);
    reorderTasksAndUpdatePriorities(newTasks);
  };

  const handleMoveDown = (taskId) => {
    const currentIndex = localInboxTasks.findIndex((t) => String(t.id) === String(taskId));
    if (currentIndex < 0 || currentIndex >= localInboxTasks.length - 1) return; // Already at bottom or not found

    const newTasks = arrayMove(localInboxTasks, currentIndex, currentIndex + 1);
    reorderTasksAndUpdatePriorities(newTasks);
  };

  // dnd-kit handler for reordering within time slot or inbox
  const handleDragEnd = async (event) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) {
      return;
    }

    const activeId = String(active.id);
    const overId = String(over.id);

    // Check if this is an inbox task being reordered (same logic as InboxSplitView)
    const activeInboxTask = localInboxTasks.find((t) => String(t.id) === activeId);
    const overInboxTask = localInboxTasks.find((t) => String(t.id) === overId);
    
    if (activeInboxTask && (overInboxTask || overId === "inbox-dropzone")) {
      // Reordering within inbox
      const oldIndex = localInboxTasks.findIndex((t) => String(t.id) === activeId);
      let newIndex;

      if (overId === "inbox-dropzone") {
        // Dropped on inbox zone itself, move to top
        newIndex = 0;
      } else {
        // Dropped on another task
        const overIndex = localInboxTasks.findIndex((t) => String(t.id) === overId);
        // If we couldn't find the target task, don't move
        if (overIndex === -1) {
          console.warn(`Could not find target task with id: ${overId}`);
          return;
        }
        
        // Correct index calculation for arrayMove
        // arrayMove(array, fromIndex, toIndex) removes item at fromIndex, then inserts at toIndex
        // The overIndex from dnd-kit is already the correct final position we want
        // Use overIndex directly (no adjustment needed)
        newIndex = overIndex;
      }

      // Only proceed if we have a valid new position
      if (oldIndex !== newIndex && newIndex >= 0 && newIndex <= localInboxTasks.length) {
        const newTasks = arrayMove(localInboxTasks, oldIndex, newIndex);
        reorderTasksAndUpdatePriorities(newTasks);
      }
      return;
    }

    // Find which time slot this task belongs to
    const activeTask = dayTasks.find((t) => String(t.id) === activeId);
    if (!activeTask || !activeTask.scheduled_time) return;

    const timeSlot = activeTask.scheduled_time.substring(0, 5); // Get HH:MM
    const currentOrder = slotTaskOrders[timeSlot] || [];
    const oldIndex = currentOrder.findIndex((id) => String(id) === activeId);
    const newIndex = currentOrder.findIndex((id) => String(id) === overId);

    // Only handle reordering if both tasks are in the same slot
    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      // Reorder in state
      const newOrder = arrayMove(currentOrder, oldIndex, newIndex);
      setSlotTaskOrders((prev) => ({
        ...prev,
        [timeSlot]: newOrder,
      }));

      // Update tasks via API - adjust scheduled_time slightly to maintain order
      try {
        const updates = newOrder.map((taskId, idx) => {
          const task = dayTasks.find((t) => t.id === taskId);
          if (!task || !task.scheduled_time) return null;
          
          // Extract base time (HH:MM)
          const baseTime = task.scheduled_time.substring(0, 5);
          // Add small offset based on position (0.1 minutes per position)
          const [hours, minutes] = baseTime.split(":").map(Number);
          const totalMinutes = hours * 60 + minutes + idx * 0.1;
          const newHours = Math.floor(totalMinutes / 60);
          const newMins = Math.floor(totalMinutes % 60);
          const newSecs = Math.floor((totalMinutes % 1) * 60);
          const newTime = `${String(newHours).padStart(2, '0')}:${String(newMins).padStart(2, '0')}:${String(newSecs).padStart(2, '0')}`;
          
          return onUpdateTask(taskId, { scheduled_time: newTime });
        });
        await Promise.all(updates.filter(Boolean));
      } catch (error) {
        console.error("Error reordering tasks:", error);
        // Revert on error
        setSlotTaskOrders((prev) => ({
          ...prev,
          [timeSlot]: currentOrder,
        }));
      }
    }
  };

  // HTML5 drag handlers for moving between time slots (use shared hook)
  const handleHTML5DragStart = (e, task) => {
    if (resizing) return;
    // Don't start drag if clicking on resize handle
    if (e.target.closest('[data-resize-handle]')) {
      return;
    }
    handleDragStart(e, task);
    // Prevent text selection during drag
    e.dataTransfer.setData("text/plain", ""); // Required for Firefox
  };

  const handleHTML5DragEnd = () => {
    handleDragEndShared();
    setDropTarget(null);
  };

  const handleDragOver = (e, time) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(time);
    // Use shared handler but also track drop target for visual feedback
    if (scrollContainerRef.current) {
      handleDragOverShared(e, scrollContainerRef);
    }
  };

  const handleDragLeave = () => {
    setDropTarget(null);
  };

  const handleDrop = (e, time) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("taskId");
    
    if (taskId && time) {
      // Use shared buildUpdatePayload to ensure consistent format
      const payload = buildUpdatePayload(dateStr, time);
      onUpdateTask(taskId, payload);
    }
    
    handleDragEndShared();
    setDropTarget(null);
  };

  const handleComplete = (e, taskId) => {
    e.stopPropagation();
    e.preventDefault();
    onUpdateTask(taskId, { status: "completed" });
  };

  const handleDelete = (e, taskId) => {
    e.stopPropagation();
    e.preventDefault();
    onDeleteTask(taskId);
  };

  const handleTaskClick = (e, task) => {
    // Don't open edit if we just finished resizing
    if (resizing) return;
    e.stopPropagation();
    setEditingTask(task);
  };

  // Resize handlers use shared hook (handleResizeStart from useCalendarDnD)

  const timePosition = isToday(currentDate) ? getCurrentTimePosition() : null;

  const handleScheduleTask = (taskId, date, time) => {
    // Use shared buildUpdatePayload for consistency
    const payload = buildUpdatePayload(date, time);
    onUpdateTask(taskId, payload);
  };

  const handleCompleteTask = (taskId) => {
    onUpdateTask(taskId, { status: "completed" });
  };

  // Get active task for DragOverlay (only show for inbox tasks when dragging within inbox)
  const activeTask = activeId
    ? localInboxTasks.find((t) => String(t.id) === String(activeId))
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(event) => {
        setActiveId(event.active.id);
      }}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
    <div className="space-y-4" data-testid="daily-calendar">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Daily View</h2>
          <div className="flex items-center gap-4">
            {/* View Mode Toggle */}
            <div className="flex items-center gap-2">
              <Label htmlFor="view-mode-toggle-daily" className="text-sm text-muted-foreground cursor-pointer">
                {viewMode === '24h' ? '24h' : '6am-10pm'}
              </Label>
              <Switch
                id="view-mode-toggle-daily"
                checked={viewMode === '24h'}
                onCheckedChange={handleViewModeChange}
              />
            </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCurrentDate(subDays(currentDate, 1))}
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <span className="text-sm font-medium min-w-[200px] text-center">
            {format(currentDate, "EEEE, MMMM d, yyyy")}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCurrentDate(addDays(currentDate, 1))}
          >
            <ChevronRight className="w-5 h-5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentDate(new Date())}
            className="ml-2"
          >
            Today
          </Button>
            </div>
        </div>
      </div>

      {/* Today indicator */}
      {isToday(currentDate) && (
          <div className="flex items-center gap-2 px-4 py-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg mb-4">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></div>
          <span className="text-sm text-cyan-400 font-medium">
            Today · {format(currentTime, "h:mm a")}
          </span>
        </div>
      )}

        {/* Two Column Layout */}
        <div className="grid grid-cols-12 gap-6">
          {/* Left Column: Calendar */}
          <div className="col-span-12 lg:col-span-7 space-y-4">
      {/* Time Grid */}
      <div className="border border-border/30 rounded-xl overflow-hidden bg-card/20">
        <div ref={scrollContainerRef} className="max-h-[500px] overflow-y-auto relative">
          {/* Current time line */}
          {timePosition !== null && (
            <div
              ref={timeLineRef}
              className="absolute left-0 right-0 z-20 pointer-events-none"
              style={{ top: `${timePosition}px` }}
            >
              <div className="flex items-center">
                <div className="w-16 flex justify-end pr-2">
                  <span className="text-xs font-bold text-cyan-400 bg-cyan-500/20 px-1.5 py-0.5 rounded">
                    {format(currentTime, "h:mm")}
                  </span>
                </div>
                <div className="flex-1 flex items-center">
                  <div className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)]"></div>
                  <div className="flex-1 h-0.5 bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.6)]"></div>
                </div>
              </div>
            </div>
          )}

          {TIME_SLOTS.map((time) => {
            const isHourMark = time.endsWith(":00");
            const [hours] = time.split(":").map(Number);
            const slotTasks = getTasksForSlot(time);
            const isDropHere = dropTarget === time;
                  const taskIds = slotTasks.map((t) => t.id);

            return (
              <div
                key={time}
                className={`grid grid-cols-[70px_1fr] ${isHourMark ? "border-t border-border/40" : ""}`}
                style={{ height: `${SLOT_HEIGHT}px` }}
              >
                {/* Time Label */}
                <div className="py-2 px-2 text-right border-r border-border/20">
                  {isHourMark && (
                    <span className="text-xs font-medium text-muted-foreground">
                      {format(new Date().setHours(hours, 0), "h:mm a")}
                    </span>
                  )}
                </div>

                {/* Time Slot */}
                      <SortableContext
                        items={taskIds}
                        strategy={horizontalListSortingStrategy}
                      >
                <div
                  onDragOver={(e) => handleDragOver(e, time)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, time)}
                  className={`relative border-b border-border/10 p-0.5
                    ${isDropHere ? "bg-primary/30 ring-2 ring-inset ring-primary" : ""}
                  `}
                  style={{ height: `${SLOT_HEIGHT}px` }}
                >
                          {slotTasks.map((task, index) => {
                            const { total } = getTaskPosition(task, slotTasks);
                    return (
                              <SortableTaskInSlot
                                key={task.id}
                                task={task}
                                index={index}
                                total={total}
                                resizing={resizing}
                                onTaskClick={handleTaskClick}
                                onComplete={handleComplete}
                                onDelete={handleDelete}
                                onResizeStart={handleResizeStart}
                                dateStr={dateStr}
                                onUpdateTask={onUpdateTask}
                                onHTML5DragStart={handleHTML5DragStart}
                                onHTML5DragEnd={handleHTML5DragEnd}
                              />
                    );
                  })}
                </div>
                      </SortableContext>
              </div>
            );
          })}
        </div>
      </div>

      {/* Completed tasks */}
      {completedTasks.length > 0 && (
              <div>
          <h3 className="text-lg font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            Completed ({completedTasks.length})
          </h3>
          <div className="space-y-2">
            {completedTasks.map((task) => (
              <div
                key={task.id}
                className="p-3 rounded-lg bg-card/30 opacity-60 line-through text-sm"
              >
                {task.title}
              </div>
            ))}
          </div>
        </div>
      )}
          </div>

          {/* Right Column: Inbox */}
          <div className="col-span-12 lg:col-span-5">
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-2xl font-semibold flex items-center gap-2">
                  <Inbox className="w-6 h-6" />
                  Inbox
                </h2>
                <p className="text-muted-foreground">
                  {inboxTasks.length} {inboxTasks.length === 1 ? "task" : "tasks"}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                Your unscheduled tasks
              </p>
            </div>

            <InboxDropzone>
              <SortableContext
                items={localInboxTasks.map((t) => String(t.id))}
                strategy={verticalListSortingStrategy}
              >
                {localInboxTasks.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-lg">
                    <Inbox className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No inbox tasks</p>
                  </div>
                ) : (
                  localInboxTasks.map((task, index) => (
                    <SortableTaskCard
                      key={task.id}
                      task={task}
                      index={index}
                      totalTasks={localInboxTasks.length}
                      onUpdateTask={onUpdateTask}
                      onDeleteTask={onDeleteTask}
                      onScheduleTask={handleScheduleTask}
                      onCompleteTask={handleCompleteTask}
                      onMakeNext={null}
                      onMoveToInbox={null}
                      onMoveUp={handleMoveUp}
                      onMoveDown={handleMoveDown}
                      onClick={() => setEditingTask(task)}
                      enableHTML5Drag={false}
                    />
                  ))
                )}
              </SortableContext>
            </InboxDropzone>
          </div>
        </div>

      {/* Edit Dialog */}
      <TaskEditDialog
        task={editingTask}
        open={!!editingTask}
        onOpenChange={(open) => !open && setEditingTask(null)}
        onSave={onUpdateTask}
        onDelete={onDeleteTask}
      />

        {/* Drag Overlay with premium styling */}
        <DragOverlay dropAnimation={premiumDropAnimation}>
          {activeTask ? (
            <div style={dragOverlayStyles}>
              <SortableTaskCard
                task={activeTask}
                index={localInboxTasks.findIndex((t) => String(t.id) === String(activeId))}
                totalTasks={localInboxTasks.length}
                onUpdateTask={onUpdateTask}
                onDeleteTask={onDeleteTask}
                onScheduleTask={handleScheduleTask}
                onCompleteTask={handleCompleteTask}
                onMakeNext={null}
                onMoveToInbox={null}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
                onClick={() => {}}
                isDragging={true}
              />
            </div>
          ) : null}
        </DragOverlay>
    </div>
    </DndContext>
  );
}
