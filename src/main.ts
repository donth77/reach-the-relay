import * as Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { BackgroundLoadScene } from './scenes/BackgroundLoadScene';
import { CombatLoadScene } from './scenes/CombatLoadScene';
import { TitleScene } from './scenes/TitleScene';
import { LeaderSelectScene } from './scenes/LeaderSelectScene';
import { LobbyScene } from './scenes/LobbyScene';
import { PartySelectScene } from './scenes/PartySelectScene';
import { PartySelectTerminalScene } from './scenes/PartySelectTerminalScene';
import { CombatScene } from './scenes/CombatScene';
import { RouteScene } from './scenes/RouteScene';
import { RouteMapScene } from './scenes/RouteMapScene';
import { RestScene } from './scenes/RestScene';
import { RunCompleteScene } from './scenes/RunCompleteScene';
import { JourneyScene } from './scenes/JourneyScene';
import { RelayCutsceneScene } from './scenes/RelayCutsceneScene';
import { LeaderboardScene } from './scenes/LeaderboardScene';
import { mountDebugBadge, mountDebugCollisionToggle } from './util/logger';
import { initAudioSettings } from './util/audio';
import { initOrientationLock } from './util/orientationLock';
import { initAutoFullscreenOnFirstGesture } from './util/fullscreen';
import { ingestUrlUsername } from './state/player';

// Portal entry support: if the page was loaded with `?username=<name>`,
// populate localStorage BEFORE any scene reads it. Keeps portal visitors
// from seeing the username prompt on Title.
ingestUrlUsername();

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
    CombatLoadScene,
    TitleScene,
    LeaderSelectScene,
    LobbyScene,
    PartySelectScene,
    PartySelectTerminalScene,
    RouteScene,
    RouteMapScene,
    CombatScene,
    JourneyScene,
    RestScene,
    RelayCutsceneScene,
    RunCompleteScene,
    LeaderboardScene,
  ],
};

const game = new Phaser.Game(config);
(window as unknown as { phaserGame: Phaser.Game }).phaserGame = game;
initAudioSettings(game);
mountDebugBadge();
mountDebugCollisionToggle();
initOrientationLock();
initAutoFullscreenOnFirstGesture();
