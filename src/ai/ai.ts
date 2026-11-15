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

/** A remembered sighting of an enemy unit: its kind, where and when it was last seen (AI-2: only what the AI saw). */
export interface Remembered {
  kind: string;
  x: number;
  y: number;
  t: number;
}

interface Wave {
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
  /** Standing scouts (AI-21): ticks each lost one lived from when it stood, and the tick the living one stood, or -1. */
  standingLives: number[];
  standingSince: number;
}

/** Options of an AI beyond difficulty and personality. */
export interface AiOptions {
  /** The standing scout (AI-21), on unless false; off only in measurement (the harness), to compare with the old scouting. */
  standingScout?: boolean;
  /** Its rules (AI-22 to AI-24), each switchable for measurement; DEFAULT_RULES where not given. */
  rules?: Partial<AiRules>;
}

/**
 * The rules of AI-22 to AI-24 that stay switchable, so later balance work can measure each one alone (HAR-5, HAR-6).
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
  /** Whether it sends out a scout. */
  scouts: boolean;
  /** Whether it pulls a beaten wave back to the staging point, or calls it home to defend the base. */
  retreats: boolean;
}

const FULL_DOCTRINE: Doctrine = { trains: () => true, scouts: true, retreats: true };

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
  readonly stats: AiStats = { waves: 0, retreats: 0, suicides: 0, lone: 0, scoutedAt: -1, defends: 0, superweaponShots: 0, firstWaveAt: -1, earlyWaves: 0, economyWaves: 0, superweaponAt: -1, strikeAt: -1, strikeArrival: -1, labAt: -1, produced: { inf: 0, at: 0, tank: 0, art: 0, air: 0, scout: 0, hero: 0 }, superweaponOrder: null, scoutsLost: 0, scoutLifetimes: [], scoutingSince: [], intelThinks: 0, intelFresh: 0, standingLives: [], standingSince: -1 };
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
    const r = new Rng(seed * 7919 + player * 104729 + 13);
    const f = (): number => r.int(1000) / 1000;
    this.jitter = { wave: 0.9 + 0.35 * f(), ratio: 1.15 + 0.3 * f(), stage: 11 + Math.floor(4 * f()) };
    this.rules = { ...DEFAULT_RULES, ...options.rules };
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
    // Scatter orders (AI-24) come out of the same share, ahead of them.
    const share = Math.max(1, Math.ceil(this.diff.maxCommands / 2));
    const crush = [...this.scatterOrders(c), ...crushOrders(me, c.army, c.foes, snap.mapWidth, snap.mapHeight)].slice(0, share);
    for (const o of crush) if (o.type === 'scatter') for (const id of o.units) this.scattered.set(id, c.tick);
    // Doomsday's strike and the order sending its wave into it go first, ahead of everything else (AI-15).
    const first = this.first.splice(0);
    return [...first, ...out.slice(0, Math.max(0, this.diff.maxCommands - crush.length - first.length)), ...crush];
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
  private scatterOrders(c: Ctx): Command[] {
    if (!this.rules.scatter || !this.doctrine.retreats) return [];
    const crushers = c.foes.filter((f) => unitDef(f.kind).crusher);
    if (crushers.length === 0) return [];
    const groups = new Map<number, number[]>();
    for (const u of c.army) {
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

  /** Its standing scout's unit id, or -1 (AI-21): for measurement only. */
  get standingScout(): number {
    return this.standing;
  }

  /** What it remembers of enemy units, by unit id (AI-21): for measurement only; nothing it has not seen. */
  get sightings(): ReadonlyMap<number, Readonly<Remembered>> {
    return this.intel;
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
    // Another barracks or factory whenever every one is busy and the bank is full, whichever it has fewer of (AI-22).
    const grow = this.growth(c);
    if (grow) return powered(grow);
    if (refineries < 3 && haulers >= 4 && c.credits > 1100) return powered(k.refinery);
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
    const unserved = d.refinery ? this.fields.find((f) => f.tiles.some((t) => (snap.shards[t] as number) > 0) && !c.buildings.some((b) => buildingDef(b.kind).refinery && dist(b.tx + 1.5, b.ty + 1, f.cx, f.cy) <= 9)) : undefined;
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
    const aim = this.doctrine.place?.(kind);
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
    for (const u of c.army) counts[roleOf(unitDef(u.kind))]++;
    if (this.scoutId >= 0) counts.scout++;
    if (this.standing >= 0) counts.scout++;
    const queued = new Map<string, number>();
    for (const b of c.buildings) for (const q of b.queue) if (!BUILDING_DEFS[q.kind]) queued.set(q.kind, (queued.get(q.kind) ?? 0) + 1);
    for (const [kind, n] of queued) counts[roleOf(unitDef(kind))] += n;
    return { counts, queued };
  }

  /**
   * Whether Doomsday trains no further infantry now (AI-15): it has its rifle floor, its tanks and artillery set the
   * pace and it has three cheap units for each of them already, and its base is not under pressure.
   */
  private doomCaps(counts: Readonly<Record<Role, number>>, rifles: number, urgent: boolean): boolean {
    return this.plan === 'doomsday' && !urgent && counts.tank + counts.art >= 4 && counts.inf + counts.at >= rifles + 3 * (counts.tank + counts.art);
  }

  private urgent(c: Ctx): boolean {
    return c.army.length < 4 || c.tick - this.lastThreat < 600;
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
    for (const b of c.buildings) for (const q of b.queue) if (UNIT_DEFS[q.kind] && roleOf(unitDef(q.kind)) === 'art') guns++;
    const urgent = this.urgent(c);
    const tilt = this.plan === 'raider' ? RAIDER_TILT : this.plan === 'doomsday' ? TECH_TILT : undefined;
    const rifles = this.plan === 'doomsday' ? infantryNeeded(this.intelSummary(c, RIFLE_INTEL)) : 0;
    // Doomsday saving for its superweapon does not spend on the floor (AI-15, AI-19).
    const floor = doom && next === this.kit.superweapon ? 0 : artilleryNeeded(intel);
    const haulerWanted = this.haulerTarget(c) - c.haulers.length - (queued.get(this.kit.hauler) ?? 0);
    // Haulers queued before this turn; those ordered during it count against haulerWanted (the steamroll's pick, HAR-5).
    const queuedBefore = queued.get(this.kit.hauler) ?? 0;
    // The standing scout (AI-21): one from the building that trains it, ahead of its other combat units, when none lives
    // or is queued and none was lost lately (SCOUT_REPLACE, or twice that after a young one). Production trains no other
    // scout unit. The steamroll opponent sends out no scout (HAR-5).
    const scoutKind = this.doctrine.scouts ? this.scoutKind() : null;
    let scoutWanted = scoutKind !== null && (this.standing >= 0 ? 1 : 0) + (queued.get(scoutKind) ?? 0) < STANDING_SCOUTS && c.tick - this.standingLostAt >= this.replaceGap;

    for (const b of c.buildings) {
      // Shallow queues (AI-22): credits are not locked in orders that will not start soon. The steamroll opponent keeps
      // the deeper queues it was calibrated with (HAR-5).
      const depth = steamroll ? (c.credits > 3000 ? 5 : c.credits > 2000 ? 4 : c.credits > 1100 ? 3 : 2) : c.credits > QUEUE_DEEP_BANK ? this.rules.queueDepthRich : this.rules.queueDepth;
      if (b.queue.length >= depth || b.queue.length >= QUEUE_MAX) continue;
      const trainable = Object.keys(UNIT_DEFS).filter((k) => unitDef(k).builtAt === b.kind && unitDef(k).faction === this.faction && this.doctrine.trains(k));
      if (trainable.length === 0) continue;
      // A hero only while the player has none, alive or queued (HERO-1).
      // No more artillery while rules.artilleryCap pieces are in production (AI-22); the steamroll opponent trains none.
      const allowed = trainable.filter(
        (k) => unitDef(k).requires.every((r) => c.buildings.some((x) => x.kind === r)) && !(unitDef(k).hero && (queued.has(k) || c.own.some((u) => u.kind === k))) && !(roleOf(unitDef(k)) === 'art' && guns >= this.rules.artilleryCap),
      );
      // Its hero takes the field whenever it is available and affordable with credits to spare (HERO-1).
      const hero = allowed.find((k) => unitDef(k).hero && c.credits >= unitDef(k).cost + 400);
      // Doomsday keeps enough rifle infantry for the enemy's infantry before anything else from the barracks (AI-15).
      const rifle = counts.inf < rifles ? allowed.find((k) => roleOf(unitDef(k)) === 'inf' && !unitDef(k).hero) : undefined;
      // Artillery floor against enemy infantry (AI-19), when it is available here.
      const gun = counts.art < floor ? allowed.find((k) => roleOf(unitDef(k)) === 'art' && !unitDef(k).hero) : undefined;
      const scout = scoutWanted && scoutKind !== null && allowed.includes(scoutKind) ? scoutKind : undefined;
      const pick: string | null = this.doctrine.pick
        ? this.doctrine.pick(b.kind, allowed, haulerWanted - ((queued.get(this.kit.hauler) ?? 0) - queuedBefore))
        : b.kind === this.kit.factory && haulerWanted > 0 && allowed.includes(this.kit.hauler)
          ? this.kit.hauler
          : (scout ?? hero ?? rifle ?? gun ?? chooseUnitKind(allowed.filter((k) => k !== this.kit.hauler && !unitDef(k).hero && k !== scoutKind), counts, intel, tilt));
      if (!pick) continue;
      // Doomsday does not flood the field with cheap infantry beyond its rifle floor: tanks and artillery set the pace (AI-15).
      if (doom && !rifle && (roleOf(unitDef(pick)) === 'inf' || roleOf(unitDef(pick)) === 'at') && this.doomCaps(counts, rifles, urgent)) continue;
      const cost = unitDef(pick).cost;
      const reserve = pick === this.kit.hauler || pick === scout || urgent || (b.queue.length === 0 && !saving && !steamroll) ? 0 : hold;
      if (c.credits < cost + reserve) continue;
      c.credits -= cost;
      out.push({ type: 'produce', player: this.player, source: b.id, kind: pick });
      counts[roleOf(unitDef(pick))]++;
      if (pick !== this.kit.hauler) this.stats.produced[unitDef(pick).hero ? 'hero' : roleOf(unitDef(pick))]++;
      if (pick === this.kit.hauler || unitDef(pick).hero) queued.set(pick, (queued.get(pick) ?? 0) + 1);
      if (pick === scout) scoutWanted = false;
      if (roleOf(unitDef(pick)) === 'art') guns++;
    }
  }

  private haulerTarget(c: Ctx): number {
    const refs = c.buildings.filter((b) => buildingDef(b.kind).refinery).length;
    // Three haulers a refinery fill both home fields (AI-18).
    const standard = refs === 0 ? 0 : Math.min(8, refs * 3);
    return this.doctrine.haulers ? this.doctrine.haulers(standard) : standard;
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
    const guarded = (t: { tx: number; ty: number }): number => {
      let v = 0;
      for (const e of this.intel.values()) {
        const d = UNIT_DEFS[e.kind];
        if (d?.weapon && d.capacity === undefined && c.tick - e.t <= RAID_GUARD_AGE && dist(tileOf(e.x), tileOf(e.y), t.tx, t.ty) <= RAID_GUARD_R) v += d.cost;
      }
      for (const b of c.enemyBuildings) if (buildingDef(b.kind).weapon && edgeDist(b, t.tx + 0.5, t.ty + 0.5) <= RAID_GUARD_R) v += buildingDef(b.kind).cost * 1.5;
      return v;
    };
    return this.economyTargets(c).find((t) => guarded(t) < RAID_GUARD_SHARE * raid) ?? null;
  }

  private attackLogic(c: Ctx, out: Command[]): void {
    const stage = this.staging as { tx: number; ty: number };
    const army = c.army;
    // The steamroll opponent keeps its own attack rule and never retreats (HAR-5).
    const ordinary = this.doctrine.retreats;
    const own = this.armyPower(army);
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
      // The wave is the units that set out together (AI-11) and the reinforcements that joined it; others wait.
      const members = army.filter((u) => w.members.has(u.id));
      const rest = army.filter((u) => !w.members.has(u.id));
      const p = this.armyPower(members);
      // Its strength counts its reinforcements: the strongest it has been (AI-23).
      w.peak = Math.max(w.peak, p);
      const { x: cx, y: cy } = members.length ? centre(members) : { x: stage.tx, y: stage.ty };
      const local = this.enemyPowerNear(c, Math.floor(cx), Math.floor(cy), LOCAL_R);
      // Doomsday commits while its strike is charged or has just landed: the strike, not a retreat, answers resistance (AI-15).
      const committed = this.plan === 'doomsday' && (c.buildings.some((b) => buildingDef(b.kind).superweapon && b.charge >= 100) || (this.lastStrike >= 0 && c.tick - this.lastStrike < 400));
      if (!ordinary) {
        // The steamroll opponent never pulls a wave back (HAR-5): it drives on until the wave is gone, then forms the next.
        if (members.length === 0) {
          this.wave = null;
          this.lastWaveEnd = c.tick;
          return;
        }
      } else if (this.rules.recall && members.length > 0 && this.baseInDanger(c, own)) {
        // An enemy force worth half its army near its buildings: the wave comes home to fight at the hold point (AI-23).
        const holdAt = this.holdPoint(c);
        this.recallPoint = holdAt;
        order('attackmove', members, holdAt.tx, holdAt.ty);
        this.wave = null;
        this.waveCooldown = c.tick + 500;
        this.lastWaveEnd = c.tick;
        return;
      } else if (members.length <= 2 || (!committed && (p <= 0.45 * (this.rules.wavePeak ? w.peak : w.start) || local >= 1.5 * p))) {
        // A beaten wave falls back to the staging point (AI-8, AI-23).
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
      } else if (members.length === 0) {
        // Nothing left of it: the next wave forms at the gathering point.
        this.wave = null;
        this.lastWaveEnd = c.tick;
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
        // Reinforcements gather at the gathering point and join in groups, never one at a time (AI-11); and only while the
        // wave is at least as strong as the enemy it has seen near it, so none are fed into a losing fight (AI-23).
        const home = rest.filter((u) => dist(tileOf(u.x), tileOf(u.y), stage.tx, stage.ty) < 10);
        const join = !ordinary || !this.rules.noFeed || p >= local;
        if (join && home.length >= Math.max(3, Math.ceil(0.25 * w.size))) {
          order('attackmove', home, cx, cy);
          for (const u of home) w.members.add(u.id);
        } else order('attackmove', rest.filter((u) => u.dest === null && !home.includes(u)), stage.tx, stage.ty);
      }
      return;
    }

    if (!threatened) {
      // Gather at the staging point (AI-11).
      const away = army.filter((u) => u.dest === null && dist(tileOf(u.x), tileOf(u.y), stage.tx, stage.ty) > 7);
      if (away.length > 0 && c.tick % 3 === 0) order('attackmove', away, stage.tx, stage.ty);
    }

    if (threatened || c.tick < this.waveCooldown) return;
    const p = own;
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
    // The steamroll opponent sets out once its army is big enough, whatever it knows of the enemy (HAR-5).
    const launch = this.doctrine.launch;
    let ready = launch ? launch(p, army.filter((u) => unitDef(u.kind).crusher).length) : shouldAttack(p, est, army.length, threshold, this.jitter.ratio) && !(raiding && army.length < RAID_MIN_ARMY);
    // Stalemate (AI-23): after three quiet minutes, with five barracks and five factories or a big army, it attacks at
    // parity with the enemy army it has seen plus the defences at the target.
    if (!ready && ordinary && this.rules.stalemate && army.length >= 5 && c.tick - this.lastWaveAt >= STALEMATE_QUIET && c.tick - this.lastThreat >= STALEMATE_QUIET) {
      const plants = (kind: string): number => c.buildings.filter((b) => b.kind === kind).length;
      const big = (plants(this.kit.barracks) >= GROWTH_MAX && plants(this.kit.factory) >= GROWTH_MAX) || p >= STALEMATE_ARMY;
      const parity = this.seenArmy(c, STALEMATE_SEEN) + defences;
      if (big && p >= parity) {
        ready = true;
        est = parity;
      }
    }
    if (!ready) {
      this.gatherSince = -1;
      return;
    }
    // Strong enough: set out only once most of the army has gathered (AI-11), or after a while.
    const gathered = army.filter((u) => dist(tileOf(u.x), tileOf(u.y), stage.tx, stage.ty) <= GATHER_R);
    if (this.gatherSince < 0) this.gatherSince = c.tick;
    // A charged strike does not wait for stragglers: the army goes in together with it (AI-15).
    if (!striking && gathered.length < GATHER_SHARE * army.length && c.tick - this.gatherSince < GATHER_WAIT) return;
    this.gatherSince = -1;
    const wave = gathered.length >= 3 && !striking && !launch ? gathered : army;
    const wp = this.armyPower(wave);
    // What sets out is the raid: its target must still be one it may go for (AI-23).
    if (raiding && guard && wave.length < army.length) {
      const t = this.raidTarget(c, wp);
      if (!t) return;
      target = t;
    }
    this.stats.waves++;
    this.lastWaveAt = c.tick;
    if (this.stats.firstWaveAt < 0) this.stats.firstWaveAt = c.tick;
    if (c.tick < RAIDER_OPENING_END) {
      this.stats.earlyWaves++;
      if (this.isEconomy(c, target)) this.stats.economyWaves++;
    }
    if (p < 0.8 * est) this.stats.suicides++;
    if (wave.length < 5) this.stats.lone++;
    this.wave = { tx: target.tx, ty: target.ty, peak: wp, start: wp, lastOrder: c.tick, members: new Set(wave.map((u) => u.id)), size: wave.length, held: false };
    const { x, y } = centre(wave);
    const d = dist(x, y, target.tx, target.ty);
    order('attackmove', wave, x + ((target.tx - x) * Math.min(d, WAVE_HOP)) / Math.max(1, d), y + ((target.ty - y) * Math.min(d, WAVE_HOP)) / Math.max(1, d));
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
    if (this.standing >= 0) return;
    const next = own.filter((u) => u.kind === kind).sort((a, b) => a.id - b.id)[0];
    if (!next) return;
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

    // Threats, whatever its health: armed units within scoutKeep tiles, defences within SCOUT_DANGER.
    const armed = c.foes.filter((u) => unitDef(u.kind).weapon && dist(u.x / FP, u.y / FP, x, y) <= Math.max(sight, scoutKeep(u.kind))).map((u) => ({ x: u.x / FP, y: u.y / FP, r: scoutKeep(u.kind) }));
    const defences = c.enemyBuildings.filter((b) => buildingDef(b.kind).weapon && edgeDist(b, x, y) <= SCOUT_DANGER).map((b) => ({ x: b.tx + buildingDef(b.kind).w / 2, y: b.ty + buildingDef(b.kind).h / 2 }));
    if (armed.some((u) => dist(u.x, u.y, x, y) <= u.r) || defences.length > 0) {
      const from = [...armed, ...defences];
      const cx = from.reduce((t, p) => t + p.x, 0) / from.length;
      const cy = from.reduce((t, p) => t + p.y, 0) / from.length;
      const nearest = (px: number, py: number): number => Math.min(...from.map((p) => dist(p.x, p.y, px, py)));
      if (!this.fleeing) this.tourDir = -this.tourDir;
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
      // Decided afresh every time; a new order only when the way to flee has turned (or it has got there).
      const f = this.fleeing;
      const target = to ?? stage;
      this.scoutHop = null;
      this.scoutGoal = null;
      this.way = null;
      if (f && me.dest !== null && at(f) > 1.5) {
        const ax = f.tx + 0.5 - x;
        const ay = f.ty + 0.5 - y;
        const bx = target.tx + 0.5 - x;
        const by = target.ty + 0.5 - y;
        if ((ax * bx + ay * by) / ((Math.hypot(ax, ay) || 1) * (Math.hypot(bx, by) || 1)) > 0.87) return;
      }
      this.fleeing = target;
      return move(target);
    }
    this.fleeing = null;
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
