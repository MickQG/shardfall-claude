import { unitDef } from '../data/defs';
import { crushable, isCrusher } from './crush';
import { centerOf, FP, isqrt, tileOf } from './fixed';
import { findPath, isBlocked, type Grid } from './path';
import { Hv, type State, type Unit } from './state';

/** Free tiles around (tx,ty) in deterministic ring order, nearest first. */
export function ringTiles(g: Grid, tx: number, ty: number, count: number): number[] {
  const out: number[] = [];
  for (let r = 0; out.length < count && r < Math.max(g.width, g.height); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isBlocked(g, tx + dx, ty + dy)) continue;
        out.push((ty + dy) * g.width + (tx + dx));
        if (out.length >= count) return out;
      }
    }
  }
  return out;
}

/** Queue a path search for `u` toward tile index `goal`. */
export function orderMove(s: State, u: Unit, goal: number): void {
  u.goal = goal;
  u.path = [];
  u.waiting = true;
  s.pathQueue.push(u.id);
}

export function clearOrder(u: Unit): void {
  u.path = [];
  u.goal = -1;
  u.waiting = false;
}

/** Path searches allowed per tick; the rest wait their turn in FIFO order (keeps tick time flat). */
export const PATHS_PER_TICK = 6;

export function servePathQueue(s: State): void {
  let served = 0;
  while (served < PATHS_PER_TICK && s.pathQueue.length > 0) {
    const id = s.pathQueue.shift() as number;
    const u = s.units.find((x) => x.id === id);
    if (!u || !u.waiting) continue;
    u.waiting = false;
    if (unitDef(u.kind).air) {
      u.path = [u.goal];
    } else {
      u.path = findPath(s.grid, tileOf(u.x), tileOf(u.y), u.goal % s.grid.width, Math.floor(u.goal / s.grid.width));
    }
    served++;
  }
}

export function stepUnit(s: State, u: Unit): void {
  const speed = unitDef(u.kind).speed;
  let budget = speed;
  while (budget > 0 && u.path.length > 0) {
    const next = u.path[0] as number;
    const wx = centerOf(next % s.grid.width);
    const wy = centerOf(Math.floor(next / s.grid.width));
    const dx = wx - u.x;
    const dy = wy - u.y;
    const dist = isqrt(dx * dx + dy * dy);
    if (dist <= budget) {
      u.x = wx;
      u.y = wy;
      budget -= dist;
      u.path.shift();
    } else {
      u.x += Math.trunc((dx * budget) / dist);
      u.y += Math.trunc((dy * budget) / dist);
      budget = 0;
    }
  }
}

/** Per-tick separation cap. Kept below every unit's speed so a moving unit can always make progress. */
const MAX_PUSH = FP / 24;

const isSquad = (u: Unit): boolean => (unitDef(u.kind).squad ?? 1) > 1;
const isHero = (u: Unit): boolean => unitDef(u.kind).hero === true;
/** A hauler unloading on a dock pad holds its place: nothing shoves it off the pad (ECO-8). */
const docked = (u: Unit): boolean => u.auto && u.hv === Hv.Unload;

/** Following a path, as opposed to standing still with no move pending. A unit shooting at a target holds its ground. */
const moving = (u: Unit): boolean => u.path.length > 0;
const standing = (u: Unit): boolean => u.path.length === 0 && !u.waiting && u.target < 0;

/** Where a moving unit is heading next (fixed-point offset to its next waypoint), or null when it is on it. */
function heading(s: State, u: Unit): [number, number] | null {
  for (const next of u.path) {
    const dx = centerOf(next % s.grid.width) - u.x;
    const dy = centerOf(Math.floor(next / s.grid.width)) - u.y;
    if (dx !== 0 || dy !== 0) return [dx, dy];
  }
  return null;
}

/**
 * Making way (SIM-9): when a moving unit touches a standing ally ahead of it, the ally steps aside, at right angles to the
 * mover's heading, to the side it already stands on (ties by id), at its own walking pace; the mover keeps going
 * without being pushed back. The sidestep, fixed-point, or null when the pair does not qualify.
 */
function makeWay(s: State, mover: Unit, blocker: Unit): [number, number] | null {
  // A hero never steps aside for a smaller ally (HERO-5).
  if (mover.owner !== blocker.owner || !moving(mover) || !standing(blocker) || docked(blocker) || (isHero(blocker) && !isHero(mover))) return null;
  const h = heading(s, mover);
  if (!h) return null;
  const rx = blocker.x - mover.x;
  const ry = blocker.y - mover.y;
  if (h[0] * rx + h[1] * ry <= 0) return null; // behind or beside: plain separation
  const cross = h[0] * ry - h[1] * rx;
  const side = cross > 0 || (cross === 0 && blocker.id % 2 === 0) ? 1 : -1;
  const len = isqrt(h[0] * h[0] + h[1] * h[1]) || 1;
  const pace = unitDef(blocker.kind).speed;
  return [Math.trunc((-h[1] * side * pace) / len), Math.trunc((h[0] * side * pace) / len)];
}

/** Push overlapping ground units apart (allies in a mover's way step aside, SIM-9). Air units do not collide. */
export function separate(s: State): void {
  const g = s.grid;
  const ground = s.units.filter((u) => !unitDef(u.kind).air);
  const buckets = new Map<number, Unit[]>();
  for (const u of ground) {
    const key = tileOf(u.y) * g.width + tileOf(u.x);
    const b = buckets.get(key);
    if (b) b.push(u);
    else buckets.set(key, [u]);
  }
  const push = new Map<number, [number, number]>();
  const aside = new Map<number, [number, number]>();
  for (const u of ground) {
    const ux = tileOf(u.x);
    const uy = tileOf(u.y);
    const ru = unitDef(u.kind).radius;
    for (let ny = uy - 1; ny <= uy + 1; ny++) {
      for (let nx = ux - 1; nx <= ux + 1; nx++) {
        const b = buckets.get(ny * g.width + nx);
        if (!b) continue;
        for (const o of b) {
          if (o.id <= u.id) continue;
          const dx = o.x - u.x;
          const dy = o.y - u.y;
          const min = ru + unitDef(o.kind).radius;
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min) continue;
          const d = isqrt(d2);
          // Coincident units are split along a deterministic axis based on id.
          const nxv = d === 0 ? (u.id & 1 ? 1 : -1) : dx;
          const nyv = d === 0 ? ((u.id >> 1) & 1 ? 1 : -1) : dy;
          const len = d === 0 ? 1 : d;
          const overlap = min - d;
          const px = Math.trunc((nxv * overlap) / (2 * len)) || (nxv > 0 ? 1 : nxv < 0 ? -1 : 0);
          const py = Math.trunc((nyv * overlap) / (2 * len)) || (nyv > 0 ? 1 : nyv < 0 ? -1 : 0);
          // A crusher ploughs on through enemy infantry: they give way, it does not (BAL-1).
          const uHolds = isCrusher(u) && crushable(u, o);
          const oHolds = isCrusher(o) && crushable(o, u);
          // A hero walks straight over an enemy vehicle it can crush: neither is pushed, so the hero overruns it (BAL-10).
          if ((uHolds && !isSquad(o)) || (oHolds && !isSquad(u))) continue;
          // A hero is never shoved by a smaller unit: it gives way, the hero does not (HERO-5).
          const uFirm = uHolds || (isHero(u) && !isHero(o)) || (docked(u) && !docked(o));
          const oFirm = oHolds || (isHero(o) && !isHero(u)) || (docked(o) && !docked(u));
          // An ally standing in a mover's way steps aside; the mover is not pushed back (SIM-9).
          const uWay = makeWay(s, o, u);
          const oWay = makeWay(s, u, o);
          for (const [who, step] of [[u, uWay], [o, oWay]] as const) {
            if (!step) continue;
            const a = aside.get(who.id) ?? [0, 0];
            a[0] += step[0];
            a[1] += step[1];
            aside.set(who.id, a);
          }
          if (!uFirm && !oWay) {
            const pu = push.get(u.id) ?? [0, 0];
            pu[0] -= px;
            pu[1] -= py;
            push.set(u.id, pu);
          }
          if (!oFirm && !uWay) {
            const po = push.get(o.id) ?? [0, 0];
            po[0] += px;
            po[1] += py;
            push.set(o.id, po);
          }
        }
      }
    }
  }
  for (const u of ground) {
    const p = push.get(u.id);
    const a = aside.get(u.id);
    if (!p && !a) continue;
    // A sidestep moves at most the unit's own pace, on top of the usual capped separation.
    const pace = unitDef(u.kind).speed;
    let ax = a ? a[0] : 0;
    let ay = a ? a[1] : 0;
    const al = isqrt(ax * ax + ay * ay);
    if (al > pace) {
      ax = Math.trunc((ax * pace) / al);
      ay = Math.trunc((ay * pace) / al);
    }
    const nx = u.x + Math.max(-MAX_PUSH, Math.min(MAX_PUSH, p ? p[0] : 0)) + ax;
    const ny = u.y + Math.max(-MAX_PUSH, Math.min(MAX_PUSH, p ? p[1] : 0)) + ay;
    if (!isBlocked(g, tileOf(nx), tileOf(ny))) {
      u.x = nx;
      u.y = ny;
    }
  }
}

/** Move any ground unit standing on a blocked tile to the nearest free tile. */
export function evictFromBlocked(s: State): void {
  for (const u of s.units) {
    if (unitDef(u.kind).air) continue;
    if (!isBlocked(s.grid, tileOf(u.x), tileOf(u.y))) continue;
    const [t] = ringTiles(s.grid, tileOf(u.x), tileOf(u.y), 1);
    if (t === undefined) continue;
    u.x = centerOf(t % s.grid.width);
    u.y = centerOf(Math.floor(t / s.grid.width));
    clearOrder(u);
  }
}
