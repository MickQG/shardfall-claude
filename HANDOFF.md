# Status and next steps

Last updated after the UX batch (#58, specs 012-013), the score screen (spec 014) and squads and veterancy (spec 015). Everything in `specs/` is built, tested and deployed; this file replaces the pre-build handoff.

## State
- Milestones 1-11 plus the UX batch are merged to `main`. Every requirement in `specs/` is cited by a test (`npm run trace`), and `npm run trace` also fails if an ID is defined twice (FND-10): a new spec file continues an area's numbering.
- Live site: https://black-sea-00f40ee03.6.azurestaticapps.net (Azure Static Web Apps, free tier, resource group `rg-shardfall`, app `swa-shardfall`). The deploy token is the repo secret `AZURE_STATIC_WEB_APPS_API_TOKEN`; CI deploys on push to `main` and creates PR previews.
- The repo `MickQG/shardfall-claude` is **private**. The plan was to flip it to public once the first playable slice was deployed: `gh repo edit MickQG/shardfall-claude --visibility public --accept-visibility-change-consequences`. Left for the owner to decide.

## Controls (current)
- Left-click select, drag to box-select (a box with combat units skips haulers), Shift-box adds, Shift-click toggles, double-click selects the kind on screen (Shift adds).
- Right-click moves / attacks / harvests / sets rally. `F` then right-click attack-moves (left-click or Esc disarms). `E` selects every unit of the selected kinds map-wide, `Q` the whole army; double-tap either to centre.
- `Ctrl+1-9` assigns a group, `1-9` recalls, double-press centres. `Space` centres on the selection, `H` on the HQ, `X` stops, `P`/Esc pause (camera, Space and H still work while paused).
- Sidebar: unit orders go to the producer with the shortest queue (or the selected one); right-click cancels the newest copy; Ctrl queues/cancels five. Refused actions show a reason toast.

## Working agreements (see CLAUDE.md and CONSTITUTION.md)
- Behaviour comes from `specs/*.md`; every requirement ID appears in a test name.
- Nothing non-deterministic in `src/sim`, `src/ai`, `src/data`; everything talks to the sim through `src/sim/index.ts`.
- One branch and PR per issue; CI (lint, typecheck, unit tests, trace, bench, AI harness, e2e) must pass before merge. `.claude/settings.json` allows `gh pr merge` for this project.

## Balance
- Target: human vs alien about even; Hard > Medium > Easy (`npm run harness` gates the ordering).
- ROS-3 (`tests/unit/balance.test.ts`) keeps equal-cost like-for-like duels within 20% of even. The last pass (#56) buffed Rocketeer, Scout Buggy and Bulwark Tank and trimmed Stalker and Brute.
- Squads and veterancy (spec 015) changed the picture: AI vs AI is now 4-4 at Medium and Hard (4 seeds, both seats). Hammer Artillery (64) and Aegis Gunship (13) were trimmed after them. Known leans: Riflemen vs Skitterers alone leans Vrax, early mixed armies (rifles plus rockets) and late mixes with artillery and air lean Aegis, Brute-heavy mid armies lean Vrax. Vrax regeneration was not touched.
- Probe used for tuning: equal-cost duels at three budgets from both seats plus AI vs AI per difficulty (see `tests/unit/balance.test.ts` for the duel harness).
- After any data change, re-run `npm run harness` and the equal-cost duels (ROS-3), and check AI vs AI per difficulty from both seats.

## Known limits and good next steps
- Genre ideas are filed as issues #60-#66 (hotkeys, queued orders, stances, more structure queues, skirmish setup, more maps; veterancy is done). Each needs a spec first.
- Replays (the sim is deterministic, so a command log plus seed is enough) and multiplayer are out of scope so far; the architecture allows them.
- Touch controls are not supported.
