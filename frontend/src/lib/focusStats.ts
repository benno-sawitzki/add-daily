const STORAGE_KEY = "add_daily_focus_stats_v1";

export interface FocusStats {
  today: string; // YYYY-MM-DD
  todayCount: number;
  streak: number;
  lastDayWithFocus: string; // YYYY-MM-DD
}

/**
 * Get today's date string in local timezone (YYYY-MM-DD)
 */
function getTodayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get yesterday's date string in local timezone (YYYY-MM-DD)
 */
function getYesterdayString(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const year = yesterday.getFullYear();
  const month = String(yesterday.getMonth() + 1).padStart(2, "0");
  const day = String(yesterday.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Load focus stats from localStorage
 */
export function getFocusStats(): FocusStats {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error("Error loading focus stats:", error);
  }
  
  // Default stats
  const today = getTodayString();
  return {
    today,
    todayCount: 0,
    streak: 0,
    lastDayWithFocus: "",
  };
}

/**
 * Initialize stats for today - resets todayCount if it's a new day
 */
export function initFocusStatsForToday(): FocusStats {
  const stats = getFocusStats();
  const today = getTodayString();
  
  // If it's a new day, reset todayCount but keep streak
  if (stats.today !== today) {
    const updated = {
      ...stats,
      today,
      todayCount: 0,
    };
    saveFocusStats(updated);
    return updated;
  }
  
  return stats;
}

/**
 * Increment focus stats when a Next task is completed
 */
export function incrementFocusStats(): FocusStats {
  const stats = getFocusStats();
  const today = getTodayString();
  const yesterday = getYesterdayString();
  
  let updated: FocusStats;
  
  // If last completion was today, just increment count
  if (stats.lastDayWithFocus === today) {
    updated = {
      ...stats,
      today,
      todayCount: (stats.todayCount || 0) + 1,
    };
  }
  // If last completion was yesterday, increment streak
  else if (stats.lastDayWithFocus === yesterday) {
    updated = {
      ...stats,
      today,
      todayCount: 1,
      streak: (stats.streak || 0) + 1,
      lastDayWithFocus: today,
    };
  }
  // If last completion was before yesterday, start new streak
  else {
    updated = {
      ...stats,
      today,
      todayCount: 1,
      streak: 1,
      lastDayWithFocus: today,
    };
  }
  
  saveFocusStats(updated);
  return updated;
}

/**
 * Save focus stats to localStorage
 */
function saveFocusStats(stats: FocusStats): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch (error) {
    console.error("Error saving focus stats:", error);
  }
}

