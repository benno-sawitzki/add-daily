/**
 * Debounced persistence utility for task reordering
 * Ensures only the latest reorder is persisted, avoiding race conditions
 */

// Debounce timeout (ms)
const DEBOUNCE_MS = 500;

// Map of debounce timers by context (e.g., 'inbox', 'queue')
const debounceTimers = new Map();

// Map of pending updates by context
const pendingUpdates = new Map();

/**
 * Debounced function to persist task reordering
 * @param {string} context - Context identifier (e.g., 'inbox', 'queue')
 * @param {Function} persistFn - Function to call to persist the update
 * @param {Function} onError - Optional error handler
 */
export const debouncedPersistReorder = (context, persistFn, onError) => {
  // Clear existing timer for this context
  if (debounceTimers.has(context)) {
    clearTimeout(debounceTimers.get(context));
  }

  // Store the latest persist function
  pendingUpdates.set(context, { persistFn, onError });

  // Set new timer
  const timer = setTimeout(async () => {
    const update = pendingUpdates.get(context);
    if (update) {
      try {
        await update.persistFn();
        pendingUpdates.delete(context);
      } catch (error) {
        console.error(`Error persisting reorder for ${context}:`, error);
        if (update.onError) {
          update.onError(error);
        }
      }
    }
    debounceTimers.delete(context);
  }, DEBOUNCE_MS);

  debounceTimers.set(context, timer);
};

/**
 * Cancel pending persistence for a context
 * @param {string} context - Context identifier
 */
export const cancelPendingPersistence = (context) => {
  if (debounceTimers.has(context)) {
    clearTimeout(debounceTimers.get(context));
    debounceTimers.delete(context);
  }
  pendingUpdates.delete(context);
};


