import * as Phaser from 'phaser';
import { CLASSES, CLASS_ORDER } from '../data/classes';

const FONT = 'Silkscreen, monospace';
const REQUIRED_PARTY_SIZE = 3;

export class LobbyScene extends Phaser.Scene {
  private selected = new Set<string>();
  private portraits = new Map<string, Phaser.GameObjects.Image>();
  private selectionHints = new Map<string, Phaser.GameObjects.Rectangle>();
  private enterButton?: Phaser.GameObjects.Text;
  private statusText?: Phaser.GameObjects.Text;

  constructor() {
    super('Lobby');
  }

  create(): void {
    this.selected.clear();
    this.portraits.clear();
    this.selectionHints.clear();

    const MAIN_THEME = 'music-main-theme';
    const currentKey = this.registry.get('currentRouteMusic') as string | undefined;
    if (currentKey !== MAIN_THEME) {
      // Stop any music currently playing (catches stale route/boss music too).
      for (const s of this.sound.getAllPlaying()) {
        if (s.key?.startsWith('music-')) s.stop();
      }
      this.sound.play(MAIN_THEME, { loop: true, volume: 0.25 });
      this.registry.set('currentRouteMusic', MAIN_THEME);
    }

    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#1a1a22');

    this.add
      .text(width / 2, 80, 'THE SIGNAL', {
        fontFamily: FONT,
        fontSize: '72px',
        color: '#e6e6e6',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 140, 'Greenhouse commune — pick 3 adventurers to escort Dr. Vey', {
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

      const hint = this.add
        .rectangle(x, rosterY, 140, 200, 0x2a5a2a, 0)
        .setStrokeStyle(3, 0x55ff55, 0);
      this.selectionHints.set(key, hint);

      const portrait = this.add
        .image(x, rosterY - 20, `${key}-south`)
        .setScale(2.4)
        .setInteractive({ useHandCursor: true });
      portrait.on('pointerup', () => this.toggleSelect(key));
      this.portraits.set(key, portrait);

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
      .text(width / 2, height - 140, this.statusMessage(), {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#aaaaaa',
      })
      .setOrigin(0.5);

    this.enterButton = this.add
      .text(width / 2, height - 80, '[ Begin escort ]', {
        fontFamily: FONT,
        fontSize: '32px',
        color: '#444444',
        backgroundColor: '#222222',
        padding: { x: 20, y: 10 },
      })
      .setOrigin(0.5);

    this.refreshEnterButton();
  }

  private toggleSelect(key: string): void {
    if (this.selected.has(key)) {
      this.selected.delete(key);
    } else if (this.selected.size < REQUIRED_PARTY_SIZE) {
      this.selected.add(key);
    }
    this.refreshSelectionVisuals();
    this.refreshEnterButton();
  }

  private refreshSelectionVisuals(): void {
    for (const key of CLASS_ORDER) {
      const hint = this.selectionHints.get(key);
      const portrait = this.portraits.get(key);
      if (!hint || !portrait) continue;
      if (this.selected.has(key)) {
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
    return `Selected ${this.selected.size} / ${REQUIRED_PARTY_SIZE}`;
  }

  private refreshEnterButton(): void {
    if (!this.enterButton || !this.statusText) return;
    this.statusText.setText(this.statusMessage());
    const ready = this.selected.size === REQUIRED_PARTY_SIZE;
    if (ready) {
      this.enterButton
        .setColor('#8aff8a')
        .setBackgroundColor('#2a3a2a')
        .setInteractive({ useHandCursor: true })
        .removeAllListeners()
        .on('pointerup', () => {
          this.sound.play('sfx-menu-confirm', { volume: 0.5 });
          this.scene.start('Route', { party: Array.from(this.selected) });
        });
    } else {
      this.enterButton.setColor('#444444').setBackgroundColor('#222222').disableInteractive();
    }
  }
}
