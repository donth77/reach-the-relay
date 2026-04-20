export interface EncounterDef {
  enemies: string[];
  enemyYOffset?: number;
  // Per-encounter party vertical offset (stacks on top of route + variant).
  // Use for boss encounters where the party should sit further down.
  partyYOffset?: number;
  // Per-encounter background override. Takes priority over the route's
  // backgroundVariants pool. Used for boss-specific arenas.
  backgroundKey?: string;
}

export interface BackgroundVariant {
  key: string;
  enemyYOffset?: number;
  partyYOffset?: number;
}

export interface RouteVariant {
  // Full encounter sequence for this variant (used as-is, no pool sampling).
  encounters: EncounterDef[];
  // Rest stops after these encounter indices.
  restAfter: number[];
  // Optional inventory override — merged over the route's base STARTING_INVENTORY
  // when this variant is picked. Useful for compensating a tougher variant
  // (e.g. fewer rests) with more consumables.
  startingInventory?: Record<string, number>;
}

export interface RouteDef {
  id: string;
  name: string;
  subtitle: string;
  difficulty: 'easy' | 'medium' | 'hard';
  // Fallback fixed-sequence encounters. Used when no encounterPool is set.
  encounters: EncounterDef[];
  // Optional: random-sample from this pool to build the encounter list at run
  // start. Slot count = `encounterPoolCount` (fixed) or a range picked uniformly
  // from `encounterPoolCountRange`. Avoids picking the same entry twice in a
  // row. Routes like Direct Line can omit this to keep their scripted sequence.
  encounterPool?: EncounterDef[];
  encounterPoolCount?: number;
  encounterPoolCountRange?: [number, number];
  restAfter: number[];
  // Optional: structural variants of the route. At run start one is picked
  // uniformly at random and its `encounters` + `restAfter` replace the base.
  // Use when a route's shape (# of encounters, rest placement) should vary run
  // to run, e.g. Direct Line flipping between 2-enc/no-rest and 3-enc/1-rest.
  variants?: RouteVariant[];
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
    subtitle: '5–6 encounters · 2 rest stops · light patrols',
    difficulty: 'easy',
    // Fallback fixed list used only if encounterPool is absent.
    encounters: [
      { enemies: ['spider'] },
      { enemies: ['spider', 'scoutdrone'] },
      { enemies: ['sentry', 'spider'] },
      { enemies: ['naniteswarm'] },
      { enemies: ['wirehead', 'spider'] },
    ],
    encounterPool: [
      { enemies: ['spider'] },
      { enemies: ['scoutdrone'] },
      { enemies: ['spider', 'scoutdrone'] },
      { enemies: ['sentry'] },
      { enemies: ['sentry', 'spider'] },
      { enemies: ['sentry', 'scoutdrone'] },
      { enemies: ['naniteswarm'] },
      { enemies: ['spider', 'naniteswarm'] },
      { enemies: ['wirehead'] },
      { enemies: ['wirehead', 'spider'] },
      { enemies: ['wirehead', 'scoutdrone'] },
      { enemies: ['scoutdrone', 'scoutdrone'] },
    ],
    encounterPoolCountRange: [5, 6],
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
    subtitle: '3–4 encounters · 1 rest stop · balanced',
    difficulty: 'medium',
    encounters: [
      { enemies: ['spider', 'sentry'] },
      { enemies: ['wirehead', 'naniteswarm'] },
      { enemies: ['sentry', 'spider', 'scoutdrone'] },
    ],
    encounterPool: [
      { enemies: ['spider', 'sentry'] },
      { enemies: ['sentry', 'scoutdrone'] },
      { enemies: ['wirehead', 'naniteswarm'] },
      { enemies: ['wirehead', 'scoutdrone'] },
      { enemies: ['wirehead', 'spider', 'sentry'] },
      { enemies: ['sentry', 'spider', 'scoutdrone'] },
      { enemies: ['naniteswarm', 'scoutdrone'] },
      { enemies: ['wirehead', 'sentry'] },
      { enemies: ['spider', 'spider', 'scoutdrone'] },
      { enemies: ['sentry', 'sentry'] },
      { enemies: ['wirehead', 'wirehead', 'wirehead'] },
      { enemies: ['naniteswarm', 'naniteswarm', 'naniteswarm', 'naniteswarm'] },
    ],
    encounterPoolCountRange: [3, 4],
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
    subtitle: '2–3 encounters · brutal',
    difficulty: 'hard',
    // Base (fallback) — matches the 2-encounter variant.
    encounters: [
      { enemies: ['wirehead', 'spider', 'sentry'] },
      {
        enemies: ['wreckwarden'],
        enemyYOffset: -80,
        partyYOffset: 40,
        backgroundKey: 'bg-dead-substation-boss',
      },
    ],
    restAfter: [],
    // Two structural variants, picked 50/50 at run start. Both include a rest
    // before the Wreckwarden boss so the party gets at least one breather:
    //  A) 2 encounters — one opener, then rest, then boss
    //  B) 3 encounters — opener, mid-fight, rest, boss
    variants: [
      {
        encounters: [
          { 
            enemies: ['wirehead', 'spider', 'sentry'],           
           },
          {
            enemies: ['wreckwarden'],
            enemyYOffset: -30,
            backgroundKey: 'bg-dead-substation-boss',
          },
        ],
        restAfter: [0],
        // 2-enc variant still gets extra supplies for a shorter, denser run:
        // 2 stimpaks + 1 powercell (vs the base 1 stimpak).
        // startingInventory: { stimpak: 2, powercell: 1, adrenaline: 0, smokegrenade: 0 },
      },
      {
        encounters: [
          { enemies: ['sentry', 'sentry'], 
            },
          { enemies: ['wirehead', 'spider', 'sentry'] },
          {
            enemies: ['wreckwarden'],
            enemyYOffset: -30,
            backgroundKey: 'bg-dead-substation-boss',
          },
        ],
        restAfter: [1],
      },
    ],
    backgroundKey: 'bg-dead-substation',
    backgroundVariants: [
      'bg-dead-substation',
      { key: 'bg-dead-substation-transformer', enemyYOffset: 15, partyYOffset: 30 },
    ],
    musicKeys: ['music-route-substation', 'music-route-substation-alt'],
    enemyYOffset: 15,
    partyYOffset: -30,
  },
  // {
  //   id: 'test-nanite-drone',
  //   name: 'TEST — Nanites & Drones',
  //   subtitle: '1 encounter · dev test route',
  //   difficulty: 'easy',
  //   encounters: [      { enemies: ['naniteswarm', 'naniteswarm', 'naniteswarm', 'naniteswarm'] }],
  //   restAfter: [],
  //   backgroundKey: 'bg-overgrown-highway',
  //   musicKeys: ['music-route-overgrown-bridge', 'music-route-overgrown-bridge-alt'],
  // },
  {
    id: 'test-wreckwarden',
    name: 'TEST — Wreckwarden Boss',
    subtitle: '1 encounter · dev boss test',
    difficulty: 'hard',
    encounters: [
      {
        enemies: ['wreckwarden'],
        enemyYOffset: -80,
        partyYOffset: 35,
        backgroundKey: 'bg-dead-substation-boss',
      },
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
];
