import * as Phaser from 'phaser';
import { FONT } from './ui';
import { getVol, setVol, type AudioCategory } from './audio';
import { getAtbSpeed, setAtbSpeed, ATB_SPEED_MIN, ATB_SPEED_MAX } from './combatSettings';

interface SliderRow {
  label: string;
  min: number;
  max: number;
  get: () => number;
  set: (v: number) => void;
  format: (v: number) => string;
}

interface Section {
  title: string;
  rows: SliderRow[];
}

/**
 * Builds the settings panel into the given container, centered on (cx, cy).
 * Sliders are organized into sections with a header above each group.
 *
 * The export name is historical (`buildAudioSettingsPanel`) — the panel
 * has since grown beyond audio. Kept to avoid touching every importer.
 */
export function buildAudioSettingsPanel(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  cx: number,
  cy: number,
): void {
  const ROW_SPACING = 60;
  const SECTION_HEADER_GAP = 42; // header to first row of its section
  const SECTION_GAP = 60; // last row of prev section to next section header

  const audioRow = (label: string, cat: AudioCategory): SliderRow => ({
    label,
    min: 0,
    max: 1,
    get: () => getVol(scene, cat),
    set: (v) => setVol(scene, cat, v),
    format: (v) => `${Math.round(v * 100)}%`,
  });

  const sections: Section[] = [
    {
      title: 'VOLUME',
      rows: [audioRow('MASTER', 'master'), audioRow('MUSIC', 'music'), audioRow('SFX', 'sfx')],
    },
    {
      title: 'GAMEPLAY',
      rows: [
        {
          label: 'ATB SPEED',
          min: ATB_SPEED_MIN,
          max: ATB_SPEED_MAX,
          get: () => getAtbSpeed(),
          set: (v) => setAtbSpeed(v),
          format: (v) => `${v.toFixed(2).replace(/0$/, '').replace(/\.$/, '')}×`,
        },
      ],
    },
  ];

  // Compute total content height so we can vertically center the stack on cy.
  let totalH = 0;
  sections.forEach((s, i) => {
    if (i > 0) totalH += SECTION_GAP;
    totalH += SECTION_HEADER_GAP; // header + gap to first row
    totalH += (s.rows.length - 1) * ROW_SPACING;
  });

  let y = cy - totalH / 2;
  sections.forEach((section, sIdx) => {
    if (sIdx > 0) y += SECTION_GAP;
    addSectionHeader(scene, container, cx, y, section.title);
    y += SECTION_HEADER_GAP;
    section.rows.forEach((row, rIdx) => {
      if (rIdx > 0) y += ROW_SPACING;
      addSlider(scene, container, cx, y, row);
    });
  });
}

function addSectionHeader(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  cx: number,
  cy: number,
  title: string,
): void {
  const TRACK_WIDTH = 300;
  // Left-aligned to the same column as the slider label so the section feels
  // anchored above its rows.
  const text = scene.add
    .text(cx - TRACK_WIDTH / 2 - 100, cy, title, {
      fontFamily: FONT,
      fontSize: '20px',
      color: '#8aff8a',
    })
    .setOrigin(0.5);
  // Thin underline rule across the panel width — visually delimits the
  // section without being heavy.
  const rule = scene.add.rectangle(cx, cy + 16, TRACK_WIDTH + 200, 1, 0x2a4a2a, 1).setOrigin(0.5);
  container.add([text, rule]);
}

function addSlider(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  cx: number,
  cy: number,
  row: SliderRow,
): void {
  const TRACK_WIDTH = 300;
  const TRACK_HEIGHT = 10;
  const KNOB_RADIUS = 12;

  const labelText = scene.add
    .text(cx - TRACK_WIDTH / 2 - 110, cy, row.label, {
      fontFamily: FONT,
      fontSize: '24px',
      color: '#e6e6e6',
    })
    .setOrigin(0.5);

  const track = scene.add.rectangle(cx, cy, TRACK_WIDTH, TRACK_HEIGHT, 0x3a3a3a, 1);
  const fill = scene.add
    .rectangle(cx - TRACK_WIDTH / 2, cy, 0, TRACK_HEIGHT, 0x8acfff, 1)
    .setOrigin(0, 0.5);
  const knob = scene.add.circle(cx, cy, KNOB_RADIUS, 0xe6e6e6, 1).setStrokeStyle(2, 0x111111);
  const valueText = scene.add
    .text(cx + TRACK_WIDTH / 2 + 65, cy, '', {
      fontFamily: FONT,
      fontSize: '22px',
      color: '#cfcfcf',
    })
    .setOrigin(0.5);

  // Convert a value in [min, max] to a fraction in [0, 1] for rendering.
  const toFrac = (v: number): number => (v - row.min) / (row.max - row.min);
  // Convert a fraction in [0, 1] back to a value in [min, max].
  const fromFrac = (f: number): number => row.min + (row.max - row.min) * f;

  const refresh = (v: number): void => {
    valueText.setText(row.format(v));
    const f = Math.max(0, Math.min(1, toFrac(v)));
    fill.width = TRACK_WIDTH * f;
    knob.x = cx - TRACK_WIDTH / 2 + TRACK_WIDTH * f;
  };
  refresh(row.get());

  const hit = scene.add
    .rectangle(cx, cy, TRACK_WIDTH + KNOB_RADIUS * 2, 44, 0x000000, 0)
    .setInteractive({ useHandCursor: true, draggable: true });

  const setFromPointer = (pointer: Phaser.Input.Pointer): void => {
    const local = pointer.x - (cx - TRACK_WIDTH / 2);
    const f = Math.max(0, Math.min(1, local / TRACK_WIDTH));
    const v = fromFrac(f);
    row.set(v);
    refresh(v);
  };
  hit.on('pointerdown', setFromPointer);
  hit.on('drag', (pointer: Phaser.Input.Pointer) => setFromPointer(pointer));

  container.add([labelText, track, fill, knob, valueText, hit]);
}
