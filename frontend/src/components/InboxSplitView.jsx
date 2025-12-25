import { useState, useEffect } from "react";
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
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { Inbox, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import SortableTaskCard from "./SortableTaskCard";
import NextSlot from "./NextSlot";
import TaskEditDialog from "./TaskEditDialog";
import axios from "axios";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function InboxSplitView({
  inboxTasks,
  nextTask,
  onUpdateTask,
  onCreateTask,
  onDeleteTask,
  onRefreshTasks,
}) {
  const [editingTask, setEditingTask] = useState(null); // null = closed, undefined = create mode, task object = edit mode
  const [activeId, setActiveId] = useState(null);
  const [localInboxTasks, setLocalInboxTasks] = useState(inboxTasks);
  const [localNextTask, setLocalNextTask] = useState(nextTask);
  const [isReordering, setIsReordering] = useState(false);

  // Update local state when props change (but not during reordering)
  useEffect(() => {
    if (!isReordering) {
      setLocalInboxTasks(inboxTasks);
      setLocalNextTask(nextTask);
    }
  }, [inboxTasks, nextTask, isReordering]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    })
  );

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
      if (activeId === String(localNextTask?.id)) {
        // Dragging from Next to Inbox
        const taskToMove = localNextTask;
        try {
          // Optimistic update
          setLocalNextTask(null);
          setLocalInboxTasks((prev) => [taskToMove, ...prev]);

          // API call
          await axios.post(`${API}/tasks/${activeId}/move-to-inbox`);
          await onRefreshTasks();
        } catch (error) {
          // Revert on error
          setLocalNextTask(taskToMove);
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
          newIndex = localInboxTasks.findIndex((t) => String(t.id) === overId);
          // If we couldn't find the target task, don't move
          if (newIndex === -1) {
            console.warn(`Could not find target task with id: ${overId}`);
            return;
          }
        }

        // Only proceed if we have a valid new position
        if (oldIndex !== newIndex && newIndex !== -1) {
          const newTasks = arrayMove(localInboxTasks, oldIndex, newIndex);
          await reorderTasksAndUpdatePriorities(newTasks);
        }
      }
      return;
    }

    // Case 2: Dropping on Next slot
    if (overId === "next-slot") {
      const taskToMakeNext = localInboxTasks.find((t) => String(t.id) === activeId) || localNextTask;

      if (!taskToMakeNext) return;

      // If task is already next, no-op
      if (String(localNextTask?.id) === activeId) return;

      const previousNext = localNextTask;
      try {
        // Optimistic update: swap next task back to inbox, set new task as next
        setLocalNextTask(taskToMakeNext);
        setLocalInboxTasks((prev) => {
          const withoutActive = prev.filter((t) => String(t.id) !== activeId);
          if (previousNext) {
            return [previousNext, ...withoutActive];
          }
          return withoutActive;
        });

        // API call
        await axios.post(`${API}/tasks/${activeId}/make-next`);
        await onRefreshTasks();
      } catch (error) {
        // Revert on error
        setLocalNextTask(previousNext);
        setLocalInboxTasks((prev) => {
          if (previousNext) {
            return prev.filter((t) => String(t.id) !== String(previousNext.id));
          }
          return [...prev, taskToMakeNext];
        });
        console.error("Error making task next:", error);
        toast.error("Failed to set task as next");
      }
      return;
    }
  };

  // Helper function to reorder tasks and update priorities
  const reorderTasksAndUpdatePriorities = async (newTasks) => {
    // Prevent useEffect from resetting local state during reorder
    setIsReordering(true);
    
    // Save original order and priorities before making changes (for error recovery)
    const originalOrder = [...localInboxTasks];
    const originalPriorities = new Map(originalOrder.map(t => [t.id, t.priority]));
    
    // Optimistic update: update local state with new ORDER only
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

    // Update priorities on backend directly (bypass optimistic updates)
    // Only update priorities if the reorder is successfully persisted
    try {
      if (priorityUpdates.length > 0) {
        // Update priorities directly via API (not through onUpdateTask to avoid optimistic updates)
        await Promise.all(
          priorityUpdates.map(({ taskId, newPriority }) =>
            axios.patch(`${API}/tasks/${taskId}`, { priority: newPriority }).catch((error) => {
              console.error(`Failed to update priority for task ${taskId}:`, error);
              throw error; // Re-throw so Promise.all fails if any update fails
            })
          )
        );
        
        // All priority updates succeeded - refresh tasks to sync global state
        // This ensures the order and priorities are in sync
        await onRefreshTasks();
        
        // Allow useEffect to sync with props again
        setIsReordering(false);
      } else {
        // No priority updates needed, just allow sync
        setIsReordering(false);
      }
    } catch (error) {
      // If priority updates fail, revert BOTH order AND priorities
      // Restore original order with original priorities in local state
      const restoredTasks = originalOrder.map(task => ({
        ...task,
        priority: originalPriorities.get(task.id) ?? task.priority
      }));
      setLocalInboxTasks(restoredTasks);
      
      // Refresh tasks from server to ensure global state matches
      await onRefreshTasks();
      
      // Allow useEffect to sync with props again
      setIsReordering(false);
      
      console.error("Failed to update task priorities:", error);
      toast.error("Failed to save task order");
    }
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
      await axios.post(`${API}/tasks/${taskId}/move-to-inbox`);
      await onRefreshTasks();
    } catch (error) {
      console.error("Error moving task to inbox:", error);
      toast.error("Failed to move task to inbox");
    }
  };

  const handleMoveUp = async (taskId) => {
    const currentIndex = localInboxTasks.findIndex((t) => String(t.id) === String(taskId));
    if (currentIndex <= 0) return; // Already at top or not found

    const newTasks = arrayMove(localInboxTasks, currentIndex, currentIndex - 1);
    await reorderTasksAndUpdatePriorities(newTasks);
  };

  const handleMoveDown = async (taskId) => {
    const currentIndex = localInboxTasks.findIndex((t) => String(t.id) === String(taskId));
    if (currentIndex < 0 || currentIndex >= localInboxTasks.length - 1) return; // Already at bottom or not found

    const newTasks = arrayMove(localInboxTasks, currentIndex, currentIndex + 1);
    await reorderTasksAndUpdatePriorities(newTasks);
  };

  const handleMakeNext = async (taskId) => {
    const taskToMakeNext = localInboxTasks.find((t) => String(t.id) === String(taskId));
    if (!taskToMakeNext) return;

    const previousNext = localNextTask;
    try {
      // Optimistic update
      setLocalNextTask(taskToMakeNext);
      setLocalInboxTasks((prev) => {
        const withoutActive = prev.filter((t) => String(t.id) !== String(taskId));
        if (previousNext) {
          return [previousNext, ...withoutActive];
        }
        return withoutActive;
      });

      // API call
      await axios.post(`${API}/tasks/${taskId}/make-next`);
      await onRefreshTasks();
      toast.success("Task set as Next");
    } catch (error) {
      // Revert on error
      setLocalNextTask(previousNext);
      setLocalInboxTasks((prev) => {
        if (previousNext) {
          return prev.filter((t) => String(t.id) !== String(previousNext.id));
        }
        return [...prev, taskToMakeNext];
      });
      console.error("Error making task next:", error);
      const errorMessage = error.response?.data?.detail || error.message || "Failed to set task as next";
      toast.error(errorMessage);
    }
  };

  const activeTask = activeId
    ? localInboxTasks.find((t) => String(t.id) === String(activeId)) || localNextTask
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

  if (localInboxTasks.length === 0 && !localNextTask) {
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
                    {localInboxTasks.length} {localInboxTasks.length === 1 ? "task" : "tasks"}
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
                items={[...localInboxTasks.map((t) => t.id), ...(localNextTask ? [localNextTask.id] : [])]}
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
                  />
                ))}
              </SortableContext>
            </InboxDropzone>
          </div>

          {/* Next Column */}
          <div className="col-span-12 lg:col-span-6 flex flex-col">
            <NextSlot
              task={localNextTask}
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
            />
          </div>
        </div>
      </div>

      {/* Drag Overlay */}
      <DragOverlay>
        {activeTask ? (
          <div className="opacity-90">
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
            />
          </div>
        ) : null}
      </DragOverlay>

      {/* Edit/Create Dialog */}
      <TaskEditDialog
        task={editingTask}
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

