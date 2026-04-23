import * as Phaser from 'phaser';
import { isPortalEntry, DEFAULT_PORTAL_LEADER, DEFAULT_PORTAL_RECRUITS } from '../util/portal';
import { setLeader, addRecruit } from '../state/lobby';

/**
 * Critical-path preload ONLY: title art, main-theme music, and the two menu
 * SFX. Everything else (party sprites + animations, NPCs, enemies, combat
 * backgrounds, combat SFX, lobby music, lobby props, VFX) is loaded by
 * BackgroundLoadScene in parallel with the user being on Title. This keeps
 * the blank-viewport window as short as possible, satisfying Vibe Jam rule 8
 * ("no loading screens / heavy downloads — has to be almost instantly in the
 * game").
 *
 * TitleScene.activateSelected gates its "Start Game" / non-Leaderboard
 * transitions on the `assets:loaded` registry flag set by BackgroundLoad
 * completion, so the first scene past Title never renders with missing
 * sprites.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    // Kick off the Silkscreen webfont download in parallel with Phaser's
    // asset preload. Doesn't block — just ensures the font is further along
    // (or done) by the time TitleScene renders its menu text.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.load?.('400 44px "Silkscreen"');
    fonts?.load?.('700 44px "Silkscreen"');

    // Title art (already <link rel="preload">'d from index.html).
    this.load.image('title-bg-on', 'assets/title/bg-on.png');
    this.load.image('title-bg-off', 'assets/title/bg-off.png');
    this.load.image('title-logo', 'assets/logo/logo-surge.png');

    // Title music + menu SFX — the only audio needed before LeaderSelect.
    this.load.audio('music-main-theme', 'assets/audio/music/main-theme.mp3');
    this.load.audio('sfx-menu-confirm', 'assets/audio/sfx/menu-confirm.mp3');
    this.load.audio('sfx-menu-cancel', 'assets/audio/sfx/menu-cancel.mp3');
  }

  create(): void {
    // Kick off background loading of everything else in parallel with Title.
    this.scene.launch('BackgroundLoad');

    // Vibe Jam 2026 webring entry: if the URL has `?portal=true`, skip all
    // menus (Title, LeaderSelect, PartySelect) and drop the player straight
    // into the walkable Lobby with a default party. The webring spec
    // mandates "no loading screens, no input screens" for continuity.
    if (isPortalEntry()) {
      setLeader(DEFAULT_PORTAL_LEADER);
      for (const id of DEFAULT_PORTAL_RECRUITS) addRecruit(id);
      // Portal entry needs assets LoadingScene isn't done with yet, so
      // wait for the background load to complete before transitioning to
      // Lobby. TitleScene does the equivalent gating for manual entry.
      this.waitForAssetsThen(() => this.scene.start('Lobby'));
      return;
    }

    this.scene.start('Title');
  }

  private waitForAssetsThen(next: () => void): void {
    if (this.registry.get('assets:loaded')) {
      next();
      return;
    }
    const onChange = (_parent: unknown, key: string, value: unknown): void => {
      if (key === 'assets:loaded' && value) {
        this.registry.events.off('changedata', onChange);
        next();
      }
    };
    this.registry.events.on('changedata', onChange);
  }
}
