import * as Phaser from 'phaser';

/**
 * Stop every currently-playing sound whose key starts with `music-`.
 * Defensive against registry desync when tracks were started without
 * updating `currentRouteMusic`.
 */
export function stopAllMusic(scene: Phaser.Scene): void {
  for (const s of scene.sound.getAllPlaying()) {
    if (s.key?.startsWith('music-')) s.stop();
  }
}
