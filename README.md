# Shardfall

An original isometric real-time strategy game for the browser: **Humans vs Aliens**, one map, one resource (shards), and an AI that plays by the same rules you do. Built with Claude using spec-driven development.

**Play:** https://black-sea-00f40ee03.6.azurestaticapps.net

## How it is built
- **Spec first:** requirements with stable IDs live in [`specs/`](specs/README.md); the umbrella spec is issue #1.
- **Provable:** every requirement ID must be cited by a test. `npm run trace` (and CI) fails otherwise.
- **Deterministic sim:** `src/sim` is pure TypeScript with a seeded PRNG and integer math; everything else talks to it through one API. See [`CONSTITUTION.md`](CONSTITUTION.md) and [`docs/adr`](docs/adr).
- **Stack:** TypeScript, Vite, PixiJS v8, Vitest, Playwright; static hosting on Azure Static Web Apps; installable as a PWA.

## Develop
```
npm install
npm run dev
npm run lint && npm run typecheck && npm test && npm run trace
npm run e2e
```

Original names, art and audio only. MIT licensed.
