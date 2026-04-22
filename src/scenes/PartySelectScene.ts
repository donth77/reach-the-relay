import * as Phaser from 'phaser';
import { CLASSES, CLASS_ORDER } from '../data/classes';
import { FONT } from '../util/ui';
import { playMusicPool } from '../util/music';
import { playSfx } from '../util/audio';
import { installPauseMenuEsc } from '../util/pauseMenu';
import { getLobbyState, toggleRecruit, getResolvedParty } from '../state/lobby';

/**
 * Full-screen party picker. The leader is locked (chosen on LeaderSelectScene)
 * and can't be toggled. The player picks 2 more companions from the remaining
 * 4 classes. Invoked from the lobby terminal (or as a keyboard shortcut).
 *
 * On confirm → `scene.start('Route', { party })`.
 *
 * Escape → back to Lobby with current selections preserved in LobbyState.
 */
export class PartySelectScene extends Phaser.Scene {
  private portraits = new Map<string, Phaser.GameObjects.Image>();
  private selectionHints = new Map<string, Phaser.GameObjects.Rectangle>();
  private leaderBadges = new Map<string, Phaser.GameObjects.Text>();
  private confirmButton?: Phaser.GameObjects.Text;
  private statusText?: Phaser.GameObjects.Text;

  constructor() {
    super('PartySelect');
  }

  create(): void {
    const lobby = getLobbyState();
    if (!lobby.leaderId) {
      // Safety — can't pick companions without a leader.
      this.scene.start('LeaderSelect');
      return;
    }

    this.portraits.clear();
    this.selectionHints.clear();
    this.leaderBadges.clear();

    playMusicPool(this, ['music-lobby-theme'], 0.35);

    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#1a1a22');

    this.add
      .text(width / 2, 80, 'ASSEMBLE THE PARTY', {
        fontFamily: FONT,
        fontSize: '56px',
        color: '#e6e6e6',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 140, `Leader: ${CLASSES[lobby.leaderId].name} — recruit 2 companions`, {
        fontFamily: FONT,
        fontSize: '22px',
        color: '#888888',
      })
      .setOrigin(0.5);

    const rosterSpacing = 220;
    const rosterStartX = width / 2 - (rosterSpacing * (CLASS_ORDER.length - 1)) / 2;
    const rosterY = height / 2 - 20;

    CLASS_ORDER.forEach((key, i) => {
      const x = rosterStartX + i * rosterSpacing;
      const def = CLASSES[key];
      const isLeader = key === lobby.leaderId;

      const hint = this.add
        .rectangle(x, rosterY, 140, 200, 0x2a5a2a, 0)
        .setStrokeStyle(3, 0x55ff55, 0);
      this.selectionHints.set(key, hint);

      const portrait = this.add.image(x, rosterY - 20, `${key}-south`).setScale(2.4);
      if (!isLeader) {
        portrait.setInteractive({ useHandCursor: true });
        portrait.on('pointerup', () => this.onPortraitClick(key));
      }
      this.portraits.set(key, portrait);

      if (isLeader) {
        const badge = this.add
          .text(x, rosterY - 120, '★ LEADER', {
            fontFamily: FONT,
            fontSize: '16px',
            color: '#ffdd55',
          })
          .setOrigin(0.5);
        this.leaderBadges.set(key, badge);
      }

      this.add
        .text(x, rosterY + 65, def.name, {
          fontFamily: FONT,
          fontSize: '20px',
          color: '#cccccc',
        })
        .setOrigin(0.5);

      const statLine = `HP ${def.hp}  SPD ${def.speed}${def.mp > 0 ? `  MP ${def.mp}` : ''}`;
      this.add
        .text(x, rosterY + 90, statLine, {
          fontFamily: FONT,
          fontSize: '14px',
          color: '#888888',
        })
        .setOrigin(0.5);
    });

    this.statusText = this.add
      .text(width / 2, height - 160, this.statusMessage(), {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#aaaaaa',
      })
      .setOrigin(0.5);

    this.confirmButton = this.add
      .text(width / 2, height - 100, '[ Begin mission ]', {
        fontFamily: FONT,
        fontSize: '32px',
        color: '#444444',
        backgroundColor: '#222222',
        padding: { x: 20, y: 10 },
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height - 50, '[ESC] back to Greenhouse', {
        fontFamily: FONT,
        fontSize: '16px',
        color: '#666666',
      })
      .setOrigin(0.5);

    this.input.keyboard?.on('keydown-ESC', () => {
      playSfx(this, 'sfx-menu-cancel', 0.3);
      this.scene.start('Lobby');
    });

    this.refreshSelectionVisuals();
    this.refreshConfirmButton();

    installPauseMenuEsc(this);
  }

  private onPortraitClick(key: string): void {
    const lobby = getLobbyState();
    const isRecruited = lobby.recruited.has(key);
    // Cap at 2 companions — ignore clicks that would push over the limit.
    if (!isRecruited && lobby.recruited.size >= 2) return;
    playSfx(this, 'sfx-menu-cancel', 0.3);
    toggleRecruit(key);
    this.refreshSelectionVisuals();
    this.refreshConfirmButton();
  }

  private refreshSelectionVisuals(): void {
    const lobby = getLobbyState();
    for (const key of CLASS_ORDER) {
      const hint = this.selectionHints.get(key);
      const portrait = this.portraits.get(key);
      if (!hint || !portrait) continue;
      const isLeader = key === lobby.leaderId;
      const isRecruited = lobby.recruited.has(key);
      if (isLeader) {
        // Leader: locked in, gold frame.
        hint.setFillStyle(0x5a4a1a, 0.3);
        hint.setStrokeStyle(3, 0xffdd55, 1);
        portrait.clearTint();
      } else if (isRecruited) {
        hint.setFillStyle(0x2a5a2a, 0.4);
        hint.setStrokeStyle(3, 0x8aff8a, 1);
        portrait.clearTint();
      } else {
        hint.setFillStyle(0x2a5a2a, 0);
        hint.setStrokeStyle(3, 0x8aff8a, 0);
        portrait.setTint(0x888888);
      }
    }
  }

  private statusMessage(): string {
    const party = getResolvedParty();
    return `Selected ${party.length} / 3`;
  }

  private refreshConfirmButton(): void {
    if (!this.confirmButton || !this.statusText) return;
    this.statusText.setText(this.statusMessage());
    const ready = getResolvedParty().length === 3;
    if (ready) {
      this.confirmButton
        .setColor('#8aff8a')
        .setBackgroundColor('#2a3a2a')
        .setInteractive({ useHandCursor: true })
        .removeAllListeners()
        .on('pointerup', () => {
          playSfx(this, 'sfx-menu-confirm', 0.5);
          this.scene.start('Route', { party: getResolvedParty() });
        });
    } else {
      this.confirmButton.setColor('#444444').setBackgroundColor('#222222').disableInteractive();
    }
  }
}
