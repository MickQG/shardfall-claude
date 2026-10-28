# 011 Desktop app

The same static build that the website serves, in a desktop window. The game code does not know it is in a wrapper (Constitution rule 7).

- **DSK-1**: The desktop shell serves the built game from the `app://shardfall` origin, mapping `/` to `index.html` and rejecting any path that would leave the build folder (dot segments, encoded separators, NUL bytes, malformed encodings).
- **DSK-2**: The game does not depend on the desktop shell: nothing under `src/` imports Electron, and the web build does not run the desktop packager, so one `dist/` serves both web and desktop.
- **DSK-3**: Links to anything outside the game open in the user's browser, never inside the game window.
- **DSK-4**: The desktop app starts, loads the game, runs the simulation and reports no console errors.
- **DSK-5**: Packaging produces Windows artifacts, a single-file portable executable and an installer, containing only the built game and the shell.
