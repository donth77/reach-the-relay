import * as Phaser from 'phaser';
// Must come before the rex import — sets up `window.Phaser`.
import '../util/rexGlobal';
import VirtualJoyStick from 'phaser3-rex-plugins/plugins/virtualjoystick';
import { FONT } from '../util/ui';
import { playMusicPool } from '../util/music';
import { installPauseMenuEsc, isPauseMenuOpen, onSceneKeyWhenUnpaused } from '../util/pauseMenu';
import { getLobbyState } from '../state/lobby';
import { isDebugCollisionOn, onDebugCollisionChange, log } from '../util/logger';
import { NpcAgent, isDialogueOpen } from './lobby/npcAgent';
import { CrewHud } from './lobby/crewHud';

// Walkable Greenhouse. Phase 2 skeleton — leader movement + scrolling
// camera. NPCs + dialogue + terminal menu land in later phases.
//
// World is larger than the 1280×720 viewport so the camera must scroll.
// For v1 we use a placeholder background (solid color + grid) sized to
// WORLD_WIDTH × WORLD_HEIGHT; the proper Greenhouse atrium art swaps in
// once it's generated.

const WORLD_WIDTH = 1280;
const WORLD_HEIGHT = 720;
const PLAYER_SPEED = 220; // px/s
// Lobby-scoped sprite scale. Scoped to this scene only — combat and select
// screens keep their own scales. NPC sprites placed in the lobby should
// also use these constants so the party, recruits, Dr. Vey, Mira, etc.
// all feel proportioned to the Greenhouse tile grid.
const DEFAULT_PLAYER_SCALE = 2.0;
// Per-class override — classes whose lobby sprite is on a larger canvas
// than the default (68×68) get scaled down to match. Vanguard's no-shield
// lobby sprite is 136×136 (≈2× the 68×68 canvas), so his multiplier is
// ≈half of DEFAULT_PLAYER_SCALE.
const LOBBY_SCALE: Partial<Record<string, number>> = {
  vanguard: 1.4,
};
// Walkable floor polygon in world coords (1280×720). Measured on the
// source bg image (2754×1536) and converted with scale factors
// 1280/2754 ≈ 0.4647 (x) and 720/1536 = 0.46875 (y). Hexagonal room with
// angled top-left and top-right corners, and a doorway notch in the
// bottom wall that extends to the image's bottom edge (which doubles as
// the exit-portal trigger zone once we wire it).
//
// Vertices ordered clockwise starting from the upper-left end of the top
// edge (where the top-left diagonal meets the horizontal top wall).
const WALK_POLY_POINTS: number[] = [
  212, 311, // 1. top edge, left end
  1067, 311, // 2. top edge, right end
  1153, 393, // 3. right wall, top (end of top-right diagonal)
  1153, 656, // 4. right wall, bottom
  699, 656, // 5. doorway top-right
  699, 720, // 6. doorway bottom-right (image bottom edge)
  581, 720, // 7. doorway bottom-left (image bottom edge)
  581, 656, // 8. doorway top-left
  125, 656, // 9. left wall, bottom
  125, 394, // 10. left wall, top (end of top-left diagonal)
];

export class LobbyScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private playerFacing: 'south' | 'north' | 'east' | 'west' = 'south';
  private cursorKeys!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private leaderKey: string = 'vanguard';
  // Tracks the animation key currently playing so we only issue play/stop
  // calls when something actually changed. Avoids fighting Phaser's internal
  // anim state on every frame.
  private currentAnimKey: string | null = null;
  // Virtual joystick for touch devices — only created on touch-capable
  // hardware. Exposes left/right/up/down booleans which we OR with keyboard
  // input in the update loop.
  private joystick?: VirtualJoyStick;
  // Cached walkable polygon for cheap point-in-polygon tests each frame.
  private walkPoly!: Phaser.Geom.Polygon;
  // Prop collision rects — feet cannot enter these. Grown as props land.
  private obstacles: Phaser.Geom.Rectangle[] = [];
  // Terminal interaction — position and range used for proximity checks
  // in the update loop. Set in create() when the terminal sprite lands.
  private terminalInteractPos?: Phaser.Math.Vector2;
  private readonly TERMINAL_INTERACT_RANGE = 80;
  private terminalPromptText?: Phaser.GameObjects.Text;
  // Lobby NPCs — patrolling recruitables + passive crew. Each entry owns
  // its sprite, patrol loop, proximity prompt, and collision rect.
  // Refreshing this list is where new NPCs land.
  private npcs: NpcAgent[] = [];
  // Top-right HUD showing current escort + crew roster. Re-renders when
  // recruits change (e.g. after an NPC dialogue closes).
  private crewHud?: CrewHud;

  constructor() {
    super('Lobby');
  }

  create(): void {
    log('SCENE', 'Lobby created');
    // Phaser reuses scene instances across start/stop cycles — class
    // field initializers run ONCE at construction, not on every create().
    // Reset the per-session arrays manually or the old session's dead
    // NpcAgents + obstacle rects leak into the new session. A dead
    // NpcAgent has a destroyed sprite (no `.anims`), which crashes the
    // update loop on the first frame.
    this.npcs = [];
    this.obstacles = [];
    this.currentAnimKey = null;
    this.terminalInteractPos = undefined;
    this.terminalPromptText = undefined;
    this.crewHud = undefined;

    const lobby = getLobbyState();
    if (!lobby.leaderId) {
      // Safety: should not happen — LeaderSelect always writes this first.
      // Bounce back to LeaderSelect so the user can pick one.
      this.scene.start('LeaderSelect');
      return;
    }
    this.leaderKey = lobby.leaderId;

    this.cameras.main.setBackgroundColor('#1a2418');
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.physics?.world?.setBounds?.(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    playMusicPool(this, ['music-lobby-theme'], 0.35);

    this.drawWorld();

    this.walkPoly = new Phaser.Geom.Polygon(WALK_POLY_POINTS);

    // Terminal — the interactable that opens PartySelect. Positioned so
    // the top of the sprite sits just below the polygon's top wall
    // (visually flush against the wall, but the sprite itself stays
    // entirely inside the walkable floor — it doesn't overlap the wall
    // art). Collision rect covers its full footprint.
    //
    // Origin (0.5, 1) → feet at (terminalX, terminalFeetY); sprite
    // extends upward from there by its displayHeight. We want sprite top
    // ≈ polygon top (y=311), so feetY = 311 + displayHeight. At scale
    // 0.85 the 84px tall sprite displays at ~71px → feetY ≈ 382.
    const TERMINAL_SCALE = 0.85;
    const TERMINAL_DISPLAY_H = 84 * TERMINAL_SCALE;
    // Nudged east of vertex 1 (x=212) so the sprite's left edge clears
    // the top-left diagonal wall. feetY is pulled up from the strict
    // "sprite top = polygon top" value (~382) so the terminal reads as
    // tucked back against the wall (top of sprite partly behind it).
    const terminalX = 235;
    const terminalFeetY = 325;
    this.add
      .image(terminalX, terminalFeetY, 'lobby-terminal')
      .setOrigin(0.5, 1)
      .setScale(TERMINAL_SCALE)
      .setDepth(terminalFeetY);
    // Obstacle rect extends:
    // - ~30px BELOW the terminal's visible base so when the player walks
    //   up from the south they stop at roughly the keyboard level —
    //   reads as "standing in front of the monitor with hands at the
    //   keyboard" rather than merged into the sprite.
    // - 10px wider on BOTH SIDES so the player can't squeak past the
    //   sprite's narrow silhouette on either side.
    const TERMINAL_COLLISION_EXTEND_DOWN = 30;
    const TERMINAL_COLLISION_EXTEND_LEFT = 10;
    const TERMINAL_COLLISION_EXTEND_RIGHT = 10;
    this.obstacles.push(
      new Phaser.Geom.Rectangle(
        terminalX - 25 - TERMINAL_COLLISION_EXTEND_LEFT,
        terminalFeetY - Math.round(TERMINAL_DISPLAY_H),
        50 + TERMINAL_COLLISION_EXTEND_LEFT + TERMINAL_COLLISION_EXTEND_RIGHT,
        Math.round(TERMINAL_DISPLAY_H) + TERMINAL_COLLISION_EXTEND_DOWN,
      ),
    );
    // Interaction anchor = keyboard level (a bit south of the terminal's
    // base so the range centers on where the player stands to interact).
    this.terminalInteractPos = new Phaser.Math.Vector2(terminalX, terminalFeetY + 20);
    // Floating "▲ E" prompt above the terminal. Hidden until the player
    // is within range. Bobs gently up-and-down on a ping-pong tween.
    this.terminalPromptText = this.add
      .text(terminalX, terminalFeetY - Math.round(TERMINAL_DISPLAY_H) - 14, '▼ E', {
        fontFamily: FONT,
        fontSize: '16px',
        color: '#8aff8a',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(99998)
      .setVisible(false);
    this.tweens.add({
      targets: this.terminalPromptText,
      y: this.terminalPromptText.y - 4,
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Register per-leader walking animations for classes that have them.
    // Vanguard has shield-less lobbywalk anims; others fall back to static
    // rotation images (no walking animation yet).
    this.registerWalkAnims();

    // Player spawns just inside the doorway at the bottom-center of the
    // walkable polygon, facing north — reads as "just walked in from
    // outside" on first entry. Doorway x-range in WALK_POLY_POINTS is
    // ~572-704 (center 638); feet y sits a little above the bottom
    // doorway boundary so the sprite is fully on the floor.
    const SPAWN_X = 640;
    const SPAWN_FEET_Y = 700;
    // Convert desired FEET position → sprite CENTER position using the
    // same 0.25 × displayHeight offset the movement code uses.
    const scale = LOBBY_SCALE[this.leaderKey] ?? DEFAULT_PLAYER_SCALE;
    this.playerFacing = 'north';
    this.player = this.add
      .sprite(SPAWN_X, SPAWN_FEET_Y, this.idleTextureKey('north'))
      .setScale(scale);
    this.player.y = SPAWN_FEET_Y - this.player.displayHeight * 0.25;
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    this.spawnNpcs();

    this.cursorKeys = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys({
      W: Phaser.Input.Keyboard.KeyCodes.W,
      A: Phaser.Input.Keyboard.KeyCodes.A,
      S: Phaser.Input.Keyboard.KeyCodes.S,
      D: Phaser.Input.Keyboard.KeyCodes.D,
    }) as Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

    // Sticky-key fix #1: reset all keys when the window loses focus.
    // Without this, alt-tabbing out while holding a key leaves `isDown`
    // stuck true because the keyup event goes to another window.
    const onWindowBlur = () => {
      this.input.keyboard?.resetKeys();
    };
    window.addEventListener('blur', onWindowBlur);

    // Sticky-key fix #2: DOM-level keyup safety net. In practice Phaser's
    // internal `keyup-<KEY>` event sometimes doesn't fire for this scene
    // (we diagnosed this — keydown always fires, keyup frequently doesn't).
    // Listen at the window capture phase and force-clear the matching
    // Key object's `isDown` flag so the character stops on release.
    const domKeyUp = (e: KeyboardEvent) => {
      const keyMap: Record<string, Phaser.Input.Keyboard.Key | undefined> = {
        KeyW: this.wasd.W,
        KeyA: this.wasd.A,
        KeyS: this.wasd.S,
        KeyD: this.wasd.D,
        ArrowUp: this.cursorKeys.up,
        ArrowDown: this.cursorKeys.down,
        ArrowLeft: this.cursorKeys.left,
        ArrowRight: this.cursorKeys.right,
      };
      const key = keyMap[e.code];
      if (key) {
        key.isDown = false;
        key.isUp = true;
      }
    };
    window.addEventListener('keyup', domKeyUp, true);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('keyup', domKeyUp, true);
    });

    this.crewHud = new CrewHud(this);
    // Proximity-gated interaction: pressing E/Enter/Space only opens
    // PartySelect when the player is standing next to the terminal.
    // Interaction dispatcher. CLOSEST in-range interactable wins —
    // whether that's an NPC or the terminal. Falls back to "transmit &
    // deploy from anywhere" when the party is full and nothing is in
    // range (so the player can deploy without walking to the terminal).
    const openTerminal = () => {
      // Pause (not stop) the Lobby so NPC patrol state, player
      // position, music, etc. survive and resume cleanly on ESC.
      this.scene.pause();
      this.scene.launch('PartySelectTerminal');
    };
    const tryInteract = () => {
      if (isDialogueOpen()) return;
      const feetYOffset = this.player.displayHeight * 0.25;
      const feetX = this.player.x;
      const feetY = this.player.y + feetYOffset;

      // Collect every in-range interactable with its distance² from
      // the player's feet. Winner = smallest distance.
      let best: { run: () => void; dist2: number } | null = null;
      for (const npc of this.npcs) {
        if (!npc.isInInteractionRange(feetX, feetY)) continue;
        const rect = npc.collisionRect;
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const d2 = (feetX - cx) ** 2 + (feetY - cy) ** 2;
        if (!best || d2 < best.dist2) best = { run: () => npc.interact(), dist2: d2 };
      }
      if (this.isPlayerNearTerminal() && this.terminalInteractPos) {
        const d2 =
          (feetX - this.terminalInteractPos.x) ** 2 +
          (feetY - this.terminalInteractPos.y) ** 2;
        if (!best || d2 < best.dist2) best = { run: openTerminal, dist2: d2 };
      }
      if (best) {
        best.run();
        return;
      }
      // Nothing in range → deploy shortcut (only when party is full).
      const lobby = getLobbyState();
      if (lobby.leaderId && lobby.recruited.size >= 2) openTerminal();
    };
    for (const k of ['ENTER', 'E', 'SPACE']) {
      onSceneKeyWhenUnpaused(this, k, tryInteract);
    }

    this.maybeCreateJoystick();

    installPauseMenuEsc(this, { shouldBlockEsc: () => isDialogueOpen() });

    this.setupCollisionDebug();
  }

  /**
   * Draws the walkable polygon + every obstacle rect as a magenta
   * overlay, and wires the DEBUG collision toggle button in the HUD to
   * show/hide it. Persistent across scene re-entry because the toggle
   * state lives in module scope.
   */
  private setupCollisionDebug(): void {
    const g = this.add.graphics().setDepth(99999);
    // Walkable polygon outline (also dot each vertex).
    g.lineStyle(2, 0xff00ff, 1);
    const pts = WALK_POLY_POINTS;
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.closePath();
    g.strokePath();
    g.fillStyle(0xffff00, 1);
    for (let i = 0; i < pts.length; i += 2) g.fillCircle(pts[i], pts[i + 1], 4);
    // Obstacle rects.
    g.lineStyle(2, 0xff6666, 1);
    for (const r of this.obstacles) g.strokeRect(r.x, r.y, r.width, r.height);
    g.setVisible(isDebugCollisionOn());
    const unsubscribe = onDebugCollisionChange((on) => g.setVisible(on));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
  }

  /**
   * On touch devices, create a bottom-left virtual joystick. Clamped to
   * 4-way output (one cardinal direction at a time). The update loop reads
   * joystick.left/right/up/down and ORs with keyboard input.
   */
  private maybeCreateJoystick(): void {
    const isTouch =
      typeof window !== 'undefined' &&
      ((navigator.maxTouchPoints ?? 0) > 0 ||
        window.matchMedia?.('(pointer: coarse)').matches);
    if (!isTouch) return;

    const { height } = this.scale;
    const x = 120;
    const y = height - 120;
    const radius = 70;
    const base = this.add
      .circle(0, 0, radius, 0x0a1820, 0.5)
      .setStrokeStyle(3, 0x6a7fad, 0.8);
    const thumb = this.add
      .circle(0, 0, radius * 0.45, 0x6a7fad, 0.8)
      .setStrokeStyle(2, 0xe6e6e6, 0.9);
    this.joystick = new VirtualJoyStick(this, {
      x,
      y,
      radius,
      base,
      thumb,
      dir: '4dir',
    });
    // Pin the joystick visuals to the camera (don't scroll with world).
    base.setScrollFactor(0).setDepth(9000);
    thumb.setScrollFactor(0).setDepth(9001);
  }

  update(_time: number, delta: number): void {
    if (!this.player) return;
    // Freeze input AND all on-screen animation while the pause menu or
    // an NPC dialogue is open. Treats both overlays identically — NPCs
    // stop walking-in-place, and the player's own walk animation
    // pauses so nothing's cycling frames under the modal.
    const overlayOpen = isPauseMenuOpen() || isDialogueOpen();
    if (overlayOpen) {
      for (const npc of this.npcs) npc.setPatrolPaused(true);
      if (this.player.anims.isPlaying) this.player.anims.pause();
      return;
    }
    for (const npc of this.npcs) npc.setPatrolPaused(false);
    if (this.player.anims.isPaused) this.player.anims.resume();
    const dt = delta / 1000;
    const step = PLAYER_SPEED * dt;

    // Read inputs — cursor keys, WASD, or virtual joystick (touch devices).
    const left =
      !!this.cursorKeys.left?.isDown || this.wasd.A.isDown || !!this.joystick?.left;
    const right =
      !!this.cursorKeys.right?.isDown || this.wasd.D.isDown || !!this.joystick?.right;
    const up = !!this.cursorKeys.up?.isDown || this.wasd.W.isDown || !!this.joystick?.up;
    const down =
      !!this.cursorKeys.down?.isDown || this.wasd.S.isDown || !!this.joystick?.down;

    // 4-way movement — only one direction active at a time. When multiple
    // keys are pressed, horizontal wins over vertical, and opposite keys
    // cancel out.
    let dx = 0;
    let dy = 0;
    if (left && !right) dx = -1;
    else if (right && !left) dx = 1;
    else if (up && !down) dy = -1;
    else if (down && !up) dy = 1;
    const moving = dx !== 0 || dy !== 0;

    // Sprite's VISUAL FEET offset from its center. Actual feet sit higher
    // up in the canvas than the display-box bottom (there's empty space
    // below the boots), so we use 0.25 × displayHeight as a uniform
    // approximation. Used for both wall-collision (feet-inside-polygon)
    // and y-sort depth (feet-y as depth).
    const feetYOffset = this.player.displayHeight * 0.25;

    // ----- Position update -----
    if (moving) {
      // Polygon-based wall collision + prop obstacle rects. Axis-separate
      // so sliding along a wall (or along the side of a prop) works. A
      // move is accepted only if the would-be feet position is inside the
      // walkable polygon AND NOT inside any obstacle rectangle.
      const feetPassesWalls = (fx: number, fy: number): boolean => {
        if (!Phaser.Geom.Polygon.Contains(this.walkPoly, fx, fy)) return false;
        for (const obs of this.obstacles) {
          if (Phaser.Geom.Rectangle.Contains(obs, fx, fy)) return false;
        }
        return true;
      };
      const tryX = this.player.x + dx * step;
      if (dx !== 0 && feetPassesWalls(tryX, this.player.y + feetYOffset)) {
        this.player.x = tryX;
      }
      const tryY = this.player.y + dy * step;
      if (dy !== 0 && feetPassesWalls(this.player.x, tryY + feetYOffset)) {
        this.player.y = tryY;
      }

      // 4-way facing — exactly one of dx/dy is non-zero.
      if (dx < 0) this.playerFacing = 'west';
      else if (dx > 0) this.playerFacing = 'east';
      else if (dy < 0) this.playerFacing = 'north';
      else if (dy > 0) this.playerFacing = 'south';
    }

    // Y-sort the player against props (terminal, later NPCs). Depth = feet
    // y so a prop above the player renders behind, below-player renders in
    // front. Props themselves use their own feet y as their depth (set at
    // placement time).
    this.player.setDepth(this.player.y + feetYOffset);

    this.updateNpcs(delta);
    this.crewHud?.refresh();

    // Show/hide proximity prompts (terminal + every NPC) based on where
    // the player's feet are this frame.
    const feetX = this.player.x;
    const feetY = this.player.y + feetYOffset;
    this.updateNpcPrompts(feetX, feetY);
    if (this.terminalPromptText) {
      this.terminalPromptText.setVisible(this.isPlayerNearTerminal());
    }

    // ----- Animation / texture sync -----
    // Horizontal fallback: if the class lacks a dedicated anim for the
    // current facing (east or west), flip the opposite horizontal direction.
    // This logic applies to BOTH walking and idle so that the idle pose
    // uses the same (flipped) source as the walk — keeps the character's
    // apparent size consistent between standing and moving. Without it,
    // idle east would fall back to the wider `world-east` rotation while
    // walking east uses the narrower worldwalk-west-flipped frames,
    // making the character appear to shrink on movement start.
    let animFacing: 'south' | 'north' | 'east' | 'west' = this.playerFacing;
    let wantFlipX = false;
    if (this.playerFacing === 'west' || this.playerFacing === 'east') {
      const hasOwn = this.anims.exists(`${this.leaderKey}-worldwalk-${this.playerFacing}`);
      if (!hasOwn) {
        animFacing = this.playerFacing === 'west' ? 'east' : 'west';
        wantFlipX = true;
      }
    }
    if (this.player.flipX !== wantFlipX) this.player.flipX = wantFlipX;

    const desiredAnim = moving ? `${this.leaderKey}-worldwalk-${animFacing}` : null;

    if (desiredAnim !== this.currentAnimKey) {
      if (desiredAnim && this.anims.exists(desiredAnim)) {
        this.player.play(desiredAnim);
        this.currentAnimKey = desiredAnim;
      } else {
        if (this.currentAnimKey !== null) {
          this.player.anims.stop();
        }
        this.player.setTexture(this.idleTextureKey(animFacing));
        this.currentAnimKey = null;
      }
    } else if (!moving) {
      this.player.setTexture(this.idleTextureKey(animFacing));
    }
  }

  /**
   * Register walking animations for the leader. Only classes whose walk
   * frames have been generated get registered. The rest fall back to the
   * static directional texture (no animation).
   */
  /**
   * Resolve the static rotation texture for idle. Prefers the lobby/overworld
   * variant (`<class>-world-<dir>`) over the combat rotation (`<class>-<dir>`)
   * when the world variant is loaded. Currently only Vanguard has a separate
   * world variant (no-shield 136×136 for Greenhouse walking).
   */
  private idleTextureKey(dir: 'south' | 'north' | 'east' | 'west'): string {
    const worldKey = `${this.leaderKey}-world-${dir}`;
    if (this.textures.exists(worldKey)) return worldKey;
    return `${this.leaderKey}-${dir}`;
  }

  private registerWalkAnims(classId: string = this.leaderKey): void {
    // Per-class world-walk registrations. Entries supply frame counts per
    // direction — missing directions mean "no dedicated anim" (e.g. west
    // falls back to east+flipX in the update loop).
    type Dir = 'south' | 'north' | 'east' | 'west';
    const walkConfig: Partial<Record<string, Partial<Record<Dir, number>>>> = {
      vanguard: { south: 4, north: 6, east: 4 }, // no-shield; east 4-frame canonical, west via flipX
      medic: { south: 6, north: 6, east: 6, west: 6 },
      scavenger: { south: 6, north: 6, west: 6 }, // east via flipX
      netrunner: { south: 6, north: 6, west: 6 }, // east via flipX
      cybermonk: { south: 6, north: 6, west: 6 }, // east via flipX
    };
    const FRAME_RATE = 10;
    const cfg = walkConfig[classId];
    if (!cfg) return;
    for (const dir of Object.keys(cfg) as Dir[]) {
      const count = cfg[dir] ?? 0;
      if (count === 0) continue;
      const key = `${classId}-worldwalk-${dir}`;
      if (this.anims.exists(key)) continue;
      const frames = Array.from({ length: count }, (_, i) => ({
        key: `${classId}-worldwalk-${dir}-${i.toString().padStart(3, '0')}`,
      }));
      this.anims.create({ key, frames, frameRate: FRAME_RATE, repeat: -1 });
    }
  }

  /**
   * True when the player's feet are within TERMINAL_INTERACT_RANGE of
   * the terminal's interaction anchor. Used both to gate the E/Enter/
   * Space keypress and to show the floating "▲ E" prompt.
   */
  private isPlayerNearTerminal(): boolean {
    if (!this.terminalInteractPos || !this.player) return false;
    const feetYOffset = this.player.displayHeight * 0.25;
    const dx = this.player.x - this.terminalInteractPos.x;
    const dy = this.player.y + feetYOffset - this.terminalInteractPos.y;
    return dx * dx + dy * dy <= this.TERMINAL_INTERACT_RANGE * this.TERMINAL_INTERACT_RANGE;
  }

  /**
   * Spawn every NPC in the Greenhouse. Add to `npcs` + register each
   * NPC's collision rect with the scene obstacles. Adding a new NPC
   * here is 3-5 lines; the NpcAgent class handles everything else.
   */
  private spawnNpcs(): void {
    // Medic — test patrol on the right side of the room.
    this.registerWalkAnims('medic');
    const medic = new NpcAgent(this, {
      classId: 'medic',
      x: 1000,
      y: 525,
      patrolAxis: 'vertical',
      patrolRange: 50,
      speed: 50,
      pauseMs: 1500,
      recruitable: true,
      greetingLines: [
        "Patch kit's topped off. You need a medic, I'm your medic.",
      ],
      alreadyRecruitedLines: ["Ready when you are. Let's not keep The Relay waiting."],
    });
    this.npcs.push(medic);
    this.obstacles.push(medic.collisionRect);
  }

  /** Per-frame tick for every NPC. */
  private updateNpcs(delta: number): void {
    for (const npc of this.npcs) npc.update(delta);
  }

  /**
   * Show/hide each NPC's proximity prompt based on the player's feet
   * position. Multiple in-range NPCs is fine — but the one with the
   * closest feet distance wins the "active interaction" on E press.
   */
  private updateNpcPrompts(playerFeetX: number, playerFeetY: number): void {
    for (const npc of this.npcs) {
      npc.setPromptVisible(npc.isInInteractionRange(playerFeetX, playerFeetY));
    }
  }

  /**
   * Render the Greenhouse background image, stretched to fill the world
   * via Phaser's nearest-neighbor scaling (pixelArt: true in Game config).
   */
  private drawWorld(): void {
    this.add
      .image(0, 0, 'lobby-greenhouse')
      .setOrigin(0, 0)
      .setDisplaySize(WORLD_WIDTH, WORLD_HEIGHT)
      .setDepth(-100);

    // Scene label (screen-fixed, not world-space).
    this.add
      .text(20, 20, 'GREENHOUSE — walkable', {
        fontFamily: FONT,
        fontSize: '18px',
        color: '#aaaaaa',
      })
      .setScrollFactor(0)
      .setDepth(1000);
  }

}
