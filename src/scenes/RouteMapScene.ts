import * as Phaser from 'phaser';
import { ROUTES, RouteDef } from '../data/routes';
import { startRun } from '../state/run';
import { FONT, isTouchDevice } from '../util/ui';
import { playSfx } from '../util/audio';
import { installPauseMenuEsc } from '../util/pauseMenu';
import { openBriefing, isBriefingOpen } from '../util/briefingModal';
import { isDebugCollisionOn, onDebugCollisionChange } from '../util/logger';

interface SceneData {
  party?: string[];
}

// Positioning of the highway overlay within the viewport. The source
// asset (`assets/ui/map-highway.png`, 2067×331) is cropped from the
// same coord space as `assets/ui/map-full.png` (2754×1536). These
// constants are the fractional position / size within the full map
// that the highway occupies — tweak if the overlay doesn't line up.
// Starting at (0, 0.5-ish) which is where the highway tends to run
// across the map; user should fine-tune by eye.
// Measured: highway top-left sits at (680, 1216) on the 2754×1536
// native map. Convert to viewport-fractional coords. The -21 on y is a
// ~10 px upward nudge at viewport scale (10 × 1536/720 ≈ 21 native px)
// so the overlay lines up visually with the underlying highway strip.
// Each route overlay is a PNG cropped from the 2754×1536 full map and
// positioned on the RouteMap viewport at the same fractional location
// it occupies in the native map. To add a new route: drop a cropped
// asset in public/assets/ui/, preload it in BootScene, and add an
// entry to ROUTE_OVERLAYS below with the measured native-px top-left
// + the asset's native dimensions + the route id (from ROUTES).
interface RouteOverlayDef {
  routeId: string;
  textureKey: string;
  // Blurred variant — crossfaded in when a DIFFERENT route is focused,
  // so non-focused overlays visually merge with the blurred bg.
  blurTextureKey: string;
  nativeX: number; // top-left x on the 2754×1536 native map
  nativeY: number; // top-left y on the 2754×1536 native map
  nativeW: number; // source asset width
  nativeH: number; // source asset height
  // Where the route-details panel sits relative to the overlay's
  // bounding box when hovered. Kept per-route so routes along the
  // edge of the map can push the panel into open space.
  panelAnchor: 'above' | 'below' | 'left' | 'right';
  // Extra padding between the overlay's bounding box and the panel
  // edge, in viewport pixels. Overrides the default 50 px. Use when a
  // particular overlay has extra visual breathing room already (or
  // needs more — e.g. the mall asset whose art is smaller than its
  // bounding box).
  panelGap?: number;
  // Per-route override for the interactive hit-area padding, in
  // native texture pixels. `number` applies the same padding to all
  // four sides; an object lets each side differ (omit a key to fall
  // back to HIT_AREA_PADDING for that side). Defaults to uniform
  // HIT_AREA_PADDING on every side.
  hitAreaPadding?: number | { top?: number; right?: number; bottom?: number; left?: number };
}
const MAP_NATIVE_W = 2754;
const MAP_NATIVE_H = 1536;
const ROUTE_OVERLAYS: RouteOverlayDef[] = [
  {
    routeId: 'long-highway',
    textureKey: 'ui-map-highway',
    blurTextureKey: 'ui-map-highway-blur',
    // Measured at (680, 1216); -21 on y is a ~10 px upward viewport
    // nudge so the overlay sits flush with the underlying highway.
    nativeX: 680,
    nativeY: 1216 - 21,
    nativeW: 2067,
    nativeH: 331,
    // Highway is near the bottom of the map — put the panel ABOVE it.
    panelAnchor: 'above',
  },
  {
    routeId: 'direct-line',
    textureKey: 'ui-map-substation',
    blurTextureKey: 'ui-map-substation-blur',
    // Measured bottom-right at (1610, 350) → top-left (610, 70) for a
    // 1000×280 substation asset.
    nativeX: 610,
    nativeY: 70,
    nativeW: 1000,
    nativeH: 280,
    // Substation is near the top-left of the map — put the panel to
    // the RIGHT of it so it lands in the clear top-right zone.
    panelAnchor: 'right',
    // Substation asset is smaller than the other routes — expand the
    // hit area so the hover target isn't fiddly.
    hitAreaPadding: 300,
  },
  {
    routeId: 'transit-line',
    textureKey: 'ui-map-mall',
    blurTextureKey: 'ui-map-mall-blur',
    // Measured top-left at (712, 412) on the 2754×1536 native map.
    nativeX: 712,
    nativeY: 412,
    nativeW: 1513,
    nativeH: 789,
    // Mall sits in the middle of the map; left side has the most
    // open space for the info panel.
    panelAnchor: 'left',
    // Negative gap pushes the panel RIGHT into the overlay's
    // bounding box — overlap is OK for this one since the mall's
    // visible art is inset well inside its bounding rect.
    panelGap: -180,
    // Pull the TOP of the hit area down to the image edge (0 px of
    // upward padding) so the mall doesn't steal hover real-estate
    // from the substation sitting above it. Bottom trimmed too so the
    // hit area doesn't extend as far down toward the highway.
    hitAreaPadding: { top: 0, bottom: 30 },
  },
];

// Hover animation: the highway scales up from its center on focus.
// An explicit padded hit area on each overlay prevents the scaled-up
// image from firing pointerout mid-hover (the bug the earlier
// scale-less version worked around).
const HIGHWAY_HOVER_SCALE = 1.08;
const HIGHWAY_HOVER_DURATION_MS = 180;
// Texture-space padding added to each route overlay's interactive hit
// area so the scaled-up image stays within its own hit area. Value is
// in native texture pixels, not display pixels.
const HIT_AREA_PADDING = 120;
// Magenta debug outlines around each overlay's hit area — tied to
// the global DEBUG collision toggle (same HUD button that shows/hides
// the lobby's collision rects). Hidden by default; flip the button to
// see where hover/click will register on this scene.

// Dim overlay alpha levels. Map bg stays crisp and un-darkened at idle
// (DIM_IDLE = 0), then tweens up to DIM_HOVER as the blurred map
// crossfades in. The sharp highway overlay pops against the darkened,
// blurred bg.
const DIM_IDLE = 0;
const DIM_HOVER = 0.4;

export class RouteMapScene extends Phaser.Scene {
  private party: string[] = [];

  constructor() {
    super('RouteMap');
  }

  init(data: SceneData): void {
    this.party = data.party ?? [];
  }

  /**
   * Deferred from BootScene — route-map UI overlays are only used
   * here, so keeping them out of the initial boot path shortens the
   * blank-viewport window (Vibe Jam rule 8: no loading screens).
   * Phaser only downloads an asset once; re-entering RouteMap won't
   * refetch.
   */
  preload(): void {
    this.load.image('lobby-map-full-blur', 'assets/ui/map-full-blur.png');
    this.load.image('ui-map-highway', 'assets/ui/map-highway.png');
    this.load.image('ui-map-substation', 'assets/ui/map-substation.png');
    this.load.image('ui-map-mall', 'assets/ui/map-mall.png');
    this.load.image('ui-map-highway-blur', 'assets/ui/map-highway-blur.png');
    this.load.image('ui-map-substation-blur', 'assets/ui/map-substation-blur.png');
    this.load.image('ui-map-mall-blur', 'assets/ui/map-mall-blur.png');
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#0a0f14');

    // Background: clear map underneath, blurred map stacked on top at
    // alpha 0. On hover we tween the blurred version's alpha up to 1
    // so the bg visibly "pulls focus"; on leave, back to 0. Simpler
    // and more reliable than Phaser's runtime postFX blur, which
    // didn't land in this build.
    this.add.image(width / 2, height / 2, 'lobby-map-full').setDisplaySize(width, height);
    const bgBlurred = this.add
      .image(width / 2, height / 2, 'lobby-map-full-blur')
      .setDisplaySize(width, height)
      .setAlpha(0);
    // Dim overlay — tweens alongside the blur crossfade for a stronger
    // focus shift on hover. Starts at 0 (unmodified bg at idle) since
    // the blur-off state should show the map crisp + un-darkened.
    // Depth stacking on this scene:
    //   0   map bg (crisp + blurred stacked)
    //   2   route overlays (crisp) — baseline
    //   2.5 route overlays (blurred siblings), alpha 0 idle
    //   3   dim overlay — darkens everything below
    //   4   focused route overlay (raised on focus)
    // The raised focused overlay sits ABOVE the dim + blurred siblings,
    // so only the focused route reads as crisp and lit; the others
    // visually merge into the blurred/dimmed bg stack.
    const dimOverlay = this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0)
      .setDepth(3);

    // Title as a compact top-left label. Font/padding kept tight so
    // the title + cycler row below don't reach into the substation
    // overlay's horizontal band (substation bottom-right ≈ x=747 on
    // the 1280px viewport).
    const titleText = this.add
      .text(24, 32, 'CHOOSE YOUR ROUTE', {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#ffffff',
        backgroundColor: '#05141099',
        // Padding on each side drives both the title pill width AND
        // the cycler label width below (which is derived from
        // titleText.width). +3 px per side ≈ +5 px wider pair.
        padding: { x: 22, y: 6 },
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(11);

    // Route details panel — hidden until hover.
    const panel = this.createRouteDetailsPanel();
    panel.container.setVisible(false);

    // Parallel arrays filled as we iterate ROUTE_OVERLAYS. Kept in
    // lockstep so `focusedIdx` can index into all three uniformly (the
    // overlay GameObject, its route definition, and its base scale).
    const validDefs: RouteOverlayDef[] = [];
    const validRoutes: RouteDef[] = [];
    const allOverlays: Phaser.GameObjects.Image[] = [];
    // Blurred siblings, stacked directly above each crisp overlay.
    // Start at alpha 0; fade in to 1 on non-focused routes so they
    // visually match the blurred map bg while the focused route stays
    // crisp.
    const allBlurs: Phaser.GameObjects.Image[] = [];
    const baseScales: { x: number; y: number }[] = [];
    const BASE_DEPTH = 2;
    const BLUR_DEPTH = 2.5;
    const FOCUSED_DEPTH = 4;
    // Scene lands here via scene.start from the PartySelectTerminal's
    // Deploy click, and the cursor is usually still over the Deploy
    // button's former location — which may align with a route overlay.
    // Phaser fires pointerover immediately in that case, making it
    // look like the player has no choice but the pre-highlighted
    // route. Gate by cursor-DISTANCE travelled, not just "did the
    // cursor move" (a single residual pointermove from the click's
    // release motion is enough to trigger the latter). The cursor
    // must move > ARM_DISTANCE_PX from wherever it was at scene-mount
    // before any hover effect activates.
    const ARM_DISTANCE_PX = 15;
    let hoverArmed = false;
    const startX = this.input.activePointer.x;
    const startY = this.input.activePointer.y;
    const armGate = (pointer: Phaser.Input.Pointer) => {
      if (hoverArmed) return;
      const dx = pointer.x - startX;
      const dy = pointer.y - startY;
      if (dx * dx + dy * dy >= ARM_DISTANCE_PX * ARM_DISTANCE_PX) {
        hoverArmed = true;
        this.input.off('pointermove', armGate);
        // If the cursor is already over an overlay at arming time,
        // trigger focus manually — Phaser's pointerover only fires
        // on ENTRY, so a cursor parked on a route when the scene
        // mounted wouldn't re-fire the event just because the gate
        // flipped. Without this, the player has to move OUT of the
        // overlay and back IN to see the hover effect activate.
        const hits = this.input.hitTestPointer(pointer);
        for (let i = 0; i < allOverlays.length; i++) {
          if (hits.indexOf(allOverlays[i]) !== -1) {
            focusOverlay(i);
            break;
          }
        }
      }
    };
    this.input.on('pointermove', armGate);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off('pointermove', armGate);
    });

    // Tracks which route overlay is currently focused. -1 = none.
    // Mouse hover, keyboard cycling, mobile tap, and the cycle arrows
    // all funnel through focusOverlay / unfocusCurrent so the visual
    // state stays consistent across input modes.
    let focusedIdx = -1;

    // The selection-cycle label between the ◀ / ▶ arrows. Declared here
    // so focusOverlay can update it; constructed further down once the
    // left arrow's width is known.
    let selectionLabel: Phaser.GameObjects.Text | null = null;
    const IDLE_LABEL = '— SELECT A ROUTE —';
    const setSelectionLabel = (text: string): void => {
      if (selectionLabel) selectionLabel.setText(text);
    };
    // Debounce the idle-label fallback — when the cursor swaps between
    // overlays, pointerout-then-pointerover fires in back-to-back ticks.
    // Without the debounce the label flickers to "— SELECT A ROUTE —"
    // for one frame before landing on the new route name. 180ms is
    // comfortably longer than any legitimate overlay-to-overlay traverse
    // and shorter than any "the player genuinely stopped hovering"
    // gesture.
    let idleLabelTimer: Phaser.Time.TimerEvent | null = null;
    const cancelIdleLabel = (): void => {
      if (idleLabelTimer) {
        idleLabelTimer.remove(false);
        idleLabelTimer = null;
      }
    };
    const scheduleIdleLabel = (): void => {
      cancelIdleLabel();
      idleLabelTimer = this.time.delayedCall(180, () => {
        setSelectionLabel(IDLE_LABEL);
        idleLabelTimer = null;
      });
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cancelIdleLabel);

    const focusOverlay = (idx: number): void => {
      if (focusedIdx === idx) return;
      if (focusedIdx !== -1) unfocusCurrent();
      focusedIdx = idx;
      const def = validDefs[idx];
      const route = validRoutes[idx];
      const overlay = allOverlays[idx];
      const base = baseScales[idx];

      // Raise the focused overlay above the dim so it reads as the one
      // lit, crisp element on the map.
      overlay.setDepth(FOCUSED_DEPTH);
      this.tweens.add({
        targets: overlay,
        scaleX: base.x * HIGHWAY_HOVER_SCALE,
        scaleY: base.y * HIGHWAY_HOVER_SCALE,
        duration: HIGHWAY_HOVER_DURATION_MS,
        ease: 'Sine.easeOut',
      });
      // Non-focused overlays stay visible but crossfade to their
      // blurred siblings. Since the dim overlay sits at depth 3 and
      // the blur siblings at 2.5, they're both below the dim — they
      // end up blurred AND darkened, visually merging with the bg.
      for (let i = 0; i < allOverlays.length; i++) {
        if (i === idx) continue;
        this.tweens.add({
          targets: allBlurs[i],
          alpha: 1,
          duration: HIGHWAY_HOVER_DURATION_MS,
        });
      }
      this.tweens.add({
        targets: dimOverlay,
        fillAlpha: DIM_HOVER,
        duration: HIGHWAY_HOVER_DURATION_MS,
      });
      this.tweens.add({
        targets: bgBlurred,
        alpha: 1,
        duration: HIGHWAY_HOVER_DURATION_MS,
      });
      // Move the shared details panel to sit adjacent to THIS overlay
      // per its panelAnchor direction. `panelGap` defaults to 50 px —
      // routes with looser bounding boxes can override.
      const gap = def.panelGap ?? 50;
      const bounds = overlay.getBounds();
      let px = bounds.centerX;
      let py = bounds.centerY;
      switch (def.panelAnchor) {
        case 'above':
          px = bounds.centerX;
          py = bounds.top - gap - panel.panelH / 2;
          break;
        case 'below':
          px = bounds.centerX;
          py = bounds.bottom + gap + panel.panelH / 2;
          break;
        case 'left':
          px = bounds.left - gap - panel.panelW / 2;
          py = bounds.centerY;
          break;
        case 'right':
          px = bounds.right + gap + panel.panelW / 2;
          py = bounds.centerY;
          break;
      }
      // Clamp to viewport so the panel never overflows the edge.
      px = Math.max(panel.panelW / 2 + 10, Math.min(width - panel.panelW / 2 - 10, px));
      py = Math.max(panel.panelH / 2 + 10, Math.min(height - panel.panelH / 2 - 10, py));
      panel.container.setPosition(px, py);
      panel.setRoute(route);
      panel.container.setVisible(true);
      cancelIdleLabel();
      setSelectionLabel(route.name.toUpperCase());
    };

    const unfocusCurrent = (): void => {
      if (focusedIdx === -1) return;
      const idx = focusedIdx;
      const overlay = allOverlays[idx];
      const base = baseScales[idx];
      // Drop the formerly-focused overlay back to the baseline depth
      // so the next focus can raise a different one cleanly.
      overlay.setDepth(BASE_DEPTH);
      this.tweens.add({
        targets: overlay,
        scaleX: base.x,
        scaleY: base.y,
        duration: HIGHWAY_HOVER_DURATION_MS,
        ease: 'Sine.easeIn',
      });
      // Fade every non-focused blur sibling back to 0 so all three
      // overlays return to crisp when nothing is selected.
      for (let i = 0; i < allBlurs.length; i++) {
        this.tweens.add({
          targets: allBlurs[i],
          alpha: 0,
          duration: HIGHWAY_HOVER_DURATION_MS,
        });
      }
      this.tweens.add({
        targets: dimOverlay,
        fillAlpha: DIM_IDLE,
        duration: HIGHWAY_HOVER_DURATION_MS,
      });
      this.tweens.add({
        targets: bgBlurred,
        alpha: 0,
        duration: HIGHWAY_HOVER_DURATION_MS,
      });
      panel.container.setVisible(false);
      focusedIdx = -1;
      // Defer the idle-label paint so rapid overlay-to-overlay traverse
      // doesn't flash "— SELECT A ROUTE —" for a frame between the
      // outgoing pointerout and the incoming pointerover. focusOverlay
      // cancels the timer on arrival.
      scheduleIdleLabel();
    };

    const commitFocused = (): void => {
      if (focusedIdx === -1) return;
      const route = validRoutes[focusedIdx];
      playSfx(this, 'sfx-menu-confirm', 0.5);
      startRun(route, this.party);
      // Committing to a route leaves the lobby flow. Stop any
      // lobby-adjacent scenes still in the background so Combat
      // starts clean.
      const sm = this.scene.manager;
      for (const key of ['Lobby', 'PartySelectTerminal']) {
        if (sm.isActive(key) || sm.isPaused(key) || sm.isSleeping(key)) {
          sm.stop(key);
        }
      }
      this.scene.start('Journey', { fromRouteStart: true });
    };

    for (const def of ROUTE_OVERLAYS) {
      const route = ROUTES.find((r) => r.id === def.routeId);
      if (!route) continue;
      const overlayW = width * (def.nativeW / MAP_NATIVE_W);
      const overlayH = height * (def.nativeH / MAP_NATIVE_H);
      const centerX = width * (def.nativeX / MAP_NATIVE_W) + overlayW / 2;
      const centerY = height * (def.nativeY / MAP_NATIVE_H) + overlayH / 2;

      const overlay = this.add
        .image(centerX, centerY, def.textureKey)
        .setOrigin(0.5, 0.5)
        .setDisplaySize(overlayW, overlayH)
        .setDepth(BASE_DEPTH);
      const blur = this.add
        .image(centerX, centerY, def.blurTextureKey)
        .setOrigin(0.5, 0.5)
        .setDisplaySize(overlayW, overlayH)
        .setAlpha(0)
        .setDepth(BLUR_DEPTH);
      const idx = allOverlays.length;
      validDefs.push(def);
      validRoutes.push(route);
      allOverlays.push(overlay);
      allBlurs.push(blur);
      baseScales.push({ x: overlay.scaleX, y: overlay.scaleY });
      // Explicit padded hit area so the scale-up-on-hover doesn't push
      // the image's visible edges past its own hit rect. Per-route
      // hitAreaPadding override supports either a uniform number or an
      // object with per-side values — the latter is useful when one
      // side shouldn't extend (e.g. the mall's top, which was
      // covering space that belongs to the substation).
      const pad = def.hitAreaPadding ?? HIT_AREA_PADDING;
      const padTop = typeof pad === 'number' ? pad : (pad.top ?? HIT_AREA_PADDING);
      const padRight = typeof pad === 'number' ? pad : (pad.right ?? HIT_AREA_PADDING);
      const padBottom = typeof pad === 'number' ? pad : (pad.bottom ?? HIT_AREA_PADDING);
      const padLeft = typeof pad === 'number' ? pad : (pad.left ?? HIT_AREA_PADDING);
      overlay.setInteractive(
        new Phaser.Geom.Rectangle(
          -padLeft,
          -padTop,
          def.nativeW + padLeft + padRight,
          def.nativeH + padTop + padBottom,
        ),
        Phaser.Geom.Rectangle.Contains,
      );
      if (overlay.input) overlay.input.cursor = 'pointer';

      // Debug hit-area outline: drawn once here, then its visibility
      // is kept in sync with the global collision-debug toggle via
      // onDebugCollisionChange so flipping the HUD button also
      // hides/shows these.
      const scale = overlayW / def.nativeW;
      const hitLeft = centerX - (def.nativeW / 2 + padLeft) * scale;
      const hitTop = centerY - (def.nativeH / 2 + padTop) * scale;
      const hitW = (def.nativeW + padLeft + padRight) * scale;
      const hitH = (def.nativeH + padTop + padBottom) * scale;
      const debug = this.add.graphics().setDepth(3);
      debug.lineStyle(2, 0xff00ff, 0.9);
      debug.strokeRect(hitLeft, hitTop, hitW, hitH);
      debug.setVisible(isDebugCollisionOn());
      const unsubscribe = onDebugCollisionChange((on) => debug.setVisible(on));
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);

      overlay.on('pointerover', (pointer: Phaser.Input.Pointer) => {
        // Ignore synthetic pointerover on touch — Phaser fires it the
        // moment the finger touches the overlay, and the matching
        // pointerout fires on release, which would un-focus the route
        // as soon as the player lifts their finger. Mobile focus is
        // driven entirely from pointerup (and the scene-level
        // "tap outside to deselect" handler).
        if (pointer.wasTouch) return;
        // Ignore the synthetic pointerover Phaser fires when the scene
        // mounts with the cursor already over this overlay — player
        // never actually hovered. Unlocks as soon as they move.
        if (!hoverArmed) return;
        focusOverlay(idx);
      });
      overlay.on('pointerout', (pointer: Phaser.Input.Pointer) => {
        if (pointer.wasTouch) return;
        // Only clear focus if THIS overlay is what's focused. Keyboard
        // / arrow-UI cycling can shift focus elsewhere; we don't want
        // a stray pointerout from a non-focused overlay to yank the
        // panel away.
        if (focusedIdx === idx) unfocusCurrent();
      });
      overlay.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        if (pointer.wasTouch) {
          // Mobile: tap is a toggle for select/deselect. Same route
          // tapped again deselects; a different route switches focus.
          // Commit happens ONLY via the dedicated CONFIRM button.
          hoverArmed = true;
          if (focusedIdx === idx) {
            unfocusCurrent();
          } else {
            focusOverlay(idx);
          }
          return;
        }
        if (focusedIdx !== idx) focusOverlay(idx);
        commitFocused();
      });
    }

    // Bottom-left: BACK → return to PartySelectTerminal with the same
    // party preserved so the player can swap crew before committing to
    // a route. Keyboard: Backspace. Clicking / pressing Backspace both
    // route through the same handler so keyboard + mouse feel identical.
    const goBack = () => {
      playSfx(this, 'sfx-menu-cancel', 0.4);
      this.scene.start('PartySelectTerminal');
    };
    const backBtn = this.add
      .text(24, height - 30, '← BACK', {
        fontFamily: FONT,
        fontSize: '18px',
        color: '#cccccc',
        backgroundColor: '#05141099',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .setDepth(10);
    backBtn.on('pointerover', () => backBtn.setColor('#ffffff'));
    backBtn.on('pointerout', () => backBtn.setColor('#cccccc'));
    backBtn.on('pointerup', goBack);
    this.input.keyboard?.on('keydown-BACKSPACE', goBack);

    // Bottom-right: BRIEFING — opens the shared mission briefing modal.
    // Keyboard: B. Clicking or pressing B routes through the same
    // handler; delayed by a tick to dodge the "opening click closes
    // the modal immediately" pattern seen in other briefing entries.
    const briefingOpen = () => {
      this.time.delayedCall(1, () => openBriefing(this));
    };
    // Bottom-left, stacked ABOVE the BACK button. Kept out of the
    // top-left cluster with the title + cycler so the route-selection
    // affordances read as a single group and the mission briefing
    // reads as its own navigation action alongside BACK.
    const briefingBtn = this.add
      .text(24, height - 70, isTouchDevice() ? '[TAP] MISSION BRIEFING' : '[B] MISSION BRIEFING', {
        fontFamily: FONT,
        fontSize: '15px',
        color: '#8affaa',
        // Bracket-framed label + bordered pill on touch so the label
        // reads clearly as a tap target without a keyboard-shortcut
        // prefix. Matches the [ CONFIRM ] button chrome above.
        backgroundColor: isTouchDevice() ? '#0a2a1a' : '#05141099',
        padding: isTouchDevice() ? { x: 14, y: 8 } : { x: 10, y: 5 },
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .setDepth(10);
    briefingBtn.on('pointerover', () => briefingBtn.setColor('#ffffff'));
    briefingBtn.on('pointerout', () => briefingBtn.setColor('#8affaa'));
    briefingBtn.on('pointerup', briefingOpen);
    this.input.keyboard?.on('keydown-B', briefingOpen);

    // Mobile-only dedicated CONFIRM button — sits above the MISSION
    // BRIEFING button. Only visible when a route is focused, so the
    // affordance only appears when tapping it does something. Desktop
    // uses the "[ CLICK TO BEGIN ]" hint inside the panel instead.
    // The visible/hidden state is refreshed each frame via a cheap
    // UPDATE listener — coupling to focusOverlay/unfocusCurrent
    // directly would require restructuring those local closures.
    if (isTouchDevice()) {
      // Big, bright commit button — the [TAP] prefix is dropped
      // because the chrome (bright green pill, thick padding, larger
      // font) is unambiguously a button on its own.
      const confirmBtn = this.add
        .text(24, height - 140, 'START ROUTE', {
          fontFamily: FONT,
          fontSize: '32px',
          color: '#062010',
          backgroundColor: '#8aff8a',
          padding: { x: 40, y: 22 },
          fontStyle: 'bold',
        })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .setDepth(10)
        .setVisible(false);
      confirmBtn.on('pointerup', () => commitFocused());
      const syncMobileConfirm = (): void => {
        confirmBtn.setVisible(focusedIdx !== -1);
      };
      this.events.on(Phaser.Scenes.Events.UPDATE, syncMobileConfirm);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.events.off(Phaser.Scenes.Events.UPDATE, syncMobileConfirm);
      });
    }

    // Selection cycle UI — [◀]  ROUTE NAME  [▶] — stacked directly
    // below the "CHOOSE YOUR ROUTE" title. Provides a touch-friendly
    // cycler for mobile (where hover doesn't fire), a visible hint
    // that routes are cyclable, and redundancy for keyboard nav.
    const cyclerY = 70;
    const arrowFontSize = 16;
    const labelFontSize = 13;
    // Square arrow buttons — fixed width+height equal to the label's
    // height so the glyph sits centered (horizontally via align:center,
    // vertically via the matching fixed height). Non-square buttons
    // made the ◀ / ▶ glyphs read as off-center because their native
    // advance widths are smaller than their visual bounding box.
    const arrowBoxSize = 26;
    const cycle = (delta: number): void => {
      hoverArmed = true;
      const n = allOverlays.length;
      if (n === 0) return;
      const next = focusedIdx < 0 ? (delta > 0 ? 0 : n - 1) : (focusedIdx + delta + n) % n;
      focusOverlay(next);
    };
    // Rectangle background + Text (origin-centered, positioned at the
    // rect's center) is the most reliable way to get both horizontal
    // AND vertical centering for a single glyph across font sizes.
    // Earlier fixedWidth/fixedHeight + padding.top fudge only worked
    // for one specific arrow font size; shrinking the font threw it
    // off. The rect also serves as the hit area and exposes `.width`
    // the way the old Text did for downstream layout math.
    const makeArrow = (
      x: number,
      glyph: string,
      onClick: () => void,
    ): Phaser.GameObjects.Rectangle => {
      const bg = this.add
        .rectangle(x, cyclerY, arrowBoxSize, arrowBoxSize, 0x051410, 0.6)
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .setDepth(10);
      const glyphText = this.add
        .text(x + arrowBoxSize / 2, cyclerY, glyph, {
          fontFamily: FONT,
          fontSize: `${arrowFontSize}px`,
          color: '#8affaa',
        })
        .setOrigin(0.5, 0.5)
        .setScrollFactor(0)
        .setDepth(11);
      bg.on('pointerover', () => {
        bg.setFillStyle(0x0a2a1a, 0.85);
        glyphText.setColor('#ffffff');
      });
      bg.on('pointerout', () => {
        bg.setFillStyle(0x051410, 0.6);
        glyphText.setColor('#8affaa');
      });
      bg.on('pointerup', onClick);
      return bg;
    };
    const leftArrow = makeArrow(24, '◀', () => cycle(-1));

    // Span the full cycler row to match the "CHOOSE YOUR ROUTE" title
    // above it so the two elements read as a unified top-left block.
    // leftArrow sits at x=24, rightArrow ends at x=24+titleWidth; the
    // label fills the middle.
    const cyclerGap = 6;
    const titleWidth = titleText.width;
    const labelWidth = Math.max(160, titleWidth - arrowBoxSize * 2 - cyclerGap * 2);
    selectionLabel = this.add
      .text(0, cyclerY, IDLE_LABEL, {
        fontFamily: FONT,
        fontSize: `${labelFontSize}px`,
        color: '#ffdd88',
        backgroundColor: '#05141099',
        padding: { x: 10, y: 6 },
        align: 'center',
        fixedWidth: labelWidth,
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(10);
    const labelX = 24 + leftArrow.width + cyclerGap;
    selectionLabel.setPosition(labelX, cyclerY);

    makeArrow(labelX + labelWidth + cyclerGap, '▶', () => cycle(1));

    // Keyboard cycling. up / left / W / A = previous,
    // down / right / S / D = next. Enter / Space commits the focused
    // route. Cycling also arms the hover gate so keyboard-only users
    // don't need to wiggle the mouse first.
    const prevKeys = ['LEFT', 'A', 'UP', 'W'];
    const nextKeys = ['RIGHT', 'D', 'DOWN', 'S'];
    for (const k of prevKeys) {
      this.input.keyboard?.on(`keydown-${k}`, () => cycle(-1));
    }
    for (const k of nextKeys) {
      this.input.keyboard?.on(`keydown-${k}`, () => cycle(1));
    }
    const commitKey = () => {
      if (focusedIdx >= 0) commitFocused();
    };
    this.input.keyboard?.on('keydown-ENTER', commitKey);
    this.input.keyboard?.on('keydown-SPACE', commitKey);
    this.input.keyboard?.on('keydown-E', commitKey);

    // Gate the pause-menu ESC so it doesn't fire while the briefing
    // modal is open or while a route is focused — ESC should close
    // the briefing / deselect the route before ever reaching the
    // pause menu. Registered BEFORE the deselect handler below so
    // Phaser fires it first — it reads `focusedIdx` pre-deselect and
    // correctly blocks; then our deselect handler runs and clears
    // the focus.
    installPauseMenuEsc(this, {
      shouldBlockEsc: () => isBriefingOpen() || focusedIdx !== -1,
    });
    // ESC while a route is focused clears the focus (deselect). Gives
    // keyboard users a way out of a selection without committing. The
    // briefing modal swallows ESC separately via isBriefingOpen().
    this.input.keyboard?.on('keydown-ESC', () => {
      if (focusedIdx !== -1) unfocusCurrent();
    });

    // Mobile "tap outside to deselect": any touch pointerdown that
    // DOESN'T hit an interactive UI element (arrows, briefing, back,
    // a route overlay) clears the current focus. Route-overlay taps
    // are handled by each overlay's own pointerup (they deselect on
    // non-focused taps, commit on focused taps); arrow/briefing/back
    // taps appear in `currentlyOver` so we skip those.
    this.input.on(
      'pointerdown',
      (pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
        if (!pointer.wasTouch) return;
        if (focusedIdx === -1) return;
        if (currentlyOver.length === 0) unfocusCurrent();
      },
    );
  }

  /**
   * Build the hover-details panel. Returns the root container and a
   * setter that repopulates its text fields for a given route.
   */
  private createRouteDetailsPanel(): {
    container: Phaser.GameObjects.Container;
    setRoute: (route: RouteDef) => void;
    panelW: number;
    panelH: number;
  } {
    // All children positioned RELATIVE to the container's origin (0, 0)
    // so the caller can move the whole panel on hover by setting
    // container.setPosition(centerX, centerY). panelW/H are returned so
    // the caller can compute anchor positions that don't overflow.
    const panelW = 420;
    const panelH = 180;

    const container = this.add.container(0, 0).setDepth(100);

    const bg = this.add
      .rectangle(0, 0, panelW, panelH, 0x051410, 0.9)
      .setStrokeStyle(3, 0x55ff88, 1);
    container.add(bg);

    // L-bracket corners, matching the briefing/map modals. Relative
    // coords (-panelW/2, -panelH/2) since container is the origin.
    const brackets = this.add.graphics();
    brackets.lineStyle(3, 0x8aff8a, 1);
    const armLen = 16;
    const l = -panelW / 2,
      r = panelW / 2,
      t = -panelH / 2,
      b = panelH / 2;
    const drawCorner = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
      brackets.beginPath();
      brackets.moveTo(ax, ay);
      brackets.lineTo(bx, by);
      brackets.lineTo(cx, cy);
      brackets.strokePath();
    };
    drawCorner(l, t + armLen, l, t, l + armLen, t);
    drawCorner(r - armLen, t, r, t, r, t + armLen);
    drawCorner(l, b - armLen, l, b, l + armLen, b);
    drawCorner(r - armLen, b, r, b, r, b - armLen);
    container.add(brackets);

    const nameText = this.add
      .text(0, -panelH / 2 + 18, '', {
        fontFamily: FONT,
        fontSize: '32px',
        color: '#ffdd88',
      })
      .setOrigin(0.5, 0);
    container.add(nameText);

    const subtitleText = this.add
      .text(0, -panelH / 2 + 56, '', {
        fontFamily: FONT,
        fontSize: '15px',
        color: '#aaaaaa',
      })
      .setOrigin(0.5, 0);
    container.add(subtitleText);

    const diffText = this.add
      .text(0, -panelH / 2 + 90, '', {
        fontFamily: FONT,
        fontSize: '24px',
        color: '#aaffaa',
      })
      .setOrigin(0.5, 0);
    container.add(diffText);

    // Desktop-only hint — on mobile a dedicated CONFIRM button sits
    // above the MISSION BRIEFING button in the bottom-left, so the
    // panel doesn't need its own call-to-action. Mentions both
    // commit paths available on desktop: mouse click or keyboard Enter.
    if (!isTouchDevice()) {
      const hint = this.add
        .text(0, panelH / 2 - 28, '[ START ]', {
          fontFamily: FONT,
          fontSize: '16px',
          color: '#8affaa',
        })
        .setOrigin(0.5, 0);
      container.add(hint);
    }

    const setRoute = (route: RouteDef): void => {
      nameText.setText(route.name);
      // Strip any trailing "· X patrols", "· brutal", or "· balanced"
      // descriptor from the subtitle — the text overflows the panel at
      // the current font size, and the difficulty rating below already
      // conveys the same threat level. Scoped to this map scene; the
      // legacy RouteScene shows the full subtitle unchanged.
      const trimmed = route.subtitle.replace(/\s*·\s*[^·]*(?:patrols|brutal|balanced)[^·]*$/i, '');
      subtitleText.setText(trimmed);
      const stars =
        route.difficulty === 'easy'
          ? '\u2605\u2606\u2606'
          : route.difficulty === 'medium'
            ? '\u2605\u2605\u2606'
            : '\u2605\u2605\u2605';
      const diffColor =
        route.difficulty === 'easy'
          ? '#aaffaa'
          : route.difficulty === 'medium'
            ? '#ffdd88'
            : '#ff8a8a';
      diffText.setText(`${stars}   ${route.difficulty.toUpperCase()}`);
      diffText.setColor(diffColor);
      nameText.setColor(diffColor);
    };

    return { container, setRoute, panelW, panelH };
  }
}
