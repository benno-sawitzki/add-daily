import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Mic, FileText, Loader2, Trash2, GripVertical, Plus } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import apiClient from "@/lib/apiClient";
import { handleApiError } from "@/lib/apiErrorHandler";
import TaskEditDialog from "./TaskEditDialog";
import { debouncedPersistReorder, cancelPendingPersistence } from "@/utils/reorderPersistence";
import { persistSortOrder, persistWithRetry } from "@/utils/reorderWithSortOrder";
import {
  DndContext,
  closestCenter,
  DragOverlay,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { usePremiumSensors, premiumDropAnimation, dragOverlayStyles } from "@/utils/dndConfig";

// Droppable Column Component
function DroppableColumn({ id, children, title, selectAllProps, onAddTask }) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: {
      type: 'column',
    },
  });

  return (
    <Card
      ref={setNodeRef}
      className={`p-4 flex-1 ${isOver ? 'ring-2 ring-primary bg-primary/5' : ''}`}
    >
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-lg font-semibold">{title}</h4>
        <div className="flex items-center gap-2">
          {onAddTask && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onAddTask}
              title={`Add task to ${title}`}
            >
              <Plus className="w-4 h-4" />
            </Button>
          )}
          {selectAllProps && (
            <div className="flex items-center gap-2">
              <Checkbox
                checked={selectAllProps.isAllSelected}
                onCheckedChange={selectAllProps.onSelectAll}
                className="h-4 w-4"
              />
              <span className="text-xs text-muted-foreground">
                Select all
              </span>
            </div>
          )}
        </div>
      </div>
      {selectAllProps && selectAllProps.hasSelected && (
        <div className="mb-4 pb-3 border-b">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {selectAllProps.selectedCount} selected
            </span>
            <Button
              variant="destructive"
              size="sm"
              onClick={selectAllProps.onDeleteSelected}
              disabled={selectAllProps.isDeleting}
            >
              {selectAllProps.isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Selected
                </>
              )}
            </Button>
          </div>
        </div>
      )}
      <div className="min-h-[200px]">
        {children}
      </div>
    </Card>
  );
}

// Activation delay constants - must match activationConstraint in dndConfig.js
// Detect touchpad for adaptive delays (Mac trackpads report as fine pointer without touch)
const isTouchpad = typeof window !== 'undefined' && (
  window.matchMedia('(pointer: fine)').matches &&
  !window.matchMedia('(any-pointer: coarse)').matches &&
  navigator.maxTouchPoints === 0
);
const ACTIVATION_DELAY_MS = isTouchpad ? 100 : 300;
const PULSE_DELAY_MS = isTouchpad ? 50 : 150;
const MOVEMENT_TOLERANCE_PX = isTouchpad ? 10 : 5;

// Sortable Task Card Component
function SortableTaskCard({ task, onUpdate, isSelected, onSelectChange, onEdit, lastDragEndTime, activeId, showCheckbox }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.4 : 1,
  };

  // Hold feedback state
  const [isHolding, setIsHolding] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [showPulse, setShowPulse] = useState(false);
  
  // Refs for tracking hold
  const holdStartTimeRef = useRef(null);
  const holdAnimationFrameRef = useRef(null);
  const pointerStartPosRef = useRef({ x: 0, y: 0 });
  const cardRef = useRef(null);
  const handleRef = useRef(null);
  const localDragStartPos = useRef(null);
  const localHasDragged = useRef(false);
  
  const isActivated = activeId === String(task.id) && isSortableDragging;
  
  // Reset hold feedback when drag activates
  useEffect(() => {
    if (isActivated) {
      cancelHoldFeedback();
    }
  }, [isActivated]);
  
  // Cancel hold feedback helper
  const cancelHoldFeedback = () => {
    setIsHolding(false);
    setHoldProgress(0);
    setShowPulse(false);
    if (holdAnimationFrameRef.current) {
      cancelAnimationFrame(holdAnimationFrameRef.current);
      holdAnimationFrameRef.current = null;
    }
    holdStartTimeRef.current = null;
    pointerStartPosRef.current = { x: 0, y: 0 };
  };
  
  // Update hold progress via requestAnimationFrame
  const updateHoldProgress = () => {
    if (!holdStartTimeRef.current || isActivated) {
      cancelHoldFeedback();
      return;
    }
    
    const elapsed = Date.now() - holdStartTimeRef.current;
    const progress = Math.min(elapsed / ACTIVATION_DELAY_MS, 1);
    
    setHoldProgress(progress);
    
    // Show pulse at ~150ms (halfway point)
    if (elapsed >= PULSE_DELAY_MS) {
      setShowPulse(true);
    }
    
    // Continue animation if still holding and not activated
    if (progress < 1 && !isActivated && holdStartTimeRef.current) {
      holdAnimationFrameRef.current = requestAnimationFrame(updateHoldProgress);
    } else if (progress >= 1) {
      // Progress complete - drag should activate now
      cancelHoldFeedback();
    }
  };
  
  // Handle pointer down on card for feedback (using Capture phase to avoid overriding dnd-kit)
  const handlePointerDownCapture = (e) => {
    // Only start hold feedback if not already dragging
    if (isActivated || isSortableDragging) return;
    
    // Don't start drag feedback if clicking on interactive elements
    if (e.target.closest('button') || e.target.closest('[role="combobox"]') || e.target.closest('input') || e.target.closest('select')) {
      return;
    }
    
    holdStartTimeRef.current = Date.now();
    pointerStartPosRef.current = { x: e.clientX, y: e.clientY };
    localDragStartPos.current = { x: e.clientX, y: e.clientY };
    localHasDragged.current = false;
    setIsHolding(true);
    setHoldProgress(0);
    setShowPulse(false);
    
    // Start progress animation
    holdAnimationFrameRef.current = requestAnimationFrame(updateHoldProgress);
    
    // Add global listeners for cancel scenarios
    const handlePointerMove = (moveEvent) => {
      if (!holdStartTimeRef.current) return;
      
      const dx = Math.abs(moveEvent.clientX - pointerStartPosRef.current.x);
      const dy = Math.abs(moveEvent.clientY - pointerStartPosRef.current.y);
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // For touchpads, be more forgiving - only cancel if movement is significant
      // This prevents force feedback from interfering with drag activation
      const cancelThreshold = isTouchpad ? MOVEMENT_TOLERANCE_PX * 2 : MOVEMENT_TOLERANCE_PX;
      
      // Track if this becomes a drag
      if (distance > cancelThreshold) {
        localHasDragged.current = true;
      }
      
      // Cancel if moved beyond threshold (more forgiving for touchpads)
      if (distance > cancelThreshold) {
        cancelHoldFeedback();
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
        document.removeEventListener('pointercancel', handlePointerCancel);
      }
    };
    
    const handlePointerUp = () => {
      cancelHoldFeedback();
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerCancel);
    };
    
    const handlePointerCancel = () => {
      cancelHoldFeedback();
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerCancel);
    };
    
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerCancel);
  };
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelHoldFeedback();
    };
  }, []);

  const handleClick = (e) => {
    // Don't open if clicking on checkbox or if dragging
    if (e.target.closest('input[type="checkbox"]') || isSortableDragging || isActivated) {
      return;
    }
    // Don't open if a drag just ended (within last 200ms)
    if (lastDragEndTime && Date.now() - lastDragEndTime.current < 200) {
      return;
    }
    // Check if it was a drag (movement > threshold)
    // For touchpads, use higher threshold to account for natural movement
    const clickThreshold = isTouchpad ? 10 : 5;
    if (localDragStartPos.current && !localHasDragged.current) {
      const deltaX = Math.abs(e.clientX - (localDragStartPos.current?.x || 0));
      const deltaY = Math.abs(e.clientY - (localDragStartPos.current?.y || 0));
      if (deltaX <= clickThreshold && deltaY <= clickThreshold) {
        if (onEdit) {
          onEdit(task);
        }
      }
    }
    localDragStartPos.current = null;
    localHasDragged.current = false;
  };

  return (
    <Card
      ref={(node) => {
        setNodeRef(node);
        cardRef.current = node;
        setActivatorNodeRef(node);
      }}
      style={style}
      {...attributes}
      {...listeners}
      onPointerDownCapture={handlePointerDownCapture}
      onClick={handleClick}
      className={`task-card p-3 mb-2 cursor-grab active:cursor-grabbing hover:bg-card/50 transition-all ${
        isSortableDragging ? "border-dashed border-primary/50 bg-primary/5" : ""
      } ${showPulse && !isActivated ? "hold-pulse" : ""} ${isSelected ? 'ring-2 ring-primary' : ''}`}
    >
      <div className="flex items-start gap-2">
        {showCheckbox && onSelectChange && (
          <Checkbox
            checked={isSelected}
            onCheckedChange={onSelectChange}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            className="h-4 w-4 mt-1 flex-shrink-0"
          />
        )}
        <div className="mt-1 relative inline-flex items-center justify-center">
          <div
            ref={(node) => {
              if (node) {
                handleRef.current = node;
              }
            }}
            className="relative text-muted-foreground hover:text-foreground pt-1 flex items-center justify-center"
          >
            {/* Progress ring SVG - positioned at the drag handle icon */}
            {isHolding && !isActivated && (
              <svg
                className="absolute left-1/2 w-8 h-8 pointer-events-none"
                viewBox="0 0 32 32"
                style={{ 
                  top: 'calc(0.25rem + 0.625rem)',
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <circle
                  cx="16"
                  cy="16"
                  r="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-primary/20"
                />
                <circle
                  cx="16"
                  cy="16"
                  r="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray={`${2 * Math.PI * 14}`}
                  strokeDashoffset={`${2 * Math.PI * 14 * (1 - holdProgress)}`}
                  strokeLinecap="round"
                  className="text-primary transition-none"
                  style={{
                    transform: 'rotate(-90deg)',
                    transformOrigin: '16px 16px',
                  }}
                />
              </svg>
            )}
            <GripVertical className="w-4 h-4" />
          </div>
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-medium text-foreground">{task.title}</h4>
          {task.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-line">
              {task.description}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function DumpsListPage({ userId }) {
  const navigate = useNavigate();
  const [dumps, setDumps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [deletingId, setDeletingId] = useState(null);
  const [selectedDumps, setSelectedDumps] = useState(new Set());
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [showDumpsSelection, setShowDumpsSelection] = useState(false);
  const [backlogTasks, setBacklogTasks] = useState([]);
  const [roadmapTasks, setRoadmapTasks] = useState([]);
  const [selectedBacklogTasks, setSelectedBacklogTasks] = useState(new Set());
  const [selectedRoadmapTasks, setSelectedRoadmapTasks] = useState(new Set());
  const [isDeletingSelectedBacklog, setIsDeletingSelectedBacklog] = useState(false);
  const [isDeletingSelectedRoadmap, setIsDeletingSelectedRoadmap] = useState(false);
  const [showBacklogSelection, setShowBacklogSelection] = useState(false);
  const [showRoadmapSelection, setShowRoadmapSelection] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [isReorderingBacklog, setIsReorderingBacklog] = useState(false);
  const [isReorderingRoadmap, setIsReorderingRoadmap] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const hasDragged = useRef(false);
  const lastDragEndTime = useRef(0);
  const limit = 20;

  const sensors = usePremiumSensors();

  const fetchDumps = async (reset = false) => {
    if (!userId) {
      console.log("DumpsListPage: No userId, skipping fetch");
      return;
    }
    
    const currentOffset = reset ? 0 : offset;
    setLoading(true);
    
    try {
      const response = await apiClient.get('/dumps', {
        params: { limit, offset: currentOffset },
      });
      
      const fetchedDumps = response.data || [];
      
      if (reset) {
        setDumps(fetchedDumps);
        setSelectedDumps(new Set()); // Clear selection when resetting
      } else {
        setDumps(prev => [...prev, ...fetchedDumps]);
      }
      
      setHasMore(fetchedDumps.length === limit);
      setOffset(currentOffset + fetchedDumps.length);
    } catch (error) {
      const errorMessage = handleApiError(error, "Failed to load dumps");
      
      if (error.response?.status === 401) {
        toast.error("Please sign in to view dumps", { duration: 5000 });
      } else {
        toast.error(errorMessage, { duration: 5000 });
      }
      
      setDumps([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchTasks = async () => {
    if (!userId) return;
    
    setTasksLoading(true);
    try {
      const [backlogResponse, roadmapResponse] = await Promise.all([
        apiClient.get('/tasks', { params: { status: 'backlog' } }),
        apiClient.get('/tasks', { params: { status: 'roadmap' } }),
      ]);
      
      // Only update if not currently reordering
      if (!isReorderingBacklog) {
        setBacklogTasks(backlogResponse.data || []);
      }
      if (!isReorderingRoadmap) {
        setRoadmapTasks(roadmapResponse.data || []);
      }
    } catch (error) {
      console.error('Failed to load tasks:', error);
      // Don't show error toast - tasks might not exist yet
    } finally {
      setTasksLoading(false);
    }
  };

  // Helper function to reorder roadmap tasks using sort_order (same as inbox)
  const reorderRoadmapTasksAndUpdateSortOrder = (newTasks) => {
    // Safety check: if array is empty, just update state and return early
    if (newTasks.length === 0) {
      setIsReorderingRoadmap(true);
      setRoadmapTasks([]);
      setIsReorderingRoadmap(false);
      return;
    }
    
    // Prevent useEffect from resetting local state during reorder
    setIsReorderingRoadmap(true);
    
    // OPTIMISTIC UPDATE: Update local state immediately with new order
    setRoadmapTasks(newTasks);

    // Update sort_order optimistically in local state (for UI consistency)
    const tasksWithSortOrder = newTasks.map((task, index) => ({
      ...task,
      sort_order: index,
    }));
    setRoadmapTasks(tasksWithSortOrder);

    // DEBOUNCED PERSISTENCE: Persist sort_order to backend (batch update)
    debouncedPersistReorder(
      'roadmap',
      async () => {
        // Use batch update endpoint for sort_order
        await persistWithRetry(
          () => persistSortOrder(newTasks, 'roadmap'),
          1, // 1 retry
          1000 // 1 second delay
        );
        
        // Sync with server (but don't overwrite optimistic state if it matches)
        await fetchTasks();
        
        // Allow useEffect to sync with props again
        setIsReorderingRoadmap(false);
      },
      (error) => {
        // On error: keep optimistic UI, show error, but don't revert
        setIsReorderingRoadmap(false);
        console.error("Failed to persist roadmap task order (UI order preserved):", error);
      }
    );
  };

  // Helper function to reorder backlog tasks using sort_order (same as inbox)
  const reorderBacklogTasksAndUpdateSortOrder = (newTasks) => {
    // Safety check: if array is empty, just update state and return early
    if (newTasks.length === 0) {
      setIsReorderingBacklog(true);
      setBacklogTasks([]);
      setIsReorderingBacklog(false);
      return;
    }
    
    // Prevent useEffect from resetting local state during reorder
    setIsReorderingBacklog(true);
    
    // OPTIMISTIC UPDATE: Update local state immediately with new order
    setBacklogTasks(newTasks);

    // Update sort_order optimistically in local state (for UI consistency)
    const tasksWithSortOrder = newTasks.map((task, index) => ({
      ...task,
      sort_order: index,
    }));
    setBacklogTasks(tasksWithSortOrder);

    // DEBOUNCED PERSISTENCE: Persist sort_order to backend (batch update)
    debouncedPersistReorder(
      'backlog',
      async () => {
        // Use batch update endpoint for sort_order
        await persistWithRetry(
          () => persistSortOrder(newTasks, 'backlog'),
          1, // 1 retry
          1000 // 1 second delay
        );
        
        // Sync with server (but don't overwrite optimistic state if it matches)
        await fetchTasks();
        
        // Allow useEffect to sync with props again
        setIsReorderingBacklog(false);
      },
      (error) => {
        // On error: keep optimistic UI, show error, but don't revert
        setIsReorderingBacklog(false);
        console.error("Failed to persist backlog task order (UI order preserved):", error);
      }
    );
  };

  useEffect(() => {
    fetchDumps(true);
    fetchTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Listen for dump-created event to refresh list
  useEffect(() => {
    const handleDumpCreated = () => {
      fetchDumps(true);
    };

    window.addEventListener('dump-created', handleDumpCreated);
    return () => {
      window.removeEventListener('dump-created', handleDumpCreated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDumpClick = (dumpId) => {
    navigate(`/app/dumps/${dumpId}`);
  };

  const handleLoadMore = () => {
    fetchDumps(false);
  };

  const handleDelete = async (dumpId, e) => {
    e.stopPropagation(); // Prevent navigation when clicking delete
    
    setDeletingId(dumpId);
    try {
      await apiClient.delete(`/dumps/${dumpId}`);
      toast.success("Dump deleted successfully");
      // Remove from local state
      setDumps(prev => prev.filter(dump => dump.id !== dumpId));
      // Remove from selected if it was selected
      setSelectedDumps(prev => {
        const next = new Set(prev);
        next.delete(dumpId);
        return next;
      });
    } catch (error) {
      const errorMessage = handleApiError(error, "Failed to delete dump");
      toast.error(errorMessage);
    } finally {
      setDeletingId(null);
    }
  };


  const handleSelectAll = (checked) => {
    if (checked) {
      setShowDumpsSelection(true);
      setSelectedDumps(new Set(dumps.map(dump => dump.id)));
    } else {
      setSelectedDumps(new Set());
      setShowDumpsSelection(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedDumps.size === 0) return;
    
    if (!window.confirm(`Delete ${selectedDumps.size} dump${selectedDumps.size > 1 ? 's' : ''}?`)) {
      return;
    }

    setIsDeletingSelected(true);
    const selectedIds = Array.from(selectedDumps);
    let successCount = 0;
    let errorCount = 0;

    try {
      // Delete all selected dumps in parallel
      await Promise.all(
        selectedIds.map(async (dumpId) => {
          try {
            await apiClient.delete(`/dumps/${dumpId}`);
            successCount++;
          } catch (error) {
            console.error(`Failed to delete dump ${dumpId}:`, error);
            errorCount++;
          }
        })
      );

      // Remove deleted dumps from local state
      setDumps(prev => prev.filter(dump => !selectedDumps.has(dump.id)));
      setSelectedDumps(new Set());
      setShowDumpsSelection(false);

      if (errorCount === 0) {
        toast.success(`Deleted ${successCount} dump${successCount > 1 ? 's' : ''} successfully`);
      } else {
        toast.warning(`Deleted ${successCount} dump${successCount > 1 ? 's' : ''}, ${errorCount} failed`);
      }
    } catch (error) {
      toast.error("Error deleting dumps");
    } finally {
      setIsDeletingSelected(false);
    }
  };

  const handleTaskUpdate = async (taskId, taskData) => {
    try {
      if (taskId === null) {
        // Create new task
        await apiClient.post('/tasks', taskData);
        await fetchTasks();
        toast.success("Task created");
      } else {
        // Update existing task
        await apiClient.patch(`/tasks/${taskId}`, taskData);
        await fetchTasks();
        toast.success("Task updated");
      }
    } catch (error) {
      const errorMessage = handleApiError(error, taskId === null ? "Failed to create task" : "Failed to update task");
      toast.error(errorMessage);
    }
  };

  const handleTaskDelete = async (taskId) => {
    try {
      await apiClient.delete(`/tasks/${taskId}`);
      await fetchTasks();
      toast.success("Task deleted");
    } catch (error) {
      const errorMessage = handleApiError(error, "Failed to delete task");
      toast.error(errorMessage);
    }
  };

  const handleDragStart = (event) => {
    setActiveId(event.active.id);
    hasDragged.current = true;
  };

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    setActiveId(null);
    lastDragEndTime.current = Date.now();

    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Case 1: Reordering within backlog column
    if (overId === 'backlog-column' || backlogTasks.some(t => String(t.id) === overId)) {
      if (backlogTasks.some(t => String(t.id) === activeId)) {
        // Reordering within backlog
        const oldIndex = backlogTasks.findIndex(t => String(t.id) === activeId);
        let newIndex;

        if (overId === 'backlog-column') {
          // Dropped on column itself, move to top
          newIndex = 0;
        } else {
          // Dropped on another task
          const overIndex = backlogTasks.findIndex(t => String(t.id) === overId);
          if (overIndex === -1) return;
          newIndex = overIndex;
        }

        // Only proceed if we have a valid new position
        if (oldIndex !== newIndex && newIndex >= 0 && newIndex <= backlogTasks.length) {
          const newTasks = arrayMove(backlogTasks, oldIndex, newIndex);
          reorderBacklogTasksAndUpdateSortOrder(newTasks);
        }
        return;
      } else if (roadmapTasks.some(t => String(t.id) === activeId)) {
        // Moving from roadmap to backlog
        const task = roadmapTasks.find(t => String(t.id) === activeId);
        if (!task) return;

        setRoadmapTasks(prev => prev.filter(t => String(t.id) !== activeId));
        setSelectedRoadmapTasks(prev => {
          const next = new Set(prev);
          next.delete(activeId);
          return next;
        });
        setBacklogTasks(prev => [...prev, { ...task, status: 'backlog' }]);

        try {
          await apiClient.patch(`/tasks/${activeId}`, { status: 'backlog' });
          await fetchTasks();
        } catch (error) {
          const errorMessage = handleApiError(error, "Failed to move task");
          toast.error(errorMessage);
          await fetchTasks();
        }
        return;
      }
    }

    // Case 2: Reordering within roadmap column
    if (overId === 'roadmap-column' || roadmapTasks.some(t => String(t.id) === overId)) {
      if (roadmapTasks.some(t => String(t.id) === activeId)) {
        // Reordering within roadmap
        const oldIndex = roadmapTasks.findIndex(t => String(t.id) === activeId);
        let newIndex;

        if (overId === 'roadmap-column') {
          // Dropped on column itself, move to top
          newIndex = 0;
        } else {
          // Dropped on another task
          const overIndex = roadmapTasks.findIndex(t => String(t.id) === overId);
          if (overIndex === -1) return;
          newIndex = overIndex;
        }

        // Only proceed if we have a valid new position
        if (oldIndex !== newIndex && newIndex >= 0 && newIndex <= roadmapTasks.length) {
          const newTasks = arrayMove(roadmapTasks, oldIndex, newIndex);
          reorderRoadmapTasksAndUpdateSortOrder(newTasks);
        }
        return;
      } else if (backlogTasks.some(t => String(t.id) === activeId)) {
        // Moving from backlog to roadmap
        const task = backlogTasks.find(t => String(t.id) === activeId);
        if (!task) return;

        setBacklogTasks(prev => prev.filter(t => String(t.id) !== activeId));
        setSelectedBacklogTasks(prev => {
          const next = new Set(prev);
          next.delete(activeId);
          return next;
        });
        setRoadmapTasks(prev => [...prev, { ...task, status: 'roadmap' }]);

        try {
          await apiClient.patch(`/tasks/${activeId}`, { status: 'roadmap' });
          await fetchTasks();
        } catch (error) {
          const errorMessage = handleApiError(error, "Failed to move task");
          toast.error(errorMessage);
          await fetchTasks();
        }
        return;
      }
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
  };

  // Backlog selection handlers
  const handleSelectAllBacklog = (checked) => {
    if (checked) {
      setShowBacklogSelection(true);
      setSelectedBacklogTasks(new Set(backlogTasks.map(task => task.id)));
    } else {
      setSelectedBacklogTasks(new Set());
      setShowBacklogSelection(false);
    }
  };

  const handleDeleteSelectedBacklog = async () => {
    if (selectedBacklogTasks.size === 0) return;
    
    if (!window.confirm(`Delete ${selectedBacklogTasks.size} task${selectedBacklogTasks.size > 1 ? 's' : ''} from backlog?`)) {
      return;
    }

    setIsDeletingSelectedBacklog(true);
    const selectedIds = Array.from(selectedBacklogTasks);
    let successCount = 0;
    let errorCount = 0;

    try {
      await Promise.all(
        selectedIds.map(async (taskId) => {
          try {
            await apiClient.delete(`/tasks/${taskId}`);
            successCount++;
          } catch (error) {
            console.error(`Failed to delete task ${taskId}:`, error);
            errorCount++;
          }
        })
      );

      setBacklogTasks(prev => prev.filter(task => !selectedBacklogTasks.has(task.id)));
      setSelectedBacklogTasks(new Set());
      setShowBacklogSelection(false);

      if (errorCount === 0) {
        toast.success(`Deleted ${successCount} task${successCount > 1 ? 's' : ''} successfully`);
      } else {
        toast.warning(`Deleted ${successCount} task${successCount > 1 ? 's' : ''}, ${errorCount} failed`);
      }
      
      // Refresh tasks
      await fetchTasks();
    } catch (error) {
      toast.error("Error deleting tasks");
    } finally {
      setIsDeletingSelectedBacklog(false);
    }
  };

  // Roadmap selection handlers
  const handleSelectAllRoadmap = (checked) => {
    if (checked) {
      setShowRoadmapSelection(true);
      setSelectedRoadmapTasks(new Set(roadmapTasks.map(task => task.id)));
    } else {
      setSelectedRoadmapTasks(new Set());
      setShowRoadmapSelection(false);
    }
  };

  const handleDeleteSelectedRoadmap = async () => {
    if (selectedRoadmapTasks.size === 0) return;
    
    if (!window.confirm(`Delete ${selectedRoadmapTasks.size} task${selectedRoadmapTasks.size > 1 ? 's' : ''} from roadmap?`)) {
      return;
    }

    setIsDeletingSelectedRoadmap(true);
    const selectedIds = Array.from(selectedRoadmapTasks);
    let successCount = 0;
    let errorCount = 0;

    try {
      await Promise.all(
        selectedIds.map(async (taskId) => {
          try {
            await apiClient.delete(`/tasks/${taskId}`);
            successCount++;
          } catch (error) {
            console.error(`Failed to delete task ${taskId}:`, error);
            errorCount++;
          }
        })
      );

      setRoadmapTasks(prev => prev.filter(task => !selectedRoadmapTasks.has(task.id)));
      setSelectedRoadmapTasks(new Set());
      setShowRoadmapSelection(false);

      if (errorCount === 0) {
        toast.success(`Deleted ${successCount} task${successCount > 1 ? 's' : ''} successfully`);
      } else {
        toast.warning(`Deleted ${successCount} task${successCount > 1 ? 's' : ''}, ${errorCount} failed`);
      }
      
      // Refresh tasks
      await fetchTasks();
    } catch (error) {
      toast.error("Error deleting tasks");
    } finally {
      setIsDeletingSelectedRoadmap(false);
    }
  };

  const activeTask = activeId
    ? [...backlogTasks, ...roadmapTasks].find(t => t.id === activeId)
    : null;

  const isAllSelected = dumps.length > 0 && selectedDumps.size === dumps.length;
  const isSomeSelected = selectedDumps.size > 0 && selectedDumps.size < dumps.length;
  
  const isAllBacklogSelected = backlogTasks.length > 0 && selectedBacklogTasks.size === backlogTasks.length;
  const isAllRoadmapSelected = roadmapTasks.length > 0 && selectedRoadmapTasks.size === roadmapTasks.length;

  const handleAddBacklogTask = () => {
    setEditingTask({ status: 'backlog' });
  };

  const handleAddRoadmapTask = () => {
    setEditingTask({ status: 'roadmap' });
  };

  if (loading && dumps.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (dumps.length === 0 && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20" data-testid="dumps-empty">
        <div className="w-20 h-20 rounded-full bg-card flex items-center justify-center mb-6">
          <FileText className="w-10 h-10 text-muted-foreground" />
        </div>
        <h3 className="text-xl font-semibold mb-2">No dumps yet</h3>
        <p className="text-muted-foreground text-center max-w-md">
          Create a dump from text or voice to start capturing your thoughts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="dumps-list-page">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Dumps</h2>
          <p className="text-sm text-muted-foreground mt-1">
            History of all capture sessions
          </p>
        </div>
        {selectedDumps.size > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {selectedDumps.size} selected
            </span>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteSelected}
              disabled={isDeletingSelected}
            >
              {isDeletingSelected ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Selected
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Three columns: Dumps, Backlog, Roadmap */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Dumps Column */}
          <div className="flex flex-col">
            <Card className="p-4 flex-1">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-lg font-semibold">Dumps</h4>
                {dumps.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={isAllSelected}
                      onCheckedChange={handleSelectAll}
                      className="h-4 w-4"
                    />
                    <span className="text-xs text-muted-foreground">
                      Select all
                    </span>
                  </div>
                )}
              </div>
              {selectedDumps.size > 0 && (
                <div className="mb-4 pb-3 border-b">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {selectedDumps.size} selected
                    </span>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleDeleteSelected}
                      disabled={isDeletingSelected}
                    >
                      {isDeletingSelected ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Deleting...
                        </>
                      ) : (
                        <>
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete Selected
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
              <div className="space-y-4 max-h-[calc(100vh-300px)] overflow-y-auto">
                {dumps.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No dumps yet
                  </p>
                ) : (
                  dumps.map((dump) => {
                    const isSelected = selectedDumps.has(dump.id);
                    const createdAt = new Date(dump.created_at);
                    const preview = dump.raw_text.length > 150 
                      ? dump.raw_text.substring(0, 150) + '...' 
                      : dump.raw_text;
                    const displayTitle = dump.title || preview;
                    
                    return (
                      <Card
                        key={dump.id}
                        className={`p-4 hover:bg-card/50 transition-colors cursor-pointer ${isSelected ? 'ring-2 ring-primary' : ''}`}
                        onClick={() => handleDumpClick(dump.id)}
                      >
                        <div className="flex items-start justify-between gap-4">
                          {showDumpsSelection && (
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => {
                                setSelectedDumps(prev => {
                                  const next = new Set(prev);
                                  if (next.has(dump.id)) {
                                    next.delete(dump.id);
                                  } else {
                                    next.add(dump.id);
                                  }
                                  return next;
                                });
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="h-4 w-4 mt-1 flex-shrink-0"
                            />
                          )}
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-sm font-medium">
                                {format(createdAt, "MMM d, yyyy 'at' HH:mm")}
                              </span>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                {dump.source === "voice" ? (
                                  <Mic className="w-3 h-3" />
                                ) : (
                                  <FileText className="w-3 h-3" />
                                )}
                                <span className="capitalize">{dump.source}</span>
                              </div>
                            </div>
                            {dump.title ? (
                              <h3 className="text-base font-semibold text-foreground mb-1 line-clamp-1">
                                {dump.title}
                              </h3>
                            ) : null}
                            <p className={`text-sm ${dump.title ? 'text-muted-foreground' : 'text-foreground'} mb-2 line-clamp-3`}>
                              {dump.title ? preview : displayTitle}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                            onClick={(e) => handleDelete(dump.id, e)}
                            disabled={deletingId === dump.id}
                            title="Delete dump"
                          >
                            {deletingId === dump.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                      </Card>
                    );
                  })
                )}
              </div>

              {hasMore && (
                <div className="flex justify-center pt-4">
                  <Button 
                    variant="outline" 
                    onClick={handleLoadMore}
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      'Load More'
                    )}
                  </Button>
                </div>
              )}
            </Card>
          </div>

          {/* Backlog Column */}
          <DroppableColumn 
            id="backlog-column" 
            title="Backlog"
            onAddTask={handleAddBacklogTask}
            selectAllProps={{
              isAllSelected: isAllBacklogSelected,
              onSelectAll: handleSelectAllBacklog,
              hasSelected: selectedBacklogTasks.size > 0,
              selectedCount: selectedBacklogTasks.size,
              onDeleteSelected: handleDeleteSelectedBacklog,
              isDeleting: isDeletingSelectedBacklog,
            }}
          >
            <SortableContext
              items={backlogTasks.map(t => t.id)}
              strategy={verticalListSortingStrategy}
            >
              {tasksLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : backlogTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No tasks in backlog. Drag tasks here to add them.
                </p>
              ) : (
                <div className="space-y-2 max-h-[calc(100vh-300px)] overflow-y-auto pt-3 pb-2">
                  {backlogTasks.map((task) => (
                    <SortableTaskCard
                      key={task.id}
                      task={task}
                      onUpdate={fetchTasks}
                      isSelected={selectedBacklogTasks.has(task.id)}
                      onSelectChange={(checked) => {
                        setSelectedBacklogTasks(prev => {
                          const next = new Set(prev);
                          if (checked) {
                            next.add(task.id);
                          } else {
                            next.delete(task.id);
                          }
                          return next;
                        });
                      }}
                      onEdit={setEditingTask}
                      lastDragEndTime={lastDragEndTime}
                      activeId={activeId}
                      showCheckbox={showBacklogSelection}
                    />
                  ))}
                </div>
              )}
            </SortableContext>
          </DroppableColumn>

          {/* Roadmap Column */}
          <DroppableColumn 
            id="roadmap-column" 
            title="Roadmap"
            onAddTask={handleAddRoadmapTask}
            selectAllProps={{
              isAllSelected: isAllRoadmapSelected,
              onSelectAll: handleSelectAllRoadmap,
              hasSelected: selectedRoadmapTasks.size > 0,
              selectedCount: selectedRoadmapTasks.size,
              onDeleteSelected: handleDeleteSelectedRoadmap,
              isDeleting: isDeletingSelectedRoadmap,
            }}
          >
            <SortableContext
              items={roadmapTasks.map(t => t.id)}
              strategy={verticalListSortingStrategy}
            >
              {tasksLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : roadmapTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No tasks in roadmap. Drag tasks here to add them.
                </p>
              ) : (
                <div className="space-y-2 max-h-[calc(100vh-300px)] overflow-y-auto pt-3 pb-2">
                  {roadmapTasks.map((task) => (
                    <SortableTaskCard
                      key={task.id}
                      task={task}
                      onUpdate={fetchTasks}
                      isSelected={selectedRoadmapTasks.has(task.id)}
                      onSelectChange={(checked) => {
                        setSelectedRoadmapTasks(prev => {
                          const next = new Set(prev);
                          if (checked) {
                            next.add(task.id);
                          } else {
                            next.delete(task.id);
                          }
                          return next;
                        });
                      }}
                      onEdit={setEditingTask}
                      lastDragEndTime={lastDragEndTime}
                      activeId={activeId}
                      showCheckbox={showRoadmapSelection}
                    />
                  ))}
                </div>
              )}
            </SortableContext>
          </DroppableColumn>
        </div>

        <DragOverlay dropAnimation={premiumDropAnimation}>
          {activeTask ? (
            <div style={dragOverlayStyles}>
              <SortableTaskCard
                task={activeTask}
                onUpdate={fetchTasks}
                isSelected={selectedBacklogTasks.has(activeTask.id) || selectedRoadmapTasks.has(activeTask.id)}
                onSelectChange={() => {}}
                onEdit={() => {}}
                lastDragEndTime={lastDragEndTime}
                activeId={activeId}
                showCheckbox={false}
                isDragging={true}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Task Edit Dialog */}
      <TaskEditDialog
        task={editingTask}
        open={!!editingTask}
        onOpenChange={(open) => {
          if (!open) {
            setEditingTask(null);
          }
        }}
        onSave={handleTaskUpdate}
        onDelete={handleTaskDelete}
      />
    </div>
  );
}

