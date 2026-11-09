/**
 * The camera fit of the build-button pictures (UI-17): each picture shows the whole model filling most of the picture, with
 * a small margin on its tighter sides, whatever its shape. The model's bounding box is projected through the preview camera and the camera backs
 * off, and aims at the middle of what it sees, until the projected bounds fill `1 - 2 * edge` of the picture's width or
 * height. Pure maths (no three.js), so it is unit-tested without a GPU.
 */
export type V3 = readonly [number, number, number];
/** The share of the picture kept clear on each side of the model at its tightest (about 5 to 6%: the model fills most of the picture). */
export const ICON_EDGE = 0.055;
/**
 * The points that bound a model's silhouette from every side: for each of `dirs` evenly spread directions, the vertex
 * farthest along it (`xyz` is a flat list of vertex positions). The projected hull of these is the model's real outline, so
 * a round or tapering model is not fitted by the corners of an empty box around it.
 */
export function extremePoints(xyz: ArrayLike<number>, dirs = 160): V3[] {
  const out = new Map<number, V3>();
  const n = Math.floor(xyz.length / 3);
  for (let k = 0; k < dirs; k++) {
    const y = 1 - (2 * (k + 0.5)) / dirs;
    const r = Math.sqrt(1 - y * y);
    const a = k * 2.399963229728653;
    const dx = Math.cos(a) * r;
    const dz = Math.sin(a) * r;
    let best = -Infinity;
    let at = -1;
    for (let i = 0; i < n; i++) {
      const d = xyz[i * 3]! * dx + xyz[i * 3 + 1]! * y + xyz[i * 3 + 2]! * dz;
      if (d > best) {
        best = d;
        at = i;
      }
    }
    if (at >= 0) out.set(at, [xyz[at * 3]!, xyz[at * 3 + 1]!, xyz[at * 3 + 2]!]);
  }
  return [...out.values()];
}
/** The eight corners of an axis-aligned box. */
export function boxCorners(min: V3, max: V3): V3[] {
  const out: V3[] = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) out.push([x, y, z]);
  return out;
}
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** Unit vector from the target toward the camera for the preview's three-quarter view at `pitch`. */
export const viewDir = (pitch: number): V3 => norm([Math.cos(pitch) * 0.72, Math.sin(pitch), Math.cos(pitch) * 0.69]);
/** Normalised device coordinates (-1..1) of each point seen from a camera `dist` out along `dir` from `target`, looking at it. */
export function project(points: readonly V3[], target: V3, dir: V3, dist: number, fovDeg: number, aspect: number): [number, number][] {
  const right = norm(cross([0, 1, 0], dir));
  const up = cross(dir, right);
  const t = Math.tan((fovDeg * Math.PI) / 360);
  return points.map((p) => {
    const v: V3 = [p[0] - target[0], p[1] - target[1], p[2] - target[2]];
    const depth = dist - dot(v, dir);
    return [dot(v, right) / (depth * t * aspect), dot(v, up) / (depth * t)];
  });
}
/**
 * Where to put the camera so `points` (a model's bounding-box corners) fill the picture with `edge` clear on each side:
 * the point it looks at and its distance.
 */
export function fitPicture(points: readonly V3[], dir: V3, fovDeg: number, aspect: number, edge = ICON_EDGE): { target: V3; dist: number } {
  const right = norm(cross([0, 1, 0], dir));
  const up = cross(dir, right);
  const want = 1 - 2 * edge;
  const t = Math.tan((fovDeg * Math.PI) / 360);
  const reach = (tg: V3, d: number): number => Math.max(...project(points, tg, dir, d, fovDeg, aspect).flat().map(Math.abs));
  // The smallest distance at which the bounds fit, found by bisection (the nearest corner must stay in front of the camera).
  const solve = (tg: V3): number => {
    let lo = 0.01;
    let hi = 500;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const front = points.every((p) => mid - dot([p[0] - tg[0], p[1] - tg[1], p[2] - tg[2]], dir) > 0.05);
      if (front && reach(tg, mid) <= want) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  let target: V3 = [0, 0, 0];
  for (const p of points) target = [target[0] + p[0] / points.length, target[1] + p[1] / points.length, target[2] + p[2] / points.length];
  // Re-aim at the middle of the projected bounds a few times so the margins even out.
  for (let pass = 0; pass < 4; pass++) {
    const dist = solve(target);
    const q = project(points, target, dir, dist, fovDeg, aspect);
    const mx = (Math.max(...q.map((a) => a[0])) + Math.min(...q.map((a) => a[0]))) / 2;
    const my = (Math.max(...q.map((a) => a[1])) + Math.min(...q.map((a) => a[1]))) / 2;
    const k = dist * t;
    target = [target[0] + (right[0] * mx * aspect + up[0] * my) * k, target[1] + (right[1] * mx * aspect + up[1] * my) * k, target[2] + (right[2] * mx * aspect + up[2] * my) * k];
  }
  return { target, dist: solve(target) };
}
