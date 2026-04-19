import * as Phaser from 'phaser';
import { CLASSES } from '../data/classes';
import { getRun, ESCORT_MAX_HP } from '../state/run';
import { FONT } from '../util/ui';

const HEAL_HP_PCT = 0.3;
const HEAL_MP_PCT = 0.2;
const HEAL_ESCORT_PCT = 0.15;
const REVIVE_KO_PCT = 0.25;

export class RestScene extends Phaser.Scene {
  constructor() {
    super('Rest');
  }

  create(): void {
    const { width, height } = this.scale;
    const run = getRun();
    this.cameras.main.setBackgroundColor('#14241a');

    for (const key of run.party) {
      const def = CLASSES[key];
      const current = run.partyHp[key] ?? def.hp;
      let next: number;
      if (current <= 1) {
        next = Math.round(def.hp * REVIVE_KO_PCT);
      } else {
        next = Math.min(def.hp, Math.round(current + def.hp * HEAL_HP_PCT));
      }
      run.partyHp[key] = next;

      if (def.mp > 0) {
        const currentMp = run.partyMp[key] ?? def.mp;
        run.partyMp[key] = Math.min(def.mp, Math.round(currentMp + def.mp * HEAL_MP_PCT));
      }
    }
    run.escortHp = Math.min(
      ESCORT_MAX_HP,
      Math.round(run.escortHp + ESCORT_MAX_HP * HEAL_ESCORT_PCT),
    );

    this.add
      .text(width / 2, 80, 'REST STOP', {
        fontFamily: FONT,
        fontSize: '48px',
        color: '#8aff8a',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 140, 'A brief moment of quiet. The party catches their breath.', {
        fontFamily: FONT,
        fontSize: '18px',
        color: '#888888',
      })
      .setOrigin(0.5);

    let y = 230;
    for (const key of run.party) {
      const def = CLASSES[key];
      const mpPart = def.mp > 0 ? `   MP ${run.partyMp[key]}/${def.mp}` : '';
      this.add
        .text(width / 2, y, `${def.name}   HP ${run.partyHp[key]}/${def.hp}${mpPart}`, {
          fontFamily: FONT,
          fontSize: '22px',
          color: '#e6e6e6',
        })
        .setOrigin(0.5);
      y += 40;
    }
    this.add
      .text(width / 2, y + 10, `Dr. Vey   HP ${run.escortHp}/${ESCORT_MAX_HP}`, {
        fontFamily: FONT,
        fontSize: '22px',
        color: '#f5c97b',
      })
      .setOrigin(0.5);

    const btn = this.add
      .text(width / 2, height - 100, '[ Continue ]', {
        fontFamily: FONT,
        fontSize: '32px',
        color: '#8aff8a',
        backgroundColor: '#2a3a2a',
        padding: { x: 24, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    btn.on('pointerup', () => this.scene.start('Combat'));
    this.input.keyboard?.once('keydown-SPACE', () => this.scene.start('Combat'));
  }
}
