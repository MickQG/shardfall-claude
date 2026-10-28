# 009 Visual upgrade

Render layer only: nothing here may read or change simulation state beyond the existing snapshot, and all art stays procedural. Decorative work is skipped on the low-quality preset and under reduced motion.

- **GFX-1**: A newly placed building plays a build-up animation (a rising building inside a team-coloured scaffold, about 1.5 s) driven by render time; buildings already present when the view starts, and ghosts, do not animate. Progress is a pure function of elapsed time, clamped to 0..1.
- **GFX-2**: Buildings show damage states by hit-point fraction: intact above 66%, damaged (smoke) from 33% to 66%, critical (fire and smoke) below 33%; the state is a pure function of hp and maximum hp.
- **GFX-3**: Weapon barrels on armed ground units (riflemen, rocketeers, buggies, tanks, artillery and spitters) aim in one of 8 directions, taken from the unit's last movement heading and re-aimed at the target when it fires; the 8-way heading is a pure function of a screen-space direction.
- **GFX-4**: Terrain has more variation: low-frequency tint patches, darkened ground tiles beside rock, extra ground decals (cracks, pebble clusters) and twinkling shard crystals, all derived from tile coordinates alone, never from the simulation RNG.
- **GFX-5**: Weapon effects are polished: each weapon type has a distinct muzzle flash (length, width and colour), ground scorch persists under explosions, and a destroyed building throws a debris burst and leaves lingering smoke.
- **GFX-6**: Selection and health bars are upgraded: team-coloured corner brackets replace the plain selection ring, a unit's or building's health bar is shown only when it is damaged or selected, and a production-progress bar shows on an own building while it is training or building something.
- **GFX-7**: Unit and building art gain polish: unit shading and highlights, building roof rim-lighting, and faction idle animation (a blinking beacon on human buildings, a pulsing biomass glow on alien buildings); each unit and building kind stays distinct.
- **GFX-8**: With the low-quality preset or reduced motion, the decorative work added by this spec (scaffold, smoke and fire, twinkles, idle animation, scorch decals) is switched off, while barrel aiming, health bars and selection stay on; the game renders without errors on both presets.
