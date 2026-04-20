import * as Phaser from 'phaser';
import {
  isPortalEntry,
  DEFAULT_PORTAL_LEADER,
  DEFAULT_PORTAL_RECRUITS,
} from '../util/portal';
import { setLeader, addRecruit } from '../state/lobby';

const PARTY_KEYS = ['vanguard', 'netrunner', 'medic', 'scavenger', 'cybermonk'] as const;
const NPC_KEYS = ['drvey', 'mira'] as const;
const HUMANOID_ENEMY_KEYS = ['wirehead', 'wreckwarden'] as const;
const OBJECT_ENEMY_KEYS = ['scoutdrone', 'spiderbot', 'sentryturret', 'naniteswarm'] as const;
const DIRECTIONS = ['south', 'east', 'north', 'west'] as const;

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    // Kick off the Silkscreen webfont download in parallel with Phaser's
    // asset preload. Doesn't block — just ensures the font is further along
    // (or done) by the time TitleScene renders its menu text.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.load?.('400 44px "Silkscreen"');
    fonts?.load?.('700 44px "Silkscreen"');

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
      // Vanguard was regenerated in PixelLab with 4-direction walk-6-frames
      // for the walkable LobbyScene. Other classes still use their original
      // single-direction combat walk until they're regenerated too.
      const walkFrames =
        key === 'cybermonk' || key === 'scavenger' || key === 'medic' || key === 'vanguard'
          ? 6
          : 4;
      for (let i = 0; i < walkFrames; i++) {
        const padded = i.toString().padStart(3, '0');
        this.load.image(
          `${key}-walk-west-${padded}`,
          `assets/sprites/party/${key}/anim/walk-west/frame_${padded}.png`,
        );
      }
      // World-walking animations — used by LobbyScene + overworld (stretch).
      // Per-class, per-direction frame counts. Classes without an entry
      // fall back to static rotation (no walk animation).
      //
      // West missing from a class's set = reuse east with flipX in the
      // scene's update loop (no separate west animation needed).
      const worldWalkFrames: Partial<
        Record<string, Partial<Record<'south' | 'north' | 'east' | 'west', number>>>
      > = {
        vanguard: { south: 4, north: 6, east: 4 }, // no-shield; east 4-frame canonical, west via flipX
        medic: { south: 6, north: 6, east: 6, west: 6 },
        scavenger: { south: 6, north: 6, west: 6 }, // east via flipX (no dedicated east)
        netrunner: { south: 6, north: 6, west: 6 }, // east via flipX (no dedicated east)
        cybermonk: { south: 6, north: 6, west: 6 }, // east via flipX (no dedicated east)
      };

      // Lobby/overworld-specific static rotations — used when the lobby
      // version of the sprite differs from the combat/portrait version
      // (currently only Vanguard: a no-shield 136×136 variant for walking
      // around Greenhouse, while combat keeps the shield-bearing 96×96).
      if (key === 'vanguard') {
        for (const dir of ['south', 'north', 'east', 'west'] as const) {
          this.load.image(
            `${key}-world-${dir}`,
            `assets/sprites/party/${key}/world/${dir}.png`,
          );
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
      // Per-character death frame counts
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

    // Medic cast animation (9 frames, PixelLab healing-magic custom) — PATCH / PULSE / STIM / SHIELD
    for (let i = 0; i < 9; i++) {
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

    // Wirehead (new 92×92 PixelLab sprite) — walk, attack, death, idle
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

    // Wreckwarden (enemy) walk + attack + death animations (east direction) + downed sprite
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

    // Sentry thermal attack (elemental alternate) — 8 frames
    for (let i = 0; i < 8; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `sentry-attack-thermal-east-${padded}`,
        `assets/sprites/enemies/sentryturret/anim/attack-thermal-east/frame_${padded}.png`,
      );
    }

    // Wreckwarden coolant attack (elemental alternate, AoE) — 9 frames, PixelLab V3
    for (let i = 0; i < 9; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `wreckwarden-attack-coolant-east-${padded}`,
        `assets/sprites/enemies/wreckwarden/anim/attack-coolant-east/frame_${padded}.png`,
      );
    }

    // Wreckwarden Shockwave (damage + ATB reset, surge element) — 17 frames, PixelLab
    for (let i = 0; i < 17; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(
        `wreckwarden-attack-shockwave-east-${padded}`,
        `assets/sprites/enemies/wreckwarden/anim/attack-shockwave-east/frame_${padded}.png`,
      );
    }

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

    this.load.image('title-bg-on', 'assets/title/bg-on.png');
    this.load.image('title-bg-off', 'assets/title/bg-off.png');
    this.load.image('title-logo', 'assets/logo/logo-surge.png');

    this.load.image('lobby-greenhouse', 'assets/backgrounds/lobby/greenhouse-v1.webp');
    this.load.image('lobby-terminal', 'assets/sprites/props/lobby/terminal.webp');

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

    // Only Title (main-theme) and Lobby (lobby-theme) music loaded up-front.
    // Route + journey music is deferred to `BackgroundLoadScene` so Title boots
    // fast — see `src/scenes/BackgroundLoadScene.ts`.
    this.load.audio('music-main-theme', 'assets/audio/music/main-theme.mp3');
    this.load.audio('music-lobby-theme', 'assets/audio/music/lobby-theme.mp3');

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
    this.load.audio('sfx-smoke-grenade', 'assets/audio/sfx/smoke-grenade.mp3');

    // Smoke grenade VFX — 8-frame looping cloud, SpriteCook-generated
    for (let i = 0; i < 8; i++) {
      const padded = i.toString().padStart(3, '0');
      this.load.image(`smoke-vfx-${padded}`, `assets/sprites/vfx/smoke/frame_${padded}.png`);
    }
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
    this.load.audio('sfx-wreckwarden-attack', 'assets/audio/sfx/enemy/wreckwarden-attack.mp3');
    this.load.audio('sfx-wreckwarden-slam', 'assets/audio/sfx/enemy/wreckwarden-slam.mp3');
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
    // Kick off background loading of route/journey music (~35 MB) in parallel
    // — these aren't needed until RouteScene or later, so we don't block Title
    // on them.
    this.scene.launch('BackgroundLoad');

    // Vibe Jam 2026 webring entry: if the URL has `?portal=true`, skip all
    // menus (Title, LeaderSelect, PartySelect) and drop the player straight
    // into the walkable Lobby with a default party. The webring spec
    // mandates "no loading screens, no input screens" for continuity.
    if (isPortalEntry()) {
      setLeader(DEFAULT_PORTAL_LEADER);
      for (const id of DEFAULT_PORTAL_RECRUITS) addRecruit(id);
      this.scene.start('Lobby');
      return;
    }

    this.scene.start('Title');
  }
}
