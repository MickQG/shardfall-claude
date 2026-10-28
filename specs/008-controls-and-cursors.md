# 008 Controls and cursors

Player-facing input only. No simulation rules, costs or AI behaviour change.

- **CTL-1**: Pressing `Q` selects every living combat unit the player owns (harvesters excluded), on or off screen; with nothing to select the selection is left unchanged. Pressing `Q` twice quickly also centres the camera on the group.
- **CTL-2**: The graphics-quality toggle moves from `Q` to `F2`; `Q` no longer changes quality, and the on-screen hint text names the new key.
- **CTL-3**: `Ctrl` + right-click on the map orders the selected units to attack-move to that point, using the existing attack-move command; without `Ctrl`, right-click behaves as before.
- **CTL-4**: When a production building is selected, a line is drawn from the building to its rally point; the line is not drawn when the building has no explicit rally point or is not selected.
- **CUR-1**: The pointer shows a distinct cursor for each state: default, hover over own unit or building (select), hover over an enemy with combat units selected (attack), attack-move (red crosshair, shown in `A` mode and while `Ctrl` is held with combat units selected), move target, invalid target (blocked terrain) and superweapon targeting.
- **CUR-2**: While placing a building the cursor reflects placement validity (valid versus blocked), matching the existing placement ghost colouring.
- **CUR-3**: Cursors are generated in code (inline SVG data URIs, with a CSS cursor fallback), need no image files, and the cursor choice is a pure function of UI state so it is testable without a browser.
