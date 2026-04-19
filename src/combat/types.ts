import * as Phaser from 'phaser';
import type { ClassDef } from '../data/classes';
import type { EnemyDef } from '../data/enemies';

export const ATB_MAX = 100;
export const ATB_RATE = 7;

export const PANEL_HEIGHT = 200;
export const PANEL_MARGIN = 10;
export const PANEL_TOP = 720 - PANEL_HEIGHT;
export const PANEL_BG = 0x101828;
export const PANEL_BORDER = 0x6a7fad;

// Depth tiers — each sprite gets a base + its Y so sprites with higher Y
// (lower on screen, closer to camera) render on top of sprites with lower Y.
export const DEPTH_ENEMY_BASE = 5000;
export const DEPTH_ENEMY_ACTIVE_BASE = 7500; // enemy during its attack sequence: above other enemies
export const DEPTH_PARTY_BASE = 10000;
export const DEPTH_WALK_FORWARD_BASE = 50000; // above everything during walk-forward + attack

export const DIMMED_OTHER_ALPHA = 0.3;
export const DIMMED_PEER_ENEMY_ALPHA = 0.35;

export type Side = 'party' | 'enemy' | 'escort';

export interface Unit {
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
