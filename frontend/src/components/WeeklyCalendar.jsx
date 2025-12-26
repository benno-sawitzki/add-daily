import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ChevronLeft, ChevronRight, CheckCircle2, Trash2, Download } from "lucide-react";
import { format, startOfWeek, addDays, isToday, addWeeks, subWeeks } from "date-fns";
import TaskEditDialog from "./TaskEditDialog";
import { getCalendarViewMode, setCalendarViewMode, generateTimeSlots, STORAGE_EVENT } from "@/utils/calendarSettings";
import { useCalendarDnD } from "@/hooks/useCalendarDnD";
import { 
  SLOT_HEIGHT, 
  formatTimeShort, 
  getEndTime,
  getTaskHeight,
  buildUpdatePayload 
} from "@/utils/calendarDnD";

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

export default function WeeklyCalendar({ tasks, onUpdateTask, onDeleteTask }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [editingTask, setEditingTask] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [viewMode, setViewMode] = useState(() => getCalendarViewMode()); // 'day' or '24h'
  const calendarRef = useRef(null);
  const dayColumnsGridRef = useRef(null); // Ref for the day columns grid container
  const dayColumnRefs = useRef({}); // Refs for individual day columns
  const [todayColumnMetrics, setTodayColumnMetrics] = useState({ left: 0, width: 0 }); // Today column position and width

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Generate time slots based on view mode
  const TIME_SLOTS = generateTimeSlots(viewMode);

  // Use shared DnD hook
  const {
    draggingTask,
    dragPosition,
    cursorPosition,
    resizing,
    handleDragStart,
    handleDragEnd,
    handleCalendarDragOver: handleDragOverShared,
    handleCalendarDrop: handleDropShared,
    handleResizeStart,
  } = useCalendarDnD({
    view: 'weekly',
    onUpdateTask,
    timeSlots: TIME_SLOTS,
    viewMode,
    weekDays,
  });

  // Wrapper for handleCalendarDragOver that passes calendarRef
  const handleCalendarDragOver = (e) => {
    handleDragOverShared(e, calendarRef);
  };

  // Wrapper for handleCalendarDrop that uses buildUpdatePayload
  const handleCalendarDrop = (e) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("taskId");
    
    if (taskId && dragPosition && dragPosition.date && dragPosition.time) {
      const payload = buildUpdatePayload(dragPosition.date, dragPosition.time);
      onUpdateTask(taskId, payload);
    }
    
    handleDragEnd();
  };

  // Update current time every 30 seconds (or on minute boundary)
  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(new Date());
    };
    
    // Update immediately
    updateTime();
    
    // Calculate delay to next 30-second boundary
    const now = new Date();
    const seconds = now.getSeconds();
    const delay = seconds < 30 ? (30 - seconds) * 1000 : (60 - seconds) * 1000;
    
    const timeout = setTimeout(() => {
      updateTime();
      // Then update every 30 seconds
      const interval = setInterval(updateTime, 30000);
      return () => clearInterval(interval);
    }, delay);
    
    return () => clearTimeout(timeout);
  }, []);

  // Listen for view mode changes from other components (e.g., DailyCalendar)
  useEffect(() => {
    const handleViewModeChange = (event) => {
      const newMode = event.detail.viewMode;
      setViewMode(newMode);
    };

    window.addEventListener(STORAGE_EVENT, handleViewModeChange);
    return () => {
      window.removeEventListener(STORAGE_EVENT, handleViewModeChange);
    };
  }, []);

  // Handle view mode change
  const handleViewModeChange = (checked) => {
    const newMode = checked ? '24h' : 'day';
    setViewMode(newMode);
    setCalendarViewMode(newMode);
  };

  // Measure today column position and width
  useEffect(() => {
    const measureTodayColumn = () => {
      if (!dayColumnsGridRef.current) return;
      
      const todayIndex = weekDays.findIndex(d => isToday(d));
      if (todayIndex === -1) {
        setTodayColumnMetrics({ left: 0, width: 0 });
        return;
      }
      
      const gridRect = dayColumnsGridRef.current.getBoundingClientRect();
      const todayDateStr = format(weekDays[todayIndex], "yyyy-MM-dd");
      const todayColRef = dayColumnRefs.current[todayDateStr];
      
      if (todayColRef) {
        const todayRect = todayColRef.getBoundingClientRect();
        const todayLeft = todayRect.left - gridRect.left;
        const todayWidth = todayRect.width;
        setTodayColumnMetrics({ left: todayLeft, width: todayWidth });
      } else {
        // If ref not ready yet, try again after a short delay
        setTimeout(measureTodayColumn, 50);
      }
    };
    
    // Measure after a short delay to ensure DOM is ready
    const timeout = setTimeout(measureTodayColumn, 100);
    
    // Measure on window resize
    window.addEventListener('resize', measureTodayColumn);
    
    // Use ResizeObserver for more accurate measurements
    let resizeObserver;
    if (dayColumnsGridRef.current) {
      resizeObserver = new ResizeObserver(measureTodayColumn);
      resizeObserver.observe(dayColumnsGridRef.current);
    }
    
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('resize', measureTodayColumn);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [weekDays, currentDate]);

  // Auto-scroll to current time on mount (with 1 hour buffer)
  useEffect(() => {
    if (calendarRef.current) {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMin = now.getMinutes();
      
      // Calculate scroll position: current time minus 1 hour buffer
      // Each slot is SLOT_HEIGHT pixels, 2 slots per hour
      const bufferHours = 1;
      let targetHour = currentHour - bufferHours;
      
      if (viewMode === 'day') {
        // Day view: clamp to 6am-10pm
        targetHour = Math.max(6, Math.min(22, targetHour));
        const slotsFromTop = (targetHour - 6) * 2 + Math.floor(currentMin / 30);
        const scrollPosition = Math.max(0, slotsFromTop * SLOT_HEIGHT);
        calendarRef.current.scrollTo({
          top: scrollPosition,
          behavior: "smooth"
        });
      } else {
        // 24h view: allow any hour
        targetHour = Math.max(0, Math.min(23, targetHour));
        const slotsFromTop = targetHour * 2 + Math.floor(currentMin / 30);
        const scrollPosition = Math.max(0, slotsFromTop * SLOT_HEIGHT);
        calendarRef.current.scrollTo({
          top: scrollPosition,
          behavior: "smooth"
        });
      }
    }
  }, [viewMode]); // Re-run when view mode changes

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

  // Format time for display uses shared utility (imported)

  // Format current time for the now indicator label
  const formatCurrentTime = () => {
    const hours = currentTime.getHours();
    const minutes = currentTime.getMinutes();
    
    if (viewMode === '24h') {
      // 24h format: "HH:mm"
      return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
    } else {
      // 12h format: "h:mm"
      const hour12 = hours % 12 || 12;
      return `${hour12}:${minutes.toString().padStart(2, "0")}`;
    }
  };

  // getEndTime uses shared utility (imported)

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
        <div className="flex items-center gap-4">
          {/* View Mode Toggle */}
          <div className="flex items-center gap-2">
            <Label htmlFor="view-mode-toggle-weekly" className="text-sm text-muted-foreground cursor-pointer">
              {viewMode === '24h' ? '24h' : '6am-10pm'}
            </Label>
            <Switch
              id="view-mode-toggle-weekly"
              checked={viewMode === '24h'}
              onCheckedChange={handleViewModeChange}
            />
          </div>
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
                height: `${getTaskHeight(draggingTask.duration || 30)}px`,
                opacity: 0.85,
              }}
            >
              <div 
                className="h-full rounded-lg p-1.5 text-xs font-medium shadow-xl border border-white/20"
                style={PRIORITY_STYLES[Math.max(1, Math.min(4, Number(draggingTask.priority) || 2))] || PRIORITY_STYLES[2]}
              >
                <span className="truncate block">{draggingTask.title}</span>
              </div>
            </div>
          )}

          {/* Now Indicator Layer - Apple Calendar style */}
          {weekDays.some(d => isToday(d)) && (() => {
            const hours = currentTime.getHours();
            const minutes = currentTime.getMinutes();
            
            // Check if current time is within visible range based on view mode
            if (viewMode === 'day' && (hours < 6 || hours > 22)) return null;
            
            // Calculate slot index based on view mode
            let slotIndex;
            if (viewMode === 'day') {
              slotIndex = (hours - 6) * 2 + (minutes >= 30 ? 1 : 0);
            } else {
              // 24h view: hours start from 0
              slotIndex = hours * 2 + (minutes >= 30 ? 1 : 0);
            }
            
            const minuteOffset = (minutes % 30) / 30 * SLOT_HEIGHT;
            const nowY = slotIndex * SLOT_HEIGHT + minuteOffset;
            // Round to avoid subpixel drift, add 0.5 for crisp 1px lines
            const nowYRounded = Math.round(nowY) + 0.5;
            const hasToday = todayColumnMetrics.width > 0;
            
            return (
              <div
                className="absolute inset-0 z-20 pointer-events-none"
                style={{ top: 0, left: 0, right: 0, bottom: 0 }}
              >
                {/* Day columns container - for positioning the lines */}
                <div
                  ref={dayColumnsGridRef}
                  className="absolute"
                  style={{
                    left: '70px',
                    right: '0',
                    top: 0,
                    bottom: 0,
                  }}
                >
                  {/* Single shared Y anchor layer - applies translateY(-50%) once */}
                  <div
                    className="absolute left-0 right-0 pointer-events-none"
                    style={{
                      top: `${nowYRounded}px`,
                      transform: 'translateY(-50%)',
                    }}
                  >
                    {/* Thin line - spans all day columns, positioned at top: 0 (centered via parent) */}
                    <div
                      className="absolute h-0.5 bg-cyan-400/30"
                      style={{
                        left: 0,
                        right: 0,
                        top: 0,
                      }}
                    />
                    
                    {/* Thick today line wrapper - only in today column, positioned at top: 0 (same as thin line) */}
                    {hasToday && (
                      <div
                        className="absolute pointer-events-none"
                        style={{
                          left: `${todayColumnMetrics.left}px`,
                          width: `${todayColumnMetrics.width}px`,
                          top: 0,
                        }}
                      >
                        {/* Glow layer - soft aura behind core line */}
                        <div
                          className="absolute bg-cyan-400 rounded-full"
                          style={{
                            left: 0,
                            right: 0,
                            top: 0,
                            height: '10px',
                            transform: 'translateY(-50%)',
                            filter: 'blur(8px)',
                            opacity: 0.35,
                          }}
                        />
                        {/* Core line - thin stroke, same Y as thin line */}
                        <div
                          className="absolute bg-cyan-400 rounded-full"
                          style={{
                            left: 0,
                            right: 0,
                            top: 0,
                            height: '2px',
                            transform: 'translateY(-50%)',
                            opacity: 1,
                          }}
                        >
                          {/* Dot at left edge of today column - centered on core line */}
                          <div
                            className="absolute w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.7)]"
                            style={{
                              left: 0,
                              top: 0,
                              transform: 'translate(-50%, -50%)',
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Time label in left gutter - uses same rounded Y value */}
                <div
                  className="absolute bg-cyan-400 text-white text-xs font-medium px-2 py-0.5 rounded-full shadow-lg"
                  style={{
                    left: '8px',
                    top: `${nowYRounded}px`,
                    transform: 'translateY(-50%)',
                    zIndex: 21,
                  }}
                >
                  {formatCurrentTime()}
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
                      ref={(el) => {
                        // Store ref for the first slot of each day (we only need one per day column)
                        if (el && slotIndex === 0) {
                          dayColumnRefs.current[dateStr] = el;
                        }
                      }}
                      className={`relative border-b border-r border-border/10 p-0.5
                        ${isToday(day) ? "bg-primary/5" : ""}
                      `}
                      style={{ height: `${SLOT_HEIGHT}px` }}
                    >
                      {slotTasks.map((task) => {
                        // Ensure priority is a number and within valid range
                        const priority = Number(task.priority) || 2;
                        const clampedPriority = Math.max(1, Math.min(4, priority));
                        const priorityStyle = PRIORITY_STYLES[clampedPriority] || PRIORITY_STYLES[2];
                        const duration = task.duration || 30;
                        const taskHeight = getTaskHeight(duration);
                        const { index, total } = getTaskPosition(task, dateStr);
                        const width = `calc((100% - 4px) / ${total})`;
                        const left = `calc(2px + (100% - 4px) * ${index} / ${total})`;
                        const isDragging = draggingTask?.id === task.id;
                        const startTime = formatTimeShort(task.scheduled_time);
                        const endTime = getEndTime(task.scheduled_time, duration);

                        return (
                          <div
                            key={`${task.id}-${clampedPriority}`}
                            data-task-id={task.id}
                            data-priority={clampedPriority}
                            draggable={!resizing}
                            onDragStart={(e) => handleDragStart(e, task)}
                            onDragEnd={handleDragEnd}
                            onClick={(e) => handleTaskClick(e, task)}
                            className={`group absolute rounded text-xs font-medium cursor-grab active:cursor-grabbing z-10 transition-opacity ${isDragging ? 'opacity-30' : ''}`}
                            style={{ 
                              height: `${taskHeight}px`, 
                              top: '2px', 
                              overflow: 'hidden',
                              width: width,
                              left: left,
                              ...priorityStyle
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
