import * as Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { LobbyScene } from './scenes/LobbyScene';
import { CombatScene } from './scenes/CombatScene';
import { RouteScene } from './scenes/RouteScene';
import { RestScene } from './scenes/RestScene';
import { RunCompleteScene } from './scenes/RunCompleteScene';
import { mountDebugBadge } from './util/logger';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0a0a0a',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720,
  },
  pixelArt: true,
  scene: [BootScene, LobbyScene, RouteScene, CombatScene, RestScene, RunCompleteScene],
};

const game = new Phaser.Game(config);
(window as unknown as { phaserGame: Phaser.Game }).phaserGame = game;
mountDebugBadge();
