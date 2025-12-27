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
  currentEnergy = 'medium',
  onEnergyChange,
}) {
  const [editingTask, setEditingTask] = useState(null);

  const handleEditTask = (taskToEdit) => {
    setEditingTask(taskToEdit);
  };

  return (
    <>
      <div className="lg:sticky lg:top-24">
        <NextControlCenter
          task={task}
          inboxTasks={inboxTasks || []}
          currentEnergy={currentEnergy}
          onEnergyChange={onEnergyChange}
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

