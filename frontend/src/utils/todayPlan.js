/**
 * Suggest tasks for Today Plan (Next + Today Top 2)
 * Deterministic scoring based on priority, computed urgency, impakt, and other factors
 * @param {Array} tasks - Array of task objects
 * @param {Object} options - Options object (future use)
 * @returns {Object} - { nextTaskId: string|null, todayTaskIds: string[] }
 */
import { computeUrgency } from "./urgency";

export function suggestTodayPlan(tasks, options = {}) {
  if (!tasks || tasks.length === 0) {
    return { nextTaskId: null, todayTaskIds: [] };
  }

  const now = new Date();

  // Filter out calendar-locked tasks
  // Exclude if: route === 'calendar' AND has scheduled_date + scheduled_time (calendar-locked)
  const candidates = tasks.filter(task => {
    // Check if explicitly routed to calendar
    const isRoutedToCalendar = options.routing && options.routing[task.id] === 'calendar';
    // Check if has scheduled date+time (scheduled_start exists)
    const hasScheduledDateTime = task.scheduled_date && task.scheduled_time;
    
    // Exclude only if BOTH conditions are true (calendar-locked)
    // This means tasks with scheduled_date+time but route !== 'calendar' are still candidates
    // and tasks with route === 'calendar' but no scheduled_date+time are still candidates
    if (isRoutedToCalendar && hasScheduledDateTime) {
      return false;
    }
    
    // Include all other tasks
    return true;
  });

  if (candidates.length === 0) {
    return { nextTaskId: null, todayTaskIds: [] };
  }

  // Score each candidate task
  const scoredTasks = candidates.map(task => {
    // Base score components
    const priority = task.priority || 2;
    
    // Compute urgency from scheduled_date/time
    const urgency = computeUrgency(task);
    const urgencyScore = urgency.rank === 99 ? 0 : (4 - urgency.rank) * 25; // Lower rank = higher urgency score
    
    // Map impakt to score (high=3, medium=2, low=1, null=0)
    const impaktMap = { 'high': 3, 'medium': 2, 'low': 1, null: 0, undefined: 0 };
    const impaktScore = (impaktMap[task.impakt] || 0) * 20;
    
    let score = priority * 100 + urgencyScore + impaktScore;

    // Duration bonus
    const duration = task.duration || 30;
    if (duration <= 30) {
      score += 8;
    } else if (duration <= 60) {
      score += 5;
    } else if (duration <= 120) {
      score += 2;
    } else if (duration > 180) {
      score -= 10;
    }

    // Due soon bonus (if scheduled_start exists and is within time window)
    if (task.scheduled_date && task.scheduled_time) {
      const scheduledDateTime = new Date(`${task.scheduled_date}T${task.scheduled_time}`);
      const hoursUntil = (scheduledDateTime - now) / (1000 * 60 * 60);
      
      if (hoursUntil > 0 && hoursUntil <= 24) {
        score += 20; // Within 24 hours
      } else if (hoursUntil > 0 && hoursUntil <= 72) {
        score += 10; // Within 72 hours
      }
    }

    // Age bonus (if created_at exists)
    if (task.created_at) {
      const createdDate = new Date(task.created_at);
      const ageDays = Math.min(
        Math.floor((now - createdDate) / (1000 * 60 * 60 * 24)),
        7
      );
      score += ageDays * 5;
    }

    return { task, score };
  });

  // Sort by score descending
  scoredTasks.sort((a, b) => b.score - a.score);

  // Pick Next = first, Today = next two
  const nextTaskId = scoredTasks.length > 0 ? scoredTasks[0].task.id : null;
  const todayTaskIds = scoredTasks.slice(1, 3).map(item => item.task.id);

  return {
    nextTaskId,
    todayTaskIds,
  };
}

