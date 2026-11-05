# 002 Simulation core (milestone 2)

Map, units, movement, pathfinding, camera and the worker host. Positions are fixed-point integers: 1 tile = 256 units.

- **SIM-1**: A game can be created with initial units; the snapshot lists each unit with id, owner, kind and position, in id order.
- **SIM-2**: A `move` command makes an owned unit travel to the target at its kind's speed and stop there; commands for units the player does not own are ignored.
- **SIM-3**: Pathfinding routes around blocked tiles and returns the shortest 8-direction path; an unreachable target sends the unit to the reachable tile nearest to it.
- **SIM-4**: Paths never cut diagonally across the corner of a blocked tile.
- **SIM-5**: Units never end a tick on a blocked tile.
- **SIM-6**: Same seed, map and commands give the same state hash; different commands give a different hash.
- **SIM-7**: Overlapping units are pushed apart so that a crowd settles without stacking.
- **SIM-8**: A group move gives each unit a distinct destination tile around the target.
- **SIM-9**: Allies make way. When a moving unit touches an ally of the same player that stands still ahead of it (idle or gathering, with no move pending; a unit shooting at a target holds its ground), the ally steps aside at right angles to the mover's heading, to the side it already stands on, at its own walking pace, and stays there; the mover keeps going without being pushed back or slowed. A unit behind or beside the mover, an enemy, an ally in a fight, or an ally that is itself moving is only pushed apart as before (SIM-7). Nobody steps onto blocked ground.
- **CAM-1**: The camera pans, zooms within limits, and stays within the map bounds; screen-to-world conversion round-trips at any pan and zoom.
- **CAM-2**: Rendering interpolates positions between two snapshots by an alpha in [0, 1].
- **HST-1**: The worker host runs the simulation at a fixed tick rate independent of frame rate, and commands sent from the UI reach the simulation.
