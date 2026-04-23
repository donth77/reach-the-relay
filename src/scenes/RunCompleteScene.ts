import * as Phaser from 'phaser';
import { CLASSES } from '../data/classes';
import { endRun, getRun, VIP_MAX_HP, startRun } from '../state/run';
import { ROUTES } from '../data/routes';
import { FONT } from '../util/ui';
import { stopAllMusic } from '../util/audio';
import { stopMusic, playMusicPool } from '../util/music';
import { installPauseMenuEsc } from '../util/pauseMenu';
import { resetLobbyForNextRun } from '../state/lobby';
import {
  submitScore,
  ROUTE_BONUS_BY_DIFFICULTY,
  getApiUrl,
  type LeaderboardRoute,
} from '../state/leaderboard';

// Debug flag — when set, surfaces a [ TEST SUBMIT (PROD) ] button on the
// victory screen and appends the submit source (remote/local) to the
// "Submitted!" modal. Use to diagnose cases where a run appears to submit
// but the entry never shows up on the remote leaderboard.
const DEBUG_LEADERBOARD_PROD =
  (import.meta.env.VITE_DEBUG_LEADERBOARD_PROD as string | undefined) === 'true';
import { getUsername } from '../state/player';
import { openUsernamePrompt, isUsernamePromptOpen } from '../util/usernamePrompt';
import { createHoverButton, GOLD_BUTTON_STYLE } from '../util/button';

// Module-scoped cache of the last score submission — so re-entering
// RunCompleteScene (e.g. via BACK from the Leaderboard scene) doesn't
// re-submit the same score and show a loading state again. Cleared
// when the player leaves via CONTINUE (returnToTitle) so the next run
// starts fresh.
interface CachedSubmitResult {
  score: number;
  rank: number | null;
  source: 'remote' | 'local';
}
let cachedSubmitResult: CachedSubmitResult | null = null;

interface SceneData {
  outcome?: 'victory' | 'defeat';
  reason?: string;
}

export class RunCompleteScene extends Phaser.Scene {
  private outcome: 'victory' | 'defeat' = 'victory';
  private reason: string = '';

  constructor() {
    super('RunComplete');
  }

  init(data: SceneData): void {
    this.outcome = data.outcome ?? 'victory';
    this.reason = data.reason ?? '';
  }

  create(): void {
    const { width, height } = this.scale;
    const run = getRun();

    if (this.outcome === 'victory') {
      // Victory: the main theme is already playing from RelayCutsceneScene.
      // `playMusicPool` no-ops when the current track is in the new pool,
      // so the theme carries through seamlessly. Fallback: if the cutscene
      // was skipped or didn't start the theme, start it here.
      playMusicPool(this, ['music-main-theme'], 0.35);
    } else {
      // Defeat: clear existing music and play the "Signal Lost" defeat theme.
      // The sting motif sits at the head of the track, the rest is a sparse
      // ambient bed — one asset serves both the "loss" moment and the
      // background under the retry/menu UI. Plays once, doesn't loop.
      stopMusic();
      stopAllMusic(this);
      this.registry.remove('currentRouteMusic');
      this.sound.play('music-signal-lost', { volume: 0.35, loop: false });
    }

    this.cameras.main.setBackgroundColor(this.outcome === 'victory' ? '#14281e' : '#281414');

    const title = this.outcome === 'victory' ? 'THE RELAY IS REACHED' : 'THE ROUTE IS LOST';
    const titleColor = this.outcome === 'victory' ? '#8aff8a' : '#ff8a8a';

    this.add
      .text(width / 2, 100, title, {
        fontFamily: FONT,
        fontSize: '64px',
        color: titleColor,
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 175, this.reason || `${run.route.name} complete.`, {
        fontFamily: FONT,
        fontSize: '28px',
        color: '#aaaaaa',
      })
      .setOrigin(0.5);

    // Final score = HP-based base + flat route bonus (harder routes add
    // more). Computed only on victory. Auto-submits if a callsign is
    // already stored; otherwise shows a "[ SUBMIT TO LEADERBOARD ]" button
    // that opens the callsign prompt (skippable — leaderboard is opt-in).
    let rankText: Phaser.GameObjects.Text | undefined;
    let finalScore = 0;
    if (this.outcome === 'victory') {
      const baseScore = run.vipHp * 2 + run.party.reduce((s, k) => s + (run.partyHp[k] ?? 0), 0);
      const routeBonus = ROUTE_BONUS_BY_DIFFICULTY[run.route.difficulty] ?? 0;
      finalScore = baseScore + routeBonus;

      this.add
        .text(width / 2, 245, `SCORE  ${finalScore}`, {
          fontFamily: FONT,
          fontSize: '44px',
          color: '#ffdd55',
        })
        .setOrigin(0.5);

      // Button / status row sits ABOVE the CONTINUE button at the bottom
      // of the screen (not squeezed between score and HP table). Buttons
      // here are slightly smaller than CONTINUE — secondary actions.
      // Layout:
      //   left slot:  [ SUBMIT SCORE ] button  OR  "RANK #X" text
      //   right slot: [ LEADERBOARD ] button
      // Nudged down so the submit/rank row isn't crammed right under
      // the HP table — gives ~80 px of breathing room above it, and
      // the gap below to CONTINUE shrinks to ~70 px correspondingly.
      const ROW_Y = height - 140;
      const LEFT_X = width / 2 - 150;
      const RIGHT_X = width / 2 + 150;

      // Rank text occupies the LEFT slot. Hidden until there's something
      // to display — either auto-submit resolves (callsign set) or the
      // player uses the SUBMIT button and that resolves.
      rankText = this.add
        .text(LEFT_X, ROW_Y, '', {
          fontFamily: FONT,
          fontSize: '22px',
          color: '#8aa5cf',
        })
        .setOrigin(0.5);

      // LEADERBOARD button — always visible on victory, right slot.
      // Return value unused; focus-cycle collection finds buttons by
      // label text below.
      createHoverButton(this, {
        x: RIGHT_X,
        y: ROW_Y,
        label: '[ LEADERBOARD ]',
        fontSize: '24px',
        padding: { x: 18, y: 8 },
        ...GOLD_BUTTON_STYLE,
        onClick: () => {
          // Keep the run state alive — BACK from the leaderboard
          // should return to THIS victory screen so the player sees
          // their score / rank / HP table again before choosing
          // CONTINUE. `endRun` + `resetLobbyForNextRun` now fire only
          // from the actual CONTINUE path (`returnToTitle`), not here.
          this.scene.start('Leaderboard', {
            initialFilter: run.route.id as LeaderboardRoute,
            returnScene: 'RunComplete',
            returnSceneData: {
              outcome: this.outcome,
              reason: this.reason,
            },
          });
        },
      });

      if (getUsername()) {
        // On re-entry from Leaderboard BACK, skip the network round-trip
        // and paint the rank we already resolved. Only submit fresh if
        // no cache or the score somehow differs.
        if (cachedSubmitResult && cachedSubmitResult.score === finalScore) {
          const r = cachedSubmitResult;
          if (r.rank !== null) {
            const suffix = r.source === 'local' ? ' (local)' : '';
            rankText.setText(`RANK  #${r.rank}${suffix}`);
            rankText.setColor(r.source === 'local' ? '#ffbb66' : '#8aff8a');
          } else {
            rankText.setText('RANK  —');
            rankText.setColor('#888');
          }
        } else {
          rankText.setText('RANK  —');
          void this.submitLeaderboardEntry(finalScore, rankText);
        }
      } else {
        // No callsign — SUBMIT button in the left slot. Rank text hidden
        // until the player submits successfully.
        rankText.setVisible(false);
        const submitBtn = createHoverButton(this, {
          x: LEFT_X,
          y: ROW_Y,
          label: '[ SUBMIT SCORE ]',
          fontSize: '24px',
          padding: { x: 18, y: 8 },
          ...GOLD_BUTTON_STYLE,
          onClick: () => {
            openUsernamePrompt(this, {
              onConfirm: () => {
                submitBtn.destroy();
                rankText!.setVisible(true);
                rankText!.setText('RANK  —');
                rankText!.setColor('#8aa5cf');
                void this.submitLeaderboardEntry(finalScore, rankText!, true);
              },
              onCancel: () => {
                // No-op — button stays for a retry.
              },
            });
          },
        });
      }

      if (DEBUG_LEADERBOARD_PROD) {
        createHoverButton(this, {
          x: width / 2,
          y: ROW_Y + 44,
          label: '[ TEST SUBMIT (PROD) ]',
          fontSize: '18px',
          idleBg: '#402020',
          hoverBg: '#6a3030',
          idleColor: '#ffaaaa',
          hoverColor: '#ffffff',
          padding: { x: 14, y: 6 },
          onClick: () => void this.runDebugProdSubmit(finalScore),
        });
      }
    }

    // Two-column table so every HP value lines up in its own left-aligned
    // column, regardless of how long the character's name + role is. Name
    // column is left-aligned at nameColX; HP column is left-aligned at
    // hpColX further right.
    const nameColX = width / 2 - 290;
    const hpColX = width / 2 + 120;
    let y = 340;
    for (const key of run.party) {
      const def = CLASSES[key];
      const hp = run.partyHp[key] ?? 0;
      this.add
        .text(nameColX, y, `${def.personName} (${def.name})`, {
          fontFamily: FONT,
          fontSize: '28px',
          color: '#e6e6e6',
        })
        .setOrigin(0, 0.5);
      this.add
        .text(hpColX, y, `HP ${hp}/${def.hp}`, {
          fontFamily: FONT,
          fontSize: '28px',
          color: '#e6e6e6',
        })
        .setOrigin(0, 0.5);
      y += 44;
    }
    this.add
      .text(nameColX, y + 14, 'Dr. Vey', {
        fontFamily: FONT,
        fontSize: '28px',
        color: '#f5c97b',
      })
      .setOrigin(0, 0.5);
    this.add
      .text(hpColX, y + 14, `HP ${run.vipHp}/${VIP_MAX_HP}`, {
        fontFamily: FONT,
        fontSize: '28px',
        color: '#f5c97b',
      })
      .setOrigin(0, 0.5);

    // CONTINUE button sits centered below the HP table. On victory, when
    // the player has no callsign yet, a SUBMIT SCORE button stacks above
    // CONTINUE so they can opt in without leaving the screen. No separate
    // LEADERBOARD button — players reach the leaderboard from the Title
    // menu or the Lobby prop; the victory screen is focused on
    // "finalize this run, then move on".
    const continueBtn = createHoverButton(this, {
      x: width / 2,
      y: height - 70,
      label: '[ CONTINUE ]',
      fontSize: '30px',
      padding: { x: 28, y: 12 },
      onClick: () => this.returnToTitle(),
    });

    // Keyboard focus cycle — collect all on-screen buttons (order:
    // left → right → continue) and draw a white border around the
    // currently focused one. TAB / LEFT / RIGHT cycle; ENTER / SPACE
    // activate. Makes the victory screen keyboard-complete while
    // preserving the existing per-button pointer handlers.
    type FocusableBtn = { text: Phaser.GameObjects.Text; activate: () => void };
    const focusables: FocusableBtn[] = [];
    // Only the `submitBtn` variant uses the `leaderboardBtn` rendered
    // above; rebuild the focusable list from whichever buttons exist
    // on the stage now.
    if (this.outcome === 'victory') {
      if (rankText && !getUsername()) {
        // Submit button was rendered — find it (only interactive gold
        // pill on the left slot). We added `submitBtn` above; pick it
        // up via children lookup on the scene.
      }
    }
    // Simpler: explicit references (already have `continueBtn`; rebuild
    // the inline refs here).
    // — collect interactive children in insertion order, filter to
    // the two gold pills + continue.
    const children = this.children.getAll() as Phaser.GameObjects.Text[];
    for (const child of children) {
      if (!(child instanceof Phaser.GameObjects.Text)) continue;
      const t = child.text;
      if (t === '[ LEADERBOARD ]') {
        focusables.push({
          text: child,
          activate: () => child.emit('pointerup'),
        });
      } else if (t === '[ SUBMIT SCORE ]') {
        focusables.push({
          text: child,
          activate: () => child.emit('pointerup'),
        });
      }
    }
    focusables.push({ text: continueBtn, activate: () => this.returnToTitle() });

    // -1 = no focus (border hidden). Flips to a real index when the
    // player hovers a button OR presses a cycle key. Hovering OUT
    // clears back to -1 so the border never lingers once the mouse
    // leaves its button.
    let focusedIdx = -1;
    const focusBorder = this.add.graphics();
    const redrawFocusBorder = (): void => {
      focusBorder.clear();
      if (focusedIdx < 0) return;
      const f = focusables[focusedIdx];
      if (!f) return;
      const b = f.text.getBounds();
      const pad = 6;
      focusBorder.lineStyle(3, 0xffffff, 0.9);
      focusBorder.strokeRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
    };
    // CONTINUE is last in the focusables list; use it as the default
    // first selection when the player starts keyboard-navigating.
    const CONTINUE_IDX = focusables.length - 1;
    const moveFocus = (delta: number): void => {
      const n = focusables.length;
      if (n === 0) return;
      // First cycle key with no current focus: land on CONTINUE
      // (the most common action on this screen). Delta is not
      // applied — the player has to press the key again to cycle
      // away. Subsequent presses wrap around the full list.
      if (focusedIdx < 0) {
        focusedIdx = CONTINUE_IDX;
      } else {
        focusedIdx = (focusedIdx + delta + n) % n;
      }
      redrawFocusBorder();
    };
    const activateFocused = (): void => {
      // No focus yet → fall back to the primary CONTINUE action so
      // Enter/Space still works as the "one-key finish the screen"
      // shortcut without requiring the player to cycle first.
      if (focusedIdx < 0) {
        this.returnToTitle();
        return;
      }
      const f = focusables[focusedIdx];
      if (f) f.activate();
    };
    focusables.forEach((f, i) => {
      f.text.on('pointerover', () => {
        focusedIdx = i;
        redrawFocusBorder();
      });
      f.text.on('pointerout', () => {
        if (focusedIdx === i) {
          focusedIdx = -1;
          redrawFocusBorder();
        }
      });
    });
    // Focus-cycle shortcuts are suppressed while the callsign input modal
    // is open — otherwise typing letters like A/D/E/SPACE or pressing
    // TAB/ENTER would both enter characters AND move focus on the victory
    // screen underneath.
    this.input.keyboard?.on('keydown-TAB', (ev: KeyboardEvent) => {
      if (isUsernamePromptOpen()) return;
      ev.preventDefault?.();
      moveFocus(ev.shiftKey ? -1 : 1);
    });
    this.input.keyboard?.on('keydown-LEFT', () => {
      if (isUsernamePromptOpen()) return;
      moveFocus(-1);
    });
    this.input.keyboard?.on('keydown-RIGHT', () => {
      if (isUsernamePromptOpen()) return;
      moveFocus(1);
    });
    this.input.keyboard?.on('keydown-A', () => {
      if (isUsernamePromptOpen()) return;
      moveFocus(-1);
    });
    this.input.keyboard?.on('keydown-D', () => {
      if (isUsernamePromptOpen()) return;
      moveFocus(1);
    });
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (isUsernamePromptOpen()) return;
      activateFocused();
    });
    this.input.keyboard?.on('keydown-SPACE', () => {
      if (isUsernamePromptOpen()) return;
      activateFocused();
    });
    this.input.keyboard?.on('keydown-E', () => {
      if (isUsernamePromptOpen()) return;
      activateFocused();
    });

    installPauseMenuEsc(this, {
      canAbandon: false,
      shouldBlockEsc: () => isUsernamePromptOpen(),
    });
  }

  /**
   * Submit the run's score to the leaderboard and update the rank line
   * in the UI once we have a number back. Graceful on failure — the
   * rank line falls back to "RANK  —" with a status hint.
   */
  private async submitLeaderboardEntry(
    score: number,
    rankText: Phaser.GameObjects.Text,
    showToast = false,
  ): Promise<void> {
    const run = getRun();
    const username = getUsername();
    if (!username) {
      // No username set — can't submit. Shouldn't happen in practice since
      // Title screen gates on username before allowing a run to start, but
      // handle gracefully.
      rankText.setText('RANK  (no callsign set)');
      rankText.setColor('#888');
      return;
    }
    const durationSec = Math.max(0, Math.floor((Date.now() - run.startedAt) / 1000));
    const result = await submitScore({
      username,
      score,
      leaderId: run.leaderId,
      route: run.route.id as LeaderboardRoute,
      durationSec,
    });
    // Cache so re-entering this scene from the leaderboard doesn't
    // resubmit the same score.
    cachedSubmitResult = { score, rank: result.rank, source: result.source };
    if (result.rank !== null) {
      const suffix = result.source === 'local' ? ' (local)' : '';
      rankText.setText(`RANK  #${result.rank}${suffix}`);
      rankText.setColor(result.source === 'local' ? '#ffbb66' : '#8aff8a');
      if (showToast) this.showSubmittedModal(result.source, result.rank, result.error);
    } else {
      rankText.setText('RANK  —');
      rankText.setColor('#888');
      if (showToast) this.showSubmittedModal(result.source, null, result.error);
    }
  }

  private async runDebugProdSubmit(finalScore: number): Promise<void> {
    const run = getRun();
    const username = getUsername() ?? `debug_${Math.random().toString(36).slice(2, 8)}`;
    const durationSec = Math.max(0, Math.floor((Date.now() - run.startedAt) / 1000));
    const result = await submitScore({
      username,
      score: finalScore,
      leaderId: run.leaderId,
      route: run.route.id as LeaderboardRoute,
      durationSec,
    });
    this.showSubmittedModal(result.source, result.rank, result.error, {
      isDebug: true,
      username,
    });
  }

  private showSubmittedModal(
    source?: 'remote' | 'local',
    rank?: number | null,
    error?: string,
    debug?: { isDebug: boolean; username: string },
  ): void {
    const { width, height } = this.scale;
    const container = this.add.container(0, 0).setDepth(200000).setScrollFactor(0);

    const backdrop = this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.6)
      .setInteractive();
    container.add(backdrop);

    const isOk = source === 'remote';
    const isDebug = DEBUG_LEADERBOARD_PROD || debug?.isDebug;
    const strokeColor = isDebug ? (isOk ? 0x55ff88 : 0xffbb66) : 0x55ff88;
    const panelW = isDebug ? 560 : 420;
    const panelH = isDebug ? 300 : 200;
    const panel = this.add
      .rectangle(width / 2, height / 2, panelW, panelH, 0x051410, 0.98)
      .setStrokeStyle(3, strokeColor, 1)
      .setInteractive();
    container.add(panel);

    const title = debug?.isDebug ? 'DEBUG SUBMIT' : 'SUBMITTED!';
    const titleColor = isDebug ? (isOk ? '#8aff8a' : '#ffbb66') : '#8aff8a';
    container.add(
      this.add
        .text(width / 2, height / 2 - panelH / 2 + 40, title, {
          fontFamily: FONT,
          fontSize: '36px',
          color: titleColor,
        })
        .setOrigin(0.5),
    );

    // Non-debug: show the rank from the response so the player sees
    // where they landed without needing to open the Leaderboard scene.
    // Falls back to a neutral line if the submit resolved without a rank.
    if (!isDebug) {
      const rankLine =
        rank != null ? `RANK  #${rank}${source === 'local' ? ' (local)' : ''}` : 'Saved locally';
      container.add(
        this.add
          .text(width / 2, height / 2, rankLine, {
            fontFamily: FONT,
            fontSize: '26px',
            color: source === 'local' ? '#ffbb66' : '#8aff8a',
          })
          .setOrigin(0.5),
      );
    }

    // Diagnostic body: source + rank (+ error). Always shown when the
    // debug env is enabled so the player can tell at a glance whether
    // the Worker actually accepted the write.
    if (DEBUG_LEADERBOARD_PROD || debug?.isDebug) {
      const api = getApiUrl();
      const lines: string[] = [];
      lines.push(`api: ${api || '(unset — build-time env missing)'}`);
      lines.push(`source: ${source ?? '—'}`);
      lines.push(`rank: ${rank ?? '—'}`);
      if (debug?.username) lines.push(`callsign: ${debug.username}`);
      if (error) lines.push(`error: ${error}`);
      container.add(
        this.add
          .text(width / 2, height / 2 - 10, lines.join('\n'), {
            fontFamily: FONT,
            fontSize: '14px',
            color: '#cfe8e8',
            align: 'center',
            wordWrap: { width: panelW - 40 },
          })
          .setOrigin(0.5),
      );
    }

    const okBtn = createHoverButton(this, {
      x: width / 2,
      y: height / 2 + panelH / 2 - 40,
      label: '[ OK ]',
      fontSize: '22px',
      idleBg: '#1a4a2a',
      hoverBg: '#2f6a3f',
      padding: { x: 28, y: 10 },
      onClick: () => close(),
    });
    container.add(okBtn);

    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      window.removeEventListener('keydown', keyHandler);
      container.destroy();
    };
    const keyHandler = (ev: KeyboardEvent): void => {
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Escape') close();
    };
    window.addEventListener('keydown', keyHandler);
    backdrop.on('pointerup', () => close());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => close());
  }

  private returnToTitle(): void {
    // Clear the submit cache so the next run starts with a fresh
    // submit cycle (not showing the previous run's rank).
    cachedSubmitResult = null;
    endRun();
    // Run's over — the player restarts from the Title screen so they
    // can re-pick a leader / start fresh. Lobby would otherwise
    // bounce to LeaderSelect on some state-race paths; sending
    // straight to Title is the cleaner arc for "this run is done."
    resetLobbyForNextRun();
    // Force-stop every scene that could still be alive from the run
    // just finished so they don't leak under the Title render.
    const sm = this.scene.manager;
    for (const key of [
      'PartySelectTerminal',
      'Combat',
      'Route',
      'RouteMap',
      'Journey',
      'Rest',
      'Lobby',
    ]) {
      if (sm.isActive(key) || sm.isPaused(key) || sm.isSleeping(key)) sm.stop(key);
    }
    this.scene.start('Title');
  }

  /**
   * Debug-only: jump straight to the RunComplete scene with a fake run so
   * the layout / submit flow / leaderboard hand-off can be iterated on
   * without playing a full run. Called from TitleScene on the `R` (victory)
   * or `Shift+R` (defeat) keybind when the debug logger is enabled.
   */
  static startTest(scene: Phaser.Scene, outcome: 'victory' | 'defeat' = 'victory'): void {
    const testRoute = ROUTES.find((r) => r.id === 'long-highway') ?? ROUTES[0];
    const testParty = ['vanguard', 'medic', 'cybermonk'];
    startRun(testRoute, testParty, 'vanguard');
    // For victory tests, advance the encounter index past the end so any
    // "run complete" logic that peeks at progression sees a finished run.
    const run = getRun();
    if (outcome === 'victory') {
      run.encounterIndex = run.route.encounters.length;
      // Shave off some HP so the score isn't max — more realistic test.
      run.partyHp['vanguard'] = Math.max(1, Math.floor(CLASSES['vanguard'].hp * 0.8));
      run.partyHp['medic'] = Math.max(1, Math.floor(CLASSES['medic'].hp * 0.6));
      run.partyHp['cybermonk'] = Math.max(1, Math.floor(CLASSES['cybermonk'].hp * 0.9));
      run.vipHp = Math.max(1, Math.floor(VIP_MAX_HP * 0.7));
    } else {
      // Defeat: simulate partial progress + wiped party.
      run.encounterIndex = Math.floor(run.route.encounters.length / 2);
      run.partyHp['vanguard'] = 0;
      run.partyHp['medic'] = 0;
      run.partyHp['cybermonk'] = 0;
      run.vipHp = 0;
    }
    scene.scene.start('RunComplete', {
      outcome,
      reason: outcome === 'victory' ? 'TEST VICTORY' : 'TEST DEFEAT',
    });
  }
}
