export const FONT = 'Silkscreen, monospace';

/**
 * True when the browser reports a touch-first primary input. Used to
 * swap "▼ E" keyboard hints for "▼ TAP", render an on-screen action
 * button in the lobby, and scale NPC dialogue modals up so they read
 * at phone-screen sizes.
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    (navigator.maxTouchPoints ?? 0) > 0 || window.matchMedia?.('(pointer: coarse)').matches === true
  );
}

/** The floating interact-prompt label — keyboard on desktop, tap hint on touch. */
export function interactPromptText(): string {
  return isTouchDevice() ? '▼ TAP' : '▼ E';
}

/**
 * Strips leading `[KEY] ` keyboard hints from UI labels on touch
 * devices, leaving them as-is on desktop. Mobile players can't press
 * keys so the bracket reads as a typo. Labels that wouldn't otherwise
 * be recognizable as buttons without the bracket (e.g. "MISSION
 * BRIEFING") should use an explicit `[TAP] ...` prefix at the call
 * site rather than this helper.
 *
 *   keyHintLabel('[E] CLOSE') → '[E] CLOSE' on desktop, 'CLOSE' on touch
 */
export function keyHintLabel(label: string): string {
  if (!isTouchDevice()) return label;
  return label.replace(/^\[[^\]]+\]\s*/, '').trim();
}
