# 027 Fly-in (milestone 27)

Every match opens with the **Fly-in** (glossary): the camera sweeps from a view of the whole map down to the player's base, and game time starts only when it ends. Issue #144.

- **CAM-4**: Every match opens with the fly-in. The camera starts high above the middle of the map, with the whole map in view, and sweeps down to the player's starting base in 4 seconds with an ease-in-out. It ends at the normal play zoom and heading, centred on the base, exactly where the camera starts today. The opening shot is as bright as the play view: from the first frame, explored ground is lit as it is in play, and the picture never starts out near-black.
- **CAM-5**: Game time does not start until the fly-in ends. The game holds at its first tick, and no command can be given during the fly-in. The HUD is hidden during it and fades in as it ends.
- **CAM-6**: In single-player, any key or click skips straight to the end of the fly-in, and the game starts. Online, the fly-in cannot be skipped and lasts exactly as long on both machines, whatever their renderer, so both players' first tick follows it together.
- **CAM-7**: The fly-in follows the fog of war. Unexplored ground stays dark and the enemy base is never shown.
- **CAM-8**: When the system asks for reduced motion, the camera does not sweep. A still view of the player's base fades in over the same time, and online it holds exactly as long (CAM-6). In single-player it can be skipped like the sweep. The classic view behaves the same way.
