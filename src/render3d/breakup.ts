/**
 * A hero breaking apart as it dies (HERO-3). Its model's parts (legs, guns, pods, the hull) are blown out one by one,
 * in step with the internal blasts, and fall under gravity; each lands, bounces once and comes to rest, and the hull,
 * the biggest piece, goes last with the final blast. Pure maths, in the unit's own frame (tiles, Y up, the ground at
 * 0), so it can be tested without a scene. Render-only.
 */

/** When the final blast throws the hull, ms after death (matches CombatFx.heroDeath). */
export const BREAK_FINAL_MS = 1350;
/** Internal blasts that throw the other parts: the first, and the spacing between them, ms. */
export const BREAK_FIRST_MS = 130;
export const BREAK_STEP_MS = 170;
export const GRAVITY = 9.8;
/** Share of its speed a piece keeps on its one bounce (up), and along the ground. */
const BOUNCE = 0.28;
const SKID = 0.4;

export interface PieceStart {
  /** Centre of the piece, tiles, in the unit's frame. */
  x: number;
  y: number;
  z: number;
  /** Rough size (bounding radius), tiles: bigger pieces fly lower and spin slower. */
  size: number;
}

export interface Piece {
  x0: number;
  y0: number;
  z0: number;
  vx: number;
  vy: number;
  vz: number;
  /** Spin axis (unit length) and rate, radians per second. */
  ax: number;
  ay: number;
  az: number;
  rate: number;
  /** When it is thrown, ms after death. */
  at: number;
  /** Height its centre rests at once down. */
  floor: number;
}

export interface PiecePose {
  x: number;
  y: number;
  z: number;
  angle: number;
  /** Down on the ground for good. */
  resting: boolean;
}

/** Deterministic scatter in [0, 1) from a seed and an index (no Math.random). */
function hash(seed: number, i: number, k: number): number {
  let h = Math.imul(seed | 0, 374761393) ^ Math.imul(i + 1, 668265263) ^ Math.imul(k + 7, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * How each piece flies (pure): the biggest one is the hull and goes with the final blast, a short hop; the rest are
 * thrown outward from the middle, away from where they sat, in the order of the internal blasts.
 */
export function planBreakup(starts: readonly PieceStart[], seed: number): Piece[] {
  let hull = 0;
  starts.forEach((s, i) => {
    if (s.size > (starts[hull]?.size ?? 0)) hull = i;
  });
  let order = 0;
  return starts.map((s, i) => {
    const r = (k: number): number => hash(seed, i, k);
    const isHull = i === hull;
    const out = Math.hypot(s.x, s.z);
    const a = out > 0.05 ? Math.atan2(s.z, s.x) + (r(0) - 0.5) * 0.9 : r(0) * Math.PI * 2;
    const heavy = Math.min(1, s.size / 1.2);
    const sp = isHull ? 0.4 + r(1) * 0.4 : (2.6 - heavy * 1.2) * (0.7 + r(1) * 0.6);
    const ax = r(2) - 0.5;
    const ay = (r(3) - 0.5) * 0.6;
    const az = r(4) - 0.5;
    const n = Math.hypot(ax, ay, az) || 1;
    const at = isHull ? BREAK_FINAL_MS : BREAK_FIRST_MS + (order++ % 7) * BREAK_STEP_MS + r(5) * 60;
    return {
      x0: s.x,
      y0: s.y,
      z0: s.z,
      vx: Math.cos(a) * sp,
      vy: isHull ? 2 + r(6) * 0.8 : 2.8 + r(6) * 2.2,
      vz: Math.sin(a) * sp,
      ax: ax / n,
      ay: ay / n,
      az: az / n,
      rate: isHull ? 1.2 + r(7) : (8 - heavy * 5) * (0.6 + r(7) * 0.6),
      at,
      floor: Math.max(0.03, s.size * 0.35),
    };
  });
}

/** Where a piece is `age` ms after death (pure): it shudders in place, flies, bounces once and rests. */
export function pieceAt(p: Piece, age: number): PiecePose {
  if (age < p.at) {
    // Shaking harder as the blasts build towards it.
    const k = (0.012 * age) / Math.max(1, p.at);
    return { x: p.x0 + Math.sin(age * 0.11 + p.rate) * k, y: p.y0 + Math.sin(age * 0.17) * k * 0.5, z: p.z0 + Math.cos(age * 0.13 + p.rate) * k, angle: 0, resting: false };
  }
  const g = GRAVITY;
  const t = (age - p.at) / 1000;
  const drop = Math.max(0, p.y0 - p.floor);
  const t1 = (p.vy + Math.sqrt(p.vy * p.vy + 2 * g * drop)) / g;
  if (t < t1) return { x: p.x0 + p.vx * t, y: p.y0 + p.vy * t - (g * t * t) / 2, z: p.z0 + p.vz * t, angle: p.rate * t, resting: false };
  const x1 = p.x0 + p.vx * t1;
  const z1 = p.z0 + p.vz * t1;
  const up = BOUNCE * (g * t1 - p.vy);
  const t2 = (2 * up) / g;
  const tb = Math.min(t - t1, t2);
  const y = tb < t2 ? p.floor + up * tb - (g * tb * tb) / 2 : p.floor;
  return { x: x1 + p.vx * SKID * tb, y: Math.max(p.floor, y), z: z1 + p.vz * SKID * tb, angle: p.rate * t1 + p.rate * 0.3 * tb, resting: t - t1 >= t2 };
}
