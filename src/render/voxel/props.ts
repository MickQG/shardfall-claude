import { box, createModel, cylinder, sphere, type Material, type VoxelModel } from './model';

const mat = (color: number, o: Partial<Material> = {}): Material => ({ color, ...o });

const hash = (x: number, y: number, z = 0): number => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967295;
};

/** Props are authored at half-size voxels, one tile (16x16 voxels) of ground. */
const prop = (sz: number, mats: readonly Material[]): VoxelModel => createModel(16, 16, sz, mats, 0.5);

// ---------------------------------------------------------------- Shard crystals

/** Crystal cluster size from the shards left on a tile: 0 (none) to 4. */
export function crystalLevel(amount: number): number {
  return amount <= 0 ? 0 : amount <= 200 ? 1 : amount <= 800 ? 2 : amount <= 2000 ? 3 : 4;
}

/** Height in px of the tallest crystal's tip for a level (for sparkles). */
export const crystalTipPx = (level: number): number => ([8, 10, 12, 14][Math.min(Math.max(level, 1), 4) - 1] as number) * 2;

const CLUSTERS: readonly (readonly (readonly [number, number, number])[])[] = [
  [[8, 8, 8]],
  [[6, 8, 10], [10, 9, 7]],
  [[8, 6, 12], [5, 10, 8], [11, 10, 8]],
  [[8, 8, 14], [4, 6, 9], [12, 7, 9], [8, 12, 8]],
];

export function crystalModel(level: number): VoxelModel {
  const m = prop(26, [mat(0x2fd29a), mat(0xbffbe6, { glow: true }), mat(0x35e0a1, { glow: true })]);
  for (const [x, y, h] of CLUSTERS[Math.min(Math.max(level, 1), 4) - 1] as readonly (readonly [number, number, number])[]) {
    for (let z = 0; z < h; z++) {
      const r = 1.9 * (1 - Math.pow(z / h, 1.5) * 0.85) + 0.4;
      cylinder(m, x, y, z, r, 1, z >= h - 2 ? 2 : 1);
    }
    cylinder(m, x, y, 0, 2.6, 1, 3); // a glowing seam where the crystal meets the ground
  }
  return m;
}

// ---------------------------------------------------------------- Rocks

export const rockVariant = (x: number, y: number): number => Math.floor(hash(x, y, 7) * 4);

/** A one-tile rock chunk: stratified (dark base, lighter top) with a ragged top and the odd glowing vein. */
export function rockModel(variant: number, level: number): VoxelModel {
  const top = level * 8 + 4;
  const m = prop(top + 6, [mat(0x3a4650), mat(0x5a6b73), mat(0x7f919d), mat(0x7fd8ff, { glow: true })]);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const edge = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) / 8;
      const n = hash(x + variant * 37, y + variant * 91);
      const h = Math.max(2, Math.floor(top * (0.74 + 0.26 * n) - (edge > 0.9 ? 2 * n : 0)));
      for (let z = 0; z < h; z++) {
        const band = z / top;
        let id = band < 0.34 ? 1 : band < 0.74 ? 2 : 3;
        if (z > 3 && hash(x, y, z + variant) > 0.99) id = 4;
        box(m, x, y, z, 1, 1, 1, id);
      }
    }
  }
  return m;
}

// ---------------------------------------------------------------- Ground props

export type PropKind = 'pebbles' | 'sprout' | 'spire';

/** Which prop (if any) sits on a tile: a few percent of free ground, from coordinates alone. */
export function propAt(x: number, y: number, free: boolean): PropKind | null {
  if (!free) return null;
  const h = hash(x * 3 + 11, y * 5 + 7, 3);
  return h < 0.012 ? 'pebbles' : h < 0.024 ? 'sprout' : h < 0.034 ? 'spire' : null;
}

export function propModel(kind: PropKind, variant: number): VoxelModel {
  if (kind === 'pebbles') {
    const m = prop(8, [mat(0x7e8f86), mat(0x5b6a63)]);
    sphere(m, 6 + variant, 7, 2, 2.6, 1);
    sphere(m, 11, 9 - variant, 1.5, 2, 2);
    sphere(m, 8, 11, 1.2, 1.5, 1);
    return m;
  }
  if (kind === 'sprout') {
    const m = prop(16, [mat(0x4a3a68), mat(0x8a56b8), mat(0xb6ff5c, { glow: true })]);
    cylinder(m, 8, 8, 0, 1.4, 7 + variant, 1);
    sphere(m, 8, 8, 8 + variant, 3.4, 2);
    cylinder(m, 8, 8, 7 + variant, 2.4, 1, 3); // glowing underside
    sphere(m, 12, 11, 2, 1.6, 2);
    return m;
  }
  const m = prop(20, [mat(0xcfc6b2), mat(0xe6dcc8)]);
  for (let z = 0; z < 16 + variant; z++) cylinder(m, 8, 8, z, 2.6 * (1 - z / (18 + variant)) + 0.5, 1, z > 10 ? 2 : 1);
  cylinder(m, 12, 5, 0, 1.4, 6, 1);
  return m;
}
