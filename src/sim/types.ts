export interface MapDef {
  width: number;
  height: number;
  /** Row-major per-tile height in whole levels (0..n). Visual only. */
  heights: number[];
  /** Row-major, 1 = impassable terrain. Omitted means all passable. */
  blocked?: number[];
}

export interface UnitSpawn {
  owner: number;
  kind: string;
  /** Tile coordinates. */
  tx: number;
  ty: number;
}

export type Command =
  | { type: 'noop'; player: number }
  | { type: 'stop'; player: number; units: number[] }
  /** x, y in fixed-point world units. */
  | { type: 'move'; player: number; units: number[]; x: number; y: number };

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
}

export interface Snapshot {
  tick: number;
  mapWidth: number;
  mapHeight: number;
  heights: readonly number[];
  units: UnitSnap[];
  /** Viewer this snapshot is limited to; null for the god view. */
  viewer: number | null;
  /** Viewer fog grid (bit 1 explored, bit 2 visible); null for the god view. */
  fog: Uint8Array | null;
}

export interface GameConfig {
  seed: number;
  map: MapDef;
  units?: UnitSpawn[];
  /** Number of players; defaults to 2. */
  players?: number;
}
