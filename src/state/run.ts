import { CLASSES } from '../data/classes';
import { STARTING_INVENTORY, type Inventory } from '../data/items';
import type { EncounterDef, RouteDef } from '../data/routes';
import { drawFromBag, resetBag } from '../util/bag';

const VIP_MAX_HP = 35;

export interface RunState {
  route: RouteDef;
  party: string[];
  // Class id of the leader — must be in `party`. Leader is the player's
  // controllable character (on overworld, when that stretch ships) and is
  // positioned at the center of the combat formation.
  leaderId: string;
  encounterIndex: number;
  partyHp: Record<string, number>;
  partyMp: Record<string, number>;
  vipHp: number;
  inventory: Inventory;
  // Remaining uses per limited ability, keyed as `${classId}:${abilityId}`.
  // Carries across combats; resets to `maxUsesPerRest` at the Rest scene.
  abilityUsesRemaining: Record<string, number>;
  // Unix-ms timestamp of run start. Used on victory to compute duration_sec
  // for the leaderboard submission.
  startedAt: number;
  // Combat-time accumulators for ATB-speed-normalized leaderboard duration.
  // Each combat tick adds `dt` to wallClock and `dt * atbSpeed` to normalized.
  // Submit-time formula: `(totalWallClock - combatWallClockSecAccum) +
  // combatTimeSecAccum`. Ensures the slider is a fully free accessibility
  // knob without skewing the duration tiebreaker — a 2.0× run takes half
  // the real combat time, but multiplying that wall-clock by 2.0 yields
  // its 1.0×-equivalent. Ungameable: speed changes are integrated
  // tick-by-tick, so flipping the slider at submit time has no
  // retroactive effect.
  combatWallClockSecAccum: number;
  combatTimeSecAccum: number;
}

let currentRun: RunState | null = null;

export function startRun(route: RouteDef, party: string[], leaderId?: string): void {
  // Default leader: first party member if no explicit leader was chosen.
  const resolvedLeader = leaderId && party.includes(leaderId) ? leaderId : party[0];
  const partyHp: Record<string, number> = {};
  const partyMp: Record<string, number> = {};
  for (const key of party) {
    const def = CLASSES[key];
    partyHp[key] = def.hp;
    partyMp[key] = def.mp;
  }
  const abilityUsesRemaining = buildAbilityUses(party);
  // Resolve encounters + rest placement now so any pool-based or variant-based
  // route gets randomized once per run. Snapshotted on a shallow-cloned route
  // so the original static def stays clean.
  const resolved = resolveRouteShape(route);
  const resolvedRoute: RouteDef = {
    ...route,
    encounters: resolved.encounters,
    restAfter: resolved.restAfter,
  };
  // Inventory = base route inventory overlaid with variant-specific overrides.
  const inventory: Inventory = {
    ...(STARTING_INVENTORY[route.id] ?? {}),
    ...(resolved.startingInventory ?? {}),
  };
  currentRun = {
    route: resolvedRoute,
    party,
    leaderId: resolvedLeader,
    encounterIndex: 0,
    partyHp,
    partyMp,
    vipHp: VIP_MAX_HP,
    inventory,
    abilityUsesRemaining,
    startedAt: Date.now(),
    combatWallClockSecAccum: 0,
    combatTimeSecAccum: 0,
  };
}

function buildAbilityUses(party: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of party) {
    const def = CLASSES[key];
    for (const ab of def.abilities) {
      if (ab.maxUsesPerRest !== undefined) {
        out[`${key}:${ab.id}`] = ab.maxUsesPerRest;
      }
    }
  }
  return out;
}

// Called by RestScene to refill every limited ability back to its max.
export function refillAbilityUsesOnRest(): void {
  if (!currentRun) return;
  currentRun.abilityUsesRemaining = buildAbilityUses(currentRun.party);
}

function resolveRouteShape(route: RouteDef): {
  encounters: RouteDef['encounters'];
  restAfter: number[];
  startingInventory?: Record<string, number>;
} {
  // Structural variants take priority — pick one uniformly.
  if (route.variants && route.variants.length > 0) {
    const pick = route.variants[Math.floor(Math.random() * route.variants.length)];
    return {
      encounters: pick.encounters,
      restAfter: pick.restAfter,
      startingInventory: pick.startingInventory,
    };
  }
  // Fixed-sequence route (no pool) — return as-is.
  if (!route.encounterPool) {
    return { encounters: route.encounters, restAfter: route.restAfter };
  }
  // Determine count: fixed or range.
  let count: number;
  if (route.encounterPoolCountRange) {
    const [lo, hi] = route.encounterPoolCountRange;
    count = lo + Math.floor(Math.random() * (hi - lo + 1));
  } else if (route.encounterPoolCount) {
    count = route.encounterPoolCount;
  } else {
    return { encounters: route.encounters, restAfter: route.restAfter };
  }
  // Grab-bag sampling: reset the bag at run start so each run gets a fresh
  // shuffle, then draw N encounters. Within a run the bag cycles through every
  // pool entry once before repeating — no "same encounter three times in a row"
  // clumping, and rare entries are guaranteed to show up if the run is long
  // enough.
  const bagTag = `route-encounters-${route.id}`;
  resetBag(bagTag);
  const out: RouteDef['encounters'] = [];
  for (let i = 0; i < count; i++) {
    const pick = drawFromBag<EncounterDef>(bagTag, route.encounterPool);
    if (pick) out.push(pick);
  }
  // Prefer count-specific rest layout (e.g. Transit Line gets a 2nd rest
  // only at the 4-encounter variant), falling back to the flat `restAfter`.
  const restAfter = route.restAfterByCount?.[count] ?? route.restAfter;
  return { encounters: out, restAfter };
}

export function getRun(): RunState {
  if (!currentRun) throw new Error('No active run');
  return currentRun;
}

export function hasRun(): boolean {
  return currentRun !== null;
}

export function endRun(): void {
  currentRun = null;
}

export { VIP_MAX_HP };
