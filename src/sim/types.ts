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
  /** Percent added to delivered shards (a difficulty handicap); default 0. */
  bonus?: number;
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
  | { type: 'rally'; player: number; building: number; x: number; y: number }
  /** Attack a specific unit or building. */
  | { type: 'attack'; player: number; units: number[]; target: number }
  /** Move to x, y (fixed-point), engaging enemies met on the way. */
  | { type: 'attackmove'; player: number; units: number[]; x: number; y: number }
  /** Fire a charged superweapon at x, y (fixed-point). */
  | { type: 'superweapon'; player: number; building: number; x: number; y: number };

/** One-tick effects for the renderer and audio. Positions are fixed-point world units. */
export type SimEvent =
  /** A shot; `elite` when a top-rank unit fired it (BAL-7). */
  | { t: 'shot'; x: number; y: number; tx: number; ty: number; weapon: string; owner: number; air: boolean; flight: number; src: number; elite?: boolean }
  | { t: 'boom'; x: number; y: number; r: number }
  /** A death; `crushed` when a heavy vehicle ran the squad over (BAL-1). */
  | { t: 'die'; x: number; y: number; big: boolean; owner: number; id: number; kind: string; crushed?: boolean }
  /**
   * A superweapon launched from (x, y) at the target (tx, ty), landing after `delay` ticks. A viewer who sees the target
   * but not the launch site gets it with `unseen` set, so only the target is marked (SW-2).
   */
  | { t: 'launch'; x: number; y: number; tx: number; ty: number; owner: number; kind: string; delay: number; unseen?: boolean }
  | { t: 'strike'; x: number; y: number; owner: number; kind: string; r: number };

export interface UnitSnap {
  /** Veterancy rank 0..3 (VET-3). */
  rank: number;
  /** Id of the unit or building it is attacking, or -1 (turrets track it: GFX-10). */
  target: number;
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
  /** Facing in steps of 256 a circle, for units that turn slowly (HERO-5): 0 along +x, increasing toward +y. */
  facing?: number;
  /** Haulers unloading at a refinery: its building id (ECO-7, R3D-22); absent otherwise. */
  dock?: number;
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
  /** Explicit rally point, fixed-point (own buildings and the god view only). */
  rally: [number, number] | null;
  /** Superweapon charge 0..100 (own buildings and the god view only). */
  charge: number;
}

/** End-of-game statistics for one player (SCR-1). */
export interface PlayerStats {
  unitsBuilt: number;
  unitsLost: number;
  buildingsBuilt: number;
  buildingsLost: number;
  /** Credits earned from delivered shards. */
  shardsGathered: number;
  /** Army value (credits, scaled by health) sampled every STATS_EVERY ticks from tick 0. */
  army: number[];
}

export interface PlayerSnap {
  faction: Faction;
  credits: number;
  powerOut: number;
  powerIn: number;
}

/**
 * A finished superweapon's countdown (SW-1). Every player sees every superweapon's timer, the enemy's too, even under
 * fog; where an enemy weapon stands is still only known once it is seen.
 */
export interface SuperweaponTimer {
  id: number;
  owner: number;
  kind: string;
  /** Ticks until it is charged; 0 when ready. */
  left: number;
  /** Not charging: its owner is low on power. */
  paused: boolean;
}

/** A launched superweapon strike on its way (SW-2): where it lands and when. */
export interface StrikeTimer {
  owner: number;
  kind: string;
  /** Ticks until impact. */
  left: number;
  /** Target, fixed-point. */
  x: number;
  y: number;
  /** Blast radius in tiles. */
  r: number;
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
  /** Effects of the tick that produced this snapshot (visible ones for a viewer). */
  events: SimEvent[];
  /** True once at most one player still has buildings. */
  over: boolean;
  /** Winning player, or null (game running, or a draw). */
  winner: number | null;
  /** Every player's statistics, once the game is over (always in the god view); null while a viewer's game runs. */
  stats: PlayerStats[] | null;
  /** Every finished superweapon's countdown, every player's (SW-1). */
  superweapons: SuperweaponTimer[];
  /** Superweapon strikes on their way (SW-2). */
  strikes: StrikeTimer[];
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
