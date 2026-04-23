import * as Phaser from 'phaser';
import { isPortalEntry, DEFAULT_PORTAL_LEADER, DEFAULT_PORTAL_RECRUITS } from '../util/portal';
import { setLeader, addRecruit } from '../state/lobby';

const PARTY_KEYS = ['vanguard', 'netrunner', 'medic', 'scavenger', 'cybermonk'] as const;

/**
 * Critical-path preload — loads only what's needed to render TitleScene
 * and the very next scene (LeaderSelect). Everything else lives in
 * BackgroundLoadScene which runs in parallel with the user being on Title /
 * LeaderSelect, so the player can start interacting almost immediately.
 *
 * What's here:
 *  - Title art (bg, logo, main-theme music, menu SFX)
 *  - LeaderSelect: party south-facing portraits (5 small images) + lobby
 *    music (so the lobby theme is ready to play when the player hits the
 *    LeaderSelect screen)
 *
 * Everything else (per-direction party sprites, all animation frames, NPCs,
 * enemies, combat backgrounds, lobby props, combat SFX, route + journey
 * music) is in BackgroundLoadScene. LeaderSelect.confirmLeader gates its
 * transition to Lobby on the `assets:loaded` flag set by BackgroundLoad.
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
    this.load.image('title-logo', 'assets/logo/logo.png');

    // Title music + menu SFX.
    this.load.audio('music-main-theme', 'assets/audio/music/main-theme.mp3');
    this.load.audio('sfx-menu-confirm', 'assets/audio/sfx/menu-confirm.mp3');
    this.load.audio('sfx-menu-cancel', 'assets/audio/sfx/menu-cancel.mp3');

    // LeaderSelect needs each class's south-facing portrait + lobby music.
    // Five small images — cheap to include here so Start Game → LeaderSelect
    // never blocks.
    for (const key of PARTY_KEYS) {
      this.load.image(`${key}-south`, `assets/sprites/party/${key}/south.png`);
    }
    this.load.audio('music-lobby-theme', 'assets/audio/music/lobby-theme.mp3');
  }

  create(): void {
    // Pre-initialize both tier flags so the later set-to-true fires
    // `changedata` (not `setdata` — which only fires on first-ever set of
    // a key). Waiters listen for `changedata`, so without the pre-init
    // they'd miss the very first transition to true.
    this.registry.set('assets:lobby-loaded', false);
    this.registry.set('assets:loaded', false);

    // Kick off background loading of everything else in parallel with
    // Title + LeaderSelect.
    this.scene.launch('BackgroundLoad');

    // Vibe Jam 2026 webring entry: if the URL has `?portal=true`, skip all
    // menus (Title, LeaderSelect, PartySelect) and drop the player straight
    // into the walkable Lobby with a default party. The webring spec
    // mandates "no loading screens, no input screens" for continuity.
    if (isPortalEntry()) {
      setLeader(DEFAULT_PORTAL_LEADER);
      for (const id of DEFAULT_PORTAL_RECRUITS) addRecruit(id);
      // Lobby needs the lobby-tier bundle (party world anims, NPCs, lobby
      // bg + props). Wait if BackgroundLoad is still in flight.
      this.waitForLobbyAssetsThen(() => this.scene.start('Lobby'));
      return;
    }

    this.scene.start('Title');
  }

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
