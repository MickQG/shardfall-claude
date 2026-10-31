# 017 Real-time 3D renderer slice (milestone 17, ADR 0005)

The world drawn in real-time 3D with three.js behind a switch, alongside the classic view until the owner approves it. Gameplay, HUD, minimap and input rules are unchanged.

- **R3D-1**: `?renderer=3d` draws the world with the 3D renderer for the whole session: chosen once at startup, never part of the simulation; without it the classic view is used unchanged.
- **R3D-2**: The 3D terrain is built from the map grid alone: one ground surface per tile at its level's height, vertical cliff walls down to every lower neighbour (the sunward walls warmer), water surfaces on blocked low tiles, and ground colours that come only from tile coordinates.
- **R3D-3**: Every unit, building, crystal and prop has a 3D model made from its voxel model: faces merged where they share a material, team materials in the owner's colour, glowing materials drawn unlit, outward-facing faces only; infantry squads show one figure per standing member and turrets turn on their own pivot.
- **R3D-4**: The 3D camera follows the same camera state as the classic view (screen-centre point and zoom): it looks along the isometric heading at a fixed pitch from a distance set by the zoom, so pan, zoom, centring and the minimap behave the same.
- **R3D-5**: One projector per renderer maps tiles to screen pixels and screen pixels to ground tiles; selection, orders, hit-testing and test hooks use it, so clicking a unit in the 3D view selects it and right-clicking the ground orders a move there.
- **R3D-6**: The 3D view lights the scene with a warm sun that casts shadows (off on the low preset) and cool ambient light, and shows combat as glowing tracers, pooled point lights, fireballs and smoke.
- **R3D-7**: The showcase in the 3D view runs on both quality presets without page errors under the software renderer used in CI, and shows a frame-time readout.
