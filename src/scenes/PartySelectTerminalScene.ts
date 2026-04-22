import * as Phaser from 'phaser';
import { CLASSES, CLASS_ORDER } from '../data/classes';
import { FONT, isTouchDevice } from '../util/ui';
import { playMusicPool } from '../util/music';
import { playSfx } from '../util/audio';
import { installPauseMenuEsc } from '../util/pauseMenu';
import { getLobbyState, toggleRecruit, getResolvedParty } from '../state/lobby';

/**
 * Terminal-styled variant of PartySelectScene — same mechanics, diegetic
 * CRT look-and-feel so the transition from walking into the lobby
 * terminal to this screen reads as "you are now looking at the terminal's
 * display." Scene key 'PartySelectTerminal' so the original scene can
 * coexist as a fallback while we iterate.
 *
 * Visual treatment:
 * - Deep dark green-black background (CRT off state)
 * - Faint horizontal scanlines overlay
 * - Cyan-green palette replacing the gold/white accents
 * - Thick bezel border framing the content as "on a screen"
 * - Brief boot-flicker on scene enter
 * - Terminal prompt header with a blinking cursor
 */
export class PartySelectTerminalScene extends Phaser.Scene {
  // True when the scene is exiting via ESC (back to the Lobby). Signals
  // the SHUTDOWN hook to leave the Lobby running. Any OTHER exit path
  // (Deploy, pause menu → Title, etc.) leaves this false so the hook
  // stops the orphaned paused Lobby.
  private headingBackToLobby = false;
  // Set true when transitioning to RouteMap so the SHUTDOWN hook leaves
  // the paused Lobby in place. Otherwise RouteMap→Back returns us to a
  // terminal with no Lobby to disconnect to, and the player teleports
  // to the doorway spawn point (because scene.start('Lobby') re-creates
  // the scene instead of resuming it).
  private headingToRouteMap = false;
  private portraits = new Map<string, Phaser.GameObjects.Image>();
  // Hit-area anchors (invisible). Used for pointer hover/click tracking
  // and to drive bracket-corner rendering via cardBrackets.
  private selectionHints = new Map<string, Phaser.GameObjects.Rectangle>();
  // Per-card ASCII-style L-bracket corner graphics. Redrawn whenever
  // selection state changes — brackets replace what used to be the
  // card's outline + fill rectangle.
  private cardBrackets = new Map<string, Phaser.GameObjects.Graphics>();
  private leaderBadges = new Map<string, Phaser.GameObjects.Text>();
  private confirmButton?: Phaser.GameObjects.Text;
  private statusText?: Phaser.GameObjects.Text;
  // Keyboard focus: 0..CLASS_ORDER.length-1 = portraits, CLASS_ORDER.length
  // = confirm button, -1 = no focus (initial state, before any input).
  private focusedIndex = -1;
  // Focus bracket overlay — redrawn each time focus moves.
  private focusBrackets?: Phaser.GameObjects.Graphics;

  constructor() {
    super('PartySelectTerminal');
  }

  create(): void {
    const lobby = getLobbyState();
    if (!lobby.leaderId) {
      this.scene.start('LeaderSelect');
      return;
    }

    this.portraits.clear();
    this.selectionHints.clear();
    this.leaderBadges.clear();

    playMusicPool(this, ['music-lobby-theme'], 0.35);

    const { width, height } = this.scale;
    // Deep dark CRT background — slightly green-tinted so the phosphor
    // glow reads correctly against it.
    this.cameras.main.setBackgroundColor('#051410');

    this.drawScanlines(width, height);
    this.drawBezel(width, height);

    // Terminal prompt header with blinking cursor.
    this.add
      .text(60, 32, '> RELAY_UPLINK --MANIFEST', {
        fontFamily: FONT,
        fontSize: '19px',
        color: '#8aff8a',
      })
      .setOrigin(0, 0);
    const cursor = this.add
      .text(60 + 315, 32, '_', {
        fontFamily: FONT,
        fontSize: '19px',
        color: '#8aff8a',
      })
      .setOrigin(0, 0);
    this.tweens.add({
      targets: cursor,
      alpha: 0,
      duration: 500,
      yoyo: true,
      repeat: -1,
    });

    this.add
      .text(width / 2, 90, 'ASSEMBLE THE PARTY', {
        fontFamily: FONT,
        fontSize: '48px',
        color: '#8affaa',
      })
      .setOrigin(0.5);

    // Dr. Vey is the fixed VIP for v1 (VIP selection deferred).
    // Shown on the terminal manifest so the player knows who they're
    // transporting — reinforces the "this is a real courier mission"
    // framing from the worldbuilding.
    this.add
      .text(width / 2, 134, 'VIP: DR. VEY', {
        fontFamily: FONT,
        fontSize: '18px',
        color: '#ffcc66',
      })
      .setOrigin(0.5);

    this.add
      .text(
        width / 2,
        162,
        `LEADER: ${CLASSES[lobby.leaderId].personName.toUpperCase()} — recruit 2 companions`,
        {
          fontFamily: FONT,
          fontSize: '18px',
          color: '#4a8a6a',
        },
      )
      .setOrigin(0.5);

    const CARD_W = 220;
    const CARD_H = 330;
    // 250 spacing with 220 cards = 30px gap between neighbors; prevents
    // stat text from one card bleeding into the next.
    const rosterSpacing = 250;
    const rosterStartX = width / 2 - (rosterSpacing * (CLASS_ORDER.length - 1)) / 2;
    const rosterY = height / 2 - 10;
    CLASS_ORDER.forEach((key, i) => {
      const x = rosterStartX + i * rosterSpacing;
      const def = CLASSES[key];
      const isLeader = key === lobby.leaderId;

      // Invisible hit-area rect covering the ENTIRE card. Hover + click
      // land on the whole card surface (not just the portrait), which
      // matches the visual affordance of the bracket frame.
      const hint = this.add
        .rectangle(x, rosterY, CARD_W, CARD_H, 0, 0)
        .setInteractive({ useHandCursor: !isLeader });
      hint.on('pointerover', () => this.setFocus(i));
      if (!isLeader) {
        hint.on('pointerup', () => this.onPortraitClick(key));
      }
      this.selectionHints.set(key, hint);
      const brackets = this.add.graphics();
      this.cardBrackets.set(key, brackets);

      const portrait = this.add.image(x, rosterY - 40, `${key}-south`).setScale(2.4);
      this.portraits.set(key, portrait);

      if (isLeader) {
        const badge = this.add
          .text(x, rosterY - 140, '[ LEADER ]', {
            fontFamily: FONT,
            fontSize: '22px',
            color: '#ffcc66',
          })
          .setOrigin(0.5);
        this.leaderBadges.set(key, badge);
      }

      // Personal name is the primary identifier on the card; role
      // (e.g. "Vanguard") sits below as a secondary subtitle.
      this.add
        .text(x, rosterY + 60, def.personName.toUpperCase(), {
          fontFamily: FONT,
          fontSize: '26px',
          color: '#a6ffc6',
        })
        .setOrigin(0.5);
      this.add
        .text(x, rosterY + 86, def.name.toUpperCase(), {
          fontFamily: FONT,
          fontSize: '14px',
          color: '#6aaa8a',
        })
        .setOrigin(0.5);

      const statLine = `HP ${def.hp}  SPD ${def.speed}${def.mp > 0 ? `  MP ${def.mp}` : ''}`;
      this.add
        .text(x, rosterY + 116, statLine, {
          fontFamily: FONT,
          fontSize: '16px',
          color: '#6aaa8a',
        })
        .setOrigin(0.5);
    });

    // Focus-bracket overlay. Redrawn whenever focus moves. Invisible
    // until first hover / nav key press so there's no default-selected
    // state on scene enter.
    this.focusBrackets = this.add.graphics().setDepth(500).setVisible(false);

    this.statusText = this.add
      .text(width / 2, height - 160, this.statusMessage(), {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#6aaa8a',
      })
      .setOrigin(0.5);

    this.confirmButton = this.add
      .text(width / 2, height - 100, '[ DEPLOY ]', {
        fontFamily: FONT,
        fontSize: '32px',
        color: '#2a4a3a',
        backgroundColor: '#0a1a14',
        padding: { x: 20, y: 10 },
      })
      .setOrigin(0.5);

    // On touch devices the `[ESC]` hint is meaningless — make the label
    // itself a tappable button, remove the bracket, and bump the font.
    const touchUi = isTouchDevice();
    const disconnectFire = (): void => {
      playSfx(this, 'sfx-menu-cancel', 0.3);
      this.headingBackToLobby = true;
      if (this.scene.isPaused('Lobby')) {
        this.scene.resume('Lobby');
        this.scene.stop();
      } else {
        this.scene.start('Lobby');
      }
    };
    const disconnectIdleColor = touchUi ? '#8affaa' : '#4a8a6a';
    const disconnectHoverColor = '#ffffff';
    const disconnectBtn = this.add
      .text(
        width / 2,
        touchUi ? height - 48 : height - 50,
        touchUi ? 'DISCONNECT' : '[ESC] DISCONNECT',
        {
          fontFamily: FONT,
          fontSize: touchUi ? '22px' : '16px',
          color: disconnectIdleColor,
          backgroundColor: touchUi ? '#0a2a1a' : undefined,
          padding: touchUi ? { x: 18, y: 10 } : undefined,
        },
      )
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    disconnectBtn.on('pointerover', () => disconnectBtn.setColor(disconnectHoverColor));
    disconnectBtn.on('pointerout', () => disconnectBtn.setColor(disconnectIdleColor));
    disconnectBtn.on('pointerup', disconnectFire);
    // `once` (not `on`) — a second ESC press during the same frame (or
    // before shutdown completes) would otherwise re-fire and race the
    // scene teardown.
    this.input.keyboard?.once('keydown-ESC', disconnectFire);
    // Keyboard nav. LEFT/RIGHT cycle between portraits; UP/DOWN switch
    // between portrait row and the confirm button. ENTER/SPACE/E
    // activates the focused item.
    this.input.keyboard?.on('keydown-LEFT', () => this.moveFocusPortrait(-1));
    this.input.keyboard?.on('keydown-A', () => this.moveFocusPortrait(-1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.moveFocusPortrait(1));
    this.input.keyboard?.on('keydown-D', () => this.moveFocusPortrait(1));
    this.input.keyboard?.on('keydown-DOWN', () => this.setFocus(CLASS_ORDER.length));
    this.input.keyboard?.on('keydown-S', () => this.setFocus(CLASS_ORDER.length));
    this.input.keyboard?.on('keydown-UP', () => this.setFocus(this.lastPortraitIndex()));
    this.input.keyboard?.on('keydown-W', () => this.setFocus(this.lastPortraitIndex()));
    const activate = () => this.activateFocused();
    this.input.keyboard?.on('keydown-ENTER', activate);
    this.input.keyboard?.on('keydown-SPACE', activate);
    this.input.keyboard?.on('keydown-E', activate);

    // Focus stays at -1 on scene enter — the focus marker only appears
    // once the player hovers a portrait or presses a nav key.
    this.refreshSelectionVisuals();
    this.refreshConfirmButton();

    this.playBootFlicker();

    installPauseMenuEsc(this);

    // Terminal launched as a parallel scene over a PAUSED Lobby. Any
    // exit that isn't the "ESC → resume Lobby" path (Deploy, Return to
    // Title from the pause menu, etc.) needs to tear down the Lobby
    // too — otherwise the paused scene leaks and keeps consuming
    // memory. The normal ESC path resumes the Lobby first, so by the
    // time SHUTDOWN fires it's no longer paused and this is a no-op.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // Only stop the paused Lobby if we're NOT planning to come back
      // to it (ESC path) and NOT transitioning to RouteMap (player
      // might hit Back to return here and then Disconnect — the Lobby
      // needs to still be paused for that round-trip to resume it).
      // Other exits (Deploy → Combat, Return to Title) leave both
      // flags false so we clean up the orphaned paused scene here.
      if (!this.headingBackToLobby && !this.headingToRouteMap && this.scene.isPaused('Lobby')) {
        this.scene.stop('Lobby');
      }
    });
  }

  /**
   * Remember the last portrait index the focus was on before moving to
   * the confirm button — so pressing UP/W from the button returns to
   * a sensible slot. Falls back to the first non-leader portrait.
   */
  private lastPortraitIndex(): number {
    const lobby = getLobbyState();
    if (this.focusedIndex < CLASS_ORDER.length) return this.focusedIndex;
    return CLASS_ORDER.findIndex((k) => k !== lobby.leaderId);
  }

  private moveFocusPortrait(delta: number): void {
    const lobby = getLobbyState();
    const n = CLASS_ORDER.length;
    // First interaction: seed focus on the first non-leader portrait,
    // ignoring the delta (this press "activates" focus without jumping).
    if (this.focusedIndex < 0) {
      const first = CLASS_ORDER.findIndex((k) => k !== lobby.leaderId);
      this.setFocus(first >= 0 ? first : 0);
      return;
    }
    // If currently on the confirm button, step back into the portrait row.
    let idx = this.focusedIndex >= n ? this.lastPortraitIndex() : this.focusedIndex;
    // Wrap within the portrait row, skipping the locked leader.
    for (let step = 0; step < n; step++) {
      idx = (idx + delta + n) % n;
      if (CLASS_ORDER[idx] !== lobby.leaderId) break;
    }
    this.setFocus(idx);
  }

  private setFocus(index: number): void {
    if (index === this.focusedIndex) return;
    this.focusedIndex = index;
    if (index >= 0) playSfx(this, 'sfx-menu-cancel', 0.25);
    this.refreshFocusMarker();
  }

  private refreshFocusMarker(): void {
    if (!this.focusBrackets) return;
    this.focusBrackets.clear();
    const n = CLASS_ORDER.length;
    let x: number;
    let y: number;
    let w: number;
    let h: number;
    if (this.focusedIndex < n) {
      const key = CLASS_ORDER[this.focusedIndex];
      const hint = this.selectionHints.get(key);
      if (!hint) {
        this.focusBrackets.setVisible(false);
        return;
      }
      // Match card bracket dimensions exactly so the white focus
      // brackets line up with the green card brackets, not inset or
      // padded.
      x = hint.x;
      y = hint.y;
      w = hint.width;
      h = hint.height;
    } else if (this.confirmButton) {
      const b = this.confirmButton;
      x = b.x;
      y = b.y;
      w = b.displayWidth + 8;
      h = b.displayHeight + 8;
    } else {
      this.focusBrackets.setVisible(false);
      return;
    }
    this.drawBrackets(this.focusBrackets, x, y, w, h, 22, 3, 0xffffff, 1);
    this.focusBrackets.setVisible(true);
  }

  /**
   * Draw four ASCII-style L-bracket corners around a rectangle centered
   * at (cx, cy). `len` is the length of each bracket arm; `thick` the
   * stroke width. Used for both per-card selection state and the focus
   * overlay.
   */
  private drawBrackets(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    w: number,
    h: number,
    len: number,
    thick: number,
    color: number,
    alpha: number,
  ): void {
    g.lineStyle(thick, color, alpha);
    const left = cx - w / 2;
    const right = cx + w / 2;
    const top = cy - h / 2;
    const bottom = cy + h / 2;
    // top-left
    g.beginPath();
    g.moveTo(left, top + len);
    g.lineTo(left, top);
    g.lineTo(left + len, top);
    g.strokePath();
    // top-right
    g.beginPath();
    g.moveTo(right - len, top);
    g.lineTo(right, top);
    g.lineTo(right, top + len);
    g.strokePath();
    // bottom-left
    g.beginPath();
    g.moveTo(left, bottom - len);
    g.lineTo(left, bottom);
    g.lineTo(left + len, bottom);
    g.strokePath();
    // bottom-right
    g.beginPath();
    g.moveTo(right - len, bottom);
    g.lineTo(right, bottom);
    g.lineTo(right, bottom - len);
    g.strokePath();
  }

  private activateFocused(): void {
    // No focus yet (player hasn't hovered or pressed a nav key) →
    // first press seeds focus on the first non-leader portrait instead
    // of activating.
    if (this.focusedIndex < 0) {
      this.moveFocusPortrait(0);
      return;
    }
    const lobby = getLobbyState();
    const n = CLASS_ORDER.length;
    if (this.focusedIndex < n) {
      const key = CLASS_ORDER[this.focusedIndex];
      if (key === lobby.leaderId) {
        playSfx(this, 'sfx-menu-cancel', 0.3);
        return;
      }
      this.onPortraitClick(key);
    } else {
      // Confirm button — only proceeds if the party is complete.
      if (getResolvedParty().length !== 3) {
        playSfx(this, 'sfx-menu-cancel', 0.3);
        return;
      }
      playSfx(this, 'sfx-menu-confirm', 0.5);
      this.headingToRouteMap = true;
      this.scene.start('RouteMap', { party: getResolvedParty() });
    }
  }

  /**
   * Faint horizontal scanline overlay across the whole screen.
   * Generated once as a graphics object; cheap, static — no per-frame cost.
   */
  private drawScanlines(width: number, height: number): void {
    const g = this.add.graphics().setDepth(10000);
    g.fillStyle(0x000000, 0.18);
    for (let y = 0; y < height; y += 3) {
      g.fillRect(0, y, width, 1);
    }
  }

  /**
   * Bezel: thick rounded border framing the content area so the whole
   * screen reads as "viewed through a monitor".
   */
  private drawBezel(width: number, height: number): void {
    const g = this.add.graphics().setDepth(10001);
    g.lineStyle(6, 0x2a5a3a, 0.9);
    g.strokeRoundedRect(8, 8, width - 16, height - 16, 12);
    // Inner highlight line for a subtle "inset screen" feel.
    g.lineStyle(1, 0x55aa77, 0.5);
    g.strokeRoundedRect(16, 16, width - 32, height - 32, 8);
  }

  /**
   * Brief CRT-style boot flicker on scene enter. Overlays a bright
   * green rectangle that fades out quickly, emulating the moment a
   * tube monitor powers on.
   */
  private playBootFlicker(): void {
    const { width, height } = this.scale;
    const flash = this.add
      .rectangle(width / 2, height / 2, width, height, 0x8aff8a, 0.5)
      .setDepth(10002);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 260,
      onComplete: () => flash.destroy(),
    });
  }

  private onPortraitClick(key: string): void {
    const lobby = getLobbyState();
    const isRecruited = lobby.recruited.has(key);
    if (!isRecruited && lobby.recruited.size >= 2) return;
    playSfx(this, 'sfx-menu-cancel', 0.3);
    toggleRecruit(key);
    this.refreshSelectionVisuals();
    this.refreshConfirmButton();
  }

  private refreshSelectionVisuals(): void {
    const lobby = getLobbyState();
    for (const key of CLASS_ORDER) {
      const hint = this.selectionHints.get(key);
      const portrait = this.portraits.get(key);
      const brackets = this.cardBrackets.get(key);
      if (!hint || !portrait || !brackets) continue;
      const isLeader = key === lobby.leaderId;
      const isRecruited = lobby.recruited.has(key);

      // Pick the bracket color + arm length based on state. Leader gets
      // amber; recruited gets bright cyan-green; unpicked gets a dim
      // green so the card is always framed but reads as "available".
      let color = 0x2a5a3a;
      let alpha = 0.8;
      let armLen = 18;
      if (isLeader) {
        color = 0xffcc66;
        alpha = 1;
        armLen = 22;
        portrait.clearTint();
      } else if (isRecruited) {
        color = 0x8affaa;
        alpha = 1;
        armLen = 22;
        portrait.clearTint();
      } else {
        portrait.setTint(0x7a9a8a);
      }

      brackets.clear();
      this.drawBrackets(brackets, hint.x, hint.y, hint.width, hint.height, armLen, 3, color, alpha);
    }
  }

  private statusMessage(): string {
    const party = getResolvedParty();
    return `> Selected ${party.length} / 3`;
  }

  private refreshConfirmButton(): void {
    if (!this.confirmButton || !this.statusText) return;
    this.statusText.setText(this.statusMessage());
    const ready = getResolvedParty().length === 3;
    if (ready) {
      this.confirmButton
        .setColor('#a6ffc6')
        .setBackgroundColor('#0a3a1f')
        .setInteractive({ useHandCursor: true })
        .removeAllListeners()
        .on('pointerup', () => {
          playSfx(this, 'sfx-menu-confirm', 0.5);
          // RouteMapScene is the current default route picker — the
          // older RouteScene (list-style) is preserved in the codebase
          // but not routed to by default. To re-enable the list-style
          // picker, swap the scene key back to 'Route'.
          this.headingToRouteMap = true;
          this.scene.start('RouteMap', { party: getResolvedParty() });
        });
    } else {
      this.confirmButton.setColor('#2a4a3a').setBackgroundColor('#0a1a14').disableInteractive();
    }
  }
}
