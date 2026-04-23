import * as Phaser from 'phaser';
import { CLASSES } from '../data/classes';
import { getRun, VIP_MAX_HP, refillAbilityUsesOnRest } from '../state/run';
import { FONT } from '../util/ui';
import { createHoverButton } from '../util/button';
import { installPauseMenuEsc } from '../util/pauseMenu';
import { ITEMS, ITEM_ORDER } from '../data/items';
import { playSfx } from '../util/audio';

// Partial-rest percentages (mid-route rest stop).
const HEAL_HP_PCT = 0.5;
const HEAL_MP_PCT = 0.5;
const HEAL_VIP_PCT = 0.15;
const REVIVE_KO_PCT = 0.25;
// Pre-boss rest restores EVERYTHING. Used when the next encounter has
// `isBoss: true`. Preserves the strategic weight of mid-route rests
// while giving the party a proper "last camp before the dungeon boss."
const PRE_BOSS_HP_PCT = 1.0;
const PRE_BOSS_MP_PCT = 1.0;
const PRE_BOSS_VIP_PCT = 1.0;

export class RestScene extends Phaser.Scene {
  constructor() {
    super('Rest');
  }

  create(): void {
    const { width, height } = this.scale;
    const run = getRun();
    this.cameras.main.setBackgroundColor('#14241a');

    // Rest framing — title/subtitle key off `isBoss` so the player sees
    // "FINAL CAMP" whenever a boss is next, regardless of restore amount.
    // The full-restore effect itself is a separate, opt-in flag
    // (`preBossFullRestore`) so balance can gate it per-route (e.g. the
    // 3-variant substation needs it, the 2-variant doesn't).
    const nextEnc = run.route.encounters[run.encounterIndex];
    const preBoss = nextEnc?.isBoss === true;
    const fullRestore = nextEnc?.preBossFullRestore === true;
    const hpPct = fullRestore ? PRE_BOSS_HP_PCT : HEAL_HP_PCT;
    const mpPct = fullRestore ? PRE_BOSS_MP_PCT : HEAL_MP_PCT;
    const vipPct = fullRestore ? PRE_BOSS_VIP_PCT : HEAL_VIP_PCT;

    // Snapshot pre-rest values so the render pass can show the exact
    // delta each member gained (`+13 HP`, `+10 MP`, `REVIVED +18` for
    // members who were KO'd at 0-1 HP).
    interface HealDelta {
      hpBefore: number;
      hpAfter: number;
      mpBefore: number;
      mpAfter: number;
      revived: boolean;
    }
    const partyDeltas = new Map<string, HealDelta>();
    const vipHpBefore = run.vipHp;

    for (const key of run.party) {
      const def = CLASSES[key];
      const current = run.partyHp[key] ?? def.hp;
      const currentMp = def.mp > 0 ? (run.partyMp[key] ?? def.mp) : 0;
      const wasKo = current <= 1;
      let next: number;
      if (wasKo) {
        // Full restore: even a KO'd ally comes back to full. Otherwise
        // partial revive per REVIVE_KO_PCT.
        next = fullRestore ? def.hp : Math.round(def.hp * REVIVE_KO_PCT);
      } else {
        next = Math.min(def.hp, Math.round(current + def.hp * hpPct));
      }
      run.partyHp[key] = next;

      let nextMp = currentMp;
      if (def.mp > 0) {
        nextMp = Math.min(def.mp, Math.round(currentMp + def.mp * mpPct));
        run.partyMp[key] = nextMp;
      }
      partyDeltas.set(key, {
        hpBefore: current,
        hpAfter: next,
        mpBefore: currentMp,
        mpAfter: nextMp,
        revived: wasKo,
      });
    }
    run.vipHp = Math.min(VIP_MAX_HP, Math.round(run.vipHp + VIP_MAX_HP * vipPct));
    const vipHpDelta = run.vipHp - vipHpBefore;
    // D&D-style: limited abilities (GUARD, TAUNT, SALVAGE) refill on rest.
    refillAbilityUsesOnRest();

    // Soft heal shimmer on scene entry — signals "party healed" the
    // moment the screen appears, paired with the visible +HP/+MP deltas.
    playSfx(this, 'sfx-heal-shimmer', 0.6);

    const title = preBoss ? 'FINAL CAMP' : 'REST STOP';
    const subtitle = preBoss
      ? fullRestore
        ? 'Everything hinges on the next fight. The party readies in full.'
        : 'The boss is next. One last breath before the fight.'
      : 'A brief moment of quiet. The party catches their breath.';

    // Title + subtitle sizing / placement matches RunCompleteScene so the
    // rest stop feels like the same visual family as the victory screen.
    this.add
      .text(width / 2, 100, title, {
        fontFamily: FONT,
        fontSize: '64px',
        color: preBoss ? '#ffdd55' : '#8aff8a',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 175, subtitle, {
        fontFamily: FONT,
        fontSize: '28px',
        color: '#aaaaaa',
      })
      .setOrigin(0.5);

    // Two-row per-character layout: row 1 is the character's name + HP +
    // MP values; row 2 directly beneath is the healing deltas, with the
    // HP delta aligned under the HP column and the MP delta aligned under
    // the MP column. Putting deltas on their own row guarantees no
    // overlap regardless of text widths.
    // Table span: NAME text starts at nameColX and the MP column's text
    // ends ~125 px past mpColX ("MP 30/30" at 28 px Silkscreen). The
    // three offsets below are tuned so the whole visible row centers
    // on the canvas midline (width/2) — previously the layout was
    // pinned to nameColX = width/2-500 which sat ~170 px left of
    // center with a dead right margin.
    const nameColX = width / 2 - 332;
    const hpColX = width / 2 + 8;
    // MP column sits directly after the HP value (widest is 3/3 digits,
    // ~160 px at 28 px Silkscreen) so there's no empty gap between the
    // two stats.
    const mpColX = hpColX + 200;
    const ROW1_TO_ROW2 = 28; // vertical gap from name/stat row to delta row
    const BLOCK_SPACING = 60; // vertical space between character blocks
    let y = 280;
    for (const key of run.party) {
      const def = CLASSES[key];
      const d = partyDeltas.get(key);
      const hp = run.partyHp[key] ?? def.hp;

      // Row 1: name, HP value, MP value (for MP-having classes).
      // HP and MP values are LEFT-aligned at their column X. Their right
      // edges are captured below so the delta text can right-align to them.
      this.add
        .text(nameColX, y, `${def.personName} (${def.name})`, {
          fontFamily: FONT,
          fontSize: '28px',
          color: '#e6e6e6',
        })
        .setOrigin(0, 0.5);
      const hpStat = this.add
        .text(hpColX, y, `HP ${hp}/${def.hp}`, {
          fontFamily: FONT,
          fontSize: '28px',
          color: '#e6e6e6',
        })
        .setOrigin(0, 0.5);
      const hpRightEdge = hpColX + hpStat.displayWidth;

      let mpRightEdge: number | null = null;
      if (def.mp > 0) {
        const mpStat = this.add
          .text(mpColX, y, `MP ${run.partyMp[key]}/${def.mp}`, {
            fontFamily: FONT,
            fontSize: '28px',
            color: '#e6e6e6',
          })
          .setOrigin(0, 0.5);
        mpRightEdge = mpColX + mpStat.displayWidth;
      }

      // Row 2: HP delta right-aligned to the HP value's right edge, MP
      // delta right-aligned to the MP value's right edge. Origin (1, 0.5)
      // so the X passed is the text's RIGHT edge, making the tail of the
      // delta text line up with the tail of the stat above it.
      if (d) {
        const hpGain = d.hpAfter - Math.max(0, d.hpBefore);
        const mpGain = d.mpAfter - d.mpBefore;
        if (d.revived) {
          this.add
            .text(hpRightEdge, y + ROW1_TO_ROW2, `REVIVED +${hpGain}`, {
              fontFamily: FONT,
              fontSize: '22px',
              color: '#ffdd55',
            })
            .setOrigin(1, 0.5);
        } else if (hpGain > 0) {
          this.add
            .text(hpRightEdge, y + ROW1_TO_ROW2, `+${hpGain} HP`, {
              fontFamily: FONT,
              fontSize: '22px',
              color: '#8aff8a',
            })
            .setOrigin(1, 0.5);
        }
        if (def.mp > 0 && mpGain > 0 && mpRightEdge !== null) {
          this.add
            .text(mpRightEdge, y + ROW1_TO_ROW2, `+${mpGain} MP`, {
              fontFamily: FONT,
              fontSize: '22px',
              color: '#8aff8a',
            })
            .setOrigin(1, 0.5);
        }
      }

      y += BLOCK_SPACING;
    }

    // VIP block — same two-row pattern, HP only.
    y += 10; // extra breathing room between party and VIP
    this.add
      .text(nameColX, y, 'Dr. Vey', {
        fontFamily: FONT,
        fontSize: '28px',
        color: '#f5c97b',
      })
      .setOrigin(0, 0.5);
    const vipHpStat = this.add
      .text(hpColX, y, `HP ${run.vipHp}/${VIP_MAX_HP}`, {
        fontFamily: FONT,
        fontSize: '28px',
        color: '#f5c97b',
      })
      .setOrigin(0, 0.5);
    if (vipHpDelta > 0) {
      this.add
        .text(hpColX + vipHpStat.displayWidth, y + ROW1_TO_ROW2, `+${vipHpDelta} HP`, {
          fontFamily: FONT,
          fontSize: '22px',
          color: '#8aff8a',
        })
        .setOrigin(1, 0.5);
    }

    // Rest continues into Journey (marker animates from the rest stop
    // onward to the next encounter) before landing in Combat. Pass
    // `fromRest: true` so Journey doesn't re-detect this transition as
    // a rest-stop journey and loop back to the Rest scene.
    // `advanced` flag guards against rapid-fire keypresses queuing
    // multiple scene starts mid-transition.
    let advanced = false;
    const advance = (): void => {
      if (advanced) return;
      advanced = true;
      this.scene.start('Journey', { fromRest: true });
    };
    // Prominent CONTINUE button — larger touch target, stronger idle/hover
    // contrast. No idle pulse / scale tween.
    const continueBtn = createHoverButton(this, {
      x: width / 2,
      y: height - 100,
      label: 'CONTINUE  ▶',
      fontSize: '36px',
      idleColor: '#0f1a0f',
      hoverColor: '#0f1a0f',
      idleBg: '#8aff8a',
      hoverBg: '#b4ffb4',
      padding: { x: 44, y: 18 },
      onClick: advance,
    });
    // Press-state flash so touch taps feel responsive (no hover on mobile).
    continueBtn.on('pointerdown', () => {
      continueBtn.setBackgroundColor('#5ccf5c');
    });
    continueBtn.on('pointerup', () => {
      continueBtn.setBackgroundColor('#b4ffb4');
    });
    this.input.keyboard?.once('keydown-E', advance);
    this.input.keyboard?.once('keydown-ENTER', advance);
    this.input.keyboard?.once('keydown-SPACE', advance);

    installPauseMenuEsc(this);

    this.renderInventoryPanel();
  }

  /**
   * Bottom-left readout of the shared party inventory. Mirrors the Journey
   * scene's panel so the player can see what they're carrying into the next
   * fight from either travel scene. Read-only here (RestScene doesn't let
   * you use items); zero-count items render dimmed.
   */
  private renderInventoryPanel(): void {
    const { height } = this.scale;
    const run = getRun();
    const margin = 24;
    const lineHeight = 26;
    const rowCount = ITEM_ORDER.length;
    const titleY = height - margin - rowCount * lineHeight - 10;

    this.add
      .text(margin, titleY, 'INVENTORY', {
        fontFamily: FONT,
        fontSize: '17px',
        color: '#8aa5cf',
      })
      .setOrigin(0, 0);

    // Two-column layout so every `×N` aligns vertically regardless of how
    // long the item name is. The count column sits at a fixed offset from
    // the left margin (wide enough for the longest label — "SMOKE GRENADE").
    const countColumnX = margin + 200;
    ITEM_ORDER.forEach((id, i) => {
      const def = ITEMS[id];
      const count = run.inventory[id] ?? 0;
      const y = titleY + 26 + i * lineHeight;
      const dim = count === 0;
      const color = dim ? '#555' : '#cceeff';
      this.add
        .text(margin, y, def.label, { fontFamily: FONT, fontSize: '18px', color })
        .setOrigin(0, 0);
      this.add
        .text(countColumnX, y, `×${count}`, { fontFamily: FONT, fontSize: '18px', color })
        .setOrigin(0, 0);
    });
  }
}
