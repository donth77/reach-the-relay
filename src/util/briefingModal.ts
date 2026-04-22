import * as Phaser from 'phaser';
import { FONT, isTouchDevice } from './ui';
import {
  BRIEFING_TITLE,
  BRIEFING_LEAD,
  BRIEFING_SECTIONS,
  BRIEFING_BACKGROUND,
} from '../data/briefing';

/**
 * Full-screen "mission briefing" modal — summarises the game's objective,
 * lose conditions, and core threat. Shared across the three surfaces
 * that expose it to the player:
 *   - TitleScene "HOW TO PLAY" menu entry
 *   - Lobby map board modal (opened via a dedicated button inside that modal)
 *   - Dr. Vey NPC dialogue [B] BRIEFING branch
 *
 * Keep the visual style identical everywhere — terminal-green border,
 * same copy — so the player recognizes it regardless of entry point.
 * Module-scoped `open` flag lets callers gate ESC handling so the pause
 * menu doesn't steal the close key.
 */

let briefingOpen = false;
export function isBriefingOpen(): boolean {
  return briefingOpen;
}

export function openBriefing(scene: Phaser.Scene): () => void {
  if (briefingOpen) return () => {};
  briefingOpen = true;

  const { width, height } = scene.scale;
  const container = scene.add.container(0, 0).setDepth(100001).setScrollFactor(0);

  // Dim background + whole-screen click-to-close surface.
  const backdrop = scene.add
    .rectangle(width / 2, height / 2, width, height, 0x000000, 0.88)
    .setScrollFactor(0);
  container.add(backdrop);

  // Panel — centered, ~60% of viewport, terminal aesthetic.
  // Height bumped to fit the background-lore paragraph at the bottom.
  const panelW = Math.min(760, width - 80);
  const panelH = Math.min(620, height - 60);
  const panelX = width / 2;
  const panelY = height / 2;
  const panelLeft = panelX - panelW / 2;
  const panelTop = panelY - panelH / 2;

  const panel = scene.add
    .rectangle(panelX, panelY, panelW, panelH, 0x051410, 0.98)
    .setStrokeStyle(3, 0x55ff88, 1)
    .setScrollFactor(0);
  container.add(panel);

  // L-bracket corners.
  const brackets = scene.add.graphics().setScrollFactor(0);
  brackets.lineStyle(3, 0x8aff8a, 1);
  const armLen = 22;
  const l = panelLeft,
    r = panelLeft + panelW,
    t = panelTop,
    b = panelTop + panelH;
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

  // Title.
  let y = panelTop + 32;
  container.add(
    scene.add
      .text(panelX, y, `> ${BRIEFING_TITLE}`, {
        fontFamily: FONT,
        fontSize: '32px',
        color: '#8aff8a',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0),
  );
  y += 56;

  // Lead paragraph.
  const textW = panelW - 48;
  const lead = scene.add
    .text(panelLeft + 24, y, BRIEFING_LEAD, {
      fontFamily: FONT,
      fontSize: '20px',
      color: '#a6ffc6',
      wordWrap: { width: textW },
    })
    .setOrigin(0, 0)
    .setScrollFactor(0);
  container.add(lead);
  y = lead.y + lead.displayHeight + 22;

  // Sections.
  for (const section of BRIEFING_SECTIONS) {
    const heading = scene.add
      .text(panelLeft + 24, y, section.heading, {
        fontFamily: FONT,
        fontSize: '18px',
        color: '#55ff88',
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    container.add(heading);
    y = heading.y + heading.displayHeight + 6;
    const body = scene.add
      .text(panelLeft + 24, y, section.text, {
        fontFamily: FONT,
        fontSize: '17px',
        color: '#cceeee',
        wordWrap: { width: textW },
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    container.add(body);
    y = body.y + body.displayHeight + 16;
  }

  // Background lore — dimmer + italic, visually separated from the
  // gameplay sections above by a thin divider so the player doesn't
  // try to read it as rules.
  y += 6;
  const divider = scene.add.graphics().setScrollFactor(0);
  divider.lineStyle(1, 0x2a4a3a, 1);
  divider.beginPath();
  divider.moveTo(panelLeft + 24, y);
  divider.lineTo(panelLeft + panelW - 24, y);
  divider.strokePath();
  container.add(divider);
  y += 14;
  const backgroundText = scene.add
    .text(panelLeft + 24, y, BRIEFING_BACKGROUND, {
      fontFamily: FONT,
      fontSize: '15px',
      color: '#6aaa8a',
      fontStyle: 'italic',
      wordWrap: { width: textW },
    })
    .setOrigin(0, 0)
    .setScrollFactor(0);
  container.add(backgroundText);

  // Close button (X) in top-right corner of the panel.
  const btnSize = 36;
  const btnCx = panelLeft + panelW - btnSize / 2 - 8;
  const btnCy = panelTop + btnSize / 2 + 8;
  const btnBg = scene.add
    .rectangle(btnCx, btnCy, btnSize, btnSize, 0x000000, 0.8)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });
  container.add(btnBg);
  const btnText = scene.add
    .text(btnCx, btnCy, 'X', {
      fontFamily: FONT,
      fontSize: '20px',
      color: '#ffffff',
    })
    .setOrigin(0.5, 0.5)
    .setScrollFactor(0);
  container.add(btnText);

  // Close hint at the bottom of the panel. Touch devices get a tap
  // hint; desktop shows the ESC/click hint.
  const closeHintText = isTouchDevice() ? 'TAP TO CLOSE' : '[ESC] CLOSE';
  container.add(
    scene.add
      .text(panelX, panelTop + panelH - 24, closeHintText, {
        fontFamily: FONT,
        fontSize: '14px',
        color: '#6aaa8a',
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0),
  );

  const close = () => {
    if (!briefingOpen) return;
    briefingOpen = false;
    container.destroy();
    scene.input.keyboard?.off('keydown-ESC', close);
    scene.input.keyboard?.off('keydown-E', close);
    scene.input.keyboard?.off('keydown-ENTER', close);
    scene.input.keyboard?.off('keydown-SPACE', close);
    scene.input.off('pointerdown', close);
  };
  scene.input.keyboard?.on('keydown-ESC', close);
  scene.input.keyboard?.on('keydown-E', close);
  scene.input.keyboard?.on('keydown-ENTER', close);
  scene.input.keyboard?.on('keydown-SPACE', close);
  // Delay the pointerdown-close binding by one frame so the same click that
  // opened this modal (via an NPC sprite pointerdown) doesn't immediately
  // close it. Without this, the click event that triggered the open
  // propagates to scene.input and the freshly-bound close handler catches it.
  scene.time.delayedCall(0, () => {
    if (briefingOpen) scene.input.on('pointerdown', close);
  });

  return close;
}
