import { isTouchDevice } from './ui';

/**
 * Mobile portrait-mode lockout. The game is designed for a 1280×720
 * landscape canvas — phones held in portrait squish it beyond
 * readability. On touch devices we:
 *
 *   1. Attempt `screen.orientation.lock('landscape')` on the first user
 *      gesture (browsers require a user-activation for this, and only
 *      some Android browsers support it — iOS Safari does not).
 *   2. Paint a DOM "rotate your device" overlay whenever the viewport
 *      is in portrait orientation. Primary UX since iOS can't lock.
 *
 * Desktop / non-touch viewports are untouched — they may be tall (a
 * narrow browser window) but a mouse user doesn't benefit from a
 * rotate prompt.
 */
export function initOrientationLock(): void {
  if (typeof window === 'undefined') return;
  if (!isTouchDevice()) return;

  const overlay = document.createElement('div');
  overlay.id = 'rotate-overlay';
  overlay.style.cssText = [
    'position: fixed',
    'inset: 0',
    'z-index: 2147483647',
    'display: none',
    'align-items: center',
    'justify-content: center',
    'flex-direction: column',
    'background: #0a0f14',
    'color: #8aff8a',
    'font-family: Silkscreen, system-ui, sans-serif',
    'text-align: center',
    'padding: 32px',
    'box-sizing: border-box',
    'user-select: none',
    '-webkit-user-select: none',
    'touch-action: none',
  ].join(';');
  overlay.innerHTML = `
    <div style="font-size: 72px; margin-bottom: 24px; transform: rotate(90deg); transform-origin: center;">📱</div>
    <div style="font-size: 22px; letter-spacing: 1px; margin-bottom: 12px;">ROTATE YOUR DEVICE</div>
    <div style="font-size: 14px; color: #6aaa8a;">Reach the Relay runs in landscape.</div>
  `;
  document.body.appendChild(overlay);

  const isPortrait = (): boolean => {
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(orientation: portrait)').matches;
    }
    return window.innerHeight > window.innerWidth;
  };

  const sync = (): void => {
    overlay.style.display = isPortrait() ? 'flex' : 'none';
  };
  sync();

  // matchMedia emits a change event the moment the viewport flips —
  // more reliable than listening to `resize` (which fires multiple
  // times mid-rotation on iOS).
  const mql = window.matchMedia?.('(orientation: portrait)');
  if (mql?.addEventListener) {
    mql.addEventListener('change', sync);
  } else if (mql?.addListener) {
    // Safari < 14 compat.
    mql.addListener(sync);
  } else {
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
  }

  // Try to lock orientation on the first user gesture. Requires the
  // document to be fullscreen on some browsers; wrap the call so a
  // rejected lock doesn't throw into the console.
  const tryLock = (): void => {
    const anyScreen = screen as Screen & {
      orientation?: { lock?: (o: string) => Promise<void> };
    };
    anyScreen.orientation?.lock?.('landscape').catch(() => {
      // Expected on iOS / unsupported browsers. Overlay handles the
      // rest of the UX.
    });
  };
  const onFirstGesture = (): void => {
    tryLock();
    window.removeEventListener('pointerdown', onFirstGesture);
    window.removeEventListener('keydown', onFirstGesture);
  };
  window.addEventListener('pointerdown', onFirstGesture, { once: true });
  window.addEventListener('keydown', onFirstGesture, { once: true });
}
