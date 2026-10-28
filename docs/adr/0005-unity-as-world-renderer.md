# ADR 0005: Unity as the world renderer, the TypeScript game stays the brain

**Status:** accepted

**Decision.** The Unity port is a second, optional *renderer* for the web game, deployed as its own static web app (`swa-shardfall-unity`). A Unity 6 WebGL player draws the 3D world (terrain, rocks, crystals, props, units, buildings) with real lighting, shadows and post-processing. Everything else stays exactly as it is: the deterministic simulation and AI (running in the existing Web Worker), the HUD, input, picking, fog of war, selection and alerts (TypeScript, DOM and a transparent Pixi overlay on top of the Unity canvas). Gameplay is therefore identical by construction.

**How the two halves talk.** The page loads the Unity build next to the game. Each rendered frame TypeScript packs the camera and the interpolated units and buildings into a fixed-layout `Float32Array` that lives in Unity's WebAssembly heap (no JSON per frame) and pokes Unity to read it. Static world data (map size, heights, shards) and the voxel model library (exported from the same TypeScript models the sprite baker uses) are sent once as JSON. Unity's orthographic camera is set up from the TypeScript camera so one tile spans exactly 64 by 32 pixels at zoom 1; the existing hit-testing, overlays and fog stay pixel-correct without change.

**Why.**
- The graphics goal needs a real 3D engine (lighting, shadows, bloom, ambient occlusion); sprites baked by the software baker cannot get there.
- Reusing the TypeScript sim, AI, UI and the 120+ traced requirements avoids a second implementation that could drift.
- Voxel models are already data; Unity turns the same models into meshes, so there is one source of art truth.

**Alternatives rejected.**
- Porting the simulation and AI to C#: months of work, a second implementation to keep in sync, and the traceability and determinism tests would have to be rebuilt.
- A full Unity game (UI included): same duplication problem, plus Unity WebGL has no threads, so the sim would have to run on the main thread.
- Another 3D library (three.js, Babylon): would work technically, but the product owner asked for Unity.

**Consequences.**
- CI needs a Unity license (GameCI `unity-builder`). Personal-license activation for CI is awkward, so the Unity job is skipped until the secrets exist and never blocks the web build.
- The Unity build is large (tens of MB); the free static web app tier (250 MB) is enough.
- Constitution rule 7 holds: the web build does not depend on Unity. Unity is selected by `?renderer=unity` or by the Unity deployment's build flag, and the game falls back to the Pixi renderer if Unity fails to load.
- Pixi keeps drawing fog, selection, bars, scaffolds, rally lines, placement ghosts and (initially) effects above the Unity canvas.
