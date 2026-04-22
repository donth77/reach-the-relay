# Reach the Relay

A post-AI-collapse party VIP-protection RPG built for **Vibe Jam 2026**. SNES-era FF6 / Dragon Quest III visuals, ATB combat, built in Phaser 4 + TypeScript.

> Unified super-AI brought civilization down decades ago. From the survivor commune of **Greenhouse** — a reclaimed pre-fall botanical conservatory — you guide Dr. Vey to **The Relay**, a hilltop radio tower still broadcasting a reconnection beacon for scattered humans. The Censor hunts the airwaves, so sensitive intel travels by courier.

---

## Quick start

```bash
npm install
npm run dev        # vite dev server at http://localhost:5173
npm run build      # typecheck + production build to dist/
npm run preview    # preview the production build
```

Optional: copy `.env.example` → `.env.local` to override defaults (e.g. `VITE_DEBUG_LOG=false` to disable the in-memory logger).

Debug builds: `SOURCEMAP=1 npm run build` re-enables source maps in the production bundle (off by default — strips ~12 MB of readable TS source from `dist/`).

Other scripts:

| Command               | What it does                                        |
| --------------------- | --------------------------------------------------- |
| `npm run typecheck`   | `tsc --noEmit` — the project's primary safety net   |
| `npm run lint`        | ESLint over `src/`                                  |
| `npm run format`      | Prettier over everything                            |
| `npm run sim`         | Headless combat simulator → markdown report         |

No unit-test suite — typecheck, lint, and the combat sim are the quality gates.

---

## Gameplay overview

- **Title** — attract screen. Press any key to continue. A small floating button in the corner toggles title music (persisted to localStorage).
- **Leader Select** — pick 1 of 5 classes as your leader. The leader is the character you walk around as in the Greenhouse, and is always in combat.
- **Greenhouse (Lobby)** — walkable top-down commune. Build your party of 3 either by:
  - **Talking to NPCs** — the other 4 adventurer classes are scattered around. Walk up + press <kbd>E</kbd>/<kbd>Enter</kbd>/<kbd>Space</kbd> (or click) to recruit. Dr. Vey or Mira handle the VIP pick.
  - **Using the terminal** — skip the wandering, pick companions + VIP from a menu.
- **Route select** — 3 tiers:
  - *easy* — 5–6 encounters, 2 rest stops
  - *medium* — 3–4 encounters, 1–2 rest stops (the 4-encounter variant gets a second rest)
  - *hard* — 2 or 3 encounters, 0–1 rest stops, ends in the Wreckwarden boss. Brutal.
  - Encounter counts + specific enemy compositions are sampled per run for replayability.
- **Combat** — SNES-style ATB (Active Time Battle). Party on the right, enemies on the left, VIP in the back. Gauges fill over time; when yours fills, combat pauses and your action menu appears.
- **Rest** — between-encounter healing and full refill of per-rest abilities (GUARD, TAUNT, SALVAGE, FOCUS, FLURRY). Pre-boss rests fully restore HP/MP instead of partial.
- **Run Complete** — victory or defeat screen with score.

### Classes

| Class       | Role                         | Key abilities                                                              |
| ----------- | ---------------------------- | -------------------------------------------------------------------------- |
| Vanguard    | Frontline striker + tank     | FIGHT, GUARD* (intercept), TAUNT*                                          |
| Netrunner   | Elemental DPS                | JACK, OVERLOAD (🔥), FROSTLOCK (❄ + slow), SURGE (⚡)                        |
| Medic       | Support + healing            | STRIKE, PATCH (heal), PULSE (anti-robotic), AMP (free turn), SHIELD        |
| Scavenger   | Physical crit + utility      | SLICE, SALVAGE* (50% crit + 25% item drop)                                 |
| Cybermonk   | Physical multi-hit           | FIGHT, FOCUS (self-heal), FLURRY* (3 hits)                                 |

\* *Rest-limited* (D&D-style spell slots). Uses carry across combat encounters and refill only at a Rest scene — so you choose which encounters to burn them on.

### Elements + enemy types

Enemies are tagged `robotic` or `hybrid`. Medic's **PULSE** is 1.5× vs robotic, 0.5× vs hybrid.

Elemental damage flags:
- 🔥 **thermal**
- ❄ **coolant**
- ⚡ **surge**

Each enemy has a `vulnerability` (1.5× damage from that element) and optional `resistances[]` (0.5× damage). Glyphs appear on damage numbers.

> **Full ability tables, enemy stats/behaviors, boss move rotation, crit rates, item effects, and starting-inventory tables live in [`GAME_MECHANICS.md`](./GAME_MECHANICS.md).** The summary above is just a teaser.

### Score

Victory-only — see `src/scenes/RunCompleteScene.ts`:

```
score = (VIP HP × 2) + Σ (remaining HP of each party member)
```

VIP HP is doubled because protecting Dr. Vey is the core mission. KO'd party members contribute 0. No difficulty bonus, no turn/MP penalty — a simple "how intact did you arrive" metric.

---

## Tech stack

- **Phaser 4** (`pixelArt: true` for crisp nearest-neighbor scaling)
- **TypeScript**
- **Vite 5** for dev server + build
- `phaser3-rex-plugins` for the mobile virtual joystick (side-loaded via `util/rexGlobal.ts` since rex expects `window.Phaser`)

### Scene flow

```
Boot → Title → LeaderSelect → Lobby ↔ PartySelectTerminal
                                 ↓
                              Route → Journey ↔ Combat ↔ Rest → RunComplete → (back to Title)
```

A parallel `BackgroundLoadScene` streams the ~35 MB of route/journey music while the player is on Title, so later scene transitions don't block on audio decode.

### Directory guide

See `CLAUDE.md` for the full annotated directory layout. High-level:

- `src/scenes/` — one file per scene. `CombatScene.ts` is the bulk of the codebase.
- `src/scenes/lobby/` — `NpcAgent`, `CrewHud`, `mapModal` — split out so LobbyScene stays focused.
- `src/data/` — static definitions: classes, enemies, items, routes, dialogue/lore copy.
- `src/state/` — two module-scoped state singletons: `lobby.ts` (pre-run) and `run.ts` (active run).
- `src/combat/` — `types.ts` (Unit interface + constants), `helpers.ts` (pure damage calc + targeting), `fx.ts` (transient VFX).
- `src/sim/` — headless combat simulator (no Phaser deps). Useful for balance spot-checks.
- `src/util/` — audio (categories, volume, music pool), pauseMenu, briefingModal, logger, portal integration, head-crop portraits, shuffle-bag RNG, misc.

### State management

Two module-scoped singletons survive scene transitions without serialization:

- `state/lobby.ts` — pre-run choices: leader id, recruited set, last lobby pose. Active from Leader Select through Route Select.
- `state/run.ts` — active-run state: party, route, encounter index, HP/MP per party member, VIP HP, inventory, `abilityUsesRemaining`. Created by `startRun()` at Route Select commit.

### Audio

- `util/audio.ts` owns three volume categories (`master`, `music`, `sfx`), persisted to localStorage, exposed via `getVol` / `setVol`. Applied globally by a Phaser registry listener.
- `util/music.ts` — `playMusicPool(scene, pool, volume)` is the ONLY supported way to start music. It filters pool keys to what's in the audio cache, re-picks a pool member when a track loops, and no-ops if the currently-playing track is a member of the new pool.
- `util/audioSettingsPanel.ts` — the shared MASTER/MUSIC/SFX slider panel used in pause menus.

---

## Credits

Built for Vibe Jam 2026.

Engines / tools: Phaser 4, Vite, TypeScript, Claude Code
Asset generation: SpriteCook, PixelLab, ElevenLabs, Suno, Hugging Face Z-Image Turbo, Google Gemini / Nano Banana 
