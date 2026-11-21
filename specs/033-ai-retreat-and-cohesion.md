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
  - A unit's power is its cost scaled by its health as a share of its **real** maximum health. That maximum includes veterancy, so a ranked unit counts for more than a fresh one.
  - The enemy force near a group counts only enemy units seen in the last 10 game seconds (200 ticks), plus defence buildings at 1.5× their cost. The longer memory still feeds the attack decision and intel.
- **AI-36**: An AI group is **overwhelmed** when the enemy power within 11 tiles of its centre is at least 1.5× its own power. Its own defence buildings within that radius count on its side.
  - The test applies to waves and strike groups (amending AI-8 and AI-23), to standing units answering an attack (amending AI-34), and to the army pulled home by base defence (amending AI-7).
  - An overwhelmed group retreats (AI-37) instead of fighting on. Base defence that is not overwhelmed still attacks as before.
  - Doomsday keeps its exemption while a charged superweapon strike is under way.

## Retreat and regroup

- **AI-37**: A retreat goes to the **nearest friendly strength**, chosen in this order:
  1. the staging point, when reinforcements or Menders are gathering there;
  2. the nearest own defence buildings;
  3. the base.

  How the army moves depends on whether it can outrun the enemy. It can outrun them when its slowest unit is faster than the fastest enemy unit chasing it.
  - **It can outrun them**: every unit runs to the fallback point at full speed with a plain move.
  - **It can't**: the whole army makes a **fighting retreat** together. It falls back in hops of about 3 tiles. Between hops it turns into its concave (AI-42) and fires for about one second. It stops once it reaches friendly strength, or once no enemy has been within its reach + 2 tiles for 3 seconds.
- **AI-38**: A retreated army **regroups** at its fallback point, and the 1200-tick cooldown after a beaten wave is removed.
  - The retreated units and new reinforcements gather there as one army.
  - The next wave launches only when the normal attack test (AI-11 / AI-23) passes against an estimate no lower than the enemy strength that beat the last wave. That memory fades as the AI's intel ages.

## Harassment

- **AI-39**: An enemy group within 12 tiles of an AI army is a **harasser** when it is weaker than that army, and either of these holds:
  - it out-ranges the units that make up most of that army's power;
  - it is faster than them and moved away from them while firing in the last 3 seconds (kiting).

  Anything else is a real fight, judged by AI-36.
- **AI-40**: Under harassment the AI never sends single units chasing.
  - **Chasing**: it chases only when its units that can **catch or reach** the harassers (as fast as the harassers' fastest, or with at least their longest range) have at least 1.5× the harassers' power. Only those units chase.
  - **Otherwise, if it is a standing army or a gathering army**: it tightens into its army ball or concave and advances **as one body** toward the harassers. It goes no further than 8 tiles from where it stood (`HARASS_LEASH`).
  - **Otherwise, if it is a wave**: it keeps advancing toward its target as one body.
  - **Falling back**: if the harassers are not pushed off within 10 seconds and the army is still losing value, it falls back out of their range onto friendly strength (AI-37).
  - This replaces AI-30's Brute-only rule; its `noChase` rule is retired in favour of this one.

## Army ball and concave

- **AI-41**: While travelling or idle, an AI army holds an **army ball**.
  - **Waves**: the existing close-up (spread above 4 + √n) stays.
  - **Units gathering at the staging point and standing units**: any unit more than 4 + √n tiles from the group's centre is moved back toward it.
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
  - **Centre**: a massive centre field of at least 380,000 shards on flat open ground.
  - **Flanks**: lakes and rock walls block the mid-map on both flanks.
  - **Lanes**: three lanes cross between the bases. A middle lane at least 8 tiles wide runs through the centre field, and a side lane at least 4 tiles wide runs on each flank, for flanking and harassment.
  - **Natural field**: each base has one beside the start of its side lane, holding about as much as a home field.
  - **Elsewhere**: the scattered mid-map rocks are removed and the ground is flat. Some raised rock stays, as R3D-14 requires.
  - **Rules**: MAP-2, MAP-3 and MAP-4 still hold, including equal road distance to every field and an AI that plays to a finish.

## Harness

- **HAR-8**: The battle harness and the full-match harness report **value traded**: the cost each side lost. The match harness reports it per AI, along with each AI's retreats, regroups and harassment responses.
- **HAR-9**: **Kite scenario**: a harness bench where a scripted harasser kites an AI army on open ground. It has two variants:
  - Glare Skimmers firing from range 9 at an Aegis army;
  - Bulwark Tanks kiting a Vrax army, using HAR-7's `kiteOrders`.

  It reports value traded and the farthest any AI unit strayed from its army's centre.
  - **Pass mark**: the AI loses less value than before this milestone in both variants, and no AI unit strays more than `HARASS_LEASH` + 4 tiles from its army's centre.
- **HAR-10**: **Overwhelm scenario**: an AI wave meets an enemy army of twice its power.
  - **Pass mark**: the wave retreats and keeps at least 40% of its value, where it used to die in place.
- **HAR-11**: **No regression** on the Balance workflow. The pass marks of AI-25 (steamroll), AI-32 (tank spam), ROS-4 (faction balance) and AI-15/AI-19 (personalities) still hold on the new Crossroads.
