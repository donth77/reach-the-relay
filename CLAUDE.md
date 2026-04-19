# CLAUDE.md

Instructions and context for Claude Code sessions working on this project.

## Project

**The Signal** — a post-AI-collapse party escort RPG for Vibe Jam 2026 (submission deadline **2026-05-01 13:37 UTC**).

See `README.md` for the player-facing overview. Design docs live in `.claude/`:

- `concept2-escort.md` — full game concept (world, mechanics, visual direction)
- `implementation-plan.md` — build plan + pipeline notes
- `rules.md` — combat rule reference
- `lobby.md`, `games.md`, `concepts.md` — supporting design notes

**Jam goal: participate, not win.** Scope small, pick fun-to-build over prize-optimized. Don't suggest skipping polish that the user explicitly asked for.

## Tech stack

- **Phaser 4** (`phaser` package, `pixelArt: true` for crisp pixel scaling)
- **TypeScript strict mode** — no implicit any, no unused locals/params, no fallthrough
- **Vite 5** for dev server + production build
- No test framework yet — **typechecking is the safety net** (`npx tsc --noEmit`)

## Project layout

```
src/
  main.ts                 Phaser Game config + scene list + debug badge mount
  scenes/
    BootScene.ts          preload all assets (sprites, audio, backgrounds)
    LobbyScene.ts         title + party selection (pick 3 of 5)
    RouteScene.ts         route select (3 difficulty tiers + test route)
    CombatScene.ts        ATB combat, the bulk of the codebase
    RestScene.ts          between-encounter heal/revive
    RunCompleteScene.ts   victory/defeat screen + score calc
  data/
    classes.ts            party class defs (Vanguard/Netrunner/Medic/Scavenger/Cybermonk)
    enemies.ts            enemy defs + VULNERABILITY_GLYPH map
    items.ts              consumables (Stimpak, Power Cell, Adrenaline, Smoke Grenade)
    routes.ts             route defs (encounters, rest stops, bg variants, music, Y offsets)
  state/
    run.ts                active-run state (party, route, encounter index, HP tracking)
  combat/
    types.ts              Unit interface, Side type, ATB/PANEL/DEPTH/DIMMED constants
    helpers.ts            pure helpers: calculateDamage, getUnitFacing, validTargets, validItemTargets
  util/
    logger.ts             in-memory ring-buffer logger (L key copies to clipboard)
    ui.ts                 shared FONT constant
    audio.ts              stopAllMusic(scene) — defensive music-stop used by Lobby + RunComplete
public/
  assets/
    sprites/              SpriteCook-generated sprites + extracted animation frames
    audio/music/          Suno-generated music tracks
    audio/sfx/            ElevenLabs-generated SFX
    backgrounds/combat/   Combat backgrounds (AI-generated)
    _review/              TEMP folder for asset previews; gitignored, delete when done
```

## Conventions

### Scenes

- Every scene uses `this.cameras.main.setBackgroundColor(...)` for its base color
- Scene transitions via `this.scene.start('SceneKey', data)`; state persists via `state/run.ts` singleton
- The unit model is a plain `Unit` interface in `src/combat/types.ts` (not ECS), imported by `CombatScene`

### Music

- Tracks preloaded in `BootScene` with key `music-<id>`
- Each route has `musicKeys: string[]` (randomly picked per combat); boss encounters can set `bossMusicKey` on enemy def to override
- Single "currently playing" track tracked via `this.registry.get('currentRouteMusic')`
- Lobby + Route use `music-main-theme` (same across both)
- **`RunCompleteScene` and `LobbyScene` stop ANY playing `music-*` sound on enter** via `stopAllMusic(this)` from `util/audio.ts` (defensive — registry tracking can desync if sounds were started without setting it). Lobby then starts main theme. Same defensive pattern lives in `CombatScene` when switching tracks.

### SFX

- Preloaded with `sfx-<id>` prefix
- Typical volume: `0.5` for menu/ambient, `1.0` for impacts/enemy attacks
- Enemy-specific attack SFX via `EnemyDef.attackSfxKey` (falls back to generic `sfx-enemy-attack`)

### Backgrounds + sprite positioning

- Each route has a `backgroundKey` (fallback) and an optional `backgroundVariants: (string | BackgroundVariant)[]`. `CombatScene` picks one at random per combat.
- A `BackgroundVariant` is `{ key, enemyYOffset?, partyYOffset? }`. Per-variant offsets stack additively on top of route + encounter offsets.
- Vertical positioning uses three offset sources, all summed:
  - **route-level** `enemyYOffset` / `partyYOffset` (whole route)
  - **encounter-level** `enemyYOffset` (specific encounter, e.g. wreckling-alone needs -30)
  - **variant-level** offsets (specific bg variant, e.g. transformer-yard pushes everyone down)
- The `PANEL_CLEARANCE` clamp at the end of `buildUnits` prevents enemies from overlapping the bottom UI. It now relaxes by `Math.max(0, totalEnemyOffset)` so a downward offset isn't clamped back. Pure upward offsets (negative values) are NOT clamped against the top — caller's responsibility.
- `BackgroundVariant` is exported from `data/routes.ts`; `CombatScene` keeps `this.activeBgVariant` set per-create so `buildUnits` can read variant offsets.
- Asset file convention: canonical `<route>.webp` + descriptively-named variants `<route>_<theme>.webp` (e.g. `dead_substation_transformer.webp`). The handmade originals live as `<route>.backup.webp`. **Never overwrite a `.backup.webp`** — only create one if it doesn't exist.

### Sprites

- Enemy + party sprites are loaded as individual directional views (`<id>-south/east/north/west.png`) plus per-animation frame sequences (`<id>-attack-west-000.png`, etc.)
- Animations registered in `CombatScene.registerAnimations()` — **must run before `createBattleSprite()` calls** (currently does)
- Idle animation convention: `<id>-idle-east` — registered anim is auto-played by **`playIdleFor(u)`** on sprite creation AND after walk-back at the end of an attack sequence (so attackers return to their idle loop)
- For tween-based bobs (no AI animation, just a y-bounce), add unit id to `TWEEN_IDLE_UNITS` set; `startIdleBob` runs alongside any frame anim
- **Idle pause/resume**: `setEnemyIdlesPaused(true/false)` pauses ALL enemy frame anims + tween bobs. Called when target selection begins (in `chooseTarget`) and resumed in `clearTargetSelect` (covers both commit and cancel). Per-unit variant `setUnitIdlePaused(u, paused)` is used to freeze dimmed peers while another enemy is attacking.
- **BBOX table** in `createBattleSprite()` maps native canvas size → `{ centerX, centerY, feetY, headY }` for origin/shadow/HP-bar placement. Add a new entry whenever a new sprite size is introduced (measure via PIL opaque-bbox — see example below).
- `flipSprite: true` on `EnemyDef` mirrors the sprite horizontally (use if source art faces the wrong way)
- `scale` field determines displayed size (currently ~1.8-2.5 for most; Wreckling boss is 2.2 on 136px canvas)
- `formationSpread` multiplier on EnemyDef can widen spacing for large sprites (default 1; `Math.max(1, ...)` floor so `0` = off)

### Floaty enemies (Scout Drone, Nanite Swarm)

- Tracked in a `floatyUnits` Set in `createBattleSprite`
- Shadow drops 25px lower + alpha 0.12 (vs grounded 0.18)
- On attack, route through **`playFloatyAttack`** (not `playFullAttackSequence`) — flies forward + nudge-impact + flies back, idle anim plays throughout (no texture swaps that would break it)
- Nanite's multi-hit behavior uses `playFloatyAttack` wrapped around the swarm-all-party logic
- `TWEEN_IDLE_UNITS` set in `CombatScene` enables the vertical bob tween alongside the frame-based idle anim

### Combat flow gotchas

- `case 'slow'` (FROSTLOCK) **must `return` early** after `playFullAttackSequence` to skip the default finalize. Earlier versions ran both in parallel, causing `checkEndConditions` to fire before impact → missed victory detection. Same pattern applies to any future case that uses `playFullAttackSequence` from `executeAbility`.
- `case 'salvage'` follows the same pattern: SFX + `applyDamage` are wrapped in an `applyImpact` callback passed to `playFullAttackSequence` so the sound fires at impact mid-anim, not at attack start. Falls back to immediate path if no attack anim exists.
- `applyDamage` signature: `(target, damage, crit?, element?)`. Element is used by `spawnDamageNumber` to append the vulnerability glyph (🔥/❄/⚡).
- **Phaser 4 Text quirk**: `spawnFloatNumber` MUST pass concrete `stroke` and `strokeThickness` values (not `undefined`) — passing `undefined` to Phaser 4's Text constructor breaks rendering of non-crit damage numbers. Defaults are `'#000000'` / `4`.
- **Path-overlap dim**: when an enemy walks through the party to attack the escort, ALL living party members are dimmed for the whole sequence (set to `DIMMED_OTHER_ALPHA = 0.3`). Implementation in `playFullAttackSequence`'s `pathOverlapTargets` block. The escort itself is NOT dimmed (filter is `p.side === 'party'`).
- Enemy HP bars fade out 2.5s after last damage. `beginEnemyTurn` hides every **other** enemy's HP bar before the attacker starts, so a lingering bar from a recent hit isn't visible during a different enemy's attack.
- The `L` key hotkey for copy-log is registered per-scene (currently only in CombatScene).

### Score

Victory-only, computed in `RunCompleteScene`:

```
score = escortHp × 2 + Σ partyHp[key]
```

No difficulty bonus, no turn/MP penalty. Don't refactor without confirming with the user — it's intentionally simple for the jam.

## Asset generation pipeline

Three MCP servers are used. Follow the established workflow:

- **SpriteCook** (`mcp__plugin_spritecook_spritecook__*`): sprites + image-to-animation. See `spritecook:spritecook-workflow-essentials` skill. Output format for animations is `webp` even when `spritesheet` is requested — use PIL to extract frames:

  ```python
  from PIL import Image
  img = Image.open('src.webp')
  for i in range(img.n_frames):
      img.seek(i)
      img.convert('RGBA').save(f'frame_{i:03d}.png')
  ```

- **ElevenLabs** (`mcp__elevenlabs__text_to_sound_effects`): SFX generation. Output mp3 directly. API key has a credit quota set on it — check if calls start failing with `quota_exceeded`.

- **Suno** (external, not MCP): Music generation. User feeds prompts manually. Conventions documented in conversation history:
  - 16-bit SNES SPC700 chiptune + hardware references (FM synth, FF6/Chrono Trigger)
  - For lobby muzak: Earthbound Hotel Theme + NieR Automata "haunted muzak" references
  - Custom Mode + Instrumental toggle ON + blank lyrics

**Asset consistency note:** AI generation has style drift across calls. If you need a 2–4 frame animation from a single sprite (e.g. rotor spin), **programmatic pixel editing with PIL** often beats re-generating (zero drift, deterministic, cheap). See `scoutdrone/anim/idle-east/` for the example — frames 000/001 are the same D2 sprite with horizontal motion blur applied at 11px and 17px kernel widths to the rotor region only.

### Measuring a sprite's opaque bounding box

When adding a new sprite size to the `BBOX` table:

```python
from PIL import Image
img = Image.open('path/side.png').convert('RGBA')
print(img.getbbox())  # (left, top, right, bottom) of opaque pixels
```

Then `centerY ≈ canvas_h / 2`, `headY = top`, `feetY = bottom`.

### Backup before overwrite

Per user convention (memory: `feedback_backup_before_overwrite`): save `<name>.backup.<ext>` next to any generated asset before replacing it. Prevents losing art that was working.

## Debug logging

Module: `src/util/logger.ts`. Used extensively in `CombatScene`.

- **`log(tag, msg, data?)`** — appends to ring buffer + mirrors to console when enabled
- **`copyLogToClipboard()`** — used by the L hotkey
- Toggled via `VITE_DEBUG_LOG` env var (defaults to on in `vite dev`, off in prod)
- Red **DEBUG · [L] copy log** badge appears top-left when active (mounted from `main.ts`)

Events currently logged:
- `SCENE` — scene create + transitions
- `TURN` — party turn / enemy turn begin
- `ACTION` — ability executed
- `DAMAGE` — target + damage + hp + ko
- `END_CHECK` — checkEndConditions evaluation (lists living units)
- `WIN` / `LOSE` — outcome

Add new `log(...)` calls at any point you suspect timing or state issues. The log is the primary diagnostic tool — **when the user pastes a log, read the sequence of events before reasoning about symptoms**.

## Commands you'll use

```bash
npx tsc --noEmit                    # typecheck (the test suite, basically)
npm run dev                         # vite dev server
npm run build                       # tsc + production build
```

No lint/format step currently. No test suite.

## Don'ts

- **Don't auto-delete assets from `public/assets/_review/`** or the old animation frame folders without explicit user confirmation — they're harmless leftovers and user may be reviewing them
- **Don't suggest skipping animation polish** — user has explicitly called this out
- **Don't commit `.env` / `.env.local` or real API keys** — `.env.example` is the shared doc
- **Don't regenerate assets when a user has uploaded their own** — check before calling `generate_game_art` if user referenced an asset; ask for the `asset_id`

## User profile

See memory files (`/Users/tomdonohue/.claude/projects/-Users-tomdonohue-projects-vibejam2026/memory/`). Key points:

- Jam goal is participation, not winning — but polish matters to user
- "A few px" means additive `+N` pixels, never a scale-factor change
- Save `.backup.<ext>` before overwriting generated assets
