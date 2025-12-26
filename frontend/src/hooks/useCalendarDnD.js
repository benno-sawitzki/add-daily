/**
 * Shared calendar drag-and-drop hook
 * Provides unified drag/resize behavior for Weekly and Daily views
 */

import { useState, useRef, useCallback } from 'react';
import { 
  computeTimeFromPointer, 
  snapToIncrement, 
  clampToDayBounds,
  computeNewStartEnd,
  buildUpdatePayload,
  getTaskHeight,
  SLOT_HEIGHT 
} from '@/utils/calendarDnD';

/**
 * Hook for calendar drag-and-drop functionality
 * @param {object} options
 * @param {string} options.view - 'weekly' | 'daily'
 * @param {Function} options.onUpdateTask - Callback to update task
 * @param {string[]} options.timeSlots - Array of time slot strings
 * @param {string} options.viewMode - 'day' | '24h'
 * @param {object} options.weekDays - For weekly view: array of dates
 * @param {string} options.dateStr - For daily view: current date string
 * @returns {object} - DnD state and handlers
 */
export function useCalendarDnD({
  view = 'weekly', // 'weekly' | 'daily'
  onUpdateTask,
  timeSlots = [],
  viewMode = 'day',
  weekDays = [], // For weekly view
  dateStr = null, // For daily view
}) {
  // State
  const [draggingTask, setDraggingTask] = useState(null);
  const [dragPosition, setDragPosition] = useState(null); // Snapped position for drop
  const [cursorPosition, setCursorPosition] = useState(null); // Smooth cursor follow
  const [resizing, setResizing] = useState(null);
  
  // Refs
  const dragTaskRef = useRef(null);
  const resizeStartY = useRef(null);
  const resizeStartDuration = useRef(null);

  /**
   * Handle drag start
   */
  const handleDragStart = useCallback((e, task) => {
    if (resizing) return;
    dragTaskRef.current = task;
    setDraggingTask(task);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("taskId", task.id);
    
    // Make the default drag image invisible
    const img = new Image();
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    e.dataTransfer.setDragImage(img, 0, 0);
  }, [resizing]);

  /**
   * Handle drag end
   */
  const handleDragEnd = useCallback(() => {
    dragTaskRef.current = null;
    setDraggingTask(null);
    setDragPosition(null);
    setCursorPosition(null);
  }, []);

  /**
   * Handle calendar drag over (for weekly view with day columns)
   */
  const handleCalendarDragOver = useCallback((e, calendarRef) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    
    if (!calendarRef?.current || !draggingTask) return;
    
    const rect = calendarRef.current.getBoundingClientRect();
    const scrollTop = calendarRef.current.scrollTop || 0;
    
    // Calculate smooth position relative to calendar (follows cursor)
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top + scrollTop;
    
    if (view === 'weekly') {
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
      const slotIndex = computeTimeFromPointer(y, 0, timeSlots);
      
      if (dayIndex >= 0 && dayIndex < 7 && weekDays[dayIndex]) {
        const dayDate = weekDays[dayIndex];
        const dateStr = dayDate instanceof Date 
          ? dayDate.toISOString().split('T')[0] 
          : (typeof dayDate === 'string' ? dayDate : null);
          
        setDragPosition({
          dayIndex,
          slotIndex,
          time: timeSlots[slotIndex],
          date: dateStr
        });
      }
    } else {
      // Daily view: no day columns, just time slots
      setCursorPosition({
        x: 0,
        y: Math.max(0, y),
        dayIndex: 0,
        columnWidth: rect.width
      });
      
      const slotIndex = computeTimeFromPointer(y, 0, timeSlots);
      if (timeSlots[slotIndex] && dateStr) {
        setDragPosition({
          dayIndex: 0,
          slotIndex,
          time: timeSlots[slotIndex],
          date: dateStr
        });
      }
    }
  }, [view, draggingTask, timeSlots, weekDays, dateStr]);

  /**
   * Handle calendar drop
   */
  const handleCalendarDrop = useCallback((e) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("taskId");
    
    if (taskId && dragPosition && dragPosition.date && dragPosition.time) {
      const payload = buildUpdatePayload(
        dragPosition.date,
        dragPosition.time
      );
      onUpdateTask(taskId, payload);
    }
    
    handleDragEnd();
  }, [dragPosition, onUpdateTask, handleDragEnd]);

  /**
   * Handle resize start
   */
  const handleResizeStart = useCallback((e, task) => {
    e.stopPropagation();
    e.preventDefault();
    setResizing(task.id);
    resizeStartY.current = e.clientY;
    resizeStartDuration.current = task.duration || 30;

    const handleMouseMove = (moveEvent) => {
      const deltaY = moveEvent.clientY - resizeStartY.current;
      const deltaSlots = Math.round(deltaY / SLOT_HEIGHT);
      const newDuration = snapToIncrement(
        resizeStartDuration.current + deltaSlots * 30,
        30,
        30
      );
      
      // Update task duration visually (will be saved on mouse up)
      const taskEl = document.querySelector(`[data-task-id="${task.id}"]`);
      if (taskEl) {
        taskEl.style.height = `${getTaskHeight(newDuration)}px`;
      }
    };

    const handleMouseUp = (upEvent) => {
      const deltaY = upEvent.clientY - resizeStartY.current;
      const deltaSlots = Math.round(deltaY / SLOT_HEIGHT);
      const newDuration = snapToIncrement(
        resizeStartDuration.current + deltaSlots * 30,
        30,
        30
      );
      
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
  }, [onUpdateTask]);

  return {
    // State
    draggingTask,
    dragPosition,
    cursorPosition,
    resizing,
    
    // Refs (for external access if needed)
    dragTaskRef,
    
    // Handlers
    handleDragStart,
    handleDragEnd,
    handleCalendarDragOver,
    handleCalendarDrop,
    handleResizeStart,
  };
}

