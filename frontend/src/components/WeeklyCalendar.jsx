import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, CheckCircle2, Trash2 } from "lucide-react";
import { format, startOfWeek, addDays, isSameDay, isToday, addWeeks, subWeeks } from "date-fns";
import {
  DndContext,
  closestCenter,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
} from "@dnd-kit/core";
import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDroppable } from "@dnd-kit/core";
import { motion } from "framer-motion";

const PRIORITY_COLORS = {
  4: "border-l-rose-500 bg-rose-500/5",
  3: "border-l-amber-500 bg-amber-500/5",
  2: "border-l-primary bg-primary/5",
  1: "border-l-muted-foreground bg-muted/20",
};

function DraggableTask({ task, onComplete, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group p-2 rounded-lg border-l-2 cursor-grab active:cursor-grabbing ${PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[2]} hover:ring-1 hover:ring-primary/30 transition-all`}
      data-testid={`calendar-task-${task.id}`}
    >
      <p className="text-sm font-medium truncate">{task.title}</p>
      {task.scheduled_time && (
        <p className="text-xs text-muted-foreground mt-1">{task.scheduled_time}</p>
      )}
      <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-emerald-500"
          onClick={(e) => {
            e.stopPropagation();
            onComplete(task.id);
          }}
        >
          <CheckCircle2 className="w-3 h-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(task.id);
          }}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

function DroppableDay({ date, tasks, onComplete, onDelete }) {
  const dateStr = format(date, "yyyy-MM-dd");
  const { setNodeRef, isOver } = useDroppable({ id: dateStr });
  const dayTasks = tasks.filter((t) => t.scheduled_date === dateStr);

  return (
    <div
      ref={setNodeRef}
      className={`calendar-day flex flex-col ${isToday(date) ? "ring-1 ring-primary" : ""} ${isOver ? "ring-2 ring-primary bg-primary/5" : ""}`}
      data-testid={`calendar-day-${dateStr}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-medium ${isToday(date) ? "text-primary" : "text-muted-foreground"}`}>
          {format(date, "EEE")}
        </span>
        <span className={`text-lg font-semibold ${isToday(date) ? "text-primary" : ""}`}>
          {format(date, "d")}
        </span>
      </div>
      <SortableContext items={dayTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex-1 space-y-2 min-h-[80px]">
          {dayTasks.map((task) => (
            <DraggableTask
              key={task.id}
              task={task}
              onComplete={onComplete}
              onDelete={onDelete}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

export default function WeeklyCalendar({ tasks, onUpdateTask, onDeleteTask }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [activeTask, setActiveTask] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const scheduledTasks = tasks.filter((t) => t.status === "scheduled" || t.scheduled_date);

  const handleDragStart = (event) => {
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const taskId = active.id;
    const newDate = over.id;

    // Only update if dropped on a different day
    const task = tasks.find((t) => t.id === taskId);
    if (task && task.scheduled_date !== newDate) {
      onUpdateTask(taskId, {
        scheduled_date: newDate,
        status: "scheduled",
      });
    }
  };

  const handleComplete = (taskId) => {
    onUpdateTask(taskId, { status: "completed" });
  };

  return (
    <div className="space-y-4" data-testid="weekly-calendar">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Weekly View</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCurrentDate(subWeeks(currentDate, 1))}
            data-testid="prev-week"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <span className="text-sm font-medium min-w-[180px] text-center">
            {format(weekStart, "MMM d")} - {format(addDays(weekStart, 6), "MMM d, yyyy")}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCurrentDate(addWeeks(currentDate, 1))}
            data-testid="next-week"
          >
            <ChevronRight className="w-5 h-5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentDate(new Date())}
            className="ml-2"
            data-testid="today-btn"
          >
            Today
          </Button>
        </div>
      </div>

      {/* Calendar Grid */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="calendar-grid">
          {weekDays.map((day) => (
            <DroppableDay
              key={format(day, "yyyy-MM-dd")}
              date={day}
              tasks={scheduledTasks}
              onComplete={handleComplete}
              onDelete={onDeleteTask}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask && (
            <div className={`p-2 rounded-lg border-l-2 bg-card shadow-xl ${PRIORITY_COLORS[activeTask.priority]}`}>
              <p className="text-sm font-medium">{activeTask.title}</p>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Legend */}
      <div className="flex items-center gap-6 mt-6 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-rose-500/30 border-l-2 border-rose-500"></div>
          Critical
        </span>
        <span className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-amber-500/30 border-l-2 border-amber-500"></div>
          High
        </span>
        <span className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-primary/30 border-l-2 border-primary"></div>
          Medium
        </span>
        <span className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-muted/30 border-l-2 border-muted-foreground"></div>
          Low
        </span>
      </div>
    </div>
  );
}
