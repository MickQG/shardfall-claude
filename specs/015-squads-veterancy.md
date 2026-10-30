# 015 Infantry squads and veterancy (milestone 15)

Light squads give infantry a visible, graceful decline; veterancy rewards keeping units alive. Both are deterministic simulation rules with matching visuals.

- **SQD-1**: Rifleman, Rocketeer, Skitterer and Spitter are squads of three figures sharing one health pool: a squad has one figure per started third of its maximum health (at least one while alive), and its damage per shot scales with the figures left out of three; other units always deal full damage.
- **SQD-2**: A squad is drawn as its standing figures around the lead figure, and a figure disappears as soon as the squad drops below its third of health.
- **VET-1**: A unit earns experience equal to the damage it deals to enemies, including by projectiles and splash, and reaches rank 1, 2 and 3 at 1, 3 and 6 times its cost; on ranking up its health rises by the same share as its maximum.
- **VET-2**: Each rank adds 10% to the unit's damage and maximum health; a rank-3 unit repairs 1% of its maximum health per second once it has not been hurt for five seconds (regenerating kinds use the faster of the two).
- **VET-3**: Snapshots carry each unit's rank; ranked units show one chevron per rank above them, their health bar measures against the ranked maximum, and experience and rank are part of the state hash.
