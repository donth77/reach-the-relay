import * as Phaser from 'phaser';
import { FONT } from './ui';
import { playSfx } from './audio';
import { setUsername, isValidUsername, getUsername } from '../state/player';

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

  const backdrop = scene.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.88);
  backdrop.setInteractive(); // swallow clicks behind the modal
  container.add(backdrop);

  const panelW = 640;
  const panelH = 320;
  const panel = scene.add
    .rectangle(width / 2, height / 2, panelW, panelH, 0x051410, 0.98)
    .setStrokeStyle(3, 0x55ff88, 1);
  container.add(panel);

  container.add(
    scene.add
      .text(width / 2, height / 2 - 110, '> ENTER CALLSIGN', {
        fontFamily: FONT,
        fontSize: '32px',
        color: '#8aff8a',
      })
      .setOrigin(0.5),
  );
  container.add(
    scene.add
      .text(width / 2, height / 2 - 60, 'Letters, numbers, space, underscore — 1 to 16 chars', {
        fontFamily: FONT,
        fontSize: '14px',
        color: '#6aaa8a',
      })
      .setOrigin(0.5),
  );

  let buffer = getUsername() ?? '';

  const inputDisplay = scene.add
    .text(width / 2, height / 2 - 5, '', {
      fontFamily: FONT,
      fontSize: '36px',
      color: '#e6e6e6',
      backgroundColor: '#0a0a14',
      padding: { x: 24, y: 10 },
      fixedWidth: 420,
      align: 'center',
    })
    .setOrigin(0.5);
  container.add(inputDisplay);

  const hint = scene.add
    .text(width / 2, height / 2 + 65, '[ENTER] CONFIRM   [ESC] SKIP', {
      fontFamily: FONT,
      fontSize: '16px',
      color: '#6aaa8a',
    })
    .setOrigin(0.5);
  container.add(hint);

  const render = (): void => {
    const caret = Math.floor(Date.now() / 500) % 2 === 0 ? '_' : ' ';
    inputDisplay.setText(buffer + caret);
    const valid = isValidUsername(buffer);
    if (buffer.length === 0) {
      hint.setText('[ENTER] CONFIRM   [ESC] SKIP');
      hint.setColor('#6aaa8a');
    } else if (valid) {
      hint.setText('[ENTER] CONFIRM   [ESC] SKIP');
      hint.setColor('#8aff8a');
    } else {
      hint.setText('Invalid — letters, numbers, space, underscore only');
      hint.setColor('#ff8a8a');
    }
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
    container.destroy();
  };

  const keyHandler = (ev: KeyboardEvent): void => {
    if (ev.key === 'Enter') {
      if (isValidUsername(buffer) && setUsername(buffer)) {
        playSfx(scene, 'sfx-menu-confirm', 0.5);
        const saved = buffer;
        close();
        opts.onConfirm(saved);
      }
      return;
    }
    if (ev.key === 'Escape') {
      playSfx(scene, 'sfx-menu-cancel', 0.3);
      close();
      opts.onCancel?.();
      return;
    }
    if (ev.key === 'Backspace') {
      buffer = buffer.slice(0, -1);
      render();
      return;
    }
    if (ev.key.length === 1 && /^[A-Za-z0-9 _]$/.test(ev.key) && buffer.length < 16) {
      buffer += ev.key;
      render();
    }
  };
  window.addEventListener('keydown', keyHandler);

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    caretTick.remove();
    window.removeEventListener('keydown', keyHandler);
  });
}
