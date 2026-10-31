# 0005 Real-time 3D renderer (three.js)

Status: accepted (2026-10-31). Supersedes 0003 (procedural voxel sprites) for the world view.

## Context

The owner wants a premium look whose qualities are inspired by modern 3D RTS games: depth and light, terrain that reads as land, detailed readable models, rich effects and a cinematic finish, with original designs. A best-possible 2D mockup (issue #68, PR #69: warm/cool baked lighting, painted cliffs and water, light pools, colour grading) held 60 fps but did not pass the owner's eye-candy test. Its limits were structural: a fixed camera, lights that brighten areas instead of shading faces, and no real shadows or height. A Unity port (#41) was cancelled earlier over CI licensing.

## Decision

Render the world in real-time 3D with three.js (WebGL2), in the browser, behind `?renderer=3d` until it reaches parity, then as the default. The deterministic simulation, AI, HUD (DOM), minimap and input rules are unchanged; only the world view and the screen-to-world mapping change.

- **Models stay generated in code.** The first slice turned the voxel models into meshes so all 14 units and 16 buildings worked from day one; they have since been replaced by procedural models shaped from bevelled plates, cylinders, domes, lathed shells and limbs (R3D-3), split into named moving parts (turrets, barrels, wheels, legs, rotors) with muzzle points, so motion and shots can be animated (R3D-9, R3D-10). Model files can still replace them one by one later.
- **Terrain** is a mesh built from the simulation's tile grid and three height levels, with vertical cliff walls, blended ground colours from tile coordinates, and water on blocked low ground. Water and cliffs stay decorative.
- **Light**: one warm late-afternoon sun with a shadow map, cool hemisphere ambient, distance haze, and short-lived point lights from combat.
- **Camera**: a perspective camera at a fixed pitch and the same 45-degree heading as the isometric view (so the map, minimap and controls keep their orientation), with pan and zoom. Rotation and tilt control can come later.
- **Picking** goes through one projection seam (world to screen and screen to ground), used by selection, orders, cursors and the minimap, so input behaves the same in both renderers.

Amended 2026-10-31 (models, motion and effects pass):

- **Drawing**: every model part is an instanced batch per team, refilled each frame and culled per unit, so draw calls do not grow with the army (R3D-13). Models, shader programs and vertex buffers are all prepared while loading, so first sight of an army or the first explosion never stalls.
- **Post-processing**: bloom on a half-float buffer, then tone mapping and FXAA. A multisampled half-float buffer looked the same but its resolve halved the frame rate on Intel integrated graphics. Shadows use `PCFShadowMap`: three.js r186 removed `PCFSoftShadowMap` and silently switched over on the first frame, which recompiled every program mid-game.
- **Simulation events** name the shooter and the dead (`src`, `id`, `kind`), so effects start at the right barrel and deaths leave the right wreck (R3D-8). Events are outside the state hash; determinism is unchanged.

Amended 2026-10-31 (organic terrain and living squads):

- **Terrain contours** come from a position-only warp of the tile grid near contours, not from a smoothed height field (R3D-14). Moving points by their position alone keeps cliff walls, tile tops and water watertight without stitching, keeps tiles away from contours as single quads, and needs no change to the simulation's tile grid. Its strength is capped by a test on every map: no ground cell folds or shrinks below a fifth of its size.
- **Smoothing and squads** live in the renderer (R3D-10, R3D-15). Drawn positions trail the simulation by under a tenth of a second through a spring, which hides uneven snapshot timing without touching the shared interpolation the classic view uses. Squad members move around the squad's simulated position with seeded render-side randomness; the simulation still knows one unit per squad.

## Consequences

- A larger bundle (three.js, about 150 KB gzipped) and a different performance profile, measured with the frame-time readout against Constitution rule 8 (60 fps, about 200 units, integrated graphics).
- The VOX sprite specs keep describing the classic renderer until it is removed; new R3D requirements describe the 3D view.
- The software GPU used in CI (SwiftShader) must run the 3D view without errors; shadows and effects scale down on the low preset.
- Hard to reverse once the classic renderer is removed, which is why both run side by side until the owner approves the 3D view.
