import * as Phaser from 'phaser';
import { FONT, keyHintLabel } from '../../util/ui';
import { CLASSES } from '../../data/classes';
import { getLobbyState } from '../../state/lobby';

/**
 * Persistent top-right HUD showing the current escort and crew roster
 * in the walkable Lobby. Terminal-styled (dark green-black panel with
 * cyan-green bracket corners) to match the rest of the comms theme.
 *
 * Recruitment state updates live — re-render whenever LobbyState may
 * have changed (e.g. after an NPC dialogue closes). The HUD polls the
 * state via `refresh()`; LobbyScene should call it each frame (cheap)
 * or on a change event.
 */

const ESCORT_NAME = 'DR. VEY';

const PANEL_W = 260;
const PANEL_H = 180;
const MARGIN = 16;

export class CrewHud {
  private container: Phaser.GameObjects.Container;
  private rowTexts: Phaser.GameObjects.Text[] = [];
  private deployHint?: Phaser.GameObjects.Text;
  private lastSignature = '';

  constructor(scene: Phaser.Scene) {
    const { width } = scene.scale;
    const panelX = width - MARGIN - PANEL_W / 2;
    const panelY = MARGIN + PANEL_H / 2;

    this.container = scene.add.container(0, 0).setDepth(10000).setScrollFactor(0);

    const panel = scene.add
      .rectangle(panelX, panelY, PANEL_W, PANEL_H, 0x051410, 0.85)
      .setScrollFactor(0);
    this.container.add(panel);

    // L-bracket corners matching the terminal aesthetic.
    const brackets = scene.add.graphics().setScrollFactor(0);
    brackets.lineStyle(2, 0x8aff8a, 1);
    const armLen = 14;
    const left = panelX - PANEL_W / 2;
    const right = panelX + PANEL_W / 2;
    const top = panelY - PANEL_H / 2;
    const bot = panelY + PANEL_H / 2;
    brackets.beginPath();
    brackets.moveTo(left, top + armLen);
    brackets.lineTo(left, top);
    brackets.lineTo(left + armLen, top);
    brackets.strokePath();
    brackets.beginPath();
    brackets.moveTo(right - armLen, top);
    brackets.lineTo(right, top);
    brackets.lineTo(right, top + armLen);
    brackets.strokePath();
    brackets.beginPath();
    brackets.moveTo(left, bot - armLen);
    brackets.lineTo(left, bot);
    brackets.lineTo(left + armLen, bot);
    brackets.strokePath();
    brackets.beginPath();
    brackets.moveTo(right - armLen, bot);
    brackets.lineTo(right, bot);
    brackets.lineTo(right, bot - armLen);
    brackets.strokePath();
    this.container.add(brackets);

    // Section labels — static (don't change with state).
    const contentX = left + 16;
    const escortLabel = scene.add
      .text(contentX, top + 12, 'ESCORT', {
        fontFamily: FONT,
        fontSize: '14px',
        color: '#6aaa8a',
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    this.container.add(escortLabel);

    const escortValue = scene.add
      .text(contentX, top + 32, ESCORT_NAME, {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#ffcc66',
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    this.container.add(escortValue);

    const crewLabel = scene.add
      .text(contentX, top + 72, 'CREW', {
        fontFamily: FONT,
        fontSize: '14px',
        color: '#6aaa8a',
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    this.container.add(crewLabel);

    // Pre-create 3 crew rows (leader + 2 recruit slots) to update in refresh().
    for (let i = 0; i < 3; i++) {
      const row = scene.add
        .text(contentX, top + 94 + i * 22, '', {
          fontFamily: FONT,
          fontSize: '16px',
          color: '#a6ffc6',
        })
        .setOrigin(0, 0)
        .setScrollFactor(0);
      this.container.add(row);
      this.rowTexts.push(row);
    }

    // Deploy hint — sits BELOW the HUD panel so it doesn't crowd the
    // crew list. Only visible when the party is full (3 members).
    this.deployHint = scene.add
      .text(panelX, bot + 14, keyHintLabel('[E] DEPLOY'), {
        fontFamily: FONT,
        fontSize: '16px',
        color: '#8affaa',
        backgroundColor: '#05141099',
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(10000)
      .setVisible(false);
    // Subtle pulse to draw attention once the party is complete.
    scene.tweens.add({
      targets: this.deployHint,
      alpha: 0.55,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.refresh();
  }

  /**
   * Re-read LobbyState and update the crew rows if anything changed.
   * Cheap — no-op when the state signature matches the last render.
   */
  refresh(): void {
    const lobby = getLobbyState();
    const leader = lobby.leaderId ?? '';
    const recruits = Array.from(lobby.recruited);
    const signature = `${leader}|${recruits.join(',')}`;
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    // Primary identifier is the personal name (e.g. "KAEL"); role
    // (e.g. "Vanguard") appears in parens after, smaller feel.
    const leaderLabel = leader ? (CLASSES[leader]?.personName.toUpperCase() ?? '') : '';
    const rows = [
      { tag: '[LEAD]', value: leaderLabel, color: '#ffcc66' },
      this.slotForRecruit(recruits[0]),
      this.slotForRecruit(recruits[1]),
    ];
    rows.forEach((row, i) => {
      const rt = this.rowTexts[i];
      rt.setText(`${row.tag.padEnd(8, ' ')}${row.value}`);
      rt.setColor(row.color);
    });

    // Deploy hint visible iff party is full (leader + 2 recruits).
    const partyFull = !!leader && recruits.length >= 2;
    this.deployHint?.setVisible(partyFull);
  }

  private slotForRecruit(classId: string | undefined): {
    tag: string;
    value: string;
    color: string;
  } {
    if (!classId) return { tag: '[—]', value: 'EMPTY', color: '#4a8a6a' };
    const def = CLASSES[classId];
    const label = def ? def.personName.toUpperCase() : classId.toUpperCase();
    return { tag: '[R]', value: label, color: '#a6ffc6' };
  }

  destroy(): void {
    this.container.destroy();
  }
}
