# CLAUDE.md

Instructions and context for Claude Code sessions working on this project.

## Project

**Reach the Relay** — a post-AI-collapse party VIP-protection RPG for Vibe Jam 2026 (submission deadline **2026-05-01 13:37 UTC**).

See `README.md` for the player-facing overview and `GAME_MECHANICS.md` at the project root for the **authoritative reference of all combat rules, ability/enemy tables, item effects, boss rotation, and score formula** — keep that doc in sync whenever you change numbers in `src/data/*.ts`.

Design docs live in `.claude/`:

- `concept2-escort.md` — full game concept (world, mechanics, visual direction)
- `implementation-plan.md` — build plan + pipeline notes
- `rules.md` — combat rule reference (older; `GAME_MECHANICS.md` is now the canonical rules doc)
- `AnimationPlan.md`, `JourneyPlan.md`, `VICTORY_CUTSCENE_PLAN.md` — feature-level plans for combat anims, journey pacing, and the relay cutscene
- `battle-simulations{,2,3}.md` — captured outputs from `npm run sim` used to balance enemy HP/damage
- `lobby.md`, `games.md`, `concepts.md` — supporting design notes
- `ITCH_DESCRIPTION.md` / `.html` — store-page copy for the itch.io submission

**Jam goal: participate, not win.** Scope small, pick fun-to-build over prize-optimized. Don't suggest skipping polish that the user explicitly asked for.

## Tech stack

- **Phaser 4** (`phaser` package, `pixelArt: true` for crisp pixel scaling)
- **TypeScript strict mode** — no implicit any, no unused locals/params, no fallthrough
- **Vite 5** for dev server + production build
- No test framework yet — **typechecking is the safety net** (`npx tsc --noEmit`)

## Project layout

```
src/
  main.ts                         Phaser Game config + scene list + audio-settings + debug badges
  scenes/
    BootScene.ts                  tier-1 preload — sprites + SFX + critical-path music + UI
    BackgroundLoadScene.ts        tier-2a loader — streams route/journey music in the background while on Title; hands off to CombatLoadScene once lobby-tier assets are cached
    CombatLoadScene.ts            tier-2b loader — combat frames for all party + enemy anims, map overlays, deferred music; runs while player is in Lobby / picking recruits. Sets `assets:loaded = true` on completion.
    TitleScene.ts                 attract screen + "press any key" + mute toggle (persisted to localStorage). `V` hotkey test-triggers RelayCutsceneScene.
    LeaderSelectScene.ts          pick 1 of 5 classes as playable avatar
    LobbyScene.ts                 walkable Greenhouse — WASD/arrows, click-to-interact, NPC dialogue, map board, exit portal
      lobby/npcAgent.ts           NpcAgent class (patrol state machine, proximity prompt, dialogue, click-to-interact)
      lobby/mapModal.ts           full-screen route-map modal + "MISSION BRIEFING" shortcut
      lobby/crewHud.ts            top-right crew/VIP HUD widget
    PartySelectScene.ts           old standalone party picker (kept as a legacy path)
    PartySelectTerminalScene.ts   in-lobby terminal that pauses Lobby and overlays the picker
    RouteScene.ts                 list-style route select (3 difficulty tiers + TEST routes)
    RouteMapScene.ts              map-based route picker — full-map background + per-route PNG overlays positioned at measured fractional coords
    JourneyScene.ts               between-encounter path animation with head-portrait markers
    CombatScene.ts                ATB combat, the bulk of the codebase
    RestScene.ts                  between-encounter heal/revive; refills maxUsesPerRest abilities
    RelayCutsceneScene.ts         victory cutscene — 4-beat relay activation. Played after final encounter clears and before RunCompleteScene.
    RunCompleteScene.ts           victory/defeat screen + score calc + opt-in leaderboard submit
    LeaderboardScene.ts           scores table with route-filter tabs; remote fetch with localStorage fallback (banner when fallback triggers)
  data/
    classes.ts                    party class defs (Vanguard/Netrunner/Medic/Scavenger/Cybermonk); AbilityDef incl. maxUsesPerRest
    enemies.ts                    enemy defs + VULNERABILITY_GLYPH map + signatureAoE/shockwave boss fields
    items.ts                      consumables (Stimpak, Power Cell, Adrenaline, Smoke Grenade) + STARTING_INVENTORY
    routes.ts                     route defs — base encounters, encounterPool, variants, rest stops, bg variants, music, Y offsets
    briefing.ts                   mission-briefing copy (title, lead, sections, lore)
    classBlurbs.ts                short lore lines shown in NPC dialogue modal
  state/
    run.ts                        active-run state (party, route, encounter index, HP/MP, VIP HP, inventory, abilityUsesRemaining)
    lobby.ts                      pre-run state (leader, recruits, last lobby pose) — survives LeaderSelect → Lobby → Route transitions
    player.ts                     persistent username (localStorage) + `ingestUrlUsername()` for `?username=<name>` portal ingest
    leaderboard.ts                submit/fetch adapter with localStorage fallback; exports `ROUTE_BONUS_BY_DIFFICULTY` (easy 100 / medium 400 / hard 800)
  combat/
    types.ts                      Unit interface, Side type, ATB/PANEL/DEPTH/DIMMED constants
    helpers.ts                    pure helpers: calculateDamage (incl. vulnerability/resistance), getUnitFacing, validTargets, validItemTargets
    fx.ts                         transient VFX — flashSprite, playHitShake, spawnFloatNumber, spawnDamageNumber
  sim/
    simBattle.ts                  headless combat simulator (no Phaser deps)
    runSim.ts                     CLI entry — runs N simulated battles per matchup; emits a markdown report (`npm run sim`)
  util/
    logger.ts                     in-memory ring-buffer logger (L key copies to clipboard) + debug badge mounts
    ui.ts                         shared FONT constant + isTouchDevice()
    audio.ts                      initAudioSettings + getVol/setVol (master/music/sfx categories) + stopAllMusic
    music.ts                      playMusicPool — plays a random pool member, re-picks on loop end
    musicToggle.ts                title-screen DOM mute button (48×48 a11y target, persisted to localStorage)
    audioSettingsPanel.ts         shared volume sliders panel (used by pause menu + combat pause)
    pauseMenu.ts                  shared ESC pause menu used by all non-title, non-combat scenes
    briefingModal.ts              shared mission-briefing modal (Title / Lobby map / Dr. Vey NPC)
    usernamePrompt.ts             shared callsign-entry modal for leaderboard; scenes gate ESC via `isUsernamePromptOpen()`
    button.ts                     `createHoverButton` — shared green-pill button used across pause menu / RestScene / RunComplete / Leaderboard
    orientationLock.ts            mobile portrait lockout — `screen.orientation.lock('landscape')` on first gesture + DOM "rotate your device" overlay
    headCrop.ts                   per-class face-crop rects for compact portraits (HEAD_CROP_BY_CLASS)
    bag.ts                        grab-bag RNG — shuffles a pool, cycles without repeats
    portal.ts                     Vibe Jam 2026 webring integration (entry detection + exit-URL builder)
    rexGlobal.ts                  side-effect import — exposes Phaser as window.Phaser before rex-plugins load
public/
  assets/
    sprites/                      sprites + extracted animation frames (party/, enemies/, npcs/, props/, vfx/)
    audio/music/                  music tracks (keys use `music-<id>`)
    audio/sfx/                    SFX (keys use `sfx-<id>`)
    backgrounds/combat/           combat backgrounds — `<route>.webp` + `<route>_<theme>.webp` variants + `.backup.webp`
    backgrounds/lobby/            lobby backgrounds
scripts/
  process_sheet.py                PIL helper for splitting SpriteCook animation webp outputs into PNG frames
sprite-dev/                       working folder, gitignored (whole folder)
  _review/                        TEMP folder for asset previews; gitignored, delete when user has picked
  unused/                         moved-out backups of overwritten/superseded sprites
worker/                           Cloudflare Worker + D1 leaderboard backend (separate deploy — see "Leaderboard" section)
  src/index.ts                    POST /submit + GET /top endpoints, CORS wide open
  schema.sql                      D1 table definition
  wrangler.toml                   Worker config (D1 binding, route)
```

## Conventions

### Scenes

- Every scene uses `this.cameras.main.setBackgroundColor(...)` for its base color
- Scene transitions via `this.scene.start('SceneKey', data)`; state persists via `state/run.ts` singleton
- The unit model is a plain `Unit` interface in `src/combat/types.ts` (not ECS), imported by `CombatScene`

### Music

- Tracks preloaded in `BootScene` (critical-path) or `BackgroundLoadScene` (streaming in parallel with Title) with key `music-<id>`
- **All music playback goes through `playMusicPool(scene, pool, volume)` in `util/music.ts`** — it filters `pool` to cache-hit keys, picks one at random, and re-picks another pool member when the track loops. Directly calling `scene.sound.add('music-...')` bypasses the audio category volume and pool rotation.
- If the currently-playing track is a member of the new pool, `playMusicPool` is a no-op (keeps music going across scene re-entries)
- Each route has `musicKeys: string[]` (pool); boss encounters override via `bossMusicKey` on `EnemyDef`
- `music-main-theme` plays on `TitleScene` (gated by the DOM mute toggle — `isTitleMusicMuted()`)
- `music-lobby-theme` plays on `LeaderSelectScene` / Lobby / Route
- **Audio categories** (`master` / `music` / `sfx`): `util/audio.ts` tracks per-category volume, persisted to localStorage as `audio:<cat>`, re-read by Phaser via the registry. `getVol(cat)` / `setVol(cat, v)` is the only API. `effectiveMult()` gives music `master × music`; sfx gets `master × sfx`.
- `stopAllMusic(scene)` in `util/audio.ts` is a defensive sweep used by scenes that want a guaranteed silent start (RunComplete, LeaderSelect, CombatScene track-swap) — registry tracking can desync if sounds were started outside `playMusicPool`

### SFX

- Preloaded with `sfx-<id>` prefix
- Typical volume: `0.5` for menu/ambient, `1.0` for impacts/enemy attacks
- Enemy-specific attack SFX via `EnemyDef.attackSfxKey` (falls back to generic `sfx-enemy-attack`)

### Backgrounds + sprite positioning

- Each route has a `backgroundKey` (fallback) and an optional `backgroundVariants: (string | BackgroundVariant)[]`. `CombatScene` picks one at random per combat.
- A `BackgroundVariant` is `{ key, enemyYOffset?, partyYOffset? }`. Per-variant offsets stack additively on top of route + encounter offsets.
- Vertical positioning uses three offset sources, all summed:
  - **route-level** `enemyYOffset` / `partyYOffset` (whole route)
  - **encounter-level** `enemyYOffset` (specific encounter, e.g. wreckwarden-alone needs -30)
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
- `scale` field determines displayed size (currently ~1.8-2.5 for most; Wreckwarden boss is 2.2 on 136px canvas)
- `formationSpread` multiplier on EnemyDef can widen spacing for large sprites (default 1). The encounter-level value is `Math.max(1, ...)` across **all** enemies in the encounter — one big enemy spreads everyone else too. Values `< 1` are effectively no-ops (floored to 1), not "off".

### Floaty enemies (Scout Drone, Nanite Swarm)

- Tracked in a `floatyUnits` Set in `createBattleSprite`
- Shadow drops 25px lower + alpha 0.12 (vs grounded 0.18)
- On attack, route through **`playFloatyAttack`** (not `playFullAttackSequence`) — flies forward + nudge-impact + flies back, idle anim plays throughout (no texture swaps that would break it)
- Nanite's multi-hit behavior uses `playFloatyAttack` wrapped around the swarm-all-party logic
- `TWEEN_IDLE_UNITS` set in `CombatScene` enables the vertical bob tween alongside the frame-based idle anim

### Lobby (walkable Greenhouse)

- Walkable polygon + obstacle rects — movement lives in `LobbyScene.update()`; point-in-polygon tests happen every frame
- NPCs are owned by `NpcAgent` (`scenes/lobby/npcAgent.ts`): each instance handles sprite, patrol state machine, proximity prompt, collision rect, dialogue, and click-to-interact. Adding an NPC is ~5 lines in `spawnNpcs()`.
- **Interactables support mouse click as an alternative to E/Enter/Space.** `LobbyScene.wireClickInteract(target, inRange, activate)` wires pointerover/pointerdown + toggles the DOM cursor to `pointer` when in range. NPCs use `NpcAgent.enableClickInteract(canInteract)` — the canInteract closure typically returns `npc.isPromptVisible()` so only the closest in-range NPC responds.
- **"Closest wins" for overlapping prompts**: when multiple interactables (NPCs, map board, terminal) are in range, only the closest one shows its `▼ E` prompt. `updateNpcPrompts` + the prop prompt gates use this rule so the visible affordance always matches what pressing E would trigger.
- **Pre-run state lives in `state/lobby.ts`** — leader id, recruited set, last player pose. Survives LeaderSelect → Lobby → PartySelectTerminal round-trips so the player doesn't snap back to spawn.
- **`PartySelectTerminalScene` pauses (not stops) LobbyScene** — so NPC patrol state, player position, and music survive intact across the overlay
- `pauseMenu.ts` is the shared ESC menu for non-combat scenes. Scenes call `installPauseMenuEsc(this, { shouldBlockEsc: () => ... })` — the predicate blocks ESC from opening the menu when another modal (dialogue, map, briefing) owns the key.
- **Vibe Jam webring** (`util/portal.ts`): `?portal=true` query param skips Title/LeaderSelect/PartySelect and drops the player straight into Lobby with a default party (Vanguard leader + Medic + Scavenger). An exit portal prop in the Lobby redirects to `vibejam.cc/portal/2026` with identity query params. `?username=<name>` is ingested silently on boot by `ingestUrlUsername()` (see `state/player.ts`) so portal visitors never see the callsign prompt.
- **`L` key is registered per-scene.** Currently only in CombatScene — if you want log-copy in another scene, register it explicitly. Collision-debug toggle (`` ` `` backtick on Lobby, mounted from `main.ts`) is independent.

### Combat flow gotchas

- `case 'slow'` (FROSTLOCK) **must `return` early** after `playFullAttackSequence` to skip the default finalize. Earlier versions ran both in parallel, causing `checkEndConditions` to fire before impact → missed victory detection. Same pattern applies to any future case that uses `playFullAttackSequence` from `executeAbility`.
- `case 'salvage'` follows the same pattern: SFX + `applyDamage` are wrapped in an `applyImpact` callback passed to `playFullAttackSequence` so the sound fires at impact mid-anim, not at attack start. Falls back to immediate path if no attack anim exists.
- `applyDamage` signature: `(target, damage, crit?, element?)`. Element is used by `spawnDamageNumber` to append the vulnerability glyph (🔥/❄/⚡).
- **Phaser 4 Text quirk**: `spawnFloatNumber` MUST pass concrete `stroke` and `strokeThickness` values (not `undefined`) — passing `undefined` to Phaser 4's Text constructor breaks rendering of non-crit damage numbers. Defaults are `'#000000'` / `4`.
- **Path-overlap dim**: when an enemy walks through the party to attack the VIP, ALL living party members are dimmed for the whole sequence (set to `DIMMED_OTHER_ALPHA = 0.3`). Implementation in `playFullAttackSequence`'s `pathOverlapTargets` block. The VIP itself is NOT dimmed (filter is `p.side === 'party'`).
- Enemy HP bars fade out 2.5s after last damage. `beginEnemyTurn` hides every **other** enemy's HP bar before the attacker starts, so a lingering bar from a recent hit isn't visible during a different enemy's attack.
- The `L` key hotkey for copy-log is registered per-scene (currently only in CombatScene).
- **`maxUsesPerRest` abilities (GUARD 2, TAUNT 2, SALVAGE 3, FOCUS 3, FLURRY 5)**: use counters live on `RunState.abilityUsesRemaining` (keyed as `${classId}:${abilityId}`), **not** on the combat scene. They persist across encounters and are only refilled by `refillAbilityUsesOnRest()` from `RestScene`. Don't accidentally reset them on combat scene create. Design rule: every non-MP special move is rest-limited; MP-gated abilities balance themselves via MP.
- **FLURRY crit**: the description says "can crit" but `case 'flurry'` currently passes `crit=false` to `applyDamage` and `calculateDamage` doesn't roll crits. If we want per-hit crits, they have to be added inside the `fireHit` loop — regular damage abilities roll 15%, SALVAGE rolls 20%.

### Score

Victory-only, computed in `RunCompleteScene`:

```
baseScore  = vipHp × 2 + Σ partyHp[key]
finalScore = baseScore + ROUTE_BONUS_BY_DIFFICULTY[run.route.difficulty]
```

`ROUTE_BONUS_BY_DIFFICULTY` lives in `state/leaderboard.ts`: easy 100, medium 400, hard 800. The flat bonus ensures harder routes always outrank easier ones even when the player cleared them at lower HP. No turn/MP penalty. Don't refactor without confirming with the user.

### Leaderboard

- **Backend**: Cloudflare Worker + D1 in `worker/`, deployed separately. Client points at it via `VITE_LEADERBOARD_API` env var. Endpoints: `POST /submit` (body `{ username, score, leaderId, route, durationSec }` → `{ ok, rank }`) and `GET /top?route=<id>&limit=<n>` (route optional — omitted = global board).
- **Client adapter**: `state/leaderboard.ts` always writes to localStorage first (guaranteed persistence), then fire-and-forgets to the Worker if configured. Reads try remote first, fall back to localStorage with a "showing local scores only" banner.
- **Submit is opt-in**: on victory `RunCompleteScene` shows a `[ SUBMIT SCORE ]` button. First submit opens `usernamePrompt.ts` to capture a callsign; subsequent runs auto-submit under the stored name. Cancel at any stage is fine — leaderboard never blocks progression.
- **Username**: persisted via `state/player.ts` (localStorage key `player:username`). Regex is `/^[A-Za-z0-9 _]{1,16}$/` — server-side validation in `worker/src/index.ts` must match.
- Tie-break is `score DESC, duration_sec ASC` (faster clears win ties).

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
npm run dev                         # vite dev server at :5173
npm run build                       # tsc + production build (dist/)
npm run preview                     # serve the production build
npm run typecheck                   # = npx tsc --noEmit (the test suite, basically)
npm run lint                        # eslint src
npm run format                      # prettier --write .
npm run format:check                # prettier --check .
npm run sim                         # headless combat sim → markdown report (see src/sim/)
```

Typecheck + eslint + prettier + a headless combat simulator are the quality gates — there is no unit-test suite.

## Don'ts

- **Don't auto-delete assets from `sprite-dev/_review/` or `sprite-dev/unused/`** — they're out-of-tree working files the user may still be reviewing or keeping as backup
- **Don't suggest skipping animation polish** — user has explicitly called this out
- **Don't commit `.env` / `.env.local` or real API keys** — `.env.example` is the shared doc
- **Don't regenerate assets when a user has uploaded their own** — check before calling `generate_game_art` if user referenced an asset; ask for the `asset_id`
- **Dr. Vey's gender is intentionally ambiguous** — use `they/them/their/themself` in all player-visible copy, NPC dialogue, and code comments referring to the VIP. Never `he/him/his` or `she/her/hers`. Same convention applies to new cutscene/briefing/dialogue text.

## User profile

See memory files (`/Users/tomdonohue/.claude/projects/-Users-tomdonohue-projects-vibejam2026/memory/`). Key points:

- Jam goal is participation, not winning — but polish matters to user
- "A few px" means additive `+N` pixels, never a scale-factor change
- Save `.backup.<ext>` before overwriting generated assets
