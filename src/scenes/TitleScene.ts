import * as Phaser from 'phaser';
import { FONT } from '../util/ui';
import { playMusicPool } from '../util/music';
import { playSfx, stopAllMusic } from '../util/audio';
import { mountMusicToggle, unmountMusicToggle, isTitleMusicMuted } from '../util/musicToggle';
import { openBriefing } from '../util/briefingModal';
import { log, isDebugEnabled } from '../util/logger';
import { RelayCutsceneScene } from './RelayCutsceneScene';

// Radio-tower beacon blink timing. Tower light is ON most of the time with
// a brief OFF flash, like a real aviation warning beacon.
const BLINK_ON_MS = 900;
const BLINK_OFF_MS = 220;

// Target display width of the logo on the 1280-wide canvas. Preserves aspect.
const LOGO_TARGET_WIDTH = 800;

// Menu layout constants.
const MENU_ITEMS = ['Start Game', 'How to Play'] as const;
type MenuItemId = (typeof MENU_ITEMS)[number];
// Layout: Settings stays at its current y (~636); Start Game sits higher so
// the two rows feel like deliberate SNES-menu options, not packed.
const MENU_START_Y_FRACTION = 0.78;
const MENU_ROW_HEIGHT = 74;
const MENU_FONT_SIZE = '44px';
const MENU_CHEVRON_FONT_SIZE = '36px';

interface MenuRow {
  id: MenuItemId;
  text: Phaser.GameObjects.Text;
  chevron: Phaser.GameObjects.Text;
}

export class TitleScene extends Phaser.Scene {
  private blinkEvent?: Phaser.Time.TimerEvent;
  private menuRows: MenuRow[] = [];
  // -1 means "no selection yet" — chevron stays hidden until the player
  // presses a key or hovers a row. Prevents the scene from looking
  // pre-decided on first load.
  private selectedIndex = -1;

  constructor() {
    super('Title');
  }

  create(): void {
    const { width, height } = this.scale;

    // Reset instance state. Phaser reuses the same Scene instance across
    // start/stop cycles, so class-field initializers run only at construction
    // — we need to manually clear on each entry. Not doing this caused
    // ghost-menu-row entries after returning to Title via the pause menu,
    // which blocked pointer input on the real rows.
    this.menuRows = [];
    this.selectedIndex = -1;

    mountMusicToggle(this.game);

    // Autoplay policy: if the audio context hasn't been unlocked yet, Phaser
    // queues the play. Re-issue on UNLOCKED to be safe.
    // Also respect the title-scoped mute preference — `isTitleMusicMuted()`
    // returns true if the player previously toggled the button off; skipping
    // playMusicPool here avoids a brief "music starts → immediately stops"
    // artifact on scene re-entry.
    const hasMainTheme = this.cache.audio.has('music-main-theme');
    log('TITLE', 'audio state', { locked: this.sound.locked, hasMainTheme });
    if (!isTitleMusicMuted()) {
      playMusicPool(this, ['music-main-theme'], 0.35);
      if (this.sound.locked) {
        this.sound.once(Phaser.Sound.Events.UNLOCKED, () => {
          log('TITLE', 'sound unlocked — retrying main-theme');
          if (!isTitleMusicMuted()) playMusicPool(this, ['music-main-theme'], 0.35);
        });
      }
    }

    // Backgrounds + beacon blink — render immediately so the user sees the
    // art even if the Silkscreen webfont hasn't finished downloading yet.
    this.add.image(width / 2, height / 2, 'title-bg-off').setOrigin(0.5);
    const onImage = this.add.image(width / 2, height / 2, 'title-bg-on').setOrigin(0.5);
    const scheduleBlink = (on: boolean): void => {
      onImage.setVisible(on);
      this.blinkEvent = this.time.delayedCall(on ? BLINK_ON_MS : BLINK_OFF_MS, () =>
        scheduleBlink(!on),
      );
    };
    scheduleBlink(true);

    // Logo (image, no webfont dependency).
    const logo = this.add.image(width / 2, height * 0.44, 'title-logo').setOrigin(0.5);
    logo.setScale(LOGO_TARGET_WIDTH / logo.width);

    // Keyboard nav can be wired immediately; the handlers check for menuRows
    // length and no-op until the menu is built.
    this.input.keyboard?.on('keydown-UP', () => this.moveSelection(-1));
    this.input.keyboard?.on('keydown-W', () => this.moveSelection(-1));
    this.input.keyboard?.on('keydown-DOWN', () => this.moveSelection(1));
    this.input.keyboard?.on('keydown-S', () => this.moveSelection(1));
    this.input.keyboard?.on('keydown-ENTER', () => this.activateSelected());
    this.input.keyboard?.on('keydown-SPACE', () => this.activateSelected());
    this.input.keyboard?.on('keydown-E', () => this.activateSelected());

    // DEV: `V` from the title screen jumps straight into the victory cutscene
    // with a test party, bypassing LeaderSelect → Lobby → Route → encounters.
    // ONLY wired up when the debug logger is enabled (same gate as the DEBUG
    // badge). In production builds this is a no-op.
    if (isDebugEnabled()) {
      this.input.keyboard?.on('keydown-V', () => {
        log('SCENE', 'Test-trigger: RelayCutscene');
        RelayCutsceneScene.startTest(this);
      });
    }

    // Defer menu text creation until Silkscreen is loaded. The bg + logo are
    // visible immediately (no black screen), and the menu text pops in once
    // the font is ready — preventing a fallback-font flash on "START GAME".
    this.ensureFontThen(() => this.buildMenuRows());

    // Cleanup when leaving. Stop the main theme so it doesn't bleed into
    // the next scene's music — the lobby theme starts on LeaderSelect and
    // both would otherwise overlap until one loop ended.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.blinkEvent?.remove();
      unmountMusicToggle();
      stopAllMusic(this);
    });
  }

  /**
   * Invokes `next` once the Silkscreen font is ready. Resolves immediately
   * if the font is already loaded (e.g., cached from a prior visit).
   */
  private ensureFontThen(next: () => void): void {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts?.load || fonts.check(`${MENU_FONT_SIZE} "Silkscreen"`)) {
      next();
      return;
    }
    fonts
      .load(`${MENU_FONT_SIZE} "Silkscreen"`)
      .then(() => next())
      .catch(() => next());
  }

  private buildMenuRows(): void {
    const { width, height } = this.scale;
    const menuStartY = height * MENU_START_Y_FRACTION - 25;
    MENU_ITEMS.forEach((id, i) => {
      const y = menuStartY + i * MENU_ROW_HEIGHT;
      const text = this.add
        .text(width / 2, y, id.toUpperCase(), {
          fontFamily: FONT,
          fontSize: MENU_FONT_SIZE,
          color: '#888888',
          stroke: '#000000',
          strokeThickness: 4,
        })
        .setOrigin(0.5);
      const chevron = this.add
        .text(width / 2 - text.width / 2 - 18, y, '\u25B6', {
          fontFamily: FONT,
          fontSize: MENU_CHEVRON_FONT_SIZE,
          color: '#8aff8a',
          stroke: '#000000',
          strokeThickness: 4,
        })
        .setOrigin(1, 0.5)
        .setVisible(false);

      text.setInteractive({ useHandCursor: true });
      text.on('pointerover', () => this.setSelected(i));
      text.on('pointerdown', () => {
        this.setSelected(i);
        this.activateSelected();
      });

      this.menuRows.push({ id, text, chevron });
    });
  }

  private setSelected(index: number): void {
    if (this.menuRows.length === 0) return;
    if (index >= this.menuRows.length) return;
    if (index !== this.selectedIndex && index >= 0) {
      playSfx(this, 'sfx-menu-cancel', 0.3);
    }
    this.selectedIndex = index;
    this.menuRows.forEach((row, i) => {
      const active = i === index;
      row.text.setColor(active ? '#e6e6e6' : '#888888');
      row.chevron.setVisible(active);
      row.chevron.setX(row.text.x - row.text.width / 2 - 18);
    });
  }

  private moveSelection(delta: number): void {
    const n = this.menuRows.length;
    if (n === 0) return;
    if (this.selectedIndex < 0) {
      this.setSelected(0);
      return;
    }
    this.setSelected((this.selectedIndex + delta + n) % n);
  }

  private activateSelected(): void {
    if (this.menuRows.length === 0) return;
    if (this.selectedIndex < 0) {
      this.setSelected(0);
      return;
    }
    const row = this.menuRows[this.selectedIndex];
    playSfx(this, 'sfx-menu-confirm', 0.5);
    if (row.id === 'Start Game') {
      this.scene.start('LeaderSelect');
    } else if (row.id === 'How to Play') {
      // Defer a tick — the briefing modal binds scene.input.on('pointerdown', close)
      // on open, and without the delay the same click that opened it also closes it.
      this.time.delayedCall(1, () => openBriefing(this));
    }
  }
}
