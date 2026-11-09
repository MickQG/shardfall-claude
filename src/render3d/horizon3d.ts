import { fbm, groundRgb } from '../render/terrainNext';
import * as THREE from 'three';
import { LEVEL_H, type MeshData } from './terrain3d';

/**
 * The world beyond the map edge (R3D-25): a ring of low rolling land that continues the map's own ground tones, going
 * darker and cooler with distance, under a sky gradient whose horizon colour is the scene fog's colour, so land fades
 * into haze and the view never shows empty space. One mesh, no fog of war, never selectable. Colours and shapes come
 * from position alone. Pure, except `skyTexture`, which needs a canvas.
 */

/** The haze colour: the scene fog and the sky's horizon (R3D-25). */
export const HAZE_COLOR = 0x4a4a62;
/** The sky overhead, a touch deeper than the haze. */
export const SKY_TOP_COLOR = 0x39405e;
/** How far the land reaches past the map edge, tiles: well beyond anything the camera can see at any zoom or pitch. */
export const HORIZON_REACH = 300;
/** Rings and points per ring of the skirt. */
const RINGS = 40;
const AROUND = 200;
/** The hills start this far from the map edge, tiles, and are at most this high, tiles. */
const HILLS_FROM = 14;
const HILL_AMP = 5.5;

/** A vertical gradient from the haze colour (bottom, at the horizon) to the sky overhead (top), used as the scene background. */
export function skyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, `#${new THREE.Color(SKY_TOP_COLOR).getHexString()}`);
  grad.addColorStop(1, `#${new THREE.Color(HAZE_COLOR).getHexString()}`);
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const srgbToLinear = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
/** The average tone of the map's ground, which distant land settles to. */
const CALM = [84, 88, 60] as const;
const smooth = (a: number, b: number, x: number): number => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** Height of the land at (x, z) given its distance `out` outside the map rectangle: flat at the edge, then low hills. */
export function horizonHeight(x: number, z: number, out: number): number {
  const ramp = smooth(HILLS_FROM, HILLS_FROM + 60, out);
  const n = fbm(x * 0.022 + 311, z * 0.022 + 57) * 0.8 + fbm(x * 0.06 + 5, z * 0.06 + 77) * 0.2;
  return ramp * HILL_AMP * Math.max(0, (n - 0.3) * 1.6);
}

/**
 * The skirt: RINGS rectangles stepping out from the map's edge to HORIZON_REACH past it (closely spaced near the map,
 * widely far out), AROUND points on each, so one indexed mesh. The inner ring lies exactly on the map's outline at
 * height 0, so it joins the ground without a seam.
 */
export function horizonMesh(width: number, height: number, heights: readonly number[] = []): MeshData {
  const rows = RINGS + 1;
  const pos = new Float32Array(rows * AROUND * 3);
  const col = new Float32Array(rows * AROUND * 3);
  const w = width;
  const h = height;
  for (let k = 0; k < rows; k++) {
    const o = HORIZON_REACH * (k / RINGS) ** 2.2;
    const perim = 2 * (w + h) + 8 * o;
    for (let j = 0; j < AROUND; j++) {
      // A point a fraction of the way round the rectangle grown by `o`, starting at its top-left corner.
      let s = (j / AROUND) * perim;
      const sw = w + 2 * o;
      const sh = h + 2 * o;
      let x: number;
      let z: number;
      if (s < sw) {
        x = -o + s;
        z = -o;
      } else if ((s -= sw) < sh) {
        x = w + o;
        z = -o + s;
      } else if ((s -= sh) < sw) {
        x = w + o - s;
        z = h + o;
      } else {
        s -= sw;
        x = -o;
        z = h + o - s;
      }
      // Land at the map's edge starts at the height of the edge tile (a raised border is not left hanging), and settles to the hills.
      const bl = heights[Math.max(0, Math.min(h - 1, Math.floor(z))) * w + Math.max(0, Math.min(w - 1, Math.floor(x)))] ?? 0;
      const y = bl * LEVEL_H * (1 - smooth(0, 5, o)) + horizonHeight(x, z, o);
      const i = (k * AROUND + j) * 3;
      pos[i] = x;
      pos[i + 1] = y;
      pos[i + 2] = z;
      // The map's own ground colours, continued by the same noise; higher, farther land dries and cools, then dims.
      // The ground's patch noise is stretched with distance, so colour does not alias across the widening rings.
      const sc = 1 / (1 + o / 6);
      const sx = x * sc;
      const sz = z * sc;
      const gx = Math.floor(sx);
      const gz = Math.floor(sz);
      let c = groundRgb(gx, gz, sx - gx, sz - gz, { level: 0, water: false, shade: 0, shore: 0, shards: false });
      // Far out, the colour settles to one calm average so the widening rings never smear the ground's patches into streaks.
      const calm = 0.85 * smooth(8, 70, o);
      c = [c[0] + (CALM[0] - c[0]) * calm, c[1] + (CALM[1] - c[1]) * calm, c[2] + (CALM[2] - c[2]) * calm];
      const far = smooth(20, HORIZON_REACH * 0.6, o);
      const rise = Math.min(1, Math.max(0, y) / HILL_AMP);
      const dim = (1 - 0.3 * far) * (0.94 + 0.1 * rise);
      c = [c[0] * dim * (1 - 0.1 * far), c[1] * dim * (1 - 0.05 * far), c[2] * dim * (1 + 0.1 * far)];
      col[i] = srgbToLinear(c[0]);
      col[i + 1] = srgbToLinear(c[1]);
      col[i + 2] = srgbToLinear(c[2]);
    }
  }
  const idx: number[] = [];
  for (let k = 0; k < RINGS; k++) {
    for (let j = 0; j < AROUND; j++) {
      const a = k * AROUND + j;
      const b = k * AROUND + ((j + 1) % AROUND);
      const c = a + AROUND;
      const d = b + AROUND;
      // Wound so the faces look up.
      idx.push(a, b, c, b, d, c);
    }
  }
  // Smooth normals from the faces.
  const nor = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t]! * 3, idx[t + 1]! * 3, idx[t + 2]! * 3];
    const e1 = [pos[b]! - pos[a]!, pos[b + 1]! - pos[a + 1]!, pos[b + 2]! - pos[a + 2]!];
    const e2 = [pos[c]! - pos[a]!, pos[c + 1]! - pos[a + 1]!, pos[c + 2]! - pos[a + 2]!];
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    for (const v of [a, b, c]) for (let q = 0; q < 3; q++) nor[v + q]! += n[q]!;
  }
  for (let v = 0; v < nor.length; v += 3) {
    const l = Math.hypot(nor[v]!, nor[v + 1]!, nor[v + 2]!) || 1;
    // Always facing up: the winding is the same everywhere, but guard against a flipped normal.
    const s = nor[v + 1]! < 0 ? -1 : 1;
    nor[v] = (nor[v]! / l) * s;
    nor[v + 1] = (nor[v + 1]! / l) * s;
    nor[v + 2] = (nor[v + 2]! / l) * s;
  }
  return { positions: pos, normals: nor, colors: col, indices: new Uint32Array(idx) };
}
