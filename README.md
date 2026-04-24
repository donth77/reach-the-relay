# Reach the Relay

A turn-based RPG set in the ruins of an AI apocalypse, built for **Vibe Jam 2026**. SNES-era FF6 / Dragon Quest III inspired, ATB combat, built in Phaser 4 + TypeScript.

> The AIs turned on their human counterparts. Most of the world didn't make it.
>
> What's left of the super-AI still patrols the ruins as **the Censor** — a hunter network that triangulates any signal it can pick off the air. Sensitive data doesn't travel by radio anymore. It walks.
>
> Dr. Vey has two months of field observations on Censor patrol patterns locked partly in their head. That data has to reach the Relay tower — a fortified broadcast site the Censor can't storm.
>
> That's where your crew comes in.

**▶ Play it: [reach-the-relay.pages.dev](https://reach-the-relay.pages.dev)**

---

## What is this?

Pick a leader. Recruit a crew of three from the Greenhouse commune. Choose a route. Escort Dr. Vey through a chain of ATB combat encounters — and the rest stops between them — to the Relay tower.

## Features

- Five playable classes — Vanguard, Netrunner, Medic, Scavenger, Cybermonk — each with unique abilities, elemental attacks, and limited-use specials
- Three routes across three difficulty tiers, with the "Dead Substation" route ending in a boss fight against the **Wreckwarden**
- ATB combat with elemental vulnerabilities (🔥 thermal / ❄ coolant / ⚡ surge), criticals, and ability targeting
- Walkable lobby — recruit survivors, study the map, plan your run
- Rest stops that replenish abilities and patch up your crew
- Global leaderboard — submit a callsign or play anonymously

## Controls

- **Arrow keys / WASD** — move
- **E / Enter / Space** — interact, confirm
- **ESC** — pause menu
- **Mouse** — click targets, menus, items
- **Mobile** — touch controls with on-screen buttons (landscape required)

## Classes

| Class     | Role                     | Key abilities                                                        |
| --------- | ------------------------ | -------------------------------------------------------------------- |
| Vanguard  | Frontline striker + tank | FIGHT, GUARD\* (intercept), TAUNT\*                                  |
| Netrunner | Elemental DPS            | JACK, OVERLOAD (🔥), FROSTLOCK (❄ + slow), SURGE (⚡)                |
| Medic     | Support + healing        | STRIKE, PATCH (heal), PULSE (anti-robotic), AMP (free turn), SHIELD  |
| Scavenger | Physical crit + utility  | SLICE, SALVAGE\* (50% crit + 25% item drop)                          |
| Cybermonk | Physical multi-hit       | FIGHT, FOCUS (self-heal), FLURRY\* (3 hits)                          |

\* *Rest-limited* (D&D-style spell slots). Uses carry across combat encounters and refill only at a Rest scene — so you choose which encounters to burn them on.

Enemies are tagged `robotic` or `hybrid`; Medic's **PULSE** is 1.5× vs robotic, 0.5× vs hybrid. Elemental damage flags 🔥 thermal, ❄ coolant, ⚡ surge — each enemy has a vulnerability (1.5×) and optional resistances (0.5×). Glyphs appear on damage numbers.

> **Full ability tables, enemy stats, boss move rotation, item effects, and starting inventory live in [`GAME_MECHANICS.md`](./GAME_MECHANICS.md).**

## Score

Victory only:

```
score = (VIP HP × 2) + Σ (remaining HP of each party member) + difficulty bonus
```

VIP HP is doubled because protecting Dr. Vey is the core mission. KO'd party members contribute 0. The difficulty bonus (easy 100 / medium 400 / hard 800) ensures harder routes always outrank easier ones.

---

## Local development

```bash
npm install
npm run dev          # vite dev server at http://localhost:5173
npm run build        # typecheck + production build
```

For everything else — full scripts list, tech stack, scene flow, directory guide, state management, audio architecture, asset pipeline — see [`CLAUDE.md`](./CLAUDE.md).

---

## Credits

Built for Vibe Jam 2026.

- Engines / tools: Phaser 4, Vite, TypeScript, Claude Code
- Asset generation: SpriteCook, PixelLab, ElevenLabs, Suno, Hugging Face Z-Image Turbo, Google Gemini / Nano Banana
- Font: [Silkscreen](https://fonts.google.com/specimen/Silkscreen) by Jason Kottke (SIL OFL 1.1)

## License

Source code: [MIT](./LICENSE).

**Generated assets** under `public/assets/` (sprites, audio, backgrounds, etc.) were produced via the AI services listed above and are licensed for use in this game under the original author's accounts with those services. They are **not** covered by the MIT license on the source code. If you fork this project, you'll need to either regenerate equivalent assets via your own accounts or substitute your own art / audio.
