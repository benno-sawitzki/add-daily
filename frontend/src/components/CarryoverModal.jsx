import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Clock, Sparkles } from "lucide-react";
import { useState, useEffect } from "react";

export default function CarryoverModal({
  open,
  onOpenChange,
  nextTask,
  inboxTasks,
  onKeepSelected,
  onSkipToday,
}) {
  const [selectedTasks, setSelectedTasks] = useState(new Set());

  // Initialize selection: Next + top 2 Inbox by default
  useEffect(() => {
    if (open && (nextTask || inboxTasks.length > 0)) {
      const defaultSelected = new Set();
      
      // Always include Next task if it exists
      if (nextTask) {
        defaultSelected.add(`next-${nextTask.id}`);
      }
      
      // Include top 2 inbox tasks (sorted by priority)
      const sortedInbox = [...inboxTasks].sort((a, b) => {
        // Sort by priority descending, then by created_at
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }
        return new Date(b.created_at) - new Date(a.created_at);
      });
      
      sortedInbox.slice(0, 2).forEach(task => {
        defaultSelected.add(`inbox-${task.id}`);
      });
      
      setSelectedTasks(defaultSelected);
    }
  }, [open, nextTask, inboxTasks]);

  const handleToggleTask = (taskId, isNext = false) => {
    const key = isNext ? `next-${taskId}` : `inbox-${taskId}`;
    setSelectedTasks(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleApply = () => {
    const keepTasks = [];
    const moveToLater = [];

    // Separate selected and unselected tasks
    if (nextTask) {
      if (selectedTasks.has(`next-${nextTask.id}`)) {
        keepTasks.push({ ...nextTask, type: 'next' });
      } else {
        moveToLater.push({ ...nextTask, type: 'next' });
      }
    }

    inboxTasks.forEach(task => {
      if (selectedTasks.has(`inbox-${task.id}`)) {
        keepTasks.push({ ...task, type: 'inbox' });
      } else {
        moveToLater.push({ ...task, type: 'inbox' });
      }
    });

    if (onKeepSelected) {
      onKeepSelected({ keepTasks, moveToLater });
    }
    onOpenChange(false);
  };

  const sortedInbox = [...inboxTasks].sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    return new Date(b.created_at) - new Date(a.created_at);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Carryover check
          </DialogTitle>
          <DialogDescription>
            Keep these tasks for tomorrow? The rest will be moved to Later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 max-h-[50vh] overflow-y-auto">
          {/* Next Task */}
          {nextTask && (
            <div className="flex items-start gap-3 p-3 rounded-lg border bg-card">
              <Checkbox
                checked={selectedTasks.has(`next-${nextTask.id}`)}
                onCheckedChange={() => handleToggleTask(nextTask.id, true)}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium text-primary">Next</span>
                </div>
                <h3 className="font-medium">{nextTask.title}</h3>
                {nextTask.description && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {nextTask.description}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Inbox Tasks */}
          {sortedInbox.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Inbox Tasks</h4>
              {sortedInbox.map((task, index) => (
                <div
                  key={task.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${
                    index < 2 ? "bg-card" : "bg-card/50"
                  }`}
                >
                  <Checkbox
                    checked={selectedTasks.has(`inbox-${task.id}`)}
                    onCheckedChange={() => handleToggleTask(task.id, false)}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium">{task.title}</h3>
                    {task.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {task.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-muted-foreground">
                        Priority: {task.priority}
                      </span>
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className="text-xs text-muted-foreground">
                        Urgency: {task.urgency}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!nextTask && inboxTasks.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <p>No tasks to carry over</p>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center pt-4 border-t">
          <Button variant="ghost" onClick={onSkipToday}>
            Skip today
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleApply}>
              Apply
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
