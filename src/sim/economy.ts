import { buildingDef, unitDef } from '../data/defs';
import { tileOf } from './fixed';
import { isBlocked } from './path';
import { clearOrder, orderMove } from './movement';
import { gapToBuilding, Hv, type Building, type Player, type State, type Unit } from './state';

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
function findField(s: State, tx: number, ty: number): number {
  const W = s.grid.width;
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < s.shards.length; i++) {
    if ((s.shards[i] as number) === 0) continue;
    const x = i % W;
    const y = (i - x) / W;
    if (isBlocked(s.grid, x, y)) continue;
    const d = (x - tx) ** 2 + (y - ty) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

function nearestRefinery(s: State, owner: number, tx: number, ty: number): Building | undefined {
  let best: Building | undefined;
  let bd = Infinity;
  for (const b of s.buildings) {
    if (b.owner !== owner || !buildingDef(b.kind).refinery) continue;
    const d = gapToBuilding(b, tx, ty);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/** Free tile adjacent to the building's footprint, nearest to (tx, ty). */
function dockTile(s: State, b: Building, tx: number, ty: number): number | undefined {
  const d = buildingDef(b.kind);
  let best: number | undefined;
  let bd = Infinity;
  for (let y = b.ty - 1; y <= b.ty + d.h; y++) {
    for (let x = b.tx - 1; x <= b.tx + d.w; x++) {
      const onRing = x === b.tx - 1 || x === b.tx + d.w || y === b.ty - 1 || y === b.ty + d.h;
      if (!onRing || isBlocked(s.grid, x, y)) continue;
      const dist = (x - tx) ** 2 + (y - ty) ** 2;
      if (dist < bd) {
        bd = dist;
        best = y * s.grid.width + x;
      }
    }
  }
  return best;
}

function stepHauler(s: State, u: Unit): void {
  const cap = unitDef(u.kind).capacity as number;
  if (!u.auto) return;
  const W = s.grid.width;
  const tx = tileOf(u.x);
  const ty = tileOf(u.y);
  const stopped = u.path.length === 0 && !u.waiting;
  const throttle = (s.tick + u.id) % 10 === 0;

  switch (u.hv) {
    case Hv.Idle: {
      if (u.load >= cap) {
        u.hv = Hv.ToRefinery;
        break;
      }
      if (!throttle || !stopped) break;
      const f = findField(s, tx, ty);
      if (f < 0) {
        if (u.load > 0) u.hv = Hv.ToRefinery;
      } else if (f === ty * W + tx) u.hv = Hv.Gather;
      else {
        orderMove(s, u, f);
        u.hv = Hv.ToField;
      }
      break;
    }
    case Hv.ToField:
      if (stopped) u.hv = (s.shards[ty * W + tx] as number) > 0 ? Hv.Gather : Hv.Idle;
      break;
    case Hv.Gather: {
      const i = ty * W + tx;
      const take = Math.min(GATHER_PER_TICK, s.shards[i] as number, cap - u.load);
      if (take > 0) {
        s.shards[i] = (s.shards[i] as number) - take;
        u.load += take;
      }
      if (u.load >= cap) u.hv = Hv.ToRefinery;
      else if ((s.shards[i] as number) === 0) u.hv = Hv.Idle;
      break;
    }
    case Hv.ToRefinery: {
      const ref = nearestRefinery(s, u.owner, tx, ty);
      if (!ref) break; // wait for a refinery
      if (gapToBuilding(ref, tx, ty) <= 1) {
        clearOrder(u);
        u.hv = Hv.Unload;
      } else if (stopped && throttle) {
        const dock = dockTile(s, ref, tx, ty);
        if (dock !== undefined) orderMove(s, u, dock);
      }
      break;
    }
    case Hv.Unload: {
      const ref = nearestRefinery(s, u.owner, tx, ty);
      if (!ref || gapToBuilding(ref, tx, ty) > 1) {
        u.hv = Hv.ToRefinery;
        break;
      }
      const amt = Math.min(UNLOAD_PER_TICK, u.load);
      u.load -= amt;
      const pl = s.players[u.owner] as Player;
      const earned = Math.floor((amt * (100 + pl.bonus)) / 100);
      pl.credits += earned;
      pl.stats.shardsGathered += earned;
      if (u.load === 0) u.hv = Hv.Idle;
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
