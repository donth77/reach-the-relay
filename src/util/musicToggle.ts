import * as Phaser from 'phaser';
import { getVol, setVol, applyCategoryVolume } from './audio';

// Global music on/off toggle, mounted as a fixed-position DOM button so it
// survives scene transitions. First click also serves as the user gesture
// that unlocks the audio context in browsers with autoplay restrictions.
//
// Positioning tracks the Phaser canvas bounds (not the viewport) so the
// button always sits inside the game frame even when the canvas is
// letterboxed by `Phaser.Scale.FIT`.
//
// A11y / mobile:
// - 48×48 touch target (exceeds WCAG 2.5.5 minimum of 24×24 and the common
//   44px mobile guideline)
// - aria-pressed reflects mute state for screen readers
// - Visible :focus-visible outline for keyboard navigation
// - Touch-action: manipulation to avoid double-tap zoom delays

const BUTTON_ID = 'music-toggle';
const INSET_PX = 12; // distance from canvas edge

let gameRef: Phaser.Game | null = null;
let buttonEl: HTMLButtonElement | null = null;
let repositionHandler: (() => void) | null = null;

export function mountMusicToggle(game: Phaser.Game): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(BUTTON_ID)) return;

  gameRef = game;

  const btn = document.createElement('button');
  btn.id = BUTTON_ID;
  btn.type = 'button';
  btn.title = 'Toggle music';
  btn.setAttribute('aria-label', 'Toggle music');
  btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML = `<span class="mt-icon">\u266B</span><span class="mt-slash" aria-hidden="true"></span>`;

  const style = document.createElement('style');
  style.textContent = `
    #${BUTTON_ID} {
      position: fixed;
      /* top/left set dynamically to match the Phaser canvas bounds */
      z-index: 9999;
      width: 48px;
      height: 48px;
      padding: 0;
      background: rgba(0, 0, 0, 0.65);
      color: #e6e6e6;
      border: 2px solid rgba(255, 255, 255, 0.4);
      border-radius: 50%;
      cursor: pointer;
      font-size: 22px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      transition: background 120ms, border-color 120ms, transform 80ms;
    }
    #${BUTTON_ID}:hover {
      background: rgba(0, 0, 0, 0.82);
      border-color: rgba(255, 255, 255, 0.7);
    }
    #${BUTTON_ID}:active {
      transform: scale(0.94);
    }
    #${BUTTON_ID}:focus-visible {
      outline: 3px solid #8aff8a;
      outline-offset: 2px;
    }
    #${BUTTON_ID} .mt-icon {
      display: block;
      pointer-events: none;
    }
    #${BUTTON_ID} .mt-slash {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 36px;
      height: 3px;
      background: #ff5555;
      border-radius: 2px;
      transform: translate(-50%, -50%) rotate(-45deg);
      display: none;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.7);
      pointer-events: none;
    }
    #${BUTTON_ID}.muted .mt-icon {
      color: #888888;
    }
    #${BUTTON_ID}.muted .mt-slash {
      display: block;
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(btn);

  buttonEl = btn;

  btn.addEventListener('click', () => {
    const scene = activeScene();
    if (!scene) return;
    const current = getVol(scene, 'music');
    const next = current > 0 ? 0 : 1;
    setVol(scene, 'music', next);
    // If we just unmuted while the audio context was locked, the click is also
    // the gesture that unlocks it. Any music sound that was created while the
    // category was muted sits queued at volume 0; re-apply volume once the
    // sound manager unlocks so those sounds become audible.
    if (next > 0 && scene.sound.locked) {
      scene.sound.once(Phaser.Sound.Events.UNLOCKED, () => {
        applyCategoryVolume(scene, 'music');
      });
    }
    refresh();
  });

  reposition();
  refresh();

  // Canvas may move/resize on viewport changes or Phaser scale events.
  repositionHandler = reposition;
  window.addEventListener('resize', repositionHandler);
  window.addEventListener('orientationchange', repositionHandler);
  game.scale.on('resize', repositionHandler);
  // One extra delayed call in case the canvas isn't laid out yet on mount.
  setTimeout(reposition, 50);
}

export function unmountMusicToggle(): void {
  if (repositionHandler) {
    window.removeEventListener('resize', repositionHandler);
    window.removeEventListener('orientationchange', repositionHandler);
    gameRef?.scale.off('resize', repositionHandler);
    repositionHandler = null;
  }
  buttonEl?.remove();
  buttonEl = null;
  // Leave gameRef set; caller may re-mount later.
}

function activeScene(): Phaser.Scene | null {
  if (!gameRef) return null;
  const scenes = gameRef.scene.getScenes(true);
  return scenes[0] ?? gameRef.scene.scenes[0] ?? null;
}

function reposition(): void {
  if (!buttonEl || !gameRef?.canvas) return;
  const rect = gameRef.canvas.getBoundingClientRect();
  buttonEl.style.top = `${Math.max(0, rect.top + INSET_PX)}px`;
  buttonEl.style.left = `${Math.max(0, rect.left + INSET_PX)}px`;
}

function refresh(): void {
  if (!buttonEl || !gameRef) return;
  const v = (gameRef.registry.get('audio:music') ?? 1) as number;
  const muted = v === 0;
  buttonEl.classList.toggle('muted', muted);
  buttonEl.setAttribute('aria-pressed', muted ? 'true' : 'false');
  buttonEl.title = muted ? 'Unmute music' : 'Mute music';
  buttonEl.setAttribute('aria-label', muted ? 'Unmute music' : 'Mute music');
}
