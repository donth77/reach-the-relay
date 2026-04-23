import * as Phaser from 'phaser';
import { getRun } from '../state/run';
import { FONT, isTouchDevice } from '../util/ui';
import { log } from '../util/logger';
import { playMusicPool } from '../util/music';
import { installPauseMenuEsc, isPauseMenuOpen } from '../util/pauseMenu';
import { getPortraitInfo } from '../util/headCrop';
import { ITEMS, ITEM_ORDER } from '../data/items';
import { drawFromBag } from '../util/bag';

const JOURNEY_MUSIC_KEYS = ['music-journey', 'music-journey-alt', 'music-journey-alt2'];
const JOURNEY_MUSIC_VOLUME = 0.25;

// Marker uses head-portrait crops of the existing south sprites (no new assets
// needed). The default crop is tuned for the standard 68×68 humanoid canvas.
// Classes with a different canvas size (Vanguard 96, Medic 104) use per-class
// overrides so their head region crops correctly.
const PORTRAIT_SCALE = 2.0;
// Compact triangle formation: lead up front, two followers behind flanking.
// Coordinates are offsets from the marker container's center.
const TRIANGLE_POSITIONS = [
  { x: 0, y: -30 }, // slot 0 — lead (front)
  { x: -38, y: 20 }, // slot 1 — back-left
  { x: 38, y: 20 }, // slot 2 — back-right
];
const VIP_OFFSET = { x: 0, y: 62 };
const MARKER_TWEEN_MS = 1600;
const FADE_IN_MS = 220;
const FADE_OUT_MS = 220;
// How long the party marker sits on the rest icon before handing off
// to RestScene. Long enough to register as "they stopped to camp,"
// short enough to not feel like filler.
const REST_PAUSE_MS = 900;

// Pool of generic flavor lines if the route doesn't define its own.
const DEFAULT_FLAVOR = [
  'The party presses on toward The Relay.',
  'Another stretch of broken road.',
  'Ash drifts across the path.',
  'They march in silence, watching the treeline.',
];

export class JourneyScene extends Phaser.Scene {
  // True when Journey is being used as the "set out from Greenhouse" intro
  // before the very first combat. In that case the marker walks from the
  // Greenhouse end of the path to encounter node 0 (instead of sitting still
  // because justCleared and destination both resolve to index 0).
  private fromRouteStart = false;
  // True when Journey is being used as the "leaving the rest stop" continuation
  // after a Rest scene. In that case isRestTransition must be forced off — the
  // `restAfter.includes(justCleared)` rule still matches but we've ALREADY
  // done the rest, so the marker should walk from the rest midpoint to the
  // next encounter node and hand off to Combat (not loop back into Rest).
  private fromRest = false;

  constructor() {
    super('Journey');
  }

  init(data?: { fromRouteStart?: boolean; fromRest?: boolean }): void {
    // Explicit defaults — Phaser's scene.start caches settings.data
    // across transitions. Relying on `data?.foo === true` works only
    // if data is freshly passed each time; callers that omit data
    // would otherwise pick up stale flags. We still default to false
    // here AND ensure every caller passes explicit flags.
    this.fromRouteStart = data?.fromRouteStart === true;
    this.fromRest = data?.fromRest === true;
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#0a0a14');
    this.cameras.main.fadeIn(FADE_IN_MS);

    // Nearest-neighbor filter on the rest-tent icon so it stays crisp when
    // scaled (the endpoint icons are pre-filtered at load; this one isn't).

    const run = getRun();
    const encounters = run.route.encounters;
    const totalNodes = encounters.length;

    // `run.encounterIndex` was advanced by winEncounter BEFORE this scene started.
    // So destinationIndex is the encounter we're heading TO; justClearedIndex is
    // the one we're coming FROM.
    const destinationIndex = run.encounterIndex;
    const justClearedIndex = Math.max(0, destinationIndex - 1);
    const isRunComplete = destinationIndex >= totalNodes;
    // If the cleared encounter has a rest-after entry AND there's a
    // next encounter to head to, this journey segment leads into a
    // rest stop — pause the marker on the rest icon, then route to
    // the Rest scene instead of the next Combat. Without this, the
    // Rest scene pops directly after Combat with no travel framing.
    //
    // Two overrides force this OFF:
    //  - fromRest — the rest already happened; this Journey leg is the
    //    "back on the road" half that hands off into Combat.
    //  - fromRouteStart — before encounter 0, the player hasn't cleared
    //    anything yet. Without this guard, Direct Line Variant A
    //    (restAfter=[0]) would trigger a rest transition BEFORE the
    //    first fight because justClearedIndex resolves to 0 at run start.
    const isRestTransition =
      !this.fromRest &&
      !this.fromRouteStart &&
      run.route.restAfter.includes(justClearedIndex) &&
      destinationIndex < totalNodes;

    log('SCENE', 'Journey created', {
      route: run.route.id,
      justCleared: justClearedIndex,
      destination: destinationIndex,
      isRunComplete,
      isRestTransition,
    });

    this.manageMusic();

    // --- Route name banner --------------------------------------------------
    this.add
      .text(width / 2, height * 0.22, run.route.name.toUpperCase(), {
        fontFamily: FONT,
        fontSize: '46px',
        color: '#e6e6e6',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height * 0.22 + 50, 'Greenhouse → The Relay', {
        fontFamily: FONT,
        fontSize: '22px',
        color: '#888',
      })
      .setOrigin(0.5);

    // --- Path + nodes -------------------------------------------------------
    // Greenhouse + Relay sit at the path ends AND participate in the even
    // spacing — the whole row (Greenhouse, encounters + rests, Relay) is
    // spaced equally across the path, so endpoint-to-first-node distance
    // matches node-to-node distance.
    const pathY = height * 0.52;
    const pathStartX = width * 0.08;
    const pathEndX = width * 0.92;

    // Build a waypoint list in traversal order: encounters interleaved with
    // rests when `restAfter` places a rest between two encounters.
    type Waypoint = { kind: 'encounter'; index: number } | { kind: 'rest'; afterIndex: number };
    const waypoints: Waypoint[] = [];
    for (let i = 0; i < totalNodes; i++) {
      waypoints.push({ kind: 'encounter', index: i });
      if (run.route.restAfter.includes(i) && i + 1 < totalNodes) {
        waypoints.push({ kind: 'rest', afterIndex: i });
      }
    }

    // Total slots = Greenhouse + waypoints + Relay. Spacing is derived so
    // every gap is identical regardless of how many waypoints exist.
    const totalSlots = waypoints.length + 2;
    const slotSpacing = totalSlots > 1 ? (pathEndX - pathStartX) / (totalSlots - 1) : 0;

    const encounterPositions: Array<{ x: number; y: number }> = [];
    const restPositions = new Map<number, { x: number; y: number }>(); // keyed by restAfter index
    waypoints.forEach((wp, wi) => {
      const x = pathStartX + (wi + 1) * slotSpacing;
      const pos = { x, y: pathY };
      if (wp.kind === 'encounter') encounterPositions[wp.index] = pos;
      else restPositions.set(wp.afterIndex, pos);
    });

    const greenhousePos = { x: pathStartX, y: pathY };
    const relayPos = { x: pathEndX, y: pathY };
    // Equal-spacing is always on now — kept as a local for the rest-marker
    // render branch below so the rest circle draws underneath the ⛺.
    const useEqualSpacing = true;

    // Main path line
    const graphics = this.add.graphics();
    graphics.lineStyle(2, 0x44556a, 0.9);
    graphics.strokeLineShape(new Phaser.Geom.Line(pathStartX, pathY, pathEndX, pathY));

    // Endpoint markers — small dot on the path to root the label + a larger
    // pixel-art icon floating above it (mirrors how the rest ⛺ icon sits
    // above the rest node).
    this.add.circle(greenhousePos.x, greenhousePos.y, 6, 0x8aa5cf, 1).setStrokeStyle(2, 0x3a5580);
    this.add.circle(relayPos.x, relayPos.y, 6, 0xf5c97b, 1).setStrokeStyle(2, 0x8a6a3a);
    const ENDPOINT_ICON_SCALE = 0.6;
    const ENDPOINT_ICON_Y_OFFSET = 26;
    if (this.textures.exists('journey-icon-greenhouse')) {
      this.add
        .image(greenhousePos.x, greenhousePos.y - ENDPOINT_ICON_Y_OFFSET, 'journey-icon-greenhouse')
        .setOrigin(0.5, 1)
        .setScale(ENDPOINT_ICON_SCALE);
    }
    if (this.textures.exists('journey-icon-relay')) {
      this.add
        .image(relayPos.x, relayPos.y - ENDPOINT_ICON_Y_OFFSET, 'journey-icon-relay')
        .setOrigin(0.5, 1)
        .setScale(ENDPOINT_ICON_SCALE);
    }
    this.add
      .text(pathStartX, pathY + 40, 'GREENHOUSE', {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#8aa5cf',
      })
      .setOrigin(0.5, 0);
    this.add
      .text(pathEndX, pathY + 40, 'THE RELAY', {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#f5c97b',
      })
      .setOrigin(0.5, 0);

    // Encounter nodes
    encounters.forEach((_enc, i) => {
      const pos = encounterPositions[i];
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

      // Encounter number below the node
      this.add
        .text(pos.x, pos.y + 20, `${i + 1}`, {
          fontFamily: FONT,
          fontSize: '18px',
          color: isCurrent ? '#8aff8a' : '#888',
        })
        .setOrigin(0.5, 0);
    });

    // Rest-stop markers. Position comes from `restPositions` — either a true
    // waypoint slot (equal-spacing mode) or a floating midpoint between two
    // encounter nodes (default mode).
    for (const [restIdx, pos] of restPositions) {
      if (!pos) continue;
      // In equal-spacing mode, the rest node is a waypoint like encounters —
      // draw a circle underneath the ⛺ so it reads as a real stop.
      if (useEqualSpacing) {
        this.add.circle(pos.x, pos.y, 7, 0x8a6a3a, 1).setStrokeStyle(2, 0x5a4a2a, 1);
      }
      this.add
        .text(pos.x, pos.y + 18, 'REST', {
          fontFamily: FONT,
          fontSize: '18px',
          color: '#f5c97b',
        })
        .setOrigin(0.5, 0);
      // Suppress the "unused" lint on restIdx — kept because future logic
      // (highlight current rest, etc.) will want it.
      void restIdx;
    }

    // --- Party marker (three small sprites marching together) ---------------
    // Pre-first-encounter: start at the Greenhouse dot, walk to encounter 0.
    // Post-rest: start at the rest waypoint, walk to the next encounter.
    // Otherwise: start at the encounter node we just cleared.
    let startPos: { x: number; y: number };
    if (this.fromRouteStart) {
      startPos = greenhousePos;
    } else if (this.fromRest && destinationIndex < totalNodes) {
      startPos = restPositions.get(justClearedIndex) ?? encounterPositions[justClearedIndex];
    } else {
      startPos = encounterPositions[justClearedIndex];
    }
    // For rest transitions: end at the rest waypoint (between the just-cleared
    // encounter and the next one). Otherwise end at the next encounter node
    // (or the Relay dot for run-complete).
    let endPos: { x: number; y: number };
    if (isRunComplete) {
      endPos = relayPos;
    } else if (isRestTransition) {
      endPos = restPositions.get(justClearedIndex) ?? encounterPositions[destinationIndex];
    } else {
      endPos = encounterPositions[destinationIndex];
    }

    const markerContainer = this.add.container(startPos.x, startPos.y - 36);
    // Show each party member as a head-portrait in a compact triangle, with
    // the VIP (Dr. Vey) tucked below the group. Origin is adjusted so the
    // crop rectangle centers on the sprite's position — per-class crops
    // handle the different canvas sizes (Vanguard 96, Medic 104, others 68).
    const makeHeadSprite = (classKey: string, x: number, y: number) => {
      const { textureKey, crop } = getPortraitInfo(classKey);
      if (!this.textures.exists(textureKey)) return;
      const originX = (crop.x + crop.w / 2) / crop.canvas;
      const originY = (crop.y + crop.h / 2) / crop.canvas;
      const sprite = this.add
        .sprite(x, y, textureKey)
        .setScale(PORTRAIT_SCALE)
        .setOrigin(originX, originY)
        .setCrop(crop.x, crop.y, crop.w, crop.h);
      markerContainer.add(sprite);
    };

    // Back row first (painted under), then the lead (painted on top — lowest y).
    // VIP added last so they render above anything they overlap below.
    for (const slotIdx of [1, 2, 0]) {
      const classKey = run.party[slotIdx];
      if (!classKey) continue;
      const pos = TRIANGLE_POSITIONS[slotIdx];
      makeHeadSprite(classKey, pos.x, pos.y);
    }
    // VIP (Dr. Vey) tucked below the triangle — "party leads, VIP follows."
    makeHeadSprite('drvey', VIP_OFFSET.x, VIP_OFFSET.y);

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
    // Pull from the route's own flavor pool via a grab-bag so consecutive
    // Journey legs on the same route don't repeat a line until the pool
    // cycles. Falls back to DEFAULT_FLAVOR if a route lacks a pool.
    const flavorPool = run.route.journeyFlavor ?? DEFAULT_FLAVOR;
    const flavor = isRunComplete
      ? 'The Relay is in sight.'
      : (drawFromBag(`journey-flavor:${run.route.id}`, flavorPool) ?? flavorPool[0]);

    // Vertically center between the path line (pathY) and the continue prompt
    // (anchored at height - 40). Keeps the flavor line balanced regardless of
    // how many waypoints the path has.
    const continuePromptY = height - 40;
    const flavorY = (pathY + continuePromptY) / 2;
    // Clamp the wrap width so the centered flavor text can't extend into the
    // bottom-left inventory panel's horizontal footprint. `countColumnX + 80`
    // is the approximate right edge of the inventory (count column start +
    // ~80px for the quantity glyph). Adding 30px of padding on each side of
    // that gives the safe half-width; we mirror it on the right for symmetry.
    const inventoryMargin = 24;
    const inventoryRightEdge = inventoryMargin + 200 + 80; // countColumnX + count text width
    const flavorHorizontalPadding = 30;
    const flavorHalfWidth = Math.max(120, width / 2 - inventoryRightEdge - flavorHorizontalPadding);
    const flavorWrapWidth = Math.min(width * 0.7, flavorHalfWidth * 2);
    const flavorText = this.add
      .text(width / 2, flavorY, flavor, {
        fontFamily: FONT,
        fontSize: '24px',
        color: '#cfe8e8',
        wordWrap: { width: flavorWrapWidth },
        align: 'center',
      })
      .setOrigin(0.5)
      .setAlpha(0);
    // If the clamped wrap forces enough lines that the text would still reach
    // down into the inventory panel, lift the block upward until its bottom
    // clears the inventory top by 12px. Horizontal overlap is already
    // prevented by the wrap clamp above.
    const inventoryLineHeight = 26;
    const inventoryRowCount = ITEM_ORDER.length;
    const inventoryTopY = height - inventoryMargin - inventoryRowCount * inventoryLineHeight - 10;
    const flavorBottom = flavorText.y + flavorText.displayHeight / 2;
    if (flavorBottom > inventoryTopY - 12) {
      flavorText.y -= flavorBottom - (inventoryTopY - 12);
    }
    this.tweens.add({
      targets: flavorText,
      alpha: 1,
      duration: 260,
      delay: 120,
    });

    // --- Marker tween ------------------------------------------------------
    // After marker arrives we wait for the player to click/tap/press any key
    // to continue rather than auto-transitioning.
    const touch = isTouchDevice();
    const continueLabel = isRunComplete
      ? touch
        ? '[ Tap to conclude ]'
        : '[ Click or press any key to conclude ]'
      : touch
        ? '[ Tap to continue ]'
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
      // Rest transitions auto-advance into the Rest scene after a brief
      // pause on the rest icon — the marker has "arrived at the camp,"
      // so the next beat is starting the rest, not waiting for input.
      if (isRestTransition) {
        this.time.delayedCall(REST_PAUSE_MS, () => {
          if (transitioned) return;
          transitioned = true;
          this.transitionToNext(justClearedIndex, /* isRest= */ true);
        });
        return;
      }
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
      this.transitionToNext(justClearedIndex, isRestTransition);
    };
    this.input.on(
      'pointerdown',
      (_pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
        if (isPauseMenuOpen()) return;
        // Skip when the tap hit an interactive game object (e.g. the
        // mobile ☰ menu button) — otherwise tapping the menu both
        // opens the pause menu and triggers the "continue" advance.
        if (currentlyOver.length > 0) return;
        onInput();
      },
    );
    this.input.keyboard?.on('keydown', onInput);

    installPauseMenuEsc(this);

    this.renderInventoryPanel();
  }

  /**
   * Bottom-left readout of the shared party inventory. Read-only —
   * JourneyScene doesn't let you use items, just reminds the player what
   * they're carrying into the next fight. Zero-count items render dimmed
   * so the player can see what's available to find vs. currently stocked.
   */
  private renderInventoryPanel(): void {
    const { height } = this.scale;
    const run = getRun();
    const margin = 24;
    const lineHeight = 26;
    const panelBottom = height - margin;

    // Title sits above the list, bottom-up.
    const rowCount = ITEM_ORDER.length;
    const titleY = panelBottom - rowCount * lineHeight - 10;
    this.add
      .text(margin, titleY, 'INVENTORY', {
        fontFamily: FONT,
        fontSize: '17px',
        color: '#8aa5cf',
      })
      .setOrigin(0, 0);

    // Two-column layout so every `×N` aligns vertically regardless of how
    // long the item name is. The count column sits at a fixed offset from
    // the left margin (wide enough for the longest label — "SMOKE GRENADE").
    const countColumnX = margin + 200;
    ITEM_ORDER.forEach((id, i) => {
      const def = ITEMS[id];
      const count = run.inventory[id] ?? 0;
      const y = titleY + 26 + i * lineHeight;
      const dim = count === 0;
      const color = dim ? '#555' : '#cceeff';
      this.add
        .text(margin, y, def.label, { fontFamily: FONT, fontSize: '18px', color })
        .setOrigin(0, 0);
      this.add
        .text(countColumnX, y, `×${count}`, { fontFamily: FONT, fontSize: '18px', color })
        .setOrigin(0, 0);
    });
  }

  private manageMusic(): void {
    // playMusicPool auto-stops anything outside the pool, and re-picks a new
    // variant every time a track loops.
    playMusicPool(this, JOURNEY_MUSIC_KEYS, JOURNEY_MUSIC_VOLUME);
  }

  private transitionToNext(_justClearedIndex: number, isRest: boolean = false): void {
    const run = getRun();
    const cam = this.cameras.main;
    cam.fadeOut(FADE_OUT_MS);
    cam.once('camerafadeoutcomplete', () => {
      if (run.encounterIndex >= run.route.encounters.length) {
        // Victory — route the player into the Relay cutscene before the
        // RunComplete stats screen. The cutscene hands off to RunComplete
        // itself (with `{ outcome: 'victory' }`) after its final beat /
        // whenever the player hits the skip button.
        log('SCENE', 'Journey → RelayCutscene (victory)');
        this.scene.start('RelayCutscene');
      } else if (isRest) {
        log('SCENE', 'Journey → Rest', { nextEncounter: run.encounterIndex });
        this.scene.start('Rest');
      } else {
        log('SCENE', 'Journey → Combat', { next: run.encounterIndex });
        this.scene.start('Combat');
      }
    });
  }
}
