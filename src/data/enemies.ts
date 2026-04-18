import type { Element } from './classes';

export type EnemyBehavior = 'random' | 'target-escort' | 'multi-hit' | 'ignore-guard';
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
  behavior: EnemyBehavior;
  bossMusicKey?: string;
  attackSfxKey?: string;
  // Multiplier applied to this enemy's formation-slot offsets. Use > 1 for
  // visually larger sprites that need more space (e.g. nanite cluster, wreckling)
  // so neighbors don't overlap. Defaults to 1 (no change).
  formationSpread?: number;
}

export const ENEMIES: Record<string, EnemyDef> = {
  sentry: {
    id: 'sentry',
    name: 'Sentry',
    spriteKey: 'sentryturret-side',
    scale: 2.5,
    hp: 22,
    attack: 11,
    defense: 6,
    speed: 4,
    type: 'robotic',
    vulnerability: 'thermal',
    behavior: 'random',
    attackSfxKey: 'sfx-sentry-attack',
  },
  spider: {
    id: 'spider',
    name: 'Spider-Bot',
    spriteKey: 'spiderbot-side',
    scale: 2.5,
    flipSprite: true,
    hp: 20,
    attack: 11,
    defense: 5,
    speed: 5,
    type: 'robotic',
    vulnerability: 'coolant',
    behavior: 'random',
    attackSfxKey: 'sfx-spider-attack',
  },
  wirehead: {
    id: 'wirehead',
    name: 'Wirehead',
    spriteKey: 'wirehead-east',
    scale: 2.5,
    hp: 25,
    attack: 13,
    defense: 3,
    speed: 4,
    type: 'hybrid',
    vulnerability: 'surge',
    behavior: 'target-escort',
    attackSfxKey: 'sfx-wirehead-attack',
  },
  scoutdrone: {
    id: 'scoutdrone',
    name: 'Scout Drone',
    spriteKey: 'scoutdrone-side',
    scale: 1.6,
    hp: 15,
    attack: 9,
    defense: 2,
    speed: 7,
    type: 'robotic',
    vulnerability: 'surge',
    behavior: 'random',
    formationSpread: 0.2,
    attackSfxKey: 'sfx-scoutdrone-attack',
  },
  naniteswarm: {
    id: 'naniteswarm',
    name: 'Nanite Swarm',
    spriteKey: 'naniteswarm-side',
    scale: 1.7,
    hp: 22,
    attack: 6,
    defense: 3,
    speed: 4,
    type: 'hybrid',
    vulnerability: 'thermal',
    behavior: 'multi-hit',
    formationSpread: 0.2,
    attackSfxKey: 'sfx-naniteswarm-attack',
  },
  wreckling: {
    id: 'wreckling',
    name: 'Wreckling',
    spriteKey: 'wreckling-east',
    scale: 2.2,
    hp: 45,
    attack: 16,
    defense: 7,
    speed: 6,
    type: 'robotic',
    vulnerability: 'surge',
    behavior: 'ignore-guard',
    bossMusicKey: 'music-route-substation-boss',
    attackSfxKey: 'sfx-wreckling-attack',
  },
};

export const VULNERABILITY_GLYPH: Record<Element, string> = {
  thermal: '🔥',
  coolant: '❄',
  surge: '⚡',
  none: '',
};
