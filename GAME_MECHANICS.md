# Game Mechanics — Reach the Relay

Comprehensive reference for combat rules, party abilities, enemy moves, items, and routes. Numbers pulled from `src/data/*.ts` and `src/sim/simBattle.ts` (the headless combat simulator mirrors the live combat rules).

If you change a number in the data files, update the relevant row here.

---

## Combat model

- **ATB (Active Time Battle)** — each unit has an ATB gauge. `ATB_MAX = 100`, filled at `ATB_RATE = 10` per tick, modulated by the unit's `speed`. When a party member's gauge fills, combat pauses and the action menu opens.
- **Party of 3** (leader always included) + **VIP** (Dr. Vey, 35 HP, damage-only — no attacks, no actions). The VIP sits in the back row; most enemies can still target them directly.
- **Victory** — all enemies KO'd. **Defeat** — VIP KO'd OR all 3 party KO'd.

### Damage formula

```
base     = max(1, attacker.attack × power − target.defense)
variance = random integer in [−2, +2]
damage   = max(1, round(base + variance))

// Elemental modifiers (if element and target is an enemy):
if target.vulnerability == element:          damage = round(damage × 1.5)
elif element in target.resistances:          damage = max(1, round(damage × 0.5))

// After-damage modifiers:
if target.shielded (Medic SHIELD):           damage = max(1, floor(damage / 2))
if critical hit:                             damage = round(damage × 2)
if enemy-vs-guarded (not ignoresGuard):      damage = max(1, floor(damage / 2))
```

### Crit rates

| Source                                         | Crit chance       |
| ---------------------------------------------- | ----------------- |
| Party regular `damage` abilities               | 15%               |
| Scavenger **SALVAGE**                          | 50%               |
| Cybermonk **FLURRY** (per hit, simulator only) | 15% per hit (sim) |
| Enemy basic attacks                            | 10%               |

> **Live-game note:** in `CombatScene.ts` the `case 'flurry'` path currently hardcodes `crit=false` and `calculateDamage` doesn't roll crits — so **in the running game FLURRY cannot crit**, despite the sim modeling it and the ability description saying "can crit." Either the code or the description should be aligned.

### Status effects

| Effect              | Source                     | What it does                                                                                     |
| ------------------- | -------------------------- | ------------------------------------------------------------------------------------------------ |
| `guarding`          | Vanguard GUARD             | Next incoming enemy hit is redirected to the guardian AND halved. `ignoresGuard` bypasses.       |
| `shielded`          | Medic SHIELD               | Next incoming damage is halved. Works against `ignoresGuard` (e.g. Wreckwarden).                 |
| `tauntedBy`         | Vanguard TAUNT             | Target's next **single-target** action forced onto the taunter. Full damage (no half). Works on bosses' normal attack. AoE moves (Nanite Swarm, Wreckwarden COOLANT SLAM) and Wreckwarden SHOCKWAVE ignore the redirect AND still consume the TAUNT — so TAUNT always lasts exactly one enemy turn. |
| `atbModifier`       | Netrunner FROSTLOCK        | Target ATB fill ×0.5 for 2 turns.                                                                |
| ATB fill (direct)   | Medic AMP                  | Target's ATB gauge is set to max immediately — grants a free turn. No ongoing modifier.          |
| `missing`           | Smoke Grenade item         | All enemies' next action is an auto-miss.                                                        |
| Evasion (passive)   | Enemies with `evasive`     | 30% dodge vs basic physical attacks (FIGHT/SLICE/STRIKE). Abilities with `sfxKey` or `element` ignore evasion. |

---

## Party classes

Base stats at full health. Leader is always part of the party; the other two are recruited in the Greenhouse.

| Class       | HP  | ATK | DEF | SPD | MP  | Canvas  | Role                         |
| ----------- | --- | --- | --- | --- | --- | ------- | ---------------------------- |
| Vanguard    | 70  | 12  | 8   | 4   | 0   | 96×96   | Frontline striker + tank     |
| Netrunner   | 35  | 14  | 3   | 7   | 30  | 68×68   | Elemental DPS                |
| Medic       | 55  | 8   | 5   | 5   | 28  | 104×104 | Support + healing            |
| Scavenger   | 45  | 10  | 4   | 8   | 0   | 68×68   | Physical crit + utility      |
| Cybermonk   | 65  | 13  | 6   | 5   | 0   | 68×68   | Physical multi-hit           |

### Abilities

| Class       | Ability      | Cost | Target           | Power | Element  | Uses/rest | Notes                                                                 |
| ----------- | ------------ | ---- | ---------------- | ----- | -------- | --------- | --------------------------------------------------------------------- |
| Vanguard    | FIGHT        | 0 MP | enemy            | 1.0×  | —        | ∞         | Basic physical attack.                                                |
| Vanguard    | **GUARD**    | 0 MP | self             | —     | —        | **2**     | Intercept every enemy attack until next turn; damage halved. Wreckwarden ignores. |
| Vanguard    | **TAUNT**    | 0 MP | enemy            | —     | —        | **2**     | Force one enemy's next single-target attack onto the Vanguard. No damage halving. Works on bosses' normal attacks; Wreckwarden SHOCKWAVE and all AoE moves ignore it. |
| Vanguard    | ITEM         | 0 MP | self             | —     | —        | —         | Use a consumable from shared party inventory.                         |
| Netrunner   | JACK         | 0 MP | enemy            | 0.5×  | —        | ∞         | Quick remote hack. Weak damage, no MP cost.                           |
| Netrunner   | OVERLOAD     | 5 MP | enemy            | 1.6×  | 🔥 thermal | ∞         | Heavy thermal damage to one enemy.                                    |
| Netrunner   | FROSTLOCK    | 5 MP | enemy            | 0.6×  | ❄ coolant | ∞         | Damage + halves target's ATB fill rate for 2 turns.                    |
| Netrunner   | SURGE        | 7 MP | enemy            | 1.4×  | ⚡ surge  | ∞         | Heavy electric damage to one enemy.                                   |
| Netrunner   | ITEM         | 0 MP | self             | —     | —        | —         |                                                                       |
| Medic       | STRIKE       | 0 MP | enemy            | 0.4×  | —        | ∞         | Weak melee attack, no MP cost.                                        |
| Medic       | PATCH        | 4 MP | ally or VIP      | +25 HP| —        | ∞         | Heal one ally or Dr. Vey for 25 HP.                                    |
| Medic       | PULSE        | 5 MP | enemy            | 1.0×  | —        | ∞         | **Anti-machine**: 1.5× vs robotic, 0.5× vs hybrid.                     |
| Medic       | AMP          | 6 MP | ally or VIP      | —     | —        | ∞         | Fills target's ATB gauge to max — grants an immediate free turn.      |
| Medic       | SHIELD       | 5 MP | ally or VIP      | —     | —        | ∞         | Halves damage taken by target until their next turn. Works vs Wreckwarden. |
| Medic       | ITEM         | 0 MP | self             | —     | —        | —         |                                                                       |
| Scavenger   | SLICE        | 0 MP | enemy            | 0.8×  | —        | ∞         | Fast melee attack, no MP cost.                                        |
| Scavenger   | **SALVAGE**  | 0 MP | enemy            | 1.0×  | —        | **3**     | 50% chance to deal double damage, 25% chance to salvage a random item. |
| Scavenger   | ITEM         | 0 MP | self             | —     | —        | —         |                                                                       |
| Cybermonk   | FIGHT        | 0 MP | enemy            | 1.0×  | —        | ∞         | Basic physical attack.                                                |
| Cybermonk   | **FOCUS**    | 0 MP | self             | +18 HP| —        | **3**     | Meditate to restore 18 HP to self.                                     |
| Cybermonk   | **FLURRY**   | 0 MP | enemy            | 0.6×  | —        | **5**     | Three rapid strikes on one enemy. Each hit rolls damage/defense separately. |
| Cybermonk   | ITEM         | 0 MP | self             | —     | —        | —         |                                                                       |

**\* Rest-limited** — uses carry across combat encounters and refill only at a Rest scene. Tracked in `RunState.abilityUsesRemaining`.

**Design rule:** every non-MP special move (anything beyond the class's basic 0-MP attack) is rest-limited. MP-gated abilities balance themselves via MP cost; 0-MP specials balance themselves via per-rest cap. Currently: GUARD 2, TAUNT 2, SALVAGE 3, FOCUS 3, FLURRY 5.

---

## VIP (Dr. Vey)

- **35 HP**, no attacks, no ATB turn, no actions
- Heals via Medic PATCH or Stimpak just like party members
- Sits in the back row, but enemies with `target-vip` behavior (Wirehead, Wreckwarden) single-mindedly hunt them
- Protecting them is the core objective — **VIP HP is doubled in the final score**

---

## Enemies

Base stats and behavior. `scoutdrone` dodges basic melee. `naniteswarm` hits the whole party+VIP every turn at 0.85× power. `wreckwarden` is the boss on the hard route.

| Enemy          | HP  | ATK | DEF | SPD | Type    | Vulnerable | Resists       | Behavior         | Notes                                                                        |
| -------------- | --- | --- | --- | --- | ------- | ---------- | ------------- | ---------------- | ---------------------------------------------------------------------------- |
| Sentry         | 65  | 14  | 9   | 4   | robotic | 🔥 thermal | ❄ coolant     | random           | "fires PLASMA BOLT at …" Attacks ARE thermal-tagged — resistance/vulnerability applies. 35% chance per combat to enter FOCUS mode (locks onto one random unit until it dies, then re-rolls). |
| Spider-Bot     | 30  | 11  | 5   | 5   | robotic | ❄ coolant  | 🔥 thermal    | random           | Fast scuttler.                                                               |
| Wirehead       | 35  | 13  | 3   | 4   | hybrid  | ⚡ surge   | 🔥 thermal    | target-vip       | Always hunts Dr. Vey. Cybernetic skin shrugs off fire.                       |
| Scout Drone    | 25  | 9   | 4   | 7   | robotic | ⚡ surge   | ❄ coolant     | prefer-low-hp    | `evasive` — 30% dodge vs basic melee. Hunts wounded targets.                 |
| Nanite Swarm   | 30  | 11  | 5   | 5   | hybrid  | 🔥 thermal | ⚡ surge      | **multi-hit**    | Hits whole party + VIP each turn at 0.85× power (light damage each).         |
| **Wreckwarden**| 85  | 20  | 9   | 6   | robotic | — (none)   | 🔥, ❄         | target-vip       | Boss. `ignoresGuard`. Three-move rotation (see below).                        |

### Wreckwarden (boss) — move rotation

The boss cycles through three moves on a strict rotation:

| Turn (mod 3)  | Move            | Power | Element  | Targets                                              |
| ------------- | --------------- | ----- | -------- | ---------------------------------------------------- |
| 1             | Normal attack   | 1.0×  | —        | Per behavior (VIP by default; TAUNT can redirect) |
| 2             | **SHOCKWAVE**   | 1.0×  | ⚡ surge | Weighted random party member (3:2:1 highest-ATB / random / last damager). Also **resets target's ATB to 0**. Ignores TAUNT. |
| 3             | **COOLANT SLAM**| 0.8×  | ❄ coolant| **AoE** — every living party member. VIP is exempt. Ignores TAUNT. |

Vanguard's GUARD is useless vs Wreckwarden (`ignoresGuard: true`). TAUNT only works on the turn-1 normal attack — SHOCKWAVE and COOLANT SLAM both bypass the redirect AND consume the TAUNT, so a mistimed TAUNT is wasted on the ignoring phase rather than carrying over. Medic SHIELD still halves.

### Enemy behaviors

| Behavior        | Meaning                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------- |
| `random`        | Picks a random target from party + VIP.                                                   |
| `target-vip`    | Always attacks the VIP if alive; otherwise picks random.                                  |
| `prefer-low-hp` | Weighted random — lower-HP targets (party + VIP) are more likely to be picked.            |
| `multi-hit`     | Hits **everyone** (party + VIP) for 0.85× power each turn.                                 |

---

## Items

Stored in a shared party inventory (`RunState.inventory`). Use via any party member's ITEM action. Quantities vary per route (see Starting inventory below).

| Item           | Target       | Effect                                                            |
| -------------- | ------------ | ----------------------------------------------------------------- |
| STIMPAK        | ally/VIP     | Restore 25 HP to one target.                                      |
| POWER CELL     | caster       | Restore 10 MP to one caster (Netrunner or Medic).                 |
| ADRENALINE     | KO'd ally    | Revive a KO'd party member at 25% max HP.                         |
| SMOKE GRENADE  | all enemies  | **All enemies miss their next action.** Single use per combat.    |

### Starting inventory per route

| Route              | Stimpak | Power Cell | Adrenaline | Smoke |
| ------------------ | ------- | ---------- | ---------- | ----- |
| The Long Highway   | 3       | 2          | 1          | 1     |
| Hollow Atrium Mall | 2       | 1          | 1          | 0     |
| Dead Substation    | 1       | 1          | 0          | 0     |

---

## Routes

Three routes of increasing difficulty. Encounter counts are sampled per run from pools; specific compositions vary between runs.

| Route              | Difficulty | Encounters            | Rest stops                                  | Background theme             |
| ------------------ | ---------- | --------------------- | ------------------------------------------- | ---------------------------- |
| The Long Highway   | easy       | 5–6 (random pool)     | 2 (after 1, 3)                              | Overgrown highway            |
| Hollow Atrium Mall | medium     | 3–4 (random pool)     | 1–2 (3-enc: after 1 · 4-enc: after 0 and 2) | Hollow shopping atrium       |
| Dead Substation    | hard       | 2 or 3 (two variants) | 1 (always before the boss)                  | Dead substation → boss arena |

### Dead Substation variants

Picked 50/50 at run start. Both end with the Wreckwarden boss in the substation arena.

- **Variant A (2 encounters)**: Wirehead+Spider+Sentry opener → **Rest** (partial) → Wreckwarden.
- **Variant B (3 encounters)**: Sentry+Sentry → Wirehead+Spider+Sentry → **Rest** (full, pre-boss) → Wreckwarden.

Two flags on the boss encounter drive behavior at the preceding rest:

- `isBoss: true` → rest-stop screen shows "FINAL CAMP" instead of "REST STOP" (both substation variants set this).
- `preBossFullRestore: true` → restore jumps from partial (50% HP/MP, 15% VIP) to full (100% all). Only the 3-encounter variant sets this — sims showed it drops to <2% win at partial rest; the 2-encounter variant already sits near band and stays on partial.

---

## Score

Victory-only, computed in `src/scenes/RunCompleteScene.ts`:

```
score = (VIP HP × 2) + Σ (remaining HP of each party member) + ROUTE_BONUS
```

- VIP HP doubled — protecting Dr. Vey is the core mission.
- KO'd party members contribute 0. Fully-healthy ones contribute their max HP.
- Over-healing is clamped to max HP (no bonus).
- Route bonus (additive, see `src/state/leaderboard.ts`): easy **+100**, medium **+400**, hard **+800** — clearing harder content always outranks easier content.
- No turn/MP penalty, no item-efficiency bonus.

Maximum possible score for a run = `35×2 + (70 + 65 + 55) + 800 = 260 + 800 = 1060` (VIP + best-three-HP party on the hard route). Easier routes cap lower because the route bonus is smaller. The leaderboard Worker rejects any submission above **1100** (true max + 40pt buffer).

---

## See also

- `src/data/classes.ts` — source of truth for party class stats and abilities
- `src/data/enemies.ts` — source of truth for enemies + boss moves
- `src/data/items.ts` — items + `STARTING_INVENTORY` per route
- `src/data/routes.ts` — route definitions, encounter pools, variants, rest placement
- `src/sim/simBattle.ts` — headless combat model; useful cross-reference when debugging damage numbers
- `src/combat/helpers.ts` — `calculateDamage()` — the live damage calculation used in combat
- `CLAUDE.md` — operating manual (conventions, gotchas)
