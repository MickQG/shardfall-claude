# 016 Graphics mockup: the "next" 2D style (milestone 16, issue #68)

A best-possible 2D look behind a switch, shown in a staged showcase, so the owner can judge it before any move to real-time 3D. Only the testable parts are requirements; how good it looks is the owner's call. Gameplay does not change.

- **NXT-1**: `?gfx=next` selects the next style for the whole session: it is read once at startup, never enters the simulation, and without it the game renders exactly as before.
- **NXT-2**: `?scenario=showcase` starts a staged battlefield with two-level plateaus, water (blocked low ground), a shard field, an Aegis base with HQ and Motor Pool, a Vrax base with Hive Heart and Brood Pit, and on each side infantry squads and tanks that march into each other with no AI; `army=N` adds up to 150 more units a side for stress tests; the scenario is deterministic for a seed.
- **NXT-3**: Next-style terrain is a pure function of the map: the same map always paints the same pixels, decoration and blending come only from tile coordinates, raised tiles get cliff walls (sunward walls brighter than shaded ones) and blocked low tiles are water.
- **NXT-4**: Next-style sprites are baked with a warm key light and a cool ambient: baking is repeatable byte for byte, sunlit faces come out warmer than shaded ones, and the classic style is unchanged.
- **NXT-5**: Shots, explosions, deaths and superweapon strikes cast short additive light pools that rise fast and fade out, never more than a fixed number at once.
- **NXT-6**: With the next style or the showcase, a frame-time readout shows frames per second, the average and the worst frame over a rolling window.
- **NXT-7**: The showcase with the next style runs on both quality presets without page errors under the software renderer used in CI.
