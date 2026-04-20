import * as Phaser from 'phaser';
import { CLASSES } from '../data/classes';
import { endRun, getRun, ESCORT_MAX_HP } from '../state/run';
import { FONT } from '../util/ui';
import { stopAllMusic } from '../util/audio';
import { stopMusic } from '../util/music';
import { installPauseMenuEsc } from '../util/pauseMenu';
import { resetLobbyForNextRun } from '../state/lobby';

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

    // Clear the pool-based music state, then defensively stop any stray tracks.
    stopMusic();
    stopAllMusic(this);
    this.registry.remove('currentRouteMusic');

    this.cameras.main.setBackgroundColor(this.outcome === 'victory' ? '#14281e' : '#281414');

    const title = this.outcome === 'victory' ? 'THE RELAY IS REACHED' : 'THE ROUTE IS LOST';
    const titleColor = this.outcome === 'victory' ? '#8aff8a' : '#ff8a8a';

    this.add
      .text(width / 2, 100, title, {
        fontFamily: FONT,
        fontSize: '48px',
        color: titleColor,
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 160, this.reason || `${run.route.name} complete.`, {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#aaaaaa',
      })
      .setOrigin(0.5);

    if (this.outcome === 'victory') {
      let score = run.escortHp * 2;
      for (const key of run.party) {
        score += run.partyHp[key] ?? 0;
      }
      this.add
        .text(width / 2, 230, `SCORE  ${score}`, {
          fontFamily: FONT,
          fontSize: '32px',
          color: '#ffdd55',
        })
        .setOrigin(0.5);
    }

    let y = 310;
    for (const key of run.party) {
      const def = CLASSES[key];
      const hp = run.partyHp[key] ?? 0;
      this.add
        .text(width / 2, y, `${def.name}   HP ${hp}/${def.hp}`, {
          fontFamily: FONT,
          fontSize: '20px',
          color: '#e6e6e6',
        })
        .setOrigin(0.5);
      y += 35;
    }
    this.add
      .text(width / 2, y + 10, `Dr. Vey   HP ${run.escortHp}/${ESCORT_MAX_HP}`, {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#f5c97b',
      })
      .setOrigin(0.5);

    const btn = this.add
      .text(width / 2, height - 80, '[ Return to Greenhouse ]', {
        fontFamily: FONT,
        fontSize: '26px',
        color: '#8aff8a',
        backgroundColor: '#2a3a2a',
        padding: { x: 24, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    btn.on('pointerup', () => this.returnToLobby());
    this.input.keyboard?.once('keydown-SPACE', () => this.returnToLobby());

    installPauseMenuEsc(this);
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
      'Journey',
      'Rest',
      'Lobby',
    ]) {
      if (sm.isActive(key) || sm.isPaused(key) || sm.isSleeping(key)) sm.stop(key);
    }
    this.scene.start('Lobby');
  }
}
