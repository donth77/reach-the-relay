export type TargetType = 'enemy' | 'self' | 'ally-or-escort';

export type Element = 'thermal' | 'coolant' | 'surge' | 'none';

export type AbilityEffectKind =
  | 'damage'
  | 'heal'
  | 'guard'
  | 'salvage'
  | 'pulse'
  | 'slow'
  | 'sleep'
  | 'boost'
  | 'shield-buff'
  | 'taunt'
  | 'flurry'
  | 'item';

export interface AbilityDef {
  id: string;
  label: string;
  description?: string;
  mpCost: number;
  target: TargetType;
  effect: AbilityEffectKind;
  power?: number;
  element?: Element;
  sfxKey?: string;
  maxUsesPerCombat?: number;
}

export interface ClassDef {
  id: string;
  name: string;
  spriteKey: string;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  mp: number;
  abilities: AbilityDef[];
}

export const CLASSES: Record<string, ClassDef> = {
  vanguard: {
    id: 'vanguard',
    name: 'Vanguard',
    spriteKey: 'vanguard-west',
    hp: 70,
    attack: 12,
    defense: 8,
    speed: 4,
    mp: 0,
    abilities: [
      {
        id: 'fight',
        label: 'FIGHT',
        description: 'Basic melee attack. Deal physical damage to one enemy.',
        mpCost: 0,
        target: 'enemy',
        effect: 'damage',
        power: 1,
      },
      {
        id: 'guard',
        label: 'GUARD',
        description:
          'Intercept every enemy attack until your next turn — damage redirected to you and halved. Wreckling ignores this.',
        mpCost: 0,
        target: 'self',
        effect: 'guard',
        sfxKey: 'sfx-vanguard-guard',
        maxUsesPerCombat: 2,
      },
      {
        id: 'taunt',
        label: 'TAUNT',
        description:
          'Force one enemy to attack you next turn. Works on bosses. Full damage, no halving.',
        mpCost: 0,
        target: 'enemy',
        effect: 'taunt',
        sfxKey: 'sfx-vanguard-taunt',
        maxUsesPerCombat: 2,
      },
      {
        id: 'item',
        label: 'ITEM',
        description: 'Use a consumable from shared party inventory.',
        mpCost: 0,
        target: 'self',
        effect: 'item',
      },
    ],
  },
  netrunner: {
    id: 'netrunner',
    name: 'Netrunner',
    spriteKey: 'netrunner-west',
    hp: 35,
    attack: 14,
    defense: 3,
    speed: 7,
    mp: 30,
    abilities: [
      {
        id: 'jack',
        label: 'JACK',
        description: 'Quick remote hack. Weak damage, no MP cost.',
        mpCost: 0,
        target: 'enemy',
        effect: 'damage',
        power: 0.5,
        sfxKey: 'sfx-netrunner-jack',
      },
      {
        id: 'overload',
        label: 'OVERLOAD',
        description: 'Thermal overload attack. Heavy damage to one enemy. 🔥',
        mpCost: 5,
        target: 'enemy',
        effect: 'damage',
        power: 1.6,
        element: 'thermal',
        sfxKey: 'sfx-netrunner-overload',
      },
      {
        id: 'frostlock',
        label: 'FROSTLOCK',
        description: 'Coolant freeze. Damages and halves target ATB speed for 2 turns. ❄\uFE0F',
        mpCost: 5,
        target: 'enemy',
        effect: 'slow',
        power: 0.6,
        element: 'coolant',
        sfxKey: 'sfx-netrunner-frostlock',
      },
      {
        id: 'surge',
        label: 'SURGE',
        description: 'Electric surge. Heavy damage to one enemy. ⚡\uFE0F',
        mpCost: 7,
        target: 'enemy',
        effect: 'damage',
        power: 1.4,
        element: 'surge',
        sfxKey: 'sfx-netrunner-surge',
      },
      {
        id: 'standby',
        label: 'STANDBY',
        description: 'Force one enemy into sleep. They skip turns until damaged.',
        mpCost: 4,
        target: 'enemy',
        effect: 'sleep',
        sfxKey: 'sfx-netrunner-standby',
      },
      {
        id: 'item',
        label: 'ITEM',
        description: 'Use a consumable from shared party inventory.',
        mpCost: 0,
        target: 'self',
        effect: 'item',
      },
    ],
  },
  medic: {
    id: 'medic',
    name: 'Medic',
    spriteKey: 'medic-west',
    hp: 55,
    attack: 8,
    defense: 5,
    speed: 5,
    mp: 28,
    abilities: [
      {
        id: 'strike',
        label: 'STRIKE',
        description: 'Weak melee attack. No MP cost.',
        mpCost: 0,
        target: 'enemy',
        effect: 'damage',
        power: 0.4,
      },
      {
        id: 'patch',
        label: 'PATCH',
        description: 'Heal 25 HP to one ally or Dr. Vey.',
        mpCost: 4,
        target: 'ally-or-escort',
        effect: 'heal',
        power: 25,
        sfxKey: 'sfx-medic-patch',
      },
      {
        id: 'pulse',
        label: 'PULSE',
        description: 'Anti-machine pulse. 1.5× damage vs robotic, 0.5× vs hybrid. Ignores defense.',
        mpCost: 5,
        target: 'enemy',
        effect: 'pulse',
        power: 1,
        sfxKey: 'sfx-medic-pulse',
      },
      {
        id: 'stim',
        label: 'STIM',
        description: "Double an ally's ATB fill rate for 1 turn.",
        mpCost: 6,
        target: 'ally-or-escort',
        effect: 'boost',
        sfxKey: 'sfx-medic-stim',
      },
      {
        id: 'shield',
        label: 'SHIELD',
        description:
          'Halve damage taken by one ally until their next turn. Works even against Wreckling.',
        mpCost: 5,
        target: 'ally-or-escort',
        effect: 'shield-buff',
        sfxKey: 'sfx-medic-shield',
      },
      {
        id: 'item',
        label: 'ITEM',
        description: 'Use a consumable from shared party inventory.',
        mpCost: 0,
        target: 'self',
        effect: 'item',
      },
    ],
  },
  scavenger: {
    id: 'scavenger',
    name: 'Scavenger',
    spriteKey: 'scavenger-west',
    hp: 45,
    attack: 10,
    defense: 4,
    speed: 8,
    mp: 0,
    abilities: [
      {
        id: 'slice',
        label: 'SLICE',
        description: 'Fast melee attack. No MP cost.',
        mpCost: 0,
        target: 'enemy',
        effect: 'damage',
        power: 0.8,
      },
      {
        id: 'salvage',
        label: 'SALVAGE',
        description:
          'Scavenged strike: 50% chance to deal double damage, 25% chance to salvage a random item from the enemy. Max 3/combat.',
        mpCost: 0,
        target: 'enemy',
        effect: 'salvage',
        power: 1,
        sfxKey: 'sfx-scavenger-salvage',
        maxUsesPerCombat: 3,
      },
      {
        id: 'item',
        label: 'ITEM',
        description: 'Use a consumable from shared party inventory.',
        mpCost: 0,
        target: 'self',
        effect: 'item',
      },
    ],
  },
  cybermonk: {
    id: 'cybermonk',
    name: 'Cybermonk',
    spriteKey: 'cybermonk-west',
    hp: 65,
    attack: 13,
    defense: 6,
    speed: 5,
    mp: 0,
    abilities: [
      {
        id: 'fight',
        label: 'FIGHT',
        description: 'Basic melee attack. Deal physical damage to one enemy.',
        mpCost: 0,
        target: 'enemy',
        effect: 'damage',
        power: 1,
      },
      {
        id: 'focus',
        label: 'FOCUS',
        description: 'Meditate to restore 18 HP to yourself. No MP cost.',
        mpCost: 0,
        target: 'self',
        effect: 'heal',
        power: 18,
        sfxKey: 'sfx-cybermonk-focus',
      },
      {
        id: 'flurry',
        label: 'FLURRY',
        description:
          'Three rapid strikes on one enemy. Each hit deals reduced damage but can crit.',
        mpCost: 0,
        target: 'enemy',
        effect: 'flurry',
        power: 0.6,
        sfxKey: 'sfx-cybermonk-flurry',
      },
      {
        id: 'item',
        label: 'ITEM',
        description: 'Use a consumable from shared party inventory.',
        mpCost: 0,
        target: 'self',
        effect: 'item',
      },
    ],
  },
};

export const CLASS_ORDER = ['vanguard', 'netrunner', 'medic', 'scavenger', 'cybermonk'] as const;
