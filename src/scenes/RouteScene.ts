import * as Phaser from 'phaser';
import { ROUTES } from '../data/routes';
import { startRun } from '../state/run';
import { FONT } from '../util/ui';

interface SceneData {
  party?: string[];
}

export class RouteScene extends Phaser.Scene {
  private party: string[] = [];

  constructor() {
    super('Route');
  }

  init(data: SceneData): void {
    this.party = data.party ?? [];
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#2a1f14');

    this.add
      .text(width / 2, 80, 'CHOOSE YOUR ROUTE', {
        fontFamily: FONT,
        fontSize: '40px',
        color: '#e6e6e6',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 135, 'Greenhouse → The Signal', {
        fontFamily: FONT,
        fontSize: '22px',
        color: '#888888',
      })
      .setOrigin(0.5);

    ROUTES.forEach((route, i) => {
      const y = 230 + i * 130;
      const bg = this.add
        .rectangle(width / 2, y, 760, 100, 0x3a2f24, 0.9)
        .setStrokeStyle(3, 0x8a7060);

      const titleColor =
        route.difficulty === 'easy'
          ? '#aaffaa'
          : route.difficulty === 'medium'
            ? '#ffdd88'
            : '#ff8a8a';

      this.add
        .text(width / 2 - 360, y - 20, route.name, {
          fontFamily: FONT,
          fontSize: '26px',
          color: titleColor,
        })
        .setOrigin(0, 0.5);

      this.add
        .text(width / 2 - 360, y + 18, route.subtitle, {
          fontFamily: FONT,
          fontSize: '16px',
          color: '#aaaaaa',
        })
        .setOrigin(0, 0.5);

      this.add
        .text(width / 2 + 290, y, '[ BEGIN ]', {
          fontFamily: FONT,
          fontSize: '24px',
          color: '#8aff8a',
        })
        .setOrigin(0.5);

      bg.setInteractive({ useHandCursor: true }).once('pointerup', () => {
        this.sound.play('sfx-menu-confirm', { volume: 0.5 });
        startRun(route, this.party);
        this.scene.start('Combat');
      });
    });

    this.add
      .text(width / 2, height - 40, 'ESC → return to lobby', {
        fontFamily: FONT,
        fontSize: '16px',
        color: '#888888',
      })
      .setOrigin(0.5);

    this.input.keyboard?.on('keydown-ESC', () => {
      this.sound.play('sfx-menu-cancel', { volume: 0.5 });
      this.scene.start('Lobby');
    });
  }
}
