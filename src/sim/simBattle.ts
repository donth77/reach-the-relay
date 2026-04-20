// Pure-TS battle simulator. Mirrors CombatScene's combat rules closely enough
// to tune boss HP/attack/defense numbers without running the game. No Phaser
// dependency — imports only data modules.

import { CLASSES, type AbilityDef, type ClassDef, type Element } from '../data/classes';
import { ENEMIES, type EnemyDef } from '../data/enemies';

// Match src/combat/types.ts
const ATB_MAX = 100;
const ATB_RATE = 9;
const ESCORT_MAX_HP = 35;

export interface SimUnit {
  id: string;
  name: string;
  side: 'party' | 'enemy' | 'escort';
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  atb: number;
  atbModifier: number;
  atbModifierTurnsLeft: number;
  ko: boolean;
  guarding: boolean;
  shielded: boolean;
  tauntedBy: string | null;
  // When true, the enemy's next attack automatically misses (smoke grenade).
  missing: boolean;
  classDef?: ClassDef;
  enemyDef?: EnemyDef;
  abilityUses: Record<string, number>;
  turnCount: number;
  lastDamagerId?: string;
}

export interface SimConfig {
  partyClassIds: string[]; // length 3
  enemyId?: string; // default 'wreckling' — used when enemyIds not set
  enemyIds?: string[]; // multi-enemy encounters (e.g. ['wirehead', 'spider', 'sentry'])
  enemyOverrides?: Partial<Pick<EnemyDef, 'hp' | 'attack' | 'defense' | 'speed'>>;
  startingInventory?: Record<string, number>; // stimpak, powercell, adrenaline, smokegrenade
  // Simulate the party arriving at the boss already worn down from the prior
  // route encounter. When true:
  //  - party HP ~80% of max
  //  - MP-using classes (Medic, Netrunner) at ~70% MP
  //  - one use of each limited ability already spent (e.g. GUARD 1/2)
  startDegraded?: boolean;
}

export interface RouteEncounter {
  enemyIds: string[];
  enemyOverrides?: Partial<Pick<EnemyDef, 'hp' | 'attack' | 'defense' | 'speed'>>; // applied to the boss-tier enemy if present
  isBoss?: boolean;
}

export interface RouteConfig {
  partyClassIds: string[];
  encounters: RouteEncounter[];
  startingInventory?: Record<string, number>;
  restAfter?: number[]; // encounter indices after which a rest heals (indexes 0-based)
}

export interface RouteResult {
  routeWon: boolean;
  encountersCleared: number;
  bossWon: boolean; // specifically whether the boss encounter resolved in win
  simSeconds: number;
  turns: number;
  escortHpEnd: number;
  partyKoCount: number;
  partyHpEndPct: number;
  itemsUsed: Record<string, number>;
}

export interface SimResult {
  win: boolean;
  simSeconds: number;
  turns: number;
  escortHpEnd: number;
  escortHpStart: number;
  enemyHpEnd: number;
  partyKoCount: number;
  partyHpEndPct: number; // avg 0..1
  itemsUsed: Record<string, number>;
}

export interface SimStats {
  trials: number;
  winRate: number;
  avgTurns: number;
  avgEscortHpEnd: number;
  escortKoRate: number;
  avgPartyKo: number;
  avgPartyHpEndPct: number;
  avgItemsUsed: Record<string, number>;
}

type RNG = () => number;

function calcDamage(
  attacker: SimUnit,
  target: SimUnit,
  power: number,
  element: Element | undefined,
  rng: RNG,
): number {
  const base = Math.max(1, attacker.attack * power - target.defense);
  const variance = Math.floor(rng() * 5) - 2;
  let dmg = Math.max(1, Math.round(base + variance));
  if (element && element !== 'none' && target.enemyDef) {
    if (target.enemyDef.vulnerability === element) dmg = Math.round(dmg * 1.5);
    else if (target.enemyDef.resistances?.includes(element))
      dmg = Math.max(1, Math.round(dmg * 0.5));
  }
  return dmg;
}

function applyDamage(target: SimUnit, damage: number, attacker?: SimUnit): number {
  let final = damage;
  if (target.shielded) final = Math.max(1, Math.floor(final / 2));
  target.hp = Math.max(0, target.hp - final);
  if (target.hp <= 0) target.ko = true;
  if (attacker && attacker.side === 'party' && target.side === 'enemy') {
    target.lastDamagerId = attacker.id;
  }
  return final;
}

function buildParty(classIds: string[], degraded: boolean = false): SimUnit[] {
  return classIds.map((id) => {
    const def = CLASSES[id];
    const uses: Record<string, number> = {};
    for (const ab of def.abilities) {
      if (ab.maxUsesPerRest !== undefined) {
        // Degraded: one use of each limited ability already spent in prior fight
        uses[ab.id] = degraded ? Math.max(0, ab.maxUsesPerRest - 1) : ab.maxUsesPerRest;
      }
    }
    const startHp = degraded ? Math.round(def.hp * 0.8) : def.hp;
    const startMp = degraded && def.mp > 0 ? Math.round(def.mp * 0.7) : def.mp;
    return {
      id,
      name: def.name,
      side: 'party' as const,
      hp: startHp,
      maxHp: def.hp,
      mp: startMp,
      maxMp: def.mp,
      attack: def.attack,
      defense: def.defense,
      speed: def.speed,
      atb: 0,
      atbModifier: 1,
      atbModifierTurnsLeft: 0,
      ko: false,
      guarding: false,
      shielded: false,
      tauntedBy: null,
      missing: false,
      classDef: def,
      abilityUses: uses,
      turnCount: 0,
    };
  });
}

function buildEnemy(def: EnemyDef): SimUnit {
  return {
    id: def.id,
    name: def.name,
    side: 'enemy',
    hp: def.hp,
    maxHp: def.hp,
    mp: 0,
    maxMp: 0,
    attack: def.attack,
    defense: def.defense,
    speed: def.speed,
    atb: 0,
    atbModifier: 1,
    atbModifierTurnsLeft: 0,
    ko: false,
    guarding: false,
    shielded: false,
    tauntedBy: null,
    missing: false,
    enemyDef: def,
    abilityUses: {},
    turnCount: 0,
  };
}

function buildEscort(): SimUnit {
  return {
    id: 'drvey',
    name: 'Dr. Vey',
    side: 'escort',
    hp: ESCORT_MAX_HP,
    maxHp: ESCORT_MAX_HP,
    mp: 0,
    maxMp: 0,
    attack: 0,
    defense: 0,
    speed: 0, // escort never acts in ATB
    atb: 0,
    atbModifier: 1,
    atbModifierTurnsLeft: 0,
    ko: false,
    guarding: false,
    shielded: false,
    tauntedBy: null,
    missing: false,
    abilityUses: {},
    turnCount: 0,
  };
}

// ========= Party policy (heuristic player) =========

interface PartyAction {
  kind: 'ability';
  ability: AbilityDef;
  target: SimUnit;
}

interface ItemAction {
  kind: 'item';
  itemId: string;
  target: SimUnit;
}

type Action = PartyAction | ItemAction | null;

function canUseAbility(u: SimUnit, ab: AbilityDef): boolean {
  if (u.mp < ab.mpCost) return false;
  if (ab.maxUsesPerRest !== undefined) {
    const left = u.abilityUses[ab.id] ?? 0;
    if (left <= 0) return false;
  }
  return ab.effect !== 'item'; // sim treats items separately below
}

function pickPartyAction(
  u: SimUnit,
  allies: SimUnit[],
  enemies: SimUnit[],
  escort: SimUnit,
  inventory: Record<string, number>,
): Action {
  if (!u.classDef) return null;
  if (enemies.length === 0) return null;
  const byId = (id: string) => u.classDef!.abilities.find((a) => a.id === id);
  const wounded = allies.filter((a) => !a.ko && a.hp <= a.maxHp * 0.4);
  const escortWounded = !escort.ko && escort.hp <= escort.maxHp * 0.5;
  const escortCritical = !escort.ko && escort.hp <= escort.maxHp * 0.3;
  const hasMedic = allies.some((a) => !a.ko && a.classDef?.id === 'medic');
  const medic = allies.find((a) => !a.ko && a.classDef?.id === 'medic');
  const medicCanPatch = !!(medic && medic.mp >= 4);
  const isMedic = u.classDef.id === 'medic';

  // ===== Priority item usage (checked before ability selection) =====

  // 1. Revive a KO'd ally with adrenaline — always worth it (lose one turn, gain a whole unit)
  if ((inventory.adrenaline ?? 0) > 0) {
    const koAlly = allies.find((a) => a.ko);
    if (koAlly) return { kind: 'item', itemId: 'adrenaline', target: koAlly };
  }

  // 2. Smoke grenade before Wreckling's AoE turn — any party member can pop it
  if ((inventory.smokegrenade ?? 0) > 0) {
    const wreckling = enemies.find((e) => e.enemyDef?.shockwave && e.enemyDef?.signatureAoE);
    if (wreckling) {
      const nextPhase = wreckling.turnCount % 3;
      // phase 2 → next turn is AoE; pop smoke to negate it
      if (nextPhase === 2) {
        return { kind: 'item', itemId: 'smokegrenade', target: wreckling };
      }
    }
  }

  // 3. Stimpak on critical escort — fallback when Medic can't PATCH
  if (escortCritical && (inventory.stimpak ?? 0) > 0 && (!medicCanPatch || isMedic === false)) {
    return { kind: 'item', itemId: 'stimpak', target: escort };
  }

  // 4. Stimpak on any party member below 30% HP when Medic can't reach them this turn
  if ((inventory.stimpak ?? 0) > 0 && !isMedic) {
    const dying = allies.find((a) => !a.ko && a.hp <= a.maxHp * 0.3);
    if (dying && (!hasMedic || !medicCanPatch)) {
      return { kind: 'item', itemId: 'stimpak', target: dying };
    }
  }

  // 5. Stimpak on wounded escort when no Medic in party (no healer, use items)
  if (escortWounded && (inventory.stimpak ?? 0) > 0 && !hasMedic) {
    return { kind: 'item', itemId: 'stimpak', target: escort };
  }

  // Smarter primary target selection:
  //  1. Any enemy with target-escort behavior (Wirehead, Wreckling) — priority kill
  //  2. Lowest-HP enemy to reduce enemy count
  //  3. First enemy in array (fallback)
  const escortHunters = enemies.filter((e) => e.enemyDef?.behavior === 'target-escort');
  const primary: SimUnit =
    escortHunters.length > 0
      ? escortHunters.reduce((acc, e) => (e.hp < acc.hp ? e : acc))
      : enemies.reduce((acc, e) => (e.hp < acc.hp ? e : acc));

  switch (u.classDef.id) {
    case 'medic': {
      const patch = byId('patch');
      const shield = byId('shield');
      const pulse = byId('pulse');
      const strike = byId('strike');

      if (escortWounded && patch && canUseAbility(u, patch))
        return { kind: 'ability', ability: patch, target: escort };
      if (wounded.length > 0 && patch && canUseAbility(u, patch)) {
        const pick = [...wounded].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        return { kind: 'ability', ability: patch, target: pick };
      }
      if (
        !escort.ko &&
        escort.hp <= escort.maxHp * 0.7 &&
        !escort.shielded &&
        shield &&
        canUseAbility(u, shield)
      ) {
        return { kind: 'ability', ability: shield, target: escort };
      }
      if (pulse && canUseAbility(u, pulse))
        return { kind: 'ability', ability: pulse, target: primary };
      return strike ? { kind: 'ability', ability: strike, target: primary } : null;
    }
    case 'netrunner': {
      const jack = byId('jack');
      const abilities = [byId('overload'), byId('surge'), byId('frostlock')].filter(
        (a): a is AbilityDef => !!a,
      );
      // MP recovery: if low on MP (<8) and has a powercell, use it first
      if (u.mp < 8 && (inventory.powercell ?? 0) > 0) {
        return { kind: 'item', itemId: 'powercell', target: u };
      }
      // Score each ability by expected damage vs target after vuln/resist
      const score = (ab: AbilityDef) => {
        if (!canUseAbility(u, ab)) return -Infinity;
        let s = ab.power ?? 1;
        if (ab.element && primary.enemyDef) {
          if (primary.enemyDef.vulnerability === ab.element) s *= 1.5;
          else if (primary.enemyDef.resistances?.includes(ab.element)) s *= 0.5;
        }
        s -= ab.mpCost * 0.05; // very mild MP preference
        return s;
      };
      abilities.sort((a, b) => score(b) - score(a));
      if (abilities.length && score(abilities[0]) > 0) {
        return { kind: 'ability', ability: abilities[0], target: primary };
      }
      return jack ? { kind: 'ability', ability: jack, target: primary } : null;
    }
    case 'vanguard': {
      const fight = byId('fight');
      const taunt = byId('taunt');
      const guard = byId('guard');
      // TAUNT when escort is hurting AND the enemy isn't about to AoE (turnCount % 3 === 2 = next is AoE)
      const bossTurn = primary.turnCount % 3;
      const nextIsAoE =
        primary.enemyDef?.shockwave && primary.enemyDef?.signatureAoE ? bossTurn === 2 : false;
      if (
        !escort.ko &&
        escort.hp <= escort.maxHp * 0.5 &&
        taunt &&
        canUseAbility(u, taunt) &&
        !nextIsAoE
      ) {
        return { kind: 'ability', ability: taunt, target: primary };
      }
      // GUARD when vanguard healthy, party under fire, enemy has no ignoresGuard
      if (
        u.hp >= u.maxHp * 0.8 &&
        guard &&
        canUseAbility(u, guard) &&
        !primary.enemyDef?.ignoresGuard &&
        !escort.ko &&
        escort.hp <= escort.maxHp * 0.7
      ) {
        return { kind: 'ability', ability: guard, target: u };
      }
      return fight ? { kind: 'ability', ability: fight, target: primary } : null;
    }
    case 'cybermonk': {
      const flurry = byId('flurry');
      const focus = byId('focus');
      const fight = byId('fight');
      if (u.hp <= u.maxHp * 0.4 && focus && canUseAbility(u, focus)) {
        return { kind: 'ability', ability: focus, target: u };
      }
      if (flurry && canUseAbility(u, flurry))
        return { kind: 'ability', ability: flurry, target: primary };
      return fight ? { kind: 'ability', ability: fight, target: primary } : null;
    }
    case 'scavenger': {
      const salvage = byId('salvage');
      const slice = byId('slice');
      if (salvage && canUseAbility(u, salvage))
        return { kind: 'ability', ability: salvage, target: primary };
      return slice ? { kind: 'ability', ability: slice, target: primary } : null;
    }
  }
  return null;
}

// ========= Core simulation =========

function executeParty(
  actor: SimUnit,
  action: Action,
  units: SimUnit[],
  inventory: Record<string, number>,
  itemsUsed: Record<string, number>,
  rng: RNG,
): void {
  if (!action) return;

  if (action.kind === 'item') {
    const itemId = action.itemId;
    inventory[itemId] = Math.max(0, (inventory[itemId] ?? 0) - 1);
    itemsUsed[itemId] = (itemsUsed[itemId] ?? 0) + 1;
    if (itemId === 'stimpak') {
      action.target.hp = Math.min(action.target.maxHp, action.target.hp + 25);
    } else if (itemId === 'powercell') {
      action.target.mp = Math.min(action.target.maxMp, action.target.mp + 10);
    } else if (itemId === 'adrenaline') {
      if (action.target.ko) {
        action.target.ko = false;
        action.target.hp = Math.max(1, Math.round(action.target.maxHp * 0.25));
      }
    } else if (itemId === 'smokegrenade') {
      // Flag all living enemies to miss their next attack
      for (const e of units) if (e.side === 'enemy' && !e.ko) e.missing = true;
    }
    return;
  }

  const { ability, target } = action;
  actor.mp = Math.max(0, actor.mp - ability.mpCost);
  if (ability.maxUsesPerRest !== undefined) {
    actor.abilityUses[ability.id] = Math.max(0, (actor.abilityUses[ability.id] ?? 0) - 1);
  }

  switch (ability.effect) {
    case 'damage': {
      // Check evasion on basic physical attacks vs evasive enemies
      const isBasicPhysical = !ability.element && !ability.sfxKey && ability.mpCost === 0;
      if (isBasicPhysical && target.enemyDef?.evasive && rng() < 0.3) break;
      const base = calcDamage(actor, target, ability.power ?? 1, ability.element, rng);
      const crit = rng() < 0.15;
      const dmg = crit ? Math.round(base * 2) : base;
      applyDamage(target, dmg, actor);
      break;
    }
    case 'heal': {
      const amt = Math.round(ability.power ?? 0);
      target.hp = Math.min(target.maxHp, target.hp + amt);
      break;
    }
    case 'guard': {
      actor.guarding = true;
      break;
    }
    case 'taunt': {
      target.tauntedBy = actor.id;
      break;
    }
    case 'slow': {
      const dmg = calcDamage(actor, target, ability.power ?? 0.6, ability.element, rng);
      applyDamage(target, dmg, actor);
      target.atbModifier = 0.5;
      target.atbModifierTurnsLeft = 2;
      break;
    }
    case 'boost': {
      target.atbModifier = 2;
      target.atbModifierTurnsLeft = 1;
      break;
    }
    case 'shield-buff': {
      target.shielded = true;
      break;
    }
    case 'pulse': {
      const base = calcDamage(actor, target, ability.power ?? 1, undefined, rng);
      let final = base;
      if (target.enemyDef?.type === 'robotic') final = Math.round(base * 1.5);
      else if (target.enemyDef?.type === 'hybrid') final = Math.max(1, Math.round(base * 0.5));
      applyDamage(target, final, actor);
      break;
    }
    case 'salvage': {
      const base = calcDamage(actor, target, ability.power ?? 1, undefined, rng);
      const crit = rng() < 0.5;
      const dmg = crit ? Math.round(base * 2) : base;
      applyDamage(target, dmg, actor);
      break;
    }
    case 'flurry': {
      for (let h = 0; h < 3; h++) {
        if (target.ko) break;
        const base = calcDamage(actor, target, ability.power ?? 0.5, ability.element, rng);
        const crit = rng() < 0.15;
        const dmg = crit ? Math.round(base * 2) : base;
        applyDamage(target, dmg, actor);
      }
      break;
    }
    default:
      break;
  }
  // Guard and shield resolve at start of actor's next turn — handled in turn prep.
  units; // satisfy lint
}

function pickShockwaveTarget(enemy: SimUnit, living: SimUnit[], rng: RNG): SimUnit {
  const weights = [3, 2, 1];
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  let choice: 'atb' | 'random' | 'lastdmg' = 'atb';
  for (let i = 0; i < weights.length; i++) {
    if (r < weights[i]) {
      choice = i === 0 ? 'atb' : i === 1 ? 'random' : 'lastdmg';
      break;
    }
    r -= weights[i];
  }
  if (choice === 'lastdmg') {
    const last = enemy.lastDamagerId ? living.find((u) => u.id === enemy.lastDamagerId) : undefined;
    if (last) return last;
    choice = 'random';
  }
  if (choice === 'atb') return living.reduce((acc, u) => (u.atb > acc.atb ? u : acc));
  return living[Math.floor(rng() * living.length)];
}

function enemyTurn(enemy: SimUnit, all: SimUnit[], rng: RNG): void {
  const party = all.filter((u) => u.side === 'party' && !u.ko);
  const escort = all.find((u) => u.side === 'escort' && !u.ko);
  if (party.length === 0 && !escort) return;

  enemy.turnCount += 1;

  // Smoke grenade effect — enemy attack automatically misses this turn.
  if (enemy.missing) {
    enemy.missing = false;
    return;
  }
  const sig = enemy.enemyDef?.signatureAoE;
  const shock = enemy.enemyDef?.shockwave;

  // 3-move rotation for bosses with both moves
  if (sig && shock) {
    const phase = (enemy.turnCount - 1) % 3;
    if (phase === 1) {
      // Shockwave
      if (party.length === 0) return;
      const target = pickShockwaveTarget(enemy, party, rng);
      const dmg = calcDamage(enemy, target, shock.power, shock.element, rng);
      applyDamage(target, dmg);
      target.atb = 0;
      return;
    }
    if (phase === 2) {
      // Signature AoE
      for (const p of party) {
        const dmg = calcDamage(enemy, p, sig.power, sig.element, rng);
        applyDamage(p, dmg);
      }
      return;
    }
  } else if (sig) {
    // Simple alternation for AoE-only bosses (currently unused — wreckling has both)
    const phase = enemy.turnCount % 2;
    if (phase === 0) {
      for (const p of party) {
        const dmg = calcDamage(enemy, p, sig.power, sig.element, rng);
        applyDamage(p, dmg);
      }
      return;
    }
  }

  // Multi-hit enemies (Nanite Swarm) hit the whole party + escort at 0.85× power.
  if (enemy.enemyDef?.behavior === 'multi-hit') {
    const targets = [...party, ...(escort ? [escort] : [])];
    for (const t of targets) {
      const dmg = calcDamage(enemy, t, 0.85, undefined, rng);
      applyDamage(t, dmg);
    }
    return;
  }

  // Normal attack (phase 0 for full rotation, or default)
  let target: SimUnit | undefined;
  if (enemy.tauntedBy) {
    target = all.find((u) => u.id === enemy.tauntedBy && !u.ko);
    enemy.tauntedBy = null;
  }
  if (!target) {
    const behavior = enemy.enemyDef?.behavior ?? 'random';
    if (behavior === 'target-escort' && escort) target = escort;
    else if (behavior === 'prefer-low-hp') {
      const pool = [...party, ...(escort ? [escort] : [])];
      const weights = pool.map((p) => 1 + 2 * Math.max(0, 1 - p.hp / p.maxHp));
      const tot = weights.reduce((a, b) => a + b, 0);
      let r = rng() * tot;
      for (let i = 0; i < pool.length; i++) {
        r -= weights[i];
        if (r <= 0) {
          target = pool[i];
          break;
        }
      }
      target ??= pool[pool.length - 1];
    } else {
      const pool = [...party, ...(escort ? [escort] : [])];
      target = pool[Math.floor(rng() * pool.length)];
    }
  }
  if (!target) return;

  // Guard redirect (non-ignoresGuard only)
  const ignoreGuard = !!enemy.enemyDef?.ignoresGuard;
  const guardian = !ignoreGuard
    ? all.find((u) => u.side === 'party' && u.guarding && !u.ko)
    : undefined;
  let finalTarget = target;
  let guardHalved = false;
  if (guardian && target !== guardian) {
    finalTarget = guardian;
    guardHalved = true;
  } else if (!ignoreGuard && target.guarding) {
    guardHalved = true;
  }

  const base = calcDamage(enemy, finalTarget, 1, enemy.enemyDef?.attackElement, rng);
  const crit = rng() < 0.1;
  let dmg = crit ? Math.round(base * 2) : base;
  if (guardHalved) dmg = Math.max(1, Math.floor(dmg / 2));
  applyDamage(finalTarget, dmg);
}

export function simulate(config: SimConfig, rngSeed?: number): SimResult {
  const rng: RNG = rngSeed !== undefined ? mulberry32(rngSeed) : Math.random;

  const party = buildParty(config.partyClassIds, config.startDegraded);
  const enemyIds = config.enemyIds ?? [config.enemyId ?? 'wreckling'];
  const enemies: SimUnit[] = enemyIds.map((id, idx) => {
    const base = ENEMIES[id];
    const isLast = idx === enemyIds.length - 1;
    const def: EnemyDef = isLast ? { ...base, ...(config.enemyOverrides ?? {}) } : { ...base };
    return buildEnemy(def);
  });
  const escort = buildEscort();
  const all: SimUnit[] = [...party, ...enemies, escort];
  const inventory: Record<string, number> = {
    stimpak: 0,
    powercell: 0,
    adrenaline: 0,
    smokegrenade: 0,
    ...(config.startingInventory ?? {}),
  };
  const itemsUsed: Record<string, number> = {};
  const escortHpStart = escort.hp;
  const primaryEnemy = enemies[enemies.length - 1];

  let simSeconds = 0;
  let turns = 0;
  const MAX_TURNS = 150;

  while (turns < MAX_TURNS) {
    // End conditions
    if (enemies.every((e) => e.ko))
      return buildResult(
        true,
        simSeconds,
        turns,
        escort,
        escortHpStart,
        primaryEnemy,
        party,
        itemsUsed,
      );
    if (escort.ko)
      return buildResult(
        false,
        simSeconds,
        turns,
        escort,
        escortHpStart,
        primaryEnemy,
        party,
        itemsUsed,
      );
    if (party.every((p) => p.ko))
      return buildResult(
        false,
        simSeconds,
        turns,
        escort,
        escortHpStart,
        primaryEnemy,
        party,
        itemsUsed,
      );

    // Advance time to next full-ATB actor. Units with speed 0 (escort) never act.
    const candidates = all.filter((u) => !u.ko && u.speed > 0);
    if (candidates.length === 0) break;

    let minT = Infinity;
    let next: SimUnit | null = null;
    for (const u of candidates) {
      if (u.atb >= ATB_MAX) {
        next = u;
        minT = 0;
        break;
      }
      const rate = u.speed * ATB_RATE * u.atbModifier;
      if (rate <= 0) continue;
      const t = (ATB_MAX - u.atb) / rate;
      if (t < minT) {
        minT = t;
        next = u;
      }
    }
    if (!next) break;

    for (const u of candidates) {
      if (u === next) {
        u.atb = ATB_MAX;
        continue;
      }
      u.atb += u.speed * ATB_RATE * u.atbModifier * minT;
    }
    simSeconds += minT;
    turns += 1;

    // Turn prep (mirror CombatScene beginPartyTurn / beginEnemyTurn):
    // Guard clears, shield clears, atb modifier countdown, taunt clears will
    // happen on enemy turn when consumed.
    if (next.side === 'party') {
      next.guarding = false;
      next.shielded = false;
      if (next.atbModifierTurnsLeft > 0) {
        next.atbModifierTurnsLeft--;
        if (next.atbModifierTurnsLeft === 0) next.atbModifier = 1;
      }
      const action = pickPartyAction(
        next,
        party,
        all.filter((u) => u.side === 'enemy' && !u.ko),
        escort,
        inventory,
      );
      executeParty(next, action, all, inventory, itemsUsed, rng);
    } else {
      // enemy
      if (next.atbModifierTurnsLeft > 0) {
        next.atbModifierTurnsLeft--;
        if (next.atbModifierTurnsLeft === 0) next.atbModifier = 1;
      }
      enemyTurn(next, all, rng);
    }
    next.atb = 0;
  }

  return buildResult(
    false,
    simSeconds,
    turns,
    escort,
    escortHpStart,
    primaryEnemy,
    party,
    itemsUsed,
  );
}

// ========= Route simulation (multi-encounter) =========

export function simulateRoute(config: RouteConfig, rngSeed?: number): RouteResult {
  const rng: RNG = rngSeed !== undefined ? mulberry32(rngSeed) : Math.random;
  const party = buildParty(config.partyClassIds, false);
  const escort = buildEscort();
  const inventory: Record<string, number> = {
    stimpak: 0,
    powercell: 0,
    adrenaline: 0,
    smokegrenade: 0,
    ...(config.startingInventory ?? {}),
  };
  const itemsUsed: Record<string, number> = {};
  const restAfter = new Set(config.restAfter ?? []);

  let totalSeconds = 0;
  let totalTurns = 0;
  let encountersCleared = 0;
  let bossWon = false;

  for (let i = 0; i < config.encounters.length; i++) {
    const enc = config.encounters[i];
    const enemies: SimUnit[] = enc.enemyIds.map((id, idx) => {
      const base = ENEMIES[id];
      const isLast = idx === enc.enemyIds.length - 1;
      const def: EnemyDef =
        isLast && enc.enemyOverrides ? { ...base, ...enc.enemyOverrides } : { ...base };
      return buildEnemy(def);
    });
    // Reset per-encounter state on party
    for (const p of party) {
      p.atb = 0;
      p.guarding = false;
      p.shielded = false;
      p.tauntedBy = null;
      p.atbModifier = 1;
      p.atbModifierTurnsLeft = 0;
    }
    const all: SimUnit[] = [...party, ...enemies, escort];
    const result = runEncounter(all, party, enemies, escort, inventory, itemsUsed, rng);
    totalSeconds += result.seconds;
    totalTurns += result.turns;
    if (!result.win) {
      return {
        routeWon: false,
        encountersCleared,
        bossWon: enc.isBoss ? false : bossWon,
        simSeconds: totalSeconds,
        turns: totalTurns,
        escortHpEnd: escort.hp,
        partyKoCount: party.filter((p) => p.ko).length,
        partyHpEndPct:
          party.reduce((acc, p) => acc + p.hp / p.maxHp, 0) / Math.max(1, party.length),
        itemsUsed,
      };
    }
    encountersCleared++;
    if (enc.isBoss) bossWon = true;
    // Rest after this encounter? Heal partially and refill limited abilities.
    if (restAfter.has(i)) {
      for (const p of party) {
        if (p.ko) p.hp = Math.max(1, Math.round(p.maxHp * 0.25));
        else p.hp = Math.min(p.maxHp, Math.round(p.hp + p.maxHp * 0.3));
        p.ko = false;
        if (p.maxMp > 0) p.mp = Math.min(p.maxMp, Math.round(p.mp + p.maxMp * 0.2));
        // Refill limited abilities
        if (p.classDef) {
          for (const ab of p.classDef.abilities) {
            if (ab.maxUsesPerRest !== undefined) p.abilityUses[ab.id] = ab.maxUsesPerRest;
          }
        }
      }
      escort.hp = Math.min(escort.maxHp, Math.round(escort.hp + escort.maxHp * 0.15));
    }
  }

  return {
    routeWon: true,
    encountersCleared,
    bossWon,
    simSeconds: totalSeconds,
    turns: totalTurns,
    escortHpEnd: escort.hp,
    partyKoCount: party.filter((p) => p.ko).length,
    partyHpEndPct: party.reduce((acc, p) => acc + p.hp / p.maxHp, 0) / Math.max(1, party.length),
    itemsUsed,
  };
}

// Inner encounter loop reusable by route simulation. Returns win=true if all enemies KO'd.
function runEncounter(
  all: SimUnit[],
  party: SimUnit[],
  enemies: SimUnit[],
  escort: SimUnit,
  inventory: Record<string, number>,
  itemsUsed: Record<string, number>,
  rng: RNG,
): { win: boolean; seconds: number; turns: number } {
  let seconds = 0;
  let turns = 0;
  const MAX_TURNS = 150;

  while (turns < MAX_TURNS) {
    if (enemies.every((e) => e.ko)) return { win: true, seconds, turns };
    if (escort.ko) return { win: false, seconds, turns };
    if (party.every((p) => p.ko)) return { win: false, seconds, turns };

    const candidates = all.filter((u) => !u.ko && u.speed > 0);
    if (candidates.length === 0) break;
    let minT = Infinity;
    let next: SimUnit | null = null;
    for (const u of candidates) {
      if (u.atb >= ATB_MAX) {
        next = u;
        minT = 0;
        break;
      }
      const rate = u.speed * ATB_RATE * u.atbModifier;
      if (rate <= 0) continue;
      const t = (ATB_MAX - u.atb) / rate;
      if (t < minT) {
        minT = t;
        next = u;
      }
    }
    if (!next) break;
    for (const u of candidates) {
      if (u === next) {
        u.atb = ATB_MAX;
        continue;
      }
      u.atb += u.speed * ATB_RATE * u.atbModifier * minT;
    }
    seconds += minT;
    turns += 1;
    if (next.side === 'party') {
      next.guarding = false;
      next.shielded = false;
      if (next.atbModifierTurnsLeft > 0) {
        next.atbModifierTurnsLeft--;
        if (next.atbModifierTurnsLeft === 0) next.atbModifier = 1;
      }
      const action = pickPartyAction(
        next,
        party,
        all.filter((u) => u.side === 'enemy' && !u.ko),
        escort,
        inventory,
      );
      executeParty(next, action, all, inventory, itemsUsed, rng);
    } else {
      if (next.atbModifierTurnsLeft > 0) {
        next.atbModifierTurnsLeft--;
        if (next.atbModifierTurnsLeft === 0) next.atbModifier = 1;
      }
      enemyTurn(next, all, rng);
    }
    next.atb = 0;
  }
  return { win: enemies.every((e) => e.ko), seconds, turns };
}

export interface RouteStats {
  trials: number;
  routeWinRate: number;
  bossWinRate: number;
  avgEncountersCleared: number;
  avgEscortHpEnd: number;
  avgPartyHpEndPct: number;
  avgItemsUsed: Record<string, number>;
  escortKoRate: number;
}

export function runRouteTrials(config: RouteConfig, trials: number): RouteStats {
  let routeWins = 0;
  let bossWins = 0;
  let encountersSum = 0;
  let escortHpSum = 0;
  let escortKos = 0;
  let hpPctSum = 0;
  const itemsUsedSum: Record<string, number> = {};
  for (let i = 0; i < trials; i++) {
    const r = simulateRoute(config);
    if (r.routeWon) routeWins++;
    if (r.bossWon) bossWins++;
    encountersSum += r.encountersCleared;
    escortHpSum += r.escortHpEnd;
    if (r.escortHpEnd <= 0) escortKos++;
    hpPctSum += r.partyHpEndPct;
    for (const [k, v] of Object.entries(r.itemsUsed)) {
      itemsUsedSum[k] = (itemsUsedSum[k] ?? 0) + v;
    }
  }
  const avgItemsUsed: Record<string, number> = {};
  for (const [k, v] of Object.entries(itemsUsedSum)) avgItemsUsed[k] = v / trials;
  return {
    trials,
    routeWinRate: routeWins / trials,
    bossWinRate: bossWins / trials,
    avgEncountersCleared: encountersSum / trials,
    avgEscortHpEnd: escortHpSum / trials,
    escortKoRate: escortKos / trials,
    avgPartyHpEndPct: hpPctSum / trials,
    avgItemsUsed,
  };
}

function buildResult(
  win: boolean,
  simSeconds: number,
  turns: number,
  escort: SimUnit,
  escortHpStart: number,
  enemy: SimUnit,
  party: SimUnit[],
  itemsUsed: Record<string, number>,
): SimResult {
  return {
    win,
    simSeconds,
    turns,
    escortHpEnd: escort.hp,
    escortHpStart,
    enemyHpEnd: enemy.hp,
    partyKoCount: party.filter((p) => p.ko).length,
    partyHpEndPct: party.reduce((acc, p) => acc + p.hp / p.maxHp, 0) / Math.max(1, party.length),
    itemsUsed,
  };
}

export function runTrials(config: SimConfig, trials: number): SimStats {
  let wins = 0;
  let turnsSum = 0;
  let escortHpSum = 0;
  let escortKos = 0;
  let partyKoSum = 0;
  let hpPctSum = 0;
  const itemsUsedSum: Record<string, number> = {};
  for (let i = 0; i < trials; i++) {
    const r = simulate(config);
    if (r.win) wins++;
    turnsSum += r.turns;
    escortHpSum += r.escortHpEnd;
    if (r.escortHpEnd <= 0) escortKos++;
    partyKoSum += r.partyKoCount;
    hpPctSum += r.partyHpEndPct;
    for (const [k, v] of Object.entries(r.itemsUsed)) {
      itemsUsedSum[k] = (itemsUsedSum[k] ?? 0) + v;
    }
  }
  const avgItemsUsed: Record<string, number> = {};
  for (const [k, v] of Object.entries(itemsUsedSum)) avgItemsUsed[k] = v / trials;
  return {
    trials,
    winRate: wins / trials,
    avgTurns: turnsSum / trials,
    avgEscortHpEnd: escortHpSum / trials,
    escortKoRate: escortKos / trials,
    avgPartyKo: partyKoSum / trials,
    avgPartyHpEndPct: hpPctSum / trials,
    avgItemsUsed,
  };
}

// Tiny seeded PRNG so reports can be reproducible if we want.
function mulberry32(seed: number): RNG {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
