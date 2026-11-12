import type { WeaponLook } from './rig';

/**
 * Where a drawn shot ends on its target (AIM-3): scattered across the target's body around the aim point, so a stream
 * of fire does not all land on one spot. Render only: the simulation's damage and timing never see it.
 */

/** How a shot scatters: not at all (melee, superweapon strikes), a little on the ground (area blasts), or over the body. */
export type ScatterKind = 'none' | 'area' | 'body';

/** Furthest an area blast's drawn landing moves from where its damage lands, tiles (AIM-3). */
export const AREA_SCATTER = 0.2;
/** Share of a unit's radius, or a building's half-width and half-depth, that shots spread over (AIM-3). */
export const BODY_SPREAD = 0.6;
/** Size assumed when nothing is found at the aim point (the target has just died, or is not drawn). */
export const DEFAULT_TARGET: ScatterTarget = { halfX: 0.15, halfZ: 0.15, height: 0.3, aimY: 0.2, air: false };

/** The target's drawn size, measured from its base (the ground under it, or its flight height for aircraft). */
export interface ScatterTarget {
  /** Half extent across x and z, tiles (a unit's radius in both). */
  halfX: number;
  halfZ: number;
  /** Body height, tiles. */
  height: number;
  /** Height of the aim point above the base. */
  aimY: number;
  /** An aircraft: shots scatter above and below its flight height. */
  air: boolean;
}

export interface Offset {
  x: number;
  y: number;
  z: number;
}

/** How a weapon's shots scatter: melee and superweapon strikes do not, area blasts (artillery, hero shells, missiles) barely. */
export function scatterKind(look: WeaponLook | 'superweapon'): ScatterKind {
  if (look === 'claw' || look === 'superweapon') return 'none';
  if (look === 'howitzer' || look === 'heroCannon' || look === 'heroAcid' || look === 'missile') return 'area';
  return 'body';
}

/** A well-mixed 32-bit hash of three integers, as a fraction in [0, 1). */
function hash01(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca77) ^ Math.imul((c | 0) + 0x165667b1, 0xc2b2ae3d);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// The R3 low-discrepancy sequence (steps of 1/g, 1/g², 1/g³ for g, the root of x⁴ = x + 1): successive shots fill the body evenly.
const R3A = 0.8191725133961645;
const R3B = 0.6710436067037893;
const R3C = 0.5497004779019703;
const frac = (v: number): number => v - Math.floor(v);

/**
 * The offset of shot number `shot` (from shooter `shooter`, squad figure `figure`) from the aim point, written to `out`.
 * The same shooter, shot and figure always give the same point. `dirX`, `dirZ` is the line of fire on the ground (any
 * length, zero for none): a body shot's spread along it is halved, so tracers end on the face toward the shooter
 * rather than in the air beside a small target.
 */
export function shotScatter(shooter: number, shot: number, figure: number, t: ScatterTarget, kind: ScatterKind, out: Offset, dirX = 0, dirZ = 0): Offset {
  out.x = 0;
  out.y = 0;
  out.z = 0;
  if (kind === 'none') return out;
  // Each shooter and figure walks the sequence from its own start, one step per shot.
  const i = shot >>> 0;
  const a = frac(hash01(shooter, figure, 1) + i * R3A);
  const b = frac(hash01(shooter, figure, 2) + i * R3B);
  const c = frac(hash01(shooter, figure, 3) + i * R3C);
  // Evenly over a disc: square-root radius, so the middle is not crowded.
  const r = Math.sqrt(a);
  const ang = b * Math.PI * 2;
  let ux = Math.cos(ang) * r;
  let uz = Math.sin(ang) * r;
  if (kind === 'area') {
    const R = Math.min(AREA_SCATTER, BODY_SPREAD * Math.min(t.halfX, t.halfZ));
    out.x = ux * R;
    out.z = uz * R;
    return out;
  }
  const len = Math.hypot(dirX, dirZ);
  if (len > 1e-6) {
    // Halve the part along the line of fire (stays within the disc).
    const dx = dirX / len;
    const dz = dirZ / len;
    const along = ux * dx + uz * dz;
    ux -= along * dx * 0.5;
    uz -= along * dz * 0.5;
  }
  out.x = ux * BODY_SPREAD * t.halfX;
  out.z = uz * BODY_SPREAD * t.halfZ;
  if (t.air) {
    // Around the flight height, over half the body's height.
    out.y = (c - 0.5) * 0.5 * t.height;
  } else {
    // Over the body from low on it to near its top, never below its base.
    const lo = 0.15 * t.height;
    const hi = 0.7 * t.height;
    out.y = lo + c * (hi - lo) - t.aimY;
  }
  return out;
}
