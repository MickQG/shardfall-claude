
/**
 * Terrain colours (NXT-3): ground blends grass and dirt with noise, raised tiles are rock with moss, cliff walls are rock
 * strata (the sunward side warmer), and blocked low tiles are water with depth and a shoreline. Pure functions of tile
 * coordinates, never of the simulation's random numbers.
 */

export interface TerrainInput {
  width: number;
  height: number;
  heights: readonly number[];
  /** Blocked tiles at level 0 are drawn as water. */
  blocked: (tx: number, ty: number) => boolean;
  shards: (tx: number, ty: number) => boolean;
}

type Rgb = [number, number, number];

const hash2 = (x: number, y: number): number => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

/** Smooth value noise in [0, 1] at a continuous position. */
export function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const d = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Three octaves of value noise, in [0, 1]. */
export function fbm(x: number, y: number): number {
  return (valueNoise(x, y) * 4 + valueNoise(x * 2.03 + 17, y * 2.03 + 9) * 2 + valueNoise(x * 4.11 + 31, y * 4.11 + 47)) / 7;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];
const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const GRASS: Rgb = [72, 86, 50];
const DRY: Rgb = [104, 100, 68];
const DIRT: Rgb = [98, 80, 60];
const ROCK: Rgb = [112, 106, 98];
const MOSS: Rgb = [84, 94, 66];
const MUD: Rgb = [70, 60, 46];
const CRYSTAL_GROUND: Rgb = [70, 110, 100];
const DEEP: Rgb = [18, 44, 66];
const SHALLOW: Rgb = [40, 92, 104];
const FOAM: Rgb = [170, 200, 196];
const CLIFF: Rgb = [128, 112, 94];

/** What surrounds a ground point: used for the contact shadow, the shoreline and crystal tint. */
export interface GroundContext {
  level: number;
  water: boolean;
  /** 0..1, 1 at a cliff base or shore. */
  shade: number;
  shore: number;
  shards: boolean;
}

/** Colour of the ground at tile (tx, ty) and position (fx, fy) inside it. Pure. */
export function groundRgb(tx: number, ty: number, fx: number, fy: number, c: GroundContext): Rgb {
  const wx = tx + fx;
  const wy = ty + fy;
  const grain = 0.92 + valueNoise(wx * 9.7, wy * 9.7) * 0.16;
  let col: Rgb;
  if (c.water) {
    const ripple = valueNoise(wx * 3.1 + 5, wy * 3.1) * 0.25;
    col = mix(SHALLOW, DEEP, Math.min(1, 1 - c.shore + ripple));
    col = mix(col, FOAM, smooth(0.82, 1, c.shore) * 0.55);
    return col;
  }
  if (c.level > 0) {
    const n = fbm(wx * 0.9 + 40, wy * 0.9);
    col = mix(ROCK, MOSS, smooth(0.55, 0.75, n));
    col = scale(col, 0.95 + c.level * 0.05);
  } else {
    const patches = fbm(wx * 0.42, wy * 0.42);
    const dry = fbm(wx * 0.13 + 90, wy * 0.13 + 20);
    const tufts = valueNoise(wx * 3.3 + 7, wy * 3.3 + 3);
    col = mix(GRASS, DRY, smooth(0.42, 0.72, dry) * 0.8);
    col = mix(col, DIRT, smooth(0.55, 0.7, patches) * 0.85);
    col = scale(col, 0.94 + tufts * 0.12);
    if (c.shore > 0) col = mix(col, MUD, c.shore * 0.85);
    if (c.shards) col = mix(col, CRYSTAL_GROUND, 0.35);
  }
  col = scale(col, grain * (1 - 0.42 * c.shade));
  return col;
}

/** Colour of a cliff wall pixel: horizontal strata, lit on the sunward (+y, screen left) side and cool on the other. */
export function cliffRgb(wx: number, wy: number, depth: number, sunward: boolean): Rgb {
  const strata = 0.82 + valueNoise(wx * 2 + depth * 0.45, depth * 0.9) * 0.3;
  const base = scale(CLIFF, strata * (1 - depth * 0.012));
  return sunward ? mix(base, [190, 150, 100], 0.12) : mix(scale(base, 0.58), [60, 66, 104], 0.25);
}
