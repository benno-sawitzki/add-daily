import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, CheckCircle2, Trash2, Clock } from "lucide-react";
import { format, addDays, subDays, isToday, isSameDay } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

const PRIORITY_COLORS = {
  4: "border-l-rose-500 bg-rose-500/10",
  3: "border-l-amber-500 bg-amber-500/10",
  2: "border-l-primary bg-primary/10",
  1: "border-l-muted-foreground bg-muted/50",
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export default function DailyCalendar({ tasks, onUpdateTask, onDeleteTask }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const dateStr = format(currentDate, "yyyy-MM-dd");

  const dayTasks = tasks.filter(
    (t) => t.scheduled_date === dateStr && (t.status === "scheduled" || t.status === "inbox")
  );

  const completedTasks = tasks.filter(
    (t) => t.scheduled_date === dateStr && t.status === "completed"
  );

  const getTasksForHour = (hour) => {
    return dayTasks.filter((t) => {
      if (!t.scheduled_time) return hour === 9; // Default to 9 AM
      const taskHour = parseInt(t.scheduled_time.split(":")[0], 10);
      return taskHour === hour;
    });
  };

  const handleComplete = (taskId) => {
    onUpdateTask(taskId, { status: "completed" });
  };

  const handleSetTime = (taskId, hour) => {
    const timeStr = `${hour.toString().padStart(2, "0")}:00`;
    onUpdateTask(taskId, { scheduled_time: timeStr });
  };

  return (
    <div className="space-y-4" data-testid="daily-calendar">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Daily View</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCurrentDate(subDays(currentDate, 1))}
            data-testid="prev-day"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <span className="text-sm font-medium min-w-[180px] text-center">
            {format(currentDate, "EEEE, MMMM d, yyyy")}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCurrentDate(addDays(currentDate, 1))}
            data-testid="next-day"
          >
            <ChevronRight className="w-5 h-5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentDate(new Date())}
            className="ml-2"
            data-testid="today-btn-daily"
          >
            Today
          </Button>
        </div>
      </div>

      {/* Day indicator */}
      {isToday(currentDate) && (
        <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-lg mb-4">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
          <span className="text-sm text-primary font-medium">Today</span>
        </div>
      )}

      {/* Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-[80px_1fr] gap-0">
        {HOURS.slice(6, 22).map((hour) => {
          const hourTasks = getTasksForHour(hour);
          const currentHour = new Date().getHours();
          const isCurrentHour = isToday(currentDate) && hour === currentHour;

          return (
            <div key={hour} className="contents">
              {/* Time label */}
              <div className={`py-3 pr-4 text-right ${isCurrentHour ? "text-primary" : "text-muted-foreground"}`}>
                <span className="text-xs font-medium">
                  {format(new Date().setHours(hour, 0), "h a")}
                </span>
              </div>

              {/* Time slot */}
              <div
                className={`min-h-[60px] border-t border-border/30 py-2 pl-4 ${isCurrentHour ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                data-testid={`hour-slot-${hour}`}
              >
                <AnimatePresence mode="popLayout">
                  {hourTasks.map((task) => (
                    <motion.div
                      key={task.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className={`group p-3 rounded-lg border-l-2 mb-2 ${PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[2]}`}
                      data-testid={`daily-task-${task.id}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-medium">{task.title}</p>
                          {task.description && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                              {task.description}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-emerald-500"
                            onClick={() => handleComplete(task.id)}
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => onDeleteTask(task.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          );
        })}
      </div>

      {/* Completed tasks */}
      {completedTasks.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-medium text-muted-foreground mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            Completed Today ({completedTasks.length})
          </h3>
          <div className="space-y-2">
            {completedTasks.map((task) => (
              <div
                key={task.id}
                className="p-3 rounded-lg bg-card/30 opacity-60 line-through"
              >
                {task.title}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
