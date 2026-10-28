# ADR 0003: Procedural voxel sprites for units, buildings and props

**Status:** accepted

**Decision.** Units and buildings are small voxel models defined in code. A software baker rotates each model to N facings, shades it with a fixed light, adds a ground shadow, supersamples for smooth edges, and caches the result as a sprite texture. PixiJS draws those sprites. The vector drawing in `unitArt.ts` and `buildingArt.ts` is replaced model by model.

**Why.** The solid, lit, many-angle look of classic isometric RTS art comes from pre-rendered 3D voxel models. Flat vector shapes cannot reach it however much detail is added. Generating the models in code keeps the art original (Constitution rule 6), needs no downloaded assets, and keeps the static build self-contained.

**Alternatives rejected.**
- Richer 2D vector drawing: faster, but no solid lit look at any number of facings.
- CC0 sprite packs: best-looking per hour, but gives up original art and adds licensing and credits work.
- Real-time 3D (three.js): heavier bundle, breaks the 2D pipeline, harder to hold the performance budget.

**Consequences.**
- The baker is pure (typed arrays in, RGBA out) so it is unit-tested without a browser. Only the upload to a GPU texture touches the DOM.
- Sprites are baked lazily per (kind, team colour, facing) and cached; startup stays fast.
- Animated extras (rotors, beacons, smoke, scaffolds) stay as Pixi overlays on top of the sprites.
- Models are authored in voxel units (8 per tile edge, 4 px per voxel of height). Hard to reverse once every kind has a model, hence this record.
