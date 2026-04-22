# Wreckwarden Battle Simulations

_Generated 2026-04-22T19:45:30.878Z_  ·  1000 trials per scenario

**Target win rate: 50.0%–60.0%**

Too easy (>70%) kills drama; too hard (<40%) frustrates. 50–60% = "thrilling but earned" — analogous to Hades final-boss pacing. Classic FF bosses sit ~70-85% but target different pacing.

Band legend: ⭐ ideal (50-60%) · 🟡 close (within 5pp) · 🟢 easy (>65%) · 🔴 hard (<45%)

## Policy assumptions

- **Medic**: PATCH VIP when ≤50% HP → PATCH ally ≤40% HP → SHIELD VIP when ≤70% HP → PULSE boss → STRIKE
- **Netrunner**: pick highest-expected-damage ability (penalizes resisted elements, bonus for vulnerability); falls back to JACK if low MP. Uses POWERCELL item when MP < 8.
- **Vanguard**: TAUNT when VIP ≤50% HP and next boss phase is not AoE; GUARD when healthy and non-ignoreGuard enemy; else FIGHT
- **Cybermonk**: FOCUS when self ≤40% HP; else FLURRY; else FIGHT
- **Scavenger**: SALVAGE while uses remain; else SLICE
- **Items**: STIMPAK on VIP when critical (≤30% HP); no smoke-grenade simulated
- **Evasion**: 30% dodge on basic physical attacks vs evasive enemies (not relevant for boss)

## Current Wreckwarden stats

HP **85** · Attack **20** · Defense **9** · Speed **6**

Rotation: normal single-target (target-vip) → SHOCKWAVE (damage + ATB reset, weighted-random target) → signature coolant AoE → repeat. Ignores GUARD. Resists thermal + coolant; no vulnerability.

## All 10 party combos vs current Wreckwarden (fresh + degraded)

_Fresh = full HP/MP. Degraded = arriving from Direct Line's prior encounter: ~80% HP, ~70% MP for casters, one use of each limited ability already spent._

| Party | Fresh Win % | Degraded Win % | Drop |
|---|---:|---:|---:|
| Van+Net+Med | 69.8% 🟡 close | 23.1% 🔴 hard | 46.7% |
| Van+Net+Sca | 57.5% ⭐ ideal | 8.0% 🔴 hard | 49.5% |
| Van+Net+Cyb | 79.7% 🟢 easy | 36.5% 🔴 hard | 43.2% |
| Van+Med+Sca | 4.2% 🔴 hard | 0.2% 🔴 hard | 4.0% |
| Van+Med+Cyb | 50.8% ⭐ ideal | 18.0% 🔴 hard | 32.8% |
| Van+Sca+Cyb | 5.6% 🔴 hard | 0.1% 🔴 hard | 5.5% |
| Net+Med+Sca | 67.2% 🟡 close | 14.9% 🔴 hard | 52.3% |
| Net+Med+Cyb | 74.9% 🟢 easy | 44.2% 🔴 hard | 30.7% |
| Net+Sca+Cyb | 64.2% 🟡 close | 16.6% 🔴 hard | 47.6% |
| Med+Sca+Cyb | 26.6% 🔴 hard | 0.9% 🔴 hard | 25.7% |

**Overall mean win rate across all combos:** 50.0% ⭐ ideal

- Best combo: **Van+Net+Cyb** (79.7%)
- Worst combo: **Van+Med+Sca** (4.2%)

## HP sweep on Wreckwarden — degraded-start party = Van+Net+Med

| Wreckwarden HP | Fresh Win % | Degraded Win % | Avg VIP HP (degraded) |
|---:|---:|---:|---:|
| 60 | 86.2% 🟢 easy | 80.0% 🟢 easy | 22.5/35 |
| 70 | 79.8% 🟢 easy | 60.1% 🟡 close | 14.6/35 |
| 80 | 77.5% 🟢 easy | 34.4% 🔴 hard | 7.8/35 |
| 85 | 70.2% 🟢 easy | 24.2% 🔴 hard | 6.1/35 |
| 90 | 61.0% 🟡 close | 14.4% 🔴 hard | 4.2/35 |
| 100 | 39.7% 🔴 hard | 4.2% 🔴 hard | 3.1/35 |
| 110 | 18.3% 🔴 hard | 0.2% 🔴 hard | 2.3/35 |
| 120 | 5.6% 🔴 hard | 0.2% 🔴 hard | 2.3/35 |

## Attack sweep on Wreckwarden (party = Van+Net+Med, HP=85)

| Wreckwarden Atk | Win % | Avg VIP HP | VIP KO % |
|---:|---:|---:|---:|
| 16 | 96.3% 🟢 easy | 25.2/35 | 3.7% |
| 18 | 84.8% 🟢 easy | 21.4/35 | 15.1% |
| 20 | 68.9% 🟡 close | 19.4/35 | 28.8% |
| 22 | 49.1% 🟡 close | 16.2/35 | 29.8% |
| 24 | 37.5% 🔴 hard | 16.2/35 | 30.5% |

## Defense sweep on Wreckwarden (party = Van+Net+Med, HP=85)

| Wreckwarden Def | Win % | Avg turns | VIP KO % |
|---:|---:|---:|---:|
| 6 | 85.7% 🟢 easy | 13.7 | 14.3% |
| 8 | 76.3% 🟢 easy | 21.8 | 23.7% |
| 9 | 71.0% 🟢 easy | 27.5 | 26.8% |
| 10 | 52.2% ⭐ ideal | 32.4 | 36.8% |
| 12 | 16.4% 🔴 hard | 36.0 | 55.4% |

## Inventory impact (party = Van+Net+Med)

| Inventory | Win % | Avg VIP HP | Items used |
|---|---:|---:|---|
| Direct Line (1 stim) | 68.9% 🟡 close | 19.5/35 | stimpak:0.50 |
| Transit Line (2/1/1) | 80.1% 🟢 easy | 26.6/35 | stimpak:0.19, powercell:0.82, adrenaline:0.07 |
| Long Highway (3/2/1) | 76.5% 🟢 easy | 24.9/35 | stimpak:0.12, powercell:1.29, adrenaline:0.08 |
| Empty | 64.6% 🟡 close | 19.8/35 | — |

## Tuning suggestion

Median party combo win rate: **57.5%** ⭐ ideal

Median sits inside the 50–60% target band. Current stats are well-tuned on average; if a specific combo is out of band, consider class-level tweaks rather than boss-level.

## Full-route simulations (new randomized structures)

Direct Line: 50/50 between 2-enc/no-rest and 3-enc/rest-after-first. Long Highway: 5-6 encounters (random). Transit Line: 3-4 encounters (random). All runs end when either all enemies cleared on the final encounter (win) or VIP KO'd / party wiped (lose).

### Direct Line (party = Van+Net+Med, inventory = 1 stim)

| Variant | Full-run win % | Boss win % | Avg enc cleared | VIP HP end | Items used |
|---|---:|---:|---:|---:|---|
| A: 2 enc / 1 rest before boss | 50.6% ⭐ ideal | 50.6% | 1.49 | 11.0/35 | stimpak:1.55, powercell:0.98 |
| B: 3 enc / 1 rest (after enc 1, before boss) | 38.2% 🔴 hard | 38.2% | 1.81 | 10.9/35 | stimpak:0.92 |
| **50/50 blend** | **44.4% 🔴 hard** | **44.4%** | — | — | — |

### Long Highway (party = Van+Net+Med, inventory = 3/2/1/1) — pool-sampled

| Variant | Full-run win % | Avg enc cleared | VIP HP end |
|---|---:|---:|---:|
| 5 encounters | 98.9% 🟢 easy | 4.98 | 26.7/35 |
| 6 encounters | 96.0% 🟢 easy | 5.89 | 23.6/35 |
| **50/50 (5 or 6)** | **97.1% 🟢 easy** | 5.45 | 25.3/35 |

### Transit Line (party = Van+Net+Med, inventory = 2/1/1/0) — pool-sampled

| Variant | Full-run win % | Avg enc cleared | VIP HP end |
|---|---:|---:|---:|
| 3 encounters | 63.5% 🟡 close | 2.27 | 14.9/35 |
| 4 encounters | 51.6% ⭐ ideal | 2.87 | 11.7/35 |
| **50/50 (3 or 4)** | **57.7% ⭐ ideal** | 2.60 | 13.4/35 |

### Cross-route summary

| Route | Blended win % | Target alignment |
|---|---:|---|
| Direct Line (hard) | 44.4% | 🔴 hard |
| Transit Line (medium) | 57.7% | ⭐ ideal |
| Long Highway (easy) | 97.1% | 🟢 easy |

_Note: easy and medium should be **above** the 50-60% band — they're meant to be beatable. Only the hard route (Direct Line) should target 50-60% for experienced play._

---

_Sim code: `src/sim/simBattle.ts` · Runner: `src/sim/runSim.ts` · Re-run with `npm run sim`_