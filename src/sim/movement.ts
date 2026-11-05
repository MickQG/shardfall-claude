import { unitDef } from '../data/defs';
import { crushable, isCrusher } from './crush';
import { centerOf, FP, isqrt, tileOf } from './fixed';
import { findPath, isBlocked, type Grid } from './path';
import type { State, Unit } from './state';

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

/** Push overlapping ground units apart. Air units do not collide. */
const isSquad = (u: Unit): boolean => (unitDef(u.kind).squad ?? 1) > 1;

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
          if (!uHolds) {
            const pu = push.get(u.id) ?? [0, 0];
            pu[0] -= px;
            pu[1] -= py;
            push.set(u.id, pu);
          }
          if (!oHolds) {
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
    if (!p) continue;
    const nx = u.x + Math.max(-MAX_PUSH, Math.min(MAX_PUSH, p[0]));
    const ny = u.y + Math.max(-MAX_PUSH, Math.min(MAX_PUSH, p[1]));
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
