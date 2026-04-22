import * as Phaser from 'phaser';
import { getRun, startRun } from '../state/run';
import { FONT } from '../util/ui';
import { log } from '../util/logger';
import { ROUTES } from '../data/routes';
import { playSfx } from '../util/audio';
import { playMusicPool } from '../util/music';

/**
 * Victory cutscene played after the final encounter clears and before
 * RunCompleteScene. See VICTORY_CUTSCENE_PLAN.md for the full 4-beat plan.
 *
 * This scaffold implements only Beats 1 + 2 so we can playtest pacing before
 * generating the Beat 3 (console close-up) and Beat 4 (tower pan) assets.
 * Beats 3 + 4 are placeholder-fadeout to RunComplete for now.
 *
 * Test-trigger from TitleScene by pressing `V` (see `TEST_TRIGGER_HOTKEY`
 * registered in TitleScene). Also invokable at run-time by JourneyScene when
 * the run completes — wiring for that happens once the cutscene is complete.
 */

type BeatState =
  | 'beat1-approach'
  | 'beat2-enter-exit'
  | 'beat3-activation'
  | 'beat4-beacon'
  | 'done';

// --- Beat 1 (wide, walking north) positioning ---
const B1_PATH_CENTER_X = 640;
const B1_START_Y = 800; // off the bottom edge
// Stop before the scrap-metal perimeter wall on the wide bg (don't walk
// past/onto it). 460 brings the party higher up the hillside so they arrive
// right at the base of the bunker/tower instead of halting mid-path.
const B1_STOP_Y = 460;
const B1_WALK_MS = 3000;
// Hold time AFTER the party stops walking in Beat 1, before cutting to Beat 2.
// Long enough to sell "we made it" before the close-up.
const B1_ARRIVAL_HOLD_MS = 300;

// --- Beat 2 (medium, walking east) positioning ---
// Ground line on the close-up bg — tune so sprite feet sit on the dirt,
// not floating above or sunk below.
const B2_GROUND_Y = 450;
const B2_DOOR_X = 1100; // door x on the zoomed-out bg v3 (bunker at right side)
const B2_LEADER_STOP_X = 900;
const B2_PARTY_SPREAD_X = 54;
const B2_VEY_EXIT_DIST = 70; // how far west Dr. Vey walks out of the bunker

// --- Beat 3 (close-up of Dr. Vey at the wall-mounted console) ---
// Dr. Vey stands in front of the wall-mounted broadcast console with her
// back to the camera (north-facing static sprite) "pulling the lever."
// Two bgs swap at the activation moment: lever-up (pre) → lever-down (post).
const B3_VEY_X = 640;
const B3_VEY_Y = 520;
const B3_SCALE_MULT = 3.6;
// Timing: appear at the console → arm-raise anim plays at normal speed →
// bg swap on activation (hands hit the lever) → hold → finish.
const B3_SHAKE_MS = 180;
const B3_POST_PULL_HOLD_MS = 2500;
const B3_ACTIVATE_FRAME_COUNT = 9;
const B3_ACTIVATE_FPS = 9; // full 9-frame arm-raise cycle runs in ~1s

// --- Beat 4 (tower close-up, camera pan up to beacon + blink) ---
// Camera zoom level — pulls the viewport in so we see the lower half at
// start and the upper half after the pan. 1.8× keeps sprite-sized detail
// readable without over-softening the 1280×720 bg.
const B4_CAMERA_ZOOM = 1.8;
// Y coordinates the camera centers on, clamped so the viewport never
// exposes black outside the 1280×720 bg. At zoom 1.8 the view is 400px
// tall — center Y must stay in [200, 520] to keep the view inside the bg.
const B4_CAMERA_START_Y = 520;
const B4_CAMERA_END_Y = 210;
const B4_CAMERA_X = 640;
const B4_PAN_MS = 2400;
// Blink cadence matches the title screen (TitleScene BLINK_ON_MS / BLINK_OFF_MS):
// beacon ON 900ms, flashes OFF 220ms, ON 900ms, flashes OFF, etc.
const B4_BLINK_CYCLES = 3;
const B4_BLINK_ON_MS = 900; // matches TitleScene
const B4_BLINK_OFF_MS = 220; // matches TitleScene
const B4_FINAL_HOLD_MS = 800; // hold on the final ON frame before fading out
// Pixels-per-millisecond walk speed — derived from "party walks across
// the bg in 7s." All Beat 2 walkers use this same speed, so Dr. Vey
// (who travels further to reach the door) arrives later without ever
// appearing faster or slower than the rest of the party.
const B2_WALK_PX_PER_MS = 0.15;
const B2_VEY_FADE_MS = 700;
const B2_INSIDE_PAUSE_MS = 1400;

// Shared
const BEAT_FADE_MS = 280;
// Base frame rate for walk anims at registration time. Actual playback
// rate is scaled per-walker via `sprite.anims.timeScale` based on the
// tween's pixels-per-millisecond speed, so feet move at a rate matching
// on-screen travel (no skating / sliding when tween speed changes).
const WALK_ANIM_FPS = 8;
// Reference walk speed (px/ms) at which `WALK_ANIM_FPS` feels natural.
// Faster tweens scale the anim up proportionally; slower scales down.
const WALK_REFERENCE_SPEED_PX_PER_MS = 0.1;

/**
 * Per-class sprite dimensions measured from the actual worldwalk-north
 * frame 000 bbox (PIL getbbox). Used to normalize display height AND
 * position the sprite's feet on the ground line (origin y = content
 * bottom / canvas height), regardless of the empty canvas padding below
 * the character.
 *
 *   baseScale: content height / reference height (Scavenger's 53px = 1.0)
 *   originY:   content-bottom-y / canvas-height
 *
 * Measurements (from PIL bbox on worldwalk-north/frame_000.png):
 *   vanguard  : canvas 136, bbox (53,39,83,102), content_h=63
 *   medic     : canvas 104, bbox (40,25,62, 76), content_h=51
 *   scavenger : canvas  68, bbox (25, 7,43, 60), content_h=53
 *   netrunner : canvas  68, bbox (25, 9,42, 57), content_h=48
 *   cybermonk : canvas  68, bbox (26, 7,43, 56), content_h=49
 *   drvey     : canvas  68, bbox (24, 8,44, 57), content_h=49
 */
interface SpriteDims {
  baseScale: number;
  originY: number;
}
const SPRITE_DIMS: Record<string, SpriteDims> = {
  vanguard: { baseScale: 0.84, originY: 0.75 }, // 53/63, 102/136
  medic: { baseScale: 1.04, originY: 0.73 }, // 53/51, 76/104
  scavenger: { baseScale: 1.0, originY: 0.88 }, // 53/53, 60/68
  netrunner: { baseScale: 1.1, originY: 0.84 }, // 53/48, 57/68
  cybermonk: { baseScale: 1.08, originY: 0.82 }, // 53/49, 56/68
  drvey: { baseScale: 1.08, originY: 0.84 }, // 53/49, 57/68
};
const DEFAULT_DIMS: SpriteDims = { baseScale: 1.0, originY: 0.85 };

/**
 * Per-beat global multiplier on top of the per-class normalization.
 * Beat 1 is a distant overview — smaller sprites. Beat 2 is a closer
 * medium shot — sprites need to read as human-sized next to the bunker.
 */
const BEAT1_SCALE_MULT = 1.6;
const BEAT2_SCALE_MULT = 2.2;

function dimsFor(classKey: string): SpriteDims {
  return SPRITE_DIMS[classKey] ?? DEFAULT_DIMS;
}
function cutsceneScale(classKey: string, beatMult: number): number {
  return dimsFor(classKey).baseScale * beatMult;
}

/** Per-class frame counts for worldwalk animations (matches BootScene's declaration). */
const WORLDWALK_FRAMES: Record<
  string,
  Partial<Record<'south' | 'north' | 'east' | 'west', number>>
> = {
  vanguard: { south: 4, north: 6, east: 4 },
  medic: { south: 6, north: 6, east: 6, west: 6 },
  scavenger: { south: 6, north: 6, west: 6 },
  netrunner: { south: 6, north: 6, west: 6 },
  cybermonk: { south: 6, north: 6, west: 6 },
  drvey: { south: 6, north: 6, west: 6 }, // east derived from west + flipX
};

interface Walker {
  sprite: Phaser.GameObjects.Sprite;
  classKey: string;
}

export class RelayCutsceneScene extends Phaser.Scene {
  private state: BeatState = 'beat1-approach';
  private walkers: Walker[] = [];
  private bgImage?: Phaser.GameObjects.Image;
  private skipArmed = true;
  // Beat 3's Dr. Vey console sprite — tracked so we can tear it down on
  // the Beat 3 → Beat 4 transition (otherwise it persists into Beat 4
  // and renders "huge" under that beat's 1.8× camera zoom).
  private b3VeySprite?: Phaser.GameObjects.Sprite;

  constructor() {
    super('RelayCutscene');
  }

  /**
   * Deferred from BootScene — cutscene-only assets (6 backgrounds +
   * 3 SFX) don't need to block the initial title-screen boot. Phaser
   * caches loaded assets, so re-entry doesn't refetch.
   */
  preload(): void {
    this.load.image(
      'cutscene-relay-hilltop-wide',
      'assets/backgrounds/cutscene/relay-hilltop-wide.webp',
    );
    this.load.image(
      'cutscene-relay-entrance-medium',
      'assets/backgrounds/cutscene/relay-entrance-medium.webp',
    );
    this.load.image(
      'cutscene-relay-console-lever-up',
      'assets/backgrounds/cutscene/relay-console-lever-up.webp',
    );
    this.load.image(
      'cutscene-relay-console-lever-down',
      'assets/backgrounds/cutscene/relay-console-lever-down.webp',
    );
    this.load.image('cutscene-relay-tower-on', 'assets/backgrounds/cutscene/relay-tower-on.webp');
    this.load.image('cutscene-relay-tower-off', 'assets/backgrounds/cutscene/relay-tower-off.webp');
    this.load.audio('sfx-relay-lever', 'assets/audio/sfx/relay-lever.mp3');
    this.load.audio('sfx-relay-broadcast', 'assets/audio/sfx/relay-broadcast.mp3');
    this.load.audio('sfx-relay-beacon-blink', 'assets/audio/sfx/relay-beacon-blink.mp3');
  }

  create(): void {
    log('SCENE', 'RelayCutscene created');
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#000000');

    // Reprise the main title theme for the whole victory cutscene + the
    // RunComplete screen that follows. `playMusicPool` no-ops if the track
    // is already playing, so the handoff into RunCompleteScene is seamless.
    playMusicPool(this, ['music-main-theme'], 0.35);

    this.registerWorldwalkAnims();

    // Skip handler — fade out to RunComplete. Keyboard: E / ENTER / SPACE
    // (all standard confirm keys). Touch: any tap anywhere on the scene
    // (touch devices have no hover cursor and expect tap-to-skip). Desktop:
    // only the on-screen SKIP button is clickable — a stray mouse click on
    // the cutscene content shouldn't cancel it.
    //
    // Guards against double-fire from rapid key/tap presses OR from the
    // natural Beat 4 → finish() path coinciding with a user skip:
    //   - `skipArmed` flag is flipped on first fire; subsequent calls no-op
    //   - keyboard + pointer listeners are explicitly detached on first fire
    //     so no stale events can retrigger even hypothetically
    //   - finish() itself has a `state === 'done'` early-return so even if
    //     something slipped past these guards, we'd hand off to RunComplete
    //     at most once.
    const isTouchDevice = this.sys.game.device.input.touch && !this.sys.game.device.os.desktop;
    const skip = (): void => {
      if (!this.skipArmed) return;
      this.skipArmed = false;
      // Explicitly detach every skip listener so no later event can re-fire.
      this.input.keyboard?.off('keydown-E', skip);
      this.input.keyboard?.off('keydown-ENTER', skip);
      this.input.keyboard?.off('keydown-SPACE', skip);
      if (isTouchDevice) this.input.off('pointerdown', skip);
      // Delegate to finish() — it does its own fadeOut → camera reset →
      // scene.start('RunComplete'). Chaining a second fadeOut here would
      // cause a visible "flash back" between two fades.
      this.finish();
    };
    this.input.keyboard?.on('keydown-E', skip);
    this.input.keyboard?.on('keydown-ENTER', skip);
    this.input.keyboard?.on('keydown-SPACE', skip);
    if (isTouchDevice) {
      this.input.on('pointerdown', skip);
    }

    // On-screen skip hint — readable as a pressable button. Label is
    // platform-aware: touch devices see "[TAP] SKIP", desktop sees "[E] SKIP".
    // Positioned bottom-center. Button `once` so a rapid double-click can't
    // fire skip twice.
    const skipLabel = isTouchDevice ? '[TAP] SKIP' : '[E] SKIP';
    const skipBtn = this.add
      .text(width / 2, height - 30, skipLabel, {
        fontFamily: FONT,
        fontSize: '18px',
        color: '#e6e6e6',
        backgroundColor: '#1a1a1acc',
        stroke: '#000000',
        strokeThickness: 3,
        padding: { x: 18, y: 10 },
        align: 'center',
      })
      .setOrigin(0.5, 1)
      .setDepth(100000)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    skipBtn.once('pointerdown', skip);
    skipBtn.on('pointerover', () => skipBtn.setColor('#8aff8a'));
    skipBtn.on('pointerout', () => skipBtn.setColor('#e6e6e6'));

    // Kick off Beat 1.
    this.cameras.main.fadeIn(BEAT_FADE_MS);
    this.beat1Approach();
  }

  // ---- Beat 1: wide, walk north ------------------------------------------

  private beat1Approach(): void {
    this.state = 'beat1-approach';
    const { width, height } = this.scale;

    // Wide bg filling the viewport.
    this.bgImage = this.add.image(width / 2, height / 2, 'cutscene-relay-hilltop-wide').setDepth(0);
    // Scale to cover the viewport in case the source isn't exactly 1280×720.
    const bgScale = Math.max(width / this.bgImage.width, height / this.bgImage.height);
    this.bgImage.setScale(bgScale);

    const run = getRun();
    // Leader explicitly pulled from `run.leaderId` — not assumed to be
    // `party[0]`. Followers are whatever other class ids are in `party`.
    const leader = run.leaderId;
    const followers = run.party.filter((p) => p !== leader);

    // Spawn slots: leader in front, other two behind flanking, Dr. Vey tucked at rear.
    const slots: Array<{ classKey: string; offsetX: number; offsetY: number }> = [
      { classKey: leader, offsetX: 0, offsetY: 0 }, // leader always in front
      { classKey: followers[0], offsetX: -44, offsetY: 30 },
      { classKey: followers[1], offsetX: 44, offsetY: 30 },
      { classKey: 'drvey', offsetX: 0, offsetY: 60 },
    ];

    this.walkers = slots
      .filter((s) => !!s.classKey)
      .map((s, i) => {
        const texKey = this.initialWorldwalkFrame(s.classKey, 'north');
        const dims = dimsFor(s.classKey);
        const sprite = this.add
          .sprite(B1_PATH_CENTER_X + s.offsetX, B1_START_Y + s.offsetY, texKey)
          .setScale(cutsceneScale(s.classKey, BEAT1_SCALE_MULT))
          .setOrigin(0.5, dims.originY);
        sprite.setDepth(10 + i);
        return { sprite, classKey: s.classKey };
      });

    // Everyone walks together — same start time, same duration, same speed.
    // All walk anims start in the same frame so the group looks cohesive.
    const b1Speed = Math.abs(B1_STOP_Y - B1_START_Y) / B1_WALK_MS;
    this.walkers.forEach((w, i) => {
      this.playWalkAnim(w, 'north', b1Speed);
      const targetY = B1_STOP_Y + (w.sprite.y - B1_START_Y); // preserve y-offsets
      this.tweens.add({
        targets: w.sprite,
        y: targetY,
        duration: B1_WALK_MS,
        ease: 'Linear', // constant speed — no ease-in-out since they walk in unison
        onComplete: () => {
          this.setIdleFacing(w, 'north');
          if (i === this.walkers.length - 1) {
            // Everyone has arrived — hold the group pose for a beat before
            // cutting to Beat 2. Sells "we made it" before the close-up.
            this.time.delayedCall(B1_ARRIVAL_HOLD_MS, () => this.transitionToBeat2());
          }
        },
      });
    });
  }

  // ---- Beat 2: medium, walk east, Vey enters + exits --------------------

  private transitionToBeat2(): void {
    if (this.state !== 'beat1-approach') return;
    this.state = 'beat2-enter-exit';

    // Fade out the Beat 1 stage, swap bg + sprites, fade back in.
    this.cameras.main.fadeOut(BEAT_FADE_MS);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      // Destroy Beat 1 bg + walkers.
      this.bgImage?.destroy();
      this.walkers.forEach((w) => w.sprite.destroy());
      this.walkers = [];

      this.beat2EnterExit();
      this.cameras.main.fadeIn(BEAT_FADE_MS);
    });
  }

  private beat2EnterExit(): void {
    const { width, height } = this.scale;
    this.bgImage = this.add
      .image(width / 2, height / 2, 'cutscene-relay-entrance-medium')
      .setDepth(0);
    const bgScale = Math.max(width / this.bgImage.width, height / this.bgImage.height);
    this.bgImage.setScale(bgScale);

    const run = getRun();
    // Leader pulled from `run.leaderId` — not assumed to be `party[0]`.
    const leader = run.leaderId;
    const followers = run.party.filter((p) => p !== leader);

    // Starting positions off-screen left, staggered horizontally + slightly y-offset.
    // Leader in front, #2 and #3 trail behind at distinct x positions (NOT
    // stacked on top of each other) so both of their faces/profiles are
    // visible — not hidden behind each other. Dr. Vey trailing at the back.
    const slots: Array<{ classKey: string; startX: number; startY: number; stopX: number }> = [
      { classKey: leader, startX: -80, startY: B2_GROUND_Y, stopX: B2_LEADER_STOP_X },
      {
        classKey: followers[0],
        startX: -150,
        startY: B2_GROUND_Y - 6,
        stopX: B2_LEADER_STOP_X - B2_PARTY_SPREAD_X,
      },
      {
        classKey: followers[1],
        startX: -220,
        startY: B2_GROUND_Y + 6,
        stopX: B2_LEADER_STOP_X - 2 * B2_PARTY_SPREAD_X,
      },
      { classKey: 'drvey', startX: -290, startY: B2_GROUND_Y, stopX: B2_DOOR_X }, // Vey continues to the door
    ];

    this.walkers = slots
      .filter((s) => !!s.classKey)
      .map((s, i) => {
        const texKey = this.initialWorldwalkFrame(s.classKey, 'east');
        const dims = dimsFor(s.classKey);
        const sprite = this.add
          .sprite(s.startX, s.startY, texKey)
          .setScale(cutsceneScale(s.classKey, BEAT2_SCALE_MULT))
          .setOrigin(0.5, dims.originY);
        sprite.setDepth(10 + i);
        // Classes without a dedicated east anim (netrunner, scavenger, cybermonk)
        // use worldwalk-west + flipX.
        const hasEast = this.anims.exists(`${s.classKey}-worldwalk-east`);
        if (!hasEast) sprite.setFlipX(true);
        return { sprite, classKey: s.classKey };
      });

    // Everyone walks together at the same ground speed. Dr. Vey's stop
    // position is further east (at the door), so they just take longer to
    // arrive — no stagger, no speed difference.
    this.walkers.forEach((w, i) => {
      const slot = slots[i];
      const distance = slot.stopX - slot.startX;
      const duration = distance / B2_WALK_PX_PER_MS;
      this.playWalkAnim(w, 'east', B2_WALK_PX_PER_MS);
      this.tweens.add({
        targets: w.sprite,
        x: slot.stopX,
        duration,
        ease: 'Linear',
        onComplete: () => {
          this.setIdleFacing(w, 'east');
          if (w.classKey === 'drvey') {
            this.doVeyEnterExit(w);
          }
        },
      });
    });
  }

  private doVeyEnterExit(vey: Walker): void {
    // Fade out at the doorway — Dr. Vey is still east-facing here (she
    // arrived mid-east-walk, so her last frame was east). Enters the bunker.
    this.tweens.add({
      targets: vey.sprite,
      alpha: 0,
      duration: B2_VEY_FADE_MS,
      onComplete: () => {
        // While invisible (alpha 0), swap her sprite to the WEST-facing idle
        // so when she fades back in she's already facing the opposite way.
        // Per the cutscene rule: no on-screen direction flips — the fade
        // covers the turn-around.
        this.setIdleFacing(vey, 'west');
        this.time.delayedCall(B2_INSIDE_PAUSE_MS, () => {
          // Fade back in facing WEST (just exited the bunker).
          this.tweens.add({
            targets: vey.sprite,
            alpha: 1,
            duration: B2_VEY_FADE_MS,
            onComplete: () => {
              // Take a few steps west to sell "walked out of the bunker."
              this.playWalkAnim(vey, 'west', B2_WALK_PX_PER_MS);
              this.tweens.add({
                targets: vey.sprite,
                x: vey.sprite.x - B2_VEY_EXIT_DIST,
                duration: 1400,
                ease: 'Linear',
                onComplete: () => {
                  this.setIdleFacing(vey, 'west');
                  this.time.delayedCall(800, () => this.transitionToBeat3());
                },
              });
            },
          });
        });
      },
    });
  }

  // ---- Beat 3: close-up of Dr. Vey at the broadcast console --------------

  private transitionToBeat3(): void {
    if (this.state !== 'beat2-enter-exit') return;
    this.state = 'beat3-activation';

    this.cameras.main.fadeOut(BEAT_FADE_MS);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      // Tear down Beat 2's bg + walkers.
      this.bgImage?.destroy();
      this.walkers.forEach((w) => w.sprite.destroy());
      this.walkers = [];

      this.beat3Activation();
      this.cameras.main.fadeIn(BEAT_FADE_MS);
    });
  }

  private beat3Activation(): void {
    const { width, height } = this.scale;

    // Start on the "lever-up" (pre-activation) bg.
    this.bgImage = this.add
      .image(width / 2, height / 2, 'cutscene-relay-console-lever-up')
      .setDepth(0);
    const bgScale = Math.max(width / this.bgImage.width, height / this.bgImage.height);
    this.bgImage.setScale(bgScale);

    // Register the activate-console anim on demand — normal-speed arm-raise.
    const activateKey = 'drvey-activate-north';
    if (!this.anims.exists(activateKey)) {
      const frames = Array.from({ length: B3_ACTIVATE_FRAME_COUNT }, (_, i) => ({
        key: `drvey-activate-north-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: activateKey, frames, frameRate: B3_ACTIVATE_FPS, repeat: 0 });
    }

    // Dr. Vey — back to camera, plays the arm-raise activate anim.
    // Tracked on `this` so we can tear it down when transitioning to Beat 4
    // (otherwise the sprite persists and renders huge under Beat 4's zoom).
    const dims = dimsFor('drvey');
    const vey = this.add
      .sprite(B3_VEY_X, B3_VEY_Y, 'drvey-activate-north-000')
      .setScale(dims.baseScale * B3_SCALE_MULT)
      .setOrigin(0.5, dims.originY)
      .setDepth(10);
    this.b3VeySprite = vey;
    vey.play(activateKey);

    // When the arm-raise anim FINISHES (hands on lever), swap bg to the
    // lever-down state + camera shake to sell the activation moment, and
    // snap sprite back to frame 0 (arms at sides) — reads as "pulled the
    // lever, dropped arms back." Then pause on the lever-down state.
    vey.once('animationcomplete', () => {
      if (this.bgImage) this.bgImage.setTexture('cutscene-relay-console-lever-down');
      this.cameras.main.shake(B3_SHAKE_MS, 0.004);
      playSfx(this, 'sfx-relay-lever', 0.9);
      vey.setTexture('drvey-activate-north-000');
      // Broadcast ping ramps up shortly after the lever clunk — "signal
      // goes out." Bridges into Beat 4's beacon pulse when it's wired.
      this.time.delayedCall(280, () => playSfx(this, 'sfx-relay-broadcast', 0.8));
      this.time.delayedCall(B3_POST_PULL_HOLD_MS, () => this.transitionToBeat4());
    });
  }

  // ---- Beat 4: tower close-up, camera pan up + beacon blink -------------

  private transitionToBeat4(): void {
    if (this.state !== 'beat3-activation') return;
    this.state = 'beat4-beacon';

    this.cameras.main.fadeOut(BEAT_FADE_MS);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      // Tear down Beat 3 bg + Dr. Vey sprite so neither leaks into Beat 4.
      this.bgImage?.destroy();
      this.b3VeySprite?.destroy();
      this.b3VeySprite = undefined;
      // Reset camera zoom/center for the new scene.
      this.cameras.main.setZoom(1);
      this.cameras.main.centerOn(this.scale.width / 2, this.scale.height / 2);

      this.beat4Beacon();
      this.cameras.main.fadeIn(BEAT_FADE_MS);
    });
  }

  private beat4Beacon(): void {
    const { width, height } = this.scale;

    // Bg starts on the "beacon ON" texture at its native 1280×720 size.
    this.bgImage = this.add.image(width / 2, height / 2, 'cutscene-relay-tower-on').setDepth(0);

    // Camera starts zoomed in, centered on the lower half of the tower.
    this.cameras.main.setZoom(B4_CAMERA_ZOOM);
    this.cameras.main.centerOn(B4_CAMERA_X, B4_CAMERA_START_Y);

    // Pan up to the beacon over B4_PAN_MS — the signature "camera climbs
    // the tower" move. Once the pan completes, kick off the blink loop.
    this.cameras.main.pan(
      B4_CAMERA_X,
      B4_CAMERA_END_Y,
      B4_PAN_MS,
      'Sine.easeInOut',
      false,
      (_camera, progress) => {
        if (progress >= 1) this.startBeaconBlink();
      },
    );
  }

  private startBeaconBlink(): void {
    let cyclesLeft = B4_BLINK_CYCLES;
    const doBlink = (): void => {
      if (cyclesLeft <= 0) {
        // Finished blinking — ensure we end on the ON state, hold, then finish.
        if (this.bgImage) this.bgImage.setTexture('cutscene-relay-tower-on');
        this.time.delayedCall(B4_FINAL_HOLD_MS, () => this.finish());
        return;
      }
      cyclesLeft--;
      // OFF flash — swap texture + play the dedicated beacon-blink SFX.
      if (this.bgImage) this.bgImage.setTexture('cutscene-relay-tower-off');
      playSfx(this, 'sfx-relay-beacon-blink', 0.6);
      this.time.delayedCall(B4_BLINK_OFF_MS, () => {
        // Back to ON for the gap before the next blink
        if (this.bgImage) this.bgImage.setTexture('cutscene-relay-tower-on');
        this.time.delayedCall(B4_BLINK_ON_MS, doBlink);
      });
    };
    doBlink();
  }

  // ---- Shared helpers ----------------------------------------------------

  private registerWorldwalkAnims(): void {
    for (const [classKey, dirs] of Object.entries(WORLDWALK_FRAMES)) {
      for (const dir of Object.keys(dirs) as Array<'south' | 'north' | 'east' | 'west'>) {
        const count = dirs[dir] ?? 0;
        if (count === 0) continue;
        const key = `${classKey}-worldwalk-${dir}`;
        if (this.anims.exists(key)) continue;
        const frames = Array.from({ length: count }, (_, i) => ({
          key: `${classKey}-worldwalk-${dir}-${i.toString().padStart(3, '0')}`,
        }));
        this.anims.create({ key, frames, frameRate: WALK_ANIM_FPS, repeat: -1 });
      }
    }
  }

  /**
   * Play a walk anim on a walker. `pxPerMs` is the tween's walking speed;
   * the anim's `timeScale` is set so that legs cycle at a rate matching
   * on-screen travel — faster tweens scale anim speed up proportionally,
   * avoiding the "sliding / skating" look when the anim is too slow for
   * the movement rate.
   */
  private playWalkAnim(
    w: Walker,
    dir: 'south' | 'north' | 'east' | 'west',
    pxPerMs: number = WALK_REFERENCE_SPEED_PX_PER_MS,
  ): void {
    // Cube-root damping — anim speed grows very sub-linearly with travel
    // speed so faster walks don't flutter the legs. A 2× faster walk only
    // moves legs ~1.26× faster, keeping the cadence close to the reference
    // even at the top of the walk-speed range.
    const timeScale = Math.cbrt(pxPerMs / WALK_REFERENCE_SPEED_PX_PER_MS);
    const nativeKey = `${w.classKey}-worldwalk-${dir}`;
    if (this.anims.exists(nativeKey)) {
      w.sprite.setFlipX(false); // reset any flip from a previous direction
      w.sprite.play(nativeKey);
      w.sprite.anims.timeScale = timeScale;
      return;
    }
    // Fallback: east → west + flipX (for classes without native east).
    if (dir === 'east') {
      const westKey = `${w.classKey}-worldwalk-west`;
      if (this.anims.exists(westKey)) {
        w.sprite.setFlipX(true);
        w.sprite.play(westKey);
        w.sprite.anims.timeScale = timeScale;
        return;
      }
    }
  }

  private initialWorldwalkFrame(
    classKey: string,
    dir: 'south' | 'north' | 'east' | 'west',
  ): string {
    const native = `${classKey}-worldwalk-${dir}-000`;
    if (this.textures.exists(native)) return native;
    // Fallback to west frame 0 for classes without a dedicated east.
    if (dir === 'east') {
      const west = `${classKey}-worldwalk-west-000`;
      if (this.textures.exists(west)) return west;
    }
    return `${classKey}-${dir}`; // static rotation
  }

  /**
   * Stop a walker's walk anim and park them in a static idle pose facing
   * `dir`. Correctly handles the east-via-west+flipX fallback for classes
   * without native east rotations (Netrunner, Scavenger, Cybermonk, Dr. Vey)
   * so the sprite never visibly flips when transitioning from walk to idle.
   *
   * For classes with native east (Vanguard world-*, Medic, + Dr. Vey west-only):
   *   - native east rotation exists → clear flipX, use native east static
   *   - east walk uses west+flipX (no native east) → keep flipX=true, use west static
   */
  private setIdleFacing(w: Walker, dir: 'south' | 'north' | 'east' | 'west'): void {
    w.sprite.anims.stop();
    const classKey = w.classKey;

    // Vanguard's 136-canvas world variant has a full 4-dir set.
    if (classKey === 'vanguard') {
      const worldKey = `vanguard-world-${dir}`;
      if (this.textures.exists(worldKey)) {
        w.sprite.setFlipX(false);
        w.sprite.setTexture(worldKey);
        return;
      }
    }

    // If this class walks east via west+flipX (no native worldwalk-east),
    // keep that visual convention for its east idle too: west static + flipX.
    // Avoids a visible flip when swapping walk → idle.
    if (dir === 'east' && !this.anims.exists(`${classKey}-worldwalk-east`)) {
      const westKey = `${classKey}-west`;
      if (this.textures.exists(westKey)) {
        w.sprite.setFlipX(true);
        w.sprite.setTexture(westKey);
        return;
      }
    }

    // Default path: use the native static rotation with flipX reset.
    const rotation = `${classKey}-${dir}`;
    if (this.textures.exists(rotation)) {
      w.sprite.setFlipX(false);
      w.sprite.setTexture(rotation);
      return;
    }

    // Last resort: freeze on walk frame 0.
    w.sprite.setTexture(this.initialWorldwalkFrame(classKey, dir));
  }

  /** Exit handler — fade out → RunComplete. */
  private finish(): void {
    if (this.state === 'done') return;
    this.state = 'done';
    // Fade out FIRST, then reset the camera zoom — otherwise resetting zoom
    // before the fade finishes shows a visible "zoom out" pop during the
    // fadeout (bad). The zoom reset only needs to happen for the next
    // scene's benefit, and can happen under the black fadeout cover.
    this.cameras.main.fadeOut(300);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.cameras.main.setZoom(1);
      this.cameras.main.centerOn(this.scale.width / 2, this.scale.height / 2);
      this.scene.start('RunComplete', { outcome: 'victory' });
    });
  }

  /**
   * Test-only entry point: set up a minimal run state and start the cutscene.
   * Invoked by the `V` hotkey in TitleScene. The cutscene expects `getRun()`
   * to return a populated RunState so it knows which party members to walk.
   */
  static startTest(scene: Phaser.Scene): void {
    const testRoute = ROUTES.find((r) => r.id === 'long-highway') ?? ROUTES[0];
    startRun(testRoute, ['vanguard', 'medic', 'scavenger'], 'vanguard');
    scene.scene.start('RelayCutscene');
  }
}
