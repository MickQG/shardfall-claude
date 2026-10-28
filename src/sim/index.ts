import { unitDef } from '../data/defs';
import { centerOf, FP, isqrt, tileOf } from './fixed';
import { Hasher } from './hash';
import { findPath, isBlocked, type Grid } from './path';
import { Rng } from './rng';
import type { Command, GameConfig, Snapshot } from './types';

export type { Command, GameConfig, MapDef, Snapshot, UnitSnap, UnitSpawn } from './types';
export { Rng } from './rng';
export { FP } from './fixed';

export const TICKS_PER_SECOND = 20;

interface Unit {
  id: number;
  owner: number;
  kind: string;
  x: number;
  y: number;
  hp: number;
  /** Remaining tile indices to walk through. */
  path: number[];
  /** Assigned destination tile index, or -1. */
  goal: number;
  /** True while a path request for `goal` is queued. */
  waiting: boolean;
}

interface State {
  tick: number;
  rng: Rng;
  cfg: GameConfig;
  grid: Grid;
  units: Unit[];
  nextId: number;
  pending: Command[];
  pathQueue: number[];
}

export interface Game {
  readonly state: State;
}

export function createGame(cfg: GameConfig): Game {
  const { width, height } = cfg.map;
  const blocked = new Uint8Array(width * height);
  cfg.map.blocked?.forEach((v, i) => {
    blocked[i] = v ? 1 : 0;
  });
  const state: State = {
    tick: 0,
    rng: new Rng(cfg.seed),
    cfg,
    grid: { width, height, blocked },
    units: [],
    nextId: 1,
    pending: [],
    pathQueue: [],
  };
  for (const s of cfg.units ?? []) {
    unitDef(s.kind);
    state.units.push({ id: state.nextId++, owner: s.owner, kind: s.kind, x: centerOf(s.tx), y: centerOf(s.ty), hp: unitDef(s.kind).hp, path: [], goal: -1, waiting: false });
  }
  return { state };
}

export function submit(game: Game, cmd: Command): void {
  game.state.pending.push(cmd);
}

/** Free tiles around (tx,ty) in deterministic ring order, nearest first. */
function ringTiles(g: Grid, tx: number, ty: number, count: number): number[] {
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

function applyCommand(s: State, cmd: Command): void {
  if (cmd.type !== 'move') return;
  const mine = s.units.filter((u) => u.owner === cmd.player && cmd.units.includes(u.id));
  if (mine.length === 0) return;
  const g = s.grid;
  const goals = ringTiles(g, tileOf(cmd.x), tileOf(cmd.y), mine.length);
  // Assign nearest-first goals to units in id order, greedily, for a stable distinct assignment.
  const free = goals.slice();
  for (const u of mine) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < free.length; i++) {
      const gi = free[i] as number;
      const gx = centerOf(gi % g.width);
      const gy = centerOf(Math.floor(gi / g.width));
      const d = Math.abs(gx - u.x) + Math.abs(gy - u.y);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    const goal = free.splice(bi, 1)[0];
    if (goal === undefined) {
      u.path = [];
      u.goal = -1;
      continue;
    }
    u.goal = goal;
    u.path = [];
    u.waiting = true;
    s.pathQueue.push(u.id);
  }
}

/** Path searches allowed per tick; the rest wait their turn in FIFO order (keeps tick time flat). */
export const PATHS_PER_TICK = 6;

function servePathQueue(s: State): void {
  let served = 0;
  while (served < PATHS_PER_TICK && s.pathQueue.length > 0) {
    const id = s.pathQueue.shift() as number;
    const u = s.units.find((x) => x.id === id);
    if (!u || !u.waiting) continue;
    u.waiting = false;
    u.path = findPath(s.grid, tileOf(u.x), tileOf(u.y), u.goal % s.grid.width, Math.floor(u.goal / s.grid.width));
    served++;
  }
}

function stepUnit(s: State, u: Unit): void {
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

function separate(s: State): void {
  const g = s.grid;
  const buckets = new Map<number, Unit[]>();
  for (const u of s.units) {
    const key = tileOf(u.y) * g.width + tileOf(u.x);
    const b = buckets.get(key);
    if (b) b.push(u);
    else buckets.set(key, [u]);
  }
  const push = new Map<number, [number, number]>();
  for (const u of s.units) {
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
          const pu = push.get(u.id) ?? [0, 0];
          pu[0] -= px;
          pu[1] -= py;
          push.set(u.id, pu);
          const po = push.get(o.id) ?? [0, 0];
          po[0] += px;
          po[1] += py;
          push.set(o.id, po);
        }
      }
    }
  }
  for (const u of s.units) {
    const p = push.get(u.id);
    if (!p) continue;
    const nx = u.x + Math.max(-FP / 8, Math.min(FP / 8, p[0]));
    const ny = u.y + Math.max(-FP / 8, Math.min(FP / 8, p[1]));
    if (!isBlocked(g, tileOf(nx), tileOf(ny))) {
      u.x = nx;
      u.y = ny;
    }
  }
}

export function tick(game: Game): void {
  const s = game.state;
  for (const cmd of s.pending) applyCommand(s, cmd);
  s.pending.length = 0;
  servePathQueue(s);
  for (const u of s.units) stepUnit(s, u);
  separate(s);
  s.rng.nextU32();
  s.tick += 1;
}

export function snapshot(game: Game): Snapshot {
  const { cfg, tick: t, units } = game.state;
  return {
    tick: t,
    mapWidth: cfg.map.width,
    mapHeight: cfg.map.height,
    heights: cfg.map.heights,
    units: units.map((u) => ({ id: u.id, owner: u.owner, kind: u.kind, x: u.x, y: u.y, hp: u.hp, dest: u.goal >= 0 ? [u.goal % cfg.map.width, Math.floor(u.goal / cfg.map.width)] : null })),
  };
}

export function hash(game: Game): number {
  const s = game.state;
  const h = new Hasher().int(s.tick).int(s.rng.state).int(s.cfg.map.width).int(s.cfg.map.height);
  for (const v of s.cfg.map.heights) h.int(v);
  for (const v of s.grid.blocked) h.int(v);
  for (const u of s.units) h.int(u.id).int(u.owner).int(u.x).int(u.y).int(u.hp).int(u.path.length).int(u.goal).int(u.waiting ? 1 : 0);
  return h.value;
}
