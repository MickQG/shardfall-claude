# 023 AI personalities (milestone 23)

An AI opponent plays one of three personalities, so games against it stop converging. A personality is chosen per match, independently of Difficulty, and changes only what the AI chooses to do: AI-2 (no vision cheat) and AI-10 (what Difficulty may change) still hold. Issue #98.

- **AI-12**: Every AI opponent plays one personality for the whole match: Raider, Balanced or Doomsday. Every Difficulty works with every personality. The personality is part of the match settings, so the same seeds and settings give the same game (HAR-1).
- **AI-13**: Balanced plays as the AI did before personalities existed (AI-1..11).
- **AI-14**: Raider opens with early pressure on the economy: across the harness seeds its first attack sets out before minute 4 of game time, and most of its attacks in the first eight minutes target haulers, refineries or extractors rather than the enemy army or defences. Its attacks still gather as a group (AI-11).
- **AI-15**: Doomsday builds towards its superweapon first, keeping only the defence it needs to hold: across the harness seeds it completes its superweapon building earlier than Balanced and Raider do. Once the superweapon is charged it holds fire until its gathered wave is close to its target, then strikes the defences in the wave's path; the wave reaches the struck area within about ten seconds of the strike.
- **AI-16**: Raider and Doomsday commit to their plan, then adapt: Raider plays as Balanced once its opening attack is beaten or eight minutes have passed; Doomsday plays as Balanced if its superweapon building is destroyed, still rebuilding it first when it can.
- **MENU-5**: The Single player panel has a Personality control (Random, Raider, Balanced, Doomsday) beside the opponent Difficulty. Random is the default; the choice is remembered on the device. Random is drawn from the game seed, so it is deterministic.
- **SCR-4**: The result screen names the AI opponent's personality. While the game runs the player is never shown it, even when the menu choice was Random.
- **HAR-4**: An on-demand harness script (not part of `npm test` or CI) plays Medium-vs-Medium matches for each personality across seeds and maps and reports the median, shortest and longest match length; the target is a median of 12 to 20 minutes.
