import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  Trash2,
  Clock,
  Calendar,
  AlertCircle,
  ArrowUp,
  ArrowRight,
  ArrowDown,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import TaskEditDialog from "./TaskEditDialog";
import apiClient from "@/lib/apiClient";
import { toast } from "sonner";

const PRIORITY_CONFIG = {
  4: { label: "Critical", color: "text-rose-400", bg: "bg-rose-500/10", border: "border-l-rose-500", icon: AlertCircle },
  3: { label: "High", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-l-amber-500", icon: ArrowUp },
  2: { label: "Medium", color: "text-primary", bg: "bg-primary/10", border: "border-l-primary", icon: ArrowRight },
  1: { label: "Low", color: "text-muted-foreground", bg: "bg-muted/50", border: "border-l-muted-foreground", icon: ArrowDown },
};

export default function DumpItemCard({ item, onUpdate, onDelete }) {
  const [editingItem, setEditingItem] = useState(null);
  const [scheduleMenuOpen, setScheduleMenuOpen] = useState(false);

  // Calculate priority from urgency + importance
  const calculatedPriority = item.urgency && item.importance 
    ? Math.round((parseInt(item.urgency) + parseInt(item.importance)) / 2)
    : (item.priority || 2);
  const displayPriority = item.priority && item.priority !== calculatedPriority 
    ? item.priority 
    : calculatedPriority;
  const priorityConfig = PRIORITY_CONFIG[displayPriority] || PRIORITY_CONFIG[2];
  const PriorityIcon = priorityConfig.icon;

  const status = item.status || 'new';
  const isPromoted = status === 'promoted';
  const isDismissed = status === 'dismissed';

  // Convert dump item to task-like format for TaskEditDialog
  const itemAsTask = {
    id: item.id,
    title: item.text || '',
    description: item.description || '',
    urgency: item.urgency || 2,
    importance: item.importance || 2,
    priority: item.priority || calculatedPriority,
    energy_required: item.energy_required || 'medium',
    scheduled_date: item.scheduled_date || null,
    scheduled_time: item.scheduled_time || '',
    duration: item.duration || 30,
    status: item.status || 'new',
  };

  const handleUpdate = async (itemId, updates) => {
    try {
      // Convert task-like updates to dump item updates
      const dumpItemUpdates = {
        text: updates.title, // Map title to text
        description: updates.description,
        urgency: updates.urgency,
        importance: updates.importance,
        priority: updates.priority,
        energy_required: updates.energy_required,
        scheduled_date: updates.scheduled_date,
        scheduled_time: updates.scheduled_time,
        duration: updates.duration,
      };
      await apiClient.patch(`/dump-items/${itemId}`, dumpItemUpdates);
      onUpdate();
      toast.success("Item updated");
    } catch (error) {
      toast.error("Failed to update item");
      console.error(error);
    }
  };

  const handleDelete = async (itemId) => {
    try {
      await apiClient.delete(`/dump-items/${itemId}`);
      onDelete();
      toast.success("Item deleted");
    } catch (error) {
      toast.error("Failed to delete item");
      console.error(error);
    }
  };

  const handleScheduleTask = async (date) => {
    const now = new Date();
    let hours = now.getHours();
    let minutes = now.getMinutes();
    
    if (minutes > 0 && minutes <= 30) {
      minutes = 30;
    } else if (minutes > 30) {
      minutes = 0;
      hours += 1;
    }
    
    if (hours < 6) hours = 9;
    if (hours > 22) hours = 9;
    
    const defaultTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    
    try {
      await apiClient.patch(`/dump-items/${item.id}`, {
        scheduled_date: date,
        scheduled_time: defaultTime,
      });
      onUpdate();
      toast.success("Item scheduled");
    } catch (error) {
      toast.error("Failed to schedule item");
      console.error(error);
    }
  };

  const handlePromoteItem = async () => {
    try {
      await apiClient.patch(`/dump-items/${item.id}`, {
        status: 'promoted',
      });
      onUpdate();
      toast.success("Item promoted");
    } catch (error) {
      toast.error("Failed to promote item");
      console.error(error);
    }
  };

  return (
    <>
      <Card
        className={`task-card group p-4 border-l-4 ${priorityConfig.border} bg-card/50 hover:bg-card transition-all cursor-pointer ${
          isPromoted 
            ? 'bg-emerald-500/10 border-emerald-500' 
            : isDismissed
              ? 'opacity-60 bg-muted/30'
              : ''
        }`}
        onClick={() => setEditingItem(itemAsTask)}
      >
        <div className="flex items-start gap-3">
          {/* Priority indicator */}
          <div className={`flex-shrink-0 w-10 h-10 rounded-lg ${priorityConfig.bg} flex items-center justify-center`}>
            <PriorityIcon className={`w-5 h-5 ${priorityConfig.color}`} />
          </div>

          {/* Item content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                status === 'promoted'
                  ? 'bg-emerald-500/20 text-emerald-500'
                  : status === 'dismissed'
                    ? 'bg-gray-500/20 text-gray-500'
                    : 'bg-blue-500/20 text-blue-500'
              }`}>
                {status === 'promoted' ? 'Promoted' : status === 'dismissed' ? 'Dismissed' : 'New'}
              </span>
              {isPromoted && item.created_task_id && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.location.href = '/app/inbox';
                  }}
                >
                  View Task
                  <ExternalLink className="w-3 h-3 ml-1" />
                </Button>
              )}
            </div>
            <h3 className="font-medium text-foreground truncate">
              {item.text || 'Untitled Item'}
            </h3>
            {item.description && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                {item.description}
              </p>
            )}
            <div className="flex items-center gap-3 mt-3">
              <span className={`text-xs px-2 py-1 rounded-full ${priorityConfig.bg} ${priorityConfig.color}`}>
                {priorityConfig.label}
              </span>
              {item.energy_required && (
                <span className="text-xs text-muted-foreground">
                  Energy: {item.energy_required}
                </span>
              )}
              {item.duration && (
                <span className="text-xs text-muted-foreground">
                  {item.duration} min
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
            {/* First row: Schedule and Next */}
            <div className="flex items-center gap-1">
              <Popover open={scheduleMenuOpen} onOpenChange={setScheduleMenuOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    title="Schedule item"
                  >
                    <Calendar className="w-4 h-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent 
                  className="w-40 p-1"
                  align="start"
                >
                  <Button
                    variant="ghost"
                    className="w-full justify-start h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleScheduleTask(new Date().toISOString().split("T")[0]);
                      setScheduleMenuOpen(false);
                    }}
                  >
                    <Calendar className="w-3.5 h-3.5 mr-2" />
                    Today
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full justify-start h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      const tomorrow = new Date();
                      tomorrow.setDate(tomorrow.getDate() + 1);
                      handleScheduleTask(tomorrow.toISOString().split("T")[0]);
                      setScheduleMenuOpen(false);
                    }}
                  >
                    <Clock className="w-3.5 h-3.5 mr-2" />
                    Tomorrow
                  </Button>
                </PopoverContent>
              </Popover>

              {status !== 'promoted' && (
                <>
                  <div className="w-px h-5 bg-border mx-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-primary hover:text-primary hover:bg-primary/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePromoteItem();
                    }}
                    title="Promote to task"
                  >
                    <Sparkles className="w-3.5 h-3.5 mr-1" />
                    Next
                  </Button>
                </>
              )}
            </div>

            {/* Second row: Done and Delete */}
            <div className="flex items-center gap-1">
              {status !== 'promoted' && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePromoteItem();
                    }}
                    title="Promote to task"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </Button>
                  <div className="w-px h-5 bg-border mx-1" />
                </>
              )}

              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(item.id);
                }}
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Edit Dialog */}
      <TaskEditDialog
        task={editingItem}
        open={!!editingItem}
        onOpenChange={(open) => !open && setEditingItem(null)}
        onSave={handleUpdate}
        onDelete={handleDelete}
      />
    </>
  );
}

