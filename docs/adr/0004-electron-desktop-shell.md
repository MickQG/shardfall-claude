# ADR 0004: Electron for the desktop app

**Status:** accepted. Supersedes the "Tauri wrapper" note in ADR 0002.

**Decision.** The desktop app is a small Electron shell (`desktop/`) around the same static `dist/` the website serves, packaged for Windows with electron-builder as a portable executable and an installer. The shell serves the build from a private `app://shardfall` origin so workers, fetch and module scripts behave as on the web.

**Why not Tauri.** ADR 0002 named Tauri as the likely wrapper. Tauri needs a Rust toolchain and the MSVC build tools, which this project's machines do not have and which are heavy to require of every contributor. Electron needs only npm, bundles its own Chromium (so WebGL and workers behave identically to the tested browser build), and packages without extra system software.

**Trade-offs accepted.** The download is about 90 MB instead of about 10 MB. Auto-update and code signing are not set up.

**Consequences.** The game code never imports Electron (Constitution rule 7, requirement DSK-2). Desktop builds are produced and smoke-tested on a Windows runner in CI (`desktop.yml`), because they cannot be assumed to run on every developer machine; some locked-down machines refuse to run an unsigned `electron.exe`.
