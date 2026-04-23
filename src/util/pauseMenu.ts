import * as Phaser from 'phaser';
import { hasRun, endRun } from '../state/run';
import { resetLobbyForNextRun } from '../state/lobby';
import { FONT } from './ui';
import { playSfx } from './audio';
import { buildAudioSettingsPanel } from './audioSettingsPanel';

/**
 * Shared ESC menu for non-title, non-combat scenes. CombatScene still has its
 * own bespoke pause menu (with turn-state-aware pause behavior).
 */

export interface PauseMenuOptions {
  /** Show "Abandon run" row. Defaults to hasRun(). */
  canAbandon?: boolean;
  /** Called when the player confirms Abandon run. Must handle scene transition. */
  onAbandon?: () => void;
  /** Scene key to load when "Return to title" is chosen. Defaults to 'Title'. */
  titleSceneKey?: string;
  /** Returning true from this callback blocks ESC from opening the
   *  pause menu — e.g. when an NPC dialogue modal owns its own ESC. */
  shouldBlockEsc?: () => boolean;
}

type RowId = 'resume' | 'settings' | 'abandon' | 'quit' | 'back';

interface Row {
  id: RowId;
  text: Phaser.GameObjects.Text;
  chevron: Phaser.GameObjects.Text;
  activate: () => void;
}

interface OpenMenu {
  scene: Phaser.Scene;
  container: Phaser.GameObjects.Container;
  rows: Row[];
  selectedIndex: number;
  cleanupKeyHandlers: () => void;
  opts: PauseMenuOptions;
  inSettings: boolean;
}

const ROW_FONT_SIZE = '32px';
const CHEVRON_FONT_SIZE = '28px';
const ROW_SPACING = 56;

let current: OpenMenu | null = null;

export function isPauseMenuOpen(): boolean {
  return current !== null;
}

/**
 * Register a scene keydown handler that automatically no-ops while the
 * pause menu is open. Use this anywhere a confirm key (ENTER/SPACE/E) would
 * otherwise also trigger a scene transition — without the guard, the key
 * fires BOTH the scene handler AND the pause menu's row activator, which
 * makes "Return to title" (and other menu actions) unreliable.
 */
export function onSceneKeyWhenUnpaused(
  scene: Phaser.Scene,
  key: string,
  handler: () => void,
): void {
  scene.input.keyboard?.on(`keydown-${key}`, () => {
    if (isPauseMenuOpen()) return;
    handler();
  });
}

export function closePauseMenu(): void {
  if (!current) return;
  current.cleanupKeyHandlers();
  current.container.destroy();
  current = null;
}

export function openPauseMenu(scene: Phaser.Scene, opts: PauseMenuOptions = {}): void {
  if (current) return;
  buildMainMenu(scene, opts);
}

/**
 * Installs the standard ESC toggle: press opens the pause menu; pressing ESC
 * again while it's open closes it. Wires in one line from each scene that
 * wants the shared menu behavior.
 */
export function installPauseMenuEsc(scene: Phaser.Scene, opts: PauseMenuOptions = {}): void {
  scene.input.keyboard?.on('keydown-ESC', () => {
    if (isPauseMenuOpen()) closePauseMenu();
    else if (!opts.shouldBlockEsc?.()) openPauseMenu(scene, opts);
  });
}

function buildMainMenu(scene: Phaser.Scene, opts: PauseMenuOptions): void {
  // Rebuild: close old menu state cleanly before constructing new.
  if (current) {
    current.cleanupKeyHandlers();
    current.container.destroy();
    current = null;
  }

  const { width, height } = scene.scale;
  // setScrollFactor(0) pins the menu to the camera — without it, scenes that
  // scroll (like the walkable lobby) render the menu at world coords and it
  // appears off-screen.
  const container = scene.add.container(0, 0).setDepth(100000).setScrollFactor(0);

  const backdrop = scene.add
    .rectangle(width / 2, height / 2, width, height, 0x000000, 0.78)
    .setScrollFactor(0)
    .setInteractive();
  container.add(backdrop);

  const canAbandon = opts.canAbandon ?? hasRun();
  const titleKey = opts.titleSceneKey ?? 'Title';

  const rowSpecs: Array<{ id: RowId; label: string; activate: () => void }> = [
    {
      id: 'resume',
      label: 'Resume',
      activate: () => {
        playSfx(scene, 'sfx-menu-cancel', 0.4);
        closePauseMenu();
      },
    },
    {
      id: 'settings',
      label: 'Audio settings',
      activate: () => {
        playSfx(scene, 'sfx-menu-confirm', 0.4);
        buildSettingsSubmenu(scene, opts);
      },
    },
  ];

  if (canAbandon) {
    // Abandoning a run drops the player back at the Lobby so they can
    // regroup and try a different route / crew without being forced
    // to re-pick a leader. "Return to title" (below) is the separate
    // full-reset path. Force-stops every mid-run scene so nothing
    // leaks under the new Lobby render.
    const onAbandonAction =
      opts.onAbandon ??
      ((): void => {
        endRun();
        resetLobbyForNextRun();
        const sm = scene.scene.manager;
        for (const key of [
          'PartySelectTerminal',
          'Combat',
          'Route',
          'RouteMap',
          'Journey',
          'Rest',
          'RunComplete',
        ]) {
          if (sm.isActive(key) || sm.isPaused(key) || sm.isSleeping(key)) sm.stop(key);
        }
        scene.scene.start('Lobby');
      });
    rowSpecs.push({
      id: 'abandon',
      label: 'Abandon run',
      activate: () => {
        playSfx(scene, 'sfx-menu-confirm', 0.4);
        closePauseMenu();
        onAbandonAction();
      },
    });
  }

  rowSpecs.push({
    id: 'quit',
    label: 'Return to title',
    activate: () => {
      playSfx(scene, 'sfx-menu-confirm', 0.4);
      closePauseMenu();
      scene.scene.start(titleKey);
    },
  });

  const rows = createRows(scene, container, width, height, rowSpecs);
  current = {
    scene,
    container,
    rows,
    selectedIndex: -1,
    cleanupKeyHandlers: wireKeyHandlers(scene),
    opts,
    inSettings: false,
  };

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    if (current?.scene === scene) closePauseMenu();
  });
}

function buildSettingsSubmenu(scene: Phaser.Scene, opts: PauseMenuOptions): void {
  if (current) {
    current.cleanupKeyHandlers();
    current.container.destroy();
    current = null;
  }

  const { width, height } = scene.scale;
  const container = scene.add.container(0, 0).setDepth(100000).setScrollFactor(0);

  const backdrop = scene.add
    .rectangle(width / 2, height / 2, width, height, 0x000000, 0.78)
    .setScrollFactor(0)
    .setInteractive();
  container.add(backdrop);

  buildAudioSettingsPanel(scene, container, width / 2, height / 2 - 40);

  const rows = createRows(scene, container, width, height, [
    {
      id: 'back',
      label: 'Back',
      activate: () => {
        playSfx(scene, 'sfx-menu-cancel', 0.4);
        buildMainMenu(scene, opts);
      },
    },
  ]);
  // Push the single Back row to the bottom.
  rows[0].text.setY(height / 2 + 160);
  rows[0].chevron.setY(height / 2 + 160);
  rows[0].chevron.setX(rows[0].text.x - rows[0].text.width / 2 - 18);

  current = {
    scene,
    container,
    rows,
    selectedIndex: -1,
    cleanupKeyHandlers: wireKeyHandlers(scene),
    opts,
    inSettings: true,
  };
}

function createRows(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  width: number,
  height: number,
  specs: Array<{ id: RowId; label: string; activate: () => void }>,
): Row[] {
  const rows: Row[] = [];
  const totalHeight = (specs.length - 1) * ROW_SPACING;
  const startY = height / 2 - totalHeight / 2;

  specs.forEach((spec, i) => {
    const y = startY + i * ROW_SPACING;
    const text = scene.add
      .text(width / 2, y, spec.label, {
        fontFamily: FONT,
        fontSize: ROW_FONT_SIZE,
        color: '#888888',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    const chevron = scene.add
      .text(width / 2 - text.width / 2 - 18, y, '\u25B6', {
        fontFamily: FONT,
        fontSize: CHEVRON_FONT_SIZE,
        color: '#8aff8a',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(1, 0.5)
      .setVisible(false)
      .setScrollFactor(0);

    const row: Row = { id: spec.id, text, chevron, activate: spec.activate };

    text.setInteractive({ useHandCursor: true });
    text.on('pointerover', () => setSelected(rows.indexOf(row)));
    text.on('pointerdown', () => {
      setSelected(rows.indexOf(row));
      row.activate();
    });

    container.add([text, chevron]);
    rows.push(row);
  });

  return rows;
}

function setSelected(index: number): void {
  if (!current) return;
  if (index >= current.rows.length) return;
  if (index !== current.selectedIndex && index >= 0) {
    playSfx(current.scene, 'sfx-menu-cancel', 0.3);
  }
  current.selectedIndex = index;
  current.rows.forEach((r, i) => {
    const active = i === index;
    r.text.setColor(active ? '#e6e6e6' : '#888888');
    r.chevron.setVisible(active);
    r.chevron.setX(r.text.x - r.text.width / 2 - 18);
  });
}

function moveSelection(delta: number): void {
  if (!current) return;
  const n = current.rows.length;
  if (n === 0) return;
  if (current.selectedIndex < 0) {
    setSelected(0);
    return;
  }
  setSelected((current.selectedIndex + delta + n) % n);
}

function activateSelected(): void {
  if (!current) return;
  if (current.selectedIndex < 0) {
    setSelected(0);
    return;
  }
  current.rows[current.selectedIndex]?.activate();
}

function wireKeyHandlers(scene: Phaser.Scene): () => void {
  const kb = scene.input.keyboard;
  const onUp = (): void => moveSelection(-1);
  const onDown = (): void => moveSelection(1);
  const onConfirm = (): void => activateSelected();

  kb?.on('keydown-UP', onUp);
  kb?.on('keydown-W', onUp);
  kb?.on('keydown-DOWN', onDown);
  kb?.on('keydown-S', onDown);
  kb?.on('keydown-ENTER', onConfirm);
  kb?.on('keydown-SPACE', onConfirm);
  kb?.on('keydown-E', onConfirm);

  return () => {
    kb?.off('keydown-UP', onUp);
    kb?.off('keydown-W', onUp);
    kb?.off('keydown-DOWN', onDown);
    kb?.off('keydown-S', onDown);
    kb?.off('keydown-ENTER', onConfirm);
    kb?.off('keydown-SPACE', onConfirm);
    kb?.off('keydown-E', onConfirm);
  };
}
