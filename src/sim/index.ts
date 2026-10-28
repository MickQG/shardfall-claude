import { buildingDef, unitDef } from '../data/defs';
import { regrow, tickHaulers, updatePower } from './economy';
import { centerOf, tileOf } from './fixed';
import { recomputeVisible, VISIBLE, type VisionSource } from './fog';
import { Hasher } from './hash';
import { clearOrder, orderMove, ringTiles, separate, servePathQueue, stepUnit } from './movement';
import { cancel, enqueue, place, sell, setRally, setRepair, tickProduction } from './production';
import { createState, Hv, type Building, type State } from './state';
import type { BuildingSnap, Command, GameConfig, Snapshot } from './types';

export type { BuildingSnap, BuildingSpawn, Command, GameConfig, MapDef, PlayerSetup, PlayerSnap, QueueSnap, Snapshot, UnitSnap, UnitSpawn } from './types';
export { Rng } from './rng';
export { FP } from './fixed';
export { EXPLORED, VISIBLE } from './fog';
export { BUILD_RANGE, canPlace, type Footprint, type PlacementContext } from './placement';
export { canQueue } from './production';
export { QUEUE_MAX } from './state';
export { PATHS_PER_TICK } from './movement';

export const TICKS_PER_SECOND = 20;

export interface Game {
  readonly state: State;
}

export function createGame(cfg: GameConfig): Game {
  const state = createState(cfg);
  updatePower(state);
  updateFog(state);
  return { state };
}

export function submit(game: Game, cmd: Command): void {
  game.state.pending.push(cmd);
}

const isBuildingVisible = (s: State, fog: Uint8Array, b: Building): boolean => {
  const d = buildingDef(b.kind);
  for (let y = b.ty; y < b.ty + d.h; y++) for (let x = b.tx; x < b.tx + d.w; x++) if ((fog[y * s.grid.width + x] as number) & VISIBLE) return true;
  return false;
};

function buildingSnap(b: Building, detail: boolean): BuildingSnap {
  const d = buildingDef(b.kind);
  return {
    id: b.id,
    owner: b.owner,
    kind: b.kind,
    tx: b.tx,
    ty: b.ty,
    hp: b.hp,
    queue: detail ? b.queue.map((q) => ({ kind: q.kind, pct: Math.min(100, Math.floor((q.progress * 100) / Math.max(1, q.total))), ready: q.ready })) : [],
    repairing: b.repairing,
    charge: detail && d.superweapon ? Math.min(100, Math.floor((b.charge * 100) / d.superweapon.charge)) : 0,
  };
}

function updateFog(s: State): void {
  const { width, height } = s.grid;
  s.fog.forEach((fog, player) => {
    const sources: VisionSource[] = [];
    for (const u of s.units) if (u.owner === player) sources.push({ tx: tileOf(u.x), ty: tileOf(u.y), r: unitDef(u.kind).vision });
    for (const b of s.buildings) {
      if (b.owner !== player) continue;
      const d = buildingDef(b.kind);
      sources.push({ tx: b.tx + (d.w >> 1), ty: b.ty + (d.h >> 1), r: d.vision });
    }
    recomputeVisible(fog, width, height, sources);

    // Remember enemy buildings that have been seen; forget ghosts whose tiles are in view and empty.
    const ghosts = s.players[player]?.ghosts;
    if (!ghosts) return;
    const live = new Set<number>();
    for (const b of s.buildings) {
      live.add(b.id);
      if (b.owner !== player && isBuildingVisible(s, fog, b)) ghosts.set(b.id, buildingSnap(b, false));
    }
    for (const [id, g] of ghosts) {
      if (live.has(id)) continue;
      const d = buildingDef(g.kind);
      let seen = false;
      for (let y = g.ty; y < g.ty + d.h && !seen; y++) for (let x = g.tx; x < g.tx + d.w; x++) if ((fog[y * width + x] as number) & VISIBLE) seen = true;
      if (seen) ghosts.delete(id);
    }
  });
}

function applyCommand(s: State, cmd: Command): void {
  switch (cmd.type) {
    case 'stop':
      for (const u of s.units) {
        if (u.owner !== cmd.player || !cmd.units.includes(u.id)) continue;
        clearOrder(u);
        u.target = -1;
        if (unitDef(u.kind).capacity !== undefined) u.auto = false;
      }
      return;
    case 'move':
      return moveUnits(s, cmd.player, cmd.units, cmd.x, cmd.y);
    case 'harvest': {
      for (const u of s.units) {
        if (u.owner !== cmd.player || !cmd.units.includes(u.id) || unitDef(u.kind).capacity === undefined) continue;
        u.auto = true;
        clearOrder(u);
        u.hv = Hv.Idle;
        const i = tileOf(cmd.y) * s.grid.width + tileOf(cmd.x);
        if ((s.shards[i] as number) > 0) {
          orderMove(s, u, i);
          u.hv = Hv.ToField;
        }
      }
      return;
    }
    case 'produce':
      return enqueue(s, cmd.player, cmd.source, cmd.kind);
    case 'cancel':
      return cancel(s, cmd.player, cmd.source, cmd.index);
    case 'place':
      return place(s, cmd.player, cmd.source, cmd.tx, cmd.ty);
    case 'sell':
      return sell(s, cmd.player, cmd.building);
    case 'repair':
      return setRepair(s, cmd.player, cmd.building, cmd.on);
    case 'rally':
      return setRally(s, cmd.player, cmd.building, cmd.x, cmd.y);
    default:
      return;
  }
}

function moveUnits(s: State, player: number, ids: number[], x: number, y: number): void {
  const mine = s.units.filter((u) => u.owner === player && ids.includes(u.id));
  if (mine.length === 0) return;
  const g = s.grid;
  const air = mine.filter((u) => unitDef(u.kind).air);
  const ground = mine.filter((u) => !unitDef(u.kind).air);
  for (const u of air) {
    const i = Math.max(0, Math.min(g.height - 1, tileOf(y))) * g.width + Math.max(0, Math.min(g.width - 1, tileOf(x)));
    u.auto = false;
    orderMove(s, u, i);
  }
  const free = ringTiles(g, tileOf(x), tileOf(y), ground.length);
  for (const u of ground) {
    u.auto = false;
    u.hv = Hv.Idle;
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < free.length; i++) {
      const gi = free[i] as number;
      const d = Math.abs(centerOf(gi % g.width) - u.x) + Math.abs(centerOf(Math.floor(gi / g.width)) - u.y);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    const goal = free.splice(bi, 1)[0];
    if (goal === undefined) {
      clearOrder(u);
      continue;
    }
    orderMove(s, u, goal);
  }
}

export function tick(game: Game): void {
  const s = game.state;
  for (const cmd of s.pending) applyCommand(s, cmd);
  s.pending.length = 0;
  updatePower(s);
  tickProduction(s);
  servePathQueue(s);
  tickHaulers(s);
  for (const u of s.units) stepUnit(s, u);
  separate(s);
  regrow(s);
  updateFog(s);
  s.rng.nextU32();
  s.tick += 1;
}

/**
 * Snapshot of the game. With a `viewer`, it is limited to what that player may see
 * (own entities always, enemies only on visible tiles) and carries their fog grid.
 * Without one it is the god view (tests, replays).
 */
export function snapshot(game: Game, viewer?: number): Snapshot {
  const s = game.state;
  const { cfg, units, buildings, fog } = s;
  const w = cfg.map.width;
  const god = viewer === undefined;
  const vf = god ? null : (fog[viewer] as Uint8Array);
  const visibleUnits = units.filter((u) => vf === null || u.owner === viewer || ((vf[tileOf(u.y) * w + tileOf(u.x)] as number) & VISIBLE) !== 0);
  const visibleBuildings = buildings.filter((b) => vf === null || b.owner === viewer || isBuildingVisible(s, vf, b));
  const shown = new Set(visibleBuildings.map((b) => b.id));
  const shards = new Uint16Array(s.shards.length);
  for (let i = 0; i < shards.length; i++) if (vf === null || (vf[i] as number) !== 0) shards[i] = s.shards[i] as number;
  return {
    tick: s.tick,
    mapWidth: w,
    mapHeight: cfg.map.height,
    heights: cfg.map.heights,
    units: visibleUnits.map((u) => ({
      id: u.id, owner: u.owner, kind: u.kind, x: u.x, y: u.y, hp: u.hp, load: u.load,
      dest: u.goal >= 0 ? [u.goal % w, Math.floor(u.goal / w)] : null,
    })),
    buildings: visibleBuildings.map((b) => buildingSnap(b, god || b.owner === viewer)),
    ghosts: god ? [] : [...(s.players[viewer]?.ghosts.values() ?? [])].filter((g) => !shown.has(g.id)),
    shards,
    players: s.players.map((p, i) => (god || i === viewer ? { faction: p.faction, credits: p.credits, powerOut: p.powerOut, powerIn: p.powerIn } : { faction: p.faction, credits: 0, powerOut: 0, powerIn: 0 })),
    viewer: viewer ?? null,
    fog: vf ? vf.slice() : null,
  };
}

export function hash(game: Game): number {
  const s = game.state;
  const h = new Hasher().int(s.tick).int(s.rng.state).int(s.cfg.map.width).int(s.cfg.map.height);
  for (const v of s.cfg.map.heights) h.int(v);
  for (const v of s.grid.blocked) h.int(v);
  for (const u of s.units) h.int(u.id).int(u.owner).int(u.x).int(u.y).int(u.hp).int(u.path.length).int(u.goal).int(u.waiting ? 1 : 0).int(u.load).int(u.hv).int(u.auto ? 1 : 0);
  for (const b of s.buildings) {
    h.int(b.id).int(b.owner).int(b.tx).int(b.ty).int(b.hp).int(b.queue.length).int(b.charge);
    for (const q of b.queue) h.int(q.progress).int(q.ready ? 1 : 0);
  }
  for (const p of s.players) h.int(p.credits).int(p.powerOut).int(p.powerIn);
  for (const f of s.fog) for (const v of f) h.int(v);
  for (const v of s.shards) h.int(v);
  return h.value;
}
