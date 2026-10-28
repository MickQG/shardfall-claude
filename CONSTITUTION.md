# Constitution

Non-negotiables for Shardfall. A change that violates one of these is rejected, however good it looks.

1. **Spec first.** Behaviour is defined in `specs/` as requirements with stable IDs (e.g. `SIM-3`). Code without a requirement is out of scope; a requirement without a test is incomplete.
2. **Traceability.** Every requirement ID is cited by at least one automated test (the ID appears in the test name). CI runs `npm run trace` and fails otherwise.
3. **Deterministic simulation.** The simulation (`src/sim`) uses a fixed tick, a seeded PRNG it owns, integer arithmetic for game state, and a stable iteration order. No `Math.random`, `Date`, `performance.now`, or DOM access inside `src/sim` or `src/ai`. Enforced by lint and tests.
4. **One seam.** UI, renderer, AI and tests talk to the simulation only through its public API (`src/sim/index.ts`): create, submit commands, tick, snapshot, hash.
5. **Same rules for the AI.** The AI sees only fog-limited snapshots and issues ordinary commands. Difficulty may change reaction time, actions per minute and a resource bonus, never vision or rules.
6. **Original IP only.** No third-party names, art, audio, stats or trademarks. CC0 assets only with attribution in `CREDITS.md`.
7. **Host-agnostic static build.** The game is static files and must not depend on a specific host or desktop wrapper.
8. **Performance budget.** 60 fps with 200 units on mid-range integrated graphics; the sim tick benchmark enforces a tick-time ceiling in CI.
9. **Reviewable history.** One feature branch and one PR per issue. PRs cite requirement IDs. `main` stays deployable.
10. **No secrets in the repo.** Deployment tokens live in GitHub secrets only.
