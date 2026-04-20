import * as Phaser from 'phaser';
import { CLASSES, type AbilityDef, type ClassDef, type Element } from '../data/classes';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import { ITEMS, ITEM_ORDER, type ItemDef } from '../data/items';
import { getRun, hasRun, ESCORT_MAX_HP } from '../state/run';
import type { BackgroundVariant } from '../data/routes';
import { log, copyLogToClipboard } from '../util/logger';
import { playMusicPool } from '../util/music';
import { playSfx } from '../util/audio';
import { buildAudioSettingsPanel } from '../util/audioSettingsPanel';
import { drawFromBag } from '../util/bag';
import { FONT } from '../util/ui';
import {
  ATB_MAX,
  ATB_RATE,
  PANEL_HEIGHT,
  PANEL_MARGIN,
  PANEL_TOP,
  PANEL_BG,
  PANEL_BORDER,
  DEPTH_ENEMY_BASE,
  DEPTH_ENEMY_ACTIVE_BASE,
  DEPTH_PARTY_BASE,
  DEPTH_WALK_FORWARD_BASE,
  DIMMED_OTHER_ALPHA,
  DIMMED_PEER_ENEMY_ALPHA,
  type Side,
  type Unit,
} from '../combat/types';
import { calculateDamage, getUnitFacing, validTargets, validItemTargets } from '../combat/helpers';
import { flashSprite, playHitShake, spawnDamageNumber, spawnFloatNumber } from '../combat/fx';

export class CombatScene extends Phaser.Scene {
  private units: Unit[] = [];
  private waitMode = false;
  private combatOver = false;
  private actionMenuContainer?: Phaser.GameObjects.Container;
  private targetMenuContainer?: Phaser.GameObjects.Container;
  private targetMenuCleanup?: () => void;
  private messageText?: Phaser.GameObjects.Text;
  private activeUnitId: string | null = null;
  private devOverlay?: Phaser.GameObjects.Container;
  private devOverlayEnabled = false;
  private enemyHpTexts = new Map<string, Phaser.GameObjects.Text>();
  private pauseMenuContainer?: Phaser.GameObjects.Container;
  private pauseMenuOpen = false;
  private savedWaitModeForPause = false;
  private targetSelectActive = false;
  private itemTargetSelectActive = false;
  private itemMenuOpen = false;
  private cancelButton?: Phaser.GameObjects.Text;
  private restoreAlphaOnClear = new Map<string, number>();
  private activeBgVariant: BackgroundVariant = { key: '' };
  private smokeClouds: Phaser.GameObjects.Sprite[] = [];

  constructor() {
    super('Combat');
  }

  create(): void {
    this.units = [];
    this.waitMode = false;
    this.combatOver = false;
    this.actionMenuContainer = undefined;
    this.activeUnitId = null;

    if (!hasRun()) {
      this.scene.start('LeaderSelect');
      return;
    }

    const { width, height } = this.scale;
    const run = getRun();
    this.cameras.main.setBackgroundColor('#1a2619');

    // Per-encounter background override (bosses) takes priority. Otherwise
    // grab-bag pick across route variants.
    const encounterForBg = run.route.encounters[run.encounterIndex];
    let bgVariant: BackgroundVariant;
    if (encounterForBg?.backgroundKey) {
      bgVariant = { key: encounterForBg.backgroundKey };
    } else {
      const variants = run.route.backgroundVariants ?? [run.route.backgroundKey];
      const picked = drawFromBag(`bg:${run.route.id}`, variants);
      bgVariant =
        typeof picked === 'string' ? { key: picked } : (picked ?? { key: run.route.backgroundKey });
    }
    this.activeBgVariant = bgVariant;
    if (this.textures.exists(bgVariant.key)) {
      this.add
        .image(width / 2, height / 2, bgVariant.key)
        .setDisplaySize(width, height)
        .setAlpha(0.8);
    }

    // Encounter-start SFX disabled — revisit when we find a sound that fits.
    // this.sound.play('sfx-encounter-start', { volume: 0.5 });

    const encounter = run.route.encounters[run.encounterIndex];
    const bossMusicKey = encounter?.enemies
      .map((id) => ENEMIES[id]?.bossMusicKey)
      .find((k): k is string => !!k);
    const musicKeys = bossMusicKey ? [bossMusicKey] : run.route.musicKeys;

    if (musicKeys && musicKeys.length > 0) {
      // playMusicPool handles the "already playing from the same pool?" check
      // internally and re-picks a variant each time a track loops.
      const musicVolume = bossMusicKey ? 0.5 : 0.35;
      playMusicPool(this, musicKeys, musicVolume);
    }

    // Register animations before sprite creation so idle anims can play immediately.
    this.registerAnimations();

    this.buildUnits();
    // Ability uses live on the run state (persist across combats; refill at Rest).
    for (const u of this.units) this.createBattleSprite(u);

    this.drawBottomPanel();

    this.add
      .text(
        width / 2,
        30,
        `${run.route.name}  —  Encounter ${run.encounterIndex + 1}`,
        {
          fontFamily: FONT,
          fontSize: '20px',
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 4,
        },
      )
      .setOrigin(0.5);

    this.messageText = this.add
      .text(width / 2, 58, '', {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#ffff88',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(200000);

    // Mobile-only pause button (touch devices don't have ESC)
    const isTouchDevice = this.sys.game.device.input.touch;
    if (isTouchDevice) {
      this.add
        .text(width - 18, 18, 'MENU', {
          fontFamily: FONT,
          fontSize: '18px',
          color: '#e6e6e6',
          backgroundColor: '#222a',
          padding: { x: 14, y: 8 },
          align: 'center',
        })
        .setOrigin(1, 0)
        .setDepth(150000)
        .setInteractive({ useHandCursor: true })
        .on('pointerup', () => {
          if (!this.pauseMenuOpen) this.openPauseMenu();
          else this.closePauseMenu();
        });
    }

    this.input.keyboard?.on('keydown-ESC', () => this.handleEscapeKey());
    // Dev overlay toggle — F2 (standard debug key, avoids conflicts with
    // the D menu-nav key and browser extensions that grab backtick).
    this.input.keyboard?.on('keydown-F2', () => this.toggleDevOverlay());
    this.input.keyboard?.on('keydown-L', async () => {
      const ok = await copyLogToClipboard();
      this.showMessage(ok ? 'Log copied to clipboard' : 'Copy failed — check console');
    });
    this.buildDevOverlay();

    const runInfo = getRun();
    log('SCENE', 'Combat created', {
      route: runInfo.route.id,
      encounter: runInfo.encounterIndex,
      enemies: runInfo.route.encounters[runInfo.encounterIndex]?.enemies,
      party: runInfo.party,
    });
  }

  private registerAnimations(): void {
    const attackFrameCounts: Record<string, number> = {
      vanguard: 6,
      netrunner: 6,
      medic: 3, // lead-jab
      scavenger: 4, // custom wrench overhead-swing
      cybermonk: 3, // lead-jab
    };
    const partyKeys = ['vanguard', 'netrunner', 'medic', 'scavenger', 'cybermonk'];
    for (const key of partyKeys) {
      const attackKey = `${key}-attack-west`;
      if (!this.anims.exists(attackKey)) {
        const count = attackFrameCounts[key] ?? 6;
        const frames = Array.from({ length: count }, (_, i) => ({
          key: `${key}-attack-west-${i.toString().padStart(3, '0')}`,
        }));
        this.anims.create({ key: attackKey, frames, frameRate: 9, repeat: 0 });
      }
      const walkKey = `${key}-walk-west`;
      if (!this.anims.exists(walkKey)) {
        const walkCount =
          key === 'cybermonk' ||
          key === 'scavenger' ||
          key === 'vanguard' ||
          key === 'medic'
            ? 6
            : 4;
        const frames = Array.from({ length: walkCount }, (_, i) => ({
          key: `${key}-walk-west-${i.toString().padStart(3, '0')}`,
        }));
        this.anims.create({ key: walkKey, frames, frameRate: 8, repeat: -1 });
      }
      const deathKey = `${key}-death-west`;
      if (!this.anims.exists(deathKey)) {
        const deathCount =
          key === 'scavenger' || key === 'cybermonk'
            ? 4
            : key === 'vanguard'
              ? 11
              : key === 'medic'
                ? 9
                : 7;
        const frames = Array.from({ length: deathCount }, (_, i) => ({
          key: `${key}-death-west-${i.toString().padStart(3, '0')}`,
        }));
        this.anims.create({ key: deathKey, frames, frameRate: 10, repeat: 0 });
      }
    }

    // Medic cast animation (9-frame healing magic) — PATCH / PULSE / STIM / SHIELD
    if (!this.anims.exists('medic-cast-west')) {
      const frames = Array.from({ length: 9 }, (_, i) => ({
        key: `medic-cast-west-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'medic-cast-west', frames, frameRate: 9, repeat: 0 });
    }

    // Dr. Vey escort death animation (she faces west like party)
    if (!this.anims.exists('drvey-death-west')) {
      const frames = Array.from({ length: 7 }, (_, i) => ({
        key: `drvey-death-west-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'drvey-death-west', frames, frameRate: 10, repeat: 0 });
    }

    // Wirehead (new 92×92 PixelLab sprite) — walk, attack, death, idle
    if (!this.anims.exists('wirehead-walk-east')) {
      const frames = Array.from({ length: 6 }, (_, i) => ({
        key: `wirehead-walk-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'wirehead-walk-east', frames, frameRate: 8, repeat: -1 });
    }
    if (!this.anims.exists('wirehead-attack-east')) {
      const frames = Array.from({ length: 6 }, (_, i) => ({
        key: `wirehead-attack-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'wirehead-attack-east', frames, frameRate: 9, repeat: 0 });
    }
    if (!this.anims.exists('wirehead-death-east')) {
      const frames = Array.from({ length: 7 }, (_, i) => ({
        key: `wirehead-death-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'wirehead-death-east', frames, frameRate: 10, repeat: 0 });
    }
    if (!this.anims.exists('wirehead-idle-east')) {
      const frames = Array.from({ length: 8 }, (_, i) => ({
        key: `wirehead-idle-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'wirehead-idle-east', frames, frameRate: 6, repeat: -1 });
    }

    // Wreckwarden (enemy) — walk + attack + death (east direction)
    if (!this.anims.exists('wreckwarden-walk-east')) {
      const frames = Array.from({ length: 6 }, (_, i) => ({
        key: `wreckwarden-walk-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'wreckwarden-walk-east', frames, frameRate: 8, repeat: -1 });
    }
    if (!this.anims.exists('wreckwarden-attack-east')) {
      const frames = Array.from({ length: 4 }, (_, i) => ({
        key: `wreckwarden-attack-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'wreckwarden-attack-east', frames, frameRate: 7, repeat: 0 });
    }
    if (!this.anims.exists('wreckwarden-attack-coolant-east')) {
      const frames = Array.from({ length: 9 }, (_, i) => ({
        key: `wreckwarden-attack-coolant-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'wreckwarden-attack-coolant-east', frames, frameRate: 8, repeat: 0 });
    }
    if (!this.anims.exists('wreckwarden-attack-shockwave-east')) {
      const frames = Array.from({ length: 17 }, (_, i) => ({
        key: `wreckwarden-attack-shockwave-east-${i.toString().padStart(3, '0')}`,
      }));
      // 17 frames at 12fps ≈ 1.4s total — gives the fist-raise + slam its full beat
      this.anims.create({
        key: 'wreckwarden-attack-shockwave-east',
        frames,
        frameRate: 12,
        repeat: 0,
      });
    }
    if (!this.anims.exists('wreckwarden-death-east')) {
      const frames = Array.from({ length: 4 }, (_, i) => ({
        key: `wreckwarden-death-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'wreckwarden-death-east', frames, frameRate: 7, repeat: 0 });
    }
    if (!this.anims.exists('wreckwarden-idle-east')) {
      const frames = Array.from({ length: 8 }, (_, i) => ({
        key: `wreckwarden-idle-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'wreckwarden-idle-east', frames, frameRate: 6, repeat: -1 });
    }

    // Sentry (enemy id 'sentry') — walk + attack + death (east, SpriteCook animations)
    if (!this.anims.exists('sentry-walk-east')) {
      const frames = Array.from({ length: 8 }, (_, i) => ({
        key: `sentry-walk-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'sentry-walk-east', frames, frameRate: 10, repeat: -1 });
    }
    if (!this.anims.exists('sentry-attack-east')) {
      const frames = Array.from({ length: 6 }, (_, i) => ({
        key: `sentry-attack-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'sentry-attack-east', frames, frameRate: 9, repeat: 0 });
    }
    if (!this.anims.exists('sentry-attack-thermal-east')) {
      const frames = Array.from({ length: 8 }, (_, i) => ({
        key: `sentry-attack-thermal-east-${i.toString().padStart(3, '0')}`,
      }));
      // 8 frames at 7fps ≈ 1.14s — bolt launches on frame 6 (~714ms in).
      this.anims.create({ key: 'sentry-attack-thermal-east', frames, frameRate: 7, repeat: 0 });
    }
    if (!this.anims.exists('sentry-death-east')) {
      const frames = Array.from({ length: 8 }, (_, i) => ({
        key: `sentry-death-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'sentry-death-east', frames, frameRate: 10, repeat: 0 });
    }
    if (!this.anims.exists('sentry-idle-east')) {
      const frames = Array.from({ length: 4 }, (_, i) => ({
        key: `sentry-idle-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'sentry-idle-east', frames, frameRate: 3, repeat: -1 });
    }

    // Spider-Bot (enemy id 'spider') — walk + attack + death (east, SpriteCook)
    if (!this.anims.exists('spider-walk-east')) {
      const frames = Array.from({ length: 8 }, (_, i) => ({
        key: `spider-walk-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'spider-walk-east', frames, frameRate: 12, repeat: -1 });
    }
    if (!this.anims.exists('spider-attack-east')) {
      const frames = Array.from({ length: 6 }, (_, i) => ({
        key: `spider-attack-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'spider-attack-east', frames, frameRate: 9, repeat: 0 });
    }
    if (!this.anims.exists('spider-death-east')) {
      const frames = Array.from({ length: 8 }, (_, i) => ({
        key: `spider-death-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'spider-death-east', frames, frameRate: 10, repeat: 0 });
    }
    if (!this.anims.exists('spider-idle-east')) {
      const frames = Array.from({ length: 2 }, (_, i) => ({
        key: `spider-idle-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'spider-idle-east', frames, frameRate: 2, repeat: -1 });
    }

    // Nanite Swarm idle (SpriteCook) — cluster ripple loop
    if (!this.anims.exists('naniteswarm-idle-east')) {
      const frames = Array.from({ length: 8 }, (_, i) => ({
        key: `naniteswarm-idle-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'naniteswarm-idle-east', frames, frameRate: 8, repeat: -1 });
    }

    // Scout Drone idle — 2-frame rotor motion blur alternation (programmatic D2 edit)
    if (!this.anims.exists('scoutdrone-idle-east')) {
      const frames = Array.from({ length: 2 }, (_, i) => ({
        key: `scoutdrone-idle-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'scoutdrone-idle-east', frames, frameRate: 5, repeat: -1 });
    }

    // Smoke grenade VFX — looping billow (SpriteCook-animated, flipped)
    if (!this.anims.exists('smoke-vfx')) {
      const frames = Array.from({ length: 8 }, (_, i) => ({
        key: `smoke-vfx-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'smoke-vfx', frames, frameRate: 6, repeat: -1 });
    }
  }

  private buildDevOverlay(): void {
    this.devOverlay = this.add.container(0, 0);
    this.devOverlay.setVisible(false);
    this.enemyHpTexts.clear();

    for (const u of this.units.filter((u) => u.side === 'enemy')) {
      const txt = this.add
        .text(u.posX, u.posY - 90, `${u.hp}/${u.maxHp}`, {
          fontFamily: FONT,
          fontSize: '14px',
          color: '#ffdd55',
        })
        .setOrigin(0.5);
      this.devOverlay.add(txt);
      this.enemyHpTexts.set(u.id, txt);
    }
  }

  private toggleDevOverlay(): void {
    this.devOverlayEnabled = !this.devOverlayEnabled;
    this.devOverlay?.setVisible(this.devOverlayEnabled);
    this.showMessage(this.devOverlayEnabled ? 'DEV OVERLAY ON' : 'DEV OVERLAY OFF');
  }

  private refreshDevOverlay(): void {
    if (!this.devOverlayEnabled) return;
    for (const u of this.units.filter((u) => u.side === 'enemy')) {
      const txt = this.enemyHpTexts.get(u.id);
      if (txt) txt.setText(u.ko ? 'KO' : `${u.hp}/${u.maxHp}`);
    }
  }

  update(_time: number, delta: number): void {
    // Auto-hide the enemy tooltip if the hovered enemy starts moving (attack
    // sequence, etc). Runs BEFORE the waitMode early return so it fires even
    // while the player can't act.
    if (this.enemyTooltipFor?.sprite) {
      const u = this.enemyTooltipFor;
      const sprite = u.sprite!;
      // X-only check — floaty enemies (scoutdrone, naniteswarm) have an idle
      // bob tween that moves sprite.y every frame, which would otherwise make
      // this flicker-hide the tooltip. Attack sequences always move X too, so
      // X-only still correctly detects "mid-animation, don't anchor here."
      const atHome = Math.abs(sprite.x - u.posX) < 2;
      if (!atHome || u.ko) this.hideEnemyTooltip();
    }

    if (this.combatOver || this.waitMode) return;
    const dt = delta / 1000;
    for (const u of this.units) {
      if (u.ko || u.side === 'escort') continue;
      u.atb = Math.min(ATB_MAX, u.atb + u.speed * ATB_RATE * u.atbModifier * dt);
      this.updatePanelRow(u);
      if (u.atb >= ATB_MAX) {
        if (u.side === 'party') this.beginPartyTurn(u);
        else this.beginEnemyTurn(u);
        return;
      }
    }
  }

  private buildUnits(): void {
    const run = getRun();
    const { width } = this.scale;
    const arenaHeight = PANEL_TOP;
    const partyX = width * 0.78;
    const enemyX = width * 0.3; // moved closer to the party
    // Party and enemies use different vertical centers — tune each independently.
    const currentEncounter = run.route.encounters[run.encounterIndex];
    const partyCentreY =
      arenaHeight * 0.62 +
      40 +
      (run.route.partyYOffset ?? 0) +
      (currentEncounter?.partyYOffset ?? 0) +
      (this.activeBgVariant.partyYOffset ?? 0);
    const enemyCentreY =
      arenaHeight * 0.62 +
      50 +
      (run.route.enemyYOffset ?? 0) +
      (currentEncounter?.enemyYOffset ?? 0) +
      (this.activeBgVariant.enemyYOffset ?? 0);
    const spacing = 85;

    const partyCount = run.party.length;
    const partyXStagger = 22; // diagonal offset between adjacent party members
    const party: Unit[] = run.party.map((key, i) => {
      const def = CLASSES[key];
      const indexOffset = i - (partyCount - 1) / 2;
      // Top party member (index 0) is leftmost / closest to enemies; bottom is rightmost / furthest back
      const posX = partyX + indexOffset * partyXStagger;
      const posY = partyCentreY + indexOffset * spacing;
      const unit = this.unitFromClass(def, 'party', posX, posY);
      unit.hp = run.partyHp[key] ?? def.hp;
      unit.mp = run.partyMp[key] ?? def.mp;
      return unit;
    });

    // Escort sits behind the vertical center of the party line (so enemies
    // attacking her visually don't appear to be hitting a specific party member).
    const escort = this.makeUnit({
      id: 'drvey',
      name: 'Dr. Vey',
      side: 'escort',
      spriteKey: 'drvey-west',
      scale: 2.5,
      hp: run.escortHp,
      maxHp: ESCORT_MAX_HP,
      mp: 0,
      maxMp: 0,
      attack: 0,
      defense: 2,
      speed: 0,
      posX: partyX + 150,
      posY: partyCentreY,
    });

    const enemyCount = currentEncounter.enemies.length;

    // Formations: pixel offsets [dx, dy] from the (enemyX, enemyCentreY) anchor.
    // +dx = closer to party (right), -dx = further back (left).
    // Designed so each formation has a visual identity suited to its count.
    const FORMATIONS: Record<number, Array<[number, number]>> = {
      1: [[0, 0]],
      2: [
        [-55, -50], // back-top
        [55, 50], //  front-bottom (diagonal line)
      ],
      3: [
        [-90, -80], // back-top
        [-90, 80], //  back-bottom
        [80, 0], //    front-center (triangle point toward party)
      ],
      4: [
        [-90, -65], // top-left
        [90, -65], //  top-right
        [-90, 65], //  bottom-left
        [90, 65], //   bottom-right (square)
      ],
      5: [
        [-130, -70], // back row
        [0, -70],
        [130, -70],
        [-65, 75], //  front row (house / pentagon)
        [65, 75],
      ],
      6: [
        [-140, -70], // back row
        [0, -70],
        [140, -70],
        [-140, 70], //  front row
        [0, 70],
        [140, 70], //   (2x3 grid)
      ],
      7: [
        [-140, -80], // back row
        [0, -80],
        [140, -80],
        [-140, 80], //  front row
        [0, 80],
        [140, 80],
        [220, 0], //    front-center champion
      ],
    };

    const getEnemyOffsets = (count: number): Array<[number, number]> => {
      if (FORMATIONS[count]) return FORMATIONS[count];
      // Fallback grid for 8+: 3 columns, wrap rows
      const cols = 3;
      const spreadX = 140;
      const spreadY = 110;
      const rows = Math.ceil(count / cols);
      const rowStartY = -((rows - 1) * spreadY) / 2;
      const offsets: Array<[number, number]> = [];
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const inThisRow = Math.min(cols, count - row * cols);
        const rowStartX = -((inThisRow - 1) * spreadX) / 2;
        offsets.push([rowStartX + col * spreadX, rowStartY + row * spreadY]);
      }
      return offsets;
    };

    const offsets = getEnemyOffsets(enemyCount);
    const enemyCenterY = enemyCentreY;
    const spreadMultiplier = Math.max(
      1,
      ...currentEncounter.enemies.map((id) => ENEMIES[id]?.formationSpread ?? 1),
    );
    const enemies: Unit[] = currentEncounter.enemies.map((id, i) => {
      const def = ENEMIES[id];
      const [rawDx, rawDy] = offsets[i] ?? [0, 0];
      const dx = rawDx * spreadMultiplier;
      const dy = rawDy * spreadMultiplier;
      const unit = this.makeUnit({
        id: def.id,
        name: def.name,
        side: 'enemy',
        spriteKey: def.spriteKey,
        scale: def.scale,
        hp: def.hp,
        maxHp: def.hp,
        mp: 0,
        maxMp: 0,
        attack: def.attack,
        defense: def.defense,
        speed: def.speed,
        posX: enemyX + dx,
        posY: enemyCenterY + dy,
      });
      unit.enemyDef = def;
      return unit;
    });

    // Clamp enemy positions so no sprite bottom overlaps the bottom UI panel.
    // If any enemy's estimated bottom edge extends past PANEL_TOP (minus padding),
    // shift the whole enemy group up by that overflow so the formation stays cohesive.
    const PANEL_CLEARANCE = 24;
    let maxEnemyBottom = 0;
    for (const enemy of enemies) {
      const tex = this.textures.get(enemy.spriteKey);
      const nativeH = tex?.getSourceImage?.()?.height ?? 68;
      const estimatedBottom = enemy.posY + nativeH * enemy.scale * 0.5;
      if (estimatedBottom > maxEnemyBottom) maxEnemyBottom = estimatedBottom;
    }
    // enemyYOffset lets a route/encounter/variant push enemies closer to (or past)
    // the UI panel boundary — the clamp relaxes by the sum of all positive offsets.
    const totalEnemyOffset =
      (run.route.enemyYOffset ?? 0) +
      (currentEncounter?.enemyYOffset ?? 0) +
      (this.activeBgVariant.enemyYOffset ?? 0);
    const allowedBottom = PANEL_TOP - PANEL_CLEARANCE + Math.max(0, totalEnemyOffset);
    const overflow = maxEnemyBottom - allowedBottom;
    if (overflow > 0) {
      for (const enemy of enemies) enemy.posY -= overflow;
    }

    this.units = [...party, escort, ...enemies];
  }

  private unitFromClass(def: ClassDef, side: Side, posX: number, posY: number): Unit {
    return this.makeUnit({
      id: def.id,
      // Party units display by personal name in combat (turn order,
      // damage popups, dialogue lines, tooltips). The role — e.g.
      // "Vanguard" — already served its purpose at selection time; in
      // the fight, "Rowan" feels more personal than "Medic".
      name: def.personName,
      side,
      classDef: def,
      spriteKey: def.spriteKey,
      scale: def.scale ?? 2.5,
      hp: def.hp,
      maxHp: def.hp,
      mp: def.mp,
      maxMp: def.mp,
      attack: def.attack,
      defense: def.defense,
      speed: def.speed,
      posX,
      posY,
    });
  }

  private makeUnit(
    data: Omit<
      Unit,
      | 'atb'
      | 'ko'
      | 'guarding'
      | 'tauntedBy'
      | 'atbModifier'
      | 'atbModifierTurnsLeft'
      | 'shielded'
      | 'missing'
    >,
  ): Unit {
    return {
      ...data,
      atb: 0,
      ko: false,
      guarding: false,
      tauntedBy: null,
      atbModifier: 1,
      atbModifierTurnsLeft: 0,
      shielded: false,
      missing: false,
    };
  }

  private createBattleSprite(u: Unit): void {
    const floatyUnits = new Set(['scoutdrone', 'naniteswarm']);
    const isFloaty = floatyUnits.has(u.id);

    const tempSprite = this.add.image(u.posX, u.posY, u.spriteKey).setScale(u.scale);
    const spriteWidth = tempSprite.displayWidth;
    const nativeCanvasSize = tempSprite.height; // 68 for humanoids, 136 for wreckwarden
    tempSprite.destroy();

    // Per-sprite character bbox within its native canvas (from PIL analysis).
    // Used to (a) center the visible character at (posX, posY) via setOrigin and
    // (b) position shadow/HP bar relative to the character, not the canvas.
    // feetX is optional — use when the character's feet are offset from the
    // opaque bbox center (e.g. Wreckwarden's backpack pulls the bbox leftward).
    // Defaults to centerX if unset.
    const BBOX: Record<
      number,
      { centerX: number; centerY: number; feetY: number; headY: number; feetX?: number }
    > = {
      64: { centerX: 32, centerY: 32, feetY: 56, headY: 6 },
      68: { centerX: 34, centerY: 33, feetY: 57, headY: 9 },
      80: { centerX: 40, centerY: 40, feetY: 74, headY: 6 },
      82: { centerX: 41, centerY: 57, feetY: 82, headY: 32 },
      84: { centerX: 42, centerY: 48, feetY: 84, headY: 12 },
      92: { centerX: 46, centerY: 46, feetY: 88, headY: 4 },
      // Calibrated to the new 96×96 Vanguard west.png (riot-shield defender).
      96: { centerX: 46.5, centerY: 47.5, feetY: 71, headY: 24 },
      // Calibrated to the new 104×104 Medic west.png.
      104: { centerX: 53.5, centerY: 50.5, feetY: 76, headY: 25 },
      // Calibrated to wreckwarden idle-east frames (plays 95% of combat), not
      // the static east.png — idle frames sit ~5px higher and 1px right.
      136: { centerX: 63.5, centerY: 72.5, feetY: 128, headY: 17, feetX: 67.5 },
    };
    // Per-sprite-key overrides — take priority over the canvas-size lookup
    // when two sprites share a canvas size but have different character bboxes
    // (e.g. wirehead + scoutdrone both 92×92 but very different silhouettes).
    const SPRITE_BBOX: Record<string, (typeof BBOX)[number]> = {
      'wirehead-east': { centerX: 44.5, centerY: 47, feetY: 81, headY: 13 },
      'wirehead-west': { centerX: 48, centerY: 46.5, feetY: 81, headY: 12 },
      'wirehead-south': { centerX: 46.5, centerY: 45.5, feetY: 80, headY: 11 },
      'wirehead-north': { centerX: 46, centerY: 45, feetY: 81, headY: 9 },
    };
    const bbox =
      SPRITE_BBOX[u.spriteKey] ?? BBOX[nativeCanvasSize] ?? BBOX[68];
    const originX = bbox.centerX / nativeCanvasSize;
    const originY = bbox.centerY / nativeCanvasSize;
    // Distance (display px) from the origin point to the feet / head top.
    const feetDistBelowOrigin = (bbox.feetY - bbox.centerY) * u.scale;
    const headDistAboveOrigin = (bbox.centerY - bbox.headY) * u.scale;
    u.feetOffsetY = feetDistBelowOrigin;
    const shadowY = u.posY + feetDistBelowOrigin + 4 + (isFloaty ? 25 : 0);
    // Horizontal offset of feet from sprite origin — zero when the character's
    // feet sit at the bbox center, non-zero when asymmetric (e.g. Wreckwarden's
    // offset backpack).
    const feetOffsetX = ((bbox.feetX ?? bbox.centerX) - bbox.centerX) * u.scale;
    const shadowX = u.posX + feetOffsetX;
    // Characters only occupy ~30-40% of the 68px canvas width — size the shadow
    // to the actual character bbox rather than the full sprite display width.
    const shadowWidth = spriteWidth * (isFloaty ? 0.28 : 0.32);
    const shadowHeight = shadowWidth * 0.32;
    u.shadow = this.add.ellipse(
      shadowX,
      shadowY,
      shadowWidth,
      shadowHeight,
      0x000000,
      isFloaty ? 0.12 : 0.18,
    );

    u.sprite = this.add
      .sprite(u.posX, u.posY, u.spriteKey)
      .setScale(u.scale)
      .setOrigin(originX, originY);
    const baseDepth = (u.side === 'enemy' ? DEPTH_ENEMY_BASE : DEPTH_PARTY_BASE) + u.posY;
    u.sprite.setDepth(baseDepth);
    if (u.enemyDef?.flipSprite) u.sprite.setFlipX(true);

    this.playIdleFor(u);

    if (u.side === 'enemy') {
      // Enemy name label hidden for now — will surface via action messages / tooltips later

      const barWidth = 60;
      const barY = u.posY - headDistAboveOrigin - 14;
      u.enemyHpBarBg = this.add
        .rectangle(u.posX, barY, barWidth, 6, 0x222222, 0.8)
        .setOrigin(0.5)
        .setStrokeStyle(1, 0x000000, 0.6)
        .setAlpha(0);
      u.enemyHpBar = this.add
        .rectangle(u.posX - barWidth / 2, barY, barWidth, 6, 0xff5555)
        .setOrigin(0, 0.5)
        .setAlpha(0);

      // Vulnerability icon hidden for now (kept on data model; may re-enable later)

      u.statusIcon = this.add
        .text(u.posX - barWidth / 2 - 10, barY, '', {
          fontFamily: FONT,
          fontSize: '16px',
          color: '#88ccff',
        })
        .setOrigin(1, 0.5);

      // Enemy hover tooltip (shows name + HP + description). Suppressed
      // automatically while target-select is active — see showEnemyTooltip.
      this.attachEnemyTooltipHandlers(u);
    } else {
      u.statusIcon = this.add
        .text(u.posX + 40, u.posY - 50, '', {
          fontFamily: FONT,
          fontSize: '16px',
          color: '#88ccff',
        })
        .setOrigin(0.5);
    }
  }

  private enemyTooltip?: Phaser.GameObjects.Container;
  private enemyTooltipFor?: Unit;

  private attachEnemyTooltipHandlers(u: Unit): void {
    if (!u.sprite) return;
    u.sprite.setInteractive();
    u.sprite.on('pointerover', () => this.showEnemyTooltip(u));
    u.sprite.on('pointerout', () => {
      if (this.enemyTooltipFor === u) this.hideEnemyTooltip();
    });
  }

  private showEnemyTooltip(u: Unit): void {
    // Suppress when the player is picking a target — the target-select flow
    // has its own highlight + chevron UI and the enemy tooltip would clutter it.
    if (this.targetSelectActive || this.itemTargetSelectActive) return;
    if (this.combatOver || u.ko) return;
    if (!u.sprite || !u.enemyDef) return;

    // Suppress while the enemy is mid-animation (walking to attack, attacking,
    // walking back, hit-shake). If the sprite is away from its home position,
    // it's in a sequence and the tooltip would anchor to a moving target.
    // X-only, same rationale as the update() path — floaty idle bob drifts Y.
    const atHome = Math.abs(u.sprite.x - u.posX) < 2;
    if (!atHome) return;

    this.hideEnemyTooltip();

    const def = u.enemyDef;
    const hpPct = u.maxHp > 0 ? Math.round((u.hp / u.maxHp) * 100) : 0;
    const header = def.name.toUpperCase();
    const hpLine = `HP ${u.hp} / ${u.maxHp}  (${hpPct}%)`;
    const desc = def.description ?? '';

    const statusLines: string[] = [];
    if (u.atbModifier < 1 && u.atbModifierTurnsLeft > 0) {
      statusLines.push(`❄ SLOWED (${u.atbModifierTurnsLeft} turns)`);
    }
    if (u.atbModifier > 1 && u.atbModifierTurnsLeft > 0) {
      statusLines.push(`▲ BOOSTED (${u.atbModifierTurnsLeft} turns)`);
    }
    if (u.shielded) statusLines.push('◆ SHIELDED (damage halved)');
    if (u.tauntedBy) {
      const taunter = this.units.find((t) => t.id === u.tauntedBy);
      statusLines.push(`! TAUNTED — forced to attack ${taunter?.name ?? 'taunter'}`);
    }

    const TOOLTIP_MAX_WIDTH = 300;
    const PADDING = 10;

    const headerTxt = this.add.text(0, 0, header, {
      fontFamily: FONT,
      fontSize: '15px',
      color: '#ffd488',
      stroke: '#000000',
      strokeThickness: 2,
    });
    const hpTxt = this.add.text(0, 0, hpLine, {
      fontFamily: FONT,
      fontSize: '12px',
      color: '#cfe8e8',
    });
    const statusTxt = this.add.text(0, 0, statusLines.join('\n'), {
      fontFamily: FONT,
      fontSize: '12px',
      color: '#ffd488',
      wordWrap: { width: TOOLTIP_MAX_WIDTH - PADDING * 2 },
    });
    const descTxt = this.add.text(0, 0, desc, {
      fontFamily: FONT,
      fontSize: '12px',
      color: '#a0bcbc',
      wordWrap: { width: TOOLTIP_MAX_WIDTH - PADDING * 2 },
    });

    // Lay out vertically (header, hp, statuses?, description).
    headerTxt.setPosition(PADDING, PADDING);
    hpTxt.setPosition(PADDING, PADDING + headerTxt.height + 2);
    let cursorY = PADDING + headerTxt.height + 2 + hpTxt.height + 4;
    if (statusLines.length > 0) {
      statusTxt.setPosition(PADDING, cursorY);
      cursorY += statusTxt.height + 4;
    } else {
      statusTxt.setVisible(false);
    }
    descTxt.setPosition(PADDING, cursorY);

    const contentWidth = Math.min(
      TOOLTIP_MAX_WIDTH,
      Math.max(headerTxt.width, hpTxt.width, statusTxt.width, descTxt.width) + PADDING * 2,
    );
    const contentHeight = descTxt.y + descTxt.height + PADDING;

    const bg = this.add
      .rectangle(0, 0, contentWidth, contentHeight, 0x0a1820, 0.9)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x3a5a6a, 0.8);

    // Position container above the enemy sprite, centered on its x.
    const sprite = u.sprite;
    const spriteTop = sprite.y - sprite.displayHeight / 2;
    const tooltipX = sprite.x - contentWidth / 2;
    const tooltipY = spriteTop - contentHeight - 12;
    const container = this.add.container(tooltipX, tooltipY, [
      bg,
      headerTxt,
      hpTxt,
      statusTxt,
      descTxt,
    ]);
    container.setDepth(150000);

    this.enemyTooltip = container;
    this.enemyTooltipFor = u;
  }

  private hideEnemyTooltip(): void {
    this.enemyTooltip?.destroy();
    this.enemyTooltip = undefined;
    this.enemyTooltipFor = undefined;
  }

  private updateEnemyHpBar(u: Unit): void {
    if (!u.enemyHpBar) return;
    u.enemyHpBar.width = (u.hp / u.maxHp) * 60;
    if (u.ko) {
      u.enemyHpBar.setAlpha(0);
      u.enemyHpBarBg?.setAlpha(0);
      u.vulnerabilityIcon?.setAlpha(0);
      u.statusIcon?.setAlpha(0);
      return;
    }
    // Flash the HP bar visible on damage, fade out after 2.5s
    this.tweens.killTweensOf([u.enemyHpBar, u.enemyHpBarBg]);
    u.enemyHpBar.setAlpha(1);
    u.enemyHpBarBg?.setAlpha(0.8);
    this.time.delayedCall(2500, () => {
      if (!u.enemyHpBar || u.ko) return;
      this.tweens.add({
        targets: [u.enemyHpBar, u.enemyHpBarBg].filter(Boolean),
        alpha: 0,
        duration: 400,
        ease: 'Sine.easeOut',
      });
    });
  }

  private updateStatusIcon(u: Unit): void {
    if (!u.statusIcon) return;
    const parts: string[] = [];
    if (u.atbModifier < 1 && u.atbModifierTurnsLeft > 0) parts.push('❄');
    if (u.atbModifier > 1 && u.atbModifierTurnsLeft > 0) parts.push('▲');
    if (u.shielded) parts.push('◆');
    if (u.tauntedBy) parts.push('!');
    if (u.missing) parts.push('~');
    u.statusIcon.setText(parts.join(' '));
  }

  private drawBottomPanel(): void {
    const { width } = this.scale;

    this.add
      .rectangle(
        width / 2,
        PANEL_TOP + PANEL_HEIGHT / 2,
        width - 20,
        PANEL_HEIGHT - 10,
        PANEL_BG,
        0.95,
      )
      .setOrigin(0.5)
      .setStrokeStyle(3, PANEL_BORDER);

    this.add.rectangle(
      width * 0.5,
      PANEL_TOP + PANEL_HEIGHT / 2,
      2,
      PANEL_HEIGHT - 40,
      PANEL_BORDER,
      0.5,
    );

    this.add.text(PANEL_MARGIN + 20, PANEL_TOP + 12, 'ACTION', {
      fontFamily: FONT,
      fontSize: '18px',
      color: '#8aa5cf',
    });
    this.add.text(width * 0.5 + 20, PANEL_TOP + 12, 'PARTY', {
      fontFamily: FONT,
      fontSize: '18px',
      color: '#8aa5cf',
    });

    this.buildPartyPanelRows();
  }

  private buildPartyPanelRows(): void {
    const { width } = this.scale;
    const rightX = width * 0.5 + 30;
    const rowHeight = 40;
    const firstRowY = PANEL_TOP + 55;

    const COL_ACTIVE = 0;
    const COL_NAME = 28;
    const COL_HP_TEXT_RIGHT = 260;
    const COL_HP_BAR = 270;
    const HP_BAR_WIDTH = 95;
    // HP bar now ends at 365 (270+95). Shift MP text + ATB bar right so the
    // "MP NN" text doesn't overlap the widened HP bar.
    const COL_MP_TEXT_RIGHT = 440;
    const COL_ATB_BAR = 460;
    const ATB_BAR_WIDTH = 95;

    const rowUnits = [
      ...this.units.filter((u) => u.side === 'party'),
      ...this.units.filter((u) => u.side === 'escort'),
    ];

    rowUnits.forEach((u, i) => {
      const y = firstRowY + i * rowHeight;
      const container = this.add.container(rightX, y);

      const activeMarker = this.add
        .text(COL_ACTIVE, 0, ' ', {
          fontFamily: FONT,
          fontSize: '22px',
          color: '#ffdd55',
        })
        .setOrigin(0, 0.5);

      const nameColor = u.side === 'escort' ? '#f5c97b' : '#e6e6e6';
      const nameText = this.add
        .text(COL_NAME, 0, u.name, {
          fontFamily: FONT,
          fontSize: '19px',
          color: nameColor,
        })
        .setOrigin(0, 0.5);

      const hpText = this.add
        .text(COL_HP_TEXT_RIGHT, 0, `${u.hp}/${u.maxHp}`, {
          fontFamily: FONT,
          fontSize: '19px',
          color: '#ffe58a',
        })
        .setOrigin(1, 0.5);

      this.add.rectangle(COL_HP_BAR, 0, HP_BAR_WIDTH, 10, 0x222222).setOrigin(0, 0.5);
      const hpBar = this.add.rectangle(COL_HP_BAR, 0, HP_BAR_WIDTH, 10, 0xff5555).setOrigin(0, 0.5);

      let mpText: Phaser.GameObjects.Text | undefined;
      let atbBar: Phaser.GameObjects.Rectangle | undefined;

      if (u.side !== 'escort') {
        this.add.rectangle(COL_ATB_BAR, 0, ATB_BAR_WIDTH, 8, 0x222222).setOrigin(0, 0.5);
        atbBar = this.add.rectangle(COL_ATB_BAR, 0, 0, 8, 0xffdd55).setOrigin(0, 0.5);

        if (u.maxMp > 0) {
          mpText = this.add
            .text(COL_MP_TEXT_RIGHT, 0, `MP ${u.mp}`, {
              fontFamily: FONT,
              fontSize: '17px',
              color: '#88aaff',
            })
            .setOrigin(1, 0.5);
        }
      }

      container.add([activeMarker, nameText, hpText, hpBar]);
      if (mpText) container.add(mpText);
      if (atbBar) container.add(atbBar);

      u.panelRow = {
        container,
        nameText,
        hpText,
        hpBar,
        mpText,
        atbBar,
        activeMarker,
      };
      this.updatePanelRow(u);
    });
  }

  private updatePanelRow(u: Unit): void {
    if (!u.panelRow) return;
    const row = u.panelRow;
    row.hpText.setText(`${u.hp}/${u.maxHp}`);
    row.hpBar.width = (u.hp / u.maxHp) * 95;

    if (row.atbBar) {
      row.atbBar.width = (u.atb / ATB_MAX) * 95;
    }

    if (row.mpText) row.mpText.setText(`MP ${u.mp}`);
    row.activeMarker.setText(this.activeUnitId === u.id ? '>' : ' ');

    const baseNameColor = u.side === 'escort' ? '#f5c97b' : '#e6e6e6';
    if (u.ko) {
      row.nameText.setAlpha(0.4);
      row.nameText.setColor(baseNameColor);
      row.hpText.setColor('#666666');
    } else {
      row.nameText.setAlpha(1);
      row.nameText.setColor(u.guarding ? '#88ccff' : baseNameColor);
      row.hpText.setColor('#ffe58a');
    }

    this.updateStatusIcon(u);
  }

  private beginPartyTurn(u: Unit): void {
    log('TURN', 'party turn begin', { unit: u.id, hp: u.hp, mp: u.mp });
    this.waitMode = true;
    if (u.guarding) {
      u.guarding = false;
    }
    if (u.shielded) {
      u.shielded = false;
    }
    if (u.atbModifierTurnsLeft > 0) {
      u.atbModifierTurnsLeft--;
      if (u.atbModifierTurnsLeft === 0) u.atbModifier = 1;
    }
    playSfx(this, 'sfx-atb-ready', 0.4);
    this.activeUnitId = u.id;
    for (const other of this.units) this.updatePanelRow(other);
    this.showMessage(`${u.name}'s turn`);
    // Subtle ▼ marker above the active party member's head. Cleared when
    // the action commits (at the top of executeAbility). Also defensively
    // clear any lingering markers on OTHER party members — covers paths like
    // item use where the previous turn's marker might not have been destroyed.
    for (const other of this.units) {
      if (other.activeTurnMarker) {
        other.activeTurnMarker.destroy();
        other.activeTurnMarker = undefined;
      }
    }
    u.activeTurnMarker = this.add
      .text(u.posX, u.posY - 75, '▼', {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#ffdd55',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(100000);
    this.showActionMenu(u);
  }

  private showActionMenu(u: Unit): void {
    const { width } = this.scale;
    const leftWidth = width * 0.5;
    this.actionMenuContainer?.destroy();
    this.actionMenuContainer = this.add.container(0, 0).setDepth(150000);

    const abilities = u.classDef?.abilities ?? [];
    const cols = 2;
    const btnWidth = (leftWidth - 60) / cols;
    const btnHeight = abilities.length > 4 ? 38 : 50;
    const btnGap = 8;
    const startX = 30;
    const startY = PANEL_TOP + 45;

    // Description tooltip positioned just above the bottom panel so it never
    // overlaps the panel's "ACTION" header. Updates on hover.
    const descText = this.add
      .text(startX, PANEL_TOP - 12, '', {
        fontFamily: FONT,
        fontSize: '14px',
        color: '#cfe8e8',
        backgroundColor: '#0a1820cc',
        padding: { x: 8, y: 4 },
        wordWrap: { width: leftWidth - 60 },
      })
      .setOrigin(0, 1)
      .setDepth(150000)
      .setVisible(false);
    this.actionMenuContainer.add(descText);

    const chevrons: Phaser.GameObjects.Text[] = [];
    const bgs: { el: Phaser.GameObjects.Rectangle; baseFill: number }[] = [];
    const BASE_FILL = 0x1a2a3a;
    const HOVER_FILL = 0x2a4252;
    // Keyboard nav state: collected per-button so arrow/WASD/Enter can drive selection.
    const selectFns: (() => void)[] = [];
    const commitFns: (() => void)[] = [];
    const canUseFlags: boolean[] = [];

    abilities.forEach((ability, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * (btnWidth + 10) + btnWidth / 2;
      const y = startY + row * (btnHeight + btnGap) + btnHeight / 2;

      const run = getRun();
      const usesRemaining =
        ability.maxUsesPerRest !== undefined
          ? (run.abilityUsesRemaining[`${u.id}:${ability.id}`] ?? 0)
          : null;
      const hasUses = usesRemaining === null || usesRemaining > 0;
      const canAfford = u.mp >= ability.mpCost && hasUses;
      const bg = this.add
        .rectangle(x, y, btnWidth, btnHeight, BASE_FILL, 0.9)
        .setStrokeStyle(2, canAfford ? 0x88ff88 : 0x444444);
      bgs.push({ el: bg, baseFill: BASE_FILL });
      let label = ability.label;
      if (ability.mpCost > 0) label += `  (${ability.mpCost})`;
      if (usesRemaining !== null) label += `  [${usesRemaining}/${ability.maxUsesPerRest}]`;
      const txt = this.add
        .text(x, y, label, {
          fontFamily: FONT,
          fontSize: btnHeight > 45 ? '20px' : '17px',
          color: canAfford ? '#8aff8a' : '#555555',
          align: 'center',
        })
        .setOrigin(0.5);

      // Chevron marker — hidden by default, shows when this button is hovered.
      const chevron = this.add
        .text(x - btnWidth / 2 + 6, y, '►', {
          fontFamily: FONT,
          fontSize: '16px',
          color: '#8aff8a',
        })
        .setOrigin(0, 0.5)
        .setVisible(false);
      chevrons.push(chevron);

      const updateHover = () => {
        chevrons.forEach((c, j) => c.setVisible(j === i));
        bgs.forEach((b, j) => b.el.setFillStyle(j === i ? HOVER_FILL : b.baseFill, 0.9));
        const text = ability.description ?? '';
        descText.setText(text);
        descText.setVisible(text.length > 0);
      };
      const clearHover = () => {
        chevrons.forEach((c) => c.setVisible(false));
        bgs.forEach((b) => b.el.setFillStyle(b.baseFill, 0.9));
        descText.setText('');
        descText.setVisible(false);
      };

      const commit = () => {
        playSfx(this, 'sfx-menu-confirm', 0.5);
        this.chooseTarget(u, ability);
      };

      if (canAfford) {
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', updateHover);
        bg.on('pointerout', clearHover);
        bg.once('pointerup', commit);
      } else {
        // Still allow hover to show description even if the ability can't be used.
        bg.setInteractive();
        bg.on('pointerover', updateHover);
        bg.on('pointerout', clearHover);
      }

      selectFns.push(updateHover);
      commitFns.push(commit);
      canUseFlags.push(canAfford);

      this.actionMenuContainer!.add([bg, txt, chevron]);
    });

    // Keyboard navigation: arrows + WASD to move, Enter to confirm.
    // 2-col grid; UP/DOWN moves by cols (clamped), LEFT/RIGHT moves ±1 wrap.
    let selectedIdx = 0;
    // Start on the first affordable button if the first slot is disabled.
    const firstUsable = canUseFlags.findIndex((c) => c);
    if (firstUsable >= 0) selectedIdx = firstUsable;
    selectFns[selectedIdx]?.();

    const navigate = (delta: 'up' | 'down' | 'left' | 'right') => {
      const n = abilities.length;
      if (n === 0) return;
      let next = selectedIdx;
      if (delta === 'left') next = (selectedIdx - 1 + n) % n;
      else if (delta === 'right') next = (selectedIdx + 1) % n;
      else if (delta === 'up') next = Math.max(0, selectedIdx - cols);
      else if (delta === 'down') next = Math.min(n - 1, selectedIdx + cols);
      if (next !== selectedIdx) {
        selectedIdx = next;
        selectFns[selectedIdx]?.();
      }
    };

    const keyLeft = () => navigate('left');
    const keyRight = () => navigate('right');
    const keyUp = () => navigate('up');
    const keyDown = () => navigate('down');
    const keyConfirm = () => {
      if (canUseFlags[selectedIdx]) commitFns[selectedIdx]();
    };

    const kb = this.input.keyboard;
    kb?.on('keydown-LEFT', keyLeft);
    kb?.on('keydown-A', keyLeft);
    kb?.on('keydown-RIGHT', keyRight);
    kb?.on('keydown-D', keyRight);
    kb?.on('keydown-UP', keyUp);
    kb?.on('keydown-W', keyUp);
    kb?.on('keydown-DOWN', keyDown);
    kb?.on('keydown-S', keyDown);
    kb?.on('keydown-ENTER', keyConfirm);
    kb?.on('keydown-SPACE', keyConfirm);
    kb?.on('keydown-E', keyConfirm);

    this.actionMenuContainer!.once('destroy', () => {
      kb?.off('keydown-LEFT', keyLeft);
      kb?.off('keydown-A', keyLeft);
      kb?.off('keydown-RIGHT', keyRight);
      kb?.off('keydown-D', keyRight);
      kb?.off('keydown-UP', keyUp);
      kb?.off('keydown-W', keyUp);
      kb?.off('keydown-DOWN', keyDown);
      kb?.off('keydown-S', keyDown);
      kb?.off('keydown-ENTER', keyConfirm);
      kb?.off('keydown-SPACE', keyConfirm);
      kb?.off('keydown-E', keyConfirm);
    });
  }

  private chooseTarget(attacker: Unit, ability: AbilityDef): void {
    this.actionMenuContainer?.destroy();
    this.actionMenuContainer = undefined;

    if (ability.effect === 'item') {
      this.showItemMenu(attacker);
      return;
    }

    if (ability.target === 'self') {
      this.executeAbility(attacker, attacker, ability);
      return;
    }

    const targets = validTargets(this.units, ability);
    if (targets.length === 0) {
      this.waitMode = false;
      return;
    }

    this.targetSelectActive = true;
    this.hideEnemyTooltip();
    this.setEnemyIdlesPaused(true);
    const prompt =
      ability.target === 'enemy'
        ? `${attacker.name} → select an enemy`
        : `${attacker.name} → select an ally`;
    this.showMessage(prompt);
    this.showCancelButton(() => this.handleEscapeKey());

    const highlightColor = ability.target === 'enemy' ? 0xffaaaa : 0xaaffaa;
    const commitTarget = (t: Unit) => {
      playSfx(this, 'sfx-menu-confirm', 0.5);
      this.targetSelectActive = false;
      this.clearTargetSelect();
      this.hideCancelButton();
      this.hideTargetMenu();
      this.executeAbility(attacker, t, ability);
    };
    for (const t of targets) {
      if (!t.sprite) continue;
      t.sprite.setInteractive({ useHandCursor: true });
      t.sprite.setTint(highlightColor);
      t.sprite.once('pointerup', () => commitTarget(t));
    }
    this.showTargetListMenu(targets, highlightColor, commitTarget);
  }

  // Target selection menu rendered in the action box. Supports arrow keys,
  // Enter, and mouse click. A "►" chevron marks the selected row.
  private showTargetListMenu(
    targets: Unit[],
    highlightColor: number,
    onSelect: (t: Unit) => void,
  ): void {
    this.hideTargetMenu();
    const { width } = this.scale;
    const leftWidth = width * 0.5;
    const container = this.add.container(0, 0);
    this.targetMenuContainer = container;

    // 2 cols when 2+ targets so 4+ options don't overflow the panel. Single
    // target stays full-width for readability.
    const cols = targets.length >= 2 ? 2 : 1;
    const colGap = 10;
    const btnWidth = (leftWidth - 60 - colGap * (cols - 1)) / cols;
    const btnHeight = targets.length > 4 ? 30 : 40;
    const btnGap = 6;
    const startX = 30;
    const startY = PANEL_TOP + 45;

    const hexColor = '#' + highlightColor.toString(16).padStart(6, '0');
    let selectedIdx = 0;
    const rows: { chevron: Phaser.GameObjects.Text }[] = [];

    targets.forEach((t, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = startX + col * (btnWidth + colGap) + btnWidth / 2;
      const y = startY + row * (btnHeight + btnGap) + btnHeight / 2;
      const bg = this.add
        .rectangle(cx, y, btnWidth, btnHeight, 0x1a2a3a, 0.9)
        .setStrokeStyle(2, highlightColor);
      const chevron = this.add
        .text(cx - btnWidth / 2 + 8, y, '►', {
          fontFamily: FONT,
          fontSize: '18px',
          color: hexColor,
        })
        .setOrigin(0, 0.5)
        .setVisible(false);
      const hpPct = t.maxHp > 0 ? Math.max(0, Math.round((t.hp / t.maxHp) * 100)) : 0;
      const label = t.side === 'enemy' ? `${t.name}  ${hpPct}%` : t.name;
      const txt = this.add
        .text(cx - btnWidth / 2 + 30, y, label, {
          fontFamily: FONT,
          fontSize: btnHeight > 35 ? '18px' : '15px',
          color: '#e6e6e6',
        })
        .setOrigin(0, 0.5);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => {
        selectedIdx = i;
        updateSelection();
      });
      bg.on('pointerup', () => onSelect(t));
      if (t.sprite) {
        t.sprite.on('pointerover', () => {
          selectedIdx = i;
          updateSelection();
        });
      }
      container.add([bg, chevron, txt]);
      rows.push({ chevron });
    });

    const intensify = (c: number) => {
      const r = (c >> 16) & 0xff;
      const g = (c >> 8) & 0xff;
      const b = c & 0xff;
      const dim = (ch: number) => (ch >= 0xff ? ch : Math.floor(ch / 2));
      return (dim(r) << 16) | (dim(g) << 8) | dim(b);
    };
    const hoverColor = intensify(highlightColor);

    const updateSelection = () => {
      rows.forEach((r, i) => {
        r.chevron.setVisible(i === selectedIdx);
        const sprite = targets[i].sprite;
        if (sprite) {
          sprite.setTint(i === selectedIdx ? hoverColor : highlightColor);
        }
      });
    };
    updateSelection();

    // Grid nav: LEFT/RIGHT wrap along linear index; UP/DOWN move by cols (clamp).
    const n = targets.length;
    const onLeft = () => {
      selectedIdx = (selectedIdx - 1 + n) % n;
      updateSelection();
    };
    const onRight = () => {
      selectedIdx = (selectedIdx + 1) % n;
      updateSelection();
    };
    const onUp = () => {
      selectedIdx = Math.max(0, selectedIdx - cols);
      updateSelection();
    };
    const onDown = () => {
      selectedIdx = Math.min(n - 1, selectedIdx + cols);
      updateSelection();
    };
    const onEnter = () => {
      const t = targets[selectedIdx];
      if (t) onSelect(t);
    };
    this.input.keyboard?.on('keydown-UP', onUp);
    this.input.keyboard?.on('keydown-W', onUp);
    this.input.keyboard?.on('keydown-LEFT', onLeft);
    this.input.keyboard?.on('keydown-A', onLeft);
    this.input.keyboard?.on('keydown-DOWN', onDown);
    this.input.keyboard?.on('keydown-S', onDown);
    this.input.keyboard?.on('keydown-RIGHT', onRight);
    this.input.keyboard?.on('keydown-D', onRight);
    this.input.keyboard?.on('keydown-ENTER', onEnter);
    this.input.keyboard?.on('keydown-SPACE', onEnter);
    this.input.keyboard?.on('keydown-E', onEnter);

    this.targetMenuCleanup = () => {
      this.input.keyboard?.off('keydown-UP', onUp);
      this.input.keyboard?.off('keydown-W', onUp);
      this.input.keyboard?.off('keydown-LEFT', onLeft);
      this.input.keyboard?.off('keydown-A', onLeft);
      this.input.keyboard?.off('keydown-DOWN', onDown);
      this.input.keyboard?.off('keydown-S', onDown);
      this.input.keyboard?.off('keydown-RIGHT', onRight);
      this.input.keyboard?.off('keydown-D', onRight);
      this.input.keyboard?.off('keydown-ENTER', onEnter);
      this.input.keyboard?.off('keydown-SPACE', onEnter);
      this.input.keyboard?.off('keydown-E', onEnter);
    };
  }

  private hideTargetMenu(): void {
    this.targetMenuCleanup?.();
    this.targetMenuCleanup = undefined;
    this.targetMenuContainer?.destroy();
    this.targetMenuContainer = undefined;
  }

  private showCancelButton(onTap: () => void): void {
    this.hideCancelButton();
    const { width } = this.scale;
    const btn = this.add
      .text(width / 2, PANEL_TOP - 60, '[ CANCEL ]', {
        fontFamily: FONT,
        fontSize: '18px',
        color: '#ffbb88',
        backgroundColor: '#3a2a1a',
        padding: { x: 16, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(150000)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerup', onTap);
    this.cancelButton = btn;
  }

  private hideCancelButton(): void {
    this.cancelButton?.destroy();
    this.cancelButton = undefined;
  }

  private showItemMenu(attacker: Unit): void {
    const { width } = this.scale;
    const run = getRun();
    const leftWidth = width * 0.5;

    this.itemMenuOpen = true;
    this.actionMenuContainer?.destroy();
    this.actionMenuContainer = this.add.container(0, 0).setDepth(150000);

    this.actionMenuContainer.add(
      this.add.text(30, PANEL_TOP + 38, 'ITEMS', {
        fontFamily: FONT,
        fontSize: '16px',
        color: '#8aa5cf',
      }),
    );

    const cols = 2;
    const btnWidth = (leftWidth - 60) / cols;
    const btnHeight = 36;
    const btnGap = 6;
    const startX = 30;
    const startY = PANEL_TOP + 58;

    // Description tooltip above the panel (matches action menu pattern).
    const descText = this.add
      .text(startX, PANEL_TOP - 12, '', {
        fontFamily: FONT,
        fontSize: '14px',
        color: '#cfe8e8',
        backgroundColor: '#0a1820cc',
        padding: { x: 8, y: 4 },
        wordWrap: { width: leftWidth - 60 },
      })
      .setOrigin(0, 1)
      .setDepth(150000)
      .setVisible(false);
    this.actionMenuContainer.add(descText);

    const chevrons: Phaser.GameObjects.Text[] = [];
    const bgs: { el: Phaser.GameObjects.Rectangle; baseFill: number }[] = [];
    const BASE_FILL = 0x1a2a3a;
    const HOVER_FILL = 0x2a4252;
    const selectFns: (() => void)[] = [];
    const commitFns: (() => void)[] = [];
    const canUseFlags: boolean[] = [];

    ITEM_ORDER.forEach((key, i) => {
      const item = ITEMS[key];
      const count = run.inventory[key] ?? 0;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * (btnWidth + 10) + btnWidth / 2;
      const y = startY + row * (btnHeight + btnGap) + btnHeight / 2;

      const canUse = count > 0;
      const bg = this.add
        .rectangle(x, y, btnWidth, btnHeight, BASE_FILL, 0.9)
        .setStrokeStyle(2, canUse ? 0x88ff88 : 0x444444);
      bgs.push({ el: bg, baseFill: BASE_FILL });
      const txt = this.add
        .text(x, y, `${item.label} × ${count}`, {
          fontFamily: FONT,
          fontSize: '16px',
          color: canUse ? '#8aff8a' : '#555555',
        })
        .setOrigin(0.5);

      const chevron = this.add
        .text(x - btnWidth / 2 + 6, y, '►', {
          fontFamily: FONT,
          fontSize: '16px',
          color: '#8aff8a',
        })
        .setOrigin(0, 0.5)
        .setVisible(false);
      chevrons.push(chevron);

      const updateHover = () => {
        chevrons.forEach((c, j) => c.setVisible(j === i));
        bgs.forEach((b, j) => b.el.setFillStyle(j === i ? HOVER_FILL : b.baseFill, 0.9));
        descText.setText(item.description);
        descText.setVisible(item.description.length > 0);
      };
      const clearHover = () => {
        chevrons.forEach((c) => c.setVisible(false));
        bgs.forEach((b) => b.el.setFillStyle(b.baseFill, 0.9));
        descText.setText('');
        descText.setVisible(false);
      };

      const commit = () => {
        playSfx(this, 'sfx-menu-confirm', 0.5);
        this.chooseItemTarget(attacker, item);
      };

      if (canUse) {
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', updateHover);
        bg.on('pointerout', clearHover);
        bg.once('pointerup', commit);
      } else {
        bg.setInteractive();
        bg.on('pointerover', updateHover);
        bg.on('pointerout', clearHover);
      }

      selectFns.push(updateHover);
      commitFns.push(commit);
      canUseFlags.push(canUse);

      this.actionMenuContainer!.add([bg, txt, chevron]);
    });

    // Keyboard navigation (matches showActionMenu pattern).
    let selectedIdx = 0;
    const firstUsable = canUseFlags.findIndex((c) => c);
    if (firstUsable >= 0) selectedIdx = firstUsable;
    selectFns[selectedIdx]?.();

    const navigate = (delta: 'up' | 'down' | 'left' | 'right') => {
      const n: number = ITEM_ORDER.length;
      if (n === 0) return;
      let next = selectedIdx;
      if (delta === 'left') next = (selectedIdx - 1 + n) % n;
      else if (delta === 'right') next = (selectedIdx + 1) % n;
      else if (delta === 'up') next = Math.max(0, selectedIdx - cols);
      else if (delta === 'down') next = Math.min(n - 1, selectedIdx + cols);
      if (next !== selectedIdx) {
        selectedIdx = next;
        selectFns[selectedIdx]?.();
      }
    };

    const keyLeft = () => navigate('left');
    const keyRight = () => navigate('right');
    const keyUp = () => navigate('up');
    const keyDown = () => navigate('down');
    const keyConfirm = () => {
      if (canUseFlags[selectedIdx]) commitFns[selectedIdx]();
    };

    const kb = this.input.keyboard;
    kb?.on('keydown-LEFT', keyLeft);
    kb?.on('keydown-A', keyLeft);
    kb?.on('keydown-RIGHT', keyRight);
    kb?.on('keydown-D', keyRight);
    kb?.on('keydown-UP', keyUp);
    kb?.on('keydown-W', keyUp);
    kb?.on('keydown-DOWN', keyDown);
    kb?.on('keydown-S', keyDown);
    kb?.on('keydown-ENTER', keyConfirm);
    kb?.on('keydown-SPACE', keyConfirm);
    kb?.on('keydown-E', keyConfirm);

    this.actionMenuContainer!.once('destroy', () => {
      kb?.off('keydown-LEFT', keyLeft);
      kb?.off('keydown-A', keyLeft);
      kb?.off('keydown-RIGHT', keyRight);
      kb?.off('keydown-D', keyRight);
      kb?.off('keydown-UP', keyUp);
      kb?.off('keydown-W', keyUp);
      kb?.off('keydown-DOWN', keyDown);
      kb?.off('keydown-S', keyDown);
      kb?.off('keydown-ENTER', keyConfirm);
      kb?.off('keydown-SPACE', keyConfirm);
      kb?.off('keydown-E', keyConfirm);
    });

    const backY = startY + 2 * (btnHeight + btnGap) + btnHeight / 2;
    const backBg = this.add
      .rectangle(startX + btnWidth + 10 + btnWidth / 2, backY, btnWidth, btnHeight, 0x2a1a1a, 0.9)
      .setStrokeStyle(2, 0x88aaaa)
      .setInteractive({ useHandCursor: true });
    const backTxt = this.add
      .text(startX + btnWidth + 10 + btnWidth / 2, backY, '< BACK', {
        fontFamily: FONT,
        fontSize: '16px',
        color: '#88aaaa',
      })
      .setOrigin(0.5);
    backBg.once('pointerup', () => {
      playSfx(this, 'sfx-menu-cancel', 0.5);
      this.itemMenuOpen = false;
      this.showActionMenu(attacker);
    });
    this.actionMenuContainer.add([backBg, backTxt]);
  }

  private chooseItemTarget(attacker: Unit, item: ItemDef): void {
    this.itemMenuOpen = false;
    this.actionMenuContainer?.destroy();
    this.actionMenuContainer = undefined;

    const targets = validItemTargets(this.units, item);

    if (item.target === 'all-enemies') {
      this.executeItem(attacker, null, item);
      return;
    }

    if (targets.length === 0) {
      this.showMessage(`No valid target for ${item.label} — pick a different item`);
      // Re-open item menu so user can pick a different item or back out
      this.showItemMenu(attacker);
      return;
    }

    this.itemTargetSelectActive = true;
    this.hideEnemyTooltip();
    this.showMessage(`${attacker.name} → select ${item.label} target`);
    this.showCancelButton(() => this.handleEscapeKey());

    const color = item.target === 'ko-ally' ? 0xff8888 : 0xaaffaa;
    for (const t of targets) {
      if (!t.sprite) continue;
      // Boost alpha if KO'd so the red tint reads clearly
      if (t.ko) {
        this.restoreAlphaOnClear.set(t.id, t.sprite.alpha);
        t.sprite.setAlpha(1);
      }
      t.sprite.setInteractive({ useHandCursor: true });
      t.sprite.setTint(color);
      t.sprite.once('pointerup', () => {
        playSfx(this, 'sfx-menu-confirm', 0.5);
        this.itemTargetSelectActive = false;
        this.hideCancelButton();
        this.clearTargetSelect();
        this.executeItem(attacker, t, item);
      });
    }
  }

  private executeItem(attacker: Unit, target: Unit | null, item: ItemDef): void {
    // Turn committed — drop the above-head active marker.
    attacker.activeTurnMarker?.destroy();
    attacker.activeTurnMarker = undefined;
    const run = getRun();
    run.inventory[item.id] = Math.max(0, (run.inventory[item.id] ?? 0) - 1);

    playSfx(this, 'sfx-item-use', 0.5);

    switch (item.effect) {
      case 'heal': {
        if (!target) break;
        const heal = Math.round(item.power ?? 20);
        target.hp = Math.min(target.maxHp, target.hp + heal);
        spawnFloatNumber(this, target, `+${heal}`, '#88ff88');
        this.showMessage(`${attacker.name} uses ${item.label} on ${target.name} (+${heal})`);
        break;
      }
      case 'restore-mp': {
        if (!target) break;
        const restore = Math.round(item.power ?? 10);
        target.mp = Math.min(target.maxMp, target.mp + restore);
        spawnFloatNumber(this, target, `+${restore} MP`, '#88aaff');
        this.showMessage(`${attacker.name} uses ${item.label} on ${target.name} (+${restore} MP)`);
        break;
      }
      case 'revive': {
        if (!target) break;
        const hp = Math.max(1, Math.round(target.maxHp * (item.power ?? 0.25)));
        target.hp = hp;
        target.ko = false;
        this.resetSpriteForRevive(target);
        spawnFloatNumber(this, target, `REVIVE`, '#ffdd55');
        this.updatePanelRow(target);
        this.showMessage(`${attacker.name} revives ${target.name}!`);
        break;
      }
      case 'smoke-miss': {
        const enemies = this.units.filter((u) => u.side === 'enemy' && !u.ko);
        for (const e of enemies) {
          e.missing = true;
          this.updateStatusIcon(e);
        }
        playSfx(this, 'sfx-smoke-grenade', 0.8);
        this.spawnSmokeClouds(enemies);
        this.showMessage(`${attacker.name} tosses a ${item.label} — enemies will miss`);
        break;
      }
    }

    if (target) this.updatePanelRow(target);
    attacker.atb = 0;
    this.activeUnitId = null;
    for (const u of this.units) this.updatePanelRow(u);

    this.time.delayedCall(400, () => {
      this.waitMode = false;
      this.checkEndConditions();
    });
  }

  private clearTargetSelect(): void {
    this.setEnemyIdlesPaused(false);
    this.hideEnemyTooltip();
    for (const u of this.units) {
      if (u.sprite) {
        u.sprite.clearTint();
        u.sprite.removeAllListeners();
        u.sprite.disableInteractive();
        // Restore alpha if we temporarily boosted it during item target select
        const origAlpha = this.restoreAlphaOnClear.get(u.id);
        if (origAlpha !== undefined) {
          u.sprite.setAlpha(origAlpha);
          this.restoreAlphaOnClear.delete(u.id);
        }
      }
    }
    // Re-attach persistent enemy hover tooltip handlers (wiped by removeAllListeners).
    for (const u of this.units) {
      if (u.side === 'enemy' && !u.ko) this.attachEnemyTooltipHandlers(u);
    }
  }

  private executeAbility(attacker: Unit, target: Unit, ability: AbilityDef): void {
    log('ACTION', `${attacker.id} -> ${ability.id}`, {
      effect: ability.effect,
      target: target.id,
      mpCost: ability.mpCost,
      power: ability.power,
    });
    // Turn committed — drop the above-head active marker.
    attacker.activeTurnMarker?.destroy();
    attacker.activeTurnMarker = undefined;
    attacker.mp = Math.max(0, attacker.mp - ability.mpCost);

    // Decrement per-rest use counter if this ability has a limit. Persists
    // across combats via run state; refilled at the Rest scene.
    if (ability.maxUsesPerRest !== undefined) {
      const run = getRun();
      const key = `${attacker.id}:${ability.id}`;
      const left = run.abilityUsesRemaining[key] ?? 0;
      run.abilityUsesRemaining[key] = Math.max(0, left - 1);
    }

    switch (ability.effect) {
      case 'damage': {
        const baseDamage = calculateDamage(attacker, target, ability.power ?? 1, ability.element);
        const crit = Math.random() < 0.15;
        const damage = crit ? Math.round(baseDamage * 2) : baseDamage;
        const animKey = `${attacker.id}-attack-west`;
        const hasAnim = this.anims.exists(animKey) && attacker.side === 'party';
        const isMagic = ability.mpCost > 0;

        const applyImpact = () => {
          const sfxKey = ability.sfxKey ?? (isMagic ? 'sfx-spell-cast' : 'sfx-attack-melee');
          playSfx(this, sfxKey, 1);
          if (this.tryEvasion(target, ability)) {
            this.showMessage(`${target.name} dodges ${attacker.name}'s ${ability.label}!`);
            return;
          }
          if (crit) playSfx(this, 'sfx-critical-hit', 1);
          this.applyDamage(target, damage, crit, ability.element, attacker);
          this.showMessage(
            crit
              ? `${attacker.name} uses ${ability.label} on ${target.name} — CRITICAL (${damage})`
              : `${attacker.name} uses ${ability.label} on ${target.name} — ${damage}`,
          );
        };

        if (hasAnim) {
          attacker.atb = 0;
          this.activeUnitId = null;
          for (const uu of this.units) this.updatePanelRow(uu);
          this.playFullAttackSequence(attacker, target, animKey, applyImpact, () => {
            this.waitMode = false;
            this.checkEndConditions();
          });
          return; // skip default finalize below
        }

        this.playAttackTween(attacker, target);
        applyImpact();
        break;
      }
      case 'heal': {
        playSfx(this, ability.sfxKey ?? 'sfx-heal-shimmer', ability.sfxKey ? 1 : 0.5);
        this.playCastTween(attacker);
        const heal = Math.round(ability.power ?? 20);
        target.hp = Math.min(target.maxHp, target.hp + heal);
        spawnFloatNumber(this, target, `+${heal}`, '#88ff88');
        this.showMessage(`${attacker.name} ${ability.label}s ${target.name} for ${heal}`);
        break;
      }
      case 'guard': {
        playSfx(this, ability.sfxKey ?? 'sfx-guard-raise', ability.sfxKey ? 1 : 0.5);
        this.playCastTween(attacker);
        attacker.guarding = true;
        this.showMessage(`${attacker.name} raises their shield — GUARD`);
        break;
      }
      case 'salvage': {
        const baseDamage = calculateDamage(attacker, target, ability.power ?? 1);
        const crit = Math.random() < 0.2;
        const finalDamage = crit ? baseDamage * 2 : baseDamage;
        const animKey = `${attacker.id}-attack-${getUnitFacing(attacker)}`;
        const hasAnim = this.anims.exists(animKey);

        // 25% chance to salvage a random item. Better items weighted lower.
        const gotLoot = Math.random() < 0.25;
        let lootedItemId: string | null = null;
        if (gotLoot) {
          const lootTable: Array<[string, number]> = [
            ['stimpak', 50],
            ['powercell', 30],
            ['adrenaline', 15],
            ['smokegrenade', 5],
          ];
          const totalWeight = lootTable.reduce((s, [, w]) => s + w, 0);
          let roll = Math.random() * totalWeight;
          for (const [id, w] of lootTable) {
            roll -= w;
            if (roll <= 0) {
              lootedItemId = id;
              break;
            }
          }
        }

        const applyImpact = () => {
          playSfx(this, ability.sfxKey ?? 'sfx-attack-melee', 1);
          if (crit) playSfx(this, 'sfx-critical-hit', 1);
          this.applyDamage(target, finalDamage, crit, undefined, attacker);
          if (lootedItemId) {
            const run = getRun();
            run.inventory[lootedItemId] = (run.inventory[lootedItemId] ?? 0) + 1;
            const lootLabel = ITEMS[lootedItemId]?.label ?? lootedItemId;
            spawnFloatNumber(this, target, `+1 ${lootLabel}`, '#88ddff');
            this.showMessage(
              crit
                ? `${attacker.name} SALVAGE — critical (${finalDamage}) — found ${lootLabel}!`
                : `${attacker.name} SALVAGE (${finalDamage}) — found ${lootLabel}!`,
            );
          } else {
            this.showMessage(
              crit
                ? `${attacker.name} SALVAGE — critical (${finalDamage})`
                : `${attacker.name} SALVAGE (${finalDamage})`,
            );
          }
        };

        if (hasAnim) {
          attacker.atb = 0;
          this.activeUnitId = null;
          for (const uu of this.units) this.updatePanelRow(uu);
          this.playFullAttackSequence(attacker, target, animKey, applyImpact, () => {
            this.waitMode = false;
            this.checkEndConditions();
          });
          return;
        }

        this.playAttackTween(attacker, target);
        applyImpact();
        break;
      }
      case 'pulse': {
        playSfx(this, ability.sfxKey ?? 'sfx-spell-cast', ability.sfxKey ? 1 : 0.5);
        this.playCastTween(attacker);
        const base = calculateDamage(attacker, target, ability.power ?? 1);
        let finalDamage: number;
        if (target.enemyDef?.type === 'robotic') {
          finalDamage = Math.round(base * 1.5);
          this.showMessage(`PULSE critical vs robotic — ${finalDamage}`);
        } else if (target.enemyDef?.type === 'hybrid') {
          finalDamage = Math.max(1, Math.round(base * 0.5));
          this.showMessage(`PULSE weak vs hybrid — ${finalDamage}`);
        } else {
          finalDamage = base;
          this.showMessage(`${attacker.name} PULSE on ${target.name} — ${finalDamage}`);
        }
        this.applyDamage(target, finalDamage, false, ability.element, attacker);
        break;
      }
      case 'slow': {
        const slowAnimKey = `${attacker.id}-attack-west`;
        const hasSlowAnim = this.anims.exists(slowAnimKey) && attacker.side === 'party';
        const applySlowImpact = () => {
          playSfx(this, ability.sfxKey ?? 'sfx-spell-cast', ability.sfxKey ? 1 : 0.5);
          const damage = calculateDamage(attacker, target, ability.power ?? 0.6, ability.element);
          this.applyDamage(target, damage, false, ability.element, attacker);
          target.atbModifier = 0.5;
          target.atbModifierTurnsLeft = 2;
          this.updateStatusIcon(target);
          this.showMessage(`${attacker.name} FROSTLOCK — ${target.name} slowed (${damage})`);
        };
        if (hasSlowAnim) {
          attacker.atb = 0;
          this.activeUnitId = null;
          for (const uu of this.units) this.updatePanelRow(uu);
          this.playFullAttackSequence(attacker, target, slowAnimKey, applySlowImpact, () => {
            this.waitMode = false;
            this.checkEndConditions();
          });
          return; // skip default finalize so we don't race checkEndConditions before impact
        }
        applySlowImpact();
        break;
      }
      case 'boost': {
        playSfx(this, ability.sfxKey ?? 'sfx-status-apply', ability.sfxKey ? 1 : 0.5);
        this.playCastTween(attacker);
        target.atbModifier = 2;
        target.atbModifierTurnsLeft = 1;
        this.updateStatusIcon(target);
        spawnFloatNumber(this, target, 'AMP', '#ffdd88');
        this.showMessage(`${attacker.name} AMPs ${target.name} — gauge doubled`);
        break;
      }
      case 'shield-buff': {
        playSfx(this, ability.sfxKey ?? 'sfx-status-apply', ability.sfxKey ? 1 : 0.5);
        this.playCastTween(attacker);
        target.shielded = true;
        this.updateStatusIcon(target);
        spawnFloatNumber(this, target, 'SHIELD', '#88ccff');
        this.showMessage(`${attacker.name} SHIELDs ${target.name}`);
        break;
      }
      case 'taunt': {
        playSfx(this, ability.sfxKey ?? 'sfx-status-apply', ability.sfxKey ? 1 : 0.5);
        this.playCastTween(attacker);
        target.tauntedBy = attacker.id;
        this.updateStatusIcon(target);
        spawnFloatNumber(this, target, 'TAUNT', '#ff9955');
        this.showMessage(`${attacker.name} TAUNTs ${target.name} — it's forced to attack them`);
        break;
      }
      case 'flurry': {
        // Run the staggered hits inside the attack sequence's onImpact callback
        // so damage numbers land AFTER the walk-forward + mid-anim, not before.
        const animKey = `${attacker.id}-attack-west`;
        const hasAnim = this.anims.exists(animKey) && attacker.side === 'party';
        const hits = 3;
        const perHitPower = ability.power ?? 0.5;
        const interHitDelay = 200;
        let totalDamage = 0;
        let hitsLanded = 0;
        const fireHit = (i: number) => {
          if (target.ko) return;
          const dmg = calculateDamage(attacker, target, perHitPower);
          this.applyDamage(target, dmg, false, undefined, attacker);
          totalDamage += dmg;
          hitsLanded++;
          if (i < hits - 1) {
            this.time.delayedCall(interHitDelay, () => fireHit(i + 1));
          } else {
            this.showMessage(`${attacker.name} FLURRY — ${hitsLanded} hits for ${totalDamage}`);
          }
        };

        const applyImpact = () => {
          const flurrySfx = playSfx(this, ability.sfxKey ?? 'sfx-attack-melee', 1);
          this.time.delayedCall(700, () => flurrySfx.stop());
          fireHit(0);
        };

        if (hasAnim) {
          attacker.atb = 0;
          this.activeUnitId = null;
          for (const uu of this.units) this.updatePanelRow(uu);
          // Delay the onComplete slightly so all 3 hits land before walk-back starts.
          const hitSequenceDuration = (hits - 1) * interHitDelay + 200;
          this.playFullAttackSequence(
            attacker,
            target,
            animKey,
            applyImpact,
            () => {
              this.time.delayedCall(hitSequenceDuration, () => {
                this.waitMode = false;
                this.checkEndConditions();
              });
            },
            hits - 1, // replay attack anim 3× total to cover all 3 hits before walk-back
          );
          return;
        }

        // Fallback (no attack anim): fire impact immediately, finalize after full sequence.
        this.playAttackTween(attacker, target);
        applyImpact();
        attacker.atb = 0;
        this.activeUnitId = null;
        for (const uu of this.units) this.updatePanelRow(uu);
        const totalDuration = hits * interHitDelay + 300;
        this.time.delayedCall(totalDuration, () => {
          this.waitMode = false;
          this.checkEndConditions();
        });
        return; // skip default finalize
      }
      case 'item': {
        // handled via showItemMenu; this case should never execute directly
        break;
      }
    }

    attacker.atb = 0;
    this.activeUnitId = null;
    for (const u of this.units) this.updatePanelRow(u);

    this.time.delayedCall(400, () => {
      this.waitMode = false;
      this.checkEndConditions();
    });
  }

  private tryEvasion(target: Unit, ability: AbilityDef): boolean {
    if (!target.enemyDef?.evasive) return false;
    // Basic physical attacks only: FIGHT/SLICE/STRIKE — no element, no sfxKey, no MP cost.
    const isBasicPhysical =
      ability.effect === 'damage' && !ability.element && !ability.sfxKey && ability.mpCost === 0;
    if (!isBasicPhysical) return false;
    if (Math.random() >= 0.3) return false;
    spawnFloatNumber(this, target, 'DODGE', '#8acfff');
    if (target.sprite) {
      // Pause the idle bob so it doesn't fight the dodge y-tween.
      this.stopIdleBob(target);
      target.sprite.y = target.posY;
      this.tweens.add({
        targets: target.sprite,
        x: target.posX + 14,
        y: target.posY - 10,
        duration: 110,
        yoyo: true,
        ease: 'Sine.easeOut',
        onComplete: () => {
          if (!target.sprite || target.ko) return;
          target.sprite.x = target.posX;
          target.sprite.y = target.posY;
          this.startIdleBob(target);
        },
      });
    }
    return true;
  }

  private applyDamage(
    target: Unit,
    damage: number,
    crit = false,
    element?: Element,
    attacker?: Unit,
  ): void {
    let finalDamage = damage;
    if (target.shielded) {
      finalDamage = Math.max(1, Math.floor(finalDamage / 2));
    }
    target.hp = Math.max(0, target.hp - finalDamage);
    if (attacker && attacker.side === 'party' && target.side === 'enemy') {
      target.lastDamagerId = attacker.id;
    }
    const resisted =
      !!element &&
      element !== 'none' &&
      target.enemyDef?.vulnerability !== element &&
      !!target.enemyDef?.resistances?.includes(element);
    spawnDamageNumber(this, target, finalDamage, crit, element, resisted);
    flashSprite(this, target);

    if (target.side !== 'enemy' && finalDamage > 0) {
      playSfx(this, 'sfx-damage-taken', 0.5);
    }

    // Hit reaction: shake tween (frame-based hit animations reverted — they didn't look clean)
    if (!target.ko) playHitShake(this, target);

    log('DAMAGE', `${target.id} took ${finalDamage}`, {
      side: target.side,
      hp: target.hp,
      maxHp: target.maxHp,
      ko: target.hp === 0,
    });
    if (target.hp === 0) {
      target.ko = true;
      this.stopIdleBob(target);
      if (target.side === 'enemy') {
        playSfx(this, 'sfx-enemy-death', 0.5);
      } else {
        playSfx(this, 'sfx-party-ko', 0.5);
      }
      // KO'd party: slightly faded (so they're visibly still there for revive targeting).
      // KO'd enemy: fade to 0 entirely — dead enemies are removed from the scene.
      // (When we add revivable enemies later, give them a partial alpha like party.)
      const koAlpha = target.side === 'enemy' ? 0 : 0.5;
      const facing = getUnitFacing(target);
      const deathAnimKey = `${target.id}-death-${facing}`;
      const downedKey = `${target.id}-downed`;
      if (target.sprite && this.anims.exists(deathAnimKey)) {
        target.shadow?.setAlpha(0);
        target.sprite.play(deathAnimKey);
        target.sprite.once('animationcomplete', () => {
          if (!target.sprite) return;
          if (this.textures.exists(downedKey)) {
            target.sprite.setTexture(downedKey);
            // Nudge downed sprite downward so its opaque body rests on the
            // standing-pose ground line (see ClassDef.downedYOffset).
            const offset = target.classDef?.downedYOffset ?? 0;
            if (offset) target.sprite.y = target.posY + offset;
          }
          if (target.side === 'enemy') {
            // Tween the downed frame out to 0 so the disappearance is smooth.
            this.tweens.add({
              targets: target.sprite,
              alpha: 0,
              duration: 400,
              ease: 'Sine.easeOut',
            });
          } else {
            target.sprite.setAlpha(koAlpha);
          }
        });
      } else {
        // Fallback (used for enemies without death animation): simple fade
        if (target.sprite) {
          this.tweens.add({
            targets: target.sprite,
            alpha: koAlpha,
            duration: 300,
            ease: 'Sine.easeOut',
          });
        }
        if (target.side === 'enemy') target.shadow?.setAlpha(0);
      }
    }
    this.updatePanelRow(target);
    if (target.side === 'enemy') this.updateEnemyHpBar(target);
    this.refreshDevOverlay();
  }

  private beginEnemyTurn(enemy: Unit): void {
    log('TURN', 'enemy turn begin', {
      unit: enemy.id,
      behavior: enemy.enemyDef?.behavior,
      hp: enemy.hp,
    });
    this.waitMode = true;

    // Hide every other enemy's HP bar before this one starts attacking — a bar
    // lingering from a recent hit shouldn't still be visible while a different
    // enemy is mid-attack.
    for (const other of this.units) {
      if (other === enemy) continue;
      if (other.side !== 'enemy') continue;
      if (!other.enemyHpBar) continue;
      this.tweens.killTweensOf([other.enemyHpBar, other.enemyHpBarBg].filter(Boolean));
      other.enemyHpBar.setAlpha(0);
      other.enemyHpBarBg?.setAlpha(0);
    }
    const living = this.units.filter((u) => (u.side === 'party' || u.side === 'escort') && !u.ko);
    if (living.length === 0) {
      this.waitMode = false;
      return;
    }

    if (enemy.atbModifierTurnsLeft > 0) {
      enemy.atbModifierTurnsLeft--;
      if (enemy.atbModifierTurnsLeft === 0) enemy.atbModifier = 1;
    }

    const behavior = enemy.enemyDef?.behavior ?? 'random';

    // Boss rotation — if the enemy has Shockwave, cycle through 3 moves:
    //   turnCount % 3 === 0 → normal single-target
    //   turnCount % 3 === 1 → Shockwave (damage + ATB reset on one party member)
    //   turnCount % 3 === 2 → signature AoE (coolant slam on whole party)
    // Otherwise fall back to the old 2-move alternation for signatureAoE-only bosses.
    const sig = enemy.enemyDef?.signatureAoE;
    const shock = enemy.enemyDef?.shockwave;
    enemy.turnCount = (enemy.turnCount ?? 0) + 1;

    if (shock && sig) {
      const phase = (enemy.turnCount - 1) % 3;
      if (phase === 1) {
        this.playShockwaveAttack(enemy, shock);
        return;
      }
      if (phase === 2) {
        this.playSignatureAoE(enemy, sig);
        return;
      }
      // phase 0 → fall through to normal attack below
    } else if (sig) {
      if (enemy.signatureNext) {
        enemy.signatureNext = false;
        this.playSignatureAoE(enemy, sig);
        return;
      }
      enemy.signatureNext = true;
    }

    if (behavior === 'multi-hit') {
      // Nanite Swarm: fly into the party, release a burst hitting all, fly back.
      const frontmost = living.reduce((acc, u) => (u.posX < acc.posX ? u : acc));
      const attackerHalfW = (enemy.sprite?.displayWidth ?? 80) * 0.5;
      const gap = 30;
      const facingDir: 1 | -1 = frontmost.posX < enemy.posX ? -1 : 1;
      const flyX = frontmost.posX - facingDir * (attackerHalfW + gap);
      this.playFloatyAttack(
        enemy,
        flyX,
        frontmost.posY,
        facingDir,
        () => {
          if (enemy.missing) {
            enemy.missing = false;
            this.updateStatusIcon(enemy);
            spawnFloatNumber(this, enemy, 'MISS', '#aaaaaa');
            this.showMessage(`${enemy.name} is blinded by smoke!`);
            return;
          }
          this.playCastTween(enemy);
          this.showMessage(`${enemy.name} swarms the party!`);
          const targets = this.units.filter(
            (u) => (u.side === 'party' || u.side === 'escort') && !u.ko,
          );
          for (const t of targets) {
            const damage = Math.max(1, calculateDamage(enemy, t, 0.85));
            this.applyDamage(t, damage);
          }
        },
        () => {
          enemy.atb = 0;
          this.time.delayedCall(400, () => {
            this.waitMode = false;
            this.checkEndConditions();
          });
        },
      );
      return;
    }

    let target: Unit;
    const wasTauntedThisTurn = enemy.tauntedBy !== null;
    if (enemy.tauntedBy) {
      const taunter = this.units.find((u) => u.id === enemy.tauntedBy && !u.ko);
      if (taunter) {
        target = taunter;
      } else {
        target = living[Math.floor(Math.random() * living.length)];
      }
      enemy.tauntedBy = null;
      this.updateStatusIcon(enemy);
    } else if (behavior === 'target-escort') {
      const escort = this.units.find((u) => u.side === 'escort' && !u.ko);
      target = escort ?? living[Math.floor(Math.random() * living.length)];
    } else if (behavior === 'prefer-low-hp') {
      // Weighted random preferring lower-HP targets. Full-HP units still have
      // a ~1/3 chance vs a 0-HP unit (weight 1 vs 3).
      const weights = living.map((u) => {
        const maxHp = u.maxHp || 1;
        const missingFrac = Math.max(0, Math.min(1, 1 - u.hp / maxHp));
        return 1 + 2 * missingFrac;
      });
      const total = weights.reduce((acc, w) => acc + w, 0);
      let roll = Math.random() * total;
      let picked = living[0];
      for (let i = 0; i < living.length; i++) {
        roll -= weights[i];
        if (roll <= 0) {
          picked = living[i];
          break;
        }
      }
      target = picked;
    } else {
      target = living[Math.floor(Math.random() * living.length)];
    }

    const ignoreGuard = !!enemy.enemyDef?.ignoresGuard;
    const guardian = this.units.find((u) => u.side === 'party' && u.guarding && !u.ko);
    const redirected = !ignoreGuard && guardian && target !== guardian;

    // Resolve the GUARD redirect UP FRONT so the walk destination and the
    // path-dim logic use the actual final target. Previously the redirect
    // happened at impact, so Wirehead would walk toward the escort (dimming
    // party on the way) even when GUARD was about to intercept.
    let guardHalved = false;

    // Sentry: decide ranged vs melee BEFORE the message so the log matches.
    // 60% plasma bolt / 40% melee swing.
    const sentryUseRanged =
      enemy.id === 'sentry' &&
      Math.random() < 0.6 &&
      this.anims.exists('sentry-attack-thermal-east');
    const attackVerb =
      enemy.id === 'sentry' && !sentryUseRanged
        ? 'attacks'
        : (enemy.enemyDef?.attackName ?? 'attacks');

    if (redirected && guardian) {
      target = guardian;
      guardHalved = true;
      this.showMessage(`${guardian.name} intercepts ${enemy.name}'s attack!`);
    } else if (!ignoreGuard && target.guarding) {
      guardHalved = true;
      this.showMessage(`${enemy.name} ${attackVerb} ${target.name}!`);
    } else {
      this.showMessage(`${enemy.name} ${attackVerb} ${target.name}!`);
    }

    // Ranged attackers (Sentry plasma bolt) always aim at the center of the
    // party for composition — unless they were taunted this turn, in which
    // case the taunter override remains.
    if (enemy.id === 'sentry' && !wasTauntedThisTurn) {
      const center = this.getCenterPartyMember();
      if (center) target = center;
    }

    const facing = getUnitFacing(enemy);
    const attackAnimKey = `${enemy.id}-attack-${facing}`;
    const hasAnim = this.anims.exists(attackAnimKey);

    const attackElement = enemy.enemyDef?.attackElement;
    const resolveImpact = () => {
      if (enemy.missing) {
        enemy.missing = false;
        this.updateStatusIcon(enemy);
        this.checkSmokeExpiry();
        spawnFloatNumber(this, enemy, 'MISS', '#aaaaaa');
        this.showMessage(`${enemy.name} is blinded by smoke!`);
        return;
      }
      const enemyAttackSfx = enemy.enemyDef?.attackSfxKey ?? 'sfx-enemy-attack';
      playSfx(this, enemyAttackSfx, 1);
      let damage = calculateDamage(enemy, target, 1, attackElement);
      if (guardHalved) damage = Math.max(1, Math.floor(damage / 2));
      if (attackElement) this.playElementalImpact(target, attackElement);
      this.applyDamage(target, damage, false, attackElement);
    };

    const finalize = () => {
      enemy.atb = 0;
      this.waitMode = false;
      this.checkEndConditions();
    };

    if (enemy.id === 'sentry') {
      // Sentry ranged/melee split was decided above so the combat log matches.
      if (sentryUseRanged) {
        this.playPartialAdvanceRangedAttack(
          enemy,
          target,
          'sentry-attack-thermal-east',
          attackElement ?? 'thermal',
          resolveImpact,
          finalize,
          -12, // muzzleYOffset — slightly higher (barrel is above sprite center)
          6, // bolt fires on frame 6
          undefined, // boltColorOverride
          100, // muzzleXOffset — well forward, aligned with barrel tip
        );
      } else {
        // Melee swing: walk to target, swing, walk back.
        this.playFullAttackSequence(enemy, target, attackAnimKey, resolveImpact, finalize);
      }
    } else if (hasAnim) {
      this.playFullAttackSequence(enemy, target, attackAnimKey, resolveImpact, finalize);
    } else if (enemy.id === 'scoutdrone') {
      // Floaty enemy — fly over to the target, nudge + impact, fly back.
      const attackerHalfW = (enemy.sprite?.displayWidth ?? 80) * 0.5;
      const targetHalfW = (target.sprite?.displayWidth ?? 100) * 0.5;
      const gap = 20;
      const facingDir: 1 | -1 = target.posX < enemy.posX ? -1 : 1;
      const forwardX = target.posX - facingDir * (attackerHalfW + targetHalfW + gap);
      this.playFloatyAttack(enemy, forwardX, target.posY, facingDir, resolveImpact, () => {
        enemy.atb = 0;
        this.time.delayedCall(400, () => {
          this.waitMode = false;
          this.checkEndConditions();
        });
      });
    } else {
      // Fallback for map-object enemies without animations: slide + delayed damage
      this.playAttackTween(enemy, target);
      this.time.delayedCall(500, () => {
        resolveImpact();
        enemy.atb = 0;
        this.time.delayedCall(400, () => {
          this.waitMode = false;
          this.checkEndConditions();
        });
      });
    }
  }

  /**
   * Spawn animated smoke-cloud sprites over each enemy using the SpriteCook
   * VFX anim. Clouds drift, pulse, and persist until every enemy has used
   * their miss (see `checkSmokeExpiry`).
   */
  private spawnSmokeClouds(enemies: Unit[]): void {
    this.clearSmokeClouds();
    for (const e of enemies) {
      if (!e.sprite) continue;
      const base = { x: e.sprite.x, y: e.sprite.y };
      const cloudsPerEnemy = 2;
      for (let i = 0; i < cloudsPerEnemy; i++) {
        const jitterX = (Math.random() - 0.5) * 50;
        const jitterY = (Math.random() - 0.5) * 30;
        const scale = 0.8 + Math.random() * 0.4;
        const cloud = this.add
          .sprite(base.x + jitterX, base.y + jitterY, 'smoke-vfx-000')
          .setAlpha(0)
          .setScale(scale)
          .setDepth(99980);
        // Start the anim at a random frame so the clouds don't pulse in unison
        cloud.play({ key: 'smoke-vfx', startFrame: Math.floor(Math.random() * 8) });
        // Fade in
        this.tweens.add({
          targets: cloud,
          alpha: 0.55 + Math.random() * 0.15,
          duration: 260,
          ease: 'Sine.easeOut',
        });
        // Gentle drift upward over time
        const driftX = (Math.random() - 0.5) * 30;
        const driftY = -18 - Math.random() * 10;
        this.tweens.add({
          targets: cloud,
          x: cloud.x + driftX,
          y: cloud.y + driftY,
          duration: 2600 + Math.random() * 800,
          ease: 'Sine.easeInOut',
          yoyo: true,
          repeat: -1,
        });
        this.smokeClouds.push(cloud);
      }
    }
  }

  /**
   * If no living enemy still has missing=true, fade and destroy all active
   * smoke clouds. Called after each enemy's miss resolves.
   */
  private checkSmokeExpiry(): void {
    if (this.smokeClouds.length === 0) return;
    const anyStillMissing = this.units.some(
      (u) => u.side === 'enemy' && !u.ko && u.missing,
    );
    if (anyStillMissing) return;
    this.clearSmokeClouds();
  }

  private clearSmokeClouds(): void {
    for (const cloud of this.smokeClouds) {
      this.tweens.killTweensOf(cloud);
      this.tweens.add({
        targets: cloud,
        alpha: 0,
        duration: 400,
        ease: 'Sine.easeIn',
        onComplete: () => cloud.destroy(),
      });
    }
    this.smokeClouds = [];
  }

  private static readonly ELEMENT_COLOR: Record<Element, number> = {
    thermal: 0xff6a1f,
    coolant: 0x5ac8ff,
    surge: 0xffe04a,
    none: 0xffffff,
  };

  /**
   * Partial-advance ranged attack: walks a fraction of the way toward the
   * target (so the attacker takes a few steps without closing the gap), plays
   * the attack anim in place, launches an elemental projectile from the
   * attacker to the target, walks back to origin. onImpact fires when the
   * projectile lands.
   */
  private playPartialAdvanceRangedAttack(
    attacker: Unit,
    target: Unit,
    animKey: string,
    element: Element,
    onImpact: () => void,
    onComplete: () => void,
    // Vertical offset from sprite center where the projectile launches.
    // Negative = higher on the sprite (e.g. chest); 0 = center (default, barrel-aligned).
    muzzleYOffset: number = 0,
    // 1-based frame index within the attack anim where the projectile launches.
    // e.g. 5 = fire on the 5th frame. Default ~ 500ms after anim start.
    boltFrameIndex?: number,
    // Optional override color for the projectile. Defaults to the element color.
    boltColorOverride?: number,
    // Forward offset (toward the target) from sprite center. Use to align the
    // muzzle point with the actual barrel/chest in the attack sprite frame.
    muzzleXOffset: number = 0,
  ): void {
    if (!attacker.sprite || !target.sprite) {
      onImpact();
      onComplete();
      return;
    }
    const sprite = attacker.sprite;
    const color = boltColorOverride ?? CombatScene.ELEMENT_COLOR[element] ?? 0xffffff;
    const originX = attacker.posX;
    const originY = attacker.posY;
    const dirX = target.posX < originX ? -1 : 1;
    const advanceDist = Math.min(80, Math.abs(target.posX - originX) * 0.35);
    const advanceX = originX + dirX * advanceDist;
    const advanceY = originY;

    const walkAnimKey = `${attacker.id}-walk-east`;
    const hasWalk = this.anims.exists(walkAnimKey);
    this.stopIdleBob(attacker);
    sprite.setDepth(DEPTH_WALK_FORWARD_BASE + sprite.y);

    // Hide the HP bar + status icon while the attacker walks out — they're
    // anchored to the home position and would otherwise float over empty space.
    const hpBarAlpha = attacker.enemyHpBar?.alpha ?? 0;
    const hpBarBgAlpha = attacker.enemyHpBarBg?.alpha ?? 0;
    const statusAlpha = attacker.statusIcon?.alpha ?? 0;
    this.tweens.killTweensOf([attacker.enemyHpBar, attacker.enemyHpBarBg].filter(Boolean));
    attacker.enemyHpBar?.setAlpha(0);
    attacker.enemyHpBarBg?.setAlpha(0);
    attacker.statusIcon?.setAlpha(0);

    // Dim other living enemies so the attacker visually pops. Mirrors the
    // peer-dim behavior in playFullAttackSequence.
    const dimmedPeers: { unit: Unit; originalAlpha: number }[] = [];
    if (attacker.side === 'enemy') {
      for (const other of this.units) {
        if (other === attacker) continue;
        if (other.side !== 'enemy') continue;
        if (other.ko) continue;
        if (!other.sprite) continue;
        dimmedPeers.push({ unit: other, originalAlpha: other.sprite.alpha });
        other.sprite.setAlpha(DIMMED_PEER_ENEMY_ALPHA);
      }
    }

    // Compute bolt launch delay: if a frame index was supplied, derive it from
    // the anim's framerate so it stays synced when framerates change. Otherwise
    // fall back to a fixed 500ms (original behavior).
    const anim = this.anims.get(animKey);
    const frameRate = anim?.frameRate ?? 7;
    const boltDelay =
      boltFrameIndex !== undefined ? Math.max(0, (boltFrameIndex - 1) * (1000 / frameRate)) : 500;

    // Step 1: walk forward a bit.
    if (hasWalk) sprite.play({ key: walkAnimKey, repeat: -1 });
    this.tweens.add({
      targets: sprite,
      x: advanceX,
      y: advanceY,
      duration: 350,
      ease: 'Linear',
      onComplete: () => {
        if (hasWalk) sprite.anims.stop();
        sprite.setTexture(attacker.spriteKey);
        // Step 2: play firing anim in place.
        sprite.play(animKey);
        // Launch the bolt on the specified frame (or at 500ms if unset).
        this.time.delayedCall(boltDelay, () => {
          if (!target.sprite) {
            onImpact();
            onComplete();
            return;
          }
          const startX = sprite.x + dirX * muzzleXOffset;
          const startY = sprite.y + muzzleYOffset;
          const distance = Phaser.Math.Distance.Between(
            startX,
            startY,
            target.sprite.x,
            target.sprite.y,
          );
          const travelDuration = Math.max(220, Math.min(480, distance * 1.3));
          const glow = this.add.circle(startX, startY, 14, color, 0.35).setDepth(99999);
          const core = this.add.circle(startX, startY, 6, color, 1).setDepth(99999);
          this.tweens.add({
            targets: [glow, core],
            x: target.sprite.x,
            y: target.sprite.y,
            duration: travelDuration,
            ease: 'Sine.easeIn',
            onComplete: () => {
              glow.destroy();
              core.destroy();
              onImpact();
            },
          });
        });
        sprite.once('animationcomplete', () => {
          sprite.setTexture(attacker.spriteKey);
          // Step 3: walk back to origin.
          if (hasWalk) sprite.play({ key: walkAnimKey, repeat: -1 });
          this.tweens.add({
            targets: sprite,
            x: originX,
            y: originY,
            duration: 350,
            ease: 'Linear',
            onComplete: () => {
              if (hasWalk) sprite.anims.stop();
              sprite.setTexture(attacker.spriteKey);
              sprite.setDepth(DEPTH_ENEMY_BASE + attacker.posY);
              // Restore HP bar + status icon now that the sprite is home.
              if (!attacker.ko) {
                attacker.enemyHpBar?.setAlpha(hpBarAlpha);
                attacker.enemyHpBarBg?.setAlpha(hpBarBgAlpha);
                attacker.statusIcon?.setAlpha(statusAlpha);
                this.playIdleFor(attacker);
              }
              // Restore dimmed peers.
              for (const peer of dimmedPeers) {
                peer.unit.sprite?.setAlpha(peer.originalAlpha);
              }
              onComplete();
            },
          });
        });
      },
    });
  }

  /**
   * Visual hit for an elemental enemy attack: a tinted shockwave ring expanding
   * from the target plus element-specific flavor (sparks / icicles / arc).
   */
  /**
   * Big centered shockwave burst for boss signature ground-slam attacks.
   * Spawns from the attacker's feet: two expanding rings + radial ice shards +
   * low ground-level frost smear. Larger and more dramatic than per-target
   * playElementalImpact.
   */
  private playSignatureSlamBurst(attacker: Unit, element: Element): void {
    if (!attacker.sprite) return;
    const color = CombatScene.ELEMENT_COLOR[element] ?? 0xffffff;
    const x = attacker.sprite.x;
    // Anchor the burst near the attacker's feet, not center.
    const y = attacker.sprite.y + attacker.sprite.displayHeight * 0.35;

    // Inner ring — bright, fast.
    const innerRing = this.add
      .circle(x, y, 24, color, 0)
      .setStrokeStyle(5, color, 1)
      .setDepth(99998);
    this.tweens.add({
      targets: innerRing,
      scale: 5,
      alpha: 0,
      duration: 480,
      ease: 'Cubic.easeOut',
      onComplete: () => innerRing.destroy(),
    });

    // Outer ring — slower, wider, thinner stroke.
    const outerRing = this.add
      .circle(x, y, 24, color, 0)
      .setStrokeStyle(3, 0xffffff, 0.9)
      .setDepth(99997);
    this.tweens.add({
      targets: outerRing,
      scale: 8,
      alpha: 0,
      duration: 680,
      delay: 80,
      ease: 'Cubic.easeOut',
      onComplete: () => outerRing.destroy(),
    });

    // Low-profile frost smear along the ground — squashed ellipse.
    const smear = this.add.ellipse(x, y, 40, 14, color, 0.55).setDepth(99996);
    this.tweens.add({
      targets: smear,
      scaleX: 6,
      scaleY: 2,
      alpha: 0,
      duration: 520,
      ease: 'Cubic.easeOut',
      onComplete: () => smear.destroy(),
    });

    // Radial ice shards — more numerous and larger than per-target impact.
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const dist = 90 + Math.random() * 40;
      const endX = x + Math.cos(angle) * dist;
      const endY = y + Math.sin(angle) * dist * 0.55; // flattened downward
      const shard = this.add
        .triangle(x, y, 0, -8, 4, 8, -4, 8, 0xd8f4ff)
        .setStrokeStyle(1, 0x2a8fbf, 1)
        .setDepth(99999)
        .setRotation(angle + Math.PI / 2);
      this.tweens.add({
        targets: shard,
        x: endX,
        y: endY,
        alpha: 0,
        duration: 560,
        ease: 'Cubic.easeOut',
        onComplete: () => shard.destroy(),
      });
    }
  }

  private playElementalImpact(target: Unit, element: Element): void {
    if (!target.sprite) return;
    const color = CombatScene.ELEMENT_COLOR[element] ?? 0xffffff;
    const x = target.sprite.x;
    const y = target.sprite.y;
    const ring = this.add.circle(x, y, 16, color, 0).setStrokeStyle(3, color, 1).setDepth(99999);
    this.tweens.add({
      targets: ring,
      scale: 3,
      alpha: 0,
      duration: 360,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });

    if (element === 'surge') {
      // Quick second pulse for an "arc" feel.
      const ring2 = this.add.circle(x, y, 12, color, 0).setStrokeStyle(2, color, 1).setDepth(99999);
      this.tweens.add({
        targets: ring2,
        scale: 2.4,
        alpha: 0,
        duration: 220,
        delay: 120,
        ease: 'Cubic.easeOut',
        onComplete: () => ring2.destroy(),
      });
      return;
    }

    if (element === 'thermal') {
      // Ember sparks flying outward.
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + Math.random() * 0.4;
        const dist = 40 + Math.random() * 20;
        const spark = this.add.circle(x, y, 3, 0xffb055, 1).setDepth(99999);
        this.tweens.add({
          targets: spark,
          x: x + Math.cos(angle) * dist,
          y: y + Math.sin(angle) * dist,
          alpha: 0,
          duration: 420,
          ease: 'Cubic.easeOut',
          onComplete: () => spark.destroy(),
        });
      }
      return;
    }

    if (element === 'coolant') {
      // Radiating icicle shards + brief frost tint on target.
      for (let i = 0; i < 7; i++) {
        const angle = (i / 7) * Math.PI * 2;
        const dist = 34 + Math.random() * 10;
        const endX = x + Math.cos(angle) * dist;
        const endY = y + Math.sin(angle) * dist;
        const shard = this.add
          .triangle(x, y, 0, -6, 3, 6, -3, 6, 0xb9ecff)
          .setStrokeStyle(1, 0x2a8fbf, 1)
          .setDepth(99999)
          .setRotation(angle + Math.PI / 2);
        this.tweens.add({
          targets: shard,
          x: endX,
          y: endY,
          alpha: 0,
          duration: 460,
          ease: 'Cubic.easeOut',
          onComplete: () => shard.destroy(),
        });
      }
      // Frost tint kicks in AFTER applyDamage's red flash clears (~140ms).
      this.time.delayedCall(160, () => {
        if (!target.sprite || target.ko) return;
        target.sprite.setTint(0x8accff);
        this.time.delayedCall(300, () => {
          if (target.sprite) target.sprite.clearTint();
        });
      });
    }
  }

  private playAttackTween(u: Unit, target: Unit): void {
    if (!u.sprite) return;

    const facing = getUnitFacing(u);
    const animKey = `${u.id}-attack-${facing}`;
    const hasAnim = this.anims.exists(animKey);

    if (hasAnim) {
      this.playFullAttackSequence(u, target, animKey);
    } else {
      // Fallback for enemies without an attack animation: small nudge + scale pulse
      // in place. Avoids the big slide that a 50-px translate produces on small
      // sprites like the Scout Drone.
      const dir = target.posX < u.posX ? -1 : 1;
      const baseScale = u.scale;
      this.tweens.add({
        targets: u.sprite,
        x: u.posX + dir * 12,
        scaleX: baseScale * 1.08,
        scaleY: baseScale * 1.08,
        duration: 110,
        yoyo: true,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          if (u.sprite) {
            u.sprite.x = u.posX;
            u.sprite.setScale(baseScale);
          }
        },
      });
    }
  }

  // Attack sequence for floaty enemies (Scout Drone, Nanite Swarm) that have an idle
  // hover anim but no walk/attack anims. Flies forward without swapping textures
  // (idle anim keeps running throughout), nudges + impact at destination, flies back.
  private playFloatyAttack(
    u: Unit,
    targetX: number,
    targetY: number,
    facingDir: 1 | -1,
    onImpact: () => void,
    onComplete: () => void,
  ): void {
    if (!u.sprite) {
      onComplete();
      return;
    }
    const sprite = u.sprite;
    const distance = Phaser.Math.Distance.Between(u.posX, u.posY, targetX, targetY);
    const flySpeed = 0.6; // pixels per ms
    const flyDuration = Math.max(300, distance / flySpeed);

    // Idle bob tweens sprite.y; our position tween needs to own y, so pause the bob.
    this.stopIdleBob(u);

    // Elevate depth during flight + hide shadow, HP bar, status icon.
    sprite.setDepth(DEPTH_WALK_FORWARD_BASE + sprite.y);
    const shadowAlpha = u.shadow?.alpha ?? 0;
    const hpBarAlpha = u.enemyHpBar?.alpha ?? 0;
    const hpBarBgAlpha = u.enemyHpBarBg?.alpha ?? 0;
    const statusAlpha = u.statusIcon?.alpha ?? 0;
    u.shadow?.setAlpha(0);
    u.enemyHpBar?.setAlpha(0);
    u.enemyHpBarBg?.setAlpha(0);
    u.statusIcon?.setAlpha(0);

    const baseScale = u.scale;

    this.tweens.add({
      targets: sprite,
      x: targetX,
      y: targetY,
      duration: flyDuration,
      ease: 'Sine.easeInOut',
      onUpdate: () => sprite.setDepth(DEPTH_WALK_FORWARD_BASE + sprite.y),
      onComplete: () => {
        // Nudge + impact
        this.tweens.add({
          targets: sprite,
          x: targetX + facingDir * 10,
          scaleX: baseScale * 1.08,
          scaleY: baseScale * 1.08,
          duration: 110,
          yoyo: true,
          ease: 'Sine.easeInOut',
          onComplete: () => {
            sprite.setScale(baseScale);
            onImpact();
            // Fly back
            this.tweens.add({
              targets: sprite,
              x: u.posX,
              y: u.posY,
              duration: flyDuration,
              ease: 'Sine.easeInOut',
              onUpdate: () => sprite.setDepth(DEPTH_WALK_FORWARD_BASE + sprite.y),
              onComplete: () => {
                sprite.setDepth(DEPTH_ENEMY_BASE + u.posY);
                if (!u.ko) {
                  u.shadow?.setAlpha(shadowAlpha);
                  u.enemyHpBar?.setAlpha(hpBarAlpha);
                  u.enemyHpBarBg?.setAlpha(hpBarBgAlpha);
                  u.statusIcon?.setAlpha(statusAlpha);
                  this.startIdleBob(u);
                }
                onComplete();
              },
            });
          },
        });
      },
    });
  }

  /**
   * Boss signature AoE attack: walk to the center party member, play the
   * dedicated elemental animation, on impact damage EVERY living party member
   * (escort exempt), show elemental impact on each, then walk back.
   */
  /**
   * Returns the living party member with the median posY — the visual
   * "middle" of the party column. Used for ranged/AoE attack focal point so
   * composition feels centered rather than biased to a front- or back-line.
   * Returns null if no party members are alive.
   */
  private getCenterPartyMember(): Unit | null {
    const alive = this.units.filter((u) => u.side === 'party' && !u.ko);
    if (alive.length === 0) return null;
    const sorted = [...alive].sort((a, b) => a.posY - b.posY);
    return sorted[Math.floor(sorted.length / 2)];
  }

  private playSignatureAoE(enemy: Unit, sig: NonNullable<EnemyDef['signatureAoE']>): void {
    const partyTargets = this.units.filter((u) => u.side === 'party' && !u.ko);
    if (partyTargets.length === 0) {
      this.waitMode = false;
      this.checkEndConditions();
      return;
    }
    // Walk to the front of the MIDDLE party member (median Y among living).
    const center = this.getCenterPartyMember() ?? partyTargets[0];

    const onImpact = () => {
      if (enemy.missing) {
        enemy.missing = false;
        this.updateStatusIcon(enemy);
        this.checkSmokeExpiry();
        spawnFloatNumber(this, enemy, 'MISS', '#aaaaaa');
        this.showMessage(`${enemy.name} is blinded by smoke!`);
        return;
      }
      playSfx(this, 'sfx-wreckwarden-slam', 1);
      // Ground shake — feel the impact.
      this.cameras.main.shake(380, 0.006);
      // Big centered shockwave burst at the wreckwarden's feet.
      this.playSignatureSlamBurst(enemy, sig.element);
      this.showMessage(`${enemy.name} COOLANT SLAM — cryogenic burst hits the party!`);
      for (const p of partyTargets) {
        if (p.ko) continue;
        const damage = Math.max(1, calculateDamage(enemy, p, sig.power, sig.element));
        this.playElementalImpact(p, sig.element);
        this.applyDamage(p, damage, false, sig.element);
      }
    };

    const finalize = () => {
      enemy.atb = 0;
      this.waitMode = false;
      this.checkEndConditions();
    };

    if (this.anims.exists(sig.animKey)) {
      // Impact delay tuned to land on the kneel/slam frame of the 9-frame
      // PixelLab anim (frame 7 at 8fps ≈ 875ms); 750ms fires just before it
      // settles so shockwave + shake + SFX sync with the visible slam.
      this.playFullAttackSequence(enemy, center, sig.animKey, onImpact, finalize, 0, 750);
    } else {
      this.playAttackTween(enemy, center);
      this.time.delayedCall(500, () => {
        onImpact();
        this.time.delayedCall(400, finalize);
      });
    }
  }

  // Pick Shockwave target via weighted random across three strategies:
  //   highest-ATB (weight 3) — most "interrupt"-feeling
  //   random      (weight 2) — keeps it from being fully predictable
  //   last-damager (weight 1) — thematic retaliation; falls back to random if null
  private pickShockwaveTarget(enemy: Unit, living: Unit[]): Unit {
    if (living.length === 0) return living[0];
    const weights = [3, 2, 1];
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    let choice: 'atb' | 'random' | 'lastdmg' = 'atb';
    for (const [i, w] of weights.entries()) {
      if (roll < w) {
        choice = i === 0 ? 'atb' : i === 1 ? 'random' : 'lastdmg';
        break;
      }
      roll -= w;
    }
    if (choice === 'lastdmg') {
      const last = enemy.lastDamagerId
        ? living.find((u) => u.id === enemy.lastDamagerId)
        : undefined;
      if (last) return last;
      choice = 'random';
    }
    if (choice === 'atb') {
      return living.reduce((acc, u) => (u.atb > acc.atb ? u : acc));
    }
    return living[Math.floor(Math.random() * living.length)];
  }

  private playShockwaveAttack(enemy: Unit, shock: NonNullable<EnemyDef['shockwave']>): void {
    const party = this.units.filter((u) => u.side === 'party' && !u.ko);
    if (party.length === 0) {
      enemy.atb = 0;
      this.waitMode = false;
      this.checkEndConditions();
      return;
    }
    const target = this.pickShockwaveTarget(enemy, party);

    const onImpact = () => {
      if (enemy.missing) {
        enemy.missing = false;
        this.updateStatusIcon(enemy);
        this.checkSmokeExpiry();
        spawnFloatNumber(this, enemy, 'MISS', '#aaaaaa');
        this.showMessage(`${enemy.name} is blinded by smoke!`);
        return;
      }
      playSfx(this, 'sfx-wreckwarden-attack', 1);
      const damage = Math.max(1, calculateDamage(enemy, target, shock.power, shock.element));
      this.playElementalImpact(target, shock.element);
      this.applyDamage(target, damage, false, shock.element);
      // ATB reset — the "interrupt" part of the move.
      target.atb = 0;
      this.updatePanelRow(target);
      // Delay the INTERRUPT floaty by 450ms so it doesn't overlap the damage
      // number (which spawns at the same spot and takes ~800ms to float+fade).
      this.time.delayedCall(450, () => {
        if (!target.ko) spawnFloatNumber(this, target, 'INTERRUPT!', '#88ccff');
      });
      this.showMessage(
        `${enemy.name} SHOCKWAVE — ${target.name} takes ${damage} and loses their turn`,
      );
    };

    const finalize = () => {
      enemy.atb = 0;
      this.waitMode = false;
      this.checkEndConditions();
    };

    const hasAnim = this.anims.exists(shock.animKey);
    // Blue-tinted projectile for Wreckwarden's shockwave (rather than surge yellow).
    const SHOCKWAVE_BLUE = 0x5ac8ff;
    if (hasAnim) {
      this.playPartialAdvanceRangedAttack(
        enemy,
        target,
        shock.animKey,
        shock.element,
        onImpact,
        finalize,
        shock.chestYOffset ?? 0,
        15, // bolt fires on frame 15 of the 17-frame windup
        SHOCKWAVE_BLUE,
      );
    } else {
      // Fallback: no dedicated anim yet — walk a step, fire projectile, walk back.
      this.playPartialAdvanceRangedAttack(
        enemy,
        target,
        `${enemy.id}-attack-east`,
        shock.element,
        onImpact,
        finalize,
        shock.chestYOffset ?? 0,
        undefined,
        SHOCKWAVE_BLUE,
      );
    }
  }

  private playFullAttackSequence(
    u: Unit,
    target: Unit,
    animKey: string,
    onImpact?: () => void,
    onComplete?: () => void,
    attackRepeats: number = 0,
    impactDelayMs: number = 300,
  ): void {
    if (!u.sprite) return;
    const sprite = u.sprite;
    const attackerHalfW = sprite.displayWidth * 0.5;
    const targetHalfW = (target.sprite?.displayWidth ?? 100) * 0.5;
    const gap = 20;

    // Position attacker just in front of the target on their own side. Align
    // the attacker's FEET with the target's feet (not their origins), so
    // oversized targets like Wreckwarden don't leave attackers floating near
    // their shoulders. Falls through to target.posY when feetOffsetY is unset.
    const facingDir = target.posX < u.posX ? -1 : 1;
    let forwardX = target.posX - facingDir * (attackerHalfW + targetHalfW + gap);
    const targetFeetY = target.posY + (target.feetOffsetY ?? 0);
    const forwardY = targetFeetY - (u.feetOffsetY ?? 0);

    // (Enemies attacking the escort walk directly to her — no clamp. Party
    // members in the visual path are dimmed during the walk, see below.)

    // FF6-style: party attacking an enemy stops at the enemy formation's front
    // edge (largest-X enemy) rather than walking through front-line enemies to
    // reach a back-line target.
    if (u.side === 'party' && target.side === 'enemy') {
      const livingEnemies = this.units.filter((e) => e.side === 'enemy' && !e.ko);
      if (livingEnemies.length > 0) {
        const frontLine = livingEnemies.reduce((acc, e) => (e.posX > acc.posX ? e : acc));
        if (frontLine !== target) {
          const frontHalfW = (frontLine.sprite?.displayWidth ?? 120) * 0.5;
          forwardX = frontLine.posX - facingDir * (attackerHalfW + frontHalfW * 0.3 + 4);
        }
      }
    }

    // Distance-based walk duration so long walks take longer than short ones
    const distance = Phaser.Math.Distance.Between(u.posX, u.posY, forwardX, forwardY);
    const walkSpeed = 0.55; // pixels per ms
    const walkDuration = Math.max(350, distance / walkSpeed);

    const walkAnimKey = `${u.id}-walk-${getUnitFacing(u)}`;
    const hasWalk = this.anims.exists(walkAnimKey);

    // Stop any idle bob so it doesn't fight the walk-forward/walk-back y tween.
    this.stopIdleBob(u);

    // Elevate sprite depth so it renders above all other battle units during walk-forward + attack.
    // Add current Y so if two walking sprites cross, they still stack naturally by Y.
    sprite.setDepth(DEPTH_WALK_FORWARD_BASE + sprite.y);

    // Hide shadow during the attack sequence — shadows are for idle only
    const shadowAlpha = u.shadow?.alpha ?? 0;
    u.shadow?.setAlpha(0);

    // Hide the enemy HP bar (and background) during the attack sequence so it
    // doesn't float in the air at the attacker's idle position while they walk.
    const hpBarAlpha = u.enemyHpBar?.alpha ?? 0;
    const hpBarBgAlpha = u.enemyHpBarBg?.alpha ?? 0;
    this.tweens.killTweensOf([u.enemyHpBar, u.enemyHpBarBg].filter(Boolean));
    u.enemyHpBar?.setAlpha(0);
    u.enemyHpBarBg?.setAlpha(0);

    // Hide status icon (❄/z/▲) — it's anchored to home position, so it would
    // float at the idle spot while the enemy walks/flies elsewhere.
    const statusAlpha = u.statusIcon?.alpha ?? 0;
    u.statusIcon?.setAlpha(0);

    // Dim other enemies so the active enemy attacker pops.
    // Only applied to enemy side — party members don't get dimmed when a peer attacks.
    const dimmedPeers: { unit: Unit; originalAlpha: number }[] = [];
    if (u.side === 'enemy') {
      for (const other of this.units) {
        if (other === u) continue;
        if (other.side !== 'enemy') continue;
        if (other.ko) continue;
        if (!other.sprite) continue;
        dimmedPeers.push({ unit: other, originalAlpha: other.sprite.alpha });
        other.sprite.setAlpha(DIMMED_PEER_ENEMY_ALPHA);
      }
    }

    // During walk-back, enemies use a raised tier so the attacker renders above other enemies
    // (party continue to use their normal tier so walking-back party respects party-peer stacking).
    const walkBackBase = u.side === 'enemy' ? DEPTH_ENEMY_ACTIVE_BASE : DEPTH_PARTY_BASE;
    const sideBase = u.side === 'enemy' ? DEPTH_ENEMY_BASE : DEPTH_PARTY_BASE;
    void sideBase; // kept to document the idle-tier baseline for reference

    // For enemy → escort: the enemy walks through the party to reach the escort,
    // so dim the entire party (not escort) for the whole sequence. Restored at end.
    const pathOverlapTargets: Unit[] = [];
    const pathOverlapOriginalAlphas = new Map<Unit, number>();
    if (u.side === 'enemy' && target.side === 'escort') {
      for (const p of this.units) {
        if (p.side !== 'party') continue;
        if (p.ko) continue;
        if (!p.sprite) continue;
        pathOverlapTargets.push(p);
        pathOverlapOriginalAlphas.set(p, p.sprite.alpha);
        p.sprite.setAlpha(DIMMED_OTHER_ALPHA);
      }
    }

    // Step 1: walk forward to target's XY (depth updates with Y via onUpdate)
    if (hasWalk) sprite.play({ key: walkAnimKey, repeat: -1 });
    this.tweens.add({
      targets: sprite,
      x: forwardX,
      y: forwardY,
      duration: walkDuration,
      ease: 'Linear',
      onUpdate: () => {
        sprite.setDepth(DEPTH_WALK_FORWARD_BASE + sprite.y);
      },
      onComplete: () => {
        if (hasWalk) sprite.anims.stop();
        sprite.setTexture(u.spriteKey);
        // Step 2: play attack animation, fire impact mid-anim
        sprite.play({ key: animKey, repeat: attackRepeats });
        const impactDelay = impactDelayMs;
        if (onImpact) this.time.delayedCall(impactDelay, onImpact);
        sprite.once('animationcomplete', () => {
          sprite.setTexture(u.spriteKey);
          // During walk-back: depth base depends on side (enemies stay above other enemies)
          sprite.setDepth(walkBackBase + sprite.y);
          if (hasWalk) sprite.play({ key: walkAnimKey, repeat: -1 });
          this.tweens.add({
            targets: sprite,
            x: u.posX,
            y: u.posY,
            duration: walkDuration,
            ease: 'Linear',
            onUpdate: () => {
              sprite.setDepth(walkBackBase + sprite.y);
            },
            onComplete: () => {
              if (hasWalk) sprite.anims.stop();
              sprite.setTexture(u.spriteKey);
              // Restore idle-tier depth (based on side, not the active walk tier)
              const idleBase = u.side === 'enemy' ? DEPTH_ENEMY_BASE : DEPTH_PARTY_BASE;
              sprite.setDepth(idleBase + u.posY);
              if (!u.ko) u.shadow?.setAlpha(shadowAlpha);
              // Restore HP bar visibility (only if attacker survived and was visible before)
              if (!u.ko) {
                u.enemyHpBar?.setAlpha(hpBarAlpha);
                u.enemyHpBarBg?.setAlpha(hpBarBgAlpha);
                u.statusIcon?.setAlpha(statusAlpha);
              }
              // Restore dimmed peers
              for (const peer of dimmedPeers) {
                peer.unit.sprite?.setAlpha(peer.originalAlpha);
              }
              // Restore any path-overlapped party members to their original alpha
              for (const p of pathOverlapTargets) {
                const orig = pathOverlapOriginalAlphas.get(p) ?? 1;
                p.sprite?.setAlpha(orig);
              }
              if (!u.ko) this.playIdleFor(u);
              if (onComplete) onComplete();
            },
          });
        });
      },
    });
  }

  private playCastTween(u: Unit): void {
    if (!u.sprite) return;
    // Prefer frame-based cast animation if available for this unit
    const castAnimKey = `${u.id}-cast-west`;
    if (this.anims.exists(castAnimKey)) {
      u.sprite.play(castAnimKey);
      u.sprite.once('animationcomplete', () => {
        if (!u.ko) u.sprite?.setTexture(u.spriteKey);
      });
      return;
    }
    const baseScale = u.scale;
    this.tweens.add({
      targets: u.sprite,
      scaleX: baseScale * 1.12,
      scaleY: baseScale * 1.12,
      duration: 180,
      yoyo: true,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        u.sprite?.setScale(baseScale);
      },
    });
  }

  private static readonly TWEEN_IDLE_UNITS = new Set<string>(['scoutdrone']);

  private startIdleBob(u: Unit): void {
    if (!u.sprite || u.ko) return;
    if (!CombatScene.TWEEN_IDLE_UNITS.has(u.id)) return;
    u.idleTween?.stop();
    u.sprite.y = u.posY;
    u.idleTween = this.tweens.add({
      targets: u.sprite,
      y: u.posY - 2,
      duration: 380,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private stopIdleBob(u: Unit): void {
    if (!u.idleTween) return;
    u.idleTween.stop();
    u.idleTween = undefined;
    if (u.sprite) u.sprite.y = u.posY;
  }

  private playIdleFor(u: Unit): void {
    if (!u.sprite || u.ko) return;
    const idleKey = `${u.id}-idle-${getUnitFacing(u)}`;
    if (this.anims.exists(idleKey)) {
      u.sprite.play(idleKey);
    }
    this.startIdleBob(u);
  }

  private setEnemyIdlesPaused(paused: boolean): void {
    for (const u of this.units) {
      if (u.side !== 'enemy' || u.ko || !u.sprite) continue;
      if (u.sprite.anims.isPlaying || u.sprite.anims.isPaused) {
        if (paused) u.sprite.anims.pause();
        else u.sprite.anims.resume();
      }
      if (u.idleTween) {
        if (paused) u.idleTween.pause();
        else u.idleTween.resume();
      }
    }
  }

  private resetSpriteForRevive(u: Unit): void {
    if (!u.sprite) return;
    this.tweens.killTweensOf(u.sprite);
    u.sprite.anims.stop();
    u.sprite.setTexture(u.spriteKey); // swap out of the downed pose back to idle
    u.sprite.setAngle(0);
    u.sprite.setAlpha(1);
    u.sprite.y = u.posY;
    u.sprite.x = u.posX;
    u.sprite.setScale(u.scale);
    if (u.shadow) {
      this.tweens.killTweensOf(u.shadow);
      u.shadow.setAlpha(0.18);
    }
  }

  private showMessage(text: string): void {
    this.messageText?.setText(text);
  }

  private checkEndConditions(): void {
    if (this.combatOver) {
      log('END_CHECK', 'skipped (combat already over)');
      return;
    }
    const escort = this.units.find((u) => u.side === 'escort');
    const livingEnemies = this.units.filter((u) => u.side === 'enemy' && !u.ko);
    const livingParty = this.units.filter((u) => u.side === 'party' && !u.ko);

    log('END_CHECK', 'evaluated', {
      livingEnemies: livingEnemies.map((u) => u.id),
      livingParty: livingParty.map((u) => u.id),
      escortKo: escort?.ko ?? false,
    });

    if (escort?.ko) {
      this.loseRun('Dr. Vey was lost.');
    } else if (livingParty.length === 0) {
      this.loseRun('Your party fell.');
    } else if (livingEnemies.length === 0) {
      this.winEncounter();
    }
  }

  private winEncounter(): void {
    log('WIN', 'encounter cleared');
    this.combatOver = true;
    this.waitMode = true;
    const run = getRun();
    this.saveStateToRun();

    playSfx(this, 'sfx-victory-jingle', 0.5);
    this.showMessage('VICTORY');

    this.time.delayedCall(1200, () => {
      const wasLastIndex = run.encounterIndex;
      const nextIndex = run.encounterIndex + 1;
      run.encounterIndex = nextIndex;
      // Rest happens BEFORE Journey narratively ("rest at this spot, then
      // travel to the next"). Journey is always the final transition into the
      // next Combat or RunComplete.
      if (run.route.restAfter.includes(wasLastIndex) && nextIndex < run.route.encounters.length) {
        log('SCENE', 'Combat → Rest', { nextEncounter: nextIndex });
        this.scene.start('Rest');
      } else {
        log('SCENE', 'Combat → Journey', { destination: nextIndex });
        this.scene.start('Journey');
      }
    });
  }

  private loseRun(reason: string): void {
    log('LOSE', 'run lost', { reason });
    this.combatOver = true;
    this.waitMode = true;
    this.saveStateToRun();
    playSfx(this, 'sfx-defeat-sting', 0.5);
    this.time.delayedCall(1000, () => {
      this.scene.start('RunComplete', { outcome: 'defeat', reason });
    });
  }

  private abortRun(): void {
    this.scene.start('RunComplete', { outcome: 'defeat', reason: 'Run aborted.' });
  }

  private handleEscapeKey(): void {
    if (this.combatOver) return;
    playSfx(this, 'sfx-menu-cancel', 0.5);
    if (this.pauseMenuOpen) {
      this.closePauseMenu();
      return;
    }
    if (this.itemTargetSelectActive && this.activeUnitId) {
      const u = this.units.find((x) => x.id === this.activeUnitId);
      this.clearTargetSelect();
      this.hideCancelButton();
      this.itemTargetSelectActive = false;
      if (u) this.showItemMenu(u);
      return;
    }
    if (this.targetSelectActive && this.activeUnitId) {
      const u = this.units.find((x) => x.id === this.activeUnitId);
      this.clearTargetSelect();
      this.hideCancelButton();
      this.hideTargetMenu();
      this.targetSelectActive = false;
      if (u) this.showActionMenu(u);
      return;
    }
    if (this.itemMenuOpen && this.activeUnitId) {
      const u = this.units.find((x) => x.id === this.activeUnitId);
      this.actionMenuContainer?.destroy();
      this.actionMenuContainer = undefined;
      this.itemMenuOpen = false;
      if (u) this.showActionMenu(u);
      return;
    }
    this.openPauseMenu();
  }

  private openPauseMenu(): void {
    if (this.pauseMenuOpen) return;
    this.pauseMenuOpen = true;
    this.savedWaitModeForPause = this.waitMode;
    this.waitMode = true;
    this.buildPauseMenuMain();
  }

  private buildPauseMenuMain(): void {
    this.pauseMenuContainer?.destroy();
    const { width, height } = this.scale;
    const container = this.add.container(0, 0).setDepth(200000);
    const bg = this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.75)
      .setOrigin(0.5)
      .setInteractive();

    const resumeBtn = this.add
      .text(width / 2, height / 2 - 70, '[ RESUME ]', {
        fontFamily: FONT,
        fontSize: '28px',
        color: '#8aff8a',
        backgroundColor: '#2a3a2a',
        padding: { x: 24, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    resumeBtn.on('pointerup', () => this.closePauseMenu());

    const audioBtn = this.add
      .text(width / 2, height / 2, '[ AUDIO SETTINGS ]', {
        fontFamily: FONT,
        fontSize: '22px',
        color: '#8acfff',
        backgroundColor: '#2a3440',
        padding: { x: 20, y: 8 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    audioBtn.on('pointerup', () => this.buildPauseMenuAudio());

    const quitBtn = this.add
      .text(width / 2, height / 2 + 70, '[ ABANDON RUN ]', {
        fontFamily: FONT,
        fontSize: '22px',
        color: '#ff8a8a',
        backgroundColor: '#3a2a2a',
        padding: { x: 20, y: 8 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    quitBtn.on('pointerup', () => {
      this.closePauseMenu();
      this.abortRun();
    });

    container.add([bg, resumeBtn, audioBtn, quitBtn]);
    this.pauseMenuContainer = container;
  }

  private buildPauseMenuAudio(): void {
    this.pauseMenuContainer?.destroy();
    const { width, height } = this.scale;
    const container = this.add.container(0, 0).setDepth(200000);
    const bg = this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.75)
      .setOrigin(0.5)
      .setInteractive();
    container.add(bg);

    // Shared master / music / sfx sliders (same panel as the non-combat pause
    // menu — keeps audio UX consistent across the game).
    buildAudioSettingsPanel(this, container, width / 2, height / 2 - 20);

    const backBtn = this.add
      .text(width / 2, height / 2 + 180, '[ BACK ]', {
        fontFamily: FONT,
        fontSize: '22px',
        color: '#8aff8a',
        backgroundColor: '#2a3a2a',
        padding: { x: 20, y: 8 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    backBtn.on('pointerup', () => this.buildPauseMenuMain());

    container.add(backBtn);
    this.pauseMenuContainer = container;
  }

  private closePauseMenu(): void {
    this.pauseMenuContainer?.destroy();
    this.pauseMenuContainer = undefined;
    this.pauseMenuOpen = false;
    this.waitMode = this.savedWaitModeForPause;
  }

  private saveStateToRun(): void {
    const run = getRun();
    for (const u of this.units.filter((u) => u.side === 'party')) {
      run.partyHp[u.id] = u.ko ? 1 : u.hp;
      if (u.maxMp > 0) run.partyMp[u.id] = u.mp;
    }
    const escort = this.units.find((u) => u.side === 'escort');
    if (escort) run.escortHp = escort.hp;
  }
}
