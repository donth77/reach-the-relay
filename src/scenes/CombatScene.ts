import * as Phaser from 'phaser';
import {
  CLASSES,
  type AbilityDef,
  type ClassDef,
  type Element,
} from '../data/classes';
import { ENEMIES, VULNERABILITY_GLYPH, type EnemyDef } from '../data/enemies';
import { ITEMS, ITEM_ORDER, type ItemDef } from '../data/items';
import { getRun, hasRun, ESCORT_MAX_HP } from '../state/run';
import type { BackgroundVariant } from '../data/routes';
import { log, copyLogToClipboard } from '../util/logger';

const FONT = 'Silkscreen, monospace';
const ATB_MAX = 100;
const ATB_RATE = 7;

const PANEL_HEIGHT = 200;
const PANEL_MARGIN = 10;
const PANEL_TOP = 720 - PANEL_HEIGHT;
const PANEL_BG = 0x101828;
const PANEL_BORDER = 0x6a7fad;

// Depth tiers — each sprite gets a base + its Y so sprites with higher Y
// (lower on screen, closer to camera) render on top of sprites with lower Y.
const DEPTH_ENEMY_BASE = 5000;
const DEPTH_ENEMY_ACTIVE_BASE = 7500; // enemy during its attack sequence: above other enemies
const DEPTH_PARTY_BASE = 10000;
const DEPTH_WALK_FORWARD_BASE = 50000; // above everything during walk-forward + attack

const DIMMED_OTHER_ALPHA = 0.3;
const DIMMED_PEER_ENEMY_ALPHA = 0.35;

type Side = 'party' | 'enemy' | 'escort';

interface Unit {
  id: string;
  name: string;
  side: Side;
  classDef?: ClassDef;
  enemyDef?: EnemyDef;
  spriteKey: string;
  scale: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  atb: number;
  ko: boolean;
  guarding: boolean;
  sleeping: boolean;
  tauntedBy: string | null;
  atbModifier: number;
  atbModifierTurnsLeft: number;
  shielded: boolean;
  missing: boolean;
  posX: number;
  posY: number;
  sprite?: Phaser.GameObjects.Sprite;
  idleTween?: Phaser.Tweens.Tween;
  shadow?: Phaser.GameObjects.Ellipse;
  nameText?: Phaser.GameObjects.Text;
  enemyHpBarBg?: Phaser.GameObjects.Rectangle;
  enemyHpBar?: Phaser.GameObjects.Rectangle;
  vulnerabilityIcon?: Phaser.GameObjects.Text;
  statusIcon?: Phaser.GameObjects.Text;
  panelRow?: {
    container: Phaser.GameObjects.Container;
    nameText: Phaser.GameObjects.Text;
    hpText: Phaser.GameObjects.Text;
    hpBar: Phaser.GameObjects.Rectangle;
    mpText?: Phaser.GameObjects.Text;
    atbBar?: Phaser.GameObjects.Rectangle;
    activeMarker: Phaser.GameObjects.Text;
  };
}

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
  // Per-combat ability use tracking: key = `${unitId}:${abilityId}` → uses remaining.
  private abilityUsesRemaining = new Map<string, number>();
  private activeBgVariant: BackgroundVariant = { key: '' };

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
      this.scene.start('Lobby');
      return;
    }

    const { width, height } = this.scale;
    const run = getRun();
    this.cameras.main.setBackgroundColor('#1a2619');

    const variants = run.route.backgroundVariants ?? [run.route.backgroundKey];
    const picked = variants[Math.floor(Math.random() * variants.length)];
    const bgVariant = typeof picked === 'string' ? { key: picked } : (picked ?? { key: run.route.backgroundKey });
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
      const currentKey = this.registry.get('currentRouteMusic') as string | undefined;
      const alreadyPlaying =
        currentKey && musicKeys.includes(currentKey) && this.sound.get(currentKey)?.isPlaying;
      if (!alreadyPlaying) {
        // Stop ANY music-* sound currently playing (covers title theme from Lobby
        // as well as any stale route music not tracked in the registry).
        for (const s of this.sound.getAllPlaying()) {
          if (s.key?.startsWith('music-')) s.stop();
        }
        const pick = musicKeys[Math.floor(Math.random() * musicKeys.length)];
        const musicVolume = bossMusicKey ? 0.2 : 0.13;
        this.sound.play(pick, { loop: true, volume: musicVolume });
        this.registry.set('currentRouteMusic', pick);
      }
    }

    // Register animations before sprite creation so idle anims can play immediately.
    this.registerAnimations();

    this.buildUnits();
    // Initialize per-combat ability use counters from each unit's class abilities.
    this.abilityUsesRemaining.clear();
    for (const u of this.units) {
      if (!u.classDef) continue;
      for (const ab of u.classDef.abilities) {
        if (ab.maxUsesPerCombat !== undefined) {
          this.abilityUsesRemaining.set(`${u.id}:${ab.id}`, ab.maxUsesPerCombat);
        }
      }
    }
    for (const u of this.units) this.createBattleSprite(u);

    this.drawBottomPanel();

    this.add
      .text(
        width / 2,
        30,
        `${run.route.name}  —  Encounter ${run.encounterIndex + 1} / ${run.route.encounters.length}`,
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
    this.input.keyboard?.on('keydown-D', () => this.toggleDevOverlay());
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
      scavenger: 6,
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
        const frames = Array.from({ length: 4 }, (_, i) => ({
          key: `${key}-walk-west-${i.toString().padStart(3, '0')}`,
        }));
        this.anims.create({ key: walkKey, frames, frameRate: 8, repeat: -1 });
      }
      const deathKey = `${key}-death-west`;
      if (!this.anims.exists(deathKey)) {
        const frames = Array.from({ length: 7 }, (_, i) => ({
          key: `${key}-death-west-${i.toString().padStart(3, '0')}`,
        }));
        this.anims.create({ key: deathKey, frames, frameRate: 10, repeat: 0 });
      }
    }

    // Medic cast animation (non-damage ability animations)
    if (!this.anims.exists('medic-cast-west')) {
      const frames = Array.from({ length: 4 }, (_, i) => ({
        key: `medic-cast-west-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'medic-cast-west', frames, frameRate: 8, repeat: 0 });
    }

    // Dr. Vey escort death animation (she faces west like party)
    if (!this.anims.exists('drvey-death-west')) {
      const frames = Array.from({ length: 7 }, (_, i) => ({
        key: `drvey-death-west-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'drvey-death-west', frames, frameRate: 10, repeat: 0 });
    }

    // Wirehead (enemy) — walk + attack + death (east direction)
    if (!this.anims.exists('wirehead-walk-east')) {
      const frames = Array.from({ length: 4 }, (_, i) => ({
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

    // Wreckling (enemy) — walk + attack + death (east direction)
    if (!this.anims.exists('wreckling-walk-east')) {
      const frames = Array.from({ length: 6 }, (_, i) => ({
        key: `wreckling-walk-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'wreckling-walk-east', frames, frameRate: 8, repeat: -1 });
    }
    if (!this.anims.exists('wreckling-attack-east')) {
      const frames = Array.from({ length: 4 }, (_, i) => ({
        key: `wreckling-attack-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'wreckling-attack-east', frames, frameRate: 7, repeat: 0 });
    }
    if (!this.anims.exists('wreckling-death-east')) {
      const frames = Array.from({ length: 4 }, (_, i) => ({
        key: `wreckling-death-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'wreckling-death-east', frames, frameRate: 7, repeat: 0 });
    }
    if (!this.anims.exists('wreckling-idle-east')) {
      const frames = Array.from({ length: 8 }, (_, i) => ({
        key: `wreckling-idle-east-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key: 'wreckling-idle-east', frames, frameRate: 6, repeat: -1 });
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
  }

  private getUnitFacing(u: Unit): 'west' | 'east' {
    return u.side === 'enemy' ? 'east' : 'west';
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
    if (this.combatOver || this.waitMode) return;
    const dt = delta / 1000;
    for (const u of this.units) {
      if (u.ko || u.side === 'escort') continue;
      if (u.sleeping) continue;
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
    const enemyX = width * 0.30; // moved closer to the party
    // Party and enemies use different vertical centers — tune each independently.
    const currentEncounter = run.route.encounters[run.encounterIndex];
    const partyCentreY =
      arenaHeight * 0.62 +
      40 +
      (run.route.partyYOffset ?? 0) +
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
      name: def.name,
      side,
      classDef: def,
      spriteKey: def.spriteKey,
      scale: 2.5,
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
      | 'sleeping'
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
      sleeping: false,
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
    const nativeCanvasSize = tempSprite.height; // 68 for humanoids, 136 for wreckling
    tempSprite.destroy();

    // Per-sprite character bbox within its native canvas (from PIL analysis).
    // Used to (a) center the visible character at (posX, posY) via setOrigin and
    // (b) position shadow/HP bar relative to the character, not the canvas.
    const BBOX: Record<number, { centerX: number; centerY: number; feetY: number; headY: number }> = {
      64: { centerX: 32, centerY: 32, feetY: 56, headY: 6 },
      68: { centerX: 34, centerY: 33, feetY: 57, headY: 9 },
      80: { centerX: 40, centerY: 40, feetY: 74, headY: 6 },
      82: { centerX: 41, centerY: 57, feetY: 82, headY: 32 },
      84: { centerX: 42, centerY: 48, feetY: 84, headY: 12 },
      92: { centerX: 46, centerY: 46, feetY: 88, headY: 4 },
      136: { centerX: 62.5, centerY: 77.5, feetY: 133, headY: 22 },
    };
    const bbox = BBOX[nativeCanvasSize] ?? BBOX[68];
    const originX = bbox.centerX / nativeCanvasSize;
    const originY = bbox.centerY / nativeCanvasSize;
    // Distance (display px) from the origin point to the feet / head top.
    const feetDistBelowOrigin = (bbox.feetY - bbox.centerY) * u.scale;
    const headDistAboveOrigin = (bbox.centerY - bbox.headY) * u.scale;
    const shadowY = u.posY + feetDistBelowOrigin + 4 + (isFloaty ? 25 : 0);
    // Characters only occupy ~30-40% of the 68px canvas width — size the shadow
    // to the actual character bbox rather than the full sprite display width.
    const shadowWidth = spriteWidth * (isFloaty ? 0.28 : 0.32);
    const shadowHeight = shadowWidth * 0.32;
    u.shadow = this.add
      .ellipse(u.posX, shadowY, shadowWidth, shadowHeight, 0x000000, isFloaty ? 0.12 : 0.18);

    u.sprite = this.add.sprite(u.posX, u.posY, u.spriteKey).setScale(u.scale).setOrigin(originX, originY);
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
    if (u.sleeping) parts.push('z');
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
      .rectangle(width / 2, PANEL_TOP + PANEL_HEIGHT / 2, width - 20, PANEL_HEIGHT - 10, PANEL_BG, 0.95)
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
    const HP_BAR_WIDTH = 60;
    const COL_MP_TEXT_RIGHT = 420;
    const COL_ATB_BAR = 440;
    const ATB_BAR_WIDTH = 130;

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

      this.add
        .rectangle(COL_HP_BAR, 0, HP_BAR_WIDTH, 10, 0x222222)
        .setOrigin(0, 0.5);
      const hpBar = this.add
        .rectangle(COL_HP_BAR, 0, HP_BAR_WIDTH, 10, 0xff5555)
        .setOrigin(0, 0.5);

      let mpText: Phaser.GameObjects.Text | undefined;
      let atbBar: Phaser.GameObjects.Rectangle | undefined;

      if (u.side !== 'escort') {
        this.add
          .rectangle(COL_ATB_BAR, 0, ATB_BAR_WIDTH, 8, 0x222222)
          .setOrigin(0, 0.5);
        atbBar = this.add
          .rectangle(COL_ATB_BAR, 0, 0, 8, 0xffdd55)
          .setOrigin(0, 0.5);

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
    row.hpBar.width = (u.hp / u.maxHp) * 60;

    if (row.atbBar) {
      row.atbBar.width = (u.atb / ATB_MAX) * 130;
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
    this.sound.play('sfx-atb-ready', { volume: 0.4 });
    this.activeUnitId = u.id;
    for (const other of this.units) this.updatePanelRow(other);
    this.showMessage(`${u.name}'s turn`);
    this.showActionMenu(u);
  }

  private showActionMenu(u: Unit): void {
    const { width } = this.scale;
    const leftWidth = width * 0.5;
    this.actionMenuContainer?.destroy();
    this.actionMenuContainer = this.add.container(0, 0);

    const abilities = u.classDef?.abilities ?? [];
    const cols = 2;
    const btnWidth = (leftWidth - 60) / cols;
    const btnHeight = abilities.length > 4 ? 38 : 50;
    const btnGap = 8;
    const startX = 30;
    const startY = PANEL_TOP + 45;

    abilities.forEach((ability, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * (btnWidth + 10) + btnWidth / 2;
      const y = startY + row * (btnHeight + btnGap) + btnHeight / 2;

      const usesRemaining =
        ability.maxUsesPerCombat !== undefined
          ? (this.abilityUsesRemaining.get(`${u.id}:${ability.id}`) ?? 0)
          : null;
      const hasUses = usesRemaining === null || usesRemaining > 0;
      const canAfford = u.mp >= ability.mpCost && hasUses;
      const bg = this.add
        .rectangle(x, y, btnWidth, btnHeight, 0x1a2a3a, 0.9)
        .setStrokeStyle(2, canAfford ? 0x88ff88 : 0x444444);
      let label = ability.label;
      if (ability.mpCost > 0) label += `  (${ability.mpCost})`;
      if (usesRemaining !== null) label += `  [${usesRemaining}/${ability.maxUsesPerCombat}]`;
      const txt = this.add
        .text(x, y, label, {
          fontFamily: FONT,
          fontSize: btnHeight > 45 ? '20px' : '17px',
          color: canAfford ? '#8aff8a' : '#555555',
          align: 'center',
        })
        .setOrigin(0.5);

      if (canAfford) {
        bg.setInteractive({ useHandCursor: true }).once('pointerup', () => {
          this.sound.play('sfx-menu-confirm', { volume: 0.5 });
          this.chooseTarget(u, ability);
        });
      }

      this.actionMenuContainer!.add([bg, txt]);
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

    const targets = this.validTargets(ability);
    if (targets.length === 0) {
      this.waitMode = false;
      return;
    }

    this.targetSelectActive = true;
    this.setEnemyIdlesPaused(true);
    const prompt =
      ability.target === 'enemy'
        ? `${attacker.name} → select an enemy`
        : `${attacker.name} → select an ally`;
    this.showMessage(prompt);
    this.showCancelButton(() => this.handleEscapeKey());

    const highlightColor = ability.target === 'enemy' ? 0xffaaaa : 0xaaffaa;
    const commitTarget = (t: Unit) => {
      this.sound.play('sfx-menu-confirm', { volume: 0.5 });
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

    const btnWidth = leftWidth - 60;
    const btnHeight = targets.length > 4 ? 30 : 40;
    const btnGap = 6;
    const startX = 30;
    const startY = PANEL_TOP + 45;

    const hexColor = '#' + highlightColor.toString(16).padStart(6, '0');
    let selectedIdx = 0;
    const rows: { chevron: Phaser.GameObjects.Text }[] = [];

    targets.forEach((t, i) => {
      const y = startY + i * (btnHeight + btnGap) + btnHeight / 2;
      const cx = startX + btnWidth / 2;
      const bg = this.add
        .rectangle(cx, y, btnWidth, btnHeight, 0x1a2a3a, 0.9)
        .setStrokeStyle(2, highlightColor);
      const chevron = this.add
        .text(startX + 8, y, '►', {
          fontFamily: FONT,
          fontSize: '18px',
          color: hexColor,
        })
        .setOrigin(0, 0.5)
        .setVisible(false);
      const hpPct = t.maxHp > 0 ? Math.max(0, Math.round((t.hp / t.maxHp) * 100)) : 0;
      const label = t.side === 'enemy' ? `${t.name}  ${hpPct}%` : t.name;
      const txt = this.add
        .text(startX + 30, y, label, {
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

    const onUp = () => {
      selectedIdx = (selectedIdx - 1 + targets.length) % targets.length;
      updateSelection();
    };
    const onDown = () => {
      selectedIdx = (selectedIdx + 1) % targets.length;
      updateSelection();
    };
    const onEnter = () => {
      const t = targets[selectedIdx];
      if (t) onSelect(t);
    };
    this.input.keyboard?.on('keydown-UP', onUp);
    this.input.keyboard?.on('keydown-DOWN', onDown);
    this.input.keyboard?.on('keydown-ENTER', onEnter);
    this.input.keyboard?.on('keydown-SPACE', onEnter);

    this.targetMenuCleanup = () => {
      this.input.keyboard?.off('keydown-UP', onUp);
      this.input.keyboard?.off('keydown-DOWN', onDown);
      this.input.keyboard?.off('keydown-ENTER', onEnter);
      this.input.keyboard?.off('keydown-SPACE', onEnter);
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

  private validTargets(ability: AbilityDef): Unit[] {
    switch (ability.target) {
      case 'enemy':
        return this.units.filter((u) => u.side === 'enemy' && !u.ko);
      case 'ally-or-escort':
        return this.units.filter(
          (u) => (u.side === 'party' || u.side === 'escort') && !u.ko,
        );
      default:
        return [];
    }
  }

  private showItemMenu(attacker: Unit): void {
    const { width } = this.scale;
    const run = getRun();
    const leftWidth = width * 0.5;

    this.itemMenuOpen = true;
    this.actionMenuContainer?.destroy();
    this.actionMenuContainer = this.add.container(0, 0);

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

    ITEM_ORDER.forEach((key, i) => {
      const item = ITEMS[key];
      const count = run.inventory[key] ?? 0;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * (btnWidth + 10) + btnWidth / 2;
      const y = startY + row * (btnHeight + btnGap) + btnHeight / 2;

      const canUse = count > 0;
      const bg = this.add
        .rectangle(x, y, btnWidth, btnHeight, 0x1a2a3a, 0.9)
        .setStrokeStyle(2, canUse ? 0x88ff88 : 0x444444);
      const txt = this.add
        .text(x, y, `${item.label} × ${count}`, {
          fontFamily: FONT,
          fontSize: '16px',
          color: canUse ? '#8aff8a' : '#555555',
        })
        .setOrigin(0.5);

      if (canUse) {
        bg.setInteractive({ useHandCursor: true }).once('pointerup', () => {
          this.sound.play('sfx-menu-confirm', { volume: 0.5 });
          this.chooseItemTarget(attacker, item);
        });
      }
      this.actionMenuContainer!.add([bg, txt]);
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
      this.sound.play('sfx-menu-cancel', { volume: 0.5 });
      this.itemMenuOpen = false;
      this.showActionMenu(attacker);
    });
    this.actionMenuContainer.add([backBg, backTxt]);
  }

  private chooseItemTarget(attacker: Unit, item: ItemDef): void {
    this.itemMenuOpen = false;
    this.actionMenuContainer?.destroy();
    this.actionMenuContainer = undefined;

    const targets = this.validItemTargets(item);

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
        this.sound.play('sfx-menu-confirm', { volume: 0.5 });
        this.itemTargetSelectActive = false;
        this.hideCancelButton();
        this.clearTargetSelect();
        this.executeItem(attacker, t, item);
      });
    }
  }

  private validItemTargets(item: ItemDef): Unit[] {
    switch (item.target) {
      case 'ally-or-escort':
        return this.units.filter(
          (u) => (u.side === 'party' || u.side === 'escort') && !u.ko,
        );
      case 'ko-ally':
        return this.units.filter((u) => u.side === 'party' && u.ko);
      case 'caster':
        return this.units.filter((u) => u.side === 'party' && !u.ko && u.maxMp > 0);
      case 'all-enemies':
        return [];
    }
  }

  private executeItem(attacker: Unit, target: Unit | null, item: ItemDef): void {
    const run = getRun();
    run.inventory[item.id] = Math.max(0, (run.inventory[item.id] ?? 0) - 1);

    this.sound.play('sfx-item-use', { volume: 0.5 });

    switch (item.effect) {
      case 'heal': {
        if (!target) break;
        const heal = Math.round(item.power ?? 20);
        target.hp = Math.min(target.maxHp, target.hp + heal);
        this.spawnFloatNumber(target, `+${heal}`, '#88ff88');
        this.showMessage(`${attacker.name} uses ${item.label} on ${target.name} (+${heal})`);
        break;
      }
      case 'restore-mp': {
        if (!target) break;
        const restore = Math.round(item.power ?? 10);
        target.mp = Math.min(target.maxMp, target.mp + restore);
        this.spawnFloatNumber(target, `+${restore} MP`, '#88aaff');
        this.showMessage(`${attacker.name} uses ${item.label} on ${target.name} (+${restore} MP)`);
        break;
      }
      case 'revive': {
        if (!target) break;
        const hp = Math.max(1, Math.round(target.maxHp * (item.power ?? 0.25)));
        target.hp = hp;
        target.ko = false;
        this.resetSpriteForRevive(target);
        this.spawnFloatNumber(target, `REVIVE`, '#ffdd55');
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
  }

  private executeAbility(attacker: Unit, target: Unit, ability: AbilityDef): void {
    log('ACTION', `${attacker.id} -> ${ability.id}`, {
      effect: ability.effect,
      target: target.id,
      mpCost: ability.mpCost,
      power: ability.power,
    });
    attacker.mp = Math.max(0, attacker.mp - ability.mpCost);

    // Decrement per-combat use counter if this ability has a limit.
    if (ability.maxUsesPerCombat !== undefined) {
      const key = `${attacker.id}:${ability.id}`;
      const left = this.abilityUsesRemaining.get(key) ?? 0;
      this.abilityUsesRemaining.set(key, Math.max(0, left - 1));
    }

    switch (ability.effect) {
      case 'damage': {
        const baseDamage = this.calculateDamage(attacker, target, ability.power ?? 1, ability.element);
        const crit = Math.random() < 0.15;
        const damage = crit ? Math.round(baseDamage * 2) : baseDamage;
        const animKey = `${attacker.id}-attack-west`;
        const hasAnim = this.anims.exists(animKey) && attacker.side === 'party';
        const isMagic = ability.mpCost > 0;

        const applyImpact = () => {
          const sfxKey = ability.sfxKey ?? (isMagic ? 'sfx-spell-cast' : 'sfx-attack-melee');
          this.sound.play(sfxKey, { volume: 1 });
          if (crit) this.sound.play('sfx-critical-hit', { volume: 1 });
          this.applyDamage(target, damage, crit, ability.element);
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
        this.sound.play(ability.sfxKey ?? 'sfx-heal-shimmer', { volume: ability.sfxKey ? 1 : 0.5 });
        this.playCastTween(attacker);
        const heal = Math.round(ability.power ?? 20);
        target.hp = Math.min(target.maxHp, target.hp + heal);
        this.spawnFloatNumber(target, `+${heal}`, '#88ff88');
        this.showMessage(`${attacker.name} ${ability.label}s ${target.name} for ${heal}`);
        break;
      }
      case 'guard': {
        this.sound.play(ability.sfxKey ?? 'sfx-guard-raise', { volume: ability.sfxKey ? 1 : 0.5 });
        this.playCastTween(attacker);
        attacker.guarding = true;
        this.showMessage(`${attacker.name} raises their shield — GUARD`);
        break;
      }
      case 'salvage': {
        const baseDamage = this.calculateDamage(attacker, target, ability.power ?? 1);
        const crit = Math.random() < 0.2;
        const finalDamage = crit ? baseDamage * 2 : baseDamage;
        const animKey = `${attacker.id}-attack-${this.getUnitFacing(attacker)}`;
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
          this.sound.play(ability.sfxKey ?? 'sfx-attack-melee', { volume: 1 });
          if (crit) this.sound.play('sfx-critical-hit', { volume: 1 });
          this.applyDamage(target, finalDamage, crit);
          if (lootedItemId) {
            const run = getRun();
            run.inventory[lootedItemId] = (run.inventory[lootedItemId] ?? 0) + 1;
            const lootLabel = ITEMS[lootedItemId]?.label ?? lootedItemId;
            this.spawnFloatNumber(target, `+1 ${lootLabel}`, '#88ddff');
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
        this.sound.play(ability.sfxKey ?? 'sfx-spell-cast', { volume: ability.sfxKey ? 1 : 0.5 });
        this.playCastTween(attacker);
        const base = this.calculateDamage(attacker, target, ability.power ?? 1);
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
        this.applyDamage(target, finalDamage, false, ability.element);
        break;
      }
      case 'slow': {
        const slowAnimKey = `${attacker.id}-attack-west`;
        const hasSlowAnim = this.anims.exists(slowAnimKey) && attacker.side === 'party';
        const applySlowImpact = () => {
          this.sound.play(ability.sfxKey ?? 'sfx-spell-cast', { volume: ability.sfxKey ? 1 : 0.5 });
          const damage = this.calculateDamage(attacker, target, ability.power ?? 0.6, ability.element);
          this.applyDamage(target, damage, false, ability.element);
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
      case 'sleep': {
        this.sound.play(ability.sfxKey ?? 'sfx-status-apply', { volume: ability.sfxKey ? 1 : 0.5 });
        this.playCastTween(attacker);
        target.sleeping = true;
        target.atb = 0;
        this.updateStatusIcon(target);
        this.spawnFloatNumber(target, 'z z z', '#88ccff');
        this.showMessage(`${target.name} forced into STANDBY`);
        break;
      }
      case 'boost': {
        this.sound.play(ability.sfxKey ?? 'sfx-status-apply', { volume: ability.sfxKey ? 1 : 0.5 });
        this.playCastTween(attacker);
        target.atbModifier = 2;
        target.atbModifierTurnsLeft = 1;
        this.updateStatusIcon(target);
        this.spawnFloatNumber(target, 'STIM', '#ffdd88');
        this.showMessage(`${attacker.name} STIMs ${target.name} — ATB doubled`);
        break;
      }
      case 'shield-buff': {
        this.sound.play(ability.sfxKey ?? 'sfx-status-apply', { volume: ability.sfxKey ? 1 : 0.5 });
        this.playCastTween(attacker);
        target.shielded = true;
        this.updateStatusIcon(target);
        this.spawnFloatNumber(target, 'SHIELD', '#88ccff');
        this.showMessage(`${attacker.name} SHIELDs ${target.name}`);
        break;
      }
      case 'taunt': {
        this.sound.play(ability.sfxKey ?? 'sfx-status-apply', { volume: ability.sfxKey ? 1 : 0.5 });
        this.playCastTween(attacker);
        target.tauntedBy = attacker.id;
        this.updateStatusIcon(target);
        this.spawnFloatNumber(target, 'TAUNT', '#ff9955');
        this.showMessage(`${attacker.name} TAUNTs ${target.name} — it's forced to attack them`);
        break;
      }
      case 'flurry': {
        // Stagger the 3 hits so damage numbers land sequentially (not in a single
        // frame) and the enemy's death fade doesn't cut off the animation.
        this.sound.play(ability.sfxKey ?? 'sfx-attack-melee', { volume: 1 });
        this.playAttackTween(attacker, target);
        const hits = 3;
        const perHitPower = ability.power ?? 0.5;
        const interHitDelay = 250;
        const startDelay = 150;
        let totalDamage = 0;
        let hitsLanded = 0;
        const fireHit = (i: number) => {
          if (target.ko) return;
          const dmg = this.calculateDamage(attacker, target, perHitPower);
          this.applyDamage(target, dmg);
          totalDamage += dmg;
          hitsLanded++;
          if (i < hits - 1) {
            this.time.delayedCall(interHitDelay, () => fireHit(i + 1));
          } else {
            this.showMessage(`${attacker.name} FLURRY — ${hitsLanded} hits for ${totalDamage}`);
          }
        };
        this.time.delayedCall(startDelay, () => fireHit(0));

        // Finalize after the full hit sequence instead of the default 400ms.
        attacker.atb = 0;
        this.activeUnitId = null;
        for (const uu of this.units) this.updatePanelRow(uu);
        const totalDuration = startDelay + hits * interHitDelay + 300;
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

  private applyDamage(target: Unit, damage: number, crit = false, element?: Element): void {
    let finalDamage = damage;
    if (target.shielded) {
      finalDamage = Math.max(1, Math.floor(finalDamage / 2));
    }
    target.hp = Math.max(0, target.hp - finalDamage);
    this.spawnDamageNumber(target, finalDamage, crit, element);
    this.flashSprite(target);

    if (target.side !== 'enemy' && finalDamage > 0) {
      this.sound.play('sfx-damage-taken', { volume: 0.5 });
    }

    // Hit reaction: shake tween (frame-based hit animations reverted — they didn't look clean)
    if (!target.ko) this.playHitShake(target);

    if (target.sleeping) {
      target.sleeping = false;
      this.updateStatusIcon(target);
    }
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
        this.sound.play('sfx-enemy-death', { volume: 0.5 });
      } else {
        this.sound.play('sfx-party-ko', { volume: 0.5 });
      }
      // KO'd party: slightly faded (so they're visibly still there for revive targeting).
      // KO'd enemy: fade to 0 entirely — dead enemies are removed from the scene.
      // (When we add revivable enemies later, give them a partial alpha like party.)
      const koAlpha = target.side === 'enemy' ? 0 : 0.7;
      const facing = this.getUnitFacing(target);
      const deathAnimKey = `${target.id}-death-${facing}`;
      const downedKey = `${target.id}-downed`;
      if (target.sprite && this.anims.exists(deathAnimKey)) {
        target.shadow?.setAlpha(0);
        target.sprite.play(deathAnimKey);
        target.sprite.once('animationcomplete', () => {
          if (!target.sprite) return;
          if (this.textures.exists(downedKey)) {
            target.sprite.setTexture(downedKey);
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
    log('TURN', 'enemy turn begin', { unit: enemy.id, behavior: enemy.enemyDef?.behavior, hp: enemy.hp });
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
    const living = this.units.filter(
      (u) => (u.side === 'party' || u.side === 'escort') && !u.ko,
    );
    if (living.length === 0) {
      this.waitMode = false;
      return;
    }

    if (enemy.atbModifierTurnsLeft > 0) {
      enemy.atbModifierTurnsLeft--;
      if (enemy.atbModifierTurnsLeft === 0) enemy.atbModifier = 1;
    }

    const behavior = enemy.enemyDef?.behavior ?? 'random';

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
            this.spawnFloatNumber(enemy, 'MISS', '#aaaaaa');
            this.showMessage(`${enemy.name} is blinded by smoke!`);
            return;
          }
          this.playCastTween(enemy);
          this.showMessage(`${enemy.name} swarms the party!`);
          const targets = this.units.filter(
            (u) => (u.side === 'party' || u.side === 'escort') && !u.ko,
          );
          for (const t of targets) {
            const damage = Math.max(1, this.calculateDamage(enemy, t, 0.7));
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
    } else {
      target = living[Math.floor(Math.random() * living.length)];
    }

    const ignoreGuard = behavior === 'ignore-guard';
    const guardian = this.units.find((u) => u.side === 'party' && u.guarding && !u.ko);
    const redirected = !ignoreGuard && guardian && target !== guardian;

    this.showMessage(`${enemy.name} attacks ${target.name}!`);

    const facing = this.getUnitFacing(enemy);
    const attackAnimKey = `${enemy.id}-attack-${facing}`;
    const hasAnim = this.anims.exists(attackAnimKey);

    const resolveImpact = () => {
      if (enemy.missing) {
        enemy.missing = false;
        this.updateStatusIcon(enemy);
        this.spawnFloatNumber(enemy, 'MISS', '#aaaaaa');
        this.showMessage(`${enemy.name} is blinded by smoke!`);
        return;
      }
      // Enemy-specific attack SFX (or fallback to the punchy shared enemy melee)
      const enemyAttackSfx = enemy.enemyDef?.attackSfxKey ?? 'sfx-enemy-attack';
      this.sound.play(enemyAttackSfx, { volume: 1 });
      let damage = this.calculateDamage(enemy, target, 1);
      if (redirected && guardian) {
        this.showMessage(`${guardian.name} intercepts!`);
        target = guardian;
        damage = Math.max(1, Math.floor(damage / 2));
      } else if (!ignoreGuard && target.guarding) {
        damage = Math.max(1, Math.floor(damage / 2));
      }
      this.applyDamage(target, damage);
    };

    const finalize = () => {
      enemy.atb = 0;
      this.waitMode = false;
      this.checkEndConditions();
    };

    if (hasAnim) {
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

  private calculateDamage(
    attacker: Unit,
    target: Unit,
    power: number,
    element?: Element,
  ): number {
    const base = Math.max(1, attacker.attack * power - target.defense);
    const variance = Math.floor(Math.random() * 5) - 2;
    let damage = Math.max(1, Math.round(base + variance));
    if (element && target.enemyDef?.vulnerability === element) {
      damage = Math.round(damage * 1.5);
    }
    return damage;
  }

  private spawnDamageNumber(u: Unit, damage: number, crit = false, element?: Element): void {
    const glyph = element ? VULNERABILITY_GLYPH[element] : '';
    const suffix = glyph ? ` ${glyph}` : '';
    if (crit) {
      this.spawnFloatNumber(u, `${damage}!${suffix}`, '#ff5533', { fontSize: '48px', stroke: '#4a0000', strokeThickness: 6 });
    } else {
      this.spawnFloatNumber(u, `${damage}${suffix}`, '#ffdd55');
    }
  }

  private spawnFloatNumber(
    u: Unit,
    text: string,
    color: string,
    opts?: { fontSize?: string; stroke?: string; strokeThickness?: number },
  ): void {
    if (!u.sprite) return;
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: FONT,
      fontSize: opts?.fontSize ?? '32px',
      color,
      stroke: opts?.stroke ?? '#000000',
      strokeThickness: opts?.strokeThickness ?? 4,
    };
    const num = this.add
      .text(u.sprite.x, u.sprite.y - 60, text, style)
      .setOrigin(0.5)
      .setDepth(100000); // always on top of every sprite, even walk-forward
    this.tweens.add({
      targets: num,
      y: num.y - 50,
      alpha: 0,
      duration: 800,
      onComplete: () => num.destroy(),
    });
  }

  private flashSprite(u: Unit): void {
    if (!u.sprite) return;
    u.sprite.setTint(0xff4444);
    this.time.delayedCall(140, () => u.sprite?.clearTint());
  }

  private playAttackTween(u: Unit, target: Unit): void {
    if (!u.sprite) return;

    const facing = this.getUnitFacing(u);
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

  private playFullAttackSequence(
    u: Unit,
    target: Unit,
    animKey: string,
    onImpact?: () => void,
    onComplete?: () => void,
  ): void {
    if (!u.sprite) return;
    const sprite = u.sprite;
    const attackerHalfW = sprite.displayWidth * 0.5;
    const targetHalfW = (target.sprite?.displayWidth ?? 100) * 0.5;
    const gap = 20;

    // Position attacker just in front of the target on their own side
    const facingDir = target.posX < u.posX ? -1 : 1;
    let forwardX = target.posX - facingDir * (attackerHalfW + targetHalfW + gap);
    let forwardY = target.posY;

    // (Enemies attacking the escort walk directly to her — no clamp. Party
    // members in the visual path are dimmed during the walk, see below.)

    // FF6-style: party attacking an enemy stops at the enemy formation's front
    // edge (largest-X enemy) rather than walking through front-line enemies to
    // reach a back-line target.
    if (u.side === 'party' && target.side === 'enemy') {
      const livingEnemies = this.units.filter(
        (e) => e.side === 'enemy' && !e.ko,
      );
      if (livingEnemies.length > 0) {
        const frontLine = livingEnemies.reduce((acc, e) =>
          e.posX > acc.posX ? e : acc,
        );
        if (frontLine !== target) {
          const frontHalfW = (frontLine.sprite?.displayWidth ?? 120) * 0.5;
          forwardX =
            frontLine.posX - facingDir * (attackerHalfW + frontHalfW * 0.3 + 4);
        }
      }
    }


    // Distance-based walk duration so long walks take longer than short ones
    const distance = Phaser.Math.Distance.Between(u.posX, u.posY, forwardX, forwardY);
    const walkSpeed = 0.55; // pixels per ms
    const walkDuration = Math.max(350, distance / walkSpeed);

    const walkAnimKey = `${u.id}-walk-${this.getUnitFacing(u)}`;
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
    const walkBackBase =
      u.side === 'enemy' ? DEPTH_ENEMY_ACTIVE_BASE : DEPTH_PARTY_BASE;
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
        sprite.play(animKey);
        const impactDelay = 300;
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
    const idleKey = `${u.id}-idle-${this.getUnitFacing(u)}`;
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

  private playHitShake(u: Unit): void {
    if (!u.sprite) return;
    const baseX = u.posX;
    this.tweens.add({
      targets: u.sprite,
      x: { from: baseX + 5, to: baseX - 5 },
      duration: 55,
      yoyo: true,
      repeat: 2,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        if (u.sprite) u.sprite.x = baseX;
      },
    });
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

    this.sound.play('sfx-victory-jingle', { volume: 0.5 });
    this.showMessage('VICTORY');

    this.time.delayedCall(1200, () => {
      const nextIndex = run.encounterIndex + 1;
      if (nextIndex >= run.route.encounters.length) {
        log('SCENE', 'run complete (victory), transitioning to RunComplete');
        this.scene.start('RunComplete', { outcome: 'victory' });
        return;
      }
      const wasLastIndex = run.encounterIndex;
      run.encounterIndex = nextIndex;
      if (run.route.restAfter.includes(wasLastIndex)) {
        log('SCENE', 'transitioning to Rest', { nextEncounter: nextIndex });
        this.scene.start('Rest');
      } else {
        log('SCENE', 'transitioning to next Combat', { nextEncounter: nextIndex });
        this.scene.start('Combat');
      }
    });
  }

  private loseRun(reason: string): void {
    log('LOSE', 'run lost', { reason });
    this.combatOver = true;
    this.waitMode = true;
    this.saveStateToRun();
    this.sound.play('sfx-defeat-sting', { volume: 0.5 });
    this.time.delayedCall(1000, () => {
      this.scene.start('RunComplete', { outcome: 'defeat', reason });
    });
  }

  private abortRun(): void {
    this.scene.start('RunComplete', { outcome: 'defeat', reason: 'Run aborted.' });
  }

  private handleEscapeKey(): void {
    if (this.combatOver) return;
    this.sound.play('sfx-menu-cancel', { volume: 0.5 });
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

    const { width, height } = this.scale;
    const container = this.add.container(0, 0).setDepth(200000);
    const bg = this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.75)
      .setOrigin(0.5)
      .setInteractive();

    const resumeBtn = this.add
      .text(width / 2, height / 2 - 40, '[ RESUME ]', {
        fontFamily: FONT,
        fontSize: '28px',
        color: '#8aff8a',
        backgroundColor: '#2a3a2a',
        padding: { x: 24, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    resumeBtn.on('pointerup', () => this.closePauseMenu());

    const quitBtn = this.add
      .text(width / 2, height / 2 + 40, '[ ABANDON RUN ]', {
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

    container.add([bg, resumeBtn, quitBtn]);
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
