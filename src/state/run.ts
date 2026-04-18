import { CLASSES } from '../data/classes';
import { STARTING_INVENTORY, type Inventory } from '../data/items';
import type { RouteDef } from '../data/routes';

const ESCORT_MAX_HP = 35;

export interface RunState {
  route: RouteDef;
  party: string[];
  encounterIndex: number;
  partyHp: Record<string, number>;
  partyMp: Record<string, number>;
  escortHp: number;
  inventory: Inventory;
}

let currentRun: RunState | null = null;

export function startRun(route: RouteDef, party: string[]): void {
  const partyHp: Record<string, number> = {};
  const partyMp: Record<string, number> = {};
  for (const key of party) {
    const def = CLASSES[key];
    partyHp[key] = def.hp;
    partyMp[key] = def.mp;
  }
  const inventory: Inventory = { ...(STARTING_INVENTORY[route.id] ?? {}) };
  currentRun = {
    route,
    party,
    encounterIndex: 0,
    partyHp,
    partyMp,
    escortHp: ESCORT_MAX_HP,
    inventory,
  };
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

export { ESCORT_MAX_HP };
