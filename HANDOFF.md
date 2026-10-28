# Status and next steps

Last updated after milestone 7. Everything in the original plan is built, tested and deployed; this file replaces the pre-build handoff.

## State
- All seven milestones are merged to `main` (issues #2-#8, umbrella spec #1). Every requirement in `specs/` is cited by a test (`npm run trace`).
- Live site: https://black-sea-00f40ee03.6.azurestaticapps.net (Azure Static Web Apps, free tier, resource group `rg-shardfall`, app `swa-shardfall`). The deploy token is the repo secret `AZURE_STATIC_WEB_APPS_API_TOKEN`; CI deploys on push to `main` and creates PR previews.
- The repo `MickQG/shardfall-claude` is **private**. The plan was to flip it to public once the first playable slice was deployed: `gh repo edit MickQG/shardfall-claude --visibility public --accept-visibility-change-consequences`. Left for the owner to decide.

## Working agreements (see CLAUDE.md and CONSTITUTION.md)
- Behaviour comes from `specs/*.md`; every requirement ID appears in a test name.
- Nothing non-deterministic in `src/sim`, `src/ai`, `src/data`; everything talks to the sim through `src/sim/index.ts`.
- One branch and PR per issue; CI (lint, typecheck, unit tests, trace, bench, AI harness, e2e) must pass before merge. `.claude/settings.json` allows `gh pr merge` for this project.

## Known limits and good next steps
- Balance is tuned through the harness (human vs alien about even; Hard > Medium > Easy). Re-run `npm run harness` and the sampling approach used in M6 after any data change.
- Veterancy, replays (the sim is deterministic, so a command log plus seed is enough), more maps, and multiplayer are out of v1 scope; the architecture allows them.
- A Tauri wrapper for Windows is possible without code changes (the build is a plain static bundle).
- Touch controls are not supported.
