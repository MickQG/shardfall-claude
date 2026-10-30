# 013 Unit info (milestone 13)

A main-menu panel that tells a new player, in plain words, what each unit of the chosen faction is for. Everything shown is derived from the unit definitions and the damage table, so it stays correct when balance changes. Buildings, defences, enemy inspection and opening the panel in game are out of scope.

- **INF-1**: The main menu has an info button that opens a panel for the faction currently picked on the menu, with one card per unit kind of that faction; changing the faction pick changes the cards, and the panel shows the faction picked when it is opened and closes with its close button, a click outside it or `Escape`.
- **INF-2**: Each card shows the unit's name, its cost in credits, a role line (Harvester, Infantry, Anti-armour, Scout, Tank, Artillery, Air, Raider) and words rather than numbers for: toughness (Fragile under 150 HP, Sturdy 150 to 399, Very tough 400 or more), speed (Slow below 30, Average below 50, Fast otherwise, in speed units), range (Melee under 2 tiles, Short under 5, Medium under 8, Long otherwise), whether it can hit air, and a "Regenerates" tag for units that heal.
- **INF-3**: "Strong against" lists the armour classes its weapon deals 100% or more against and can hit, each with the opposing faction's unit kinds of that class ("Buildings" for structures); a unit without a weapon says it cannot attack.
- **INF-4**: "Weak against" lists the opposing faction's unit kinds whose weapon can hit this unit and deals 100% or more against its armour class.
- **INF-5**: The card contents come from a pure function of the unit definitions and damage table, testable without a browser.
