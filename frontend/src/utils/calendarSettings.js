/**
 * Calendar view settings (24h vs 6am-10pm)
 * Stored in localStorage
 */

const STORAGE_KEY = 'calendar_view_settings_v1';
const STORAGE_EVENT = 'calendarViewModeChanged'; // Custom event name

export function getCalendarViewMode() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const settings = JSON.parse(stored);
      return settings.viewMode || 'day'; // 'day' = 6am-10pm, '24h' = 24 hours
    }
  } catch (error) {
    console.error('Error loading calendar view mode:', error);
  }
  return 'day'; // Default to 6am-10pm
}

export function setCalendarViewMode(viewMode) {
  try {
    const settings = { viewMode };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    // Dispatch custom event so other components can listen and update
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail: { viewMode } }));
  } catch (error) {
    console.error('Error saving calendar view mode:', error);
  }
}

// Export event name for components to use
export { STORAGE_EVENT };

/**
 * Generate time slots based on view mode
 * @param {string} viewMode - 'day' (6am-10pm) or '24h' (24 hours)
 * @returns {string[]} Array of time strings in HH:mm format
 */
export function generateTimeSlots(viewMode) {
  const slots = [];
  
  if (viewMode === '24h') {
    // 24-hour view: 00:00 to 23:30
    for (let hour = 0; hour < 24; hour++) {
      slots.push(`${hour.toString().padStart(2, "0")}:00`);
      slots.push(`${hour.toString().padStart(2, "0")}:30`);
    }
  } else {
    // Day view: 6am to 10pm (default)
    for (let hour = 6; hour <= 22; hour++) {
      slots.push(`${hour.toString().padStart(2, "0")}:00`);
      slots.push(`${hour.toString().padStart(2, "0")}:30`);
    }
  }
  
  return slots;
}

