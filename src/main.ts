import * as Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { BackgroundLoadScene } from './scenes/BackgroundLoadScene';
import { TitleScene } from './scenes/TitleScene';
import { LeaderSelectScene } from './scenes/LeaderSelectScene';
import { CombatScene } from './scenes/CombatScene';
import { RouteScene } from './scenes/RouteScene';
import { RestScene } from './scenes/RestScene';
import { RunCompleteScene } from './scenes/RunCompleteScene';
import { JourneyScene } from './scenes/JourneyScene';
import { mountDebugBadge } from './util/logger';
import { initAudioSettings } from './util/audio';

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
  scene: [
    BootScene,
    BackgroundLoadScene,
    TitleScene,
    LeaderSelectScene,
    RouteScene,
    CombatScene,
    JourneyScene,
    RestScene,
    RunCompleteScene,
  ],
};

const game = new Phaser.Game(config);
(window as unknown as { phaserGame: Phaser.Game }).phaserGame = game;
initAudioSettings(game);
mountDebugBadge();
