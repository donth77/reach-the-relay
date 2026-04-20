# Wreckling Battle Simulations

_Generated 2026-04-19T13:27:17.507Z_  ·  1000 trials per scenario

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

## Current Wreckling stats

HP **85** · Attack **20** · Defense **9** · Speed **6**

Rotation: normal single-target (target-escort) → SHOCKWAVE (damage + ATB reset, weighted-random target) → signature coolant AoE → repeat. Ignores GUARD. Resists thermal + coolant; no vulnerability.

## All 10 party combos vs current Wreckling (fresh + degraded)

_Fresh = full HP/MP. Degraded = arriving from Direct Line's prior encounter: ~80% HP, ~70% MP for casters, one use of each limited ability already spent._

| Party | Fresh Win % | Degraded Win % | Drop |
|---|---:|---:|---:|
| Van+Net+Med | 63.2% 🟡 close | 20.5% 🔴 hard | 42.7% |
| Van+Net+Sca | 40.5% 🔴 hard | 7.5% 🔴 hard | 33.0% |
| Van+Net+Cyb | 70.9% 🟢 easy | 28.6% 🔴 hard | 42.3% |
| Van+Med+Sca | 5.1% 🔴 hard | 0.0% 🔴 hard | 5.1% |
| Van+Med+Cyb | 50.7% ⭐ ideal | 19.7% 🔴 hard | 31.0% |
| Van+Sca+Cyb | 5.1% 🔴 hard | 0.1% 🔴 hard | 5.0% |
| Net+Med+Sca | 68.4% 🟡 close | 14.3% 🔴 hard | 54.1% |
| Net+Med+Cyb | 76.7% 🟢 easy | 48.9% 🟡 close | 27.8% |
| Net+Sca+Cyb | 67.7% 🟡 close | 14.6% 🔴 hard | 53.1% |
| Med+Sca+Cyb | 32.3% 🔴 hard | 1.8% 🔴 hard | 30.5% |

**Overall mean win rate across all combos:** 48.1% 🟡 close

- Best combo: **Net+Med+Cyb** (76.7%)
- Worst combo: **Van+Med+Sca** (5.1%)

## HP sweep on Wreckling — degraded-start party = Van+Net+Med

| Wreckling HP | Fresh Win % | Degraded Win % | Avg escort HP (degraded) |
|---:|---:|---:|---:|
| 60 | 84.1% 🟢 easy | 79.0% 🟢 easy | 22.1/35 |
| 70 | 79.4% 🟢 easy | 60.6% 🟡 close | 15.2/35 |
| 80 | 73.5% 🟢 easy | 33.5% 🔴 hard | 7.7/35 |
| 85 | 69.0% 🟡 close | 19.7% 🔴 hard | 5.4/35 |
| 90 | 57.0% ⭐ ideal | 12.9% 🔴 hard | 4.3/35 |
| 100 | 37.3% 🔴 hard | 2.8% 🔴 hard | 2.8/35 |
| 110 | 16.9% 🔴 hard | 0.8% 🔴 hard | 2.4/35 |
| 120 | 5.5% 🔴 hard | 0.0% 🔴 hard | 2.4/35 |

## Attack sweep on Wreckling (party = Van+Net+Med, HP=85)

| Wreckling Atk | Win % | Avg escort HP | Escort KO % |
|---:|---:|---:|---:|
| 16 | 97.0% 🟢 easy | 25.2/35 | 3.0% |
| 18 | 85.1% 🟢 easy | 21.6/35 | 14.6% |
| 20 | 65.5% 🟡 close | 18.4/35 | 30.3% |
| 22 | 43.0% 🔴 hard | 15.2/35 | 31.2% |
| 24 | 31.5% 🔴 hard | 14.0/35 | 31.8% |

## Defense sweep on Wreckling (party = Van+Net+Med, HP=85)

| Wreckling Def | Win % | Avg turns | Escort KO % |
|---:|---:|---:|---:|
| 6 | 85.7% 🟢 easy | 14.2 | 14.3% |
| 8 | 76.6% 🟢 easy | 21.8 | 22.8% |
| 9 | 66.4% 🟡 close | 27.8 | 29.8% |
| 10 | 47.2% 🟡 close | 32.2 | 40.7% |
| 12 | 13.0% 🔴 hard | 36.9 | 63.9% |

## Inventory impact (party = Van+Net+Med)

| Inventory | Win % | Avg escort HP | Items used |
|---|---:|---:|---|
| Direct Line (1 stim) | 66.4% 🟡 close | 18.7/35 | stimpak:0.47 |
| Transit Line (2/1/1) | 79.4% 🟢 easy | 26.2/35 | stimpak:0.19, powercell:0.81, adrenaline:0.13 |
| Long Highway (3/2/1) | 78.7% 🟢 easy | 25.0/35 | stimpak:0.05, powercell:1.34, adrenaline:0.19 |
| Empty | 66.1% 🟡 close | 20.6/35 | — |

## Tuning suggestion

Median party combo win rate: **50.7%** ⭐ ideal

Median sits inside the 50–60% target band. Current stats are well-tuned on average; if a specific combo is out of band, consider class-level tweaks rather than boss-level.

## Full-route simulations (new randomized structures)

Direct Line: 50/50 between 2-enc/no-rest and 3-enc/rest-after-first. Long Highway: 5-6 encounters (random). Transit Line: 3-4 encounters (random). All runs end when either all enemies cleared on the final encounter (win) or escort KO'd / party wiped (lose).

### Direct Line (party = Van+Net+Med, inventory = 1 stim)

| Variant | Full-run win % | Boss win % | Avg enc cleared | Escort HP end | Items used |
|---|---:|---:|---:|---:|---|
| A: 2 enc / 1 rest before boss | 5.8% 🔴 hard | 5.8% | 1.04 | 4.2/35 | stimpak:1.75, powercell:0.98 |
| B: 3 enc / 1 rest (after enc 1, before boss) | 0.0% 🔴 hard | 0.0% | 1.29 | 2.3/35 | stimpak:0.94 |
| **50/50 blend** | **2.9% 🔴 hard** | **2.9%** | — | — | — |

### Long Highway (party = Van+Net+Med, inventory = 3/2/1/1) — pool-sampled

| Variant | Full-run win % | Avg enc cleared | Escort HP end |
|---|---:|---:|---:|
| 5 encounters | 95.6% 🟢 easy | 4.92 | 24.9/35 |
| 6 encounters | 89.2% 🟢 easy | 5.82 | 19.8/35 |
| **50/50 (5 or 6)** | **91.8% 🟢 easy** | 5.35 | 22.0/35 |

### Transit Line (party = Van+Net+Med, inventory = 2/1/1/0) — pool-sampled

| Variant | Full-run win % | Avg enc cleared | Escort HP end |
|---|---:|---:|---:|
| 3 encounters | 58.7% ⭐ ideal | 2.33 | 12.7/35 |
| 4 encounters | 13.2% 🔴 hard | 2.45 | 2.0/35 |
| **50/50 (3 or 4)** | **38.9% 🔴 hard** | 2.46 | 8.1/35 |

### Cross-route summary

| Route | Blended win % | Target alignment |
|---|---:|---|
| Direct Line (hard) | 2.9% | 🔴 hard |
| Transit Line (medium) | 38.9% | 🔴 hard |
| Long Highway (easy) | 91.8% | 🟢 easy |

_Note: easy and medium should be **above** the 50-60% band — they're meant to be beatable. Only the hard route (Direct Line) should target 50-60% for experienced play._

---

_Sim code: `src/sim/simBattle.ts` · Runner: `src/sim/runSim.ts` · Re-run with `npm run sim`_