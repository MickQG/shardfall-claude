# 003 Control and fog of war (milestone 3)

- **FOG-1**: At game start each player's map is hidden except the tiles within vision of their own units.
- **FOG-2**: Vision is a circle of per-kind radius; moving reveals new tiles, and tiles that leave vision stay explored but are no longer visible.
- **FOG-3**: A player's snapshot always lists their own units and lists enemy units only on currently visible tiles; the god-view snapshot lists all.
- **FOG-4**: Fog state is part of the state hash.
- **CMD-1**: A `stop` command clears the path and destination of owned units and ignores units the player does not own.
- **CTL-1**: Clicking selects the own unit under the pointer: each unit can be clicked anywhere over its drawn body at the current zoom (its size with a margin, a squad's whole spread, from its feet up to the top of its body, and never less than 18 pixels around it), and where reaches overlap the unit the click lands on most squarely wins. Right-clicking an enemy to attack uses the same reach; clicking empty ground clears the selection; enemy units are never selected.
- **CTL-2**: Box-select selects own units inside the rectangle; if the rectangle holds at least one combat unit, the non-combat units in it are left out. With shift, the units the box would select are added to the existing selection, and units already selected stay selected; shift-clicking a single unit toggles it.
- **CTL-3**: Double-click selects all own units of the same kind on screen.
- **CTL-4**: Control groups: assign with a key, recall with the same key; recalling drops units that no longer exist.
- **MAP-1**: Minimap projection maps tiles to minimap pixels and back without loss, and a minimap click resolves to the right tile.
- **CTL-5**: In the browser, a click selects a unit, and a right-click sends a move order for the selection only.
- **FOG-6**: When a unit dies, its owner keeps its sight where it fell (its vision radius, from that tile) for 4 seconds, then that sight fades; the lingering sight is part of the state, so it is deterministic and in the hash.
- **FOG-7**: Sight lingers for every unit and building: ground that drops out of all of a player's vision (its unit moved away or died) stays in sight, enemies on it included, for 4 seconds before the fog closes in; it stays explored. This applies to the AI as well.
