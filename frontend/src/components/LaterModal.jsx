import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Clock, ArrowLeft, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";

export default function LaterModal({
  open,
  onOpenChange,
  laterTasks,
  onMoveToInbox,
  onDeleteTask,
}) {
  const handleMoveToInbox = async (taskId) => {
    if (onMoveToInbox) {
      await onMoveToInbox(taskId);
    }
  };

  const handleDelete = async (taskId) => {
    if (onDeleteTask) {
      await onDeleteTask(taskId);
    }
  };

  const getDaysUntilExpiry = (expiresAt) => {
    if (!expiresAt) return null;
    const expiry = parseISO(expiresAt);
    const now = new Date();
    const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Later Tasks</DialogTitle>
          <DialogDescription>
            Tasks in Later expire after 14 days. Move them back to Inbox when you're ready to work on them.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto max-h-[60vh] space-y-2 py-4">
          {laterTasks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No tasks in Later</p>
            </div>
          ) : (
            laterTasks.map((task) => {
              const daysUntilExpiry = getDaysUntilExpiry(task.expires_at);
              const isExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry <= 3;
              
              return (
                <Card key={task.id} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium mb-1">{task.title}</h3>
                      {task.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mb-2 whitespace-pre-line">
                          {task.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        {task.expires_at && (
                          <Badge 
                            variant={isExpiringSoon ? "destructive" : "outline"}
                            className="text-xs"
                          >
                            <Clock className="w-3 h-3 mr-1" />
                            {daysUntilExpiry !== null 
                              ? daysUntilExpiry === 0 
                                ? "Expires today"
                                : daysUntilExpiry === 1
                                ? "Expires tomorrow"
                                : `Expires in ${daysUntilExpiry} days`
                              : format(parseISO(task.expires_at), "MMM d")
                            }
                          </Badge>
                        )}
                        {task.priority && (
                          <Badge variant="outline" className="text-xs">
                            Priority: {task.priority}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleMoveToInbox(task.id)}
                        className="gap-2"
                      >
                        <ArrowLeft className="w-4 h-4" />
                        To Inbox
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(task.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

