# ADR 0001: Deterministic simulation behind a single seam

**Status:** accepted

**Context.** The game must be testable by AI-vs-AI headless play, keep 60 fps rendering with many units, and leave replays and multiplayer possible.

**Decision.** The simulation is pure TypeScript with a fixed tick, seeded PRNG and integer math, exposed through one API. The browser runs it in a Web Worker; the renderer interpolates between snapshots.

**Consequences.** Every rule is unit-testable; same seed + commands gives the same hash. Costs: no floating-point game state, no wall-clock time in the sim.
