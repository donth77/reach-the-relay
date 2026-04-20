import * as Phaser from 'phaser';
import { getRun } from '../state/run';
import { FONT } from '../util/ui';
import { log } from '../util/logger';
import { playMusicPool } from '../util/music';
import { installPauseMenuEsc, isPauseMenuOpen } from '../util/pauseMenu';

const JOURNEY_MUSIC_KEYS = ['music-journey', 'music-journey-alt', 'music-journey-alt2'];
const JOURNEY_MUSIC_VOLUME = 0.25;

// Marker uses head-portrait crops of the existing south sprites (no new assets
// needed). The default crop is tuned for the standard 68×68 humanoid canvas.
// Classes with a different canvas size (Vanguard 96, Medic 104) use per-class
// overrides so their head region crops correctly.
interface HeadCrop {
  x: number;
  y: number;
  w: number;
  h: number;
  canvas: number;
}
const HEAD_CROP_DEFAULT: HeadCrop = { x: 14, y: 4, w: 40, h: 28, canvas: 68 };
const HEAD_CROP_BY_CLASS: Record<string, HeadCrop> = {
  vanguard: { x: 30, y: 20, w: 36, h: 22, canvas: 96 },
  medic: { x: 35, y: 21, w: 34, h: 28, canvas: 104 },
};
function getHeadCrop(classKey: string): HeadCrop {
  return HEAD_CROP_BY_CLASS[classKey] ?? HEAD_CROP_DEFAULT;
}
const PORTRAIT_SCALE = 2.0;
// Compact triangle formation: lead up front, two followers behind flanking.
// Coordinates are offsets from the marker container's center.
const TRIANGLE_POSITIONS = [
  { x: 0, y: -30 }, // slot 0 — lead (front)
  { x: -38, y: 20 }, // slot 1 — back-left
  { x: 38, y: 20 }, // slot 2 — back-right
];
const ESCORT_OFFSET = { x: 0, y: 62 };
const MARKER_TWEEN_MS = 1600;
const FADE_IN_MS = 220;
const FADE_OUT_MS = 220;

// Pool of generic flavor lines if the route doesn't define its own.
const DEFAULT_FLAVOR = [
  'The party presses on toward The Relay.',
  'Another stretch of broken road.',
  'Ash drifts across the path.',
  'They march in silence, watching the treeline.',
];

export class JourneyScene extends Phaser.Scene {
  constructor() {
    super('Journey');
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#0a0a14');
    this.cameras.main.fadeIn(FADE_IN_MS);

    const run = getRun();
    const encounters = run.route.encounters;
    const totalNodes = encounters.length;

    // `run.encounterIndex` was advanced by winEncounter BEFORE this scene started.
    // So destinationIndex is the encounter we're heading TO; justClearedIndex is
    // the one we're coming FROM.
    const destinationIndex = run.encounterIndex;
    const justClearedIndex = Math.max(0, destinationIndex - 1);
    const isRunComplete = destinationIndex >= totalNodes;

    log('SCENE', 'Journey created', {
      route: run.route.id,
      justCleared: justClearedIndex,
      destination: destinationIndex,
      isRunComplete,
    });

    this.manageMusic();

    // --- Route name banner --------------------------------------------------
    this.add
      .text(width / 2, height * 0.22, run.route.name.toUpperCase(), {
        fontFamily: FONT,
        fontSize: '34px',
        color: '#e6e6e6',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height * 0.22 + 40, 'Greenhouse → The Relay', {
        fontFamily: FONT,
        fontSize: '16px',
        color: '#666',
      })
      .setOrigin(0.5);

    // --- Path + nodes -------------------------------------------------------
    const pathY = height * 0.52;
    const pathStartX = width * 0.15;
    const pathEndX = width * 0.85;
    const nodeSpacing = totalNodes > 1 ? (pathEndX - pathStartX) / (totalNodes - 1) : 0;
    const nodePositions = encounters.map((_, i) => ({
      x: totalNodes > 1 ? pathStartX + i * nodeSpacing : (pathStartX + pathEndX) / 2,
      y: pathY,
    }));

    // Main path line
    const graphics = this.add.graphics();
    graphics.lineStyle(2, 0x44556a, 0.9);
    graphics.strokeLineShape(new Phaser.Geom.Line(pathStartX, pathY, pathEndX, pathY));

    // Start / end labels
    this.add
      .text(pathStartX, pathY + 40, 'GREENHOUSE', {
        fontFamily: FONT,
        fontSize: '14px',
        color: '#8aa5cf',
      })
      .setOrigin(0.5, 0);
    this.add
      .text(pathEndX, pathY + 40, 'THE RELAY', {
        fontFamily: FONT,
        fontSize: '14px',
        color: '#f5c97b',
      })
      .setOrigin(0.5, 0);

    // Encounter nodes
    encounters.forEach((_enc, i) => {
      const pos = nodePositions[i];
      const isPast = i < justClearedIndex;
      const isJustCleared = i === justClearedIndex && !isRunComplete;
      const isCurrent = i === destinationIndex;

      let fillColor: number;
      let strokeColor: number;
      if (isCurrent) {
        fillColor = 0x8aff8a;
        strokeColor = 0x4aaa4a;
      } else if (isJustCleared || isPast) {
        fillColor = 0x4a6a4a;
        strokeColor = 0x2a3a2a;
      } else {
        fillColor = 0x2a2a3a;
        strokeColor = 0x555566;
      }

      const radius = isCurrent ? 12 : 8;
      const node = this.add
        .circle(pos.x, pos.y, radius, fillColor, 1)
        .setStrokeStyle(2, strokeColor, 1);

      if (isCurrent) {
        this.tweens.add({
          targets: node,
          scale: 1.35,
          duration: 620,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }

      // Small encounter number below the node
      this.add
        .text(pos.x, pos.y + 18, `${i + 1}`, {
          fontFamily: FONT,
          fontSize: '11px',
          color: isCurrent ? '#8aff8a' : '#666',
        })
        .setOrigin(0.5, 0);
    });

    // Rest-stop markers — placed BETWEEN encounter nodes at the midpoint so
    // it's visually clear that the rest happens on the path between two fights.
    for (const restIdx of run.route.restAfter) {
      const a = nodePositions[restIdx];
      const b = nodePositions[restIdx + 1];
      if (!a || !b) continue;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      this.add
        .text(midX, midY - 22, '⛺', {
          fontFamily: 'monospace',
          fontSize: '20px',
        })
        .setOrigin(0.5);
      this.add
        .text(midX, midY + 16, 'REST', {
          fontFamily: FONT,
          fontSize: '10px',
          color: '#f5c97b',
        })
        .setOrigin(0.5, 0);
    }

    // --- Party marker (three small sprites marching together) ---------------
    const startPos = nodePositions[justClearedIndex];
    const endPos = isRunComplete ? { x: pathEndX, y: pathY } : nodePositions[destinationIndex];

    const markerContainer = this.add.container(startPos.x, startPos.y - 36);
    // Show each party member as a head-portrait in a compact triangle, with
    // the escort (Dr. Vey) tucked below the group. Origin is adjusted so the
    // crop rectangle centers on the sprite's position — per-class crops
    // handle the different canvas sizes (Vanguard 96, Medic 104, others 68).
    const makeHeadSprite = (classKey: string, x: number, y: number) => {
      const spriteKey = `${classKey}-south`;
      if (!this.textures.exists(spriteKey)) return;
      const crop = getHeadCrop(classKey);
      const originX = (crop.x + crop.w / 2) / crop.canvas;
      const originY = (crop.y + crop.h / 2) / crop.canvas;
      const sprite = this.add
        .sprite(x, y, spriteKey)
        .setScale(PORTRAIT_SCALE)
        .setOrigin(originX, originY)
        .setCrop(crop.x, crop.y, crop.w, crop.h);
      markerContainer.add(sprite);
    };

    // Back row first (painted under), then the lead (painted on top — lowest y).
    // Escort added last so she renders above anything she overlaps below.
    for (const slotIdx of [1, 2, 0]) {
      const classKey = run.party[slotIdx];
      if (!classKey) continue;
      const pos = TRIANGLE_POSITIONS[slotIdx];
      makeHeadSprite(classKey, pos.x, pos.y);
    }
    // Escort (Dr. Vey) tucked below the triangle — "party leads, escort follows."
    makeHeadSprite('drvey', ESCORT_OFFSET.x, ESCORT_OFFSET.y);

    // Subtle y-bob on the container so the sprites feel like they're walking.
    this.tweens.add({
      targets: markerContainer,
      y: markerContainer.y - 4,
      duration: 340,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // --- Flavor line --------------------------------------------------------
    const flavorPool = (run.route as { journeyFlavor?: string[] }).journeyFlavor ?? DEFAULT_FLAVOR;
    const flavor = isRunComplete
      ? 'The Relay is in sight.'
      : flavorPool[Math.floor(Math.random() * flavorPool.length)];

    const flavorText = this.add
      .text(width / 2, height * 0.78, flavor, {
        fontFamily: FONT,
        fontSize: '18px',
        color: '#cfe8e8',
        wordWrap: { width: width * 0.7 },
        align: 'center',
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.tweens.add({
      targets: flavorText,
      alpha: 1,
      duration: 260,
      delay: 120,
    });

    // --- Marker tween ------------------------------------------------------
    // After marker arrives we wait for the player to click/tap/press any key
    // to continue rather than auto-transitioning.
    const continueLabel = isRunComplete
      ? '[ Click or press any key to conclude ]'
      : '[ Click or press any key to continue ]';
    const continuePrompt = this.add
      .text(width / 2, height - 40, continueLabel, {
        fontFamily: FONT,
        fontSize: '18px',
        color: '#8aff8a',
        backgroundColor: '#1a2a1a',
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5, 1)
      .setAlpha(0);

    let arrived = false;
    let transitioned = false;

    const showContinuePrompt = () => {
      if (arrived) return;
      arrived = true;
      this.tweens.add({
        targets: continuePrompt,
        alpha: 1,
        duration: 200,
      });
    };

    const markerTween = this.tweens.add({
      targets: markerContainer,
      x: endPos.x,
      duration: MARKER_TWEEN_MS,
      delay: 180,
      ease: 'Sine.easeInOut',
      onComplete: showContinuePrompt,
    });

    // --- Input: any press snaps marker to destination and advances ---------
    const onInput = (event?: KeyboardEvent) => {
      if (transitioned) return;
      if (isPauseMenuOpen()) return;
      // ESC opens the pause menu via the dedicated handler below — don't
      // advance the journey on ESC.
      if (event && event.code === 'Escape') return;
      transitioned = true;
      if (!arrived) {
        // Skip the marker tween: finish it immediately.
        markerTween.stop();
        markerContainer.x = endPos.x;
      }
      this.transitionToNext(justClearedIndex);
    };
    this.input.on('pointerdown', () => {
      if (isPauseMenuOpen()) return;
      onInput();
    });
    this.input.keyboard?.on('keydown', onInput);

    installPauseMenuEsc(this);
  }

  private manageMusic(): void {
    // playMusicPool auto-stops anything outside the pool, and re-picks a new
    // variant every time a track loops.
    playMusicPool(this, JOURNEY_MUSIC_KEYS, JOURNEY_MUSIC_VOLUME);
  }

  private transitionToNext(_justClearedIndex: number): void {
    const run = getRun();
    const cam = this.cameras.main;
    cam.fadeOut(FADE_OUT_MS);
    cam.once('camerafadeoutcomplete', () => {
      if (run.encounterIndex >= run.route.encounters.length) {
        log('SCENE', 'Journey → RunComplete (victory)');
        this.scene.start('RunComplete', { outcome: 'victory' });
      } else {
        log('SCENE', 'Journey → Combat', { next: run.encounterIndex });
        this.scene.start('Combat');
      }
    });
  }
}
