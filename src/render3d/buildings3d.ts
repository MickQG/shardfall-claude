import * as THREE from 'three';
import { hash3, Shape, type Paint, type V3 } from './kit';
import type { RigDef, RigNode } from './rig';

/**
 * Procedural building, crystal and prop models (R3D-3). Buildings stand on their footprint centre; tall parts sit
 * toward the back (-X, -Z) so they do not hide the front from the fixed camera, which looks from +X +Z.
 */

const STEEL = 0x959c97;
const STEEL2 = 0x6a716d;
const CONCRETE = 0x8a877e;
const CONCRETE2 = 0x6a675f;
const GUN = 0x3b4248;
const DARK = 0x202428;
const HAZARD = 0xe0aa2c;
const GLASS = 0x22384a;
const CYAN = 0x6fe2ff;
const AMBER = 0xffb347;
const RED = 0xff4a3a;
const SAND = 0x8f8160;
const CHITIN = 0x4b2b45;
const CHITIN2 = 0x6e4062;
const BELLY = 0x2c1a28;
const BONE = 0xd9ccb2;
const FLESH = 0x8c4460;
const GREEN = 0x9dff3c;
const ACID = 0xc8ff4a;
const SAC = 0x7fb23a;
const MAGENTA = 0xff5ab0;
/** The dark pit of a pore, and the thin skin of a membrane (R3D-34). */
const PORE = 0x170c14;
const MEMBRANE = 0x5e2c4c;
const CERAMIC = 0xc9c3b4;
const CRATE = 0x5d6650;

const shape = (): Shape => new Shape();

/**
 * A refinery's dock (ECO-7, R3D-22) is drawn as its own model on the pad tile the simulation chose, beside the side of
 * the footprint facing the shards. Dock models stand on the pad's centre with +X pointing out, away from the building,
 * whose wall is at x = -0.5. How far in from the pad's centre each dock takes in the load: the Aegis receiving trough at
 * the wall, the Vrax feeding maw just short of it.
 */
export const DOCK_INTAKE: Readonly<Record<string, number>> = { hum_refinery: 0.45, ali_extractor: 0.42 };

/** Where a refinery's dock stands (R3D-22): the pad tile's centre and the unit vector pointing out of the building. */
export interface DockFrame {
  x: number;
  z: number;
  out: [number, number];
}

export function dockFrame(b: { kind: string; tx: number; ty: number; pad?: readonly [number, number] | null }, w: number, h: number): DockFrame | undefined {
  if (!b.pad || DOCK_INTAKE[b.kind] === undefined) return undefined;
  const [px, py] = b.pad;
  const ox = px < b.tx ? -1 : px >= b.tx + w ? 1 : 0;
  const oz = py < b.ty ? -1 : py >= b.ty + h ? 1 : 0;
  return { x: px + 0.5, z: py + 0.5, out: [ox, oz] };
}

/** The world point a dock takes the load in at (R3D-22). */
export function dockIntake(kind: string, f: DockFrame): [number, number] {
  const k = DOCK_INTAKE[kind] ?? 0.45;
  return [f.x - f.out[0] * k, f.z - f.out[1] * k];
}

/** The yaw that turns a dock model's +X out of the building (three.js: +X turned by `yaw` about Y goes to (cos, -sin)). */
export const dockModelYaw = (f: DockFrame): number => Math.atan2(-f.out[1], f.out[0]);

/**
 * The world yaw a hauler unloading at (x, z) turns to (R3D-22): a gorger faces the feeding maw; a hauler, whose bed
 * tips out of the back, turns its back to the hopper.
 */
export function dockYaw(unitKind: string, kind: string, f: DockFrame, x: number, z: number): number | undefined {
  const [ix, iz] = dockIntake(kind, f);
  const dx = ix - x;
  const dz = iz - z;
  if (Math.hypot(dx, dz) < 1e-3) return undefined;
  return unitKind.startsWith('ali_') ? Math.atan2(dz, dx) : Math.atan2(-dz, -dx);
}

const def = (w: number, d: number, height: number, shapes: RigDef['shapes'], kids: RigNode[], o: Partial<RigDef> = {}): RigDef => ({
  shapes,
  root: { kids: [{ geo: 'body' }, ...kids] },
  move: 'static',
  radius: Math.max(w, d) / 2,
  height,
  ...o,
});

/** Aegis concrete foundation with hazard-striped corners. */
function plinth(s: Shape, w: number, d: number): Shape {
  s.box(w - 0.06, 0.1, d - 0.06, CONCRETE, { at: [0, 0.05, 0], bevel: 0.3 });
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) s.box(0.16, 0.02, 0.16, HAZARD, { at: [x * (w / 2 - 0.14), 0.105, z * (d / 2 - 0.14)], bevel: 0 });
  return s;
}

/** A row of glowing window slits along X on the +Z face (and mirrored on +X when `alsoX`). */
function windows(s: Shape, x0: number, x1: number, y: number, z: number, n: number, color = CYAN): void {
  for (let i = 0; i < n; i++) s.box(((x1 - x0) / n) * 0.55, 0.05, 0.012, color, { at: [x0 + ((i + 0.5) * (x1 - x0)) / n, y, z], glow: true, bevel: 0 });
}
function windowsX(s: Shape, z0: number, z1: number, y: number, x: number, n: number, color = CYAN): void {
  for (let i = 0; i < n; i++) s.box(0.012, 0.05, ((z1 - z0) / n) * 0.55, color, { at: [x, y, z0 + ((i + 0.5) * (z1 - z0)) / n], glow: true, bevel: 0 });
}

// ---------------------------------------------------------------- fine detail (R3D-34)
// Small parts stay plain (no bevel, few sides) and mostly under the shadow stand-in's size thresholds (PERF-4); they
// are added to the existing shapes, so they cost no draw calls (R3D-13). Seams are few, of uneven length and spacing,
// never a grid (R3D-23). Nothing here moves or glows brighter than the lights already on the buildings.

/** A wall facing +X ('x') or +Z ('z'). */
type Face = 'x' | 'z';
/** A point on a wall facing +X ('x', `p` is its x) or +Z ('z', `p` is its z): `u` runs along the wall, `y` up. */
const onWall = (f: Face, p: number, u: number, y: number): V3 => (f === 'x' ? [p, y, u] : [u, y, p]);
/** A box's size on such a wall: `t` out of the wall, `h` up, `l` along it. */
const wallBox = (f: Face, t: number, h: number, l: number): [number, number, number] => (f === 'x' ? [t, h, l] : [l, h, t]);
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** A few panel seams on a wall: thin grooves of uneven length at uneven places, some upright and some level. */
function seams(s: Shape, f: Face, p: number, u0: number, u1: number, y0: number, y1: number, n: number, seed: number, color = STEEL2): void {
  for (let i = 0; i < n; i++) {
    const up = hash3(seed, i, 1) < 0.5;
    const len = up ? (y1 - y0) * (0.5 + 0.45 * hash3(seed, i, 2)) : (u1 - u0) * (0.18 + 0.3 * hash3(seed, i, 2));
    const u = up ? u0 + (u1 - u0) * (0.06 + 0.88 * hash3(seed, i, 3)) : u0 + len / 2 + (u1 - u0 - len) * hash3(seed, i, 3);
    const y = up ? y0 + len / 2 + (y1 - y0 - len) * hash3(seed, i, 4) : y0 + (y1 - y0) * (0.15 + 0.7 * hash3(seed, i, 4));
    s.box(...wallBox(f, 0.006, up ? len : 0.007, up ? 0.007 : len), color, { at: onWall(f, p, u, y), bevel: 0, shadow: false });
  }
}

/** A louvred grille on a wall: a dark recess with a few level slats across it. */
function grille(s: Shape, f: Face, p: number, u: number, y: number, l: number, h: number, n = 3): void {
  s.box(...wallBox(f, 0.01, h, l), DARK, { at: onWall(f, p, u, y), bevel: 0, shadow: false });
  for (let i = 0; i < n; i++) s.box(...wallBox(f, 0.018, h / (n * 2.4), l * 0.9), GUN, { at: onWall(f, p, u, y - h / 2 + ((i + 0.5) * h) / n), bevel: 0, shadow: false });
}

/** A roof vent box standing on `at`, with louvres across its top. */
function roofVent(s: Shape, at: V3, w: number, d: number, h = 0.06): void {
  s.box(w, h, d, STEEL2, { at: [at[0], at[1] + h / 2, at[2]], bevel: 0, shadow: false });
  for (const k of [-0.3, 0.02, 0.3]) s.box(w * 0.84, 0.008, d * 0.14, DARK, { at: [at[0], at[1] + h + 0.002, at[2] + k * d], bevel: 0, shadow: false });
}

/**
 * A dish aerial on a gimbal at `at`, tilted `tilt` radians from straight up toward +x, with its feed on the axis. The
 * bowl is closed and thick (a back out to the rim, and a face from the rim back to the middle), so it shows from
 * behind as well as from the front, and the gimbal joins it to the mast below.
 */
function dish(s: Shape, at: V3, r: number, tilt: number, shadow = true): void {
  const along = (k: number): V3 => [at[0] + Math.sin(tilt) * k, at[1] + Math.cos(tilt) * k, at[2]];
  const d = r * 0.42;
  // The back casts the shadow; the face lies inside it and casts none (PERF-4).
  s.lathe([[0, 0], [r * 0.55, d * 0.22], [r * 0.92, d * 0.78], [r, d]], STEEL, { at, rot: [0, 0, -tilt], seg: 12, shadow });
  s.lathe([[r, d], [r * 0.93, d * 0.98], [r * 0.5, d * 0.36], [0, d * 0.2]], STEEL, { at, rot: [0, 0, -tilt], seg: 12, shadow: false });
  s.ball(r * 0.2, GUN, { at: along(-r * 0.05), seg: 6, shadow: false });
  s.cyl(r * 0.035, r * 0.75, DARK, { at: along(d * 0.2 + r * 0.375), rot: [0, 0, -tilt], seg: 4, shadow: false });
  s.ball(r * 0.07, DARK, { at: along(d * 0.2 + r * 0.75), seg: 6, shadow: false });
}

/** A ladder from `a` up to `b`, its rungs across the horizontal unit vector `side` (x, z). */
function ladder(s: Shape, a: V3, b: V3, side: readonly [number, number], rungs: number, w = 0.07): void {
  const o = (p: V3, k: number): V3 => [p[0] + side[0] * k, p[1], p[2] + side[1] * k];
  for (const k of [w / 2, -w / 2]) s.strut(o(a, k), o(b, k), 0.007, GUN, { seg: 4, shadow: false });
  for (let i = 0; i < rungs; i++) {
    const p = lerp3(a, b, (i + 0.5) / rungs);
    s.strut(o(p, w / 2), o(p, -w / 2), 0.005, GUN, { seg: 3, shadow: false });
  }
}

/** A handrail from `a` to `b` on `posts` posts, `h` high. */
function railing(s: Shape, a: V3, b: V3, posts: number, color = STEEL2, h = 0.06): void {
  const up = (p: V3): V3 => [p[0], p[1] + h, p[2]];
  s.strut(up(a), up(b), 0.006, color, { seg: 4, shadow: false });
  for (let i = 0; i < posts; i++) {
    const p = lerp3(a, b, i / (posts - 1));
    s.strut(p, up(p), 0.005, color, { seg: 3, shadow: false });
  }
}

/** A pipe through `pts` with a joint at each bend. */
function pipe(s: Shape, pts: readonly V3[], r: number, color = GUN): void {
  for (let i = 0; i + 1 < pts.length; i++) s.strut(pts[i]!, pts[i + 1]!, r, color, { seg: 6, shadow: false });
  for (let i = 1; i + 1 < pts.length; i++) s.ball(r * 1.25, color, { at: pts[i]!, seg: 5, shadow: false });
}

/** A small status light (drawn like the other lit windows, no brighter). */
function lamp(s: Shape, at: V3, color = AMBER, size = 0.022): void {
  s.box(size, size, size, color, { at, glow: true, bevel: 0, shadow: false });
}

/** The unit vector a piece's local +Y points along once turned by an XYZ Euler `rot` (x and z only). */
function axisOf(rot: V3): V3 {
  const [ax, , az] = rot;
  return [-Math.sin(az), Math.cos(az) * Math.cos(ax), Math.cos(az) * Math.sin(ax)];
}
const along = (p: V3, d: V3, k: number): V3 => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];

/**
 * A surface to place detail on: the point at height fraction `t` (0 bottom .. 1 top) and longitude `th`, pushed out
 * by `out` tiles.
 */
type Surf = (t: number, th: number, out?: number) => V3;

/** The band of an ellipsoid (centre c, radii r) between latitudes `from` and `to`. */
function dome(c: V3, r: V3, from: number, to: number): Surf {
  return (t, th, out = 0) => {
    const phi = from + (to - from) * t;
    const k = 1 + out / Math.min(r[0], r[1], r[2]);
    return [c[0] + r[0] * k * Math.cos(phi) * Math.cos(th), c[1] + r[1] * k * Math.sin(phi), c[2] + r[2] * k * Math.cos(phi) * Math.sin(th)];
  };
}

/** The band of a lathed shell (its (radius, height) profile, standing on `at`) between heights `from` and `to`. */
function shell(profile: readonly (readonly [number, number])[], at: V3, from: number, to: number): Surf {
  const radius = (y: number): number => {
    for (let i = 0; i + 1 < profile.length; i++) {
      const [r0, y0] = profile[i]!;
      const [r1, y1] = profile[i + 1]!;
      if (y <= y1 || i + 2 === profile.length) return r0 + (r1 - r0) * Math.min(1, Math.max(0, (y - y0) / (y1 - y0 || 1)));
    }
    return profile[0]![0];
  };
  return (t, th, out = 0) => {
    const y = from + (to - from) * t;
    const r = radius(y) + out;
    return [at[0] + Math.cos(th) * r, at[1] + y, at[2] + Math.sin(th) * r];
  };
}

/** Raised ribs over a surface: `n` meridians from bottom to top, each three tapering segments. */
function ribs(s: Shape, f: Surf, n: number, seed: number, thick: number, color = CHITIN): void {
  for (let i = 0; i < n; i++) {
    const th = ((i + hash3(seed, i, 31) * 0.5) / n) * Math.PI * 2;
    for (let j = 0; j < 3; j++) s.strut(f(j / 3, th), f((j + 1) / 3, th), thick * (1 - j * 0.22), color, { r2: thick * (1 - (j + 1) * 0.22), seg: 3, shadow: false });
  }
}

/** Thin veins wandering up a surface. */
function veins(s: Shape, f: Surf, n: number, seed: number, color = FLESH, thick = 0.012): void {
  for (let i = 0; i < n; i++) {
    let th = hash3(seed, i, 41) * Math.PI * 2;
    let prev = f(0, th, 0.004);
    for (let j = 1; j <= 3; j++) {
      th += (hash3(seed, i, 42 + j) - 0.5) * 0.5;
      const next = f(j / 3, th, 0.004);
      s.strut(prev, next, thick * (1 - (j - 1) * 0.2), color, { r2: thick * (1 - j * 0.2), seg: 3, shadow: false });
      prev = next;
    }
  }
}

/** Pores: a dark pit in a raised chitin rim. */
function pores(s: Shape, f: Surf, n: number, seed: number, size = 0.028): void {
  for (let i = 0; i < n; i++) {
    const t = hash3(seed, i, 51);
    const th = hash3(seed, i, 52) * Math.PI * 2;
    s.ball(size, CHITIN2, { at: f(t, th), seg: 5, shadow: false });
    s.ball(size * 0.6, PORE, { at: f(t, th, size * 0.75), seg: 5, shadow: false });
  }
}

/** Dim bioluminescent spots: tiny beads, lit like the hive's other glows (no brighter). */
function glints(s: Shape, f: Surf, n: number, seed: number, color = GREEN): void {
  for (let i = 0; i < n; i++) s.ball(0.016, color, { at: f(hash3(seed, i, 61), hash3(seed, i, 62) * Math.PI * 2), seg: 5, glow: true });
}

/** Root-like footings: tapering roots splaying out from an oval (radii rx, rz) round `at` and diving into the ground. */
function footings(s: Shape, at: V3, rx: number, rz: number, n: number, seed: number, len = 0.22, thick = 0.035, color = CHITIN): void {
  for (let i = 0; i < n; i++) {
    const a = ((i + hash3(seed, i, 71) * 0.6) / n) * Math.PI * 2;
    const l = len * (0.7 + hash3(seed, i, 72) * 0.6);
    s.cone(thick, l, color, { at: [at[0] + Math.cos(a) * (rx + l * 0.35), at[1] + 0.03, at[2] + Math.sin(a) * (rz + l * 0.35)], rot: [0, -a, -Math.PI / 2 - 0.2], seg: 4, shadow: false });
  }
}

/**
 * The top of an ellipsoid (radius r, stretched by `scale`) down to `cut` of its half turn, as a lathed cap of three
 * rows: the same shell as a cut ball for a fraction of its triangles (R3D-34 budget).
 */
function cap(s: Shape, r: number, paint: Paint, at: V3, scale: V3, cut: number, seg: number): void {
  const pts: [number, number][] = [];
  for (let i = 3; i >= 0; i--) pts.push([Math.sin((i / 3) * Math.PI * cut) * r, Math.cos((i / 3) * Math.PI * cut) * r]);
  s.lathe(pts, paint, { at, scale, seg });
}

/** A membrane: a thin sheet across the quad a-b-c-d, seen from both sides (four triangles). */
function membrane(s: Shape, a: V3, b: V3, c: V3, d: V3, color = MEMBRANE): void {
  const tri = [a, b, c, a, c, d, a, c, b, a, d, c].flatMap((p) => [...p]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
  geo.computeVertexNormals();
  s.add(geo, color, { shadow: false });
}

/**
 * A bone arch over the centre along a half ellipse of radius `r` and height `h`, turned by `a` about Y: a chain of round
 * bone segments rooted in the ground, with a knuckle at each joint and small spurs along its back (R3D-34).
 */
function boneArch(s: Shape, r: number, h: number, a: number, thick: number, seed: number): void {
  const n = 7;
  const at = (x: number, y: number): V3 => [x * Math.cos(a), y, -x * Math.sin(a)];
  const pts: V3[] = [at(r, -0.02)];
  for (let j = 0; j <= n; j++) pts.push(at(Math.cos((j / n) * Math.PI) * r, 0.1 + Math.sin((j / n) * Math.PI) * h));
  pts.push(at(-r, -0.02));
  const R = thick / 2;
  for (let j = 0; j + 1 < pts.length; j++) s.strut(pts[j]!, pts[j + 1]!, R, BONE, { seg: 6 });
  for (let j = 1; j + 1 < pts.length; j++) s.ball(R * 1.3, BONE, { at: pts[j]!, scale: [1, 0.9, 1], seg: 6, shadow: false });
  for (const j of [1, 2, 5, 6]) {
    const t = (j / n) * Math.PI;
    const up = 0.2 + hash3(seed, j, 81) * 0.3;
    s.cone(0.022, 0.1, BONE, { at: at(Math.cos(t) * (r + 0.02), 0.1 + Math.sin(t) * (h + R + 0.03)), rot: [0, a, t - Math.PI / 2 + up], seg: 4, shadow: false });
  }
}

/** Organic Vrax ground cover: a low fleshy mound with chitin rim. */
function mound(s: Shape, w: number, d: number): Shape {
  s.lathe([[0, 0], [0.5, 0.0], [0.48, 0.06], [0.36, 0.11], [0, 0.13]], BELLY, { scale: [w * 0.98, 1, d * 0.98], seg: 18 });
  s.lathe([[0.47, 0], [0.5, 0.02], [0.47, 0.07], [0.42, 0.06]], CHITIN, { scale: [w * 0.98, 1, d * 0.98], seg: 18 });
  return hiveBase(s, w, d, w * 7 + d);
}

/**
 * Armour scutes and ridges over a Vrax dome (an ellipsoid centred at c with radii r): two bands of overlapping plates
 * following its curve, a ridge of bone nubs along the top and a few pustules between the plates (R3D-3).
 */
function scutes(s: Shape, c: readonly [number, number, number], r: readonly [number, number, number], seed: number, bands: readonly [number, number] = [9, 6]): Shape {
  const pt = (phi: number, th: number, k = 1): [number, number, number] => [c[0] + r[0] * k * Math.cos(phi) * Math.cos(th), c[1] + r[1] * k * Math.sin(phi), c[2] + r[2] * k * Math.cos(phi) * Math.sin(th)];
  const size = Math.min(r[0], r[1], r[2]);
  // The plates are flat, so five sides read as well as seven (R3D-34 frees those triangles for fine detail).
  for (const [phi, n] of [[0.3, bands[0]], [0.8, bands[1]]] as const) {
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2 + hash3(seed, i, phi * 10) * 0.3 + phi;
      s.ball(size * 0.3, i % 2 ? CHITIN : 'teamDark', { at: pt(phi, th, 1.0), scale: [1.25, 0.32, 0.9], rot: [0, -th, phi + 0.25], seg: 5, shadow: false });
    }
  }
  for (let i = 0; i < 5; i++) s.cone(size * 0.07, size * 0.22, BONE, { at: pt(1.15 + i * 0.07, hash3(seed, i, 12) * 0.4, 1.0), seg: 4 });
  for (let i = 0; i < 4; i++) s.ball(size * 0.08, SAC, { at: pt(0.55, (i / 4) * Math.PI * 2 + 0.5, 1.02), seg: 5, shadow: false });
  return s;
}

/**
 * The living skin around a Vrax building's base (R3D-3): overlapping chitin plates with bone spines, root tendrils
 * creeping out over the ground, dark veins climbing the walls and clusters of pustules, a few faintly glowing. Placed
 * from a seed, so each building kind is the same every time.
 */
function hiveBase(s: Shape, w: number, d: number, seed: number): Shape {
  const rx = w * 0.46;
  const rz = d * 0.46;
  const at = (a: number, k: number, y: number): [number, number, number] => [Math.cos(a) * rx * k, y, Math.sin(a) * rz * k];
  // Overlapping chitin plates around the skirt, every other one crested with a bone spine.
  const plates = 10 + Math.round((w + d) * 2);
  for (let i = 0; i < plates; i++) {
    const a = (i / plates) * Math.PI * 2 + hash3(seed, i, 1) * 0.2;
    const size = 0.16 + hash3(seed, i, 2) * 0.08;
    s.ball(size, i % 3 ? CHITIN2 : 'teamDark', { at: at(a, 0.93, 0.1), scale: [1.3, 0.38, 0.85], rot: [0, -a, 0.35], seg: 6 });
    if (i % 2 === 0) s.cone(0.03, 0.14 + hash3(seed, i, 3) * 0.1, BONE, { at: at(a, 0.9, 0.2), rot: [0, -a, -0.5], seg: 4 });
  }
  // Root tendrils creeping out over the ground.
  const roots = 6 + Math.round(w + d);
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * Math.PI * 2 + hash3(seed, i, 4) * 0.5;
    const len = 0.35 + hash3(seed, i, 5) * 0.35;
    s.cone(0.06, len, i % 2 ? CHITIN : BELLY, { at: at(a, 1.0 + len * 0.2, 0.03), rot: [0, -a, -Math.PI / 2 + 0.08], seg: 5 });
  }
  // Dark veins climbing from the skirt.
  for (let i = 0; i < 6 + w + d; i++) {
    const a = hash3(seed, i, 6) * Math.PI * 2;
    s.tube(0.018, 0.32 + hash3(seed, i, 7) * 0.25, FLESH, { at: at(a, 0.78, 0.2), rot: [0, -a + Math.PI, 0.9 + hash3(seed, i, 8) * 0.4], seg: 5 });
  }
  // Clusters of pustules; only a few glow, and softly.
  for (let i = 0; i < 4 + w + d; i++) {
    const a = hash3(seed, i, 9) * Math.PI * 2;
    const p = at(a, 0.82 + hash3(seed, i, 10) * 0.1, 0.12);
    s.ball(0.05, i % 4 === 0 ? ACID : SAC, { at: p, seg: 5, glow: i % 4 === 0 });
    s.ball(0.035, SAC, { at: [p[0] + 0.06, p[1] - 0.02, p[2] + 0.04], seg: 5 });
  }
  return s;
}

// ---------------------------------------------------------------- Aegis

function humHq(): RigDef {
  return def(3, 3, 2.3, {
    body: () => {
      const s = plinth(shape(), 3, 3);
      const oct = (r: number): [number, number][] => [[r, -r * 0.55], [r, r * 0.55], [r * 0.55, r], [-r * 0.55, r], [-r, r * 0.55], [-r, -r * 0.55], [-r * 0.55, -r], [r * 0.55, -r]];
      s.hull(oct(1.15), 0.62, STEEL, { at: [0, 0.1, 0], bevel: 0.04 });
      s.hull(oct(1.18), 0.08, 'team', { at: [0, 0.6, 0], bevel: 0.02 });
      s.hull(oct(0.85), 0.36, STEEL2, { at: [0.0, 0.68, 0.0], bevel: 0.04 });
      // The bevelled walls stand 0.04 out from the outline: windows and the door sit on them, not inside.
      windows(s, -0.6, 0.6, 0.42, 1.195, 6);
      windowsX(s, -0.6, -0.3, 0.42, 1.195, 2);
      windowsX(s, 0.3, 0.6, 0.42, 1.195, 2);
      windows(s, -0.4, 0.4, 0.86, 0.895, 4, AMBER);
      windowsX(s, -0.4, 0.4, 0.86, 0.895, 4, AMBER);
      // Main entrance with a lit frame, on the +X face, and a striped apron in front of it.
      s.box(0.04, 0.3, 0.5, DARK, { at: [1.19, 0.27, 0], bevel: 0, shadow: false });
      s.box(0.05, 0.03, 0.56, AMBER, { at: [1.2, 0.44, 0], glow: true, bevel: 0, shadow: false });
      s.box(0.24, 0.012, 0.5, DARK, { at: [1.32, 0.106, 0], bevel: 0, shadow: false });
      for (const x of [1.24, 1.32, 1.4]) s.box(0.035, 0.014, 0.5, HAZARD, { at: [x, 0.108, 0], bevel: 0, shadow: false });
      for (const z of [0.31, -0.31]) lamp(s, [1.2, 0.36, z], CYAN, 0.02);
      // Panel seams, armour plates with louvres on the corner faces, roof vents and a rail on the lower roof.
      seams(s, 'x', 1.193, -0.6, -0.3, 0.14, 0.39, 2, 101);
      seams(s, 'x', 1.193, 0.3, 0.6, 0.14, 0.39, 2, 102);
      seams(s, 'z', 1.193, -0.6, 0.6, 0.14, 0.39, 3, 103);
      seams(s, 'x', 1.193, -0.6, 0.6, 0.46, 0.58, 2, 104);
      seams(s, 'z', 1.193, -0.6, 0.6, 0.46, 0.58, 2, 105);
      seams(s, 'x', 0.893, -0.45, 0.45, 0.72, 0.83, 2, 106, GUN);
      seams(s, 'z', 0.893, -0.45, 0.45, 0.72, 0.83, 2, 107, GUN);
      for (const a of [Math.PI / 4, -Math.PI / 4, (3 * Math.PI) / 4]) {
        const [cx, cz] = [Math.cos(a), Math.sin(a)];
        s.box(0.03, 0.34, 0.46, STEEL2, { at: [cx * 1.315, 0.36, cz * 1.315], rot: [0, -a, 0], bevel: 0, shadow: false });
        for (const y of [0.3, 0.36, 0.42]) s.box(0.012, 0.022, 0.32, GUN, { at: [cx * 1.335, y, cz * 1.335], rot: [0, -a, 0], bevel: 0, shadow: false });
      }
      roofVent(s, [1.04, 0.72, -0.32], 0.14, 0.2);
      roofVent(s, [-0.3, 0.72, 1.04], 0.2, 0.14);
      railing(s, [1.12, 0.72, -0.1], [1.12, 0.72, 0.55], 4);
      railing(s, [0.1, 0.72, 1.12], [0.55, 0.72, 1.12], 3);
      grille(s, 'x', 0.895, -0.22, 0.76, 0.2, 0.07);
      grille(s, 'z', 0.895, 0.22, 0.76, 0.2, 0.07);
      // Upper roof: a rail along the front edges, a sensor dome and a second whip antenna.
      railing(s, [0.82, 1.04, -0.5], [0.82, 1.04, 0.02], 4);
      railing(s, [-0.5, 1.04, 0.82], [0.02, 1.04, 0.82], 4);
      s.box(0.14, 0.06, 0.12, GUN, { at: [0.15, 1.07, -0.66], bevel: 0, shadow: false });
      s.ball(0.06, STEEL, { at: [0.15, 1.1, -0.66], cut: 0.5, seg: 8, shadow: false });
      s.cyl(0.006, 0.4, DARK, { at: [0.62, 1.24, -0.42], seg: 4, shadow: false });
      // A ladder up the command tower, and two weld bands round it.
      ladder(s, [-0.205, 1.05, -0.205], [-0.205, 1.88, -0.205], [0.707, -0.707], 8);
      for (const y of [1.2, 1.42]) s.cyl(0.324, 0.014, STEEL2, { at: [-0.45, y, -0.45], seg: 16, shadow: false });
      // Command tower, back left.
      s.cyl(0.32, 0.9, STEEL, { at: [-0.45, 1.45, -0.45], seg: 16 });
      s.cyl(0.335, 0.12, GLASS, { at: [-0.45, 1.62, -0.45], seg: 16 });
      s.cyl(0.338, 0.03, CYAN, { at: [-0.45, 1.62, -0.45], seg: 16, glow: true });
      s.cyl(0.36, 0.06, 'team', { at: [-0.45, 1.93, -0.45], seg: 16 });
      s.cone(0.3, 0.14, STEEL2, { at: [-0.45, 2.03, -0.45], seg: 16 });
      // Helipad, front right on the upper deck.
      s.cyl(0.36, 0.03, DARK, { at: [0.45, 1.06, 0.45], seg: 20 });
      s.ring(0.33, 0.012, AMBER, { at: [0.45, 1.08, 0.45], seg: 24, glow: true });
      s.box(0.04, 0.012, 0.22, HAZARD, { at: [0.38, 1.08, 0.45], bevel: 0 });
      s.box(0.04, 0.012, 0.22, HAZARD, { at: [0.52, 1.08, 0.45], bevel: 0 });
      s.box(0.14, 0.012, 0.04, HAZARD, { at: [0.45, 1.08, 0.45], bevel: 0 });
      // Antenna mast and vents.
      s.cyl(0.012, 0.7, DARK, { at: [0.5, 1.4, -0.55], seg: 5 });
      s.ball(0.025, RED, { at: [0.5, 1.76, -0.55], seg: 6, glow: true });
      for (let i = 0; i < 3; i++) s.box(0.14, 0.08, 0.1, GUN, { at: [-0.85, 0.78, 0.4 - i * 0.2] });
      return s;
    },
    radar: () => {
      const s = shape();
      s.cyl(0.03, 0.16, DARK, { at: [0, 0.08, 0], seg: 6 });
      dish(s, [0, 0.19, 0], 0.24, 1.0);
      return s;
    },
  }, [{ geo: 'radar', at: [-0.45, 2.1, -0.45], anim: { k: 'spin', axis: 'y', rate: 1.1 } }]);
}

function humReactor(): RigDef {
  return def(2, 2, 1.5, {
    body: () => {
      const s = plinth(shape(), 2, 2);
      // Two cooling towers at the back.
      for (const [x, z] of [[-0.45, -0.45], [-0.45, 0.35]] as const) {
        s.lathe([[0.36, 0], [0.3, 0.4], [0.26, 0.72], [0.29, 1.0], [0.27, 1.02]], CONCRETE, { at: [x, 0.1, z], seg: 16 });
        s.lathe([[0.37, 0], [0.37, 0.1], [0.355, 0.12]], 'team', { at: [x, 0.1, z], seg: 16 });
        s.cyl(0.24, 0.02, DARK, { at: [x, 1.1, z], seg: 14 });
      }
      // Reactor dome with a glowing core ring.
      s.cyl(0.42, 0.18, STEEL2, { at: [0.38, 0.19, 0.1], seg: 18 });
      s.ball(0.4, STEEL, { at: [0.38, 0.28, 0.1], cut: 0.5, seg: 18 });
      s.ring(0.41, 0.025, CYAN, { at: [0.38, 0.29, 0.1], seg: 24, glow: true });
      s.cyl(0.08, 0.06, CYAN, { at: [0.38, 0.69, 0.1], seg: 10, glow: true });
      s.ring(0.12, 0.02, 'team', { at: [0.38, 0.67, 0.1], seg: 14 });
      // Coolant pipes.
      s.tube(0.04, 0.6, GUN, { at: [0.0, 0.25, -0.45] });
      s.tube(0.04, 0.6, GUN, { at: [0.0, 0.25, 0.35] });
      s.box(0.2, 0.18, 0.22, STEEL2, { at: [0.5, 0.19, -0.6] });
      s.box(0.012, 0.05, 0.14, AMBER, { at: [0.605, 0.22, -0.6], glow: true, bevel: 0 });
      // Fine detail (R3D-34). Maintenance ladders up the towers (outside their waist) and a weathered band under each lip.
      ladder(s, [-0.065, 0.2, -0.45], [-0.15, 1.08, -0.45], [0, 1], 9);
      ladder(s, [-0.45, 0.2, 0.735], [-0.45, 1.08, 0.65], [1, 0], 9);
      for (const [x, z] of [[-0.45, -0.45], [-0.45, 0.35]] as const) s.lathe([[0.283, 0.86], [0.297, 0.98]], CONCRETE2, { at: [x, 0.1, z], seg: 16, shadow: false });
      // Containment ribs over the dome, an access hatch in its drum and a warning plate.
      const cap = dome([0.38, 0.28, 0.1], [0.408, 0.408, 0.408], 0.05, 1.31);
      for (let i = 0; i < 6; i++) {
        const th = (i / 6) * Math.PI * 2 + 0.3;
        for (let j = 0; j < 3; j++) s.strut(cap(j / 3, th), cap((j + 1) / 3, th), 0.012, GUN, { seg: 4, shadow: false });
      }
      s.box(0.02, 0.12, 0.12, DARK, { at: [0.682, 0.18, 0.402], rot: [0, -Math.PI / 4, 0], bevel: 0, shadow: false });
      s.box(0.022, 0.016, 0.14, HAZARD, { at: [0.684, 0.25, 0.404], rot: [0, -Math.PI / 4, 0], bevel: 0, shadow: false });
      // Coolant pipes: flanges, a valve wheel and stands.
      for (const x of [-0.03, 0.22]) s.tube(0.052, 0.025, STEEL2, { at: [x, 0.25, -0.45], seg: 8, shadow: false });
      s.tube(0.052, 0.025, STEEL2, { at: [-0.05, 0.25, 0.35], seg: 8, shadow: false });
      s.box(0.04, 0.11, 0.07, GUN, { at: [0.1, 0.155, -0.45], bevel: 0, shadow: false });
      s.cyl(0.008, 0.06, GUN, { at: [0.1, 0.31, -0.45], seg: 4, shadow: false });
      s.ring(0.035, 0.007, RED, { at: [0.1, 0.34, -0.45], seg: 8, shadow: false });
      // The control box: a louvred side, an aerial.
      grille(s, 'z', -0.487, 0.5, 0.17, 0.14, 0.08);
      s.cyl(0.005, 0.22, DARK, { at: [0.44, 0.39, -0.67], seg: 4, shadow: false });
      // A step-down transformer in the front corner: ceramic insulators, cooling fins, a cable to the reactor drum.
      s.box(0.26, 0.16, 0.2, STEEL2, { at: [0.68, 0.18, 0.72], bevel: 0.15 });
      for (let i = 0; i < 3; i++) {
        s.cyl(0.022, 0.08, CERAMIC, { at: [0.6 + i * 0.08, 0.3, 0.7], seg: 6, shadow: false });
        s.cyl(0.03, 0.012, CERAMIC, { at: [0.6 + i * 0.08, 0.29, 0.7], seg: 6, shadow: false });
      }
      for (const x of [0.58, 0.65, 0.73, 0.78]) s.box(0.012, 0.11, 0.025, GUN, { at: [x, 0.18, 0.832], bevel: 0, shadow: false });
      s.box(0.006, 0.05, 0.08, HAZARD, { at: [0.812, 0.2, 0.72], bevel: 0, shadow: false });
      pipe(s, [[0.6, 0.34, 0.7], [0.6, 0.4, 0.62], [0.55, 0.2, 0.45]], 0.012);
      return s;
    },
  }, [], { vents: [[-0.45, 1.15, -0.45], [-0.45, 1.15, 0.35]] });
}

function humRefinery(): RigDef {
  return def(3, 2, 1.4, {
    body: () => {
      const s = plinth(shape(), 3, 2);
      // Processing hall at the back.
      s.slab([[-1.35, 0.1], [0.1, 0.1], [0.1, 0.62], [-0.3, 0.8], [-1.35, 0.8]], 0.95, STEEL, { at: [0, 0, -0.45], bevel: 0.03 });
      s.box(1.46, 0.06, 0.97, 'team', { at: [-0.62, 0.56, -0.45], bevel: 0.3 });
      windows(s, -1.2, 0.0, 0.35, 0.03, 5, AMBER);
      // Silos with team bands.
      for (const x of [-1.05, -0.6]) {
        s.cyl(0.2, 0.9, STEEL2, { at: [x, 0.55, 0.45], seg: 14 });
        s.ball(0.2, STEEL2, { at: [x, 1.0, 0.45], cut: 0.5, seg: 14 });
        s.cyl(0.205, 0.08, 'team', { at: [x, 0.8, 0.45], seg: 14 });
      }
      // Shard processing tank with glowing crystal slurry.
      s.cyl(0.24, 0.42, GLASS, { at: [0.35, 0.33, -0.45], seg: 14 });
      s.cyl(0.2, 0.3, 0x47e8c4, { at: [0.35, 0.3, -0.45], seg: 14, glow: true });
      s.ring(0.245, 0.02, STEEL, { at: [0.35, 0.55, -0.45], seg: 16 });
      // Shard bins in the front corner (haulers unload at the separate dock beside the building, R3D-22).
      for (const [x, z] of [[0.75, 0.35], [1.1, 0.35], [0.92, 0.7]] as const) {
        s.box(0.28, 0.2, 0.26, STEEL2, { at: [x, 0.2, z], bevel: 0.15 });
        s.box(0.24, 0.02, 0.22, 0x47e8c4, { at: [x, 0.31, z], glow: true, bevel: 0 });
      }
      s.slab([[0.2, 0.1], [0.4, 0.1], [0.4, 0.5], [0.3, 0.55]], 0.4, STEEL2, { at: [0, 0, 0.0], bevel: 0.02 });
      s.tube(0.035, 0.7, GUN, { at: [0.1, 0.5, -0.1], rot: [0, 0, 0.3] }); // conveyor
      // Chimney.
      s.cyl(0.08, 0.7, CONCRETE2, { at: [-1.2, 1.0, -0.75], seg: 10 });
      s.cyl(0.09, 0.05, RED, { at: [-1.2, 1.32, -0.75], seg: 10, glow: true });
      // Fine detail (R3D-34). The hall: seams, a side door with a striped step, roof vents, a skylight and a roof rail.
      seams(s, 'z', 0.028, -1.3, 0.1, 0.13, 0.3, 4, 201);
      seams(s, 'z', 0.028, -1.3, 0.1, 0.4, 0.52, 2, 202);
      s.box(0.12, 0.2, 0.012, DARK, { at: [0.03, 0.2, 0.031], bevel: 0, shadow: false });
      s.box(0.16, 0.012, 0.06, HAZARD, { at: [0.03, 0.106, 0.06], bevel: 0, shadow: false });
      lamp(s, [0.03, 0.32, 0.035], CYAN, 0.018);
      lamp(s, [0.135, 0.45, -0.85], CYAN, 0.018);
      roofVent(s, [-0.75, 0.83, -0.3], 0.2, 0.14);
      roofVent(s, [-1.0, 0.83, -0.62], 0.14, 0.2);
      s.box(0.4, 0.012, 0.08, GLASS, { at: [-0.55, 0.836, -0.7], bevel: 0, shadow: false });
      railing(s, [-1.3, 0.83, -0.02], [-0.4, 0.83, -0.02], 5);
      // Silos: weld bands, a ladder, and feed pipes down into the hall roof.
      for (const x of [-1.05, -0.6]) {
        for (const y of [0.38, 0.62]) s.cyl(0.204, 0.012, STEEL, { at: [x, y, 0.45], seg: 14, shadow: false });
        pipe(s, [[x, 0.95, 0.3], [x, 0.95, -0.1], [x, 0.82, -0.1]], 0.022);
      }
      ladder(s, [-0.385, 0.12, 0.45], [-0.385, 0.98, 0.45], [0, 1], 9);
      // The slurry tank: steel straps and a pipe to the hall; striped rims on the bins; the chimney's bands and ladder.
      for (const th of [0.35, 1.2, -0.5]) s.box(0.014, 0.42, 0.03, STEEL2, { at: [0.35 + Math.cos(th) * 0.245, 0.33, -0.45 + Math.sin(th) * 0.245], rot: [0, -th, 0], bevel: 0, shadow: false });
      pipe(s, [[0.3, 0.52, -0.45], [0.3, 0.68, -0.45], [0.05, 0.68, -0.45]], 0.022);
      for (const [x, z] of [[0.75, 0.35], [1.1, 0.35], [0.92, 0.7]] as const) s.box(0.006, 0.025, 0.2, HAZARD, { at: [x + 0.143, 0.17, z], bevel: 0, shadow: false });
      for (const y of [0.85, 1.12]) s.cyl(0.087, 0.014, STEEL2, { at: [-1.2, y, -0.75], seg: 10, shadow: false });
      ladder(s, [-1.105, 0.84, -0.75], [-1.105, 1.28, -0.75], [0, 1], 5, 0.06);
      return s;
    },
  }, [], { vents: [[-1.2, 1.4, -0.75]] });
}

function humBarracks(): RigDef {
  return def(2, 2, 1.1, {
    body: () => {
      const s = plinth(shape(), 2, 2);
      s.slab([[-0.8, 0.1], [0.75, 0.1], [0.75, 0.45], [0.35, 0.68], [-0.8, 0.68]], 1.5, STEEL, { bevel: 0.04 });
      s.slab([[0.33, 0.66], [0.77, 0.43], [0.8, 0.47], [0.36, 0.72]], 1.54, 'team', { bevel: 0.01 });
      // The bevelled front wall stands at x 0.79: windows and door sit on it, the windows clear of the door.
      windowsX(s, -0.55, -0.22, 0.36, 0.795, 2, AMBER);
      windowsX(s, 0.22, 0.55, 0.36, 0.795, 2, AMBER);
      s.box(0.04, 0.26, 0.34, DARK, { at: [0.785, 0.24, 0.0], bevel: 0 }); // door
      s.box(0.05, 0.025, 0.38, AMBER, { at: [0.795, 0.38, 0.0], glow: true, bevel: 0 });
      windows(s, -0.6, 0.2, 0.42, 0.76, 3);
      // Fine detail (R3D-34): seams, a porch roof over the door, a side door with a step and a lamp, a ladder to the roof.
      seams(s, 'z', 0.753, -0.8, 0.3, 0.14, 0.36, 3, 301);
      seams(s, 'z', 0.753, -0.8, 0.3, 0.47, 0.64, 2, 302);
      seams(s, 'x', 0.793, -0.7, -0.24, 0.14, 0.32, 2, 303);
      seams(s, 'x', 0.793, 0.24, 0.7, 0.14, 0.32, 2, 304);
      s.box(0.12, 0.02, 0.44, STEEL2, { at: [0.85, 0.435, 0], bevel: 0, shadow: false });
      for (const z of [0.2, -0.2]) s.strut([0.9, 0.425, z], [0.795, 0.34, z], 0.008, GUN, { seg: 3, shadow: false });
      s.box(0.16, 0.22, 0.012, DARK, { at: [0.5, 0.21, 0.756], bevel: 0, shadow: false });
      s.box(0.2, 0.025, 0.07, CONCRETE2, { at: [0.5, 0.112, 0.79], bevel: 0, shadow: false });
      lamp(s, [0.5, 0.36, 0.76], AMBER, 0.02);
      ladder(s, [-0.33, 0.1, 0.77], [-0.33, 0.8, 0.77], [1, 0], 8);
      // On the roof: an air unit with its fan, a hatch, a small dish, a rail; standing seams down the sloped roof.
      s.box(0.2, 0.09, 0.16, STEEL2, { at: [0.0, 0.765, -0.45], bevel: 0, shadow: false });
      s.cyl(0.055, 0.01, DARK, { at: [0.0, 0.814, -0.45], seg: 8, shadow: false });
      s.box(0.12, 0.02, 0.12, GUN, { at: [-0.1, 0.73, 0.4], bevel: 0, shadow: false });
      s.box(0.13, 0.006, 0.018, HAZARD, { at: [-0.1, 0.742, 0.47], bevel: 0, shadow: false });
      s.cyl(0.012, 0.1, DARK, { at: [-0.55, 0.77, -0.15], seg: 5, shadow: false });
      dish(s, [-0.55, 0.83, -0.15], 0.09, 0.7, false);
      railing(s, [-0.62, 0.72, 0.7], [-0.42, 0.72, 0.7], 2);
      railing(s, [-0.24, 0.72, 0.7], [0.3, 0.72, 0.7], 4);
      for (const z of [-0.52, -0.05, 0.38]) s.box(0.48, 0.008, 0.02, GUN, { at: [0.58, 0.611, z], rot: [0, 0, -0.517], bevel: 0, shadow: false });
      // Supply crates by the side door.
      s.box(0.12, 0.12, 0.12, CRATE, { at: [0.66, 0.16, 0.88], bevel: 0 });
      s.box(0.006, 0.03, 0.1, HAZARD, { at: [0.723, 0.17, 0.88], bevel: 0, shadow: false });
      s.box(0.1, 0.09, 0.1, CRATE, { at: [0.81, 0.145, 0.86], rot: [0, 0.3, 0], bevel: 0 });
      // Sandbag walls by the door.
      for (const z of [0.42, -0.42]) for (let i = 0; i < 4; i++) s.ball(0.06, SAND, { at: [0.88, 0.14 + (i % 2) * 0.06, z + (i - 1.5) * 0.08], scale: [0.9, 0.55, 1.2], seg: 6 });
      // Flag pole with a team flag; antenna; roof vents.
      s.cyl(0.012, 0.8, DARK, { at: [-0.7, 1.05, 0.7], seg: 5 });
      s.box(0.26, 0.15, 0.012, 'team', { at: [-0.56, 1.36, 0.7], bevel: 0 });
      s.cyl(0.008, 0.5, DARK, { at: [-0.6, 0.93, -0.6], seg: 4 });
      s.ball(0.02, RED, { at: [-0.6, 1.19, -0.6], seg: 6, glow: true });
      for (let i = 0; i < 2; i++) s.box(0.18, 0.08, 0.16, GUN, { at: [-0.4, 0.72, -0.35 + i * 0.4] });
      return s;
    },
  }, []);
}

/** Where the Motor Pool's two roof fans stand along the hangar: midway between its team-coloured ribs, so nothing cuts into a rib. */
const FAN_X = [-0.62, 0.22] as const;

function humFactory(): RigDef {
  return def(3, 3, 1.7, {
    body: () => {
      const s = plinth(shape(), 3, 3);
      // Arched assembly hangar along X; its big bay door faces +X.
      s.box(2.3, 0.4, 1.5, STEEL2, { at: [-0.2, 0.3, -0.3], bevel: 0.05 });
      s.arch(0.75, 2.3, STEEL, { at: [-0.2, 0.5, -0.3], seg: 16 });
      for (let i = 0; i < 6; i++) s.arch(0.77, 0.05, 'team', { at: [-1.25 + i * 0.42, 0.5, -0.3], seg: 16 });
      s.box(0.05, 0.62, 1.1, DARK, { at: [0.96, 0.52, -0.3], bevel: 0 }); // bay door
      for (let i = 0; i < 5; i++) s.box(0.055, 0.04, 1.1, i % 2 ? DARK : HAZARD, { at: [0.965, 0.25 + i * 0.12, -0.3], bevel: 0 });
      s.box(0.06, 0.04, 1.2, AMBER, { at: [0.97, 0.87, -0.3], glow: true, bevel: 0 });
      // Side workshop and roller apron.
      s.box(1.2, 0.5, 0.6, STEEL, { at: [-0.5, 0.35, 0.95], bevel: 0.05 });
      s.box(1.22, 0.06, 0.62, 'team', { at: [-0.5, 0.62, 0.95], bevel: 0.3 });
      windows(s, -1.0, 0.0, 0.42, 1.255, 4, AMBER);
      s.box(0.9, 0.02, 1.2, DARK, { at: [1.0, 0.11, -0.3], bevel: 0 }); // apron
      // Gantry crane.
      for (const z of [0.55, 0.05]) s.box(0.06, 0.9, 0.06, HAZARD, { at: [0.55, 0.55, z], bevel: 0.1 });
      s.box(0.08, 0.06, 0.6, HAZARD, { at: [0.55, 1.0, 0.3], bevel: 0.1 });
      s.box(0.12, 0.1, 0.12, GUN, { at: [0.55, 0.92, 0.35] });
      // Exhaust stacks.
      for (const z of [-0.9, -1.15]) {
        s.cyl(0.07, 0.6, CONCRETE2, { at: [-1.2, 1.1, z], seg: 10 });
        s.cyl(0.075, 0.04, RED, { at: [-1.2, 1.38, z], seg: 10, glow: true });
        for (const y of [0.95, 1.2]) s.cyl(0.074, 0.012, STEEL2, { at: [-1.2, y, z], seg: 10, shadow: false }); // weld bands (R3D-34)
      }
      // Fine detail (R3D-34). The bay door's frame posts and striped apron edges.
      for (const z of [-0.88, 0.28]) {
        s.box(0.07, 0.7, 0.06, STEEL2, { at: [0.975, 0.45, z], bevel: 0, shadow: false });
        s.box(0.88, 0.006, 0.03, HAZARD, { at: [1.0, 0.123, z], bevel: 0, shadow: false });
      }
      // Skylights along the hangar roof between the ribs, and a pedestal under each roof fan.
      for (const x of [-1.04, -0.2, 0.64]) s.box(0.3, 0.008, 0.2, GLASS, { at: [x, 1.052, 0.215], rot: [0.75, 0, 0], bevel: 0, shadow: false });
      for (const x of FAN_X) s.cyl(0.07, 0.1, GUN, { at: [x, 1.215, -0.3], seg: 8, shadow: false });
      // The hall's side wall beside the workshop: seams and a louvre.
      seams(s, 'z', 0.452, 0.15, 0.9, 0.14, 0.46, 3, 401);
      grille(s, 'z', 0.452, 0.3, 0.3, 0.24, 0.1);
      // The workshop: a door with a lamp and a striped sill, seams, roof vents and a pipe up into the hangar.
      s.box(0.012, 0.24, 0.2, DARK, { at: [0.106, 0.22, 0.95], bevel: 0, shadow: false });
      s.box(0.06, 0.012, 0.22, HAZARD, { at: [0.14, 0.106, 0.95], bevel: 0, shadow: false });
      lamp(s, [0.11, 0.37, 0.95], AMBER, 0.02);
      seams(s, 'z', 1.253, -1.05, 0.05, 0.14, 0.37, 3, 402);
      roofVent(s, [-0.85, 0.65, 0.95], 0.16, 0.2);
      roofVent(s, [-0.3, 0.65, 1.05], 0.2, 0.14);
      pipe(s, [[-0.6, 0.65, 0.8], [-0.6, 0.8, 0.8], [-0.6, 0.8, 0.35]], 0.025);
      // The gantry crane: a knee brace and a warning lamp.
      s.strut([0.55, 0.82, 0.55], [0.55, 0.97, 0.45], 0.012, HAZARD, { seg: 4, shadow: false });
      lamp(s, [0.55, 1.045, 0.57], AMBER, 0.02);
      return s;
    },
    fan: () => {
      const s = shape();
      for (let i = 0; i < 4; i++) s.box(0.24, 0.015, 0.05, GUN, { rot: [0.3, (i * Math.PI) / 2, 0], at: [Math.cos((i * Math.PI) / 2) * 0.1, 0, -Math.sin((i * Math.PI) / 2) * 0.1], bevel: 0 });
      s.cyl(0.03, 0.03, DARK, { seg: 8 });
      return s;
    },
  }, [
    { geo: 'fan', at: [FAN_X[0], 1.27, -0.3], anim: { k: 'spin', axis: 'y', rate: 5 } },
    { geo: 'fan', at: [FAN_X[1], 1.27, -0.3], anim: { k: 'spin', axis: 'y', rate: 4.2 } },
  ], { vents: [[-1.2, 1.45, -0.9], [-1.2, 1.45, -1.15]] });
}

function humTurret(): RigDef {
  return def(1, 1, 0.75, {
    body: () => {
      const s = shape();
      s.cyl(0.44, 0.14, CONCRETE, { at: [0, 0.07, 0], seg: 8 });
      s.cyl(0.36, 0.14, STEEL2, { at: [0, 0.21, 0], r2: 0.4, seg: 8 });
      s.ring(0.37, 0.02, 'team', { at: [0, 0.28, 0], seg: 16 });
      for (let i = 0; i < 4; i++) s.box(0.06, 0.02, 0.06, HAZARD, { at: [Math.cos((i * Math.PI) / 2 + 0.4) * 0.4, 0.145, Math.sin((i * Math.PI) / 2 + 0.4) * 0.4], bevel: 0 });
      // Fine detail (R3D-34): anchor bolts round the collar and a junction box on the footing.
      for (let i = 0; i < 4; i++) s.box(0.03, 0.02, 0.03, GUN, { at: [Math.cos((i * Math.PI) / 2 + 1.2) * 0.42, 0.145, Math.sin((i * Math.PI) / 2 + 1.2) * 0.42], bevel: 0, shadow: false });
      s.box(0.03, 0.07, 0.09, STEEL2, { at: [0.388, 0.07, 0.161], rot: [0, -0.393, 0], bevel: 0, shadow: false });
      s.box(0.032, 0.012, 0.06, HAZARD, { at: [0.39, 0.09, 0.162], rot: [0, -0.393, 0], bevel: 0, shadow: false });
      return s;
    },
    turret: () => {
      const s = shape();
      s.hull([[0.18, -0.14], [0.22, 0], [0.18, 0.14], [-0.2, 0.18], [-0.24, 0], [-0.2, -0.18]], 0.2, STEEL, { bevel: 0.03 });
      s.box(0.26, 0.02, 0.2, 'team', { at: [-0.04, 0.205, 0], bevel: 0.3 });
      s.box(0.05, 0.05, 0.06, GUN, { at: [0.04, 0.23, -0.1] });
      s.box(0.012, 0.025, 0.04, CYAN, { at: [0.068, 0.235, -0.1], glow: true, bevel: 0 });
      s.cyl(0.07, 0.04, CYAN, { at: [-0.12, 0.21, 0], seg: 10, glow: true }); // capacitor
      // Fine detail (R3D-34): slanted side armour, a sighting optic, and a seam across the top.
      for (const side of [1, -1]) s.box(0.2, 0.1, 0.02, STEEL2, { at: [-0.02, 0.1, side * 0.205], rot: [0, side * 0.105, 0], bevel: 0, shadow: false });
      s.tube(0.022, 0.06, GUN, { at: [0.1, 0.225, 0.11], seg: 6, shadow: false });
      s.box(0.006, 0.004, 0.16, STEEL2, { at: [0.13, 0.201, 0], bevel: 0, shadow: false });
      return s;
    },
    barrel: () => {
      const s = shape();
      for (const z of [0.065, -0.065]) {
        s.tube(0.026, 0.4, GUN, { at: [0.2, 0, z], seg: 10 });
        for (let i = 0; i < 3; i++) s.ring(0.03, 0.008, CYAN, { at: [0.12 + i * 0.09, 0, z], rot: [0, 0, Math.PI / 2], seg: 10, glow: true });
      }
      s.box(0.1, 0.1, 0.2, STEEL2, { at: [0.02, 0, 0] });
      return s;
    },
  }, [
    {
      geo: 'turret',
      at: [0, 0.29, 0],
      anim: { k: 'turret' },
      kids: [{ geo: 'barrel', at: [0.18, 0.1, 0], anim: { k: 'barrel', recoil: 0.05 }, kids: [{ muzzle: true, at: [0.42, 0, 0.065] }, { muzzle: true, at: [0.42, 0, -0.065] }] }],
    },
  ], { weapon: 'pulse' });
}

function humLab(): RigDef {
  return def(2, 2, 1.4, {
    body: () => {
      const s = plinth(shape(), 2, 2);
      s.hull([[0.8, -0.8], [0.8, 0.5], [0.5, 0.8], [-0.8, 0.8], [-0.8, -0.8]], 0.4, STEEL, { at: [0, 0.1, 0], bevel: 0.04 });
      s.hull([[0.82, -0.82], [0.82, 0.51], [0.51, 0.82], [-0.82, 0.82], [-0.82, -0.82]], 0.05, 'team', { at: [0, 0.46, 0], bevel: 0.01 });
      // The bevelled walls stand at 0.84: the windows sit on them.
      windows(s, -0.6, 0.3, 0.3, 0.845, 4);
      windowsX(s, -0.6, 0.3, 0.3, 0.845, 4);
      // Research dome: glass over a glowing core.
      s.ball(0.38, CYAN, { at: [-0.15, 0.5, -0.15], scale: [0.6, 0.6, 0.6], seg: 12, glow: true });
      s.ball(0.42, GLASS, { at: [-0.15, 0.5, -0.15], cut: 0.5, seg: 18 });
      s.ring(0.42, 0.025, STEEL2, { at: [-0.15, 0.51, -0.15], seg: 24 });
      for (let i = 0; i < 4; i++) s.box(0.02, 0.4, 0.02, STEEL2, { at: [-0.15 + Math.cos(i * 1.57) * 0.3, 0.72, -0.15 + Math.sin(i * 1.57) * 0.3], rot: [Math.sin(i * 1.57) * -0.8, 0, Math.cos(i * 1.57) * 0.8], bevel: 0 });
      s.cyl(0.03, 0.3, DARK, { at: [0.55, 0.65, -0.55], seg: 6 }); // dish mast
      s.box(0.2, 0.12, 0.2, GUN, { at: [0.5, 0.56, 0.45] });
      // Fine detail (R3D-34). The entrance on the cut corner, with a lit lintel and a step; seams on the walls.
      s.box(0.02, 0.24, 0.22, DARK, { at: [0.69, 0.22, 0.69], rot: [0, -Math.PI / 4, 0], bevel: 0, shadow: false });
      s.box(0.025, 0.018, 0.26, CYAN, { at: [0.692, 0.355, 0.692], rot: [0, -Math.PI / 4, 0], glow: true, bevel: 0, shadow: false });
      s.box(0.1, 0.02, 0.3, CONCRETE2, { at: [0.75, 0.11, 0.75], rot: [0, -Math.PI / 4, 0], bevel: 0, shadow: false });
      seams(s, 'x', 0.843, -0.75, 0.45, 0.14, 0.27, 3, 501);
      seams(s, 'z', 0.843, -0.75, 0.45, 0.14, 0.27, 3, 502);
      seams(s, 'x', 0.843, -0.75, 0.45, 0.33, 0.44, 2, 503);
      seams(s, 'z', 0.843, -0.75, 0.45, 0.33, 0.44, 2, 504);
      // On the roof: gas bottles in a rack piped into the dome, a hatch, a vent, rails along the front edges.
      for (const [i, z] of [-0.25, -0.17, -0.09].entries()) {
        s.cyl(0.035, 0.2, STEEL, { at: [0.45, 0.61, z], seg: 6, shadow: false });
        s.cyl(0.036, 0.03, i === 1 ? HAZARD : STEEL2, { at: [0.45, 0.66, z], seg: 6, shadow: false });
      }
      s.box(0.03, 0.02, 0.24, GUN, { at: [0.41, 0.6, -0.17], bevel: 0, shadow: false });
      pipe(s, [[0.45, 0.72, -0.17], [0.45, 0.75, -0.13], [0.25, 0.6, -0.13]], 0.014);
      s.box(0.12, 0.02, 0.12, GUN, { at: [0.1, 0.52, 0.55], bevel: 0, shadow: false });
      s.box(0.13, 0.006, 0.018, HAZARD, { at: [0.1, 0.532, 0.62], bevel: 0, shadow: false });
      roofVent(s, [-0.55, 0.51, 0.5], 0.2, 0.14);
      railing(s, [0.78, 0.51, -0.75], [0.78, 0.51, 0.3], 5);
      railing(s, [-0.75, 0.51, 0.78], [0.3, 0.51, 0.78], 5);
      grille(s, 'x', 0.602, 0.45, 0.56, 0.14, 0.07);
      return s;
    },
    dish: () => {
      const s = shape();
      dish(s, [0, 0, 0], 0.19, 0.8);
      s.ball(0.015, RED, { at: [0.158 * Math.sin(0.8), 0.158 * Math.cos(0.8), 0], seg: 6, glow: true });
      return s;
    },
    halo: () => shape().ring(0.3, 0.012, CYAN, { seg: 24, glow: true }).ring(0.24, 0.008, CYAN, { at: [0, 0.06, 0], seg: 24, glow: true }),
  }, [
    { geo: 'dish', at: [0.55, 0.82, -0.55], anim: { k: 'spin', axis: 'y', rate: 0.6 } },
    { at: [-0.15, 1.0, -0.15], rot: [0.25, 0, 0.15], kids: [{ geo: 'halo', anim: { k: 'spin', axis: 'y', rate: 1.6 } }] },
  ]);
}

function humLance(): RigDef {
  return def(3, 3, 2.4, {
    body: () => {
      const s = plinth(shape(), 3, 3);
      s.cyl(1.1, 0.2, STEEL2, { at: [0, 0.2, 0], seg: 8 });
      s.cyl(1.12, 0.05, 'team', { at: [0, 0.32, 0], seg: 8 });
      // Four pylons braced against the emitter tower.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        s.box(0.14, 1.3, 0.14, STEEL, { at: [Math.cos(a) * 0.62, 0.9, Math.sin(a) * 0.62], rot: [Math.sin(a) * -0.32, 0, Math.cos(a) * 0.32], bevel: 0.2 });
        s.box(0.08, 0.04, 0.08, AMBER, { at: [Math.cos(a) * 0.85, 0.36, Math.sin(a) * 0.85], glow: true, bevel: 0 });
      }
      s.lathe([[0.42, 0], [0.34, 0.5], [0.22, 1.4], [0.16, 1.9], [0.2, 1.95], [0.0, 2.0]], STEEL, { at: [0, 0.3, 0], seg: 16 });
      for (let i = 0; i < 3; i++) s.ring(0.34 - i * 0.06, 0.035, CYAN, { at: [0, 0.75 + i * 0.45, 0], seg: 20, glow: true });
      s.cone(0.1, 0.3, CYAN, { at: [0, 2.42, 0], seg: 8, glow: true });
      // Fine detail (R3D-34). Steps up the deck's front face and rails along its edges.
      const face = (th: number): [number, number] => [Math.sin(th), Math.cos(th)];
      const [fx, fz] = face((3 * Math.PI) / 8);
      for (let k = 0; k < 3; k++) s.box(0.08, 0.18 - k * 0.06, 0.34, CONCRETE2, { at: [(1.07 + k * 0.08) * fx, 0.1 + (0.18 - k * 0.06) / 2, (1.07 + k * 0.08) * fz], rot: [0, -Math.atan2(fz, fx), 0], bevel: 0, shadow: false });
      for (const k of [0, 2, -1]) {
        const [ax, az] = face((k * Math.PI) / 4);
        const [bx, bz] = face(((k + 1) * Math.PI) / 4);
        railing(s, [ax * 1.05, 0.345, az * 1.05], [bx * 1.05, 0.345, bz * 1.05], 4);
      }
      // Capacitor banks wired to the emitter, between the front pylons.
      for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
        for (const o of [-0.1, 0, 0.1]) {
          const at: V3 = [dx * 0.72 + dz * o, 0.425, dz * 0.72 + dx * o];
          s.cyl(0.05, 0.16, STEEL2, { at, seg: 8, shadow: false });
          s.cyl(0.052, 0.015, GUN, { at: [at[0], 0.5, at[2]], seg: 8, shadow: false });
        }
        s.strut([dx * 0.62, 0.4, dz * 0.62], [dx * 0.4, 0.36, dz * 0.4], 0.014, GUN, { seg: 4, shadow: false });
      }
      // Pylons: clamp bands and a red warning light at each top.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const rot: V3 = [Math.sin(a) * -0.32, 0, Math.cos(a) * 0.32];
        const c: V3 = [Math.cos(a) * 0.62, 0.9, Math.sin(a) * 0.62];
        const ax = axisOf(rot);
        for (const k of [-0.3, 0.25]) s.box(0.17, 0.035, 0.17, STEEL2, { at: along(c, ax, k), rot, bevel: 0, shadow: false });
        lamp(s, along(c, ax, 0.67), RED, 0.025);
      }
      // Conduits up the emitter tower, and an access hatch at its foot.
      for (const phi of [Math.PI / 4 - 0.3, Math.PI / 4 + 0.3]) {
        const pts = ([[0.438, 0.32], [0.358, 0.8], [0.238, 1.7], [0.184, 2.15]] as const).map(([r, y]): V3 => [Math.cos(phi) * r, y, Math.sin(phi) * r]);
        for (let j = 0; j < 3; j++) s.strut(pts[j]!, pts[j + 1]!, 0.013, GUN, { seg: 4, shadow: false });
      }
      s.box(0.02, 0.16, 0.12, DARK, { at: [0.293, 0.42, 0.293], rot: [0, -Math.PI / 4, 0], bevel: 0, shadow: false });
      return s;
    },
    coil: () => shape().ring(0.48, 0.03, 'team', { seg: 24 }).box(0.1, 0.08, 0.08, AMBER, { at: [0.48, 0, 0], glow: true, bevel: 0 }).box(0.1, 0.08, 0.08, AMBER, { at: [-0.48, 0, 0], glow: true, bevel: 0 }),
  }, [{ geo: 'coil', at: [0, 1.7, 0], anim: { k: 'spin', axis: 'y', rate: 1.4 } }]);
}

// ---------------------------------------------------------------- Vrax

function aliHq(): RigDef {
  return def(3, 3, 2.3, {
    body: () => {
      const s = mound(shape(), 3, 3);
      // Bone tusks rising around the heart.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        s.cone(0.1, 1.0, BONE, { at: [Math.cos(a) * 1.0, 0.45, Math.sin(a) * 1.0], rot: [Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45], seg: 7 });
      }
      // Ribbed cage over the heart.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        s.box(0.08, 1.1, 0.08, CHITIN2, { at: [Math.cos(a) * 0.55, 0.85, Math.sin(a) * 0.55], rot: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5], bevel: 0.4 });
      }
      s.lathe([[0.85, 0], [0.8, 0.25], [0.62, 0.5], [0.3, 0.62], [0, 0.65]], 'teamDark', { at: [0, 0.1, 0], seg: 18 }); // carapace skirt
      scutes(s, [0, 0.1, 0], [0.85, 0.62, 0.85], 41);
      s.ring(0.82, 0.03, 'team', { at: [0, 0.2, 0], seg: 24 });
      s.ball(0.2, ACID, { at: [0, 1.55, 0], seg: 10, glow: true }); // crown bulb
      s.cone(0.12, 0.5, BONE, { at: [0, 1.9, 0], seg: 7 });
      // Fine detail (R3D-34). Veins, pores and a few dim spots over the carapace; chitin sockets where the tusks root;
      // a collar of small spines under the crown bulb; membranes webbing the back of the cage.
      const carapace = shell([[0.85, 0], [0.8, 0.25], [0.62, 0.5], [0.3, 0.62], [0, 0.65]], [0, 0.1, 0], 0.06, 0.52);
      veins(s, carapace, 7, 43);
      pores(s, carapace, 5, 44);
      glints(s, carapace, 4, 45);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        const rot: V3 = [Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45];
        s.ball(0.15, CHITIN, { at: along([Math.cos(a), 0.45, Math.sin(a)], axisOf(rot), -0.42), scale: [1, 0.5, 1], seg: 6, shadow: false });
        s.cone(0.025, 0.12, BONE, { at: [Math.cos(a) * 0.21, 1.42, Math.sin(a) * 0.21], rot: [0, -a, -Math.PI / 2 - 0.5], seg: 4, shadow: false });
      }
      const rib = (i: number, k: number): V3 => {
        const a = (i / 8) * Math.PI * 2;
        return along([Math.cos(a) * 0.55, 0.85, Math.sin(a) * 0.55], axisOf([Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5]), k);
      };
      for (const i of [3, 4, 5]) membrane(s, rib(i, -0.45), rib(i + 1, -0.45), rib(i + 1, 0), rib(i, 0));
      return s;
    },
    heart: () => {
      const s = shape();
      s.ball(0.42, FLESH, { seg: 16, scale: [1, 1.15, 1] });
      s.ball(0.3, GREEN, { at: [0.15, 0.05, 0.15], seg: 12, glow: true });
      for (let i = 0; i < 5; i++) s.tube(0.03, 0.5, GREEN, { at: [0, -0.1 + i * 0.08, 0], rot: [0, i * 1.25, 0.6], glow: true, seg: 5 });
      return s;
    },
  }, [{ geo: 'heart', at: [0, 1.0, 0], anim: { k: 'breathe', amp: 0.06, rate: 2.2 } }]);
}

function aliGenerator(): RigDef {
  return def(2, 2, 1.2, {
    body: () => {
      const s = mound(shape(), 2, 2);
      const pods = [[-0.4, -0.35, 0.36], [0.35, -0.4, 0.28], [-0.35, 0.4, 0.3]] as const;
      for (const [x, z, r] of pods) {
        s.ball(r, CHITIN2, { at: [x, r * 0.75, z], scale: [1, 1.2, 1], seg: 12 });
        cap(s, r * 1.01, 'teamDark', [x, r * 0.8, z], [0.9, 1.15, 0.9], 0.3, 12);
        s.ring(r * 0.55, 0.02, 'team', { at: [x, r * 1.55, z], seg: 12 });
        scutes(s, [x, r * 0.75, z], [r, r * 1.2, r], Math.round(r * 100), [7, 5]);
        for (let i = 0; i < 3; i++) s.tube(0.018, r * 1.4, GREEN, { at: [x, r * (0.5 + i * 0.25), z], rot: [0, i * 1.1, 0.4], glow: true, seg: 5 });
        // Fine detail (R3D-34): ribs up the pod's flanks, dim spots, roots into the mound.
        const seed = Math.round(r * 100);
        ribs(s, dome([x, r * 0.75, z], [r, r * 1.2, r], -0.5, 0.2), 4, seed + 7, 0.016);
        glints(s, dome([x, r * 0.75, z], [r, r * 1.2, r], -0.3, 0.5), 2, seed + 9);
        footings(s, [x, 0.1, z], r * 0.85, r * 0.85, 4, seed + 10, 0.2, 0.03);
      }
      // A chitin cup cradles the orb, fed by a tendril from each pod.
      s.lathe([[0.03, 0], [0.1, 0.04], [0.15, 0.13], [0.13, 0.17]], CHITIN, { at: [0.3, 0.03, 0.3], seg: 8 });
      for (const [x, z, r] of pods) {
        const d = Math.hypot(0.3 - x, 0.3 - z);
        const [ux, uz] = [(0.3 - x) / d, (0.3 - z) / d];
        const a: V3 = [x + ux * r * 0.95, 0.08, z + uz * r * 0.95];
        const b: V3 = [0.3 - ux * 0.13, 0.12, 0.3 - uz * 0.13];
        const m: V3 = [(a[0] + b[0]) / 2, 0.15, (a[2] + b[2]) / 2];
        s.strut(a, m, 0.028, FLESH, { r2: 0.022, seg: 5, shadow: false });
        s.strut(m, b, 0.022, FLESH, { r2: 0.018, seg: 5, shadow: false });
      }
      return s;
    },
    orb: () => shape().ball(0.22, GREEN, { seg: 14, glow: true }).ring(0.27, 0.03, BONE, { seg: 16 }),
  }, [{ geo: 'orb', at: [0.3, 0.45, 0.3], anim: { k: 'breathe', amp: 0.12, rate: 3 } }]);
}

function aliExtractor(): RigDef {
  return def(3, 2, 1.3, {
    body: () => {
      const s = mound(shape(), 3, 2);
      // A hunched digester at the back with feeding tubes into the ground.
      s.ball(0.6, CHITIN, { at: [-0.6, 0.35, -0.2], scale: [1.4, 0.95, 1], seg: 16 });
      cap(s, 0.6, 'teamDark', [-0.6, 0.38, -0.2], [1.3, 0.92, 0.85], 0.35, 16);
      s.ball(0.12, 'team', { at: [-0.6, 0.93, -0.2], scale: [3, 0.4, 1.2], seg: 10 });
      scutes(s, [-0.6, 0.35, -0.2], [0.84, 0.57, 0.6], 53);
      for (let i = 0; i < 4; i++) s.cone(0.07, 0.4, BONE, { at: [-1.0 + i * 0.27, 0.95, -0.2], rot: [0, 0, 0.4], seg: 6 });
      for (const z of [0.4, -0.65]) s.tube(0.07, 0.8, FLESH, { at: [0.2, 0.15, z], rot: [0, 0.3, -0.25], seg: 8 });
      // Glowing digestive pustules in the front corner (gorgers feed it at the separate maw beside it, R3D-22).
      for (const [x, z, r] of [[0.75, 0.3, 0.16], [1.05, 0.5, 0.12], [0.8, 0.65, 0.1]] as const) {
        s.ball(r, SAC, { at: [x, 0.1 + r * 0.6, z], scale: [1, 0.8, 1], seg: 10 });
        s.ball(r * 0.4, ACID, { at: [x, 0.1 + r * 1.3, z], seg: 6, glow: true });
      }
      for (let i = 0; i < 3; i++) s.ball(0.05, GREEN, { at: [-0.25 + i * 0.12, 0.62 - i * 0.05, 0.25], seg: 6, glow: true });
      // Fine detail (R3D-34). Ribs, veins, pores and dim spots over the digester; a membrane sail between the bone spines
      // on its back; ribbed collars on the feeding tubes; roots where it meets the ground.
      const gut = (from: number, to: number): Surf => dome([-0.6, 0.35, -0.2], [0.84, 0.57, 0.6], from, to);
      ribs(s, gut(-0.35, 0.28), 7, 57, 0.02);
      veins(s, gut(-0.2, 0.75), 5, 58);
      pores(s, gut(-0.1, 0.6), 4, 59);
      glints(s, gut(0.0, 0.7), 3, 60);
      const spine = (i: number, k: number): V3 => along([-1.0 + i * 0.27, 0.95, -0.2], axisOf([0, 0, 0.4]), k);
      for (let i = 0; i < 3; i++) membrane(s, spine(i, -0.2), spine(i + 1, -0.2), spine(i + 1, 0.08), spine(i, 0.08));
      for (const z of [0.4, -0.65]) for (const k of [-0.22, 0.02, 0.24]) s.tube(0.082, 0.03, CHITIN, { at: along([0.2, 0.15, z], [0.926, -0.247, -0.286], k), rot: [0, 0.3, -0.25], seg: 7, shadow: false });
      footings(s, [-0.6, 0.08, -0.2], 0.76, 0.55, 6, 61, 0.26, 0.04);
      return s;
    },
  }, [], { vents: [[-0.6, 0.95, -0.2]] });
}

function aliNest(): RigDef {
  return def(2, 2, 1.0, {
    body: () => {
      const s = mound(shape(), 2, 2);
      const eggs = [[-0.4, -0.4, 0.3], [0.1, -0.5, 0.24], [-0.5, 0.15, 0.26], [0.05, 0.0, 0.34], [0.5, 0.2, 0.2], [0.2, 0.5, 0.22], [-0.25, 0.55, 0.18]] as const;
      for (const [i, [x, z, r]] of eggs.entries()) {
        s.ball(r, CHITIN2, { at: [x, r * 1.1, z], scale: [1, 1.4, 1], seg: 9 });
        cap(s, r * 1.02, 'teamDark', [x, r * 1.0, z], [0.95, 1.2, 0.95], 0.25, 10);
        s.ball(r * 0.35, GREEN, { at: [x, r * 2.4, z], seg: 6, glow: true });
        if (r >= 0.24) scutes(s, [x, r * 1.1, z], [r, r * 1.4, r], Math.round(r * 100) + 3, [7, 4]);
        // Fine detail (R3D-34): a vein up each shell, a pore on the big ones, roots into the mound.
        const shellOf = dome([x, r * 1.1, z], [r, r * 1.4, r], -0.45, 0.55);
        veins(s, shellOf, 1, 90 + i);
        if (r >= 0.24) pores(s, shellOf, 1, 95 + i, 0.024);
        footings(s, [x, 0.1, z], r * 0.85, r * 0.85, 2 + (i % 2), 100 + i, 0.18, 0.028);
      }
      // Tendrils binding the front of the clutch, membranes webbing the back eggs together, a few dim spots.
      const egg = (i: number): readonly [number, number, number] => eggs[i]!;
      for (const [i, j] of [[4, 5], [5, 6], [2, 6], [3, 4]] as const) {
        const [ax, az, ar] = egg(i);
        const [bx, bz, br] = egg(j);
        const d = Math.hypot(bx - ax, bz - az);
        const [ux, uz] = [(bx - ax) / d, (bz - az) / d];
        const a: V3 = [ax + ux * ar * 0.9, 0.13, az + uz * ar * 0.9];
        const b: V3 = [bx - ux * br * 0.9, 0.13, bz - uz * br * 0.9];
        const m: V3 = [(a[0] + b[0]) / 2, 0.17, (a[2] + b[2]) / 2];
        s.strut(a, m, 0.02, FLESH, { r2: 0.016, seg: 4, shadow: false });
        s.strut(m, b, 0.016, FLESH, { r2: 0.02, seg: 4, shadow: false });
      }
      for (const [i, j] of [[0, 1], [0, 2]] as const) {
        const [ax, az, ar] = egg(i);
        const [bx, bz, br] = egg(j);
        const d = Math.hypot(bx - ax, bz - az);
        const [ux, uz] = [(bx - ax) / d, (bz - az) / d];
        membrane(s, [ax + ux * ar * 0.8, 0.14, az + uz * ar * 0.8], [bx - ux * br * 0.8, 0.14, bz - uz * br * 0.8], [bx - ux * br * 0.7, br * 1.7, bz - uz * br * 0.7], [ax + ux * ar * 0.7, ar * 1.7, az + uz * ar * 0.7]);
      }
      glints(s, dome([0.05, 0.374, 0.0], [0.34, 0.476, 0.34], -0.3, 0.4), 3, 97);
      return s;
    },
  }, []);
}

function aliPit(): RigDef {
  return def(3, 3, 1.4, {
    body: () => {
      const s = shape();
      // A crater ring with a glowing brood pool and bone arches over it.
      hiveBase(s, 3, 3, 31);
      s.lathe([[1.42, 0], [1.38, 0.18], [1.1, 0.34], [0.85, 0.3], [0.7, 0.08], [0.6, 0.02]], CHITIN, { seg: 22 });
      s.lathe([[1.2, 0.3], [1.05, 0.36], [0.88, 0.32]], 'team', { seg: 22 });
      s.cyl(0.72, 0.04, ACID, { at: [0, 0.04, 0], seg: 22, glow: true });
      for (let i = 0; i < 3; i++) boneArch(s, 1.0, 0.98, (i / 3) * Math.PI + 0.3, 0.09, 31 + i);
      for (let i = 0; i < 5; i++) s.ball(0.06, GREEN, { at: [Math.cos(i * 1.3) * 0.4, 0.08, Math.sin(i * 1.3) * 0.4], seg: 6, glow: true });
      // Fine detail (R3D-34). Chitin ridges down the crater's inner wall, pores in its outer slope, tendrils trailing
      // into the brood pool, and dim spots round the pool's edge.
      for (let i = 0; i < 9; i++) {
        const th = ((i + hash3(31, i, 91) * 0.6) / 9) * Math.PI * 2;
        s.strut([Math.cos(th) * 0.9, 0.33, Math.sin(th) * 0.9], [Math.cos(th) * 0.72, 0.1, Math.sin(th) * 0.72], 0.028, CHITIN2, { r2: 0.016, seg: 4, shadow: false });
      }
      pores(s, shell([[1.42, 0], [1.38, 0.18], [1.1, 0.34]], [0, 0, 0], 0.08, 0.3), 6, 92, 0.03);
      for (let i = 0; i < 5; i++) {
        const th = ((i + 0.5 + hash3(31, i, 93) * 0.5) / 5) * Math.PI * 2;
        const pt = (r: number, y: number): V3 => [Math.cos(th) * r, y, Math.sin(th) * r];
        s.strut(pt(0.82, 0.24), pt(0.66, 0.08), 0.022, FLESH, { r2: 0.016, seg: 4, shadow: false });
        s.strut(pt(0.66, 0.08), pt(0.48, 0.05), 0.016, FLESH, { r2: 0.01, seg: 4, shadow: false });
      }
      glints(s, (_t, th) => [Math.cos(th) * 0.69, 0.07, Math.sin(th) * 0.69], 4, 94);
      return s;
    },
  }, []);
}

function aliSpire(): RigDef {
  return def(1, 1, 1.5, {
    body: () => {
      const s = hiveBase(shape(), 1.1, 1.1, 17);
      s.lathe([[0.42, 0], [0.38, 0.12], [0.2, 0.4], [0.14, 0.9], [0.17, 1.05], [0.12, 1.1]], CHITIN, { seg: 10 });
      s.lathe([[0.4, 0.04], [0.34, 0.16], [0.26, 0.28]], 'team', { seg: 10 });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        s.cone(0.04, 0.3, BONE, { at: [Math.cos(a) * 0.3, 0.2, Math.sin(a) * 0.3], rot: [Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7], seg: 5 });
      }
      for (let i = 0; i < 3; i++) s.ring(0.17 - i * 0.012, 0.02, GREEN, { at: [0, 0.55 + i * 0.15, 0], seg: 12, glow: true });
      // Fine detail (R3D-34). Ribs up the flared foot, pores on it, small spines up the neck between the glowing rings,
      // dim spots under the crown.
      const neck = [[0.42, 0], [0.38, 0.12], [0.2, 0.4], [0.14, 0.9], [0.17, 1.05], [0.12, 1.1]] as const;
      ribs(s, shell(neck, [0, 0, 0], 0.28, 0.52), 6, 18, 0.02, CHITIN2);
      pores(s, shell(neck, [0, 0, 0], 0.3, 0.48), 3, 19, 0.022);
      glints(s, shell(neck, [0, 0, 0], 0.93, 1.03), 3, 20);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + (i % 2) * 0.5;
        const y = [0.625, 0.775, 0.95][i % 3]!;
        const r = shell(neck, [0, 0, 0], y, y)(0, 0)[0] + 0.03;
        s.cone(0.02, 0.09, BONE, { at: [Math.cos(a) * r, y, Math.sin(a) * r], rot: [0, -a, -Math.PI / 2 + 0.6], seg: 4, shadow: false });
      }
      return s;
    },
    turret: () => {
      const s = shape();
      s.ball(0.17, CHITIN2, { scale: [1.3, 0.9, 1], seg: 12 });
      s.ball(0.17, 'team', { at: [0, 0.02, 0], scale: [1.2, 0.85, 0.8], cut: 0.4, seg: 12 });
      s.ball(0.04, GREEN, { at: [0.18, 0.05, 0], seg: 8, glow: true });
      for (const z of [0.1, -0.1]) s.cone(0.03, 0.18, BONE, { at: [-0.12, 0.12, z], rot: [z > 0 ? 0.4 : -0.4, 0, 0.8], seg: 5 });
      // Fine detail (R3D-34): a ridge of small spines along the top, and a pore on each side.
      for (let i = 0; i < 3; i++) s.cone(0.014, 0.06, BONE, { at: [-0.06 + i * 0.05, 0.155, 0], rot: [0, 0, 0.5], seg: 4, shadow: false });
      for (const z of [0.16, -0.16]) {
        s.ball(0.022, CHITIN2, { at: [0.02, 0.06, z], seg: 5, shadow: false });
        s.ball(0.013, PORE, { at: [0.02, 0.06, z * 1.1], seg: 5, shadow: false });
      }
      return s;
    },
    barrel: () => shape().tube(0.04, 0.28, BONE, { at: [0.12, 0, 0], r2: 0.06, seg: 8 }).ring(0.035, 0.012, GREEN, { at: [0.26, 0, 0], rot: [0, 0, Math.PI / 2], seg: 10, glow: true }),
  }, [
    { geo: 'turret', at: [0, 1.2, 0], anim: { k: 'turret' }, kids: [{ geo: 'barrel', at: [0.12, 0, 0], anim: { k: 'barrel', recoil: 0.06 }, kids: [{ muzzle: true, at: [0.3, 0, 0] }] }] },
  ], { weapon: 'spine' });
}

function aliEvolver(): RigDef {
  return def(2, 2, 1.9, {
    body: () => {
      const s = mound(shape(), 2, 2);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        s.tube(0.05, 0.7, FLESH, { at: [Math.cos(a) * 0.55, 0.15, Math.sin(a) * 0.55], rot: [0, -a, 0.15], r2: 0.02, seg: 6 });
      }
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        s.box(0.07, 1.5, 0.07, BONE, { at: [Math.cos(a) * 0.42, 0.85, Math.sin(a) * 0.42], rot: [Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18], bevel: 0.4 });
      }
      s.lathe([[0.3, 0], [0.38, 0.1], [0.3, 0.2]], 'team', { at: [0, 0.1, 0], seg: 14 });
      // Fine detail (R3D-34). Chitin bands up the bone pillars, a spur at each tip, roots at each foot, membranes webbing
      // the back between them (bowed out clear of the pod), pores and dim spots on the mound.
      const pillar = (i: number): { a: number; rot: V3; c: V3; ax: V3 } => {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const rot: V3 = [Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18];
        return { a, rot, c: [Math.cos(a) * 0.42, 0.85, Math.sin(a) * 0.42], ax: axisOf(rot) };
      };
      for (let i = 0; i < 4; i++) {
        const { a, rot, c, ax } = pillar(i);
        for (const k of [-0.42, 0.05, 0.45]) s.cyl(0.055, 0.035, CHITIN, { at: along(c, ax, k), rot, seg: 6, shadow: false });
        s.cone(0.022, 0.12, BONE, { at: along(along(c, ax, 0.62), [Math.cos(a), 0, Math.sin(a)], 0.05), rot: [0, -a, -Math.PI / 2 + 0.7], seg: 4, shadow: false });
        const foot = along(c, ax, -0.72);
        footings(s, [foot[0], 0.09, foot[2]], 0.04, 0.04, 3, 120 + i, 0.18, 0.03);
      }
      for (const i of [1, 2]) {
        const p = pillar(i);
        const q = pillar(i + 1);
        const mid = (p.a + q.a) / 2;
        const m = (y: number): V3 => [Math.cos(mid) * 0.5, y, Math.sin(mid) * 0.5];
        const [plo, phi, qlo, qhi] = [along(p.c, p.ax, -0.65), along(p.c, p.ax, -0.1), along(q.c, q.ax, -0.65), along(q.c, q.ax, -0.1)];
        membrane(s, plo, m(plo[1]), m(phi[1]), phi);
        membrane(s, m(qlo[1]), qlo, qhi, m(qhi[1]));
      }
      const skin = shell([[0.98, 0], [0.94, 0.06], [0.706, 0.11], [0, 0.13]], [0, 0, 0], 0.07, 0.115);
      pores(s, skin, 3, 125, 0.026);
      glints(s, skin, 3, 126);
      return s;
    },
    pod: () => {
      const s = shape();
      s.lathe([[0.0, 0], [0.24, 0.12], [0.34, 0.5], [0.3, 0.9], [0.14, 1.15], [0.0, 1.2]], MAGENTA, { seg: 14, glow: true, scale: [0.8, 1, 0.8] });
      s.lathe([[0.0, -0.02], [0.27, 0.1], [0.37, 0.5], [0.33, 0.9], [0.16, 1.16], [0.0, 1.22]], CHITIN2, { seg: 7, scale: [0.88, 1, 0.88] });
      return s;
    },
  }, [{ geo: 'pod', at: [0, 0.3, 0], anim: { k: 'breathe', amp: 0.05, rate: 1.4 } }]);
}

function aliRift(): RigDef {
  return def(3, 3, 2.4, {
    body: () => {
      const s = mound(shape(), 3, 3);
      // Two curved bone horns cradle the rift, set across the camera's line of sight so the portal shows between them.
      for (const side of [1, -1]) {
        const n = 7;
        const pt = (i: number): [number, number, number] => {
          const k = i / n;
          const w = side * 0.95 * (1 - 0.55 * k * k);
          return [w * 0.707, 0.12 + 1.9 * k, -w * 0.707];
        };
        for (let i = 0; i < n; i++) s.strut(pt(i), pt(i + 1), 0.13 * (1 - i / n) + 0.02, BONE, { r2: 0.13 * (1 - (i + 1) / n) + 0.02, seg: 7 });
        s.ball(0.17, CHITIN, { at: pt(0), scale: [1, 0.6, 1], seg: 10 });
        // Fine detail (R3D-34): knuckles at the horn's joints, spurs along its outer curve, roots round its foot.
        const out = Math.atan2(-side * 0.707, side * 0.707);
        for (let i = 1; i < n; i++) s.ball(0.13 * (1 - i / n) + 0.032, BONE, { at: pt(i), scale: [1, 0.6, 1], seg: 6, shadow: false });
        for (let i = 2; i < n; i++) {
          const r = 0.13 * (1 - i / n) + 0.02;
          const p = pt(i);
          s.cone(0.022, 0.1, BONE, { at: [p[0] + Math.cos(out) * (r + 0.03), p[1] + 0.02, p[2] + Math.sin(out) * (r + 0.03)], rot: [0, -out, -Math.PI / 2 + 0.6], seg: 4, shadow: false });
        }
        const foot = pt(0);
        footings(s, [foot[0], 0.1, foot[2]], 0.16, 0.16, 4, 130 + side, 0.28, 0.045);
      }
      // Veins, pores and dim spots round the basin.
      const basin = shell([[0.7, 0], [0.62, 0.2], [0.4, 0.3]], [0, 0.1, 0], 0.03, 0.18);
      veins(s, basin, 4, 133);
      pores(s, basin, 4, 134);
      glints(s, basin, 3, 135);
      s.lathe([[0.7, 0], [0.62, 0.2], [0.4, 0.3]], 'teamDark', { at: [0, 0.1, 0], seg: 18 });
      s.cyl(0.45, 0.04, MAGENTA, { at: [0, 0.32, 0], seg: 18, glow: true });
      return s;
    },
    portal: () => {
      // Drawn in the local YZ plane (facing +X); the node turns it toward the camera.
      const s = shape();
      s.ring(0.62, 0.06, MAGENTA, { rot: [0, 0, Math.PI / 2], seg: 28, glow: true });
      s.ring(0.5, 0.03, 0xffb0e0, { rot: [0, 0, Math.PI / 2], seg: 24, glow: true });
      s.cyl(0.6, 0.02, 0x5a1050, { rot: [0, 0, Math.PI / 2], seg: 24 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        s.box(0.02, 0.36, 0.05, MAGENTA, { at: [0.015, Math.sin(a) * 0.25, Math.cos(a) * 0.25], rot: [a + 0.9, 0, 0], glow: true, bevel: 0 });
      }
      return s;
    },
    // Turned toward the camera and tilted back so the fixed overhead view sees it face on.
  }, [{ at: [0, 1.2, 0], rot: [0, -Math.PI / 4, 0.62], kids: [{ geo: 'portal', anim: { k: 'spin', axis: 'x', rate: 0.9 } }] }]);
}

// ---------------------------------------------------------------- crystals and props

/** A shard crystal cluster for a depletion level 1..4: hexagonal prisms with pointed tips. */
export function crystalShape(level: number, seed: number): Shape {
  const s = shape();
  const n = [1, 2, 3, 5][Math.min(4, Math.max(1, level)) - 1] as number;
  for (let i = 0; i < n; i++) {
    const a = hash3(seed, i, 1) * Math.PI * 2;
    const r = i === 0 ? 0 : 0.1 + hash3(seed, i, 2) * 0.14;
    const h = (i === 0 ? 0.28 + level * 0.06 : 0.14 + hash3(seed, i, 3) * 0.16) * (0.75 + level * 0.08);
    const w = i === 0 ? 0.07 : 0.045;
    const tilt: [number, number, number] = [Math.sin(a) * 0.35 * (r > 0 ? 1 : 0.3), 0, -Math.cos(a) * 0.35 * (r > 0 ? 1 : 0.3)];
    const at: [number, number, number] = [Math.cos(a) * r, h / 2, Math.sin(a) * r];
    s.cyl(w, h, 0x2fc7b0, { at, rot: tilt, seg: 6 });
    s.cyl(w * 0.55, h * 0.9, 0x9ffcff, { at, rot: tilt, seg: 6, glow: true });
    // The tip sits on the prism's top along its tilted axis: (0, L, 0) turned by the XYZ Euler (no Y turn).
    const L = h / 2 + w * 1.1;
    const tip: [number, number, number] = [at[0] - L * Math.sin(tilt[2]), at[1] + L * Math.cos(tilt[2]) * Math.cos(tilt[0]), at[2] + L * Math.cos(tilt[2]) * Math.sin(tilt[0])];
    s.cone(w, w * 2.2, 0x56e8d0, { at: tip, rot: tilt, seg: 6 });
  }
  s.rock(0.12, 0x5a5f63, seed, { at: [0, 0.02, 0], scale: [1.3, 0.5, 1.3] });
  return s;
}

/** Ground props by kind and variant (the same choice of tiles as the classic view). */
export function propShape(kind: string, variant: number): Shape {
  const s = shape();
  if (kind === 'pebbles') {
    s.rock(0.16, 0x7a8079, variant * 3 + 1, { at: [0, 0.06, 0], scale: [1.2, 0.9, 1] });
    s.rock(0.1, 0x666b66, variant * 3 + 2, { at: [0.18, 0.03, 0.1] });
    s.rock(0.07, 0x7f857e, variant * 3 + 3, { at: [-0.12, 0.02, 0.16] });
  } else if (kind === 'sprout') {
    // Alien flora: a curved stalk with a glowing bulb and fronds.
    s.cyl(0.025, 0.4 + variant * 0.06, 0x4a3a68, { at: [0, 0.2 + variant * 0.03, 0], r2: 0.04, seg: 6 });
    s.ball(0.11, 0x8a56b8, { at: [0, 0.44 + variant * 0.06, 0], scale: [1, 0.75, 1], seg: 10 });
    s.ball(0.07, GREEN, { at: [0, 0.4 + variant * 0.06, 0], seg: 8, glow: true });
    for (let i = 0; i < 4; i++) s.cone(0.03, 0.22, 0x5c3f7a, { at: [Math.cos(i * 1.6) * 0.07, 0.08, Math.sin(i * 1.6) * 0.07], rot: [Math.sin(i * 1.6) * 0.8, 0, -Math.cos(i * 1.6) * 0.8], seg: 4 });
  } else {
    // Rock spire.
    s.rock(0.18, 0x8b8577, variant * 5 + 11, { at: [0, 0.32, 0], scale: [0.8, 2.4, 0.8], rough: 0.3 });
    s.rock(0.12, 0x77725f, variant * 5 + 12, { at: [0.14, 0.06, 0.06] });
  }
  return s;
}

/** A grass tuft: a few tapered blades. */
export function grassShape(variant: number, color: number): Shape {
  const s = shape();
  for (let i = 0; i < 5; i++) {
    const a = hash3(variant, i, 9) * Math.PI * 2;
    const h = 0.06 + hash3(variant, i, 10) * 0.06;
    s.cone(0.012, h, color, { at: [Math.cos(a) * 0.035, h / 2, Math.sin(a) * 0.035], rot: [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4], seg: 3 });
  }
  return s;
}

/** A clump of reeds: tall leaning blades and a couple of brown seed heads (R3D-14). */
export function reedShape(variant: number): Shape {
  const s = shape();
  const n = 7 + variant;
  for (let i = 0; i < n; i++) {
    const a = hash3(variant, i, 21) * Math.PI * 2;
    const h = 0.16 + hash3(variant, i, 22) * 0.14;
    const lean = 0.12 + hash3(variant, i, 23) * 0.25;
    const g = [0x5f7a3c, 0x6f8442, 0x52693a][i % 3] as number;
    s.cone(0.011, h, g, { at: [Math.cos(a) * 0.04, h / 2, Math.sin(a) * 0.04], rot: [Math.sin(a) * lean, 0, -Math.cos(a) * lean], seg: 3 });
  }
  for (let i = 0; i < 2; i++) {
    const a = hash3(variant, i, 24) * Math.PI * 2;
    const x = Math.cos(a) * 0.02;
    const z = Math.sin(a) * 0.02;
    s.cyl(0.004, 0.26, 0x6a7a44, { at: [x, 0.13, z], seg: 3 });
    s.cyl(0.012, 0.05, 0x5a3e28, { at: [x, 0.27, z], seg: 6 });
  }
  return s;
}

/** The Aegis dock (R3D-22): a hazard-striped pad with bollards, and a low, wide receiving trough at the wall that takes the tipped load. */
function humDock(): RigDef {
  return def(1, 1, 0.6, {
    body: () => {
      const s = shape();
      s.box(0.92, 0.03, 0.92, DARK, { at: [0, 0.015, 0], bevel: 0 });
      for (let i = 0; i < 4; i++) s.box(0.92, 0.008, 0.07, HAZARD, { at: [0, 0.034, -0.34 + i * 0.227], bevel: 0 });
      for (const z of [0.4, -0.4]) {
        s.cyl(0.035, 0.24, HAZARD, { at: [0.38, 0.12, z], seg: 8 });
        s.cyl(0.03, 0.03, AMBER, { at: [0.38, 0.255, z], seg: 8, glow: true });
      }
      // The receiving trough: low and wide against the wall, sloping down toward the pad, so a tipped hopper and its open
      // hatch pass over it. It stands between the hauler's wheels; a lit lip marks the intake, a pipe across the back takes the load into the plant.
      s.slab([[-0.5, 0.0], [-0.28, 0.0], [-0.3, 0.07], [-0.36, 0.14], [-0.5, 0.16]], 0.48, STEEL, { bevel: 0.015 });
      for (const z of [0.255, -0.255]) s.slab([[-0.5, 0.0], [-0.28, 0.0], [-0.3, 0.09], [-0.36, 0.17], [-0.5, 0.19]], 0.03, STEEL, { at: [0, 0, z], bevel: 0.006 });
      s.box(0.03, 0.02, 0.5, 'team', { at: [-0.29, 0.085, 0], rot: [0, 0, -0.9], bevel: 0 });
      s.box(0.016, 0.014, 0.4, CYAN, { at: [-0.485, 0.17, 0], glow: true, bevel: 0 });
      s.cyl(0.04, 0.5, GUN, { at: [-0.54, 0.2, 0], rot: [Math.PI / 2, 0, 0], seg: 8 });
      return s;
    },
  }, []);
}

/** The Vrax dock (R3D-22): a bone-toothed feeding maw over a glowing pool at the wall, fed into the hive by a fleshy gullet. */
function aliDock(): RigDef {
  return def(1, 1, 0.4, {
    body: () => {
      const s = shape();
      s.lathe([[0, 0], [0.48, 0], [0.44, 0.04], [0, 0.05]], BELLY, { seg: 14 });
      const mx = -DOCK_INTAKE.ali_extractor!;
      s.ring(0.26, 0.07, BONE, { at: [mx, 0.1, 0], seg: 16 });
      s.cyl(0.21, 0.03, ACID, { at: [mx, 0.08, 0], seg: 16, glow: true });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        s.cone(0.03, 0.13, BONE, { at: [mx + Math.cos(a) * 0.27, 0.17, Math.sin(a) * 0.27], rot: [Math.sin(a) * -0.6, 0, Math.cos(a) * 0.6], seg: 4 });
      }
      s.tube(0.08, 0.5, FLESH, { at: [mx - 0.1, 0.25, 0], rot: [0, 0, 1.0], seg: 8 });
      for (let i = 0; i < 3; i++) s.ball(0.04, GREEN, { at: [0.15 + i * 0.1, 0.06, -0.3 + i * 0.3], seg: 6, glow: true });
      return s;
    },
  }, [], { organic: true });
}

/** Dock models by refinery kind (R3D-22). */
export const DOCK_RIGS: Readonly<Record<string, () => RigDef>> = { hum_refinery: humDock, ali_extractor: aliDock };

export const BUILDING_RIGS: Readonly<Record<string, () => RigDef>> = {
  hum_hq: humHq,
  hum_reactor: humReactor,
  hum_refinery: humRefinery,
  hum_barracks: humBarracks,
  hum_factory: humFactory,
  hum_turret: humTurret,
  hum_lab: humLab,
  hum_lance: humLance,
  ali_hq: aliHq,
  ali_generator: aliGenerator,
  ali_extractor: aliExtractor,
  ali_nest: aliNest,
  ali_pit: aliPit,
  ali_spire: aliSpire,
  ali_evolver: aliEvolver,
  ali_rift: aliRift,
};
