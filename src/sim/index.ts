import { buildingDef, unitDef } from '../data/defs';
import { fireSuperweapon, tickCombat } from './combat';
import { regrow, tickHaulers, updatePower } from './economy';
import { centerOf, tileOf } from './fixed';
import { recomputeVisible, VISIBLE, type VisionSource } from './fog';
import { Hasher } from './hash';
import { clearOrder, orderMove, ringTiles, separate, servePathQueue, stepUnit } from './movement';
import { cancel, enqueue, place, sell, setRally, setRepair, tickProduction } from './production';
import { createState, Hv, STATS_EVERY, type Building, type State } from './state';
import type { BuildingSnap, Command, GameConfig, Snapshot } from './types';

export type { BuildingSnap, BuildingSpawn, Command, GameConfig, MapDef, PlayerSetup, PlayerSnap, PlayerStats, QueueSnap, SimEvent, Snapshot, UnitSnap, UnitSpawn } from './types';
export { damageAgainst } from './combat';
export { Rng } from './rng';
export { FP } from './fixed';
export { EXPLORED, VISIBLE } from './fog';
export { BUILD_RANGE, canPlace, type Footprint, type PlacementContext } from './placement';
export { canQueue } from './production';
export { QUEUE_MAX, STATS_EVERY } from './state';
export { maxHpOf, MAX_RANK, rankFor, RANK_XP, squadAlive, unitDamage } from './units';
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
    rally: detail ? b.rally : null,
    charge: detail && d.superweapon ? Math.min(100, Math.floor((b.charge * 100) / d.superweapon.charge)) : 0,
  };
}

function updateFog(s: State): void {
  const { width, height } = s.grid;
  if (s.lingering.length > 0) s.lingering = s.lingering.filter((l) => l.until > s.tick);
  s.fog.forEach((fog, player) => {
    const sources: VisionSource[] = [];
    for (const l of s.lingering) if (l.owner === player) sources.push({ tx: l.tx, ty: l.ty, r: l.r });
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
        u.mode = 'idle';
        u.amove = -1;
        if (unitDef(u.kind).capacity !== undefined) u.auto = false;
      }
      return;
    case 'move':
      return moveUnits(s, cmd.player, cmd.units, cmd.x, cmd.y, 'move');
    case 'attackmove':
      return moveUnits(s, cmd.player, cmd.units, cmd.x, cmd.y, 'amove');
    case 'attack': {
      const target = s.units.some((q) => q.id === cmd.target && q.owner !== cmd.player) || s.buildings.some((q) => q.id === cmd.target && q.owner !== cmd.player);
      if (!target) return;
      for (const u of s.units) {
        if (u.owner !== cmd.player || !cmd.units.includes(u.id) || !unitDef(u.kind).weapon) continue;
        clearOrder(u);
        u.auto = false;
        u.mode = 'attack';
        u.target = cmd.target;
        u.amove = -1;
      }
      return;
    }
    case 'superweapon':
      return fireSuperweapon(s, cmd.player, cmd.building, cmd.x, cmd.y);
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

function moveUnits(s: State, player: number, ids: number[], x: number, y: number, mode: 'move' | 'amove'): void {
  const mine = s.units.filter((u) => u.owner === player && ids.includes(u.id));
  if (mine.length === 0) return;
  const g = s.grid;
  const air = mine.filter((u) => unitDef(u.kind).air);
  const ground = mine.filter((u) => !unitDef(u.kind).air);
  for (const u of air) {
    const i = Math.max(0, Math.min(g.height - 1, tileOf(y))) * g.width + Math.max(0, Math.min(g.width - 1, tileOf(x)));
    u.auto = false;
    u.mode = mode;
    u.target = -1;
    u.amove = mode === 'amove' ? i : -1;
    orderMove(s, u, i);
  }
  const free = ringTiles(g, tileOf(x), tileOf(y), ground.length);
  for (const u of ground) {
    u.auto = false;
    u.hv = Hv.Idle;
    u.mode = mode;
    u.target = -1;
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
    u.amove = mode === 'amove' ? goal : -1;
    orderMove(s, u, goal);
  }
}

export function tick(game: Game): void {
  const s = game.state;
  s.events.length = 0;
  for (const cmd of s.pending) applyCommand(s, cmd);
  s.pending.length = 0;
  updatePower(s);
  tickProduction(s);
  tickCombat(s);
  servePathQueue(s);
  tickHaulers(s);
  for (const u of s.units) stepUnit(s, u);
  separate(s);
  regrow(s);
  updateFog(s);
  if (s.tick % STATS_EVERY === 0 && !s.over) sampleArmy(s);
  s.rng.nextU32();
  s.tick += 1;
}

/** Record each player's army value (unit cost scaled by health) for the score graph. */
function sampleArmy(s: State): void {
  s.players.forEach((p, i) => {
    let v = 0;
    for (const u of s.units) if (u.owner === i) v += Math.floor((unitDef(u.kind).cost * u.hp) / unitDef(u.kind).hp);
    p.stats.army.push(v);
  });
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
      id: u.id, owner: u.owner, kind: u.kind, x: u.x, y: u.y, hp: u.hp, load: u.load, rank: u.rank, target: u.target,
      dest: u.goal >= 0 ? [u.goal % w, Math.floor(u.goal / w)] : null,
    })),
    buildings: visibleBuildings.map((b) => buildingSnap(b, god || b.owner === viewer)),
    ghosts: god ? [] : [...(s.players[viewer]?.ghosts.values() ?? [])].filter((g) => !shown.has(g.id)),
    shards,
    events: s.events.filter((e) => vf === null || ((vf[Math.max(0, Math.min(cfg.map.height - 1, tileOf(e.y))) * w + Math.max(0, Math.min(w - 1, tileOf(e.x)))] as number) & VISIBLE) !== 0),
    over: s.over,
    winner: s.winner,
    players: s.players.map((p, i) => (god || i === viewer ? { faction: p.faction, credits: p.credits, powerOut: p.powerOut, powerIn: p.powerIn } : { faction: p.faction, credits: 0, powerOut: 0, powerIn: 0 })),
    stats: god || s.over ? s.players.map((p) => ({ ...p.stats, army: [...p.stats.army] })) : null,
    viewer: viewer ?? null,
    fog: vf ? vf.slice() : null,
  };
}

export function hash(game: Game): number {
  const s = game.state;
  const h = new Hasher().int(s.tick).int(s.rng.state).int(s.cfg.map.width).int(s.cfg.map.height);
  for (const v of s.cfg.map.heights) h.int(v);
  for (const v of s.grid.blocked) h.int(v);
  for (const u of s.units) h.int(u.id).int(u.owner).int(u.x).int(u.y).int(u.hp).int(u.path.length).int(u.goal).int(u.waiting ? 1 : 0).int(u.load).int(u.hv).int(u.auto ? 1 : 0).int(u.target).int(u.cooldown).int(u.amove).int(u.sinceHurt > 100 ? 100 : u.sinceHurt).int(u.mode.length).int(u.xp).int(u.rank);
  for (const b of s.buildings) {
    h.int(b.id).int(b.owner).int(b.tx).int(b.ty).int(b.hp).int(b.queue.length).int(b.charge).int(b.cooldown).int(b.target);
    for (const q of b.queue) h.int(q.progress).int(q.ready ? 1 : 0);
  }
  for (const p of s.players) {
    h.int(p.credits).int(p.powerOut).int(p.powerIn);
    const st = p.stats;
    h.int(st.unitsBuilt).int(st.unitsLost).int(st.buildingsBuilt).int(st.buildingsLost).int(st.shardsGathered).int(st.army.length).int(st.army[st.army.length - 1] ?? 0);
  }
  for (const f of s.fog) for (const v of f) h.int(v);
  for (const v of s.shards) h.int(v);
  for (const p of s.projectiles) h.int(p.hit).int(p.targetId).int(p.damage);
  for (const k of s.strikes) h.int(k.hit).int(k.x).int(k.y);
  for (const l of s.lingering) h.int(l.owner).int(l.tx).int(l.ty).int(l.until);
  h.int(s.over ? 1 : 0).int(s.winner ?? -1);
  return h.value;
}
