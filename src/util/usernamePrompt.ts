import * as Phaser from 'phaser';
import { FONT } from './ui';
import { playSfx } from './audio';
import { setUsername, isValidUsername, getUsername } from '../state/player';
import { createHoverButton } from './button';

// Module-scoped open flag — mirrors briefingModal / dialogue / etc. Scenes
// gate their ESC handler via `isUsernamePromptOpen()` so pressing ESC to
// dismiss this modal doesn't also trigger the pause menu underneath.
let promptOpen = false;
export function isUsernamePromptOpen(): boolean {
  return promptOpen;
}

/**
 * Full-screen modal that prompts the player to enter a leaderboard
 * callsign. Skippable — the caller chooses what happens on cancel (e.g.
 * "submit skipped", navigate back, etc.).
 *
 * Mobile support: a hidden DOM `<input>` is appended to the body and
 * focused when the player taps the displayed input area. That pops the
 * soft keyboard on iOS / Android (Phaser's canvas can't do this on
 * its own). Desktop continues to use the module's `window.keydown`
 * handler as before.
 *
 * Used by:
 *   - RunCompleteScene victory path (when the player wants to submit a
 *     score but has no callsign stored yet)
 *   - Any future "CHANGE CALLSIGN" flow on the Title menu or Settings
 *
 * NOT used on Title-scene first-load anymore — forcing username input
 * before the player can touch the game is bad UX and violates the Vibe
 * Jam webring rule that portal visitors must never see input screens.
 */
export function openUsernamePrompt(
  scene: Phaser.Scene,
  opts: { onConfirm: (username: string) => void; onCancel?: () => void },
): void {
  if (promptOpen) return;
  promptOpen = true;
  const { width, height } = scene.scale;
  const container = scene.add.container(0, 0).setDepth(200000).setScrollFactor(0);

  // Backdrop — tap/click-outside dismisses. Registered with a 1-frame
  // delay so the click that OPENED this modal doesn't immediately
  // close it.
  const backdrop = scene.add
    .rectangle(width / 2, height / 2, width, height, 0x000000, 0.88)
    .setInteractive();
  container.add(backdrop);

  const panelW = 640;
  const panelH = 360;
  const panelLeft = width / 2 - panelW / 2;
  const panelTop = height / 2 - panelH / 2;
  const panel = scene.add
    .rectangle(width / 2, height / 2, panelW, panelH, 0x051410, 0.98)
    .setStrokeStyle(3, 0x55ff88, 1)
    // Swallow clicks so tapping the panel itself doesn't dismiss.
    .setInteractive();
  container.add(panel);

  container.add(
    scene.add
      .text(width / 2, height / 2 - 130, '> ENTER CALLSIGN', {
        fontFamily: FONT,
        fontSize: '32px',
        color: '#8aff8a',
      })
      .setOrigin(0.5),
  );
  container.add(
    scene.add
      .text(width / 2, height / 2 - 80, 'Letters, numbers, space, underscore — 1 to 16 chars', {
        fontFamily: FONT,
        fontSize: '14px',
        color: '#6aaa8a',
      })
      .setOrigin(0.5),
  );

  let buffer = getUsername() ?? '';

  // The visible input pill. Tapping it on touch devices focuses the
  // hidden DOM <input> so the soft keyboard pops up.
  const inputDisplay = scene.add
    .text(width / 2, height / 2 - 20, '', {
      fontFamily: FONT,
      fontSize: '36px',
      color: '#e6e6e6',
      backgroundColor: '#0a0a14',
      padding: { x: 24, y: 10 },
      fixedWidth: 420,
      align: 'center',
    })
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true });
  container.add(inputDisplay);

  // Hidden DOM <input> — positioned off-screen but kept focusable so
  // the soft keyboard pops on mobile. `readonly`/`disabled` would
  // block that, so we leave it editable and mirror its value into our
  // own render loop.
  const domInput = document.createElement('input');
  domInput.type = 'text';
  domInput.maxLength = 16;
  domInput.value = buffer;
  domInput.autocapitalize = 'characters';
  domInput.autocomplete = 'off';
  domInput.style.cssText = [
    'position: fixed',
    'left: 50%',
    'top: 50%',
    'transform: translate(-50%, -50%)',
    'width: 1px',
    'height: 1px',
    'opacity: 0',
    'pointer-events: none',
    'border: none',
    'outline: none',
    'background: transparent',
    'font-size: 16px', // >=16px prevents iOS auto-zoom on focus
  ].join(';');
  document.body.appendChild(domInput);

  const focusDomInput = (): void => {
    // Re-seed DOM value from our buffer in case the player typed on
    // desktop first, then tapped to continue on touch.
    domInput.value = buffer;
    domInput.focus();
    // Place the caret at the end.
    try {
      domInput.setSelectionRange(buffer.length, buffer.length);
    } catch {
      // Silent — some browsers throw on non-text-like types.
    }
  };
  inputDisplay.on('pointerup', focusDomInput);

  // Validation hint — only shown when the buffer contains invalid
  // characters. The CONFIRM button + X + tap-outside carry every
  // other affordance, so no key-hint text is needed.
  const hint = scene.add
    .text(width / 2, height / 2 + 55, '', {
      fontFamily: FONT,
      fontSize: '16px',
      color: '#6aaa8a',
    })
    .setOrigin(0.5)
    .setVisible(false);
  container.add(hint);

  // Single CONFIRM button — the X button + tap-outside-to-close
  // below already cover the SKIP/cancel case, so there's no dedicated
  // skip button.
  const BTN_Y = height / 2 + 110;
  const tryConfirm = (): void => {
    if (!isValidUsername(buffer)) return;
    if (!setUsername(buffer)) return;
    playSfx(scene, 'sfx-menu-confirm', 0.5);
    const saved = buffer;
    close();
    opts.onConfirm(saved);
  };
  const doSkip = (): void => {
    playSfx(scene, 'sfx-menu-cancel', 0.3);
    close();
    opts.onCancel?.();
  };
  const confirmBtn = createHoverButton(scene, {
    x: width / 2,
    y: BTN_Y,
    label: '[ CONFIRM ]',
    fontSize: '22px',
    idleBg: '#1a4a2a',
    hoverBg: '#2f6a3f',
    padding: { x: 20, y: 10 },
    onClick: tryConfirm,
  });
  container.add(confirmBtn);

  // Close [X] button in the panel's top-right corner.
  const xBtnSize = 36;
  const xBtnCx = panelLeft + panelW - xBtnSize / 2 - 8;
  const xBtnCy = panelTop + xBtnSize / 2 + 8;
  const xBtnBg = scene.add
    .rectangle(xBtnCx, xBtnCy, xBtnSize, xBtnSize, 0x000000, 0.8)
    .setInteractive({ useHandCursor: true });
  const xBtnText = scene.add
    .text(xBtnCx, xBtnCy - 2, 'X', {
      fontFamily: FONT,
      fontSize: '20px',
      color: '#ffffff',
    })
    .setOrigin(0.5, 0.5);
  container.add(xBtnBg);
  container.add(xBtnText);
  xBtnBg.on('pointerover', () => xBtnText.setColor('#ff8a8a'));
  xBtnBg.on('pointerout', () => xBtnText.setColor('#ffffff'));
  xBtnBg.on('pointerup', doSkip);

  // Tap outside the panel dismisses (as skip). Delay 1 frame so the
  // click that opened the modal doesn't immediately close it.
  scene.time.delayedCall(1, () => {
    if (promptOpen) backdrop.on('pointerup', doSkip);
  });

  const render = (): void => {
    const caret = Math.floor(Date.now() / 500) % 2 === 0 ? '_' : ' ';
    inputDisplay.setText(buffer + caret);
    const valid = isValidUsername(buffer);

    // Only the validation error surfaces here — all affordances are
    // visible as buttons, so no key-hint text is rendered.
    if (buffer.length > 0 && !valid) {
      hint.setText('Invalid — letters, numbers, space, underscore only');
      hint.setColor('#ff8a8a');
      hint.setVisible(true);
    } else {
      hint.setVisible(false);
    }

    // Dim the CONFIRM button when the buffer is empty/invalid so the
    // player sees which action is ready.
    confirmBtn.setAlpha(valid ? 1 : 0.5);
  };
  render();

  const caretTick = scene.time.addEvent({
    delay: 500,
    loop: true,
    callback: render,
  });

  let resolved = false;
  const close = (): void => {
    if (resolved) return;
    resolved = true;
    promptOpen = false;
    caretTick.remove();
    window.removeEventListener('keydown', keyHandler);
    domInput.removeEventListener('input', onDomInput);
    if (domInput.parentNode) domInput.parentNode.removeChild(domInput);
    container.destroy();
  };

  // DOM input → our buffer. Normalizes to the allowed charset so
  // pasted values or autocapitalize don't slip invalid chars through.
  const onDomInput = (): void => {
    const raw = domInput.value;
    const cleaned = raw
      .split('')
      .filter((c) => /^[A-Za-z0-9 _]$/.test(c))
      .slice(0, 16)
      .join('');
    if (cleaned !== raw) {
      // Mirror back so the native text input reflects the sanitized
      // buffer (prevents invalid chars from appearing in the DOM value
      // while the player sees our sanitized display).
      domInput.value = cleaned;
    }
    buffer = cleaned;
    render();
  };
  domInput.addEventListener('input', onDomInput);

  const keyHandler = (ev: KeyboardEvent): void => {
    if (ev.key === 'Enter') {
      tryConfirm();
      return;
    }
    if (ev.key === 'Escape') {
      doSkip();
      return;
    }
    // If focus is on the DOM input, the 'input' event above handles
    // typing — don't duplicate here.
    if (document.activeElement === domInput) return;
    if (ev.key === 'Backspace') {
      buffer = buffer.slice(0, -1);
      domInput.value = buffer;
      render();
      return;
    }
    if (ev.key.length === 1 && /^[A-Za-z0-9 _]$/.test(ev.key) && buffer.length < 16) {
      buffer += ev.key;
      domInput.value = buffer;
      render();
    }
  };
  window.addEventListener('keydown', keyHandler);

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => close());
}
