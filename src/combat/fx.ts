import * as Phaser from 'phaser';
import type { Element } from '../data/classes';
import { VULNERABILITY_GLYPH } from '../data/enemies';
import { FONT } from '../util/ui';
import type { Unit } from './types';

/**
 * Transient visual effects used by CombatScene — damage numbers, heal/status
 * floaters, hit flashes, screen shakes. Pulled out of CombatScene so the
 * scene file stays focused on turn-loop + unit state. All helpers are pure
 * functions that take the scene + unit and produce a tween/text.
 */

/** Brief red tint on a unit sprite to signal a hit. */
export function flashSprite(scene: Phaser.Scene, u: Unit): void {
  if (!u.sprite) return;
  u.sprite.setTint(0xff4444);
  scene.time.delayedCall(140, () => u.sprite?.clearTint());
}

/** Quick horizontal shake of a unit's sprite. */
export function playHitShake(scene: Phaser.Scene, u: Unit): void {
  if (!u.sprite) return;
  const baseX = u.posX;
  scene.tweens.add({
    targets: u.sprite,
    x: { from: baseX + 5, to: baseX - 5 },
    duration: 55,
    yoyo: true,
    repeat: 2,
    ease: 'Sine.easeInOut',
    onComplete: () => {
      if (u.sprite) u.sprite.x = baseX;
    },
  });
}

/**
 * Generic floating text above a unit's head. Fades up and out.
 * Used for damage numbers, heals (+N), status labels (STIM, SHIELD, DODGE).
 */
export function spawnFloatNumber(
  scene: Phaser.Scene,
  u: Unit,
  text: string,
  color: string,
  opts?: { fontSize?: string; stroke?: string; strokeThickness?: number },
): void {
  if (!u.sprite) return;
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: FONT,
    fontSize: opts?.fontSize ?? '32px',
    color,
    stroke: opts?.stroke ?? '#000000',
    strokeThickness: opts?.strokeThickness ?? 4,
  };
  const num = scene.add
    .text(u.sprite.x, u.sprite.y - 60, text, style)
    .setOrigin(0.5)
    .setDepth(100000); // always on top of every sprite, even walk-forward
  scene.tweens.add({
    targets: num,
    y: num.y - 50,
    alpha: 0,
    duration: 800,
    onComplete: () => num.destroy(),
  });
}

/**
 * Styled damage number — red for crits, gray for resisted, gold for normal.
 * When `element` has a vulnerability glyph (🔥/❄/⚡), renders the number
 * and glyph in a container so they float together.
 */
export function spawnDamageNumber(
  scene: Phaser.Scene,
  u: Unit,
  damage: number,
  crit = false,
  element?: Element,
  resisted = false,
): void {
  if (!u.sprite) return;
  const glyph = element ? VULNERABILITY_GLYPH[element] : '';

  let numText: string;
  let color: string;
  let baseFontSize: number;
  let stroke: string;
  let strokeThickness: number;
  if (crit) {
    numText = `${damage}!`;
    color = '#ff5533';
    baseFontSize = 48;
    stroke = '#4a0000';
    strokeThickness = 6;
  } else if (resisted) {
    numText = `${damage} RESIST`;
    color = '#7a7a7a';
    baseFontSize = 24;
    stroke = '#1a1a1a';
    strokeThickness = 3;
  } else {
    numText = `${damage}`;
    color = '#ffdd55';
    baseFontSize = 32;
    stroke = '#000000';
    strokeThickness = 4;
  }

  if (!glyph) {
    spawnFloatNumber(scene, u, numText, color, {
      fontSize: `${baseFontSize}px`,
      stroke,
      strokeThickness,
    });
    return;
  }

  // Composite: number + small glyph, grouped so they float & fade together.
  const glyphFontSize = Math.round(baseFontSize * 0.7);
  const container = scene.add.container(u.sprite.x, u.sprite.y - 60).setDepth(100000);

  const numEl = scene.add
    .text(0, 0, numText, {
      fontFamily: FONT,
      fontSize: `${baseFontSize}px`,
      color,
      stroke,
      strokeThickness,
    })
    .setOrigin(1, 0.5);
  const glyphEl = scene.add
    .text(6, -2, glyph, {
      fontFamily: FONT,
      fontSize: `${glyphFontSize}px`,
      stroke: '#000000',
      strokeThickness: 3,
    })
    .setOrigin(0, 0.5);
  container.add([numEl, glyphEl]);

  // Shift container left so the combined element visually centers on sprite.
  const combinedWidth = numEl.width + 6 + glyphEl.width;
  container.x += combinedWidth / 2 - numEl.width;

  scene.tweens.add({
    targets: container,
    y: container.y - 50,
    alpha: 0,
    duration: 800,
    onComplete: () => container.destroy(),
  });
}
