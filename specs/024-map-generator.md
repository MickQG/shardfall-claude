# 024 Map generator (milestone 24)

A seeded generator gives an endless supply of fair maps beside the three hand-made ones. Issue #99.

- **MAP-7**: A generated map is produced from a map seed (a whole number). The same seed always gives the same map on every machine: the same tiles, starts and shard fields, and the same state hash at the first tick.
- **MAP-8**: Every generated map is fair and playable: it is the same for both players turned half a turn (as MAP-2); both starts are connected by ground; every shard field is reachable from both starts and each side has the same shard fields; and it has at least one chokepoint or water feature between the bases. It is built only from existing terrain (rock, ridges, water, bridges, fords) and is the same size as the hand-made maps.
- **MAP-9**: A seed whose map fails MAP-8 moves on to the next seed in a fixed sequence until one passes. The seed reported for the map is the one that produced it, so entering that seed gives the same map.
- **MENU-6**: The Single player panel has a fourth map card, Generated, with a thumbnail drawn from the generated map (as MENU-1), a reroll button and an editable map seed. The choice and seed are remembered on the device; `?map=generated&seed=N` selects it too. The generator has no other settings.
- **NET-6**: In an online match on a generated map, the host's seed is sent with the match settings and both players generate the same map from it.
- **SCR-5**: After a game on a generated map, the result screen shows the map seed and a "Play this map again" button that starts a new single player game with the same seed, faction, opponent Difficulty and Personality setting.
