import { buildingDef, choosePad, nearestShard2, unitDef, type Faction } from '../data/defs';
import { dirOf } from './facing';
import { centerOf, FP } from './fixed';
import { createFog } from './fog';
import { isBlocked, type Grid } from './path';
import { Rng } from './rng';
import type { BuildingSnap, Command, GameConfig, PlayerStats, SimEvent } from './types';

export enum Hv {
  Idle = 0,
  ToField = 1,
  Gather = 2,
  ToRefinery = 3,
  /** On the dock pad, unloading (ECO-7). */
  Unload = 4,
  /** Holding the refinery's dock pad and driving onto it (ECO-7). */
  ToPad = 5,
  /** Waiting beside a taken dock pad for its turn (ECO-8). */
  Queue = 6,
}

/**
 * One group order's shared route work (SIM-10): the distance field to the group's destination tile, made when the first
 * of its units is routed; every member walks down it and finishes with a short search to its own tile. `rev` is the grid
 * revision it was made on; it is made again if the grid has changed since (a building placed or destroyed).
 */
export interface GroupRoute {
  /** Destination tile: a free tile, or a building's middle tile (the field then starts from the tiles next to it). */
  to: number;
  rev: number;
  field: Int32Array | null;
}

export interface Unit {
  id: number;
  owner: number;
  kind: string;
  x: number;
  y: number;
  hp: number;
  /** Remaining tile indices to walk through. */
  path: number[];
  /** Assigned destination tile index, or -1. */
  goal: number;
  /** True while a route to `goal` is wanted; the unit keeps walking its old `path`, if any, until it is served (SIM-10). */
  waiting: boolean;
  /** True while the unit's id stands in a route queue (at most once, SIM-10); may outlive `waiting` if the order is dropped. */
  queued: boolean;
  /** Its route request is for an order given by a player or an AI, served ahead of automatic re-routes (SIM-10). */
  urgent: boolean;
  /** The group order it was given, whose shared distance field speeds up its route search (SIM-10); null otherwise. */
  group: GroupRoute | null;
  /** Haulers: run the harvest loop on their own. */
  auto: boolean;
  hv: Hv;
  load: number;
  /** Haulers: the refinery (building id) it is heading for, queueing at or unloading into, or -1 (ECO-7). */
  dock: number;
  /** Haulers: when it joined the refinery's line (ECO-8), and how often it has tried to reach the pad in vain. */
  queuedAt: number;
  dockTries: number;
  /** Haulers: a shard tile index marking the field it works, or -1 until its first assignment (ECO-8). */
  home: number;
  /** Ticks since the unit last took damage (alien regeneration). */
  sinceHurt: number;
  /** Combat target id (unit or building), or -1. */
  target: number;
  cooldown: number;
  /** Ticks until the second weapon (missile pods) can fire again (HERO-7). */
  cooldown2: number;
  /** How the unit is currently acting: idle (auto-engage), a plain move, attack-move or a focused attack. */
  mode: Mode;
  /** Attack-move destination tile index, or -1. */
  amove: number;
  /** Veterancy: damage dealt to enemies so far, and the rank it has earned (VET-1). */
  xp: number;
  rank: number;
  /** Facing, in steps of 256 a circle; turned slowly by units with a turn rate (HERO-5), else unused. */
  facing: number;
}

export type Mode = 'idle' | 'move' | 'amove' | 'attack';

export interface Projectile {
  hit: number;
  x: number;
  y: number;
  targetId: number;
  owner: number;
  damage: number;
  type: string;
  splash: number;
  air: boolean;
  /** Unit that fired it, credited with the damage (VET-1); -1 for buildings. */
  shooter: number;
}

export interface Strike {
  /** The superweapon's building kind (for its look; not part of the state hash). */
  kind: string;
  hit: number;
  x: number;
  y: number;
  owner: number;
  damage: number;
  radius: number;
}

export interface QueueItem {
  kind: string;
  cost: number;
  /** Progress in half-ticks (2 per tick at full power). */
  progress: number;
  total: number;
  ready: boolean;
}

export interface Building {
  id: number;
  owner: number;
  kind: string;
  tx: number;
  ty: number;
  hp: number;
  queue: QueueItem[];
  rally: [number, number] | null;
  repairing: boolean;
  cooldown: number;
  /** Superweapon charge in ticks. */
  charge: number;
  target: number;
  /** Refineries: the dock pad tile [tx, ty], beside the side facing the nearest shards, chosen once when placed (ECO-7). */
  pad: [number, number] | null;
}

export interface Player {
  faction: Faction;
  credits: number;
  /** Percent bonus on delivered shards. */
  bonus: number;
  powerOut: number;
  powerIn: number;
  /** Last-seen enemy buildings that are no longer visible, keyed by building id. */
  ghosts: Map<number, BuildingSnap>;
  stats: PlayerStats;
}

/** Ticks between army-value samples (ten seconds). */
export const STATS_EVERY = 200;

export interface State {
  tick: number;
  rng: Rng;
  cfg: GameConfig;
  /** Pathing grid: terrain plus building footprints. */
  grid: Grid;
  units: Unit[];
  buildings: Building[];
  players: Player[];
  fog: Uint8Array[];
  shards: Uint16Array;
  /** Original shard amounts (regrow targets). */
  shardSeed: Uint16Array;
  nextId: number;
  pending: Command[];
  /** Route requests for orders given by a player or an AI, first come first served (SIM-10). */
  orderQueue: number[];
  /** Bumped whenever the pathing grid changes, so stale distance fields are not used (SIM-10). */
  gridRev: number;
  /** Automatic route requests (chasing, attack-move, haulers, rally), served after `orderQueue` (SIM-10). */
  pathQueue: number[];
  projectiles: Projectile[];
  strikes: Strike[];
  /** Per player and tile, the tick until which the tile stays in sight after it was last seen (FOG-6, FOG-7). */
  sightUntil: Int32Array[];
  events: SimEvent[];
  over: boolean;
  winner: number | null;
}

export const QUEUE_MAX = 20;

export function createState(cfg: GameConfig): State {
  const { width, height } = cfg.map;
  const n = width * height;
  const blocked = new Uint8Array(n);
  cfg.map.blocked?.forEach((v, i) => {
    blocked[i] = v ? 1 : 0;
  });
  const shards = new Uint16Array(n);
  cfg.map.shards?.forEach((v, i) => {
    shards[i] = v;
  });
  const setups = cfg.players ?? [
    { faction: 'human' as const, credits: 0 },
    { faction: 'alien' as const, credits: 0 },
  ];
  const s: State = {
    tick: 0,
    rng: new Rng(cfg.seed),
    cfg,
    grid: { width, height, blocked },
    units: [],
    buildings: [],
    players: setups.map((p) => ({ faction: p.faction, credits: p.credits, bonus: p.bonus ?? 0, powerOut: 0, powerIn: 0, ghosts: new Map(), stats: { unitsBuilt: 0, unitsLost: 0, buildingsBuilt: 0, buildingsLost: 0, shardsGathered: 0, army: [] } })),
    fog: setups.map(() => createFog(width, height)),
    shards,
    shardSeed: shards.slice(),
    nextId: 1,
    pending: [],
    orderQueue: [],
    gridRev: 0,
    pathQueue: [],
    projectiles: [],
    strikes: [],
    sightUntil: setups.map(() => new Int32Array(width * height)),
    events: [],
    over: false,
    winner: null,
  };
  for (const b of cfg.buildings ?? []) addBuilding(s, b.owner, b.kind, b.tx, b.ty);
  for (const u of cfg.units ?? []) addUnit(s, u.owner, u.kind, centerOf(u.tx), centerOf(u.ty));
  return s;
}

export function addUnit(s: State, owner: number, kind: string, x: number, y: number): Unit {
  const d = unitDef(kind);
  const u: Unit = {
    id: s.nextId++, owner, kind, x, y, hp: d.hp, path: [], goal: -1, waiting: false, queued: false, urgent: false, group: null,
    auto: d.capacity !== undefined, hv: Hv.Idle, load: 0, dock: -1, queuedAt: 0, dockTries: 0, home: -1, sinceHurt: 1000, target: -1, cooldown: 0, cooldown2: 0, mode: 'idle', amove: -1, xp: 0, rank: 0,
    // A slow turner starts facing the middle of the map, where the fight is (HERO-5).
    facing: d.turnRate ? Math.max(0, dirOf(((s.grid.width * FP) >> 1) - x, ((s.grid.height * FP) >> 1) - y)) : 0,
  };
  s.units.push(u);
  return u;
}

export function addBuilding(s: State, owner: number, kind: string, tx: number, ty: number): Building {
  const d = buildingDef(kind);
  const W = s.grid.width;
  const open = (x: number, y: number): boolean => !isBlocked(s.grid, x, y);
  const pad = choosePad(kind, tx, ty, W, s.grid.height, open, (x, y) => nearestShard2(s.shards, W, x, y)) ?? null;
  const b: Building = { id: s.nextId++, owner, kind, tx, ty, hp: d.hp, queue: [], rally: null, repairing: false, cooldown: 0, charge: 0, target: -1, pad };
  s.buildings.push(b);
  rebuildBlocked(s);
  return b;
}

/** Recompute the pathing grid from terrain plus building footprints. */
export function rebuildBlocked(s: State): void {
  s.gridRev++;
  const { width, height, blocked } = s.grid;
  const terrain = s.cfg.map.blocked;
  for (let i = 0; i < width * height; i++) blocked[i] = terrain?.[i] ? 1 : 0;
  for (const b of s.buildings) {
    const d = buildingDef(b.kind);
    for (let y = b.ty; y < b.ty + d.h; y++) for (let x = b.tx; x < b.tx + d.w; x++) if (x >= 0 && y >= 0 && x < width && y < height) blocked[y * width + x] = 1;
  }
}

export const buildingById = (s: State, id: number): Building | undefined => s.buildings.find((b) => b.id === id);
export const unitById = (s: State, id: number): Unit | undefined => s.units.find((u) => u.id === id);

/** True if the owner has at least one building of every listed kind. */
export function hasKinds(s: State, owner: number, kinds: readonly string[]): boolean {
  return kinds.every((k) => s.buildings.some((b) => b.owner === owner && b.kind === k));
}

/** Chebyshev gap in tiles between a tile and a building footprint (0 = on or touching diagonally/adjacent). */
export function gapToBuilding(b: Building, tx: number, ty: number): number {
  const d = buildingDef(b.kind);
  const dx = Math.max(b.tx - tx, tx - (b.tx + d.w - 1), 0);
  const dy = Math.max(b.ty - ty, ty - (b.ty + d.h - 1), 0);
  return Math.max(dx, dy);
}
