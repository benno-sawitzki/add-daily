/**
 * Date range utilities for Command Center metrics
 * All ranges use user's local timezone
 */

/**
 * Get today's date range (start and end of current day in local timezone)
 */
export function getTodayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

/**
 * Get this week's range (Monday to Sunday in local timezone)
 */
export function getThisWeekRange() {
  const now = new Date();
  const day = now.getDay();
  // Convert Sunday (0) to 7 for easier calculation
  const dayOfWeek = day === 0 ? 7 : day;
  // Monday is day 1, so subtract (dayOfWeek - 1) days to get Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek - 1));
  monday.setHours(0, 0, 0, 0);
  
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  
  return {
    start: monday.toISOString(),
    end: sunday.toISOString(),
  };
}

/**
 * Get last week's range (previous Monday to Sunday)
 */
export function getLastWeekRange() {
  const thisWeek = getThisWeekRange();
  const lastWeekStart = new Date(thisWeek.start);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  
  const lastWeekEnd = new Date(thisWeek.end);
  lastWeekEnd.setDate(lastWeekEnd.getDate() - 7);
  
  return {
    start: lastWeekStart.toISOString(),
    end: lastWeekEnd.toISOString(),
  };
}

/**
 * Get this month's range (first day to last day of current month)
 */
export function getThisMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

/**
 * Get date range bounds for a given range key
 * @param {string} rangeKey - 'today' | 'thisWeek' | 'lastWeek' | 'thisMonth'
 * @returns {{ start: string, end: string }} ISO date strings
 */
export function getRangeBounds(rangeKey) {
  switch (rangeKey) {
    case 'today':
      return getTodayRange();
    case 'thisWeek':
      return getThisWeekRange();
    case 'lastWeek':
      return getLastWeekRange();
    case 'thisMonth':
      return getThisMonthRange();
    default:
      return getTodayRange();
  }
}


