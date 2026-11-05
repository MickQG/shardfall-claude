# Specs

Requirements live here, one file per area. Format: a bullet `- **ID**: text` (ID = `AREA-N`). IDs are unique across all files: a new file continues an area's numbering, never restarts it. Tests cite the ID in their name, e.g. `it('SIM-1: …')`.

| File | Area | Milestone |
|---|---|---|
| `001-foundation.md` | Scaffold, CI, deploy, traceability, determinism | 1 |
| `002-sim-core.md` | Map, units, movement, pathfinding, camera | 2 |
| `003-control-fog.md` | Selection, commands, fog of war | 3 |
| `004-economy.md` | Harvest, power, production, tech tree | 4 |
| `005-combat.md` | Combat, rosters, factions | 5 |
| `006-ai.md` | AI opponent and harness | 6 |
| `007-polish.md` | Visuals, audio, superweapons | 7 |
| `008-controls-and-cursors.md` | Select-all-combat key, rally line, cursors, F attack-move | 8 |
| `009-visual-upgrade.md` | Construction, damage, facing, terrain, effects, polish | 9 |
| `010-voxel-art.md` | Procedural voxel sprite engine; unit and building models | 10 |
| `011-desktop.md` | Desktop app (Electron shell around the same build) | 11 |
| `012-ux-fixes.md` | Bug and UX fixes: production routing, selection, orders, camera, feedback, superweapon countdown | 12 |
| `013-unit-info.md` | Main-menu unit sheet with 3D models | 13 |
| `014-score.md` | Post-game score screen | 14 |
| `015-squads-veterancy.md` | Light infantry squads and veterancy | 15 |
| `016-gfx-next.md` | Showcase scenario and frame-time readout (from the 2D mockup) | 16 |
| `017-render3d.md` | Real-time 3D renderer slice (three.js) | 17 |
| `018-performance-security.md` | Frame-rate headroom; web, desktop and CI security | 18 |
| `019-main-menu.md` | Modern main menu: modes rail, map thumbnails, settings, multiplayer | 19 |
| `020-multiplayer.md` | Online one-versus-one matches: rooms, lockstep, desync detection, disconnects, security | 20 |
| `021-infantry-balance.md` | Crushing (heroes crush vehicles), infantry damage, slower heroes, straight shells, elite shots, AI crushing | 21 |
| `022-aim-and-models.md` | Shots leave along the barrel; no clipping between moving parts or into the ground | 22 |

Umbrella spec: GitHub issue #1.
