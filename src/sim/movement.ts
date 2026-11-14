import { unitDef } from '../data/defs';
import { crushable, isCrusher } from './crush';
import { centerOf, FP, isqrt, tileOf } from './fixed';
import { descend, distanceField, FAR, findPath, isBlocked, nearestFreeTiles, type Grid } from './path';
import { Hv, type GroupRoute, type State, type Unit } from './state';

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

/**
 * Ask for a route for `u` toward tile index `goal` (SIM-10). The unit keeps walking the path it has until the new one is
 * served, so a moving unit never stops to wait. `urgent` marks an order given by a player or an AI: it is served ahead of
 * automatic re-routes. A unit stands in the queues at most once; asking again while queued only updates the goal (and
 * moves the request up front when it has become urgent).
 */
export function orderMove(s: State, u: Unit, goal: number, urgent = false, group: GroupRoute | null = null): void {
  u.goal = goal;
  u.waiting = true;
  u.group = group;
  if (!u.queued) {
    (urgent ? s.orderQueue : s.pathQueue).push(u.id);
    u.queued = true;
    u.urgent = urgent;
  } else if (urgent && !u.urgent) {
    const i = s.pathQueue.indexOf(u.id);
    if (i >= 0) s.pathQueue.splice(i, 1);
    s.orderQueue.push(u.id);
    u.urgent = true;
  }
}

export function clearOrder(u: Unit): void {
  u.path = [];
  u.goal = -1;
  u.waiting = false;
  u.group = null;
}

/** Group orders of at least this many ground units share one distance field for their routes (SIM-10). */
export const GROUP_FIELD_MIN = 8;

/**
 * Shared route work for a group order sending `units` to tile `to` (a building's middle tile when attacking one), or
 * null when there are too few ground units for it to pay (SIM-10).
 */
export function groupRoute(_s: State, units: readonly Unit[], to: number | undefined): GroupRoute | null {
  const ground = units.filter((u) => !unitDef(u.kind).air);
  if (ground.length < GROUP_FIELD_MIN || to === undefined) return null;
  return { to, rev: -1, field: null };
}

/**
 * Route finding per tick (SIM-10). Full searches are served while the nodes expanded this tick stay under PATH_WORK, but
 * never more than PATHS_MAX of them; at least PATHS_PER_TICK are served whatever they cost, and orders at least
 * ORDERS_PER_TICK. A group order's distance field is one such search (at most FIELDS_PER_TICK of them a tick); once it
 * is made, each member's route walks down it and finishes with a short search to its own tile (GROUP_NEAR), cheap
 * enough that every member is routed in the tick the field is made, within GROUP_WORK.
 */
export const PATH_WORK = 8000;
export const PATHS_PER_TICK = 6;
export const ORDERS_PER_TICK = 20;
export const PATHS_MAX = 64;
export const FIELDS_PER_TICK = 2;
export const GROUP_WORK = 40000;
/**
 * A group member walks down the group's field until it is this many tiles from its own tile, or no farther from the
 * group's destination than its own tile is plus this many tiles, then searches the rest (SIM-10).
 */
export const GROUP_NEAR = 8;
/**
 * A member whose own tile is more than this much farther (in travel cost, 10 a straight step) from the group's
 * destination than a straight line (its tile lies behind an obstacle from there) gets a full search instead (SIM-10).
 */
export const GROUP_DETOUR = 40;

const octile = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return 10 * (dx + dy) - 6 * Math.min(dx, dy);
};

/**
 * A group member's route from (sx,sy) to its own tile (gx,gy) near the group's destination `to`, using the group's
 * distance field `field` to `to` (SIM-10). It walks down the field (a shortest way to `to`) and finishes with a search
 * guided by the field, so it costs a few dozen tiles of work, not a few hundred. The route is at most twice the travel
 * cost between (gx,gy) and `to` longer than a shortest one (SIM-3): walking down the field to a tile p and on to the
 * goal costs field[s] - field[p] + d(p, goal), while no route is shorter than field[s] - field[goal]; and d(p, goal) is
 * at most field[p] + field[goal]. A member whose tile is reached from `to` only by a detour gets a full search.
 */
export function groupPath(g: Grid, field: Int32Array, to: number, sx: number, sy: number, gx: number, gy: number, work?: { expanded: number }): number[] {
  const W = g.width;
  const goal = gy * W + gx;
  // To a building: straight down the field to the nearest of the tiles next to it, a shortest route (SIM-3).
  if (isBlocked(g, gx, gy) && goal === to && (field[sy * W + sx] as number) !== FAR) return descend(g, field, sx, sy, gx, gy, -1, work);
  const at = field[goal] as number;
  if (at === FAR || (field[sy * W + sx] as number) === FAR || at > octile(gx, gy, to % W, Math.floor(to / W)) + GROUP_DETOUR) return findPath(g, sx, sy, gx, gy, work, [field]);
  const lead = descend(g, field, sx, sy, gx, gy, GROUP_NEAR, work, at + GROUP_NEAR * 10);
  if (lead.length === 0) return findPath(g, sx, sy, gx, gy, work, [field]);
  const p = lead[lead.length - 1] as number;
  const tail = findPath(g, p % W, Math.floor(p / W), gx, gy, work, [field]);
  return lead.concat(tail);
}

export function servePathQueue(s: State): void {
  if (s.orderQueue.length === 0 && s.pathQueue.length === 0) return;
  const byId = new Map<number, Unit>();
  for (const u of s.units) byId.set(u.id, u);
  const g = s.grid;
  const W = g.width;
  const work = { expanded: 0 };
  let served = 0;
  let orders = 0;
  let fields = 0;
  for (;;) {
    const urgent = s.orderQueue.length > 0;
    const q = urgent ? s.orderQueue : s.pathQueue;
    if (q.length === 0) break;
    const head = byId.get(q[0] as number);
    const group = head?.waiting && !unitDef(head.kind).air ? head.group : null;
    const ready = !!group && group.field !== null && group.rev === s.gridRev;
    if (ready) {
      // A member of a group whose field is made: cheap, served within the group allowance.
      if (work.expanded >= GROUP_WORK) break;
    } else {
      if (served >= PATHS_MAX) break;
      if (work.expanded >= PATH_WORK && served >= PATHS_PER_TICK && !(urgent && orders < ORDERS_PER_TICK)) break;
      // A group's field waits for the next tick once this tick has made its share; the queue waits behind it, in order.
      if (group && fields >= FIELDS_PER_TICK) break;
    }
    q.shift();
    const u = head;
    if (!u) continue;
    u.queued = false;
    u.urgent = false;
    if (!u.waiting) continue; // the order was dropped while it stood in line
    u.waiting = false;
    u.group = null;
    const sx = tileOf(u.x);
    const sy = tileOf(u.y);
    const gx = u.goal % W;
    const gy = Math.floor(u.goal / W);
    // The new route starts from the tile the unit stands on now, so it turns onto it without stepping back (SIM-10).
    if (unitDef(u.kind).air) u.path = [u.goal];
    else if (group) {
      if (!ready) {
        // The first of a group to be routed makes the group's distance field.
        const tx = group.to % W;
        const ty = Math.floor(group.to / W);
        // To a building (its middle tile is blocked): from every free tile a route to it may end on (SIM-3).
        group.field = distanceField(g, isBlocked(g, tx, ty) ? nearestFreeTiles(g, tx, ty) : group.to, work);
        group.rev = s.gridRev;
        fields++;
      }
      u.path = groupPath(g, group.field as Int32Array, group.to, sx, sy, gx, gy, work);
    } else u.path = findPath(g, sx, sy, gx, gy, work);
    if (!ready) served++;
    if (urgent) orders++;
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
