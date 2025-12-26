/**
 * Shared calendar drag-and-drop utilities
 * Used by both Weekly and Daily calendar views
 */

export const SLOT_HEIGHT = 32; // Height of each 30-min slot in pixels

/**
 * Calculate time from pointer position
 * @param {number} y - Y position relative to calendar
 * @param {number} scrollTop - Current scroll position
 * @param {string[]} timeSlots - Array of time slot strings (e.g., ["06:00", "06:30", ...])
 * @returns {number} - Index of the time slot
 */
export function computeTimeFromPointer(y, scrollTop, timeSlots) {
  const absoluteY = y + scrollTop;
  const slotIndex = Math.max(0, Math.min(timeSlots.length - 1, Math.floor(absoluteY / SLOT_HEIGHT)));
  return slotIndex;
}

/**
 * Snap duration to 30-minute increments
 * @param {number} duration - Duration in minutes
 * @param {number} minDuration - Minimum duration (default 30)
 * @param {number} increment - Snap increment (default 30)
 * @returns {number} - Snapped duration
 */
export function snapToIncrement(duration, minDuration = 30, increment = 30) {
  return Math.max(minDuration, Math.round(duration / increment) * increment);
}

/**
 * Clamp time to day bounds (6am - 10pm for day view, 0-24h for 24h view)
 * @param {string} timeStr - Time string (HH:MM)
 * @param {string} viewMode - 'day' or '24h'
 * @returns {string} - Clamped time string
 */
export function clampToDayBounds(timeStr, viewMode) {
  if (!timeStr) return "06:00";
  
  const [hours, mins] = timeStr.split(":").map(Number);
  
  if (viewMode === 'day') {
    // Clamp to 6am - 10pm
    const clampedHours = Math.max(6, Math.min(22, hours));
    if (clampedHours === 22 && mins > 0) {
      return "22:00";
    }
    return `${String(clampedHours).padStart(2, '0')}:${String(mins || 0).padStart(2, '0')}`;
  } else {
    // 24h view: 0-23:59
    const clampedHours = Math.max(0, Math.min(23, hours));
    const clampedMins = hours === 23 ? Math.min(59, mins || 0) : (mins || 0);
    return `${String(clampedHours).padStart(2, '0')}:${String(clampedMins).padStart(2, '0')}`;
  }
}

/**
 * Compute new start and end times from drag/resize
 * @param {string} startTime - Original start time (HH:MM)
 * @param {number} duration - Duration in minutes
 * @param {string} newStartTime - New start time (if dragging) or null (if resizing)
 * @param {number} newDuration - New duration (if resizing) or null (if dragging)
 * @returns {{startTime: string, endTime: string, duration: number}}
 */
export function computeNewStartEnd(startTime, duration, newStartTime = null, newDuration = null) {
  const actualStartTime = newStartTime || startTime;
  const actualDuration = newDuration || duration;
  
  const [hours, mins] = actualStartTime.split(":").map(Number);
  const totalMinutes = hours * 60 + mins + actualDuration;
  const endHours = Math.floor(totalMinutes / 60);
  const endMins = totalMinutes % 60;
  
  const endTime = `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;
  
  return {
    startTime: actualStartTime,
    endTime,
    duration: actualDuration,
  };
}

/**
 * Build update payload for task schedule changes
 * @param {string} scheduledDate - Date string (YYYY-MM-DD)
 * @param {string} scheduledTime - Time string (HH:MM)
 * @param {number} duration - Duration in minutes (optional)
 * @returns {object} - Update payload for API
 */
export function buildUpdatePayload(scheduledDate, scheduledTime, duration = null) {
  const payload = {
    scheduled_date: scheduledDate,
    scheduled_time: scheduledTime,
    status: "scheduled",
  };
  
  if (duration !== null) {
    payload.duration = duration;
  }
  
  return payload;
}

/**
 * Calculate task height from duration
 * @param {number} duration - Duration in minutes
 * @returns {number} - Height in pixels
 */
export function getTaskHeight(duration) {
  const slots = duration / 30;
  return slots * SLOT_HEIGHT - 4; // 4px gap
}

/**
 * Format time for display
 * @param {string} timeStr - Time string (HH:MM)
 * @returns {string} - Formatted time
 */
export function formatTimeShort(timeStr) {
  if (!timeStr) return "";
  const [hours, mins] = timeStr.split(":").map(Number);
  return `${hours}:${mins.toString().padStart(2, "0")}`;
}

/**
 * Calculate end time from start time and duration
 * @param {string} startTime - Start time (HH:MM)
 * @param {number} duration - Duration in minutes
 * @returns {string} - End time (HH:MM)
 */
export function getEndTime(startTime, duration) {
  if (!startTime) return "";
  const [hours, mins] = startTime.split(":").map(Number);
  let endMins = mins + (duration || 30);
  let endHours = hours;
  while (endMins >= 60) {
    endMins -= 60;
    endHours += 1;
  }
  return `${endHours}:${endMins.toString().padStart(2, "0")}`;
}


