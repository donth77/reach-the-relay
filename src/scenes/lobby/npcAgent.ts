import * as Phaser from 'phaser';
import { FONT, interactPromptText, isTouchDevice, keyHintLabel } from '../../util/ui';
import { playSfx } from '../../util/audio';
import { getLobbyState, toggleRecruit } from '../../state/lobby';
import { CLASSES } from '../../data/classes';
import { getHeadCrop, getPortraitInfo } from '../../util/headCrop';
import { CLASS_LORE_BLURBS } from '../../data/classBlurbs';
import { openBriefing } from '../../util/briefingModal';

/**
 * Single-source-of-truth for Greenhouse NPCs. Each NpcAgent handles:
 *   - sprite creation + y-sort depth
 *   - patrol state machine (vertical / horizontal / stationary)
 *   - proximity prompt ("▼ E" floating above the sprite)
 *   - proximity + interaction radius check
 *   - collision rect exposed so the scene can add it to its obstacles
 *   - dialogue trigger that opens the shared dialogue modal
 *
 * Adding a new NPC to the Greenhouse is ~5 lines in LobbyScene:
 *   const npc = new NpcAgent(this, { classId: 'scavenger', x: 300, y: 600,
 *     recruitable: true, patrolAxis: 'horizontal' });
 *   this.npcs.push(npc);
 *   this.obstacles.push(npc.collisionRect);
 */

export type PatrolAxis = 'vertical' | 'horizontal' | null;

export interface NpcAgentConfig {
  /** Matches a class id in CLASSES / sprite keys: medic, scavenger, etc. */
  classId: string;
  /** Center of the patrol range in world coords. */
  x: number;
  y: number;
  /** null = stationary. */
  patrolAxis?: PatrolAxis;
  /** Distance from (x, y) the NPC walks in each direction along patrolAxis. */
  patrolRange?: number;
  /** Walk speed in px/s. Slow Pokemon-style defaults to 50. */
  speed?: number;
  /** Pause at each end before turning around. */
  pauseMs?: number;
  /** Direction the NPC faces when stationary / starting. */
  initialFacing?: 'south' | 'north' | 'east' | 'west';
  /** Whether interacting can toggle recruit. Non-recruitables still greet. */
  recruitable: boolean;
  /** Override the name banner on the dialogue modal. Defaults to class name. */
  displayName?: string;
  /** Lines shown the first time you greet. At least one required. */
  greetingLines?: string[];
  /** Lines shown after the NPC has been recruited. */
  alreadyRecruitedLines?: string[];
  /** Per-NPC sprite scale override. Defaults to the lobby's
   *  DEFAULT_PLAYER_SCALE of 2.0 (matching the leader's visual size). */
  spriteScale?: number;
  /** Fixed depth override. When set, bypasses the default y-sort depth
   *  so the NPC sprite can be forced to render above (or below) a
   *  specific prop — e.g. the Scavenger stacked on top of the
   *  workbench sprite regardless of their feet-y ordering. */
  depthOverride?: number;
  /** Optional custom idle animation (e.g. scavenger working at the
   *  workbench). When set, the NPC plays this anim continuously
   *  instead of showing the default static rotation — only meaningful
   *  for stationary NPCs (patrolAxis unset/null). */
  idleAnim?: {
    /** Prefix for frame texture keys; frames are <prefix>-000, -001, ... */
    textureKeyPrefix: string;
    frameCount: number;
    /** FPS for the anim. Defaults to 6 — slow/working tempo. */
    frameRate?: number;
  };
  /** Override the auto-computed stat line in the dialogue modal. Use for
   *  NPCs that aren't in CLASSES (e.g. Dr. Vey, whose stats differ from
   *  a combat class — escort-only HP pool, no attack/MP). */
  customStatLine?: string;
  /** Override the lore blurb shown below the stat line. Use for NPCs
   *  outside CLASSES. Defaults to CLASS_LORE_BLURBS[classId] when unset. */
  customLore?: string;
  /** Role subtitle under the personal name banner (e.g. "ESCORT" for
   *  Dr. Vey). For CLASSES-backed NPCs the subtitle auto-populates
   *  from CLASSES[classId].name; set this to show one for NPCs that
   *  aren't in CLASSES. */
  customRoleSubtitle?: string;
  /** Fine-tune the "▼ E" prompt's vertical offset. Added to the
   *  default position (which sits 28 px above the inferred head —
   *  sprite.y - 0.25 × displayHeight). Positive pushes the prompt
   *  DOWN (closer to head), negative pushes UP. Use when a sprite's
   *  character-fill ratio differs from the 0.25 head-offset assumption
   *  (e.g. Vanguard's 136-canvas sprites have more transparent space
   *  above the character, so the default prompt sits too high). */
  promptYAdjust?: number;
  /** Override the default 90-px interaction radius. Use a larger value
   *  when the NPC has prop-shaped collision around them (e.g. the
   *  Cybermonk seated on a cushion) that pushes the player further
   *  from the NPC's sprite center than the default reach allows. */
  interactionRadius?: number;
}

type PatrolState = 'walking-forward' | 'paused-forward' | 'walking-back' | 'paused-back';

export class NpcAgent {
  readonly classId: string;
  readonly recruitable: boolean;
  readonly displayName: string;

  private scene: Phaser.Scene;
  private sprite: Phaser.GameObjects.Sprite;
  private prompt: Phaser.GameObjects.Text;
  private _collisionRect: Phaser.Geom.Rectangle;
  private cfg: Required<
    Pick<NpcAgentConfig, 'patrolAxis' | 'patrolRange' | 'speed' | 'pauseMs' | 'initialFacing'>
  > &
    NpcAgentConfig;
  private state: PatrolState;
  private stateUntil = 0;
  private patrolPausedExternally = false;
  // Tracks whether the mouse cursor is currently over the NPC's sprite.
  // Used by update() to reconcile the pointer cursor when canInteract()
  // flips to true while the cursor is already parked on the sprite —
  // since pointerover only fires on entry, a static cursor wouldn't
  // otherwise get the hand-cursor treatment when the player walks in.
  private pointerOverSprite = false;
  private canInteractFn: (() => boolean) | null = null;

  constructor(scene: Phaser.Scene, config: NpcAgentConfig) {
    this.scene = scene;
    this.classId = config.classId;
    this.recruitable = config.recruitable;
    // Display name is the CHARACTER'S personal name (e.g. "ROWAN"), not
    // their role (e.g. "MEDIC") — role is shown separately as a
    // subtitle in the dialogue modal.
    this.displayName = (
      config.displayName ??
      CLASSES[config.classId]?.personName ??
      config.classId
    ).toUpperCase();

    this.cfg = {
      patrolAxis: config.patrolAxis ?? null,
      patrolRange: config.patrolRange ?? 50,
      speed: config.speed ?? 50,
      pauseMs: config.pauseMs ?? 1500,
      initialFacing: config.initialFacing ?? 'south',
      ...config,
    };

    // Prefer the worldwalk frame-0 texture when the class has one (patrol
    // classes — medic/scavenger/etc). Fall back to the plain rotation
    // texture (`<classId>-<facing>`) for NPCs without a walking anim,
    // like Dr. Vey / other static escort-style characters.
    const walkKey = `${config.classId}-worldwalk-${this.cfg.initialFacing}-000`;
    const staticKey = `${config.classId}-${this.cfg.initialFacing}`;
    const initialTextureKey = scene.textures.exists(walkKey) ? walkKey : staticKey;
    this.sprite = scene.add
      .sprite(config.x, config.y, initialTextureKey)
      .setScale(config.spriteScale ?? 2.0);

    // Collision rect = sprite base (where feet plant). Narrow + short
    // so the player can pass behind the NPC's head visually without
    // being blocked.
    const base = { w: 42, h: 24 };
    this._collisionRect = new Phaser.Geom.Rectangle(
      config.x - base.w / 2,
      config.y + this.sprite.displayHeight / 2 - base.h,
      base.w,
      base.h,
    );

    // Proximity prompt — mirrors the terminal's "▼ E" floaty. Position
    // is recomputed from the sprite's current position every frame (in
    // update()) so it tracks the NPC while they patrol. The gentle bob
    // is a time-based sine offset rather than a Phaser tween — a tween
    // on .y would fight the per-frame setPosition.
    this.prompt = scene.add
      .text(config.x, config.y, interactPromptText(), {
        fontFamily: FONT,
        fontSize: '16px',
        color: '#8aff8a',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(99998)
      .setVisible(false);

    // Start in a paused state so the NPC doesn't immediately start
    // walking into the player's line of sight.
    this.state = 'paused-forward';
    this.stateUntil = scene.time.now + this.cfg.pauseMs;

    // Custom idle animation (e.g. scavenger working at the workbench).
    // Register the anim on the scene (idempotent) and start playing it.
    // Only makes sense for stationary NPCs — the patrol loop would
    // fight with the anim if both ran.
    if (config.idleAnim) {
      const { textureKeyPrefix, frameCount, frameRate = 6 } = config.idleAnim;
      const animKey = `${config.classId}-${textureKeyPrefix}`;
      if (!scene.anims.exists(animKey)) {
        const frames = Array.from({ length: frameCount }, (_, i) => ({
          key: `${textureKeyPrefix}-${i.toString().padStart(3, '0')}`,
        }));
        scene.anims.create({ key: animKey, frames, frameRate, repeat: -1 });
      }
      this.sprite.play(animKey);
    }
  }

  get collisionRect(): Phaser.Geom.Rectangle {
    return this._collisionRect;
  }

  /** Hide/show the "▼ E" prompt. */
  setPromptVisible(visible: boolean): void {
    this.prompt.setVisible(visible);
  }

  /** True when the "▼ E" prompt is currently shown for this NPC. */
  isPromptVisible(): boolean {
    return this.prompt.visible;
  }

  /**
   * Enable click-to-interact on the NPC sprite as an alternative to the
   * E/Enter/Space keys. `canInteract` gates both the hand-cursor hover
   * and the click itself so the affordance matches the floating prompt's
   * visibility — only the closest in-range NPC responds.
   */
  enableClickInteract(canInteract: () => boolean): void {
    this.canInteractFn = canInteract;
    this.sprite.setInteractive();
    this.sprite.on('pointerover', () => {
      this.pointerOverSprite = true;
      if (canInteract()) this.scene.input.setDefaultCursor('pointer');
    });
    this.sprite.on('pointerout', () => {
      this.pointerOverSprite = false;
      this.scene.input.setDefaultCursor('');
    });
    this.sprite.on('pointerdown', () => {
      if (!canInteract()) return;
      this.interact();
    });
  }

  /**
   * Pause patrol externally (e.g. while a dialogue is open). Also
   * pauses/resumes the sprite's frame animation so the character stops
   * visibly walking-in-place — not just freezing their world position.
   */
  setPatrolPaused(paused: boolean): void {
    if (this.patrolPausedExternally === paused) return;
    this.patrolPausedExternally = paused;
    if (paused) {
      if (this.sprite.anims.isPlaying) this.sprite.anims.pause();
    } else {
      if (this.sprite.anims.isPaused) this.sprite.anims.resume();
    }
  }

  /**
   * True when the player's feet are within an interaction radius of the
   * NPC's sprite center. Caller passes the player's feet position.
   */
  isInInteractionRange(feetX: number, feetY: number, radius?: number): boolean {
    const r = radius ?? this.cfg.interactionRadius ?? 90;
    const dx = feetX - this.sprite.x;
    const dy = feetY - this.sprite.y;
    return dx * dx + dy * dy <= r * r;
  }

  /** Per-frame tick. Runs patrol and updates depth + prompt position. */
  update(delta: number): void {
    if (!this.patrolPausedExternally && this.cfg.patrolAxis) {
      this.tickPatrol(delta);
    }

    // Reconcile the hand-cursor when interaction range flips while the
    // mouse is parked on the sprite. pointerover only fires on entry, so
    // a stationary cursor never gets the pointer style unless we poll.
    if (this.pointerOverSprite && this.canInteractFn) {
      const desired = this.canInteractFn() ? 'pointer' : '';
      if (this.scene.input.manager.defaultCursor !== desired) {
        this.scene.input.setDefaultCursor(desired);
      }
    }
    // Y-sort against player + props.
    this.sprite.setDepth(
      this.cfg.depthOverride ?? this.sprite.y + this.sprite.displayHeight * 0.25,
    );

    // Collision rect follows the sprite's feet — updated in place so
    // the reference held by the scene's obstacles array stays current.
    const feetY = this.sprite.y + this.sprite.displayHeight * 0.25;
    this._collisionRect.x = this.sprite.x - this._collisionRect.width / 2;
    this._collisionRect.y = feetY - this._collisionRect.height;

    // Prompt sits just above the NPC's visible head. The sprite's
    // canvas has transparent padding above the character, so using
    // displayHeight/2 lands the prompt way above the art. 0.25 ×
    // displayHeight mirrors the feet offset (0.25) by symmetry — the
    // character's head sits ~25% of displayHeight above center for
    // every class. Small time-based sine bob so it feels alive.
    const bob = Math.sin(this.scene.time.now / 160) * 2;
    const headY = this.sprite.y - this.sprite.displayHeight * 0.25;
    const promptAdjust = this.cfg.promptYAdjust ?? 0;
    this.prompt.setPosition(this.sprite.x, headY - 28 + bob + promptAdjust);
  }

  private tickPatrol(delta: number): void {
    const step = this.cfg.speed * (delta / 1000);
    const now = this.scene.time.now;
    const axis = this.cfg.patrolAxis;
    const center = axis === 'vertical' ? this.cfg.y : this.cfg.x;
    const min = center - this.cfg.patrolRange;
    const max = center + this.cfg.patrolRange;
    const getCoord = (): number => (axis === 'vertical' ? this.sprite.y : this.sprite.x);
    const setCoord = (v: number): void => {
      if (axis === 'vertical') this.sprite.y = v;
      else this.sprite.x = v;
    };

    const applyAnim = (animKey: string | null, idleTexture: string): void => {
      if (animKey === null) {
        if (this.sprite.anims.isPlaying) this.sprite.anims.stop();
        this.sprite.setTexture(idleTexture);
      } else if (this.sprite.anims.currentAnim?.key !== animKey) {
        this.sprite.play(animKey);
      }
    };

    // "forward" = toward max coord; "back" = toward min.
    // Vertical: forward=south, back=north. Horizontal: forward=east, back=west.
    const forwardDir = axis === 'vertical' ? 'south' : 'east';
    const backDir = axis === 'vertical' ? 'north' : 'west';

    switch (this.state) {
      case 'walking-forward': {
        applyAnim(
          `${this.classId}-worldwalk-${forwardDir}`,
          `${this.classId}-worldwalk-${forwardDir}-000`,
        );
        // Horizontal-east flip handling: if the class lacks a dedicated
        // east anim (only west), use west + flipX.
        if (axis === 'horizontal') this.applyHorizontalFlip('east');
        const next = getCoord() + step;
        if (next >= max) {
          setCoord(max);
          this.state = 'paused-forward';
          this.stateUntil = now + this.cfg.pauseMs;
        } else {
          setCoord(next);
        }
        break;
      }
      case 'paused-forward':
        applyAnim(null, `${this.classId}-worldwalk-${forwardDir}-000`);
        if (axis === 'horizontal') this.applyHorizontalFlip('east');
        if (now >= this.stateUntil) this.state = 'walking-back';
        break;
      case 'walking-back': {
        applyAnim(
          `${this.classId}-worldwalk-${backDir}`,
          `${this.classId}-worldwalk-${backDir}-000`,
        );
        if (axis === 'horizontal') this.applyHorizontalFlip('west');
        const next = getCoord() - step;
        if (next <= min) {
          setCoord(min);
          this.state = 'paused-back';
          this.stateUntil = now + this.cfg.pauseMs;
        } else {
          setCoord(next);
        }
        break;
      }
      case 'paused-back':
        applyAnim(null, `${this.classId}-worldwalk-${backDir}-000`);
        if (axis === 'horizontal') this.applyHorizontalFlip('west');
        if (now >= this.stateUntil) this.state = 'walking-forward';
        break;
    }
  }

  /**
   * Horizontal classes (scavenger/netrunner/cybermonk/vanguard) have a
   * west walk but not east — east is rendered as flipped west.
   */
  private applyHorizontalFlip(desired: 'east' | 'west'): void {
    const hasEast = this.scene.anims.exists(`${this.classId}-worldwalk-east`);
    const shouldFlip = desired === 'east' && !hasEast;
    if (this.sprite.flipX !== shouldFlip) this.sprite.flipX = shouldFlip;
  }

  /**
   * Open the dialogue modal. Caller is responsible for deciding WHEN to
   * call this (usually after a proximity + E check). The modal owns its
   * own input; while it's open, the scene should skip player/npc
   * updates (check isDialogueOpen()).
   */
  interact(): void {
    if (isDialogueOpen()) return;
    const lobby = getLobbyState();
    const isRecruited = lobby.recruited.has(this.classId);
    const isLeader = lobby.leaderId === this.classId;
    // Prefer the no-shield "world" portrait variant for classes that
    // have one (currently just Vanguard) — keeps combat gear like the
    // raised shield from covering half the face in the dialogue modal.
    const portraitInfo = getPortraitInfo(this.classId);
    const portraitKey = portraitInfo.textureKey;
    // Use the world-variant key as the crop-lookup class so the
    // dialogue modal picks up the matching head-crop entry.
    const portraitClassId =
      portraitKey === `${this.classId}-world-south` ? `${this.classId}-world` : this.classId;
    const statLine = this.cfg.customStatLine;
    const loreLine = this.cfg.customLore;
    const roleSubtitle = this.cfg.customRoleSubtitle;

    // Leaders can't be "recruited" — short-circuit to a different line.
    if (isLeader) {
      openDialogue(this.scene, {
        name: this.displayName,
        portraitKey,
        portraitClassId,
        statLine,
        loreLine,
        roleSubtitle,
        text: 'You told me to lead. Just say the word and we move.',
        options: [{ label: '[E] CLOSE', key: 'E', action: () => closeDialogue() }],
      });
      return;
    }

    const lines = isRecruited
      ? (this.cfg.alreadyRecruitedLines ?? ['Ready when you are.'])
      : (this.cfg.greetingLines ?? ["I'm in if you'll have me."]);
    const text = lines[Math.floor(Math.random() * lines.length)];

    if (!this.recruitable) {
      // Non-recruitable NPCs (currently: Dr. Vey) get a CLOSE row and
      // a BRIEFING shortcut. BRIEFING closes this dialogue and opens
      // the shared mission-briefing modal so the player can re-read
      // the objective any time from the escort themself.
      const scene = this.scene;
      openDialogue(scene, {
        name: this.displayName,
        portraitKey,
        portraitClassId,
        statLine,
        loreLine,
        roleSubtitle,
        text,
        options: [
          { label: '[E] CLOSE', key: 'E', action: () => closeDialogue() },
          {
            label: '[B] BRIEFING',
            key: 'B',
            action: () => {
              closeDialogue();
              // Next-tick so the keypress that opened the briefing
              // doesn't also hit its own dismiss listener immediately.
              scene.time.delayedCall(1, () => openBriefing(scene));
            },
          },
        ],
      });
      return;
    }

    // Two symmetric branches. When NOT recruited: E = recruit (add),
    // ESC = leave them behind (no change). When already recruited:
    // E = keep them on (no change), ESC = stand them down (remove).
    // This way ESC always means "they're not coming right now," so
    // hitting ESC on an already-recruited NPC removes them from the
    // roster — matching the player's mental model.
    const primaryLabel = isRecruited ? '[E] KEEP' : '[E] RECRUIT';
    const secondaryLabel = isRecruited ? '[ESC] STAND DOWN' : '[ESC] NOT NOW';
    openDialogue(this.scene, {
      name: this.displayName,
      portraitKey,
      portraitClassId,
      statLine,
      loreLine,
      text,
      options: [
        {
          label: primaryLabel,
          key: 'E',
          action: () => {
            if (!isRecruited) {
              toggleRecruit(this.classId);
              playSfx(this.scene, 'sfx-menu-confirm', 0.4);
            } else {
              playSfx(this.scene, 'sfx-menu-cancel', 0.3);
            }
            closeDialogue();
          },
        },
        {
          label: secondaryLabel,
          key: 'ESC',
          action: () => {
            if (isRecruited) {
              toggleRecruit(this.classId);
              playSfx(this.scene, 'sfx-menu-confirm', 0.4);
            } else {
              playSfx(this.scene, 'sfx-menu-cancel', 0.3);
            }
            closeDialogue();
          },
        },
      ],
    });
  }

  destroy(): void {
    this.sprite.destroy();
    this.prompt.destroy();
  }
}

// ------------------------------------------------------------------
// Shared dialogue modal. Module-scoped so scenes can check
// isDialogueOpen() to gate input + patrol updates while the modal is
// open. Terminal-styled to match the PartySelectTerminal aesthetic.
// ------------------------------------------------------------------

interface DialogueOption {
  label: string;
  /** Phaser key name: 'E', 'ENTER', 'SPACE', 'ESC', etc. */
  key: string;
  action: () => void;
}

interface DialogueConfig {
  name: string;
  text: string;
  options: DialogueOption[];
  /** Optional sprite texture key to render as a portrait in the modal. */
  portraitKey?: string;
  /** Class id used to look up the head-crop rectangle — so the portrait
   *  shows only the character's face, not their whole body. */
  portraitClassId?: string;
  /** Override the auto-computed stat line. Shown verbatim when set. */
  statLine?: string;
  /** Override the lore blurb below the stat line. */
  loreLine?: string;
  /** Override the role subtitle shown under the name banner. */
  roleSubtitle?: string;
}

interface ActiveDialogue {
  scene: Phaser.Scene;
  container: Phaser.GameObjects.Container;
  keyBindings: Array<{ key: string; handler: () => void }>;
}

let active: ActiveDialogue | null = null;

export function isDialogueOpen(): boolean {
  return active !== null;
}

export function closeDialogue(): void {
  if (!active) return;
  const kb = active.scene.input.keyboard;
  for (const b of active.keyBindings) kb?.off(`keydown-${b.key}`, b.handler);
  active.container.destroy();
  active = null;
}

export function openDialogue(scene: Phaser.Scene, config: DialogueConfig): void {
  if (active) closeDialogue();

  const { width, height } = scene.scale;
  // Centered panel. Size tuned for a portrait + multi-line text + a row
  // of options. Portrait sits in the top-left of the panel; name banner
  // to the right of it; body text below; options along the bottom.
  // Touch devices get a scaled-up variant: the canvas is fit-to-screen
  // on phones so the native panel reads tiny — bumping the panel +
  // fonts keeps the modal legible at phone sizes.
  const touchUi = isTouchDevice();
  const panelW = touchUi ? 960 : 680;
  const panelH = touchUi ? 500 : 320;
  const panelX = width / 2;
  const panelY = height / 2;
  const panelLeft = panelX - panelW / 2;
  const panelTop = panelY - panelH / 2;

  const container = scene.add.container(0, 0).setDepth(100001).setScrollFactor(0);

  // Full-screen dim that ALSO catches click-outside-to-close.
  // Defer the listener binding one tick: the click that OPENS this
  // dialogue (e.g. pointerdown on an NPC sprite) is often still mid-flight
  // — if the user's mouse ends up over the dim on release, the pointerup
  // would immediately close the modal we just opened. Also using
  // pointerdown (not pointerup) so the dim only closes on a *new* click
  // after it's fully live.
  const dim = scene.add
    .rectangle(width / 2, height / 2, width, height, 0x000000, 0.55)
    .setScrollFactor(0)
    .setInteractive();
  scene.time.delayedCall(1, () => {
    if (active) dim.on('pointerdown', () => closeDialogue());
  });
  container.add(dim);

  // Terminal-styled panel (dark green-black, cyan bezel). Interactive
  // so clicks ON the panel don't bubble up to the dim and close it.
  const panel = scene.add
    .rectangle(panelX, panelY, panelW, panelH, 0x051410, 0.98)
    .setStrokeStyle(3, 0x55ff88, 1)
    .setScrollFactor(0)
    .setInteractive();
  container.add(panel);

  // L-bracket corners on the panel — reinforces the terminal aesthetic.
  const brackets = scene.add.graphics().setScrollFactor(0);
  brackets.lineStyle(3, 0x8aff8a, 1);
  const armLen = 18;
  const l = panelLeft;
  const r = panelLeft + panelW;
  const t = panelTop;
  const b = panelTop + panelH;
  brackets.beginPath();
  brackets.moveTo(l, t + armLen);
  brackets.lineTo(l, t);
  brackets.lineTo(l + armLen, t);
  brackets.strokePath();
  brackets.beginPath();
  brackets.moveTo(r - armLen, t);
  brackets.lineTo(r, t);
  brackets.lineTo(r, t + armLen);
  brackets.strokePath();
  brackets.beginPath();
  brackets.moveTo(l, b - armLen);
  brackets.lineTo(l, b);
  brackets.lineTo(l + armLen, b);
  brackets.strokePath();
  brackets.beginPath();
  brackets.moveTo(r - armLen, b);
  brackets.lineTo(r, b);
  brackets.lineTo(r, b - armLen);
  brackets.strokePath();
  container.add(brackets);

  // Portrait slot (if provided). Framed box in the top-left of the
  // panel — shows ONLY the character's face, cropped from the
  // south-facing sprite using the shared headCrop rectangles.
  const PORTRAIT_BOX = touchUi ? 192 : 128;
  const portraitX = panelLeft + 24 + PORTRAIT_BOX / 2;
  const portraitY = panelTop + 24 + PORTRAIT_BOX / 2;
  if (config.portraitKey) {
    const portraitBg = scene.add
      .rectangle(portraitX, portraitY, PORTRAIT_BOX, PORTRAIT_BOX, 0x0a2a1a, 1)
      .setStrokeStyle(2, 0x55ff88, 0.9)
      .setScrollFactor(0);
    container.add(portraitBg);
    if (scene.textures.exists(config.portraitKey)) {
      const crop = config.portraitClassId
        ? getHeadCrop(config.portraitClassId)
        : { x: 14, y: 4, w: 40, h: 28, canvas: 68 };
      // Fit the cropped region into the square slot, constrained by
      // the crop's larger dimension so the face stays proportional.
      // The default 1.2 multiplier zooms the head a bit so the portrait
      // reads as a face rather than a distant doll — per-class overrides
      // on HeadCrop.fitMultiplier disable that zoom for crops whose
      // proportions would overflow the 128×128 slot (e.g. Vanguard).
      const fitMult = crop.fitMultiplier ?? 1.2;
      const fitScale = ((PORTRAIT_BOX - 2) / Math.max(crop.w, crop.h)) * fitMult;
      // Origin is the BOTTOM-CENTER of the crop rect in normalized
      // canvas coords — setting the image's position at the frame's
      // bottom (accounting for the 2px stroke) anchors the face flush
      // to the bottom border, horizontally centered.
      const originX = (crop.x + crop.w / 2) / crop.canvas;
      const originY = (crop.y + crop.h) / crop.canvas;
      const img = scene.add
        .image(portraitX, portraitY + PORTRAIT_BOX / 2 - 1, config.portraitKey)
        .setOrigin(originX, originY)
        .setScale(fitScale)
        .setCrop(crop.x, crop.y, crop.w, crop.h)
        .setScrollFactor(0);
      container.add(img);
    }
  }

  // Name banner: to the right of the portrait. Personal name is the
  // primary identifier; the role (e.g. "Medic") sits just beneath in a
  // smaller dim color as a subtitle.
  const nameX = config.portraitKey ? portraitX + PORTRAIT_BOX / 2 + 20 : panelLeft + 24;
  const nameY = panelTop + 24;
  const nameBanner = scene.add
    .text(nameX, nameY, `> ${config.name}`, {
      fontFamily: FONT,
      fontSize: touchUi ? '36px' : '24px',
      color: '#8aff8a',
    })
    .setOrigin(0, 0)
    .setScrollFactor(0);
  container.add(nameBanner);
  // Strip a trailing `-world` suffix for CLASSES / lore lookups —
  // `vanguard-world` is a portrait-only alias that points at the same
  // class data as `vanguard`.
  const dataClassId = config.portraitClassId?.replace(/-world$/, '');
  const roleSubtitle =
    config.roleSubtitle ?? (dataClassId ? (CLASSES[dataClassId]?.name.toUpperCase() ?? '') : '');
  if (roleSubtitle) {
    const roleText = scene.add
      .text(nameX, nameY + (touchUi ? 44 : 30), roleSubtitle, {
        fontFamily: FONT,
        fontSize: touchUi ? '20px' : '14px',
        color: '#6aaa8a',
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    container.add(roleText);
  }

  // Body text below the name+role, wrapped to the remaining width.
  const bodyY = nameY + (roleSubtitle ? (touchUi ? 80 : 54) : touchUi ? 54 : 36);
  const bodyWidth = panelW - (nameX - panelLeft) - 30;
  const body_ = scene.add
    .text(nameX, bodyY, config.text, {
      fontFamily: FONT,
      fontSize: touchUi ? '26px' : '18px',
      color: '#a6ffc6',
      wordWrap: { width: bodyWidth },
    })
    .setOrigin(0, 0)
    .setScrollFactor(0);
  container.add(body_);

  // Stat line below the body text. Prefers an explicit override from
  // the config (non-class NPCs like Dr. Vey), otherwise auto-computes
  // from CLASSES. Terminal-styled as `HP xx ATK yy ...`.
  let lastBottom = body_.y + body_.displayHeight;
  const resolvedStatLine =
    config.statLine ??
    (dataClassId && CLASSES[dataClassId]
      ? (() => {
          const def = CLASSES[dataClassId!];
          return `HP ${def.hp}   ATK ${def.attack}   DEF ${def.defense}   SPD ${def.speed}${def.mp > 0 ? `   MP ${def.mp}` : ''}`;
        })()
      : null);
  if (resolvedStatLine) {
    const stats = scene.add
      .text(nameX, lastBottom + 14, resolvedStatLine, {
        fontFamily: FONT,
        fontSize: touchUi ? '24px' : '18px',
        color: '#6aaa8a',
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    container.add(stats);
    lastBottom = stats.y + stats.displayHeight;
  }

  // Lore blurb — prefers an explicit config.loreLine, otherwise falls
  // back to CLASS_LORE_BLURBS[classId]. Dim-colored so it reads as
  // supplementary to the NPC's in-the-moment greeting above.
  const resolvedLore =
    config.loreLine ?? (dataClassId ? CLASS_LORE_BLURBS[dataClassId] : undefined);
  if (resolvedLore) {
    const lore = scene.add
      .text(nameX, lastBottom + 12, resolvedLore, {
        fontFamily: FONT,
        fontSize: touchUi ? '22px' : '16px',
        color: '#4a8a6a',
        fontStyle: 'italic',
        wordWrap: { width: bodyWidth },
      })
      .setOrigin(0, 0)
      .setScrollFactor(0);
    container.add(lore);
  }

  // X button in the top-right of the panel.
  const closeBtn = scene.add
    .text(panelLeft + panelW - 20, panelTop + 14, '✕', {
      fontFamily: FONT,
      fontSize: touchUi ? '32px' : '22px',
      color: '#8aff8a',
    })
    .setOrigin(1, 0)
    .setScrollFactor(0)
    .setInteractive({ useHandCursor: true });
  closeBtn.on('pointerover', () => closeBtn.setColor('#ffffff'));
  closeBtn.on('pointerout', () => closeBtn.setColor('#8aff8a'));
  closeBtn.on('pointerup', () => closeDialogue());
  container.add(closeBtn);

  // Option labels along the bottom of the panel. Keyboard `[X]` hints
  // are stripped on touch since mobile players can't press them — the
  // labels themselves are tappable.
  const optSpacing = Math.min(
    touchUi ? 360 : 260,
    (panelW - 60) / Math.max(1, config.options.length),
  );
  const optsY = panelTop + panelH - (touchUi ? 50 : 34);
  config.options.forEach((opt, i) => {
    const x = panelX - ((config.options.length - 1) * optSpacing) / 2 + i * optSpacing;
    const txt = scene.add
      .text(x, optsY, keyHintLabel(opt.label), {
        fontFamily: FONT,
        fontSize: touchUi ? '26px' : '18px',
        color: '#8affaa',
        backgroundColor: touchUi ? '#0a2a1a' : undefined,
        padding: touchUi ? { x: 16, y: 10 } : undefined,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    txt.on('pointerover', () => txt.setColor('#ffffff'));
    txt.on('pointerout', () => txt.setColor('#8affaa'));
    txt.on('pointerup', () => opt.action());
    container.add(txt);
  });

  // Key bindings. ESC always closes, even if the options don't bind it.
  const kb = scene.input.keyboard;
  const keyBindings: ActiveDialogue['keyBindings'] = [];
  const hasEsc = config.options.some((o) => o.key === 'ESC');
  if (!hasEsc) {
    const escHandler = (): void => closeDialogue();
    kb?.on('keydown-ESC', escHandler);
    keyBindings.push({ key: 'ESC', handler: escHandler });
  }
  for (const opt of config.options) {
    const handler = (): void => opt.action();
    kb?.on(`keydown-${opt.key}`, handler);
    keyBindings.push({ key: opt.key, handler });
  }

  active = { scene, container, keyBindings };

  // Self-cleanup if the scene shuts down while the dialogue is still
  // open (e.g. Return to Title from pause menu).
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    if (active && active.scene === scene) closeDialogue();
  });
}
