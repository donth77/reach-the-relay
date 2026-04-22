# Wreckwarden Battle Simulations

_Generated 2026-04-22T18:59:19.360Z_  ·  1000 trials per scenario

**Target win rate: 50.0%–60.0%**

Too easy (>70%) kills drama; too hard (<40%) frustrates. 50–60% = "thrilling but earned" — analogous to Hades final-boss pacing. Classic FF bosses sit ~70-85% but target different pacing.

Band legend: ⭐ ideal (50-60%) · 🟡 close (within 5pp) · 🟢 easy (>65%) · 🔴 hard (<45%)

## Policy assumptions

- **Medic**: PATCH escort when ≤50% HP → PATCH ally ≤40% HP → SHIELD escort when ≤70% HP → PULSE boss → STRIKE
- **Netrunner**: pick highest-expected-damage ability (penalizes resisted elements, bonus for vulnerability); falls back to JACK if low MP. Uses POWERCELL item when MP < 8.
- **Vanguard**: TAUNT when escort ≤50% HP and next boss phase is not AoE; GUARD when healthy and non-ignoreGuard enemy; else FIGHT
- **Cybermonk**: FOCUS when self ≤40% HP; else FLURRY; else FIGHT
- **Scavenger**: SALVAGE while uses remain; else SLICE
- **Items**: STIMPAK on escort when critical (≤30% HP); no smoke-grenade simulated
- **Evasion**: 30% dodge on basic physical attacks vs evasive enemies (not relevant for boss)

## Current Wreckwarden stats

HP **85** · Attack **20** · Defense **9** · Speed **6**

Rotation: normal single-target (target-escort) → SHOCKWAVE (damage + ATB reset, weighted-random target) → signature coolant AoE → repeat. Ignores GUARD. Resists thermal + coolant; no vulnerability.

## All 10 party combos vs current Wreckwarden (fresh + degraded)

_Fresh = full HP/MP. Degraded = arriving from Direct Line's prior encounter: ~80% HP, ~70% MP for casters, one use of each limited ability already spent._

| Party | Fresh Win % | Degraded Win % | Drop |
|---|---:|---:|---:|
| Van+Net+Med | 67.7% 🟡 close | 23.8% 🔴 hard | 43.9% |
| Van+Net+Sca | 51.9% ⭐ ideal | 9.1% 🔴 hard | 42.8% |
| Van+Net+Cyb | 77.1% 🟢 easy | 37.2% 🔴 hard | 39.9% |
| Van+Med+Sca | 4.0% 🔴 hard | 0.1% 🔴 hard | 3.9% |
| Van+Med+Cyb | 50.4% ⭐ ideal | 19.7% 🔴 hard | 30.7% |
| Van+Sca+Cyb | 5.1% 🔴 hard | 0.3% 🔴 hard | 4.8% |
| Net+Med+Sca | 70.5% 🟢 easy | 13.7% 🔴 hard | 56.8% |
| Net+Med+Cyb | 76.6% 🟢 easy | 44.4% 🔴 hard | 32.2% |
| Net+Sca+Cyb | 65.0% 🟡 close | 14.0% 🔴 hard | 51.0% |
| Med+Sca+Cyb | 26.9% 🔴 hard | 0.9% 🔴 hard | 26.0% |

**Overall mean win rate across all combos:** 49.5% 🟡 close

- Best combo: **Van+Net+Cyb** (77.1%)
- Worst combo: **Van+Med+Sca** (4.0%)

## HP sweep on Wreckwarden — degraded-start party = Van+Net+Med

| Wreckwarden HP | Fresh Win % | Degraded Win % | Avg escort HP (degraded) |
|---:|---:|---:|---:|
| 60 | 84.8% 🟢 easy | 80.6% 🟢 easy | 23.0/35 |
| 70 | 79.3% 🟢 easy | 57.1% ⭐ ideal | 13.8/35 |
| 80 | 71.3% 🟢 easy | 35.3% 🔴 hard | 8.1/35 |
| 85 | 70.1% 🟢 easy | 23.2% 🔴 hard | 5.9/35 |
| 90 | 62.2% 🟡 close | 14.1% 🔴 hard | 4.0/35 |
| 100 | 38.5% 🔴 hard | 5.2% 🔴 hard | 2.9/35 |
| 110 | 15.6% 🔴 hard | 0.8% 🔴 hard | 2.2/35 |
| 120 | 5.6% 🔴 hard | 0.2% 🔴 hard | 2.4/35 |

## Attack sweep on Wreckwarden (party = Van+Net+Med, HP=85)

| Wreckwarden Atk | Win % | Avg escort HP | Escort KO % |
|---:|---:|---:|---:|
| 16 | 97.2% 🟢 easy | 25.6/35 | 2.8% |
| 18 | 84.8% 🟢 easy | 21.4/35 | 15.0% |
| 20 | 69.7% 🟡 close | 19.7/35 | 28.1% |
| 22 | 48.3% 🟡 close | 15.7/35 | 32.7% |
| 24 | 35.5% 🔴 hard | 15.4/35 | 31.2% |

## Defense sweep on Wreckwarden (party = Van+Net+Med, HP=85)

| Wreckwarden Def | Win % | Avg turns | Escort KO % |
|---:|---:|---:|---:|
| 6 | 83.8% 🟢 easy | 14.1 | 16.2% |
| 8 | 77.3% 🟢 easy | 22.3 | 22.5% |
| 9 | 71.2% 🟢 easy | 27.6 | 26.6% |
| 10 | 51.3% ⭐ ideal | 32.4 | 36.2% |
| 12 | 14.6% 🔴 hard | 37.3 | 53.1% |

## Inventory impact (party = Van+Net+Med)

| Inventory | Win % | Avg escort HP | Items used |
|---|---:|---:|---|
| Direct Line (1 stim) | 67.9% 🟡 close | 19.5/35 | stimpak:0.45 |
| Transit Line (2/1/1) | 79.0% 🟢 easy | 26.4/35 | stimpak:0.17, powercell:0.80, adrenaline:0.07 |
| Long Highway (3/2/1) | 74.7% 🟢 easy | 24.8/35 | stimpak:0.17, powercell:1.26, adrenaline:0.08 |
| Empty | 66.7% 🟡 close | 20.3/35 | — |

## Tuning suggestion

Median party combo win rate: **51.9%** ⭐ ideal

Median sits inside the 50–60% target band. Current stats are well-tuned on average; if a specific combo is out of band, consider class-level tweaks rather than boss-level.

## Full-route simulations (new randomized structures)

Direct Line: 50/50 between 2-enc/no-rest and 3-enc/rest-after-first. Long Highway: 5-6 encounters (random). Transit Line: 3-4 encounters (random). All runs end when either all enemies cleared on the final encounter (win) or escort KO'd / party wiped (lose).

### Direct Line (party = Van+Net+Med, inventory = 1 stim)

| Variant | Full-run win % | Boss win % | Avg enc cleared | Escort HP end | Items used |
|---|---:|---:|---:|---:|---|
| A: 2 enc / 1 rest before boss | 50.3% ⭐ ideal | 50.3% | 1.48 | 11.1/35 | stimpak:1.54, powercell:0.97 |
| B: 3 enc / 1 rest (after enc 1, before boss) | 42.8% 🔴 hard | 42.8% | 1.90 | 11.7/35 | stimpak:0.94 |
| **50/50 blend** | **46.6% 🟡 close** | **46.6%** | — | — | — |

### Long Highway (party = Van+Net+Med, inventory = 3/2/1/1) — pool-sampled

| Variant | Full-run win % | Avg enc cleared | Escort HP end |
|---|---:|---:|---:|
| 5 encounters | 98.0% 🟢 easy | 4.94 | 26.9/35 |
| 6 encounters | 96.5% 🟢 easy | 5.92 | 23.5/35 |
| **50/50 (5 or 6)** | **96.7% 🟢 easy** | 5.44 | 24.6/35 |

### Transit Line (party = Van+Net+Med, inventory = 2/1/1/0) — pool-sampled

| Variant | Full-run win % | Avg enc cleared | Escort HP end |
|---|---:|---:|---:|
| 3 encounters | 66.0% 🟡 close | 2.32 | 15.5/35 |
| 4 encounters | 51.5% ⭐ ideal | 2.87 | 12.2/35 |
| **50/50 (3 or 4)** | **57.2% ⭐ ideal** | 2.50 | 13.2/35 |

### Cross-route summary

| Route | Blended win % | Target alignment |
|---|---:|---|
| Direct Line (hard) | 46.6% | 🟡 close |
| Transit Line (medium) | 57.2% | ⭐ ideal |
| Long Highway (easy) | 96.7% | 🟢 easy |

_Note: easy and medium should be **above** the 50-60% band — they're meant to be beatable. Only the hard route (Direct Line) should target 50-60% for experienced play._

---

_Sim code: `src/sim/simBattle.ts` · Runner: `src/sim/runSim.ts` · Re-run with `npm run sim`_