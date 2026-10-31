import { cliffRgb, groundRgb, type TerrainInput } from '../render/terrainNext';

/**
 * Terrain for the 3D view (R3D-2, R3D-11), built from the simulation's grid: one textured top per tile at its level's
 * height, faceted rock cliff walls (strata, the sunward side warmer) down to lower neighbours, and water surfaces on
 * blocked low tiles. Colours and rock shapes come from tile coordinates only. Pure.
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

const level = (t: TerrainInput, x: number, y: number): number => (x < 0 || y < 0 || x >= t.width || y >= t.height ? 0 : (t.heights[y * t.width + x] ?? 0));
const water = (t: TerrainInput, x: number, y: number): boolean => x >= 0 && y >= 0 && x < t.width && y < t.height && level(t, x, y) === 0 && t.blocked(x, y);

/** RGBA ground texture, TEXELS per tile, row 0 at tile row 0. */
export function groundTexture(t: TerrainInput): { width: number; height: number; data: Uint8Array } {
  const w = t.width * TEXELS;
  const h = t.height * TEXELS;
  const data = new Uint8Array(w * h * 4);
  for (let ty = 0; ty < t.height; ty++) {
    for (let tx = 0; tx < t.width; tx++) {
      const lv = level(t, tx, ty);
      const wet = water(t, tx, ty);
      const back = Math.max(0, level(t, tx - 1, ty) - lv);
      const other = (dx: number, dy: number): boolean => water(t, tx + dx, ty + dy) !== wet;
      const sides = { nx: other(-1, 0), px: other(1, 0), ny: other(0, -1), py: other(0, 1) };
      const shards = t.shards(tx, ty);
      for (let j = 0; j < TEXELS; j++) {
        for (let i = 0; i < TEXELS; i++) {
          const fx = (i + 0.5) / TEXELS;
          const fy = (j + 0.5) / TEXELS;
          const toShore = Math.min(sides.nx ? fx : 9, sides.px ? 1 - fx : 9, sides.ny ? fy : 9, sides.py ? 1 - fy : 9);
          const shore = toShore > 1 ? 0 : wet ? Math.max(0, 1 - toShore * 2.6) : Math.max(0, 1 - toShore * 3.2) * 0.8;
          const shade = back > 0 ? Math.max(0, 1 - fx / 0.55) * 0.7 : 0;
          const c = groundRgb(tx, ty, fx, fy, { level: lv, water: wet, shade, shore, shards });
          const k = ((ty * TEXELS + j) * w + tx * TEXELS + i) * 4;
          data[k] = c[0];
          data[k + 1] = c[1];
          data[k + 2] = c[2];
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
  done(): MeshData & { uvs: Float32Array } {
    return { positions: new Float32Array(this.pos), normals: new Float32Array(this.nor), colors: new Float32Array(this.col), indices: new Uint32Array(this.idx), uvs: new Float32Array(this.uv) };
  }
}

export interface TerrainMeshes {
  /** Tile tops, UV-mapped onto the ground texture. */
  ground: MeshData & { uvs: Float32Array };
  /** Cliff walls, vertex-coloured rock strata. */
  cliffs: MeshData & { uvs: Float32Array };
  /** Water surfaces on blocked low tiles. */
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
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const lv = level(t, tx, ty);
      const y = lv * LEVEL_H;
      const corners = [[tx, ty], [tx + 1, ty], [tx + 1, ty + 1], [tx, ty + 1]] as const;
      ground.quad(corners.map(([x, z]) => [x, y, z]), [0, 1, 0], [1, 1, 1], corners.map(([x, z]) => uv(x, z)));
      // The water surface floats just above the painted lake bed, so the bed shows through it.
      if (water(t, tx, ty)) sea.quad(corners.map(([x, z]) => [x, 0.015, z]), [0, 1, 0], [1, 1, 1], corners.map(([x, z]) => uv(x, z)));
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
          return [x + o[0], yy + o[1], z + o[2]];
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
  kind: 'grass' | 'stone' | 'flora';
  variant: number;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
}

/**
 * Ground scatter (R3D-11): grass tufts on grassy low ground, stones on any dry tile, the odd alien plant. Tiles that are
 * water, shard fields or not `free` (near buildings) stay clear. Positions come from tile coordinates only. Pure.
 */
export function scatter(t: TerrainInput, free: (x: number, y: number) => boolean): ScatterItem[] {
  const out: ScatterItem[] = [];
  for (let ty = 0; ty < t.height; ty++) {
    for (let tx = 0; tx < t.width; tx++) {
      const lv = level(t, tx, ty);
      if (t.blocked(tx, ty) && lv === 0) continue;
      if (t.shards(tx, ty) || !free(tx, ty)) continue;
      const y = lv * LEVEL_H;
      const r = (k: number): number => hashf(tx * 7 + k, ty * 13 + k * 3, 99);
      if (lv === 0) {
        const c = groundRgb(tx, ty, 0.5, 0.5, { level: 0, water: false, shade: 0, shore: 0, shards: false });
        const grassy = c[1] > c[0] * 1.08;
        const tufts = grassy ? Math.floor(r(1) * 4) : r(1) < 0.2 ? 1 : 0;
        for (let i = 0; i < tufts; i++) out.push({ kind: 'grass', variant: Math.floor(r(10 + i) * 3), x: tx + 0.1 + r(20 + i) * 0.8, y, z: ty + 0.1 + r(30 + i) * 0.8, rot: r(40 + i) * Math.PI * 2, scale: 0.8 + r(50 + i) * 0.7 });
        if (r(2) < 0.025) out.push({ kind: 'flora', variant: Math.floor(r(3) * 3), x: tx + 0.5, y, z: ty + 0.5, rot: r(4) * 6.28, scale: 0.55 + r(5) * 0.3 });
      }
      if (r(6) < (lv > 0 ? 0.3 : 0.07)) out.push({ kind: 'stone', variant: Math.floor(r(7) * 3), x: tx + 0.2 + r(8) * 0.6, y, z: ty + 0.2 + r(9) * 0.6, rot: r(11) * 6.28, scale: 0.35 + r(12) * 0.35 });
    }
  }
  return out;
}
