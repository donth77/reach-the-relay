// Vibe Jam 2026 portal integration. Two sides:
//
// 1. Entry detection (this module): when our page loads with `?portal=true`,
//    BootScene skips Title/LeaderSelect/PartySelect and drops the player
//    straight into the walkable Lobby with a pre-picked default party.
//    Rule: "NO loading screens" — continuity with the webring means zero
//    menus between arrival and being in control of a character.
//
// 2. Exit portal (rendered in LobbyScene): a labeled prop the player walks
//    into, which redirects to vibejam.cc/portal/2026 with query params
//    carrying the player's identity forward.

// Default party when arriving via portal. Chosen for recognizability: Vanguard
// is the tank with the most-polished lobby walking animation, and Medic +
// Scavenger give the visitor a balanced 3-person crew without forcing them
// through PartySelect.
export const DEFAULT_PORTAL_LEADER = 'vanguard';
export const DEFAULT_PORTAL_RECRUITS: readonly string[] = ['medic', 'scavenger'];

export interface PortalEntryParams {
  portal: boolean;
  username?: string;
  color?: string;
  ref?: string;
  avatarUrl?: string;
  team?: string;
  hp?: number;
}

/**
 * True when the current URL contains `?portal=true` — i.e. the player arrived
 * via the Vibe Jam webring. Caller should skip all menus.
 */
export function isPortalEntry(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('portal') === 'true';
}

/**
 * Read every portal-relevant param off the URL. All fields are optional per
 * the webring spec; callers must tolerate missing values. `portal` is the
 * only field that's guaranteed when `isPortalEntry()` is true.
 */
export function getPortalParams(): PortalEntryParams {
  const out: PortalEntryParams = { portal: false };
  if (typeof window === 'undefined') return out;
  const q = new URLSearchParams(window.location.search);
  out.portal = q.get('portal') === 'true';
  const username = q.get('username');
  if (username) out.username = username;
  const color = q.get('color');
  if (color) out.color = color;
  const ref = q.get('ref');
  if (ref) out.ref = ref;
  const avatarUrl = q.get('avatar_url');
  if (avatarUrl) out.avatarUrl = avatarUrl;
  const team = q.get('team');
  if (team) out.team = team;
  const hpRaw = q.get('hp');
  if (hpRaw !== null) {
    const n = parseInt(hpRaw, 10);
    if (Number.isFinite(n)) out.hp = Math.max(1, Math.min(100, n));
  }
  return out;
}

/**
 * Build the outbound URL for the Vibe Jam Portal. Called when the player walks
 * into the exit portal in LobbyScene.
 *
 * `ourRef` should be the canonical URL of our deployed game (not `window.
 * location.href`, which would include the inbound `?portal=true`). Next-game
 * receives `?ref=<ourRef>` so it can place a return portal back to us.
 *
 * `leaderClassId` feeds `username` and `color` so the next game can spawn a
 * matching avatar.
 */
export function buildPortalExitUrl(opts: {
  ourRef: string;
  leaderClassId: string;
  leaderColor?: string;
}): string {
  const q = new URLSearchParams();
  q.set('username', opts.leaderClassId);
  if (opts.leaderColor) q.set('color', opts.leaderColor);
  q.set('ref', opts.ourRef);
  return `https://vibejam.cc/portal/2026?${q.toString()}`;
}
