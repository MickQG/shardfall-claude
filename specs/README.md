# Specs

Requirements live here, one file per area. Format: a bullet `- **ID**: text` (ID = `AREA-N`). Tests cite the ID in their name, e.g. `it('SIM-1: …')`.

| File | Area | Milestone |
|---|---|---|
| `001-foundation.md` | Scaffold, CI, deploy, traceability, determinism | 1 |
| `002-sim-core.md` | Map, units, movement, pathfinding, camera | 2 |
| `003-control-fog.md` | Selection, commands, fog of war | 3 |
| `004-economy.md` | Harvest, power, production, tech tree | 4 |
| `005-combat.md` | Combat, rosters, factions | 5 |
| `006-ai.md` | AI opponent and harness | 6 |
| `007-polish.md` | Visuals, audio, superweapons | 7 |
| `008-controls-and-cursors.md` | Select-all-combat key, rally line, cursors, Ctrl-attack-move | 8 |
| `009-visual-upgrade.md` | Construction, damage, facing, terrain, effects, polish | 9 |
| `010-voxel-art.md` | Procedural voxel sprite engine; unit and building models | 10 |
| `011-desktop.md` | Desktop app (Electron shell around the same build) | 11 |

Umbrella spec: GitHub issue #1.
