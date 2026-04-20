// Short one-sentence blurbs per class, split by purpose:
//
// - ROLE_BLURBS: mechanics-focused (what they DO in combat). Shown on
//   the Leader Select screen so the player knows what role they're
//   picking.
// - LORE_BLURBS: worldbuilding-focused (who they ARE). Shown in the
//   NPC dialogue modal so recruiting a companion has a hint of their
//   backstory, not just their stat block.

export const CLASS_ROLE_BLURBS: Record<string, string> = {
  vanguard:
    'Frontline tank. Intercepts hits with GUARD, pulls aggro with TAUNT. Steady, loud, and hard to move.',
  netrunner:
    'Signal-jamming caster. Overloads circuits with thermal, electric, and coolant packets. Fragile, but the only one who can crack hardened targets.',
  medic:
    'Field technician. PATCH keeps the escort upright; PULSE shreds robotics; STIM rushes a teammate back into the fight.',
  scavenger:
    'Salvage artist. Critical hits and a chance to pull items off downed enemies. Thrives on quick, dirty engagements.',
  cybermonk:
    'Rhythmic martial artist. FLURRY hits three times before you blink; FOCUS tops themselves off without a medic.',
};

export const CLASS_LORE_BLURBS: Record<string, string> = {
  vanguard:
    'Corps soldier before the fall. Lost the unit. Still wears the patch — says it reminds them who to stand in front of.',
  netrunner:
    'Coastal-cell kid who cut their teeth jailbreaking vending machines. Reads dead protocols like native tongues.',
  medic:
    'Ran a tunnel clinic through the worst winters. Greenhouse traded them three seasons of filters to keep them here.',
  scavenger:
    'Third-generation picker. Knows which pre-fall malls still have batteries worth pulling and which ones will kill you.',
  cybermonk:
    'Wandered in from the highway a year ago carrying nothing but a prayer drum. Hasn\'t left. Hasn\'t explained why.',
};
