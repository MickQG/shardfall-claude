import { TILE_H, TILE_W } from './iso';

/** Painted lift per height level. Taller than the gameplay HEIGHT_PX so plateaus read as cliffs; nothing stands on them. */
export const CLIFF_PX = 26;

/**
 * "Next" style terrain (NXT-3): a pure painter from the map grid to pixels. Ground blends grass and dirt with noise,
 * raised tiles are rock plateaus with strata cliff walls (the sunward wall lit, the other in cool shade), cliff bases get
 * a contact shadow, and blocked low tiles are water with depth and a shoreline. Everything comes from tile coordinates
 * and the map, never from the simulation's random numbers.
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

const level = (t: TerrainInput, x: number, y: number): number => (x < 0 || y < 0 || x >= t.width || y >= t.height ? 0 : (t.heights[y * t.width + x] ?? 0));
const isWater = (t: TerrainInput, x: number, y: number): boolean => x >= 0 && y >= 0 && x < t.width && y < t.height && level(t, x, y) === 0 && t.blocked(x, y);

/** Screen-space bounds (before camera) of the whole map, including cliff walls. */
export function terrainBounds(t: TerrainInput): { x: number; y: number; w: number; h: number } {
  const maxLevel = t.heights.reduce((m, h) => Math.max(m, h), 0);
  const x = -t.height * (TILE_W / 2);
  const y = -maxLevel * CLIFF_PX;
  return { x, y, w: (t.width + t.height) * (TILE_W / 2), h: (t.width + t.height) * (TILE_H / 2) + maxLevel * CLIFF_PX };
}

/**
 * Paint the tiles whose footprint lies in screen rect (x0, y0, w, h) into RGBA pixels, back to front: each tile's top,
 * then its walls down to lower neighbours in front. Pure.
 */
export function paintTerrain(t: TerrainInput, x0: number, y0: number, w: number, h: number, only?: (tx: number, ty: number) => boolean): Uint8ClampedArray<ArrayBuffer> {
  const px = new Uint8ClampedArray(w * h * 4);
  const put = (sx: number, sy: number, c: Rgb): void => {
    const x = sx - x0;
    const y = sy - y0;
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
    px[i + 3] = 255;
  };
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  for (let s = 0; s < t.width + t.height - 1; s++) {
    for (let ty = Math.max(0, s - t.width + 1); ty <= Math.min(t.height - 1, s); ty++) {
      const tx = s - ty;
      if (only && !only(tx, ty)) continue;
      const lv = level(t, tx, ty);
      const ox = (tx - ty) * hw;
      const oy = (tx + ty) * hh - lv * CLIFF_PX;
      if (ox + hw < x0 || ox - hw > x0 + w || oy > y0 + h || oy + TILE_H + lv * CLIFF_PX < y0) continue;
      const water = isWater(t, tx, ty);
      const behindHigher = (dx: number, dy: number): number => Math.max(0, level(t, tx + dx, ty + dy) - lv);
      const backX = behindHigher(-1, 0);
      const backY = behindHigher(0, -1);
      // Which sides border the other kind (land beside water, water beside land): the shoreline follows only those edges.
      const other = (dx: number, dy: number): boolean => isWater(t, tx + dx, ty + dy) !== water;
      const sides = { nx: other(-1, 0), px: other(1, 0), ny: other(0, -1), py: other(0, 1) };
      const shards = t.shards(tx, ty);
      // Tile top: invert the diamond to (fx, fy) for every pixel.
      for (let dy = 0; dy < TILE_H; dy++) {
        const span = dy < hh ? (dy + 0.5) * 2 : (TILE_H - dy - 0.5) * 2;
        for (let dx = -Math.ceil(span); dx <= Math.ceil(span); dx++) {
          const fx = ((dx + 0.5) / hw + (dy + 0.5) / hh) / 2;
          const fy = ((dy + 0.5) / hh - (dx + 0.5) / hw) / 2;
          if (fx < 0 || fy < 0 || fx > 1 || fy > 1) continue;
          // Contact shadow from higher ground behind (the sun is up and to the left).
          const shade = Math.max(backX > 0 ? 1 - smooth(0, 0.55, fx) : 0, backY > 0 ? 0.6 * (1 - smooth(0, 0.45, fy)) : 0);
          const toShore = Math.min(sides.nx ? fx : 9, sides.px ? 1 - fx : 9, sides.ny ? fy : 9, sides.py ? 1 - fy : 9);
          const shore = toShore > 1 ? 0 : water ? Math.max(0, 1 - toShore * 2.6) : Math.max(0, 1 - toShore * 3.2) * 0.8;
          let c = groundRgb(tx, ty, fx, fy, { level: lv, water, shade, shore, shards });
          // Plateau lips: a sunlit rim above the sunward (+y) wall, a darker lip above the shaded (+x) wall.
          if (lv > 0 && fy > 0.9 && level(t, tx, ty + 1) < lv) c = mix(c, [214, 182, 132], 0.35);
          else if (lv > 0 && fx > 0.92 && level(t, tx + 1, ty) < lv) c = scale(c, 0.8);
          put(ox + dx, oy + dy, c);
        }
      }
      if (lv === 0) continue;
      // Walls down to lower neighbours in front: +x is the lower-right edge (shaded), +y the lower-left edge (sunward).
      for (const [ndx, ndy, sunward] of [[1, 0, false], [0, 1, true]] as const) {
        const drop = (lv - level(t, tx + ndx, ty + ndy)) * CLIFF_PX;
        if (drop <= 0) continue;
        for (let k = 0; k <= hw; k++) {
          const ex = ndx === 1 ? ox + hw - k : ox - hw + k;
          const ey = oy + hh + k / 2;
          for (let d = 0; d < drop; d++) put(Math.round(ex), Math.round(ey + d), cliffRgb(tx + k / hw, ty + (ndx === 1 ? 0 : 1), d, sunward));
        }
      }
    }
  }
  return px;
}
