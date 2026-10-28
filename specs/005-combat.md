# 005 Combat and rosters (milestone 5)

- **CMB-1**: Damage is the weapon's base damage times the damage-type percentage against the target's armor class, rounded down, never below 1.
- **CMB-2**: A weapon can hit air targets only if it is anti-air and ground targets only if it is anti-ground.
- **CMB-3**: A shooter fires only at targets within weapon range and never faster than the weapon cooldown.
- **CMB-4**: Idle units and defences automatically acquire visible enemies in range; a unit on a plain move order neither fires nor diverts.
- **CMB-5**: An attack order chases and kills its target; enemies on tiles the owner cannot see cannot be targeted.
- **CMB-6**: An attack-move engages enemies met on the way and then continues to its destination.
- **CMB-7**: Projectiles with flight time land later; splash damage hits enemy ground units near the impact point with falloff and spares friendly units.
- **CMB-8**: Units at zero hit points are removed and their attackers drop them; destroyed buildings free their tiles.
- **CMB-9**: Defence structures fire automatically and go offline while their owner is on low power.
- **CMB-10**: Units with regeneration heal when they have not taken damage for five seconds.
- **CMB-11**: Air units fly over blocked terrain and do not collide with ground units.
- **CMB-12**: A player with no buildings is defeated; the last player standing wins; the snapshot reports when the game is over and who won.
- **CMB-13**: A superweapon charges only while powered, fires at a chosen point after a delay, damages everything in its radius with falloff, and then recharges.
- **ROS-1**: Every building and unit of both factions is reachable through the tech tree from the headquarters, and all prerequisites and producers exist.
- **ROS-2**: Each faction can counter armour, infantry and air: it has an anti-armour weapon, an anti-air weapon, and artillery that outranges its own defences.
