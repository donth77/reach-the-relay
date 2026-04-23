// Leaderboard state + network adapter.
//
// Submit flow:
//   1. Always write to localStorage (guaranteed persistence, survives offline)
//   2. Fire-and-forget submit to the Cloudflare Worker if API URL configured
//   3. Return rank from the Worker when possible; fall back to local rank
//
// Read flow:
//   1. Try remote fetch first
//   2. Fall back to localStorage on network/API failure
//   3. UI displays a "showing local scores only" banner when fallback triggers

import { log } from '../util/logger';

const LOCAL_STORAGE_KEY = 'leaderboard:local';
const API_URL = (import.meta.env.VITE_LEADERBOARD_API as string | undefined) ?? '';

// Additive bonus per route's declared difficulty. Applied to the HP-based
// base score so clearing harder content always outranks easier content.
// See RunCompleteScene where this is consumed.
export const ROUTE_BONUS_BY_DIFFICULTY: Record<string, number> = {
  easy: 100,
  medium: 400,
  hard: 800,
};

export type LeaderboardRoute = 'long-highway' | 'transit-line' | 'direct-line';

export interface ScoreEntry {
  username: string;
  score: number;
  leaderId: string;
  route: LeaderboardRoute;
  durationSec: number;
  // Unix-ms timestamp of when the score was recorded. Populated by
  // `submitScore` so callers don't need to pass it.
  timestamp?: number;
}

export interface SubmitResult {
  rank: number | null;
  // 'remote' = rank came from the Worker; 'local' = Worker unreachable,
  // rank computed from localStorage entries only.
  source: 'remote' | 'local';
  error?: string;
}

// ---------- localStorage ----------

function readLocal(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocal(entries: ScoreEntry[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or disabled — silent. The remote submit still ran.
  }
}

function appendLocal(entry: ScoreEntry): void {
  const all = readLocal();
  all.push(entry);
  // Keep the last 200 entries max so localStorage doesn't grow unbounded.
  // Leaderboard scene reads are always sorted/limited downstream.
  const trimmed = all.slice(-200);
  writeLocal(trimmed);
}

function computeLocalRank(route: LeaderboardRoute, score: number, durationSec: number): number {
  const all = readLocal();
  // Count entries on the SAME route with strictly better standing
  // (higher score, or same score with faster duration). Rank = that + 1.
  const better = all.filter(
    (e) =>
      e.route === route && (e.score > score || (e.score === score && e.durationSec < durationSec)),
  ).length;
  return better + 1;
}

// ---------- remote ----------

interface RemoteSubmitResponse {
  ok?: boolean;
  rank?: number | null;
  error?: string;
}

interface RemoteTopResponse {
  entries?: Array<{
    username: string;
    score: number;
    leader_id: string;
    route: string;
    duration_sec: number;
    created_at: number;
  }>;
  error?: string;
}

async function submitRemote(
  entry: ScoreEntry,
): Promise<{ rank: number | null } | { error: string }> {
  if (!API_URL) return { error: 'no_api_configured' };
  try {
    const res = await fetch(`${API_URL}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: entry.username,
        score: entry.score,
        leaderId: entry.leaderId,
        route: entry.route,
        durationSec: entry.durationSec,
      }),
    });
    if (!res.ok) return { error: `http_${res.status}` };
    const data: RemoteSubmitResponse = await res.json();
    if (!data.ok) return { error: data.error ?? 'server' };
    return { rank: data.rank ?? null };
  } catch (err) {
    return { error: `network:${String(err)}` };
  }
}

async function fetchRemote(
  route: LeaderboardRoute | null,
  limit: number,
): Promise<ScoreEntry[] | { error: string }> {
  if (!API_URL) return { error: 'no_api_configured' };
  try {
    const params = new URLSearchParams();
    if (route) params.set('route', route);
    params.set('limit', String(limit));
    const res = await fetch(`${API_URL}/top?${params}`);
    if (!res.ok) return { error: `http_${res.status}` };
    const data: RemoteTopResponse = await res.json();
    if (data.error) return { error: data.error };
    const rows = data.entries ?? [];
    return rows.map((r) => ({
      username: r.username,
      score: r.score,
      leaderId: r.leader_id,
      route: r.route as LeaderboardRoute,
      durationSec: r.duration_sec,
      timestamp: r.created_at * 1000, // Worker stores unix seconds
    }));
  } catch (err) {
    return { error: `network:${String(err)}` };
  }
}

// ---------- public API ----------

/**
 * Submit a score. Always writes to localStorage; also fires a remote
 * submit when the API URL is configured. Returns the player's rank from
 * whichever source responded — remote preferred, falls back to local.
 */
export async function submitScore(entry: Omit<ScoreEntry, 'timestamp'>): Promise<SubmitResult> {
  const stamped: ScoreEntry = { ...entry, timestamp: Date.now() };
  appendLocal(stamped);

  const remote = await submitRemote(stamped);
  if ('rank' in remote) {
    log('LEADERBOARD', 'submit ok', { source: 'remote', rank: remote.rank });
    return { rank: remote.rank, source: 'remote' };
  }
  log('LEADERBOARD', 'submit fallback', { error: remote.error });
  const localRank = computeLocalRank(stamped.route, stamped.score, stamped.durationSec);
  return { rank: localRank, source: 'local', error: remote.error };
}

/**
 * Fetch top scores for a route (or all routes if `route` is null). Prefers
 * remote; falls back to localStorage on network/API failure. Always
 * returns an array — empty if no scores exist.
 */
export async function fetchTopScores(opts: {
  route?: LeaderboardRoute | null;
  limit?: number;
  // Bypass the remote call entirely and read localStorage. Used by the
  // debug `L` test-trigger so seeded entries render even in builds
  // with a Worker API configured.
  localOnly?: boolean;
}): Promise<{ entries: ScoreEntry[]; source: 'remote' | 'local' }> {
  const route = opts.route ?? null;
  const limit = opts.limit ?? 50;

  const readLocalSlice = (): ScoreEntry[] => {
    const all = readLocal();
    const filtered = route ? all.filter((e) => e.route === route) : all;
    filtered.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.durationSec - b.durationSec;
    });
    return filtered.slice(0, limit);
  };

  if (opts.localOnly) {
    return { entries: readLocalSlice(), source: 'local' };
  }

  const remote = await fetchRemote(route, limit);
  if (Array.isArray(remote)) {
    return { entries: remote, source: 'remote' };
  }

  // Remote failure — fall back to local entries.
  return { entries: readLocalSlice(), source: 'local' };
}

/**
 * Returns the configured API URL, or empty string if the game is in
 * localStorage-only mode (no Worker backend deployed). LeaderboardScene
 * uses this to show a "local only" hint in the UI.
 */
export function isRemoteConfigured(): boolean {
  return API_URL.length > 0;
}

/**
 * Dev-only: replace localStorage leaderboard contents with the given
 * entries. Used by the debug `L` hotkey on the title screen to preview
 * how the LeaderboardScene renders without playing a full run. Bypasses
 * the remote submit entirely.
 */
export function _seedLocalForTest(entries: ScoreEntry[]): void {
  writeLocal(entries);
}
