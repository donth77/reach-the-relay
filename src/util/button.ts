import * as Phaser from 'phaser';
import { FONT } from './ui';

/**
 * Config for `createHoverButton`. Only `x`, `y`, `label`, and `onClick`
 * are required — everything else has sensible defaults (matched to the
 * "green pill" style used across the pause menu, RestScene, etc.).
 */
export interface HoverButtonConfig {
  x: number;
  y: number;
  label: string;
  onClick: () => void;
  fontSize?: string;
  idleColor?: string;
  hoverColor?: string;
  idleBg?: string;
  hoverBg?: string;
  padding?: { x: number; y: number };
  /** Text alignment inside the pill. Defaults to 'center'. */
  align?: 'left' | 'center' | 'right';
  /** Passed through to `setOrigin`. Defaults to (0.5, 0.5). */
  originX?: number;
  originY?: number;
  /** Optional depth. Leave undefined to use Phaser's default. */
  depth?: number;
  /** When true, button ignores camera scroll. Defaults to false. */
  scrollFactorZero?: boolean;
}

/**
 * Shared button factory. Creates a Phaser Text with background pill,
 * hand cursor, pointer-hover color swap, and a pointerup handler.
 * Returns the Text so callers can still reposition, hide, or add
 * extra listeners (e.g. keyboard activation).
 *
 * Replaces ~10 copies of the same boilerplate across scenes. Extracted
 * here rather than inlined so:
 *   - Hover transitions stay consistent visually.
 *   - New buttons default to the terminal-green aesthetic without
 *     requiring callers to remember the exact hex codes.
 *   - Keyboard / a11y wiring can be added in ONE place later if needed.
 */
export function createHoverButton(
  scene: Phaser.Scene,
  cfg: HoverButtonConfig,
): Phaser.GameObjects.Text {
  const idleColor = cfg.idleColor ?? '#8aff8a';
  const hoverColor = cfg.hoverColor ?? '#ffffff';
  const idleBg = cfg.idleBg ?? '#2a3a2a';
  const hoverBg = cfg.hoverBg ?? '#3f5a3f';
  const padding = cfg.padding ?? { x: 24, y: 10 };

  const btn = scene.add
    .text(cfg.x, cfg.y, cfg.label, {
      fontFamily: FONT,
      fontSize: cfg.fontSize ?? '28px',
      color: idleColor,
      backgroundColor: idleBg,
      padding,
      align: cfg.align ?? 'center',
    })
    .setOrigin(cfg.originX ?? 0.5, cfg.originY ?? 0.5)
    .setInteractive({ useHandCursor: true });

  if (cfg.depth !== undefined) btn.setDepth(cfg.depth);
  if (cfg.scrollFactorZero) btn.setScrollFactor(0);

  btn.on('pointerover', () => {
    btn.setColor(hoverColor);
    btn.setBackgroundColor(hoverBg);
  });
  btn.on('pointerout', () => {
    btn.setColor(idleColor);
    btn.setBackgroundColor(idleBg);
  });
  btn.on('pointerup', cfg.onClick);

  return btn;
}

/**
 * Preset: the gold pill used for leaderboard / submit / victory
 * secondary actions. Inline this when a call site needs the full
 * config, or use it as the `...GOLD_BUTTON_STYLE` spread for the
 * default color/bg pair.
 */
export const GOLD_BUTTON_STYLE = {
  idleColor: '#ffdd55',
  hoverColor: '#ffffff',
  idleBg: '#3a3a1a',
  hoverBg: '#5a5a2a',
} as const;

/**
 * Preset: the dim-gray cancel pill. Used for BACK / skip actions
 * that shouldn't visually compete with the primary action.
 */
export const NEUTRAL_BUTTON_STYLE = {
  idleColor: '#aaaaaa',
  hoverColor: '#ffffff',
  idleBg: '#2a2a2a',
  hoverBg: '#3f3f3f',
} as const;
