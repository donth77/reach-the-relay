// Pre-run lobby state — tracks the player's choices from LeaderSelect onward
// up until `startRun` is called (after which run state owns the party).
//
// This is module-scoped (not a scene singleton) so the data survives
// scene transitions (LeaderSelect → Lobby → PartySelect / PartySelectTerminal
// → Route) without serialization.

export interface LobbyPlayerPose {
  x: number;
  y: number;
  facing: 'south' | 'north' | 'east' | 'west';
}

export interface LobbyState {
  leaderId: string | null;
  recruited: Set<string>;
  // Last player position + facing in the walkable lobby. Persisted across
  // short scene trips (e.g. to PartySelectTerminal) so returning to the
  // lobby doesn't snap the player back to spawn.
  lastPlayerPose: LobbyPlayerPose | null;
}

let state: LobbyState = {
  leaderId: null,
  recruited: new Set<string>(),
  lastPlayerPose: null,
};

export function getLobbyState(): LobbyState {
  return state;
}

export function setLeader(classId: string): void {
  state.leaderId = classId;
  // Clear any prior recruits since the leader changed — they may conflict.
  state.recruited = new Set<string>();
}

export function addRecruit(classId: string): void {
  if (state.leaderId === classId) return; // leader isn't a recruit
  state.recruited.add(classId);
}

export function removeRecruit(classId: string): void {
  state.recruited.delete(classId);
}

export function toggleRecruit(classId: string): void {
  if (state.leaderId === classId) return;
  if (state.recruited.has(classId)) state.recruited.delete(classId);
  else state.recruited.add(classId);
}

// Final party for run start = leader + up to 2 recruits. Caller enforces size.
export function getResolvedParty(): string[] {
  const out: string[] = [];
  if (state.leaderId) out.push(state.leaderId);
  for (const id of state.recruited) out.push(id);
  return out;
}

export function setLastPlayerPose(pose: LobbyPlayerPose): void {
  state.lastPlayerPose = pose;
}

// Called at the start of a new session / when returning to Title.
export function resetLobbyState(): void {
  state = { leaderId: null, recruited: new Set<string>(), lastPlayerPose: null };
}

/**
 * Called when a run ends and the player returns to the Lobby to plan
 * another escort. Keeps the chosen leader (player restarts from Title
 * to re-pick), but clears recruits + last player pose so the next run
 * starts fresh. Ensures the player can pick a different crew without
 * being forced through LeaderSelect again.
 */
export function resetLobbyForNextRun(): void {
  state.recruited = new Set<string>();
  state.lastPlayerPose = null;
}
