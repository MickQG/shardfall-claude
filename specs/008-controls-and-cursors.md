# 008 Controls and cursors

Player-facing input only. No simulation rules, costs or AI behaviour change.

- **CTL-6**: Pressing `Q` selects every living combat unit the player owns (harvesters excluded), on or off screen; with nothing to select the selection is left unchanged. Pressing `Q` twice quickly also centres the camera on the group.
- **CTL-7**: The graphics-quality toggle moves from `Q` to `F2`; `Q` no longer changes quality, and the on-screen hint text names the new key.
- **CTL-8**: Pressing `F` with combat units selected arms attack-move; the next right-click on the map orders the selected units to attack-move to that point, using the existing attack-move command, and disarms it. A left-click or `Escape` disarms it without an order, and the left-click also does its usual job in the same press (a click selects, a drag starts a box). With no combat unit selected `F` does nothing. Attack-move is available only this way: `Ctrl` never arms or changes an order, and the camera panning keys (`W` `A` `S` `D`) never arm any order.
- **CTL-9**: When a production building is selected, a line is drawn from the building to its rally point; the line is not drawn when the building has no explicit rally point or is not selected.
- **CUR-1**: The pointer shows a distinct cursor for each state: default, hover over own unit or building (select), hover over an enemy with combat units selected (attack), attack-move (red crosshair, shown only while attack-move is armed), harvest (a green crystal, over a shard field while a harvester is selected), move target, invalid target (blocked terrain) and superweapon targeting.
- **CUR-2**: While placing a building the cursor reflects placement validity (valid versus blocked), matching the existing placement ghost colouring.
- **CUR-3**: Cursors are generated in code (inline SVG data URIs, with a CSS cursor fallback), need no image files, and the cursor choice is a pure function of UI state so it is testable without a browser.
- **CUR-4**: What is under the pointer is worked out by one hit-test (own and enemy units and buildings, ground tile, blocked terrain) at one interpolation instant; the hover cursor, the right-click order and the left-click selection all read that same result, so the cursor shown always matches what a click does.
- **CTL-10**: While the game has focus, `Ctrl` + `S` does not open the browser's save dialog (the `S` key pans the camera, so holding `Ctrl` while panning must not trigger it); the game cancels that key press.
