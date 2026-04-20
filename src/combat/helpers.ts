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
    case 'ally-or-escort':
      return units.filter((u) => (u.side === 'party' || u.side === 'escort') && !u.ko);
    default:
      return [];
  }
}

export function validItemTargets(units: Unit[], item: ItemDef): Unit[] {
  switch (item.target) {
    case 'ally-or-escort':
      return units.filter((u) => (u.side === 'party' || u.side === 'escort') && !u.ko);
    case 'ko-ally':
      return units.filter((u) => u.side === 'party' && u.ko);
    case 'caster':
      return units.filter((u) => u.side === 'party' && !u.ko && u.maxMp > 0);
    case 'all-enemies':
      return [];
  }
}
