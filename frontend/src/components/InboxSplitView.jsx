import { useState, useEffect, useRef } from "react";
import {
  DndContext,
  closestCorners,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { Inbox, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import SortableTaskCard from "./SortableTaskCard";
import NextSlot from "./NextSlot";
import TaskEditDialog from "./TaskEditDialog";
import { toast } from "sonner";
import { usePremiumSensors, premiumDropAnimation, dragOverlayStyles } from "@/utils/dndConfig";
import { debouncedPersistReorder, cancelPendingPersistence } from "@/utils/reorderPersistence";
import { persistSortOrder, persistWithRetry } from "@/utils/reorderWithSortOrder";
import apiClient from "@/lib/apiClient";
import { handleApiError } from "@/lib/apiErrorHandler";

export default function InboxSplitView({
  inboxTasks,
  nextTasks = [], // Changed from nextTask to nextTasks (array)
  onUpdateTask,
  onCreateTask,
  onDeleteTask,
  onRefreshTasks,
  currentEnergy = 'medium',
  onEnergyChange,
}) {
  const [editingTask, setEditingTask] = useState(null); // null = closed, undefined = create mode, task object = edit mode
  const [activeId, setActiveId] = useState(null);
  const [localInboxTasks, setLocalInboxTasks] = useState(inboxTasks);
  const [localNextTasks, setLocalNextTasks] = useState(nextTasks);
  const [isReordering, setIsReordering] = useState(false);
  const NEXT_TODAY_CAP = 1; // Next Today can only have 1 task max
  const INBOX_CAP = 5; // Inbox can have 5 tasks max

  // Update local state when props change (but not during reordering)
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
      
      setLocalNextTasks(nextTasks);
    }
  }, [inboxTasks, nextTasks, isReordering, localInboxTasks]);

  const sensors = usePremiumSensors();
  const persistTimeoutRef = useRef(null);

  const handleDragStart = (event) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) {
      // If dropped outside, revert to original position
      return;
    }

    const activeId = String(active.id);
    const overId = String(over.id);

    // Case 1: Reordering within inbox
    if (overId === "inbox-dropzone" || localInboxTasks.some((t) => String(t.id) === overId)) {
      if (localNextTasks.some((t) => String(t.id) === activeId)) {
        // Dragging from Next Today to Inbox
        const taskToMove = localNextTasks.find((t) => String(t.id) === activeId);
        try {
          // Optimistic update: remove from Next Today, add to inbox
          setLocalNextTasks((prev) => prev.filter((t) => String(t.id) !== activeId));
          setLocalInboxTasks((prev) => [taskToMove, ...prev]);

          // API call
          await apiClient.post(`/tasks/${activeId}/move-to-inbox`);
          await onRefreshTasks();
        } catch (error) {
          // Revert on error
          setLocalNextTasks((prev) => [...prev, taskToMove]);
          setLocalInboxTasks((prev) => prev.filter((t) => String(t.id) !== activeId));
          console.error("Error moving task to inbox:", error);
          toast.error("Failed to move task to inbox");
        }
      } else if (localInboxTasks.some((t) => String(t.id) === activeId)) {
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
          // The toIndex is the position in the RESULT array (after removal)
          // When dragging down (oldIndex < overIndex): after removing oldIndex, overIndex becomes overIndex - 1
          //   But we want the item to end up at the position where overIndex currently is
          //   So we need to account for the shift: newIndex = overIndex (the target position)
          // When dragging up (oldIndex > overIndex): no shift occurs, so newIndex = overIndex
          // 
          // However, dnd-kit's SortableContext provides the correct destination index via over.id
          // The overIndex is already the correct final position we want
          newIndex = overIndex;
          
          // Dev-only assertion to verify reorder logic
          if (process.env.NODE_ENV === 'development') {
            const testArray = ['A', 'B', 'C', 'D'];
            const testFrom = 1;
            const testTo = 2;
            const testResult = arrayMove(testArray, testFrom, testTo);
            const expected = ['A', 'C', 'B', 'D'];
            if (JSON.stringify(testResult) !== JSON.stringify(expected)) {
              console.warn('[REORDER] arrayMove test failed:', { testResult, expected });
            }
          }
        }

        // Only proceed if we have a valid new position
        if (oldIndex !== newIndex && newIndex >= 0 && newIndex <= localInboxTasks.length) {
          const newTasks = arrayMove(localInboxTasks, oldIndex, newIndex);
          reorderTasksAndUpdateSortOrder(newTasks);
        }
      }
      return;
    }

    // Case 2: Dropping on Next Today slot
    if (overId === "next-slot") {
      const taskToMakeNext = localInboxTasks.find((t) => String(t.id) === activeId) || 
                             localNextTasks.find((t) => String(t.id) === activeId);

      if (!taskToMakeNext) return;

      // Check if task is already in Next Today - allow reordering within Next Today
      const isAlreadyNext = localNextTasks.some((t) => String(t.id) === activeId);
      
      // Check Next Today cap (1 task max)
      if (!isAlreadyNext && localNextTasks.length >= NEXT_TODAY_CAP) {
        toast.error(`Next Today is full (${NEXT_TODAY_CAP}). Finish or move something out first.`);
        return;
      }

      try {
        if (isAlreadyNext) {
          // Task is already in Next Today - allow reordering within the list
          // (Reordering logic would go here if needed, but for now we allow it)
          return;
        }
        
        // Optimistic update: add task to Next Today, remove from inbox
        setLocalNextTasks((prev) => [...prev, taskToMakeNext]);
        setLocalInboxTasks((prev) => prev.filter((t) => String(t.id) !== activeId));

        // API call
        await apiClient.post(`/tasks/${activeId}/make-next`);
        await onRefreshTasks();
      } catch (error) {
        // Revert on error
        setLocalNextTasks((prev) => prev.filter((t) => String(t.id) !== activeId));
        setLocalInboxTasks((prev) => [...prev, taskToMakeNext]);
        
        // handleApiError already shows HTTP status and response body snippet
        const errorMessage = handleApiError(error, "Failed to set task as next");
        toast.error(errorMessage, {
          id: 'make-next-error-drag', // Deduplicate
          duration: 5000,
        });
      }
      return;
    }
  };

  // Helper function to reorder tasks using sort_order (single source of truth: arrayMove result)
  const reorderTasksAndUpdateSortOrder = (newTasks) => {
    // Safety check: if array is empty, just update state and return early
    if (newTasks.length === 0) {
      setIsReordering(true);
      setLocalInboxTasks([]);
      setIsReordering(false);
      return;
    }
    
    // Prevent useEffect from resetting local state during reorder
    setIsReordering(true);
    
    // Save original order for error recovery
    const originalOrder = [...localInboxTasks];
    
    // OPTIMISTIC UPDATE: Update local state immediately with new order
    // This is the single source of truth from arrayMove
    setLocalInboxTasks(newTasks);

    // Update sort_order optimistically in local state (for UI consistency)
    const tasksWithSortOrder = newTasks.map((task, index) => ({
      ...task,
      sort_order: index,
    }));
    setLocalInboxTasks(tasksWithSortOrder);

    // DEBOUNCED PERSISTENCE: Persist sort_order to backend (batch update)
    debouncedPersistReorder(
      'inbox',
      async () => {
        // Use batch update endpoint for sort_order
        await persistWithRetry(
          () => persistSortOrder(newTasks, 'inbox'),
          1, // 1 retry
          1000 // 1 second delay
        );
        
        // Sync with server (but don't overwrite optimistic state if it matches)
        await onRefreshTasks();
        
        // Allow useEffect to sync with props again
        setIsReordering(false);
      },
      (error) => {
        // On error: keep optimistic UI, show error, but don't revert
        // This keeps the UI usable even if persistence fails
        setIsReordering(false);
        
        // Error toast is shown by persistSortOrder, so we just log here
        console.error("Failed to persist task order (UI order preserved):", error);
      }
    );
  };

  const handleSaveTask = async (taskId, taskData) => {
    if (taskId === null) {
      // Create new task
      if (onCreateTask) {
        try {
          await onCreateTask(taskData);
          await onRefreshTasks();
        } catch (error) {
          // INBOX_FULL error is expected - modal will be shown by MainApp
          // Don't show error toast or throw - the modal handles the flow
          if (error.message !== "INBOX_FULL") {
            console.error("Error creating task:", error);
          }
        }
      }
    } else {
      // Update existing task
      await onUpdateTask(taskId, taskData);
      
      // If priority changed and task is in inbox, refresh to reorder
      if (taskData.priority !== undefined && taskData.status === "inbox") {
        await onRefreshTasks();
      } else {
        // For other updates, still refresh to get latest state
        await onRefreshTasks();
      }
    }
  };

  const handleScheduleTask = async (taskId, date, time) => {
    await onUpdateTask(taskId, {
      scheduled_date: date,
      scheduled_time: time,
      status: "scheduled",
    });
  };

  const handleCompleteTask = async (taskId) => {
    await onUpdateTask(taskId, { status: "completed" });
  };

  const handleMoveToInbox = async (taskId) => {
    try {
      await apiClient.post(`/tasks/${taskId}/move-to-inbox`);
      await onRefreshTasks();
    } catch (error) {
      console.error("Error moving task to inbox:", error);
      toast.error("Failed to move task to inbox");
    }
  };

  const handleMoveUp = (taskId) => {
    const currentIndex = localInboxTasks.findIndex((t) => String(t.id) === String(taskId));
    if (currentIndex <= 0) return; // Already at top or not found
    if (localInboxTasks.length === 0) return; // Safety check: no tasks to reorder

    const newTasks = arrayMove(localInboxTasks, currentIndex, currentIndex - 1);
    reorderTasksAndUpdateSortOrder(newTasks);
  };

  const handleMoveDown = (taskId) => {
    const currentIndex = localInboxTasks.findIndex((t) => String(t.id) === String(taskId));
    if (currentIndex < 0 || currentIndex >= localInboxTasks.length - 1) return; // Already at bottom or not found
    if (localInboxTasks.length === 0) return; // Safety check: no tasks to reorder

    const newTasks = arrayMove(localInboxTasks, currentIndex, currentIndex + 1);
    reorderTasksAndUpdateSortOrder(newTasks);
  };

  const handleMakeNext = async (taskId) => {
    // Auth guard - ensure user is available
    if (!taskId) {
      console.warn("handleMakeNext: taskId is missing");
      return;
    }

    // Check if task is already in Next Today
    const isAlreadyNext = localNextTasks.some((t) => String(t.id) === String(taskId));
    if (isAlreadyNext) {
      return; // Already in Next Today, no-op
    }

    // Check Next Today cap (1 task max)
    if (localNextTasks.length >= NEXT_TODAY_CAP) {
      toast.error(`Next Today is full (${NEXT_TODAY_CAP}). Finish or move something out first.`);
      return;
    }

    const taskToMakeNext = localInboxTasks.find((t) => String(t.id) === String(taskId));
    if (!taskToMakeNext) {
      console.warn("handleMakeNext: task not found in inbox tasks:", taskId);
      return;
    }

    try {
      // Optimistic update: add task to Next Today, remove from inbox
      setLocalNextTasks((prev) => [...prev, taskToMakeNext]);
      setLocalInboxTasks((prev) => prev.filter((t) => String(t.id) !== String(taskId)));

      // API call - minimal payload (backend only updates status field)
      await apiClient.post(`/tasks/${taskId}/make-next`);
      await onRefreshTasks();
      toast.success("Task added to Next Today");
    } catch (error) {
      // Revert optimistic update on error
      setLocalNextTasks((prev) => prev.filter((t) => String(t.id) !== String(taskId)));
      setLocalInboxTasks((prev) => [...prev, taskToMakeNext]);
      
      toast.error(handleApiError(error, "Failed to set task as next"), {
        id: 'make-next-error', // Deduplicate
        duration: 5000,
      });
    }
  };

  const activeTask = activeId
    ? localInboxTasks.find((t) => String(t.id) === String(activeId)) || localNextTasks.find((t) => String(t.id) === String(activeId))
    : null;

  // Inbox droppable zone
  function InboxDropzone({ children, className = "" }) {
    const { setNodeRef } = useDroppable({
      id: "inbox-dropzone",
    });

    return (
      <div
        ref={setNodeRef}
        className={`min-h-[400px] ${className}`}
      >
        {children}
      </div>
    );
  }

  if (localInboxTasks.length === 0 && localNextTasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20" data-testid="inbox-empty">
        <div className="w-20 h-20 rounded-full bg-card flex items-center justify-center mb-6">
          <Inbox className="w-10 h-10 text-muted-foreground" />
        </div>
        <h3 className="text-xl font-semibold mb-2">Your inbox is empty</h3>
        <p className="text-muted-foreground text-center max-w-md">
          Click the "Braindump" button and speak to add tasks. The AI will help prioritize them for you.
        </p>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="w-full max-w-6xl">
        <div className="grid grid-cols-12 gap-6">
          {/* Inbox Column */}
          <div className="col-span-12 lg:col-span-6 flex flex-col">
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-2xl font-semibold">Inbox</h2>
                <div className="flex items-center gap-3">
                  <p className="text-muted-foreground">
                    {localInboxTasks.length}/{INBOX_CAP} {localInboxTasks.length === 1 ? "Task" : "Tasks"}
                  </p>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setEditingTask(undefined)} // undefined means create mode
                    className="h-8 w-8"
                    data-testid="add-task-button"
                    title="Add Task"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Your unscheduled tasks
              </p>
            </div>

            <InboxDropzone className="flex-1">
              <SortableContext
                items={[...localInboxTasks.map((t) => String(t.id)), ...localNextTasks.map((t) => String(t.id))]}
                strategy={verticalListSortingStrategy}
              >
                {localInboxTasks.map((task, index) => (
                  <SortableTaskCard
                    key={task.id}
                    task={task}
                    index={index}
                    totalTasks={localInboxTasks.length}
                    onUpdateTask={onUpdateTask}
                    onDeleteTask={onDeleteTask}
                    onScheduleTask={handleScheduleTask}
                    onCompleteTask={handleCompleteTask}
                    onMakeNext={handleMakeNext}
                    onMoveToInbox={null}
                    onMoveUp={handleMoveUp}
                    onMoveDown={handleMoveDown}
                    onClick={() => setEditingTask(task)}
                    activeId={activeId}
                  />
                ))}
              </SortableContext>
            </InboxDropzone>
          </div>

          {/* Next Today Column */}
          <div className="col-span-12 lg:col-span-6 flex flex-col">
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-2xl font-semibold">Next Today</h2>
                <p className="text-muted-foreground">
                  {localNextTasks.length}/{NEXT_TODAY_CAP} {localNextTasks.length === 1 ? "Task" : "Tasks"}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                Your priority tasks for today
              </p>
            </div>
            
            {/* Next Today Dropzone */}
            <div
              ref={(el) => {
                if (el) {
                  // Store ref for drag-and-drop
                  el.setAttribute('data-dropzone', 'next-slot');
                }
              }}
              id="next-slot"
              className="flex-1 space-y-3 min-h-[200px]"
            >
              {localNextTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[200px] border-2 border-dashed border-border rounded-lg bg-card/30">
                  <p className="text-sm text-muted-foreground text-center">
                    Drag tasks from Inbox here
                  </p>
                </div>
              ) : (
                localNextTasks.map((task, index) => (
            <NextSlot
                    key={task.id}
                    task={task}
              inboxTasks={localInboxTasks}
              onUpdateTask={onUpdateTask}
              onDeleteTask={onDeleteTask}
              onScheduleTask={handleScheduleTask}
              onCompleteTask={handleCompleteTask}
              onMoveToInbox={handleMoveToInbox}
              onEditTask={(task) => setEditingTask(task)}
              onMakeNext={handleMakeNext}
              onCreateTask={onCreateTask}
              onRefreshTasks={onRefreshTasks}
                    currentEnergy={currentEnergy}
                    onEnergyChange={onEnergyChange || (() => {})}
            />
                ))
              )}
            </div>
          </div>
        </div>
      </div>

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
              onMakeNext={handleMakeNext}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              onClick={() => {}}
              isDragging={true}
              activeId={activeId}
            />
          </div>
        ) : null}
      </DragOverlay>

      {/* Edit/Create Dialog */}
      <TaskEditDialog
        task={editingTask === undefined ? null : editingTask}
        open={editingTask !== null}
        onOpenChange={(open) => {
          if (!open) setEditingTask(null);
        }}
        onSave={handleSaveTask}
        onDelete={onDeleteTask}
      />
    </DndContext>
  );
}

