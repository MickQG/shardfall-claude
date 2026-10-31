import { cliffRgb, groundRgb, type TerrainInput } from '../render/terrainNext';
import type { MeshData } from './voxelMesh';

/**
 * Terrain for the 3D view (R3D-2), built from the simulation's grid: one textured top per tile at its level's height,
 * vertical cliff walls (striped rock, the sunward side warmer) down to lower neighbours, and water surfaces on blocked
 * low tiles. Colours come from tile coordinates only. Pure.
 */

/** World height of one level: plateaus are clearly raised without towering over units. */
export const LEVEL_H = 0.45;
/** Ground texture texels per tile edge. */
export const TEXELS = 16;

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
        // Edge endpoints on the shared side.
        const [a, b] = dx === 1 ? [[tx + 1, ty], [tx + 1, ty + 1]] : dx === -1 ? [[tx, ty + 1], [tx, ty]] : dy === 1 ? [[tx + 1, ty + 1], [tx, ty + 1]] : [[tx, ty], [tx + 1, ty]];
        const bands = Math.max(1, Math.round(((lv - nl) * LEVEL_H) / 0.075));
        for (let k = 0; k < bands; k++) {
          const top = y - (k * (lv - nl) * LEVEL_H) / bands;
          const bot = y - ((k + 1) * (lv - nl) * LEVEL_H) / bands;
          const c = cliffRgb(tx + 0.5, ty + 0.5, k * 2, sunward).map((v) => v / 255);
          // Wound so the front face points out of the plateau, towards the lower neighbour.
          cliffs.quad([[a![0]!, top, a![1]!], [a![0]!, bot, a![1]!], [b![0]!, bot, b![1]!], [b![0]!, top, b![1]!]], [dx, 0, dy], c);
        }
      }
    }
  }
  return { ground: ground.done(), cliffs: cliffs.done(), water: sea.done() };
}
