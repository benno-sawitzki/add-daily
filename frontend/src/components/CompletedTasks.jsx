import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  Trash2,
  RotateCcw,
  Calendar,
  Clock,
  Inbox,
} from "lucide-react";
import { format, parseISO } from "date-fns";

export default function CompletedTasks({ tasks, onRestoreTask, onDeleteTask }) {
  const [filter, setFilter] = useState("all"); // all, today, week

  const sortedTasks = [...tasks].sort((a, b) => {
    // Sort by completion date (most recent first)
    return new Date(b.created_at) - new Date(a.created_at);
  });

  const handleRestore = (taskId) => {
    onRestoreTask(taskId, { status: "inbox" });
  };

  const handleRestoreToCalendar = (task) => {
    onRestoreTask(task.id, { 
      status: "scheduled",
      scheduled_date: task.scheduled_date || format(new Date(), "yyyy-MM-dd"),
      scheduled_time: task.scheduled_time || "09:00"
    });
  };

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20" data-testid="completed-empty">
        <div className="w-20 h-20 rounded-full bg-card flex items-center justify-center mb-6">
          <CheckCircle2 className="w-10 h-10 text-emerald-600/60 dark:text-emerald-500/50" />
        </div>
        <h3 className="text-xl font-semibold mb-2">No completed tasks yet</h3>
        <p className="text-muted-foreground text-center max-w-md">
          When you complete tasks, they'll appear here. You can restore them or delete them permanently.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-0" data-testid="completed-tasks">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-500" />
            Completed Tasks
          </h2>
          <p className="text-muted-foreground mt-1">{tasks.length} tasks done</p>
        </div>
      </div>

      <div className="space-y-3">
        {sortedTasks.map((task) => {
          return (
            <Card
              key={task.id}
              className="task-card group p-4 border-l-4 border-l-emerald-500 bg-card/50 hover:bg-card transition-all opacity-75"
              data-testid={`completed-task-${task.id}`}
            >
              <div className="flex items-start gap-3">
                {/* Completed indicator - always green */}
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-emerald-500/20 dark:bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-500" />
                </div>

                {/* Task content */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-foreground/70 line-through truncate">
                    {task.title}
                  </h3>
                  {task.description && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2 whitespace-pre-line">
                      {task.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-3">
                    <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/20 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-500">
                      Completed
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => handleRestore(task.id)}
                    data-testid={`restore-inbox-${task.id}`}
                  >
                    <Inbox className="w-3.5 h-3.5 mr-1" />
                    To Inbox
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => handleRestoreToCalendar(task)}
                    data-testid={`restore-calendar-${task.id}`}
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    Reschedule
                  </Button>
                  <div className="w-px h-5 bg-border mx-1" />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => onDeleteTask(task.id)}
                    data-testid={`delete-completed-${task.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Clear all button */}
      {tasks.length > 0 && (
        <div className="pt-6 border-t border-border/50 mt-6">
          <Button
            variant="outline"
            className="text-muted-foreground hover:text-destructive hover:border-destructive"
            onClick={() => {
              tasks.forEach(t => onDeleteTask(t.id));
            }}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear All Completed
          </Button>
        </div>
      )}
    </div>
  );
}
