import * as Phaser from 'phaser';
import { CLASSES } from '../data/classes';
import { getRun, ESCORT_MAX_HP, refillAbilityUsesOnRest } from '../state/run';
import { FONT } from '../util/ui';
import { installPauseMenuEsc } from '../util/pauseMenu';
import { ITEMS, ITEM_ORDER } from '../data/items';

// Partial-rest percentages (mid-route rest stop).
const HEAL_HP_PCT = 0.5;
const HEAL_MP_PCT = 0.5;
const HEAL_ESCORT_PCT = 0.15;
const REVIVE_KO_PCT = 0.25;
// Pre-boss rest restores EVERYTHING. Used when the next encounter has
// `isBoss: true`. Preserves the strategic weight of mid-route rests
// while giving the party a proper "last camp before the dungeon boss."
const PRE_BOSS_HP_PCT = 1.0;
const PRE_BOSS_MP_PCT = 1.0;
const PRE_BOSS_ESCORT_PCT = 1.0;

export class RestScene extends Phaser.Scene {
  constructor() {
    super('Rest');
  }

  create(): void {
    const { width, height } = this.scale;
    const run = getRun();
    this.cameras.main.setBackgroundColor('#14241a');

    // Pre-boss rest = full restore. Detected by peeking at the NEXT
    // encounter (run.encounterIndex already advanced past the cleared one
    // in CombatScene.winEncounter). If that encounter is flagged as a
    // boss, upgrade HP/MP/escort restore to 100%. Otherwise, normal
    // partial restore.
    const nextEnc = run.route.encounters[run.encounterIndex];
    const preBoss = nextEnc?.isBoss === true;
    const hpPct = preBoss ? PRE_BOSS_HP_PCT : HEAL_HP_PCT;
    const mpPct = preBoss ? PRE_BOSS_MP_PCT : HEAL_MP_PCT;
    const escortPct = preBoss ? PRE_BOSS_ESCORT_PCT : HEAL_ESCORT_PCT;

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
    const escortHpBefore = run.escortHp;

    for (const key of run.party) {
      const def = CLASSES[key];
      const current = run.partyHp[key] ?? def.hp;
      const currentMp = def.mp > 0 ? (run.partyMp[key] ?? def.mp) : 0;
      const wasKo = current <= 1;
      let next: number;
      if (wasKo) {
        // Pre-boss: even a KO'd ally comes back to full. Otherwise
        // partial revive per REVIVE_KO_PCT.
        next = preBoss ? def.hp : Math.round(def.hp * REVIVE_KO_PCT);
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
    run.escortHp = Math.min(ESCORT_MAX_HP, Math.round(run.escortHp + ESCORT_MAX_HP * escortPct));
    const escortHpDelta = run.escortHp - escortHpBefore;
    // D&D-style: limited abilities (GUARD, TAUNT, SALVAGE) refill on rest.
    refillAbilityUsesOnRest();

    const title = preBoss ? 'FINAL CAMP' : 'REST STOP';
    const subtitle = preBoss
      ? 'Everything hinges on the next fight. The party readies in full.'
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

    // Three-column table matching RunCompleteScene's HP layout: character
    // name (with class in parens), HP/MP stats, then healing deltas in
    // their own tinted column. Every value lines up regardless of row
    // content length.
    const nameColX = width / 2 - 290;
    const hpColX = width / 2 + 50;
    const deltaColX = width / 2 + 290;
    let y = 300;
    for (const key of run.party) {
      const def = CLASSES[key];
      const d = partyDeltas.get(key);
      const hp = run.partyHp[key] ?? def.hp;
      const mpPart = def.mp > 0 ? `   MP ${run.partyMp[key]}/${def.mp}` : '';
      this.add
        .text(nameColX, y, `${def.personName} (${def.name})`, {
          fontFamily: FONT,
          fontSize: '28px',
          color: '#e6e6e6',
        })
        .setOrigin(0, 0.5);
      this.add
        .text(hpColX, y, `HP ${hp}/${def.hp}${mpPart}`, {
          fontFamily: FONT,
          fontSize: '28px',
          color: '#e6e6e6',
        })
        .setOrigin(0, 0.5);
      if (d) {
        const hpGain = d.hpAfter - Math.max(0, d.hpBefore);
        const mpGain = d.mpAfter - d.mpBefore;
        const deltaParts: string[] = [];
        if (d.revived) deltaParts.push(`REVIVED +${hpGain}`);
        else if (hpGain > 0) deltaParts.push(`+${hpGain} HP`);
        if (mpGain > 0) deltaParts.push(`+${mpGain} MP`);
        if (deltaParts.length > 0) {
          this.add
            .text(deltaColX, y, deltaParts.join('  '), {
              fontFamily: FONT,
              fontSize: '24px',
              color: d.revived ? '#ffdd55' : '#8aff8a',
            })
            .setOrigin(0, 0.5);
        }
      }
      y += 44;
    }
    this.add
      .text(nameColX, y + 14, 'Dr. Vey', {
        fontFamily: FONT,
        fontSize: '28px',
        color: '#f5c97b',
      })
      .setOrigin(0, 0.5);
    this.add
      .text(hpColX, y + 14, `HP ${run.escortHp}/${ESCORT_MAX_HP}`, {
        fontFamily: FONT,
        fontSize: '28px',
        color: '#f5c97b',
      })
      .setOrigin(0, 0.5);
    if (escortHpDelta > 0) {
      this.add
        .text(deltaColX, y + 14, `+${escortHpDelta} HP`, {
          fontFamily: FONT,
          fontSize: '24px',
          color: '#8aff8a',
        })
        .setOrigin(0, 0.5);
    }

    const btn = this.add
      .text(width / 2, height - 100, '[ Continue ]', {
        fontFamily: FONT,
        fontSize: '32px',
        color: '#8aff8a',
        backgroundColor: '#2a3a2a',
        padding: { x: 24, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    // Rest continues into Journey (marker animates from the rest stop
    // onward to the next encounter) before landing in Combat. Pass
    // `fromRest: true` so Journey doesn't re-detect this transition as
    // a rest-stop journey and loop back to the Rest scene.
    const advance = () => this.scene.start('Journey', { fromRest: true });
    btn.on('pointerup', advance);
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
