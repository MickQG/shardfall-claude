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
}

export interface GameConfig {
  seed: number;
  map: MapDef;
  units?: UnitSpawn[];
}
