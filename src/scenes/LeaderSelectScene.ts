import * as Phaser from 'phaser';
import { CLASSES, CLASS_ORDER } from '../data/classes';
import { FONT } from '../util/ui';
import { playMusicPool } from '../util/music';
import { playSfx } from '../util/audio';
import { installPauseMenuEsc, onSceneKeyWhenUnpaused } from '../util/pauseMenu';
import { setLeader, getLobbyState } from '../state/lobby';
import { CLASS_ROLE_BLURBS } from '../data/classBlurbs';

/**
 * Cinematic single-leader pick. One large portrait at a time, cycle with
 * arrow keys or on-screen chevrons. Each class gets a short role blurb so
 * the decision feels weighty. Distinct visual from PartySelectScene, which
 * uses a 5-portrait row and handles companion-recruit.
 *
 * Flow: confirm leader → write to LobbyState → start walkable LobbyScene.
 */

// Role-focused blurbs now live in src/data/classBlurbs.ts (shared with
// the lobby NPC dialogue modal).
const CLASS_BLURBS = CLASS_ROLE_BLURBS;

export class LeaderSelectScene extends Phaser.Scene {
  private currentIdx = 0;
  private portrait?: Phaser.GameObjects.Image;
  private nameText?: Phaser.GameObjects.Text;
  private roleText?: Phaser.GameObjects.Text;
  private statsText?: Phaser.GameObjects.Text;
  private blurbText?: Phaser.GameObjects.Text;
  private indicatorText?: Phaser.GameObjects.Text;

  constructor() {
    super('LeaderSelect');
  }

  create(): void {
    // Restore previous pick if the player already chose once and came back.
    const prior = getLobbyState().leaderId;
    if (prior) {
      const i = CLASS_ORDER.indexOf(prior as (typeof CLASS_ORDER)[number]);
      if (i >= 0) this.currentIdx = i;
    } else {
      this.currentIdx = 0;
    }

    playMusicPool(this, ['music-lobby-theme'], 0.35);

    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#0b0d14');

    this.drawAtmosphere(width, height);

    // Header
    this.add
      .text(width / 2, 36, 'CHOOSE YOUR LEADER', {
        fontFamily: FONT,
        fontSize: '44px',
        color: '#e6e6e6',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 82, 'The face of the crew — you walk in their shoes', {
        fontFamily: FONT,
        fontSize: '18px',
        color: '#888888',
      })
      .setOrigin(0.5);

    // Large portrait centered in the upper half
    const portraitY = height * 0.37;
    this.portrait = this.add.image(width / 2, portraitY, `${CLASS_ORDER[0]}-south`).setScale(5.5);

    // Glowing ring behind portrait
    const ring = this.add.circle(width / 2, portraitY, 140, 0x1a2a3a, 0.4);
    ring.setStrokeStyle(3, 0x4a7aaa, 0.8).setDepth(-1);

    // Personal name (large) — the character's individual name; role
    // (e.g. "Vanguard") sits below as a secondary label.
    this.nameText = this.add
      .text(width / 2, height * 0.63, '', {
        fontFamily: FONT,
        fontSize: '56px',
        color: '#ffdd55',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5);
    // Role title — moved further below the name so the big name and the
    // small role don't crowd each other.
    this.roleText = this.add
      .text(width / 2, height * 0.7, '', {
        fontFamily: FONT,
        fontSize: '22px',
        color: '#aaaaaa',
      })
      .setOrigin(0.5);

    // Stats row
    this.statsText = this.add
      .text(width / 2, height * 0.76, '', {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#cfe8e8',
      })
      .setOrigin(0.5);

    // Blurb / role description — centered below stats, with word wrap
    // up to 70% viewport. Top origin so multi-line wrap grows DOWN
    // predictably without spilling into the confirm button area.
    this.blurbText = this.add
      .text(width / 2, height * 0.8, '', {
        fontFamily: FONT,
        fontSize: '17px',
        color: '#aaaaaa',
        wordWrap: { width: width * 0.7 },
        align: 'center',
      })
      .setOrigin(0.5, 0);

    // Left / right chevrons (clickable)
    const chevronY = portraitY;
    const leftChevron = this.add
      .text(width / 2 - 280, chevronY, '◄', {
        fontFamily: FONT,
        fontSize: '72px',
        color: '#4a7aaa',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    leftChevron.on('pointerover', () => leftChevron.setColor('#8accff'));
    leftChevron.on('pointerout', () => leftChevron.setColor('#4a7aaa'));
    leftChevron.on('pointerup', () => this.cycle(-1));

    const rightChevron = this.add
      .text(width / 2 + 280, chevronY, '►', {
        fontFamily: FONT,
        fontSize: '72px',
        color: '#4a7aaa',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    rightChevron.on('pointerover', () => rightChevron.setColor('#8accff'));
    rightChevron.on('pointerout', () => rightChevron.setColor('#4a7aaa'));
    rightChevron.on('pointerup', () => this.cycle(1));

    // Page indicator (1/5, 2/5, ...) — pinned under the subtitle near
    // the top so it stays clear of the blurb + confirm button below.
    this.indicatorText = this.add
      .text(width / 2, 110, '', {
        fontFamily: FONT,
        fontSize: '16px',
        color: '#888888',
      })
      .setOrigin(0.5);

    // Confirm button
    const confirm = this.add
      .text(width / 2, height - 50, '[ Confirm Leader ]', {
        fontFamily: FONT,
        fontSize: '28px',
        color: '#8aff8a',
        backgroundColor: '#2a3a2a',
        padding: { x: 24, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    confirm.on('pointerup', () => this.confirmLeader());

    // Keyboard nav
    this.input.keyboard?.on('keydown-LEFT', () => this.cycle(-1));
    this.input.keyboard?.on('keydown-A', () => this.cycle(-1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.cycle(1));
    this.input.keyboard?.on('keydown-D', () => this.cycle(1));
    for (const k of ['ENTER', 'SPACE', 'E']) {
      onSceneKeyWhenUnpaused(this, k, () => this.confirmLeader());
    }

    this.refresh();

    installPauseMenuEsc(this);
  }

  /**
   * Subtle background flavor — vignette + faint vertical rays to give the
   * scene weight. Plain-rect graphics; no images needed.
   */
  private drawAtmosphere(width: number, height: number): void {
    // Vertical spotlight gradient (a softly glowing column behind the portrait).
    const spotlight = this.add.graphics();
    spotlight.fillStyle(0x1a2a3a, 0.35);
    spotlight.fillEllipse(width / 2, height * 0.45, width * 0.5, height * 0.8);

    // Divider line between the portrait and the name/role/stats
    // section. Sits just above the name so it frames the info block
    // rather than dangling across the middle of the screen.
    const divider = this.add.graphics();
    divider.lineStyle(2, 0x4a5a6a, 0.6);
    divider.lineBetween(width * 0.2, height * 0.58 + 2, width * 0.8, height * 0.58 + 2);
  }

  private cycle(delta: number): void {
    const n = CLASS_ORDER.length;
    this.currentIdx = (this.currentIdx + delta + n) % n;
    playSfx(this, 'sfx-menu-cancel', 0.3);
    this.refresh();
  }

  private refresh(): void {
    const key = CLASS_ORDER[this.currentIdx];
    const def = CLASSES[key];
    if (this.portrait) {
      this.portrait.setTexture(`${key}-south`);
    }
    if (this.nameText) this.nameText.setText(def.personName);
    if (this.roleText) this.roleText.setText(def.name.toUpperCase());
    if (this.statsText) {
      const statLine = `HP ${def.hp}   ATK ${def.attack}   DEF ${def.defense}   SPD ${def.speed}${
        def.mp > 0 ? `   MP ${def.mp}` : ''
      }`;
      this.statsText.setText(statLine);
    }
    if (this.blurbText) this.blurbText.setText(CLASS_BLURBS[key] ?? '');
    if (this.indicatorText) {
      this.indicatorText.setText(`${this.currentIdx + 1} / ${CLASS_ORDER.length}`);
    }
  }

  private confirmLeader(): void {
    const key = CLASS_ORDER[this.currentIdx];
    playSfx(this, 'sfx-menu-confirm', 0.5);
    setLeader(key);
    // Lobby needs the lobby-tier bundle (NPC sprites, lobby props, world
    // walking animations) but NOT the combat/map/route-music bundle —
    // those keep streaming in CombatLoadScene while the player wanders
    // the Greenhouse. By the time they hit Route Select / Combat, those
    // are usually done too.
    this.waitForLobbyAssetsThen(() => this.scene.start('Lobby'));
  }

  /**
   * If the lobby-tier asset bundle has finished, invoke `next` immediately.
   * Otherwise subscribe to the registry flag set by BackgroundLoadScene on
   * completion and invoke once it flips. Pre-init in BootScene.create
   * guarantees `changedata` (not the first-set-only `setdata`) fires, so
   * this listener is reliable.
   */
  private waitForLobbyAssetsThen(next: () => void): void {
    if (this.registry.get('assets:lobby-loaded')) {
      next();
      return;
    }
    const onChange = (_parent: unknown, key: string, value: unknown): void => {
      if (key === 'assets:lobby-loaded' && value) {
        this.registry.events.off('changedata', onChange);
        next();
      }
    };
    this.registry.events.on('changedata', onChange);
  }
}
