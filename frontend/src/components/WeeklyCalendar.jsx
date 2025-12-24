import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, CheckCircle2, Trash2, Download } from "lucide-react";
import { format, startOfWeek, addDays, isToday, addWeeks, subWeeks } from "date-fns";
import TaskEditDialog from "./TaskEditDialog";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

// Use inline style colors for dynamic priority coloring
const PRIORITY_STYLES = {
  4: { backgroundColor: "#f43f5e", color: "white" }, // rose-500
  3: { backgroundColor: "#f59e0b", color: "white" }, // amber-500
  2: { backgroundColor: "#6366f1", color: "white" }, // indigo-500
  1: { backgroundColor: "#64748b", color: "white" }, // slate-500
};

const PRIORITY_COLORS = {
  4: "bg-rose-500 text-white",
  3: "bg-amber-500 text-white",
  2: "bg-indigo-500 text-white",
  1: "bg-slate-500 text-white",
};

const SLOT_HEIGHT = 32; // Height of each 30-min slot in pixels

// Generate time slots from 6 AM to 10 PM in 30-min intervals
const TIME_SLOTS = [];
for (let hour = 6; hour <= 22; hour++) {
  TIME_SLOTS.push(`${hour.toString().padStart(2, "0")}:00`);
  TIME_SLOTS.push(`${hour.toString().padStart(2, "0")}:30`);
}

export default function WeeklyCalendar({ tasks, onUpdateTask, onDeleteTask }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [editingTask, setEditingTask] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [resizing, setResizing] = useState(null);
  const [draggingTask, setDraggingTask] = useState(null);
  const [dragPosition, setDragPosition] = useState(null); // Snapped position for drop
  const [cursorPosition, setCursorPosition] = useState(null); // Smooth cursor follow
  const calendarRef = useRef(null);
  const dragTaskRef = useRef(null);
  const resizeStartY = useRef(null);
  const resizeStartDuration = useRef(null);

  // Update current time every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // Auto-scroll to current time on mount (with 1 hour buffer)
  useEffect(() => {
    if (calendarRef.current) {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMin = now.getMinutes();
      
      // Calculate scroll position: current time minus 1 hour buffer
      // Each slot is SLOT_HEIGHT pixels, 2 slots per hour
      const bufferHours = 1;
      const targetHour = Math.max(6, currentHour - bufferHours); // Don't scroll above 6 AM
      const slotsFromTop = (targetHour - 6) * 2 + Math.floor(currentMin / 30);
      const scrollPosition = Math.max(0, slotsFromTop * SLOT_HEIGHT);
      
      // Smooth scroll to position
      calendarRef.current.scrollTo({
        top: scrollPosition,
        behavior: "smooth"
      });
    }
  }, []); // Only run on mount

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const scheduledTasks = tasks.filter((t) => t.status === "scheduled" && t.scheduled_date);

  const getTasksForSlot = (dateStr, time) => {
    return scheduledTasks.filter((t) => {
      if (t.scheduled_date !== dateStr) return false;
      if (!t.scheduled_time) return false;
      return t.scheduled_time === time;
    });
  };

  // Get all tasks that overlap with a given time slot
  const getOverlappingTasks = (dateStr, time) => {
    const [slotHour, slotMin] = time.split(":").map(Number);
    const slotStart = slotHour * 60 + slotMin;
    
    return scheduledTasks.filter((t) => {
      if (t.scheduled_date !== dateStr) return false;
      if (!t.scheduled_time) return false;
      
      const [taskHour, taskMin] = t.scheduled_time.split(":").map(Number);
      const taskStart = taskHour * 60 + taskMin;
      const taskEnd = taskStart + (t.duration || 30);
      
      // Check if task overlaps with this slot
      return taskStart <= slotStart && taskEnd > slotStart;
    });
  };

  // Calculate position for overlapping tasks
  const getTaskPosition = (task, dateStr) => {
    const [taskHour, taskMin] = task.scheduled_time.split(":").map(Number);
    const taskStart = taskHour * 60 + taskMin;
    const taskEnd = taskStart + (task.duration || 30);
    
    // Find all tasks that overlap with this task
    const overlapping = scheduledTasks.filter((t) => {
      if (t.scheduled_date !== dateStr) return false;
      if (!t.scheduled_time) return false;
      
      const [tHour, tMin] = t.scheduled_time.split(":").map(Number);
      const tStart = tHour * 60 + tMin;
      const tEnd = tStart + (t.duration || 30);
      
      // Check for any overlap
      return (taskStart < tEnd && taskEnd > tStart);
    });
    
    // Sort by start time, then by id for consistent ordering
    overlapping.sort((a, b) => {
      const aTime = a.scheduled_time;
      const bTime = b.scheduled_time;
      if (aTime !== bTime) return aTime.localeCompare(bTime);
      return a.id.localeCompare(b.id);
    });
    
    const index = overlapping.findIndex((t) => t.id === task.id);
    const total = overlapping.length;
    
    return { index, total };
  };

  const handleDragStart = (e, task) => {
    if (resizing) return;
    dragTaskRef.current = task;
    setDraggingTask(task);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("taskId", task.id);
    
    // Make the default drag image invisible
    const img = new Image();
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    e.dataTransfer.setDragImage(img, 0, 0);
  };

  const handleDragEnd = () => {
    dragTaskRef.current = null;
    setDraggingTask(null);
    setDragPosition(null);
    setCursorPosition(null);
  };

  const handleCalendarDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    
    if (!calendarRef.current || !draggingTask) return;
    
    const rect = calendarRef.current.getBoundingClientRect();
    const scrollTop = calendarRef.current.scrollTop;
    
    // Calculate smooth position relative to calendar (follows cursor)
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top + scrollTop;
    
    // Calculate which day column (skip the time label column which is 70px)
    const columnWidth = (rect.width - 70) / 7;
    const dayIndex = Math.max(0, Math.min(6, Math.floor((x - 70) / columnWidth)));
    
    // Store smooth cursor position (for fluid ghost movement)
    setCursorPosition({
      x: Math.max(70, x),
      y: Math.max(0, y),
      dayIndex,
      columnWidth
    });
    
    // Calculate snapped slot position (for drop target indicator)
    const slotIndex = Math.max(0, Math.min(TIME_SLOTS.length - 1, Math.floor(y / SLOT_HEIGHT)));
    
    if (dayIndex >= 0 && dayIndex < 7) {
      setDragPosition({
        dayIndex,
        slotIndex,
        time: TIME_SLOTS[slotIndex],
        date: format(weekDays[dayIndex], "yyyy-MM-dd")
      });
    }
  };

  const handleCalendarDrop = (e) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("taskId");
    
    if (taskId && dragPosition) {
      onUpdateTask(taskId, {
        scheduled_date: dragPosition.date,
        scheduled_time: dragPosition.time,
        status: "scheduled",
      });
    }
    
    dragTaskRef.current = null;
    setDraggingTask(null);
    setDragPosition(null);
    setCursorPosition(null);
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
    // Don't open edit if we just finished resizing
    if (resizing) return;
    e.stopPropagation();
    setEditingTask(task);
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
      
      // Update task duration visually (will be saved on mouse up)
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
      
      // Delay clearing resizing state to prevent click from firing
      setTimeout(() => setResizing(null), 100);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // Format time for display (e.g., "9:00" or "13:30")
  const formatTimeShort = (timeStr) => {
    if (!timeStr) return "";
    const [hours, mins] = timeStr.split(":").map(Number);
    return `${hours}:${mins.toString().padStart(2, "0")}`;
  };

  // Calculate end time from start time and duration
  const getEndTime = (startTime, duration) => {
    if (!startTime) return "";
    const [hours, mins] = startTime.split(":").map(Number);
    let endMins = mins + (duration || 30);
    let endHours = hours;
    while (endMins >= 60) {
      endMins -= 60;
      endHours += 1;
    }
    return `${endHours}:${endMins.toString().padStart(2, "0")}`;
  };

  const handleExportICal = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/tasks/export/ical`);
      if (!response.ok) throw new Error("Export failed");
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "add-daily-tasks.ics";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Export error:", error);
    }
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
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportICal}
            className="gap-1.5"
            title="Export to iCal"
          >
            <Download className="w-4 h-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="border border-border/30 rounded-xl overflow-hidden bg-card/20">
        {/* Day Headers */}
        <div className="grid grid-cols-[70px_repeat(7,1fr)] bg-card/80 border-b border-border/30">
          <div className="p-3 border-r border-border/20" />
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

        {/* Time Grid */}
        <div 
          ref={calendarRef}
          className="max-h-[500px] overflow-y-auto relative"
          onDragOver={handleCalendarDragOver}
          onDrop={handleCalendarDrop}
        >
          {/* Subtle snap indicator line - shows where task will land */}
          {draggingTask && dragPosition && (
            <div
              className="absolute pointer-events-none z-20"
              style={{
                left: `calc(70px + ${dragPosition.dayIndex} * ((100% - 70px) / 7))`,
                top: `${dragPosition.slotIndex * SLOT_HEIGHT}px`,
                width: `calc((100% - 70px) / 7)`,
                height: '2px',
              }}
            >
              <div className="h-full bg-primary/60 rounded-full shadow-[0_0_8px_rgba(var(--primary),0.4)]" />
            </div>
          )}

          {/* Ghost preview - follows cursor smoothly */}
          {draggingTask && cursorPosition && (
            <div
              className="absolute pointer-events-none z-30 transition-opacity duration-75"
              style={{
                left: `calc(70px + ${cursorPosition.dayIndex} * ((100% - 70px) / 7) + 4px)`,
                top: `${cursorPosition.y - 20}px`,
                width: `calc((100% - 70px) / 7 - 8px)`,
                height: `${((draggingTask.duration || 30) / 30) * SLOT_HEIGHT - 4}px`,
                opacity: 0.85,
              }}
            >
              <div className={`h-full rounded-lg ${PRIORITY_COLORS[draggingTask.priority] || PRIORITY_COLORS[2]} p-1.5 text-xs font-medium shadow-xl border border-white/20`}>
                <span className="truncate block">{draggingTask.title}</span>
              </div>
            </div>
          )}

          {/* Current time indicator */}
          {weekDays.some(d => isToday(d)) && (() => {
            const hours = currentTime.getHours();
            const minutes = currentTime.getMinutes();
            if (hours < 6 || hours > 22) return null;
            const slotIndex = (hours - 6) * 2 + (minutes >= 30 ? 1 : 0);
            const minuteOffset = (minutes % 30) / 30 * SLOT_HEIGHT;
            const topPosition = slotIndex * SLOT_HEIGHT + minuteOffset;
            const todayIndex = weekDays.findIndex(d => isToday(d));
            
            return (
              <div
                className="absolute z-20 pointer-events-none"
                style={{ 
                  top: `${topPosition}px`,
                  left: '70px',
                  right: '0'
                }}
              >
                <div 
                  className="flex items-center"
                  style={{
                    marginLeft: `calc(${todayIndex} * (100% / 7))`,
                    width: `calc(100% / 7)`
                  }}
                >
                  <div className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)] -ml-1.5"></div>
                  <div className="flex-1 h-0.5 bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.6)]"></div>
                </div>
              </div>
            );
          })()}

          {TIME_SLOTS.map((time, slotIndex) => {
            const isHourMark = time.endsWith(":00");
            const [hours] = time.split(":").map(Number);

            return (
              <div
                key={time}
                className={`grid grid-cols-[70px_repeat(7,1fr)] ${isHourMark ? "border-t border-border/40" : ""}`}
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

                {/* Day Cells */}
                {weekDays.map((day) => {
                  const dateStr = format(day, "yyyy-MM-dd");
                  const slotTasks = getTasksForSlot(dateStr, time);

                  return (
                    <div
                      key={`${dateStr}|${time}`}
                      className={`relative border-b border-r border-border/10 p-0.5
                        ${isToday(day) ? "bg-primary/5" : ""}
                      `}
                      style={{ height: `${SLOT_HEIGHT}px` }}
                    >
                      {slotTasks.map((task) => {
                        const colors = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[2];
                        // Debug: log task priority and color
                        console.log(`Task "${task.title}" priority=${task.priority} colors=${colors}`);
                        const duration = task.duration || 30;
                        const slots = duration / 30;
                        const taskHeight = slots * SLOT_HEIGHT - 4;
                        const { index, total } = getTaskPosition(task, dateStr);
                        const width = `calc((100% - 4px) / ${total})`;
                        const left = `calc(2px + (100% - 4px) * ${index} / ${total})`;
                        const isDragging = draggingTask?.id === task.id;
                        const startTime = formatTimeShort(task.scheduled_time);
                        const endTime = getEndTime(task.scheduled_time, duration);

                        return (
                          <div
                            key={`${task.id}-${task.priority}`}
                            data-task-id={task.id}
                            data-priority={task.priority}
                            draggable={!resizing}
                            onDragStart={(e) => handleDragStart(e, task)}
                            onDragEnd={handleDragEnd}
                            onClick={(e) => handleTaskClick(e, task)}
                            className={`group absolute rounded text-xs font-medium cursor-grab active:cursor-grabbing ${colors} z-10 transition-opacity ${isDragging ? 'opacity-30' : ''}`}
                            style={{ 
                              height: `${taskHeight}px`, 
                              top: '2px', 
                              overflow: 'hidden',
                              width: width,
                              left: left
                            }}
                          >
                            <div className="p-1.5 h-full flex flex-col overflow-hidden">
                              <div className="flex items-start justify-between gap-1">
                                <span className="truncate flex-shrink block flex-1">{task.title}</span>
                                <button
                                  onClick={(e) => handleComplete(e, task.id)}
                                  className="p-0.5 hover:bg-white/30 rounded flex-shrink-0 opacity-60 hover:opacity-100"
                                  title="Mark as done"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <span className="text-[10px] opacity-80 flex-shrink-0">{startTime}–{endTime}</span>
                              <div className="flex-1" />
                              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0">
                                <button
                                  onClick={(e) => handleDelete(e, task.id)}
                                  className="p-0.5 hover:bg-white/30 rounded"
                                  title="Delete task"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                            
                            {/* Resize handle */}
                            <div
                              onMouseDown={(e) => handleResizeStart(e, task)}
                              className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-white/20 flex items-center justify-center"
                            >
                              <div className="w-8 h-1 rounded-full bg-white/40" />
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
