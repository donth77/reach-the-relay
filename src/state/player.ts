// Persistent player identity — just a username for now, stored in
// localStorage so it survives reloads. The leaderboard submits under this
// name, and the LeaderboardScene highlights matching rows.
//
// Portal entry (webring rule): if the URL loads with `?username=<name>`,
// ingest it silently. Portal visitors never see the username prompt.

const STORAGE_KEY = 'player:username';
// Matches the server-side validation in worker/src/index.ts.
const USERNAME_RE = /^[A-Za-z0-9 _]{1,16}$/;

/**
 * Returns the stored username, or null if none set yet.
 */
export function getUsername(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && USERNAME_RE.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Persists the username. Caller is responsible for validation — returns
 * false if the name doesn't match the allowed shape and refuses to save.
 */
export function setUsername(name: string): boolean {
  const trimmed = name.trim();
  if (!USERNAME_RE.test(trimmed)) return false;
  try {
    localStorage.setItem(STORAGE_KEY, trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * True iff a valid username is already stored.
 */
export function isUsernameSet(): boolean {
  return getUsername() !== null;
}

/**
 * Parse `?username=<name>` from the current URL and write it to storage
 * if it validates. Call this once on app boot BEFORE any scene inspects
 * the stored username, so portal entries pre-populate without prompting.
 *
 * Returns true if a username was ingested from the URL (for logging).
 */
export function ingestUrlUsername(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('username');
    if (!raw) return false;
    const trimmed = raw.trim();
    if (!USERNAME_RE.test(trimmed)) return false;
    localStorage.setItem(STORAGE_KEY, trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validation helper for in-game input widgets — returns true iff the
 * string matches the allowed shape. Exported so the Title screen's
 * username prompt can mirror the exact validation rule.
 */
export function isValidUsername(name: string): boolean {
  return USERNAME_RE.test(name);
}

export { USERNAME_RE };
