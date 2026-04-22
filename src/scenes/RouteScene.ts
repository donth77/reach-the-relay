import * as Phaser from 'phaser';
import { ROUTES } from '../data/routes';
import { startRun } from '../state/run';
import { FONT } from '../util/ui';
import { playSfx } from '../util/audio';
import { installPauseMenuEsc } from '../util/pauseMenu';

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
      .text(width / 2, 135, 'Greenhouse → The Relay', {
        fontFamily: FONT,
        fontSize: '22px',
        color: '#888888',
      })
      .setOrigin(0.5);

    const ROW_FILL = 0x3a2f24;
    const ROW_FILL_HOVER = 0x5a4534;
    const ROW_STROKE = 0x8a7060;
    const ROW_STROKE_HOVER = 0xd8b088;

    ROUTES.forEach((route, i) => {
      const y = 230 + i * 130;
      const bg = this.add
        .rectangle(width / 2, y, 760, 100, ROW_FILL, 0.9)
        .setStrokeStyle(3, ROW_STROKE);

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

      // Star rating + text label — redundant shape + text signals alongside
      // the color-coded name so red/green color-blind players can still tell
      // the tiers apart.
      const stars =
        route.difficulty === 'easy'
          ? '\u2605\u2606\u2606'
          : route.difficulty === 'medium'
            ? '\u2605\u2605\u2606'
            : '\u2605\u2605\u2605';
      this.add
        .text(width / 2 + 290, y - 30, stars, {
          fontFamily: FONT,
          fontSize: '26px',
          color: titleColor,
        })
        .setOrigin(0.5);

      this.add
        .text(width / 2 + 290, y - 6, route.difficulty.toUpperCase(), {
          fontFamily: FONT,
          fontSize: '13px',
          color: titleColor,
        })
        .setOrigin(0.5);

      this.add
        .text(width / 2 + 290, y + 18, '[ BEGIN ]', {
          fontFamily: FONT,
          fontSize: '22px',
          color: '#8aff8a',
        })
        .setOrigin(0.5);

      bg.setInteractive({ useHandCursor: true })
        .on('pointerover', () => {
          bg.setFillStyle(ROW_FILL_HOVER, 0.95);
          bg.setStrokeStyle(3, ROW_STROKE_HOVER);
        })
        .on('pointerout', () => {
          bg.setFillStyle(ROW_FILL, 0.9);
          bg.setStrokeStyle(3, ROW_STROKE);
        })
        .once('pointerup', () => {
          playSfx(this, 'sfx-menu-confirm', 0.5);
          startRun(route, this.party);
          this.scene.start('Journey', { fromRouteStart: true });
        });
    });

    this.add
      .text(width / 2, height - 40, 'ESC → menu', {
        fontFamily: FONT,
        fontSize: '16px',
        color: '#888888',
      })
      .setOrigin(0.5);

    installPauseMenuEsc(this);
  }
}
