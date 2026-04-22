import type { AbilityDef, Element } from '../data/classes';
import type { ItemDef } from '../data/items';
import type { Unit } from './types';

export function getUnitFacing(u: Unit): 'west' | 'east' {
  return u.side === 'enemy' ? 'east' : 'west';
}

export function calculateDamage(
  attacker: Unit,
  target: Unit,
  power: number,
  element?: Element,
): number {
  const base = Math.max(1, attacker.attack * power - target.defense);
  const variance = Math.floor(Math.random() * 5) - 2;
  let damage = Math.max(1, Math.round(base + variance));
  if (element && element !== 'none') {
    if (target.enemyDef?.vulnerability === element) {
      damage = Math.round(damage * 1.5);
    } else if (target.enemyDef?.resistances?.includes(element)) {
      damage = Math.max(1, Math.round(damage * 0.5));
    }
  }
  return damage;
}

export function validTargets(units: Unit[], ability: AbilityDef): Unit[] {
  switch (ability.target) {
    case 'enemy':
      return units.filter((u) => u.side === 'enemy' && !u.ko);
    case 'ally-or-vip':
      return units.filter((u) => (u.side === 'party' || u.side === 'vip') && !u.ko);
    default:
      return [];
  }
}

/**
 * Will a currently-applied taunt actually redirect this enemy's NEXT action?
 * Returns true only if:
 *   - the unit is tauntedBy someone, AND
 *   - the enemy's next move is a single-target attack that honors taunt
 *
 * Used to suppress the '!' taunt icon on enemies where the taunt would be
 * wasted on the immediate next turn (e.g. Wreckwarden mid-rotation on a
 * Shockwave or AoE phase; Nanite Swarm's multi-hit always ignores taunt).
 */
export function tauntWillApply(u: Unit): boolean {
  if (!u.tauntedBy) return false;
  const beh = u.enemyDef?.behavior;
  // Multi-hit enemies (Nanite Swarm) always hit all party; taunt never redirects.
  if (beh === 'multi-hit') return false;
  const sig = u.enemyDef?.signatureAoE;
  const shock = u.enemyDef?.shockwave;
  // 3-phase boss (Wreckwarden: normal / shockwave / AoE). Next turn will
  // increment turnCount and read phase = (turnCount - 1) % 3 AFTER the
  // increment — equivalent to (current turnCount) % 3. Only phase 0
  // (normal single-target) redirects to the taunter.
  if (shock && sig) {
    const nextPhase = (u.turnCount ?? 0) % 3;
    return nextPhase === 0;
  }
  // 2-phase boss with signatureAoE only: if signatureNext is true, next is
  // AoE (no redirect); otherwise normal single-target (redirects).
  if (sig && u.signatureNext) return false;
  return true;
}

export function validItemTargets(units: Unit[], item: ItemDef): Unit[] {
  switch (item.target) {
    case 'ally-or-vip':
      return units.filter((u) => (u.side === 'party' || u.side === 'vip') && !u.ko);
    case 'ko-ally':
      return units.filter((u) => u.side === 'party' && u.ko);
    case 'caster':
      return units.filter((u) => u.side === 'party' && !u.ko && u.maxMp > 0);
    case 'all-enemies':
      return [];
  }
}
