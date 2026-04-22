import * as Phaser from 'phaser';
import { effectiveMult } from './audio';

const BASE_VOLUME_PROP = '__baseVolume';

// Pool-based music manager. Plays one track from a pool at a time. When a track
// finishes naturally (loop point), picks another random variant from the same
// pool and plays it — so the listener gets a new variant per loop cycle rather
// than hearing the same file repeat.
//
// State is module-scoped so it persists across scene transitions (sound objects
// themselves live on the game-level sound manager).

let currentPool: string[] | null = null;
let currentKey: string | null = null;
let currentSound: Phaser.Sound.BaseSound | null = null;
let currentVolume = 0.1;

/**
 * Play a track from `pool` on loop, re-picking a random variant each time one
 * ends. If the currently-playing track is already a member of the incoming
 * pool, this is a no-op — the music continues without interruption (useful
 * for scene re-entries where the same route music should persist).
 *
 * @param scene Any live Phaser scene (used only for cache lookup + sound manager access).
 * @param pool Array of audio keys. Only keys present in the audio cache are used.
 * @param volume 0..1.
 */
export function playMusicPool(scene: Phaser.Scene, pool: string[], volume: number): void {
  const cache = scene.sys.game.cache.audio;
  const available = pool.filter((k) => cache.has(k));
  if (available.length === 0) {
    stopMusic();
    stopStrayMusic(scene, pool);
    return;
  }

  // Kill any music-* sound that's NOT in the incoming pool. Catches tracks
  // started outside the pool manager via direct `scene.sound.play(...)` —
  // e.g. the defeat-screen "music-signal-lost" track. Without this, that
  // sound keeps playing when the player clicks Return to Greenhouse and
  // overlaps with the lobby theme.
  stopStrayMusic(scene, pool);

  // If the currently-playing track is a member of the new pool, let it keep
  // going — don't restart mid-track just because we re-entered a scene.
  if (currentSound?.isPlaying && currentKey && pool.includes(currentKey)) {
    currentPool = [...pool];
    currentVolume = volume;
    return;
  }

  stopMusic();
  currentPool = [...pool];
  currentVolume = volume;
  playNext(scene);
}

/**
 * Stop every currently-playing `music-*` sound whose key is NOT in `keepPool`.
 * Used as a cleanup inside `playMusicPool` to kill any music track started
 * outside the pool manager (direct `scene.sound.play(...)` calls).
 */
function stopStrayMusic(scene: Phaser.Scene, keepPool: string[]): void {
  for (const s of scene.sys.game.sound.getAllPlaying()) {
    if (s.key?.startsWith('music-') && !keepPool.includes(s.key)) {
      s.stop();
    }
  }
}

/**
 * Stops any currently-playing pool track and clears the state so no new track
 * is picked on loop-end.
 */
export function stopMusic(): void {
  if (currentSound) {
    currentSound.off('complete');
    currentSound.stop();
    currentSound.destroy();
    currentSound = null;
  }
  currentKey = null;
  currentPool = null;
}

export function getCurrentMusicKey(): string | null {
  return currentKey;
}

function playNext(scene: Phaser.Scene): void {
  if (currentPool === null) return;
  const cache = scene.sys.game.cache.audio;
  const available = currentPool.filter((k) => cache.has(k));
  if (available.length === 0) {
    stopMusic();
    return;
  }
  // If there's more than one option, avoid picking the same one we just played
  // (gives a stronger "different variant" feel on loop).
  let pickFrom = available;
  if (available.length > 1 && currentKey) {
    const diff = available.filter((k) => k !== currentKey);
    if (diff.length > 0) pickFrom = diff;
  }
  const pick = pickFrom[Math.floor(Math.random() * pickFrom.length)];

  const mult = effectiveMult(scene, 'music');
  const sound = scene.sys.game.sound.add(pick, {
    loop: false,
    volume: currentVolume * mult,
  });
  (sound as unknown as Record<string, unknown>)[BASE_VOLUME_PROP] = currentVolume;
  sound.once('complete', () => playNext(scene));
  sound.play();

  currentKey = pick;
  currentSound = sound;
}
