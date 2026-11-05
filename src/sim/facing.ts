import { buildingDef, unitDef } from '../data/defs';
import { centerOf, FP } from './fixed';
import type { Building, State, Unit } from './state';

/**
 * Facing for units that turn slowly (HERO-5): a direction is one of DIRS steps around the circle, 0 along +x and
 * increasing toward +y (the same sense as the renderers' yaw). Integer only, so every browser agrees (SIM-6, NET-2).
 */
export const DIRS = 256;
/** A hero walks only once it faces within this many steps of its way (22.5 degrees): it turns in place first. */
export const MOVE_ARC = 16;
/** A hero fires only at a target within this many steps of its facing (about 11 degrees, its guns' own swivel). */
export const FIRE_ARC = 8;

/** sin(k * 2pi / DIRS) * 4096 for k = 0..DIRS/4, fixed so no engine's Math.sin is involved. */
const QUARTER = [
  0, 101, 201, 301, 401, 501, 601, 700, 799, 897, 995, 1092, 1189, 1285, 1380, 1474, 1567, 1660, 1751, 1842, 1931, 2019, 2106, 2191, 2276, 2359, 2440, 2520, 2598, 2675, 2751, 2824, 2896, 2967,
  3035, 3102, 3166, 3229, 3290, 3349, 3406, 3461, 3513, 3564, 3612, 3659, 3703, 3745, 3784, 3822, 3857, 3889, 3920, 3948, 3973, 3996, 4017, 4036, 4052, 4065, 4076, 4085, 4091, 4095, 4096,
];
const Q = DIRS / 4;
const sinOf = (k: number): number => {
  const a = ((k % DIRS) + DIRS) % DIRS;
  if (a <= Q) return QUARTER[a] as number;
  if (a <= 2 * Q) return QUARTER[2 * Q - a] as number;
  if (a <= 3 * Q) return -(QUARTER[a - 2 * Q] as number);
  return -(QUARTER[DIRS - a] as number);
};
const cosOf = (k: number): number => sinOf(k + Q);

/** The step nearest the direction (dx, dy); ties go to the lower step. (0, 0) gives -1. */
export function dirOf(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return -1;
  let best = 0;
  let bd = -Infinity;
  for (let k = 0; k < DIRS; k++) {
    const d = dx * cosOf(k) + dy * sinOf(k);
    if (d > bd) {
      bd = d;
      best = k;
    }
  }
  return best;
}

/** Signed steps from `a` to `b`, in [-DIRS/2, DIRS/2). */
export const dirDiff = (a: number, b: number): number => ((((b - a) % DIRS) + DIRS + DIRS / 2) % DIRS) - DIRS / 2;

/** Whether a unit of this kind turns slowly and must face its way and its target (HERO-5). */
export const turnsSlowly = (u: Unit): boolean => (unitDef(u.kind).turnRate ?? 0) > 0;

/** Where something is: a unit's position, a building's centre (fixed-point). */
function centre(e: Unit | Building): [number, number] {
  if ('tx' in e) {
    const d = buildingDef(e.kind);
    return [e.tx * FP + (d.w * FP) / 2, e.ty * FP + (d.h * FP) / 2];
  }
  return [e.x, e.y];
}

/** The step toward `e` from `u`, or -1 when on top of it. */
export const dirTo = (u: Unit, e: Unit | Building): number => {
  const [x, y] = centre(e);
  return dirOf(x - u.x, y - u.y);
};

/** The step toward a slow turner's next waypoint, or -1 when it has none to go to. */
export function wayDir(s: State, u: Unit): number {
  for (const next of u.path) {
    const d = dirOf(centerOf(next % s.grid.width) - u.x, centerOf(Math.floor(next / s.grid.width)) - u.y);
    if (d >= 0) return d;
  }
  return -1;
}

/**
 * One tick of turning (HERO-5): a slow turner on the way somewhere turns toward its next waypoint; standing, it turns
 * toward its target. It turns at most its kind's `turnRate` steps a tick.
 */
export function turnUnit(s: State, u: Unit): void {
  const rate = unitDef(u.kind).turnRate ?? 0;
  if (rate <= 0) return;
  let want = wayDir(s, u);
  if (want < 0 && u.target >= 0) {
    const t = s.units.find((v) => v.id === u.target) ?? s.buildings.find((b) => b.id === u.target);
    if (t) want = dirTo(u, t);
  }
  if (want < 0) return;
  const d = dirDiff(u.facing, want);
  u.facing = (u.facing + Math.max(-rate, Math.min(rate, d)) + DIRS) % DIRS;
}

/** Whether a slow turner faces its way closely enough to walk; any other unit always may (HERO-5). */
export function mayWalk(s: State, u: Unit): boolean {
  if (!turnsSlowly(u)) return true;
  const want = wayDir(s, u);
  return want < 0 || Math.abs(dirDiff(u.facing, want)) <= MOVE_ARC;
}

/** Whether a slow turner faces `e` closely enough to fire at it; any other unit always does (HERO-5). */
export function faces(u: Unit, e: Unit | Building): boolean {
  if (!turnsSlowly(u)) return true;
  const d = dirTo(u, e);
  return d < 0 || Math.abs(dirDiff(u.facing, d)) <= FIRE_ARC;
}
