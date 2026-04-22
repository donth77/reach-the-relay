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
  type LeaderboardRoute,
} from '../state/leaderboard';
import { getUsername } from '../state/player';
import { openUsernamePrompt, isUsernamePromptOpen } from '../util/usernamePrompt';

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
      const ROW_Y = height - 180;
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
      const leaderboardBtn = this.add
        .text(RIGHT_X, ROW_Y, '[ LEADERBOARD ]', {
          fontFamily: FONT,
          fontSize: '24px',
          color: '#ffdd55',
          backgroundColor: '#3a3a1a',
          padding: { x: 18, y: 8 },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      leaderboardBtn.on('pointerup', () => {
        this.scene.start('Leaderboard', {
          initialFilter: run.route.id as LeaderboardRoute,
          returnScene: 'Lobby',
        });
        endRun();
        resetLobbyForNextRun();
      });

      if (getUsername()) {
        rankText.setText('RANK  —');
        void this.submitLeaderboardEntry(finalScore, rankText);
      } else {
        // No callsign — SUBMIT button in the left slot. Rank text hidden
        // until the player submits successfully.
        rankText.setVisible(false);
        const submitBtn = this.add
          .text(LEFT_X, ROW_Y, '[ SUBMIT SCORE ]', {
            fontFamily: FONT,
            fontSize: '24px',
            color: '#ffdd55',
            backgroundColor: '#3a3a1a',
            padding: { x: 18, y: 8 },
          })
          .setOrigin(0.5)
          .setInteractive({ useHandCursor: true });
        submitBtn.on('pointerup', () => {
          openUsernamePrompt(this, {
            onConfirm: () => {
              submitBtn.destroy();
              rankText!.setVisible(true);
              rankText!.setText('RANK  —');
              rankText!.setColor('#8aa5cf');
              void this.submitLeaderboardEntry(finalScore, rankText!);
            },
            onCancel: () => {
              // No-op — the player chose to skip. Button stays for a retry.
            },
          });
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
    const continueBtn = this.add
      .text(width / 2, height - 70, '[ CONTINUE ]', {
        fontFamily: FONT,
        fontSize: '30px',
        color: '#8aff8a',
        backgroundColor: '#2a3a2a',
        padding: { x: 28, y: 12 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    continueBtn.on('pointerup', () => this.returnToLobby());
    this.input.keyboard?.once('keydown-SPACE', () => this.returnToLobby());

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
    if (result.rank !== null) {
      const suffix = result.source === 'local' ? ' (local)' : '';
      rankText.setText(`RANK  #${result.rank}${suffix}`);
      rankText.setColor(result.source === 'local' ? '#ffbb66' : '#8aff8a');
    } else {
      rankText.setText('RANK  —');
      rankText.setColor('#888');
    }
  }

  private returnToLobby(): void {
    endRun();
    // Keep the chosen leader across runs — player restarts from Title
    // to re-pick. Recruits and last position reset via
    // resetLobbyForNextRun so the next run starts with a fresh crew
    // to assemble.
    resetLobbyForNextRun();
    // Force-stop every scene that could still be alive from the run
    // just finished. scene.start('Lobby') would normally stop the
    // calling RunComplete scene, but leaked peers (PartySelectTerminal
    // paused, Journey still drawing, etc.) can keep rendering over
    // the new Lobby. Explicit manager.stop calls kill the leftovers
    // before we start Lobby fresh.
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
    this.scene.start('Lobby');
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
