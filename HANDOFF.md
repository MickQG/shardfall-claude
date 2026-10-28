# Handoff: Shardfall (working title), a spec-driven web RTS

Written 2026-10-28 after a design-grilling session. The next session starts **building**. No code or specs exist yet; this folder (`RTS-claude`) was empty and is not yet a git repo. The user said Claude may run end to end and should be prompted only for critical issues.

## Goal
A small but polished, visually impressive, original RTS "in the spirit of" C&C3: Kane's Wrath. It is vibe-coded with Claude but run as spec-driven development, managed in GitHub. The audience clicks a link, plays for 30 seconds, then reads the repo to see how it was built.

## Settled decisions (the full design tree was walked; nothing is left open)
- **IP:** original only. No EA names, art, audio or stats. Avoid "Tiberium" and "Command & Conquer". Working title **Shardfall**, GitHub repo `MickQG/shardfall-claude` (private, created; local folder is `RTS-claude`). The resource is a crystal called *shards*.
- **Factions:** exactly two, **Humans** (tough, structured, ground and air) and **Aliens** (fast, organic, regenerating).
- **Platform:** browser first, hosted on the Azure Static Web Apps free tier and deployed by GitHub Actions. Ship as an installable PWA. A Tauri wrapper for Windows is an optional later milestone. Game code must not depend on any wrapper.
- **Stack:** TypeScript, Vite, PixiJS v8, Vitest, Playwright.
- **Look:** 2D isometric. Procedural, shader-driven art: lighting and glow, bloom, shadows, particles, animated crystals, screen shake, heightmap-lit terrain. CC0 assets (e.g. Kenney) are allowed as a fallback, with attribution. Audio is Web Audio synthesis or CC0.
- **Simulation:** deterministic fixed-tick (about 20 Hz), seeded RNG, integer or fixed-point maths, in a Web Worker. The renderer interpolates and the UI sends commands only. No `Math.random` or wall-clock time inside the sim. This allows replays and later multiplayer.
- **Scope v1:** single-player 1v1 skirmish vs AI. About 6 units and 6 buildings per faction, one resource, a power grid, a 3-tier tech tree, one superweapon per faction, fog of war, one map of about 96x96. Explicitly out of scope: campaign, multiplayer, save/load, touch support.
- **AI ("challengingly competent, no dumb things"):** same rules as the player, with no vision cheating. It has a scripted opening, economy management, scouting, counter-composition, attack waves with retreat and regroup, base defence and expansion. Difficulty varies only in APM, reaction time and a resource bonus. A headless AI-vs-AI harness measures win rates and checks "no dumb behaviour" rules (idle harvesters, units stuck on walls, undefended base).
- **Controls:** classic RTS. Left-click select and box-select, right-click command, edge and WASD scroll, control groups 1-9, a sidebar build menu, a minimap.
- **Performance budget:** 60 fps with 200 units on a mid-range integrated-graphics laptop. A CI sim benchmark enforces the tick-time limit.
- **Process:**
  - Private GitHub repo under the user's personal account (`MickQG`), flipped to public after the first playable slice is deployed. MIT licence.
  - `CONSTITUTION.md` holds the non-negotiables above. `/specs` holds Markdown specs with stable IDs and requirement acceptance criteria. `/docs/adr` holds decision records.
  - Each spec becomes GitHub Issues, and each Issue becomes a PR that cites its requirement IDs.
  - Every requirement has at least one automated test citing its ID, and CI fails if one has none.
  - CI runs lint, type-check, unit tests, the AI harness, the perf benchmark and Playwright smoke tests. Each PR gets an Azure SWA preview, and main deploys to production.
  - Claude works on feature branches (one per Issue), opens PRs, and never pushes to `main` directly.
  - `CLAUDE.md` points at the constitution, the spec index and the traceability rule.

## Build order (each step playable and deployed before the next)
1. Scaffold, CI and deploy a blank isometric map, with the constitution, spec skeleton, ADRs and `CLAUDE.md`.
2. Deterministic sim core: tile map, one unit, move orders, pathfinding, camera pan and zoom.
3. Selection, box-select, commands, fog of war.
4. Economy: harvester, refinery, power, construction.
5. Combat and the full unit roster.
6. The AI, then balancing via the harness.
7. Visual polish and audio, then superweapons.

## Environment facts
- Windows 11, PowerShell and Git Bash. Node v22.19.0, npm 10.9.3, git 2.47.1.
- `gh` is authenticated as `MickQG` (HTTPS, scopes: gist, read:org, repo). Verified.
- Working directory `C:\Users\MikeGu\Desktop\Claude_dev\RTS-claude`: not yet a git repo, contains only this file.

## Azure (blocker resolved)
- The user ran `az login` in the session. The default subscription is a Visual Studio Enterprise one and is enabled. Run `az account show` to confirm before use.
- The next agent can create the Static Web App itself (`az staticwebapp create`, Free SKU), fetch the deployment token with `az staticwebapp secrets list`, and store it as a GitHub repo secret with `gh secret set`. Nothing is needed from the user unless a command fails.
- Never print or commit the token. The app itself must stay host-agnostic. Cloudflare Pages or GitHub Pages are fallbacks.

## Suggested skills for the next agent
- `mattpocock-skills:domain-modeling`: write `GLOSSARY.md` and the ADRs.
- `mattpocock-skills:codebase-design`: draw the seams between sim, renderer, UI and AI.
- `mattpocock-skills:tdd`: build the sim and AI test-first, since every requirement needs a test.
- `mattpocock-skills:wizard`: only if a human-only step (e.g. the Azure token) needs a guided walkthrough.
- `mattpocock-skills:pr` and `mattpocock-skills:code-review`: for each PR.
- `claude-api` is not needed (no LLM at runtime).

## First actions
1. Done already: `git init -b main`, private repo `MickQG/shardfall-claude` created with `origin` set, label `ready-for-agent` created, and the umbrella spec issue published (see the repo's Issues). Nothing is pushed yet. Make the initial commit on `main` (the one allowed direct push, for the bootstrap), then use feature branches.
2. Add `CONSTITUTION.md`, `CLAUDE.md`, `specs/` and `docs/adr/` skeletons, then draft spec 001 for the step-1 scaffold.
3. Scaffold Vite, TypeScript, PixiJS and Vitest. Add the CI workflow with the requirement-traceability check, then the SWA deploy workflow.
4. Open the first PR from a feature branch.
