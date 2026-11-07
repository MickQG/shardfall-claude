import { describe, expect, it } from 'vitest';
import { buildingDef, padTile } from '../../src/data/defs';
import { MAPS, skirmishConfig } from '../../src/data/maps';
import { DOCKS } from '../../src/render3d/buildings3d';
import { createGame, FP, hash, snapshot, submit, tick, type Game, type GameConfig, type MapDef } from '../../src/sim';
import { findPath } from '../../src/sim/path';
import { addBuilding, Hv } from '../../src/sim/state';

const W = 48;
const open = (shards: Record<string, number> = {}): MapDef => {
  const sh = new Array<number>(W * W).fill(0);
  for (const [k, v] of Object.entries(shards)) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    sh[y * W + x] = v;
  }
  return { width: W, height: W, heights: new Array<number>(W * W).fill(0), blocked: new Array<number>(W * W).fill(0), shards: sh };
};
const field = (cx: number, cy: number, r: number, amount: number): Record<string, number> => {
  const out: Record<string, number> = {};
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) out[`${x},${y}`] = amount;
  return out;
};
const run = (g: Game, n: number): void => {
  for (let i = 0; i < n; i++) tick(g);
};
const tileOf = (v: number): number => Math.floor(v / FP);

/** A refinery at (12, 6) (pad at (14, 7)), with `haulers` standing below it and a field to the south-east. */
function scene(faction: 'human' | 'alien', haulers: [number, number][], o: { field?: [number, number]; extra?: GameConfig['buildings']; units?: GameConfig['units'] } = {}): Game {
  const [fx, fy] = o.field ?? [17, 16];
  const ref = faction === 'human' ? 'hum_refinery' : 'ali_extractor';
  const hauler = faction === 'human' ? 'hum_hauler' : 'ali_gorger';
  return createGame({
    seed: 1,
    map: open(field(fx, fy, 2, 3000)),
    players: [
      { faction, credits: 0 },
      { faction: 'alien', credits: 0 },
    ],
    buildings: [{ owner: 0, kind: ref, tx: 12, ty: 6 }, { owner: 1, kind: 'ali_hq', tx: 40, ty: 40 }, ...(o.extra ?? [])],
    units: [...haulers.map(([tx, ty]) => ({ owner: 0, kind: hauler, tx, ty })), ...(o.units ?? [])],
  });
}

const PAD = 7 * W + 14;
const haulersOf = (g: Game) => g.state.units.filter((u) => u.kind === 'hum_hauler' || u.kind === 'ali_gorger');

/** Run, checking every tick that shards are only ever unloaded on a pad; returns the credits earned. */
function runOnPad(g: Game, n: number, pads: number[] = [PAD]): number {
  const c0 = g.state.players[0]!.credits;
  for (let i = 0; i < n; i++) {
    const before = new Map(haulersOf(g).map((u) => [u.id, u.load]));
    tick(g);
    for (const u of haulersOf(g)) {
      if ((before.get(u.id) ?? 0) > u.load) expect(pads, `hauler ${u.id} unloads at tick ${g.state.tick}`).toContain(tileOf(u.y) * g.state.grid.width + tileOf(u.x));
    }
  }
  return g.state.players[0]!.credits - c0;
}

describe('dock pad', () => {
  it('ECO-7: each refinery kind has one pad, on the tile its 3D model draws it, drivable and reachable, on every map and side', () => {
    for (const kind of ['hum_refinery', 'ali_extractor']) {
      const d = buildingDef(kind);
      const pad = padTile(kind, 0, 0)!;
      const drawn = DOCKS[kind]!.pad;
      // The model is centred on its footprint, X along tile x and Z along tile y, and buildings never turn.
      expect([Math.floor(d.w / 2 + drawn[0]), Math.floor(d.h / 2 + drawn[1])], kind).toEqual([pad.tx, pad.ty]);
    }
    for (const { id } of MAPS)
      for (const factions of [['human', 'alien'], ['alien', 'human']] as const) {
        const cfg = skirmishConfig(1, { map: id, factions: [...factions] });
        const g = createGame(cfg);
        const refs = g.state.buildings.filter((b) => buildingDef(b.kind).refinery);
        expect(refs, id).toHaveLength(2);
        for (const b of refs) {
          const p = padTile(b.kind, b.tx, b.ty)!;
          const d = buildingDef(b.kind);
          const drawn = DOCKS[b.kind]!.pad;
          expect([Math.floor(b.tx + d.w / 2 + drawn[0]), Math.floor(b.ty + d.h / 2 + drawn[1])], `${id} ${b.kind}`).toEqual([p.tx, p.ty]);
          expect(g.state.grid.blocked[p.ty * 96 + p.tx], `${id} pad drivable`).toBe(0);
          // The rest of the footprint still blocks.
          expect(g.state.grid.blocked[b.ty * 96 + b.tx]).toBe(1);
          const h = g.state.units.find((u) => u.owner === b.owner && (u.kind === 'hum_hauler' || u.kind === 'ali_gorger'))!;
          const path = findPath(g.state.grid, tileOf(h.x), tileOf(h.y), p.tx, p.ty);
          expect(path[path.length - 1], `${id} pad reachable for player ${b.owner}`).toBe(p.ty * 96 + p.tx);
        }
        // Both starting haulers unload, only on their pads, early in the game.
        const pads = refs.map((b) => {
          const p = padTile(b.kind, b.tx, b.ty)!;
          return p.ty * 96 + p.tx;
        });
        const start = g.state.players.map((p) => p.credits);
        for (let i = 0; i < 900; i++) {
          const before = new Map(haulersOf(g).map((u) => [u.id, u.load]));
          tick(g);
          for (const u of haulersOf(g)) if ((before.get(u.id) ?? 0) > u.load) expect(pads).toContain(tileOf(u.y) * 96 + tileOf(u.x));
        }
        g.state.players.forEach((p, i) => expect(p.credits, `${id} player ${i} earns`).toBeGreaterThan(start[i]!));
      }
  }, 120_000);

  it('ECO-7: a hauler unloads only on the pad, turns no profit elsewhere, and drives off once empty', () => {
    for (const faction of ['human', 'alien'] as const) {
      const g = scene(faction, [[10, 10]], { field: [4, 3] }); // the field lies behind the refinery, away from the pad
      const earned = runOnPad(g, 1600);
      expect(earned, faction).toBeGreaterThanOrEqual(400);
      // Seen unloading: on the pad, in the unloading state, and the snapshot says where it docks.
      const g2 = scene(faction, [[16, 9]]);
      const h = haulersOf(g2)[0]!;
      h.load = 200;
      let seen = false;
      for (let i = 0; i < 300 && !seen; i++) {
        tick(g2);
        if (h.hv === Hv.Unload) {
          seen = true;
          expect(tileOf(h.y) * W + tileOf(h.x)).toBe(PAD);
          expect(snapshot(g2, 0).units.find((u) => u.id === h.id)!.dock).toBe(g2.state.buildings[0]!.id);
        }
      }
      expect(seen).toBe(true);
      run(g2, 60);
      expect(h.load).toBe(0);
      expect(snapshot(g2, 0).units.find((u) => u.id === h.id)!.dock).toBeUndefined();
      run(g2, 60);
      expect(tileOf(h.y) * W + tileOf(h.x)).not.toBe(PAD); // gone back to the field
    }
  });

  it('ECO-8: a second hauler waits beside the taken pad, then takes its turn', () => {
    const g = scene('human', [[16, 9], [17, 10]]);
    const [a, b] = haulersOf(g) as [NonNullable<ReturnType<typeof haulersOf>[0]>, NonNullable<ReturnType<typeof haulersOf>[0]>];
    a.load = 200;
    b.load = 200;
    let both = false;
    let waited = false;
    for (let i = 0; i < 400; i++) {
      const before = [a.load, b.load];
      tick(g);
      expect(a.hv === Hv.Unload && b.hv === Hv.Unload, 'never two on one pad').toBe(false);
      if ((a.hv === Hv.Unload && b.hv === Hv.Queue) || (b.hv === Hv.Unload && a.hv === Hv.Queue)) {
        waited = true;
        const waiter = a.hv === Hv.Queue ? a : b;
        // It waits close beside the pad, not on it.
        expect(Math.max(Math.abs(tileOf(waiter.x) - 14), Math.abs(tileOf(waiter.y) - 7))).toBeLessThanOrEqual(5);
      }
      for (const [k, u] of [a, b].entries()) if (before[k]! > u.load) expect(tileOf(u.y) * W + tileOf(u.x)).toBe(PAD);
      if (a.load === 0 && b.load === 0) {
        both = true;
        break;
      }
    }
    expect(waited).toBe(true);
    expect(both).toBe(true);
    expect(g.state.players[0]!.credits).toBe(400);
  });

  it('ECO-8: three haulers on one refinery earn within 15% of what they did before the pad, deterministically', () => {
    // Credits after three minutes from the same scenes before the dock pad (unloading from any tile beside the refinery).
    const before = { human: 10000, alien: 11120 };
    for (const faction of ['human', 'alien'] as const) {
      const make = (): Game => scene(faction, [[12, 10], [13, 10], [14, 10]]);
      const g = make();
      const earned = runOnPad(g, 20 * 180);
      expect(earned, faction).toBeGreaterThanOrEqual(before[faction] * 0.85);
      const again = make();
      run(again, 20 * 180);
      expect(hash(again)).toBe(hash(g));
    }
  }, 60_000);

  it('ECO-8: haulers spread over refineries rather than all queueing at the nearest', () => {
    const g = scene('human', [[12, 10], [13, 10], [14, 10], [15, 10]], { extra: [{ owner: 0, kind: 'hum_refinery', tx: 18, ty: 6 }] });
    const pads = [PAD, 7 * W + 20];
    runOnPad(g, 20 * 120, pads);
    const used = new Set<number>();
    // Watch who unloads where for another minute.
    for (let i = 0; i < 1200; i++) {
      tick(g);
      for (const u of haulersOf(g)) if (u.hv === Hv.Unload) used.add(u.dock);
    }
    expect(used.size).toBe(2);
  }, 60_000);

  it('ECO-9: a unit parked on the pad does not stop the haulers', () => {
    for (const parked of ['hum_rifleman', 'hum_tank']) {
      const g = scene('human', [[16, 9]], { units: [{ owner: 0, kind: parked, tx: 14, ty: 7 }] });
      const guard = g.state.units.find((u) => u.kind === parked)!;
      submit(g, { type: 'stop', player: 0, units: [guard.id] });
      const h = haulersOf(g)[0]!;
      h.load = 200;
      const earned = runOnPad(g, 400);
      expect(earned, parked).toBeGreaterThanOrEqual(200);
    }
    // An enemy parked on the pad does not stop it either.
    const g = scene('human', [[16, 9]], { units: [{ owner: 1, kind: 'ali_skitter', tx: 14, ty: 7 }] });
    g.state.units.find((u) => u.owner === 1)!.hp = 1e6;
    haulersOf(g)[0]!.load = 200;
    expect(runOnPad(g, 400)).toBeGreaterThanOrEqual(200);
  });

  it('ECO-9: if the refinery dies mid-queue the haulers go to another; with none left they wait, then resume', () => {
    const g = scene('human', [[16, 9], [17, 10], [15, 10]], { extra: [{ owner: 0, kind: 'hum_refinery', tx: 30, ty: 6 }] });
    for (const h of haulersOf(g)) h.load = 200;
    // Let them reach the first refinery's pad and line up.
    for (let i = 0; i < 200 && !haulersOf(g).some((u) => u.hv === Hv.Queue); i++) tick(g);
    expect(haulersOf(g).some((u) => u.hv === Hv.Queue)).toBe(true);
    const first = g.state.buildings[0]!;
    first.hp = 0;
    tick(g);
    expect(g.state.buildings.includes(first)).toBe(false);
    const c0 = g.state.players[0]!.credits;
    runOnPad(g, 1200, [7 * W + 32]);
    expect(g.state.players[0]!.credits - c0).toBeGreaterThanOrEqual(400);

    // No refinery at all: full haulers wait (ECO-3) and deliver once one stands again.
    const g2 = scene('human', [[16, 9], [17, 10]]);
    for (const h of haulersOf(g2)) h.load = 200;
    run(g2, 30);
    g2.state.buildings[0]!.hp = 0;
    run(g2, 300);
    expect(g2.state.players[0]!.credits).toBeLessThan(400);
    expect(haulersOf(g2).every((u) => u.dock === -1 && u.load > 0)).toBe(true);
    g2.state.players[0]!.credits = 0;
    addBuilding(g2.state, 0, 'hum_refinery', 30, 6);
    run(g2, 1200);
    expect(g2.state.players[0]!.credits).toBeGreaterThanOrEqual(200);
  });

  it('ECO-9: a walled-in pad falls back to unloading beside the refinery; a stopped hauler gives up its place', () => {
    // Buildings close every way onto the pad.
    const g = scene('human', [[16, 12]], {
      extra: [
        { owner: 0, kind: 'hum_reactor', tx: 15, ty: 6 },
        { owner: 0, kind: 'hum_reactor', tx: 13, ty: 8 },
        { owner: 0, kind: 'hum_reactor', tx: 15, ty: 8 },
      ],
    });
    const h = haulersOf(g)[0]!;
    h.load = 200;
    run(g, 800);
    expect(g.state.players[0]!.credits).toBeGreaterThanOrEqual(200);

    const g2 = scene('human', [[16, 9], [17, 10]]);
    const [a, b] = haulersOf(g2) as [ReturnType<typeof haulersOf>[0] & object, ReturnType<typeof haulersOf>[0] & object];
    a.load = 200;
    b.load = 200;
    for (let i = 0; i < 300 && a.hv !== Hv.ToPad && a.hv !== Hv.Unload; i++) tick(g2);
    const holder = a.hv === Hv.ToPad || a.hv === Hv.Unload ? a : b;
    const other = holder === a ? b : a;
    submit(g2, { type: 'stop', player: 0, units: [holder.id] });
    for (let i = 0; i < 600 && other.load > 0; i++) tick(g2);
    expect(other.load).toBe(0);
    expect(holder.load).toBe(200); // stopped where it stood, still loaded
  });
});

