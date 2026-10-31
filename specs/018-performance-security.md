# 018 Performance and security (milestone 18)

Frame-rate headroom with the least change to how the game looks or plays, and safe defaults for the website, the
desktop app and CI.

- **PERF-1**: The view does no per-frame work that cannot show: the minimap redraws its fog, buildings and shards at most five times a second (units, alert pings and the camera box every frame); units more than a couple of tiles outside the view are not posed (their walk and aim carry on, so nothing jumps when they come into view); a part's rotation is rewritten only when it changes; and the sun's shadows are redrawn every other frame.
- **PERF-2**: When frames run slow (under 50 fps) for about 1.5 s while the CPU side of a frame is light, so the graphics chip is the bottleneck, the 3D view renders fewer pixels, a step of 0.1 device pixels per CSS pixel at a time, down to 0.85 (or the screen's own ratio if lower); after about eight seconds of frames on time it steps back up, to at most 1.25. Hidden tabs and other long pauses are ignored.
- **SEC-1**: The website and the desktop app serve the game under the same strict Content-Security-Policy: scripts, workers and data only from the game's own origin, no inline scripts or `eval`, no plugins, and no framing by other sites. The website also sends `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a Permissions-Policy that turns off the camera, microphone, location, payment and USB, and `Cross-Origin-Opener-Policy: same-origin`. The build publishes no source maps.
- **SEC-2**: The offline cache stores only complete, successful responses for the game's own files (never errors or other sites), serves them only when the network fails, and drops caches from older versions.
- **SEC-3**: Values from the address bar are validated before use: a seed is used only when it is a whole number of up to nine digits (otherwise a fresh seed is drawn), and an unknown map, faction or difficulty falls back to the default.
- **SEC-4**: CI runs with a read-only token and fails when a dependency shipped to players has a known high or critical vulnerability.
