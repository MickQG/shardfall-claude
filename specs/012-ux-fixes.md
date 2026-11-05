# 012 UX fixes (milestone 12)

Bug and usability fixes found in a review of the player-facing controls and HUD. Player-facing only: no simulation rule, cost or AI behaviour changes; the sim keeps rejecting what it rejects today and the UI says so.

## Production

- **PRD-11**: Every unit ordered from the sidebar, including each of the five from a Ctrl-click, goes to the producer of that kind that would finish it soonest (the least build time queued), ties going to the shorter queue and then the earlier building, so all of a player's producers of a kind keep working, whatever the mix of unit kinds; which building is selected does not change where orders go.
- **PRD-12**: A single right-click on a unit or structure in the sidebar cancels the newest queued copy of that kind across all of the player's buildings (furthest back in its queue, then least progressed), so the item in progress keeps its progress until it is the last one.
- **PRD-13**: An item is shown as unavailable whenever it cannot be queued right now (not enough credits, full queue, missing prerequisite), including while other copies of it are already queued; a structure ready to place stays clickable.
- **PRD-14**: Production buildings of the same kind keep each other busy: whenever one has an empty queue while a sibling has orders waiting that have not started, it takes over the newest of them, so a player with several Garrisons (or Motor Pools, Spawn Nests, Brood Pits) gets units from all of them at once, however quickly or in whatever order the orders were clicked. Orders already in progress stay where they are, and the move is deterministic.

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
- **UI-9**: While the player owns a superweapon, the right-hand console shows a superweapon panel near the top, outside the scrolling lists, with one row per weapon: its name, a charge bar, its state (charging with a percentage, low power, ready, or picking a target) and a fire button. The button is lit and pulses once the weapon is ready; pressing it arms targeting (the next click on the map fires), and pressing it again or right-clicking cancels. Pressing it before then shows why it cannot fire.
- **SW-1**: Superweapon countdown. Every finished superweapon, the enemy's as well as the player's own, has a countdown at the top centre of the map view: its owner ("Your" or "Enemy"), its name and the time until it is charged as m:ss. Enemy timers show as soon as the weapon is finished, even if the player has never seen it (where it stands is still only revealed by sight). A weapon whose owner is low on power stops charging: its timer freezes and says "paused". A charged weapon says READY, an enemy one in pulsing red. Enemy weapons are listed before the player's own. The console's superweapon panel (UI-9) adds the same time to its charging line. A finished enemy superweapon raises the alert "Enemy superweapon detected" once.
- **SW-2**: Incoming strikes. Between a superweapon's launch and its impact, the countdown box lists the strike first ("Enemy ... strike · impact in Ns", in pulsing red for an enemy strike) and the player is alerted to an enemy launch whether or not its launch site is in view. The target is marked on the ground for every player who can see it, even when the launch site is out of their sight; the launch site's own flash and beam are shown only to those who can see it.
- **UI-10**: The game frame (world view, console, minimap and every overlay) is at most 16:9: on wider screens it is centred between dark side bars, so the right-hand console stays beside the action instead of at the far edge of the screen. Pointer input, selection boxes and the minimap work the same inside the frame.
- **UI-11**: The minimap is 280 by 140 pixels (the map's diamond, twice as wide as tall) and, on a 1280 by 720 screen, overlaps neither the selection panel nor the console.
- **UI-12**: No black screen and no lost start. From the moment the game page opens until the battlefield is built and drawn, a loading screen shows the game's name, a spinner and "Preparing the battlefield…". Meanwhile the game waits at its first tick: nothing moves, no AI plays and, online, no turns are announced, so the other player waits too. The game begins, and the loading screen fades, only once the battlefield is built and the controls work, and the view has drawn its first frames; a background tab draws no frames, so then the game begins at most 3 seconds after the battlefield is built, and nobody (online, neither player) waits for the player to come back to the tab.
