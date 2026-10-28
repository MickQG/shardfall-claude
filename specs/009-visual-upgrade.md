# 009 Visual upgrade

Render layer only: nothing here may read or change simulation state beyond the existing snapshot, and all art stays procedural.

- **GFX-1**: A building under construction is drawn as a build-up animation (growing scaffold) over the building's final art, driven by the snapshot; a finished building shows no scaffold.
- **GFX-2**: Buildings show damage states by hit-point fraction (intact, damaged with smoke, critical with fire); the state is a pure function of the hp fraction with documented thresholds.
- **GFX-3**: Ground units and turret-carrying units draw 8 facing directions from their movement or target heading, and turrets rotate independently of the hull toward their target.
- **GFX-4**: Terrain has more variation: per-tile deterministic tint noise, edge shading where rock meets open ground, small ground decals (pebbles, cracks), and shard fields shown with glints, all derived from the map seed and not from the sim RNG.
- **GFX-5**: Weapon effects are polished: muzzle flashes by weapon type, projectile trails, ground scorch under explosions, and a short debris burst when a building dies; all are skipped when the quality is low or reduced motion is on.
- **GFX-6**: Selection and health bars are upgraded: team-coloured selection brackets, health bars that appear on damage or selection, a production-progress bar on buildings, and a veterancy-free clean layout that does not hide small units.
- **GFX-7**: Unit and building art are polished: unit drawings gain shading and highlights, buildings gain roof detail, team-coloured accents and a faction-specific idle animation (blinking lights or pulsing biomass); each unit and building kind remains visually distinct.
- **GFX-8**: Visual upgrades keep performance: with 200 units and 40 buildings on screen, the frame cost on the quality-high preset stays inside the existing render budget check, and the low preset disables the new decorative work.
