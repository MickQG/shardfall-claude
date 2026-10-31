# 004 Economy, production and tech (milestone 4)

Shards are the single resource. Haulers gather shards and deliver them to refineries; credits pay for structures and units, which are produced from queues, limited by power and a three-tier tech tree.

- **ECO-1**: Players start with the credits and buildings given in the game config; a player snapshot exposes the viewer's credits and power balance.
- **ECO-2**: A hauler gathers shards from a field into its load, drives to the nearest own refinery, unloads, and the delivered amount is added to credits while the field shrinks by the same amount.
- **ECO-3**: A hauler repeats this loop on its own; with no refinery it waits instead of wandering and resumes once one exists; a stop order halts the loop until a harvest order.
- **ECO-4**: Shard tiles deplete when emptied and seed tiles regrow slowly.
- **ECO-5**: Power output and drain are summed from completed buildings; while drain exceeds output, production progresses at half speed.
- **PRD-1**: Queueing an item needs its prerequisites and enough credits, deducts the cost, and cancelling refunds it in full.
- **PRD-2**: An item completes after its build time in ticks at full power, and after twice as long at low power.
- **PRD-3**: Structure placement must be within build range of an own building, on explored, unblocked, unoccupied tiles; an invalid placement is rejected and the ready item is kept.
- **PRD-4**: A placed structure blocks pathing, and units standing on its footprint are moved off it.
- **PRD-5**: A produced unit appears beside its producing building and walks to the rally point; only buildings that can train the unit kind may be the source.
- **PRD-6**: Items whose prerequisite buildings are not owned (the tech tree) cannot be queued.
- **PRD-7**: Selling a building refunds half its cost and frees its tiles; repairing restores hit points at a credit cost.
- **PRD-8**: Queues are first-in-first-out with a fixed maximum length of 20 items per building.
- **PRD-9**: Ctrl-clicking an item in the build or train list queues five of it at once; each is queued only while there is room in the queue and enough credits.
- **PRD-10**: Right-click cancels a queued item even when the list is full or the item cannot be afforded; Ctrl + right-click cancels up to five of that kind at once, newest first.
- **FOG-5**: Enemy buildings appear in a player snapshot only on visible tiles, and the last-seen ones are remembered as ghosts until their tile is seen again.
- **DET-1**: An economy scenario with the same seed and commands yields the same state hash; changing a command changes it.
- **UI-1**: The shared placement check agrees with the simulation, so the UI ghost is green exactly when a placement would be accepted.
- **MAP-2**: The skirmish map is point-symmetric; both start positions are connected, and every shard field is reachable from both starts.
- **MAP-3**: The skirmish map has water (blocked ground at level 0), mirrored like the rest of the map: a pond on each base's outer flank, clear of the base and its exits, and lakes beside the mid-map routes that narrow them without closing them. Water never covers a start, a starting building or a shard field.
- **ECO-6**: Training a harvester costs less than a refinery, so a refinery's free first harvester is never the cheapest way to add harvesters.
