/**
 * Shared calendar drag-and-drop hook
 * Provides unified drag/resize behavior for Weekly and Daily views
 */

import { useState, useRef, useCallback } from 'react';
import { format } from 'date-fns';
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
  dayColumnRefs = null, // For weekly view: refs to day column elements
}) {
  // State
  const [draggingTask, setDraggingTask] = useState(null);
  const [dragPosition, setDragPosition] = useState(null); // Snapped position for drop
  const [cursorPosition, setCursorPosition] = useState(null); // Smooth cursor follow
  const [resizing, setResizing] = useState(null);
  const [resizePreviewDuration, setResizePreviewDuration] = useState(null); // Preview duration during resize
  
  // Refs
  const dragTaskRef = useRef(null);
  const resizeStartY = useRef(null);
  const resizeStartDuration = useRef(null);
  const resizingTaskRef = useRef(null); // Store the task being resized

  /**
   * Helper function to detect which day column contains the cursor
   * Used by both dragOver and drop handlers to ensure consistency
   */
  const detectDayIndexFromEvent = useCallback((e, calendarRef) => {
    if (!calendarRef?.current) return null;
    
    const rect = calendarRef.current.getBoundingClientRect();
    let dayIndex = null;
    
    // Method 1: Use dayColumnRefs (most reliable)
    if (dayColumnRefs?.current && weekDays.length === 7) {
      for (let i = 0; i < weekDays.length; i++) {
        const dayDate = weekDays[i];
        const dateStr = dayDate instanceof Date 
          ? dayDate.toISOString().split('T')[0] 
          : format(dayDate, 'yyyy-MM-dd');
        
        const colElement = dayColumnRefs.current[dateStr];
        if (colElement) {
          const colRect = colElement.getBoundingClientRect();
          // Check if cursor is within this column (including right edge for last column)
          if (e.clientX >= colRect.left && (i === 6 ? e.clientX <= colRect.right : e.clientX < colRect.right)) {
            dayIndex = i;
            break;
          }
        }
      }
    }
    
    // Method 2: DOM query fallback
    if (dayIndex === null) {
      const calendarContainer = calendarRef.current;
      const firstRow = calendarContainer.querySelector('[data-day-index="0"]')?.parentElement;
      if (firstRow) {
        const rowChildren = Array.from(firstRow.children);
        const dayColumns = rowChildren.slice(1); // Skip time label
        for (let i = 0; i < dayColumns.length; i++) {
          const colRect = dayColumns[i].getBoundingClientRect();
          if (e.clientX >= colRect.left && (i === 6 ? e.clientX <= colRect.right : e.clientX < colRect.right)) {
            dayIndex = i;
            break;
          }
        }
      }
    }
    
    // Method 3: Math fallback
    if (dayIndex === null) {
      const x = e.clientX - rect.left;
      const timeLabelWidth = 70;
      const columnAreaWidth = rect.width - timeLabelWidth;
      const columnWidth = columnAreaWidth / 7;
      const adjustedX = x - timeLabelWidth;
      if (adjustedX >= 0 && adjustedX < columnAreaWidth) {
        dayIndex = Math.min(6, Math.max(0, Math.floor(adjustedX / columnWidth)));
      }
    }
    
    return dayIndex;
  }, [weekDays, dayColumnRefs]);

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
    // Use clientY directly and add scrollTop for accurate position calculation
    const x = e.clientX - rect.left;
    const y = (e.clientY - rect.top) + scrollTop;
    
    if (view === 'weekly') {
      let dayIndex = null;
      
      // Use actual DOM elements to find column positions
      const calendarContainer = calendarRef.current;
      if (calendarContainer) {
        // Find the first time slot row's day cells to get column positions
        const firstRow = calendarContainer.querySelector('[data-day-index="0"]')?.parentElement;
        if (firstRow) {
          // Get all day column divs from this row (skip the time label which is first child)
          const rowChildren = Array.from(firstRow.children);
          const dayColumns = rowChildren.slice(1); // Skip first child (time label)
          
          // Find which column center is closest to the cursor
          let closestIndex = 0;
          let closestDistance = Infinity;
          
          for (let i = 0; i < dayColumns.length && i < weekDays.length; i++) {
            const colRect = dayColumns[i].getBoundingClientRect();
            const centerX = colRect.left + colRect.width / 2;
            const distance = Math.abs(e.clientX - centerX);
            
            if (distance < closestDistance) {
              closestDistance = distance;
              closestIndex = i;
            }
          }
          
          dayIndex = closestIndex;
        }
      }
      
      // Fallback to math calculation using center-based approach
      if (dayIndex === null) {
        const timeLabelWidth = 70;
        const columnAreaWidth = rect.width - timeLabelWidth;
        const columnWidth = columnAreaWidth / 7;
        const adjustedX = x - timeLabelWidth;
        
        if (adjustedX < 0) {
          dayIndex = 0;
        } else if (adjustedX >= columnAreaWidth) {
          dayIndex = 6;
        } else {
          // Use center-based calculation: find which column center is closest
          const columnCenter = adjustedX / columnWidth;
          dayIndex = Math.round(columnCenter);
          dayIndex = Math.min(6, Math.max(0, dayIndex));
        }
      }
      
      // Store smooth cursor position (for fluid ghost movement)
      const columnWidth = (rect.width - 70) / 7;
      setCursorPosition({
        x: Math.max(70, x),
        y: Math.max(0, y),
        dayIndex,
        columnWidth
      });
      
      // Calculate snapped slot position (for drop target indicator)
      const slotIndex = computeTimeFromPointer(y, 0, timeSlots);
      
      if (dayIndex !== null && dayIndex >= 0 && dayIndex < 7 && weekDays[dayIndex]) {
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
      
      const clampedY = Math.max(0, y);
      const slotIndex = computeTimeFromPointer(clampedY, 0, timeSlots);
      if (slotIndex >= 0 && slotIndex < timeSlots.length && timeSlots[slotIndex] && dateStr) {
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
  const handleCalendarDrop = useCallback((e, calendarRef) => {
    e.preventDefault();
    e.stopPropagation();
    
    const taskId = e.dataTransfer.getData("taskId");
    
    // Always reset drag state first
    const resetState = () => {
      handleDragEnd();
    };
    
    if (!taskId || !calendarRef?.current) {
      resetState();
      return;
    }
    
    const rect = calendarRef.current.getBoundingClientRect();
    const scrollTop = calendarRef.current.scrollTop || 0;
    const y = e.clientY - rect.top + scrollTop;
    
    try {
      if (view === 'weekly') {
        // Recalculate dayIndex from drop event (don't trust dragPosition state)
        const dropDayIndex = detectDayIndexFromEvent(e, calendarRef);
        const slotIndex = computeTimeFromPointer(y, 0, timeSlots);
        const dropTime = timeSlots[slotIndex];
        
        if (dropDayIndex !== null && dropDayIndex >= 0 && dropDayIndex < 7 && weekDays[dropDayIndex] && dropTime) {
          const dayDate = weekDays[dropDayIndex];
          const dateStr = dayDate instanceof Date 
            ? dayDate.toISOString().split('T')[0] 
            : format(dayDate, 'yyyy-MM-dd');
          
          const payload = buildUpdatePayload(dateStr, dropTime);
          onUpdateTask(taskId, payload);
        }
      } else {
        // Daily view: use dateStr directly
        const clampedY = Math.max(0, y);
        const slotIndex = computeTimeFromPointer(clampedY, 0, timeSlots);
        const dropTime = slotIndex >= 0 && slotIndex < timeSlots.length ? timeSlots[slotIndex] : null;
        if (dropTime && dateStr) {
          const payload = buildUpdatePayload(dateStr, dropTime);
          onUpdateTask(taskId, payload);
        }
      }
    } finally {
      // Always reset state, even if update fails
      resetState();
    }
  }, [onUpdateTask, handleDragEnd, view, weekDays, timeSlots, dateStr, detectDayIndexFromEvent]);

  /**
   * Handle resize start
   */
  const handleResizeStart = useCallback((e, task) => {
    e.stopPropagation();
    e.preventDefault();
    setResizing(task.id);
    setResizePreviewDuration(task.duration || 30);
    resizeStartY.current = e.clientY;
    resizeStartDuration.current = task.duration || 30;
    resizingTaskRef.current = task;

    const handleMouseMove = (moveEvent) => {
      const deltaY = moveEvent.clientY - resizeStartY.current;
      const deltaSlots = Math.round(deltaY / SLOT_HEIGHT);
      const newDuration = snapToIncrement(
        resizeStartDuration.current + deltaSlots * 30,
        30,
        30
      );
      
      // Update preview duration state (will trigger React re-render with new height)
      setResizePreviewDuration(newDuration);
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
      
      // Clear preview and resizing state
      setResizePreviewDuration(null);
      resizingTaskRef.current = null;
      
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
    resizePreviewDuration,
    
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

