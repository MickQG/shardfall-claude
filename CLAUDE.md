# CLAUDE.md

Shardfall: an original RTS (Humans vs Aliens) for the browser, drawn in real-time 3D (three.js, ADR 0005) with the classic isometric 2D view behind `?renderer=classic`. Start with `CONSTITUTION.md`, then `specs/README.md`.

## Rules
- Behaviour comes from `specs/*.md`. Each requirement has an ID; every ID must appear in a test name. Run `npm run trace`.
- Never use `Math.random`, `Date`, `performance.now` or DOM in `src/sim` or `src/ai`. Talk to the sim only via `src/sim/index.ts`.
- Work on a feature branch per GitHub issue; open a PR citing requirement IDs; never push to `main`.
- Before a PR: `npm run lint && npm run typecheck && npm test && npm run trace`. When the change touches `src/sim`, `src/ai` or `src/data`, also `npm run test:matches` (full AI-vs-AI matches; slow).
- Original IP only; no secrets in the repo.

## Commands
`npm run dev` · `npm run build` · `npm test` · `npm run test:matches` · `npm run lint` · `npm run typecheck` · `npm run trace` · `npm run bench` · `npm run e2e` · `npm run desktop` · `npm run desktop:dist`

## Layout
`src/sim` deterministic core · `src/ai` AI client · `src/render3d` three.js renderer (default) · `src/render` classic PixiJS renderer and the shared projector · `src/ui` HUD and input · `src/data` factions, units, maps · `scripts` tooling · `specs` requirements · `docs/adr` decisions
