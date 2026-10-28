import { describe, expect, it } from 'vitest';
import { demoMap } from '../../src/data/maps';
import { SimRunner, TICK_MS } from '../../src/host/runner';
import { clampCamera, mapBounds, pan, screenToWorld, worldToScreen, zoomAt, MAX_ZOOM, MIN_ZOOM } from '../../src/render/camera';
import { interpolate } from '../../src/render/interp';
import { createGame, FP, hash, snapshot, submit, tick, type Game, type MapDef, type UnitSpawn } from '../../src/sim';
import { findPath, type Grid } from '../../src/sim/path';

const open = (w: number, h: number, blockedTiles: [number, number][] = []): MapDef => {
  const blocked = new Array<number>(w * h).fill(0);
  for (const [x, y] of blockedTiles) blocked[y * w + x] = 1;
  return { width: w, height: h, heights: new Array<number>(w * h).fill(0), blocked };
};

const game = (map: MapDef, units: UnitSpawn[], seed = 1): Game => createGame({ seed, map, units });
const run = (g: Game, n: number): void => {
  for (let i = 0; i < n; i++) tick(g);
};
const unit = (g: Game, id: number) => snapshot(g).units.find((u) => u.id === id)!;
const tileOfUnit = (g: Game, id: number): [number, number] => {
  const u = unit(g, id);
  return [Math.floor(u.x / FP), Math.floor(u.y / FP)];
};

describe('sim core', () => {
  it('SIM-1: a game lists its initial units in id order with owner, kind and position', () => {
    const g = game(open(8, 8), [
      { owner: 0, kind: 'hum_rifleman', tx: 1, ty: 2 },
      { owner: 1, kind: 'hum_buggy', tx: 5, ty: 6 },
    ]);
    const s = snapshot(g);
    expect(s.units.map((u) => u.id)).toEqual([1, 2]);
    expect(s.units[0]).toMatchObject({ owner: 0, kind: 'hum_rifleman', x: 1 * FP + FP / 2, y: 2 * FP + FP / 2 });
    expect(s.units[1]).toMatchObject({ owner: 1, kind: 'hum_buggy' });
  });

  it('SIM-2: a move command travels at unit speed and stops; foreign units ignore it', () => {
    const g = game(open(20, 5), [
      { owner: 0, kind: 'hum_rifleman', tx: 1, ty: 2 },
      { owner: 1, kind: 'hum_rifleman', tx: 1, ty: 4 },
    ]);
    submit(g, { type: 'move', player: 0, units: [1, 2], x: 15 * FP + FP / 2, y: 2 * FP + FP / 2 });
    tick(g);
    const moved = unit(g, 1).x - (1 * FP + FP / 2);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual(38);
    expect(unit(g, 2).x).toBe(1 * FP + FP / 2);
    run(g, 400);
    expect(tileOfUnit(g, 1)).toEqual([15, 2]);
    const x = unit(g, 1).x;
    run(g, 10);
    expect(unit(g, 1).x).toBe(x);
  });

  it('SIM-3: routes around blocked tiles with the shortest path; unreachable goals go to the nearest reachable tile', () => {
    const wall: [number, number][] = [];
    for (let y = 0; y < 9; y++) wall.push([5, y]);
    const m = open(11, 11, wall);
    const grid: Grid = { width: 11, height: 11, blocked: Uint8Array.from(m.blocked!) };
    const path = findPath(grid, 2, 2, 8, 2);
    expect(path.length).toBeGreaterThan(0);
    expect(path.at(-1)).toBe(2 * 11 + 8);
    expect(path.some((i) => i % 11 === 5 && Math.floor(i / 11) >= 9)).toBe(true);
    // open ground: straight line of length 6 (steps)
    const straight = findPath({ width: 11, height: 11, blocked: new Uint8Array(121) }, 2, 2, 8, 2);
    expect(straight).toHaveLength(6);

    const sealed: [number, number][] = [];
    for (let y = 0; y < 11; y++) sealed.push([5, y]);
    const sg: Grid = { width: 11, height: 11, blocked: Uint8Array.from(open(11, 11, sealed).blocked!) };
    const near = findPath(sg, 2, 5, 8, 5);
    expect(near.at(-1)).toBe(5 * 11 + 4);
  });

  it('SIM-4: paths never cut diagonally across a blocked corner', () => {
    // Blocks at (3,2) and (2,3) leave only a diagonal gap from (2,2) to (3,3).
    const m = open(6, 6, [
      [3, 2],
      [2, 3],
    ]);
    const grid: Grid = { width: 6, height: 6, blocked: Uint8Array.from(m.blocked!) };
    const path = findPath(grid, 2, 2, 3, 3);
    let px = 2;
    let py = 2;
    for (const i of path) {
      const x = i % 6;
      const y = Math.floor(i / 6);
      if (x !== px && y !== py) {
        expect(grid.blocked[py * 6 + x]).toBe(0);
        expect(grid.blocked[y * 6 + px]).toBe(0);
      }
      px = x;
      py = y;
    }
    expect(path.at(-1)).toBe(3 * 6 + 3);
    expect(path.length).toBeGreaterThan(1);
  });

  it('SIM-5: units never end a tick on a blocked tile while crowding through a gap', () => {
    const wall: [number, number][] = [];
    for (let y = 0; y < 12; y++) if (y !== 6) wall.push([6, y]);
    const m = open(12, 12, wall);
    const spawns: UnitSpawn[] = Array.from({ length: 12 }, (_, i) => ({ owner: 0, kind: 'hum_rifleman', tx: 2 + (i % 3), ty: 4 + Math.floor(i / 3) }));
    const g = game(m, spawns);
    submit(g, { type: 'move', player: 0, units: spawns.map((_, i) => i + 1), x: 10 * FP, y: 6 * FP });
    for (let t = 0; t < 400; t++) {
      tick(g);
      for (const u of snapshot(g).units) {
        expect(m.blocked![Math.floor(u.y / FP) * 12 + Math.floor(u.x / FP)]).toBe(0);
      }
    }
  });

  it('SIM-6: same seed and commands hash identically; different commands differ', () => {
    const spawns: UnitSpawn[] = [{ owner: 0, kind: 'hum_buggy', tx: 2, ty: 2 }];
    const play = (tx: number): number => {
      const g = game(demoMap(24, 24), spawns, 9);
      submit(g, { type: 'move', player: 0, units: [1], x: tx * FP, y: 20 * FP });
      run(g, 120);
      return hash(g);
    };
    expect(play(18)).toBe(play(18));
    expect(play(18)).not.toBe(play(8));
  });

  it('SIM-7: overlapping units are pushed apart and settle without stacking', () => {
    const g = game(open(10, 10), [
      { owner: 0, kind: 'hum_rifleman', tx: 5, ty: 5 },
      { owner: 0, kind: 'hum_rifleman', tx: 5, ty: 5 },
      { owner: 0, kind: 'hum_rifleman', tx: 5, ty: 5 },
    ]);
    run(g, 80);
    const us = snapshot(g).units;
    for (let i = 0; i < us.length; i++) {
      for (let j = i + 1; j < us.length; j++) {
        const d = Math.hypot(us[i]!.x - us[j]!.x, us[i]!.y - us[j]!.y);
        expect(d).toBeGreaterThanOrEqual(120);
      }
    }
  });

  it('SIM-8: a group move gives each unit a distinct destination tile', () => {
    const spawns: UnitSpawn[] = Array.from({ length: 9 }, (_, i) => ({ owner: 0, kind: 'hum_rifleman', tx: 1 + (i % 3), ty: 1 + Math.floor(i / 3) }));
    const g = game(open(20, 20), spawns);
    submit(g, { type: 'move', player: 0, units: spawns.map((_, i) => i + 1), x: 14 * FP + 10, y: 14 * FP + 10 });
    tick(g);
    const dests = new Set(snapshot(g).units.map((u) => `${u.dest![0]},${u.dest![1]}`));
    expect(dests.size).toBe(9);
    run(g, 700);
    for (const u of snapshot(g).units) {
      expect(Math.abs(u.x / FP - 14.5)).toBeLessThan(3);
      expect(Math.abs(u.y / FP - 14.5)).toBeLessThan(3);
    }
  });
});

describe('camera, interpolation and host', () => {
  const b = mapBounds(96, 96);
  const v = { width: 1280, height: 720 };

  it('CAM-1: pans and zooms within limits, stays in bounds, and round-trips screen/world', () => {
    let c = { x: 0, y: 1000, zoom: 1 };
    c = pan(c, 1e9, 1e9, b);
    expect(c.x).toBeLessThanOrEqual(b.maxX);
    expect(c.y).toBeLessThanOrEqual(b.maxY);
    c = pan(c, -1e9, -1e9, b);
    expect(c.x).toBeGreaterThanOrEqual(b.minX);
    expect(c.y).toBeGreaterThanOrEqual(b.minY);
    expect(clampCamera({ x: 0, y: 0, zoom: 99 }, b).zoom).toBe(MAX_ZOOM);
    expect(clampCamera({ x: 0, y: 0, zoom: 0.01 }, b).zoom).toBe(MIN_ZOOM);

    let z = { x: 100, y: 1500, zoom: 1 };
    const anchor = screenToWorld(z, v, 900, 200);
    z = zoomAt(z, v, 900, 200, 1.5, b);
    const after = screenToWorld(z, v, 900, 200);
    expect(after.x).toBeCloseTo(anchor.x, 6);
    expect(after.y).toBeCloseTo(anchor.y, 6);
    const w = screenToWorld(z, v, 321, 123);
    const s = worldToScreen(z, v, w.x, w.y);
    expect(s.x).toBeCloseTo(321, 9);
    expect(s.y).toBeCloseTo(123, 9);
  });

  it('CAM-2: interpolation blends positions by alpha and clamps it to [0, 1]', () => {
    const mk = (x: number) => [{ id: 1, owner: 0, kind: 'hum_rifleman', x, y: 0, hp: 1, dest: null, load: 0 }];
    expect(interpolate(mk(0), mk(256), 0.5)[0]!.tx).toBeCloseTo(0.5);
    expect(interpolate(mk(0), mk(256), 2)[0]!.tx).toBeCloseTo(1);
    expect(interpolate(mk(0), mk(256), -1)[0]!.tx).toBeCloseTo(0);
  });

  it('HST-1: the runner ticks at a fixed rate regardless of frame size and forwards commands', () => {
    const cfg = { seed: 1, map: open(30, 5), units: [{ owner: 0, kind: 'hum_rifleman', tx: 1, ty: 2 }] };
    const ticksFor = (frame: number): number => {
      const r = new SimRunner(cfg, () => undefined);
      let n = 0;
      for (let t = 0; t < 1000; t += frame) n += r.advance(frame);
      return n;
    };
    expect(ticksFor(16)).toBeGreaterThanOrEqual(19);
    expect(Math.abs(ticksFor(16) - ticksFor(33))).toBeLessThanOrEqual(1);
    expect(Math.abs(ticksFor(16) - 1000 / TICK_MS)).toBeLessThanOrEqual(1);

    let last = 0;
    const r = new SimRunner(cfg, (s) => (last = s.units[0]!.x));
    r.send({ type: 'move', player: 0, units: [1], x: 20 * FP, y: 2 * FP + FP / 2 });
    r.advance(TICK_MS * 5);
    expect(last).toBeGreaterThan(1 * FP + FP / 2);
  });
});
