import type { Element } from './classes';

export type EnemyBehavior = 'random' | 'target-escort' | 'multi-hit' | 'prefer-low-hp';
export type EnemyType = 'robotic' | 'hybrid';

export interface EnemyDef {
  id: string;
  name: string;
  spriteKey: string;
  scale: number;
  flipSprite?: boolean;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  type: EnemyType;
  vulnerability: Element;
  // Elements this enemy resists — damage from any matching element is halved.
  // Must not include the vulnerability.
  resistances?: Element[];
  // Element applied to this enemy's basic attack (bosses only). Damage number
  // shows the glyph; the target's resistance/vulnerability applies.
  attackElement?: Element;
  // Verb phrase used in the combat log instead of the default "attacks".
  // e.g. "fires PLASMA BOLT at" → "Sentry fires PLASMA BOLT at Medic!".
  attackName?: string;
  // If true, this enemy ignores GUARD redirect (still respects TAUNT).
  ignoresGuard?: boolean;
  // Boss-only: an AoE elemental slam on every other turn that hits all party
  // members (escort exempt). Uses a dedicated animation key.
  signatureAoE?: {
    element: Element;
    animKey: string; // e.g. 'wreckwarden-attack-coolant-east'
    power: number; // damage multiplier vs full attack
  };
  // Boss-only: a ranged projectile attack that damages + resets target ATB.
  // Targeting is weighted random (highest-ATB party > random > last-damager).
  shockwave?: {
    element: Element; // projectile color element (usually 'surge')
    animKey: string; // e.g. 'wreckwarden-attack-shockwave-east'
    power: number; // damage multiplier vs basic attack
    // Y offset from sprite center where the projectile launches (negative = up).
    // Wreckwarden's chest sits ~20px above center.
    chestYOffset?: number;
  };
  behavior: EnemyBehavior;
  bossMusicKey?: string;
  attackSfxKey?: string;
  // Multiplier applied to this enemy's formation-slot offsets. Use > 1 for
  // visually larger sprites that need more space (e.g. nanite cluster, wreckwarden)
  // so neighbors don't overlap. Defaults to 1 (no change).
  formationSpread?: number;
  // Short description shown in the enemy hover tooltip.
  description?: string;
  // Aerial evasion: 30% chance to dodge basic physical attacks (FIGHT/SLICE/STRIKE).
  // Abilities with a sfxKey or element ignore evasion.
  evasive?: boolean;
}

export const ENEMIES: Record<string, EnemyDef> = {
  sentry: {
    id: 'sentry',
    name: 'Sentry',
    spriteKey: 'sentryturret-side',
    scale: 2.5,
    hp: 65,
    attack: 14,
    defense: 10,
    speed: 4,
    type: 'robotic',
    vulnerability: 'thermal',
    resistances: ['coolant'],
    attackElement: 'thermal',
    behavior: 'random',
    attackSfxKey: 'sfx-sentry-attack',
    attackName: 'fires PLASMA BOLT at',
    description:
      'Tripod turret with insulated armor. Fires plasma bolts — its own heat sink runs hot, one push over the limit cooks the circuits.',
  },
  spider: {
    id: 'spider',
    name: 'Spider-Bot',
    spriteKey: 'spiderbot-side',
    scale: 2.5,
    flipSprite: true,
    hp: 30,
    attack: 11,
    defense: 5,
    speed: 5,
    type: 'robotic',
    vulnerability: 'coolant',
    resistances: ['thermal'],
    behavior: 'random',
    attackSfxKey: 'sfx-spider-attack',
    description:
      'Fast scuttler with exposed hydraulic lines. Metal chassis shrugs off heat, but cold seizes its joints.',
  },
  wirehead: {
    id: 'wirehead',
    name: 'Wirehead',
    spriteKey: 'wirehead-east',
    scale: 2.0,
    hp: 35,
    attack: 13,
    defense: 3,
    speed: 4,
    type: 'hybrid',
    vulnerability: 'surge',
    resistances: ['thermal'],
    behavior: 'target-escort',
    attackSfxKey: 'sfx-wirehead-attack',
    description:
      "Former human, wired into the Censor's grid. Hunts NPCs — always targets the escort. Cybernetic skin laughs off flame; the implant in its skull can't take a current spike.",
  },
  scoutdrone: {
    id: 'scoutdrone',
    name: 'Scout Drone',
    spriteKey: 'scoutdrone-side',
    scale: 1.6,
    hp: 25,
    attack: 9,
    defense: 4,
    speed: 7,
    type: 'robotic',
    vulnerability: 'surge',
    resistances: ['coolant'],
    behavior: 'prefer-low-hp',
    formationSpread: 0.2,
    attackSfxKey: 'sfx-scoutdrone-attack',
    evasive: true,
    description:
      'Evasive aerial recon bot — dodges basic melee. Hunts wounded party. Metal frame shrugs off the cold; delicate optics fry under a current spike.',
  },
  naniteswarm: {
    id: 'naniteswarm',
    name: 'Nanite Swarm',
    spriteKey: 'naniteswarm-side',
    scale: 1.7,
    hp: 30,
    attack: 11,
    defense: 5,
    speed: 4,
    type: 'hybrid',
    vulnerability: 'thermal',
    resistances: ['surge'],
    behavior: 'multi-hit',
    formationSpread: 0.2,
    attackSfxKey: 'sfx-naniteswarm-attack',
    description:
      'Cloud of bio-polymer nanobots — hits the whole party each turn for light damage. Melts under heat; current passes harmlessly through distributed nodes.',
  },
  wreckwarden: {
    id: 'wreckwarden',
    name: 'Wreckwarden',
    spriteKey: 'wreckwarden-east',
    scale: 2.2,
    hp: 85,
    attack: 20,
    defense: 9,
    speed: 6,
    type: 'robotic',
    vulnerability: 'none',
    resistances: ['thermal', 'coolant'],
    behavior: 'target-escort',
    ignoresGuard: true,
    signatureAoE: {
      element: 'coolant',
      animKey: 'wreckwarden-attack-coolant-east',
      power: 0.8,
    },
    shockwave: {
      element: 'surge',
      animKey: 'wreckwarden-attack-shockwave-east',
      power: 1.0,
      chestYOffset: -20,
    },
    bossMusicKey: 'music-route-substation-boss',
    attackSfxKey: 'sfx-wreckwarden-attack',
    description:
      'Apex Censor enforcer — a tower of welded warbot plating. Ignores GUARD, hunts the escort, and vents cryogenic slams at the whole party. Armor and coolant systems shrug off heat and cold alike.',
  },
};

export const VULNERABILITY_GLYPH: Record<Element, string> = {
  thermal: '🔥',
  coolant: '❄\uFE0F',
  surge: '⚡\uFE0F',
  none: '',
};
