import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles, Clock, ArrowLeft, X } from "lucide-react";
import { useState } from "react";

export default function InboxFullModal({
  open,
  onOpenChange,
  taskToAdd,
  existingInboxTasks,
  onSetAsNext,
  onSendToLater,
  onReplaceTask,
  onCancel,
}) {
  const [selectedReplaceTaskId, setSelectedReplaceTaskId] = useState(null);
  const [action, setAction] = useState(null); // 'next' | 'later' | 'replace' | null

  const handleApply = () => {
    if (action === 'next' && onSetAsNext) {
      onSetAsNext();
    } else if (action === 'later' && onSendToLater) {
      onSendToLater();
    } else if (action === 'replace' && selectedReplaceTaskId && onReplaceTask) {
      onReplaceTask(selectedReplaceTaskId);
    } else {
      onCancel();
    }
    // Reset state
    setAction(null);
    setSelectedReplaceTaskId(null);
    onOpenChange(false);
  };

  const handleCancel = () => {
    setAction(null);
    setSelectedReplaceTaskId(null);
    if (onCancel) onCancel();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Inbox is full (7)</DialogTitle>
          <DialogDescription>
            Choose what to do with this task: "{taskToAdd?.title || 'Untitled'}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Set as Next */}
          <Button
            variant={action === 'next' ? 'default' : 'outline'}
            className="w-full justify-start gap-2 h-auto py-3"
            onClick={() => setAction('next')}
          >
            <Sparkles className="w-4 h-4" />
            <div className="flex flex-col items-start">
              <span className="font-medium">Set as Next</span>
              <span className="text-xs text-muted-foreground">Swap rules still apply</span>
            </div>
          </Button>

          {/* Send to Later */}
          <Button
            variant={action === 'later' ? 'default' : 'outline'}
            className="w-full justify-start gap-2 h-auto py-3"
            onClick={() => setAction('later')}
          >
            <Clock className="w-4 h-4" />
            <div className="flex flex-col items-start">
              <span className="font-medium">Send to Later</span>
              <span className="text-xs text-muted-foreground">Will expire in 14 days</span>
            </div>
          </Button>

          {/* Replace an existing task */}
          <div className="space-y-2">
            <Button
              variant={action === 'replace' ? 'default' : 'outline'}
              className="w-full justify-start gap-2 h-auto py-3"
              onClick={() => setAction('replace')}
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="font-medium">Replace an existing inbox task</span>
            </Button>
            {action === 'replace' && (
              <Select
                value={selectedReplaceTaskId || ''}
                onValueChange={setSelectedReplaceTaskId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select task to replace..." />
                </SelectTrigger>
                <SelectContent>
                  {existingInboxTasks.map((task) => (
                    <SelectItem key={task.id} value={task.id}>
                      {task.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Cancel */}
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={handleCancel}
          >
            <X className="w-4 h-4" />
            <span>Cancel</span>
          </Button>
        </div>

        {action && action !== 'cancel' && (
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              onClick={handleApply}
              disabled={action === 'replace' && !selectedReplaceTaskId}
            >
              Apply
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

