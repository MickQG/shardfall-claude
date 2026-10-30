# 012 UX fixes (milestone 12)

Bug and usability fixes found in a review of the player-facing controls and HUD. Player-facing only: no simulation rule, cost or AI behaviour changes; the sim keeps rejecting what it rejects today and the UI says so.

## Production

- **PRD-11**: Every unit ordered from the sidebar, including each of the five from a Ctrl-click, goes to the producer of that kind with the shortest queue, ties going to the one with the least build time left; while a producer of that kind is selected, orders go to that building instead.
- **PRD-12**: A single right-click on a unit or structure in the sidebar cancels the newest queued copy of that kind across all of the player's buildings (furthest back in its queue, then least progressed), so the item in progress keeps its progress until it is the last one.
- **PRD-13**: An item is shown as unavailable whenever it cannot be queued right now (not enough credits, full queue, missing prerequisite), including while other copies of it are already queued; a structure ready to place stays clickable.
