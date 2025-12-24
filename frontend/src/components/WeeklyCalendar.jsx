import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, CheckCircle2, Trash2 } from "lucide-react";
import { format, startOfWeek, addDays, isToday, addWeeks, subWeeks, parseISO } from "date-fns";
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";

const PRIORITY_COLORS = {
  4: "bg-rose-500/20 border-l-rose-500 text-rose-100",
  3: "bg-amber-500/20 border-l-amber-500 text-amber-100",
  2: "bg-primary/20 border-l-primary text-primary-foreground",
  1: "bg-muted/30 border-l-muted-foreground text-muted-foreground",
};

// Generate time slots from 6 AM to 10 PM in 30-min intervals
const TIME_SLOTS = [];
for (let hour = 6; hour <= 22; hour++) {
  TIME_SLOTS.push(`${hour.toString().padStart(2, "0")}:00`);
  TIME_SLOTS.push(`${hour.toString().padStart(2, "0")}:30`);
}

function DraggableTask({ task, onComplete, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group p-1.5 rounded border-l-2 cursor-grab active:cursor-grabbing text-xs ${PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[2]} hover:ring-1 hover:ring-primary/50 transition-all`}
      data-testid={`calendar-task-${task.id}`}
    >
      <p className="font-medium truncate leading-tight">{task.title}</p>
      <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          className="p-0.5 hover:bg-white/10 rounded"
          onClick={(e) => {
            e.stopPropagation();
            onComplete(task.id);
          }}
        >
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
        </button>
        <button
          className="p-0.5 hover:bg-white/10 rounded"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(task.id);
          }}
        >
          <Trash2 className="w-3 h-3 text-rose-400" />
        </button>
      </div>
    </div>
  );
}

function TimeSlotCell({ date, time, tasks, onComplete, onDelete }) {
  const dateStr = format(date, "yyyy-MM-dd");
  const slotId = `${dateStr}|${time}`;
  const { setNodeRef, isOver } = useDroppable({ id: slotId });

  // Find tasks for this specific slot
  const slotTasks = tasks.filter((t) => {
    if (t.scheduled_date !== dateStr) return false;
    if (!t.scheduled_time) return false;
    // Match exact time or within the 30-min slot
    const taskTime = t.scheduled_time;
    return taskTime === time || (taskTime > time && taskTime < getNextSlot(time));
  });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[40px] border-b border-r border-border/20 p-0.5 transition-colors ${
        isOver ? "bg-primary/10" : ""
      }`}
      data-testid={`slot-${slotId}`}
    >
      {slotTasks.map((task) => (
        <DraggableTask
          key={task.id}
          task={task}
          onComplete={onComplete}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function getNextSlot(time) {
  const [hours, mins] = time.split(":").map(Number);
  if (mins === 0) {
    return `${hours.toString().padStart(2, "0")}:30`;
  } else {
    return `${(hours + 1).toString().padStart(2, "0")}:00`;
  }
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
    const task = event.active.data.current?.task || tasks.find((t) => t.id === event.active.id);
    setActiveTask(task);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const taskId = active.id;
    const [newDate, newTime] = over.id.split("|");

    if (newDate && newTime) {
      onUpdateTask(taskId, {
        scheduled_date: newDate,
        scheduled_time: newTime,
        status: "scheduled",
      });
    }
  };

  const handleComplete = (taskId) => {
    onUpdateTask(taskId, { status: "completed" });
  };

  // Get current time indicator position
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const isCurrentWeek = weekDays.some((d) => isToday(d));

  return (
    <div className="space-y-4" data-testid="weekly-calendar">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Weekly Calendar</h2>
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
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="border border-border/30 rounded-xl overflow-hidden bg-card/30">
          {/* Day Headers */}
          <div className="grid grid-cols-[60px_repeat(7,1fr)] bg-card/50 border-b border-border/30">
            <div className="p-2 text-xs text-muted-foreground text-center border-r border-border/20">
              Time
            </div>
            {weekDays.map((day) => (
              <div
                key={format(day, "yyyy-MM-dd")}
                className={`p-2 text-center border-r border-border/20 last:border-r-0 ${
                  isToday(day) ? "bg-primary/10" : ""
                }`}
              >
                <div className={`text-xs ${isToday(day) ? "text-primary" : "text-muted-foreground"}`}>
                  {format(day, "EEE")}
                </div>
                <div className={`text-lg font-semibold ${isToday(day) ? "text-primary" : ""}`}>
                  {format(day, "d")}
                </div>
              </div>
            ))}
          </div>

          {/* Time Slots Grid */}
          <div className="max-h-[600px] overflow-y-auto">
            {TIME_SLOTS.map((time, timeIndex) => {
              const isHourMark = time.endsWith(":00");
              const [hours] = time.split(":").map(Number);
              
              return (
                <div
                  key={time}
                  className={`grid grid-cols-[60px_repeat(7,1fr)] ${isHourMark ? "border-t border-border/30" : ""}`}
                >
                  {/* Time Label */}
                  <div className={`p-1 text-xs text-muted-foreground text-right pr-2 border-r border-border/20 ${isHourMark ? "" : "text-transparent"}`}>
                    {isHourMark ? format(new Date().setHours(hours, 0), "h a") : "00"}
                  </div>

                  {/* Day Columns */}
                  {weekDays.map((day) => (
                    <TimeSlotCell
                      key={`${format(day, "yyyy-MM-dd")}-${time}`}
                      date={day}
                      time={time}
                      tasks={scheduledTasks}
                      onComplete={handleComplete}
                      onDelete={onDeleteTask}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        <DragOverlay>
          {activeTask && (
            <div className={`p-2 rounded border-l-2 bg-card shadow-xl text-xs ${PRIORITY_COLORS[activeTask.priority]}`}>
              <p className="font-medium">{activeTask.title}</p>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Legend */}
      <div className="flex items-center gap-6 mt-4 text-xs text-muted-foreground">
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
