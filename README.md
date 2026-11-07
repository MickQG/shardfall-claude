# Shardfall

An original real-time 3D strategy game for the browser: **Aegis Union (humans)** versus the **Vrax Hive (aliens)**, fair generated maps, one resource (shards), and an AI that plays by the same rules you do. Built with Claude using spec-driven development.

**Play:** https://black-sea-00f40ee03.6.azurestaticapps.net (installable as a PWA)

Harvest shards, build a base up a three-tier tech tree, scout through fog of war, and destroy the enemy base. Play solo against the AI (pick a faction, level Easy / Medium / Hard and personality Raider / Balanced / Doomsday) or online 1v1.

| Input | Action |
|---|---|
| Left-click / drag | select / box-select (double-click: all of that kind on screen) |
| Right-click | move, attack, harvest (on shards), or set a building's rally point |
| `A` then click | attack-move |
| `X` | stop |
| `Ctrl+1-9` / `1-9` | assign / recall control groups |
| `WASD`, screen edges, wheel | scroll and zoom; click or drag the minimap |
| `P` / `Esc`, `+` / `-`, `M`, `Q` | pause, game speed (default x0.8), mute, graphics quality |

## How it is built

- **Spec first.** Requirements with stable IDs live in [`specs/`](specs/README.md) (umbrella spec: issue #1). Every requirement ID must appear in a test name; `npm run trace` (and CI) fails otherwise. About 250 requirements today.
- **One seam.** `src/sim` is a deterministic, fixed-tick, integer-math simulation behind a small API (`createGame`, `submit`, `tick`, `snapshot`, `hash`). The renderer, UI, AI and tests only use that API. No `Math.random`, `Date` or DOM is allowed in `src/sim`, `src/ai` or `src/data` (enforced by lint). See [`CONSTITUTION.md`](CONSTITUTION.md) and [`docs/adr`](docs/adr).
- **Same rules for the AI.** The AI reads a fog-limited snapshot and issues ordinary commands. Difficulty changes only reaction time, orders per decision and a shard bonus. A headless AI-vs-AI harness (`npm run harness`, `npm run test:matches`) plays full matches in CI and checks for bad behaviour: idle haulers, stuck units, power outages, hoarded shards, undefended bases, suicidal waves.
- **Procedural everything.** All art is generated in code: a real-time 3D view with three.js (models, terrain, bloom, particles) and the classic isometric PixiJS view behind `?renderer=classic`. All audio is synthesised with Web Audio. No third-party assets.
- **Stack.** TypeScript, Vite, three.js, PixiJS v8, Vitest, Playwright; Azure Static Web Apps (with a preview per PR) and Azure Web PubSub for online play.

## Develop

```
npm install
npm run dev
npm run lint && npm run typecheck && npm test && npm run trace
npm run test:matches  # full AI-vs-AI matches (slow; when sim, ai or data change)
npm run bench      # sim tick budget: 200 units under 12 ms p99
npm run harness    # AI-vs-AI matches
npm run e2e        # Playwright against a fresh build
```

## Desktop app

The same build runs in a desktop window (Electron, see `docs/adr/0004-electron-desktop-shell.md`):

```
npm run desktop        # build, then open the game in a desktop window
npm run desktop:dist   # Windows portable .exe and installer in release/
```

The Windows build is run by hand from the Actions tab (`.github/workflows/desktop.yml`).

Dev scenarios: `?faction=human&scenario=duel` (a fight starts at once) and `?scenario=rush` (a quick win).

Original names, art and audio only. MIT licensed.
