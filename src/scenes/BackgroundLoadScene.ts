import * as Phaser from 'phaser';
import { log } from '../util/logger';

const PARTY_KEYS = ['vanguard', 'netrunner', 'medic', 'scavenger', 'cybermonk'] as const;
const NPC_KEYS = ['drvey', 'mira'] as const;
const NON_SOUTH_DIRECTIONS = ['east', 'north', 'west'] as const;

/**
 * Tier 2a — Lobby essentials. Launched by BootScene.create. Loads only what
 * the player will see/touch up to and including the walkable Lobby:
 * party non-south directions + world animations, NPC sprites, lobby
 * backgrounds + props, lobby idle animations, journey icons.
 *
 * On completion sets `assets:lobby-loaded = true` so LeaderSelect.confirmLeader
 * can transition to Lobby without blocking on combat/map/music assets, then
 * launches CombatLoadScene to keep the rest streaming in the background.
 *
 * `playMusicPool` filters to cache-hit keys, so any music that hasn't loaded
 * yet at scene transition just degrades to silence — no broken playback.
 */
export class BackgroundLoadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BackgroundLoad', active: false });
  }

  preload(): void {
    // --- Party non-south directions ---
    // (south is in BootScene for the LeaderSelect portrait)
    for (const key of PARTY_KEYS) {
      for (const dir of NON_SOUTH_DIRECTIONS) {
        this.load.image(`${key}-${dir}`, `assets/sprites/party/${key}/${dir}.png`);
      }
    }

    // --- Party world / lobby animations ---
    for (const key of PARTY_KEYS) {
      const worldWalkFrames: Partial<
        Record<string, Partial<Record<'south' | 'north' | 'east' | 'west', number>>>
      > = {
        vanguard: { south: 4, north: 6, east: 4 },
        medic: { south: 6, north: 6, east: 6, west: 6 },
        scavenger: { south: 6, north: 6, west: 6 },
        netrunner: { south: 6, north: 6, west: 6 },
        cybermonk: { south: 6, north: 6, west: 6 },
      };

      if (key === 'vanguard') {
        for (const dir of ['south', 'north', 'east', 'west'] as const) {
          this.load.image(`${key}-world-${dir}`, `assets/sprites/party/${key}/world/${dir}.png`);
        }
      }
      const classWalk = worldWalkFrames[key];
      if (classWalk) {
        for (const dir of Object.keys(classWalk) as Array<'south' | 'north' | 'east' | 'west'>) {
          const count = classWalk[dir] ?? 0;
          for (let i = 0; i < count; i++) {
            const padded = i.toString().padStart(3, '0');
            this.load.image(
              `${key}-worldwalk-${dir}-${padded}`,
              `assets/sprites/party/${key}/anim/worldwalk-${dir}/frame_${padded}.png`,
            );
          }
        }
      }
    }

    // --- Lobby idle animations (stationary class NPCs around the room) ---
    for (let i = 0; i < 9; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `scavenger-workbench-west-${padded}`,
        `assets/sprites/party/scavenger/anim/workbench-west/frame_${padded}.png`,
      );
    }
    for (let i = 0; i < 9; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `netrunner-typing-west-${padded}`,
        `assets/sprites/party/netrunner/anim/typing-west/frame_${padded}.png`,
      );
    }
    for (let i = 0; i < 8; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `cybermonk-meditate-south-${padded}`,
        `assets/sprites/party/cybermonk/anim/meditate-south/frame_${padded}.png`,
      );
    }
    for (let i = 0; i < 9; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `vanguard-punchingbag-west-${padded}`,
        `assets/sprites/party/vanguard/anim/punchingbag-west/frame_${padded}.png`,
      );
    }

    // --- NPC sprites (4 directions each) ---
    for (const key of NPC_KEYS) {
      for (const dir of ['south', 'east', 'north', 'west'] as const) {
        this.load.image(`${key}-${dir}`, `assets/sprites/npcs/${key}/${dir}.png`);
      }
    }

    // --- Dr. Vey worldwalk + activate (escort NPC in Lobby) ---
    for (const dir of ['south', 'north', 'west'] as const) {
      for (let i = 0; i < 6; i++) {
        const padded = i.toString().padStart(3, '0');
        this.load.image(
          `drvey-worldwalk-${dir}-${padded}`,
          `assets/sprites/npcs/drvey/anim/worldwalk-${dir}/frame_${padded}.png`,
        );
      }
    }
    for (let i = 0; i < 9; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `drvey-activate-north-${padded}`,
        `assets/sprites/npcs/drvey/anim/activate-north/frame_${padded}.png`,
      );
    }

    // --- Lobby bg + props ---
    this.load.image('lobby-greenhouse', 'assets/backgrounds/lobby/greenhouse.webp');
    this.load.image('lobby-terminal', 'assets/sprites/props/lobby/terminal.webp');
    this.load.image('lobby-planter-bed', 'assets/sprites/props/lobby/planter-bed.webp');
    this.load.image('lobby-table', 'assets/sprites/props/lobby/table.webp');
    this.load.image('lobby-workbench', 'assets/sprites/props/lobby/workbench.webp');
    this.load.image('lobby-sidetable', 'assets/sprites/props/lobby/sidetable.webp');
    this.load.image('lobby-radio', 'assets/sprites/props/lobby/radio.webp');
    this.load.image('lobby-mapboard', 'assets/sprites/props/lobby/mapboard.png');
    this.load.image('lobby-relayboard', 'assets/sprites/props/lobby/relayboard.png');
    this.load.image('lobby-punchingbag', 'assets/sprites/props/lobby/punchingbag.png');
    this.load.image('lobby-cushion', 'assets/sprites/props/lobby/cushion.png');
    this.load.image('lobby-planter-square', 'assets/sprites/props/lobby/planter-square.png');
    this.load.image('lobby-supply-shelf', 'assets/sprites/props/lobby/supply-shelf.png');
    this.load.image('journey-icon-greenhouse', 'assets/sprites/ui/journey-greenhouse.png');
    this.load.image('journey-icon-relay', 'assets/sprites/ui/journey-relay.png');
    this.load.image('lobby-map-full', 'assets/ui/map-full.png');
  }

  create(): void {
    log('BG_LOAD', 'lobby tier loaded');
    this.registry.set('assets:lobby-loaded', true);
    // Hand off to combat-tier loader. This keeps streaming in the background
    // while the player is in Lobby; if they're slow enough, by the time they
    // hit Route Select / Combat the bundle is ready.
    this.scene.launch('CombatLoad');
    this.scene.stop();
  }
}
