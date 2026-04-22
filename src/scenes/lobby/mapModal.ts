import * as Phaser from 'phaser';
import { FONT, isTouchDevice } from '../../util/ui';
import { openBriefing } from '../../util/briefingModal';

/**
 * Full-screen map modal — opens when the player interacts with the
 * lobby map board. Shows the hand-drawn route map filling the viewport
 * with an [ESC] close hint. Blocks lobby input while open via the
 * module-scoped `mapOpen` flag (mirrors the `dialogueOpen` pattern in
 * npcAgent.ts).
 */

let mapOpen = false;
export function isMapOpen(): boolean {
  return mapOpen;
}

/**
 * Open the map modal in the given scene. Returns a close callback the
 * caller can invoke if they need to dismiss programmatically (e.g. on
 * scene shutdown). Idempotent — calling while already open is a no-op.
 */
export function openMapModal(scene: Phaser.Scene): () => void {
  if (mapOpen) return () => {};
  mapOpen = true;

  const { width, height } = scene.scale;
  // Depth sits above the E-prompt text (99998) and the portal labels
  // (99997) so they can't poke through the modal visually or intercept
  // pointer events over the map.
  const container = scene.add.container(0, 0).setDepth(100000).setScrollFactor(0);

  // Dim the world behind the modal. Not set interactive — pointerdown is
  // handled scene-wide below so ANY click dismisses without needing the
  // click to hit a specific object (more reliable than per-object handlers
  // when other UI layers may be intercepting).
  const backdrop = scene.add
    .rectangle(width / 2, height / 2, width, height, 0x000000, 0.85)
    .setScrollFactor(0);
  container.add(backdrop);

  // Map image — fits inside the viewport with ~40px margin so the close
  // hint has room below. Aspect-ratio preserved so it doesn't look
  // squashed (source is ~2754×1536 ≈ 1.79; viewport is 1.78 — near-
  // identical, so the fit is essentially edge-to-edge).
  const marginY = 60;
  const maxW = width - 40;
  const maxH = height - marginY * 2;
  const tex = scene.textures.get('lobby-map-full').getSourceImage() as HTMLImageElement;
  const srcW = tex.width || 2754;
  const srcH = tex.height || 1536;
  const scale = Math.min(maxW / srcW, maxH / srcH);
  const img = scene.add
    .image(width / 2, height / 2, 'lobby-map-full')
    .setScale(scale)
    .setScrollFactor(0);
  container.add(img);

  // Close button — square background with the X glyph centered inside.
  // Hover flips to the pointer cursor via setInteractive; the actual
  // close runs from the scene-level pointerdown handler below.
  const frameW = srcW * scale;
  const frameH = srcH * scale;
  const right = (width + frameW) / 2;
  const top = (height - frameH) / 2;
  const btnSize = 36;
  const btnCx = right - btnSize / 2 - 6;
  const btnCy = top + btnSize / 2 + 6;
  const btnBg = scene.add
    .rectangle(btnCx, btnCy, btnSize, btnSize, 0x000000, 0.8)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });
  container.add(btnBg);
  // Silkscreen's baseline + ascent metrics leave the visual glyph
  // slightly below geometric center at origin (0.5, 0.5). Nudge up 2px
  // so the X reads optically centered inside the 36x36 button.
  const btnText = scene.add
    .text(btnCx, btnCy - 2, 'X', {
      fontFamily: FONT,
      fontSize: '20px',
      color: '#ffffff',
    })
    .setOrigin(0.5, 0.5)
    .setScrollFactor(0);
  container.add(btnText);

  // Briefing button — sits just below the map image, opens the shared
  // "mission briefing" modal. Clicking it closes the map modal first
  // (via the scene-wide pointerdown handler) then hands off to the
  // briefing modal on the next tick.
  let openBriefingAfterClose = false;
  const briefingY = (height + frameH) / 2 + 14;
  const briefingBtnPadX = 14;
  const briefingBtnPadY = 6;
  const briefingIdleColor = '#8affaa';
  const briefingHoverColor = '#ffffff';
  // Bracket-framed label + darker bordered pill on touch so mobile
  // players read it as a tap target; desktop keeps the keyboard hint.
  const briefingLabel = scene.add
    .text(
      width / 2,
      briefingY,
      isTouchDevice() ? '[TAP] MISSION BRIEFING' : '[B] MISSION BRIEFING',
      {
        fontFamily: FONT,
        fontSize: '22px',
        color: briefingIdleColor,
        backgroundColor: isTouchDevice() ? '#0a2a1a' : '#05141099',
        padding: { x: briefingBtnPadX, y: briefingBtnPadY },
      },
    )
    .setOrigin(0.5, 0)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });
  briefingLabel.on('pointerover', () => briefingLabel.setColor(briefingHoverColor));
  briefingLabel.on('pointerout', () => briefingLabel.setColor(briefingIdleColor));
  briefingLabel.on('pointerdown', () => {
    openBriefingAfterClose = true;
  });
  container.add(briefingLabel);

  // Close is wired via scene-level listeners — any keypress from the
  // dismiss set or any pointerdown anywhere on the canvas triggers it.
  // Using scene.input.on (rather than per-object once handlers) dodges
  // the "Phaser silently drops the event" class of bugs when other
  // interactive objects overlap.
  const close = () => {
    if (!mapOpen) return;
    mapOpen = false;
    container.destroy();
    scene.input.keyboard?.off('keydown-ESC', close);
    scene.input.keyboard?.off('keydown-E', close);
    scene.input.keyboard?.off('keydown-ENTER', close);
    scene.input.keyboard?.off('keydown-SPACE', close);
    scene.input.keyboard?.off('keydown-B', openBriefingNow);
    scene.input.off('pointerdown', close);
    if (openBriefingAfterClose) {
      openBriefingAfterClose = false;
      // Delay a tick so the current click event fully propagates
      // before the briefing's own scene-wide pointerdown handler
      // attaches — otherwise this same click would close it too.
      scene.time.delayedCall(1, () => openBriefing(scene));
    }
  };
  const openBriefingNow = () => {
    openBriefingAfterClose = true;
    close();
  };
  scene.input.keyboard?.on('keydown-ESC', close);
  scene.input.keyboard?.on('keydown-E', close);
  scene.input.keyboard?.on('keydown-ENTER', close);
  scene.input.keyboard?.on('keydown-SPACE', close);
  scene.input.keyboard?.on('keydown-B', openBriefingNow);
  // Defer the scene-level pointerdown close binding by one tick so the
  // click that OPENED this modal (e.g. pointerdown on the map board
  // sprite) doesn't immediately fire this listener and close the modal.
  scene.time.delayedCall(1, () => {
    if (mapOpen) scene.input.on('pointerdown', close);
  });

  return close;
}
