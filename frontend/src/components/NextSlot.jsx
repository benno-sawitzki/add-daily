import { useDroppable } from "@dnd-kit/core";
import NextControlCenter from "./NextControlCenter";
import TaskEditDialog from "./TaskEditDialog";
import { useState } from "react";

export default function NextSlot({ 
  task, 
  inboxTasks,
  onUpdateTask, 
  onDeleteTask,
  onScheduleTask,
  onCompleteTask,
  onMoveToInbox,
  onEditTask,
  onMakeNext,
  onCreateTask,
  onRefreshTasks,
  onClick,
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: "next-slot",
  });

  const [editingTask, setEditingTask] = useState(null);
  const [currentEnergy, setCurrentEnergy] = useState(() => {
    // Load from localStorage or default to medium
    try {
      return localStorage.getItem('user_energy') || 'medium';
    } catch {
      return 'medium';
    }
  });

  const handleEnergyChange = (energy) => {
    setCurrentEnergy(energy);
    try {
      localStorage.setItem('user_energy', energy);
    } catch (error) {
      console.error('Error saving energy preference:', error);
    }
  };

  const handleEditTask = (taskToEdit) => {
    setEditingTask(taskToEdit);
  };

  return (
    <>
      <div
        ref={setNodeRef}
        className={`lg:sticky lg:top-24 transition-all ${
          isOver ? "scale-105" : ""
        }`}
      >
        <NextControlCenter
          task={task}
          inboxTasks={inboxTasks || []}
          currentEnergy={currentEnergy}
          onEnergyChange={handleEnergyChange}
          onUpdateTask={onUpdateTask}
          onDeleteTask={onDeleteTask}
          onScheduleTask={onScheduleTask}
          onCompleteTask={onCompleteTask}
          onMoveToInbox={onMoveToInbox}
          onEditTask={handleEditTask}
          onMakeNext={onMakeNext}
          onCreateTask={onCreateTask}
          onRefreshTasks={onRefreshTasks}
          onClick={onClick || (() => setEditingTask(task))}
        />
      </div>

      {/* Edit Dialog */}
      <TaskEditDialog
        task={editingTask}
        open={!!editingTask}
        onOpenChange={(open) => !open && setEditingTask(null)}
        onSave={onUpdateTask}
        onDelete={onDeleteTask}
      />
    </>
  );
}

