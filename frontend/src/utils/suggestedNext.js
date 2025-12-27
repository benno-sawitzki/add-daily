/**
 * Pick the best suggested next task from inbox tasks
 * Uses energy level to match task effort requirements
 * @param {Array} inboxTasks - Array of task objects
 * @param {string} energyLevel - 'low'|'medium'|'high'
 * @returns {string|null} - Task ID of suggested next task, or null if no tasks
 */
import { computeUrgency } from "./urgency";

export function pickSuggestedNext(inboxTasks, energyLevel = 'medium') {
  if (!inboxTasks || inboxTasks.length === 0) {
    return null;
  }

  // Filter to inbox tasks (not completed)
  const availableTasks = inboxTasks.filter(t => 
    t.status === 'inbox' || t.status === undefined || t.status === null
  );
  
  if (availableTasks.length === 0) {
    return null;
  }

  const now = new Date();

  // Score each task
  const scoredTasks = availableTasks.map(task => {
    // Base score components
    const priority = task.priority || 2;
    
    // Compute urgency from scheduled_date/time
    const urgency = computeUrgency(task);
    const urgencyScore = urgency.rank === 99 ? 0 : (4 - urgency.rank) * 25; // Lower rank = higher urgency score
    
    // Map impakt to score (high=3, medium=2, low=1, null=0)
    const impaktMap = { 'high': 3, 'medium': 2, 'low': 1, null: 0, undefined: 0 };
    const impaktScore = (impaktMap[task.impakt] || 0) * 20;
    
    // Calculate age in days (capped at 7)
    const createdDate = new Date(task.created_at);
    const ageDays = Math.min(
      Math.floor((now - createdDate) / (1000 * 60 * 60 * 24)),
      7
    );

    // Base score
    let score = priority * 100 + urgencyScore + impaktScore + ageDays * 5;

    // Energy/Effort matching (primary factor)
    // Use effort field if available, fallback to energy_required
    const taskEffort = task.effort || task.energy_required || 'medium';
    
    if (energyLevel === 'low') {
      // Low energy: prefer low effort, medium is ok, avoid high
      if (taskEffort === 'low') score += 30;
      else if (taskEffort === 'medium') score += 10;
      else if (taskEffort === 'high') score -= 20;
    } else if (energyLevel === 'medium') {
      // Medium energy: prefer medium, low is good, high is ok
      if (taskEffort === 'medium') score += 30;
      else if (taskEffort === 'low') score += 20;
      else if (taskEffort === 'high') score += 10;
    } else if (energyLevel === 'high') {
      // High energy: prefer high, medium is good, low is ok
      if (taskEffort === 'high') score += 30;
      else if (taskEffort === 'medium') score += 20;
      else if (taskEffort === 'low') score += 10;
    }

    // Duration bonus (prefer tasks <= 60 minutes)
    const duration = task.duration || 30;
    if (duration <= 60) {
      score += 5;
    }

    return { task, score };
  });

  // Find task with highest score
  const bestTask = scoredTasks.reduce((best, current) => 
    current.score > best.score ? current : best
  );

  return bestTask.task.id;
}

