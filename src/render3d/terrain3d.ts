import { cliffRgb, groundRgb, valueNoise, type TerrainInput } from '../render/terrainNext';

/**
 * Terrain for the 3D view (R3D-2, R3D-11), built from the simulation's grid: one textured top per tile at its level's
 * height, faceted rock cliff walls (strata, the sunward side warmer) down to lower neighbours, and water surfaces on
 * blocked low tiles. Cliff edges and shorelines follow organic contours (R3D-14): every vertex near one is moved by a
 * smooth, position-only warp, so tile edges wave and corners round off. Colours and shapes come from tile coordinates
 * only. Pure.
 */

/** Triangle mesh data: positions, normals and colours per vertex, and indices. */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

/** World height of one level: plateaus are clearly raised without towering over units. */
export const LEVEL_H = 0.45;
/** Ground texture texels per tile edge. */
export const TEXELS = 16;
/** Cliff rock: rows per level of height, columns per tile edge, and the largest push in or out (tiles). */
const ROWS_PER_LEVEL = 4;
const COLS = 4;
export const ROCK_AMP = 0.075;

const hashf = (x: number, y: number, z: number): number => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * How far a cliff vertex at world position (x, y, z) is pushed (R3D-11). A function of position alone, so walls that
 * share a vertex agree and the rock stays watertight; zero at every level height, so walls meet the tile tops and each
 * other's rims exactly.
 */
export function rockOffset(x: number, y: number, z: number): [number, number, number] {
  const q = (v: number): number => Math.round(v * 64);
  const band = Math.sin(Math.PI * ((((y / LEVEL_H) % 1) + 1) % 1));
  const k = ROCK_AMP * band;
  return [(hashf(q(x), q(y), q(z)) - 0.5) * 2 * k, (hashf(q(x) + 17, q(y), q(z) + 5) - 0.5) * k * 0.6, (hashf(q(x), q(y) + 31, q(z) + 11) - 0.5) * 2 * k];
}

/** The furthest a drawn edge strays from its tile edge (R3D-14), tiles. Gameplay stays on the tile grid. */
export const EDGE_AMP = 0.3;
/** Tile tops near a contour are split into this many cells per edge (as many as a cliff wall has columns). */
const SUB = COLS;

/** A position-only warp of the ground plane: (x, z) -> how far to move that point, in tiles. */
export type Warp = (x: number, z: number) => [number, number];

/**
 * The organic-contour warp for a map (R3D-14). Contours are the tile edges between different levels or between water
 * and land. Points within a tile of a contour wave with smooth noise; corners where one tile differs from the other
 * three round off toward it. Zero a tile or more from any contour and across the map border, never more than EDGE_AMP,
 * and gentle enough that the ground never folds over. Pure.
 */
export function contourWarp(t: TerrainInput, cached = true): Warp {
  const W = t.width;
  const H = t.height;
  // Points inside a tile that touches no contour never move: a quick test before any search.
  const near = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) near[y * W + x] = nearContour(t, x, y) ? 1 : 0;
  const ZERO: [number, number] = [0, 0];
  // Out-of-map tiles copy the nearest edge tile, so the map border is never a contour.
  const key = (x: number, y: number): number => {
    const cx = Math.max(0, Math.min(W - 1, x));
    const cy = Math.max(0, Math.min(H - 1, y));
    return level(t, cx, cy) * 2 + (water(t, cx, cy) ? 1 : 0);
  };
  const cache = new Map<number, [number, number]>();
  return (x, z) => {
    const gx = Math.floor(x);
    const gz = Math.floor(z);
    // On a tile edge or corner the point belongs to every tile sharing it: it moves if any of them is near a contour.
    let touched = false;
    for (const ox of x === gx ? [gx - 1, gx] : [gx]) {
      for (const oz of z === gz ? [gz - 1, gz] : [gz]) {
        const cx = Math.max(0, Math.min(W - 1, ox));
        const cz = Math.max(0, Math.min(H - 1, oz));
        if (near[cz * W + cx]) touched = true;
      }
    }
    if (!touched) return ZERO;
    const id = Math.round(x * 64) * 131072 + Math.round(z * 64);
    const hit = cached ? cache.get(id) : undefined;
    if (hit) return hit;
    // Distance to the nearest contour segment within reach.
    let d = 9;
    for (let j = gz - REACH; j <= gz + REACH + 1; j++) {
      for (let i = gx - REACH; i <= gx + REACH + 1; i++) {
        // Vertical edge at x = i, z in [j, j + 1]; horizontal edge at z = j, x in [i, i + 1].
        if (key(i - 1, j) !== key(i, j)) d = Math.min(d, Math.hypot(x - i, z - Math.max(j, Math.min(j + 1, z))));
        if (key(i, j - 1) !== key(i, j)) d = Math.min(d, Math.hypot(x - Math.max(i, Math.min(i + 1, x)), z - j));
      }
    }
    let dx = 0;
    let dz = 0;
    if (d < REACH) {
      const e = d / REACH;
      const m = 1 - e * e * (3 - 2 * e);
      dx += m * ((valueNoise(x * WAVE_F + 13, z * WAVE_F) - 0.5) * WAVE_A + (valueNoise(x * 1.1 + 71, z * 1.1 + 5) - 0.5) * 0.1);
      dz += m * ((valueNoise(x * WAVE_F, z * WAVE_F + 29) - 0.5) * WAVE_A + (valueNoise(x * 1.1 + 3, z * 1.1 + 91) - 0.5) * 0.1);
      // Round off corners: pull toward the one tile of four that differs.
      for (let j = Math.round(z) - REACH; j <= Math.round(z) + REACH; j++) {
        for (let i = Math.round(x) - REACH; i <= Math.round(x) + REACH; i++) {
          const r = Math.hypot(x - i, z - j);
          if (r >= CORNER_R) continue;
          const k = [key(i - 1, j - 1), key(i, j - 1), key(i - 1, j), key(i, j)];
          for (let q = 0; q < 4; q++) {
            const others = k.filter((_, n) => n !== q);
            if (others[0] === k[q] || others.some((v) => v !== others[0])) continue;
            const f = (1 - (r / CORNER_R) ** 2) ** 2 * CORNER_PULL * Math.SQRT1_2;
            dx += (q % 2 ? 1 : -1) * f;
            dz += (q >= 2 ? 1 : -1) * f;
          }
        }
      }
    }
    // Points on the map border only slide along it.
    dx *= Math.max(0, Math.min(1, x, W - x));
    dz *= Math.max(0, Math.min(1, z, H - z));
    const len = Math.hypot(dx, dz);
    const out: [number, number] = len > EDGE_AMP ? [(dx / len) * EDGE_AMP, (dz / len) * EDGE_AMP] : [dx, dz];
    if (cached) cache.set(id, out);
    return out;
  };
}

/** How far from a contour the warp reaches, tiles: tiles this close are split, the rest stay whole. */
const REACH = 2;
/** Edge waves: frequency (per tile) and full range, tiles. */
const WAVE_F = 0.4;
const WAVE_A = 0.46;
/** Corner rounding: reach and the corner point's pull, tiles. Large and gentle, so corners round over a wide arc. */
const CORNER_R = 1.8;
const CORNER_PULL = 0.4;

/** Whether a tile is within REACH of a contour (its tops are subdivided and warped). */
function nearContour(t: TerrainInput, tx: number, ty: number): boolean {
  const k = (x: number, y: number): number => {
    const cx = Math.max(0, Math.min(t.width - 1, x));
    const cy = Math.max(0, Math.min(t.height - 1, y));
    return level(t, cx, cy) * 2 + (water(t, cx, cy) ? 1 : 0);
  };
  const me = k(tx, ty);
  // A contour edge less than REACH away separates two tiles of the (2 REACH + 1) square around this one.
  for (let dy = -REACH; dy <= REACH; dy++) for (let dx = -REACH; dx <= REACH; dx++) if (k(tx + dx, ty + dy) !== me) return true;
  return false;
}

const level = (t: TerrainInput, x: number, y: number): number => (x < 0 || y < 0 || x >= t.width || y >= t.height ? 0 : (t.heights[y * t.width + x] ?? 0));
const water = (t: TerrainInput, x: number, y: number): boolean => x >= 0 && y >= 0 && x < t.width && y < t.height && level(t, x, y) === 0 && t.blocked(x, y);

/**
 * How much shard ground covers the point (x, y), 0..1 (R3D-14): the shard tiles' centres blended across tiles and
 * broken up by noise, so a field reads as an uneven patch. Full at every shard tile's centre, none at other centres.
 */
export function shardCover(t: TerrainInput, x: number, y: number): number {
  const u = x - 0.5;
  const v = y - 0.5;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const s = (a: number, b: number): number => (a >= 0 && b >= 0 && a < t.width && b < t.height && t.shards(a, b) && level(t, a, b) === 0 ? 1 : 0);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = s(x0, y0) + (s(x0 + 1, y0) - s(x0, y0)) * sx;
  const bottom = s(x0, y0 + 1) + (s(x0 + 1, y0 + 1) - s(x0, y0 + 1)) * sx;
  const blend = top + (bottom - top) * sy;
  // Noise only where the blend is partial, strongest half-way: the patch edge wanders, its heart and the bare ground
  // around it stay as they are.
  const n = (valueNoise(x * 1.6 + 211, y * 1.6 + 7) - 0.5) * 0.75 + (valueNoise(x * 4.1 + 5, y * 4.1 + 61) - 0.5) * 0.25;
  const b = blend + n * 6.4 * blend * (1 - blend);
  const k = Math.max(0, Math.min(1, (b - 0.38) / 0.24));
  return k * k * (3 - 2 * k);
}

const SAND = [176, 156, 114] as const;
const WET_SAND = [112, 98, 76] as const;
const mixRgb = (a: readonly number[], b: readonly number[], k: number): [number, number, number] => [a[0]! + (b[0]! - a[0]!) * k, a[1]! + (b[1]! - a[1]!) * k, a[2]! + (b[2]! - a[2]!) * k];
const smooth = (a: number, b: number, x: number): number => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** Whether any tile within `r` (a square) of (tx, ty) is water. */
function nearWater(t: TerrainInput, tx: number, ty: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (water(t, tx + dx, ty + dy)) return true;
  return false;
}

/**
 * How wet the ground is at (x, y), 0..1 (R3D-14): the water tiles around, weighted by distance over a tile and a half,
 * so a shore is a smooth line that rounds the corners of a lake at the scale of a tile, then made to wander by noise
 * where it is partial. A straight shore sits at one half; deep water is 1, dry land 0. Pure.
 */
export function wetness(t: TerrainInput, x: number, y: number): number {
  const R = 1.5;
  let sum = 0;
  let wet = 0;
  for (let ty = Math.floor(y - R - 0.5); ty <= Math.ceil(y + R); ty++) {
    for (let tx = Math.floor(x - R - 0.5); tx <= Math.ceil(x + R); tx++) {
      const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
      if (d >= R) continue;
      const w = (1 - d / R) ** 2;
      sum += w;
      if (water(t, tx, ty)) wet += w;
    }
  }
  const v = sum > 0 ? wet / sum : 0;
  const n = (valueNoise(x * 0.9 + 7, y * 0.9 + 3) - 0.5) * 0.5 + (valueNoise(x * 2.3, y * 2.3 + 11) - 0.5) * 0.2;
  return Math.max(0, Math.min(1, v + n * 4 * v * (1 - v)));
}

/**
 * How opaque the water surface is at (x, y), 0..1 (R3D-14): it fades in across the shore line of the wetness field,
 * is full once well inside the water tiles, and never reaches more than a sliver into land, so no walkable ground is
 * drawn under water. Continuous across tile edges. Pure.
 */
export function waterAlpha(t: TerrainInput, x: number, y: number, wet = wetness(t, x, y)): number {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const inWater = water(t, tx, ty);
  // Distance to the nearest tile of the other kind.
  let other = 9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (water(t, tx + dx, ty + dy) === inWater) continue;
      const cx = Math.max(tx + dx, Math.min(tx + dx + 1, x));
      const cy = Math.max(ty + dy, Math.min(ty + dy + 1, y));
      other = Math.min(other, Math.hypot(x - cx, y - cy));
    }
  }
  const edge = smooth(0.42, 0.9, wet);
  if (!inWater) return other >= LAND_SLIVER ? 0 : edge * (1 - other / LAND_SLIVER);
  return Math.max(edge, smooth(0.15, 0.5, other));
}

/** Water may lap this far onto land tiles, tiles. */
const LAND_SLIVER = 0.12;

/** A shore texel: `dry` ground turning to beach sand, wet sand, then the lake bed under the water (R3D-14). */
function shoreRgb(t: TerrainInput, tx: number, ty: number, fx: number, fy: number, dry: readonly number[]): [number, number, number] {
  const x = tx + fx;
  const y = ty + fy;
  const wet = wetness(t, x, y);
  const grain = 0.9 + valueNoise(x * 11, y * 11) * 0.2;
  let c = mixRgb(dry, SAND.map((v) => v * grain), smooth(0.14, 0.3, wet) * 0.9);
  c = mixRgb(c, WET_SAND.map((v) => v * grain), smooth(0.34, 0.52, wet));
  const a = waterAlpha(t, x, y, wet);
  if (a > 0) c = mixRgb(c, groundRgb(tx, ty, fx, fy, { level: 0, water: true, shade: 0, shore: 1 - smooth(0.55, 0.95, wet), shards: false }), a);
  return c;
}

/** RGBA ground texture, TEXELS per tile, row 0 at tile row 0. */
export function groundTexture(t: TerrainInput): { width: number; height: number; data: Uint8Array } {
  const w = t.width * TEXELS;
  const h = t.height * TEXELS;
  const data = new Uint8Array(w * h * 4);
  for (let ty = 0; ty < t.height; ty++) {
    for (let tx = 0; tx < t.width; tx++) {
      const lv = level(t, tx, ty);
      const back = Math.max(0, level(t, tx - 1, ty) - lv);
      // Ground near water is painted from the wetness field: grass, beach sand, wet sand, then the lake bed (R3D-14).
      const shoreTile = lv === 0 && nearWater(t, tx, ty, 2);
      // Shard ground is a soft, uneven patch over the shard tiles rather than a tinted square (R3D-14).
      const nearShards = lv === 0 && [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => shardCover(t, tx + 0.5 + dx, ty + 0.5 + dy) > 0));
      for (let j = 0; j < TEXELS; j++) {
        for (let i = 0; i < TEXELS; i++) {
          const fx = (i + 0.5) / TEXELS;
          const fy = (j + 0.5) / TEXELS;
          const shade = back > 0 ? Math.max(0, 1 - fx / 0.55) * 0.7 : 0;
          const ctx = { level: lv, water: false, shade, shore: 0, shards: false };
          let c = groundRgb(tx, ty, fx, fy, ctx);
          if (shoreTile) c = shoreRgb(t, tx, ty, fx, fy, c);
          if (nearShards) {
            const k = shardCover(t, tx + fx, ty + fy);
            if (k > 0) {
              const s = groundRgb(tx, ty, fx, fy, { ...ctx, shards: true });
              c = [c[0] + (s[0] - c[0]) * k, c[1] + (s[1] - c[1]) * k, c[2] + (s[2] - c[2]) * k];
            }
          }
          const k = ((ty * TEXELS + j) * w + tx * TEXELS + i) * 4;
          data[k] = Math.round(c[0]);
          data[k + 1] = Math.round(c[1]);
          data[k + 2] = Math.round(c[2]);
          data[k + 3] = 255;
        }
      }
    }
  }
  return { width: w, height: h, data };
}

class Mesh {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  quad(p: number[][], n: number[], c: number[], uv: number[][] = [[0, 0], [0, 0], [0, 0], [0, 0]]): void {
    const b = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(...(p[i] as number[]));
      this.nor.push(...n);
      this.col.push(...c);
      this.uv.push(...(uv[i] as number[]));
    }
    this.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  /** A flat-shaded triangle (its normal from its winding), darkened in the crevices facing down. */
  tri(p0: number[], p1: number[], p2: number[], c: number[]): void {
    const b = this.pos.length / 3;
    const e1 = [p1[0]! - p0[0]!, p1[1]! - p0[1]!, p1[2]! - p0[2]!];
    const e2 = [p2[0]! - p0[0]!, p2[1]! - p0[1]!, p2[2]! - p0[2]!];
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    const nn = n.map((v) => v / l);
    const shade = 0.82 + 0.18 * Math.max(-1, Math.min(1, nn[1]! * 3 + 0.4));
    for (const p of [p0, p1, p2]) {
      this.pos.push(p[0]!, p[1]!, p[2]!);
      this.nor.push(nn[0]!, nn[1]!, nn[2]!);
      this.col.push(c[0]! * shade, c[1]! * shade, c[2]! * shade);
      this.uv.push(0, 0);
    }
    this.idx.push(b, b + 1, b + 2);
  }
  /** A quad with its own RGBA colour per corner. */
  quadColors(p: number[][], n: number[], c: number[][], uv: number[][]): void {
    const b = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(...(p[i] as number[]));
      this.nor.push(...n);
      this.col.push(...(c[i] as number[]));
      this.uv.push(...(uv[i] as number[]));
    }
    this.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  done(): MeshData & { uvs: Float32Array } {
    return { positions: new Float32Array(this.pos), normals: new Float32Array(this.nor), colors: new Float32Array(this.col), indices: new Uint32Array(this.idx), uvs: new Float32Array(this.uv) };
  }
}

export interface TerrainMeshes {
  /** Tile tops, UV-mapped onto the ground texture. */
  ground: MeshData & { uvs: Float32Array };
  /** Cliff walls, vertex-coloured rock strata. */
  cliffs: MeshData & { uvs: Float32Array };
  /** Water surfaces on blocked low tiles, fading out over the shore: colours are RGBA (alpha per vertex). */
  water: MeshData & { uvs: Float32Array };
}

/** Build the terrain meshes for a map. Pure. */
export function terrainMeshes(t: TerrainInput): TerrainMeshes {
  const ground = new Mesh();
  const cliffs = new Mesh();
  const sea = new Mesh();
  const W = t.width;
  const H = t.height;
  const uv = (x: number, y: number): number[] => [x / W, 1 - y / H];
  const warp = contourWarp(t);
  // A warped point on the ground plane at height y; texture coordinates stay with the unwarped point, so the painted
  // shore, shade and shard ground move with the edge.
  const at = (x: number, y: number, z: number): number[] => {
    const d = warp(x, z);
    return [x + d[0], y, z + d[1]];
  };
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const lv = level(t, tx, ty);
      const y = lv * LEVEL_H;
      // Tiles near a contour are split so their edges can wave; the rest stay one quad (the warp is zero there).
      const n = nearContour(t, tx, ty) ? SUB : 1;
      // Water is drawn over water tiles and the land right next to them, where its edge fades.
      const shore = lv === 0 && nearWater(t, tx, ty, 1);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const corners = [[tx + i / n, ty + j / n], [tx + (i + 1) / n, ty + j / n], [tx + (i + 1) / n, ty + (j + 1) / n], [tx + i / n, ty + (j + 1) / n]] as const;
          ground.quad(corners.map(([x, z]) => at(x, y, z)), [0, 1, 0], [1, 1, 1], corners.map(([x, z]) => uv(x, z)));
          // The water surface floats just above the painted lake bed, so the bed shows through it. It fades out across
          // the shore with lighter, foamy edges (vertex colour and alpha), so a lake has no hard rim (R3D-14).
          if (shore) {
            const alpha = corners.map(([x, z]) => waterAlpha(t, x, z));
            if (alpha.some((a) => a > 0.005)) {
              sea.quadColors(
                corners.map(([x, z]) => at(x, 0.015, z)),
                [0, 1, 0],
                alpha.map((a) => {
                  const foam = 1 + 1.1 * 4 * a * (1 - a);
                  return [foam, foam, foam, a];
                }),
                corners.map(([x, z]) => uv(x, z)),
              );
            }
          }
        }
      }
      // Walls towards every lower neighbour (all four sides, since the 3D camera can see more than two faces later).
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nl = level(t, tx + dx, ty + dy);
        if (nl >= lv) continue;
        // The 3D sun shines from -X and +Z (as in the classic bake), so walls facing those ways are the lit, warmer ones.
        const sunward = dx === -1 || dy === 1;
        // Edge endpoints on the shared side, ordered so the faces wind outward, towards the lower neighbour.
        const [a, b] = dx === 1 ? [[tx + 1, ty], [tx + 1, ty + 1]] : dx === -1 ? [[tx, ty + 1], [tx, ty]] : dy === 1 ? [[tx + 1, ty + 1], [tx, ty + 1]] : [[tx, ty], [tx + 1, ty]];
        // A grid on fixed world heights (so neighbouring walls share rows), every vertex pushed by its position.
        const rows = (lv - nl) * ROWS_PER_LEVEL;
        const vert = (i: number, j: number): number[] => {
          const f = i / COLS;
          const x = a![0]! + (b![0]! - a![0]!) * f;
          const z = a![1]! + (b![1]! - a![1]!) * f;
          const yy = y - (j / ROWS_PER_LEVEL) * LEVEL_H;
          const o = rockOffset(x, yy, z);
          const d = warp(x, z);
          return [x + d[0] + o[0], yy + o[1], z + d[1] + o[2]];
        };
        for (let j = 0; j < rows; j++) {
          const c = cliffRgb(tx + 0.5, ty + 0.5, Math.round((lv * ROWS_PER_LEVEL - j) * 1.5), sunward).map((v) => v / 255);
          for (let i = 0; i < COLS; i++) {
            const p00 = vert(i, j);
            const p10 = vert(i + 1, j);
            const p01 = vert(i, j + 1);
            const p11 = vert(i + 1, j + 1);
            // The quad p00 -> p10 -> p11 -> p01 winds outward; alternate its diagonal for a less regular facet pattern.
            if ((i + j) % 2) {
              cliffs.tri(p00, p10, p11, c);
              cliffs.tri(p00, p11, p01, c);
            } else {
              cliffs.tri(p00, p10, p01, c);
              cliffs.tri(p10, p11, p01, c);
            }
          }
        }
      }
    }
  }
  return { ground: ground.done(), cliffs: cliffs.done(), water: sea.done() };
}

export interface ScatterItem {
  kind: 'grass' | 'stone' | 'flora' | 'reed' | 'boulder';
  variant: number;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  /** The tile it grows on (its drawn position follows the contour warp). */
  tx: number;
  ty: number;
}

/**
 * Ground scatter (R3D-11, R3D-14): grass tufts on grassy low ground, stones on any dry tile, the odd alien plant,
 * boulders at the foot of cliffs, reeds in the shallows and at the waterline, pebbles on beaches. Shard fields and
 * tiles that are not `free` (near buildings) stay clear; only reeds grow on water tiles. Positions come from tile coordinates only and follow
 * the contour warp, so items stay on their tile's drawn ground. Pure.
 */
export function scatter(t: TerrainInput, free: (x: number, y: number) => boolean): ScatterItem[] {
  const out: ScatterItem[] = [];
  const warp = contourWarp(t);
  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  const put = (it: Omit<ScatterItem, 'tx' | 'ty'>, tx: number, ty: number): void => {
    const d = warp(it.x, it.z);
    out.push({ ...it, x: it.x + d[0], z: it.z + d[1], tx, ty });
  };
  for (let ty = 0; ty < t.height; ty++) {
    for (let tx = 0; tx < t.width; tx++) {
      const lv = level(t, tx, ty);
      const y = lv * LEVEL_H;
      const r = (k: number): number => hashf(tx * 7 + k, ty * 13 + k * 3, 99);
      const wetTile = water(t, tx, ty);
      // By the water: reeds in the shallows and at the waterline, pebbles on the beach (R3D-14).
      if (lv === 0 && !t.shards(tx, ty) && (wetTile || free(tx, ty)) && nearWater(t, tx, ty, 1)) {
        for (let k = 0; k < 5; k++) {
          const px = tx + 0.08 + r(60 + k) * 0.84;
          const pz = ty + 0.08 + r(70 + k) * 0.84;
          const wv = wetness(t, px, pz);
          const a = waterAlpha(t, px, pz, wv);
          if (a < 0.75 && wv > 0.36 && wv < 0.7 && r(80 + k) < 0.6) put({ kind: 'reed', variant: Math.floor(r(90 + k) * 3), x: px, y, z: pz, rot: r(95 + k) * 6.28, scale: 0.8 + r(97 + k) * 0.6 }, tx, ty);
          else if (!wetTile && wv > 0.16 && wv < 0.42 && r(100 + k) < 0.1) put({ kind: 'stone', variant: Math.floor(r(105 + k) * 3), x: px, y, z: pz, rot: r(107 + k) * 6.28, scale: 0.22 + r(109 + k) * 0.18 }, tx, ty);
        }
      }
      if (wetTile) continue;
      if (t.shards(tx, ty) || !free(tx, ty)) continue;
      // Boulders at the foot of a cliff break up its base line.
      sides.forEach(([dx, dy], k) => {
        if (level(t, tx + dx, ty + dy) <= lv || r(110 + k) > 0.15) return;
        const along = 0.15 + r(115 + k) * 0.7;
        const bx = dx === 0 ? tx + along : dx > 0 ? tx + 0.88 : tx + 0.12;
        const bz = dy === 0 ? ty + along : dy > 0 ? ty + 0.88 : ty + 0.12;
        put({ kind: 'boulder', variant: Math.floor(r(120 + k) * 3), x: bx, y, z: bz, rot: r(125 + k) * 6.28, scale: 0.8 + r(130 + k) * 0.7 }, tx, ty);
      });
      if (lv === 0) {
        const c = groundRgb(tx, ty, 0.5, 0.5, { level: 0, water: false, shade: 0, shore: 0, shards: false });
        const grassy = c[1] > c[0] * 1.08;
        const tufts = grassy ? Math.floor(r(1) * 4) : r(1) < 0.2 ? 1 : 0;
        for (let i = 0; i < tufts; i++) put({ kind: 'grass', variant: Math.floor(r(10 + i) * 3), x: tx + 0.1 + r(20 + i) * 0.8, y, z: ty + 0.1 + r(30 + i) * 0.8, rot: r(40 + i) * Math.PI * 2, scale: 0.8 + r(50 + i) * 0.7 }, tx, ty);
        if (r(2) < 0.025) put({ kind: 'flora', variant: Math.floor(r(3) * 3), x: tx + 0.5, y, z: ty + 0.5, rot: r(4) * 6.28, scale: 0.55 + r(5) * 0.3 }, tx, ty);
      }
      if (r(6) < (lv > 0 ? 0.05 : 0.02)) put({ kind: 'stone', variant: Math.floor(r(7) * 3), x: tx + 0.2 + r(8) * 0.6, y, z: ty + 0.2 + r(9) * 0.6, rot: r(11) * 6.28, scale: 0.35 + r(12) * 0.35 }, tx, ty);
    }
  }
  return out;
}
