import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, CheckCircle2, Trash2, X } from "lucide-react";
import { format, startOfWeek, addDays, isToday, addWeeks, subWeeks } from "date-fns";

const PRIORITY_COLORS = {
  4: "bg-rose-500 text-white",
  3: "bg-amber-500 text-white",
  2: "bg-indigo-500 text-white",
  1: "bg-slate-500 text-white",
};

// Generate time slots from 6 AM to 10 PM in 30-min intervals
const TIME_SLOTS = [];
for (let hour = 6; hour <= 22; hour++) {
  TIME_SLOTS.push(`${hour.toString().padStart(2, "0")}:00`);
  TIME_SLOTS.push(`${hour.toString().padStart(2, "0")}:30`);
}

export default function WeeklyCalendar({ tasks, onUpdateTask, onDeleteTask }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedTask, setSelectedTask] = useState(null);

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

  const handleSlotClick = (dateStr, time) => {
    if (selectedTask) {
      // Move selected task to this slot
      onUpdateTask(selectedTask.id, {
        scheduled_date: dateStr,
        scheduled_time: time,
        status: "scheduled",
      });
      setSelectedTask(null);
    }
  };

  const handleTaskClick = (e, task) => {
    e.stopPropagation();
    if (selectedTask?.id === task.id) {
      setSelectedTask(null);
    } else {
      setSelectedTask(task);
    }
  };

  const handleComplete = (e, taskId) => {
    e.stopPropagation();
    onUpdateTask(taskId, { status: "completed" });
    setSelectedTask(null);
  };

  const handleDelete = (e, taskId) => {
    e.stopPropagation();
    onDeleteTask(taskId);
    setSelectedTask(null);
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

      {/* Selected task indicator */}
      {selectedTask && (
        <div className="flex items-center gap-3 p-3 bg-primary/20 rounded-lg border border-primary/30">
          <span className="text-sm">
            Moving: <strong>{selectedTask.title}</strong>
          </span>
          <span className="text-xs text-muted-foreground">Click on a time slot to place it</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedTask(null)}
            className="ml-auto"
          >
            <X className="w-4 h-4 mr-1" />
            Cancel
          </Button>
        </div>
      )}

      {/* Calendar Grid */}
      <div className="border border-border/30 rounded-xl overflow-hidden bg-card/20">
        {/* Day Headers */}
        <div className="grid grid-cols-[70px_repeat(7,1fr)] bg-card/80 border-b border-border/30">
          <div className="p-3 text-xs font-medium text-muted-foreground text-center border-r border-border/20" />
          {weekDays.map((day) => (
            <div
              key={format(day, "yyyy-MM-dd")}
              className={`p-3 text-center border-r border-border/20 last:border-r-0 ${
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
        <div className="max-h-[500px] overflow-y-auto">
          {TIME_SLOTS.map((time) => {
            const isHourMark = time.endsWith(":00");
            const [hours] = time.split(":").map(Number);

            return (
              <div
                key={time}
                className={`grid grid-cols-[70px_repeat(7,1fr)] ${isHourMark ? "border-t border-border/40" : ""}`}
              >
                {/* Time Label */}
                <div className="py-2 px-2 text-right border-r border-border/20">
                  <span className={`text-xs font-medium ${isHourMark ? "text-muted-foreground" : "text-transparent"}`}>
                    {isHourMark ? format(new Date().setHours(hours, 0), "h:mm a") : "."}
                  </span>
                </div>

                {/* Day Cells */}
                {weekDays.map((day) => {
                  const dateStr = format(day, "yyyy-MM-dd");
                  const slotTasks = getTasksForSlot(dateStr, time);

                  return (
                    <div
                      key={`${dateStr}-${time}`}
                      onClick={() => handleSlotClick(dateStr, time)}
                      className={`min-h-[32px] border-b border-r border-border/10 p-0.5 cursor-pointer
                        ${isToday(day) ? "bg-primary/5" : ""}
                        ${selectedTask ? "hover:bg-primary/20 hover:ring-2 hover:ring-inset hover:ring-primary/50" : "hover:bg-white/5"}
                      `}
                      data-testid={`slot-${dateStr}-${time}`}
                    >
                      {slotTasks.map((task) => {
                        const colors = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[2];
                        const isSelected = selectedTask?.id === task.id;

                        return (
                          <div
                            key={task.id}
                            onClick={(e) => handleTaskClick(e, task)}
                            className={`group relative px-2 py-1 rounded text-xs font-medium cursor-pointer
                              ${colors}
                              ${isSelected ? "ring-2 ring-white ring-offset-1 ring-offset-background" : ""}
                              hover:opacity-90
                            `}
                            data-testid={`task-block-${task.id}`}
                          >
                            <span className="truncate block">{task.title}</span>
                            
                            {/* Action buttons */}
                            <div className="absolute right-0 top-0 bottom-0 flex items-center gap-0.5 pr-1 opacity-0 group-hover:opacity-100">
                              <button
                                onClick={(e) => handleComplete(e, task.id)}
                                className="p-0.5 bg-white/20 rounded hover:bg-white/40"
                              >
                                <CheckCircle2 className="w-3 h-3" />
                              </button>
                              <button
                                onClick={(e) => handleDelete(e, task.id)}
                                className="p-0.5 bg-white/20 rounded hover:bg-white/40"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
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
          <div className="w-4 h-4 rounded bg-rose-500"></div>
          Critical
        </span>
        <span className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-amber-500"></div>
          High
        </span>
        <span className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-indigo-500"></div>
          Medium
        </span>
        <span className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-slate-500"></div>
          Low
        </span>
      </div>

      {/* Instructions */}
      <p className="text-center text-xs text-muted-foreground">
        Click a task to select it, then click a time slot to move it
      </p>
    </div>
  );
}
