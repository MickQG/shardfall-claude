# 001 Foundation (milestone 1)

Scaffold, determinism primitives, traceability, CI, deployment and the first render.

- **FND-1**: The simulation exposes `createGame`, `submit`, `tick`, `snapshot` and `hash` as its only public API (`src/sim/index.ts`).
- **FND-2**: The simulation PRNG is seeded; the same seed yields the same sequence, different seeds differ.
- **FND-3**: Two games created with the same seed and fed identical commands have identical state hashes after N ticks; a different seed gives a different hash.
- **FND-4**: A game is created from a map definition (width, height, per-tile height); the snapshot reports the map dimensions and tick number.
- **FND-5**: Isometric projection maps tile coordinates to screen and back without loss (round trip).
- **FND-6**: `npm run trace` fails when a requirement ID in `specs/` has no citing test and passes otherwise.
- **FND-7**: Non-deterministic APIs (`Math.random`, `Date`, `performance`, DOM) are rejected by lint inside `src/sim`, `src/ai` and `src/data`.
- **FND-8**: The built app loads in a browser, renders a non-blank canvas showing the isometric map, and exposes a PWA manifest.
- **FND-9**: CI runs lint, type-check, unit tests, trace, build and e2e on every PR, and the full AI-vs-AI matches (the AI harness on every map and the statistical match tests) in parallel jobs on every push to `main` and on every PR that changes the simulation, AI, data or those tests (#107); `main` deploys to Azure Static Web Apps and PRs get previews.
- **FND-10**: `npm run trace` fails when the same requirement ID is defined more than once across `specs/`.
