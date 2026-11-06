# 007 Visual polish, audio and game feel (milestone 7)

- **VIS-1**: Every unit kind has its own procedural drawing, distinct per kind, faction-styled and team-coloured; aircraft hover above their shadow, and ground units face the way they move.
- **VIS-2**: A graphics-quality setting (high/low) controls bloom, particles and decorative effects, and starts at high for everyone; the system reduced-motion preference stops screen shake without lowering the quality. Settings persist and fall back safely when storage is unavailable; settings saved before the high default (version 1) keep their sound choices but start on high quality again.
- **VIS-3**: Terrain has varied tint, faceted rock formations, ambient drifting particles and a vignette, without changing simulation data.
- **AUD-1**: Simulation events map to sounds (shots by weapon type, explosions, deaths, superweapon launch and strike); events outside the viewer's interest are not played, and muting silences everything.
- **AUD-2**: The ambient music is generated deterministically from a seed (same seed, same score) and stays in key.
- **AUD-3**: The audio engine is safe where no audio exists (tests, blocked autoplay): it never throws.
- **ALR-1**: Alerts are raised for: base under attack, construction ready to place, production complete, low power, superweapon ready, enemy superweapon detected (SW-1), and enemy superweapon launch (SW-2); each has a cooldown so it does not repeat every tick.
- **UX-1**: The game can be paused and its speed changed; a paused game does not advance.
- **UX-2**: The match ends with a victory or defeat screen with a play-again option and a button back to the main menu.
- **UX-3**: The game plays a little slower than one game second a second by default, so players have time to react: ×0.8 (16 ticks a real second). The speed steps are ×0.5, ×0.8, ×1, ×2 and ×4; the last speed chosen in a single player game is remembered on the device. Online matches play at ×0.8 for both players, who cannot change it. Speed only paces the ticks: per tick the game is the same at every speed, so balance, AI timings and the 12 to 20 minute match-length target (in game time) are unchanged. Motion stays smooth at every speed: units move between ticks over the real length of a tick. Issue #110.
