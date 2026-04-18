# The Signal

A post-AI-collapse party escort RPG built for **Vibe Jam 2026**. SNES FF6 / Dragon Quest III visuals, Phaser 4 + TypeScript.

> Unified super-AI brought civilization down decades ago. From the mall-atrium garden of **Greenhouse** you escort Dr. Vey to **The Signal**, a hilltop radio relay still broadcasting a reconnection beacon for scattered humans. The Censor hunts the airwaves — so sensitive intel travels by courier.

## Running it

```bash
npm install
npm run dev       # vite dev server at http://localhost:5173
npm run build     # typecheck + production build to dist/
npm run preview   # preview the production build
```

Copy `.env.example` to `.env.local` if you want to override defaults (e.g. toggle the debug logger with `VITE_DEBUG_LOG`).

## Gameplay

- **Lobby** — pick **3 of 5** adventurers (Vanguard, Netrunner, Medic, Scavenger, Cybermonk)
- **Route select** — pick one of 3 routes: `easy` (5 encounters, 2 rest stops), `medium` (3/1), `hard` (2/0, punishing)
- **Combat** — SNES-style ATB (Active Time Battle). Party on the right, enemies on the left, escort in the back row. Gauges fill over time; when a party member's gauge is full, combat pauses and the action menu appears
- **Rest** — heal/recover between encounters at rest-after beats
- **Run Complete** — victory/defeat screen with score

Abilities per class (renamed from classic fantasy for the sci-fi setting):

| Class | Primary roles | Key abilities |
|-------|---------------|---------------|
| Vanguard | Frontline striker + tank | Basic attack, GUARD |
| Netrunner | Magic DPS + status | OVERLOAD (surge), FROSTLOCK (coolant + slow), SURGE, STANDBY (sleep) |
| Medic | Support + healing | PATCH (heal), PULSE (anti-robotic), STIM (ATB boost), SHIELD (damage halver) |
| Scavenger | Physical crit + utility | Basic attack, SALVAGE (50% crit), items |
| Cybermonk | Physical multi-hit | Basic attack, FLURRY (3 hits) |

Enemies are tagged `robotic` or `hybrid` — Medic's **PULSE** is a 1.5× critical vs robotic and 0.5× weak vs hybrid. Elemental vulnerabilities (thermal 🔥, coolant ❄, surge ⚡) show as glyphs on damage numbers.

## Score

Victory-only. Calculated in `src/scenes/RunCompleteScene.ts`:

```
score = (escort HP × 2) + Σ (remaining HP of each party member)
```

- **Escort HP × 2** — Dr. Vey's remaining HP, doubled. Protecting her is the core mission, so her survival weights double.
- **+ party HP** — KO'd party members contribute 0; fully-healthy ones contribute their max HP.

This rewards **HP efficiency** — finishing with everyone at full HP is the ceiling. Over-healing via PATCH past max doesn't help (HP is clamped). There's no bonus for route difficulty, turn count, or MP/item use — a simple "how intact did you arrive" metric.

## Asset pipeline

- **Sprites + animations**: [SpriteCook](https://spritecook.ai) via MCP. Most enemy/party sprites + walk/attack/death/idle animations generated programmatically and extracted to `public/assets/sprites/`.
- **Sound effects**: [ElevenLabs](https://elevenlabs.io) text-to-SFX via MCP. Outputs in `public/assets/audio/sfx/`.
- **Music**: [Suno](https://suno.com) (external), 16-bit SNES chiptune / post-apocalyptic muzak prompts. Tracks in `public/assets/audio/music/`.
- **Backgrounds**: AI-generated combat backgrounds in `public/assets/backgrounds/combat/`. Each route has a pool of variants (originals + AI-generated alternates) and one is randomly selected per combat. Per-variant Y-offsets let layouts adjust where horizon position differs.

## Tech

- **Phaser 4** with `pixelArt: true` for crisp nearest-neighbor scaling
- **TypeScript strict mode**
- **Vite** for dev server + build
- Scenes: `BootScene` → `LobbyScene` → `RouteScene` → `CombatScene` ↔ `RestScene` → `RunCompleteScene`

## Debug

- Set `VITE_DEBUG_LOG=true` (or leave unset in dev) to enable the in-memory logger
- A small **DEBUG** badge appears top-left when active
- Press **`L`** during combat to copy the last ~500 log lines to clipboard — paste into a bug report to show exactly what the game did

## Credits

Design + code: **Tom Donohue**. Built for Vibe Jam 2026, submitting May 1, 2026.
