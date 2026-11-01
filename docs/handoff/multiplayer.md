# Handoff: online multiplayer

Status, 2026-11-01: **not started; listed in the main menu as "In progress"** (MENU-2). This document is everything the
next person needs to build it: what was found, what the owner still has to decide, the proposed design, the Azure set-up,
and the tests that should prove it. Nothing here is built yet.

## Where things stand

- The main menu has a Multiplayer entry marked "In progress". Its panel describes what is coming and has no buttons
  (`src/ui/menu.ts`, spec `specs/019-main-menu.md`, MENU-2). Replace that panel when multiplayer ships.
- The website is an Azure Static Web App (`public/staticwebapp.config.json`, deployed by `.github/workflows/deploy.yml`).
  The desktop app (`desktop/`) serves the same build from an `app://` origin.
- A strict Content-Security-Policy is in force on both (SEC-1): `connect-src 'self'` today. Any relay address must be
  added to `CSP` in `desktop/paths.cjs`, and the website config is generated from it (they must stay equal; a unit test
  checks this).

## Why lockstep fits this game

The simulation was built for it (ADR 0001):

- **Deterministic.** `src/sim` uses integer fixed-point maths only (`FP = 256` per tile, an integer square root), a
  seeded RNG, and no `Math.random`, `Date`, `performance.now` or DOM (enforced by lint and CLAUDE.md). Floating point
  appears only in `src/ai`, which multiplayer does not run.
- **Driven only by commands.** Everything a player does is a `Command` (`src/sim/types.ts`) submitted to the sim
  through `src/sim/index.ts`. Two clients that apply the same commands on the same ticks stay identical.
- **Already checksummed.** `hash(game)` covers the whole state (units, buildings, fog, sight, shards, projectiles,
  strikes); compare it between clients to detect a desync.
- **Runs in a worker.** `src/host/worker.ts` advances ticks; `src/host/client.ts` posts commands to it. Lockstep slots
  in between: instead of submitting commands at once, hold them for the agreed future tick.

So players exchange **commands, not state**: a few dozen bytes per turn.

## Hosting: what Azure Static Web Apps can and cannot do

- Static Web Apps serves static files and optional **managed Azure Functions** (HTTP only). Functions cannot hold a
  WebSocket open, so they cannot relay a match.
- Options for the live connection:

| Option | How | Cost | Verdict |
|---|---|---|---|
| **Azure Web PubSub** (recommended) | Managed WebSocket service; each match is a group; a managed Function hands each player a short-lived client access URL | Free tier: 20 connections, 20,000 messages a day (a few test matches). Standard: about $49 a month per unit (1,000 connections) | Simple, no servers to run, scales |
| WebRTC peer-to-peer | Browsers connect directly; signalling (offer/answer) through a Function or Web PubSub free tier | Traffic is free; needs a STUN server (third-party, must be allowed by the CSP) and a paid TURN relay for the roughly 10-20% of networks where direct connections fail | Cheaper at scale, flaky without TURN |
| Own WebSocket server | Azure Container Apps or App Service running a small Node relay | Always-on compute, plus operating it | Only if Web PubSub limits bite |

Message budget for Web PubSub: with one batched message per player per turn at 10 turns a second, a 1v1 match sends
about 20 messages a second (72,000 an hour), so the free tier is for testing only.

## Decisions the owner still has to make

These were asked on 2026-11-01 (recommendation in brackets); none is answered yet.

1. Scope of the first version [1v1 only, private room codes, no public lobby or matchmaking, no AI players, pause and
   game speed disabled].
2. Transport [lockstep over Azure Web PubSub; WebRTC left out].
3. Cost [start on the Web PubSub free tier for testing, move to Standard, about $49 a month, at launch].
4. Azure set-up [the owner creates the resource and app setting; a scripted wizard walks through it].
5. When multiplayer is unavailable (no relay configured, or the desktop app) [show it disabled with the reason].
6. Shipping [one PR for multiplayer, merged only after the owner has played a real match between two browsers].

## Proposed design

### Rooms

- **Create:** the host picks map and faction; the client calls `POST /api/negotiate?room=new`. The Function makes a
  room code (6 characters, no look-alike letters), returns a Web PubSub client URL scoped to group `room-<code>` with
  `sendToGroup` and `joinLeaveGroup` permissions for that group only, valid for one hour.
- **Join:** the guest enters the code; `POST /api/negotiate?room=<code>` returns a URL for the same group. A room holds
  two players; a third is refused.
- **Start:** the host sends `start { seed, map, factions, startTick, protocol }`; both clients build the same
  `GameConfig` from it (`skirmishConfig(seed, { map, factions })`) and start at the same tick. Mismatched `protocol`
  (the game version) refuses the match.

### Lockstep turns

- A **turn** is 2 ticks (100 ms at 20 ticks a second). Commands a player issues during turn `T` are scheduled for turn
  `T + 2` (about 150-200 ms input delay, hidden by instant local feedback: order ring, voice line, selection).
- Each player sends exactly one message per turn: `turn { n, cmds[] }`, even when `cmds` is empty, so the other side
  knows it may advance.
- The worker advances turn `n` only when it holds both players' messages for `n`. If one is late, the game waits (show
  "Waiting for opponent..." after 500 ms) instead of guessing.
- Commands are applied in a fixed order (player 0 then player 1, each in send order) so both sides run identically.
- The sim already rejects illegal commands (wrong owner, unaffordable, locked), so a hacked client cannot cheat by
  sending them; it can only give orders to its own units.

### Desync detection

- Every 40 ticks (2 s) each client sends `hash { tick, value }`. If the values differ, both show "Out of sync: the match
  cannot continue", log both hashes, and end the match. Snapshots of both states at that tick are invaluable when
  debugging; keep the last few in memory and offer "Download debug report".

### Disconnects

- No message from the opponent for 10 s: show "Opponent disconnected" with a countdown; after 60 s the remaining player
  wins. Reconnecting within that time replays the missed turns from a short buffer kept by the opponent.

### What changes in the code

- `src/net/` (new): `transport.ts` (an interface: `send`, `onMessage`, `close`), `pubsub.ts` (the Web PubSub client),
  `lockstep.ts` (turn scheduling, buffering, hash checks; pure and deterministic, so it can be unit-tested with a fake
  transport), `room.ts` (create, join, start).
- `src/host/worker.ts`: a lockstep mode where ticks advance only on complete turns (no speed control, no pause).
- `src/game.ts`: when `?room=<code>` is present, play as the assigned player, no AI, pause and speed keys disabled.
- `src/ui/menu.ts`: replace the "In progress" panel with Create room / Join with code, plus the room lobby (both
  players, factions, map, Ready).
- `api/negotiate/` (new): one Azure Function (managed by Static Web Apps). Reads `WEBPUBSUB_CONNECTION_STRING` from app
  settings, validates the room code format, returns the client URL. No secrets in the repo.
- `desktop/paths.cjs`: add the Web PubSub `wss://<name>.webpubsub.azure.com` origin to `connect-src`.
- Specs: a new `specs/020-multiplayer.md` (NET-1 rooms, NET-2 lockstep turns, NET-3 desync detection, NET-4
  disconnects, NET-5 security), tests citing them.

### Security checklist

- The connection string lives only in Static Web Apps app settings (`az staticwebapp appsettings set`); never commit it.
- Client URLs are short-lived (1 h) and scoped to a single group with the least permissions.
- Validate every incoming message shape and size on the client (ignore malformed ones); cap commands per turn.
- Rate-limit `/api/negotiate` per IP (Static Web Apps has no built-in limiter; keep the Function cheap and reject bad
  codes early).
- Keep `connect-src` to the exact Web PubSub host, not a wildcard.

## Azure set-up (for the owner)

```sh
# Resource group and Web PubSub (free tier for testing)
az group create -n shardfall-rg -l westeurope
az webpubsub create -n shardfall-pubsub -g shardfall-rg --sku Free_F1 --unit-count 1
# Hand the connection string to the Static Web App as a setting (never into the repo)
CS=$(az webpubsub key show -n shardfall-pubsub -g shardfall-rg --query primaryConnectionString -o tsv)
az staticwebapp appsettings set -n <static-web-app-name> --setting-names WEBPUBSUB_CONNECTION_STRING="$CS" WEBPUBSUB_HUB=shardfall
# At launch: upgrade to Standard
az webpubsub update -n shardfall-pubsub -g shardfall-rg --sku Standard_S1
```

## Tests that should prove it

- **Unit (no network):** two `Lockstep` instances joined by an in-memory fake transport with random delays and
  reordering play 3,000 ticks of scripted commands; their state hashes are equal every 40 ticks. A dropped message
  stalls both, never desyncs them. A tampered command for the other player's units is rejected by the sim on both sides.
- **Desync:** inject a different command on one side only; both detect "Out of sync" within 2 s.
- **Function:** room code format, group scoping, refusal of a third player, refusal of malformed codes.
- **End to end:** two browser contexts in one Playwright test against a local relay (a tiny WebSocket server in the test
  harness that mimics Web PubSub's group messages), playing until one side's HQ falls; both show the same result.
- **Real match:** the owner plays one game between two machines before the PR merges.

## Risks

- **Hidden non-determinism.** Anything outside `src/sim` that feeds the sim differently on each side (for example map
  generation reading settings, or a command built from floating-point screen positions) desyncs the match. Commands must
  carry integer `FP` coordinates (they already do) and configs must come only from the `start` message.
- **Performance gaps.** The slower machine sets the pace; lockstep waits for it. Show "Waiting for opponent" rather
  than stuttering.
- **Cost.** Free tier is for testing only; budget Standard before launch.
