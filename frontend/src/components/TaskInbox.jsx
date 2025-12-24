import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  CheckCircle2,
  Trash2,
  Clock,
  MoreVertical,
  Calendar,
  AlertCircle,
  ArrowUp,
  ArrowRight,
  ArrowDown,
  Inbox,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import TaskEditDialog from "./TaskEditDialog";

const PRIORITY_CONFIG = {
  4: { label: "Critical", color: "text-rose-400", bg: "bg-rose-500/10", border: "border-l-rose-500", icon: AlertCircle },
  3: { label: "High", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-l-amber-500", icon: ArrowUp },
  2: { label: "Medium", color: "text-primary", bg: "bg-primary/10", border: "border-l-primary", icon: ArrowRight },
  1: { label: "Low", color: "text-muted-foreground", bg: "bg-muted/50", border: "border-l-muted-foreground", icon: ArrowDown },
};

export default function TaskInbox({ tasks, onUpdateTask, onDeleteTask }) {
  const [editingTask, setEditingTask] = useState(null);
  const sortedTasks = [...tasks].sort((a, b) => b.priority - a.priority);

  const handleScheduleTask = (taskId, date) => {
    onUpdateTask(taskId, {
      scheduled_date: date,
      status: "scheduled",
    });
  };

  const handleCompleteTask = (taskId) => {
    onUpdateTask(taskId, { status: "completed" });
  };

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20" data-testid="inbox-empty">
        <div className="w-20 h-20 rounded-full bg-card flex items-center justify-center mb-6">
          <Inbox className="w-10 h-10 text-muted-foreground" />
        </div>
        <h3 className="text-xl font-semibold mb-2">Your inbox is empty</h3>
        <p className="text-muted-foreground text-center max-w-md">
          Click the "Add Tasks" button and speak to add tasks. The AI will help prioritize them for you.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="task-inbox">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Task Inbox</h2>
        <p className="text-muted-foreground">{tasks.length} tasks</p>
      </div>

      <AnimatePresence mode="popLayout">
        {sortedTasks.map((task, index) => {
          const priorityConfig = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG[2];
          const PriorityIcon = priorityConfig.icon;

          return (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -100 }}
              transition={{ delay: index * 0.05 }}
            >
              <Card
                className={`task-card group p-4 border-l-4 ${priorityConfig.border} bg-card/50 hover:bg-card transition-all cursor-pointer`}
                data-testid={`task-card-${task.id}`}
                onClick={() => setEditingTask(task)}
              >
                <div className="flex items-start gap-4">
                  {/* Priority indicator */}
                  <div className={`flex-shrink-0 w-10 h-10 rounded-lg ${priorityConfig.bg} flex items-center justify-center`}>
                    <PriorityIcon className={`w-5 h-5 ${priorityConfig.color}`} />
                  </div>

                  {/* Task content */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-foreground truncate" data-testid={`task-title-${task.id}`}>
                      {task.title}
                    </h3>
                    {task.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {task.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${priorityConfig.bg} ${priorityConfig.color}`}>
                        {priorityConfig.label}
                      </span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <ArrowUp className="w-3 h-3" /> Urgency: {task.urgency}
                      </span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Importance: {task.importance}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                      onClick={() => handleCompleteTask(task.id)}
                      data-testid={`complete-task-${task.id}`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`task-menu-${task.id}`}>
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleScheduleTask(task.id, new Date().toISOString().split("T")[0])}
                          className="gap-2"
                        >
                          <Calendar className="w-4 h-4" />
                          Schedule for Today
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            const tomorrow = new Date();
                            tomorrow.setDate(tomorrow.getDate() + 1);
                            handleScheduleTask(task.id, tomorrow.toISOString().split("T")[0]);
                          }}
                          className="gap-2"
                        >
                          <Clock className="w-4 h-4" />
                          Schedule for Tomorrow
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => onDeleteTask(task.id)}
                          className="gap-2 text-destructive focus:text-destructive"
                          data-testid={`delete-task-${task.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete Task
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
