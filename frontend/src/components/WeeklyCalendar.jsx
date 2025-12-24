import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, CheckCircle2, Trash2, GripVertical } from "lucide-react";
import { format, startOfWeek, addDays, isToday, addWeeks, subWeeks } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

const PRIORITY_COLORS = {
  4: { bg: "bg-rose-500/90", border: "border-rose-400", text: "text-white" },
  3: { bg: "bg-amber-500/90", border: "border-amber-400", text: "text-white" },
  2: { bg: "bg-indigo-500/90", border: "border-indigo-400", text: "text-white" },
  1: { bg: "bg-slate-500/80", border: "border-slate-400", text: "text-white" },
};

// Generate time slots from 6 AM to 10 PM in 30-min intervals
const TIME_SLOTS = [];
for (let hour = 6; hour <= 22; hour++) {
  TIME_SLOTS.push(`${hour.toString().padStart(2, "0")}:00`);
  TIME_SLOTS.push(`${hour.toString().padStart(2, "0")}:30`);
}

export default function WeeklyCalendar({ tasks, onUpdateTask, onDeleteTask }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [draggedTask, setDraggedTask] = useState(null);
  const [dragOverSlot, setDragOverSlot] = useState(null);

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const scheduledTasks = tasks.filter((t) => t.status === "scheduled" || t.scheduled_date);

  const getTasksForSlot = (dateStr, time) => {
    return scheduledTasks.filter((t) => {
      if (t.scheduled_date !== dateStr) return false;
      if (!t.scheduled_time) return false;
      return t.scheduled_time === time;
    });
  };

  const handleDragStart = (e, task) => {
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", task.id);
    // Make drag image semi-transparent
    if (e.target) {
      e.target.style.opacity = "0.5";
    }
  };

  const handleDragEnd = (e) => {
    if (e.target) {
      e.target.style.opacity = "1";
    }
    setDraggedTask(null);
    setDragOverSlot(null);
  };

  const handleDragOver = (e, dateStr, time) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const slotId = `${dateStr}|${time}`;
    if (dragOverSlot !== slotId) {
      setDragOverSlot(slotId);
    }
  };

  const handleDragLeave = (e) => {
    // Only clear if leaving to outside
    if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget)) {
      setDragOverSlot(null);
    }
  };

  const handleDrop = (e, dateStr, time) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/plain");
    
    if (taskId) {
      onUpdateTask(taskId, {
        scheduled_date: dateStr,
        scheduled_time: time,
        status: "scheduled",
      });
    }
    
    setDraggedTask(null);
    setDragOverSlot(null);
  };

  const handleComplete = (taskId) => {
    onUpdateTask(taskId, { status: "completed" });
  };

  const TaskBlock = ({ task }) => {
    const colors = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[2];
    const isDragging = draggedTask?.id === task.id;

    return (
      <motion.div
        layout
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: isDragging ? 0.5 : 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        transition={{ duration: 0.15 }}
        draggable
        onDragStart={(e) => handleDragStart(e, task)}
        onDragEnd={handleDragEnd}
        className={`group relative px-2 py-1.5 rounded-md cursor-grab active:cursor-grabbing select-none
          ${colors.bg} ${colors.text} border ${colors.border}
          shadow-sm hover:shadow-md transition-shadow
          ${isDragging ? "ring-2 ring-white/50" : ""}`}
        data-testid={`task-block-${task.id}`}
      >
        <div className="flex items-center gap-1">
          <GripVertical className="w-3 h-3 opacity-50 flex-shrink-0" />
          <span className="text-xs font-medium truncate flex-1">{task.title}</span>
        </div>
        
        {/* Quick actions on hover */}
        <div className="absolute -right-1 -top-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleComplete(task.id);
            }}
            className="p-1 bg-emerald-500 rounded-full shadow-lg hover:bg-emerald-400 transition-colors"
          >
            <CheckCircle2 className="w-3 h-3 text-white" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteTask(task.id);
            }}
            className="p-1 bg-rose-500 rounded-full shadow-lg hover:bg-rose-400 transition-colors"
          >
            <Trash2 className="w-3 h-3 text-white" />
          </button>
        </div>
      </motion.div>
    );
  };

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
      <div className="border border-border/30 rounded-xl overflow-hidden bg-card/20 backdrop-blur-sm">
        {/* Day Headers - Fixed */}
        <div className="grid grid-cols-[70px_repeat(7,1fr)] bg-card/80 border-b border-border/30 sticky top-0 z-10">
          <div className="p-3 text-xs font-medium text-muted-foreground text-center border-r border-border/20">
            
          </div>
          {weekDays.map((day) => (
            <div
              key={format(day, "yyyy-MM-dd")}
              className={`p-3 text-center border-r border-border/20 last:border-r-0 transition-colors ${
                isToday(day) ? "bg-primary/20" : ""
              }`}
            >
              <div className={`text-xs uppercase tracking-wide ${isToday(day) ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                {format(day, "EEE")}
              </div>
              <div className={`text-xl font-bold mt-0.5 ${isToday(day) ? "text-primary" : ""}`}>
                {format(day, "d")}
              </div>
            </div>
          ))}
        </div>

        {/* Scrollable Time Grid */}
        <div className="max-h-[550px] overflow-y-auto overflow-x-hidden">
          {TIME_SLOTS.map((time) => {
            const isHourMark = time.endsWith(":00");
            const [hours] = time.split(":").map(Number);

            return (
              <div
                key={time}
                className={`grid grid-cols-[70px_repeat(7,1fr)] ${isHourMark ? "border-t border-border/40" : ""}`}
              >
                {/* Time Label */}
                <div className={`py-2 px-2 text-right border-r border-border/20 ${isHourMark ? "" : ""}`}>
                  <span className={`text-xs font-medium ${isHourMark ? "text-muted-foreground" : "text-transparent"}`}>
                    {isHourMark ? format(new Date().setHours(hours, 0), "h:mm a") : "."}
                  </span>
                </div>

                {/* Day Cells */}
                {weekDays.map((day) => {
                  const dateStr = format(day, "yyyy-MM-dd");
                  const slotId = `${dateStr}|${time}`;
                  const slotTasks = getTasksForSlot(dateStr, time);
                  const isOver = dragOverSlot === slotId;

                  return (
                    <div
                      key={slotId}
                      onDragOver={(e) => handleDragOver(e, dateStr, time)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, dateStr, time)}
                      className={`min-h-[36px] border-b border-r border-border/10 p-0.5 transition-all duration-100
                        ${isToday(day) ? "bg-primary/5" : ""}
                        ${isOver ? "bg-primary/20 ring-2 ring-inset ring-primary/50" : ""}
                        ${isHourMark ? "border-t border-t-border/20" : ""}
                        hover:bg-white/5`}
                      data-testid={`slot-${slotId}`}
                    >
                      <AnimatePresence mode="popLayout">
                        {slotTasks.map((task) => (
                          <TaskBlock key={task.id} task={task} />
                        ))}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 pt-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-rose-500/90"></div>
          Critical
        </span>
        <span className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-amber-500/90"></div>
          High
        </span>
        <span className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-indigo-500/90"></div>
          Medium
        </span>
        <span className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-slate-500/80"></div>
          Low
        </span>
      </div>
    </div>
  );
}
