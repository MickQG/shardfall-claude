# 014 Score screen (milestone 14)

End-of-game statistics: counted deterministically in the simulation, revealed only when the game ends, shown on the result screen.

- **SCR-1**: The simulation counts, per player, units built and units lost, buildings built and buildings lost, and credits earned from delivered shards, and samples each player's army value (unit cost scaled by health) every ten seconds; starting forces do not count as built, and the counts are part of the state hash.
- **SCR-2**: A player's snapshot carries every player's statistics only once the game is over (never while it runs); the god view always carries them.
- **SCR-3**: The result screen shows a score table with a column per side (units built, lost and destroyed, buildings built and lost, shards gathered), the game length, and an army-value-over-time chart with one line per side in that side's colour, all sides on the same axes.
