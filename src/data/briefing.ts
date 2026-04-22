// Mission briefing copy — single source of truth shared across every
// surface that explains the game's objective to the player:
//   - TitleScene "How to Play" menu entry
//   - Map board modal in the lobby
//   - Dr. Vey's dialogue [B] BRIEFING branch
//
// Keep it short. Every copy below has to fit multiple UI surfaces with
// different widths; long paragraphs become unreadable when wrapped.

export const BRIEFING_TITLE = 'THE MISSION';

export const BRIEFING_LEAD =
  'Escort Dr. Vey from the Greenhouse to the Relay. Their research on Censor patrol patterns has to reach the broadcast tower.';

export interface BriefingSection {
  heading: string;
  text: string;
}

export const BRIEFING_SECTIONS: BriefingSection[] = [
  {
    heading: 'OBJECTIVE',
    text: 'Pick a leader, recruit two companions, choose a route. Survive every encounter with Dr. Vey alive.',
  },
  {
    heading: 'DEFEAT',
    text: "Dr. Vey's HP reaches zero, or all three party members fall. Either ends the run.",
  },
  {
    heading: 'THE CENSOR',
    text: 'An AI fragment still enforcing its old information-control directive. Some of its patrols will ignore your crew and go straight for Dr. Vey — keep them alive however you can.',
  },
];

// Worldbuilding paragraph shown at the bottom of the briefing modal in
// a dimmer color, italicized — separates "rules of play" above from
// "setting flavor" here. Short on purpose; the lobby + enemy names
// already carry most of the worldbuilding.
export const BRIEFING_BACKGROUND =
  "Decades ago, a super AI brought civilization down and splintered. Its shards still patrol the ruins, enforcing old directives. The Censor triangulates any signal it can pick off the air — so sensitive payloads don't travel by radio, they walk. The Relay transmits from a fortified hilltop the Censor can't storm; every commune tunes in for its signal. Dr. Vey's patrol-pattern notes live partly in their head — only they can encode them into the Relay's looped broadcast.";
