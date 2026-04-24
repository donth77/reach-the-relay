// User-facing combat preferences, persisted to localStorage. Mirrors the
// shape of util/audio.ts but for non-audio knobs.

const ATB_SPEED_KEY = 'combat:atb-speed';

export const ATB_SPEED_MIN = 0.5;
export const ATB_SPEED_MAX = 2.0;
export const ATB_SPEED_DEFAULT = 1.0;

function clampAtbSpeed(v: number): number {
  if (!Number.isFinite(v)) return ATB_SPEED_DEFAULT;
  return Math.max(ATB_SPEED_MIN, Math.min(ATB_SPEED_MAX, v));
}

// In-memory cache of the persisted value. CombatScene reads this every
// frame during combat (60×/sec); hitting localStorage on every read would
// be a real cost on low-end devices. Initialized lazily on first read,
// kept in sync by setAtbSpeed.
let cachedAtbSpeed: number | null = null;

function loadFromStorage(): number {
  try {
    const raw = localStorage.getItem(ATB_SPEED_KEY);
    if (raw === null) return ATB_SPEED_DEFAULT;
    return clampAtbSpeed(parseFloat(raw));
  } catch {
    return ATB_SPEED_DEFAULT;
  }
}

/**
 * User-set multiplier on the ATB gauge fill rate. 1.0 = default Phaser-tick
 * speed; 0.5 = half (more decision time); 2.0 = double (snappier turns).
 * Cheap — reads from an in-memory cache, not localStorage.
 */
export function getAtbSpeed(): number {
  if (cachedAtbSpeed === null) cachedAtbSpeed = loadFromStorage();
  return cachedAtbSpeed;
}

export function setAtbSpeed(value: number): void {
  const v = clampAtbSpeed(value);
  cachedAtbSpeed = v;
  try {
    localStorage.setItem(ATB_SPEED_KEY, String(v));
  } catch {
    /* localStorage unavailable */
  }
}
