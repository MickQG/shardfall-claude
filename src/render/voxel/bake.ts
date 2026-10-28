import { getVoxel, type VoxelModel } from './model';

/** Screen pixels per voxel along the ground axes and per layer of height. */
const PX_X = 4;
const PX_Y = 2;
const PX_Z = 4;
/** Supersampling factor: the sprite is drawn at 2x and averaged down for smooth edges. */
const SS = 2;
/** Direction towards the light (unit length): from the upper left, so left faces are lit and right faces are dark. */
const LIGHT = { x: 0.2, y: 0.55, z: 0.81 };
const AMBIENT = 0.42;
/** Ground shadow offset per voxel of height, along the world x axis (down-right on screen). */
const SHADOW = 0.45;
const SHADOW_ALPHA = 80;

export interface BakeOptions {
  /** Team colour as 0xRRGGBB. */
  team: number;
  facing: number;
  /** Number of facings around the full turn. */
  facings: number;
  /** Layers at and above this height are left out (for build-up reveals). */
  clipZ?: number;
}

export interface Sprite {
  width: number;
  height: number;
  /** RGBA, row-major, not premultiplied. */
  pixels: Uint8ClampedArray;
  /** Pixel of the model's ground centre; the same for every facing. */
  anchorX: number;
  anchorY: number;
  /** Faces actually drawn (for tests and tooling). */
  faces: number;
}

/** Nearest facing index for a tile-space heading; 0 is the model's +x axis, turning towards +y. */
export function facingOf(dx: number, dy: number, facings: number): number {
  if (dx === 0 && dy === 0) return 0;
  const k = Math.round(Math.atan2(dy, dx) / ((Math.PI * 2) / facings));
  return ((k % facings) + facings) % facings;
}

/** Brightness 0..1 of a face with normal (nx, ny, nz) after the model is turned by `theta` radians. */
export function faceIntensity(nx: number, ny: number, nz: number, theta: number): number {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const rx = nx * c - ny * s;
  const ry = nx * s + ny * c;
  const d = Math.max(0, rx * LIGHT.x + ry * LIGHT.y + nz * LIGHT.z);
  return AMBIENT + ((1 - AMBIENT) * d) / LIGHT.z;
}

const hash3 = (x: number, y: number, z: number): number => {
  let h = (x * 374761393 + y * 668265263 + z * 2246822519) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
};

class Buffer2D {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  /** Fills a convex polygon (flat colour, no blending) using pixel-centre sampling. */
  fill(pts: readonly number[], r: number, g: number, b: number, a: number): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < pts.length; i += 2) {
      minY = Math.min(minY, pts[i] as number);
      maxY = Math.max(maxY, pts[i] as number);
    }
    const n = pts.length / 2;
    for (let y = Math.max(0, Math.ceil(minY - 0.5)); y <= Math.min(this.h - 1, Math.floor(maxY - 0.5)); y++) {
      const sy = y + 0.5;
      let xl = Infinity;
      let xr = -Infinity;
      for (let i = 0; i < n; i++) {
        const x0 = pts[i * 2] as number;
        const y0 = pts[i * 2 + 1] as number;
        const x1 = pts[((i + 1) % n) * 2] as number;
        const y1 = pts[((i + 1) % n) * 2 + 1] as number;
        if ((y0 <= sy && y1 > sy) || (y1 <= sy && y0 > sy)) {
          const x = x0 + ((sy - y0) / (y1 - y0)) * (x1 - x0);
          xl = Math.min(xl, x);
          xr = Math.max(xr, x);
        }
      }
      for (let x = Math.max(0, Math.ceil(xl - 0.5)); x <= Math.min(this.w - 1, Math.floor(xr - 0.5)); x++) {
        const i = (y * this.w + x) * 4;
        this.data[i] = r;
        this.data[i + 1] = g;
        this.data[i + 2] = b;
        this.data[i + 3] = a;
      }
    }
  }
}

const channel = (c: number, shift: number): number => (c >> shift) & 255;

/** Renders one facing of a model into a sprite. Pure: the result depends only on the arguments. */
export function bakeModel(m: VoxelModel, o: BakeOptions): Sprite {
  const facing = ((o.facing % o.facings) + o.facings) % o.facings;
  const theta = (facing * Math.PI * 2) / o.facings;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const clip = Math.min(o.clipZ ?? m.sz, m.sz);
  const cx = m.sx / 2;
  const cy = m.sy / 2;

  const rad = Math.hypot(m.sx, m.sy) / 2;
  const halfW = Math.ceil(rad * PX_X * Math.SQRT2) + 4 + Math.ceil(m.sz * 2);
  const width = halfW * 2;
  const anchorX = halfW;
  const anchorY = Math.ceil(m.sz * PX_Z + rad * PX_Y * Math.SQRT2) + 4;
  const height = anchorY + Math.ceil(rad * PX_Y * Math.SQRT2 + m.sz) + 6;
  const buf = new Buffer2D(width * SS, height * SS);

  /** World (turned) ground coordinates and height to supersampled screen pixels. */
  const screen = (rx: number, ry: number, z: number): [number, number] => [(anchorX + (rx - ry) * PX_X) * SS, (anchorY + (rx + ry) * PX_Y - z * PX_Z) * SS];
  const world = (x: number, y: number): [number, number] => {
    const dx = x - cx;
    const dy = y - cy;
    return [dx * cos - dy * sin, dx * sin + dy * cos];
  };
  const solid = (x: number, y: number, z: number): number => (z < clip ? getVoxel(m, x, y, z) : 0);

  // Ground shadow first: columns swept along the shadow direction, so the model paints over it.
  for (let y = 0; y < m.sy; y++) {
    for (let x = 0; x < m.sx; x++) {
      let h = 0;
      for (let z = clip - 1; z >= 0; z--) {
        if (solid(x, y, z) !== 0) {
          h = z + 1;
          break;
        }
      }
      if (h === 0) continue;
      const steps = Math.ceil(h * SHADOW * 2) + 1;
      for (let s = 0; s <= steps; s++) {
        const off = (s / steps) * h * SHADOW;
        const quad: number[] = [];
        for (const [qx, qy] of [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]] as const) {
          const [rx, ry] = world(qx, qy);
          quad.push(...screen(rx + off, ry, 0));
        }
        buf.fill(quad, 0, 0, 0, SHADOW_ALPHA);
      }
    }
  }

  // Back-to-front list of voxels: farther (smaller x+y in the turned frame) first, lower first.
  const order: { x: number; y: number; z: number; key: number }[] = [];
  for (let z = 0; z < clip; z++) {
    for (let y = 0; y < m.sy; y++) {
      for (let x = 0; x < m.sx; x++) {
        if (solid(x, y, z) === 0) continue;
        const [rx, ry] = world(x + 0.5, y + 0.5);
        order.push({ x, y, z, key: (rx + ry) * 1000 + z });
      }
    }
  }
  order.sort((a, b) => a.key - b.key);

  const SIDES: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  let faces = 0;
  for (const v of order) {
    const mat = m.materials[solid(v.x, v.y, v.z) - 1];
    if (!mat) continue;
    const base = mat.team ? o.team : mat.color;
    const noise = mat.glow ? 1 : 1 + (hash3(v.x, v.y, v.z) - 0.5) * 0.08;
    const paint = (intensity: number, top: boolean): [number, number, number] => {
      const k = mat.glow ? 1 : intensity * noise;
      const hi = mat.metal && top ? 0.28 : 0;
      return [16, 8, 0].map((sh) => {
        const c = channel(base, sh);
        return Math.max(0, Math.min(255, Math.round((c + (255 - c) * hi) * k)));
      }) as [number, number, number];
    };

    for (const [nx, ny] of SIDES) {
      // A side face is visible when its turned normal points towards the camera (+x +y).
      const vis = nx * cos - ny * sin + (nx * sin + ny * cos);
      if (vis <= 1e-6 || solid(v.x + nx, v.y + ny, v.z) !== 0) continue;
      const alongY = nx !== 0;
      const fx = nx > 0 ? v.x + 1 : v.x;
      const fy = ny > 0 ? v.y + 1 : v.y;
      const quad: number[] = [];
      for (const [t, z] of [[0, v.z], [1, v.z], [1, v.z + 1], [0, v.z + 1]] as const) {
        const [rx, ry] = world(fx + (alongY ? 0 : t), fy + (alongY ? t : 0));
        quad.push(...screen(rx, ry, z));
      }
      const [r, g, b] = paint(faceIntensity(nx, ny, 0, theta), false);
      buf.fill(quad, r, g, b, 255);
      faces++;
    }
    if (solid(v.x, v.y, v.z + 1) === 0) {
      const quad: number[] = [];
      for (const [qx, qy] of [[v.x, v.y], [v.x + 1, v.y], [v.x + 1, v.y + 1], [v.x, v.y + 1]] as const) {
        const [rx, ry] = world(qx, qy);
        quad.push(...screen(rx, ry, v.z + 1));
      }
      const [r, g, b] = paint(faceIntensity(0, 0, 1, theta), true);
      buf.fill(quad, r, g, b, 255);
      faces++;
    }
  }

  // Average the supersamples down, weighting colour by alpha.
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let j = 0; j < SS; j++) {
        for (let i = 0; i < SS; i++) {
          const k = ((y * SS + j) * buf.w + x * SS + i) * 4;
          const al = buf.data[k + 3] as number;
          r += (buf.data[k] as number) * al;
          g += (buf.data[k + 1] as number) * al;
          b += (buf.data[k + 2] as number) * al;
          a += al;
        }
      }
      const p = (y * width + x) * 4;
      if (a > 0) {
        pixels[p] = Math.round(r / a);
        pixels[p + 1] = Math.round(g / a);
        pixels[p + 2] = Math.round(b / a);
        pixels[p + 3] = Math.round(a / (SS * SS));
      }
    }
  }
  return { width, height, pixels, anchorX, anchorY, faces };
}
