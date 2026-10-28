import { buildingDef, unitDef, type Faction } from '../data/defs';
import { centerOf } from './fixed';
import { createFog } from './fog';
import type { Grid } from './path';
import { Rng } from './rng';
import type { BuildingSnap, Command, GameConfig } from './types';

export enum Hv {
  Idle = 0,
  ToField = 1,
  Gather = 2,
  ToRefinery = 3,
  Unload = 4,
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
  /** True while a path request for `goal` is queued. */
  waiting: boolean;
  /** Haulers: run the harvest loop on their own. */
  auto: boolean;
  hv: Hv;
  load: number;
  /** Ticks since the unit last took damage (alien regeneration). */
  sinceHurt: number;
  /** Combat target id (unit or building), or -1. */
  target: number;
  cooldown: number;
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
}

export interface Player {
  faction: Faction;
  credits: number;
  powerOut: number;
  powerIn: number;
  /** Last-seen enemy buildings that are no longer visible, keyed by building id. */
  ghosts: Map<number, BuildingSnap>;
}

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
  pathQueue: number[];
}

export const QUEUE_MAX = 5;

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
    players: setups.map((p) => ({ faction: p.faction, credits: p.credits, powerOut: 0, powerIn: 0, ghosts: new Map() })),
    fog: setups.map(() => createFog(width, height)),
    shards,
    shardSeed: shards.slice(),
    nextId: 1,
    pending: [],
    pathQueue: [],
  };
  for (const b of cfg.buildings ?? []) addBuilding(s, b.owner, b.kind, b.tx, b.ty);
  for (const u of cfg.units ?? []) addUnit(s, u.owner, u.kind, centerOf(u.tx), centerOf(u.ty));
  return s;
}

export function addUnit(s: State, owner: number, kind: string, x: number, y: number): Unit {
  const d = unitDef(kind);
  const u: Unit = {
    id: s.nextId++, owner, kind, x, y, hp: d.hp, path: [], goal: -1, waiting: false,
    auto: d.capacity !== undefined, hv: Hv.Idle, load: 0, sinceHurt: 1000, target: -1, cooldown: 0,
  };
  s.units.push(u);
  return u;
}

export function addBuilding(s: State, owner: number, kind: string, tx: number, ty: number): Building {
  const d = buildingDef(kind);
  const b: Building = { id: s.nextId++, owner, kind, tx, ty, hp: d.hp, queue: [], rally: null, repairing: false, cooldown: 0, charge: 0, target: -1 };
  s.buildings.push(b);
  rebuildBlocked(s);
  return b;
}

/** Recompute the pathing grid from terrain plus building footprints. */
export function rebuildBlocked(s: State): void {
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
