# 007 Visual polish, audio and game feel (milestone 7)

- **VIS-1**: Every unit kind has its own procedural drawing, distinct per kind, faction-styled and team-coloured; aircraft hover above their shadow, and ground units face the way they move.
- **VIS-2**: A graphics-quality setting (high/low) and the system reduced-motion preference control bloom, particles and screen shake; settings persist and fall back safely when storage is unavailable.
- **VIS-3**: Terrain has varied tint, faceted rock formations, ambient drifting particles and a vignette, without changing simulation data.
- **AUD-1**: Simulation events map to sounds (shots by weapon type, explosions, deaths, superweapon launch and strike); events outside the viewer's interest are not played, and muting silences everything.
- **AUD-2**: The ambient music is generated deterministically from a seed (same seed, same score) and stays in key.
- **AUD-3**: The audio engine is safe where no audio exists (tests, blocked autoplay): it never throws.
- **ALR-1**: Alerts are raised for: base under attack, construction ready to place, production complete, low power, superweapon ready, and enemy superweapon launch; each has a cooldown so it does not repeat every tick.
- **UX-1**: The game can be paused and its speed changed; a paused game does not advance.
- **UX-2**: The match ends with a victory or defeat screen with a play-again option and a button back to the main menu.
