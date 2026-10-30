import { unitDef, type Faction } from '../data/defs';

/** How long a newly placed building takes to rise, in ms. */
export const BUILD_MS = 1500;

/** Build-up progress 0..1 for a building first seen at `born` (use -Infinity for buildings that were already there). */
export function buildUp(now: number, born: number): number {
  return Math.max(0, Math.min(1, (now - born) / BUILD_MS));
}

export type DamageState = 'intact' | 'damaged' | 'critical';

export function damageState(hp: number, maxHp: number): DamageState {
  const f = hp / Math.max(1, maxHp);
  return f > 0.66 ? 'intact' : f > 0.33 ? 'damaged' : 'critical';
}

/** Compass index 0..7 of a screen-space direction, 0 = right and turning clockwise (y grows downward). */
export function octant(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  return (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
}

/** Unit vector for an octant in the flattened isometric plane (vertical directions are squashed). */
export function octantVector(o: number): { x: number; y: number } {
  const a = (o * Math.PI) / 4;
  return { x: Math.cos(a), y: Math.sin(a) * 0.5 };
}

const hash = (x: number, y: number): number => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
};

const CELL = 6;

/** Low-frequency brightness factor (about 0.92..1.08) for open ground; smooth value noise on tile coordinates. */
export function groundTint(x: number, y: number): number {
  const gx = Math.floor(x / CELL);
  const gy = Math.floor(y / CELL);
  const fx = x / CELL - gx;
  const fy = y / CELL - gy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = hash(gx, gy) * (1 - sx) + hash(gx + 1, gy) * sx;
  const bot = hash(gx, gy + 1) * (1 - sx) + hash(gx + 1, gy + 1) * sx;
  return 0.92 + (top * (1 - sy) + bot * sy) * 0.16;
}

export interface Edges {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
}

/** Which sides of tile (x, y) touch a taller tile (rock), for edge shading. */
export function edgeShade(heights: ArrayLike<number>, width: number, x: number, y: number): Edges {
  const h = (tx: number, ty: number): number => (tx < 0 || ty < 0 || tx >= width || ty * width + tx >= heights.length ? 0 : (heights[ty * width + tx] ?? 0));
  const me = h(x, y);
  return { n: h(x, y - 1) > me, e: h(x + 1, y) > me, s: h(x, y + 1) > me, w: h(x - 1, y) > me };
}

export interface Muzzle {
  len: number;
  width: number;
  color: number;
}

const MUZZLES: Record<string, Muzzle> = {
  pierce: { len: 9, width: 3, color: 0xfff1a8 },
  rocket: { len: 14, width: 5, color: 0xffb347 },
  blast: { len: 20, width: 8, color: 0xff8c42 },
  claw: { len: 6, width: 2, color: 0xff5a8a },
  beam: { len: 24, width: 3, color: 0x9ff0ff },
};

export const muzzleFor = (weapon: string): Muzzle => MUZZLES[weapon] ?? { len: 8, width: 3, color: 0xffffff };

/** Depth offset that puts air units above everything on the ground (the map is far smaller than this in screen pixels). */
const AIR_DEPTH = 1_000_000;

/** Draw-order key of a unit at screen-y `y`: ground units sort with terrain and buildings, air units always above them. */
export const unitDepth = (y: number, air: boolean): number => (air ? y + AIR_DEPTH : y);

/** Health 0..1 against the unit kind's full hit points. */
export const hpFraction = (hp: number, kind: string): number => Math.max(0, Math.min(1, hp / unitDef(kind).hp));

/** Health bars appear only on damaged or selected things. */
export const barVisible = (hp: number, maxHp: number, selected: boolean): boolean => selected || hp < maxHp;

/** Idle animation brightness 0..1: humans blink a beacon, aliens pulse. */
export function idleGlow(faction: Faction, t: number): number {
  return faction === 'human' ? ((t % 1200) < 150 ? 1 : 0) : 0.5 + 0.5 * Math.sin(t / 300);
}

/** The y (px) below which a rising building is shown: `bottom` at progress 0 up to `top` at progress 1. */
export const revealLine = (progress: number, bottom: number, top: number): number => bottom - progress * (bottom - top);

/** Sprite tint for a building's damage state: darker as it weakens, untinted when intact. */
export const damageTint = (state: DamageState): number => (state === 'intact' ? 0xffffff : state === 'damaged' ? 0xe4dcd8 : 0xc9bab2);

const scaleRgb = (c: number, f: number): number => {
  const ch = (s: number): number => Math.max(0, Math.min(255, Math.round(((c >> s) & 255) * f)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/** Face colours of a lit cube: bright top, mid left, dark right (the same light as the voxel baker). */
export const shadeCube = (c: number): { top: number; left: number; right: number } => ({ top: scaleRgb(c, 1.1), left: scaleRgb(c, 0.82), right: scaleRgb(c, 0.55) });
