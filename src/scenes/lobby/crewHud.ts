import * as Phaser from 'phaser';
import { FONT, isTouchDevice } from '../../util/ui';
import { CLASSES } from '../../data/classes';
import { getLobbyState } from '../../state/lobby';

/**
 * Persistent top-right HUD showing the current VIP and crew roster
 * in the walkable Lobby. Terminal-styled (dark green-black panel with
 * cyan-green bracket corners) to match the rest of the comms theme.
 *
 * Recruitment state updates live — re-render whenever LobbyState may
 * have changed (e.g. after an NPC dialogue closes). The HUD polls the
 * state via `refresh()`; LobbyScene should call it each frame (cheap)
 * or on a change event.
 *
 * On touch devices the panel and fonts scale up so the roster is
 * readable on a phone, and the [E] DEPLOY hint becomes a real
 * tappable button that fires `onDeploy` when the party is full.
 */

const VIP_NAME = 'DR. VEY';

export class CrewHud {
  private container: Phaser.GameObjects.Container;
  private rowTexts: Phaser.GameObjects.Text[] = [];
  private deployBtnBg?: Phaser.GameObjects.Rectangle;
  private deployBtnLabel?: Phaser.GameObjects.Text;
  private lastSignature = '';

  constructor(scene: Phaser.Scene, onDeploy?: () => void) {
    const isTouch = isTouchDevice();
    const PANEL_W = isTouch ? 360 : 260;
    const PANEL_H = isTouch ? 240 : 180;
    const MARGIN = 16;
    const labelSize = isTouch ? '20px' : '14px';
    const vipSize = isTouch ? '28px' : '20px';
    const rowSize = isTouch ? '22px' : '16px';
    const padTop = isTouch ? 16 : 12;
    const vipValueY = isTouch ? 44 : 32;
    const crewLabelY = isTouch ? 104 : 72;
    const crewRowY = isTouch ? 134 : 94;
    const rowStep = isTouch ? 30 : 22;

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
    const armLen = isTouch ? 18 : 14;
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
    const contentX = left + (isTouch ? 20 : 16);
    const vipLabel = scene.add
      .text(contentX, top + padTop, 'VIP', {
        fontFamily: FONT,
        fontSize: labelSize,
        color: '#6aaa8a',
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    this.container.add(vipLabel);

    const vipValue = scene.add
      .text(contentX, top + vipValueY, VIP_NAME, {
        fontFamily: FONT,
        fontSize: vipSize,
        color: '#ffcc66',
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    this.container.add(vipValue);

    const crewLabel = scene.add
      .text(contentX, top + crewLabelY, 'CREW', {
        fontFamily: FONT,
        fontSize: labelSize,
        color: '#6aaa8a',
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    this.container.add(crewLabel);

    // Pre-create 3 crew rows (leader + 2 recruit slots) to update in refresh().
    for (let i = 0; i < 3; i++) {
      const row = scene.add
        .text(contentX, top + crewRowY + i * rowStep, '', {
          fontFamily: FONT,
          fontSize: rowSize,
          color: '#a6ffc6',
        })
        .setOrigin(0, 0)
        .setScrollFactor(0);
      this.container.add(row);
      this.rowTexts.push(row);
    }

    // Deploy button — sits BELOW the HUD panel so it doesn't crowd the
    // crew list. Only visible when the party is full (3 members). On
    // touch it's a real tappable button that fires `onDeploy`; on
    // desktop the [E] hint is enough since the keyboard handler does
    // the work.
    const btnW = isTouch ? PANEL_W - 16 : 160;
    const btnH = isTouch ? 64 : 36;
    const btnY = bot + 18 + btnH / 2;
    const btnLabel = isTouch ? 'DEPLOY' : '[E] DEPLOY';
    const btnFontSize = isTouch ? '28px' : '16px';

    this.deployBtnBg = scene.add
      .rectangle(panelX, btnY, btnW, btnH, 0x0a3018, 0.95)
      .setStrokeStyle(2, 0x8aff8a, 1)
      .setScrollFactor(0)
      .setDepth(10000)
      .setVisible(false);
    if (isTouch && onDeploy) {
      this.deployBtnBg.setInteractive({ useHandCursor: true }).on('pointerup', () => {
        if (!this.deployBtnBg?.visible) return;
        onDeploy();
      });
    }
    this.container.add(this.deployBtnBg);

    this.deployBtnLabel = scene.add
      .text(panelX, btnY, btnLabel, {
        fontFamily: FONT,
        fontSize: btnFontSize,
        color: '#8affaa',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(10001)
      .setVisible(false);
    this.container.add(this.deployBtnLabel);

    // Subtle pulse to draw attention once the party is complete.
    scene.tweens.add({
      targets: [this.deployBtnBg, this.deployBtnLabel],
      alpha: 0.6,
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

    // Deploy button visible iff party is full (leader + 2 recruits).
    const partyFull = !!leader && recruits.length >= 2;
    this.deployBtnBg?.setVisible(partyFull);
    this.deployBtnLabel?.setVisible(partyFull);
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
