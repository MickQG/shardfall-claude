export interface MapDef {
  width: number;
  height: number;
  /** Row-major per-tile height in whole levels (0..n). */
  heights: number[];
}

export type Command = { type: 'noop'; player: number };

export interface Snapshot {
  tick: number;
  mapWidth: number;
  mapHeight: number;
  heights: readonly number[];
}

export interface GameConfig {
  seed: number;
  map: MapDef;
}
