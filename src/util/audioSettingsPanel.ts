import * as Phaser from 'phaser';
import { FONT } from './ui';
import { getVol, setVol, type AudioCategory } from './audio';

/**
 * Builds a stack of master / music / sfx volume sliders into the given
 * container, centered on (cx, cy). Used by both CombatScene's pause-menu
 * audio sub-panel and the shared pause-menu settings sub-panel.
 */
export function buildAudioSettingsPanel(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  cx: number,
  cy: number,
): void {
  const ROW_SPACING = 70;
  const rows: Array<{ label: string; cat: AudioCategory }> = [
    { label: 'MASTER', cat: 'master' },
    { label: 'MUSIC', cat: 'music' },
    { label: 'SFX', cat: 'sfx' },
  ];

  rows.forEach((row, i) => {
    const y = cy + (i - (rows.length - 1) / 2) * ROW_SPACING;
    addSlider(scene, container, cx, y, row.label, row.cat);
  });
}

function addSlider(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  cx: number,
  cy: number,
  label: string,
  category: AudioCategory,
): void {
  const TRACK_WIDTH = 300;
  const TRACK_HEIGHT = 10;
  const KNOB_RADIUS = 12;

  const labelText = scene.add
    .text(cx - TRACK_WIDTH / 2 - 100, cy, label, {
      fontFamily: FONT,
      fontSize: '22px',
      color: '#e6e6e6',
    })
    .setOrigin(0.5);

  const track = scene.add.rectangle(cx, cy, TRACK_WIDTH, TRACK_HEIGHT, 0x3a3a3a, 1);
  const fill = scene.add
    .rectangle(cx - TRACK_WIDTH / 2, cy, 0, TRACK_HEIGHT, 0x8acfff, 1)
    .setOrigin(0, 0.5);
  const knob = scene.add.circle(cx, cy, KNOB_RADIUS, 0xe6e6e6, 1).setStrokeStyle(2, 0x111111);
  const valueText = scene.add
    .text(cx + TRACK_WIDTH / 2 + 60, cy, '', {
      fontFamily: FONT,
      fontSize: '20px',
      color: '#aaaaaa',
    })
    .setOrigin(0.5);

  const refresh = (v: number): void => {
    valueText.setText(`${Math.round(v * 100)}%`);
    fill.width = TRACK_WIDTH * v;
    knob.x = cx - TRACK_WIDTH / 2 + TRACK_WIDTH * v;
  };
  refresh(getVol(scene, category));

  const hit = scene.add
    .rectangle(cx, cy, TRACK_WIDTH + KNOB_RADIUS * 2, 44, 0x000000, 0)
    .setInteractive({ useHandCursor: true, draggable: true });

  const setFromPointer = (pointer: Phaser.Input.Pointer): void => {
    const local = pointer.x - (cx - TRACK_WIDTH / 2);
    const v = Math.max(0, Math.min(1, local / TRACK_WIDTH));
    setVol(scene, category, v);
    refresh(v);
  };
  hit.on('pointerdown', setFromPointer);
  hit.on('drag', (pointer: Phaser.Input.Pointer) => setFromPointer(pointer));

  container.add([labelText, track, fill, knob, valueText, hit]);
}
