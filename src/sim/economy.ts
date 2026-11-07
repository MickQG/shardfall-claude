import { buildingDef, unitDef } from '../data/defs';
import { tileOf } from './fixed';
import { isBlocked } from './path';
import { clearOrder, orderMove, ringTiles } from './movement';
import { buildingById, gapToBuilding, Hv, type Building, type Player, type State, type Unit } from './state';

/** Shards a hauler takes per tick while on a field, and delivers per tick while unloading. */
export const GATHER_PER_TICK = 4;
export const UNLOAD_PER_TICK = 10;
const REGROW_EVERY = 100;
const REGROW_STEP = 5;

export function updatePower(s: State): void {
  for (const p of s.players) {
    p.powerOut = 0;
    p.powerIn = 0;
  }
  for (const b of s.buildings) {
    const p = s.players[b.owner];
    if (!p) continue;
    const pw = buildingDef(b.kind).power;
    if (pw > 0) p.powerOut += pw;
    else p.powerIn -= pw;
  }
}

export const isLowPower = (s: State, owner: number): boolean => {
  const p = s.players[owner];
  return !!p && p.powerIn > p.powerOut;
};

/** Nearest tile index with shards that a ground unit can stand on, or -1. */
/**
 * Ties go to the first tile in scan order. Player 1 scans the map from the far end, so on a point-symmetric map (MAP-4)
 * both players' harvesters break ties as mirror images instead of both leaning toward the same corner.
 */
const scanIndex = (owner: number, k: number, n: number): number => (owner % 2 === 1 ? n - 1 - k : k);

function findField(s: State, tx: number, ty: number, owner: number, around = -1): number {
  const W = s.grid.width;
  let best = -1;
  let bd = Infinity;
  const n = s.shards.length;
  for (let k = 0; k < n; k++) {
    const i = scanIndex(owner, k, n);
    if ((s.shards[i] as number) === 0) continue;
    const x = i % W;
    const y = (i - x) / W;
    if (isBlocked(s.grid, x, y)) continue;
    if (around >= 0 && Math.max(Math.abs(x - (around % W)), Math.abs(y - Math.floor(around / W))) > FIELD_RADIUS) continue;
    const d = (x - tx) ** 2 + (y - ty) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** A hauler's field is the shards within this many tiles (Chebyshev) of its home tile (ECO-8). */
const FIELD_RADIUS = 8;
/** Within this many tiles (Chebyshev) of the pad, a hauler takes the pad or joins the line beside it (ECO-8). */
const PAD_NEAR = 5;
/** Tries at reaching a pad (one every ten ticks while stopped short of it) before unloading beside the refinery instead. */
export const DOCK_TRIES = 6;
/** Waiting spots beside a pad; a longer line shares the last one. */
const LINE_SPOTS = 4;
/** How heavily a busy pad counts against another refinery, in tiles per hauler ahead, for a hauler waiting long (ECO-9). */
const BUSY_TILES = 8;
/** Ticks a hauler waits in line before it looks for a less busy refinery (ECO-9). */
export const LINE_PATIENCE = 300;
/** Ticks before the pad comes free that the first hauler in line sets off for it (ECO-8). */
const ROLL_UP = 8;

const isRefineryOf = (b: Building | undefined, owner: number): b is Building => !!b && b.owner === owner && !!buildingDef(b.kind).refinery;

/** The pad tile index of a refinery (ECO-7). */
function padIndex(s: State, b: Building): number {
  const p = b.pad as [number, number];
  return p[1] * s.grid.width + p[0];
}

/** The hauler holding a refinery's pad: driving onto it or unloading on it (ECO-7). */
const padHolder = (s: State, b: Building): Unit | undefined => s.units.find((u) => u.auto && u.dock === b.id && (u.hv === Hv.ToPad || u.hv === Hv.Unload));

/** Haulers waiting in a refinery's line, first come first served (ECO-8). */
function padLine(s: State, b: Building): Unit[] {
  return s.units.filter((u) => u.auto && u.dock === b.id && u.hv === Hv.Queue).sort((a, c) => a.queuedAt - c.queuedAt || a.id - c.id);
}

/** How many haulers are ahead at a refinery's pad: its holder and its line, not counting `u` (ECO-8). */
function busy(s: State, b: Building, u: Unit): number {
  let n = 0;
  for (const o of s.units) if (o !== u && o.auto && o.dock === b.id && (o.hv === Hv.ToPad || o.hv === Hv.Unload || o.hv === Hv.Queue)) n++;
  return n;
}

/** The refinery to deliver to: the one whose dock pad is nearest the hauler's field, however busy it is (ECO-8). */
function chooseRefinery(s: State, u: Unit, tx: number, ty: number): Building | undefined {
  const W = s.grid.width;
  const fx = u.home >= 0 ? u.home % W : tx;
  const fy = u.home >= 0 ? Math.floor(u.home / W) : ty;
  let best: Building | undefined;
  let bd = Infinity;
  for (const b of s.buildings) {
    if (!isRefineryOf(b, u.owner)) continue;
    const p = b.pad as [number, number];
    const d = (p[0] - fx) ** 2 + (p[1] - fy) ** 2;
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/** A refinery other than `avoid` that would serve a hauler waiting in line sooner: near it and with few ahead (ECO-9). */
function lessBusyRefinery(s: State, u: Unit, tx: number, ty: number, avoid: number, ahead: number): Building | undefined {
  let best: Building | undefined;
  let bd = BUSY_TILES * ahead;
  for (const b of s.buildings) {
    if (!isRefineryOf(b, u.owner) || b.id === avoid) continue;
    const d = gapToBuilding(b, tx, ty) + BUSY_TILES * busy(s, b, u);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/**
 * Where a hauler n-th in line waits (ECO-8): a free tile next to the pad with a straight step onto it, on the side the
 * hauler comes from so it never drives across the pad to get there (the n-th nearest to it), else further round.
 */
function lineSpot(s: State, b: Building, n: number, u: Unit): number {
  const g = s.grid;
  const pad = padIndex(s, b);
  const px = pad % g.width;
  const py = Math.floor(pad / g.width);
  const ring = ringTiles(g, px, py, LINE_SPOTS + 9).filter((i) => i !== pad);
  // Ties go by scan order, from the far end for player 1, so mirrored lines wait on mirrored spots (MAP-4).
  if (b.owner % 2 === 1) ring.reverse();
  const direct = (i: number): boolean => {
    const dx = (i % g.width) - px;
    const dy = Math.floor(i / g.width) - py;
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return false;
    return dx === 0 || dy === 0 || (!isBlocked(g, px + dx, py) && !isBlocked(g, px, py + dy));
  };
  const ux = tileOf(u.x);
  const uy = tileOf(u.y);
  const far = (i: number): number => ((i % g.width) - ux) ** 2 + (Math.floor(i / g.width) - uy) ** 2;
  const byNear = (a: number, c: number): number => far(a) - far(c);
  // Best of all: beside the pad along the refinery's wall, clear of the lane haulers use to drive on and off (ECO-8).
  const d = buildingDef(b.kind);
  const wall = (i: number): boolean => gapToBuilding(b, i % g.width, Math.floor(i / g.width)) === 1 && Math.abs((i % g.width) - px) + Math.abs(Math.floor(i / g.width) - py) === 1 && touches(b, d, i % g.width, Math.floor(i / g.width));
  const rank = (i: number): number => (wall(i) ? 0 : direct(i) ? 1 : 2);
  const spots = [...ring].sort((a, c) => rank(a) - rank(c) || byNear(a, c));
  return spots[Math.max(0, Math.min(n, spots.length - 1))] ?? pad;
}

/** Whether tile (x, y), outside the footprint, shares a side with it. */
function touches(b: Building, d: { w: number; h: number }, x: number, y: number): boolean {
  const inX = x >= b.tx && x < b.tx + d.w;
  const inY = y >= b.ty && y < b.ty + d.h;
  return (inX && (y === b.ty - 1 || y === b.ty + d.h)) || (inY && (x === b.tx - 1 || x === b.tx + d.w));
}

/** Free tile adjacent to the building's footprint other than its pad, nearest to (tx, ty): where a hauler unloads if the pad cannot be reached. */
function besideTile(s: State, b: Building, tx: number, ty: number): number | undefined {
  const d = buildingDef(b.kind);
  let best: number | undefined;
  let bd = Infinity;
  const rows = d.h + 2;
  const cols = d.w + 2;
  for (let k = 0; k < rows * cols; k++) {
    const j = scanIndex(b.owner, k, rows * cols);
    const x = b.tx - 1 + (j % cols);
    const y = b.ty - 1 + Math.floor(j / cols);
    const onRing = x === b.tx - 1 || x === b.tx + d.w || y === b.ty - 1 || y === b.ty + d.h;
    if (!onRing || isBlocked(s.grid, x, y) || (b.pad && b.pad[0] === x && b.pad[1] === y)) continue;
    const dist = (x - tx) ** 2 + (y - ty) ** 2;
    if (dist < bd) {
      bd = dist;
      best = y * s.grid.width + x;
    }
  }
  return best;
}

/** Let go of the refinery (freeing its pad or a place in its line) and move on (ECO-7). */
function undock(u: Unit, hv: Hv): void {
  u.dock = -1;
  u.dockTries = 0;
  u.hv = hv;
}

/** Take the pad and drive onto it (ECO-7). */
function takePad(s: State, u: Unit, b: Building): void {
  u.hv = Hv.ToPad;
  u.dock = b.id;
  u.dockTries = 0;
  const pad = padIndex(s, b);
  // Already on its way there: keep going rather than stop for a fresh path.
  if (u.goal !== pad || (u.path.length === 0 && !u.waiting)) orderMove(s, u, pad);
}

/** Head for the nearest shard field, or deliver what it carries if none is left. */
function seekField(s: State, u: Unit, tx: number, ty: number): void {
  const here = ty * s.grid.width + tx;
  // Back to its own field; any other only when that one is used up (ECO-8).
  let f = findField(s, tx, ty, u.owner, u.home);
  if (f < 0) f = findField(s, tx, ty, u.owner);
  if (f >= 0) u.home = u.home < 0 || Math.max(Math.abs((f % s.grid.width) - (u.home % s.grid.width)), Math.abs(Math.floor(f / s.grid.width) - Math.floor(u.home / s.grid.width))) > FIELD_RADIUS ? f : u.home;
  if (f < 0) {
    if (u.load > 0) u.hv = Hv.ToRefinery;
  } else if (f === here) u.hv = Hv.Gather;
  else {
    orderMove(s, u, f);
    u.hv = Hv.ToField;
  }
}

function stepHauler(s: State, u: Unit): void {
  const cap = unitDef(u.kind).capacity as number;
  if (!u.auto) return;
  const W = s.grid.width;
  const tx = tileOf(u.x);
  const ty = tileOf(u.y);
  const here = ty * W + tx;
  const stopped = u.path.length === 0 && !u.waiting;
  const throttle = (s.tick + u.id) % 10 === 0;

  switch (u.hv) {
    case Hv.Idle: {
      if (u.load >= cap) {
        u.hv = Hv.ToRefinery;
        break;
      }
      if (throttle && stopped) seekField(s, u, tx, ty);
      break;
    }
    case Hv.ToField:
      if (stopped) u.hv = (s.shards[here] as number) > 0 ? Hv.Gather : Hv.Idle;
      break;
    case Hv.Gather: {
      if (u.home < 0) u.home = here;
      const take = Math.min(GATHER_PER_TICK, s.shards[here] as number, cap - u.load);
      if (take > 0) {
        s.shards[here] = (s.shards[here] as number) - take;
        u.load += take;
      }
      if (u.load >= cap) u.hv = Hv.ToRefinery;
      else if ((s.shards[here] as number) === 0) u.hv = Hv.Idle;
      break;
    }
    case Hv.ToRefinery: {
      // Head for a refinery's pad; close to it, take the pad if it is free and nobody waits, else join the line (ECO-8).
      let ref = buildingById(s, u.dock);
      if (!isRefineryOf(ref, u.owner)) {
        u.dock = -1;
        ref = chooseRefinery(s, u, tx, ty);
        if (!ref) break; // wait for a refinery (ECO-3)
        u.dock = ref.id;
      }
      const pad = padIndex(s, ref);
      const dist = Math.max(Math.abs((pad % W) - tx), Math.abs(Math.floor(pad / W) - ty));
      if (dist <= PAD_NEAR) {
        // The pad is taken only on the last step onto it (or when stopped short of it), so it is never held for long.
        const line = padLine(s, ref);
        const free = !padHolder(s, ref) && line.length === 0;
        if (free && (dist <= 1 || (stopped && u.goal === pad))) {
          takePad(s, u, ref);
          break;
        }
        if (!free) {
          u.hv = Hv.Queue;
          u.queuedAt = s.tick;
          orderMove(s, u, lineSpot(s, ref, line.length, u));
          break;
        }
      }
      if (stopped && (throttle || u.goal !== pad)) orderMove(s, u, pad); // set off at once, then retry now and then
      break;
    }
    case Hv.Queue: {
      const ref = buildingById(s, u.dock);
      if (!isRefineryOf(ref, u.owner)) {
        undock(u, Hv.ToRefinery); // the refinery is gone: find another (ECO-9)
        break;
      }
      const at = padLine(s, ref).indexOf(u);
      const holder = padHolder(s, ref);
      if (at === 0 && !holder) {
        takePad(s, u, ref);
        break;
      }
      // First in line and the pad about to come free: roll up to it now, so the pad never stands idle (ECO-8). The
      // unloading hauler holds its place meanwhile; this one takes the pad only once it is free.
      if (at === 0 && holder && holder.hv === Hv.Unload && holder.load <= UNLOAD_PER_TICK * ROLL_UP && u.goal !== padIndex(s, ref)) {
        orderMove(s, u, padIndex(s, ref));
        break;
      }
      if (!throttle) break;
      // Waited long enough: a less busy refinery may serve sooner (ECO-9).
      if (s.tick - u.queuedAt > LINE_PATIENCE) {
        const other = lessBusyRefinery(s, u, tx, ty, ref.id, at + 1);
        if (other) {
          undock(u, Hv.ToRefinery);
          u.dock = other.id;
          orderMove(s, u, padIndex(s, other));
          break;
        }
      }
      const spot = lineSpot(s, ref, at, u);
      if (stopped && here !== spot && !(at === 0 && u.goal === padIndex(s, ref))) orderMove(s, u, spot);
      break;
    }
    case Hv.ToPad: {
      const ref = buildingById(s, u.dock);
      if (!isRefineryOf(ref, u.owner)) {
        undock(u, Hv.ToRefinery);
        break;
      }
      const pad = padIndex(s, ref);
      if (here === pad) {
        u.hv = Hv.Unload; // unloading starts on rolling onto the pad; it pulls up at the centre meanwhile
        break;
      }
      if (!stopped || !throttle) break;
      // Stopped short of the pad: try again; if it stays out of reach, unload beside the refinery instead (ECO-9).
      u.dockTries++;
      if (u.dockTries <= DOCK_TRIES) orderMove(s, u, pad);
      else if (gapToBuilding(ref, tx, ty) <= 1) u.hv = Hv.Unload;
      else {
        const beside = besideTile(s, ref, tx, ty);
        if (beside !== undefined && u.dockTries <= 3 * DOCK_TRIES) orderMove(s, u, beside);
        else undock(u, Hv.ToRefinery);
      }
      break;
    }
    case Hv.Unload: {
      const ref = buildingById(s, u.dock);
      if (!isRefineryOf(ref, u.owner)) {
        undock(u, Hv.ToRefinery);
        break;
      }
      // Unload only on the pad, unless the pad proved out of reach and the hauler stands beside the refinery (ECO-9).
      const fallback = u.dockTries > DOCK_TRIES && gapToBuilding(ref, tx, ty) <= 1;
      if (here !== padIndex(s, ref) && !fallback) {
        u.hv = Hv.ToPad; // nudged off the pad: drive back on, keeping it
        if (stopped) orderMove(s, u, padIndex(s, ref));
        break;
      }
      if (u.goal !== padIndex(s, ref)) clearOrder(u);
      const amt = Math.min(UNLOAD_PER_TICK, u.load);
      u.load -= amt;
      const pl = s.players[u.owner] as Player;
      const earned = Math.floor((amt * (100 + pl.bonus)) / 100);
      pl.credits += earned;
      pl.stats.shardsGathered += earned;
      if (u.load === 0) {
        // Free the pad and drive straight off, back to the field.
        undock(u, Hv.Idle);
        seekField(s, u, tx, ty);
      }
      break;
    }
  }
}

export function tickHaulers(s: State): void {
  for (const u of s.units) if (unitDef(u.kind).capacity !== undefined) stepHauler(s, u);
}

/** Seed tiles slowly regrow toward half of their original amount. */
export function regrow(s: State): void {
  if (s.tick % REGROW_EVERY !== 0) return;
  for (let i = 0; i < s.shards.length; i++) {
    const seed = s.shardSeed[i] as number;
    if (seed === 0) continue;
    const cap = seed >> 1;
    const cur = s.shards[i] as number;
    if (cur < cap) s.shards[i] = Math.min(cap, cur + REGROW_STEP);
  }
}
