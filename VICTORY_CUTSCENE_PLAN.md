# Victory Cutscene Plan — "Reaching the Relay"

A short cinematic that plays after the final encounter clears and before `RunCompleteScene`. Payoff moment for the whole VIP mission — the party delivers Dr. Vey to the tower, Dr. Vey goes inside briefly to do their work, emerges, and activates the broadcast.

**Scope**: four beats across four backgrounds, world-walking animations, a custom activation animation for Dr. Vey, a VFX pulse, and a new victory music track. ~12–14 seconds total. Skippable.

---

## Narrative beats

Four-beat structure (wide approach → medium enter/exit → tight activation close-up → tower beacon pan), ~12s total. Skippable with any key at any point.

### Beat 1 — Wide approach (~3s) — *north walk*

- Establishing shot. Overworld 3/4 top-down, tower at the top-center of the frame on a fortified hilltop.
- Party (3 members) + Dr. Vey enter from the bottom edge and walk **north** up a long winding dirt path toward the bunker + tower.
- Backs-to-camera framing — classic JRPG "arriving at a landmark" grammar (DQ3 Zoma climb, FF6 Floating Continent).
- Leader at the front; other two party members behind; Dr. Vey tucked between them, protected.
- Stagger walk-start times by ~180ms so they form a loose climbing line.
- Walkers fade out or walk off the top of frame as Beat 2 cuts in.
- **Bg asset: `relay-hilltop-wide.webp` ✅ installed**

### Beat 2 — Enter + exit (~4s) — *east walk, fade in/out at the door*

Shared bg: side-on medium view of the same fortified base, zoomed in close to the bunker's exterior, tower lattice cropped at the top of frame.

Sequence:
- Hard cut from Beat 1 (or brief crossfade).
- Party + Dr. Vey enter from the **left** of the frame, walking east. Profile side-view.
- Party stops near the bunker. Dr. Vey continues past them, east-bound, reaches the riveted steel door on the east side of the bunker.
- **Dr. Vey's sprite fades out** over ~500ms at the doorway → reads as "entered."
- ~1s empty-doorway pause (tension / implied work happening inside).
- **Dr. Vey's sprite fades back in** at the same doorway, facing east (exits). The fade-in/out approach avoids a visual direction flip — no turning the sprite west — so whole cutscene reads as single eastward motion.
- **End of Beat 2** — hard cut to Beat 3 (Dr. Vey hasn't reached the console yet; Beat 3 handles activation in a new framing).

### Beat 3 — Activation close-up (~2.5s + ~0.8s hold) — *tight console close-up, new framing*

New dedicated bg: tight side-on close-up of the broadcast console. Dr. Vey fills more of the frame; the console is the visual subject. A hint of the tower's lattice at the top edge keeps the setting consistent.

- Hard cut to the close-up bg.
- Dr. Vey sprite is foregrounded in front of the console.
- Plays a short custom "activation" animation: reach forward, press a chunky red activation lever. 3–4 frames at ~10 fps.
- Small camera shake on press (≤2px, single pulse).
- Broadcast-ping SFX layered over the visual.
- ~0.8s hold on the console mid-activation with LEDs lit brighter.
- **End of Beat 3** — hard cut to Beat 4.

### Beat 4 — Beacon pulse (~3s + ~1.5s hold) — *tower close-up pan, beacon fires*

New dedicated bg: tight side-on close-up of the tower filling the vertical frame from base to beacon.

- Hard cut to the tower close-up bg.
- Phaser camera starts centered low (tower base visible, bunker roof just in the lower-right corner), tweens UP along the tower's length (~1.8s smooth ease) until the red beacon is centered in the upper-middle of frame.
- Once the camera settles: beacon flashes — bright, dim, bright — 2–3 pulses, each accompanied by the reused/recolored **Wreckwarden SHOCKWAVE** sprite anim firing outward from the beacon (recolored surge-blue → warm amber signal), plus broadcast-ping SFX on each pulse.
- ~1.5s hold on the final bright-pulse frame.
- Fade out → `RunCompleteScene`.

### Skip behavior

- Any keydown or pointerdown at any point triggers an immediate 200ms fade → `RunCompleteScene`.
- Skip is always available — no "you must watch the whole thing" state.

---

## Technical implementation

### New scene: `RelayCutsceneScene`

Register in `main.ts` scene list after `JourneyScene`, before `RunCompleteScene`.

```
src/scenes/RelayCutsceneScene.ts
```

Responsibilities:
- Drive the four-beat state machine (`approach` → `enter_exit` → `activation` → `beacon` → `done`)
- Load + render all four cutscene backgrounds (hard cuts between beats, optional brief crossfade)
- Beat 1: spawn party + VIP at the bottom of the frame, tween upward with staggered start, running `worldwalk-north` anim per unit
- Beat 2: cut to the medium side-on bg, respawn party + VIP on the left edge, tween rightward with `worldwalk-east` anim (with the `flipX` fallback for classes without a dedicated east). Dr. Vey fades out at the door, pauses ~1s, fades back in.
- Beat 3: hard cut to the close-up bg, spawn Dr. Vey sprite foregrounded, play custom activation anim, trigger broadcast-ping SFX + small camera shake
- Beat 4: hard cut to the tower close-up bg, Phaser camera pans UP the tower, then beacon pulses fire with the amber-tinted SHOCKWAVE sprite + broadcast-ping SFX on each
- Wire skip input + fade-out → `RunCompleteScene`

### Scene flow wiring

Only change to existing code: `JourneyScene.transitionToNext` on `isRunComplete` starts `'RelayCutscene'` instead of `'RunComplete'`.

```ts
// JourneyScene.ts:402-404 (approx)
if (run.encounterIndex >= run.route.encounters.length) {
  this.scene.start('RelayCutscene');
}
```

The cutscene itself hands off to `RunCompleteScene` with `{ outcome: 'victory' }`, preserving the existing score-calc flow.

### Per-class walk-direction sprite handling

Party already has worldwalk support in the Lobby — reuse the same fallback logic. Beat 1 uses north, Beat 2 uses east.

| Class     | North walk (Beat 1)        | East walk (Beat 2)        |
| --------- | -------------------------- | ------------------------- |
| Vanguard  | `worldwalk-north` (6 fr)   | `worldwalk-east` (4 fr)   |
| Medic     | `worldwalk-north` (6 fr)   | `worldwalk-east` (6 fr)   |
| Netrunner | `worldwalk-north` (6 fr)   | `worldwalk-west` + `flipX` |
| Scavenger | `worldwalk-north` (6 fr)   | `worldwalk-west` + `flipX` |
| Cybermonk | `worldwalk-north` (6 fr)   | `worldwalk-west` + `flipX` |
| Dr. Vey   | **new** — north frames     | **new** — east frames (or west + flipX) |

### Formation positions

**Beat 1 (wide, walking north).** Positions in 1280×720 viewport. Path-center X is the tower's base X on the wide background. Y goes from the bottom of the frame (start) upward toward the tower base (stop).

```
path_center_x = 640    // center horizontally, tune to bg
start_y       = 720    // off the bottom edge
stop_y        = 360    // below the tower base

Leader      → (path_center_x,       start_y)   → (path_center_x,       stop_y)
Party #2    → (path_center_x - 44,  start_y+20)→ (path_center_x - 44,  stop_y+20)
Party #3    → (path_center_x + 44,  start_y+20)→ (path_center_x + 44,  stop_y+20)
Dr. Vey     → (path_center_x,       start_y+40)→ (path_center_x,       stop_y+40)  // tucked behind
```

**Beat 2 (close-up, walking east).** New background, sprites re-spawn on the left edge and walk to positions near the doorway on the right.

```
entrance_x = 1000      // right-side doorway, tune to bg
ground_y   = 540       // ground line of the close-up bg

Dr. Vey     → offscreen (-40, ground_y) → (entrance_x - 80, ground_y)   // continues past party
Leader      → offscreen (-80, ground_y) → (entrance_x - 280, ground_y)
Party #2    → offscreen (-120, ground_y-4) → (entrance_x - 330, ground_y-4)
Party #3    → offscreen (-120, ground_y+4) → (entrance_x - 330, ground_y+4)
```

Exact numbers get tuned once the two backgrounds land.

### Beacon pulse VFX

Reuse the Wreckwarden SHOCKWAVE sprite animation (`wreckwarden-attack-shockwave-east`) as the concentric-wave pulse. Recolor from surge-blue (`0x5ac8ff`) to a warm signal amber (e.g. `0xffc970`) via `setTint()` on the sprite, positioned at the tower's beacon location and scaled up ~2–3×.

No new VFX assets needed — just repurpose an existing one.

### Audio

**New victory track — `music-victory`** plays continuously across the cutscene AND the `RunCompleteScene` that follows. Seamless hand-off: both scenes start it via the same `playMusicPool(this, ['music-victory'], volume)` call, and `playMusicPool` no-ops when the currently-playing track is already in the incoming pool — so the cutscene fades in the track once, and RunComplete picks up the same running track instead of restarting it.

- `RelayCutsceneScene` enter: stop the Journey music (currently playing), fade in `music-victory` at ~0.3 volume
- **Remove** `stopAllMusic(this)` from `RunCompleteScene.create()` (currently line 34) — we want the cutscene's victory track to carry through. If the player skips the cutscene, RunComplete still starts `music-victory` fresh.
- Beat 2 beacon activation: play a soft broadcast/ping SFX (new asset — one `text_to_sound_effects` call) layered over the music, not replacing it
- When the player leaves RunComplete → Title, `stopAllMusic` / the title-music start-up handles the handoff as today

**Music track spec (generate externally via Suno — user-driven):**

- Key/feel: major key, warm and hopeful without being triumphant-stadium. Think FF6 "World of Ruin → World of Balance reveal," or Chrono Trigger "Memories of Green." Reflective pride, not a fanfare.
- Palette: 16-bit SNES SPC700 chiptune, warm FM-synth pads, soft lead bell/flute voice over a gentle arpeggiated accompaniment, light kick+snare kit.
- Tempo: ~90–100 BPM.
- Duration: ~60–90s loopable. Needs to comfortably cover the cutscene (~6s) AND hold for the length of a RunComplete view (player may linger 20–60s reading stats before pressing continue).
- Structure: soft ambient intro (8–12s, fits under cutscene arrival), lift into the main melody (fits beat 2 + RunComplete opening), gentle return to the theme and loop point.
- No vocals, no lyrics, no strong percussion hits on beat 1 — nothing that would step on the broadcast-ping SFX.

**Suno prompt to paste** (Custom Mode, Instrumental ON, blank lyrics):
> 16-bit SNES SPC700 chiptune. Warm, hopeful, reflective end-of-journey theme — the mission succeeded but the world is still broken. Major key, 95 BPM. Soft FM-synth pad intro, then a gentle bell/flute lead melody over arpeggiated accompaniment, light chiptune kit, a subtle hopeful lift in the middle. References: Final Fantasy VI "Balance is Restored" (without the triumphant fanfare), Chrono Trigger "Memories of Green," NieR "Song of the Ancients." No vocals. Loopable.

Once the user generates it: save as `public/assets/audio/music/victory.mp3`, preload in `BootScene` as `music-victory`.

### SFX (broadcast ping)

Beat-2 activation gets a one-shot broadcast-ping SFX over the music. ElevenLabs prompt in the Assets section below.

---

## Assets needed

### 1. Beat 1 wide background — "hilltop approach" ✅ INSTALLED

SpriteCook detailed mode, 4K resolution (5504×3072 native), downscaled to 1280×720 webp via PIL LANCZOS.

Final asset at `public/assets/backgrounds/cutscene/relay-hilltop-wide.webp` (131 KB).

Reference asset for downstream gens: `f3e29e4a-0547-4f03-add1-467e77fa39ae` (the approved SpriteCook asset — use this as `reference_asset_id` on Beat 2 / Beat 3 for continuity).

### 2. Beat 2 — medium side-on exterior (new)

Generator: SpriteCook `generate_game_art`, detailed mode (`pixel=false`) at 4K resolution, downscaled to 1280×720 webp.

**Framing**: side-on medium view at ground level, tower lattice cropped at top of frame, bunker mid-right with door on its east face, wide ground on the left for sprites to walk across.

**Prompt**:
> Classic SNES JRPG cutscene background, 16-bit pixel art, side-on medium view at ground level. This is a continuation of the same fortified relay base shown in the reference asset — now zoomed in tight on the bunker's exterior. Match the bunker design, palette, color grading, and weathering style from the reference asset. The dark steel lattice radio relay tower rises up out of the top of the frame — only the lower portion of its lattice is visible, cropped by the top edge, establishing that the bunker sits at the tower's base. The weathered concrete bunker fills the right-center of the frame, side-on: boxy pre-fall construction with patched repairs, dark corrugated metal roof, one small glowing yellow window. A heavy riveted steel entrance door on the right face of the bunker, centered vertically — clear walk-in target. Thick cable conduits run from the tower down and into the bunker's roof. A low section of the scavenged scrap-metal perimeter wall is visible in the background to the left. Packed dirt and gravel ground extending as a wide flat band across the middle of the frame — plenty of open horizontal space on the left for sprites to walk along from left to right toward the door. Hazy dusk sky visible above and behind the tower, warm purple-orange with thin ashen clouds. Muted faded palette, matching the reference. Empty stage, no characters.

Reference asset: `f3e29e4a-0547-4f03-add1-467e77fa39ae`.

Install path: `public/assets/backgrounds/cutscene/relay-entrance-medium.webp`.

### 3. Beat 3 — tight close-up of broadcast console (new)

Generator: SpriteCook `generate_game_art`, detailed mode, 4K.

**Framing**: tight side-on close-up, console is the visual subject filling center-right, foreground space on the left for Dr. Vey sprite to stand at waist height. Hint of tower lattice at top edge for continuity.

**Prompt**:
> Classic SNES JRPG cutscene background, 16-bit pixel art, tight side-on close-up at ground level. A rugged decades-old analog broadcast control console mounted on a weathered concrete wall — the console is the clear visual subject, filling the center-right of the frame. The console is waist-height, faced with a metal panel housing banks of dials, gauges, switches, patched-in wiring bundles, two glowing yellow indicator LEDs, and a single large chunky red activation lever mounted at the center as the clear interactive target. The concrete wall behind the console shows its age — patched repairs, exposed rebar in spots, dark weathering streaks. Thick cable conduits run from the wall up and out the top of the frame, disappearing into the radio relay tower's dark steel lattice, which is faintly visible at the top edge of the frame for continuity. Warm yellow incandescent lighting from the console's LEDs casts a soft glow on the wall and the ground in front. The floor is packed concrete with visible scuffs. Left side of the frame is open — ground-level floor space for a Dr. Vey character sprite to stand at roughly waist-height in front of the console. Muted palette with warm amber highlights from the console lighting, dusk shadows elsewhere. Empty stage, no characters.

Reference asset: `f3e29e4a-0547-4f03-add1-467e77fa39ae` (for bunker/palette consistency).

Install path: `public/assets/backgrounds/cutscene/relay-console-closeup.webp`.

### 4. Beat 4 — overworld tower close-up (new)

Generator: SpriteCook `generate_game_art`, detailed mode, 4K.

**Framing**: tight side-on close-up of the tower filling the vertical frame from base to beacon. Plenty of sky above the beacon + open ground at the base so the Phaser camera can pan vertically.

**Prompt**:
> Classic SNES JRPG cutscene background, 16-bit pixel art. A tight side-on close-up of the dark steel lattice radio relay tower from the reference asset — the tower fills the vertical center of the frame from bottom to top, occupying most of the image's height, positioned so there's clear sky visible above the beacon at the top and open ground visible at the base at the bottom. Tower design matches the reference: clean dark steel lattice with visible cross-bracing, two circular microwave dishes mounted on the mast at different heights, a thin antenna rod at the peak capped by a glowing red beacon light. Decades-old infrastructure, still standing. At the base of the tower: the top of the weathered concrete bunker building visible in the lower-right corner of the frame (same bunker design as the reference), with cable conduits running from the tower down into its roof. The landscape is an overgrown hilltop — faded yellow-green grass, clumps of weeds, weathered stone outcroppings. The tower is the clear hero of the shot — centered, dominant, occupying nearly the full vertical extent of the image. Hazy dusk sky filling the area behind and around the tower, warm purple-orange with thin ashen clouds, the red beacon at the peak glowing against the sky. Muted faded palette. Empty stage, no characters.

Reference asset: `c77a01dc-b4a0-410e-8cce-166175cfe65f` (relay-v2-B icon — canonical tower design).

Install path: `public/assets/backgrounds/cutscene/relay-tower-closeup.webp`.

### 3. Dr. Vey worldwalk animations (new)

Dr. Vey needs TWO walk directions + one custom activation animation.

**3a. North + east walks** — for Beat 1 (climbing) and Beat 2 (walking into entrance).

Route via PixelLab (cleaner for multi-frame walks than SpriteCook drift). If Dr. Vey isn't already a PixelLab character, `create_character` once from the existing `south.png` first. Then:
- `animate_character` with `walking-6-frames` template, direction=`north`
- `animate_character` with `walking-6-frames` template, direction=`east`

Cost: 1 gen per template animation. ~2 gens total (plus the character creation if needed).

Output:
- `public/assets/sprites/npcs/drvey/anim/worldwalk-north/frame_{000..005}.png`
- `public/assets/sprites/npcs/drvey/anim/worldwalk-east/frame_{000..005}.png`

Preload in `BootScene` as `drvey-worldwalk-north-000..005` and `drvey-worldwalk-east-000..005`. Register anim keys in `RelayCutsceneScene` (6 frames, 8 fps, repeat=-1 for both).

**3b. Custom "activate" animation** — for Beat 3.

A 3–4 frame animation of Dr. Vey reaching forward and pressing a console panel. Side/east-facing (since Beat 2 ends with them walking east into the doorway, they should be facing the console on the right).

Route via PixelLab `animate_character` with a custom prompt (not a template, since there's no "operate console" template). Cost: ~20 gens for custom animation, takes longer than template but needed here — the activation is the emotional payoff beat and deserves proper animation rather than a scale-pop cheat.

**PixelLab custom prompt** (paste into `animate_character` with direction=`east`):
> Dr. Vey, a field scientist in a utility jacket, stands facing right at a wall-mounted control console. They reach their right arm forward toward the console panel, fingers spreading as they press a button. Their body leans slightly forward with focus. 4 frames, smooth arm extension, subtle head-tilt toward the panel.

Output: `public/assets/sprites/npcs/drvey/anim/activate-east/frame_{000..003}.png`

Preload as `drvey-activate-east-000..003`. Register anim `drvey-activate-east` in `RelayCutsceneScene` (4 frames, 10 fps, repeat=0).

If PixelLab drift produces unusable frames, **fallback**: skip the custom anim and do a scale-pop (`playCastTween`-style) on the static `drvey-east` sprite, plus the camera shake + beacon pulse. Emotionally weaker but ships.

### 5. Dr. Vey animations — re-numbered (now item 5)

Same as previously documented — north walk, east walk, custom activate-east. See subsections 3a + 3b of the earlier version (renumber when we get here; not reproducing here to keep the doc concise).

### 6. Broadcast ping SFX (new)

Generator: ElevenLabs `text_to_sound_effects`.

**Prompt**:
> A single soft electronic broadcast ping — a clean sine-wave chirp rising half an octave, followed by a low reverb tail suggesting distance and open signal. Retro sci-fi computer feel, sparse, hopeful, 1.2 seconds total.

Save as `public/assets/audio/sfx/relay-broadcast.mp3`, preload as `sfx-relay-broadcast`.

### 7. Victory music (new — external via Suno)

See the Audio section above for the full Suno prompt and file path. Saved as `public/assets/audio/music/victory.mp3`, preloaded as `music-victory`. Drives both the cutscene and the subsequent `RunCompleteScene`.

### 6. Reuse (no generation needed)

- Wreckwarden SHOCKWAVE sprite animation — tinted amber for the beacon pulse in Beat 3
- Party `worldwalk-north` frames — already preloaded for Lobby (all 5 classes have them)
- Party `worldwalk-east` frames — Vanguard + Medic native; Netrunner/Scavenger/Cybermonk fall back to `worldwalk-west` + `flipX`
- Party `<class>-south.png` static rotations — already preloaded for Lobby, available if we need any "face the camera" holds during Beat 3
- `playMusicPool` no-op-when-already-playing logic — carries the victory track seamlessly from Cutscene → RunComplete

---

## File checklist

Files changed or created:

- `src/scenes/RelayCutsceneScene.ts` *(new)*
- `src/scenes/JourneyScene.ts` *(route run-complete handoff to the new scene)*
- `src/scenes/BootScene.ts` *(preload the new bg, Dr. Vey walk frames, broadcast SFX)*
- `src/main.ts` *(register the new scene in the scene list)*
- `public/assets/backgrounds/cutscene/relay-hilltop-wide.webp` *(new asset — Beat 1)*
- `public/assets/backgrounds/cutscene/relay-entrance.webp` *(new asset — Beat 2+3)*
- `public/assets/sprites/npcs/drvey/anim/worldwalk-north/frame_000.png` … `frame_005.png` *(new assets — Beat 1)*
- `public/assets/sprites/npcs/drvey/anim/worldwalk-east/frame_000.png` … `frame_005.png` *(new assets — Beat 2)*
- `public/assets/sprites/npcs/drvey/anim/activate-east/frame_000.png` … `frame_003.png` *(new assets — Beat 3 custom animation)*
- `public/assets/audio/sfx/relay-broadcast.mp3` *(new asset)*
- `public/assets/audio/music/victory.mp3` *(new asset — Suno external)*
- `src/scenes/RunCompleteScene.ts` *(remove the `stopAllMusic` call in `create()` so the cutscene's victory track carries through)*

---

## Build order

1. **Generate wide background (Beat 1)** — SpriteCook 3 variants, user picks one, install.
2. **Generate close-up background (Beat 2)** — SpriteCook 3 variants, user picks one, install.
3. **Generate Dr. Vey walks** — PixelLab `create_character` if needed, then `animate_character` template for `north` + `east`. Extract frames, install.
4. **Generate Dr. Vey custom activation anim (Beat 3)** — PixelLab `animate_character` custom prompt (east-facing). Extract frames, install. If unusable, flag fallback.
5. **Generate broadcast-ping SFX** — ElevenLabs one-shot.
6. **Generate victory music** — Suno prompt (user-driven, external). Install once they pick a take.
7. **Scaffold `RelayCutsceneScene`** — preload everything, render Beat 1 bg, place party + VIP sprites statically at their Beat 1 start positions. Verify positioning.
8. **Wire Beat 1** — stagger-start north tweens + `worldwalk-north` anim per unit. Transition trigger when all walkers reach stop_y.
9. **Wire Beat 2** — crossfade bg, respawn sprites on the left edge of the close-up, tween rightward with `worldwalk-east` (with flipX fallback). Transition trigger when Dr. Vey reaches the console.
10. **Wire Beat 3** — swap Dr. Vey to `drvey-activate-east` anim, camera shake on press, spawn + amber-tint SHOCKWAVE sprite at the beacon location, play broadcast-ping SFX, hold ~1.5s.
11. **Wire skip + fade + RunComplete handoff** — any keydown / pointerdown triggers a 200ms fade → `RunComplete`.
12. **Update `JourneyScene.transitionToNext`** — route run-complete → `'RelayCutscene'` instead of `'RunComplete'`.
13. **Remove `stopAllMusic` from `RunCompleteScene.create()`** — so the cutscene's `music-victory` carries through.
14. **Playtest** — full run on Direct Line (fastest path to victory), tune pacing numbers + formation offsets.
15. **Document in CLAUDE.md** — short entry under the scene flow diagram (add `RelayCutscene` to the flow).

Each step is independently testable. Steps 4–8 are pure code; 1–3 are asset-generation only.

---

## Open questions

- **Formation ground-line**: wait until the background is picked to nail the `formation_y` so sprite feet land on the path and not floating over the horizon or clipped into the hillside.
- **Dr. Vey's 4-direction walk or just east?** Recommendation: east only for now. If they get added as a Greenhouse patroller later, generate the other 3 then.
- **Pacing**: numbers above (2.5s + 2s + 1s) are a starting point. Adjust after first playtest.
- **Title card / on-screen text?** Currently none — purely visual. Could add a final "THE SIGNAL IS OUT" fade-in text over the hold if the moment needs more weight, but start without it.


---
  Beat 2 — exterior closeup, door on right edge, party walks in (revised):                 
                                                                                           
  ▎ Classic SNES JRPG cutscene background, 16-bit pixel art, side-on closeup view at ground
  ▎  level. This is a continuation of the same fortified relay base shown in the reference 
  ▎ asset — now zoomed in tight on the bunker's entrance. Match the bunker design, palette,
  ▎  color grading, and weathering style from the reference asset. The dark steel lattice  
  ▎ radio relay tower rises up out of the top of the frame — only the lower portion of its 
  ▎ lattice is visible, cropped by the top edge of the image, establishing that the bunker 
  ▎ sits at the tower's base. The same weathered concrete bunker from the reference fills
  ▎ the right side of the frame, side-on: boxy pre-fall construction with patched repairs,
  ▎ dark corrugated metal roof, one small glowing yellow window. A heavy riveted steel
  ▎ entrance door on the RIGHT EDGE of the frame, centered vertically — fully closed, dark
  ▎ metal — framed as a clear walk-in target for sprites entering from the left. Thick
  ▎ cable conduits run from the tower down and into the bunker's roof. A low section of the
  ▎  scavenged scrap-metal perimeter wall is visible in the background to the left. Packed
  ▎ dirt and gravel ground extending as a wide flat band across the middle of the frame —
  ▎ leaving plenty of open horizontal space on the left for sprites to walk along from left
  ▎  to right toward the door. Hazy dusk sky visible above and behind the tower, warm
  ▎ purple-orange with thin ashen clouds. Muted faded palette, matching the reference.
  ▎ Empty stage, no characters.

  Reference asset: f3e29e4a-0547-4f03-add1-467e77fa39ae (Beat 1 bg).                       
                                                                                
  Change from the prior Beat 2 draft: removed the exterior console + the "slightly ajar    
  with warm light" detail — door is now a clean, closed walk-in target because activation  
  happens inside.                           
                                                                                           
  ---                                                                                    
  Beat 3 — interior shot (new):                                                          
                                                                                           
  ▎ Classic SNES JRPG cutscene background, 16-bit pixel art, side-on interior shot of a 
  ▎ cramped concrete broadcast control room inside the relay bunker. Warm yellow           
  ▎ incandescent lighting — matching the yellow window glow seen from outside. Wall-mounted
  ▎  bank of decades-old analog broadcast equipment fills the right side of the frame: 
  ▎ racks of dials, gauges, switches, patched-in wiring bundles, tape reels, cooling vents.
  ▎  At the center-right, a single large chunky red activation lever / push-button mounted 
  ▎ on a metal console face at waist-height — clearly the interactive target. Exposed cable
  ▎  conduits and a few hanging utility lights above. The floor is packed concrete with    
  ▎ visible scuffs from decades of use. Left side of the frame leaves open floor space for 
  ▎ party sprites to stand. The wall to the far left has a closed steel door (the one they 
  ▎ just entered through). Muted palette with warm amber highlights from the lighting, dark
  ▎  shadows in the corners. Empty stage, no characters. 16-bit FF6 / Chrono Trigger
  ▎ interior aesthetic.


    Beat 4 prompt (overworld close-up of the tower, camera pans to beacon):
                                                                                           
  ▎ Classic SNES JRPG cutscene background, 16-bit pixel art. A tight side-on close-up of 
  ▎ the dark steel lattice radio relay tower from the reference asset — the tower fills the
  ▎  vertical center of the frame from bottom to top, occupying most of the image's height,
  ▎  positioned so there's clear sky visible above the beacon at the top and open ground 
  ▎ visible at the base at the bottom. Tower design matches the reference: clean dark steel
  ▎  lattice with visible cross-bracing, two circular microwave dishes mounted on the mast 
  ▎ at different heights, a thin antenna rod at the peak capped by a glowing red beacon    
  ▎ light. Decades-old infrastructure, still standing. At the base of the tower: the top of
  ▎  the weathered concrete bunker building visible in the lower-right corner of the frame
  ▎ (same bunker design as the reference), with cable conduits running from the tower down
  ▎ into its roof — just enough to establish continuity, not the focus. The landscape is an
  ▎  overgrown hilltop — faded yellow-green grass, clumps of weeds, weathered stone
  ▎ outcroppings. The tower is the clear hero of the shot — centered, dominant, occupying
  ▎ nearly the full vertical extent of the image. Hazy dusk sky filling the area behind and
  ▎  around the tower, warm purple-orange with thin ashen clouds, the red beacon at the
  ▎ peak glowing against the sky. Muted faded palette. Empty stage, no characters.

  Reference asset: c77a01dc-b4a0-410e-8cce-166175cfe65f (relay-v2-B icon — so the tower
  design stays canonical for the capstone shot).