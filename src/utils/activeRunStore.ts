const STORAGE_PREFIX = 'ask-o11y-active-run:';

export function getActiveRunId(sessionId: string): string | null {
  try {
    return localStorage.getItem(STORAGE_PREFIX + sessionId);
  } catch {
    return null;
  }
}

export function setActiveRunId(sessionId: string, runId: string): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + sessionId, runId);
  } catch (err) {
    console.warn('[activeRunStore] Failed to set active run ID:', err);
  }
}

export function clearActiveRunId(sessionId: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + sessionId);
  } catch (err) {
    console.warn('[activeRunStore] Failed to clear active run ID:', err);
  }
}
