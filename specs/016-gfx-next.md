# 016 Showcase scenario and frame-time readout (milestone 16, issue #68)

Kept from the 2D graphics mockup (which did not pass the owner's eye-candy test; see ADR 0005): a staged battlefield for judging the look, and a frame-time readout.

- **NXT-2**: `?scenario=showcase` starts a staged battlefield with two-level plateaus, water (blocked low ground), a shard field, an Aegis base with HQ and Motor Pool, a Vrax base with Hive Heart and Brood Pit, and on each side infantry squads and tanks that march into each other with no AI; `army=N` adds up to 150 more units a side on free, unblocked tiles for stress tests; the scenario is deterministic for a seed.
- **NXT-3**: Ground and cliff colours are a pure function of tile coordinates: the same tile always gets the same colour, sunward cliff walls are brighter than shaded ones, and water is blue.
- **NXT-6**: In the showcase or the 3D view, a frame-time readout shows frames per second, the average and the worst frame over a rolling window.
