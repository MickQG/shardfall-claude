import { getVoxel, type VoxelModel } from '../render/voxel/model';

/**
 * Voxel model to triangle mesh (R3D-3): greedy-merged faces, one colour per material (team materials take the team
 * colour), glowing materials split out so they can be drawn unlit. World axes: X = model x, Y = up (model z),
 * Z = model y; the model's ground centre is the origin and one tile is one world unit.
 */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

export interface VoxelMesh {
  lit: MeshData;
  glow: MeshData;
  /** Height of the top of the model in world units. */
  height: number;
  /** Faces emitted (after merging), for tests and budgets. */
  quads: number;
}

/** Edge length of one voxel in world units (tiles): 8 voxels per tile at scale 1. */
export const voxelSize = (m: VoxelModel): number => m.scale / 8;

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  quad(corners: readonly (readonly [number, number, number])[], n: readonly [number, number, number], rgb: readonly [number, number, number]): void {
    const base = this.pos.length / 3;
    for (const c of corners) {
      this.pos.push(c[0], c[1], c[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(rgb[0], rgb[1], rgb[2]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  done(): MeshData {
    return { positions: new Float32Array(this.pos), normals: new Float32Array(this.nor), colors: new Float32Array(this.col), indices: new Uint32Array(this.idx) };
  }
}

const rgbOf = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

/** Build a mesh from a voxel model in the given team colour. Pure. */
export function voxelMesh(m: VoxelModel, team: number): VoxelMesh {
  const s = voxelSize(m);
  const cx = m.sx / 2;
  const cy = m.sy / 2;
  const lit = new Builder();
  const glow = new Builder();
  let quads = 0;
  let top = 0;
  const dims = [m.sx, m.sy, m.sz];
  // Model coords (x, y, z) -> world (X, Y, Z) = ((x - cx) s, z s, (y - cy) s).
  const world = (p: readonly number[]): [number, number, number] => [((p[0] as number) - cx) * s, (p[2] as number) * s, ((p[1] as number) - cy) * s];
  const at = (p: readonly number[]): number => getVoxel(m, p[0] as number, p[1] as number, p[2] as number);

  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    for (const sign of [1, -1]) {
      const n = [0, 0, 0];
      n[axis] = sign;
      const nw = world([n[0] as number, n[1] as number, n[2] as number]);
      const nWorld: [number, number, number] = [nw[0] + cx * s, nw[1], nw[2] + cy * s].map((c) => Math.sign(c)) as [number, number, number];
      const du = dims[u] as number;
      const dv = dims[v] as number;
      for (let d = 0; d < (dims[axis] as number); d++) {
        // Mask of visible faces on this slice: material id, or 0.
        const mask = new Int32Array(du * dv);
        const p = [0, 0, 0];
        for (let j = 0; j < dv; j++) {
          for (let i = 0; i < du; i++) {
            p[axis] = d;
            p[u] = i;
            p[v] = j;
            const id = at(p);
            if (id === 0) continue;
            const q = [...p];
            q[axis] = d + sign;
            if (at(q) !== 0) continue;
            mask[j * du + i] = id;
          }
        }
        // Greedy merge equal ids into rectangles.
        for (let j = 0; j < dv; j++) {
          for (let i = 0; i < du; ) {
            const id = mask[j * du + i] as number;
            if (id === 0) {
              i++;
              continue;
            }
            let w = 1;
            while (i + w < du && mask[j * du + i + w] === id) w++;
            let h = 1;
            grow: while (j + h < dv) {
              for (let k = 0; k < w; k++) if (mask[(j + h) * du + i + k] !== id) break grow;
              h++;
            }
            for (let jj = 0; jj < h; jj++) for (let k = 0; k < w; k++) mask[(j + jj) * du + i + k] = 0;
            const mat = m.materials[id - 1];
            if (mat) {
              const plane = sign > 0 ? d + 1 : d;
              const corner = (a: number, b: number): [number, number, number] => {
                const c = [0, 0, 0];
                c[axis] = plane;
                c[u] = a;
                c[v] = b;
                return world(c);
              };
              const quad = sign > 0 ? [corner(i, j), corner(i + w, j), corner(i + w, j + h), corner(i, j + h)] : [corner(i, j), corner(i, j + h), corner(i + w, j + h), corner(i + w, j)];
              // Keep the winding counter-clockwise seen from outside, whatever the axis permutation.
              const e1 = [quad[1]![0] - quad[0]![0], quad[1]![1] - quad[0]![1], quad[1]![2] - quad[0]![2]];
              const e2 = [quad[2]![0] - quad[0]![0], quad[2]![1] - quad[0]![1], quad[2]![2] - quad[0]![2]];
              const cr = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
              if (cr[0]! * nWorld[0] + cr[1]! * nWorld[1] + cr[2]! * nWorld[2] < 0) quad.reverse();
              (mat.glow ? glow : lit).quad(quad, nWorld, rgbOf(mat.team ? team : mat.color));
              quads++;
              if (axis === 2 && sign > 0) top = Math.max(top, plane * s);
            }
            i += w;
          }
        }
      }
    }
  }
  return { lit: lit.done(), glow: glow.done(), height: top, quads };
}
