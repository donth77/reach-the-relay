import { writeFileSync } from 'node:fs';
import {
  runTrials,
  runRouteTrials,
  simulateRoute,
  type SimStats,
  type RouteConfig,
  type RouteStats,
} from './simBattle';
import { ENEMIES } from '../data/enemies';
import { ROUTES } from '../data/routes';

const TRIALS = 1000;
const TARGET_MIN = 0.5;
const TARGET_MAX = 0.6;

const CLASSES_LIST = ['vanguard', 'netrunner', 'medic', 'scavenger', 'cybermonk'] as const;

function allPartyCombos(): string[][] {
  const out: string[][] = [];
  for (let a = 0; a < CLASSES_LIST.length; a++) {
    for (let b = a + 1; b < CLASSES_LIST.length; b++) {
      for (let c = b + 1; c < CLASSES_LIST.length; c++) {
        out.push([CLASSES_LIST[a], CLASSES_LIST[b], CLASSES_LIST[c]]);
      }
    }
  }
  return out;
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function fmtNum(x: number, digits = 1): string {
  return x.toFixed(digits);
}

function inTargetBand(wr: number): string {
  if (wr < TARGET_MIN - 0.05) return '🔴 hard';
  if (wr > TARGET_MAX + 0.1) return '🟢 easy';
  if (wr >= TARGET_MIN && wr <= TARGET_MAX) return '⭐ ideal';
  return '🟡 close';
}

function partyLabel(ids: string[]): string {
  return ids.map((id) => id[0].toUpperCase() + id.slice(1, 3)).join('+');
}

function itemsSummary(stats: SimStats): string {
  const parts: string[] = [];
  for (const k of ['stimpak', 'powercell', 'adrenaline']) {
    const v = stats.avgItemsUsed[k] ?? 0;
    if (v > 0.01) parts.push(`${k}:${fmtNum(v, 2)}`);
  }
  return parts.length ? parts.join(', ') : '—';
}

const lines: string[] = [];
lines.push('# Wreckwarden Battle Simulations');
lines.push('');
lines.push(`_Generated ${new Date().toISOString()}_  ·  ${TRIALS} trials per scenario`);
lines.push('');
lines.push(`**Target win rate: ${fmtPct(TARGET_MIN)}–${fmtPct(TARGET_MAX)}**`);
lines.push('');
lines.push(
  'Too easy (>70%) kills drama; too hard (<40%) frustrates. 50–60% = "thrilling but earned" — analogous to Hades final-boss pacing. Classic FF bosses sit ~70-85% but target different pacing.',
);
lines.push('');
lines.push(
  'Band legend: ⭐ ideal (50-60%) · 🟡 close (within 5pp) · 🟢 easy (>65%) · 🔴 hard (<45%)',
);
lines.push('');
lines.push('## Policy assumptions');
lines.push('');
lines.push(
  '- **Medic**: PATCH escort when ≤50% HP → PATCH ally ≤40% HP → SHIELD escort when ≤70% HP → PULSE boss → STRIKE',
);
lines.push(
  '- **Netrunner**: pick highest-expected-damage ability (penalizes resisted elements, bonus for vulnerability); falls back to JACK if low MP. Uses POWERCELL item when MP < 8.',
);
lines.push(
  '- **Vanguard**: TAUNT when escort ≤50% HP and next boss phase is not AoE; GUARD when healthy and non-ignoreGuard enemy; else FIGHT',
);
lines.push('- **Cybermonk**: FOCUS when self ≤40% HP; else FLURRY; else FIGHT');
lines.push('- **Scavenger**: SALVAGE while uses remain; else SLICE');
lines.push('- **Items**: STIMPAK on escort when critical (≤30% HP); no smoke-grenade simulated');
lines.push(
  '- **Evasion**: 30% dodge on basic physical attacks vs evasive enemies (not relevant for boss)',
);
lines.push('');
lines.push('## Current Wreckwarden stats');
lines.push('');
const w = ENEMIES.wreckwarden;
lines.push(
  `HP **${w.hp}** · Attack **${w.attack}** · Defense **${w.defense}** · Speed **${w.speed}**`,
);
lines.push('');
lines.push(
  'Rotation: normal single-target (target-escort) → SHOCKWAVE (damage + ATB reset, weighted-random target) → signature coolant AoE → repeat. Ignores GUARD. Resists thermal + coolant; no vulnerability.',
);
lines.push('');

// Direct Line inventory (the route that leads to Wreckwarden)
const directLineInventory = { stimpak: 1, powercell: 0, adrenaline: 0, smokegrenade: 0 };

// ============ Block 1: all party combos at current stats ============
lines.push('## All 10 party combos vs current Wreckwarden (fresh + degraded)');
lines.push('');
lines.push(
  "_Fresh = full HP/MP. Degraded = arriving from Direct Line's prior encounter: ~80% HP, ~70% MP for casters, one use of each limited ability already spent._",
);
lines.push('');
lines.push('| Party | Fresh Win % | Degraded Win % | Drop |');
lines.push('|---|---:|---:|---:|');

const comboStats: Array<{ party: string[]; stats: SimStats; degradedStats: SimStats }> = [];
for (const party of allPartyCombos()) {
  const stats = runTrials({ partyClassIds: party, startingInventory: directLineInventory }, TRIALS);
  const degradedStats = runTrials(
    { partyClassIds: party, startingInventory: directLineInventory, startDegraded: true },
    TRIALS,
  );
  comboStats.push({ party, stats, degradedStats });
  const drop = stats.winRate - degradedStats.winRate;
  lines.push(
    `| ${partyLabel(party)} | ${fmtPct(stats.winRate)} ${inTargetBand(stats.winRate)} | ${fmtPct(degradedStats.winRate)} ${inTargetBand(degradedStats.winRate)} | ${fmtPct(drop)} |`,
  );
}

// Overall average across all combos
const overallWr = comboStats.reduce((a, b) => a + b.stats.winRate, 0) / comboStats.length;
lines.push('');
lines.push(
  `**Overall mean win rate across all combos:** ${fmtPct(overallWr)} ${inTargetBand(overallWr)}`,
);
lines.push('');

const best = [...comboStats].sort((a, b) => b.stats.winRate - a.stats.winRate)[0];
const worst = [...comboStats].sort((a, b) => a.stats.winRate - b.stats.winRate)[0];
lines.push(`- Best combo: **${partyLabel(best.party)}** (${fmtPct(best.stats.winRate)})`);
lines.push(`- Worst combo: **${partyLabel(worst.party)}** (${fmtPct(worst.stats.winRate)})`);
lines.push('');

// ============ Block 2: HP sweep for balanced party ============
const balancedParty = ['vanguard', 'netrunner', 'medic'];
lines.push(`## HP sweep on Wreckwarden — degraded-start party = ${partyLabel(balancedParty)}`);
lines.push('');
lines.push('| Wreckwarden HP | Fresh Win % | Degraded Win % | Avg escort HP (degraded) |');
lines.push('|---:|---:|---:|---:|');
for (const hp of [60, 70, 80, 85, 90, 100, 110, 120]) {
  const fresh = runTrials(
    {
      partyClassIds: balancedParty,
      enemyOverrides: { hp },
      startingInventory: directLineInventory,
    },
    TRIALS,
  );
  const deg = runTrials(
    {
      partyClassIds: balancedParty,
      enemyOverrides: { hp },
      startingInventory: directLineInventory,
      startDegraded: true,
    },
    TRIALS,
  );
  lines.push(
    `| ${hp} | ${fmtPct(fresh.winRate)} ${inTargetBand(fresh.winRate)} | ${fmtPct(deg.winRate)} ${inTargetBand(deg.winRate)} | ${fmtNum(deg.avgEscortHpEnd)}/35 |`,
  );
}
lines.push('');

// ============ Block 3: Attack sweep ============
lines.push(`## Attack sweep on Wreckwarden (party = ${partyLabel(balancedParty)}, HP=${w.hp})`);
lines.push('');
lines.push('| Wreckwarden Atk | Win % | Avg escort HP | Escort KO % |');
lines.push('|---:|---:|---:|---:|');
for (const atk of [16, 18, 20, 22, 24]) {
  const stats = runTrials(
    {
      partyClassIds: balancedParty,
      enemyOverrides: { attack: atk },
      startingInventory: directLineInventory,
    },
    TRIALS,
  );
  const band = inTargetBand(stats.winRate);
  lines.push(
    `| ${atk} | ${fmtPct(stats.winRate)} ${band} | ${fmtNum(stats.avgEscortHpEnd)}/35 | ${fmtPct(stats.escortKoRate)} |`,
  );
}
lines.push('');

// ============ Block 4: Defense sweep ============
lines.push(`## Defense sweep on Wreckwarden (party = ${partyLabel(balancedParty)}, HP=${w.hp})`);
lines.push('');
lines.push('| Wreckwarden Def | Win % | Avg turns | Escort KO % |');
lines.push('|---:|---:|---:|---:|');
for (const def of [6, 8, 9, 10, 12]) {
  const stats = runTrials(
    {
      partyClassIds: balancedParty,
      enemyOverrides: { defense: def },
      startingInventory: directLineInventory,
    },
    TRIALS,
  );
  const band = inTargetBand(stats.winRate);
  lines.push(
    `| ${def} | ${fmtPct(stats.winRate)} ${band} | ${fmtNum(stats.avgTurns)} | ${fmtPct(stats.escortKoRate)} |`,
  );
}
lines.push('');

// ============ Block 5: Inventory sweep ============
lines.push(`## Inventory impact (party = ${partyLabel(balancedParty)})`);
lines.push('');
lines.push('| Inventory | Win % | Avg escort HP | Items used |');
lines.push('|---|---:|---:|---|');
const inventories: Array<{ label: string; inv: Record<string, number> }> = [
  {
    label: 'Direct Line (1 stim)',
    inv: { stimpak: 1, powercell: 0, adrenaline: 0, smokegrenade: 0 },
  },
  {
    label: 'Transit Line (2/1/1)',
    inv: { stimpak: 2, powercell: 1, adrenaline: 1, smokegrenade: 0 },
  },
  {
    label: 'Long Highway (3/2/1)',
    inv: { stimpak: 3, powercell: 2, adrenaline: 1, smokegrenade: 1 },
  },
  { label: 'Empty', inv: { stimpak: 0, powercell: 0, adrenaline: 0, smokegrenade: 0 } },
];
for (const { label, inv } of inventories) {
  const stats = runTrials({ partyClassIds: balancedParty, startingInventory: inv }, TRIALS);
  const band = inTargetBand(stats.winRate);
  lines.push(
    `| ${label} | ${fmtPct(stats.winRate)} ${band} | ${fmtNum(stats.avgEscortHpEnd)}/35 | ${itemsSummary(stats)} |`,
  );
}
lines.push('');

// ============ Block 6: Tuning recommendation ============
lines.push('## Tuning suggestion');
lines.push('');
const best2d = comboStats.sort((a, b) => b.stats.winRate - a.stats.winRate);
const medianWr = best2d[Math.floor(best2d.length / 2)].stats.winRate;
lines.push(`Median party combo win rate: **${fmtPct(medianWr)}** ${inTargetBand(medianWr)}`);
lines.push('');
if (medianWr < TARGET_MIN) {
  lines.push(
    `Median is **below** the 50–60% target band. Consider lowering Wreckwarden HP, defense, or attack — cross-reference the sweep tables above to pick the lightest-touch tweak that lands in band.`,
  );
} else if (medianWr > TARGET_MAX) {
  lines.push(
    `Median is **above** the 50–60% target band. Wreckwarden is currently too easy for a balanced party. Consider +5–10 HP or +1 defense/attack — again see sweeps above.`,
  );
} else {
  lines.push(
    `Median sits inside the 50–60% target band. Current stats are well-tuned on average; if a specific combo is out of band, consider class-level tweaks rather than boss-level.`,
  );
}
lines.push('');
// ============ Block 7: All three routes with new randomized structures ============
lines.push('## Full-route simulations (new randomized structures)');
lines.push('');
lines.push(
  "Direct Line: 50/50 between 2-enc/no-rest and 3-enc/rest-after-first. Long Highway: 5-6 encounters (random). Transit Line: 3-4 encounters (random). All runs end when either all enemies cleared on the final encounter (win) or escort KO'd / party wiped (lose).",
);
lines.push('');

const routeParty = ['vanguard', 'netrunner', 'medic'];

// Helpers to build route configs
const directLineVariantA: RouteConfig = {
  partyClassIds: routeParty,
  encounters: [
    { enemyIds: ['wirehead', 'spider', 'sentry'] },
    { enemyIds: ['wreckwarden'], isBoss: true },
  ],
  // 2-enc variant: rest before boss, plus 2 stim + 1 powercell for a dense run.
  startingInventory: { stimpak: 2, powercell: 1, adrenaline: 0, smokegrenade: 0 },
  restAfter: [0],
};
const directLineVariantB: RouteConfig = {
  partyClassIds: routeParty,
  encounters: [
    { enemyIds: ['wirehead', 'spider', 'sentry'] },
    { enemyIds: ['spider', 'sentry'] },
    { enemyIds: ['wreckwarden'], isBoss: true },
  ],
  startingInventory: directLineInventory,
  restAfter: [1],
};

// Pool-sampling runner — builds a fresh encounter list per trial by sampling
// from the actual routes.ts pool (matching game behavior). Returns stats
// aggregated across `trials` pool-sampled routes.
function runPoolSampledRoute(
  routeId: 'long-highway' | 'transit-line',
  partyIds: string[],
  inventory: Record<string, number>,
  countOverride: number | undefined,
  trials: number,
): RouteStats {
  const route = ROUTES.find((r) => r.id === routeId);
  if (!route || !route.encounterPool) {
    throw new Error(`Route ${routeId} has no encounterPool`);
  }
  const pool = route.encounterPool;
  const [lo, hi] = route.encounterPoolCountRange ?? [route.encounterPoolCount ?? 3, route.encounterPoolCount ?? 3];
  let routeWins = 0, bossWins = 0, encSum = 0, escortHpSum = 0, escortKos = 0, hpPctSum = 0;
  const items: Record<string, number> = {};
  for (let t = 0; t < trials; t++) {
    const count = countOverride ?? lo + Math.floor(Math.random() * (hi - lo + 1));
    // Grab-bag: shuffle a copy of the pool and pop the first `count` entries.
    // Mirrors the real game's drawFromBag behavior so sim numbers reflect the
    // "no clumping, rare entries always get drawn" distribution.
    const bag = [...pool];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    const encounters: RouteConfig['encounters'] = [];
    for (let i = 0; i < count; i++) {
      const pick = bag[i % bag.length];
      encounters.push({ enemyIds: pick.enemies, isBoss: i === count - 1 });
    }
    const result = simulateRoute({
      partyClassIds: partyIds,
      encounters,
      startingInventory: inventory,
      restAfter: route.restAfter,
    });
    if (result.routeWon) routeWins++;
    if (result.bossWon) bossWins++;
    encSum += result.encountersCleared;
    escortHpSum += result.escortHpEnd;
    if (result.escortHpEnd <= 0) escortKos++;
    hpPctSum += result.partyHpEndPct;
    for (const [k, v] of Object.entries(result.itemsUsed)) items[k] = (items[k] ?? 0) + v;
  }
  const avgItems: Record<string, number> = {};
  for (const [k, v] of Object.entries(items)) avgItems[k] = v / trials;
  return {
    trials,
    routeWinRate: routeWins / trials,
    bossWinRate: bossWins / trials,
    avgEncountersCleared: encSum / trials,
    avgEscortHpEnd: escortHpSum / trials,
    escortKoRate: escortKos / trials,
    avgPartyHpEndPct: hpPctSum / trials,
    avgItemsUsed: avgItems,
  };
}


function routeRow(label: string, stats: ReturnType<typeof runRouteTrials>): string {
  const band = inTargetBand(stats.routeWinRate);
  const items: string[] = [];
  for (const k of ['stimpak', 'powercell', 'adrenaline']) {
    const v = stats.avgItemsUsed[k] ?? 0;
    if (v > 0.01) items.push(`${k}:${fmtNum(v, 2)}`);
  }
  return `| ${label} | ${fmtPct(stats.routeWinRate)} ${band} | ${fmtPct(stats.bossWinRate)} | ${fmtNum(stats.avgEncountersCleared, 2)} | ${fmtNum(stats.avgEscortHpEnd)}/35 | ${items.join(', ') || '—'} |`;
}

// Direct Line — both variants + blended
lines.push(`### Direct Line (party = ${partyLabel(routeParty)}, inventory = 1 stim)`);
lines.push('');
lines.push(
  '| Variant | Full-run win % | Boss win % | Avg enc cleared | Escort HP end | Items used |',
);
lines.push('|---|---:|---:|---:|---:|---|');
const dlaStats = runRouteTrials(directLineVariantA, TRIALS);
const dlbStats = runRouteTrials(directLineVariantB, TRIALS);
lines.push(routeRow('A: 2 enc / 1 rest before boss', dlaStats));
lines.push(routeRow('B: 3 enc / 1 rest (after enc 1, before boss)', dlbStats));
const blendedWr = (dlaStats.routeWinRate + dlbStats.routeWinRate) / 2;
const blendedBossWr = (dlaStats.bossWinRate + dlbStats.bossWinRate) / 2;
lines.push(
  `| **50/50 blend** | **${fmtPct(blendedWr)} ${inTargetBand(blendedWr)}** | **${fmtPct(blendedBossWr)}** | — | — | — |`,
);
lines.push('');

// Long Highway — pool-sampled per trial from real routes.ts pool
lines.push(`### Long Highway (party = ${partyLabel(routeParty)}, inventory = 3/2/1/1) — pool-sampled`);
lines.push('');
lines.push('| Variant | Full-run win % | Avg enc cleared | Escort HP end |');
lines.push('|---|---:|---:|---:|');
const longHighwayInv = { stimpak: 3, powercell: 2, adrenaline: 1, smokegrenade: 1 };
const lh5 = runPoolSampledRoute('long-highway', routeParty, longHighwayInv, 5, TRIALS);
const lh6 = runPoolSampledRoute('long-highway', routeParty, longHighwayInv, 6, TRIALS);
const lhBlendStats = runPoolSampledRoute('long-highway', routeParty, longHighwayInv, undefined, TRIALS);
lines.push(`| 5 encounters | ${fmtPct(lh5.routeWinRate)} ${inTargetBand(lh5.routeWinRate)} | ${fmtNum(lh5.avgEncountersCleared, 2)} | ${fmtNum(lh5.avgEscortHpEnd)}/35 |`);
lines.push(`| 6 encounters | ${fmtPct(lh6.routeWinRate)} ${inTargetBand(lh6.routeWinRate)} | ${fmtNum(lh6.avgEncountersCleared, 2)} | ${fmtNum(lh6.avgEscortHpEnd)}/35 |`);
lines.push(`| **50/50 (5 or 6)** | **${fmtPct(lhBlendStats.routeWinRate)} ${inTargetBand(lhBlendStats.routeWinRate)}** | ${fmtNum(lhBlendStats.avgEncountersCleared, 2)} | ${fmtNum(lhBlendStats.avgEscortHpEnd)}/35 |`);
lines.push('');
const lhBlend = lhBlendStats.routeWinRate;

// Transit Line — pool-sampled per trial
lines.push(`### Transit Line (party = ${partyLabel(routeParty)}, inventory = 2/1/1/0) — pool-sampled`);
lines.push('');
lines.push('| Variant | Full-run win % | Avg enc cleared | Escort HP end |');
lines.push('|---|---:|---:|---:|');
const transitLineInv = { stimpak: 2, powercell: 1, adrenaline: 1, smokegrenade: 0 };
const tl3 = runPoolSampledRoute('transit-line', routeParty, transitLineInv, 3, TRIALS);
const tl4 = runPoolSampledRoute('transit-line', routeParty, transitLineInv, 4, TRIALS);
const tlBlendStats = runPoolSampledRoute('transit-line', routeParty, transitLineInv, undefined, TRIALS);
lines.push(`| 3 encounters | ${fmtPct(tl3.routeWinRate)} ${inTargetBand(tl3.routeWinRate)} | ${fmtNum(tl3.avgEncountersCleared, 2)} | ${fmtNum(tl3.avgEscortHpEnd)}/35 |`);
lines.push(`| 4 encounters | ${fmtPct(tl4.routeWinRate)} ${inTargetBand(tl4.routeWinRate)} | ${fmtNum(tl4.avgEncountersCleared, 2)} | ${fmtNum(tl4.avgEscortHpEnd)}/35 |`);
lines.push(`| **50/50 (3 or 4)** | **${fmtPct(tlBlendStats.routeWinRate)} ${inTargetBand(tlBlendStats.routeWinRate)}** | ${fmtNum(tlBlendStats.avgEncountersCleared, 2)} | ${fmtNum(tlBlendStats.avgEscortHpEnd)}/35 |`);
lines.push('');
const tlBlend = tlBlendStats.routeWinRate;

// Cross-route summary
lines.push('### Cross-route summary');
lines.push('');
lines.push('| Route | Blended win % | Target alignment |');
lines.push('|---|---:|---|');
lines.push(`| Direct Line (hard) | ${fmtPct(blendedWr)} | ${inTargetBand(blendedWr)} |`);
lines.push(`| Transit Line (medium) | ${fmtPct(tlBlend)} | ${inTargetBand(tlBlend)} |`);
lines.push(`| Long Highway (easy) | ${fmtPct(lhBlend)} | ${inTargetBand(lhBlend)} |`);
lines.push('');
lines.push(
  `_Note: easy and medium should be **above** the 50-60% band — they\'re meant to be beatable. Only the hard route (Direct Line) should target 50-60% for experienced play._`,
);
lines.push('');

lines.push('---');
lines.push('');
lines.push(
  '_Sim code: `src/sim/simBattle.ts` · Runner: `src/sim/runSim.ts` · Re-run with `npm run sim`_',
);

const report = lines.join('\n');
writeFileSync('battle-simulations.md', report);
console.log(report);
console.log('\n---\n✓ Written to battle-simulations.md');
