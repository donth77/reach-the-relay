import * as Phaser from 'phaser';
import { log } from '../util/logger';

const PARTY_KEYS = ['vanguard', 'netrunner', 'medic', 'scavenger', 'cybermonk'] as const;
const NPC_KEYS = ['drvey', 'mira'] as const;
const HUMANOID_ENEMY_KEYS = ['wirehead', 'wreckwarden'] as const;
const OBJECT_ENEMY_KEYS = ['scoutdrone', 'spiderbot', 'sentryturret', 'naniteswarm'] as const;
const DIRECTIONS = ['south', 'east', 'north', 'west'] as const;

/**
 * Invisible scene launched by BootScene.create. Loads everything that isn't
 * needed for TitleScene — all party sprites, enemy sprites, NPC sprites,
 * animation frames, lobby/combat backgrounds + props, combat SFX, and the
 * deferred music tracks. Runs in parallel with the user being on Title.
 *
 * On completion, sets `assets:loaded = true` in the game registry. TitleScene
 * gates its "Start Game" transition (and BootScene's portal-entry transition)
 * on this flag so the first scene past Title never renders with missing art.
 *
 * If the user transitions before music finishes, `playMusicPool` already
 * filters to cache-hit keys and degrades to silence — no broken playback.
 */
export class BackgroundLoadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BackgroundLoad', active: false });
  }

  preload(): void {
    // --- Party sprites (4 directions each) ---
    for (const key of PARTY_KEYS) {
      for (const dir of DIRECTIONS) {
        this.load.image(`${key}-${dir}`, `assets/sprites/party/${key}/${dir}.png`);
      }
    }

    // --- NPC sprites (4 directions each) ---
    for (const key of NPC_KEYS) {
      for (const dir of DIRECTIONS) {
        this.load.image(`${key}-${dir}`, `assets/sprites/npcs/${key}/${dir}.png`);
      }
    }

    // --- Humanoid enemy sprites (4 directions) ---
    for (const key of HUMANOID_ENEMY_KEYS) {
      for (const dir of DIRECTIONS) {
        this.load.image(`${key}-${dir}`, `assets/sprites/enemies/${key}/${dir}.png`);
      }
    }

    // --- Object enemy sprites (single side view) ---
    for (const key of OBJECT_ENEMY_KEYS) {
      this.load.image(`${key}-side`, `assets/sprites/enemies/${key}/side.png`);
    }

    // --- Party animations ---
    const ATTACK_FRAMES: Record<string, number> = {
      vanguard: 6,
      netrunner: 6,
      medic: 3,
      scavenger: 4,
      cybermonk: 3,
    };

    for (const key of PARTY_KEYS) {
      const attackFrames = ATTACK_FRAMES[key] ?? 6;
      for (let i = 0; i < attackFrames; i++) {
        const padded = i.toString().padStart(3, '0');
        this.load.image(
          `${key}-attack-west-${padded}`,
          `assets/sprites/party/${key}/anim/attack-west/frame_${padded}.png`,
        );
      }
      const walkFrames =
        key === 'cybermonk' || key === 'scavenger' || key === 'medic' || key === 'vanguard' ? 6 : 4;
      for (let i = 0; i < walkFrames; i++) {
        const padded = i.toString().padStart(3, '0');
        this.load.image(
          `${key}-walk-west-${padded}`,
          `assets/sprites/party/${key}/anim/walk-west/frame_${padded}.png`,
        );
      }
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
      const deathFrames =
        key === 'scavenger' || key === 'cybermonk'
          ? 4
          : key === 'vanguard'
            ? 11
            : key === 'medic'
              ? 9
              : 7;
      for (let i = 0; i < deathFrames; i++) {
        const padded = i.toString().padStart(3, '0');
        this.load.image(
          `${key}-death-west-${padded}`,
          `assets/sprites/party/${key}/anim/death-west/frame_${padded}.png`,
        );
      }
      this.load.image(`${key}-downed`, `assets/sprites/party/${key}/downed.png`);
    }

    // Medic cast animation (PATCH / PULSE / STIM / SHIELD)
    for (let i = 0; i < 9; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `medic-cast-west-${padded}`,
        `assets/sprites/party/medic/anim/cast-west/frame_${padded}.png`,
      );
    }

    // --- Dr. Vey (VIP) ---
    for (let i = 0; i < 7; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `drvey-death-west-${padded}`,
        `assets/sprites/npcs/drvey/anim/death-west/frame_${padded}.png`,
      );
    }
    this.load.image('drvey-downed', 'assets/sprites/npcs/drvey/downed.png');

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

    // --- Wirehead ---
    for (let i = 0; i < 6; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `wirehead-walk-east-${padded}`,
        `assets/sprites/enemies/wirehead/anim/walk-east/frame_${padded}.png`,
      );
    }
    for (let i = 0; i < 6; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `wirehead-attack-east-${padded}`,
        `assets/sprites/enemies/wirehead/anim/attack-east/frame_${padded}.png`,
      );
    }
    for (let i = 0; i < 7; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `wirehead-death-east-${padded}`,
        `assets/sprites/enemies/wirehead/anim/death-east/frame_${padded}.png`,
      );
    }
    for (let i = 0; i < 8; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `wirehead-idle-east-${padded}`,
        `assets/sprites/enemies/wirehead/anim/idle-east/frame_${padded}.png`,
      );
    }
    this.load.image('wirehead-downed', 'assets/sprites/enemies/wirehead/downed.png');

    // --- Wreckwarden ---
    for (let i = 0; i < 6; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `wreckwarden-walk-east-${padded}`,
        `assets/sprites/enemies/wreckwarden/anim/walk-east/frame_${padded}.png`,
      );
    }
    for (let i = 0; i < 4; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `wreckwarden-attack-east-${padded}`,
        `assets/sprites/enemies/wreckwarden/anim/attack-east/frame_${padded}.png`,
      );
    }
    for (let i = 0; i < 4; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `wreckwarden-death-east-${padded}`,
        `assets/sprites/enemies/wreckwarden/anim/death-east/frame_${padded}.png`,
      );
    }
    for (let i = 0; i < 8; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `wreckwarden-idle-east-${padded}`,
        `assets/sprites/enemies/wreckwarden/anim/idle-east/frame_${padded}.png`,
      );
    }
    this.load.image('wreckwarden-downed', 'assets/sprites/enemies/wreckwarden/downed.png');

    for (let i = 0; i < 8; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `sentry-attack-thermal-east-${padded}`,
        `assets/sprites/enemies/sentryturret/anim/attack-thermal-east/frame_${padded}.png`,
      );
    }

    for (let i = 0; i < 9; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `wreckwarden-attack-coolant-east-${padded}`,
        `assets/sprites/enemies/wreckwarden/anim/attack-coolant-east/frame_${padded}.png`,
      );
    }

    for (let i = 0; i < 17; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `wreckwarden-attack-shockwave-east-${padded}`,
        `assets/sprites/enemies/wreckwarden/anim/attack-shockwave-east/frame_${padded}.png`,
      );
    }

    // --- Sentry ---
    for (let i = 0; i < 8; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `sentry-walk-east-${padded}`,
        `assets/sprites/enemies/sentryturret/anim/walk-east/frame_${padded}.png`,
      );
    }
    for (let i = 0; i < 6; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `sentry-attack-east-${padded}`,
        `assets/sprites/enemies/sentryturret/anim/attack-east/frame_${padded}.png`,
      );
    }
    for (let i = 0; i < 8; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `sentry-death-east-${padded}`,
        `assets/sprites/enemies/sentryturret/anim/death-east/frame_${padded}.png`,
      );
    }
    for (let i = 0; i < 4; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `sentry-idle-east-${padded}`,
        `assets/sprites/enemies/sentryturret/anim/idle-east/frame_${padded}.png`,
      );
    }
    this.load.image('sentry-downed', 'assets/sprites/enemies/sentryturret/downed.png');

    // --- Spider-Bot ---
    for (let i = 0; i < 8; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `spider-walk-east-${padded}`,
        `assets/sprites/enemies/spiderbot/anim/walk-east/frame_${padded}.png`,
      );
    }
    for (let i = 0; i < 6; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `spider-attack-east-${padded}`,
        `assets/sprites/enemies/spiderbot/anim/attack-east/frame_${padded}.png`,
      );
    }
    for (let i = 0; i < 8; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `spider-death-east-${padded}`,
        `assets/sprites/enemies/spiderbot/anim/death-east/frame_${padded}.png`,
      );
    }
    for (let i = 0; i < 2; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `spider-idle-east-${padded}`,
        `assets/sprites/enemies/spiderbot/anim/idle-east/frame_${padded}.png`,
      );
    }
    this.load.image('spider-downed', 'assets/sprites/enemies/spiderbot/downed.png');

    // --- Scout Drone ---
    for (let i = 0; i < 2; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `scoutdrone-idle-east-${padded}`,
        `assets/sprites/enemies/scoutdrone/anim/idle-east/frame_${padded}.png`,
      );
    }

    // --- Nanite Swarm ---
    for (let i = 0; i < 8; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `naniteswarm-idle-east-${padded}`,
        `assets/sprites/enemies/naniteswarm/anim/idle-east/frame_${padded}.png`,
      );
    }

    // --- Lobby bg + props + map board ---
    this.load.image('lobby-greenhouse', 'assets/backgrounds/lobby/greenhouse.webp');
    this.load.image('lobby-terminal', 'assets/sprites/props/lobby/terminal.webp');
    this.load.image('lobby-planter-bed', 'assets/sprites/props/lobby/planter-bed.webp');
    this.load.image('lobby-table', 'assets/sprites/props/lobby/table.webp');
    this.load.image('lobby-workbench', 'assets/sprites/props/lobby/workbench.webp');
    this.load.image('lobby-sidetable', 'assets/sprites/props/lobby/sidetable.webp');
    this.load.image('lobby-radio', 'assets/sprites/props/lobby/radio.webp');
    this.load.image('lobby-mapboard', 'assets/sprites/props/lobby/mapboard.png');
    this.load.image('lobby-relayboard', 'assets/sprites/props/lobby/relayboard.png');
    this.load.image('journey-icon-greenhouse', 'assets/sprites/ui/journey-greenhouse.png');
    this.load.image('journey-icon-relay', 'assets/sprites/ui/journey-relay.png');
    this.load.image('lobby-punchingbag', 'assets/sprites/props/lobby/punchingbag.png');
    this.load.image('lobby-cushion', 'assets/sprites/props/lobby/cushion.png');
    this.load.image('lobby-planter-square', 'assets/sprites/props/lobby/planter-square.png');
    this.load.image('lobby-supply-shelf', 'assets/sprites/props/lobby/supply-shelf.png');
    this.load.image('lobby-map-full', 'assets/ui/map-full.png');

    // --- Lobby idle animations ---
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

    // --- UI icons ---
    this.load.image('icon-rest-tent', 'assets/ui/icon-rest-tent.png');

    // --- Combat backgrounds ---
    this.load.image('bg-overgrown-highway', 'assets/backgrounds/combat/overgrown_highway.webp');
    this.load.image(
      'bg-overgrown-highway-tunnel',
      'assets/backgrounds/combat/overgrown_highway_tunnel.webp',
    );
    this.load.image(
      'bg-overgrown-highway-gas',
      'assets/backgrounds/combat/overgrown_highway_gas.webp',
    );
    this.load.image('bg-mall-atrium', 'assets/backgrounds/combat/mall_atrium.webp');
    this.load.image('bg-mall-atrium-garage', 'assets/backgrounds/combat/mall_atrium_garage.webp');
    this.load.image('bg-mall-atrium-dept', 'assets/backgrounds/combat/mall_atrium_dept.webp');
    this.load.image('bg-dead-substation', 'assets/backgrounds/combat/dead_substation.webp');
    this.load.image(
      'bg-dead-substation-transformer',
      'assets/backgrounds/combat/dead_substation_transformer.webp',
    );
    this.load.image(
      'bg-dead-substation-boss',
      'assets/backgrounds/combat/dead_substation_boss.webp',
    );

    // --- Smoke VFX ---
    for (let i = 0; i < 8; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(`smoke-vfx-${padded}`, `assets/sprites/vfx/smoke/frame_${padded}.png`);
    }

    // --- Lobby music + combat SFX ---
    this.load.audio('music-lobby-theme', 'assets/audio/music/lobby-theme.mp3');
    this.load.audio('music-signal-lost', 'assets/audio/music/signal-lost.mp3');

    this.load.audio('sfx-attack-melee', 'assets/audio/sfx/attack-melee.mp3');
    this.load.audio('sfx-damage-taken', 'assets/audio/sfx/damage-taken.mp3');
    this.load.audio('sfx-enemy-death', 'assets/audio/sfx/enemy-death.mp3');
    this.load.audio('sfx-spell-cast', 'assets/audio/sfx/spell-cast.mp3');
    this.load.audio('sfx-heal-shimmer', 'assets/audio/sfx/heal-shimmer.mp3');
    this.load.audio('sfx-victory-jingle', 'assets/audio/sfx/victory-jingle.mp3');
    this.load.audio('sfx-defeat-sting', 'assets/audio/sfx/defeat-sting.mp3');
    this.load.audio('sfx-item-use', 'assets/audio/sfx/item-use.mp3');
    this.load.audio('sfx-smoke-grenade', 'assets/audio/sfx/smoke-grenade.mp3');
    this.load.audio('sfx-party-ko', 'assets/audio/sfx/party-ko.mp3');
    this.load.audio('sfx-atb-ready', 'assets/audio/sfx/atb-ready.mp3');
    this.load.audio('sfx-critical-hit', 'assets/audio/sfx/critical-hit.mp3');
    this.load.audio('sfx-guard-raise', 'assets/audio/sfx/guard-raise.mp3');
    this.load.audio('sfx-status-apply', 'assets/audio/sfx/status-apply.mp3');
    this.load.audio('sfx-encounter-start', 'assets/audio/sfx/encounter-start.mp3');

    this.load.audio('sfx-netrunner-jack', 'assets/audio/sfx/netrunner/jack.mp3');
    this.load.audio('sfx-netrunner-overload', 'assets/audio/sfx/netrunner/overload.mp3');
    this.load.audio('sfx-netrunner-frostlock', 'assets/audio/sfx/netrunner/frostlock.mp3');
    this.load.audio('sfx-netrunner-surge', 'assets/audio/sfx/netrunner/surge.mp3');

    this.load.audio('sfx-medic-patch', 'assets/audio/sfx/medic/patch.mp3');
    this.load.audio('sfx-medic-pulse', 'assets/audio/sfx/medic/pulse.mp3');
    this.load.audio('sfx-medic-stim', 'assets/audio/sfx/medic/stim.mp3');
    this.load.audio('sfx-medic-shield', 'assets/audio/sfx/medic/shield.mp3');

    this.load.audio('sfx-cybermonk-flurry', 'assets/audio/sfx/cybermonk-flurry.mp3');

    this.load.audio('sfx-enemy-attack', 'assets/audio/sfx/enemy/melee.mp3');
    this.load.audio('sfx-sentry-attack', 'assets/audio/sfx/enemy/sentry-attack.mp3');
    this.load.audio('sfx-spider-attack', 'assets/audio/sfx/enemy/spider-attack.mp3');
    this.load.audio('sfx-wirehead-attack', 'assets/audio/sfx/enemy/wirehead-attack.mp3');
    this.load.audio('sfx-wreckwarden-attack', 'assets/audio/sfx/enemy/wreckwarden-attack.mp3');
    this.load.audio('sfx-wreckwarden-slam', 'assets/audio/sfx/enemy/wreckwarden-slam.mp3');
    this.load.audio('sfx-scoutdrone-attack', 'assets/audio/sfx/enemy/scoutdrone-attack.mp3');
    this.load.audio('sfx-naniteswarm-attack', 'assets/audio/sfx/enemy/naniteswarm-attack.mp3');

    this.load.audio('sfx-scavenger-salvage', 'assets/audio/sfx/scavenger/salvage.mp3');
    this.load.audio('sfx-cybermonk-focus', 'assets/audio/sfx/cybermonk/focus.mp3');
    this.load.audio('sfx-vanguard-guard', 'assets/audio/sfx/vanguard/guard.mp3');
    this.load.audio('sfx-vanguard-taunt', 'assets/audio/sfx/vanguard/taunt.mp3');

    // --- Route + journey music (~35 MB of the total load) ---
    this.load.audio(
      'music-route-overgrown-bridge',
      'assets/audio/music/route-overgrown-bridge.mp3',
    );
    this.load.audio(
      'music-route-overgrown-bridge-alt',
      'assets/audio/music/route-overgrown-bridge-alt.mp3',
    );
    this.load.audio('music-route-hollow-atrium', 'assets/audio/music/route-hollow-atrium.mp3');
    this.load.audio(
      'music-route-hollow-atrium-alt',
      'assets/audio/music/route-hollow-atrium-alt.mp3',
    );
    this.load.audio('music-route-substation', 'assets/audio/music/route-substation.mp3');
    this.load.audio('music-route-substation-alt', 'assets/audio/music/route-substation-alt.mp3');
    this.load.audio('music-route-substation-boss', 'assets/audio/music/route-substation-boss.mp3');
    this.load.audio('music-journey', 'assets/audio/music/journey.mp3');
    this.load.audio('music-journey-alt', 'assets/audio/music/journey-alt.mp3');
    this.load.audio('music-journey-alt2', 'assets/audio/music/journey-alt2.mp3');
  }

  create(): void {
    log('BG_LOAD', 'deferred assets loaded');
    // Signal TitleScene / BootScene portal-entry that the first scene past
    // Title is now safe to enter. Uses `changedata` event via registry.set
    // so waiters can subscribe.
    this.registry.set('assets:loaded', true);
    // Nothing to render; scene is just a parallel loader. Stop itself to free
    // the slot in the scene manager.
    this.scene.stop();
  }
}
