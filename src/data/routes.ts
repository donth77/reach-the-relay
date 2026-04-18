export interface EncounterDef {
  enemies: string[];
  enemyYOffset?: number;
}

export interface BackgroundVariant {
  key: string;
  enemyYOffset?: number;
  partyYOffset?: number;
}

export interface RouteDef {
  id: string;
  name: string;
  subtitle: string;
  difficulty: 'easy' | 'medium' | 'hard';
  encounters: EncounterDef[];
  restAfter: number[];
  backgroundKey: string;
  backgroundVariants?: (string | BackgroundVariant)[];
  musicKeys?: string[];
  enemyYOffset?: number;
  partyYOffset?: number;
}

export const ROUTES: RouteDef[] = [
  {
    id: 'long-highway',
    name: 'The Long Highway',
    subtitle: '5 encounters · 2 rest stops · light patrols',
    difficulty: 'easy',
    encounters: [
      { enemies: ['spider'] },
      { enemies: ['spider', 'scoutdrone'] },
      { enemies: ['sentry', 'spider'] },
      { enemies: ['naniteswarm'] },
      { enemies: ['wirehead', 'spider'] },
    ],
    restAfter: [1, 3],
    backgroundKey: 'bg-overgrown-highway',
    backgroundVariants: [
      'bg-overgrown-highway',
      'bg-overgrown-highway-tunnel',
      'bg-overgrown-highway-gas',
    ],
    musicKeys: ['music-route-overgrown-bridge', 'music-route-overgrown-bridge-alt'],
  },
  {
    id: 'transit-line',
    name: 'Old Transit Line',
    subtitle: '3 encounters · 1 rest stop · balanced',
    difficulty: 'medium',
    encounters: [
      { enemies: ['spider', 'sentry'] },
      { enemies: ['wirehead', 'naniteswarm'] },
      { enemies: ['sentry', 'spider', 'scoutdrone'] },
    ],
    restAfter: [1],
    backgroundKey: 'bg-mall-atrium',
    backgroundVariants: [
      'bg-mall-atrium',
      'bg-mall-atrium-garage',
      { key: 'bg-mall-atrium-dept', enemyYOffset: -10, partyYOffset: -20 },
    ],
    musicKeys: ['music-route-hollow-atrium', 'music-route-hollow-atrium-alt'],
  },
  {
    id: 'direct-line',
    name: 'Direct Line',
    subtitle: '2 encounters · no rest · brutal',
    difficulty: 'hard',
    encounters: [
      { enemies: ['wirehead', 'spider', 'sentry'] },
      { enemies: ['wreckling'], enemyYOffset: -30 },
    ],
    restAfter: [],
    backgroundKey: 'bg-dead-substation',
    backgroundVariants: [
      'bg-dead-substation',
      { key: 'bg-dead-substation-transformer', enemyYOffset: 30, partyYOffset: 30 },
    ],
    musicKeys: ['music-route-substation', 'music-route-substation-alt'],
    enemyYOffset: 15,
    partyYOffset: -30,
  },
  {
    id: 'test-nanite-drone',
    name: 'TEST — Nanites & Drones',
    subtitle: '1 encounter · dev test route',
    difficulty: 'easy',
    encounters: [{ enemies: ['naniteswarm', 'scoutdrone'] }],
    restAfter: [],
    backgroundKey: 'bg-overgrown-highway',
    musicKeys: ['music-route-overgrown-bridge', 'music-route-overgrown-bridge-alt'],
  },
];
