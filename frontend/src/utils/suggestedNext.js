/**
 * Pick the best suggested next task from inbox tasks
 * @param {Array} inboxTasks - Array of task objects
 * @param {string} currentEnergy - 'low'|'medium'|'high'
 * @returns {string|null} - Task ID of suggested next task, or null if no tasks
 */
export function pickSuggestedNext(inboxTasks, currentEnergy = null) {
  if (!inboxTasks || inboxTasks.length === 0) {
    return null;
  }

  const now = new Date();
  
  // Energy mapping
  const energyMap = { low: 1, medium: 2, high: 3 };
  const userEnergy = currentEnergy ? energyMap[currentEnergy] : null;

  // Score each task
  const scoredTasks = inboxTasks.map(task => {
    // Base score components
    const priority = task.priority || 2;
    const urgency = task.urgency || 2;
    const importance = task.importance || 2;
    
    // Calculate age in days (capped at 7)
    const createdDate = new Date(task.created_at);
    const ageDays = Math.min(
      Math.floor((now - createdDate) / (1000 * 60 * 60 * 24)),
      7
    );

    // Base score
    let score = priority * 100 + urgency * 25 + importance * 20 + ageDays * 5;

    // Energy bonus
    if (task.energy_required && userEnergy) {
      const taskEnergy = energyMap[task.energy_required] || 2;
      const diff = userEnergy - taskEnergy;
      
      if (diff >= 0) {
        score += 10; // User has enough energy
      } else if (diff === -1) {
        score += 4; // Slightly low energy, but doable
      } else {
        score -= 20; // Too low energy
      }
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

