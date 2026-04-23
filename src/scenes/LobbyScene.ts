import * as Phaser from 'phaser';
// Must come before the rex import — sets up `window.Phaser`.
import '../util/rexGlobal';
import VirtualJoyStick from 'phaser3-rex-plugins/plugins/virtualjoystick';
import { FONT, interactPromptText, isTouchDevice } from '../util/ui';
import { playMusicPool } from '../util/music';
import {
  installPauseMenuEsc,
  isPauseMenuOpen,
  onSceneKeyWhenUnpaused,
  openPauseMenu,
} from '../util/pauseMenu';
import { getLobbyState, setLastPlayerPose } from '../state/lobby';
import { isDebugCollisionOn, onDebugCollisionChange, log } from '../util/logger';
import { NpcAgent, isDialogueOpen } from './lobby/npcAgent';
import { CrewHud } from './lobby/crewHud';
import { openMapModal, isMapOpen } from './lobby/mapModal';
import { isBriefingOpen } from '../util/briefingModal';
import { CLASSES } from '../data/classes';
import { buildPortalExitUrl, getPortalParams, isJamMode } from '../util/portal';

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
  // 68px classes have character bbox ~60px × scale 2.0 = ~120px display.
  // Vanguard's 136px canvas character bbox is ~64px tall → scale 1.85
  // brings him to ~118px display, roughly matching the other classes.
  vanguard: 1.6,
};
// Walkable floor polygon in world coords (1280×720). Measured on the
// source bg image (2754×1536) and converted with scale factors
// 1280/2754 ≈ 0.4647 (x) and 720/1536 = 0.46875 (y). Hexagonal room with
// angled top-left and top-right corners, and a doorway notch in the
// bottom wall that extends PAST the image's bottom edge (y=720) down to
// y=770 — gives the player 50px of off-screen runway so walking into the
// portal feels like actually walking through the doorway rather than
// bonking into the bottom of the room.
//
// Vertices ordered clockwise starting from the upper-left end of the top
// edge (where the top-left diagonal meets the horizontal top wall).
const DOORWAY_X_LEFT = 581;
const DOORWAY_X_RIGHT = 699;
const DOORWAY_Y_TOP = 656;
const DOORWAY_Y_BOTTOM = 870; // ~150px past image bottom (720) — long off-screen runway
// Feet-Y threshold for triggering the portal redirect. Tuned so the player
// sprite is mostly off-screen when it fires: at scale 2 (136px displayHeight)
// with the 0.25 × displayHeight feet offset, feet y ≈ 820 puts the sprite
// top at ~718 — just a sliver of helmet visible, reads as "walked out".
const PORTAL_TRIGGER_Y = 820;
const WALK_POLY_POINTS: number[] = [
  212,
  311, // 1. top edge, left end
  1067,
  311, // 2. top edge, right end
  1153,
  393, // 3. right wall, top (end of top-right diagonal)
  1153,
  DOORWAY_Y_TOP, // 4. right wall, bottom
  DOORWAY_X_RIGHT,
  DOORWAY_Y_TOP, // 5. doorway top-right
  DOORWAY_X_RIGHT,
  DOORWAY_Y_BOTTOM, // 6. doorway bottom-right (off-screen)
  DOORWAY_X_LEFT,
  DOORWAY_Y_BOTTOM, // 7. doorway bottom-left (off-screen)
  DOORWAY_X_LEFT,
  DOORWAY_Y_TOP, // 8. doorway top-left
  125,
  DOORWAY_Y_TOP, // 9. left wall, bottom
  125,
  394, // 10. left wall, top (end of top-left diagonal)
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
  // Map board — second stationary interactable north of the terminal.
  // Opens a full-screen route map modal when the player presses E.
  private mapBoardInteractPos?: Phaser.Math.Vector2;
  private readonly MAPBOARD_INTERACT_RANGE = 80;
  private mapBoardPromptText?: Phaser.GameObjects.Text;
  // Relay Board — third stationary interactable on the north wall.
  // Opens LeaderboardScene on E; returns back to Lobby on exit.
  private relayBoardInteractPos?: Phaser.Math.Vector2;
  private readonly RELAYBOARD_INTERACT_RANGE = 80;
  private relayBoardPromptText?: Phaser.GameObjects.Text;
  // Lobby NPCs — patrolling recruitables + passive crew. Each entry owns
  // its sprite, patrol loop, proximity prompt, and collision rect.
  // Refreshing this list is where new NPCs land.
  private npcs: NpcAgent[] = [];
  // Top-right HUD showing current VIP + crew roster. Re-renders when
  // recruits change (e.g. after an NPC dialogue closes).
  private crewHud?: CrewHud;
  // Portal trigger one-shot — flips true the frame the player's feet cross
  // PORTAL_TRIGGER_Y inside the doorway. Blocks the redirect from firing
  // every frame while the location-change is in flight.
  private portalTriggered = false;
  // Ref URL from inbound ?ref= param. Populated only when the player
  // arrived via the webring. Used to render a RETURN portal in the
  // left half of the doorway and redirect there instead of to vibejam.cc.
  private portalRefUrl?: string;
  // Mobile SELECT button visuals — shown only when an interactable is
  // in range OR the party is full (enabling the deploy shortcut).
  // Hidden otherwise so the button doesn't advertise a no-op tap.
  private mobileSelectBg?: Phaser.GameObjects.Arc;
  private mobileSelectLabel?: Phaser.GameObjects.Text;

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
    this.mapBoardInteractPos = undefined;
    this.mapBoardPromptText = undefined;
    this.relayBoardInteractPos = undefined;
    this.relayBoardPromptText = undefined;
    this.crewHud = undefined;
    this.portalTriggered = false;
    this.portalRefUrl = undefined;
    this.mobileSelectBg = undefined;
    this.mobileSelectLabel = undefined;

    // Capture inbound ?ref= ONCE on create — if the player arrived via the
    // webring with a back-ref, we render a return portal alongside the exit.
    const portalParams = getPortalParams();
    if (portalParams.portal && portalParams.ref) {
      this.portalRefUrl = portalParams.ref;
    }

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

    // Interaction handlers used both by keyboard (E/Enter/Space) and by
    // click-to-interact. Defined up-front so prop/NPC creation below can
    // wire pointerdown handlers referencing them.
    const openTerminal = () => {
      // Pause (not stop) the Lobby so NPC patrol state, player
      // position, music, etc. survive and resume cleanly on ESC.
      this.scene.pause();
      this.scene.launch('PartySelectTerminal');
    };
    const openMap = () => openMapModal(this);

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
    const terminalImg = this.add
      .image(terminalX, terminalFeetY, 'lobby-terminal')
      .setOrigin(0.5, 1)
      .setScale(TERMINAL_SCALE)
      .setDepth(terminalFeetY)
      .setInteractive();
    this.wireClickInteract(
      terminalImg,
      () => this.terminalPromptText?.visible === true,
      () => openTerminal(),
    );
    // Obstacle rect extends:
    // - ~30px BELOW the terminal's visible base so when the player walks
    //   up from the south they stop at roughly the keyboard level —
    //   reads as "standing in front of the monitor with handxs at the
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

    // Planter bed — decorative only. Sits against the top-right section
    // against the south wall (walkable polygon bottom at y=656 outside
    // the doorway), right side of the room.
    this.spawnPlanter(885, 690, 0.85);
    // Communal table + stools, centered horizontally with the planter
    // and well clear of the doorway path (doorway x=581-699).
    this.spawnTable(890, 540);
    // Workbench flush against the left wall. Sprite is the vertical
    // wall-oriented variant (66×141 content) so feet_x sits close to
    // the left wall at x=125.
    this.spawnWorkbench(150, 650);
    // Side table + radio tucked against the top-right wall, just below
    // the planter. Radio sits on the lid.
    this.spawnSideTableWithRadio(1000, 350, 0.85);
    // 128×199 native; tall narrow silhouette scales
    // cleanly at 0.5 (integer divisor → crisp nearest-neighbor).
    this.spawnSupplyShelf(830, 325, 0.9);
    // Freestanding punching bag on the walkable floor just LEFT of the
    // doorway (doorway x-range 581-699). Decor only — pairs with the
    // Vanguard's punchingbag NPC idle animation so training gear is
    // visible even when the player is the Vanguard.
    this.spawnPunchingBag(350, 650);
    // Meditation cushion underneath the Cybermonk NPC (spawned at
    // (680, 400) sprite-center, feet ~y=434). Cushion feet a bit below
    // those so the cushion visibly sits on the floor with the monk
    // perched on top. Depth pinned to the cushion's TOP so the monk
    // y-sorts on top of it naturally.
    this.spawnCushion(1100, 430);
    // Square centerpiece planter — axis-aligned with the doorway
    // (doorway center x=640) so it reads as the room's focal point.
    // Sits between the monk/cushion area (which ends ~y=360) and the
    // doorway opening (y=656+), leaving walking corridors on either side.
    this.spawnSquarePlanter(640, 545, 1);
    // Interaction anchor = keyboard level (a bit south of the terminal's
    // base so the range centers on where the player stands to interact).
    this.terminalInteractPos = new Phaser.Math.Vector2(terminalX, terminalFeetY + 20);
    // Floating "▲ E" prompt above the terminal. Hidden until the player
    // is within range. Bobs gently up-and-down on a ping-pong tween.
    this.terminalPromptText = this.add
      .text(terminalX, terminalFeetY - Math.round(TERMINAL_DISPLAY_H) - 14, interactPromptText(), {
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

    // Map board — hanging on the north wall to the right of the terminal.
    // Interactive: E/Enter/Space opens a full-screen route map modal.
    // Sprite is 270×270 native; content bbox (0, 22, 270, 247) → visible
    // 270×225. Scale 0.5 is an integer divisor (crisp nearest-neighbor
    // downsample) → displayed 135×112 visible area.
    const MAPBOARD_SCALE = 0.5;
    const MAPBOARD_DISPLAY_H = 270 * MAPBOARD_SCALE;
    const mapBoardX = 395;
    const mapBoardFeetY = 340;
    const mapBoardImg = this.add
      .image(mapBoardX, mapBoardFeetY, 'lobby-mapboard')
      .setOrigin(0.5, 1)
      .setScale(MAPBOARD_SCALE)
      .setDepth(mapBoardFeetY)
      .setInteractive();
    this.wireClickInteract(
      mapBoardImg,
      () => this.mapBoardPromptText?.visible === true,
      () => openMap(),
    );
    // Collision rect covers the visible board footprint so the player
    // can't clip into the wall art. Extended south so they stop a few
    // px below the board's base — reads as "reading the map".
    const MAPBOARD_COLL_W = 120;
    const MAPBOARD_COLL_H = 90;
    const MAPBOARD_COLL_EXTEND_DOWN = 15;
    this.obstacles.push(
      new Phaser.Geom.Rectangle(
        mapBoardX - MAPBOARD_COLL_W / 2,
        mapBoardFeetY - MAPBOARD_COLL_H,
        MAPBOARD_COLL_W,
        MAPBOARD_COLL_H + MAPBOARD_COLL_EXTEND_DOWN,
      ),
    );
    this.mapBoardInteractPos = new Phaser.Math.Vector2(mapBoardX, mapBoardFeetY + 20);
    this.mapBoardPromptText = this.add
      .text(mapBoardX, mapBoardFeetY - Math.round(MAPBOARD_DISPLAY_H) + 10, interactPromptText(), {
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
      targets: this.mapBoardPromptText,
      y: this.mapBoardPromptText.y - 4,
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Relay Board — Opens the
    // global leaderboard. Sprite is 166×166 native, opaque content bbox
    // (23, 0, 143, 166) → visible 120×166. Scale 0.5 → displayed 60×83
    // visible area, matching the mapboard's visual weight.
    const RELAYBOARD_SCALE = 1.0;
    const RELAYBOARD_DISPLAY_H = 166 * RELAYBOARD_SCALE;
    const relayBoardX = 640;
    const relayBoardFeetY = 340;
    const openLeaderboard = () => {
      setLastPlayerPose({
        x: this.player.x,
        y: this.player.y,
        facing: this.playerFacing,
      });
      this.scene.start('Leaderboard', { returnScene: 'Lobby' });
    };
    const relayBoardImg = this.add
      .image(relayBoardX, relayBoardFeetY, 'lobby-relayboard')
      .setOrigin(0.5, 1)
      .setScale(RELAYBOARD_SCALE)
      .setDepth(relayBoardFeetY)
      .setInteractive();
    this.wireClickInteract(
      relayBoardImg,
      () => this.relayBoardPromptText?.visible === true,
      () => openLeaderboard(),
    );
    // Collision covers the board + cabinet base. Extended south so
    // the player stops a few px below the cabinet — reads as
    // "reading the board". Extended up + sideways so the full visible
    // silhouette blocks the player instead of just the cabinet base.
    const RELAYBOARD_COLL_W = 70;
    const RELAYBOARD_COLL_H = 80;
    const RELAYBOARD_COLL_EXTEND_DOWN = 15;
    const RELAYBOARD_COLL_EXTEND_UP = 40;
    const RELAYBOARD_COLL_EXTEND_SIDES = 20;
    this.obstacles.push(
      new Phaser.Geom.Rectangle(
        relayBoardX - RELAYBOARD_COLL_W / 2 - RELAYBOARD_COLL_EXTEND_SIDES,
        relayBoardFeetY - RELAYBOARD_COLL_H - RELAYBOARD_COLL_EXTEND_UP,
        RELAYBOARD_COLL_W + RELAYBOARD_COLL_EXTEND_SIDES * 2,
        RELAYBOARD_COLL_H + RELAYBOARD_COLL_EXTEND_UP + RELAYBOARD_COLL_EXTEND_DOWN,
      ),
    );
    this.relayBoardInteractPos = new Phaser.Math.Vector2(relayBoardX, relayBoardFeetY + 20);
    this.relayBoardPromptText = this.add
      .text(
        relayBoardX,
        relayBoardFeetY - Math.round(RELAYBOARD_DISPLAY_H) + 10,
        interactPromptText(),
        {
          fontFamily: FONT,
          fontSize: '16px',
          color: '#8aff8a',
          stroke: '#000000',
          strokeThickness: 3,
        },
      )
      .setOrigin(0.5, 1)
      .setDepth(99998)
      .setVisible(false);
    this.tweens.add({
      targets: this.relayBoardPromptText,
      y: this.relayBoardPromptText.y - 4,
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
    // If we have a saved pose (e.g. we just returned from Leaderboard),
    // restore it instead of snapping to the doorway. Pose is stored as
    // the raw sprite x/y (already includes the displayHeight offset),
    // so we don't re-apply the feet→center shift.
    const savedPose = getLobbyState().lastPlayerPose;
    const scale = LOBBY_SCALE[this.leaderKey] ?? DEFAULT_PLAYER_SCALE;
    const startFacing = savedPose?.facing ?? 'north';
    this.playerFacing = startFacing;
    this.player = this.add
      .sprite(
        savedPose?.x ?? SPAWN_X,
        savedPose?.y ?? SPAWN_FEET_Y,
        this.idleTextureKey(startFacing),
      )
      .setScale(scale);
    if (!savedPose) {
      this.player.y = SPAWN_FEET_Y - this.player.displayHeight * 0.25;
    } else {
      // Consume the pose — next fresh entry to Lobby spawns at the doorway.
      setLastPlayerPose(null);
    }
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    this.spawnNpcs();

    this.drawPortals();

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
    const tryInteract = () => {
      if (isDialogueOpen() || isMapOpen()) return;
      const feetYOffset = this.player.displayHeight * 0.25;
      const feetX = this.player.x;
      const feetY = this.player.y + feetYOffset;

      // Terminal takes priority over NPCs when both are in range — the
      // terminal is the deploy gate, and players hugging an NPC near it
      // shouldn't have to step away to get to the run.
      if (this.isPlayerNearTerminal()) {
        openTerminal();
        return;
      }

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
      if (this.isPlayerNearMapBoard() && this.mapBoardInteractPos) {
        const d2 =
          (feetX - this.mapBoardInteractPos.x) ** 2 + (feetY - this.mapBoardInteractPos.y) ** 2;
        if (!best || d2 < best.dist2) best = { run: openMap, dist2: d2 };
      }
      if (this.isPlayerNearRelayBoard() && this.relayBoardInteractPos) {
        const d2 =
          (feetX - this.relayBoardInteractPos.x) ** 2 + (feetY - this.relayBoardInteractPos.y) ** 2;
        if (!best || d2 < best.dist2)
          best = {
            run: () => {
              setLastPlayerPose({
                x: this.player.x,
                y: this.player.y,
                facing: this.playerFacing,
              });
              this.scene.start('Leaderboard', { returnScene: 'Lobby' });
            },
            dist2: d2,
          };
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
    this.maybeCreateMobileHud(tryInteract);

    installPauseMenuEsc(this, {
      shouldBlockEsc: () => isDialogueOpen() || isMapOpen() || isBriefingOpen(),
    });

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
      ((navigator.maxTouchPoints ?? 0) > 0 || window.matchMedia?.('(pointer: coarse)').matches);
    if (!isTouch) return;

    const { height } = this.scale;
    const x = 120;
    const y = height - 120;
    const radius = 70;
    const base = this.add.circle(0, 0, radius, 0x0a1820, 0.5).setStrokeStyle(3, 0x6a7fad, 0.8);
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

  /**
   * On touch devices, paint the mobile HUD: a circular SELECT button in
   * the bottom-right (mirrors the joystick) that runs the same
   * closest-wins interact dispatch the E key triggers, plus a MENU
   * button in the top-right that opens the shared pause menu (since
   * touch devices don't have ESC). Matches the CombatScene pattern.
   */
  private maybeCreateMobileHud(tryInteract: () => void): void {
    if (!isTouchDevice()) return;
    const { width, height } = this.scale;

    const selectX = width - 100;
    const selectY = height - 120;
    const selectRadius = 60;
    const selectBase = this.add
      .circle(selectX, selectY, selectRadius, 0x0a1820, 0.7)
      .setStrokeStyle(3, 0x8aff8a, 0.9)
      .setScrollFactor(0)
      .setDepth(9000)
      .setInteractive({ useHandCursor: true })
      .setVisible(false);
    const selectLabel = this.add
      .text(selectX, selectY, 'SELECT', {
        fontFamily: FONT,
        fontSize: '18px',
        color: '#8aff8a',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(9001)
      .setVisible(false);
    selectBase.on('pointerdown', () => {
      if (isPauseMenuOpen()) return;
      tryInteract();
    });
    this.mobileSelectBg = selectBase;
    this.mobileSelectLabel = selectLabel;

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
      .setScrollFactor(0)
      .setDepth(9001)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => {
        if (isDialogueOpen() || isMapOpen() || isBriefingOpen()) return;
        if (!isPauseMenuOpen()) openPauseMenu(this);
      });
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
    const left = !!this.cursorKeys.left?.isDown || this.wasd.A.isDown || !!this.joystick?.left;
    const right = !!this.cursorKeys.right?.isDown || this.wasd.D.isDown || !!this.joystick?.right;
    const up = !!this.cursorKeys.up?.isDown || this.wasd.W.isDown || !!this.joystick?.up;
    const down = !!this.cursorKeys.down?.isDown || this.wasd.S.isDown || !!this.joystick?.down;

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

    // Portal trigger — feet crossed the doorway threshold. Fire once,
    // fade camera, redirect. Split logic: if ?ref= was present on entry,
    // the LEFT half of the doorway returns to that ref; the RIGHT half
    // always exits to the Vibe Jam 2026 portal. Without a ref, the whole
    // doorway is the Vibe Jam exit. Gated behind isJamMode() — outside the
    // jam context the doorway is decorative only (no redirect).
    if (isJamMode()) {
      const feetXNow = this.player.x;
      const feetYNow = this.player.y + feetYOffset;
      if (
        !this.portalTriggered &&
        feetYNow >= PORTAL_TRIGGER_Y &&
        feetXNow >= DOORWAY_X_LEFT &&
        feetXNow <= DOORWAY_X_RIGHT
      ) {
        const midX = (DOORWAY_X_LEFT + DOORWAY_X_RIGHT) / 2;
        const useReturn = !!this.portalRefUrl && feetXNow < midX;
        this.firePortal(useReturn ? this.portalRefUrl! : this.exitPortalUrl());
      }
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
    // Prop prompts yield to NPC prompts when overlapping — e.g. standing
    // between Dr. Vey and the map board should only show Dr. Vey's "▼ E"
    // so the player isn't staring at two prompts with ambiguous priority.
    // Interact dispatcher (`tryInteract`) already picks the closest target,
    // so this is purely the visual half of that same rule.
    const anyNpcInRange = this.npcs.some((npc) => npc.isInInteractionRange(feetX, feetY));
    if (this.terminalPromptText) {
      this.terminalPromptText.setVisible(this.isPlayerNearTerminal() && !anyNpcInRange);
    }
    if (this.mapBoardPromptText) {
      this.mapBoardPromptText.setVisible(this.isPlayerNearMapBoard() && !anyNpcInRange);
    }
    if (this.relayBoardPromptText) {
      this.relayBoardPromptText.setVisible(this.isPlayerNearRelayBoard() && !anyNpcInRange);
    }

    // Mobile SELECT button: only visible when tapping it would actually
    // do something — any NPC / terminal / map board in range, or party
    // full so tapping fires the deploy-from-anywhere shortcut.
    if (this.mobileSelectBg && this.mobileSelectLabel) {
      const lobby = getLobbyState();
      const deployFallbackReady = !!lobby.leaderId && lobby.recruited.size >= 2;
      const canSelect =
        anyNpcInRange ||
        this.isPlayerNearTerminal() ||
        this.isPlayerNearMapBoard() ||
        this.isPlayerNearRelayBoard() ||
        deployFallbackReady;
      this.mobileSelectBg.setVisible(canSelect);
      this.mobileSelectLabel.setVisible(canSelect);
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
   * Wire a scene object (NPC sprite, terminal image, map board) for
   * click-to-interact. Click only triggers when `inRange()` — matches the
   * E/Enter/Space proximity gate. Cursor turns into a hand on hover only
   * when in range so the affordance mirrors the floating "▼ E" prompt.
   */
  private wireClickInteract(
    target: Phaser.GameObjects.GameObject,
    inRange: () => boolean,
    activate: () => void,
  ): void {
    target.on('pointerover', () => {
      if (inRange()) this.input.setDefaultCursor('pointer');
    });
    target.on('pointerout', () => this.input.setDefaultCursor(''));
    target.on('pointerdown', () => {
      if (isDialogueOpen() || isMapOpen()) return;
      if (!inRange()) return;
      activate();
    });
  }

  /** Mirror of `isPlayerNearTerminal` for the map board hanging next to it. */
  private isPlayerNearMapBoard(): boolean {
    if (!this.mapBoardInteractPos || !this.player) return false;
    const feetYOffset = this.player.displayHeight * 0.25;
    const dx = this.player.x - this.mapBoardInteractPos.x;
    const dy = this.player.y + feetYOffset - this.mapBoardInteractPos.y;
    return dx * dx + dy * dy <= this.MAPBOARD_INTERACT_RANGE * this.MAPBOARD_INTERACT_RANGE;
  }

  /** Same pattern — proximity check for the leaderboard relay board. */
  private isPlayerNearRelayBoard(): boolean {
    if (!this.relayBoardInteractPos || !this.player) return false;
    const feetYOffset = this.player.displayHeight * 0.25;
    const dx = this.player.x - this.relayBoardInteractPos.x;
    const dy = this.player.y + feetYOffset - this.relayBoardInteractPos.y;
    return dx * dx + dy * dy <= this.RELAYBOARD_INTERACT_RANGE * this.RELAYBOARD_INTERACT_RANGE;
  }

  /**
   * Spawn every NPC in the Greenhouse. Add to `npcs` + register each
   * NPC's collision rect with the scene obstacles. Adding a new NPC
   * here is 3-5 lines; the NpcAgent class handles everything else.
   */
  /**
   * Drop a raised planter bed prop at the given feet position. Non-
   * interactive decor; collision rect covers the visible wooden box
   * (foliage overflow is non-blocking — reads as leaves you can brush
   * past). Origin (0.5, 1) → y-sort depth = feetY, matching other
   * props + the player.
   */
  /**
   * Drop a small crate side table + a radio sitting on top of it.
   * The radio is not its own physical prop — it piggybacks on the
   * table's collision rect and gets a matching depth so it renders
   * on top of the crate.
   */
  private spawnSideTableWithRadio(feetX: number, feetY: number, scale = 1): void {
    // Side table — 90×90 native; content bbox (3, 0, 86, 89) = 83×89.
    // Top-surface (the crate lid) is roughly the upper ~28px of the
    // sprite, so in world coords the lid sits around feetY - 62*scale.
    this.add
      .image(feetX, feetY, 'lobby-sidetable')
      .setOrigin(0.5, 1)
      .setScale(scale)
      .setDepth(feetY);
    // Collision covers the whole visible crate footprint with a small
    // margin on each side + a bit of south extension so the player
    // stops in front of the table instead of merging into it.
    const crateW = Math.round(80 * scale);
    const crateH = Math.round(80 * scale);
    const extendDown = 10;
    const extendSides = 8;
    this.obstacles.push(
      new Phaser.Geom.Rectangle(
        feetX - crateW / 2 - extendSides,
        feetY - crateH,
        crateW + extendSides * 2,
        crateH + extendDown,
      ),
    );

    // Radio on the lid. 120×120 native; 0.5 × scale keeps it crisp
    // when the parent scale is 1 and shrinks proportionally otherwise.
    // Its feet sit at the lid line so it visibly rests on the crate.
    // Same depth as the table; added after so Phaser's creation-order
    // tiebreak draws it on top.
    const radioScale = 0.5 * scale;
    const radioFeetY = feetY - Math.round(62 * scale);
    this.add
      .image(feetX, radioFeetY, 'lobby-radio')
      .setOrigin(0.5, 1)
      .setScale(radioScale)
      .setDepth(feetY);
  }

  /**
   * Drop a freestanding punching bag prop at the given feet position.
   * Decor only. Sprite is 178×178 native with content bbox (56, 0, 122, 178)
   * — tall narrow silhouette centered on the canvas. Scale 0.7 keeps
   * it readably large next to the doorway without dominating the room.
   */
  /**
   * Drop a round meditation cushion prop at the given feet position.
   * Decor only (no collision) — pairs with the Cybermonk NPC's
   * seated meditation idle anim. Depth pinned to the cushion's TOP so
   * a character whose feet-y lands between the cushion's top and feet
   * — like the Cybermonk sitting on it — renders in front naturally.
   * Sprite is 160×160 native with content bbox (0, 24, 160, 136).
   */
  /**
   * Drop a square centerpiece planter prop at the given feet position.
   * Sprite is 166×166 native with content bbox (4, 0, 161, 166) —
   * nearly canvas-filling. Collision covers the wooden box footprint
   * with a small south extension so the player stops in front of it
   * rather than clipping into the rim.
   */
  /**
   * Drop a supply shelf prop on the north wall. Sprite is 128×199
   * native (content fills the canvas). Tall wall prop — depth set to
   * the top of the sprite so characters in front of it y-sort above,
   * matching the workbench pattern.
   */
  private spawnSupplyShelf(feetX: number, feetY: number, scale = 0.5): void {
    const contentH = Math.round(199 * scale);
    this.add
      .image(feetX, feetY, 'lobby-supply-shelf')
      .setOrigin(0.5, 1)
      .setScale(scale)
      .setDepth(feetY - contentH);
    // Collision narrow + tallish, covering the shelf footprint plus a
    // small south extension so the player stops in front rather than
    // clipping into the shelves.
    const w = Math.round(120 * scale);
    const h = Math.round(140 * scale);
    const extendDown = 10;
    const extendSides = 6;
    this.obstacles.push(
      new Phaser.Geom.Rectangle(
        feetX - w / 2 - extendSides,
        feetY - h,
        w + extendSides * 2,
        h + extendDown,
      ),
    );
  }

  private spawnSquarePlanter(feetX: number, feetY: number, scale = 0.6): void {
    this.add
      .image(feetX, feetY, 'lobby-planter-square')
      .setOrigin(0.5, 1)
      .setScale(scale)
      .setDepth(feetY);
    // Collision covers the wooden box + most of the foliage but leaves
    // the top ~35 px of the sprite unblocked so the player can appear
    // to walk "behind" the tallest leaves without getting stopped
    // against an invisible wall at the full sprite height.
    const w = Math.round(157 * scale);
    const h = Math.round(120 * scale);
    const extendDown = 12;
    const extendSides = 14;
    this.obstacles.push(
      new Phaser.Geom.Rectangle(
        feetX - w / 2 - extendSides,
        feetY - h,
        w + extendSides * 2,
        h + extendDown,
      ),
    );
  }

  private spawnCushion(feetX: number, feetY: number, scale = 0.5): void {
    const contentH = Math.round(112 * scale);
    this.add
      .image(feetX, feetY, 'lobby-cushion')
      .setOrigin(0.5, 1)
      .setScale(scale)
      .setDepth(feetY - contentH);
    // Collision covers the cushion's visible footprint so the player
    // can't walk through it. Kept narrower than the full content bbox
    // since the cushion's silhouette is round — the corners are empty
    // pixels, and a rectangular block matching the full bbox would
    // feel wider than it looks.
    const collW = Math.round(120 * scale);
    const collH = Math.round(70 * scale);
    const extendDown = 6;
    const extendUp = 20;
    this.obstacles.push(
      new Phaser.Geom.Rectangle(
        feetX - collW / 2,
        feetY - collH - extendUp,
        collW,
        collH + extendUp + extendDown,
      ),
    );
  }

  private spawnPunchingBag(feetX: number, feetY: number, scale = 0.7): void {
    // Depth set to the TOP of the bag rather than its feet so the bag
    // y-sorts as a tall standing prop — characters standing near it (the
    // Vanguard NPC swinging at it, the player walking past) naturally
    // render above it. Using feet-y as depth would force them behind
    // since their feet land ABOVE the bag's base line on screen. Same
    // pattern as spawnWorkbench.
    const contentH = Math.round(178 * scale);
    this.add
      .image(feetX, feetY, 'lobby-punchingbag')
      .setOrigin(0.5, 1)
      .setScale(scale)
      .setDepth(feetY - contentH);
    // Collision covers just the weighted BASE + a bit of south extension
    // so the player stops in front of the bag rather than clipping into
    // the weighted disc.
    const baseW = Math.round(44 * scale);
    const baseH = Math.round(28 * scale);
    const extendDown = 10;
    const extendSides = 6;
    this.obstacles.push(
      new Phaser.Geom.Rectangle(
        feetX - baseW / 2 - extendSides,
        feetY - baseH,
        baseW + extendSides * 2,
        baseH + extendDown,
      ),
    );
  }

  /**
   * Drop the scavenger's workbench prop at the given feet position.
   * Non-interactive decor. Sized to sit against the top-right diagonal
   * wall, mirroring the terminal's top-left corner.
   * rotation is in radians. Caveat: pixel art rotation through Phaser
   * uses subpixel sampling, so any non-zero rotation will soften edges.
   */
  private spawnWorkbench(feetX: number, feetY: number, scale = 1, rotation = 0): void {
    // Sprite is 142×142 native — VERTICAL (wall-oriented) bench with
    // content bbox (38, 0, 104, 141) = 66×141, tall and narrow.
    // Depth is set to the TOP of the bench rather than its feet so
    // the workbench y-sorts as a wall prop — characters standing in
    // front of it (scavenger NPC, the player) naturally render above
    // it without needing a depthOverride. Using its own feet-y would
    // force characters behind, since their feet land ABOVE the bench's
    // base line on screen.
    const contentH = Math.round(141 * scale);
    this.add
      .image(feetX, feetY, 'lobby-workbench')
      .setOrigin(0.5, 1)
      .setScale(scale)
      .setRotation(rotation)
      .setDepth(feetY - contentH);
    const w = Math.round(66 * scale);
    const h = Math.round(130 * scale);
    const extendDown = 15;
    const extendUp = 10;
    const extendSides = 14;
    this.obstacles.push(
      new Phaser.Geom.Rectangle(
        feetX - w / 2 - extendSides,
        feetY - h - extendUp,
        w + extendSides * 2,
        h + extendUp + extendDown,
      ),
    );
  }

  /**
   * Drop the communal table + stools prop at the given feet position.
   * Non-interactive decor; collision rect covers the full table +
   * nearest stools footprint so the player walks around the whole
   * dining setup rather than clipping through the stools.
   */
  private spawnTable(feetX: number, feetY: number, scale = 1): void {
    // Sprite is 142×142 native with content bbox (0, 8, 142, 133) —
    // so nearly full-canvas. Round table with 4 stools around it.
    this.add.image(feetX, feetY, 'lobby-table').setOrigin(0.5, 1).setScale(scale).setDepth(feetY);
    const w = Math.round(130 * scale);
    const h = Math.round(100 * scale);
    const extendDown = 12;
    const extendUp = 20;
    const extendSides = 20;
    this.obstacles.push(
      new Phaser.Geom.Rectangle(
        feetX - w / 2 - extendSides,
        feetY - h - extendUp,
        w + extendSides * 2,
        h + extendUp + extendDown,
      ),
    );
  }

  private spawnPlanter(feetX: number, feetY: number, scale = 0.7): void {
    // Sprite is 194×194 native; content bbox (0, 34, 194, 160), so
    // the visible image is 194×126 with the wood box in the bottom
    // half. 0.5× is an integer divisor → clean nearest-neighbor
    // downsample, no blur.
    this.add
      .image(feetX, feetY, 'lobby-planter-bed')
      .setOrigin(0.5, 1)
      .setScale(scale)
      .setDepth(feetY);
    // Collision covers the wood-box footprint AND extends a bit past
    // every side — so the player can't squeak past the ends and
    // stops a comfortable distance in front when approaching from
    // below, reading as "standing next to it" rather than merged.
    const w = Math.round(170 * scale);
    const h = Math.round(44 * scale);
    const extendDown = 20;
    const extendUp = 45;
    const extendSides = 24;
    this.obstacles.push(
      new Phaser.Geom.Rectangle(
        feetX - w / 2 - extendSides,
        feetY - h - extendUp,
        w + extendSides * 2,
        h + extendUp + extendDown,
      ),
    );
  }

  private spawnNpcs(): void {
    // Skip spawning an NPC when the player IS that class — the player
    // can't recruit themselves, and a duplicate of their sprite standing
    // in the room reads as a glitch. Future: swap to a different class
    // filling that slot instead of leaving the spot empty.
    const playerIs = (classId: string) => this.leaderKey === classId;

    // Dr. Vey — the VIP. Non-recruitable, always present (only one
    // VIP exists for now and it's fixed to Dr. Vey; no way to swap
    // VIPs in the lobby yet). Stands south-facing just to the right
    // of the map board so they're visible on the player's natural path
    // from the doorway up toward the terminal. Stats + lore are passed
    // explicitly since Dr. Vey isn't in CLASSES.
    const drVey = new NpcAgent(this, {
      classId: 'drvey',
      x: 510,
      y: 290,
      initialFacing: 'south',
      recruitable: false,
      displayName: 'DR. VEY',
      customStatLine: `HP 35`,
      collisionExtend: { top: 20, bottom: 20 },
      customLore:
        'Scientist. Two months of field observations on AI patrol pattern shifts — the data the survivor network has been waiting on.',
      greetingLines: [
        'My research has to reach the tower. Findings on AI patrol pattern shifts.',
        "I've been trying to get this data to the Relay for two months. Don't let me die on this road.",
        "Whenever you and your crew are ready, I'll be right behind you.",
        "I can't make this walk alone. You say go, I go.",
      ],
    });
    this.npcs.push(drVey);
    this.obstacles.push(drVey.collisionRect);

    // Medic — test patrol on the right side of the room.
    if (!playerIs('medic')) {
      this.registerWalkAnims('medic');
      const medic = new NpcAgent(this, {
        classId: 'medic',
        x: 1050,
        y: 525,
        patrolAxis: 'vertical',
        patrolRange: 50,
        speed: 50,
        pauseMs: 1500,
        recruitable: true,
        // Medic's 104-canvas sprite puts the head slightly below the
        // default 0.25-displayHeight inference — nudge the prompt down
        // so it sits right above the medic's hat.
        promptYAdjust: 12,
        greetingLines: [
          "Patch kit's topped off. You need a medic, I'm your medic.",
          "Someone's gotta stitch you up when the drones start thinking. Might as well be me.",
          "I brought the clinic with me in three bags. Say the word and they're on your back.",
          "Three seasons of filters bought me this spot. I'm not sitting the run out.",
        ],
        alreadyRecruitedLines: [
          "Ready when you are. Let's not keep the relay waiting.",
          'Bags are packed, splints in the outer pocket. Whenever you call it.',
          "Been doing mobility drills for a week. My knee won't quit on us this time.",
        ],
      });
      this.npcs.push(medic);
      this.obstacles.push(medic.collisionRect);
    }

    // Scavenger — stationary at the workbench, facing west so she
    // reads as "working on the bench". No patrol. Plays the custom
    // 9-frame Workbench animation on loop.
    if (!playerIs('scavenger')) {
      this.registerWalkAnims('scavenger');
      const scavenger = new NpcAgent(this, {
        classId: 'scavenger',
        x: 200,
        y: 560,
        initialFacing: 'west',
        // Workbench juts out east of the scavenger's feet — extend the
        // collision rightward so the player can't walk through the
        // bench's east edge while approaching from the doorway. Small
        // top/bottom cushion so the player can't clip into the anim's
        // vertical silhouette either.
        collisionExtend: { top: 10, bottom: 10, right: 18 },
        // Workbench depth is now set to its TOP edge (see spawnWorkbench)
        // so natural y-sort handles both the scavenger AND the player
        // rendering in front of the bench. No depthOverride needed.
        recruitable: true,
        idleAnim: {
          textureKeyPrefix: 'scavenger-workbench-west',
          frameCount: 9,
          frameRate: 6,
        },
        greetingLines: [
          'Pulled this board out of a dead car uplink yesterday. Still warm.',
          'Stripped a tow rig last week. Still smelled like its driver.',
          'If it ran on pre-fall current, I can hotwire it. Usually.',
          "You want me on this run, say so. Otherwise I've got work.",
        ],
        alreadyRecruitedLines: [
          'Almost done here. Give me one more pass.',
          "Kit's sorted. Lock picks, cutter, two spare cells. Ready.",
          "Just taping this together. I'll sling it and follow.",
        ],
      });
      this.npcs.push(scavenger);
      this.obstacles.push(scavenger.collisionRect);
    }

    // Netrunner — stationary at his desk on the left wall, above the
    // scavenger. 9-frame typing animation has the chair, desk, and
    // laptop baked into every frame — no separate prop needed.
    if (!playerIs('netrunner')) {
      const netrunner = new NpcAgent(this, {
        classId: 'netrunner',
        x: 180,
        y: 430,
        initialFacing: 'west',
        recruitable: true,
        // Chair + desk + laptop are baked into the typing animation
        // and extend well past the netrunner's feet in every direction —
        // push collision outward on all sides so the player can't clip
        // through any part of the desk setup.
        collisionExtend: { top: 20, bottom: 16, left: 20, right: 20 },
        idleAnim: {
          textureKeyPrefix: 'netrunner-typing-west',
          frameCount: 9,
          frameRate: 6,
        },
        greetingLines: [
          'Protocol on this channel is older than me. Still listening though.',
          "I've mapped three Censor sweep loops out of this terminal. Feels good to have a target.",
          "Uplink's warm. Say the word and I'm walking it with you.",
          'They jailbroke my handset when I was nine. I owe the scene a walk like this.',
        ],
        alreadyRecruitedLines: [
          "Rig's packed. I'll close the session the moment we move.",
          'Just pushing the last sniffer to the archive. Ready.',
        ],
      });
      this.npcs.push(netrunner);
      this.obstacles.push(netrunner.collisionRect);
    }

    // Cybermonk — stationary cross-legged meditation in the top-right
    // of the room, facing south so the breathing loop reads to the
    // player as they approach from the doorway.
    if (!playerIs('cybermonk')) {
      this.registerWalkAnims('cybermonk');
      const cybermonk = new NpcAgent(this, {
        classId: 'cybermonk',
        x: 1100,
        y: 340,
        initialFacing: 'south',
        recruitable: true,
        // The cushion prop + monk's own collision rect push the player
        // further from his sprite center than the default 90 allows —
        // bump so the prompt activates when the player stops south of
        // the cushion.
        interactionRadius: 140,
        idleAnim: {
          textureKeyPrefix: 'cybermonk-meditate-south',
          frameCount: 8,
          frameRate: 6,
        },
        greetingLines: [
          "The Relay sings on its own frequency. I'm listening for the rhythm.",
          "Breath in, breath out. When you need me, I'll be ready.",
          "Hands are warm from the drum. They'll still be warm when we move.",
          'Eight minutes between Censor sweeps, in this cell. Useful to know.',
        ],
        alreadyRecruitedLines: [
          "Still here. Still centered. Walk when you're ready.",
          "The flurry comes easier when I'm rested. Almost there.",
        ],
      });
      this.npcs.push(cybermonk);
      this.obstacles.push(cybermonk.collisionRect);
    }

    // Vanguard — stationary punching-bag drill in the right-center
    // "training" area between the planter and the medic's patrol lane.
    // 9-frame west-facing loop; the bag is baked into the sprite so no
    // separate prop is needed. Scale 1.6 matches the player's Vanguard
    // size (LOBBY_SCALE.vanguard) so the NPC and playable look alike.
    if (!playerIs('vanguard')) {
      this.registerWalkAnims('vanguard');
      const vanguardNpc = new NpcAgent(this, {
        classId: 'vanguard',
        x: 410,
        y: 590,
        initialFacing: 'west',
        recruitable: true,
        spriteScale: 1.6,
        // Vanguard's 136-canvas sprites have extra transparent space
        // above the character, so the default "0.25 × displayHeight
        // above center = head" assumption overshoots. Nudge the prompt
        // down to sit just above the helmet.
        promptYAdjust: 18,
        idleAnim: {
          textureKeyPrefix: 'vanguard-punchingbag-west',
          frameCount: 9,
          frameRate: 10,
        },
        greetingLines: [
          "Bag's been catching hits since the filter run last week. Keeps me sharp.",
          'When a shove comes for Dr. Vey on the road, I want it landing on me, not them.',
          "Say go. I've been itching to do this on something that hits back.",
          'Three rounds in, three to go. You can pull me off the bag whenever.',
        ],
        alreadyRecruitedLines: [
          "Last reps. I'll be at the terminal when you are.",
          "Warmed up. Shield's on a hook by the door.",
        ],
      });
      this.npcs.push(vanguardNpc);
      this.obstacles.push(vanguardNpc.collisionRect);
    }

    // Click-to-interact for every NPC. Gated by prompt visibility so only
    // the closest in-range NPC responds — matches the E/Enter/Space flow
    // and keeps the hover cursor affordance in sync with the floating "▼ E".
    for (const npc of this.npcs) {
      npc.enableClickInteract(() => npc.isPromptVisible());
    }
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
    // When multiple NPCs are in range (e.g. Netrunner + Scavenger patrol
    // zones overlap), show the prompt for the closest one only. Mirrors
    // `tryInteract`'s "closest wins" rule so the visible prompt matches
    // which NPC E/Enter/Space would actually activate.
    let closest: NpcAgent | null = null;
    let closestDist2 = Infinity;
    for (const npc of this.npcs) {
      if (!npc.isInInteractionRange(playerFeetX, playerFeetY)) {
        npc.setPromptVisible(false);
        continue;
      }
      const rect = npc.collisionRect;
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      const d2 = (playerFeetX - cx) ** 2 + (playerFeetY - cy) ** 2;
      if (d2 < closestDist2) {
        closestDist2 = d2;
        closest = npc;
      }
    }
    for (const npc of this.npcs) {
      npc.setPromptVisible(npc === closest);
    }
  }

  /**
   * Absolute URL of THIS deployed game, stripped of any query string so
   * the next Vibe Jam destination can store a clean `ref` back to us.
   */
  private exitPortalUrl(): string {
    const ourRef =
      typeof window !== 'undefined' ? window.location.origin + window.location.pathname : '';
    const def = CLASSES[this.leaderKey];
    return buildPortalExitUrl({
      ourRef,
      leaderClassId: def?.personName ?? this.leaderKey,
    });
  }

  /**
   * Redirect the browser to the given portal URL. Sets the one-shot
   * guard first so movement-loop ticks between now and navigation don't
   * stack redirects. Kept tiny on purpose — the browser's own nav takes
   * over visually.
   */
  private firePortal(url: string): void {
    this.portalTriggered = true;
    // Brief camera flash helps mask the navigation gap.
    this.cameras.main.flash(250, 120, 220, 255);
    // Defer the actual nav by one tick so the flash starts rendering.
    this.time.delayedCall(120, () => {
      if (typeof window !== 'undefined') window.location.href = url;
    });
  }

  /**
   * Draw the portal visuals on top of the doorway. Always renders the
   * Vibe Jam exit portal (right half if a return portal is present,
   * full width otherwise). If the player arrived via `?ref=<url>`, adds
   * a return portal on the left half styled differently so they're
   * visually distinguishable at a glance.
   */
  private drawPortals(): void {
    // Outside jam mode (no ?jam=1 / ?portal=true): doorway is decorative,
    // no portal overlay. Keeps the standalone build clean.
    if (!isJamMode()) return;
    const hasReturn = !!this.portalRefUrl;
    const midX = (DOORWAY_X_LEFT + DOORWAY_X_RIGHT) / 2;

    // Exit portal (Vibe Jam) — cyan/magenta pulse.
    const exitLeftX = hasReturn ? midX : DOORWAY_X_LEFT;
    this.paintPortalZone(
      exitLeftX,
      DOORWAY_Y_TOP,
      DOORWAY_X_RIGHT - exitLeftX,
      DOORWAY_Y_BOTTOM - DOORWAY_Y_TOP,
      0xff66ff,
      'VIBE JAM ▼',
    );

    if (hasReturn) {
      this.paintPortalZone(
        DOORWAY_X_LEFT,
        DOORWAY_Y_TOP,
        midX - DOORWAY_X_LEFT,
        DOORWAY_Y_BOTTOM - DOORWAY_Y_TOP,
        0x66ffcc,
        'RETURN ▼',
      );
    }
  }

  /**
   * Paint a single portal zone — label-only. The doorway opening in the
   * bg art is already the visual cue; a floating label above it tells
   * the player what walking through it does. Pulses on alpha so it
   * reads as active without painting over the floor. Trigger logic
   * lives in update().
   */
  private paintPortalZone(
    x: number,
    y: number,
    w: number,
    _h: number,
    colorHex: number,
    label: string,
  ): void {
    const labelY = y - 8;
    const text = this.add
      .text(x + w / 2, labelY, label, {
        fontFamily: FONT,
        fontSize: '22px',
        color: '#ffffff',
        stroke: `#${colorHex.toString(16).padStart(6, '0')}`,
        strokeThickness: 5,
      })
      .setOrigin(0.5, 1)
      .setDepth(99997);
    // Matches the terminal's "▼ E" prompt bob — gentle 4px ping-pong.
    this.tweens.add({
      targets: text,
      y: labelY - 4,
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
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
  }
}
