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
