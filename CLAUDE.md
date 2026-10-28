# CLAUDE.md

Shardfall: an original isometric 2D RTS (Humans vs Aliens) for the browser. Start with `CONSTITUTION.md`, then `specs/README.md`.

## Rules
- Behaviour comes from `specs/*.md`. Each requirement has an ID; every ID must appear in a test name. Run `npm run trace`.
- Never use `Math.random`, `Date`, `performance.now` or DOM in `src/sim` or `src/ai`. Talk to the sim only via `src/sim/index.ts`.
- Work on a feature branch per GitHub issue; open a PR citing requirement IDs; never push to `main`.
- Before a PR: `npm run lint && npm run typecheck && npm test && npm run trace`.
- Original IP only; no secrets in the repo.

## Commands
`npm run dev` · `npm run build` · `npm test` · `npm run lint` · `npm run typecheck` · `npm run trace` · `npm run bench` · `npm run e2e`

## Layout
`src/sim` deterministic core · `src/ai` AI client · `src/render` PixiJS renderer · `src/ui` HUD and input · `src/data` factions, units, maps · `scripts` tooling · `specs` requirements · `docs/adr` decisions
