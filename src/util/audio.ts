import * as Phaser from 'phaser';

export type AudioCategory = 'master' | 'music' | 'sfx';

const REGISTRY_KEY: Record<AudioCategory, string> = {
  master: 'audio:master',
  music: 'audio:music',
  sfx: 'audio:sfx',
};
const STORAGE_KEY: Record<AudioCategory, string> = {
  master: 'audio:master',
  music: 'audio:music',
  sfx: 'audio:sfx',
};

const BASE_VOLUME_PROP = '__baseVolume';

interface SoundWithBase extends Phaser.Sound.BaseSound {
  [BASE_VOLUME_PROP]?: number;
  volume?: number;
  key: string;
  isPlaying: boolean;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(1, v));
}

/**
 * Effective volume multiplier for a category = master × category.
 * Use this when computing a sound's actual playback volume.
 */
export function effectiveMult(scene: Phaser.Scene, cat: AudioCategory): number {
  if (cat === 'master') return getVol(scene, 'master');
  return getVol(scene, 'master') * getVol(scene, cat);
}

/**
 * Load persisted audio multipliers from localStorage into the game registry.
 * Call once at game start (main.ts).
 */
export function initAudioSettings(game: Phaser.Game): void {
  for (const cat of ['master', 'music', 'sfx'] as AudioCategory[]) {
    let v = 1;
    try {
      const raw = localStorage.getItem(STORAGE_KEY[cat]);
      if (raw !== null) v = clamp01(parseFloat(raw));
    } catch {
      /* localStorage unavailable */
    }
    game.registry.set(REGISTRY_KEY[cat], v);
  }
}

export function getVol(scene: Phaser.Scene, cat: AudioCategory): number {
  const v = scene.registry.get(REGISTRY_KEY[cat]);
  return typeof v === 'number' ? clamp01(v) : 1;
}

export function setVol(scene: Phaser.Scene, cat: AudioCategory, value: number): void {
  const v = clamp01(value);
  scene.registry.set(REGISTRY_KEY[cat], v);
  try {
    localStorage.setItem(STORAGE_KEY[cat], String(v));
  } catch {
    /* localStorage unavailable */
  }
  applyCategoryVolume(scene, cat);
}

/**
 * Recompute live volumes for category's playing sounds. Accounts for master
 * multiplier. Setting cat='master' applies to both music and sfx categories.
 */
export function applyCategoryVolume(scene: Phaser.Scene, cat: AudioCategory): void {
  if (cat === 'master') {
    applyPrefix(scene, 'music-', effectiveMult(scene, 'music'));
    applyPrefix(scene, 'sfx-', effectiveMult(scene, 'sfx'));
    return;
  }
  const prefix = cat === 'music' ? 'music-' : 'sfx-';
  applyPrefix(scene, prefix, effectiveMult(scene, cat));
}

function applyPrefix(scene: Phaser.Scene, prefix: string, mult: number): void {
  for (const raw of scene.sound.getAllPlaying()) {
    const s = raw as SoundWithBase;
    if (!s.key || !s.key.startsWith(prefix)) continue;
    const base = s[BASE_VOLUME_PROP];
    if (typeof base !== 'number') continue;
    if (typeof s.volume === 'number') s.volume = base * mult;
  }
}

export function playMusic(
  scene: Phaser.Scene,
  key: string,
  baseVolume: number,
  loop: boolean = true,
): Phaser.Sound.BaseSound {
  const sound = scene.sound.add(key, {
    loop,
    volume: baseVolume * effectiveMult(scene, 'music'),
  });
  (sound as SoundWithBase)[BASE_VOLUME_PROP] = baseVolume;
  sound.play();
  return sound;
}

export function playSfx(
  scene: Phaser.Scene,
  key: string,
  baseVolume: number = 1,
): Phaser.Sound.BaseSound {
  const sound = scene.sound.add(key, {
    volume: baseVolume * effectiveMult(scene, 'sfx'),
  });
  (sound as SoundWithBase)[BASE_VOLUME_PROP] = baseVolume;
  sound.play();
  return sound;
}

export function stopAllMusic(scene: Phaser.Scene): void {
  for (const s of scene.sound.getAllPlaying()) {
    if (s.key?.startsWith('music-')) s.stop();
  }
}
