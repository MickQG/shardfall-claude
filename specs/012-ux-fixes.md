# 012 UX fixes (milestone 12)

Bug and usability fixes found in a review of the player-facing controls and HUD. Player-facing only: no simulation rule, cost or AI behaviour changes; the sim keeps rejecting what it rejects today and the UI says so.

## Production

- **PRD-11**: Every unit ordered from the sidebar, including each of the five from a Ctrl-click, goes to the producer of that kind with the shortest queue, ties going to the one with the least build time left; while a producer of that kind is selected, orders go to that building instead.
- **PRD-12**: A single right-click on a unit or structure in the sidebar cancels the newest queued copy of that kind across all of the player's buildings (furthest back in its queue, then least progressed), so the item in progress keeps its progress until it is the last one.
- **PRD-13**: An item is shown as unavailable whenever it cannot be queued right now (not enough credits, full queue, missing prerequisite), including while other copies of it are already queued; a structure ready to place stays clickable.

## Selection

- **CTL-11**: Pressing `E` with at least one unit selected selects every living own unit, on or off screen, whose unit kind is among the kinds in the selection; pressing it twice quickly also centres the camera on the group. With no unit selected (nothing, or only a building) `E` does nothing.
- **CTL-12**: Shift + double-click adds every own on-screen unit of that kind to the existing selection.

## Orders

- **CTL-13**: An attack-move order is given only to the combat units in the selection; non-combat units in it keep what they were doing.
- **CUR-5**: Right-clicking an enemy with only non-combat units selected shows the move cursor and orders a move to that point.
- **CTL-14**: While attack-move or superweapon targeting is armed, a minimap click issues that order at the clicked tile; superweapon targeting disarms when its building is destroyed or sold.
- **CTL-15**: `Space` centres the camera on the middle of the selection; pressing a control-group key twice quickly centres on that group; assigning a group with nothing selected leaves the group unchanged.
- **CTL-16**: While the game is paused, only camera controls, `Escape`, `P` and the pause menu respond; once the game is over, only the result screen responds.

## Camera

- **CAM-3**: Centring the camera on any point (minimap, `H`, `Space`, `Q`, `E`, control groups) keeps the view within the map bounds, and orders given through the minimap target only tiles on the map.

## HUD and feedback

- **UI-3**: A refused action (blocked placement, unaffordable or unavailable item, superweapon fire before charge or on low power) shows a short toast naming the reason and plays a refusal sound.
- **UI-4**: The first click on Sell turns the button into a confirmation for three seconds and a second click sells; the rally-point hint is shown only on buildings that train units.
- **UI-5**: Superweapon charge and the Fire button refresh as the charge changes; Fire is unavailable and labelled "Low power" while its owner is on low power.
