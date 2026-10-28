import type { Faction } from '../data/defs';

export interface MapDef {
  width: number;
  height: number;
  /** Row-major per-tile height in whole levels (0..n). Visual only. */
  heights: number[];
  /** Row-major, 1 = impassable terrain. Omitted means all passable. */
  blocked?: number[];
  /** Row-major shard amounts per tile. Tiles with a positive value regrow toward half of it. */
  shards?: number[];
}

export interface UnitSpawn {
  owner: number;
  kind: string;
  /** Tile coordinates. */
  tx: number;
  ty: number;
}

export interface BuildingSpawn {
  owner: number;
  kind: string;
  /** Top-left tile of the footprint. */
  tx: number;
  ty: number;
}

export interface PlayerSetup {
  faction: Faction;
  credits: number;
}

export type Command =
  | { type: 'noop'; player: number }
  | { type: 'stop'; player: number; units: number[] }
  /** x, y in fixed-point world units. */
  | { type: 'move'; player: number; units: number[]; x: number; y: number }
  /** Haulers: resume the harvest loop (optionally toward the shard tile at x, y). */
  | { type: 'harvest'; player: number; units: number[]; x: number; y: number }
  | { type: 'produce'; player: number; source: number; kind: string }
  | { type: 'cancel'; player: number; source: number; index: number }
  /** Place the ready structure at the head of `source`'s queue; tx, ty = top-left tile. */
  | { type: 'place'; player: number; source: number; tx: number; ty: number }
  | { type: 'sell'; player: number; building: number }
  | { type: 'repair'; player: number; building: number; on: boolean }
  | { type: 'rally'; player: number; building: number; x: number; y: number };

export interface UnitSnap {
  id: number;
  owner: number;
  kind: string;
  /** Fixed-point world position. */
  x: number;
  y: number;
  hp: number;
  /** Assigned destination tile [tx, ty], or null. */
  dest: [number, number] | null;
  /** Shards carried (haulers). */
  load: number;
}

export interface QueueSnap {
  kind: string;
  /** Progress 0..100. */
  pct: number;
  /** Structures: finished and waiting to be placed. */
  ready: boolean;
}

export interface BuildingSnap {
  id: number;
  owner: number;
  kind: string;
  /** Top-left tile. */
  tx: number;
  ty: number;
  hp: number;
  /** Production queue (own buildings and the god view only). */
  queue: QueueSnap[];
  repairing: boolean;
  /** Superweapon charge 0..100 (own buildings and the god view only). */
  charge: number;
}

export interface PlayerSnap {
  faction: Faction;
  credits: number;
  powerOut: number;
  powerIn: number;
}

export interface Snapshot {
  tick: number;
  mapWidth: number;
  mapHeight: number;
  heights: readonly number[];
  units: UnitSnap[];
  buildings: BuildingSnap[];
  /** Last-seen enemy buildings no longer in view. */
  ghosts: BuildingSnap[];
  /** Shard amounts for tiles the viewer has explored (0 elsewhere). */
  shards: Uint16Array;
  /** Viewer's own data, or every player's in the god view. */
  players: PlayerSnap[];
  /** Viewer this snapshot is limited to; null for the god view. */
  viewer: number | null;
  /** Viewer fog grid (bit 1 explored, bit 2 visible); null for the god view. */
  fog: Uint8Array | null;
}

export interface GameConfig {
  seed: number;
  map: MapDef;
  units?: UnitSpawn[];
  buildings?: BuildingSpawn[];
  /** Defaults to two players: a human and an alien with no credits. */
  players?: PlayerSetup[];
}
