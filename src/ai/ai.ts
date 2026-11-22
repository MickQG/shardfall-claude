import { BUILDING_DEFS, buildingDef, canCrush, choosePad, UNIT_DEFS, unitDef, type Faction, type UnitDef } from '../data/defs';
import { BUILD_RANGE, canPlace, EXPLORED, FP, QUEUE_MAX, Rng, VISIBLE, type BuildingSnap, type Command, type MapDef, type Snapshot, type UnitSnap } from '../sim';
import { CRAWL_FILLER_BANK, CRAWL_SAFE, CRAWL_SAFE_R, crawlTarget, HAULERS_IN_PRODUCTION, inReach, minedFields, RAMP_PER_REFINERY, SERVE_R, wantsCrawl, type MinedField } from './expand';
import { kitOf, type Kit } from './kit';
import { CONCAVE_R, ballStragglers, concaveSlots, middleOf, slotMoves, type FormUnit } from './formation';
import { setCatchByEffectiveSpeed, HARASS_LEASH, HARASS_PATIENCE, HARASS_R, KiteWatch, harassAnswer, isHarasser, leashed, mainUnits, outranges, reachOf } from './harass';
import { isTank, MENDER_FALLBACK, MenderPlan, menderOf, mendersWanted } from './menders';
import { RETREAT_ARRIVED, RETREAT_CLEAR_R, RETREAT_HOLD, chooseFallback, retreatStep, toward, RETREAT_HOP, type FallbackKind, type FightingRetreat } from './retreat';
import { armyPower as powerOf, canOutrun, defencePower, edgeDist, FRESH_SIGHT, freshEnemyPower, isOverwhelmed, OVERWHELM_R } from './strength';

/** Difficulty changes only how fast the AI reacts, how many orders it can give, and a shard-income bonus. */
export interface Difficulty {
  name: string;
  /** Ticks between decisions (reaction time). */
  thinkEvery: number;
  /** Maximum orders per decision (actions per minute). */
  maxCommands: number;
  /** Percent bonus (or handicap, if negative) on delivered shards. */
  bonus: number;
}

export const DIFFICULTIES: Readonly<Record<'easy' | 'medium' | 'hard', Difficulty>> = {
  easy: { name: 'easy', thinkEvery: 60, maxCommands: 2, bonus: -10 },
  medium: { name: 'medium', thinkEvery: 26, maxCommands: 7, bonus: 0 },
  hard: { name: 'hard', thinkEvery: 8, maxCommands: 12, bonus: 15 },
};

/**
 * The strategy an AI opponent commits to for a match (AI-12). Separate from Difficulty: a personality changes only what
 * the AI chooses to do, never what it sees or the rules (AI-2, AI-10).
 */
export type Personality = 'raider' | 'balanced' | 'doomsday';
export const PERSONALITIES: readonly Personality[] = ['raider', 'balanced', 'doomsday'];

/** A named personality, or a draw from the game seed for anything else ("random"), so the choice is deterministic (MENU-5). */
export function resolvePersonality(choice: string | null | undefined, seed: number): Personality {
  if ((PERSONALITIES as readonly string[]).includes(choice ?? '')) return choice as Personality;
  return PERSONALITIES[new Rng((seed >>> 0) * 31 + 977).int(PERSONALITIES.length)] as Personality;
}

/** Raider's opening lasts at most eight minutes of game time, or until this many of its raids are beaten back (AI-16). */
export const RAIDER_OPENING_END = 20 * 60 * 8;
export const RAIDER_RAIDS_LOST = 3;
/** Raider sets out once it has this many armed units, from this tick (AI-14). */
export const RAID_MIN_ARMY = 5;
export const RAID_FROM = 20 * 75;
/** Doomsday fires when its wave is this close (tiles) to the strike, so the wave arrives just after it lands (AI-15). */
export const STRIKE_LEAD = 16;
/** Doomsday's wave stays committed (no retreat, harassment answer or concave) this long (ticks) after its strike (AI-15). */
export const STRIKE_COMMIT = 400;
/** Doomsday holds a charged superweapon at most this long (ticks) for its wave before it fires anyway. */
export const STRIKE_HOLD = 20 * 90;
/** ... and at most this long while no wave is out or its wave is still closing in by STRIKE_CLOSING tiles (AI-15). */
export const STRIKE_HOLD_MAX = 20 * 240;
export const STRIKE_CLOSING = 3;
/** Doomsday goes for its superweapon only with an army worth this much and this many haulers working (AI-15). */
export const SUPERWEAPON_ARMY = 5000;
export const SUPERWEAPON_HAULERS = 5;
/** Doomsday sizes its rifle floor on enemy infantry seen within this many ticks (AI-15): "lately", not everything it has seen since the sight lingers (FOG-7). */
export const RIFLE_INTEL = 20 * 30;
/**
 * Production first (AI-22). With every barracks and factory busy and more than GROWTH_BANK credits banked, the next
 * building is another barracks or factory, up to GROWTH_MAX of each. Turrets wait for TURRETS_FROM production buildings
 * (or an attack on the base); the lab comes once it has LAB_FROM of them and that rule has nothing to build (Doomsday's
 * comes straight after its second factory; Raider builds none in its opening).
 */
export const GROWTH_BANK = 1500;
export const GROWTH_MAX = 5;
export const TURRETS_FROM = 6;
export const LAB_FROM = 5;
/** Unit queues stay shallow (AI-22): this many deep in a building, QUEUE_DEEP above QUEUE_DEEP_BANK credits banked. */
export const QUEUE_SHALLOW = 3;
export const QUEUE_DEEP = 5;
export const QUEUE_DEEP_BANK = 3000;
/** Artillery pieces in production (queued or being built) at once, at most (AI-22). */
export const ARTILLERY_IN_PRODUCTION = 4;
/** One more artillery piece may be in production for every this many armed units in its army (AI-19, amending AI-22). */
export const ARTILLERY_PER_ARMY = 15;

/** Artillery pieces it may have in production at once (AI-19, AI-22): the base cap, and one more per ARTILLERY_PER_ARMY armed units. */
export function artilleryInProduction(base: number, army: number): number {
  return base + Math.floor(army / ARTILLERY_PER_ARMY);
}

/** How far (tiles) to one side of the straight line a scout's route swings, around the enemy's front (AI-17). */
export const SCOUT_FLANK = 22;

/**
 * The standing scout (AI-21). How many scout units an AI keeps out watching: one, for every personality and difficulty.
 * This is the "one standing scout" rule; production never trains a scout unit beyond it, and the scout logic follows
 * one such unit (giving Raider more would need a tour for each).
 */
export const STANDING_SCOUTS = 1;
/** No replacement scout is ordered within this many ticks of losing one, so scouts are not fed to the same guns (AI-21). */
export const SCOUT_REPLACE = 20 * 30;
/** A scout lost younger than this (ticks) is replaced only after twice SCOUT_REPLACE (AI-21). */
export const SCOUT_YOUNG = 20 * 60;
/** How far (tiles) its observation points, and its way round the enemy base, stay from the enemy buildings it knows (AI-21). */
export const SCOUT_STANDOFF = 9;
/** It backs away from any defence this close (tiles, to the defence's footprint), whatever its health (AI-21). */
export const SCOUT_DANGER = 8;
/**
 * It backs away from any armed enemy unit this close (tiles), near the edge of its sight (11), whatever its health; from
 * a unit whose guns reach farther (artillery, the heroes' missile pods), as far as they reach and two tiles more (AI-21).
 */
export const SCOUT_KEEP = 10;
/** How close (tiles) an armed enemy unit of this kind may come to the scout (AI-21). */
export const scoutKeep = (kind: string): number => {
  const d = unitDef(kind);
  return Math.max(SCOUT_KEEP, (d.weapon?.range ?? 0) + 2, (d.weapon2?.range ?? 0) + 2);
};
/** How long (ticks) a sighting of an armed enemy unit keeps the ground around it closed to the scout (AI-21). */
export const SCOUT_MEMORY = 20 * 30;
/**
 * The longest hop (tiles) of one order (AI-21): it sees 11 tiles and guns reach about 7, so in 4 tiles it cannot drive from
 * out of sight into gun range before it decides again. A quick AI hops just past where its next decision finds it.
 */
export const SCOUT_HOP = 4;
/** How far (tiles) it flees straight away from the threats it sees (AI-21). */
export const SCOUT_FLEE = 8;
/** Directions of its observation points around the enemy base, in order around the compass (AI-21). */
const RING: readonly (readonly [number, number])[] = [
  [1, 0],
  [Math.SQRT1_2, Math.SQRT1_2],
  [0, 1],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [-1, 0],
  [-Math.SQRT1_2, -Math.SQRT1_2],
  [0, -1],
  [Math.SQRT1_2, -Math.SQRT1_2],
];

export type Role = 'inf' | 'at' | 'tank' | 'art' | 'air' | 'scout';

/** A shard field: a patch of shard tiles (8-way neighbours), by its tiles and centre (AI-18). */
export interface ShardField {
  tiles: number[];
  cx: number;
  cy: number;
}

/** The shard fields of a map, from its shard tiles: each connected patch is one field (AI-18). */
export function shardFields(map: MapDef): ShardField[] {
  const W = map.width;
  const shards = map.shards ?? [];
  const seen = new Uint8Array(shards.length);
  const out: ShardField[] = [];
  for (let i = 0; i < shards.length; i++) {
    if (seen[i] || !((shards[i] as number) > 0)) continue;
    const tiles: number[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const t = stack.pop() as number;
      tiles.push(t);
      const x = t % W;
      const y = Math.floor(t / W);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= map.height) continue;
          const j = ny * W + nx;
          if (!seen[j] && (shards[j] as number) > 0) {
            seen[j] = 1;
            stack.push(j);
          }
        }
    }
    tiles.sort((p, q) => p - q);
    const cx = tiles.reduce((s2, t) => s2 + (t % W), 0) / tiles.length + 0.5;
    const cy = tiles.reduce((s2, t) => s2 + Math.floor(t / W), 0) / tiles.length + 0.5;
    out.push({ tiles, cx, cy });
  }
  return out;
}

/** A player's home fields (AI-18): the two shard fields nearest their start, within 20 tiles of it. */
export function homeFields(map: MapDef, home: { tx: number; ty: number }): ShardField[] {
  const d = (f: ShardField): number => Math.hypot(f.cx - home.tx - 1.5, f.cy - home.ty - 1.5);
  return shardFields(map)
    .filter((f) => d(f) <= 20)
    .sort((a, b) => d(a) - d(b) || a.tiles[0]! - b.tiles[0]!)
    .slice(0, 2);
}

export const roleOf = (d: UnitDef): Role =>
  d.role === 'infantry' || d.role === 'raider' ? 'inf' : d.role === 'antiarmor' ? 'at' : d.role === 'tank' ? 'tank' : d.role === 'artillery' ? 'art' : d.role === 'air' ? 'air' : 'scout';

export interface Intel {
  /** Fractions (0..1) of recently seen armed enemy units. */
  air: number;
  heavy: number;
  light: number;
  /** Fraction that are infantry squads (BAL-6). */
  squads?: number;
  total: number;
}

const BASE_WEIGHTS: Record<Role, number> = { inf: 0.28, at: 0.2, tank: 0.32, art: 0.08, air: 0.08, scout: 0.04 };
/** The Doomsday mix (AI-15): tech units (tanks, artillery) over cheap ones; its rifles come from the infantry floor. */
const TECH_TILT: Partial<Record<Role, number>> = { tank: 0.3, art: 0.1, at: -0.08, inf: -0.22 };

/**
 * Rifle infantry Doomsday keeps to answer enemy infantry (AI-15): at least two, and at least half as many as the enemy
 * infantry squads it has seen lately.
 */
export function infantryNeeded(intel: Intel): number {
  return Math.max(2, Math.ceil(0.5 * (intel.squads ?? 0) * intel.total));
}

/** Extra artillery weight per unit of infantry-squad share among the enemies seen (AI-19). */
export const ARTILLERY_TILT = 0.8;

/** One artillery for every four enemy infantry squads seen lately, at most four (AI-19). */
export function artilleryNeeded(intel: Intel): number {
  if (intel.total < 3) return 0;
  return Math.min(4, Math.floor(((intel.squads ?? 0) * intel.total) / 4 + 1e-9));
}

/** The Raider mix (AI-14): fast, cheap raiders and rifles over tanks and artillery. */
const RAIDER_TILT: Partial<Record<Role, number>> = { inf: 0.12, scout: 0.06, tank: -0.04, art: -0.04 };

/** Pick the next unit to train: fill the biggest gap between desired and actual composition, adapting to what the enemy fields. */
export function chooseUnitKind(cands: readonly string[], counts: Readonly<Record<Role, number>>, intel: Intel, tilt?: Partial<Record<Role, number>>, scoutCap = 1): string | null {
  if (cands.length === 0) return null;
  const army = Object.values(counts).reduce((a, b) => a + b, 0);
  const w = { ...BASE_WEIGHTS };
  // A personality tilts the base mix (AI-14): Raider fields fast, cheap units.
  if (tilt) for (const [r, v] of Object.entries(tilt) as [Role, number][]) w[r] = Math.max(0.02, w[r] + v);
  if (intel.total >= 3) {
    // Artillery grows with the share of infantry the enemy fields (AI-19), for every personality.
    // Doomsday already leans on artillery (its tech tilt), so it takes a quarter of the extra (AI-15, AI-19).
    w.art += ARTILLERY_TILT * (intel.squads ?? 0) * (tilt === TECH_TILT ? 0.25 : 1);
    if (intel.heavy > 0.4) {
      w.at += 0.25;
      w.art += 0.05;
    }
    if (intel.light > 0.5) {
      w.tank += 0.15;
      w.inf += 0.1;
    }
    // An infantry-heavy enemy is met with crushers and rifles rather than more anti-armour (BAL-6).
    if ((intel.squads ?? 0) > INFANTRY_HEAVY) {
      w.tank += 0.25;
      w.inf += 0.1;
      w.at = Math.max(0.05, w.at - 0.1);
    }
  }
  let best: string | null = null;
  let bs = -Infinity;
  for (const k of cands) {
    const d = unitDef(k);
    const r = roleOf(d);
    let score = w[r] * (army + 3) - counts[r];
    if (r === 'art' && counts.art >= Math.max(1, army * 0.25, artilleryNeeded(intel))) score -= 5;
    if (r === 'air' && counts.air >= Math.max(1, army * 0.25)) score -= 5;
    // Scout units beyond the cap (one; Raider's raiders beside its standing scout, AI-27 a) are worth little.
    if (r === 'scout' && counts.scout >= scoutCap) score -= 5;
    // Enemy aircraft: anti-air capable units are worth a premium until we have a few.
    if (intel.total >= 2 && intel.air > 0.12 && d.weapon?.antiAir) score += 1.5 + 4 * intel.air;
    if (score > bs || (score === bs && best !== null && d.cost < unitDef(best).cost)) {
      bs = score;
      best = k;
    }
  }
  return best;
}

/** How recently (ticks) an enemy must have been seen to count toward the armour mix, and what share is "mostly" (SKM-6). */
export const ARMOUR_INTEL_TICKS = 2400;
export const MOSTLY_HEAVY = 0.5;

/**
 * Share of heavy armour, by cost, among the armed enemy units seen in the last ARMOUR_INTEL_TICKS (two minutes; SKM-6):
 * the credits' worth of heavy-armoured ones over the credits' worth of all of them; 0 when none were seen.
 */
export function heavyShareByCost(seen: Iterable<{ kind: string; t: number }>, tick: number): number {
  let heavy = 0;
  let all = 0;
  for (const e of seen) {
    const d = UNIT_DEFS[e.kind];
    if (!d || !d.weapon || tick - e.t > ARMOUR_INTEL_TICKS) continue;
    all += d.cost;
    if (d.armor === 'heavy') heavy += d.cost;
  }
  return all === 0 ? 0 : heavy / all;
}

/**
 * The Vrax answer to an armoured enemy (SKM-6): of the kinds a building can train, the hover tank that fires on the
 * move with a lance made for heavy armour (the Glare Skimmer), or null. The AI trains it as its main anti-armour unit
 * while the armed enemies seen lately are mostly heavy armour by cost (heavyShareByCost above MOSTLY_HEAVY), and not
 * otherwise.
 */
export const skimmerOf = (trainable: readonly string[]): string | null => trainable.find((u) => unitDef(u).firesMoving && unitDef(u).weapon?.type === 'lance') ?? null;
/** Share of infantry squads among the armed enemies seen above which the enemy is infantry-heavy (BAL-6). */
export const INFANTRY_HEAVY = 0.45;

/** The Skimmer, `skim`, in place of a building's usual choice unless that is artillery (SKM-6, AI-19); the usual choice when `skim` is null. */
export const skimOr = (skim: string | null, usual: string | null): string | null => (skim !== null && (usual === null || roleOf(unitDef(usual)) !== 'art') ? skim : usual);

/** Launch a wave only with a real army that clearly outclasses what we know of the target. */
/**
 * How close (tiles) an enemy it can crush must be before an AI crusher drives over it, and how far past it the crusher
 * drives (BAL-5). Farther off it fights with its guns like any other unit, and it keeps firing on the way in (BAL-11).
 */
export const CRUSH_REACH = 6;
export const CRUSH_OVERRUN = 1.5;

/**
 * Crush micro (BAL-5, BAL-10): each healthy crusher that sees an enemy it can crush close by (an infantry squad; for a
 * hero, any ground unit but a hero) drives through it (a plain move to a point just beyond it), so it runs it over
 * instead of standing and trading shots. Pure: a function of what the player can see.
 */
export function crushOrders(player: number, own: readonly UnitSnap[], foes: readonly UnitSnap[], mapW: number, mapH: number): Command[] {
  const out: Command[] = [];
  const enemies = foes.filter((f) => f.owner !== player);
  if (enemies.length === 0) return out;
  for (const u of own) {
    const d = unitDef(u.kind);
    if (u.owner !== player || !d.crusher || u.hp * 10 < d.hp * 3) continue;
    let best: UnitSnap | null = null;
    let bd = CRUSH_REACH * FP;
    for (const f of enemies) {
      if (!canCrush(u.kind, f.kind)) continue;
      const fd = Math.hypot(f.x - u.x, f.y - u.y);
      if (fd < bd || (fd === bd && best !== null && f.id < best.id)) {
        bd = fd;
        best = f;
      }
    }
    if (!best) continue;
    const len = Math.max(1, bd);
    const x = Math.max(0, Math.min(mapW * FP - 1, Math.round(best.x + ((best.x - u.x) * CRUSH_OVERRUN * FP) / len)));
    const y = Math.max(0, Math.min(mapH * FP - 1, Math.round(best.y + ((best.y - u.y) * CRUSH_OVERRUN * FP) / len)));
    out.push({ type: 'move', player, units: [u.id], x, y });
  }
  return out;
}

export function shouldAttack(myPower: number, enemyEstimate: number, armyCount: number, threshold: number, ratio = 1.25): boolean {
  return armyCount >= 5 && myPower >= threshold && myPower >= ratio * enemyEstimate;
}

const tileOf = (v: number): number => Math.floor(v / FP);

const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);

/** A remembered sighting of an enemy unit: its kind, where and when it was last seen (AI-2: only what the AI saw). */
export interface Remembered {
  kind: string;
  x: number;
  y: number;
  t: number;
  /** Its health and veterancy rank when last seen (AI-35). */
  hp?: number;
  rank?: number;
}

/** How a main wave goes to its target (AI-26): the straight line, or by an approach point on its left or right flank. */
export type Approach = 'straight' | 'left' | 'right';
export const APPROACHES: readonly Approach[] = ['straight', 'left', 'right'];
/** A flank's approach point lies halfway to the target and APPROACH_FLANK tiles to that side (AI-26). */
export const APPROACH_FLANK = 10;
/** A flank whose approach point has no open ground within this many tiles is not offered (AI-26). */
export const APPROACH_OPEN = 6;
/** Where the enemy army was last seen: the armed enemy units seen within APPROACH_SEEN ticks, beyond APPROACH_DEFENDERS tiles of the target (AI-26). */
export const APPROACH_SEEN = 20 * 120;
export const APPROACH_DEFENDERS = 10;
/** A group has passed its approach point once its centre is within this many tiles of it (AI-26). */
export const APPROACH_PASSED = 4;
/** A strike group is at least this many units (AI-27). */
export const STRIKE_MIN = 3;
/** Raider splits a raid of at least this many units, between two targets at least SPLIT_APART tiles apart (AI-27 a). */
export const SPLIT_MIN = 6;
export const SPLIT_APART = 8;
/** Scout units Raider may train beyond its standing scout, for its raids; they belong to the army (AI-27 a, amending AI-21). */
export const RAIDER_SCOUTS = 3;
/** A fast unit, which a strike group beside a main wave is made of: a top speed of at least this (AI-27 b). */
export const FAST_SPEED = 45;
/** That strike group takes at most this share of the army's value (AI-27 b). */
export const STRIKE_SHARE = 0.1;
/** The main wave it leaves behind keeps at least this many units: a strike group never turns it into a lone wave (AI-27 b, HAR-2). */
export const STRIKE_WAVE_MIN = 5;
/**
 * Raider splits a raid only when each squad is worth at least SPLIT_RATIO times the armed enemy units it has seen within
 * APPROACH_SEEN ticks, so half a raid does not meet the whole enemy army (AI-27 a); 0 drops the condition.
 */
export const SPLIT_RATIO = 1;

/**
 * A group out on the map (AI-11, AI-27). 'wave': a main wave, or a raid that set out as one body; 'raid': one of the two
 * strike groups of Raider's split raid (AI-27 a); 'strike': the strike group beside a main wave (AI-27 b), not part of it.
 */
interface Wave {
  kind: 'wave' | 'raid' | 'strike';
  /** Its approach point (AI-26, AI-27) while it has one to go by, and whether its body has passed it. */
  via: { tx: number; ty: number } | null;
  passed: boolean;
  /** Reinforcements that joined after its body passed the approach point: they go by it too, until they reach it (AI-26). */
  trail: Set<number>;
  tx: number;
  ty: number;
  /** The strongest it has been, reinforcements included (AI-23): the retreat test compares with this. */
  peak: number;
  /** Its strength as it set out: the retreat test compares with this when rules.wavePeak is off (AI-8, AI-23). */
  start: number;
  lastOrder: number;
  /** The units in the wave, and how many set out (AI-11). */
  members: Set<number>;
  size: number;
  /** Whether the last order held the wave back to close up. */
  held: boolean;
  /** Since when harassers have been near it, and its power then (AI-40). */
  harassSince?: number;
  harassStart?: number;
  /** A strike group sent while the enemy's armour was away (AI-31): no threat to the base calls it home. */
  ball?: boolean;
}

/** Wave pacing (AI-11): ticks between orders, tiles per hop, the spread at which it closes up, and gathering rules. */
export const WAVE_STEP = 60;
export const WAVE_HOP = 8;
export const WAVE_SPREAD = 4;
export const GATHER_R = 9;
export const GATHER_SHARE = 0.75;
export const GATHER_WAIT = 900;

/**
 * Where a recalled wave goes (AI-23): its hold point, HOLD_AHEAD tiles toward the enemy from its turrets (or its front
 * building), within HOLD_REACH tiles of its buildings.
 */
export const HOLD_AHEAD = 3;
export const HOLD_REACH = 5;
/** A wave comes home when an enemy force worth RECALL_SHARE of its whole army is seen within RECALL_RANGE tiles of its buildings (AI-23). */
export const RECALL_RANGE = 20;
export const RECALL_SHARE = 0.5;
/** How lately (ticks) "seen" means for the recall: what it sees now, or has just seen. */
export const RECALL_SEEN = 100;
/** The retreat test counts enemies within this many tiles of the wave's centre (AI-8, AI-23). */
export const LOCAL_R = 11;
/**
 * Stalemate (AI-23): no wave out and no attack on the base for this long (ticks), and five of each production building or
 * an army worth this much; it weighs the enemy army it has seen within STALEMATE_SEEN ticks.
 */
export const STALEMATE_QUIET = 20 * 180;
export const STALEMATE_ARMY = 25000;
export const STALEMATE_SEEN = 20 * 120;
/** Raider's raid sets out only where the defenders seen within RAID_GUARD_R tiles in the last RAID_GUARD_AGE ticks are worth less than RAID_GUARD_SHARE of the raid (AI-23). */
export const RAID_GUARD_R = 10;
export const RAID_GUARD_AGE = 20 * 60;
export const RAID_GUARD_SHARE = 0.5;

/**
 * The army's discipline (AI-36 to AI-42): a regroup remembers the strength that beat the last wave, fading over
 * BEATEN_MEMORY ticks as intel ages (AI-38); the concave stands CONCAVE_STANDOFF tiles short of the enemy's centre (AI-42).
 */
export const BEATEN_MEMORY = 2400;
/** A defence's fallback spot lies DEFENCE_BEHIND tiles behind it; against out-ranging harassers, their extra reach plus HARASS_BEHIND (AI-37, AI-40). */
export const DEFENCE_BEHIND = 2;
export const HARASS_BEHIND = 3.5;
/** A group within COVER_R tiles of its cover spot is under its defences' cover and holds there (AI-40). */
export const COVER_R = 3;
/** It leaves its cover once no armed enemy has been within COVER_WATCH tiles of it for COVER_CLEAR ticks (AI-40). */
export const COVER_WATCH = 20;
/** Slack (tiles) beyond HARASS_LEASH before a chasing unit of its standing army is called back (AI-40). */
export const LEASH_SLACK = 2;
export const COVER_CLEAR = 20 * 10;
export const CONCAVE_STANDOFF = 4;
/** A wave or strike group judges the enemy it has seen within WAVE_SIGHT_R tiles, so it turns before contact (AI-36). */
export const WAVE_SIGHT_R = 14;
/**
 * The enemy's armour is away from its base (AI-31) when the middle, by cost, of the heavy armed enemy units it has seen in
 * the last BALL_SEEN ticks is at least BALL_AWAY tiles from every enemy building it knows; then a strike group of fast
 * units, at most BALL_RAID_SHARE of its army's value, goes for the enemy economy.
 */
export const BALL_SEEN = 20 * 30;
export const BALL_AWAY = 20;
export const BALL_RAID_SHARE = 0.25;
/** No such strike group sets out within BALL_RAID_GAP ticks of the last one (AI-31). */
export const BALL_RAID_GAP = 20 * 30;
/** Against armour, Vrax keeps one Brute for every SCREEN_PER Skimmers it has or has queued (AI-33). */
export const SCREEN_PER = 3;
/** Where its second standing scout watches (AI-21): this far along the way from its staging point to the enemy start, and PICKET_SIDE tiles to one side. */
export const PICKET_ALONG = 0.3;
export const PICKET_SIDE = 6;
/**
 * Standing units answer an attack as a group (AI-34). Its units not out on a wave, raid or strike group that lost health
 * since its last decision, with the armed enemy units it sees within RESPONSE_R tiles of them, call in its other such
 * units within RESPONSE_R tiles. A counter-attack goes no farther than RESPONSE_LEASH tiles from where the group stood and
 * lasts at most RESPONSE_MAX ticks, its order renewed every RESPONSE_STEP ticks; a retreat goes to a refuge at least
 * RESPONSE_AWAY tiles off, and its units stay out of the army's orders for RETREAT_STAY ticks.
 */
export const RESPONSE_R = 9;
export const RESPONSE_LEASH = 8;
export const RESPONSE_MAX = 20 * 6;
export const RESPONSE_STEP = 40;
export const RESPONSE_AWAY = 6;
export const RETREAT_STAY = 20 * 10;

/**
 * A group of its standing units answering an attack (AI-34): counter-attacking, or answering harassers (AI-40) by chasing
 * with the units that can catch them or pushing as one body. An overwhelmed group retreats instead (Retreat).
 */
interface Response {
  mode: 'counter' | 'chase' | 'push' | 'hold';
  /** Its power when it began (AI-40: is it still losing value?). */
  start: number;
  members: Set<number>;
  /** Where the group stood (its middle, in tiles), and where it is going. */
  home: { x: number; y: number };
  to: { x: number; y: number };
  since: number;
  lastOrder: number;
}

/** How a group of its standing units answers attackers (AI-34, AI-36, AI-40): retreat to a fallback point, chase, push or counter-attack. */
type Judgement =
  | { mode: 'retreat'; to: { at: { x: number; y: number }; kind: FallbackKind }; run?: boolean }
  | { mode: 'counter' | 'push' | 'hold'; to: { x: number; y: number }; foe: { x: number; y: number } }
  | { mode: 'chase'; chasers: UnitSnap[]; to: { x: number; y: number }; foe: { x: number; y: number } };

/**
 * A group retreating to friendly strength (AI-37): its units, where it goes and what that is, whether it runs (plain move,
 * it can outrun the enemy) or makes a fighting retreat, and since when; units in it take no other army order meanwhile.
 */
/** A concave being held (AI-42): its units, where its front row stands, what it faces, how its units move, and until when. */
interface Formation {
  ids: number[];
  anchor: { x: number; y: number };
  facing: { x: number; y: number };
  type: 'move' | 'attackmove';
  until: number;
}

interface Retreat {
  members: Set<number>;
  to: { x: number; y: number };
  kind: FallbackKind;
  fight: FightingRetreat | null;
  since: number;
}

export interface AiStats {
  waves: number;
  retreats: number;
  /** Waves launched into clearly stronger opposition. */
  suicides: number;
  /** Waves launched with fewer than five units. */
  lone: number;
  scoutedAt: number;
  defends: number;
  superweaponShots: number;
  /** Tick the first wave set out, or -1 (AI-14). */
  firstWaveAt: number;
  /** Waves launched in the first eight minutes, and how many of those were aimed at the enemy economy (AI-14). */
  earlyWaves: number;
  economyWaves: number;
  /** Tick its first superweapon building stood, or -1 (AI-15). */
  superweaponAt: number;
  /** Tick of its first superweapon strike, and ticks until its wave reached the struck area afterwards, or -1 (AI-15). */
  strikeAt: number;
  strikeArrival: number;
  /** Tick its first lab was ordered, or -1 (AI-15). */
  labAt: number;
  /** Combat units ordered, by role, heroes apart (AI-15). */
  produced: Record<Role | 'hero', number>;
  /** Haulers and army value when it ordered its first superweapon, or null (AI-15). */
  superweaponOrder: { haulers: number; army: number } | null;
  /** The steamroll opponent only (HAR-5). */
  steamroll?: {
    /** Each attack it launched: tick, army value (credits) and crushers in the army. */
    launches: { tick: number; value: number; crushers: number }[];
    /** Most refineries, barracks, factories and haulers it had standing at once, and its largest army value. */
    peakRefineries: number;
    peakBarracks: number;
    peakFactories: number;
    peakHaulers: number;
    peakArmy: number;
    /** Kite orders its crushers were given (HAR-7). */
    kites: number;
  };
  /** Units it sent scouting (of any kind) that died while scouting (AI-21). */
  scoutsLost: number;
  /** Ticks each finished scouting term lasted, until the unit died or rejoined the army (AI-21). */
  scoutLifetimes: number[];
  /** Ticks the units scouting now set out, so a lifetime can be read at the end of a match (AI-21). */
  scoutingSince: number[];
  /** Its decisions from minute 5 on, and those on which its newest sighting of an armed enemy unit was at most INTEL_FRESH ticks old (AI-21). */
  intelThinks: number;
  intelFresh: number;
  /** Standing scouts (AI-21): ticks each lost one lived from when it stood, and the tick the living one stood, or -1. */
  standingLives: number[];
  standingSince: number;
  /**
   * Main waves by the approach they chose (AI-26), and each choice in the order they set out. Only waves that choose are
   * counted: raids, strike waves and the steamroll opponent's attacks go straight without choosing, and so does every wave
   * with rules.approach off.
   */
  approaches: Record<Approach, number>;
  approachLog: Approach[];
  /** Raids that set out split in two (AI-27 a), and strike groups sent beside a main wave (AI-27 b). */
  splitRaids: number;
  strikeGroups: number;
  /** Raider's scout units that came out for its army, beyond its standing scout (AI-27 a). */
  raiderScouts: number;
  /** Strike groups sent at the enemy economy while the enemy's armour was away from its base (AI-31). */
  ballRaids: number;
  /** Beaten waves that regrouped at their fallback point (AI-38), and retreats made fighting (AI-37). */
  regroups: number;
  fightingRetreats: number;
  /** Answers to harassers (AI-40): chasing with the units that can catch them, pushing as one body, falling back. */
  harassResponses: { chase: number; push: number; fallBack: number; hold: number };
  /** Doomsday's strikes and what its wave did after them (AI-15), for measuring. */
  strikeNotes: string[];
  /** Groups of its standing units that answered an attack (AI-34): by counter-attacking together, and by retreating. */
  counters: number;
  withdrawals: number;
}

/** Options of an AI beyond difficulty and personality. */
export interface AiOptions {
  /** The standing scout (AI-21), on unless false; off only in measurement (the harness), to compare with the old scouting. */
  standingScout?: boolean;
  /** Its rules (AI-22 to AI-27), each switchable for measurement; DEFAULT_RULES where not given. */
  rules?: Partial<AiRules>;
}

/**
 * The rules of AI-22 to AI-27 that stay switchable, so later balance work can measure each one alone (HAR-5, HAR-6).
 * DEFAULT_RULES is how the game plays; an "off" value restores the behaviour before that rule. The steamroll opponent
 * keeps its own build and attack (HAR-5) and does not scatter.
 */
export interface AiRules {
  /** (AI-23 a) The retreat test compares a wave with the strongest it has been; off: with what set out. */
  wavePeak: boolean;
  /** (AI-23 b) Reinforcements join only a wave at least as strong as the enemy near it. */
  noFeed: boolean;
  /** (AI-23 c) A wave out comes home when a big enemy force is near the base. */
  recall: boolean;
  /** (AI-23 d) Attack at parity after three quiet minutes. */
  stalemate: boolean;
  /** (AI-23 e) Raider raids only weakly guarded targets. */
  raidGuard: boolean;
  /** (AI-22) Unit queue depth, and the depth above QUEUE_DEEP_BANK credits banked; at most this many artillery in production. */
  queueDepth: number;
  queueDepthRich: number;
  artilleryCap: number;
  /** (AI-24) Its infantry squads scatter from enemy crushers. */
  scatter: boolean;
  /** (AI-22, AI-15) Doomsday grows by factories alone, whenever every factory is busy; off: it grows as Balanced does. */
  doomGrowth: boolean;
  /** (AI-26) Main waves vary their approach; off: every wave goes straight. */
  approach: boolean;
  /** (AI-27 a) Raider splits a raid into two strike groups, and may train scout units for its army; off: one body, one scout unit. */
  raidSplit: boolean;
  /** (AI-27 b) Balanced and Doomsday send a strike group of fast units beside a main wave; off: the fast units go with the wave. */
  strikeGroup: boolean;
  /** (AI-26, AI-27) How far (tiles) to the side of the straight line a flank's approach point lies. */
  approachFlank: number;
  /** (AI-27 b) The largest share of the army's value a strike group beside a main wave may take. */
  strikeShare: number;
  /** (AI-27 a) Each squad of a split raid is worth at least this many times the enemy army seen lately; 0: no such condition. */
  splitRatio: number;
  /** (SKM-6) Trains Glare Skimmers against an enemy that is mostly heavy armour; off: never trains them. */
  skimmers: boolean;
  /** (SKM-6) The share of heavy armour by cost among the enemies seen above which it trains Skimmers. */
  skimAt: number;
  /** (AI-29) Aegis trains Field Menders, one for every three tanks; off: none (so neither of the two below applies). */
  menders: boolean;
  /** (AI-29) Badly damaged tanks fall back to a Field Mender until mended. */
  menderFallback: boolean;
  /** (AI-29) Field Menders take an anti-armour squad aboard. */
  menderLoad: boolean;
  /** (AI-29) The share of its health below which a tank falls back to a Field Mender. */
  menderFallbackAt: number;
  /** (AI-36, AI-37) An overwhelmed group retreats to friendly strength, fighting when it cannot outrun; off: the old retreat tests (AI-8, AI-34). */
  overwhelm: boolean;
  /** (AI-38) A beaten wave regroups at its fallback point, the next one waiting for the strength that beat it; off: a 1200-tick cooldown. */
  regroup: boolean;
  /** (AI-39, AI-40) Harassers are chased only by units that can catch them, else pushed as one body; off: no such answer. */
  harass: boolean;
  /** (AI-41, AI-42) The army holds a ball and meets a near enemy in a concave; off: neither. */
  formation: boolean;
  /** (AI-31) Against mostly heavy armour, a strike group goes for the enemy economy whenever the enemy's armour is away from its base. */
  ballRaid: boolean;
  /** (AI-31) The largest share of the army's value that strike group may take. */
  ballRaidShare: number;
  /** (AI-33) Against mostly heavy armour, Vrax keeps a few Brutes beside its Skimmers to screen them. */
  screen: boolean;
  /** (AI-21) Two standing scouts: one tours the enemy base, the other watches the way between the bases; off: one. */
  twoScouts: boolean;
  /** (AI-21) How far along the way from its staging point to the enemy start the second scout's post lies. */
  picketAlong: number;
  /** (AI-34) Its standing units answer an attack as a group; off: each hit unit retaliates alone (the simulation's own rule). */
  groupResponse: boolean;
  /** (AI-43, AI-44) Ideal hauler counts per mined field and the building crawl to new fields; off: three haulers a refinery, at most eight, and a third refinery at most (AI-18). */
  expand: boolean;
  xSpeed: boolean;
  xCover: boolean;
  xLeash: boolean;
  xGather: boolean;
  xFallback: boolean;
  xChasers: boolean;
  xSight: boolean;
  xClose: boolean;
}

export const DEFAULT_RULES: Readonly<AiRules> = {
  wavePeak: true,
  noFeed: true,
  recall: true,
  stalemate: true,
  raidGuard: true,
  queueDepth: QUEUE_SHALLOW,
  queueDepthRich: QUEUE_DEEP,
  artilleryCap: ARTILLERY_IN_PRODUCTION,
  scatter: true,
  doomGrowth: true,
  approach: true,
  raidSplit: true,
  strikeGroup: true,
  approachFlank: APPROACH_FLANK,
  strikeShare: STRIKE_SHARE,
  splitRatio: SPLIT_RATIO,
  skimmers: true,
  skimAt: MOSTLY_HEAVY,
  menders: true,
  menderFallback: true,
  menderLoad: true,
  menderFallbackAt: MENDER_FALLBACK,
  overwhelm: true,
  regroup: true,
  harass: true,
  formation: true,
  ballRaid: false,
  ballRaidShare: BALL_RAID_SHARE,
  screen: false,
  twoScouts: false,
  picketAlong: PICKET_ALONG,
  groupResponse: true,
  expand: true,
  xSpeed: true,
  xCover: true,
  xLeash: true,
  xGather: true,
  xFallback: true,
  xChasers: true,
  xSight: true,
  xClose: true,
};

/** Its infantry squads within SCATTER_R tiles of an enemy crusher it sees scatter (AI-24), each at most once in SCATTER_GAP ticks. */
export const SCATTER_R = 3;
export const SCATTER_GAP = 40;

/** Intel freshness (AI-21) is counted from this tick: how often a sighting of an armed enemy unit is at most INTEL_FRESH ticks old. */
export const INTEL_FROM = 20 * 60 * 5;
export const INTEL_FRESH = 20 * 60;

/**
 * Hooks that change what an AI builds, trains and when it attacks. Every ordinary AI uses none of them (its own rules
 * apply); only the harness's steamroll opponent (HAR-5, steamroll.ts) sets them.
 */
export interface Doctrine {
  /** Whether it may train this unit kind. */
  trains(kind: string): boolean;
  /** Its own build order: the structure it wants next, given how many of each kind it has or has queued. */
  structure?(have: (kind: string) => number): string | null;
  /** The unit a production building trains next, from those it may train there; null trains nothing. */
  pick?(building: string, allowed: readonly string[], haulersWanted: number): string | null;
  /** How many haulers it wants, given the AI's own number. */
  haulers?(standard: number): number;
  /** Where a structure goes: how far from the HQ it may stand, and a point it should be built toward (a building crawl). */
  place?(kind: string): { reach: number; toward?: { x: number; y: number } } | undefined;
  /** Whether its army, of this value (credits) and with this many crushers, sets out now; replaces the AI's own attack rule, and the whole army goes. */
  launch?(value: number, crushers: number): boolean;
  /** How deep its unit queues may be, given its bank; the steamroll opponent's own depth when absent. */
  depth?(credits: number): number;
  /** Whether it sends out a scout. */
  scouts: boolean;
  /** Whether it pulls a beaten wave back to the staging point, or calls it home to defend the base. */
  retreats: boolean;
}

const FULL_DOCTRINE: Doctrine = { trains: () => true, scouts: true, retreats: true };

/** What a group's turn needs from attackLogic (AI-11, AI-27): its order helper, the army's value and whether the base is in danger, found once a turn. */
type Drive = {
  out: Command[];
  order: (type: 'move' | 'attackmove', units: UnitSnap[], x: number, y: number) => void;
  centre: (us: UnitSnap[]) => { x: number; y: number };
  own: number;
  ordinary: boolean;
  danger: boolean | undefined;
};

type Ctx = {
  snap: Snapshot;
  tick: number;
  own: UnitSnap[];
  foes: UnitSnap[];
  buildings: BuildingSnap[];
  enemyBuildings: BuildingSnap[];
  hq: BuildingSnap;
  credits: number;
  powerOut: number;
  powerIn: number;
  counts: Map<string, number>;
  army: UnitSnap[];
  haulers: UnitSnap[];
  /**
   * Its whole army for counting (AI-29): `army` as it was before squads boarding a Field Mender and tanks falling back
   * to one were taken out of it for orders, plus the squads riding in its Menders.
   */
  strength: UnitSnap[];
  /** The squads riding in its Field Menders, placed at their carriers (AI-29): they fight with the army the Menders follow. */
  riders: UnitSnap[];
};

/**
 * An ordinary client of the simulation: it sees only its own fog-limited snapshot plus the static map
 * and answers with ordinary commands. Nothing here reads hidden state.
 */
export class AI {
  readonly kit: Kit;
  protected readonly doctrine: Doctrine = FULL_DOCTRINE;
  readonly stats: AiStats = { waves: 0, retreats: 0, suicides: 0, lone: 0, scoutedAt: -1, defends: 0, superweaponShots: 0, firstWaveAt: -1, earlyWaves: 0, economyWaves: 0, superweaponAt: -1, strikeAt: -1, strikeArrival: -1, labAt: -1, produced: { inf: 0, at: 0, tank: 0, art: 0, air: 0, scout: 0, hero: 0 }, superweaponOrder: null, scoutsLost: 0, scoutLifetimes: [], scoutingSince: [], intelThinks: 0, intelFresh: 0, standingLives: [], standingSince: -1, approaches: { straight: 0, left: 0, right: 0 }, approachLog: [], splitRaids: 0, strikeGroups: 0, raiderScouts: 0, ballRaids: 0, counters: 0, withdrawals: 0, regroups: 0, fightingRetreats: 0, harassResponses: { chase: 0, push: 0, fallBack: 0, hold: 0 }, strikeNotes: [] };
  /** Its Field Menders (AI-29): loading, following, fallback and unloading. */
  protected readonly menders: MenderPlan;
  /** Raider or Doomsday has abandoned its plan and plays as Balanced (AI-16). */
  private adapted = false;
  private raidsLost = 0;
  /** Doomsday: when the superweapon was first seen charged, and where it struck. */
  private chargedAt = -1;
  private strike: { tx: number; ty: number } | null = null;
  private lastStrike = -1;
  private strikeNoted = false;
  /** Doomsday holding a charged strike: its wave's nearest approach to its objective so far, and when it last closed in (AI-15). */
  private closest = Infinity;
  private closingAt = -1;
  /** Orders that must not be cut by the command budget this tick. */
  private first: Command[] = [];
  private intel = new Map<number, Remembered>();
  private wave: Wave | null = null;
  /** Strike groups out (AI-27): the two squads of a split raid, or the strike group sent beside a main wave. */
  private squads: Wave[] = [];
  /** A split raid (AI-27 a): whether a squad of it was beaten back, or called home, before both ended. */
  private splitBeaten = false;
  private splitRecalled = false;
  /** The approach its last main wave chose (AI-26), and its turn through them while it has seen no enemy army. */
  private lastApproach: Approach | null = null;
  private approachTurn: number;
  /** Raider's scout units in its army, beyond its standing scout (AI-27 a), and standing scouts ordered, not yet out. */
  private armyScouts = new Set<number>();
  private standingOrdered = 0;
  private waveCooldown = 0;
  /** When the army was first strong enough to attack but not yet gathered, or -1. */
  private gatherSince = -1;
  private scoutId = -1;
  private lastScout = -100000;
  /** The scout's route (AI-17): a flank point first, then the enemy start; trips alternate flanks. */
  private scoutRoute: { tx: number; ty: number }[] = [];
  private scoutTrips = 0;
  /** The standing scout (AI-21): its unit or -1, when the last one was lost, where it is going and how far round its tour. */
  private standing = -1;
  private standingLostAt = -100000;
  /** Ticks after a loss before the next one is ordered: SCOUT_REPLACE, doubled after a young scout's loss (AI-21). */
  private replaceGap = SCOUT_REPLACE;
  /** Its tour (AI-21): the points, which one it heads for and which way round it goes; the side flips after each loss. */
  private tour: { tx: number; ty: number }[] = [];
  private tourIdx = 1;
  private tourDir = 1;
  private tourSide = 1;
  private scoutGoal: { tx: number; ty: number } | null = null;
  private scoutHop: { tx: number; ty: number } | null = null;
  private fleeing: { tx: number; ty: number } | null = null;
  /** Its way to its goal, as tiles, kept while it stays open; goals it found no way to lately, until when. */
  private way: number[] | null = null;
  /** Until when it does not search again after finding no way anywhere (AI-21). */
  private waysFailed = -1;
  private searchBuf: { cost: Float64Array; prev: Int32Array; done: Uint8Array; heap: Int32Array; key: Float64Array } | undefined;
  private standingKind: string | null | undefined;
  /** Units scouting now and the tick each set out, for the statistics only (AI-21). */
  private scouting = new Map<number, number>();
  /** Tick it last saw an armed enemy unit, or -1 (AI-21). */
  private lastArmedSeen = -1;
  private defend = { tick: -1000, x: 0, y: 0 };
  private lastThreat = -100000;
  private idle = new Map<number, { x: number; y: number; n: number }>();
  private staging: { tx: number; ty: number } | null = null;
  private home: { tx: number; ty: number } | null = null;
  /** The map's shard fields, its two home fields first (AI-18), and which field each hauler works. */
  private fields: ShardField[] = [];
  private haulerField = new Map<number, number>();
  private lastRebalance = -1000;
  /** Each field's shards at the start (AI-44), by its index in `fields`. */
  private fieldStart: number[] = [];
  /** The economy plan worked out this decision (AI-43, AI-44), the field it crawls to (an index in `fields`, or -1), and whether its second factory has stood. */
  private expandPlan: { tick: number; mined: MinedField[]; want: number; target: ShardField | null; reachable: boolean } | null = null;
  private crawlTo = -1;
  private rampDone = false;
  /** The exact centre of our HQ, in tiles; on a point-symmetric map the two players' centres mirror exactly. */
  private centre: { x: number; y: number } = { x: 0, y: 0 };
  private attacks = 0;
  private lastWaveEnd = 0;
  /** Tick its last wave set out (AI-23: the stalemate rule); the start of the game until one has. */
  private lastWaveAt = 0;
  /** Where it last called a wave home to (AI-23 c), for tests only. */
  private recallPoint: { tx: number; ty: number } | null = null;
  /** Seeded personality so repeated games differ a little: attack timing, staging distance. */
  private readonly jitter: { wave: number; ratio: number; stage: number };
  /** Its rules (AiRules): DEFAULT_RULES with the options' changes. */
  readonly rules: Readonly<AiRules>;
  /** The tick each of its squads was last told to scatter from a crusher (AI-24). */
  private scattered = new Map<number, number>();
  /** Its groups retreating (AI-37), the enemy units that kited lately (AI-39), and this decision's concave orders (AI-42). */
  private retreats: Retreat[] = [];
  private readonly kites = new KiteWatch();
  private form: { off: number; cmd: Command }[] = [];
  private formations: Formation[] = [];
  /** The strength that beat its last wave, and when (AI-38); where its army regroups until the next wave sets out. */
  private beatenBy: { power: number; tick: number } | null = null;
  private regroupAt: { tx: number; ty: number } | null = null;
  /** Its cover from harassers (AI-40): where its army gathers while they are about, and when it last saw one near there. */
  private cover: { tx: number; ty: number; seen: number } | null = null;
  /** When the base defence last fought a threat that was no harassment (AI-7): the leash does not hold it back then. */
  private fighting = -100000;
  /** When it last pulled stragglers back into the ball at the gathering point (AI-41). */
  private lastBall = -1000;
  /** When its last strike group went for the economy while the enemy's armour was away (AI-31). */
  private ballRaidAt = -100000;
  /** Its second standing scout (AI-21), watching the way between the bases: its unit or -1, when it stood, and where it flees to. */
  private picket = -1;
  private picketSince = -1;
  private picketFleeing: { tx: number; ty: number } | null = null;
  private picketHop: { tx: number; ty: number } | null = null;
  private picketAt: { x: number; y: number } | null = null;
  /** Its units' health at its last decision, and its groups answering an attack (AI-34). */
  private lastHp = new Map<number, number>();
  private responses: Response[] = [];

  constructor(
    readonly player: number,
    readonly faction: Faction,
    readonly diff: Difficulty,
    private map: MapDef,
    seed = 0,
    readonly personality: Personality = 'balanced',
    readonly options: Readonly<AiOptions> = {},
  ) {
    this.kit = kitOf(faction);
    this.menders = new MenderPlan(player, menderOf(faction));
    const r = new Rng(seed * 7919 + player * 104729 + 13);
    const f = (): number => r.int(1000) / 1000;
    this.jitter = { wave: 0.9 + 0.35 * f(), ratio: 1.15 + 0.3 * f(), stage: 11 + Math.floor(4 * f()) };
    // Where its turn through the approaches starts (AI-26): drawn after the jitter, so the jitter is what it was.
    this.approachTurn = r.int(APPROACHES.length);
    this.rules = { ...DEFAULT_RULES, ...options.rules };
    setCatchByEffectiveSpeed(this.rules.xSpeed);
  }

  /** Decide this tick's orders from a fog-limited snapshot. */
  think(snap: Snapshot): Command[] {
    const me = this.player;
    const buildings = snap.buildings.filter((b) => b.owner === me);
    const hq = buildings.find((b) => buildingDef(b.kind).hq);
    const pl = snap.players[me];
    if (!hq || !pl || !snap.fog) return [];
    const own = snap.units.filter((u) => u.owner === me);
    const foes = snap.units.filter((u) => u.owner !== me);
    const counts = new Map<string, number>();
    for (const b of buildings) counts.set(b.kind, (counts.get(b.kind) ?? 0) + 1);
    for (const q of hq.queue) counts.set(q.kind, (counts.get(q.kind) ?? 0) + 1);
    const haulers = own.filter((u) => unitDef(u.kind).capacity !== undefined);
    this.keepStanding(own, snap.tick);
    // The scouts are not part of the army: no wave, gathering or defence order takes them (AI-17, AI-21).
    const army = own.filter((u) => unitDef(u.kind).weapon && unitDef(u.kind).capacity === undefined && u.id !== this.scoutId && u.id !== this.standing && u.id !== this.picket);
    const c: Ctx = {
      snap, tick: snap.tick, own, foes, buildings,
      enemyBuildings: [...snap.buildings.filter((b) => b.owner !== me), ...snap.ghosts],
      hq, credits: pl.credits, powerOut: pl.powerOut, powerIn: pl.powerIn, counts, army, haulers, strength: [...army], riders: [],
    };
    this.updateIntel(c);
    this.scoutBook(c);
    this.setupPoints(c);
    this.updatePlan(c);

    // The Field Menders (AI-29): squads on their way to board and tanks falling back leave the army for this turn; their
    // orders go first, a share of the budget at most.
    const mend = this.menders.turn(c.tick, own, foes, c.army, snap.mapWidth, this.doctrine.retreats && this.rules.menderFallback, this.rules.menderLoad, this.rules.menderFallbackAt);
    if (mend.busy.size > 0) c.army = c.army.filter((u) => !mend.busy.has(u.id));
    // Those still count as its strength, and so do the squads riding in its Menders (gone from its snapshot's units):
    // what it trains and when it feels strong must not change because some of its army is aboard or being mended.
    for (const u of own) {
      if (!u.cargo) continue;
      const rider = { ...u, id: u.cargo.id, kind: u.cargo.kind, hp: u.cargo.hp, rank: u.cargo.rank, cargo: undefined, mend: undefined };
      c.strength.push(rider);
      c.riders.push(rider);
    }
    const out: Command[] = [...mend.orders.slice(0, Math.max(1, Math.floor(this.diff.maxCommands / 4)))];
    this.form = [];
    // Which enemy units kited lately (AI-39), from where they are now and were at its last decision.
    this.kites.see(c.tick, foes, c.army);
    // Its groups retreating to friendly strength (AI-37) leave the army until they get there; their squads still scatter
    // from crushers (AI-24).
    const scatterable = c.army;
    this.driveRetreats(c, out);
    this.placeReady(c, out);
    this.defendBase(c, out);
    // Its standing units answer an attack as a group (AI-34); the base defence above takes precedence.
    this.respond(c, out);
    // Scouting goes ahead of building and production in the command budget, or the scout is rarely sent (AI-6, AI-17).
    this.scout(c, out);
    this.structures(c, out);
    this.production(c, out);
    this.economy(c, out);
    // Units answering an attack (AI-34) take no wave, gathering or reinforcement orders meanwhile.
    const whole = c.army;
    if (this.responses.length > 0) {
      const answering = new Set(this.responses.flatMap((r) => [...r.members]));
      c.army = c.army.filter((u) => !answering.has(u.id));
    }
    this.attackLogic(c, out);
    c.army = whole;
    if (this.rules.xLeash) this.leash(c, out);
    this.maintain(c, out);
    this.superweapon(c, out);
    // Crush orders go last so they override this tick's wave orders for the same units, and always get a share of the
    // command budget (BAL-5).
    // Scatter orders (AI-24) come out of the same share, ahead of them.
    const share = Math.max(1, Math.ceil(this.diff.maxCommands / 2));
    const crush = [...this.scatterOrders(c, scatterable), ...crushOrders(me, c.army, c.foes, snap.mapWidth, snap.mapHeight)].slice(0, share);
    for (const o of crush) if (o.type === 'scatter') for (const id of o.units) this.scattered.set(id, c.tick);
    // Doomsday's strike and the order sending its wave into it go first, ahead of everything else (AI-15).
    const first = this.first.splice(0);
    // Concave orders (AI-42), farthest off first, out of their own share of the budget.
    this.refreshFormations(c);
    const form = this.form
      .sort((a, b) => b.off - a.off)
      .slice(0, this.formShare())
      .map((f) => f.cmd);
    return [...first, ...form, ...out.slice(0, Math.max(0, this.diff.maxCommands - crush.length - first.length - form.length)), ...crush];
  }

  /** Concave orders one decision may give (AI-42): a third of its orders; none with a budget of two, which cannot afford one. */
  private formShare(): number {
    return this.rules.formation && this.doctrine.retreats ? Math.floor(this.diff.maxCommands / 3) : 0;
  }

  /** The middle of some units, in tiles. */
  private middle(us: readonly { x: number; y: number }[]): { x: number; y: number } {
    return { x: us.reduce((s, u) => s + u.x, 0) / us.length / FP, y: us.reduce((s, u) => s + u.y, 0) / us.length / FP };
  }

  /** The armed enemy units it sees within `r` tiles of a point (tiles). */
  private armedNear(c: Ctx, x: number, y: number, r: number): UnitSnap[] {
    return c.foes.filter((f) => unitDef(f.kind).weapon && unitDef(f.kind).capacity === undefined && dist(f.x / FP, f.y / FP, x, y) <= r);
  }

  /**
   * The known enemy force near a point (AI-42): the cost-weighted middle of the armed enemy units seen within FRESH_SIGHT
   * ticks and of the armed enemy buildings within `r` tiles of it; null when there is none.
   */
  private enemyFocus(c: Ctx, x: number, y: number, r = CONCAVE_R): { x: number; y: number } | null {
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (const e of this.intel.values()) {
      const d = UNIT_DEFS[e.kind];
      if (!d?.weapon || d.capacity !== undefined || c.tick - e.t > FRESH_SIGHT) continue;
      const ex = e.x / FP;
      const ey = e.y / FP;
      if (dist(ex, ey, x, y) > r) continue;
      sx += ex * d.cost;
      sy += ey * d.cost;
      sw += d.cost;
    }
    for (const b of c.enemyBuildings) {
      const d = buildingDef(b.kind);
      if (!d.weapon || edgeDist(b, x, y) > r) continue;
      sx += (b.tx + d.w / 2) * d.cost;
      sy += (b.ty + d.h / 2) * d.cost;
      sw += d.cost;
    }
    return sw > 0 ? { x: sx / sw, y: sy / sw } : null;
  }

  /**
   * The concave (AI-42): these units take their slots, the front row at the anchor facing the enemy, for the next ttl ticks.
   * Now, those of them off their slots and not given one this decision get one order toward the anchor, so none keeps a
   * stale order; at this and every decision until then (refreshFormations) the units off their slots are sent to them,
   * farthest off first, out of the concave's share of the budget. False, and no orders, when it cannot form one
   * (formation off, no share of the budget, or fewer than two units): the caller gives its usual order instead.
   */
  private formUp(c: Ctx, units: readonly UnitSnap[], anchor: { x: number; y: number }, facing: { x: number; y: number }, type: 'move' | 'attackmove', ttl: number): boolean {
    const share = this.formShare();
    if (share === 0 || units.length < 2) return false;
    const ids = new Set(units.map((u) => u.id));
    this.formations = this.formations.filter((f) => !f.ids.some((id) => ids.has(id)));
    const f = { ids: [...ids], anchor: { ...anchor }, facing: { ...facing }, type, until: c.tick + ttl };
    this.formations.push(f);
    // Those off their slots that the budget leaves out this time go toward the anchor in one order.
    const rest = this.slotOrders(c, f, units, true);
    if (rest.length > 0) this.form.push({ off: Infinity, cmd: { type, player: this.player, units: rest, x: Math.floor(anchor.x) * FP + FP / 2, y: Math.floor(anchor.y) * FP + FP / 2 } });
    return true;
  }

  /** Slot orders for a concave's units off their slots (AI-42), out of its share of the budget; the units off their slots left out. */
  private slotOrders(c: Ctx, f: Formation, units: readonly UnitSnap[], reserve = false): number[] {
    const W = this.map.width;
    const H = this.map.height;
    const open = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < W && ty < H && !this.map.blocked?.[ty * W + tx];
    const fu = units.map((u) => ({ id: u.id, kind: u.kind, x: u.x / FP, y: u.y / FP, dest: u.dest, target: u.target }));
    const slots = concaveSlots(fu, f.anchor, f.facing, open);
    const moves = slotMoves(fu, slots, Infinity);
    // With more than its share off their slots, one order is kept for the rest (reserve).
    const share = reserve && moves.length > this.formShare() ? this.formShare() - 1 : this.formShare();
    for (const m of moves.slice(0, share)) this.form.push({ off: m.off, cmd: { type: f.type, player: this.player, units: [m.id], x: m.tx * FP + FP / 2, y: m.ty * FP + FP / 2 } });
    return moves.slice(share).map((m) => m.id);
  }

  /** The concaves still held (AI-42) that no group re-formed this decision: their units off their slots are sent to them. */
  private refreshFormations(c: Ctx): void {
    this.formations = this.formations.filter((f) => f.until > c.tick);
    const touched = new Set(this.form.flatMap((x) => (x.cmd.type === 'move' || x.cmd.type === 'attackmove' ? x.cmd.units : [])));
    for (const f of this.formations) {
      if (f.ids.some((id) => touched.has(id))) continue;
      const units = c.own.filter((u) => f.ids.includes(u.id));
      if (units.length >= 2) this.slotOrders(c, f, units);
    }
  }

  /**
   * Where a group retreats to (AI-37): the nearest friendly strength, by chooseFallback. The staging point counts while
   * reinforcements (army units not out, retreating or in the group) or Field Menders stand within GATHER_R of it; each of
   * its defences offers a spot behind it, away from the enemy (toward the headquarters when no enemy is known), by
   * DEFENCE_BEHIND tiles; against harassers that out-range the defence (reach: their longest gun), far enough that a
   * harasser shooting at the group's front stands inside the defence's reach (AI-40). The base is its hold point (AI-23).
   * With defenceOnly, only a defence is taken.
   */
  private fallbackFor(c: Ctx, group: readonly UnitSnap[], enemy: { x: number; y: number } | null, lastResort: boolean, o: { defenceOnly?: boolean; reach?: number } = {}): { at: { x: number; y: number }; kind: FallbackKind } | null {
    const ids = new Set(group.map((u) => u.id));
    const out = new Set([...(this.wave ? [...this.wave.members] : []), ...this.squads.flatMap((s) => [...s.members])]);
    const stage = this.staging as { tx: number; ty: number };
    const mender = menderOf(this.faction);
    const near = (u: UnitSnap): boolean => dist(u.x / FP, u.y / FP, stage.tx + 0.5, stage.ty + 0.5) <= GATHER_R;
    const gathering = c.army.some((u) => !ids.has(u.id) && !out.has(u.id) && near(u)) || c.own.some((u) => u.kind === mender && near(u));
    const defences = c.buildings
      .filter((b) => buildingDef(b.kind).weapon)
      .sort((a, b) => a.id - b.id)
      .map((b) => {
        const d = buildingDef(b.kind);
        const bx = b.tx + d.w / 2;
        const by = b.ty + d.h / 2;
        const from = (this.rules.xFallback ? enemy : null) ?? { x: 2 * bx - this.centre.x, y: 2 * by - this.centre.y };
        const l = dist(bx, by, from.x, from.y) || 1;
        const back = Math.max(DEFENCE_BEHIND, (o.reach ?? 0) - (d.weapon?.range ?? 0) + HARASS_BEHIND);
        const t = this.nearestFree(Math.floor(bx + (back * (bx - from.x)) / l), Math.floor(by + (back * (by - from.y)) / l));
        return { x: t.tx + 0.5, y: t.ty + 0.5 };
      });
    const hold = this.holdPoint(c);
    if (o.defenceOnly) {
      const f = chooseFallback(this.middle(group), enemy, { staging: null, defences, base: { x: -1000, y: -1000 } });
      return f?.kind === 'defence' ? f : null;
    }
    return chooseFallback(this.middle(group), enemy, { staging: gathering ? { x: stage.tx + 0.5, y: stage.ty + 0.5 } : null, defences, base: { x: hold.tx + 0.5, y: hold.ty + 0.5 }, lastResort });
  }

  /**
   * A group retreats to friendly strength (AI-37): when its slowest unit is faster than the fastest of the armed enemies
   * within HARASS_R tiles that carry most of their power (or it sees none), or when run is set (harassers it cannot hurt,
   * AI-40), it runs there with a plain move; otherwise it makes a fighting retreat in hops.
   */
  private startRetreat(c: Ctx, group: readonly UnitSnap[], to: { at: { x: number; y: number }; kind: FallbackKind }, out: Command[], run = false): void {
    const m = this.middle(group);
    // The pursuers that matter carry most of the enemy's power near it: fast light units alone are swatted on arrival.
    const chasers = this.rules.xChasers ? mainUnits(this.armedNear(c, m.x, m.y, HARASS_R)) : this.armedNear(c, m.x, m.y, HARASS_R);
    const ids = group.map((u) => u.id);
    const r: Retreat = { members: new Set(ids), to: { ...to.at }, kind: to.kind, fight: null, since: c.tick };
    let p = to.at;
    // Pursuers not yet within their reach of it: it runs while it can (AI-37).
    const close = chasers.some((f) => group.some((u) => Math.hypot(f.x - u.x, f.y - u.y) <= (reachOf(f.kind) + RETREAT_CLEAR_R) * FP));
    if (!run && (close || !this.rules.xClose) && chasers.length > 0 && !canOutrun(group, chasers)) {
      p = toward(m, to.at, RETREAT_HOP);
      r.fight = { phase: 'hop', since: c.tick, hop: p, lastNear: c.tick };
      this.stats.fightingRetreats++;
    }
    out.push({ type: 'move', player: this.player, units: ids, x: Math.floor(p.x) * FP + FP / 2, y: Math.floor(p.y) * FP + FP / 2 });
    this.retreats.push(r);
  }

  /**
   * Its groups retreating (AI-37), each decision. One that runs ends once it has been away RETREAT_STAY ticks and has got
   * there (or three times as long). A fighting retreat hops toward its fallback point and holds its concave between hops,
   * facing the enemy, until it gets there or no enemy has been within its units' reach + RETREAT_CLEAR_R tiles for
   * RETREAT_CLEAR ticks (retreatStep). Their units leave the army meanwhile.
   */
  private driveRetreats(c: Ctx, out: Command[]): void {
    if (this.retreats.length === 0) return;
    const byId = new Map(c.army.map((u) => [u.id, u]));
    for (const r of [...this.retreats]) {
      const members = [...r.members].map((id) => byId.get(id)).filter((u): u is UnitSnap => u !== undefined);
      r.members = new Set(members.map((u) => u.id));
      const drop = (): void => {
        this.retreats = this.retreats.filter((x) => x !== r);
      };
      if (members.length === 0) {
        drop();
        continue;
      }
      const m = this.middle(members);
      if (!r.fight) {
        const away = c.tick - r.since;
        if (away >= 3 * RETREAT_STAY || (away >= RETREAT_STAY && dist(m.x, m.y, r.to.x, r.to.y) <= RETREAT_ARRIVED + 1)) drop();
        continue;
      }
      const near = c.foes.some((f) => unitDef(f.kind).weapon && members.some((u) => Math.hypot(f.x - u.x, f.y - u.y) <= ((unitDef(u.kind).weapon?.range ?? 0) + RETREAT_CLEAR_R) * FP));
      const step = retreatStep(r.fight, c.tick, m, r.to, near, this.rules.xClose);
      if (step === null) continue;
      if (step.act === 'done') drop();
      else if (step.act === 'hop') out.push({ type: 'move', player: this.player, units: members.map((u) => u.id), x: Math.floor(step.to.x) * FP + FP / 2, y: Math.floor(step.to.y) * FP + FP / 2 });
      else this.formUp(c, members, m, this.enemyFocus(c, m.x, m.y) ?? { x: 2 * m.x - r.to.x, y: 2 * m.y - r.to.y }, 'move', RETREAT_HOLD);
    }
    const away = new Set(this.retreats.flatMap((r) => [...r.members]));
    if (away.size > 0) c.army = c.army.filter((u) => !away.has(u.id));
  }

  /** Its groups retreating (AI-37): units, fallback point and kind, and whether it is a fighting retreat: for tests only. */
  get retreatState(): { members: readonly number[]; to: { x: number; y: number }; kind: FallbackKind; fighting: boolean }[] {
    return this.retreats.map((r) => ({ members: [...r.members], to: { ...r.to }, kind: r.kind, fighting: r.fight !== null }));
  }

  /** Where its army regroups after a beaten wave, and the strength that beat it as it remembers it now (AI-38), or null: for tests only. */
  regroupState(tick: number): { at: { tx: number; ty: number } | null; power: number } | null {
    const b = this.beatenBy;
    return b ? { at: this.regroupAt, power: b.power * Math.max(0, 1 - (tick - b.tick) / BEATEN_MEMORY) } : null;
  }

  /**
   * Its standing units answer an attack as a group (AI-34). A unit of its army not out on a wave, raid or strike group (nor
   * retreating, nor busy with a Field Mender, AI-29) that has less health than at its last decision has been hit. With the
   * armed enemy units it sees within RESPONSE_R tiles of the hit units (the attackers) and its other such units within
   * RESPONSE_R tiles of them (the group), it judges the fight (judge):
   * - overwhelmed (AI-36): the group retreats to friendly strength (AI-37);
   * - harassers (AI-39): the units that can catch them chase, or the group pushes toward them as one body (AI-40);
   * - otherwise the whole group attack-moves to the attackers' middle.
   * A counter-attack is renewed every RESPONSE_STEP ticks toward the attackers it still sees within RESPONSE_R tiles of
   * its units, never beyond RESPONSE_LEASH tiles from where the group stood (judged anew); it ends, and the group moves
   * back to where it stood, when it sees no attacker so near, when its middle is more than RESPONSE_LEASH tiles from there,
   * or after RESPONSE_MAX ticks. An answer to harassers is held to HARASS_LEASH and HARASS_PATIENCE ticks instead; at the
   * end of those, with the harassers still near and the group weaker than when it began, it falls back (AI-40). While the
   * base defence (AI-7) answers a threat near its buildings, no group answers.
   */
  private respond(c: Ctx, out: Command[]): void {
    const before = this.lastHp;
    this.lastHp = new Map(c.own.map((u) => [u.id, u.hp]));
    if (!this.rules.groupResponse || !this.doctrine.retreats || this.lastThreat === c.tick) {
      this.responses = [];
      return;
    }
    const byId = new Map(c.army.map((u) => [u.id, u]));
    const armed = c.foes.filter((f) => unitDef(f.kind).weapon && unitDef(f.kind).capacity === undefined);
    const at = (u: UnitSnap): { x: number; y: number } => ({ x: u.x / FP, y: u.y / FP });
    const within = (us: readonly UnitSnap[]): UnitSnap[] => armed.filter((f) => us.some((u) => dist(f.x / FP, f.y / FP, at(u).x, at(u).y) <= RESPONSE_R));
    const order = (type: 'move' | 'attackmove', ids: readonly number[], p: { x: number; y: number }): void => {
      if (ids.length > 0) out.push({ type, player: this.player, units: [...ids], x: Math.floor(p.x) * FP + FP / 2, y: Math.floor(p.y) * FP + FP / 2 });
    };
    const committed = new Set([...(this.wave ? [...this.wave.members] : []), ...this.squads.flatMap((s) => [...s.members])]);
    /** Carry out a judgement; false when the group retreats instead (and is no longer a response). */
    const act = (members: readonly UnitSnap[], j: Judgement, home: { x: number; y: number }, fresh: boolean): boolean => {
      // Driven onto its defences by harassers, its army gathers there, not back out at the staging point (AI-38, AI-40).
      if (j.mode === 'hold') this.takeCover(c, j.to);
      if (j.mode === 'retreat' && j.run) this.takeCover(c, j.to.at);
      if (j.mode === 'retreat') {
        this.startRetreat(c, members, j.to, out, j.run);
        return false;
      }
      if (j.mode === 'hold') {
        // Under cover of its defences: it holds there, facing the harassers, so they must come into the defences' reach.
        if (!this.formUp(c, members, j.to, j.foe, 'move', RESPONSE_STEP)) order('move', members.map((u) => u.id), j.to);
        return true;
      }
      if (j.mode === 'chase') {
        const ch = new Set(j.chasers.map((u) => u.id));
        order('attackmove', [...ch], j.to);
        // The rest close up where the group stood; no single unit goes after them (AI-40).
        if (fresh) order('move', members.filter((u) => !ch.has(u.id)).map((u) => u.id), home);
      } else if (j.mode === 'push') {
        if (!this.formUp(c, members, j.to, j.foe, 'attackmove', RESPONSE_STEP)) order('attackmove', members.map((u) => u.id), j.to);
      } else order('attackmove', members.map((u) => u.id), j.to);
      return true;
    };
    // Groups already answering.
    for (const r of [...this.responses]) {
      const members = [...r.members].map((id) => byId.get(id)).filter((u): u is UnitSnap => u !== undefined && !committed.has(u.id));
      r.members = new Set(members.map((u) => u.id));
      const drop = (): void => {
        this.responses = this.responses.filter((x) => x !== r);
      };
      if (members.length === 0) {
        drop();
        continue;
      }
      const m = this.middle(members);
      const harassed = r.mode !== 'counter';
      const foes = harassed ? this.armedNear(c, m.x, m.y, HARASS_R) : within(members);
      if (harassed && r.mode !== 'hold' && foes.length > 0 && c.tick - r.since >= HARASS_PATIENCE && this.armyPower(members) < r.start) {
        // Not pushed off in time, and still losing: it falls back onto friendly strength (AI-40, AI-37).
        drop();
        this.stats.harassResponses.fallBack++;
        const to = this.fallbackFor(c, members, this.middle(foes), true);
        if (to) this.startRetreat(c, members, to, out);
        continue;
      }
      if (foes.length === 0 || dist(m.x, m.y, r.home.x, r.home.y) > (harassed ? HARASS_LEASH : RESPONSE_LEASH) || c.tick - r.since >= (harassed ? HARASS_PATIENCE : RESPONSE_MAX)) {
        order('move', [...r.members], r.home);
        drop();
        continue;
      }
      if (c.tick - r.lastOrder < RESPONSE_STEP) continue;
      r.lastOrder = c.tick;
      const next = this.judge(c, members, foes, r.home);
      if (next.mode === 'retreat') {
        drop();
        if (next.run) this.stats.harassResponses.fallBack++;
        else this.stats.withdrawals++;
      } else {
        r.to = next.to;
        r.mode = next.mode;
      }
      act(members, next, r.home, false);
    }
    // Units newly hit.
    const busy = new Set([...committed, ...this.responses.flatMap((r) => [...r.members])]);
    const pool = c.army.filter((u) => !busy.has(u.id));
    const hit = pool.filter((u) => {
      const was = before.get(u.id);
      return was !== undefined && u.hp < was;
    });
    const taken = new Set<number>();
    for (const h of hit) {
      if (taken.has(h.id)) continue;
      const group = pool.filter((u) => !taken.has(u.id) && dist(at(u).x, at(u).y, at(h).x, at(h).y) <= RESPONSE_R);
      for (const u of group) taken.add(u.id);
      const attackers = within(group.filter((u) => hit.includes(u)));
      if (attackers.length === 0) continue;
      const home = this.middle(group);
      const j = this.judge(c, group, attackers, home, pool.filter((u) => !group.includes(u)));
      if (j.mode === 'retreat') {
        if (j.run) this.stats.harassResponses.fallBack++;
        else this.stats.withdrawals++;
      } else if (j.mode === 'counter') this.stats.counters++;
      else this.stats.harassResponses[j.mode]++;
      if (act(group, j, home, true) && j.mode !== 'retreat') this.responses.push({ mode: j.mode, start: this.armyPower(group), members: new Set(group.map((u) => u.id)), home, to: j.to, since: c.tick, lastOrder: c.tick });
    }
  }

  /** Where its standing army belongs (AI-40, AI-41): its cover from harassers, else where it regroups, else its staging point. */
  private anchor(c: Ctx): { x: number; y: number } {
    const a = this.coverAt(c) ?? this.regroupAt ?? (this.staging as { tx: number; ty: number });
    return { x: a.tx + 0.5, y: a.ty + 0.5 };
  }

  /**
   * The leash (AI-40): no unit of its standing army (not out on a wave or strike group, nor retreating) chases farther
   * than HARASS_LEASH + LEASH_SLACK tiles from where the army belongs (anchor); one that has, while fighting, is called
   * back. Not while the base defence fights a real attack (AI-7), which may take the army anywhere near its buildings.
   */
  private leash(c: Ctx, out: Command[]): void {
    if (!this.rules.harass || !this.doctrine.retreats || c.tick - this.fighting < 200) return;
    const a = this.anchor(c);
    const out2 = new Set([...(this.wave ? [...this.wave.members] : []), ...this.squads.flatMap((s) => [...s.members])]);
    const far = c.army.filter((u) => !out2.has(u.id) && u.target >= 0 && dist(u.x / FP, u.y / FP, a.x, a.y) > HARASS_LEASH + LEASH_SLACK);
    if (far.length === 0) return;
    const ids = new Set(far.map((u) => u.id));
    for (const r of this.responses) for (const id of ids) r.members.delete(id);
    this.responses = this.responses.filter((r) => r.members.size > 0);
    out.unshift({ type: 'move', player: this.player, units: [...ids], x: Math.floor(a.x) * FP + FP / 2, y: Math.floor(a.y) * FP + FP / 2 });
  }

  /** Its army gathers under its defences' cover while harassers are about (AI-40). */
  private takeCover(c: Ctx, at: { x: number; y: number }): void {
    this.cover = { tx: Math.floor(at.x), ty: Math.floor(at.y), seen: c.tick };
  }

  /**
   * Where its army gathers under cover (AI-40), or null: until no armed enemy has been within COVER_WATCH tiles of the
   * cover for COVER_CLEAR ticks, when it goes back to its usual gathering point.
   */
  private coverAt(c: Ctx): { tx: number; ty: number } | null {
    const k = this.cover;
    if (!k) return null;
    if (this.armedNear(c, k.tx + 0.5, k.ty + 0.5, COVER_WATCH).length > 0) k.seen = c.tick;
    if (c.tick - k.seen > COVER_CLEAR) this.cover = null;
    return this.cover;
  }

  /**
   * Cover from harassers (AI-40): the fallback spot (fallbackFor) of its defence nearest the group, behind it away from the
   * harassers by enough that one shooting at the group from its full reach stands inside the defence's; null without
   * defences, or when that spot lies nearer the harassers than the group.
   */
  private coverSpot(c: Ctx, g: { x: number; y: number }, foe: { x: number; y: number }, reach: number): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (const b of c.buildings) {
      const d = buildingDef(b.kind);
      if (!d.weapon) continue;
      const bx = b.tx + d.w / 2;
      const by = b.ty + d.h / 2;
      const l = dist(bx, by, foe.x, foe.y) || 1;
      const back = Math.max(DEFENCE_BEHIND, reach - d.weapon.range + HARASS_BEHIND);
      const t = this.nearestFree(Math.floor(bx + (back * (bx - foe.x)) / l), Math.floor(by + (back * (by - foe.y)) / l));
      const p = { x: t.tx + 0.5, y: t.ty + 0.5 };
      const pd = dist(p.x, p.y, g.x, g.y);
      if (pd < bd && dist(p.x, p.y, foe.x, foe.y) + COVER_R >= dist(g.x, g.y, foe.x, foe.y)) {
        bd = pd;
        best = p;
      }
    }
    return best;
  }

  /**
   * How a group of its standing units answers these attackers (AI-34, AI-36, AI-39, AI-40):
   * - overwhelmed (the enemy power within OVERWHELM_R tiles of its middle, seen lately, is at least 1.5 times its own
   *   plus its defences there): it retreats to friendly strength when it has some to go to (fallbackFor);
   * - the enemy near it (within HARASS_R tiles) is a harasser: its units that can catch them chase when they are strong
   *   enough, else it pushes toward them as one body; either way at most HARASS_LEASH tiles from where it stood;
   * - otherwise it counter-attacks toward the attackers' middle, at most RESPONSE_LEASH tiles from where it stood.
   * With rules.overwhelm off, it retreats as before AI-36: when the attackers are worth more than it, it can outrun them
   * and it has a refuge (refuge).
   */
  private judge(c: Ctx, group: readonly UnitSnap[], attackers: readonly UnitSnap[], home: { x: number; y: number }, rest?: readonly UnitSnap[]): Judgement {
    const g = this.middle(group);
    const a = this.middle(attackers);
    const mine = this.armyPower(group);
    if (this.rules.harass) {
      const near = this.armedNear(c, g.x, g.y, HARASS_R);
      const harasser = isHarasser(near, group, (id) => this.kites.kited(id, c.tick));
      // Guns that out-reach it and that it cannot catch are answered the same way whatever their strength (AI-40).
      if (harasser || (this.rules.xCover && outranges(near, group))) {
        const foe = this.middle(near);
        const h = harassAnswer(group, near);
        if (h.mode === 'chase') return { mode: 'chase', chasers: h.chasers, to: leashed(home, foe, HARASS_LEASH), foe };
        // It cannot catch them: onto its defences at once, so they must come into the defences' reach to keep shooting.
        const spot = this.coverSpot(c, g, foe, Math.max(...near.map((f) => reachOf(f.kind))));
        if (this.rules.xCover && spot && dist(g.x, g.y, spot.x, spot.y) <= COVER_R) return { mode: 'hold', to: spot, foe };
        if (this.rules.xCover && spot) return { mode: 'retreat', to: { at: spot, kind: 'defence' }, run: true };
        // A pushing body's concave bulges ahead of its front row's middle: that stands a little short of the leash.
        if (harasser) return { mode: 'push', to: leashed(home, foe, HARASS_LEASH - 2), foe };
      }
    }
    if (this.rules.overwhelm) {
      const enemy = freshEnemyPower(this.intel.values(), c.enemyBuildings, c.tick, g.x, g.y, OVERWHELM_R);
      if (isOverwhelmed(mine, defencePower(c.buildings, g.x, g.y, OVERWHELM_R), enemy)) {
        const to = this.fallbackFor(c, group, a, false);
        if (to) return { mode: 'retreat', to };
      }
    } else {
      const theirs = this.armyPower(attackers);
      if (theirs > mine && canOutrun(group, attackers)) {
        const to = this.refuge(c, group, a, theirs, rest);
        if (to) return { mode: 'retreat', to: { at: to, kind: 'base' } };
      }
    }
    return { mode: 'counter', to: leashed(home, a, RESPONSE_LEASH), foe: a };
  }

  /**
   * Where an outmatched group retreats to with rules.overwhelm off (AI-34 before AI-36): its hold point by its buildings
   * (AI-23), or the middle of the rest of its standing army when that with the group is worth at least the attackers; of
   * those at least RESPONSE_AWAY tiles from the group and farther from the attackers than the group is, the nearest; null
   * if none.
   */
  private refuge(c: Ctx, group: readonly UnitSnap[], foe: { x: number; y: number }, theirs: number, rest?: readonly UnitSnap[]): { x: number; y: number } | null {
    const g = this.middle(group);
    const hold = this.holdPoint(c);
    const cands: { x: number; y: number }[] = [{ x: hold.tx + 0.5, y: hold.ty + 0.5 }];
    if (rest && rest.length > 0 && this.armyPower(rest) + this.armyPower(group) >= theirs) cands.push(this.middle(rest));
    const far = dist(g.x, g.y, foe.x, foe.y);
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (const p of cands) {
      const d = dist(p.x, p.y, g.x, g.y);
      if (d >= RESPONSE_AWAY && dist(p.x, p.y, foe.x, foe.y) > far && d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** Its groups answering an attack (AI-34): mode, units, where they stood and where they are going: for tests only. */
  get responseState(): { mode: 'counter' | 'chase' | 'push' | 'hold'; members: readonly number[]; home: { x: number; y: number }; to: { x: number; y: number } }[] {
    return this.responses.map((r) => ({ mode: r.mode, members: [...r.members], home: { ...r.home }, to: { ...r.to } }));
  }

  /** Where it last called a wave home to (AI-23 c), or null: for tests and measurement only. */
  get recalledTo(): { tx: number; ty: number } | null {
    return this.recallPoint;
  }

  /** Its wave out, if any: objective, units and the strongest it has been (AI-11, AI-23): for tests and measurement only. */
  get waveState(): { tx: number; ty: number; members: readonly number[]; peak: number } | null {
    const w = this.wave;
    return w ? { tx: w.tx, ty: w.ty, members: [...w.members], peak: w.peak } : null;
  }

  /**
   * Its groups out (AI-26, AI-27): the main wave or a raid as one body first, then its strike groups; each with its objective,
   * the approach point it goes by (null: straight), whether it has passed it, and its units: for tests and measurement only.
   */
  get groupState(): { kind: 'wave' | 'raid' | 'strike'; tx: number; ty: number; via: { tx: number; ty: number } | null; passed: boolean; members: readonly number[]; trail: readonly number[]; peak: number }[] {
    return [...(this.wave ? [this.wave] : []), ...this.squads].map((g) => ({ kind: g.kind, tx: g.tx, ty: g.ty, via: g.via, passed: g.passed, members: [...g.members], trail: [...g.trail], peak: g.peak }));
  }

  /** Its staging point (AI-11), where its waves gather and set out from, or null before its first decision: for tests only. */
  get stagingPoint(): { tx: number; ty: number } | null {
    return this.staging;
  }

  /** Raids beaten back so far (AI-16; a split raid once, AI-27 a): for tests only. */
  get raidsBeatenBack(): number {
    return this.raidsLost;
  }

  /** Raider's scout units in its army, beyond its standing scout (AI-27 a): for tests only. */
  get raiderScouts(): readonly number[] {
    return [...this.armyScouts];
  }

  /** What the AI is playing now: its personality, or Balanced once it has adapted (AI-16). */
  get plan(): Personality {
    return this.adapted ? 'balanced' : this.personality;
  }

  private updatePlan(c: Ctx): void {
    const sw = c.buildings.some((b) => buildingDef(b.kind).superweapon);
    if (sw && this.stats.superweaponAt < 0) this.stats.superweaponAt = c.tick;
    if (this.adapted) return;
    if (this.personality === 'raider' && (c.tick >= RAIDER_OPENING_END || this.raidsLost >= RAIDER_RAIDS_LOST)) this.adapted = true;
  }

  /**
   * Scatter orders (AI-24): its infantry squads within SCATTER_R tiles of an enemy crusher it sees, and not told to
   * scatter within SCATTER_GAP ticks, scatter (CTL-18), one order for the squads near each crusher. Never for the
   * steamroll opponent (HAR-5).
   */
  private scatterOrders(c: Ctx, army: readonly UnitSnap[]): Command[] {
    if (!this.rules.scatter || !this.doctrine.retreats) return [];
    const crushers = c.foes.filter((f) => unitDef(f.kind).crusher);
    if (crushers.length === 0) return [];
    const groups = new Map<number, number[]>();
    for (const u of army) {
      if ((unitDef(u.kind).squad ?? 1) <= 1 || c.tick - (this.scattered.get(u.id) ?? -SCATTER_GAP) < SCATTER_GAP) continue;
      let best: UnitSnap | null = null;
      let bd = SCATTER_R * FP;
      for (const f of crushers) {
        const d = Math.hypot(f.x - u.x, f.y - u.y);
        if (d < bd || (d === bd && (best === null || f.id < best.id))) {
          bd = d;
          best = f;
        }
      }
      if (best) groups.set(best.id, [...(groups.get(best.id) ?? []), u.id]);
    }
    return [...groups.keys()].sort((a, b) => a - b).map((k): Command => ({ type: 'scatter', player: this.player, units: groups.get(k) as number[] }));
  }

  // ---------------------------------------------------------------- knowledge

  private updateIntel(c: Ctx): void {
    const { snap } = c;
    const W = snap.mapWidth;
    const seen = new Set<number>();
    for (const u of c.foes) {
      this.intel.set(u.id, { kind: u.kind, x: u.x, y: u.y, t: c.tick, hp: u.hp, rank: u.rank });
      seen.add(u.id);
    }
    for (const [id, e] of this.intel) {
      if (seen.has(id)) continue;
      const visible = ((snap.fog?.[tileOf(e.y) * W + tileOf(e.x)] ?? 0) & VISIBLE) !== 0;
      if (visible || c.tick - e.t > 2400) this.intel.delete(id);
    }
  }

  /** Bookkeeping for the scouting statistics (AI-21): scouts lost, how long each scouted, and how fresh its sightings are. */
  private scoutBook(c: Ctx): void {
    if (c.foes.some((u) => unitDef(u.kind).weapon)) this.lastArmedSeen = c.tick;
    if (c.tick >= INTEL_FROM) {
      this.stats.intelThinks++;
      if (this.lastArmedSeen >= 0 && c.tick - this.lastArmedSeen <= INTEL_FRESH) this.stats.intelFresh++;
    }
    for (const [id, from] of this.scouting) {
      if (c.own.some((u) => u.id === id)) continue;
      this.stats.scoutsLost++;
      this.endScouting(id, c.tick - from);
    }
  }

  /** Its standing scout's unit id, or -1 (AI-21): for measurement only. */
  get standingScout(): number {
    return this.standing;
  }

  /** What it remembers of enemy units, by unit id (AI-21): for measurement only; nothing it has not seen. */
  get sightings(): ReadonlyMap<number, Readonly<Remembered>> {
    return this.intel;
  }

  /** Its units out scouting now (AI-17, AI-21): no part of its army, for measurement only. */
  get scoutingUnits(): readonly number[] {
    return [...this.scouting.keys()];
  }

  private startScouting(id: number, tick: number): void {
    if (this.scouting.has(id)) return;
    this.scouting.set(id, tick);
    this.stats.scoutingSince = [...this.scouting.values()];
  }

  private endScouting(id: number, ticks: number): void {
    this.scouting.delete(id);
    this.stats.scoutLifetimes.push(ticks);
    this.stats.scoutingSince = [...this.scouting.values()];
  }

  /** A scouting unit rejoins the army (AI-21 statistics). */
  private rejoin(id: number, tick: number): void {
    const from = this.scouting.get(id);
    if (from !== undefined) this.endScouting(id, tick - from);
  }

  private setupPoints(c: Ctx): void {
    if (this.home) return;
    const W = this.map.width;
    const H = this.map.height;
    const d = buildingDef(c.hq.kind);
    const hx = c.hq.tx + d.w / 2;
    const hy = c.hq.ty + d.h / 2;
    this.home = { tx: Math.floor(hx), ty: Math.floor(hy) };
    this.centre = { x: hx, y: hy };
    // Home fields first, then every other field by distance (AI-18).
    const homes = homeFields(this.map, { tx: c.hq.tx, ty: c.hq.ty });
    const rest = shardFields(this.map)
      .filter((f) => !homes.some((h) => h.tiles[0] === f.tiles[0]))
      .sort((a, b) => dist(a.cx, a.cy, hx, hy) - dist(b.cx, b.cy, hx, hy) || a.tiles[0]! - b.tiles[0]!);
    this.fields = [...homes, ...rest];
    this.fieldStart = this.fields.map((f) => f.tiles.reduce((s, t) => s + (this.map.shards?.[t] ?? 0), 0));
    // Symmetric map: the opponent starts opposite us. A human can read this off the map too.
    const ex = W - hx;
    const ey = H - hy;
    const len = Math.hypot(ex - hx, ey - hy) || 1;
    const sx = hx + ((ex - hx) / len) * this.jitter.stage;
    const sy = hy + ((ey - hy) / len) * this.jitter.stage;
    this.staging = this.nearestFree(Math.floor(sx), Math.floor(sy));
  }

  private enemyStart(): { tx: number; ty: number } {
    const home = this.home as { tx: number; ty: number };
    return this.nearestFree(this.map.width - home.tx - 1, this.map.height - home.ty - 1);
  }

  private nearestFree(tx: number, ty: number): { tx: number; ty: number } {
    const W = this.map.width;
    const H = this.map.height;
    for (let r = 0; r < 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx;
          const y = ty + dy;
          if (x >= 0 && y >= 0 && x < W && y < H && !this.map.blocked?.[y * W + x]) return { tx: x, ty: y };
        }
      }
    }
    return { tx, ty };
  }

  private intelSummary(c: Ctx, within = 2400): Intel {
    let air = 0;
    let heavy = 0;
    let light = 0;
    let squads = 0;
    let total = 0;
    for (const e of this.intel.values()) {
      const d = UNIT_DEFS[e.kind];
      if (!d || !d.weapon || c.tick - e.t > within) continue;
      total++;
      if ((d.squad ?? 1) > 1) squads++;
      if (d.armor === 'air') air++;
      else if (d.armor === 'heavy') heavy++;
      else light++;
    }
    return total === 0 ? { air: 0, heavy: 0, light: 0, squads: 0, total: 0 } : { air: air / total, heavy: heavy / total, light: light / total, squads: squads / total, total };
  }

  /** Cost-weighted strength of the remembered enemy army and defences within `r` tiles of a tile. */
  private enemyPowerNear(c: Ctx, tx: number, ty: number, r: number): number {
    let p = 0;
    for (const e of this.intel.values()) {
      const d = UNIT_DEFS[e.kind];
      if (!d?.weapon || c.tick - e.t > 1800) continue;
      if (dist(tileOf(e.x), tileOf(e.y), tx, ty) <= r) p += d.cost;
    }
    for (const b of c.enemyBuildings) {
      const d = buildingDef(b.kind);
      if (d.weapon && dist(b.tx, b.ty, tx, ty) <= r + 2) p += d.cost * 1.5;
    }
    return p;
  }

  /** Its power (AI-35): cost scaled by health over real maximum health, veterancy included. */
  private armyPower(units: readonly UnitSnap[]): number {
    return powerOf(units);
  }

  // ---------------------------------------------------------------- structures

  private can(c: Ctx, kind: string, extra = 0): boolean {
    const d = buildingDef(kind);
    return c.credits >= d.cost + extra && d.requires.every((r) => (c.counts.get(r) ?? 0) > 0 && c.buildings.some((b) => b.kind === r));
  }

  /** The structure we want next, ignoring affordability. Order encodes the build order. */
  private wantedStructure(c: Ctx): string | null {
    // The steamroll opponent follows its own build order (HAR-5).
    if (this.doctrine.structure) return this.doctrine.structure((kind) => c.counts.get(kind) ?? 0);
    const k = this.kit;
    const n = (kind: string): number => c.counts.get(kind) ?? 0;
    const queuedDrain = c.hq.queue.reduce((s, q) => s + Math.max(0, -buildingDef(q.kind).power), 0);
    const margin = c.powerOut - c.powerIn - queuedDrain;
    const haulers = c.haulers.length;
    const refineries = n(k.refinery);
    const plain = Math.min(6, (c.tick < 3000 ? 0 : c.tick < 6500 ? 1 : c.tick < 11000 ? 2 : 3) + Math.min(3, this.attacks));
    // Raider defends with its army in the opening (AI-14).
    const turretsWanted = this.plan === 'raider' ? 0 : plain;
    const tech = this.plan === 'doomsday';
    // A building that would leave the power short asks for a power plant first (AI-3).
    const powered = (kind: string): string => (margin < -buildingDef(kind).power + 15 ? k.power : kind);

    if (c.powerIn > c.powerOut || margin < 15) return k.power;
    if (n(k.barracks) === 0) return k.barracks;
    if (refineries < 2) return k.refinery;
    if (margin < 35) return k.power;
    if (n(k.factory) === 0) return k.factory;
    // Production first (AI-22): a second factory, a second barracks and a third factory before the lab, any turret or the
    // superweapon. Doomsday builds its lab straight after its second factory (AI-15, AI-22).
    if (n(k.factory) < 2) return powered(k.factory);
    if (tech && n(k.lab) === 0) return powered(k.lab);
    if (n(k.barracks) < 2) return powered(k.barracks);
    if (n(k.factory) < 3) return powered(k.factory);
    const production = n(k.barracks) + n(k.factory);
    // Raider spends on its army, not on tech, until its opening is over (AI-14).
    const teching = this.plan !== 'raider';
    // Doomsday, once it can afford its superweapon, orders it ahead of further growth, expansion and turrets: on the open
    // Crossroads (MAP-10) games are decided sooner, and a later strike came after the game was settled (AI-15).
    if (tech && n(k.lab) > 0 && n(k.superweapon) === 0 && this.canAffordDoom(c)) {
      const sw = buildingDef(k.superweapon);
      return margin < -sw.power + 10 ? k.power : k.superweapon;
    }
    // Another barracks or factory whenever every one is busy and the bank is full, whichever it has fewer of (AI-22).
    const grow = this.growth(c);
    if (grow) return powered(grow);
    // A refinery at the field it crawls to once that is in reach (AI-44); with the rule off, a third refinery (AI-18).
    if (this.rules.expand ? this.expansion(c).reachable : refineries < 3 && haulers >= 4 && c.credits > 1100) return powered(k.refinery);
    // Turrets wait for six production buildings or an attack on the base (AI-22); after an attack they come ahead of the lab.
    const turrets = production >= TURRETS_FROM || this.attacks > 0;
    if (this.attacks > 0 && n(k.turret) < turretsWanted) return k.turret;
    // The lab comes once it has five production buildings and the growth rule has nothing to build (AI-22); it saves for
    // it (see production).
    if (teching && n(k.lab) === 0 && production >= LAB_FROM) return powered(k.lab);
    if (turrets && n(k.turret) < turretsWanted) return k.turret;
    // Doomsday's superweapon is optional: only when it can spare the money and its army is strong (AI-15).
    if (teching && n(k.superweapon) === 0 && n(k.lab) > 0 && (!tech || this.canAffordDoom(c))) {
      const sw = buildingDef(k.superweapon);
      if (margin < -sw.power + 10) return k.power;
      return k.superweapon;
    }
    const factoriesOnly = tech && this.rules.doomGrowth;
    if (c.credits > 4000 && factoriesOnly && n(k.factory) < GROWTH_MAX) return powered(k.factory);
    if (c.credits > 4000 && !factoriesOnly && (n(k.barracks) < GROWTH_MAX || n(k.factory) < GROWTH_MAX)) return powered(n(k.factory) <= n(k.barracks) && n(k.factory) < GROWTH_MAX ? k.factory : k.barracks);
    if (teching && turrets && n(k.turret) < 6 && c.credits > 1800) return k.turret;
    if (n(k.power) < 8 && margin < 80 && c.credits > 1200) return k.power;
    // Crawling with nothing else due: a power plant toward the field once the bank is full (AI-44); none in Raider's opening (AI-14).
    if (this.rules.expand && this.plan !== 'raider' && c.credits > CRAWL_FILLER_BANK) {
      const e = this.expansion(c);
      if (e.target && !e.reachable) return k.power;
    }
    return null;
  }

  /**
   * The growth rule (AI-22): when every barracks and every factory it has is busy and it has more than GROWTH_BANK credits
   * banked, another of whichever it has fewer of (a factory on a tie), up to GROWTH_MAX of each; otherwise none.
   */
  private growth(c: Ctx): string | null {
    const k = this.kit;
    if (c.credits <= GROWTH_BANK) return null;
    const plants = c.buildings.filter((b) => b.kind === k.barracks || b.kind === k.factory);
    const nb = plants.filter((b) => b.kind === k.barracks).length;
    const nf = plants.length - nb;
    // Doomsday's army is tanks, artillery and its hero (AI-15): it grows by factories alone, and barracks it leaves idle
    // on purpose do not hold it back.
    if (this.plan === 'doomsday' && this.rules.doomGrowth) {
      const factories = plants.filter((b) => b.kind === k.factory);
      return factories.length > 0 && factories.every((b) => b.queue.length > 0) && nf < GROWTH_MAX ? k.factory : null;
    }
    if (plants.length === 0 || plants.some((b) => b.queue.length === 0)) return null;
    if (nf <= nb && nf < GROWTH_MAX) return k.factory;
    if (nb < GROWTH_MAX) return k.barracks;
    if (nf < GROWTH_MAX) return k.factory;
    return null;
  }

  /**
   * Whether Doomsday goes for its superweapon now (AI-15): a strong army, a working economy (two refineries and enough
   * haulers) and a quiet base; then it saves for it.
   */
  private canAffordDoom(c: Ctx): boolean {
    const refineries = c.buildings.filter((b) => buildingDef(b.kind).refinery).length;
    return this.armyPower(this.strengthOf(c)) >= SUPERWEAPON_ARMY && refineries >= 2 && c.haulers.length >= Math.max(SUPERWEAPON_HAULERS, this.rules.expand ? this.haulerTarget(c) - 2 : 0) && c.tick - this.lastThreat > 600;
  }

  private structures(c: Ctx, out: Command[]): void {
    if (c.hq.queue.length > 0) return;
    const kind = this.wantedStructure(c);
    if (kind && this.can(c, kind)) {
      if (kind === this.kit.lab && this.stats.labAt < 0) this.stats.labAt = c.tick;
      if (kind === this.kit.superweapon && !this.stats.superweaponOrder) this.stats.superweaponOrder = { haulers: c.haulers.length, army: this.armyPower(this.strengthOf(c)) };
      out.push({ type: 'produce', player: this.player, source: c.hq.id, kind });
      // Spent now, so units ordered in the same turn cannot count on it (AI-3).
      c.credits -= buildingDef(kind).cost;
    }
  }

  private placeReady(c: Ctx, out: Command[]): void {
    const head = c.hq.queue[0];
    if (!head?.ready) return;
    const spot = this.findSpot(c, head.kind);
    if (spot) out.push({ type: 'place', player: this.player, source: c.hq.id, tx: spot.tx, ty: spot.ty });
    else out.push({ type: 'cancel', player: this.player, source: c.hq.id, index: 0 });
  }

  private findSpot(c: Ctx, kind: string): { tx: number; ty: number } | null {
    const { snap } = c;
    const d = buildingDef(kind);
    const W = snap.mapWidth;
    const fog = snap.fog as Uint8Array;
    const occupied = [...snap.buildings, ...snap.ghosts];
    const ctx = { width: W, height: snap.mapHeight, terrain: this.map.blocked, occupied, own: c.buildings, fog };
    const occ = new Set<number>();
    // The open ground around each dock pad, where haulers drive on and wait (ECO-7): never built over.
    const aprons = new Set<number>();
    const apron = (p: readonly [number, number]): number[] => [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => (p[1] + dy) * W + p[0] + dx));
    for (const b of occupied) {
      const bd = buildingDef(b.kind);
      for (let y = b.ty; y < b.ty + bd.h; y++) for (let x = b.tx; x < b.tx + bd.w; x++) occ.add(y * W + x);
      if (b.pad) for (const i of apron(b.pad)) aprons.add(i);
    }
    const home = this.home as { tx: number; ty: number };
    // Scored from the exact HQ centre toward the exact mirror of it (the enemy's start), so both players weigh mirror-image
    // spots alike (MAP-4).
    const hc = this.centre;
    const dir = { x: W - 2 * hc.x, y: snap.mapHeight - 2 * hc.y };
    const dl = Math.hypot(dir.x, dir.y) || 1;
    // Ties are broken by scan order; the player whose home is the later tile of the two mirrored starts scans from the far
    // corner, so both sides resolve ties as mirror images on any point-symmetric map (MAP-4), not only corner starts.
    const flip = home.ty * W + home.tx > (snap.mapHeight - 1 - home.ty) * W + (W - 1 - home.tx);
    // Nearest shard tile, for refineries.
    const fields: [number, number][] = [];
    // Every third tile counted from the player's own corner of the map, so both players sample mirror-image tiles.
    const n = snap.shards.length;
    // A new refinery goes beside the first field without one, home fields first (AI-18).
    // A refinery for a crawl goes beside the field it crawls to (AI-44).
    const crawl = d.refinery && this.rules.expand && !this.doctrine.place ? this.expansion(c) : null;
    const unserved = crawl?.target && crawl.reachable ? crawl.target : d.refinery ? this.fields.find((f) => f.tiles.some((t) => (snap.shards[t] as number) > 0) && !c.buildings.some((b) => buildingDef(b.kind).refinery && dist(b.tx + 1.5, b.ty + 1, f.cx, f.cy) <= 9)) : undefined;
    if (unserved) for (const t of unserved.tiles) if ((snap.shards[t] as number) > 0) fields.push([(t % W) + 0.5, Math.floor(t / W) + 0.5]);
    if (d.refinery && fields.length === 0)
      for (let k = 0; k < n; k += 3) {
        const i = flip ? n - 1 - k : k;
        if ((snap.shards[i] as number) > 0) fields.push([(i % W) + 0.5, Math.floor(i / W) + 0.5]); // tile centres mirror exactly
      }
    const nearField = (x: number, y: number): number => {
      let m = Infinity;
      for (const [fx, fy] of fields) m = Math.min(m, (fx - x - 0.5) ** 2 + (fy - y - 0.5) ** 2);
      return m;
    };
    // The steamroll opponent may build far from its HQ, and crawl toward a field (HAR-5); the AI's own rules otherwise.
    const aim = this.doctrine.place ? this.doctrine.place(kind) : this.crawlPlace(c, kind);
    const reach = aim ? aim.reach : d.refinery ? 24 : d.weapon ? 13 : 16;
    let best: { tx: number; ty: number } | null = null;
    let bs = Infinity;
    const minX = Math.min(...c.buildings.map((b) => b.tx)) - BUILD_RANGE - d.w;
    const maxX = Math.max(...c.buildings.map((b) => b.tx)) + BUILD_RANGE + 4;
    const minY = Math.min(...c.buildings.map((b) => b.ty)) - BUILD_RANGE - d.h;
    const maxY = Math.max(...c.buildings.map((b) => b.ty)) + BUILD_RANGE + 4;
    const y0 = Math.max(0, minY);
    const y1 = Math.min(snap.mapHeight - d.h, maxY);
    const x0 = Math.max(0, minX);
    const x1 = Math.min(W - d.w, maxX);
    for (let iy = y0; iy <= y1; iy++) {
      for (let ix = x0; ix <= x1; ix++) {
        const tx = flip ? x1 - (ix - x0) : ix;
        const ty = flip ? y1 - (iy - y0) : iy;
        if (!canPlace(ctx, kind, tx, ty)) continue;
        // A compact base: nothing strays far from the headquarters (no creeping chains toward the enemy).
        if (dist(tx + d.w / 2, ty + d.h / 2, hc.x, hc.y) > reach) continue;
        let score = 0;
        // Keep a one-tile gap so units are never walled in.
        let touching = 0;
        for (let y = ty - 1; y <= ty + d.h; y++) for (let x = tx - 1; x <= tx + d.w; x++) if (occ.has(y * W + x) || this.map.blocked?.[y * W + x]) touching++;
        score += touching * (d.weapon ? 1 : 6);
        for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) if (aprons.has(y * W + x)) score += 200;
        // A refinery's pad goes on the side facing the nearest shards, as the simulation will place it (ECO-7).
        const free = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < snap.mapHeight && !occ.has(y * W + x) && !this.map.blocked?.[y * W + x];
        const pad = d.refinery ? choosePad(kind, tx, ty, W, snap.mapHeight, free, nearField) : undefined;
        if (pad) for (const i of apron(pad)) if ((occ.has(i) || this.map.blocked?.[i]) && !(i % W >= tx && i % W < tx + d.w && Math.floor(i / W) >= ty && Math.floor(i / W) < ty + d.h)) score += 40;
        // Never build on crystal.
        for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) if ((snap.shards[y * W + x] as number) > 0) score += 80;
        const cx = tx + d.w / 2;
        const cy = ty + d.h / 2;
        const toward = ((cx - hc.x) * dir.x + (cy - hc.y) * dir.y) / dl;
        if (d.weapon) score -= toward * 2.2; // defences face the enemy
        else if (d.refinery) {
          // Haulers unload on the dock pad, so it is the pad that should be near the shards (ECO-7).
          const px = (pad as [number, number])[0] + 0.5;
          const py = (pad as [number, number])[1] + 0.5;
          let nearest = 40;
          for (const [fx, fy] of fields) nearest = Math.min(nearest, dist(px, py, fx, fy));
          score += nearest * 3;
        } else if (aim?.toward) score += dist(cx, cy, aim.toward.x, aim.toward.y) * 3;
        else score += Math.max(0, toward) * 1.5 + dist(cx, cy, hc.x, hc.y) * 0.8; // soft buildings stay behind the lines
        if (score < bs) {
          bs = score;
          best = { tx, ty };
        }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- units

  /** Its army by role, the units queued in its buildings counted in, and the queued units by kind. */
  private roleCounts(c: Ctx): { counts: Record<Role, number>; queued: Map<string, number> } {
    const counts: Record<Role, number> = { inf: 0, at: 0, tank: 0, art: 0, air: 0, scout: 0 };
    for (const u of this.strengthOf(c)) counts[roleOf(unitDef(u.kind))]++;
    if (this.scoutId >= 0) counts.scout++;
    if (this.standing >= 0) counts.scout++;
    if (this.picket >= 0) counts.scout++;
    const queued = new Map<string, number>();
    for (const b of c.buildings) for (const q of b.queue) if (!BUILDING_DEFS[q.kind]) queued.set(q.kind, (queued.get(q.kind) ?? 0) + 1);
    // Field Menders are not part of the fighting mix (AI-29).
    for (const [kind, n] of queued) if (!unitDef(kind).repair) counts[roleOf(unitDef(kind))] += n;
    return { counts, queued };
  }

  /**
   * Whether Doomsday trains no further infantry now (AI-15): it has its rifle floor, its tanks and artillery set the
   * pace and it has three cheap units for each of them already, and its base is not under pressure.
   */
  private doomCaps(counts: Readonly<Record<Role, number>>, rifles: number, urgent: boolean): boolean {
    return this.plan === 'doomsday' && !urgent && counts.tank + counts.art >= 4 && counts.inf + counts.at >= rifles + 3 * (counts.tank + counts.art);
  }

  /** Its whole army for counting (AI-29): `strength` less a scout taken from the army this turn. */
  private strengthOf(c: Ctx): UnitSnap[] {
    return c.strength.filter((u) => u.id !== this.scoutId && u.id !== this.standing && u.id !== this.picket);
  }

  private urgent(c: Ctx): boolean {
    return this.strengthOf(c).length < 4 || c.tick - this.lastThreat < 600;
  }

  private production(c: Ctx, out: Command[]): void {
    const intel = this.intelSummary(c);
    const { counts, queued } = this.roleCounts(c);

    const next = this.wantedStructure(c);
    // Doomsday saves the whole price of a superweapon it has decided on, else up to its lab's price (AI-15); every AI saves
    // the whole price of its lab; others hold back at most 750. Only those two savings stop an idle barracks or factory:
    // any other reserve applies to further orders in a building that is already busy, so it never starves production (AI-22).
    const doom = this.plan === 'doomsday';
    const saving = c.hq.queue.length === 0 && ((doom && next === this.kit.superweapon) || next === this.kit.lab);
    const hold = next && c.hq.queue.length === 0 ? Math.min(buildingDef(next).cost, doom && next === this.kit.superweapon ? Infinity : doom || next === this.kit.lab ? 1100 : 750) : 0;
    // The steamroll opponent keeps the queues and reserve it was calibrated with (HAR-5).
    const steamroll = this.doctrine.pick !== undefined;
    // Artillery in production now (AI-22): at most ARTILLERY_IN_PRODUCTION (rules.artilleryCap) at once.
    let guns = 0;
    // The cap grows with its army, so artillery keeps its share as AI-43's economy fields bigger armies (AI-19).
    const gunCap = steamroll ? this.rules.artilleryCap : artilleryInProduction(this.rules.artilleryCap, c.army.length);
    for (const b of c.buildings) for (const q of b.queue) if (UNIT_DEFS[q.kind] && roleOf(unitDef(q.kind)) === 'art') guns++;
    const urgent = this.urgent(c);
    const tilt = this.plan === 'raider' ? RAIDER_TILT : this.plan === 'doomsday' ? TECH_TILT : undefined;
    const rifles = this.plan === 'doomsday' ? infantryNeeded(this.intelSummary(c, RIFLE_INTEL)) : 0;
    // Doomsday saving for its superweapon does not spend on the floor (AI-15, AI-19).
    const floor = doom && next === this.kit.superweapon ? 0 : artilleryNeeded(intel);
    // At most HAULERS_IN_PRODUCTION haulers in production at once (AI-43); the steamroll opponent keeps its own (HAR-5).
    const haulerCap = this.rules.expand && !this.doctrine.haulers ? HAULERS_IN_PRODUCTION - (queued.get(this.kit.hauler) ?? 0) : Infinity;
    const haulerWanted = Math.min(haulerCap, this.haulerTarget(c) - c.haulers.length - (queued.get(this.kit.hauler) ?? 0));
    // Haulers queued before this turn; those ordered during it count against haulerWanted (the steamroll's pick, HAR-5).
    const queuedBefore = queued.get(this.kit.hauler) ?? 0;
    // The standing scout (AI-21): one from the building that trains it, ahead of its other combat units, when none lives
    // or is queued and none was lost lately (SCOUT_REPLACE, or twice that after a young one). Production trains no other
    // scout unit. The steamroll opponent sends out no scout (HAR-5).
    const scoutKind = this.doctrine.scouts ? this.scoutKind() : null;
    // Two standing scouts with rules.twoScouts (AI-21), one without.
    const slots = this.rules.twoScouts ? 2 : STANDING_SCOUTS;
    const standingNow = (this.standing >= 0 ? 1 : 0) + (this.picket >= 0 ? 1 : 0);
    let scoutWanted = scoutKind !== null && standingNow + (queued.get(scoutKind) ?? 0) < slots && c.tick - this.standingLostAt >= this.replaceGap;
    // Raider may train up to RAIDER_SCOUTS scout units beyond its standing scout, for its army (AI-27 a, amending AI-21):
    // those queued for the army do not hold back a standing scout, and a standing scout queued is told apart from them.
    const raiderScouts = scoutKind !== null && this.raiderScoutRule();
    let extraScouts = 0;
    // Against mostly heavy armour (by cost, seen in the last two minutes) Vrax trains Skimmers as its main anti-armour (SKM-6).
    const armoured = this.rules.skimmers && heavyShareByCost(this.intel.values(), c.tick) > this.rules.skimAt;
    if (raiderScouts) {
      const queuedScouts = queued.get(scoutKind) ?? 0;
      this.standingOrdered = Math.min(this.standingOrdered, queuedScouts);
      scoutWanted = standingNow + this.standingOrdered < slots && c.tick - this.standingLostAt >= this.replaceGap;
      extraScouts = this.plan === 'raider' ? RAIDER_SCOUTS - this.armyScouts.size - (queuedScouts - this.standingOrdered) : 0;
    }

    // One Field Mender for every three tanks, alive and queued (AI-29).
    let menderWant = this.menderWant(c, queued);

    for (const b of c.buildings) {
      // Shallow queues (AI-22): credits are not locked in orders that will not start soon. The steamroll opponent keeps
      // the deeper queues it was calibrated with (HAR-5).
      const depth = this.doctrine.depth ? this.doctrine.depth(c.credits) : steamroll ? (c.credits > 3000 ? 5 : c.credits > 2000 ? 4 : c.credits > 1100 ? 3 : 2) : c.credits > QUEUE_DEEP_BANK ? this.rules.queueDepthRich : this.rules.queueDepth;
      if (b.queue.length >= depth || b.queue.length >= QUEUE_MAX) continue;
      const trainable = Object.keys(UNIT_DEFS).filter((k) => unitDef(k).builtAt === b.kind && unitDef(k).faction === this.faction && this.doctrine.trains(k));
      if (trainable.length === 0) continue;
      // A hero only while the player has none, alive or queued (HERO-1).
      // No more artillery while rules.artilleryCap pieces are in production (AI-22); the steamroll opponent trains none.
      const allowed = trainable.filter(
        (k) => unitDef(k).requires.every((r) => c.buildings.some((x) => x.kind === r)) && !(unitDef(k).hero && (queued.has(k) || c.own.some((u) => u.kind === k))) && !(roleOf(unitDef(k)) === 'art' && guns >= gunCap),
      );
      // Its hero takes the field whenever it is available and affordable with credits to spare (HERO-1).
      const hero = allowed.find((k) => unitDef(k).hero && c.credits >= unitDef(k).cost + 400);
      // Doomsday keeps enough rifle infantry for the enemy's infantry before anything else from the barracks (AI-15).
      const rifle = counts.inf < rifles ? allowed.find((k) => roleOf(unitDef(k)) === 'inf' && !unitDef(k).hero) : undefined;
      // Artillery floor against enemy infantry (AI-19), when it is available here.
      const gun = counts.art < floor ? allowed.find((k) => roleOf(unitDef(k)) === 'art' && !unitDef(k).hero) : undefined;
      const scout = scoutWanted && scoutKind !== null && allowed.includes(scoutKind) ? scoutKind : undefined;
      // A Field Mender only when it is wanted, affordable now and not out of savings for the lab or a superweapon (AI-22,
      // AI-29); otherwise the building trains what it would have.
      const menderCost = this.menders.kind ? unitDef(this.menders.kind).cost + (urgent || (b.queue.length === 0 && !steamroll) ? 0 : hold) : Infinity;
      const mender = menderWant > 0 && this.menders.kind !== null && allowed.includes(this.menders.kind) && !(saving && !urgent) && c.credits >= menderCost ? this.menders.kind : undefined;
      // The Skimmer only against armour (SKM-6): then it is in this building's mix as its anti-armour choice, and it comes
      // ahead of the rest of the mix (not of artillery) unless the enemy is infantry-heavy by count, which crushers answer (BAL-6).
      const skimmer = skimmerOf(allowed);
      const mix = armoured ? allowed : allowed.filter((k) => k !== skimmer);
      const skimFirst = armoured && skimmer !== null && (intel.squads ?? 0) <= INFANTRY_HEAVY;
      // A few Brutes beside the Skimmers to screen them (AI-33): one for every SCREEN_PER Skimmers, alive and queued.
      const brute = skimFirst && this.rules.screen ? allowed.find((k) => unitDef(k).crusher && !unitDef(k).hero) : undefined;
      const have = (k: string): number => c.own.filter((u) => u.kind === k).length + (queued.get(k) ?? 0);
      const screen = brute !== undefined && skimmer !== null && have(brute) < Math.floor(have(skimmer) / SCREEN_PER) ? brute : undefined;
      // Field Menders are not part of the fighting mix (AI-29).
      const usual = (): string | null =>
        extraScouts > 0
          ? chooseUnitKind(mix.filter((k) => k !== this.kit.hauler && !unitDef(k).hero && !unitDef(k).repair), counts, intel, tilt, slots + RAIDER_SCOUTS)
          : chooseUnitKind(mix.filter((k) => k !== this.kit.hauler && !unitDef(k).hero && !unitDef(k).repair && k !== scoutKind), counts, intel, tilt);
      const pick: string | null = this.doctrine.pick
        ? this.doctrine.pick(b.kind, allowed.filter((k) => !unitDef(k).repair || k === mender), haulerWanted - ((queued.get(this.kit.hauler) ?? 0) - queuedBefore))
        : b.kind === this.kit.factory && haulerWanted - ((queued.get(this.kit.hauler) ?? 0) - queuedBefore) > 0 && allowed.includes(this.kit.hauler)
          ? this.kit.hauler
          : (scout ??
            hero ??
            rifle ??
            gun ??
            mender ??
            skimOr(skimFirst ? (screen ?? skimmer) : null, usual()));
      if (!pick) continue;
      if (unitDef(pick).repair) {
        // A Field Mender: bought like any unit, but outside the fighting mix (AI-29).
        if (c.credits < menderCost) continue;
        c.credits -= unitDef(pick).cost;
        out.push({ type: 'produce', player: this.player, source: b.id, kind: pick });
        menderWant--;
        continue;
      }
      // Doomsday does not flood the field with cheap infantry beyond its rifle floor: tanks and artillery set the pace (AI-15).
      if (doom && !rifle && pick !== skimmer && (roleOf(unitDef(pick)) === 'inf' || roleOf(unitDef(pick)) === 'at') && this.doomCaps(counts, rifles, urgent)) continue;
      const cost = unitDef(pick).cost;
      const reserve = pick === this.kit.hauler || pick === scout || urgent || (b.queue.length === 0 && !saving && !steamroll) ? 0 : hold;
      if (c.credits < cost + reserve) continue;
      c.credits -= cost;
      out.push({ type: 'produce', player: this.player, source: b.id, kind: pick });
      counts[roleOf(unitDef(pick))]++;
      if (pick !== this.kit.hauler) this.stats.produced[unitDef(pick).hero ? 'hero' : roleOf(unitDef(pick))]++;
      if (pick === this.kit.hauler || unitDef(pick).hero) queued.set(pick, (queued.get(pick) ?? 0) + 1);
      if (pick === scout) scoutWanted = false;
      if (raiderScouts && pick === scoutKind) {
        if (pick === scout) this.standingOrdered++;
        else extraScouts--;
      }
      if (roleOf(unitDef(pick)) === 'art') guns++;
      // Queued Skimmers and Brutes count toward the screen (AI-33).
      if (pick === skimmer || pick === screen) queued.set(pick, (queued.get(pick) ?? 0) + 1);
    }
  }

  /** How many more Field Menders it wants (AI-29): one per three of its tanks, alive and queued, less those it has or has queued. */
  private menderWant(c: Ctx, queued: ReadonlyMap<string, number>): number {
    const kind = this.menders.kind;
    // The steamroll opponent keeps its own build and ignores the rules (HAR-5).
    if (!kind || (!this.rules.menders && this.doctrine.pick === undefined)) return 0;
    // Raider's fast, cheap raiding army has no place for a slow Mender: none while it plays Raider (AI-14, AI-29).
    if (this.plan === 'raider' && this.doctrine.pick === undefined) return 0;
    let tanks = c.own.filter((u) => isTank(u.kind)).length;
    for (const [k, n] of queued) if (isTank(k)) tanks += n;
    return mendersWanted(tanks, c.own.filter((u) => u.kind === kind).length + (queued.get(kind) ?? 0));
  }

  private haulerTarget(c: Ctx): number {
    const refs = c.buildings.filter((b) => buildingDef(b.kind).refinery).length;
    // Three haulers a refinery, at most eight (AI-18): the steamroll opponent's fallback (HAR-5), and the AI's with rules.expand off.
    const standard = refs === 0 ? 0 : Math.min(8, refs * 3);
    if (this.doctrine.haulers) return this.doctrine.haulers(standard);
    // The ideal count on each field it mines (AI-43).
    return this.rules.expand ? this.expansion(c).want : standard;
  }

  /**
   * The economy plan for this decision, worked out once (AI-43, AI-44): the fields it mines and the haulers each wants,
   * their sum (three a refinery at most until its second factory stands, so the opening is unchanged), and the field it
   * crawls to with whether a refinery can go there now.
   */
  private expansion(c: Ctx): { tick: number; mined: MinedField[]; want: number; target: ShardField | null; reachable: boolean } {
    if (this.expandPlan?.tick === c.tick) return this.expandPlan;
    const { snap } = c;
    const W = snap.mapWidth;
    const kind = this.kit.hauler;
    const mined = minedFields(this.fields, this.fieldStart, c.buildings, snap.shards, W, kind, unitDef(kind).cost);
    const refineries = c.buildings.filter((b) => buildingDef(b.kind).refinery).length;
    const factories = c.buildings.filter((b) => b.kind === this.kit.factory).length;
    if (factories >= 2) this.rampDone = true;
    const ideal = mined.reduce((s, m) => s + m.want, 0);
    const want = this.rampDone ? ideal : Math.min(ideal, RAMP_PER_REFINERY * refineries);
    // Haulers at work on each field, by its index.
    const alive = new Set(c.haulers.map((h) => h.id));
    const load = new Map<number, number>();
    for (const [id, fi] of this.haulerField) if (alive.has(id)) load.set(fi, (load.get(fi) ?? 0) + 1);
    // Fields it may crawl to: not its own, shards left as far as it knows, and no enemy refinery seen beside them.
    const fog = snap.fog as Uint8Array;
    const own = new Set(mined.map((m) => m.index));
    const known = (t: number): boolean => ((fog[t] as number) & EXPLORED ? (snap.shards[t] as number) > 0 : (this.map.shards?.[t] ?? 0) > 0);
    const enemyRefinery = (f: ShardField): boolean =>
      c.enemyBuildings.some((b) => {
        const d = buildingDef(b.kind);
        return !!d.refinery && Math.hypot(b.tx + d.w / 2 - f.cx, b.ty + d.h / 2 - f.cy) <= SERVE_R;
      });
    const candidates = this.fields.filter((f, i) => !own.has(i) && f.tiles.some(known) && !enemyRefinery(f));
    const safe = (f: ShardField): boolean => this.enemyPowerNear(c, Math.floor(f.cx), Math.floor(f.cy), CRAWL_SAFE_R) <= CRAWL_SAFE;
    // It crawls once its opening is over (a factory and two refineries stand) and its fields are staffed or one runs low
    // (AI-44); a crawl under way goes on to its field while that is still a candidate and safe.
    const prev = this.crawlTo >= 0 ? this.fields[this.crawlTo] : undefined;
    const going = prev !== undefined && candidates.includes(prev) && safe(prev);
    const ready = this.rules.expand && factories > 0 && refineries >= 2 && (going || wantsCrawl(mined, (m) => (load.get(m.index) ?? 0) >= m.want));
    const target = !ready ? null : going ? prev : crawlTarget(candidates, safe, { x: W / 2, y: snap.mapHeight / 2 });
    this.crawlTo = target ? this.fields.indexOf(target) : -1;
    const reachable = target !== null && inReach(target, c.buildings, fog, W, known);
    this.expandPlan = { tick: c.tick, mined, want, target, reachable };
    return this.expandPlan;
  }

  /** The field it crawls to and whether a refinery can go there now (AI-44); null while it is not crawling. */
  get crawl(): { cx: number; cy: number; reachable: boolean } | null {
    const e = this.expandPlan;
    return e?.target ? { cx: e.target.cx, cy: e.target.cy, reachable: e.reachable } : null;
  }

  /**
   * Where a building goes while it crawls (AI-44): a refinery anywhere once the field is in reach; power and production
   * toward the field, the base-size cap lifted, until then. Anything else keeps the compact base.
   */
  private crawlPlace(c: Ctx, kind: string): { reach: number; toward?: { x: number; y: number } } | undefined {
    if (!this.rules.expand) return undefined;
    const e = this.expansion(c);
    if (!e.target) return undefined;
    if (buildingDef(kind).refinery) return e.reachable ? { reach: Infinity } : undefined;
    const k = this.kit;
    if (!e.reachable && (kind === k.power || kind === k.barracks || kind === k.factory)) return { reach: Infinity, toward: { x: e.target.cx, y: e.target.cy } };
    return undefined;
  }

  /** Whether a field still has shards and one of our refineries beside it (AI-18). */
  private served(c: Ctx, f: ShardField): boolean {
    return f.tiles.some((t) => (c.snap.shards[t] as number) > 0) && c.buildings.some((b) => buildingDef(b.kind).refinery && dist(b.tx + 1.5, b.ty + 1, f.cx, f.cy) <= 9);
  }

  /** The shard tile of field `fi` nearest to (x, y) (tiles), skipping exhausted ones. */
  private fieldTile(c: Ctx, fi: number, x: number, y: number): { x: number; y: number } | null {
    const W = c.snap.mapWidth;
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (const t of this.fields[fi]!.tiles) {
      if (!((c.snap.shards[t] as number) > 0)) continue;
      const d = dist(t % W, Math.floor(t / W), x, y);
      if (d < bd) {
        bd = d;
        best = { x: t % W, y: Math.floor(t / W) };
      }
    }
    return best;
  }

  private economy(c: Ctx, out: Command[]): void {
    const W = c.snap.mapWidth;
    const fieldsNear = (hx: number, hy: number): { x: number; y: number } | null => {
      let best: { x: number; y: number } | null = null;
      let bd = Infinity;
      for (let i = 0; i < c.snap.shards.length; i++) {
        if ((c.snap.shards[i] as number) === 0) continue;
        const x = i % W;
        const y = Math.floor(i / W);
        // Avoid fields with remembered enemy troops on them.
        if (this.enemyPowerNear(c, x, y, 8) > 150) continue;
        const d = dist(x, y, hx, hy);
        if (d < bd) {
          bd = d;
          best = { x, y };
        }
      }
      return best;
    };
    // Fields worth sending haulers to: ours (a refinery beside them), not held by the enemy (AI-18).
    const open = this.fields.map((f, i) => (this.served(c, f) && this.enemyPowerNear(c, Math.floor(f.cx), Math.floor(f.cy), 8) <= 150 ? i : -1)).filter((i) => i >= 0);
    const alive = new Set(c.haulers.map((h) => h.id));
    for (const id of [...this.haulerField.keys()]) if (!alive.has(id)) this.haulerField.delete(id);
    const load = (fi: number): number => [...this.haulerField.values()].filter((v) => v === fi).length;
    // Haulers each field wants (AI-43): a field is judged by its haulers less those, so each moves toward its ideal; all
    // alike (0) with rules.expand off, the even split of AI-18.
    const wants = new Map<number, number>();
    if (this.rules.expand && !this.doctrine.haulers) for (const m of this.expansion(c).mined) wants.set(m.index, m.want);
    const surplus = (fi: number): number => load(fi) - (wants.get(fi) ?? 0);
    const send = (h: UnitSnap, fi: number): boolean => {
      const t = this.fieldTile(c, fi, tileOf(h.x), tileOf(h.y));
      if (!t) return false;
      this.haulerField.set(h.id, fi);
      out.push({ type: 'harvest', player: this.player, units: [h.id], x: t.x * FP + FP / 2, y: t.y * FP + FP / 2 });
      return true;
    };
    // The field furthest below the haulers it wants (AI-43; the fewest haulers with rules.expand off, AI-18), the nearer on a tie.
    const leastWorked = (h: UnitSnap): number | undefined =>
      [...open].sort((a, b) => surplus(a) - surplus(b) || dist(this.fields[a]!.cx, this.fields[a]!.cy, tileOf(h.x), tileOf(h.y)) - dist(this.fields[b]!.cx, this.fields[b]!.cy, tileOf(h.x), tileOf(h.y)) || a - b)[0];
    for (const h of c.haulers) {
      // A hauler already at work on a field we know counts for that field.
      if (!this.haulerField.has(h.id) && h.dest === null && h.load > 0) {
        const fi = this.fields.findIndex((f) => f.tiles.some((t) => dist(t % W, Math.floor(t / W), tileOf(h.x), tileOf(h.y)) <= 2));
        if (fi >= 0) this.haulerField.set(h.id, fi);
      }
      const prev = this.idle.get(h.id);
      const still = prev && prev.x === h.x && prev.y === h.y;
      const n = still ? prev.n + 1 : 0;
      this.idle.set(h.id, { x: h.x, y: h.y, n });
      if (n >= 3 && h.dest === null) {
        const fi = leastWorked(h);
        if (fi === undefined || !send(h, fi)) {
          const f = fieldsNear(tileOf(h.x), tileOf(h.y));
          if (f) out.push({ type: 'harvest', player: this.player, units: [h.id], x: f.x * FP + FP / 2, y: f.y * FP + FP / 2 });
        }
        this.idle.set(h.id, { x: h.x, y: h.y, n: 0 });
      }
    }
    // New haulers, and an uneven split: move one hauler from the field most over its want to the one most under it (AI-18, AI-43).
    for (const h of c.haulers) {
      if (this.haulerField.has(h.id)) continue;
      const fi = leastWorked(h);
      if (fi !== undefined) send(h, fi);
    }
    if (open.length >= 2 && c.tick - this.lastRebalance >= 200) {
      const byLoad = [...open].sort((a, b) => surplus(a) - surplus(b) || a - b);
      const low = byLoad[0]!;
      const high = byLoad[byLoad.length - 1]!;
      if (surplus(high) - surplus(low) >= 2) {
        const h = c.haulers.filter((u) => this.haulerField.get(u.id) === high).sort((a, b) => a.load - b.load || a.id - b.id)[0];
        if (h && send(h, low)) this.lastRebalance = c.tick;
      }
    }
  }

  // ---------------------------------------------------------------- army

  private defendBase(c: Ctx, out: Command[]): void {
    const threats = c.foes.filter((u) => unitDef(u.kind).weapon && c.buildings.some((b) => dist(tileOf(u.x), tileOf(u.y), b.tx, b.ty) <= 16));
    if (threats.length === 0) return;
    const power = this.armyPower(threats);
    if (power < 180 && threats.length < 2) return;
    if (c.tick - this.lastThreat > 600) this.attacks++;
    this.lastThreat = c.tick;
    const cx = threats.reduce((s, u) => s + u.x, 0) / threats.length;
    const cy = threats.reduce((s, u) => s + u.y, 0) / threats.length;
    const moved = dist(cx / FP, cy / FP, this.defend.x / FP, this.defend.y / FP) > 5;
    if (c.tick - this.defend.tick < 40 && !moved) return;
    this.defend = { tick: c.tick, x: cx, y: cy };
    // The steamroll opponent does not call its attack home: those left at home defend (HAR-5).
    const w = this.wave;
    const pressing = w !== null && !this.doctrine.retreats;
    if (w && !pressing) {
      this.wave = null;
      this.waveCooldown = c.tick + 500;
    }
    // Strike groups come home like any other group (AI-7, AI-27); a split raid called home starts the cooldown a wave would.
    if (this.squads.length > 0 && !pressing) {
      if (this.squads.some((s) => s.kind === 'raid')) this.waveCooldown = c.tick + 500;
      // A strike group out at the economy while the enemy's armour is away carries on (AI-31).
      this.squads = this.squads.filter((s) => s.ball);
    }
    const away = new Set(this.squads.flatMap((s) => (s.ball ? [...s.members] : [])));
    const units = (pressing ? c.army.filter((u) => !w.members.has(u.id)) : c.army).filter((u) => !away.has(u.id));
    if (units.length === 0) return;
    this.stats.defends++;
    const t = { x: cx / FP, y: cy / FP };
    const m = this.middle(units);
    if (this.doctrine.retreats && this.rules.harass && this.rules.xCover) {
      // Harassers it cannot catch, or guns that out-reach it (AI-39, AI-40): it holds under its defences' cover.
      const harassed = isHarasser(threats, units, (id) => this.kites.kited(id, c.tick)) || outranges(threats, units);
      const answer = harassed ? harassAnswer(units, threats) : null;
      if (answer?.mode === 'chase') {
        // Only the units that can catch them go, no farther than HARASS_LEASH tiles (AI-40).
        const to = leashed(this.anchor(c), t, HARASS_LEASH);
        this.stats.harassResponses.chase++;
        out.push({ type: 'attackmove', player: this.player, units: answer.chasers.map((u) => u.id), x: Math.floor(to.x) * FP + FP / 2, y: Math.floor(to.y) * FP + FP / 2 });
        return;
      }
      if (answer?.mode === 'push') {
        const spot = this.coverSpot(c, m, t, Math.max(...threats.map((f) => reachOf(f.kind))));
        if (spot) {
          this.takeCover(c, spot);
          if (dist(m.x, m.y, spot.x, spot.y) > COVER_R) {
            this.stats.harassResponses.fallBack++;
            this.startRetreat(c, units, { at: spot, kind: 'defence' }, out, true);
          } else if (!this.formUp(c, units, spot, t, 'move', 40)) out.push({ type: 'move', player: this.player, units: units.map((u) => u.id), x: Math.floor(spot.x) * FP + FP / 2, y: Math.floor(spot.y) * FP + FP / 2 });
          return;
        }
      }
    }
    this.fighting = c.tick;
    if (this.doctrine.retreats && this.rules.overwhelm) {
      // Overwhelmed at home (AI-36): it falls back to friendly strength (AI-37), and holds there in its concave.
      const enemy = freshEnemyPower(this.intel.values(), c.enemyBuildings, c.tick, t.x, t.y, OVERWHELM_R);
      if (isOverwhelmed(this.armyPower(units), defencePower(c.buildings, t.x, t.y, OVERWHELM_R), enemy)) {
        const to = this.fallbackFor(c, units, t, true) as { at: { x: number; y: number }; kind: FallbackKind };
        if (dist(m.x, m.y, to.at.x, to.at.y) > RETREAT_ARRIVED + 1) this.startRetreat(c, units, to, out);
        else this.formUp(c, units, m, t, 'move', 40);
        return;
      }
    }
    // Close to the threat, it meets it in a concave (AI-42) a little short of its middle.
    const d = dist(m.x, m.y, t.x, t.y);
    if (d <= CONCAVE_R && this.formUp(c, units, toward(m, t, Math.max(0, d - CONCAVE_STANDOFF)), t, 'attackmove', 40)) return;
    out.push({ type: 'attackmove', player: this.player, units: units.map((u) => u.id), x: Math.round(cx), y: Math.round(cy) });
  }

  private nearestEnemyBuilding(c: Ctx, tx: number, ty: number): BuildingSnap | null {
    let best: BuildingSnap | null = null;
    let bd = Infinity;
    for (const b of c.enemyBuildings) {
      const d = dist(b.tx, b.ty, tx, ty);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  private searchPoint(c: Ctx): { tx: number; ty: number } {
    const W = this.map.width;
    const H = this.map.height;
    const start = this.enemyStart();
    const pts = [start, { tx: W >> 1, ty: H >> 1 }, { tx: W >> 2, ty: (3 * H) >> 2 }, { tx: (3 * W) >> 2, ty: H >> 2 }, { tx: W >> 2, ty: H >> 2 }, { tx: (3 * W) >> 2, ty: (3 * H) >> 2 }];
    for (const p of pts) {
      const f = c.snap.fog?.[p.ty * W + p.tx] ?? 0;
      if ((f & EXPLORED) === 0) return this.nearestFree(p.tx, p.ty);
    }
    return this.nearestFree(start.tx, start.ty);
  }

  /** Value (credits) of the armed enemy units it has seen within `within` ticks (AI-23): what it knows of their army. */
  private seenArmy(c: Ctx, within: number): number {
    let v = 0;
    for (const e of this.intel.values()) {
      const d = UNIT_DEFS[e.kind];
      if (d?.weapon && d.capacity === undefined && c.tick - e.t <= within) v += d.cost;
    }
    return v;
  }

  /**
   * Its hold point (AI-23), where a recalled wave goes: on the enemy side of its base, HOLD_AHEAD tiles toward the enemy
   * from its turrets (their middle) when it has any, else from its building nearest the enemy; on open ground within
   * HOLD_REACH tiles of its buildings.
   */
  private holdPoint(c: Ctx): { tx: number; ty: number } {
    const W = this.map.width;
    const H = this.map.height;
    const hc = this.centre;
    const ex = W - 2 * hc.x;
    const ey = H - 2 * hc.y;
    const len = Math.hypot(ex, ey) || 1;
    const ux = ex / len;
    const uy = ey / len;
    const mid = (b: BuildingSnap): { x: number; y: number } => ({ x: b.tx + buildingDef(b.kind).w / 2, y: b.ty + buildingDef(b.kind).h / 2 });
    const turrets = c.buildings.filter((b) => buildingDef(b.kind).weapon);
    let anchor: { x: number; y: number };
    if (turrets.length > 0) {
      anchor = { x: turrets.reduce((t, b) => t + mid(b).x, 0) / turrets.length, y: turrets.reduce((t, b) => t + mid(b).y, 0) / turrets.length };
    } else {
      const ahead = (b: BuildingSnap): number => (mid(b).x - hc.x) * ux + (mid(b).y - hc.y) * uy;
      anchor = mid([...c.buildings].sort((a, b) => ahead(b) - ahead(a) || a.id - b.id)[0] as BuildingSnap);
    }
    const near = (x: number, y: number): boolean => c.buildings.some((b) => edgeDist(b, x + 0.5, y + 0.5) <= HOLD_REACH);
    const under = (x: number, y: number): boolean => c.buildings.some((b) => x >= b.tx && y >= b.ty && x < b.tx + buildingDef(b.kind).w && y < b.ty + buildingDef(b.kind).h);
    const open = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && !this.map.blocked?.[y * W + x] && !under(x, y);
    // From the point ahead back toward the anchor, the first open tile near its buildings.
    for (let k = HOLD_AHEAD; k >= 0; k--) {
      const x = Math.floor(anchor.x + ux * k);
      const y = Math.floor(anchor.y + uy * k);
      for (let r = 0; r <= 3; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (open(x + dx, y + dy) && near(x + dx, y + dy)) return { tx: x + dx, ty: y + dy };
          }
    }
    return this.nearestFree(Math.floor(anchor.x), Math.floor(anchor.y));
  }

  /** An enemy force worth RECALL_SHARE of its whole army seen near its buildings: a wave out comes home (AI-23). */
  private baseInDanger(c: Ctx, own: number): boolean {
    let v = 0;
    for (const e of this.intel.values()) {
      const d = UNIT_DEFS[e.kind];
      if (!d?.weapon || d.capacity !== undefined || c.tick - e.t > RECALL_SEEN) continue;
      const x = e.x / FP;
      const y = e.y / FP;
      if (c.buildings.some((b) => edgeDist(b, x, y) <= RECALL_RANGE)) v += d.cost;
    }
    return v > 0 && v >= RECALL_SHARE * own;
  }

  /**
   * Where Raider's raid goes (AI-14, AI-23): the nearest part of the enemy economy it knows where the defenders it has
   * seen within RAID_GUARD_R tiles in the last RAID_GUARD_AGE ticks (units, and defences at their cost and a half) are
   * worth less than RAID_GUARD_SHARE of the raid; else the next it knows; null if none, and it waits.
   */
  private raidTarget(c: Ctx, raid: number): { tx: number; ty: number } | null {
    return this.economyTargets(c).find((t) => this.guarded(c, t) < RAID_GUARD_SHARE * raid) ?? null;
  }

  /** Value of the defenders it has seen at a target (AI-23 e): units within RAID_GUARD_R tiles in the last RAID_GUARD_AGE ticks, defences at their cost and a half. */
  private guarded(c: Ctx, t: { tx: number; ty: number }): number {
    let v = 0;
    for (const e of this.intel.values()) {
      const d = UNIT_DEFS[e.kind];
      if (d?.weapon && d.capacity === undefined && c.tick - e.t <= RAID_GUARD_AGE && dist(tileOf(e.x), tileOf(e.y), t.tx, t.ty) <= RAID_GUARD_R) v += d.cost;
    }
    for (const b of c.enemyBuildings) if (buildingDef(b.kind).weapon && edgeDist(b, t.tx + 0.5, t.ty + 0.5) <= RAID_GUARD_R) v += buildingDef(b.kind).cost * 1.5;
    return v;
  }

  /** Whether a squad worth `value` may go for an economy target (AI-23 e, AI-27): always with rules.raidGuard off. */
  private mayRaid(c: Ctx, t: { tx: number; ty: number }, value: number): boolean {
    return !this.rules.raidGuard || this.guarded(c, t) < RAID_GUARD_SHARE * value;
  }

  /**
   * A flank's approach point (AI-26): halfway along the straight line from `from` to `to` and rules.approachFlank tiles to
   * that side of it (left as seen looking along the line, on the map, y downward), moved to the nearest open ground; null
   * when the point would lie off the map or has no open ground within APPROACH_OPEN tiles.
   */
  flankPoint(from: { tx: number; ty: number }, to: { tx: number; ty: number }, side: 'left' | 'right'): { tx: number; ty: number } | null {
    const W = this.map.width;
    const H = this.map.height;
    const dx = to.tx - from.tx;
    const dy = to.ty - from.ty;
    const len = Math.hypot(dx, dy) || 1;
    const s = side === 'left' ? 1 : -1;
    const px = from.tx + 0.5 + dx / 2 + (s * dy * this.rules.approachFlank) / len;
    const py = from.ty + 0.5 + dy / 2 - (s * dx * this.rules.approachFlank) / len;
    if (px < 0 || py < 0 || px >= W || py >= H) return null;
    const cx = Math.floor(px);
    const cy = Math.floor(py);
    let best: { tx: number; ty: number } | null = null;
    let bd = Infinity;
    for (let y = cy - APPROACH_OPEN; y <= cy + APPROACH_OPEN; y++)
      for (let x = cx - APPROACH_OPEN; x <= cx + APPROACH_OPEN; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H || this.map.blocked?.[y * W + x]) continue;
        const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
        if (d <= APPROACH_OPEN && d < bd) {
          bd = d;
          best = { tx: x, ty: y };
        }
      }
    return best;
  }

  /** Which side of the straight line from `from` to `to` a point lies on (AI-26, AI-27): left, right, or null on the line. */
  private sideOf(from: { tx: number; ty: number }, to: { tx: number; ty: number }, p: { tx: number; ty: number }): 'left' | 'right' | null {
    const cross = (p.tx - from.tx) * (to.ty - from.ty) - (p.ty - from.ty) * (to.tx - from.tx);
    return cross > 0 ? 'left' : cross < 0 ? 'right' : null;
  }

  /**
   * The approach a main wave takes to its target (AI-26): straight, or by the left or right flank point where one is
   * offered; never the approach its previous main wave chose (unless nothing else is offered); of the others the one
   * farthest from where it last saw the enemy army, or with no such sighting the next in turn.
   */
  private chooseApproach(c: Ctx, target: { tx: number; ty: number }): { approach: Approach; via: { tx: number; ty: number } | null } {
    const stage = this.staging as { tx: number; ty: number };
    const offered = APPROACHES.map((a) => ({ a, via: a === 'straight' ? null : this.flankPoint(stage, target, a) })).filter((o) => o.a === 'straight' || o.via !== null);
    const fresh = offered.filter((o) => o.a !== this.lastApproach);
    const cands = fresh.length > 0 ? fresh : offered;
    // Where it last saw the enemy army: the cost-weighted middle of the armed units seen lately, the target's defenders apart.
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (const e of this.intel.values()) {
      const d = UNIT_DEFS[e.kind];
      if (!d?.weapon || d.capacity !== undefined || c.tick - e.t > APPROACH_SEEN) continue;
      const x = e.x / FP;
      const y = e.y / FP;
      if (dist(x, y, target.tx + 0.5, target.ty + 0.5) <= APPROACH_DEFENDERS) continue;
      sx += x * d.cost;
      sy += y * d.cost;
      sw += d.cost;
    }
    let pick = cands[0] as (typeof cands)[number];
    if (sw > 0) {
      const ref = (o: (typeof cands)[number]): { x: number; y: number } => (o.via ? { x: o.via.tx + 0.5, y: o.via.ty + 0.5 } : { x: (stage.tx + target.tx) / 2 + 0.5, y: (stage.ty + target.ty) / 2 + 0.5 });
      let bd = -1;
      for (const o of cands) {
        const d = dist(ref(o).x, ref(o).y, sx / sw, sy / sw);
        if (d > bd) {
          bd = d;
          pick = o;
        }
      }
    } else {
      for (let k = 0; k < APPROACHES.length; k++) {
        const i = (this.approachTurn + k) % APPROACHES.length;
        const o = cands.find((x) => x.a === APPROACHES[i]);
        if (o) {
          pick = o;
          this.approachTurn = (i + 1) % APPROACHES.length;
          break;
        }
      }
    }
    return { approach: pick.a, via: pick.via };
  }

  private attackLogic(c: Ctx, out: Command[]): void {
    // A beaten wave's army regroups at its fallback point until the next wave sets out (AI-38).
    const stage = this.coverAt(c) ?? this.regroupAt ?? (this.staging as { tx: number; ty: number });
    const army = c.army;
    // The steamroll opponent keeps its own attack rule and never retreats (HAR-5).
    const ordinary = this.doctrine.retreats;
    // The squads riding in its Menders go with the army and fire from inside: they count in its strength (AI-29).
    const riding = c.riders.length > 0 ? this.armyPower(c.riders) : 0;
    const own = this.armyPower(army) + riding;
    if (army.length === 0 && this.retreats.length === 0) {
      if (this.wave) this.wave = null;
      this.squads = [];
      return;
    }
    const threatened = c.tick - this.lastThreat < 200;
    const order = (type: 'move' | 'attackmove', units: UnitSnap[], x: number, y: number): void => {
      if (units.length > 0) out.push({ type, player: this.player, units: units.map((u) => u.id), x: Math.floor(x) * FP + FP / 2, y: Math.floor(y) * FP + FP / 2 });
    };
    const centre = (us: UnitSnap[]): { x: number; y: number } => ({ x: us.reduce((s, u) => s + u.x, 0) / us.length / FP, y: us.reduce((s, u) => s + u.y, 0) / us.length / FP });

    // While the enemy's armour is away from its base, a strike group goes for its economy (AI-31).
    if (ordinary && this.rules.ballRaid && this.plan !== 'raider' && this.squads.length === 0) this.ballRaid(c, army, order, centre);
    // Units out in a strike group (AI-27) are no part of the wave, its reinforcements or the gathering.
    const inSquad = new Set(this.squads.flatMap((s) => [...s.members]));
    const free = inSquad.size > 0 ? army.filter((u) => !inSquad.has(u.id)) : army;
    const drive: Drive = { out, order, centre, own, ordinary, danger: undefined };

    if (this.wave) {
      const w = this.wave;
      // Doomsday commits while its strike is charged or has just landed: the strike, not a retreat, answers resistance (AI-15).
      const committed = this.plan === 'doomsday' && (c.buildings.some((b) => buildingDef(b.kind).superweapon && b.charge >= 100) || (this.lastStrike >= 0 && c.tick - this.lastStrike < STRIKE_COMMIT));
      // The wave is the units that set out together (AI-11) and the reinforcements that joined it; others wait.
      const end = this.driveGroup(c, w, drive, free.filter((u) => !w.members.has(u.id)), committed);
      if (end !== null && this.lastStrike >= 0 && c.tick - this.lastStrike < 800 && this.stats.strikeNotes.length < 12) this.stats.strikeNotes.push(`E${c.tick - this.lastStrike}:${end}:${c.army.filter((u) => w.members.has(u.id)).length}`);
      if (end !== null) {
        this.wave = null;
        this.lastWaveEnd = c.tick;
        if (end === 'recalled') this.waveCooldown = c.tick + 500;
        if (end === 'beaten' && !(ordinary && this.rules.regroup)) {
          this.waveCooldown = c.tick + 1200;
          if (this.plan === 'raider') {
            this.raidsLost++;
            this.waveCooldown = c.tick + 600;
          }
        } else if (end === 'beaten' && this.plan === 'raider') this.raidsLost++;
      }
      this.driveSquads(c, drive, null);
      return;
    }
    if (this.squads.some((s) => s.kind === 'raid')) {
      // A split raid out (AI-27 a): its squads, and reinforcements for the one with fewer units left.
      this.driveSquads(c, drive, free);
      return;
    }
    this.driveSquads(c, drive, null);

    if (!threatened) {
      // Gather at the staging point (AI-11).
      // Units not already bound there (a unit keeps its last destination once it stands idle at it).
      const away = this.rules.xGather ? free.filter((u) => dist(tileOf(u.x), tileOf(u.y), stage.tx, stage.ty) > 7 && (u.dest === null || dist(u.dest[0], u.dest[1], stage.tx, stage.ty) > 7) && u.target < 0) : free.filter((u) => u.dest === null && dist(tileOf(u.x), tileOf(u.y), stage.tx, stage.ty) > 7);
      if (away.length > 0 && c.tick % 3 === 0) order('attackmove', away, stage.tx, stage.ty);
      // Those gathered hold a ball (AI-41): a straggler more than 4 + √n tiles from the group's centre comes back to it.
      if (ordinary && this.rules.formation && c.tick - this.lastBall >= WAVE_STEP) {
        const here = free.filter((u) => !away.includes(u) && dist(u.x / FP, u.y / FP, stage.tx + 0.5, stage.ty + 0.5) <= GATHER_R);
        const fu: FormUnit[] = here.map((u) => ({ id: u.id, kind: u.kind, x: u.x / FP, y: u.y / FP }));
        const mid = fu.length > 0 ? middleOf(fu) : null;
        const back = new Set(ballStragglers(fu, mid ?? undefined));
        const strays = here.filter((u) => back.has(u.id) && u.target < 0);
        if (mid && strays.length > 0) {
          this.lastBall = c.tick;
          order('move', strays, mid.x, mid.y);
        }
      }
    }

    if (threatened || c.tick < this.waveCooldown) return;
    const p = inSquad.size > 0 ? this.armyPower(free) + riding : own;
    const raiding = this.plan === 'raider';
    const sw = c.buildings.find((b) => buildingDef(b.kind).superweapon && b.charge >= 100);
    // Doomsday with a charged superweapon sends its wave at what it will strike (AI-15).
    const striking = this.plan === 'doomsday' && sw !== undefined;
    if (raiding && (c.tick < RAID_FROM || (!this.economyTarget(c) && c.tick < 2 * RAID_FROM))) return;
    let threshold = Math.min(4200, (1100 + 450 * this.stats.waves) * this.jitter.wave);
    if (raiding) threshold = 0;
    if (striking) threshold = Math.min(threshold, 1500);
    const known = this.nearestEnemyBuilding(c, stage.tx, stage.ty);
    // A raid goes only where the defenders it has seen are worth less than half of it; else it waits (AI-23).
    const guard = this.rules.raidGuard;
    const raidAim = raiding ? (guard ? this.raidTarget(c, p) : this.economyTarget(c)) : null;
    if (raiding && guard && !raidAim) {
      this.gatherSince = -1;
      return;
    }
    const aim = raidAim ?? (striking && sw ? this.bestStrike(c, sw, null, true) : null);
    let target = aim ?? (known ? { tx: known.tx, ty: known.ty } : this.enemyStart());
    // Attack only on fresh intel: what we have recently seen of their army (anywhere), plus their defences at the target.
    // Without it we are blind, and a blind attack into a defender with reinforcements is how armies get lost.
    const recent = [...this.intel.values()].filter((e) => UNIT_DEFS[e.kind]?.weapon && c.tick - e.t <= 1200);
    const seen = recent.reduce((s, e) => s + (UNIT_DEFS[e.kind]?.cost ?? 0), 0);
    const defences = c.enemyBuildings.reduce((s, b) => (buildingDef(b.kind).weapon && dist(b.tx, b.ty, target.tx, target.ty) <= 14 ? s + buildingDef(b.kind).cost * 1.5 : s), 0);
    const blind = recent.length === 0;
    const stalemate = c.tick - this.lastWaveEnd > 7000;
    let est = blind ? (stalemate ? 1.1 * p : 3 * p) : 1.15 * seen + defences + 250;
    // A raid goes for the economy and slips past the army rather than fighting it (AI-14); a strike clears the way (AI-15).
    if (raiding) est = (blind ? 0 : 0.6 * seen) + defences;
    if (striking) est = 0.5 * ((blind ? 0 : 1.15 * seen) + defences);
    // After a beaten wave, no lower than the strength that beat it, that memory fading as its intel ages (AI-38).
    const beaten = this.rememberedBeating(c);
    if (ordinary && !striking) est = Math.max(est, beaten);
    // The steamroll opponent sets out once its army is big enough, whatever it knows of the enemy (HAR-5).
    const launch = this.doctrine.launch;
    let ready = launch ? launch(p, free.filter((u) => unitDef(u.kind).crusher).length) : shouldAttack(p, est, free.length, threshold, this.jitter.ratio) && !(raiding && free.length < RAID_MIN_ARMY);
    // Stalemate (AI-23): after three quiet minutes, with five barracks and five factories or a big army, it attacks at
    // parity with the enemy army it has seen plus the defences at the target.
    if (!ready && ordinary && this.rules.stalemate && free.length >= 5 && c.tick - this.lastWaveAt >= STALEMATE_QUIET && c.tick - this.lastThreat >= STALEMATE_QUIET) {
      const plants = (kind: string): number => c.buildings.filter((b) => b.kind === kind).length;
      const big = (plants(this.kit.barracks) >= GROWTH_MAX && plants(this.kit.factory) >= GROWTH_MAX) || p >= STALEMATE_ARMY;
      const parity = this.seenArmy(c, STALEMATE_SEEN) + defences;
      if (big && p >= parity && p >= beaten) {
        ready = true;
        est = parity;
      }
    }
    if (!ready) {
      this.gatherSince = -1;
      return;
    }
    // Strong enough: set out only once most of the army has gathered (AI-11), or after a while.
    const gathered = free.filter((u) => dist(tileOf(u.x), tileOf(u.y), stage.tx, stage.ty) <= GATHER_R);
    if (this.gatherSince < 0) this.gatherSince = c.tick;
    // A charged strike does not wait for stragglers: the army goes in together with it (AI-15).
    if (!striking && gathered.length < GATHER_SHARE * free.length && c.tick - this.gatherSince < GATHER_WAIT) return;
    this.gatherSince = -1;
    const setOut = gathered.length >= 3 && !striking && !launch ? gathered : free;
    // What sets out is the raid: its target must still be one it may go for (AI-23).
    if (raiding && guard && setOut.length < free.length) {
      const t = this.raidTarget(c, this.armyPower(setOut));
      if (!t) return;
      target = t;
    }
    // Raider splits its raid into two strike groups when it can (AI-27 a); otherwise the raid sets out as one body.
    const split = raiding && ordinary && this.rules.raidSplit ? this.splitRaid(c, setOut) : null;
    if (split) target = split[0].target;
    // Balanced and Doomsday send a strike group of fast units beside the main wave (AI-27 b): not part of the wave.
    const main = !raiding && ordinary && !launch;
    // It leaves a wave of at least STRIKE_WAVE_MIN units behind it, never a lone one, or the fast units go with the wave.
    const hitOf = main && this.rules.strikeGroup && (this.plan === 'balanced' || this.plan === 'doomsday') && this.squads.length === 0 ? this.strikeGroupOf(c, setOut, target) : null;
    const hit = hitOf && setOut.length - hitOf.units.length >= STRIKE_WAVE_MIN ? hitOf : null;
    const wave = hit ? setOut.filter((u) => !hit.units.includes(u)) : setOut;
    this.stats.waves++;
    this.lastWaveAt = c.tick;
    this.regroupAt = null;
    if (this.stats.firstWaveAt < 0) this.stats.firstWaveAt = c.tick;
    if (c.tick < RAIDER_OPENING_END) {
      this.stats.earlyWaves++;
      if (this.isEconomy(c, target)) this.stats.economyWaves++;
    }
    if (p < 0.8 * est) this.stats.suicides++;
    if (wave.length < 5) this.stats.lone++;
    const group = (kind: Wave['kind'], units: UnitSnap[], to: { tx: number; ty: number }, via: { tx: number; ty: number } | null): Wave => {
      const v = this.armyPower(units);
      const g: Wave = { kind, via, passed: false, trail: new Set(), tx: to.tx, ty: to.ty, peak: v, start: v, lastOrder: c.tick, members: new Set(units.map((u) => u.id)), size: units.length, held: false };
      // The first hop, toward its approach point if it has one (AI-26), else its target.
      const aim = via ?? to;
      const { x, y } = centre(units);
      const d = dist(x, y, aim.tx, aim.ty);
      order('attackmove', units, x + ((aim.tx - x) * Math.min(d, WAVE_HOP)) / Math.max(1, d), y + ((aim.ty - y) * Math.min(d, WAVE_HOP)) / Math.max(1, d));
      return g;
    };
    if (split) {
      // One attack in AI-14's and AI-16's counts (above); two squads, each to its own target by its own flank.
      this.stats.splitRaids++;
      this.splitBeaten = false;
      this.splitRecalled = false;
      this.squads = split.map((s) => group('raid', s.units, s.target, s.via));
      return;
    }
    // A main wave chooses its approach (AI-26); a raid, a wave timed with a charged strike and the steamroll opponent's
    // attack go straight.
    let approach: Approach = 'straight';
    let via: { tx: number; ty: number } | null = null;
    if (main && !striking && this.rules.approach) {
      ({ approach, via } = this.chooseApproach(c, target));
      this.lastApproach = approach;
      this.stats.approaches[approach]++;
      this.stats.approachLog.push(approach);
    }
    this.wave = group('wave', wave, target, via);
    if (hit) {
      const side = approach === 'left' ? 'right' : approach === 'right' ? 'left' : (this.sideOf(stage, target, hit.target) ?? 'left');
      this.stats.strikeGroups++;
      this.squads = [group('strike', hit.units, hit.target, this.flankPoint(stage, hit.target, side))];
    }
  }

  /** The strength that beat its last wave (AI-38), fading to nothing over BEATEN_MEMORY ticks; 0 with rules.regroup off. */
  private rememberedBeating(c: Ctx): number {
    const b = this.beatenBy;
    if (!b || !this.rules.regroup) return 0;
    return b.power * Math.max(0, 1 - (c.tick - b.tick) / BEATEN_MEMORY);
  }

  /**
   * The enemy's armour away from its base (AI-31): the middle, by cost, of the heavy armed enemy units it has seen in the
   * last BALL_SEEN ticks, when it is at least BALL_AWAY tiles from every enemy building it knows (the enemy start while it
   * knows none); else null.
   */
  private ballAway(c: Ctx): { x: number; y: number } | null {
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (const e of this.intel.values()) {
      const d = UNIT_DEFS[e.kind];
      if (!d?.weapon || d.armor !== 'heavy' || d.capacity !== undefined || c.tick - e.t > BALL_SEEN) continue;
      sx += (e.x / FP) * d.cost;
      sy += (e.y / FP) * d.cost;
      sw += d.cost;
    }
    if (sw === 0) return null;
    const x = sx / sw;
    const y = sy / sw;
    return this.enemyAnchors(c).every((b) => edgeDist(b, x, y) >= BALL_AWAY) ? { x, y } : null;
  }

  /**
   * A strike group at the enemy economy while its armour is away (AI-31): while the armed enemies it has seen in the last two
   * minutes are mostly heavy armour by cost (SKM-6) and their armour is away from its base (ballAway), at most once in
   * BALL_RAID_GAP ticks, the fastest of its fast units not out in a wave (FAST_SPEED; no hero), as many as stay within
   * rules.ballRaidShare of the army's value and at least STRIKE_MIN, set out at the economy target it may go for (AI-23 e)
   * that is farthest from that armour, by the flank away from it. A threat to the base does not call it home.
   */
  private ballRaid(c: Ctx, army: readonly UnitSnap[], order: Drive['order'], centre: Drive['centre']): void {
    if (c.tick - this.ballRaidAt < BALL_RAID_GAP || heavyShareByCost(this.intel.values(), c.tick) <= MOSTLY_HEAVY) return;
    const ball = this.ballAway(c);
    if (!ball) return;
    const w = this.wave;
    const fast = army.filter((u) => !w?.members.has(u.id) && unitDef(u.kind).speed >= FAST_SPEED && !unitDef(u.kind).hero).sort((a, b) => unitDef(b.kind).speed - unitDef(a.kind).speed || a.id - b.id);
    if (fast.length < STRIKE_MIN) return;
    const cap = this.rules.ballRaidShare * this.armyPower(army);
    const units: UnitSnap[] = [];
    let v = 0;
    for (const u of fast) {
      const uv = this.armyPower([u]);
      if (v + uv > cap) break;
      units.push(u);
      v += uv;
    }
    if (units.length < STRIKE_MIN) return;
    let best: { tx: number; ty: number } | null = null;
    let bd = -1;
    for (const t of this.economyTargets(c)) {
      const d = dist(t.tx, t.ty, ball.x, ball.y);
      if (d > bd && this.mayRaid(c, t, v)) {
        bd = d;
        best = t;
      }
    }
    if (!best) return;
    const stage = this.staging as { tx: number; ty: number };
    const side = this.sideOf(stage, best, { tx: ball.x, ty: ball.y }) === 'left' ? 'right' : 'left';
    const via = this.flankPoint(stage, best, side);
    this.squads = [{ kind: 'strike', ball: true, via, passed: false, trail: new Set(), tx: best.tx, ty: best.ty, peak: v, start: v, lastOrder: c.tick, members: new Set(units.map((u) => u.id)), size: units.length, held: false }];
    this.ballRaidAt = c.tick;
    this.stats.ballRaids++;
    const aim = via ?? best;
    const { x, y } = centre(units);
    const d = dist(x, y, aim.tx, aim.ty);
    order('attackmove', units, x + ((aim.tx - x) * Math.min(d, WAVE_HOP)) / Math.max(1, d), y + ((aim.ty - y) * Math.min(d, WAVE_HOP)) / Math.max(1, d));
  }

  /**
   * Raider's split raid (AI-27 a): with at least SPLIT_MIN units setting out, dealt alternately from the dearest down into
   * two squads, each worth at least rules.splitRatio times the armed enemy units it has seen within APPROACH_SEEN ticks, the first to the nearest economy target it may go for and the second to the one farthest from that, at
   * least SPLIT_APART tiles away (each judged against its own squad, AI-23 e); each by the flank on its target's side of
   * the straight line from the staging point to between the two. Null when it cannot split.
   */
  private splitRaid(c: Ctx, raid: readonly UnitSnap[]): [{ units: UnitSnap[]; target: { tx: number; ty: number }; via: { tx: number; ty: number } | null }, { units: UnitSnap[]; target: { tx: number; ty: number }; via: { tx: number; ty: number } | null }] | null {
    if (raid.length < SPLIT_MIN) return null;
    const dear = [...raid].sort((a, b) => unitDef(b.kind).cost - unitDef(a.kind).cost || a.id - b.id);
    const a = dear.filter((_, i) => i % 2 === 0);
    const b = dear.filter((_, i) => i % 2 === 1);
    // Half a raid must not meet the whole enemy army it has seen lately (nothing seen: no limit).
    const seen = this.rules.splitRatio * this.seenArmy(c, APPROACH_SEEN);
    if (this.armyPower(a) < seen || this.armyPower(b) < seen) return null;
    const targets = this.economyTargets(c);
    const t1 = targets.find((t) => this.mayRaid(c, t, this.armyPower(a)));
    if (!t1) return null;
    let t2: { tx: number; ty: number } | null = null;
    let far = SPLIT_APART;
    for (const t of targets) {
      const d = dist(t.tx, t.ty, t1.tx, t1.ty);
      if (d >= far && (t2 === null || d > far) && this.mayRaid(c, t, this.armyPower(b))) {
        far = d;
        t2 = t;
      }
    }
    if (!t2) return null;
    const stage = this.staging as { tx: number; ty: number };
    const mid = { tx: (t1.tx + t2.tx) / 2, ty: (t1.ty + t2.ty) / 2 };
    const s1 = this.sideOf(stage, mid, t1) ?? 'left';
    const s2 = s1 === 'left' ? 'right' : 'left';
    return [
      { units: a, target: t1, via: this.flankPoint(stage, t1, s1) },
      { units: b, target: t2, via: this.flankPoint(stage, t2, s2) },
    ];
  }

  /**
   * The strike group beside a main wave (AI-27 b): the fastest of the fast units setting out (FAST_SPEED; never a hero, and
   * the standing scout is no part of the army), as many as stay within rules.strikeShare of the army's value, at least
   * STRIKE_MIN; bound for the economy target it may go for that lies farthest from the wave's target. Null when there is
   * no such squad or target: the fast units go with the wave.
   */
  private strikeGroupOf(c: Ctx, setOut: readonly UnitSnap[], target: { tx: number; ty: number }): { units: UnitSnap[]; target: { tx: number; ty: number } } | null {
    const fast = setOut.filter((u) => unitDef(u.kind).speed >= FAST_SPEED && !unitDef(u.kind).hero).sort((a, b) => unitDef(b.kind).speed - unitDef(a.kind).speed || a.id - b.id);
    if (fast.length < STRIKE_MIN) return null;
    const cap = this.rules.strikeShare * this.armyPower(c.army);
    const units: UnitSnap[] = [];
    let v = 0;
    for (const u of fast) {
      const uv = this.armyPower([u]);
      if (v + uv > cap) break;
      units.push(u);
      v += uv;
    }
    if (units.length < STRIKE_MIN) return null;
    let best: { tx: number; ty: number } | null = null;
    let bd = -1;
    for (const t of this.economyTargets(c)) {
      const d = dist(t.tx, t.ty, target.tx, target.ty);
      if (d > bd && this.mayRaid(c, t, v)) {
        bd = d;
        best = t;
      }
    }
    return best ? { units, target: best } : null;
  }

  /**
   * One group's turn (AI-8, AI-11, AI-23, AI-26, AI-27): the recall, the retreat test, and every WAVE_STEP ticks a hop as
   * one body, by its approach point until its body has passed it; `pool` are the units that may join it as
   * reinforcements, or null. Returns how it ended, or null while it goes on.
   */
  private driveGroup(
    c: Ctx,
    g: Wave,
    h: Drive,
    pool: UnitSnap[] | null,
    committed: boolean,
  ): 'recalled' | 'beaten' | 'gone' | null {
    const stage = this.staging as { tx: number; ty: number };
    const { order, centre, ordinary } = h;
    const members = c.army.filter((u) => g.members.has(u.id));
    const p = this.armyPower(members);
    // Its strength counts its reinforcements: the strongest it has been (AI-23).
    g.peak = Math.max(g.peak, p);
    // Reinforcements on their way to its approach point are not yet with its body (AI-26).
    if (g.trail.size > 0) {
      const via = g.via;
      for (const id of g.trail) {
        const u = members.find((m) => m.id === id);
        if (!u || !via || dist(u.x / FP, u.y / FP, via.tx + 0.5, via.ty + 0.5) <= APPROACH_PASSED) g.trail.delete(id);
      }
    }
    let body = g.trail.size > 0 ? members.filter((u) => !g.trail.has(u.id)) : members;
    if (body.length === 0 && members.length > 0) {
      g.trail.clear();
      body = members;
    }
    const { x: cx, y: cy } = body.length ? centre(body) : { x: stage.tx, y: stage.ty };
    // The enemy force near it (AI-35, AI-36): seen within the last FRESH_SIGHT ticks, with its own defences on its side;
    // with rules.overwhelm off, everything seen in the last 1800 ticks against the group alone.
    const fresh = ordinary && this.rules.overwhelm;
    const local = fresh ? freshEnemyPower(this.intel.values(), c.enemyBuildings, c.tick, cx, cy, OVERWHELM_R) : this.enemyPowerNear(c, Math.floor(cx), Math.floor(cy), LOCAL_R);
    // On the move it judges what it sees ahead of it (toward where it is going) as well, within WAVE_SIGHT_R tiles, so it
    // turns before contact (AI-36).
    const goal = g.via && !g.passed ? g.via : { tx: g.tx, ty: g.ty };
    const before = (e: { x: number; y: number }): boolean => (e.x / FP - cx) * (goal.tx + 0.5 - cx) + (e.y / FP - cy) * (goal.ty + 0.5 - cy) > 0;
    // (A strike group slips past armies to the economy: it judges only what is about it.)
    const ahead = fresh && this.rules.xSight && g.kind !== 'strike' ? freshEnemyPower([...this.intel.values()].filter(before), [], c.tick, cx, cy, WAVE_SIGHT_R) : local;
    const swamped = fresh ? isOverwhelmed(p, defencePower(c.buildings, cx, cy, OVERWHELM_R), Math.max(local, ahead)) : local >= 1.5 * p;
    // Harassers near it (AI-39): the units that can catch them chase, or it keeps on as one body (AI-40).
    let chase: { units: Set<number>; to: { x: number; y: number } } | null = null;
    let harassed = false;
    if (ordinary && this.rules.harass && !committed && body.length > 0) {
      const foes = this.armedNear(c, cx, cy, HARASS_R);
      harassed = isHarasser(foes, body, (id) => this.kites.kited(id, c.tick));
      if (harassed) {
        const a = harassAnswer(body, foes);
        if (g.harassSince === undefined) {
          g.harassSince = c.tick;
          g.harassStart = p;
          this.stats.harassResponses[a.mode]++;
        }
        if (a.mode === 'chase') chase = { units: new Set(a.chasers.map((u) => u.id)), to: leashed({ x: cx, y: cy }, this.middle(foes), HARASS_LEASH) };
      } else g.harassSince = undefined;
    }
    if (!ordinary) {
      // The steamroll opponent never pulls a wave back (HAR-5): it drives on until the wave is gone, then forms the next.
      if (members.length === 0) return 'gone';
    } else if (this.rules.recall && !g.ball && members.length > 0 && (h.danger ??= this.baseInDanger(c, h.own))) {
      // An enemy force worth half its army near its buildings: the group comes home to fight at the hold point (AI-23).
      const holdAt = this.holdPoint(c);
      this.recallPoint = holdAt;
      order('attackmove', members, holdAt.tx, holdAt.ty);
      return 'recalled';
    } else if (members.length <= 2 || (!committed && (p <= 0.45 * (this.rules.wavePeak ? g.peak : g.start) || swamped))) {
      // A beaten or overwhelmed group falls back (AI-8, AI-23, AI-36); a strike group's units rejoin the army (AI-27).
      this.stats.retreats++;
      this.fallBack(c, g, members, Math.max(local, this.enemyPowerNear(c, Math.floor(cx), Math.floor(cy), LOCAL_R)), h);
      return 'beaten';
    } else if (harassed && g.harassSince !== undefined && c.tick - g.harassSince >= HARASS_PATIENCE && p < (g.harassStart ?? 0)) {
      // Harassers it has not pushed off in time while it still loses value: it falls back out of their range (AI-40).
      this.stats.retreats++;
      this.stats.harassResponses.fallBack++;
      this.fallBack(c, g, members, local, h);
      return 'beaten';
    } else if (members.length === 0) {
      // Nothing left of it: the next wave forms at the gathering point.
      return 'gone';
    }
    // Its body has passed its approach point once its centre is close to it (AI-26).
    if (g.via && !g.passed && dist(cx, cy, g.via.tx + 0.5, g.via.ty + 0.5) <= APPROACH_PASSED) g.passed = true;
    if (c.tick - g.lastOrder < WAVE_STEP) return null;
    // Retarget when the objective is gone or reached, and go straight to the new one (AI-26).
    const near = dist(cx, cy, g.tx, g.ty) < 6;
    const known = c.enemyBuildings.some((b) => dist(b.tx, b.ty, g.tx, g.ty) < 4);
    if (near && !known) {
      const nb = this.nearestEnemyBuilding(c, Math.floor(cx), Math.floor(cy));
      // A raid, or a strike group, moves on to the next part of the economy it knows of (AI-14, AI-27).
      const t = (this.plan === 'raider' || g.kind !== 'wave' ? this.economyTarget(c) : null) ?? (nb ? { tx: nb.tx, ty: nb.ty } : this.searchPoint(c));
      g.tx = t.tx;
      g.ty = t.ty;
      if (g.via) {
        g.via = null;
        g.trail.clear();
        body = members;
      }
    }
    g.lastOrder = c.tick;
    // Advance as one body (AI-11): the whole group attack-moves to a point a short hop ahead of its centre, so the fast
    // wait there for the slow; strung out, it closes up on its centre first; close to the objective it goes in. Until its
    // body has passed its approach point, the hops lead there (AI-26).
    // Spread: how far most of the group (four in five) is from its centre; a big group is naturally wider.
    const ds = body.map((u) => dist(u.x / FP, u.y / FP, cx, cy)).sort((a, b) => a - b);
    const spread = ds[Math.floor(0.8 * (ds.length - 1))] ?? 0;
    // A committed Doomsday wave (AI-15) does not wait for stragglers: it drives into what its strike is clearing.
    const strung = !committed && spread > WAVE_SPREAD + Math.sqrt(body.length) && !g.held;
    g.held = strung; // never hold back two hops running
    const aim = g.via && !g.passed ? g.via : { tx: g.tx, ty: g.ty };
    const d = dist(cx, cy, aim.tx, aim.ty);
    // Once its strike has landed it goes straight in, not hop by hop (AI-15).
    const struck = committed && this.lastStrike >= 0 && c.tick - this.lastStrike < STRIKE_COMMIT;
    const k = strung ? 0 : struck || d <= WAVE_HOP + 2 ? 1 : WAVE_HOP / d;
    // Chasers go after the harassers, at most HARASS_LEASH tiles from its centre; the rest keep on (AI-40).
    const moving = chase ? body.filter((u) => !chase.units.has(u.id)) : body;
    if (chase) order('attackmove', body.filter((u) => chase.units.has(u.id)), chase.to.x, chase.to.y);
    // A known enemy force near it: it advances on it in a concave, the front row stopping short of its middle (AI-42).
    // A committed Doomsday wave forms no concave: it drives into the struck target (AI-15), and any concave it held is let go.
    if (committed) this.formations = this.formations.filter((f) => !f.ids.some((id) => g.members.has(id)));
    const foe = ordinary && !strung && !committed ? this.enemyFocus(c, cx, cy) : null;
    const fd = foe ? dist(cx, cy, foe.x, foe.y) : 0;
    if (!foe || !this.formUp(c, moving, toward({ x: cx, y: cy }, foe, Math.min(WAVE_HOP, Math.max(0, fd - CONCAVE_STANDOFF))), foe, 'attackmove', WAVE_STEP)) order('attackmove', moving, cx + (aim.tx - cx) * k, cy + (aim.ty - cy) * k);
    // Reinforcements still on their way go by the approach point (AI-26).
    if (g.via && g.trail.size > 0) order('attackmove', members.filter((u) => g.trail.has(u.id) && u.dest === null), g.via.tx, g.via.ty);
    if (pool === null) return null;
    // Reinforcements gather at the gathering point and join in groups, never one at a time (AI-11); and only while the
    // group is at least as strong as the enemy it has seen near it, so none are fed into a losing fight (AI-23). Those
    // joining after its body passed its approach point go by it too (AI-26).
    const home = pool.filter((u) => dist(tileOf(u.x), tileOf(u.y), stage.tx, stage.ty) < 10);
    const join = !ordinary || !this.rules.noFeed || p >= local;
    if (join && home.length >= Math.max(3, Math.ceil(0.25 * g.size))) {
      if (g.via && g.passed) {
        order('attackmove', home, g.via.tx, g.via.ty);
        for (const u of home) g.trail.add(u.id);
      } else order('attackmove', home, cx, cy);
      for (const u of home) g.members.add(u.id);
    } else order('attackmove', pool.filter((u) => u.dest === null && !home.includes(u)), stage.tx, stage.ty);
    return null;
  }

  /**
   * A beaten group falls back (AI-8, AI-23, AI-37): to the nearest friendly strength, running or in a fighting retreat
   * (startRetreat); with rules.overwhelm off, to the staging point. A beaten wave or raid regroups there (AI-38): it
   * remembers the strength that beat it, and its army gathers at that point until the next wave sets out.
   */
  private fallBack(c: Ctx, g: Wave, members: UnitSnap[], beatenBy: number, h: Drive): void {
    const stage = this.staging as { tx: number; ty: number };
    if (members.length === 0) return;
    if (!h.ordinary || !this.rules.overwhelm) {
      h.order('move', members, stage.tx, stage.ty);
      return;
    }
    const m = this.middle(members);
    const to = this.fallbackFor(c, members, this.enemyFocus(c, m.x, m.y, OVERWHELM_R), true) as { at: { x: number; y: number }; kind: FallbackKind };
    this.startRetreat(c, members, to, h.out);
    if (this.rules.regroup && g.kind !== 'strike') {
      this.beatenBy = { power: beatenBy, tick: c.tick };
      this.regroupAt = { tx: Math.floor(to.at.x), ty: Math.floor(to.at.y) };
      this.stats.regroups++;
    }
  }

  /**
   * Its strike groups' turns (AI-27): each judged on its own. One that ends rejoins the army; a split raid ends when both its
   * squads have, counting as beaten back once if either was (AI-16). `pool`, when given, reinforces the split raid's
   * squad with fewer units left.
   */
  private driveSquads(c: Ctx, h: Drive, pool: UnitSnap[] | null): void {
    if (this.squads.length === 0) return;
    const alive = (s: Wave): number => c.army.filter((u) => s.members.has(u.id)).length;
    let takes: Wave | null = null;
    if (pool) for (const s of this.squads) if (s.kind === 'raid' && (takes === null || alive(s) < alive(takes))) takes = s;
    const raid = this.squads.some((s) => s.kind === 'raid');
    for (const s of [...this.squads]) {
      const end = this.driveGroup(c, s, h, s === takes ? pool : null, false);
      if (end === null) continue;
      this.squads = this.squads.filter((x) => x !== s);
      if (end === 'beaten') this.splitBeaten = true;
      if (end === 'recalled') this.splitRecalled = true;
    }
    // A strike group beside a main wave starts no wave cooldown (AI-27 b); a split raid's end is the raid's end.
    if (raid && !this.squads.some((s) => s.kind === 'raid')) {
      this.lastWaveEnd = c.tick;
      if (this.splitBeaten && this.doctrine.retreats && this.rules.regroup) {
        // No cooldown: the next raid waits for the strength that beat this one (AI-38).
        if (this.plan === 'raider') this.raidsLost++;
      } else if (this.splitBeaten) {
        this.waveCooldown = c.tick + 1200;
        if (this.plan === 'raider') {
          this.raidsLost++;
          this.waveCooldown = c.tick + 600;
        }
      } else if (this.splitRecalled) this.waveCooldown = c.tick + 500;
    }
  }

  /** The nearest part of the enemy economy we know of: a refinery, or a hauler seen lately (AI-14). */
  private economyTarget(c: Ctx): { tx: number; ty: number } | null {
    return this.economyTargets(c)[0] ?? null;
  }

  /**
   * The parts of the enemy economy it knows, nearest its staging point first: refineries, and haulers seen lately; or,
   * none known, the shard field nearest the enemy start (AI-14).
   */
  private economyTargets(c: Ctx): { tx: number; ty: number }[] {
    const stage = this.staging as { tx: number; ty: number };
    const all: { tx: number; ty: number; d: number; k: number }[] = [];
    const consider = (tx: number, ty: number): void => {
      all.push({ tx, ty, d: dist(tx, ty, stage.tx, stage.ty), k: all.length });
    };
    for (const b of c.enemyBuildings) if (buildingDef(b.kind).refinery) consider(b.tx + 1, b.ty + 1);
    for (const e of this.intel.values()) if (UNIT_DEFS[e.kind]?.capacity !== undefined && c.tick - e.t <= 1200) consider(tileOf(e.x), tileOf(e.y));
    if (all.length > 0) return all.sort((p, q) => p.d - q.d || p.k - q.k).map(({ tx, ty }) => ({ tx, ty }));
    // Unseen, the enemy mines the shard field nearest its start: the map shows the fields to every player (MENU-1).
    const f = this.enemyField();
    return f ? [f] : [];
  }

  private field: { tx: number; ty: number } | null | undefined;
  /** The shard tile nearest the enemy start, from the static map. */
  private enemyField(): { tx: number; ty: number } | null {
    if (this.field !== undefined) return this.field;
    const start = this.enemyStart();
    const W = this.map.width;
    let bd = Infinity;
    this.field = null;
    for (let i = 0; i < (this.map.shards?.length ?? 0); i++) {
      if (!this.map.shards?.[i]) continue;
      const d = dist(i % W, Math.floor(i / W), start.tx, start.ty);
      if (d > 3 && d < bd) {
        bd = d;
        this.field = { tx: i % W, ty: Math.floor(i / W) };
      }
    }
    return this.field;
  }

  /** Whether a target point is on the enemy economy: a known refinery or a recently seen hauler close by. */
  private isEconomy(c: Ctx, t: { tx: number; ty: number }): boolean {
    const f = this.enemyField();
    return (
      (f !== null && dist(f.tx, f.ty, t.tx, t.ty) <= 4) ||
      c.enemyBuildings.some((b) => buildingDef(b.kind).refinery && dist(b.tx + 1, b.ty + 1, t.tx, t.ty) <= 4) ||
      [...this.intel.values()].some((e) => UNIT_DEFS[e.kind]?.capacity !== undefined && c.tick - e.t <= 1200 && dist(tileOf(e.x), tileOf(e.y), t.tx, t.ty) <= 4)
    );
  }

  // ---------------------------------------------------------------- scouting

  private scout(c: Ctx, out: Command[]): void {
    const me = c.own.find((u) => u.id === this.scoutId);
    if (this.scoutId >= 0 && !me) this.scoutId = -1;
    const knowEnemy = c.enemyBuildings.length > 0;
    if (knowEnemy && this.stats.scoutedAt < 0) this.stats.scoutedAt = c.tick;
    if (!this.doctrine.scouts) return;
    const stage = this.staging as { tx: number; ty: number };
    const go = (id: number, t: { tx: number; ty: number }): void => {
      out.push({ type: 'move', player: this.player, units: [id], x: t.tx * FP + FP / 2, y: t.ty * FP + FP / 2 });
    };

    // The standing scout watches the enemy (AI-21); the old scouting below sends a new scout only while there is none (AI-17).
    this.watch(c, out);
    this.picketWatch(c, out);

    if (me) {
      // A scout is expendable until it has been hit; then it falls back with what it learned.
      const hurt = me.hp < unitDef(me.kind).hp * 0.55;
      const danger = hurt && c.foes.some((u) => unitDef(u.kind).weapon && dist(tileOf(u.x), tileOf(u.y), tileOf(me.x), tileOf(me.y)) < 9);
      const done = knowEnemy && c.tick - this.lastScout > 900;
      if (danger || done) {
        this.scoutRoute = [];
        go(me.id, stage);
        if (done || dist(tileOf(me.x), tileOf(me.y), stage.tx, stage.ty) < 8) {
          this.rejoin(me.id, c.tick);
          this.scoutId = -1;
        }
        return;
      }
      // On to the next leg of the route once this one is reached (or the unit has stopped short of it).
      const leg = this.scoutRoute[0];
      if (leg && (me.dest === null || dist(tileOf(me.x), tileOf(me.y), leg.tx, leg.ty) < 4)) {
        this.scoutRoute.shift();
        const next = this.scoutRoute[0];
        if (next) go(me.id, next);
      }
      return;
    }
    if (this.standing >= 0) return;
    const fresh = [...this.intel.values()].some((e) => UNIT_DEFS[e.kind]?.weapon && c.tick - e.t <= 900);
    const due = c.tick > (this.plan === 'raider' ? 300 : 1100) && (!knowEnemy || !fresh);
    // A scout lost before it found the enemy is replaced sooner: finding the base early matters most (AI-17).
    if (!due || c.tick - this.lastScout < (knowEnemy ? 1500 : 1000)) return;
    // A genuine scout if there is one; else the fastest unit that is not a hero (AI-17).
    const cands = c.army.filter((u) => u.dest === null && !unitDef(u.kind).hero).sort((a, b) => unitDef(b.kind).speed - unitDef(a.kind).speed || a.id - b.id);
    const pick = cands.find((u) => unitDef(u.kind).role === 'scout') ?? (c.tick > (this.plan === 'raider' ? 300 : 1500) ? cands[0] : undefined);
    if (!pick) return;
    this.scoutId = pick.id;
    this.lastScout = c.tick;
    this.startScouting(pick.id, c.tick);
    // The scout leaves the army now, so this turn's wave or gather orders do not call it back (AI-17).
    c.army = c.army.filter((u) => u.id !== pick.id);
    // Around the enemy's front rather than through it: a flank point halfway there, off to one side (AI-17).
    const target = this.enemyStart();
    const dx = target.tx - stage.tx;
    const dy = target.ty - stage.ty;
    const len = Math.max(1, Math.hypot(dx, dy));
    const side = this.scoutTrips++ % 2 === 0 ? 1 : -1;
    const W = this.map.width;
    const H = this.map.height;
    const clampX = (v: number): number => Math.max(2, Math.min(W - 3, Math.round(v)));
    const clampY = (v: number): number => Math.max(2, Math.min(H - 3, Math.round(v)));
    const flank = this.nearestFree(clampX(stage.tx + dx * 0.55 - (dy / len) * side * SCOUT_FLANK), clampY(stage.ty + dy * 0.55 + (dx / len) * side * SCOUT_FLANK));
    this.scoutRoute = [flank, target];
    go(pick.id, flank);
  }

  /** The faction's scout unit if this AI may train it (AI-21): the Scout Buggy or Stalker; none for the steamroll opponent. */
  private scoutKind(): string | null {
    if (this.options.standingScout === false) return null;
    if (this.standingKind === undefined) this.standingKind = Object.keys(UNIT_DEFS).find((k) => unitDef(k).faction === this.faction && unitDef(k).role === 'scout' && this.doctrine.trains(k)) ?? null;
    return this.standingKind;
  }

  /** Whether this AI tells Raider's scout units for its army apart from its standing scout (AI-27 a). */
  private raiderScoutRule(): boolean {
    return this.rules.raidSplit && this.personality === 'raider' && this.doctrine.scouts;
  }

  /** Which unit is the standing scout (AI-21): it notes the loss of the last one and takes up a new one once it stands. */
  private keepStanding(own: readonly UnitSnap[], tick: number): void {
    const kind = this.scoutKind();
    if (kind === null) return;
    if (this.standing >= 0 && !own.some((u) => u.id === this.standing)) {
      const life = tick - this.stats.standingSince;
      this.standing = -1;
      this.standingLostAt = tick;
      this.stats.standingLives.push(life);
      this.stats.standingSince = -1;
      // A young loss: wait longer before the next one; and the next one tours the other way round.
      this.replaceGap = life < SCOUT_YOUNG ? 2 * SCOUT_REPLACE : SCOUT_REPLACE;
      this.tourSide = -this.tourSide;
    }
    if (this.picket >= 0 && !own.some((u) => u.id === this.picket)) {
      // Its second standing scout lost (AI-21): replaced as the first is.
      const life = tick - this.picketSince;
      this.picket = -1;
      this.picketSince = -1;
      this.standingLostAt = tick;
      this.replaceGap = life < SCOUT_YOUNG ? 2 * SCOUT_REPLACE : SCOUT_REPLACE;
      this.picketFleeing = null;
      this.picketHop = null;
    }
    // Standing scouts it lacks: the touring one first, then the one watching the way between the bases (AI-21).
    const open = (): number => (this.standing < 0 ? 1 : 0) + (this.rules.twoScouts && this.picket < 0 ? 1 : 0);
    const fresh: UnitSnap[] = [];
    if (this.raiderScoutRule()) {
      // Raider's scout units (AI-27 a): one that comes out while a standing scout is ordered becomes a standing scout;
      // any other belongs to the army, and never becomes a standing scout.
      for (const id of this.armyScouts) if (!own.some((u) => u.id === id)) this.armyScouts.delete(id);
      for (const u of [...own].sort((a, b) => a.id - b.id)) {
        if (u.kind !== kind || u.id === this.standing || u.id === this.picket || u.id === this.scoutId || this.armyScouts.has(u.id)) continue;
        if (open() - fresh.length > 0 && this.standingOrdered > 0) {
          this.standingOrdered--;
          fresh.push(u);
        } else {
          this.armyScouts.add(u.id);
          this.stats.raiderScouts++;
        }
      }
    } else if (open() > 0) {
      fresh.push(...own.filter((u) => u.kind === kind && u.id !== this.standing && u.id !== this.picket).sort((a, b) => a.id - b.id).slice(0, open()));
    }
    for (const u of fresh) {
      if (this.standing < 0) this.takeStanding(u, tick);
      else {
        this.picket = u.id;
        this.picketSince = tick;
        this.picketFleeing = null;
        this.picketHop = null;
        if (u.id === this.scoutId) {
          this.scoutId = -1;
          this.scoutRoute = [];
        }
        this.startScouting(u.id, tick);
      }
    }
  }

  /** Its second standing scout's unit id, or -1 (AI-21): for tests and measurement only. */
  get pickedScout(): number {
    return this.picket;
  }

  /**
   * Where its second standing scout watches the way between the bases (AI-21): PICKET_ALONG of the way from its staging
   * point to the enemy start, PICKET_SIDE tiles to one side (the left, seen along the way; the right when that is off the
   * map), on open ground.
   */
  picketPost(): { tx: number; ty: number } {
    const stage = this.staging as { tx: number; ty: number };
    const to = this.enemyStart();
    const W = this.map.width;
    const H = this.map.height;
    const dx = to.tx - stage.tx;
    const dy = to.ty - stage.ty;
    const len = Math.hypot(dx, dy) || 1;
    for (const s of [1, -1]) {
      const x = Math.round(stage.tx + dx * this.rules.picketAlong + (s * dy * PICKET_SIDE) / len);
      const y = Math.round(stage.ty + dy * this.rules.picketAlong - (s * dx * PICKET_SIDE) / len);
      if (x >= 1 && y >= 1 && x < W - 1 && y < H - 1) return this.nearestFree(x, y);
    }
    return this.nearestFree(Math.round(stage.tx + dx * this.rules.picketAlong), Math.round(stage.ty + dy * this.rules.picketAlong));
  }

  /**
   * Its second standing scout (AI-21) watches the way between the bases from its post (picketPost). It flees from threats
   * as the first does (an armed enemy unit within scoutKeep tiles, a defence within SCOUT_DANGER), and otherwise goes back
   * to its post in hops of at most SCOUT_HOP tiles, waiting where the next hop would take it onto ground closed to it
   * (near an armed unit seen lately or the enemy base).
   */
  private picketWatch(c: Ctx, out: Command[]): void {
    const me = c.own.find((u) => u.id === this.picket);
    if (!me) return;
    const W = this.map.width;
    const H = this.map.height;
    const stage = this.staging as { tx: number; ty: number };
    const x = me.x / FP;
    const y = me.y / FP;
    const move = (p: { tx: number; ty: number }): void => {
      out.push({ type: 'move', player: this.player, units: [me.id], x: p.tx * FP + FP / 2, y: p.ty * FP + FP / 2 });
    };
    const at = (p: { tx: number; ty: number }): number => dist(x, y, p.tx + 0.5, p.ty + 0.5);
    const sight = unitDef(me.kind).vision;
    const armed = c.foes.filter((u) => unitDef(u.kind).weapon && dist(u.x / FP, u.y / FP, x, y) <= Math.max(sight, scoutKeep(u.kind))).map((u) => ({ x: u.x / FP, y: u.y / FP, r: scoutKeep(u.kind) }));
    const defences = c.enemyBuildings.filter((b) => buildingDef(b.kind).weapon && edgeDist(b, x, y) <= SCOUT_DANGER).map((b) => ({ x: b.tx + buildingDef(b.kind).w / 2, y: b.ty + buildingDef(b.kind).h / 2 }));
    if (armed.some((u) => dist(u.x, u.y, x, y) <= u.r) || defences.length > 0) {
      const target = this.fleeFrom(x, y, [...armed, ...defences], stage);
      const f = this.picketFleeing;
      this.picketHop = null;
      if (f && me.dest !== null && at(f) > 1.5 && !this.turned(x, y, f, target)) return;
      this.picketFleeing = target;
      return move(target);
    }
    this.picketFleeing = null;
    const post = this.picketPost();
    const d = at(post);
    if (d < 2.5) return;
    // A new hop once it has nearly reached the last one, or stopped short of it.
    const hop = this.picketHop;
    const last = this.picketAt;
    this.picketAt = { x: me.x, y: me.y };
    const moving = last !== null && (last.x !== me.x || last.y !== me.y);
    if (hop && me.dest !== null && moving && at(hop) > 1) return;
    // Its way there round the ground closed to it (as the first scout's, AI-21); none: it waits.
    const here = { tx: Math.max(0, Math.min(W - 1, Math.floor(x))), ty: Math.max(0, Math.min(H - 1, Math.floor(y))) };
    const route = this.safeWays(here, this.scoutGround(c))(post);
    if (!route) return;
    let next = route[route.length - 1] as number;
    for (const i of route) {
      if (dist((i % W) + 0.5, Math.floor(i / W) + 0.5, x, y) > SCOUT_HOP) break;
      next = i;
    }
    const p = { tx: next % W, ty: Math.floor(next / W) };
    if (p.tx === here.tx && p.ty === here.ty) return;
    this.picketHop = p;
    move(p);
  }

  /** A scout unit becomes its touring standing scout (AI-21). */
  private takeStanding(next: UnitSnap, tick: number): void {
    this.standing = next.id;
    this.stats.standingSince = tick;
    this.scoutGoal = null;
    this.scoutHop = null;
    this.fleeing = null;
    // It starts at a flank of the enemy base, not the side facing us.
    this.tourIdx = 1;
    this.tourDir = 1;
    // A scout unit out on the old scouting route becomes the standing scout.
    if (next.id === this.scoutId) {
      this.scoutId = -1;
      this.scoutRoute = [];
    }
    this.startScouting(next.id, tick);
  }

  /** Its standing scout's tour and the point it heads for (AI-21): for tests only. */
  get scoutPlan(): { tour: readonly { tx: number; ty: number }[]; goal: { tx: number; ty: number } | null } {
    return { tour: this.tour, goal: this.scoutGoal };
  }

  /** The enemy buildings it knows, or, while it knows none, the enemy HQ at the start read off the symmetric map. */
  private enemyAnchors(c: Ctx): { kind: string; tx: number; ty: number }[] {
    if (c.enemyBuildings.length > 0) return c.enemyBuildings;
    const start = this.enemyStart();
    return [{ kind: this.kit.hq, tx: start.tx - 1, ty: start.ty - 1 }];
  }

  /** Armed enemy units it has seen within SCOUT_MEMORY ticks, where it saw them (tiles). */
  private armedSeen(c: Ctx): { x: number; y: number; r: number }[] {
    const out: { x: number; y: number; r: number }[] = [];
    for (const e of this.intel.values()) if (UNIT_DEFS[e.kind]?.weapon && c.tick - e.t <= SCOUT_MEMORY) out.push({ x: e.x / FP, y: e.y / FP, r: scoutKeep(e.kind) });
    return out;
  }

  /**
   * The ground closed to the scout (AI-21), by tile: within scoutKeep tiles of an armed enemy unit seen lately, or within
   * SCOUT_STANDOFF - 1 tiles of an enemy building it knows (which covers every defence's SCOUT_DANGER); and the tiles it
   * cannot cross (rock, water, buildings).
   */
  private scoutGround(c: Ctx): { danger: Uint8Array; solid: Uint8Array } {
    const W = this.map.width;
    const H = this.map.height;
    const danger = new Uint8Array(W * H);
    const solid = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) if (this.map.blocked?.[i]) solid[i] = 1;
    for (const b of [...c.snap.buildings, ...c.snap.ghosts]) {
      const d = buildingDef(b.kind);
      for (let y = b.ty; y < b.ty + d.h; y++) for (let x = b.tx; x < b.tx + d.w; x++) if (x >= 0 && y >= 0 && x < W && y < H) solid[y * W + x] = 1;
    }
    const mark = (x0: number, y0: number, x1: number, y1: number, near: (x: number, y: number) => boolean): void => {
      for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.ceil(y1)); y++)
        for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, Math.ceil(x1)); x++) if (near(x + 0.5, y + 0.5)) danger[y * W + x] = 1;
    };
    for (const b of this.enemyAnchors(c)) {
      const d = buildingDef(b.kind);
      const r = SCOUT_STANDOFF - 1;
      mark(b.tx - r, b.ty - r, b.tx + d.w + r, b.ty + d.h + r, (x, y) => edgeDist(b, x, y) <= r);
    }
    for (const e of this.armedSeen(c)) mark(e.x - e.r, e.y - e.r, e.x + e.r, e.y + e.r, (x, y) => dist(x, y, e.x, e.y) <= e.r);
    return { danger, solid };
  }

  /**
   * The scout's ways from tile `from` (AI-21), round the ground closed to it: one shortest-path search over open tiles
   * (closed ground is impassable, or, when it starts inside it, costs dearly), then the way to any tile. A way is null
   * when there is none, or when it enters closed ground after leaving it. Deterministic: ties go to the lower tile index.
   */
  private safeWays(from: { tx: number; ty: number }, g: { danger: Uint8Array; solid: Uint8Array }): (to: { tx: number; ty: number }) => number[] | null {
    const W = this.map.width;
    const H = this.map.height;
    const N = W * H;
    const s = from.ty * W + from.tx;
    const inside = g.danger[s] === 1;
    // Work arrays, kept between searches; the ways returned hold until the next search.
    const b = (this.searchBuf ??= { cost: new Float64Array(N), prev: new Int32Array(N), done: new Uint8Array(N), heap: new Int32Array(8 * N + 8), key: new Float64Array(8 * N + 8) });
    const { cost, prev, done, heap, key } = b;
    cost.fill(Infinity);
    prev.fill(-1);
    done.fill(0);
    // A binary heap of tiles by cost, then tile index.
    let size = 0;
    const less = (a: number, b: number): boolean => (key[a] as number) < (key[b] as number) || ((key[a] as number) === (key[b] as number) && (heap[a] as number) < (heap[b] as number));
    const swap = (a: number, b: number): void => {
      const h = heap[a] as number;
      heap[a] = heap[b] as number;
      heap[b] = h;
      const k = key[a] as number;
      key[a] = key[b] as number;
      key[b] = k;
    };
    const push = (pr: number, i: number): void => {
      heap[size] = i;
      key[size] = pr;
      let k = size++;
      while (k > 0 && less(k, (k - 1) >> 1)) {
        swap(k, (k - 1) >> 1);
        k = (k - 1) >> 1;
      }
    };
    const pop = (): number => {
      const top = heap[0] as number;
      size--;
      heap[0] = heap[size] as number;
      key[0] = key[size] as number;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        let m = k;
        if (l < size && less(l, m)) m = l;
        if (l + 1 < size && less(l + 1, m)) m = l + 1;
        if (m === k) break;
        swap(m, k);
        k = m;
      }
      return top;
    };
    cost[s] = 0;
    push(0, s);
    while (size > 0) {
      const i = pop();
      if (done[i]) continue;
      done[i] = 1;
      const x = i % W;
      const y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (g.solid[j] || done[j]) continue;
          if (g.danger[j] && !inside) continue;
          // No corner cutting past solid tiles.
          if (dx !== 0 && dy !== 0 && (g.solid[y * W + nx] || g.solid[ny * W + x])) continue;
          const nc = (cost[i] as number) + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1) + (g.danger[j] ? 50 : 0);
          if (nc < (cost[j] as number)) {
            cost[j] = nc;
            prev[j] = i;
            push(nc, j);
          }
        }
    }
    return (to) => {
      const t = to.ty * W + to.tx;
      if (!done[t] || g.danger[t]) return null;
      const path: number[] = [];
      for (let i = t; i !== -1; i = prev[i] as number) path.push(i);
      path.reverse();
      let out = !inside;
      for (const i of path) {
        if (!g.danger[i]) out = true;
        else if (out) return null;
      }
      return path;
    };
  }

  /**
   * The standing scout's observation points (AI-21): around the enemy base, SCOUT_STANDOFF tiles out from every enemy
   * building it knows (from the enemy start, read off the symmetric map, while it knows none), along seven compass
   * directions: every one but the one facing us, where the enemy gathers and its waves set out. In order round the base
   * from one side of the front to the other; which side comes first flips after each lost scout.
   */
  private tourPoints(c: Ctx): { tx: number; ty: number }[] {
    const home = this.home as { tx: number; ty: number };
    const W = this.map.width;
    const H = this.map.height;
    const anchors = this.enemyAnchors(c);
    const cx = anchors.reduce((t, b) => t + b.tx + buildingDef(b.kind).w / 2, 0) / anchors.length;
    const cy = anchors.reduce((t, b) => t + b.ty + buildingDef(b.kind).h / 2, 0) / anchors.length;
    const clear = (x: number, y: number): boolean => anchors.every((b) => edgeDist(b, x + 0.5, y + 0.5) >= SCOUT_STANDOFF);
    const fx = home.tx - cx;
    const fy = home.ty - cy;
    let facing = 0;
    RING.forEach((d, i) => {
      const f = RING[facing] as readonly [number, number];
      if (d[0] * fx + d[1] * fy > f[0] * fx + f[1] * fy) facing = i;
    });
    const out: { tx: number; ty: number }[] = [];
    for (let k = 1; k < RING.length; k++) {
      const [dx, dy] = RING[(facing + RING.length + k * this.tourSide) % RING.length] as readonly [number, number];
      for (let r = SCOUT_STANDOFF; r <= 40; r++) {
        const x = Math.max(1, Math.min(W - 2, Math.round(cx + dx * r)));
        const y = Math.max(1, Math.min(H - 2, Math.round(cy + dy * r)));
        if (!clear(x, y)) continue;
        const p = this.nearestFree(x, y);
        if (clear(p.tx, p.ty) && !out.some((q) => q.tx === p.tx && q.ty === p.ty)) out.push(p);
        break;
      }
    }
    return out;
  }

  /**
   * The standing scout's orders (AI-21). It watches rather than fights:
   * - with an armed enemy unit within scoutKeep tiles (SCOUT_KEEP, or beyond its guns' reach) or a defence within SCOUT_DANGER, whatever its health, it flees
   *   SCOUT_FLEE tiles straight away from the armed enemies it sees (turning up to 90 degrees round rock or water), and
   *   afterwards tours the other way round;
   * - otherwise it tours its observation points to and fro, moving on when it reaches one, skipping those it cannot reach
   *   without crossing ground closed to it (near an armed unit seen lately or near the enemy base), or its staging point;
   * - it moves in hops of at most SCOUT_HOP tiles along its way round the closed ground, so it decides again before it can
   *   drive into guns it has not seen.
   */
  private watch(c: Ctx, out: Command[]): void {
    const me = c.own.find((u) => u.id === this.standing);
    if (!me) return;
    const stage = this.staging as { tx: number; ty: number };
    const x = me.x / FP;
    const y = me.y / FP;
    const move = (p: { tx: number; ty: number }): void => {
      out.push({ type: 'move', player: this.player, units: [me.id], x: p.tx * FP + FP / 2, y: p.ty * FP + FP / 2 });
    };
    const at = (p: { tx: number; ty: number }): number => dist(x, y, p.tx + 0.5, p.ty + 0.5);
    const sight = unitDef(me.kind).vision;

    // Threats, whatever its health: armed units within scoutKeep tiles, defences within SCOUT_DANGER.
    const armed = c.foes.filter((u) => unitDef(u.kind).weapon && dist(u.x / FP, u.y / FP, x, y) <= Math.max(sight, scoutKeep(u.kind))).map((u) => ({ x: u.x / FP, y: u.y / FP, r: scoutKeep(u.kind) }));
    const defences = c.enemyBuildings.filter((b) => buildingDef(b.kind).weapon && edgeDist(b, x, y) <= SCOUT_DANGER).map((b) => ({ x: b.tx + buildingDef(b.kind).w / 2, y: b.ty + buildingDef(b.kind).h / 2 }));
    if (armed.some((u) => dist(u.x, u.y, x, y) <= u.r) || defences.length > 0) {
      if (!this.fleeing) this.tourDir = -this.tourDir;
      const target = this.fleeFrom(x, y, [...armed, ...defences], stage);
      // Decided afresh every time; a new order only when the way to flee has turned (or it has got there).
      const f = this.fleeing;
      this.scoutHop = null;
      this.scoutGoal = null;
      this.way = null;
      if (f && me.dest !== null && at(f) > 1.5 && !this.turned(x, y, f, target)) return;
      this.fleeing = target;
      return move(target);
    }
    this.fleeing = null;
    this.tourOn(c, me, x, y, move, at);
  }

  /** Whether the way to flee has turned (AI-21): the new point lies more than about 30 degrees off the old one, seen from (x, y). */
  private turned(x: number, y: number, f: { tx: number; ty: number }, target: { tx: number; ty: number }): boolean {
    const ax = f.tx + 0.5 - x;
    const ay = f.ty + 0.5 - y;
    const bx = target.tx + 0.5 - x;
    const by = target.ty + 0.5 - y;
    return (ax * bx + ay * by) / ((Math.hypot(ax, ay) || 1) * (Math.hypot(bx, by) || 1)) <= 0.87;
  }

  /**
   * Where a scout at (x, y) flees to (AI-21): SCOUT_FLEE tiles straight away from the threats `from` (the nearest counting
   * most), turning off by 45 and then 90 degrees either way round rock or water, to a point farther from them; else its
   * staging point.
   */
  private fleeFrom(x: number, y: number, from: readonly { x: number; y: number }[], stage: { tx: number; ty: number }): { tx: number; ty: number } {
    const W = this.map.width;
    const H = this.map.height;
    {
      const cx = from.reduce((t, p) => t + p.x, 0) / from.length;
      const cy = from.reduce((t, p) => t + p.y, 0) / from.length;
      const nearest = (px: number, py: number): number => Math.min(...from.map((p) => dist(p.x, p.y, px, py)));
      // Away from what it sees, the nearest counting most.
      let ux = 0;
      let uy = 0;
      for (const p of from) {
        const d2 = Math.max(0.25, (x - p.x) ** 2 + (y - p.y) ** 2);
        ux += (x - p.x) / d2;
        uy += (y - p.y) / d2;
      }
      if (Math.hypot(ux, uy) < 1e-6) {
        ux = x - cx || stage.tx + 0.5 - x;
        uy = y - cy || stage.ty + 0.5 - y;
      }
      const l = Math.hypot(ux, uy) || 1;
      ux /= l;
      uy /= l;
      const C = Math.SQRT1_2;
      // Straight away first, then turning off by 45 and 90 degrees either way.
      const turns: [number, number][] = [[1, 0], [C, C], [C, -C], [0, 1], [0, -1]];
      const open = (px: number, py: number): boolean => {
        const tx = Math.floor(px);
        const ty = Math.floor(py);
        return tx >= 0 && ty >= 0 && tx < W && ty < H && !this.map.blocked?.[ty * W + tx];
      };
      let to: { tx: number; ty: number } | null = null;
      for (const [cs, sn] of turns) {
        const dx = ux * cs - uy * sn;
        const dy = ux * sn + uy * cs;
        let ok = true;
        for (let k = 1; k <= 2 * SCOUT_FLEE && ok; k++) ok = open(x + (dx * k) / 2, y + (dy * k) / 2);
        const px = x + dx * SCOUT_FLEE;
        const py = y + dy * SCOUT_FLEE;
        if (ok && nearest(px, py) > nearest(x, y)) {
          to = { tx: Math.floor(px), ty: Math.floor(py) };
          break;
        }
      }
      return to ?? stage;
    }
  }

  /** The standing scout's tour (AI-21), in hops along its way round the closed ground. */
  private tourOn(c: Ctx, me: UnitSnap, x: number, y: number, move: (p: { tx: number; ty: number }) => void, at: (p: { tx: number; ty: number }) => number): void {
    const W = this.map.width;
    const H = this.map.height;
    const stage = this.staging as { tx: number; ty: number };
    // Touring, in hops along its way round the closed ground.
    const ground = this.scoutGround(c);
    const here = { tx: Math.max(0, Math.min(W - 1, Math.floor(x))), ty: Math.max(0, Math.min(H - 1, Math.floor(y))) };
    const tour = (this.tour = this.tourPoints(c));
    let route: number[] | null = null;
    const goal = this.scoutGoal;
    const key = (p: { tx: number; ty: number }): number => p.ty * W + p.tx;
    // Its way there, from the tile of it nearest the scout, while every tile on it is still open; else a new way.
    const kept = (): number[] | null => {
      const wy = this.way;
      if (!wy || ground.danger[key(here)]) return null;
      let k = 0;
      wy.forEach((i, n) => {
        if (dist((i % W) + 0.5, Math.floor(i / W) + 0.5, x, y) < dist(((wy[k] as number) % W) + 0.5, Math.floor((wy[k] as number) / W) + 0.5, x, y)) k = n;
      });
      const rest = wy.slice(k);
      return rest.every((i) => !ground.solid[i] && !ground.danger[i]) ? rest : null;
    };
    let ways: ((to: { tx: number; ty: number }) => number[] | null) | null = null;
    const find = (p: { tx: number; ty: number }): number[] | null => {
      if (this.waysFailed > c.tick) return null;
      ways ??= this.safeWays(here, ground);
      return ways(p);
    };
    if (goal && at(goal) >= 2.5) route = kept() ?? find(goal);
    if (!route) {
      // Reached it, or it cannot get there safely: the next point it can reach, to and fro round the base.
      this.scoutGoal = null;
      this.scoutHop = null;
      const n = tour.length;
      if (this.tourIdx >= n) this.tourIdx = n - 1;
      for (let k = 0; k < 2 * n && !route; k++) {
        if (goal !== null || k > 0) {
          if (this.tourIdx + this.tourDir < 0 || this.tourIdx + this.tourDir >= n) this.tourDir = -this.tourDir;
          this.tourIdx = Math.max(0, Math.min(n - 1, this.tourIdx + this.tourDir));
        }
        const p = tour[this.tourIdx];
        if (!p || at(p) < 2.5) continue;
        route = find(p);
        if (route) this.scoutGoal = p;
      }
      if (!route) {
        // Nowhere safe to go: back to its staging point.
        this.scoutGoal = stage;
        route = at(stage) >= 2.5 ? find(stage) : null;
        if (!route) {
          if (ways) this.waysFailed = c.tick + 100;
          if (at(stage) >= 2.5 && me.dest === null) move(stage);
          return;
        }
      }
    }
    // A new hop once it has nearly reached the last one (or stopped): the tile along the way just past where its next
    // decision will find it, at most SCOUT_HOP tiles on.
    this.way = route;
    const hop = this.scoutHop;
    const reach = Math.min(SCOUT_HOP, (unitDef(me.kind).speed * this.diff.thinkEvery) / FP + 1);
    if (hop && me.dest !== null && at(hop) > reach - (unitDef(me.kind).speed * this.diff.thinkEvery) / FP && at(hop) > 1) return;
    let next = route[route.length - 1] as number;
    for (const i of route) {
      if (dist((i % W) + 0.5, Math.floor(i / W) + 0.5, x, y) > reach) break;
      next = i;
    }
    const p = { tx: next % W, ty: Math.floor(next / W) };
    if (p.tx === here.tx && p.ty === here.ty) return;
    this.scoutHop = p;
    move(p);
  }

  // ---------------------------------------------------------------- upkeep

  private maintain(c: Ctx, out: Command[]): void {
    for (const b of c.buildings) {
      const d = buildingDef(b.kind);
      const hot = c.foes.some((u) => unitDef(u.kind).weapon && dist(tileOf(u.x), tileOf(u.y), b.tx, b.ty) <= 9);
      if (!d.hq && b.hp < d.hp * 0.18 && hot) {
        out.push({ type: 'sell', player: this.player, building: b.id }); // salvage what we can
      } else if (!hot && b.hp < d.hp * 0.75 && !b.repairing && c.credits > 350) {
        out.push({ type: 'repair', player: this.player, building: b.id, on: true });
      }
    }
  }

  /**
   * The best place for a superweapon strike: the most enemy value within its radius, never near our own units or
   * buildings. `near` limits it to around a point; `defences` counts defences double (AI-15).
   */
  private bestStrike(c: Ctx, sw: BuildingSnap, near: { tx: number; ty: number; r: number } | null, defences = false): { tx: number; ty: number } | null {
    const radius = (buildingDef(sw.kind).superweapon as { radius: number }).radius;
    let best: { tx: number; ty: number } | null = null;
    let bs = 500;
    for (const t of c.enemyBuildings) {
      if (near && dist(t.tx, t.ty, near.tx, near.ty) > near.r) continue;
      let score = 0;
      for (const o of c.enemyBuildings) if (dist(o.tx, o.ty, t.tx, t.ty) <= radius) score += buildingDef(o.kind).cost * (defences && buildingDef(o.kind).weapon ? 2 : 1);
      for (const e of this.intel.values()) if (c.tick - e.t < 300 && dist(tileOf(e.x), tileOf(e.y), t.tx, t.ty) <= radius) score += (UNIT_DEFS[e.kind]?.cost ?? 0) * 0.5;
      // Never hit ourselves.
      const friendly = c.own.some((u) => dist(tileOf(u.x), tileOf(u.y), t.tx, t.ty) <= radius + 2) || c.buildings.some((b) => dist(b.tx, b.ty, t.tx, t.ty) <= radius + 3);
      if (!friendly && score > bs) {
        bs = score;
        best = { tx: t.tx + 1, ty: t.ty + 1 };
      }
    }
    return best;
  }

  /** The densest enemy army seen lately within STRIKE_LEAD tiles of the wave, if it is worth a strike (AI-15). */
  private fieldStrike(c: Ctx, sw: BuildingSnap, mid: { x: number; y: number }): { tx: number; ty: number } | null {
    const radius = (buildingDef(sw.kind).superweapon as { radius: number }).radius;
    const foes = [...this.intel.values()].filter((e) => UNIT_DEFS[e.kind]?.weapon && c.tick - e.t < 100 && dist(tileOf(e.x), tileOf(e.y), mid.x, mid.y) <= STRIKE_LEAD);
    let best: { tx: number; ty: number } | null = null;
    let bs = 1200;
    for (const f of foes) {
      const tx = tileOf(f.x);
      const ty = tileOf(f.y);
      const score = foes.reduce((s, e) => (dist(tileOf(e.x), tileOf(e.y), tx, ty) <= radius ? s + (UNIT_DEFS[e.kind]?.cost ?? 0) : s), 0);
      if (score > bs && !this.nearFriendly(c, sw, tx, ty)) {
        bs = score;
        best = { tx, ty };
      }
    }
    return best;
  }

  private nearFriendly(c: Ctx, sw: BuildingSnap, tx: number, ty: number): boolean {
    const radius = (buildingDef(sw.kind).superweapon as { radius: number }).radius;
    return c.own.some((u) => dist(tileOf(u.x), tileOf(u.y), tx, ty) <= radius + 2) || c.buildings.some((b) => dist(b.tx, b.ty, tx, ty) <= radius + 3);
  }

  private superweapon(c: Ctx, out: Command[]): void {
    const w = this.wave;
    const members = w ? c.army.filter((u) => w.members.has(u.id)) : [];
    const mid = members.length ? { x: members.reduce((s, u) => s + u.x, 0) / members.length / FP, y: members.reduce((s, u) => s + u.y, 0) / members.length / FP } : null;
    // How soon after the first strike its army (three units or more) reached the struck area (AI-15).
    const struck = this.strike;
    if (struck && this.stats.strikeArrival < 0 && c.army.filter((u) => dist(u.x / FP, u.y / FP, struck.tx, struck.ty) <= 8).length >= 3) this.stats.strikeArrival = c.tick - this.stats.strikeAt;
    if (struck && this.stats.strikeArrival < 0 && c.tick - this.stats.strikeAt >= 200 && !this.strikeNoted) {
      this.strikeNoted = true;
      const ds = c.army.map((u) => dist(u.x / FP, u.y / FP, struck.tx, struck.ty)).sort((a, b) => a - b);
      this.stats.strikeNotes.push(`A:wave${w ? members.length : '-'}:d3=${(ds[2] ?? -1).toFixed(0)}:army${c.army.length}:retr${this.retreats.length}`);
    }
    const sw = c.buildings.find((b) => buildingDef(b.kind).superweapon && b.charge >= 100);
    if (!sw) return;
    let best: { tx: number; ty: number } | null = null;
    if (this.plan === 'doomsday') {
      // Hold the charged weapon until the wave is about to arrive, then clear the defences in its path (AI-15).
      if (this.chargedAt < 0) this.chargedAt = c.tick;
      // It holds for STRIKE_HOLD, and longer (up to STRIKE_HOLD_MAX) while no wave is out yet or its wave is still closing
      // in: a strike with no army arriving behind it is the plan wasted (AI-15).
      const gap = w && mid ? dist(mid.x, mid.y, w.tx, w.ty) : Infinity;
      if (!w || gap < this.closest - STRIKE_CLOSING) {
        this.closest = gap;
        this.closingAt = c.tick;
      }
      const closing = !w || c.tick - this.closingAt < STRIKE_HOLD / 3;
      const waiting = c.tick - this.chargedAt < STRIKE_HOLD || (closing && c.tick - this.chargedAt < STRIKE_HOLD_MAX);
      if (w && mid) {
        // An enemy army standing in the wave's way is struck first; otherwise the defences at its objective.
        best = this.fieldStrike(c, sw, mid);
        if (!best && dist(mid.x, mid.y, w.tx, w.ty) > STRIKE_LEAD && waiting) return;
        best ??= this.bestStrike(c, sw, { tx: w.tx, ty: w.ty, r: 8 }, true);
        // Nothing known there: strike the wave's objective itself, which every player can read off the map.
        if (!best && !this.nearFriendly(c, sw, w.tx, w.ty)) best = { tx: w.tx, ty: w.ty };
      }
      if (!best && waiting) return;
    }
    best ??= this.bestStrike(c, sw, null);
    if (!best) return;
    if (this.plan === 'doomsday' && this.stats.strikeNotes.length < 12) this.stats.strikeNotes.push(`S${c.tick}:wave${members.length}:d${mid ? dist(mid.x, mid.y, best.tx, best.ty).toFixed(0) : '-'}:w${w ? `${w.tx},${w.ty}` : '-'}:b${best.tx},${best.ty}:held${c.tick - this.chargedAt}`);
    this.stats.superweaponShots++;
    this.chargedAt = -1;
    this.closest = Infinity;
    this.lastStrike = c.tick;
    // The wave goes straight into the struck area, to arrive while the defenders reel (AI-15).
    const doomsday = this.plan === 'doomsday';
    (doomsday ? this.first : out).push({ type: 'superweapon', player: this.player, building: sw.id, x: best.tx * FP + FP / 2, y: best.ty * FP + FP / 2 });
    if (doomsday && w && members.length) {
      w.tx = best.tx;
      w.ty = best.ty;
      // Straight into the struck area (AI-15, AI-26).
      w.via = null;
      w.trail.clear();
      w.lastOrder = c.tick;
      // No concave (AI-42) holds its units back from the struck area.
      this.formations = this.formations.filter((f) => !f.ids.some((id) => w.members.has(id)));
      this.first.push({ type: 'attackmove', player: this.player, units: members.map((u) => u.id), x: best.tx * FP + FP / 2, y: best.ty * FP + FP / 2 });
    }
    if (this.stats.strikeAt < 0) {
      this.stats.strikeAt = c.tick;
      this.strike = best;
    }
  }
}
