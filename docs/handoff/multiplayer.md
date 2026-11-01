# Handoff: online multiplayer

Status, 2026-11-01: **built and on the PR preview site; not yet on production.** One-versus-one online matches with
private room codes, lockstep over Azure Web PubSub, desync detection and disconnect handling are implemented and tested
(spec `specs/020-multiplayer.md`, NET-1..5). The PR merges only after the owner has played a real match between two
browsers.

## Where things stand

- **Code:** `src/net/` (`protocol.ts` message validation, `lockstep.ts` turns, `transport.ts` Web PubSub socket and
  `/api/negotiate` calls, `lobby.ts` host/join handshake, `watch.ts` disconnects and desync), `src/host/` (lockstep
  mode in the worker: ticks wait for complete turns; checksums every 60 ticks), `src/ui/onlinePanel.ts` (the menu
  panel), `src/game.ts` (seat, no AI, no pause or speed online), `api/` (the room-ticket function).
- **Azure (created 2026-11-01):** Web PubSub `wps-shardfall` (Free_F1, West Europe) in `rg-shardfall`. The Static Web
  App `swa-shardfall` has app settings `WEBPUBSUB_CONNECTION_STRING` and `WEBPUBSUB_HUB=shardfall`; they are copied to
  PR preview environments. Nothing secret is in the repository.
- **CSP:** `connect-src 'self' wss://wps-shardfall.webpubsub.azure.com` (`desktop/paths.cjs`, mirrored in
  `public/staticwebapp.config.json`). The desktop app shows online play as unavailable (it has no `/api`).

## Decisions taken (the defaults recommended earlier)

1. Scope: one versus one, private room codes, no lobby or matchmaking, no AI players, no pause or speed change.
2. Transport: lockstep over Azure Web PubSub; no WebRTC.
3. Cost: Free tier while testing (see the quota below); move to Standard before a public launch.
4. Azure set-up: done with the Azure CLI (commands below).
5. Where online play is unavailable, the panel says why and the rail marks Multiplayer "Unavailable".
6. Shipping: one PR, merged after the owner has played a real match between two browsers.

## Free tier quota (important)

Web PubSub bills **outbound** messages in 2 KB units; the Free tier allows 20,000 a day and 20 connections. Each
player sends a turn every 150 ms, which the service delivers to the other player, so a match uses about 13 outbound
messages a second: roughly **25 minutes of play a day** on the Free tier. When the quota is used up, sending stops until
the next day (UTC). For regular play, upgrade (about $49 a month per unit, 1,000,000 messages a day):

```sh
az webpubsub update -n wps-shardfall -g rg-shardfall --sku Standard_S1 --unit-count 1
```

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

## Design (as built)

### Rooms (NET-1)

- **Host:** the host's faction and map come from the Single player panel. The client calls `POST /api/negotiate` with
  `{}`; the function makes a room code (6 characters, no look-alikes) and returns a ticket: a Web PubSub client URL for
  hub `shardfall` whose one-hour token puts the user in group `room-<code>` and lets it publish only there.
- **Join:** the guest types the code; `POST /api/negotiate` with `{ "room": "<code>" }` returns a ticket to the same
  group. The guest sends `hello { v }` every second; the host answers the first one of the same version with
  `welcome { to, setup: { seed, map, factions } }` and both start. A different version gets `refuse { why: "version" }`;
  after the start anyone else who says hello gets `refuse { why: "full" }`. With no host, the guest gives up after 20 s.
- **Start:** both build `skirmishConfig(seed, { map, factions, bonuses: [0, 0] })`. The match starts in the same page
  (the menu goes, `game.ts` loads with `?faction&map&online=<code>`), so the connection stays open; reloading an online
  page goes back to the menu.

### Lockstep turns (NET-2)

- A **turn** is 3 ticks (150 ms). Each side announces turn `k` (`turn { n, c[] }`, sent even when empty) once its own
  simulation reaches turn `k - 2`; local orders go into the next announced turn, so they take effect 300-450 ms later.
- The worker runs a turn's first tick only once it holds that turn's commands from both players, player 0's first, each
  in the order issued. Own commands take the same JSON round trip and checks as the opponent's.
- No pause or speed change online; Escape opens a menu while the match goes on.

### Desync detection (NET-3)

- After every 60 ticks (3 s) each side sends `hash { tick, h }` (the simulation's full-state checksum). If the two
  differ, both end the match with "Out of sync" naming the tick. Not built: a downloadable debug report with both states.

### Disconnects (NET-4)

- Held up for over a second: "Waiting for your opponent"; after 5 s of silence a countdown. 30 s without a message (60 s
  before the opponent's game has sent anything, as it may still be loading) ends the match as a win for the player who
  stayed. Leaving the page sends `bye`, which ends the match at once. Losing one's own connection shows "Connection lost".
- Not built: reconnecting to a running match.

### Security (NET-5)

- The connection string lives only in the Static Web App's app settings; the function signs tokens itself (HS256, no
  SDK) with only `webpubsub.sendToGroup.room-<code>` and `webpubsub.group: room-<code>`.
- Every incoming message is validated (`parseMessage`): known types only, field types and sizes checked, at most 32
  commands a turn, 200 ids a list, 24,000 characters a message. Commands are rebuilt field by field for the sender's
  seat (`sanitizeCommand`), so a tampered client can only order its own side; the simulation refuses the rest.
- Only the welcomed opponent's user id (set by the server in the token) counts.
- `connect-src` names the exact Web PubSub host; the service worker never caches `/api/`.
- Not built: per-IP rate limiting of `/api/negotiate` (Static Web Apps has none built in). The Free tier's 20-connection
  cap bounds the cost of abuse; add Azure Front Door or API Management rules before a public launch on Standard.

## Azure set-up (done; kept for reference)

```sh
# Resource group and Web PubSub (free tier for testing)
az extension add --name webpubsub
az webpubsub create -n wps-shardfall -g rg-shardfall -l westeurope --sku Free_F1 --unit-count 1
# Hand the connection string to the Static Web App as a setting (never into the repo)
CS=$(az webpubsub key show -n wps-shardfall -g rg-shardfall --query primaryConnectionString -o tsv)
az staticwebapp appsettings set -n swa-shardfall -g rg-shardfall --setting-names WEBPUBSUB_CONNECTION_STRING="$CS" WEBPUBSUB_HUB=shardfall
# At launch: upgrade to Standard
az webpubsub update -n wps-shardfall -g rg-shardfall --sku Standard_S1
```

## Tests

- **Unit, `tests/unit/net.test.ts`:**
  - two complete simulations in lockstep over a fake network with random delays and reordering, 1,200 ticks of
    scripted orders, with equal turns and equal checksums (NET-2);
  - a lost turn stalls both and never desyncs them;
  - an extra command on one side is caught by both at the next checksum (NET-3);
  - tampered and malformed messages are dropped or rebuilt (NET-5);
  - room handshake, version and full-room refusals, the join timeout (NET-1);
  - the waiting notice (NET-4).
- **Unit, `tests/unit/api.test.ts`:** room codes, token claims and signature, least privilege, the connection string
  only from settings, the pinned dependency.
- **End to end, `tests/e2e/online.spec.ts`:** two pages host and join through the real menu and game code, with a
  stand-in for Web PubSub that relays between the pages. They play in lockstep past several checksums, give orders on
  both sides, the match cannot be paused, and the host wins when the guest quits. `tests/e2e/menu.spec.ts` checks that
  the panel says online play is unavailable where there is no game server.
- **Real match (the owner):** play one game between two machines on the preview site before merging.

## Risks

- **Hidden non-determinism.** Anything outside `src/sim` that feeds the sim differently on each side desyncs the match.
  Commands carry integer `FP` coordinates, and configs come only from the host's `welcome`. Desync detection will show it.
- **Performance gaps.** The slower machine sets the pace; lockstep waits for it, with "Waiting for your opponent".
- **Cost.** The Free tier is for testing only (about 25 minutes of play a day); move to Standard before launch.
