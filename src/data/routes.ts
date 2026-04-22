export interface EncounterDef {
  enemies: string[];
  enemyYOffset?: number;
  // Per-encounter party vertical offset (stacks on top of route + variant).
  // Use for boss encounters where the party should sit further down.
  partyYOffset?: number;
  // Per-encounter background override. Takes priority over the route's
  // backgroundVariants pool. Used for boss-specific arenas.
  backgroundKey?: string;
  // Marks this encounter as a boss fight. Currently only affects the
  // rest-stop IMMEDIATELY before it: that rest fully restores HP/MP
  // instead of partial. Keeps "mid-route rests" as partial strategic
  // recovery while turning the pre-boss rest into a proper "last camp."
  isBoss?: boolean;
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
  // Optional: override `restAfter` based on the resolved encounter count.
  // Use when a pool-sampled route should have more (or fewer) rest stops
  // at higher encounter counts than at lower ones. Keyed by encounter
  // count; if the resolved count has no entry, fall back to `restAfter`.
  restAfterByCount?: Record<number, number[]>;
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
  // Pool of short flavor lines shown under the party marker on the
  // Journey scene. Pulled via a grab-bag so consecutive Journey legs on
  // the same route never repeat a line until the pool cycles. Include at
  // least as many entries as the route's max Journey-leg count (first
  // departure + one per encounter/rest) to guarantee no repeats in a
  // single run.
  journeyFlavor?: string[];
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
    journeyFlavor: [
      'Cracked asphalt winds between rusted billboards.',
      'A cicada-drone whines somewhere in the trees.',
      'Ivy has pulled half the guardrail back into the earth.',
      'Dr. Vey steadies their satchel and nods onward.',
      'Wind carries the scent of wet moss and burnt plastic.',
      'The party skirts a tipped delivery van, door still open.',
      'They march in silence, watching the treeline for movement.',
      'Somewhere far off, a relay beacon pulses, faint but steady.',
      'A crow watches from a broken streetlight, then flies.',
      'Weeds crack the median like something clawed its way up.',
    ],
  },
  {
    id: 'transit-line',
    name: 'Hollow Atrium Mall',
    subtitle: '3–4 encounters · 1–2 rest stops · balanced',
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
    // 4-enc variant gets a second rest — sim showed the 4-encounter run
    // dropping to 26% win with just one rest, dragging the blended avg
    // below the "medium = beatable" target.
    restAfterByCount: { 4: [0, 2] },
    backgroundKey: 'bg-mall-atrium',
    backgroundVariants: [
      'bg-mall-atrium',
      'bg-mall-atrium-garage',
      { key: 'bg-mall-atrium-dept', enemyYOffset: -10, partyYOffset: -20 },
    ],
    musicKeys: ['music-route-hollow-atrium', 'music-route-hollow-atrium-alt'],
    journeyFlavor: [
      'Escalators hang silent under vaulted skylights.',
      'Shattered storefront glass crunches underfoot.',
      'A mannequin watches from a doorway.',
      'Water drips steadily somewhere in the dark.',
      'Dr. Vey keeps close, satchel held tight.',
      'Kiosk signs flicker with decades-dead ad loops.',
      'A food-court fountain is dry, choked with leaves.',
      'Their bootsteps echo down tiled corridors.',
      'A breaker somewhere clicks and resets itself.',
      'They step around a collapsed display of strollers.',
    ],
  },
  {
    id: 'direct-line',
    name: 'Dead Substation',
    subtitle: '2–3 encounters · 0–1 rest stops · brutal',
    difficulty: 'hard',
    // Base (fallback) — matches the 2-encounter variant.
    // NOTE: no `isBoss` flag on this wreckwarden. The 2-encounter variant
    // is already balanced at ~49% win with the 50% rest; only the longer
    // 3-encounter variant (defined below) needs the pre-boss full-restore
    // exception because 2 fights of attrition makes partial rest insufficient.
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
          { enemies: ['sentry', 'sentry'] },
          { enemies: ['wirehead', 'spider', 'sentry'] },
          {
            enemies: ['wreckwarden'],
            enemyYOffset: -30,
            backgroundKey: 'bg-dead-substation-boss',
            // 3-encounter variant ONLY: flag the boss so the pre-boss rest
            // upgrades from partial (50%) to full restore. Sims showed the
            // 2-encounter variant already sits at ~49% win with partial
            // rest, but the 3-encounter variant drops to <2% — the extra
            // fight of attrition drains the party beyond what a partial
            // rest can recover before the Wreckwarden.
            isBoss: true,
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
    journeyFlavor: [
      'Transformer casings hum, then go still again.',
      'Warning tape flutters, faded yellow, half-torn.',
      'Dr. Vey flinches at a breaker snapping somewhere.',
      'Cables droop overhead in black snarled webs.',
      'A stepdown tower leans hard, bolts long since sheared.',
      'The air smells like burnt copper and rain.',
      'Glass insulators crunch like bone underfoot.',
      "A service hatch is open. They don't look down it.",
      'Something heavy shifts behind the next row of transformers.',
    ],
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
