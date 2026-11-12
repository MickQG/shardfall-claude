import { describe, expect, it } from 'vitest';
import { buildingDef, unitDef } from '../../src/data/defs';
import { brawlConfig, skirmishConfig } from '../../src/data/maps';
import { createGame, FP, hash, submit, tick, type Command, type Game, type GameConfig, type UnitSpawn } from '../../src/sim';
import { distanceField, FAR, findPath, isBlocked } from '../../src/sim/path';
import type { Unit } from '../../src/sim/state';

const MIX = ['hum_rifleman', 'hum_tank', 'hum_rocketeer', 'hum_buggy', 'hum_artillery'];

/**
 * Riverbed (the costliest map to route on) with `n` of player 0's units packed around its HQ and nothing else moving.
 * With `spotter`, one more of player 0's riflemen stands by the enemy HQ so that it is in sight and can be attacked.
 */
function massConfig(n = 200, spotter = false): GameConfig {
  const base = skirmishConfig(1, { map: 'riverbed', factions: ['human', 'alien'] });
  const probe = createGame({ ...base, units: [] });
  const g = probe.state.grid;
  const hq = probe.state.buildings.find((b) => b.owner === 0 && buildingDef(b.kind).hq)!;
  const cx = hq.tx + 1;
  const cy = hq.ty + 1;
  const units: UnitSpawn[] = [];
  for (let r = 3; units.length < n && r < g.width; r++)
    for (let y = cy - r; y <= cy + r && units.length < n; y++)
      for (let x = cx - r; x <= cx + r && units.length < n; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r || isBlocked(g, x, y)) continue;
        units.push({ owner: 0, kind: MIX[units.length % MIX.length]!, tx: x, ty: y });
      }
  const foe = probe.state.buildings.find((b) => b.owner === 1 && buildingDef(b.kind).hq)!;
  if (spotter) units.push({ owner: 0, kind: 'hum_rifleman', tx: foe.tx - 2, ty: foe.ty + 1 });
  return { ...base, units };
}

const enemyHq = (g: Game, player: number) => g.state.buildings.find((b) => b.owner !== player && buildingDef(b.kind).hq)!;
const mine = (g: Game, player: number): Unit[] => g.state.units.filter((u) => u.owner === player);
const byId = (g: Game, id: number): Unit | undefined => g.state.units.find((u) => u.id === id);
const atGoal = (g: Game, u: Unit): boolean => u.goal >= 0 && Math.floor(u.x / FP) + Math.floor(u.y / FP) * g.state.grid.width === u.goal;

/** Every listed unit that can move has its route and has moved off its start within `ticks` ticks of the order. */
function underWay(g: Game, ids: number[], ticks: number): { late: number[]; unrouted: number[] } {
  const start = new Map(ids.map((id) => [id, { x: byId(g, id)!.x, y: byId(g, id)!.y }]));
  for (let i = 0; i < ticks; i++) tick(g);
  const late: number[] = [];
  const unrouted: number[] = [];
  for (const id of ids) {
    const u = byId(g, id);
    if (!u || atGoal(g, u)) continue;
    const s = start.get(id)!;
    if (u.waiting) unrouted.push(id);
    if (u.x === s.x && u.y === s.y) late.push(id);
  }
  return { late, unrouted };
}

/** The brawl (BAL-11's 200-unit set-up): both armies attack-move into each other. */
function brawl(): Game {
  const g = createGame(brawlConfig(1, 100, 'human'));
  for (const p of [0, 1]) {
    const hq = enemyHq(g, p);
    submit(g, { type: 'attackmove', player: p, units: mine(g, p).map((u) => u.id), x: (hq.tx + 2) * FP, y: (hq.ty + 2) * FP });
  }
  return g;
}

describe('order response (SIM-10)', () => {
  for (const type of ['move', 'attackmove', 'attack'] as const) {
    it(`SIM-10: 200 units given one ${type} order across the map all have their routes and are under way within 10 ticks`, () => {
      const g = createGame(massConfig(200, true));
      const ids = mine(g, 0)
        .slice(0, 200)
        .map((u) => u.id);
      expect(ids).toHaveLength(200);
      const hq = enemyHq(g, 0);
      const cmd: Command =
        type === 'attack' ? { type, player: 0, units: ids, target: hq.id } : { type, player: 0, units: ids, x: (hq.tx - 3) * FP, y: (hq.ty + 1) * FP };
      submit(g, cmd);
      const { late, unrouted } = underWay(g, ids, 10);
      expect(unrouted).toEqual([]);
      expect(late).toEqual([]);
    });
  }

  it('SIM-10: a moving group of 200 given a new order never has a unit stand still waiting for its route', () => {
    const g = createGame(massConfig());
    const ids = mine(g, 0).map((u) => u.id);
    const hq = enemyHq(g, 0);
    submit(g, { type: 'move', player: 0, units: ids, x: (hq.tx - 3) * FP, y: (hq.ty + 1) * FP });
    for (let i = 0; i < 40; i++) tick(g);
    // Turn the whole group round to a point on the far side of the map.
    submit(g, { type: 'move', player: 0, units: ids, x: 8 * FP, y: (g.state.grid.height - 8) * FP });
    const last = new Map(ids.map((id) => [id, { x: byId(g, id)!.x, y: byId(g, id)!.y, still: 0 }]));
    let worst = 0;
    for (let t = 0; t < 40; t++) {
      tick(g);
      for (const id of ids) {
        const u = byId(g, id)!;
        const r = last.get(id)!;
        const step = Math.abs(u.x - r.x) + Math.abs(u.y - r.y);
        r.x = u.x;
        r.y = u.y;
        // Standing still while on the order: under a quarter of its pace this tick.
        if (u.mode === 'move' && step < unitDef(u.kind).speed / 4) r.still++;
        else r.still = 0;
        worst = Math.max(worst, r.still);
      }
    }
    expect(worst).toBeLessThanOrEqual(2);
  });

  it('SIM-10: in a 200-unit fight, a fresh move order to 30 units is routed within 10 ticks', () => {
    const g = brawl();
    for (let i = 0; i < 50; i++) tick(g);
    const ids = mine(g, 0)
      .filter((u) => !unitDef(u.kind).hero)
      .slice(0, 30)
      .map((u) => u.id);
    expect(ids).toHaveLength(30);
    submit(g, { type: 'move', player: 0, units: ids, x: 4 * FP, y: 4 * FP });
    const { unrouted, late } = underWay(g, ids, 10);
    expect(unrouted).toEqual([]);
    expect(late).toEqual([]);
  });

  it('SIM-10: orders are served before automatic re-routes, and no unit is ever queued twice', () => {
    const g = brawl();
    for (let t = 0; t < 300; t++) {
      if (t === 50) submit(g, { type: 'move', player: 0, units: mine(g, 0).slice(0, 10).map((u) => u.id), x: 4 * FP, y: 4 * FP });
      tick(g);
      const all = [...g.state.orderQueue, ...g.state.pathQueue];
      expect(new Set(all).size).toBe(all.length);
      // A unit waiting on an order is never behind an automatic re-route.
      for (const id of g.state.pathQueue) expect(byId(g, id)?.urgent ?? false).toBe(false);
    }
  });

  it('SIM-10: a unit attacking a building that stands still asks for its route once, not again and again', () => {
    const g = createGame(massConfig(1, true));
    const u = mine(g, 0)[0]!;
    submit(g, { type: 'attack', player: 0, units: [u.id], target: enemyHq(g, 0).id });
    // Each route served is a fresh path array; walking it only shortens the same one.
    let routes = 0;
    let path: number[] = [];
    for (let t = 0; t < 400; t++) {
      tick(g);
      if (byId(g, u.id)?.mode !== 'attack') break;
      const p = byId(g, u.id)!.path;
      if (p !== path && p.length > 0) routes++;
      path = p;
    }
    expect(routes).toBe(1);
  });

  it('SIM-10: the same commands in a busy fight give the same hash twice', () => {
    const play = (): number => {
      const g = brawl();
      for (let t = 0; t < 120; t++) {
        if (t === 40) submit(g, { type: 'move', player: 0, units: mine(g, 0).slice(0, 30).map((u) => u.id), x: 4 * FP, y: 30 * FP });
        if (t === 60) submit(g, { type: 'attack', player: 1, units: mine(g, 1).slice(0, 20).map((u) => u.id), target: enemyHq(g, 1).id });
        tick(g);
      }
      return hash(g);
    };
    expect(play()).toBe(play());
  });
});

describe('route search (SIM-10, SIM-3, SIM-4)', () => {
  const grid = createGame(skirmishConfig(1, { map: 'crossroads' })).state.grid;
  const W = grid.width;
  /** Cost of walking `p` from (sx,sy), failing on any step that jumps, lands on a blocked tile or cuts a blocked corner. */
  const walk = (sx: number, sy: number, p: number[]): number => {
    let [x, y, cost] = [sx, sy, 0];
    for (const q of p) {
      const [nx, ny] = [q % W, Math.floor(q / W)];
      const [dx, dy] = [nx - x, ny - y];
      expect(Math.max(Math.abs(dx), Math.abs(dy))).toBe(1);
      expect(isBlocked(grid, nx, ny)).toBe(false);
      if (dx !== 0 && dy !== 0) expect(isBlocked(grid, x + dx, y) || isBlocked(grid, x, y + dy)).toBe(false);
      cost += dx !== 0 && dy !== 0 ? 14 : 10;
      [x, y] = [nx, ny];
    }
    return cost;
  };

  it('SIM-3 SIM-10: every route is a shortest one, with or without a group order’s shared distance fields', () => {
    let seed = 7;
    const rnd = (k: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % k;
    };
    for (let i = 0; i < 300; i++) {
      const [sx, sy, gx, gy] = [rnd(W), rnd(grid.height), rnd(W), rnd(grid.height)];
      if (isBlocked(grid, sx, sy) || isBlocked(grid, gx, gy) || (sx === gx && sy === gy)) continue;
      const exact = distanceField(grid, sy * W + sx);
      if (exact[gy * W + gx] === FAR) continue;
      const lx = Math.min(W - 1, gx + 3);
      const landmarks = isBlocked(grid, lx, gy) ? [] : [distanceField(grid, gy * W + lx), distanceField(grid, rnd(grid.height) * W + rnd(W))];
      for (const p of [findPath(grid, sx, sy, gx, gy), findPath(grid, sx, sy, gx, gy, undefined, landmarks)]) {
        expect(p.at(-1)).toBe(gy * W + gx);
        expect(walk(sx, sy, p)).toBe(exact[gy * W + gx]);
      }
    }
    // A case the old search got wrong (it walked 680 where 672 will do).
    expect(walk(24, 64, findPath(grid, 24, 64, 32, 0))).toBe(672);
  });

  it('SIM-3 SIM-10: a route to a building ends on the nearest tile next to it without searching the whole map', () => {
    const s = createGame(skirmishConfig(1, { map: 'crossroads' })).state;
    const hq = s.buildings.find((b) => b.owner === 1 && buildingDef(b.kind).hq)!;
    const [gx, gy] = [hq.tx + 1, hq.ty + 1];
    const work = { expanded: 0 };
    const p = findPath(grid, 10, 10, gx, gy, work);
    const end = p.at(-1)!;
    const near = (q: number): number => Math.max(Math.abs((q % W) - gx), Math.abs(Math.floor(q / W) - gy));
    expect(near(end)).toBe(2); // the HQ is 3 by 3: its middle is two tiles from the nearest free ones
    const exact = distanceField(grid, 10 * W + 10);
    expect(walk(10, 10, p)).toBe(exact[end]);
    expect(work.expanded).toBeLessThan(grid.width * grid.height / 4);
  });
});
