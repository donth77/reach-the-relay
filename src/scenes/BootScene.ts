import * as Phaser from 'phaser';

const PARTY_KEYS = ['vanguard', 'netrunner', 'medic', 'scavenger', 'cybermonk'] as const;
const NPC_KEYS = ['drvey', 'mira'] as const;
const HUMANOID_ENEMY_KEYS = ['wirehead', 'wreckling'] as const;
const OBJECT_ENEMY_KEYS = ['scoutdrone', 'spiderbot', 'sentryturret', 'naniteswarm'] as const;
const DIRECTIONS = ['south', 'east', 'north', 'west'] as const;

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    for (const key of PARTY_KEYS) {
      for (const dir of DIRECTIONS) {
        this.load.image(`${key}-${dir}`, `assets/sprites/party/${key}/${dir}.png`);
      }
    }
    for (const key of NPC_KEYS) {
      for (const dir of DIRECTIONS) {
        this.load.image(`${key}-${dir}`, `assets/sprites/npcs/${key}/${dir}.png`);
      }
    }
    for (const key of HUMANOID_ENEMY_KEYS) {
      for (const dir of DIRECTIONS) {
        this.load.image(`${key}-${dir}`, `assets/sprites/enemies/${key}/${dir}.png`);
      }
    }
    for (const key of OBJECT_ENEMY_KEYS) {
      this.load.image(`${key}-side`, `assets/sprites/enemies/${key}/side.png`);
    }

    // Per-character frame counts for animations
    const ATTACK_FRAMES: Record<string, number> = {
      vanguard: 6,
      netrunner: 6,
      medic: 3, // lead-jab (STRIKE)
      scavenger: 4, // custom wrench overhead-swing
      cybermonk: 3, // lead-jab (replaces cross-punch that had the red-lips issue)
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
      const walkFrames = key === 'cybermonk' || key === 'scavenger' ? 6 : 4;
      for (let i = 0; i < walkFrames; i++) {
        const padded = i.toString().padStart(3, '0');
        this.load.image(
          `${key}-walk-west-${padded}`,
          `assets/sprites/party/${key}/anim/walk-west/frame_${padded}.png`,
        );
      }
      // Per-character death frame counts (most are 7; scavenger + cybermonk custom are 4)
      const deathFrames = key === 'scavenger' || key === 'cybermonk' ? 4 : 7;
      for (let i = 0; i < deathFrames; i++) {
        const padded = i.toString().padStart(3, '0');
        this.load.image(
          `${key}-death-west-${padded}`,
          `assets/sprites/party/${key}/anim/death-west/frame_${padded}.png`,
        );
      }
      this.load.image(`${key}-downed`, `assets/sprites/party/${key}/downed.png`);
    }

    // Medic cast_v2 animation (4 frames) — for PATCH / PULSE / STIM / SHIELD
    for (let i = 0; i < 4; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `medic-cast-west-${padded}`,
        `assets/sprites/party/medic/anim/cast-west/frame_${padded}.png`,
      );
    }

    // Dr. Vey (escort) death animation + downed sprite
    for (let i = 0; i < 7; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `drvey-death-west-${padded}`,
        `assets/sprites/npcs/drvey/anim/death-west/frame_${padded}.png`,
      );
    }
    this.load.image('drvey-downed', 'assets/sprites/npcs/drvey/downed.png');

    // Wirehead (enemy) walk + attack + death animations (east direction) + downed sprite
    for (let i = 0; i < 4; i++) {
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

    // Wreckling (enemy) walk + attack + death animations (east direction) + downed sprite
    for (let i = 0; i < 6; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `wreckling-walk-east-${padded}`,
        `assets/sprites/enemies/wreckling/anim/walk-east/frame_${padded}.png`,
      );
    }
    for (let i = 0; i < 4; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `wreckling-attack-east-${padded}`,
        `assets/sprites/enemies/wreckling/anim/attack-east/frame_${padded}.png`,
      );
    }
    for (let i = 0; i < 4; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `wreckling-death-east-${padded}`,
        `assets/sprites/enemies/wreckling/anim/death-east/frame_${padded}.png`,
      );
    }
    for (let i = 0; i < 8; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `wreckling-idle-east-${padded}`,
        `assets/sprites/enemies/wreckling/anim/idle-east/frame_${padded}.png`,
      );
    }
    this.load.image('wreckling-downed', 'assets/sprites/enemies/wreckling/downed.png');

    // Sentry (enemy id 'sentry', dir 'sentryturret') — walk + attack + death (east) + downed
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

    // Spider-Bot (enemy id 'spider', dir 'spiderbot') — walk + attack + death (east) + downed
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

    // Scout Drone idle (2-frame rotor motion blur, programmatic edit of D2 sprite)
    for (let i = 0; i < 2; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `scoutdrone-idle-east-${padded}`,
        `assets/sprites/enemies/scoutdrone/anim/idle-east/frame_${padded}.png`,
      );
    }

    // Nanite Swarm idle animation (8 frames, east-facing)
    for (let i = 0; i < 8; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `naniteswarm-idle-east-${padded}`,
        `assets/sprites/enemies/naniteswarm/anim/idle-east/frame_${padded}.png`,
      );
    }

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
    this.load.audio('music-main-theme', 'assets/audio/music/main-theme.mp3');

    this.load.audio('sfx-menu-confirm', 'assets/audio/sfx/menu-confirm.mp3');
    this.load.audio('sfx-menu-cancel', 'assets/audio/sfx/menu-cancel.mp3');
    this.load.audio('sfx-attack-melee', 'assets/audio/sfx/attack-melee.mp3');
    this.load.audio('sfx-damage-taken', 'assets/audio/sfx/damage-taken.mp3');
    this.load.audio('sfx-enemy-death', 'assets/audio/sfx/enemy-death.mp3');
    this.load.audio('sfx-spell-cast', 'assets/audio/sfx/spell-cast.mp3');
    this.load.audio('sfx-heal-shimmer', 'assets/audio/sfx/heal-shimmer.mp3');
    this.load.audio('sfx-victory-jingle', 'assets/audio/sfx/victory-jingle.mp3');
    this.load.audio('sfx-defeat-sting', 'assets/audio/sfx/defeat-sting.mp3');
    this.load.audio('sfx-item-use', 'assets/audio/sfx/item-use.mp3');
    this.load.audio('sfx-party-ko', 'assets/audio/sfx/party-ko.mp3');
    this.load.audio('sfx-atb-ready', 'assets/audio/sfx/atb-ready.mp3');
    this.load.audio('sfx-critical-hit', 'assets/audio/sfx/critical-hit.mp3');
    this.load.audio('sfx-guard-raise', 'assets/audio/sfx/guard-raise.mp3');
    this.load.audio('sfx-status-apply', 'assets/audio/sfx/status-apply.mp3');
    this.load.audio('sfx-encounter-start', 'assets/audio/sfx/encounter-start.mp3');

    // Netrunner per-ability SFX
    this.load.audio('sfx-netrunner-jack', 'assets/audio/sfx/netrunner/jack.mp3');
    this.load.audio('sfx-netrunner-overload', 'assets/audio/sfx/netrunner/overload.mp3');
    this.load.audio('sfx-netrunner-frostlock', 'assets/audio/sfx/netrunner/frostlock.mp3');
    this.load.audio('sfx-netrunner-surge', 'assets/audio/sfx/netrunner/surge.mp3');
    this.load.audio('sfx-netrunner-standby', 'assets/audio/sfx/netrunner/standby.mp3');

    // Medic per-ability SFX
    this.load.audio('sfx-medic-patch', 'assets/audio/sfx/medic/patch.mp3');
    this.load.audio('sfx-medic-pulse', 'assets/audio/sfx/medic/pulse.mp3');
    this.load.audio('sfx-medic-stim', 'assets/audio/sfx/medic/stim.mp3');
    this.load.audio('sfx-medic-shield', 'assets/audio/sfx/medic/shield.mp3');

    // Cybermonk
    this.load.audio('sfx-cybermonk-flurry', 'assets/audio/sfx/cybermonk-flurry.mp3');

    // Enemy-specific melee attack sound (punchier than the shared sfx-attack-melee)
    this.load.audio('sfx-enemy-attack', 'assets/audio/sfx/enemy/melee.mp3');
    this.load.audio('sfx-sentry-attack', 'assets/audio/sfx/enemy/sentry-attack.mp3');
    this.load.audio('sfx-spider-attack', 'assets/audio/sfx/enemy/spider-attack.mp3');
    this.load.audio('sfx-wirehead-attack', 'assets/audio/sfx/enemy/wirehead-attack.mp3');
    this.load.audio('sfx-wreckling-attack', 'assets/audio/sfx/enemy/wreckling-attack.mp3');
    this.load.audio('sfx-scoutdrone-attack', 'assets/audio/sfx/enemy/scoutdrone-attack.mp3');
    this.load.audio('sfx-naniteswarm-attack', 'assets/audio/sfx/enemy/naniteswarm-attack.mp3');

    // Scavenger
    this.load.audio('sfx-scavenger-salvage', 'assets/audio/sfx/scavenger/salvage.mp3');

    // Cybermonk
    this.load.audio('sfx-cybermonk-focus', 'assets/audio/sfx/cybermonk/focus.mp3');

    // Vanguard
    this.load.audio('sfx-vanguard-guard', 'assets/audio/sfx/vanguard/guard.mp3');
    this.load.audio('sfx-vanguard-taunt', 'assets/audio/sfx/vanguard/taunt.mp3');
  }

  create(): void {
    this.scene.start('Lobby');
  }
}
