import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, CheckCircle2, Trash2 } from "lucide-react";
import { format, addDays, subDays, isToday } from "date-fns";
import TaskEditDialog from "./TaskEditDialog";

const PRIORITY_COLORS = {
  4: "bg-rose-500 text-white",
  3: "bg-amber-500 text-white",
  2: "bg-indigo-500 text-white",
  1: "bg-slate-500 text-white",
};

const SLOT_HEIGHT = 40; // Height of each 30-min slot in pixels

// Generate time slots from 6 AM to 10 PM in 30-min intervals
const TIME_SLOTS = [];
for (let hour = 6; hour <= 22; hour++) {
  TIME_SLOTS.push(`${hour.toString().padStart(2, "0")}:00`);
  TIME_SLOTS.push(`${hour.toString().padStart(2, "0")}:30`);
}

export default function DailyCalendar({ tasks, onUpdateTask, onDeleteTask }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dropTarget, setDropTarget] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [resizing, setResizing] = useState(null);
  const timeLineRef = useRef(null);
  const dragTaskRef = useRef(null);
  const resizeStartY = useRef(null);
  const resizeStartDuration = useRef(null);

  const dateStr = format(currentDate, "yyyy-MM-dd");

  // Update current time every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // Scroll to current time on mount
  useEffect(() => {
    if (timeLineRef.current && isToday(currentDate)) {
      timeLineRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentDate]);

  const dayTasks = tasks.filter(
    (t) => t.scheduled_date === dateStr && (t.status === "scheduled" || t.status === "inbox")
  );

  const completedTasks = tasks.filter(
    (t) => t.scheduled_date === dateStr && t.status === "completed"
  );

  const getTasksForSlot = (time) => {
    return dayTasks.filter((t) => t.scheduled_time === time);
  };

  // Calculate current time position
  const getCurrentTimePosition = () => {
    const hours = currentTime.getHours();
    const minutes = currentTime.getMinutes();
    if (hours < 6 || hours > 22) return null;
    const slotIndex = (hours - 6) * 2 + (minutes >= 30 ? 1 : 0);
    const minuteOffset = (minutes % 30) / 30 * SLOT_HEIGHT;
    return slotIndex * SLOT_HEIGHT + minuteOffset;
  };

  const handleDragStart = (e, task) => {
    if (resizing) return;
    dragTaskRef.current = task;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("taskId", task.id);
  };

  const handleDragEnd = () => {
    dragTaskRef.current = null;
    setDropTarget(null);
  };

  const handleDragOver = (e, time) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(time);
  };

  const handleDragLeave = () => {
    setDropTarget(null);
  };

  const handleDrop = (e, time) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("taskId");
    
    if (taskId) {
      onUpdateTask(taskId, {
        scheduled_date: dateStr,
        scheduled_time: time,
        status: "scheduled",
      });
    }
    
    dragTaskRef.current = null;
    setDropTarget(null);
  };

  const handleComplete = (e, taskId) => {
    e.stopPropagation();
    e.preventDefault();
    onUpdateTask(taskId, { status: "completed" });
  };

  const handleDelete = (e, taskId) => {
    e.stopPropagation();
    e.preventDefault();
    onDeleteTask(taskId);
  };

  const handleTaskClick = (e, task) => {
    if (!dragTaskRef.current && !resizing) {
      e.stopPropagation();
      setEditingTask(task);
    }
  };

  // Resize handlers
  const handleResizeStart = (e, task) => {
    e.stopPropagation();
    e.preventDefault();
    setResizing(task.id);
    resizeStartY.current = e.clientY;
    resizeStartDuration.current = task.duration || 30;

    const handleMouseMove = (moveEvent) => {
      const deltaY = moveEvent.clientY - resizeStartY.current;
      const deltaSlots = Math.round(deltaY / SLOT_HEIGHT);
      const newDuration = Math.max(30, resizeStartDuration.current + deltaSlots * 30);
      
      const taskEl = document.querySelector(`[data-task-id="${task.id}"]`);
      if (taskEl) {
        const slots = newDuration / 30;
        taskEl.style.height = `${slots * SLOT_HEIGHT - 4}px`;
      }
    };

    const handleMouseUp = (upEvent) => {
      const deltaY = upEvent.clientY - resizeStartY.current;
      const deltaSlots = Math.round(deltaY / SLOT_HEIGHT);
      const newDuration = Math.max(30, resizeStartDuration.current + deltaSlots * 30);
      
      if (newDuration !== resizeStartDuration.current) {
        onUpdateTask(task.id, { duration: newDuration });
      }
      
      setResizing(null);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const timePosition = isToday(currentDate) ? getCurrentTimePosition() : null;

  return (
    <div className="space-y-4" data-testid="daily-calendar">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Daily View</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCurrentDate(subDays(currentDate, 1))}
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <span className="text-sm font-medium min-w-[200px] text-center">
            {format(currentDate, "EEEE, MMMM d, yyyy")}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCurrentDate(addDays(currentDate, 1))}
          >
            <ChevronRight className="w-5 h-5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentDate(new Date())}
            className="ml-2"
          >
            Today
          </Button>
        </div>
      </div>

      {/* Today indicator */}
      {isToday(currentDate) && (
        <div className="flex items-center gap-2 px-4 py-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></div>
          <span className="text-sm text-cyan-400 font-medium">
            Today · {format(currentTime, "h:mm a")}
          </span>
        </div>
      )}

      {/* Time Grid */}
      <div className="border border-border/30 rounded-xl overflow-hidden bg-card/20">
        <div className="max-h-[500px] overflow-y-auto relative">
          {/* Current time line */}
          {timePosition !== null && (
            <div
              ref={timeLineRef}
              className="absolute left-0 right-0 z-20 pointer-events-none"
              style={{ top: `${timePosition}px` }}
            >
              <div className="flex items-center">
                <div className="w-16 flex justify-end pr-2">
                  <span className="text-xs font-bold text-cyan-400 bg-cyan-500/20 px-1.5 py-0.5 rounded">
                    {format(currentTime, "h:mm")}
                  </span>
                </div>
                <div className="flex-1 flex items-center">
                  <div className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)]"></div>
                  <div className="flex-1 h-0.5 bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.6)]"></div>
                </div>
              </div>
            </div>
          )}

          {TIME_SLOTS.map((time) => {
            const isHourMark = time.endsWith(":00");
            const [hours] = time.split(":").map(Number);
            const slotTasks = getTasksForSlot(time);
            const isDropHere = dropTarget === time;

            return (
              <div
                key={time}
                className={`grid grid-cols-[70px_1fr] ${isHourMark ? "border-t border-border/40" : ""}`}
                style={{ height: `${SLOT_HEIGHT}px` }}
              >
                {/* Time Label */}
                <div className="py-2 px-2 text-right border-r border-border/20">
                  {isHourMark && (
                    <span className="text-xs font-medium text-muted-foreground">
                      {format(new Date().setHours(hours, 0), "h:mm a")}
                    </span>
                  )}
                </div>

                {/* Time Slot */}
                <div
                  onDragOver={(e) => handleDragOver(e, time)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, time)}
                  className={`relative border-b border-border/10 p-0.5
                    ${isDropHere ? "bg-primary/30 ring-2 ring-inset ring-primary" : ""}
                  `}
                  style={{ height: `${SLOT_HEIGHT}px` }}
                >
                  {slotTasks.map((task) => {
                    const colors = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[2];
                    const duration = task.duration || 30;
                    const slots = duration / 30;
                    const taskHeight = slots * SLOT_HEIGHT - 4;

                    return (
                      <div
                        key={task.id}
                        data-task-id={task.id}
                        draggable={!resizing}
                        onDragStart={(e) => handleDragStart(e, task)}
                        onDragEnd={handleDragEnd}
                        onClick={(e) => handleTaskClick(e, task)}
                        className={`group absolute left-0.5 right-0.5 rounded font-medium cursor-grab active:cursor-grabbing ${colors} overflow-hidden z-10`}
                        style={{ height: `${taskHeight}px`, top: '2px' }}
                      >
                        <div className="p-2 h-full flex flex-col">
                          <div className="flex items-center justify-between">
                            <span className="truncate text-sm">{task.title}</span>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 flex-shrink-0 ml-2">
                              <button
                                onClick={(e) => handleComplete(e, task.id)}
                                className="p-1 hover:bg-white/30 rounded"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(e) => handleDelete(e, task.id)}
                                className="p-1 hover:bg-white/30 rounded"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          {duration > 30 && (
                            <span className="text-xs opacity-70 mt-1">
                              {duration} min
                            </span>
                          )}
                        </div>
                        
                        {/* Resize handle */}
                        <div
                          onMouseDown={(e) => handleResizeStart(e, task)}
                          className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize hover:bg-white/20 flex items-center justify-center"
                        >
                          <div className="w-12 h-1 rounded-full bg-white/40" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Completed tasks */}
      {completedTasks.length > 0 && (
        <div className="mt-6">
          <h3 className="text-lg font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            Completed ({completedTasks.length})
          </h3>
          <div className="space-y-2">
            {completedTasks.map((task) => (
              <div
                key={task.id}
                className="p-3 rounded-lg bg-card/30 opacity-60 line-through text-sm"
              >
                {task.title}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit Dialog */}
      <TaskEditDialog
        task={editingTask}
        open={!!editingTask}
        onOpenChange={(open) => !open && setEditingTask(null)}
        onSave={onUpdateTask}
        onDelete={onDeleteTask}
      />
    </div>
  );
}
