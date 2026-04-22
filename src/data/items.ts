export type ItemTargetType = 'ally-or-vip' | 'ko-ally' | 'caster' | 'all-enemies';

export type ItemEffectKind = 'heal' | 'restore-mp' | 'revive' | 'smoke-miss';

export interface ItemDef {
  id: string;
  label: string;
  description: string;
  target: ItemTargetType;
  effect: ItemEffectKind;
  power?: number;
}

export const ITEMS: Record<string, ItemDef> = {
  stimpak: {
    id: 'stimpak',
    label: 'STIMPAK',
    description: 'Restore 25 HP to one ally or Dr. Vey.',
    target: 'ally-or-vip',
    effect: 'heal',
    power: 25,
  },
  powercell: {
    id: 'powercell',
    label: 'POWER CELL',
    description: 'Restore 10 MP to one caster (Netrunner or Medic).',
    target: 'caster',
    effect: 'restore-mp',
    power: 10,
  },
  adrenaline: {
    id: 'adrenaline',
    label: 'ADRENALINE',
    description: "Revive a KO'd party member at 25% HP.",
    target: 'ko-ally',
    effect: 'revive',
    power: 0.25,
  },
  smokegrenade: {
    id: 'smokegrenade',
    label: 'SMOKE GRENADE',
    description: 'All enemies miss their next action.',
    target: 'all-enemies',
    effect: 'smoke-miss',
  },
};

export const ITEM_ORDER = ['stimpak', 'powercell', 'adrenaline', 'smokegrenade'] as const;

export type Inventory = Record<string, number>;

export const STARTING_INVENTORY: Record<string, Inventory> = {
  'long-highway': { stimpak: 3, powercell: 2, adrenaline: 1, smokegrenade: 1 },
  'transit-line': { stimpak: 2, powercell: 1, adrenaline: 1, smokegrenade: 0 },
  'direct-line': { stimpak: 1, powercell: 1, adrenaline: 0, smokegrenade: 0 },
};
