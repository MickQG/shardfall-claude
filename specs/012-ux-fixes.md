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
- **CTL-14**: While attack-move or superweapon targeting is armed, a minimap click issues or cancels it at the clicked tile with the same buttons as the main view (superweapon: left fires, right cancels; attack-move: right orders, left disarms and moves the camera); superweapon targeting disarms when its building is destroyed or sold.
- **CTL-15**: `Space` centres the camera on the middle of the selection; pressing a control-group key twice quickly centres on that group; assigning a group with nothing selected leaves the group unchanged.
- **CTL-16**: While the game is paused, only camera controls (panning, zoom, the minimap camera, `Space` and `H`), `Escape`, `P` and the pause menu respond; a drag or click finished while paused changes nothing; once the game is over, only the result screen responds.

## Camera

- **CAM-3**: Centring the camera on any point (minimap, `H`, `Space`, `Q`, `E`, control groups) keeps the view within the map bounds, and orders given through the minimap target only tiles on the map.

## HUD and feedback

- **UI-3**: A refused action (blocked placement, unaffordable or unavailable item, superweapon fire before charge or on low power) shows a short toast naming the reason and plays a refusal sound.
- **UI-4**: The first click on Sell turns the button into a confirmation for three seconds and a second click sells; the rally-point hint is shown only on buildings that train units.
- **UI-5**: Superweapon charge and the Fire button refresh as the charge changes; Fire is unavailable and labelled "Low power" while its owner is on low power.
- **UI-2**: The main-menu help text names the current bindings, including `F` then right-click for attack-move and `E` for select-same-kind.
- **UI-6**: Placement mode ends as soon as the structure it is placing is no longer ready to place (cancelled, lost, or the next queued item is not ready), and no ghost is shown for an item that is not ready.
- **UI-7**: A unit's health bar measures hit points against that kind's maximum, including enemy units first seen already damaged.
- **UI-8**: A drawn game shows a draw message, not a defeat message.
- **ALR-2**: The "ready: place it" alert fires each time a structure becomes ready to place, not only the first time for that kind.
