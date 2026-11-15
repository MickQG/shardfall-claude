import { BUILDING_DEFS, buildingDef, canCrush, choosePad, UNIT_DEFS, unitDef, type Faction, type UnitDef } from '../data/defs';
import { BUILD_RANGE, canPlace, EXPLORED, FP, QUEUE_MAX, Rng, VISIBLE, type BuildingSnap, type Command, type MapDef, type Snapshot, type UnitSnap } from '../sim';
import { kitOf, type Kit } from './kit';

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
  easy: { name: 'easy', thinkEvery: 80, maxCommands: 2, bonus: -20 },
  medium: { name: 'medium', thinkEvery: 30, maxCommands: 5, bonus: 0 },
  hard: { name: 'hard', thinkEvery: 8, maxCommands: 12, bonus: 30 },
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
/** Doomsday holds a charged superweapon at most this long (ticks) for its wave before it fires anyway. */
export const STRIKE_HOLD = 20 * 90;
/** Doomsday goes for its superweapon only with an army worth this much and this many haulers working (AI-15). */
export const SUPERWEAPON_ARMY = 5000;
export const SUPERWEAPON_HAULERS = 5;
/** Doomsday sizes its rifle floor on enemy infantry seen within this many ticks (AI-15): "lately", not everything it has seen since the sight lingers (FOG-7). */
export const RIFLE_INTEL = 20 * 30;
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
/** How far (tiles) its observation points around the enemy base stand from the enemy buildings it knows (AI-21). */
export const SCOUT_STANDOFF = 9;
/** It backs away from any armed enemy unit or defence this close (tiles), whatever its health (AI-21). */
export const SCOUT_DANGER = 8;
/** How long (ticks) a sighting of an armed enemy unit keeps an observation point, and the way to it, unsafe (AI-21). */
export const SCOUT_MEMORY = 20 * 60;
/**
 * Economy and production scale (AI-22). It takes further fields once both home fields have a refinery and it has this
 * many haulers.
 */
export const EXPAND_HAULERS = 5;
/** A field on which it has seen an enemy army or defence within this many ticks is skipped (AI-22). */
export const FIELD_INTEL = 20 * 60;
/** Remembered enemy strength (cost) on a field, or on the way to it, that counts as an army; as economy() uses (AI-18). */
export const ARMY_NEAR = 150;
/** It stops building toward a field while it has seen an enemy army on the way within this many ticks (AI-22). */
export const WAY_INTEL = 20 * 20;
/** Haulers for each refinery, and for one at a field of more than BIG_FIELD shard tiles (AI-22). */
export const HAULERS_PER_REFINERY = 3;
export const HAULERS_PER_BIG = 4;
export const BIG_FIELD = 30;
/** A barracks or factory is added when every one is busy and it can pay for it with this much to spare, up to GROWTH_MAX of each (AI-22). */
export const GROWTH_SPARE = 500;
export const GROWTH_MAX = 5;
/** A refinery whose centre stands farther than this (tiles) from the HQ centre is outside the base and gets a turret (AI-22). */
export const OUTPOST = 16;
/** A refinery counts as guarded with an own turret this close (tiles) to it, and its turret goes this close (AI-22). */
export const GUARD_R = 6;

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

/** Distance from point (px, py) to the segment from (ax, ay) to (bx, by). */
const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2)) : 0;
  return Math.hypot(px - ax - t * vx, py - ay - t * vy);
};

/** Distance (tiles) from a point to the nearest part of a building's footprint. */
const edgeDist = (b: { tx: number; ty: number; kind: string }, x: number, y: number): number => {
  const d = buildingDef(b.kind);
  const dx = Math.max(b.tx - x, 0, x - (b.tx + d.w));
  const dy = Math.max(b.ty - y, 0, y - (b.ty + d.h));
  return Math.hypot(dx, dy);
};

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
export function chooseUnitKind(cands: readonly string[], counts: Readonly<Record<Role, number>>, intel: Intel, tilt?: Partial<Record<Role, number>>): string | null {
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
    if ((intel.squads ?? 0) > 0.45) {
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
    if (r === 'scout' && counts.scout >= 1) score -= 5;
    // Enemy aircraft: anti-air capable units are worth a premium until we have a few.
    if (intel.total >= 2 && intel.air > 0.12 && d.weapon?.antiAir) score += 1.5 + 4 * intel.air;
    if (score > bs || (score === bs && best !== null && d.cost < unitDef(best).cost)) {
      bs = score;
      best = k;
    }
  }
  return best;
}

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

interface Remembered {
  kind: string;
  x: number;
  y: number;
  t: number;
}

interface Wave {
  tx: number;
  ty: number;
  startPower: number;
  lastOrder: number;
  /** The units in the wave, and how many set out (AI-11). */
  members: Set<number>;
  size: number;
  /** Whether the last order held the wave back to close up. */
  held: boolean;
}

/** Wave pacing (AI-11): ticks between orders, tiles per hop, the spread at which it closes up, and gathering rules. */
export const WAVE_STEP = 60;
export const WAVE_HOP = 8;
export const WAVE_SPREAD = 4;
export const GATHER_R = 9;
export const GATHER_SHARE = 0.75;
export const GATHER_WAIT = 900;

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
}

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
  /** Whether it sends out a scout. */
  scouts: boolean;
  /** Whether it pulls a beaten wave back to the staging point, or calls it home to defend the base. */
  retreats: boolean;
}

const FULL_DOCTRINE: Doctrine = { trains: () => true, scouts: true, retreats: true };

/** The further field an AI is taking (AI-22): its index, where its refinery goes if one fits now, and whether an enemy army stands on the way. */
interface Expansion {
  fi: number;
  spot: { tx: number; ty: number } | null;
  blocked: boolean;
}

/**
 * Where a building goes when it is not an ordinary part of the compact base (AI-22): a refinery beside a further field,
 * a step of the crawl toward one, a turret by an outlying refinery, or, when the compact base is full, a little farther out.
 */
type Aim = { refineryFor: ShardField } | { toward: ShardField } | { guard: BuildingSnap } | { wide: true };

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
};

/**
 * An ordinary client of the simulation: it sees only its own fog-limited snapshot plus the static map
 * and answers with ordinary commands. Nothing here reads hidden state.
 */
export class AI {
  readonly kit: Kit;
  protected readonly doctrine: Doctrine = FULL_DOCTRINE;
  readonly stats: AiStats = { waves: 0, retreats: 0, suicides: 0, lone: 0, scoutedAt: -1, defends: 0, superweaponShots: 0, firstWaveAt: -1, earlyWaves: 0, economyWaves: 0, superweaponAt: -1, strikeAt: -1, strikeArrival: -1, labAt: -1, produced: { inf: 0, at: 0, tank: 0, art: 0, air: 0, scout: 0, hero: 0 }, superweaponOrder: null, scoutsLost: 0, scoutLifetimes: [], scoutingSince: [], intelThinks: 0, intelFresh: 0 };
  /** Raider or Doomsday has abandoned its plan and plays as Balanced (AI-16). */
  private adapted = false;
  private raidsLost = 0;
  /** Doomsday: when the superweapon was first seen charged, and where it struck. */
  private chargedAt = -1;
  private strike: { tx: number; ty: number } | null = null;
  private lastStrike = -1;
  /** Orders that must not be cut by the command budget this tick. */
  private first: Command[] = [];
  private intel = new Map<number, Remembered>();
  private wave: Wave | null = null;
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
  private scoutGoal: { tx: number; ty: number } | null = null;
  private backing = false;
  private tourStep = 0;
  private tourLaps = 0;
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
  /** The further field it is taking now, worked out afresh each decision, or null (AI-22). */
  private expansion: Expansion | null = null;
  /** The exact centre of our HQ, in tiles; on a point-symmetric map the two players' centres mirror exactly. */
  private centre: { x: number; y: number } = { x: 0, y: 0 };
  private attacks = 0;
  private lastWaveEnd = 0;
  /** Seeded personality so repeated games differ a little: attack timing, staging distance. */
  private readonly jitter: { wave: number; ratio: number; stage: number };

  constructor(
    readonly player: number,
    readonly faction: Faction,
    readonly diff: Difficulty,
    private map: MapDef,
    seed = 0,
    readonly personality: Personality = 'balanced',
  ) {
    this.kit = kitOf(faction);
    const r = new Rng(seed * 7919 + player * 104729 + 13);
    const f = (): number => r.int(1000) / 1000;
    this.jitter = { wave: 0.9 + 0.35 * f(), ratio: 1.15 + 0.3 * f(), stage: 11 + Math.floor(4 * f()) };
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
    const army = own.filter((u) => unitDef(u.kind).weapon && unitDef(u.kind).capacity === undefined && u.id !== this.scoutId && u.id !== this.standing);
    const c: Ctx = {
      snap, tick: snap.tick, own, foes, buildings,
      enemyBuildings: [...snap.buildings.filter((b) => b.owner !== me), ...snap.ghosts],
      hq, credits: pl.credits, powerOut: pl.powerOut, powerIn: pl.powerIn, counts, army, haulers,
    };
    this.updateIntel(c);
    this.scoutBook(c);
    this.setupPoints(c);
    this.updatePlan(c);
    this.expansion = this.scales ? this.planExpansion(c) : null;

    const out: Command[] = [];
    this.placeReady(c, out);
    this.defendBase(c, out);
    // Scouting goes ahead of building and production in the command budget, or the scout is rarely sent (AI-6, AI-17).
    this.scout(c, out);
    this.structures(c, out);
    this.production(c, out);
    this.economy(c, out);
    this.attackLogic(c, out);
    this.maintain(c, out);
    this.superweapon(c, out);
    // Crush orders go last so they override this tick's wave orders for the same units, and always get a share of the
    // command budget (BAL-5).
    const crush = crushOrders(me, c.army, c.foes, snap.mapWidth, snap.mapHeight).slice(0, Math.max(1, Math.ceil(this.diff.maxCommands / 2)));
    // Doomsday's strike and the order sending its wave into it go first, ahead of everything else (AI-15).
    const first = this.first.splice(0);
    return [...first, ...out.slice(0, Math.max(0, this.diff.maxCommands - crush.length - first.length)), ...crush];
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

  // ---------------------------------------------------------------- knowledge

  private updateIntel(c: Ctx): void {
    const { snap } = c;
    const W = snap.mapWidth;
    const seen = new Set<number>();
    for (const u of c.foes) {
      this.intel.set(u.id, { kind: u.kind, x: u.x, y: u.y, t: c.tick });
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
    // Ties are broken by a key that a field and its mirror image share, so both players order mirrored fields alike and
    // take mirror-image fields (MAP-4, AI-22): the first tile counted from the player's own corner of the map.
    const n = W * H;
    const flip = this.home.ty * W + this.home.tx > (H - 1 - this.home.ty) * W + (W - 1 - this.home.tx);
    // The steamroll opponent keeps the plain first-tile order (HAR-5).
    const key = (f: ShardField): number => (flip && this.scales ? n - 1 - f.tiles[f.tiles.length - 1]! : f.tiles[0]!);
    const rest = shardFields(this.map)
      .filter((f) => !homes.some((h) => h.tiles[0] === f.tiles[0]))
      .sort((a, b) => dist(a.cx, a.cy, hx, hy) - dist(b.cx, b.cy, hx, hy) || key(a) - key(b));
    this.fields = [...homes, ...rest];
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

  /** Cost-weighted strength of the remembered enemy army (seen within `within` ticks) and defences within `r` tiles of a tile. */
  private enemyPowerNear(c: Ctx, tx: number, ty: number, r: number, within = 1800): number {
    let p = 0;
    for (const e of this.intel.values()) {
      const d = UNIT_DEFS[e.kind];
      if (!d?.weapon || c.tick - e.t > within) continue;
      if (dist(tileOf(e.x), tileOf(e.y), tx, ty) <= r) p += d.cost;
    }
    for (const b of c.enemyBuildings) {
      const d = buildingDef(b.kind);
      if (d.weapon && dist(b.tx, b.ty, tx, ty) <= r + 2) p += d.cost * 1.5;
    }
    return p;
  }

  private armyPower(units: readonly UnitSnap[]): number {
    let p = 0;
    for (const u of units) {
      const d = unitDef(u.kind);
      p += (d.cost * u.hp) / d.hp;
    }
    return p;
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
    const refineries = n(k.refinery);
    const plain = Math.min(6, (c.tick < 3000 ? 0 : c.tick < 6500 ? 1 : c.tick < 11000 ? 2 : 3) + Math.min(3, this.attacks));
    // Raider defends with its army in the opening (AI-14).
    const turretsWanted = this.plan === 'raider' ? 0 : plain;
    const tech = this.plan === 'doomsday';

    if (c.powerIn > c.powerOut || margin < 15) return k.power;
    if (n(k.barracks) === 0) return k.barracks;
    if (refineries < 2) return k.refinery;
    if (margin < 35) return k.power;
    if (n(k.factory) === 0) return k.factory;
    // Doomsday (AI-15): tech first, its lab straight after the first factory and a second factory when it can afford it.
    if (tech && n(k.lab) === 0) return k.lab;
    if (tech && n(k.factory) < 2 && c.credits > 1400) return k.factory;
    if (n(k.turret) < turretsWanted) return k.turret;
    // The rest grows as a strong player does (AI-22).
    return this.scaledStructure(c, margin);
  }

  /** Whether this AI grows its economy and production by AI-22: every ordinary AI, not the steamroll opponent (HAR-5). */
  private get scales(): boolean {
    return this.doctrine === FULL_DOCTRINE;
  }

  /**
   * The rest of the build order of an ordinary AI (AI-22), once power, its first barracks, factory and two refineries,
   * Doomsday's own buildings and its planned turrets stand: a refinery for a home field that lost one, the lab, the next
   * further field and a turret by each outlying refinery, more barracks and factories while every one is busy, the
   * superweapon (Doomsday's ahead of the extra production, AI-15), then turrets and power. Anything that would
   * leave the power short asks for a power plant first (AI-3).
   */
  private scaledStructure(c: Ctx, margin: number): string | null {
    const k = this.kit;
    const n = (kind: string): number => c.counts.get(kind) ?? 0;
    const powered = (kind: string): string => (margin < -buildingDef(kind).power + 15 ? k.power : kind);
    const teching = this.plan !== 'raider';
    const doom = this.plan === 'doomsday';
    const queued = (kind: string): boolean => c.hq.queue.some((q) => q.kind === kind);
    // A home field that lost its refinery gets one again, unless the enemy holds it (AI-18).
    if (!queued(k.refinery) && this.homeRefineries(c) < 2 && this.fields.slice(0, 2).some((f) => this.hasShards(c, f) && !this.served(c, f) && this.enemyPowerNear(c, Math.floor(f.cx), Math.floor(f.cy), 8) <= ARMY_NEAR)) return powered(k.refinery);
    if (teching && n(k.lab) === 0 && c.credits > 1100) return powered(k.lab);
    const superweapon = (): string | null => {
      if (!teching || n(k.superweapon) > 0 || n(k.lab) === 0 || (doom && !this.canAffordDoom(c))) return null;
      return margin < -buildingDef(k.superweapon).power + 10 ? k.power : k.superweapon;
    };
    // Doomsday's own build order comes first (AI-15).
    if (doom) {
      const sw = superweapon();
      if (sw) return sw;
    }
    // The next further field, while it can afford it (AI-22); it saves for the refinery once it has half its price.
    const ex = this.expansion;
    if (ex?.spot && !queued(k.refinery) && c.credits >= buildingDef(k.refinery).cost / 2) return powered(k.refinery);
    if (teching && !queued(k.turret) && this.unguarded(c) && c.credits >= buildingDef(k.turret).cost) return powered(k.turret);
    // A barracks or factory whenever every one it has is busy and it can pay with GROWTH_SPARE to spare (AI-22).
    const busy = (kind: string): boolean => {
      const bs = c.buildings.filter((b) => b.kind === kind);
      return bs.length > 0 && bs.every((b) => b.queue.length > 0);
    };
    const grow = (kind: string): boolean => n(kind) < GROWTH_MAX && !queued(kind) && busy(kind) && c.credits >= buildingDef(kind).cost + GROWTH_SPARE;
    for (const kind of n(k.factory) <= n(k.barracks) ? [k.factory, k.barracks] : [k.barracks, k.factory]) if (grow(kind)) return powered(kind);
    if (!doom) {
      const sw = superweapon();
      if (sw) return sw;
    }
    if (n(k.turret) < 6 && c.credits > 1800) return k.turret;
    // Power keeps ahead of the drain as buildings multiply (AI-3); while it builds toward a field, power plants are its steps.
    const crawling = ex !== null && ex.spot === null && !ex.blocked;
    if (n(k.power) < (crawling ? 10 : 8) && (margin < 80 || crawling) && c.credits > 1200) return k.power;
    return null;
  }

  /** Whether a field still has shards: as last seen where it has looked, as the map shows where it has not (AI-2). */
  private hasShards(c: Ctx, f: ShardField): boolean {
    const fog = c.snap.fog as Uint8Array;
    return f.tiles.some((t) => (((fog[t] as number) & EXPLORED) !== 0 ? (c.snap.shards[t] as number) > 0 : ((this.map.shards?.[t] ?? 0) as number) > 0));
  }

  /**
   * The further field to take next (AI-22): none for Raider in its opening or before both home fields have a refinery
   * and it has EXPAND_HAULERS haulers; else the nearest field (home fields first, then by distance) that still has shards,
   * has no refinery of ours, and on which it has seen no enemy army or defence in the last FIELD_INTEL ticks. One at a time.
   */
  private planExpansion(c: Ctx): Expansion | null {
    if (this.plan === 'raider' || c.haulers.length < EXPAND_HAULERS) return null;
    if (!this.homesServed(c)) return null;
    for (let fi = 2; fi < this.fields.length; fi++) {
      const f = this.fields[fi]!;
      if (!this.hasShards(c, f) || this.served(c, f)) continue;
      if (this.enemyPowerNear(c, Math.floor(f.cx), Math.floor(f.cy), 8, FIELD_INTEL) > ARMY_NEAR) continue;
      const spot = this.findSpot(c, this.kit.refinery, { refineryFor: f });
      return { fi, spot, blocked: spot === null && this.armyOnTheWay(c, f) };
    }
    return null;
  }

  /** Whether it has seen an enemy army lately between its building nearest a field and the field (AI-22). */
  private armyOnTheWay(c: Ctx, f: ShardField): boolean {
    let from: BuildingSnap | null = null;
    let fd = Infinity;
    for (const b of c.buildings) {
      const d = edgeDist(b, f.cx, f.cy);
      if (d < fd) {
        fd = d;
        from = b;
      }
    }
    if (!from) return false;
    const bd = buildingDef(from.kind);
    const ax = from.tx + bd.w / 2;
    const ay = from.ty + bd.h / 2;
    let p = 0;
    for (const e of this.intel.values()) {
      const d = UNIT_DEFS[e.kind];
      if (!d?.weapon || c.tick - e.t > WAY_INTEL) continue;
      if (segDist(e.x / FP, e.y / FP, ax, ay, f.cx, f.cy) <= 8) p += d.cost;
    }
    return p > ARMY_NEAR;
  }

  /** Its nearest refinery outside the base (farther than OUTPOST from the HQ centre) with no turret of its own beside it, or null (AI-22). */
  private unguarded(c: Ctx): BuildingSnap | null {
    const hc = this.centre;
    const centre = (b: BuildingSnap): [number, number] => [b.tx + buildingDef(b.kind).w / 2, b.ty + buildingDef(b.kind).h / 2];
    const open = c.buildings
      .filter((b) => buildingDef(b.kind).refinery && dist(...centre(b), hc.x, hc.y) > OUTPOST)
      .filter((r) => !c.buildings.some((t) => buildingDef(t.kind).weapon && edgeDist(r, ...centre(t)) <= GUARD_R))
      .sort((a, b) => dist(...centre(a), hc.x, hc.y) - dist(...centre(b), hc.x, hc.y) || a.id - b.id);
    return open[0] ?? null;
  }

  /** Its refineries that serve no further field: those of its home fields (AI-18, AI-22). */
  private homeRefineries(c: Ctx): number {
    const further = this.fields.slice(2);
    return c.buildings.filter((b) => buildingDef(b.kind).refinery && !further.some((f) => dist(b.tx + 1.5, b.ty + 1, f.cx, f.cy) <= 9)).length;
  }

  /** Whether both home fields have a refinery (AI-18): each that still has shards has one, or it has two home refineries anyway. */
  private homesServed(c: Ctx): boolean {
    return this.homeRefineries(c) >= 2 || this.fields.slice(0, 2).every((f) => !this.hasShards(c, f) || this.served(c, f));
  }

  /**
   * Whether Doomsday goes for its superweapon now (AI-15): a strong army, a working economy (two refineries and enough
   * haulers) and a quiet base; then it saves for it.
   */
  private canAffordDoom(c: Ctx): boolean {
    const refineries = c.buildings.filter((b) => buildingDef(b.kind).refinery).length;
    return this.armyPower(c.army) >= SUPERWEAPON_ARMY && refineries >= 2 && c.haulers.length >= SUPERWEAPON_HAULERS && c.tick - this.lastThreat > 600;
  }

  private structures(c: Ctx, out: Command[]): void {
    if (c.hq.queue.length > 0) return;
    const kind = this.wantedStructure(c);
    if (kind && this.can(c, kind)) {
      if (kind === this.kit.lab && this.stats.labAt < 0) this.stats.labAt = c.tick;
      if (kind === this.kit.superweapon && !this.stats.superweaponOrder) this.stats.superweaponOrder = { haulers: c.haulers.length, army: this.armyPower(c.army) };
      out.push({ type: 'produce', player: this.player, source: c.hq.id, kind });
      // Spent now, so units ordered in the same turn cannot count on it (AI-3).
      c.credits -= buildingDef(kind).cost;
    }
  }

  private placeReady(c: Ctx, out: Command[]): void {
    const head = c.hq.queue[0];
    if (!head?.ready) return;
    const aim = this.scales ? this.aimFor(c, head.kind) : null;
    // Beyond the compact base only for a further field or its guard (AI-22); then, if the compact base is full, a little
    // farther out rather than cancelling.
    const spot = (aim ? this.findSpot(c, head.kind, aim) : null) ?? this.findSpot(c, head.kind) ?? (this.scales ? this.findSpot(c, head.kind, { wide: true }) : null);
    if (spot) out.push({ type: 'place', player: this.player, source: c.hq.id, tx: spot.tx, ty: spot.ty });
    else out.push({ type: 'cancel', player: this.player, source: c.hq.id, index: 0 });
  }

  /**
   * Where a ready building aims (AI-22): a refinery beside the further field it is taking when one fits there; a turret
   * by an outlying refinery without one; a power plant, barracks or factory one step toward a further field that is out
   * of reach, unless an enemy army stands on the way. Anything else, or nothing to aim at: the compact base.
   */
  private aimFor(c: Ctx, kind: string): Aim | null {
    const k = this.kit;
    const ex = this.expansion;
    const f = ex ? this.fields[ex.fi] : undefined;
    if (kind === k.refinery) return ex?.spot && f ? { refineryFor: f } : null;
    if (kind === k.turret) {
      const r = this.unguarded(c);
      return r ? { guard: r } : null;
    }
    if ((kind === k.power || kind === k.barracks || kind === k.factory) && ex && f && !ex.spot && !ex.blocked) return { toward: f };
    return null;
  }

  private findSpot(c: Ctx, kind: string, aim?: Aim): { tx: number; ty: number } | null {
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
    // A refinery for a further field goes beside that field (AI-22).
    const forField = aim && 'refineryFor' in aim ? aim.refineryFor : undefined;
    const unserved = forField ?? (d.refinery ? this.fields.find((f) => f.tiles.some((t) => (snap.shards[t] as number) > 0) && !c.buildings.some((b) => buildingDef(b.kind).refinery && dist(b.tx + 1.5, b.ty + 1, f.cx, f.cy) <= 9)) : undefined);
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
    const placeRule = this.doctrine.place?.(kind);
    let best: { tx: number; ty: number } | null = null;
    let bs = Infinity;
    let minX = Math.min(...c.buildings.map((b) => b.tx)) - BUILD_RANGE - d.w;
    let maxX = Math.max(...c.buildings.map((b) => b.tx)) + BUILD_RANGE + 4;
    let minY = Math.min(...c.buildings.map((b) => b.ty)) - BUILD_RANGE - d.h;
    let maxY = Math.max(...c.buildings.map((b) => b.ty)) + BUILD_RANGE + 4;
    if (forField) {
      // Only around the field: footprints within 8 tiles of its tiles, a box that mirrors exactly with the field (MAP-4).
      const xs = forField.tiles.map((t) => t % W);
      const ys = forField.tiles.map((t) => Math.floor(t / W));
      minX = Math.min(...xs) - 8;
      maxX = Math.max(...xs) + 8 - d.w + 1;
      minY = Math.min(...ys) - 8;
      maxY = Math.max(...ys) + 8 - d.h + 1;
    }
    const y0 = Math.max(0, minY);
    const y1 = Math.min(snap.mapHeight - d.h, maxY);
    const x0 = Math.max(0, minX);
    const x1 = Math.min(W - d.w, maxX);
    // A step of the crawl toward a further field (AI-22): its shard tiles (as last seen, or as the map shows where it has
    // not looked), and how near our nearest building already stands to them; a step must get at least two tiles nearer.
    const crawlTo = aim && 'toward' in aim ? aim.toward : undefined;
    const target: [number, number][] = [];
    if (crawlTo) {
      for (const t of crawlTo.tiles) {
        const live = ((fog[t] as number) & EXPLORED) !== 0 ? (snap.shards[t] as number) > 0 : ((this.map.shards?.[t] ?? 0) as number) > 0;
        if (live) target.push([(t % W) + 0.5, Math.floor(t / W) + 0.5]);
      }
      if (target.length === 0) return null;
    }
    const gap = (x: number, y: number): number => {
      let m = Infinity;
      for (const [fx, fy] of target) m = Math.min(m, dist(x, y, fx, fy));
      return m;
    };
    const frontier = crawlTo ? Math.min(...c.buildings.map((b) => gap(b.tx + buildingDef(b.kind).w / 2, b.ty + buildingDef(b.kind).h / 2))) : 0;
    const guard = aim && 'guard' in aim ? aim.guard : undefined;
    const wide = aim !== undefined && 'wide' in aim;
    for (let iy = y0; iy <= y1; iy++) {
      for (let ix = x0; ix <= x1; ix++) {
        const tx = flip ? x1 - (ix - x0) : ix;
        const ty = flip ? y1 - (iy - y0) : iy;
        if (!canPlace(ctx, kind, tx, ty)) continue;
        if (forField) {
          // Beside the field, near enough to count as its refinery (AI-18).
          if (dist(tx + d.w / 2, ty + d.h / 2, forField.cx, forField.cy) > 9) continue;
        } else if (crawlTo) {
          // Never on shards or a dock apron; nearer the field than any building yet, but leaving room for the refinery.
          let bad = false;
          for (let y = ty; y < ty + d.h && !bad; y++) for (let x = tx; x < tx + d.w; x++) if ((snap.shards[y * W + x] as number) > 0 || aprons.has(y * W + x)) bad = true;
          const g = gap(tx + d.w / 2, ty + d.h / 2);
          if (bad || g > frontier - 2 || g < 4) continue;
        } else if (guard) {
          if (edgeDist(guard, tx + d.w / 2, ty + d.h / 2) > GUARD_R) continue;
        } else if (placeRule) {
          // The steamroll opponent's own placement rule (HAR-5).
          if (dist(tx + d.w / 2, ty + d.h / 2, hc.x, hc.y) > placeRule.reach) continue;
        } else {
          // A compact base: nothing strays far from the headquarters (no creeping chains toward the enemy). When it is
          // full, a little farther out (AI-22).
          const reach = (d.refinery ? 24 : d.weapon ? 13 : 16) + (wide ? 8 : 0);
          if (dist(tx + d.w / 2, ty + d.h / 2, hc.x, hc.y) > reach) continue;
        }
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
        if (crawlTo) score += gap(cx, cy) * 10; // a crawl step goes as near the field as it may (AI-22)
        else if (d.weapon) score -= toward * 2.2 - (guard ? edgeDist(guard, cx, cy) : 0); // defences face the enemy
        else if (d.refinery) {
          // Haulers unload on the dock pad, so it is the pad that should be near the shards (ECO-7).
          const px = (pad as [number, number])[0] + 0.5;
          const py = (pad as [number, number])[1] + 0.5;
          let nearest = 40;
          for (const [fx, fy] of fields) nearest = Math.min(nearest, dist(px, py, fx, fy));
          // A further field's refinery fits only with its pad right by the shards (AI-22).
          if (forField && nearest > 4) continue;
          score += nearest * 3;
        } else if (placeRule?.toward) score += dist(cx, cy, placeRule.toward.x, placeRule.toward.y) * 3;
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

  private production(c: Ctx, out: Command[]): void {
    const intel = this.intelSummary(c);
    const counts: Record<Role, number> = { inf: 0, at: 0, tank: 0, art: 0, air: 0, scout: 0 };
    for (const u of c.army) counts[roleOf(unitDef(u.kind))]++;
    if (this.scoutId >= 0) counts.scout++;
    if (this.standing >= 0) counts.scout++;
    const queued = new Map<string, number>();
    for (const b of c.buildings) for (const q of b.queue) if (!BUILDING_DEFS[q.kind]) queued.set(q.kind, (queued.get(q.kind) ?? 0) + 1);
    for (const [kind, n] of queued) counts[roleOf(unitDef(kind))] += n;

    const next = this.wantedStructure(c);
    // Doomsday saves the whole price of a superweapon it has decided on, else up to its lab's price (AI-15); others hold
    // back at most 750.
    const doom = this.plan === 'doomsday';
    const hold = next && c.hq.queue.length === 0 ? Math.min(buildingDef(next).cost, doom && next === this.kit.superweapon ? Infinity : doom ? 1100 : 750) : 0;
    const urgent = c.army.length < 4 || c.tick - this.lastThreat < 600;
    const tilt = this.plan === 'raider' ? RAIDER_TILT : this.plan === 'doomsday' ? TECH_TILT : undefined;
    const rifles = this.plan === 'doomsday' ? infantryNeeded(this.intelSummary(c, RIFLE_INTEL)) : 0;
    // Doomsday saving for its superweapon does not spend on the floor (AI-15, AI-19).
    const guns = doom && next === this.kit.superweapon ? 0 : artilleryNeeded(intel);
    let haulerWanted = this.haulerTarget(c) - c.haulers.length - (queued.get(this.kit.hauler) ?? 0);
    // Haulers queued before this turn; those ordered during it count against haulerWanted (the steamroll's pick, HAR-5).
    const queuedBefore = queued.get(this.kit.hauler) ?? 0;
    // The standing scout (AI-21): one from the building that trains it, ahead of its other combat units, when none lives
    // or is queued and none was lost in the last SCOUT_REPLACE ticks. Production trains no other scout unit. The steamroll
    // opponent sends out no scout (HAR-5).
    const scoutKind = this.doctrine.scouts ? this.scoutKind() : null;
    let scoutWanted = scoutKind !== null && (this.standing >= 0 ? 1 : 0) + (queued.get(scoutKind) ?? 0) < STANDING_SCOUTS && c.tick - this.standingLostAt >= SCOUT_REPLACE;

    for (const b of c.buildings) {
      const depth = c.credits > 3000 ? 5 : c.credits > 2000 ? 4 : c.credits > 1100 ? 3 : 2;
      if (b.queue.length >= depth || b.queue.length >= QUEUE_MAX) continue;
      const trainable = Object.keys(UNIT_DEFS).filter((k) => unitDef(k).builtAt === b.kind && unitDef(k).faction === this.faction && this.doctrine.trains(k));
      if (trainable.length === 0) continue;
      // A hero only while the player has none, alive or queued (HERO-1).
      const allowed = trainable.filter((k) => unitDef(k).requires.every((r) => c.buildings.some((x) => x.kind === r)) && !(unitDef(k).hero && (queued.has(k) || c.own.some((u) => u.kind === k))));
      // Its hero takes the field whenever it is available and affordable with credits to spare (HERO-1).
      const hero = allowed.find((k) => unitDef(k).hero && c.credits >= unitDef(k).cost + 400);
      // Doomsday keeps enough rifle infantry for the enemy's infantry before anything else from the barracks (AI-15).
      const rifle = counts.inf < rifles ? allowed.find((k) => roleOf(unitDef(k)) === 'inf' && !unitDef(k).hero) : undefined;
      // Artillery floor against enemy infantry (AI-19), when it is available here.
      const gun = counts.art < guns ? allowed.find((k) => roleOf(unitDef(k)) === 'art' && !unitDef(k).hero) : undefined;
      const scout = scoutWanted && scoutKind !== null && allowed.includes(scoutKind) ? scoutKind : undefined;
      const pick: string | null = this.doctrine.pick
        ? this.doctrine.pick(b.kind, allowed, haulerWanted - ((queued.get(this.kit.hauler) ?? 0) - queuedBefore))
        : b.kind === this.kit.factory && haulerWanted > 0 && allowed.includes(this.kit.hauler)
          ? this.kit.hauler
          : (scout ?? hero ?? rifle ?? gun ?? chooseUnitKind(allowed.filter((k) => k !== this.kit.hauler && !unitDef(k).hero && k !== scoutKind), counts, intel, tilt));
      if (!pick) continue;
      // Doomsday does not flood the field with cheap infantry beyond its rifle floor: tanks and artillery set the pace (AI-15).
      if (doom && !rifle && (roleOf(unitDef(pick)) === 'inf' || roleOf(unitDef(pick)) === 'at') && counts.tank + counts.art >= 4 && counts.inf + counts.at >= rifles + 3 * (counts.tank + counts.art) && !urgent) continue;
      const cost = unitDef(pick).cost;
      const reserve = pick === this.kit.hauler || pick === scout || urgent ? 0 : hold;
      if (c.credits < cost + reserve) continue;
      c.credits -= cost;
      out.push({ type: 'produce', player: this.player, source: b.id, kind: pick });
      counts[roleOf(unitDef(pick))]++;
      if (pick !== this.kit.hauler) this.stats.produced[unitDef(pick).hero ? 'hero' : roleOf(unitDef(pick))]++;
      if (pick === this.kit.hauler || unitDef(pick).hero) queued.set(pick, (queued.get(pick) ?? 0) + 1);
      if (pick === scout) scoutWanted = false;
      // Several factories may each train a hauler in one decision: no more than the target between them (AI-22).
      if (pick === this.kit.hauler && this.scales) haulerWanted--;
    }
  }

  private haulerTarget(c: Ctx): number {
    const refineries = c.buildings.filter((b) => buildingDef(b.kind).refinery);
    // Three haulers a refinery fill both home fields (AI-18); the steamroll opponent's own rule starts from that (HAR-5).
    if (!this.scales) {
      const standard = refineries.length === 0 ? 0 : Math.min(8, refineries.length * 3);
      return this.doctrine.haulers ? this.doctrine.haulers(standard) : standard;
    }
    // Three for each refinery, four at a field of more than BIG_FIELD tiles, none at a field that is used up; no cap (AI-22).
    let n = 0;
    for (const b of refineries) {
      const near = this.fields.filter((f) => dist(b.tx + 1.5, b.ty + 1, f.cx, f.cy) <= 9);
      const f = near.find((x) => this.hasShards(c, x));
      n += f ? (f.tiles.length > BIG_FIELD ? HAULERS_PER_BIG : HAULERS_PER_REFINERY) : near.length > 0 ? 0 : HAULERS_PER_REFINERY;
    }
    return n;
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
    const send = (h: UnitSnap, fi: number): boolean => {
      const t = this.fieldTile(c, fi, tileOf(h.x), tileOf(h.y));
      if (!t) return false;
      this.haulerField.set(h.id, fi);
      out.push({ type: 'harvest', player: this.player, units: [h.id], x: t.x * FP + FP / 2, y: t.y * FP + FP / 2 });
      return true;
    };
    // The field with the fewest haulers for its refinery, the nearer on a tie (AI-18).
    const leastWorked = (h: UnitSnap): number | undefined =>
      [...open].sort((a, b) => load(a) - load(b) || dist(this.fields[a]!.cx, this.fields[a]!.cy, tileOf(h.x), tileOf(h.y)) - dist(this.fields[b]!.cx, this.fields[b]!.cy, tileOf(h.x), tileOf(h.y)) || a - b)[0];
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
    // New haulers, and an uneven split: move one hauler from the busiest field to the least worked (AI-18).
    for (const h of c.haulers) {
      if (this.haulerField.has(h.id)) continue;
      const fi = leastWorked(h);
      if (fi !== undefined) send(h, fi);
    }
    if (open.length >= 2 && c.tick - this.lastRebalance >= 200) {
      const byLoad = [...open].sort((a, b) => load(a) - load(b) || a - b);
      const low = byLoad[0]!;
      const high = byLoad[byLoad.length - 1]!;
      if (load(high) - load(low) >= 2) {
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
    const ids = (pressing ? c.army.filter((u) => !w.members.has(u.id)) : c.army).map((u) => u.id);
    if (ids.length > 0) {
      this.stats.defends++;
      out.push({ type: 'attackmove', player: this.player, units: ids, x: Math.round(cx), y: Math.round(cy) });
    }
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

  private attackLogic(c: Ctx, out: Command[]): void {
    const stage = this.staging as { tx: number; ty: number };
    const army = c.army;
    if (army.length === 0) {
      if (this.wave) this.wave = null;
      return;
    }
    const threatened = c.tick - this.lastThreat < 200;
    const order = (type: 'move' | 'attackmove', units: UnitSnap[], x: number, y: number): void => {
      if (units.length > 0) out.push({ type, player: this.player, units: units.map((u) => u.id), x: Math.floor(x) * FP + FP / 2, y: Math.floor(y) * FP + FP / 2 });
    };
    const centre = (us: UnitSnap[]): { x: number; y: number } => ({ x: us.reduce((s, u) => s + u.x, 0) / us.length / FP, y: us.reduce((s, u) => s + u.y, 0) / us.length / FP });

    if (this.wave) {
      const w = this.wave;
      // The wave is the units that set out together (AI-11); others are reinforcements.
      const members = army.filter((u) => w.members.has(u.id));
      const rest = army.filter((u) => !w.members.has(u.id));
      const p = this.armyPower(members);
      const { x: cx, y: cy } = members.length ? centre(members) : { x: stage.tx, y: stage.ty };
      const local = this.enemyPowerNear(c, Math.floor(cx), Math.floor(cy), 11);
      // Doomsday commits while its strike is charged or has just landed: the strike, not a retreat, answers resistance (AI-15).
      const committed = this.plan === 'doomsday' && (c.buildings.some((b) => buildingDef(b.kind).superweapon && b.charge >= 100) || (this.lastStrike >= 0 && c.tick - this.lastStrike < 400));
      // The steamroll opponent never pulls a wave back (HAR-5): it drives on until the wave is gone, then forms the next.
      if (!this.doctrine.retreats) {
        if (members.length === 0) {
          this.wave = null;
          this.lastWaveEnd = c.tick;
          return;
        }
      } else if (members.length <= 2 || (!committed && (p <= 0.45 * w.startPower || local >= 1.5 * p))) {
        this.stats.retreats++;
        order('move', members, stage.tx, stage.ty);
        this.wave = null;
        this.waveCooldown = c.tick + 1200;
        this.lastWaveEnd = c.tick;
        if (this.plan === 'raider') {
          this.raidsLost++;
          this.waveCooldown = c.tick + 600;
        }
        return;
      }
      if (c.tick - w.lastOrder >= WAVE_STEP) {
        // Retarget when the objective is gone or reached.
        const near = dist(cx, cy, w.tx, w.ty) < 6;
        const known = c.enemyBuildings.some((b) => dist(b.tx, b.ty, w.tx, w.ty) < 4);
        if (near && !known) {
          const nb = this.nearestEnemyBuilding(c, Math.floor(cx), Math.floor(cy));
          // A raid moves on to the next part of the economy it knows of (AI-14).
          const t = (this.plan === 'raider' ? this.economyTarget(c) : null) ?? (nb ? { tx: nb.tx, ty: nb.ty } : this.searchPoint(c));
          w.tx = t.tx;
          w.ty = t.ty;
        }
        w.lastOrder = c.tick;
        // Advance as one body (AI-11): the whole wave attack-moves to a point a short hop ahead of its centre, so the
        // fast wait there for the slow; strung out, it closes up on its centre first; close to the objective it goes in.
        // Spread: how far most of the wave (four in five) is from its centre; a big wave is naturally wider.
        const ds = members.map((u) => dist(u.x / FP, u.y / FP, cx, cy)).sort((a, b) => a - b);
        const spread = ds[Math.floor(0.8 * (ds.length - 1))] ?? 0;
        const strung = spread > WAVE_SPREAD + Math.sqrt(members.length) && !w.held;
        w.held = strung; // never hold back two hops running
        const d = dist(cx, cy, w.tx, w.ty);
        const k = strung ? 0 : d <= WAVE_HOP + 2 ? 1 : WAVE_HOP / d;
        order('attackmove', members, cx + (w.tx - cx) * k, cy + (w.ty - cy) * k);
        // Reinforcements gather at the staging point and join in groups, never one at a time.
        const home = rest.filter((u) => dist(tileOf(u.x), tileOf(u.y), stage.tx, stage.ty) < 10);
        if (home.length >= Math.max(3, Math.ceil(0.25 * w.size))) {
          order('attackmove', home, cx, cy);
          for (const u of home) w.members.add(u.id);
        } else order('attackmove', rest.filter((u) => u.dest === null && !home.includes(u)), stage.tx, stage.ty);
      }
      return;
    }

    if (!threatened) {
      // Gather at the staging point.
      const away = army.filter((u) => u.dest === null && dist(tileOf(u.x), tileOf(u.y), stage.tx, stage.ty) > 7);
      if (away.length > 0 && c.tick % 3 === 0) order('attackmove', away, stage.tx, stage.ty);
    }

    if (threatened || c.tick < this.waveCooldown) return;
    const p = this.armyPower(army);
    const raiding = this.plan === 'raider';
    const sw = c.buildings.find((b) => buildingDef(b.kind).superweapon && b.charge >= 100);
    // Doomsday with a charged superweapon sends its wave at what it will strike (AI-15).
    const striking = this.plan === 'doomsday' && sw !== undefined;
    if (raiding && (c.tick < RAID_FROM || (!this.economyTarget(c) && c.tick < 2 * RAID_FROM))) return;
    let threshold = Math.min(4200, (1100 + 450 * this.stats.waves) * this.jitter.wave);
    if (raiding) threshold = 0;
    if (striking) threshold = Math.min(threshold, 1500);
    const known = this.nearestEnemyBuilding(c, stage.tx, stage.ty);
    const aim = raiding ? this.economyTarget(c) : striking && sw ? this.bestStrike(c, sw, null, true) : null;
    const target = aim ?? (known ? { tx: known.tx, ty: known.ty } : this.enemyStart());
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
    // The steamroll opponent sets out once its army is big enough, whatever it knows of the enemy (HAR-5).
    const launch = this.doctrine.launch;
    const ready = launch ? launch(p, army.filter((u) => unitDef(u.kind).crusher).length) : shouldAttack(p, est, army.length, threshold, this.jitter.ratio) && !(raiding && army.length < RAID_MIN_ARMY);
    if (!ready) {
      this.gatherSince = -1;
      return;
    }
    // Strong enough: set out only once most of the army has gathered at the staging point (AI-11), or after a while.
    const gathered = army.filter((u) => dist(tileOf(u.x), tileOf(u.y), stage.tx, stage.ty) <= GATHER_R);
    if (this.gatherSince < 0) this.gatherSince = c.tick;
    // A charged strike does not wait for stragglers: the army goes in together with it (AI-15).
    if (!striking && gathered.length < GATHER_SHARE * army.length && c.tick - this.gatherSince < GATHER_WAIT) return;
    this.gatherSince = -1;
    const wave = gathered.length >= 3 && !striking && !launch ? gathered : army;
    this.stats.waves++;
    if (this.stats.firstWaveAt < 0) this.stats.firstWaveAt = c.tick;
    if (c.tick < RAIDER_OPENING_END) {
      this.stats.earlyWaves++;
      if (this.isEconomy(c, target)) this.stats.economyWaves++;
    }
    if (p < 0.8 * est) this.stats.suicides++;
    if (wave.length < 5) this.stats.lone++;
    this.wave = { tx: target.tx, ty: target.ty, startPower: this.armyPower(wave), lastOrder: c.tick, members: new Set(wave.map((u) => u.id)), size: wave.length, held: false };
    const { x, y } = centre(wave);
    const d = dist(x, y, target.tx, target.ty);
    order('attackmove', wave, x + ((target.tx - x) * Math.min(d, WAVE_HOP)) / Math.max(1, d), y + ((target.ty - y) * Math.min(d, WAVE_HOP)) / Math.max(1, d));
  }


  /** The nearest part of the enemy economy we know of: a refinery, or a hauler seen lately (AI-14). */
  private economyTarget(c: Ctx): { tx: number; ty: number } | null {
    const stage = this.staging as { tx: number; ty: number };
    let best: { tx: number; ty: number } | null = null;
    let bd = Infinity;
    const consider = (tx: number, ty: number): void => {
      const d = dist(tx, ty, stage.tx, stage.ty);
      if (d < bd) {
        bd = d;
        best = { tx, ty };
      }
    };
    for (const b of c.enemyBuildings) if (buildingDef(b.kind).refinery) consider(b.tx + 1, b.ty + 1);
    for (const e of this.intel.values()) if (UNIT_DEFS[e.kind]?.capacity !== undefined && c.tick - e.t <= 1200) consider(tileOf(e.x), tileOf(e.y));
    // Unseen, the enemy mines the shard field nearest its start: the map shows the fields to every player (MENU-1).
    return best ?? this.enemyField();
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
    if (this.standingKind === undefined) this.standingKind = Object.keys(UNIT_DEFS).find((k) => unitDef(k).faction === this.faction && unitDef(k).role === 'scout' && this.doctrine.trains(k)) ?? null;
    return this.standingKind;
  }

  /** Which unit is the standing scout (AI-21): it notes the loss of the last one and takes up a new one once it stands. */
  private keepStanding(own: readonly UnitSnap[], tick: number): void {
    const kind = this.scoutKind();
    if (kind === null) return;
    if (this.standing >= 0 && !own.some((u) => u.id === this.standing)) {
      this.standing = -1;
      this.standingLostAt = tick;
    }
    if (this.standing >= 0) return;
    const next = own.filter((u) => u.kind === kind).sort((a, b) => a.id - b.id)[0];
    if (!next) return;
    this.standing = next.id;
    this.scoutGoal = null;
    this.backing = false;
    this.tourStep = 0;
    // A scout unit out on the old scouting route becomes the standing scout.
    if (next.id === this.scoutId) {
      this.scoutId = -1;
      this.scoutRoute = [];
    }
    this.startScouting(next.id, tick);
  }

  /**
   * Whether a point is unsafe for the scout (AI-21): a defence within SCOUT_DANGER tiles of it, or an armed enemy unit seen
   * within SCOUT_MEMORY ticks that close to it or, given where the scout is `from`, to the straight way there (so it does
   * not drive through an army it can see on its way to a point beyond it).
   */
  private unsafe(c: Ctx, p: { tx: number; ty: number }, from?: { x: number; y: number }): boolean {
    const x = p.tx + 0.5;
    const y = p.ty + 0.5;
    for (const e of this.intel.values()) {
      if (!UNIT_DEFS[e.kind]?.weapon || c.tick - e.t > SCOUT_MEMORY) continue;
      const ex = e.x / FP;
      const ey = e.y / FP;
      if ((from ? segDist(ex, ey, from.x, from.y, x, y) : dist(ex, ey, x, y)) <= SCOUT_DANGER) return true;
    }
    return c.enemyBuildings.some((b) => buildingDef(b.kind).weapon && edgeDist(b, x, y) <= SCOUT_DANGER);
  }

  /**
   * The standing scout's observation points (AI-21), in tour order: the ground midway between the two bases, then points
   * around the enemy base SCOUT_STANDOFF tiles out from every enemy building it knows (from the enemy start, read off the
   * symmetric map, while it knows none), starting on the side facing us and going round, the other way each lap.
   */
  private tourPoints(c: Ctx): { tx: number; ty: number }[] {
    const home = this.home as { tx: number; ty: number };
    const start = this.enemyStart();
    const W = this.map.width;
    const H = this.map.height;
    const mid = this.nearestFree(Math.round((home.tx + start.tx) / 2), Math.round((home.ty + start.ty) / 2));
    const anchors = c.enemyBuildings.length > 0 ? c.enemyBuildings : [{ kind: this.kit.hq, tx: start.tx - 1, ty: start.ty - 1 }];
    const cx = anchors.reduce((t, b) => t + b.tx + buildingDef(b.kind).w / 2, 0) / anchors.length;
    const cy = anchors.reduce((t, b) => t + b.ty + buildingDef(b.kind).h / 2, 0) / anchors.length;
    const clear = (x: number, y: number): boolean => anchors.every((b) => edgeDist(b, x + 0.5, y + 0.5) >= SCOUT_STANDOFF);
    // The direction facing us first.
    const fx = home.tx - cx;
    const fy = home.ty - cy;
    let first = 0;
    RING.forEach((d, i) => {
      const f = RING[first] as readonly [number, number];
      if (d[0] * fx + d[1] * fy > f[0] * fx + f[1] * fy) first = i;
    });
    const way = this.tourLaps % 2 === 0 ? 1 : RING.length - 1;
    const ring: { tx: number; ty: number }[] = [];
    for (let i = 0; i < RING.length; i++) {
      const [dx, dy] = RING[(first + i * way) % RING.length] as readonly [number, number];
      // Out along this direction to the first tile SCOUT_STANDOFF clear of every building it knows.
      for (let r = SCOUT_STANDOFF; r <= 40; r++) {
        const x = Math.max(1, Math.min(W - 2, Math.round(cx + dx * r)));
        const y = Math.max(1, Math.min(H - 2, Math.round(cy + dy * r)));
        if (!clear(x, y)) continue;
        const p = this.nearestFree(x, y);
        if (clear(p.tx, p.ty) && !ring.some((q) => q.tx === p.tx && q.ty === p.ty)) ring.push(p);
        break;
      }
    }
    return [mid, ...ring];
  }

  /**
   * The standing scout's orders (AI-21). It watches rather than fights: it backs away from any armed enemy unit or
   * defence within SCOUT_DANGER tiles, whatever its health, to the nearest point of its tour with no armed enemy near it
   * that is farther from the threat than it is (or else to its staging point); otherwise it tours its observation points,
   * moving on when it reaches one and skipping those with an armed enemy near them or on the way there.
   */
  private watch(c: Ctx, out: Command[]): void {
    const me = c.own.find((u) => u.id === this.standing);
    if (!me) return;
    const stage = this.staging as { tx: number; ty: number };
    const x = me.x / FP;
    const y = me.y / FP;
    const go = (p: { tx: number; ty: number }): void => {
      const same = this.scoutGoal !== null && this.scoutGoal.tx === p.tx && this.scoutGoal.ty === p.ty;
      this.scoutGoal = p;
      if (same && me.dest !== null) return;
      out.push({ type: 'move', player: this.player, units: [me.id], x: p.tx * FP + FP / 2, y: p.ty * FP + FP / 2 });
    };
    const at = (p: { tx: number; ty: number }): number => dist(x, y, p.tx + 0.5, p.ty + 0.5);
    const tour = this.tourPoints(c);

    // Threats: armed enemy units it sees within SCOUT_DANGER tiles, and defences that close.
    const threats: { x: number; y: number }[] = [];
    for (const u of c.foes) if (unitDef(u.kind).weapon && dist(u.x / FP, u.y / FP, x, y) <= SCOUT_DANGER) threats.push({ x: u.x / FP, y: u.y / FP });
    for (const b of c.enemyBuildings) {
      const d = buildingDef(b.kind);
      if (d.weapon && edgeDist(b, x, y) <= SCOUT_DANGER) threats.push({ x: b.tx + d.w / 2, y: b.ty + d.h / 2 });
    }
    if (threats.length > 0) {
      const near = (p: { tx: number; ty: number }): number => Math.min(...threats.map((t) => dist(t.x, t.y, p.tx + 0.5, p.ty + 0.5)));
      const here = Math.min(...threats.map((t) => dist(t.x, t.y, x, y)));
      const away = (p: { tx: number; ty: number }): boolean => near(p) > here && !this.unsafe(c, p);
      // Already on its way to such a point: keep going.
      const goal = this.scoutGoal;
      if (this.backing && goal && away(goal)) return go(goal);
      this.backing = true;
      let best = -1;
      tour.forEach((p, i) => {
        if (at(p) >= 2 && away(p) && (best < 0 || at(p) < at(tour[best] as { tx: number; ty: number }))) best = i;
      });
      if (best < 0) return go(stage);
      this.tourStep = best;
      return go(tour[best] as { tx: number; ty: number });
    }

    // Touring: on to the next safe point once it reaches this one (or has stopped short of it).
    const goal = this.scoutGoal;
    const reached = goal !== null && (at(goal) < 2.5 || me.dest === null);
    const here = { x, y };
    if (goal && !reached && !this.backing && !this.unsafe(c, goal, here)) return go(goal);
    // Reached (or stopped short of) a tour point: the next one.
    if (goal && reached && (goal.tx !== stage.tx || goal.ty !== stage.ty)) this.tourStep++;
    this.backing = false;
    for (let k = 0; k <= tour.length; k++) {
      if (this.tourStep >= tour.length) {
        this.tourStep = 0;
        this.tourLaps++;
      }
      const p = tour[this.tourStep] as { tx: number; ty: number };
      if (at(p) >= 2.5 && !this.unsafe(c, p, here)) return go(p);
      this.tourStep++;
    }
    go(stage);
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
    const sw = c.buildings.find((b) => buildingDef(b.kind).superweapon && b.charge >= 100);
    if (!sw) return;
    let best: { tx: number; ty: number } | null = null;
    if (this.plan === 'doomsday') {
      // Hold the charged weapon until the wave is about to arrive, then clear the defences in its path (AI-15).
      if (this.chargedAt < 0) this.chargedAt = c.tick;
      const waiting = c.tick - this.chargedAt < STRIKE_HOLD;
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
    this.stats.superweaponShots++;
    this.chargedAt = -1;
    this.lastStrike = c.tick;
    // The wave goes straight into the struck area, to arrive while the defenders reel (AI-15).
    const doomsday = this.plan === 'doomsday';
    (doomsday ? this.first : out).push({ type: 'superweapon', player: this.player, building: sw.id, x: best.tx * FP + FP / 2, y: best.ty * FP + FP / 2 });
    if (doomsday && w && members.length) {
      w.tx = best.tx;
      w.ty = best.ty;
      w.lastOrder = c.tick;
      this.first.push({ type: 'attackmove', player: this.player, units: members.map((u) => u.id), x: best.tx * FP + FP / 2, y: best.ty * FP + FP / 2 });
    }
    if (this.stats.strikeAt < 0) {
      this.stats.strikeAt = c.tick;
      this.strike = best;
    }
  }
}
