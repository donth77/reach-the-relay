import * as Phaser from 'phaser';
import { log } from '../util/logger';

/**
 * Invisible scene that runs in parallel with Title and loads the large music
 * files (~35 MB of route + journey tracks) that aren't needed until later in
 * the flow. This keeps Title's boot fast while the rest streams in quietly.
 *
 * If the user transitions to Route / Journey / Combat before these finish,
 * `playMusicPool` already filters to cache-hit keys and degrades gracefully —
 * worst case the player hears silence for a moment, no broken playback.
 */
export class BackgroundLoadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BackgroundLoad', active: false });
  }

  preload(): void {
    this.load.audio(
      'music-route-overgrown-bridge',
      'assets/audio/music/route-overgrown-bridge.mp3',
    );
    this.load.audio(
      'music-route-overgrown-bridge-alt',
      'assets/audio/music/route-overgrown-bridge-alt.mp3',
    );
    this.load.audio('music-route-hollow-atrium', 'assets/audio/music/route-hollow-atrium.mp3');
    this.load.audio(
      'music-route-hollow-atrium-alt',
      'assets/audio/music/route-hollow-atrium-alt.mp3',
    );
    this.load.audio('music-route-substation', 'assets/audio/music/route-substation.mp3');
    this.load.audio(
      'music-route-substation-alt',
      'assets/audio/music/route-substation-alt.mp3',
    );
    this.load.audio(
      'music-route-substation-boss',
      'assets/audio/music/route-substation-boss.mp3',
    );
    this.load.audio('music-journey', 'assets/audio/music/journey.mp3');
    this.load.audio('music-journey-alt', 'assets/audio/music/journey-alt.mp3');
    this.load.audio('music-journey-alt2', 'assets/audio/music/journey-alt2.mp3');
  }

  create(): void {
    log('BG_LOAD', 'deferred music loaded');
    // Nothing to render; scene is just a parallel loader. Stop itself to free
    // the slot in the scene manager.
    this.scene.stop();
  }
}
