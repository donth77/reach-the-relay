import * as Phaser from 'phaser';
import { FONT } from '../util/ui';
import { CLASSES } from '../data/classes';
import {
  _seedLocalForTest,
  fetchTopScores,
  isRemoteConfigured,
  type LeaderboardRoute,
  type ScoreEntry,
} from '../state/leaderboard';
import { getUsername } from '../state/player';

// Filter tabs displayed at the top. `null` = "all routes" global board.
type FilterKey = 'all' | LeaderboardRoute;

interface Tab {
  key: FilterKey;
  label: string;
}

const TABS: Tab[] = [
  { key: 'all', label: 'ALL' },
  { key: 'long-highway', label: 'HIGHWAY' },
  { key: 'transit-line', label: 'MALL' },
  { key: 'direct-line', label: 'SUBSTATION' },
];

// Route label shown in the table rows + route-filter labels. Keep them
// concise — the table has to fit 1280px wide.
const ROUTE_LABEL: Record<LeaderboardRoute, string> = {
  'long-highway': 'HIGHWAY',
  'transit-line': 'MALL',
  'direct-line': 'SUBSTATION',
};

interface SceneData {
  // Opens the scene with a specific filter tab pre-selected. RunComplete
  // passes the just-played route so the player's fresh entry is visible;
  // Title opens to 'all'; Lobby prop also opens to 'all'.
  initialFilter?: FilterKey;
  // Where to send the user when they hit [BACK]. Defaults to 'Title'.
  returnScene?: string;
  // Optional scene data to pass back to the return scene.
  returnSceneData?: Record<string, unknown>;
}

// Entries per page. Sized to fit comfortably above the pagination controls
// without crowding the BACK button at the bottom of the scene.
const PAGE_SIZE = 14;

export class LeaderboardScene extends Phaser.Scene {
  private activeFilter: FilterKey = 'all';
  private returnScene = 'Title';
  private returnSceneData: Record<string, unknown> | undefined = undefined;
  // Container for the current table rendering — cleared and re-rendered
  // whenever the active filter changes OR the page changes.
  private tableContainer?: Phaser.GameObjects.Container;
  // Cached status banner ("showing local scores only", "loading", etc.)
  // so filter re-renders can update it without creating duplicates.
  private statusText?: Phaser.GameObjects.Text;
  // All entries from the latest fetch. Paginated client-side into
  // PAGE_SIZE chunks so the player can browse deeper into the board
  // without another network round-trip per page.
  private allEntries: ScoreEntry[] = [];
  private currentPage = 1;
  // Pagination controls live in a separate container so they can be
  // torn down + redrawn without touching the table rows.
  private paginationContainer?: Phaser.GameObjects.Container;

  constructor() {
    super('Leaderboard');
  }

  init(data?: SceneData): void {
    this.activeFilter = data?.initialFilter ?? 'all';
    this.returnScene = data?.returnScene ?? 'Title';
    this.returnSceneData = data?.returnSceneData;
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#0a0a14');

    // Title
    this.add
      .text(width / 2, 60, 'LEADERBOARD', {
        fontFamily: FONT,
        fontSize: '56px',
        color: '#8aff8a',
      })
      .setOrigin(0.5);

    // Filter tabs — horizontal row under the title. Clicking one switches
    // `activeFilter` and re-renders the table.
    const tabY = 140;
    const tabSpacing = 160;
    const totalTabsWidth = (TABS.length - 1) * tabSpacing;
    const tabStartX = width / 2 - totalTabsWidth / 2;
    TABS.forEach((tab, i) => {
      const x = tabStartX + i * tabSpacing;
      const label = this.add
        .text(x, tabY, tab.label, {
          fontFamily: FONT,
          fontSize: '24px',
          color: tab.key === this.activeFilter ? '#ffdd55' : '#888',
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      label.on('pointerup', () => {
        if (this.activeFilter === tab.key) return;
        this.activeFilter = tab.key;
        // Re-render the whole scene (cheap — just a table swap).
        this.scene.restart({
          initialFilter: this.activeFilter,
          returnScene: this.returnScene,
          returnSceneData: this.returnSceneData,
        });
      });
    });

    // Column headers
    const colY = 195;
    const cols = this.getColumnXs();
    const addHeader = (x: number, text: string) =>
      this.add
        .text(x, colY, text, {
          fontFamily: FONT,
          fontSize: '18px',
          color: '#6aaa8a',
        })
        .setOrigin(0, 0);
    addHeader(cols.rank, 'RANK');
    addHeader(cols.name, 'NAME');
    addHeader(cols.score, 'SCORE');
    addHeader(cols.route, 'ROUTE');
    addHeader(cols.leader, 'LEADER');
    addHeader(cols.time, 'TIME');

    // Divider under headers
    const divider = this.add.graphics();
    divider.lineStyle(1, 0x2a4a3a, 1);
    divider.beginPath();
    divider.moveTo(cols.rank, colY + 28);
    divider.lineTo(cols.time + 90, colY + 28);
    divider.strokePath();

    // Status line (below title, above tabs). Shows loading / local-only / error.
    this.statusText = this.add
      .text(width / 2, 105, 'Loading…', {
        fontFamily: FONT,
        fontSize: '16px',
        color: '#888',
      })
      .setOrigin(0.5);

    // Async fetch, render when ready.
    this.loadAndRender();

    // Back button — hover state lightens the label + background so it
    // clearly reads as clickable.
    const BTN_COLOR = '#8aff8a';
    const BTN_COLOR_HOVER = '#ffffff';
    const BTN_BG = '#2a3a2a';
    const BTN_BG_HOVER = '#3f5a3f';
    const btn = this.add
      .text(width / 2, height - 60, '[ BACK ]', {
        fontFamily: FONT,
        fontSize: '28px',
        color: BTN_COLOR,
        backgroundColor: BTN_BG,
        padding: { x: 20, y: 8 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => {
      btn.setColor(BTN_COLOR_HOVER);
      btn.setBackgroundColor(BTN_BG_HOVER);
    });
    btn.on('pointerout', () => {
      btn.setColor(BTN_COLOR);
      btn.setBackgroundColor(BTN_BG);
    });
    btn.on('pointerup', () => this.returnBack());
    this.input.keyboard?.once('keydown-ESC', () => this.returnBack());
    this.input.keyboard?.once('keydown-SPACE', () => this.returnBack());

    // Arrow-key pagination — works whenever the board has more than one page.
    this.input.keyboard?.on('keydown-LEFT', () => this.changePage(-1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.changePage(1));
  }

  // Total horizontal span of the table from the start of the RANK column
  // to the end of the TIME values. Used both for column positioning and
  // for centering the table + highlight bars on the viewport.
  private static readonly TABLE_SPAN = 880;

  private getColumnXs() {
    const { width } = this.scale;
    const tableLeft = (width - LeaderboardScene.TABLE_SPAN) / 2;
    return {
      rank: tableLeft,
      name: tableLeft + 70,
      score: tableLeft + 310,
      route: tableLeft + 440,
      leader: tableLeft + 620,
      time: tableLeft + 820,
    };
  }

  private async loadAndRender(): Promise<void> {
    const route = this.activeFilter === 'all' ? null : this.activeFilter;
    // Fetch up to 100 entries so we have enough to paginate through.
    // Worker / local store both clamp to this anyway.
    const { entries, source } = await fetchTopScores({ route, limit: 100 });
    this.allEntries = entries;
    this.currentPage = 1;

    // Update the status banner now that the fetch resolved.
    if (this.statusText) {
      if (entries.length === 0) {
        this.statusText.setText('No scores yet — be the first to reach the Relay');
        this.statusText.setColor('#888');
      } else if (source === 'local') {
        const msg = isRemoteConfigured()
          ? 'Offline — showing local scores only'
          : 'Local scores only (no server configured)';
        this.statusText.setText(msg);
        this.statusText.setColor('#ffbb66');
      } else {
        this.statusText.setText(`${entries.length} score${entries.length === 1 ? '' : 's'}`);
        this.statusText.setColor('#6aaa8a');
      }
    }

    this.renderCurrentPage();
  }

  /**
   * Render the slice of `allEntries` corresponding to `currentPage`. Also
   * redraws the pagination controls — they only appear when there's more
   * than one page of results.
   */
  private renderCurrentPage(): void {
    this.tableContainer?.destroy();
    this.tableContainer = this.add.container(0, 0);

    const cols = this.getColumnXs();
    const rowStart = 240;
    const rowHeight = 26;
    const myUsername = getUsername();

    const startIndex = (this.currentPage - 1) * PAGE_SIZE;
    const endIndex = Math.min(startIndex + PAGE_SIZE, this.allEntries.length);

    for (let i = startIndex; i < endIndex; i++) {
      const entry = this.allEntries[i];
      const rank = i + 1;
      const isMe = myUsername !== null && entry.username === myUsername;
      const color = isMe ? '#ffdd55' : '#e6e6e6';
      const rowY = rowStart + (i - startIndex) * rowHeight;

      const leaderLabel = (CLASSES[entry.leaderId]?.name ?? entry.leaderId).toUpperCase();
      const minutes = Math.floor(entry.durationSec / 60);
      const seconds = entry.durationSec % 60;
      const timeLabel = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      const routeLabel = ROUTE_LABEL[entry.route] ?? entry.route.toUpperCase();

      const addCell = (x: number, text: string, size = '18px') =>
        this.add
          .text(x, rowY, text, {
            fontFamily: FONT,
            fontSize: size,
            color,
          })
          .setOrigin(0, 0);

      const rankCell = addCell(cols.rank, String(rank));
      const nameCell = addCell(cols.name, entry.username);
      const scoreCell = addCell(cols.score, String(entry.score));
      const routeCell = addCell(cols.route, routeLabel);
      const leaderCell = addCell(cols.leader, leaderLabel);
      const timeCell = addCell(cols.time, timeLabel);
      this.tableContainer?.add([rankCell, nameCell, scoreCell, routeCell, leaderCell, timeCell]);

      // Highlight: faint background bar behind the player's own rows.
      if (isMe) {
        const { width } = this.scale;
        const tableLeft = (width - LeaderboardScene.TABLE_SPAN) / 2;
        const bar = this.add
          .rectangle(
            tableLeft - 10,
            rowY + 10,
            LeaderboardScene.TABLE_SPAN + 20,
            rowHeight,
            0xffdd55,
            0.08,
          )
          .setOrigin(0, 0.5);
        bar.setDepth(-1);
        this.tableContainer?.add(bar);
      }
    }

    this.renderPagination();
  }

  /**
   * Draw the "< Page X of Y >" controls below the table. Only shown when
   * there's more than one page — on a single-page board, nothing renders.
   */
  private renderPagination(): void {
    this.paginationContainer?.destroy();
    this.paginationContainer = this.add.container(0, 0);

    const totalPages = Math.max(1, Math.ceil(this.allEntries.length / PAGE_SIZE));
    if (totalPages <= 1) return; // No controls when not needed.

    const { width, height } = this.scale;
    const centerX = width / 2;
    // Controls sit below the last possible table row (240 + 14*26 = 604),
    // above the BACK button at y=height-60.
    const controlY = height - 110;

    const canPrev = this.currentPage > 1;
    const canNext = this.currentPage < totalPages;

    const prev = this.add
      .text(centerX - 120, controlY, '< PREV', {
        fontFamily: FONT,
        fontSize: '20px',
        color: canPrev ? '#8aff8a' : '#444',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: canPrev });
    if (canPrev) prev.on('pointerup', () => this.changePage(-1));

    const label = this.add
      .text(centerX, controlY, `PAGE ${this.currentPage} OF ${totalPages}`, {
        fontFamily: FONT,
        fontSize: '20px',
        color: '#e6e6e6',
      })
      .setOrigin(0.5);

    const next = this.add
      .text(centerX + 120, controlY, 'NEXT >', {
        fontFamily: FONT,
        fontSize: '20px',
        color: canNext ? '#8aff8a' : '#444',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: canNext });
    if (canNext) next.on('pointerup', () => this.changePage(1));

    this.paginationContainer.add([prev, label, next]);
  }

  private changePage(delta: number): void {
    const totalPages = Math.max(1, Math.ceil(this.allEntries.length / PAGE_SIZE));
    const next = this.currentPage + delta;
    if (next < 1 || next > totalPages) return;
    this.currentPage = next;
    this.renderCurrentPage();
  }

  private returnBack(): void {
    this.scene.start(this.returnScene, this.returnSceneData);
  }

  /**
   * Dev-only: seed localStorage with a mixed set of fake scores and open
   * the scene. Wired to the `L` hotkey on TitleScene (debug builds only).
   * Intentionally produces more than one page of results so pagination
   * controls are visible during iteration.
   */
  static startTest(caller: Phaser.Scene): void {
    const now = Date.now();
    const leaders = ['vanguard', 'netrunner', 'medic', 'scavenger', 'cybermonk'];
    const routes: LeaderboardRoute[] = ['long-highway', 'transit-line', 'direct-line'];
    const names = [
      'VEY',
      'CARGO_9',
      'NEON_RAT',
      'SALVAGEE',
      'RELAY_OP',
      'DR_BLIP',
      'ECHOPUNK',
      'HUSK',
      'ACE',
      'PIXELWIRE',
      'SCOUT_01',
      'MIRA',
      'QUIET',
      'GHOSTLINE',
      'BITROT',
      'SUNBAKED',
      'LOCKSMITH',
      'TALLY',
      'KERNEL',
      'VAGRANT',
      'SPORE',
      'HALFLIFE',
      'DUSTKID',
      'LOOP',
      'STATIC',
      'CIPHER',
      'WASP',
      'RUNE',
    ];

    const entries: ScoreEntry[] = names.map((username, i) => {
      const route = routes[i % routes.length];
      const leaderId = leaders[i % leaders.length];
      // Scores trend downward as the index increases so the sort produces
      // a visually-ordered top board. Small jitter avoids perfect runs of
      // identical scores (durationSec becomes the tiebreaker).
      const base = 2400 - i * 65;
      const score = Math.max(40, base + ((i * 37) % 90) - 30);
      const durationSec = 180 + ((i * 53) % 420);
      return {
        username,
        score,
        leaderId,
        route,
        durationSec,
        timestamp: now - i * 60_000,
      };
    });

    // Include the real player username (if set) so the yellow highlight
    // row renders in the preview.
    const me = getUsername();
    if (me !== null) {
      entries.push({
        username: me,
        score: 1875,
        leaderId: 'cybermonk',
        route: 'transit-line',
        durationSec: 342,
        timestamp: now - 1_000,
      });
    }

    _seedLocalForTest(entries);
    caller.scene.start('Leaderboard', { returnScene: 'Title' });
  }
}
