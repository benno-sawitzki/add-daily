import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { X, Sparkles, Calendar as CalendarIcon, Check } from "lucide-react";
import { suggestTodayPlan } from "@/utils/todayPlan";
import axios from "axios";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const PRIORITY_COLORS = {
  4: "bg-rose-500",
  3: "bg-amber-500",
  2: "bg-indigo-500",
  1: "bg-slate-500",
};

const PRIORITY_LABELS = {
  4: "Critical",
  3: "High",
  2: "Medium",
  1: "Low",
};

export default function TodayPlanModal({
  tasks,
  taskRouting,
  onClose,
  onAccept,
}) {
  const [selectedNextId, setSelectedNextId] = useState(null);
  const [selectedTodayIds, setSelectedTodayIds] = useState(new Set());

  // Handle suggest
  const handleSuggest = () => {
    const suggestion = suggestTodayPlan(tasks, { routing: taskRouting });
    
    if (suggestion.nextTaskId) {
      setSelectedNextId(suggestion.nextTaskId);
    }
    
    if (suggestion.todayTaskIds && suggestion.todayTaskIds.length > 0) {
      setSelectedTodayIds(new Set(suggestion.todayTaskIds));
    } else {
      setSelectedTodayIds(new Set());
    }
  };

  // Handle Next selection (only one)
  const handleNextToggle = (taskId) => {
    if (selectedNextId === taskId) {
      setSelectedNextId(null);
    } else {
      setSelectedNextId(taskId);
    }
  };

  // Handle Today selection (up to 2)
  const handleTodayToggle = (taskId) => {
    const newSet = new Set(selectedTodayIds);
    if (newSet.has(taskId)) {
      newSet.delete(taskId);
    } else {
      if (newSet.size < 2) {
        newSet.add(taskId);
      } else {
        toast.info("You can select up to 2 tasks for Today");
        return;
      }
    }
    setSelectedTodayIds(newSet);
  };

  // Handle accept plan
  const handleAccept = async () => {
    if (!selectedNextId) {
      toast.error("Please select a Next task");
      return;
    }

    try {
      // Call onAccept with the plan (it will handle Next task setting and scheduling)
      if (onAccept) {
        await onAccept({
          nextTaskId: selectedNextId,
          todayTaskIds: Array.from(selectedTodayIds),
        });
      }
      onClose();
    } catch (error) {
      console.error("Error accepting plan:", error);
      const errorMessage = error.response?.data?.detail || error.message || "Failed to accept plan";
      toast.error(errorMessage);
    }
  };

  // Filter tasks that aren't calendar-locked
  const availableTasks = tasks.filter(task => {
    const isRoutedToCalendar = taskRouting && taskRouting[task.id] === 'calendar';
    const hasScheduledDateTime = task.scheduled_date && task.scheduled_time;
    // Exclude calendar-locked tasks
    return !(isRoutedToCalendar && hasScheduledDateTime);
  });

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-6 border-b border-border bg-card/50 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Plan My Day</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Select your Next task and up to 2 tasks for Today
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Next Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                Next (select 1)
              </h3>
              <Button
                onClick={handleSuggest}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                Suggest
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Suggested based on priority, urgency, and impakt.
            </p>
            <div className="space-y-2">
              {availableTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No available tasks
                </p>
              ) : (
                availableTasks.map((task) => {
                  const priorityColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[2];
                  const isSelected = selectedNextId === task.id;
                  
                  return (
                    <Card
                      key={task.id}
                      className={`p-3 cursor-pointer transition-all ${
                        isSelected
                          ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                          : "border-border hover:bg-card/50"
                      }`}
                      onClick={() => handleNextToggle(task.id)}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => handleNextToggle(task.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className={`flex-shrink-0 w-6 h-6 rounded-full ${priorityColor} flex items-center justify-center text-white text-xs font-bold`}>
                          {PRIORITY_LABELS[task.priority]?.charAt(0) || "M"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium line-clamp-1">{task.title}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${priorityColor} text-white`}>
                              {PRIORITY_LABELS[task.priority] || "Medium"}
                            </span>
                            {task.duration && (
                              <span className="text-xs text-muted-foreground">
                                {task.duration} min
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })
              )}
            </div>
          </div>

          {/* Today Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <CalendarIcon className="w-5 h-5 text-primary" />
                Today (select up to 2)
              </h3>
              <span className="text-sm text-muted-foreground">
                {selectedTodayIds.size} / 2
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Additional tasks to schedule for today
            </p>
            <div className="space-y-2">
              {availableTasks
                .filter(task => task.id !== selectedNextId) // Exclude selected Next task
                .length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No available tasks (excluding Next selection)
                </p>
              ) : (
                availableTasks
                  .filter(task => task.id !== selectedNextId)
                  .map((task) => {
                    const priorityColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[2];
                    const isSelected = selectedTodayIds.has(task.id);
                    const isDisabled = selectedTodayIds.size >= 2 && !isSelected;
                    
                    return (
                      <Card
                        key={task.id}
                        className={`p-3 cursor-pointer transition-all ${
                          isSelected
                            ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                            : isDisabled
                            ? "opacity-50 cursor-not-allowed"
                            : "border-border hover:bg-card/50"
                        }`}
                        onClick={() => !isDisabled && handleTodayToggle(task.id)}
                      >
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={isSelected}
                            disabled={isDisabled}
                            onCheckedChange={() => handleTodayToggle(task.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className={`flex-shrink-0 w-6 h-6 rounded-full ${priorityColor} flex items-center justify-center text-white text-xs font-bold`}>
                            {PRIORITY_LABELS[task.priority]?.charAt(0) || "M"}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium line-clamp-1">{task.title}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${priorityColor} text-white`}>
                                {PRIORITY_LABELS[task.priority] || "Medium"}
                              </span>
                              {task.duration && (
                                <span className="text-xs text-muted-foreground">
                                  {task.duration} min
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </Card>
                    );
                  })
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border bg-card/50 flex-shrink-0">
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={onClose}>
              Back
            </Button>
            <Button onClick={handleAccept} className="gap-2">
              <Check className="w-4 h-4" />
              Accept Plan
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

