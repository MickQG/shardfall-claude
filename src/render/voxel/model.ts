/** A voxel material. Ids in a model are 1-based indices into its `materials` list (0 = empty). */
export interface Material {
  color: number;
  /** Adds a highlight on top faces. */
  metal?: boolean;
  /** Unshaded, always at full colour. */
  glow?: boolean;
  /** Takes the owner's team colour instead of `color`. */
  team?: boolean;
}

/** Axes: x and y span the ground (x runs right-down on screen, y left-down), z is up. Units are voxels. */
export interface VoxelModel {
  sx: number;
  sy: number;
  sz: number;
  materials: readonly Material[];
  cells: Uint8Array;
}

export function createModel(sx: number, sy: number, sz: number, materials: readonly Material[]): VoxelModel {
  return { sx, sy, sz, materials, cells: new Uint8Array(sx * sy * sz) };
}

const inside = (m: VoxelModel, x: number, y: number, z: number): boolean => x >= 0 && y >= 0 && z >= 0 && x < m.sx && y < m.sy && z < m.sz;

export function setVoxel(m: VoxelModel, x: number, y: number, z: number, mat: number): void {
  if (inside(m, x, y, z)) m.cells[(z * m.sy + y) * m.sx + x] = mat;
}

export function getVoxel(m: VoxelModel, x: number, y: number, z: number): number {
  return inside(m, x, y, z) ? (m.cells[(z * m.sy + y) * m.sx + x] as number) : 0;
}

/** Fills a w x d x h block with its corner at (x, y, z). */
export function box(m: VoxelModel, x: number, y: number, z: number, w: number, d: number, h: number, mat: number): void {
  for (let k = z; k < z + h; k++) for (let j = y; j < y + d; j++) for (let i = x; i < x + w; i++) setVoxel(m, i, j, k, mat);
}

/** A vertical cylinder of radius r centred on (cx, cy), from layer z for h layers. */
export function cylinder(m: VoxelModel, cx: number, cy: number, z: number, r: number, h: number, mat: number): void {
  for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) {
    for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
      if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 <= r * r) for (let k = z; k < z + h; k++) setVoxel(m, i, j, k, mat);
    }
  }
}

/** A ball of radius r centred on (cx, cy, cz). */
export function sphere(m: VoxelModel, cx: number, cy: number, cz: number, r: number, mat: number): void {
  for (let k = Math.floor(cz - r); k <= Math.ceil(cz + r); k++) {
    for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) {
      for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
        if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 + (k + 0.5 - cz) ** 2 <= r * r) setVoxel(m, i, j, k, mat);
      }
    }
  }
}

export function voxelCount(m: VoxelModel): number {
  let n = 0;
  for (const c of m.cells) if (c !== 0) n++;
  return n;
}

/** Highest occupied layer, or -1 for an empty model. */
export function topLayer(m: VoxelModel): number {
  for (let k = m.sz - 1; k >= 0; k--) {
    for (let j = 0; j < m.sy; j++) for (let i = 0; i < m.sx; i++) if (getVoxel(m, i, j, k) !== 0) return k;
  }
  return -1;
}
