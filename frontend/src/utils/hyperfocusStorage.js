/**
 * localStorage utilities for Timer session persistence
 * Supports both "starter" (2-min rule) and "focus" (hyperfocus) modes
 */

const STORAGE_KEY = 'hyperfocus_session';

/**
 * Timer session model:
 * {
 *   nextTaskId: string,
 *   status: 'idle' | 'running' | 'paused', // single source of truth for focus state
 *   mode: "starter" | "focus",
 *   durationSeconds: number, // total duration in seconds
 *   remainingSeconds?: number, // remaining time in seconds (used when paused)
 *   endsAt: number | null, // timestamp when timer ends (only set when status === 'running')
 *   // Legacy fields for backward compatibility:
 *   isRunning?: boolean, // deprecated, use status === 'running'
 *   pausedAt?: number, // deprecated
 *   modeMinutes?: number, // for backward compatibility
 *   remainingMs?: number, // for backward compatibility
 * }
 */

export function loadHyperfocusSession() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    
    const session = JSON.parse(stored);
    
    // Migrate old format to new format with status enum
    if (!session.status) {
      // Old format: derive status from isRunning
      if (session.isRunning) {
        session.status = 'running';
      } else if (session.remainingMs || session.remainingSeconds || session.endsAt) {
        // Has session data but not running = paused
        session.status = 'paused';
      } else {
        session.status = 'idle';
      }
    }
    
    // Migrate old mode field if missing
    if (!session.mode) {
      session.mode = "focus";
      if (session.modeMinutes) {
        session.durationSeconds = session.modeMinutes * 60;
      }
    }
    
    // Migrate remainingMs to remainingSeconds if needed
    if (session.remainingMs && !session.remainingSeconds) {
      session.remainingSeconds = Math.floor(session.remainingMs / 1000);
    }
    
    // Check if session is still valid (not expired)
    if (session.status === 'running' && session.endsAt) {
      const now = Date.now();
      if (now >= session.endsAt) {
        // Session expired, clear it
        clearHyperfocusSession();
        return null;
      }
      
      // Calculate remaining time for running sessions
      const remainingMs = session.endsAt - now;
      session.remainingMs = remainingMs;
      session.remainingSeconds = Math.floor(remainingMs / 1000);
    } else if (session.status === 'paused' && session.remainingSeconds) {
      // Paused session: ensure remainingSeconds is set, calculate remainingMs for compatibility
      session.remainingMs = session.remainingSeconds * 1000;
    }
    
    return session;
  } catch (error) {
    console.error('Error loading hyperfocus session:', error);
    return null;
  }
}

export function saveHyperfocusSession(session) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch (error) {
    console.error('Error saving hyperfocus session:', error);
  }
}

export function clearHyperfocusSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Error clearing hyperfocus session:', error);
  }
}

/**
 * Calculate end timestamp based on remaining time and whether running
 */
export function calculateEndsAt(remainingMs, isRunning) {
  if (!isRunning) {
    return null; // Don't set endsAt when paused
  }
  return Date.now() + remainingMs;
}

