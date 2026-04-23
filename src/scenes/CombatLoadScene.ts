import * as Phaser from 'phaser';
import { log } from '../util/logger';

const PARTY_KEYS = ['vanguard', 'netrunner', 'medic', 'scavenger', 'cybermonk'] as const;
const HUMANOID_ENEMY_KEYS = ['wirehead', 'wreckwarden'] as const;
const OBJECT_ENEMY_KEYS = ['scoutdrone', 'spiderbot', 'sentryturret', 'naniteswarm'] as const;
const DIRECTIONS = ['south', 'east', 'north', 'west'] as const;

/**
 * Tier 2b — Combat + map + deferred music. Launched by BackgroundLoadScene
 * (the lobby-tier loader) once the player has the assets they need to enter
 * the Lobby. Continues streaming in the background while the player wanders
 * the Greenhouse, picks recruits, etc.
 *
 * Most players spend long enough in Lobby for this to finish before they
 * reach Route Select / Combat. CombatScene + RouteMapScene re-list the same
 * keys in their own preload as a fallback — Phaser skips re-loads that are
 * already in cache.
 *
 * On completion sets `assets:loaded = true` (the legacy "everything done"
 * flag — kept for any future code that wants to know when ALL background
 * loading is finished).
 */
export class CombatLoadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'CombatLoad', active: false });
  }

  preload(): void {
    // --- Party combat anims ---
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

    // --- Dr. Vey combat death + downed ---
    for (let i = 0; i < 7; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `drvey-death-west-${padded}`,
        `assets/sprites/npcs/drvey/anim/death-west/frame_${padded}.png`,
      );
    }
    this.load.image('drvey-downed', 'assets/sprites/npcs/drvey/downed.png');

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

    // --- Route map (RouteMapScene) ---
    this.load.image('lobby-map-full-blur', 'assets/ui/map-full-blur.png');
    this.load.image('ui-map-highway', 'assets/ui/map-highway.png');
    this.load.image('ui-map-substation', 'assets/ui/map-substation.png');
    this.load.image('ui-map-mall', 'assets/ui/map-mall.png');
    this.load.image('ui-map-highway-blur', 'assets/ui/map-highway-blur.png');
    this.load.image('ui-map-substation-blur', 'assets/ui/map-substation-blur.png');
    this.load.image('ui-map-mall-blur', 'assets/ui/map-mall-blur.png');

    // --- Smoke VFX ---
    for (let i = 0; i < 8; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(`smoke-vfx-${padded}`, `assets/sprites/vfx/smoke/frame_${padded}.png`);
    }

    // --- UI icons (combat-side) ---

    // --- Combat SFX ---
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

    // --- Music ---
    this.load.audio('music-signal-lost', 'assets/audio/music/signal-lost.mp3');
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
    log('BG_LOAD', 'combat tier loaded');
    this.registry.set('assets:loaded', true);
    this.scene.stop();
  }
}
