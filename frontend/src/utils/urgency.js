/**
 * Urgency computation utility
 * Computes urgency status from task due date/time
 * 
 * Rules:
 * - If task has NO date → urgency = none (no badge)
 * - If task has date + time → due_at = date+time
 * - If task has date but NO time → due_at = date + DEFAULT_DUE_TIME (17:00 local)
 * 
 * Urgency statuses (based on minutes_until_due = due_at - now):
 * - Overdue: minutes_until_due < 0 → badge "Overdue"
 * - Due soon: 0 <= minutes_until_due <= 120 → badge "Due soon"
 * - Due today: due_date is today and not "Due soon" → badge "Due today"
 * - Upcoming: due_date is in the future (tomorrow+) → badge "Upcoming"
 * - None: no due date → no badge
 */

const DEFAULT_DUE_TIME = '17:00'; // 5:00 PM local time

/**
 * Compute urgency status for a task
 * @param {Object} task - Task object with scheduled_date and optional scheduled_time
 * @param {Date} now - Current date/time (defaults to now)
 * @returns {Object} { status: 'none'|'overdue'|'soon'|'today'|'upcoming', label: string|null, rank: number }
 */
export function computeUrgency(task, now = new Date()) {
  // No date = no urgency
  if (!task.scheduled_date) {
    return {
      status: 'none',
      label: null,
      rank: 99
    };
  }

  // Parse the scheduled date
  const scheduledDate = new Date(task.scheduled_date + 'T00:00:00');
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const scheduledDateOnly = new Date(scheduledDate.getFullYear(), scheduledDate.getMonth(), scheduledDate.getDate());

  // Determine due_at (date + time)
  let dueAt;
  if (task.scheduled_time) {
    // Has time: use date + time
    const [hours, minutes] = task.scheduled_time.split(':').map(Number);
    dueAt = new Date(scheduledDate);
    dueAt.setHours(hours, minutes, 0, 0);
  } else {
    // No time: use date + DEFAULT_DUE_TIME (17:00)
    const [hours, minutes] = DEFAULT_DUE_TIME.split(':').map(Number);
    dueAt = new Date(scheduledDate);
    dueAt.setHours(hours, minutes, 0, 0);
  }

  // Calculate minutes until due
  const minutesUntilDue = Math.floor((dueAt - now) / (1000 * 60));

  // Determine status
  if (minutesUntilDue < 0) {
    // Overdue
    return {
      status: 'overdue',
      label: 'Overdue',
      rank: 0
    };
  } else if (minutesUntilDue <= 120) {
    // Due soon (within 2 hours)
    return {
      status: 'soon',
      label: 'Due soon',
      rank: 1
    };
  } else {
    // Check if it's today
    const isToday = scheduledDateOnly.getTime() === today.getTime();
    if (isToday) {
      return {
        status: 'today',
        label: 'Due today',
        rank: 2
      };
    } else {
      return {
        status: 'upcoming',
        label: 'Upcoming',
        rank: 3
      };
    }
  }
}

/**
 * Get urgency badge styling classes
 * @param {string} status - Urgency status
 * @returns {string} Tailwind CSS classes
 */
export function getUrgencyBadgeClasses(status) {
  const baseClasses = "text-xs px-2 py-1 rounded-full font-medium";
  
  switch (status) {
    case 'overdue':
      return `${baseClasses} bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400 border border-red-300 dark:border-red-500/30`;
    case 'soon':
      return `${baseClasses} bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400 border border-orange-300 dark:border-orange-500/30`;
    case 'today':
      return `${baseClasses} bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 border border-blue-300 dark:border-blue-500/30`;
    case 'upcoming':
      return `${baseClasses} bg-slate-100 dark:bg-slate-500/20 text-slate-700 dark:text-slate-400 border border-slate-300 dark:border-slate-500/30`;
    default:
      return '';
  }
}



