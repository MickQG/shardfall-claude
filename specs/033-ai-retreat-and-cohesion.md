# 033 The AI retreats, regroups, holds a concave and crawls to fields (milestone 33)

Agreed with the owner in a design session on 2026-11-21. Players beat the AI by making it throw units away. Its waves die in place against a stronger army. Its units chase Glare Skimmers and kiting Bulwark Tanks one by one. Its army strings out instead of fighting as one body. And its economy stops at its home fields, which on the old Crossroads left the big centre field to the player.

This milestone teaches the AI four things: to judge when it is beaten and fall back to friendly strength, to stay together and refuse bait from harassers, to meet enemies in a concave, and to build toward new shard fields. Crossroads is redrawn around one massive centre field reached by three lanes.

Some rules stay as they are:
- Unit stats and the crush rule are unchanged.
- Difficulty still changes only reaction time, orders per decision and shard bonus (AI-10). Every rule below applies the same at every difficulty and to every personality, except where a rule says otherwise.
- The Watchpost is out of scope (backlog issue #204).

The numbers below are a first draft. CI tunes them on the Balance workflow (GitHub runners), and the measured figures are written back here.

Terms used below (see GLOSSARY.md): Staging point, Wave, Standing army, Strike group (the code's old "hit squad"), Harasser, Army ball, Concave, Retreat, Fighting retreat, Regroup.

## Judging strength

- **AI-35**: The AI's strength estimate is fairer.
  - A unit's power is its cost scaled by its health as a share of its **real** maximum health. That maximum includes veterancy, so a ranked unit counts for more than a fresh one: each rank adds 10% to both its health and its damage (VET-2), so at full health it counts for its cost times (1 + 0.1 × rank) squared.
  - The enemy force near a group counts only enemy units seen in the last 10 game seconds (200 ticks), plus defence buildings at 1.5× their cost. The longer memory still feeds the attack decision and intel.
- **AI-36**: An AI group is **overwhelmed** when the enemy power within 11 tiles of its centre is at least 1.5× its own power. Its own defence buildings within that radius count on its side.
  - The test applies to waves and strike groups (amending AI-8 and AI-23), to standing units answering an attack (amending AI-34), and to the army pulled home by base defence (amending AI-7). A wave on the move also counts the enemy it has seen within 14 tiles ahead of it (toward where it is going), so it turns as soon as it sees the army that would overwhelm it, before contact; a strike group, which slips past armies to the economy, does not.
  - An overwhelmed group retreats (AI-37) instead of fighting on. Base defence that is not overwhelmed still attacks as before.
  - Doomsday keeps its exemption while a charged superweapon strike is under way.

## Retreat and regroup

- **AI-37**: A retreat goes to the **nearest friendly strength**, chosen in this order:
  1. the staging point, when reinforcements or Menders are gathering there;
  2. the nearest own defence buildings;
  3. the base.

  How the army moves depends on whether it can outrun the enemy. It can outrun them when its slowest unit is faster than the fastest armed enemy unit within 12 tiles of it.
  - **It can outrun them**: every unit runs to the fallback point at full speed with a plain move.
  - **It can't**: the whole army makes a **fighting retreat** together. It falls back in hops of about 3 tiles. Between hops it turns into its concave (AI-42) and fires for about one second. It stops once it reaches friendly strength, or once no enemy has been within its reach + 2 tiles for 3 seconds.
  - **Its Menders** within 12 tiles of the group go back with it, to its fallback point (AI-29).
  - A defence's fallback spot lies 2 tiles behind it as seen from the base's centre (further against harassers that out-range it, AI-40).
  - **Revised** with the Crossroads redraw (MAP-10): the first version ran until the pursuers came within reach, judged only the pursuers carrying most of the enemy's power, hopped on twice as far with no enemy near, and put a defence's fallback spot behind it as seen from the enemy. Each of those, with the gather rule in AI-41, tilted equal-AI games toward the faster Vrax (ROS-4); measured on the Balance workflow, 24 games a run.
- **AI-38**: A retreated army **regroups** at its fallback point, and the 1200-tick cooldown after a beaten wave is removed.
  - The retreated units and new reinforcements gather there as one army.
  - The next wave launches only when the normal attack test (AI-11 / AI-23) passes against an estimate no lower than the enemy strength that beat the last wave. That memory fades as the AI's intel ages.

## Harassment

- **AI-39**: An enemy group within 12 tiles of an AI army is a **harasser** when it is weaker than that army, and either of these holds:
  - it out-ranges the units that make up most of that army's power (its longest gun reaches at least 1.5 tiles farther than theirs: one tile is no harassment), and it keeps its distance on purpose: one of it kited in the last 3 seconds, or the units carrying most of its power fire on the move (SKM-3);
  - it is faster than them and kited in the last 3 seconds.

  **Kiting**: an enemy unit kites when it is firing and its own move since the last decision took it farther from the AI's units where they stand now (the AI backing off is no kiting).

  Anything else is a real fight, judged by AI-36. **Revised** (ROS-4): the first version answered any group that out-ranged the army as a harasser, whatever its strength and whether or not it kited. The Aegis army out-ranges the Vrax one (rifles and tanks against claws and bites), so the Vrax AI treated every smaller Aegis force as harassment and fought it under its own defences, which the Aegis AI could never do in return.
- **AI-40**: Under harassment the AI never sends single units chasing.
  - **Chasing**: it chases only when its units that can **catch or reach** the harassers (as fast as the harassers' fastest really gets away, or with at least their longest range; a harasser that fires on the move counts its full speed, one that must stop to fire, CMB-4, counts 0.6 of it) have at least 1.5× the harassers' power. Only those units chase.
  - **Otherwise, with defence buildings of its own**: a standing or gathering army (and the army pulled home by base defence) falls back at once behind its nearest defence, far enough that a harasser shooting at it from its full reach stands inside the defence's reach, and holds there in its concave; its army gathers there until no enemy has come within 20 tiles of it for 10 seconds. A harasser that wants to keep shooting must come into the defence's reach.
  - **Otherwise, if it is a standing army or a gathering army**: it tightens into its army ball or concave and advances **as one body** toward the harassers. It goes no further than 8 tiles from where it stood (`HARASS_LEASH`).
  - **Otherwise, if it is a wave**: it keeps advancing toward its target as one body.
  - **Falling back**: if the harassers are not pushed off within 10 seconds and the army is still losing value, it falls back out of their range onto friendly strength (AI-37).
  - **Leash**: no unit of the standing army chases farther than `HARASS_LEASH` + 2 tiles from where the army belongs (its cover, its regroup point or its staging point); one that has is called back, unless the base defence is fighting a real attack.
  - This replaces AI-30's Brute-only rule; its `noChase` rule is retired in favour of this one.

## Army ball and concave

- **AI-41**: While travelling or idle, an AI army holds an **army ball**.
  - **Waves**: the existing close-up (spread above 4 + √n) stays.
  - **Units gathering at the staging point and standing units**: any unit more than 4 + √n tiles from the group's centre is moved back toward it.
  - **Gathering**: units with no destination of their own go to the staging point. When its cover from harassers (AI-40) is over, the concave it held there is let go, and for 20 seconds the units it sent there, and any standing idle at an old destination, are called back to the staging point too.
  - **Revised** (ROS-4): the first version sent every unit not fighting and bound anywhere but the staging point back to it, constantly. On its own that moved equal-AI games from Aegis 8, Vrax 14 to Aegis 1, Vrax 23 (24 games; Balance workflow).
- **AI-42**: When a known enemy force (a real army or harassers) is within 12 tiles, the AI army forms a **concave** facing it.
  - **Shape**: an arc centred on the line from the army's centre to the enemy's centre, its ends bent toward the enemy. It is wide enough that every ranged unit has a clear line of fire.
  - **Front of the arc**: heavy units (tanks, Brutes, Skimmers, the hero).
  - **Behind them**: infantry squads, artillery and other ranged units.
  - **Slots**: each unit gets its slot deterministically. A blocked slot moves to the nearest open tile.
  - The concave applies to waves, the standing army and base defence alike, and it is also the shape held between hops of a fighting retreat.

## Economy and expansion

- **ECO-10**: The **ideal hauler count** for one refinery is the largest number of haulers for which adding one more still raises income by at least half a lone hauler's income.
  - It depends on how big the field is and how far it lies from the dock pad.
  - A deterministic bench measures it for both haulers, for fields of 13, 21, 44 and 80 tiles, at pad distances from 2 to 12 tiles. The resulting table lives in src/data/haulers.ts (`idealHaulers`) and is quoted here.
  - **Measured** (npm run bench:haulers; flat open ground, one refinery, income over 3 minutes after 30 seconds, depletion ignored). Rows are field sizes in tiles, columns the distance in tiles from the dock pad to the field's nearest shard tile. The pad itself moves at most 10 shards a tick, so about 11,000 shards a minute is the ceiling for one refinery.

    Shard Hauler (humans):

    | Field | 2 | 4 | 6 | 8 | 10 | 12 |
    |---|---|---|---|---|---|---|
    | 13 | 6 | 8 | 10 | 12 | 14 | 16 |
    | 21 | 5 | 7 | 9 | 10 | 12 | 14 |
    | 44 | 5 | 7 | 9 | 11 | 12 | 14 |
    | 80 | 6 | 9 | 11 | 12 | 14 | 16 |

    Gorger (aliens):

    | Field | 2 | 4 | 6 | 8 | 10 | 12 |
    |---|---|---|---|---|---|---|
    | 13 | 6 | 8 | 11 | 12 | 13 | 14 |
    | 21 | 5 | 6 | 8 | 9 | 11 | 13 |
    | 44 | 5 | 6 | 8 | 10 | 11 | 13 |
    | 80 | 7 | 8 | 9 | 11 | 12 | 14 |

  - Between measured points the lookup interpolates and rounds down; outside them it takes the nearest edge. At the ideal count a refinery earns about 11,000 shards a minute, which empties a 3000 a tile field in roughly 0.3 minutes a tile: a 13 tile field in about 4 minutes, 21 in 6, 44 in 12, 80 in 22 to 25.
- **AI-43**: The AI keeps the **ideal hauler count** (ECO-10) on each field it mines, for that field's size and pad distance. This replaces the old cap of three a refinery and at most eight (AI-18 amended). A field is not overfilled once its remaining shards would run out before a new hauler paid back its cost.
  - **Counting**: a field is mined when one of the AI's refineries stands within 9 tiles of its centre (AI-18). Its size is the tiles still holding shards; its distance runs from that refinery's dock pad to the nearest of them. The haulers it wants are the ideal count, but no more than its remaining shards divided by a hauler's cost (each hauler's share of what is left must pay for it). The AI's target is the sum over its mined fields.
  - **Opening ramp**: until its second factory stands, it keeps at most three haulers a refinery, so the opening (AI-3, AI-22) is unchanged.
  - **Trickle**: at most two haulers are in production at once, so new haulers come in beside the army rather than stalling the factories.
  - **Assignment**: a new or idle hauler goes to the field furthest below its count, and one moves over when one field is two or more further over its count than another (AI-18 amended).
- **AI-44**: The AI **crawls** toward a new shard field when every field it mines has its ideal hauler count, or any of them has less than a quarter of its shards left.
  - **Target**: the nearest field it does not yet mine where no more than 150 cost of recent enemy armed units or defences stand within 8 tiles. If no field is safe, it targets the contested centre field, or the only field left.
  - **Building toward it**: it places the buildings it needs anyway (power, production) in a chain toward the target, then a refinery once the field is within build range. The base-size cap does not apply to these buildings.
  - The approach is the one the steamroll test opponent uses (HAR-5).
  - **When**: only once its opening is over (a factory and two refineries stand). A crawl under way keeps its target while the target is still unmined and safe. Fields with an enemy refinery seen beside them are never targets.
  - **In reach**: one of its buildings stands within 5 tiles (build range less one) of an explored tile of the field that still holds shards. Until then its power plants, barracks and factories go toward the field; defences, the lab and the superweapon keep the compact base.
  - **Filler**: when nothing else is due and more than 1 500 credits are banked, it builds a power plant toward the field. Raider builds none in its opening (AI-14).
  - `rules.expand` switches AI-43 and AI-44 off together for measurement (AI-18's three a refinery, at most eight, and a third refinery).

## Map

- **MAP-10**: Crossroads is redrawn.
  - **Unchanged**: both bases, their starting buildings and their two home fields, so Highlands and the base-area tests are not affected.
  - **Home**: each base has its two home fields and no other field near it, so its next field is out in the middle.
  - **Middle**: a forward field per base on the road between the bases, about halfway to the centre and about the size of a home field; and a massive centre field of at least 500,000 shards on flat open ground. Revised at the owner's request: the first drawing gave each base a natural field beside its side lane, so nobody had to go to the middle.
  - **Lanes**: three lanes cross the mid-map between the bases. The middle lane is at least 24 tiles wide and runs past both forward fields through the centre field. A side lane at least 14 tiles wide runs far out on each flank, crossing the middle of the map at least 24 tiles off the road, for flanking and harassment. A side lane is at most 60% longer than the middle way.
  - **Flanks**: on each flank a barrier, a hill at each end and a lake between, divides the middle lane from the side lane. A lake in each of the map's east and west corners closes the side lane's far edge. Water covers under 2,000 tiles, under half of the first drawing (4,024).
  - **Elsewhere**: the ground is flat. The barrier hills are raised rock, as R3D-14 requires.
  - **Rules**: MAP-2, MAP-3 and MAP-4 still hold, including equal road distance to every field and an AI that plays to a finish. The pond on each base's outer flank (MAP-3) moves a few tiles toward the base's corner to open the way into the side lane.
  - **Network version**: the network version goes to 12, since an older client would build the old Crossroads and fall out of step (NET-3).

## Combat

- **CMB-18**: An artillery shell (Aegis artillery, Vrax Lobber) is in the air for 30 ticks (1.5 s; it was 14). It lands where its target stood when it was fired, so a target on the move can get clear of it. Requested by the owner with the AI balance work.
- **CMB-19**: Artillery has a **minimum range** of 4 tiles: it cannot fire at anything closer. It never picks such a target. One it picked itself that comes that close is dropped for another; one it was ordered to attack it holds without firing.

## Harness

- **HAR-8**: The battle harness and the full-match harness report **value traded**: the cost each side lost. The match harness reports it per AI, along with each AI's retreats, regroups and harassment responses.
- **HAR-9**: **Kite scenario**: a harness bench where a scripted harasser kites an AI army on open ground. It has two variants:
  - Glare Skimmers firing from range 9 at an Aegis army;
  - Bulwark Tanks kiting a Vrax army, using HAR-7's `kiteOrders`.

  The AI has what a Hard AI has by then: a power plant and two defences (Pulse Turrets or Spine Spires) a few tiles in front of its headquarters, toward the harassers. A unit out scouting is not counted as part of the army.

  It reports value traded and the farthest any AI unit strayed from its army's centre.
  - **Pass mark**: the AI loses less value than before this milestone in both variants, and no AI unit strays more than `HARASS_LEASH` + 4 tiles from its army's centre.
- **HAR-10**: **Overwhelm scenario**: an AI wave meets an enemy army of twice its power that has taken the middle ground and holds it. The army fights whatever comes within its reach but does not march on the AI's base, so the scenario judges the wave's decision to retreat, not whether a base can survive an army twice its wave's size.
  - **Pass mark**: after 60 s the wave has retreated and keeps at least 40% of its value.
  - **Measured on seeds 1 to 3**: 76% kept (800 lost). The AI before this milestone, on the same bench, kept none: it retreated only after contact and died on the way (3,400 lost).
- **HAR-11**: **No regression** on the Balance workflow. The pass marks of AI-25 (steamroll), AI-32 (tank spam), ROS-4 (faction balance) and AI-15/AI-19 (personalities) still hold on the new Crossroads.
  - **Measured** (Balance workflow, commit 098c72d): steamroll 46 won, 50 lost of 96 (run 44930627980); tank spam 66 won, 30 lost of 96 (44930631479); faction balance Aegis 2, Vrax 8, 2 undecided of 12 (44930634571); personalities: Doomsday 3, Balanced 5, strikes in 4 games, arrival median 52 ticks (44930638011); artillery share 0.140, 0.180, 0.171 (44930641115). Before the fixes: Doomsday 1 to 7 with its strike wave never arriving (its wave was held in the concave, and the superweapon fired at the end of its hold with the wave far off or not out), and artillery 0.076, 0.113, 0.136 (AI-15 and AI-19 amended). For comparison, main before this milestone: Doomsday 5 to 3, strikes in 6.
