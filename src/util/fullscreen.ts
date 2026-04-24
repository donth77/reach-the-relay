// Fullscreen capability detection. Used by pause menus to show:
//   - a working "Fullscreen" toggle button on browsers that support the API
//     (Android Chrome / Firefox / Samsung Internet / etc.)
//   - a passive "iOS: Add to Home Screen for fullscreen" hint on iOS Safari
//     (iPhone, iPad including modern iPad pretending to be Mac), where the
//     fullscreen API is not exposed for non-video elements
//   - nothing on desktop (out of scope for the current button)
//
// Phaser's scale.toggleFullscreen() wraps the actual call.

import { isTouchDevice } from './ui';

/**
 * True when a fullscreen toggle button will actually work — touch device AND
 * the browser exposes the Fullscreen API. iOS returns false here because
 * `document.fullscreenEnabled` is not surfaced for non-video elements.
 */
export function canFullscreen(): boolean {
  if (!isTouchDevice()) return false;
  if (typeof document === 'undefined') return false;
  return document.fullscreenEnabled === true;
}

/**
 * Whether the page is currently in fullscreen mode. Used to render the
 * toggle button label as "Fullscreen" vs "Exit fullscreen".
 */
export function isFullscreenActive(): boolean {
  if (typeof document === 'undefined') return false;
  return document.fullscreenElement !== null;
}

/**
 * True if the page is running as an installed PWA (iOS standalone or any
 * `display-mode: standalone`). In that mode the browser chrome is already
 * gone — no need to show either the button or the iOS hint.
 */
export function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false;
  const navStandalone = (window.navigator as { standalone?: boolean }).standalone;
  if (navStandalone === true) return true;
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(display-mode: standalone)').matches;
  }
  return false;
}

/**
 * True for iOS browsers (iPhone / iPad), where `requestFullscreen()` is not
 * available on non-video elements. Used to gate the "Add to Home Screen"
 * hint shown in lieu of a useless button.
 */
export function isIosBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return true;
  // Modern iPad reports a Mac UA but exposes touch points — use that as
  // the disambiguator.
  if (/Mac/.test(ua) && navigator.maxTouchPoints > 1) return true;
  return false;
}

// --- Auto-enter fullscreen on first gesture (mobile only) -----------------
// Browsers gate requestFullscreen() to a user-activation, so we can't call
// it on page load. Instead, arm a one-shot listener that triggers on the
// first tap/keypress. Respects an opt-out flag set when the user explicitly
// exits fullscreen via the pause-menu toggle — we don't want to yank them
// back in on the next tap.

const AUTO_FS_OPT_OUT_KEY = 'fullscreen:auto-disabled';

function isAutoFullscreenDisabled(): boolean {
  try {
    return localStorage.getItem(AUTO_FS_OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Call when the user manually exits fullscreen via the pause menu toggle.
 * Prevents auto-enter on the next first-gesture — they told us no.
 */
export function setAutoFullscreenOptOut(optOut: boolean): void {
  try {
    if (optOut) localStorage.setItem(AUTO_FS_OPT_OUT_KEY, '1');
    else localStorage.removeItem(AUTO_FS_OPT_OUT_KEY);
  } catch {
    // Ignore quota / disabled-storage — auto behavior just won't persist.
  }
}

/**
 * Install a one-shot first-gesture listener that enters fullscreen on
 * eligible mobile browsers. No-op on desktop, iOS (no API), when already
 * fullscreen, when the user previously opted out, or when running as a PWA.
 */
export function initAutoFullscreenOnFirstGesture(): void {
  if (typeof window === 'undefined') return;
  if (!canFullscreen()) return;
  if (isStandalonePWA()) return;
  if (isAutoFullscreenDisabled()) return;

  const tryEnter = (): void => {
    if (isFullscreenActive()) return;
    const el = document.documentElement;
    try {
      const p = el.requestFullscreen?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // Some browsers throw synchronously when the gesture has already
      // been consumed. Silent fail — the pause-menu toggle still works.
    }
  };
  const onFirstGesture = (): void => {
    tryEnter();
    window.removeEventListener('pointerdown', onFirstGesture);
    window.removeEventListener('keydown', onFirstGesture);
  };
  window.addEventListener('pointerdown', onFirstGesture, { once: true });
  window.addEventListener('keydown', onFirstGesture, { once: true });
}
