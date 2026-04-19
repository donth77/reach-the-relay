import * as Phaser from 'phaser';
import { CLASSES } from '../data/classes';
import { endRun, getRun, ESCORT_MAX_HP } from '../state/run';
import { FONT } from '../util/ui';
import { stopAllMusic } from '../util/audio';

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

    stopAllMusic(this);
    this.registry.remove('currentRouteMusic');

    this.cameras.main.setBackgroundColor(this.outcome === 'victory' ? '#14281e' : '#281414');

    const title = this.outcome === 'victory' ? 'THE SIGNAL IS REACHED' : 'THE ROUTE IS LOST';
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
  }

  private returnToLobby(): void {
    endRun();
    this.scene.start('Lobby');
  }
}
