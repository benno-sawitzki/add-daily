/**
 * Unified reorder logic using sort_order column
 * Replaces priority-based reordering for better consistency
 */

import axios from "axios";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Persist task order using sort_order column (batch update)
 * @param {Array} orderedTasks - Array of tasks in new order (from arrayMove result)
 * @param {string} context - Context for error messages (e.g., 'inbox')
 * @returns {Promise<void>}
 */
export async function persistSortOrder(orderedTasks, context = "tasks") {
  if (!orderedTasks || orderedTasks.length === 0) {
    return;
  }

  // Build updates: assign sort_order sequentially (0-based index)
  const updates = orderedTasks.map((task, index) => ({
    task_id: task.id,
    sort_order: index,
  }));

  try {
    const response = await axios.post(`${API}/tasks/batch-update-sort-order`, {
      updates,
    });

    if (response.data.updated < updates.length) {
      console.warn(
        `Only ${response.data.updated} of ${updates.length} tasks updated for ${context}`
      );
    }
  } catch (error) {
    // Extract detailed error information
    const errorDetails = {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      statusText: error.response?.statusText,
      details: error.response?.data?.detail,
      hint: error.response?.data?.hint,
      code: error.response?.data?.code,
    };

    console.error(`Error persisting sort_order for ${context}:`, errorDetails);

    // Build detailed error message for dev
    let errorMsg = "Couldn't save order";
    if (process.env.NODE_ENV === "development") {
      errorMsg = `Couldn't save order: ${
        errorDetails.details || errorDetails.message
      }`;
      if (errorDetails.hint) errorMsg += ` (Hint: ${errorDetails.hint})`;
      if (errorDetails.status)
        errorMsg += ` (Status: ${errorDetails.status})`;
    }

    // Show error toast (will be deduplicated by caller)
    toast.error(errorMsg, {
      id: `reorder-error-${context}`, // Deduplicate by context
      duration: 5000,
    });

    throw error; // Re-throw for caller to handle
  }
}

/**
 * Retry persistence with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} delayMs - Initial delay in ms
 * @returns {Promise<void>}
 */
export async function persistWithRetry(
  fn,
  maxRetries = 2,
  delayMs = 1000
) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await fn();
      return; // Success
    } catch (error) {
      if (attempt === maxRetries) {
        throw error; // Final attempt failed
      }
      // Wait before retrying (exponential backoff)
      await new Promise((resolve) =>
        setTimeout(resolve, delayMs * Math.pow(2, attempt))
      );
    }
  }
}


