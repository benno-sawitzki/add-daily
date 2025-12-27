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
function SortableTaskInSlot({ task, index, total, resizing, resizePreviewDuration, onTaskClick, onComplete, onDelete, onResizeStart, dateStr, onUpdateTask, activeId }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ 
    id: String(task.id),
    disabled: resizing === task.id, // Disable only when resizing this specific task
  });

  const priority = Number(task.priority) || 2;
  const clampedPriority = Math.max(1, Math.min(4, priority));
  const priorityStyle = PRIORITY_STYLES[clampedPriority] || PRIORITY_STYLES[2];
  const isResizingThis = resizing === task.id;
  const duration = isResizingThis && resizePreviewDuration !== null ? resizePreviewDuration : (task.duration || 30);
  const taskHeight = getTaskHeight(duration);
  const width = `calc((100% - 4px) / ${total})`;
  const left = `calc(2px + (100% - 4px) * ${index} / ${total})`;

  // Calculate end time for display
  const getEndTimeDisplay = () => {
    if (!task.scheduled_time) return '';
    const [hours, mins] = task.scheduled_time.split(':').map(Number);
    const totalMinutes = hours * 60 + mins + duration;
    const endHours = Math.floor(totalMinutes / 60);
    const endMins = totalMinutes % 60;
    return `${endHours}:${endMins.toString().padStart(2, '0')}`;
  };

  const formatDuration = (mins) => {
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const minutes = mins % 60;
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  };

  // Check if this task is currently being dragged
  const isBeingDragged = activeId === String(task.id);
  
  const style = {
    transform: isBeingDragged 
      ? 'translateX(-9999px)' // Move off-screen when dragging to prevent blocking indicator
      : CSS.Transform.toString(transform),
    transition: isResizingThis ? 'none' : transition, // Disable transition while resizing for smooth preview
    opacity: isBeingDragged ? 0 : 1, // Completely hide original task when dragging - DragOverlay shows what's being dragged
    height: `${taskHeight}px`,
    top: '2px',
    width: width,
    left: left,
    position: 'absolute',
    zIndex: isBeingDragged ? 0 : 10, // Lower z-index when dragging so indicator is visible
    pointerEvents: isBeingDragged ? 'none' : 'auto', // Disable pointer events when hidden
    ...priorityStyle,
  };

  const isActivated = isBeingDragged && isDragging;
  
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // Don't open edit if we just finished resizing or if dragging
        if (resizing || isDragging) return;
        onTaskClick(e, task);
      }}
      className="group rounded font-medium select-none overflow-visible cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-primary/50 hover:shadow-md transition-all"
      title="Drag to move to another time slot"
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

      {/* Resize preview tooltip */}
      {isResizingThis && resizePreviewDuration !== null && (
        <div 
          className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-full mb-1 px-2 py-1 bg-black/80 text-white text-xs rounded shadow-lg whitespace-nowrap z-50 pointer-events-none"
          style={{ zIndex: 100 }}
        >
          {formatDuration(resizePreviewDuration)}
          {task.scheduled_time && (
            <span className="ml-2 text-white/70">
              {task.scheduled_time.substring(0, 5)} - {getEndTimeDisplay()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function DailyCalendar({ tasks, onUpdateTask, onDeleteTask, onRefreshTasks }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [editingTask, setEditingTask] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [viewMode, setViewMode] = useState(() => getCalendarViewMode()); // 'day' or '24h'
  const [activeId, setActiveId] = useState(null);
  const [overId, setOverId] = useState(null); // Track what we're dragging over for visual feedback
  const overIdRef = useRef(null); // Use ref to prevent infinite loops from frequent updates
  const isDraggingRef = useRef(false); // Track if we're currently dragging to prevent useEffect loops

  // Update editingTask when the task in tasks array changes (e.g., after update)
  useEffect(() => {
    if (editingTask) {
      const updatedTask = tasks.find(t => t.id === editingTask.id);
      if (updatedTask) {
        setEditingTask(updatedTask);
      }
    }
  }, [tasks, editingTask?.id]);
  const [slotTaskOrders, setSlotTaskOrders] = useState({}); // { timeSlot: [taskId1, taskId2, ...] }
  const [localInboxTasks, setLocalInboxTasks] = useState([]);
  const [isReordering, setIsReordering] = useState(false);
  const timeLineRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const previousOrdersKeyRef = useRef(null); // Track previous orders to prevent unnecessary updates
  const prevInboxTasksRef = useRef([]); // Track previous inboxTasks to prevent infinite loops
  const lastProcessedInboxTasksRef = useRef(null); // Track the last inboxTasks array reference we processed

  const dateStr = format(currentDate, "yyyy-MM-dd");

  // Generate time slots based on view mode (memoized to prevent infinite loops)
  const TIME_SLOTS = useMemo(() => generateTimeSlots(viewMode), [viewMode]);

  // Use shared DnD hook only for resize functionality
  const {
    resizing,
    resizePreviewDuration,
    handleResizeStart,
  } = useCalendarDnD({
    view: 'daily',
    onUpdateTask,
    timeSlots: TIME_SLOTS,
    viewMode,
    dateStr,
  });

  // Calendar slot droppable component for dragging inbox tasks to calendar
  function CalendarSlotDroppable({ time, dateStr, children, className, style }) {
    const { setNodeRef, isOver } = useDroppable({
      id: `calendar-slot-${dateStr}-${time}`,
      data: {
        type: 'calendar-slot',
        time,
        dateStr,
      },
    });

    return (
      <div
        ref={setNodeRef}
        className={`${className} relative`}
        style={style}
      >
        {/* Drop indicator line - appears above tasks when dragging */}
        {isOver && (
          <div
            className="absolute top-0 left-0 right-0 h-1 bg-primary pointer-events-none"
            style={{
              zIndex: 100, // Higher z-index to appear above all tasks
              boxShadow: '0 0 12px rgba(var(--primary), 0.8), 0 2px 4px rgba(var(--primary), 0.4)',
            }}
          />
        )}
        {/* Background highlight when dragging over */}
        {isOver && (
          <div className="absolute inset-0 bg-primary/10 pointer-events-none" style={{ zIndex: 0 }} />
        )}
        <div className="relative" style={{ zIndex: 10 }}>
          {children}
        </div>
      </div>
    );
  }

  // Inbox droppable zone component (same as InboxSplitView)
  function InboxDropzone({ children, className = "", activeId, dayTasks, overIdRef, localInboxTasks }) {
    const { setNodeRef, isOver } = useDroppable({
      id: "inbox-dropzone",
    });
    
    // Check if a calendar task is being dragged over the inbox
    // A calendar task is one that has scheduled_date and status === "scheduled"
    const activeTask = activeId ? dayTasks.find((t) => String(t.id) === String(activeId)) : null;
    const isCalendarTaskDragging = activeTask && activeTask.status === "scheduled" && activeTask.scheduled_date;
    const showDropFeedback = isOver && isCalendarTaskDragging;
    
    // Read from ref instead of state to avoid re-renders
    const currentOverId = overIdRef?.current || null;
    
    // Calculate insertion index for visual feedback
    let insertionIndex = null;
    if (isCalendarTaskDragging && currentOverId) {
      if (currentOverId === "inbox-dropzone") {
        insertionIndex = 0; // Insert at top
      } else {
        const overTaskIndex = localInboxTasks.findIndex((t) => String(t.id) === currentOverId);
        if (overTaskIndex !== -1) {
          insertionIndex = overTaskIndex;
        }
      }
    }

    return (
      <div
        ref={setNodeRef}
        className={`min-h-[400px] ${className} transition-all duration-200 relative ${
          showDropFeedback 
            ? "ring-4 ring-primary ring-offset-2 ring-offset-background rounded-lg bg-primary/15 border-2 border-primary shadow-lg shadow-primary/20" 
            : isOver 
              ? "ring-2 ring-primary/50 ring-offset-2 ring-offset-background rounded-lg bg-primary/5" 
              : ""
        }`}
        style={showDropFeedback ? {
          animation: 'breathe 3s ease-in-out infinite',
          transform: 'scale(1.01)',
        } : {}}
      >
        {/* Visual insertion indicator line */}
        {insertionIndex !== null && (
          <div
            className="absolute left-0 right-0 h-0.5 bg-primary z-30 pointer-events-none"
            style={{
              top: insertionIndex === 0 ? '0px' : `${insertionIndex * 100}px`, // Approximate task height (100px per task)
              boxShadow: '0 0 8px rgba(var(--primary), 0.6)',
            }}
          />
        )}
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

  // Update local inbox tasks when props change (but not during reordering or dragging)
  // Only reconcile if server order differs AND we can do it without visible jumping
  useEffect(() => {
    // AGGRESSIVE: Skip if reordering, dragging, or if activeId/overId is set (any drag operation)
    // Use refs to check drag state to avoid reading state during render
    if (isReordering || isDraggingRef.current) {
      return;
    }
    
    // Also check state values (but these shouldn't trigger the effect since they're not in deps)
    // This is a safety check in case the effect runs for other reasons
    if (activeId || overId) {
      return;
    }
    
    // Skip if this is the same array reference we already processed
    if (lastProcessedInboxTasksRef.current === inboxTasks) {
      return;
    }
    
    // Prevent infinite loops by checking if inboxTasks actually changed
    // Compare by creating a stable string representation
    const createTaskKey = (t) => `${t.id}-${t.priority}-${t.urgency}-${t.importance}-${t.energy_required || ''}-${t.duration}-${t.status}-${t.title}`;
    const prevTasksKey = prevInboxTasksRef.current.map(createTaskKey).join('|');
    const newTasksKey = inboxTasks.map(createTaskKey).join('|');
    
    if (prevTasksKey === newTasksKey) {
      // No actual changes, but mark as processed to skip future checks
      lastProcessedInboxTasksRef.current = inboxTasks;
      return;
    }
    
    // Update refs first to prevent re-triggering
    prevInboxTasksRef.current = inboxTasks;
    lastProcessedInboxTasksRef.current = inboxTasks;
    
    // Only update local state if tasks actually changed
    setLocalInboxTasks(inboxTasks);
  }, [inboxTasks, isReordering]); // Only depend on inboxTasks and isReordering

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

  // Memoize calendar task dragging check to prevent recalculation on every render
  const isCalendarTaskDragging = useMemo(() => {
    return activeId && dayTasks.some((t) => String(t.id) === String(activeId));
  }, [activeId, dayTasks]);

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
    
    // Reset drag state FIRST using refs to prevent useEffect from running
    isDraggingRef.current = false;
    overIdRef.current = null;
    
    // Use setTimeout to defer state updates and prevent immediate re-renders
    setTimeout(() => {
      setActiveId(null);
      setOverId(null);
    }, 0);

    if (!over) {
      return;
    }

    const activeId = String(active.id);
    const overId = String(over.id);

    // Check if dropping on a calendar slot (from inbox)
    if (over.data?.current?.type === 'calendar-slot') {
      const { time, dateStr } = over.data.current;
      const activeInboxTask = localInboxTasks.find((t) => String(t.id) === activeId);
      
      if (activeInboxTask) {
        // Schedule the task to this calendar slot
        const payload = buildUpdatePayload(dateStr, time);
        onUpdateTask(activeId, payload);
        return;
      }
    }

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

    // Handle calendar task movement (between slots or reordering within slot)
    const activeCalendarTask = dayTasks.find((t) => String(t.id) === activeId);
    
    if (activeCalendarTask) {
      // Check if dropping calendar task back to inbox
      // Can drop on inbox-dropzone OR on any inbox task (which means dropping in inbox)
      const overInboxTask = localInboxTasks.find((t) => String(t.id) === overId);
      if (overId === "inbox-dropzone" || overInboxTask) {
        // Move task back to inbox
        onUpdateTask(activeId, {
          scheduled_date: null,
          scheduled_time: null,
          status: "inbox",
        });
        return;
      }
      
      // Check if dropping on a calendar slot (moving to different time)
      if (over.data?.current?.type === 'calendar-slot') {
        const { time, dateStr } = over.data.current;
        const currentTime = activeCalendarTask.scheduled_time?.substring(0, 5);
        
        // Only update if moving to a different time slot
        if (currentTime !== time) {
          const payload = buildUpdatePayload(dateStr, time);
          onUpdateTask(activeId, payload);
        }
        return;
      }
      
      // Check if reordering within the same slot (dropped on another task in same slot)
      const overTask = dayTasks.find((t) => String(t.id) === overId);
      if (overTask && overTask.scheduled_time) {
        const activeTimeSlot = activeCalendarTask.scheduled_time?.substring(0, 5);
        const overTimeSlot = overTask.scheduled_time.substring(0, 5);
        
        // Same slot - reorder horizontally
        if (activeTimeSlot === overTimeSlot) {
          const currentOrder = slotTaskOrders[activeTimeSlot] || dayTasks
            .filter(t => t.scheduled_time?.substring(0, 5) === activeTimeSlot)
            .map(t => t.id);
          
          const oldIndex = currentOrder.findIndex((id) => String(id) === activeId);
          const newIndex = currentOrder.findIndex((id) => String(id) === overId);
          
          if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
            const newOrder = arrayMove(currentOrder, oldIndex, newIndex);
            setSlotTaskOrders((prev) => ({
              ...prev,
              [activeTimeSlot]: newOrder,
            }));

            // Update tasks via API - adjust scheduled_time slightly to maintain order
            try {
              const updates = newOrder.map((taskId, idx) => {
                const task = dayTasks.find((t) => t.id === taskId);
                if (!task || !task.scheduled_time) return null;
                
                const baseTime = task.scheduled_time.substring(0, 5);
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
              setSlotTaskOrders((prev) => ({
                ...prev,
                [activeTimeSlot]: currentOrder,
              }));
            }
          }
          return;
        }
      }
    }
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

  // Get active task for DragOverlay (inbox or calendar tasks)
  const activeTask = activeId
    ? localInboxTasks.find((t) => String(t.id) === String(activeId)) ||
      dayTasks.find((t) => String(t.id) === String(activeId))
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(event) => {
        setActiveId(event.active.id);
        isDraggingRef.current = true; // Mark that we're dragging
      }}
      onDragOver={(event) => {
        // Track what we're dragging over for visual feedback
        // ONLY update ref, NOT state - this prevents re-renders that cause infinite loops
        if (event.over) {
          overIdRef.current = String(event.over.id);
          // Don't call setOverId - we'll read from ref in components that need it
        }
      }}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        overIdRef.current = null;
        setOverId(null);
        isDraggingRef.current = false; // Mark that dragging was cancelled
      }}
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
        <div 
          ref={scrollContainerRef} 
          className="max-h-[500px] overflow-y-auto relative"
        >

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
                <CalendarSlotDroppable
                  time={time}
                  dateStr={dateStr}
                  className="relative border-b border-border/10 p-0.5"
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
                                resizePreviewDuration={resizePreviewDuration}
                                onTaskClick={handleTaskClick}
                                onComplete={handleComplete}
                                onDelete={handleDelete}
                                onResizeStart={handleResizeStart}
                                dateStr={dateStr}
                                onUpdateTask={onUpdateTask}
                                activeId={activeId}
                              />
                    );
                  })}
                </CalendarSlotDroppable>
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

            <InboxDropzone activeId={activeId} dayTasks={dayTasks} overIdRef={overIdRef} localInboxTasks={localInboxTasks}>
              <SortableContext
                items={localInboxTasks.map((t) => String(t.id))}
                strategy={verticalListSortingStrategy}
              >
                <div className="relative">
                  {localInboxTasks.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-lg">
                      <Inbox className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>No inbox tasks</p>
                    </div>
                  ) : (
                    <>
                      {/* Insertion indicator at top when dragging calendar task over dropzone */}
                      {overIdRef.current === "inbox-dropzone" && isCalendarTaskDragging && (
                        <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary z-30 pointer-events-none" style={{
                          boxShadow: '0 0 8px rgba(var(--primary), 0.6)',
                        }} />
                      )}
                      {localInboxTasks.map((task, index) => {
                        // Check if calendar task is being dragged over this inbox task
                        // Read from ref to avoid re-renders
                        const isOverThisTask = overIdRef.current === String(task.id) && isCalendarTaskDragging;
                        
                        return (
                          <div key={task.id} className="relative">
                            {/* Insertion indicator above this task */}
                            {isOverThisTask && (
                              <div className="absolute -top-1 left-0 right-0 h-0.5 bg-primary z-30 pointer-events-none" style={{
                                boxShadow: '0 0 8px rgba(var(--primary), 0.6)',
                              }} />
                            )}
                            <div style={{
                              transform: isOverThisTask ? 'translateY(4px)' : 'translateY(0)',
                              transition: 'transform 0.2s ease',
                            }}>
                              <SortableTaskCard
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
                                activeId={activeId}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
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
              {activeTask.status === "inbox" ? (
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
              ) : (
                // Calendar task overlay - simplified version with translucency
                <div
                  className="rounded font-medium p-2 min-w-[200px]"
                  style={{
                    ...PRIORITY_STYLES[Number(activeTask.priority) || 2],
                    height: `${getTaskHeight(activeTask.duration || 30)}px`,
                    opacity: 0.5, // Make drag overlay translucent so drop indicator is visible behind it
                  }}
                >
                  <span className="text-sm block truncate">{activeTask.title}</span>
                </div>
              )}
            </div>
          ) : null}
        </DragOverlay>
    </div>
    </DndContext>
  );
}
