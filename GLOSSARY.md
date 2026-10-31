# Glossary

- **Shard** – the single harvestable crystal resource; spent as credits.
- **Credits** – a player's banked shards.
- **Tick** – one fixed simulation step (20 per second).
- **Snapshot** – an immutable, per-player, fog-limited view of the game at a tick.
- **Command** – a player or AI instruction submitted to the simulation (move, build, attack…).
- **Seam** – the public simulation API through which everything else interacts with it.
- **State hash** – a deterministic hash of the full game state, used to prove determinism.
- **Faction** – Humans or Aliens.
- **Map** – the battlefield a skirmish is played on (Crossroads, Riverbed or Highlands), chosen before the game; every map is the same for both players, turned half a turn.
- **Tier** – depth in the tech tree (1–3).
- **Power grid** – total power produced versus consumed; a deficit slows production and disables power-hungry buildings.
- **Fog of war** – per-player visibility: hidden, explored (remembered), visible.
- **Superweapon** – a faction's long-charging area-effect weapon.
- **Control group** – a numbered (1–9) set of units the player can recall with one key.
- **Attack-move** – an order to travel to a point and engage any enemy met on the way.
- **Rally point** – where a production building sends newly built units.
- **Combat unit** – any unit that can attack; haulers are not combat units.
- **Unit kind** – what a unit is (Rifleman, Bulwark Tank, Brute…). "Type" is reserved for damage types and armour types.
