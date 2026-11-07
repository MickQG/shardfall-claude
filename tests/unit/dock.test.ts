import { describe, expect, it } from 'vitest';
import { buildingDef, padSpots } from '../../src/data/defs';
import { MAPS, skirmishConfig, type MapId } from '../../src/data/maps';
import { dockFrame } from '../../src/render3d/buildings3d';
import { createGame, FP, hash, snapshot, submit, tick, type Game, type GameConfig, type MapDef } from '../../src/sim';
import { findPath } from '../../src/sim/path';
import { LINE_PATIENCE } from '../../src/sim/economy';
import { addBuilding, addUnit, Hv, rebuildBlocked, type Building } from '../../src/sim/state';

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

/** Fields around a refinery whose footprint is (20..22, 20..21): beside it, and off each side. */
const FIELDS = { beside: [26, 23], east: [29, 21], west: [13, 20], south: [21, 28], north: [21, 13] } as const;

/** A refinery at (20, 20) with `haulers` standing below it and a field at `field` (beside it by default). */
function scene(faction: 'human' | 'alien', haulers: [number, number][], o: { field?: readonly [number, number]; extra?: GameConfig['buildings']; units?: GameConfig['units'] } = {}): Game {
  const [fx, fy] = o.field ?? FIELDS.beside;
  const ref = faction === 'human' ? 'hum_refinery' : 'ali_extractor';
  const hauler = faction === 'human' ? 'hum_hauler' : 'ali_gorger';
  return createGame({
    seed: 1,
    map: open(field(fx, fy, 2, 3000)),
    players: [
      { faction, credits: 0 },
      { faction: 'alien', credits: 0 },
    ],
    buildings: [{ owner: 0, kind: ref, tx: 20, ty: 20 }, { owner: 1, kind: 'ali_hq', tx: 42, ty: 42 }, ...(o.extra ?? [])],
    units: [...haulers.map(([tx, ty]) => ({ owner: 0, kind: hauler, tx, ty })), ...(o.units ?? [])],
  });
}

const padOf = (b: Building, width = W): number => (b.pad as [number, number])[1] * width + (b.pad as [number, number])[0];
const haulersOf = (g: Game) => g.state.units.filter((u) => u.kind === 'hum_hauler' || u.kind === 'ali_gorger');

/** Run, checking every tick that shards are only ever unloaded on a pad; returns the credits earned. */
function runOnPad(g: Game, n: number, pads: number[] = [padOf(g.state.buildings[0]!)]): number {
  const c0 = g.state.players[0]!.credits;
  for (let i = 0; i < n; i++) {
    // Haulers act before anyone moves in a tick, so where a hauler stood going into the tick is where it unloaded.
    const before = new Map(haulersOf(g).map((u) => [u.id, { load: u.load, at: tileOf(u.y) * g.state.grid.width + tileOf(u.x) }]));
    tick(g);
    for (const u of haulersOf(g)) {
      const was = before.get(u.id);
      if (was && was.load > u.load) expect(pads, `hauler ${u.id} unloads at tick ${g.state.tick}`).toContain(was.at);
    }
  }
  return g.state.players[0]!.credits - c0;
}

describe('dock pad', () => {
  it('ECO-7: each refinery has one pad, beside the side of its footprint facing its shards, where its dock model stands', () => {
    for (const faction of ['human', 'alien'] as const)
      for (const [side, at] of Object.entries(FIELDS)) {
        const g = scene(faction, [], { field: at });
        const b = g.state.buildings[0]!;
        const pad = b.pad!;
        const d = buildingDef(b.kind);
        // Outside the footprint, touching one of its sides.
        expect(padSpots(b.kind, b.tx, b.ty), side).toContainEqual(pad);
        expect(pad[0] >= b.tx && pad[0] < b.tx + d.w && pad[1] >= b.ty && pad[1] < b.ty + d.h).toBe(false);
        // The spot nearest the shards.
        const near = (p: readonly [number, number]): number => Math.min(...Object.keys(field(at[0], at[1], 2, 1)).map((k) => k.split(',').map(Number)).map(([x, y]) => (x! - p[0]) ** 2 + (y! - p[1]) ** 2));
        for (const s of padSpots(b.kind, b.tx, b.ty)) expect(near(pad), `${faction} ${side}`).toBeLessThanOrEqual(near(s));
        if (side === 'east') expect(pad[0], side).toBe(b.tx + d.w);
        if (side === 'west') expect(pad[0], side).toBe(b.tx - 1);
        if (side === 'south') expect(pad[1], side).toBe(b.ty + d.h);
        if (side === 'north') expect(pad[1], side).toBe(b.ty - 1);
        // The snapshot shows it, and the 3D dock stands on its centre, facing out of the building.
        expect(snapshot(g, 0).buildings[0]!.pad).toEqual(pad);
        const f = dockFrame({ ...b, pad }, d.w, d.h)!;
        expect([Math.floor(f.x), Math.floor(f.z)]).toEqual(pad);
        const inward = [Math.floor(f.x - f.out[0]), Math.floor(f.z - f.out[1])] as const;
        expect(inward[0] >= b.tx && inward[0] < b.tx + d.w && inward[1] >= b.ty && inward[1] < b.ty + d.h, 'one step in from the pad is the building').toBe(true);
      }
  });

  it('ECO-7: on every map, from both sides, the refineries and their pads are exact mirror images, and every pad is reachable', () => {
    const maps: [MapId, number][] = [...MAPS.map(({ id }) => [id, 0] as [MapId, number]), ['generated', 3], ['generated', 77]];
    for (const [id, mapSeed] of maps)
      for (const factions of [['human', 'alien'], ['alien', 'human']] as const) {
        const g = createGame(skirmishConfig(1, { map: id, mapSeed, factions: [...factions] }));
        const N = g.state.grid.width;
        const [r0, r1] = [0, 1].map((p) => g.state.buildings.find((b) => b.owner === p && buildingDef(b.kind).refinery)!) as [Building, Building];
        const d = buildingDef(r0.kind);
        expect([r1.tx, r1.ty], id).toEqual([N - r0.tx - d.w, N - r0.ty - d.h]);
        expect(r1.pad, `${id} pads mirror`).toEqual([N - 1 - r0.pad![0], N - 1 - r0.pad![1]]);
        for (const b of [r0, r1]) {
          expect(g.state.grid.blocked[padOf(b, N)], `${id} pad open`).toBe(0);
          const h = g.state.units.find((u) => u.owner === b.owner && (u.kind === 'hum_hauler' || u.kind === 'ali_gorger'))!;
          const path = findPath(g.state.grid, tileOf(h.x), tileOf(h.y), b.pad![0], b.pad![1]);
          expect(path[path.length - 1], `${id} pad reachable for player ${b.owner}`).toBe(padOf(b, N));
        }
        // Both starting haulers unload, only on their pads.
        const pads = [padOf(r0, N), padOf(r1, N)];
        const start = g.state.players.map((p) => p.credits);
        for (let i = 0; i < 700; i++) {
          const before = new Map(haulersOf(g).map((u) => [u.id, { load: u.load, at: tileOf(u.y) * N + tileOf(u.x) }]));
          tick(g);
          for (const u of haulersOf(g)) if ((before.get(u.id)?.load ?? 0) > u.load) expect(pads).toContain(before.get(u.id)!.at);
        }
        g.state.players.forEach((p, i) => expect(p.credits, `${id} player ${i} earns`).toBeGreaterThan(start[i]!));
      }
  }, 120_000);

  it('ECO-7: no building may be placed over a pad', async () => {
    const { canPlace } = await import('../../src/sim');
    const g = scene('human', []);
    const b = g.state.buildings[0]!;
    const fog = new Uint8Array(W * W).fill(3);
    const ctx = { width: W, height: W, terrain: undefined, occupied: [{ kind: b.kind, tx: b.tx, ty: b.ty, pad: b.pad }], own: [{ kind: b.kind, tx: b.tx, ty: b.ty }], fog };
    expect(canPlace(ctx, 'hum_reactor', b.pad![0], b.pad![1])).toBe(false);
    expect(canPlace(ctx, 'hum_reactor', b.pad![0] + 2, b.pad![1] + 2)).toBe(true);
  });

  it('ECO-7: a hauler unloads only on the pad, then drives off back to its field', () => {
    for (const faction of ['human', 'alien'] as const) {
      const g = scene(faction, [[19, 23]], { field: FIELDS.west });
      const earned = runOnPad(g, 1600);
      expect(earned, faction).toBeGreaterThanOrEqual(400);
      // Seen unloading: on the pad, in the unloading state, and the snapshot says where it docks.
      const g2 = scene(faction, [[22, 24]]);
      const pad = padOf(g2.state.buildings[0]!);
      const h = haulersOf(g2)[0]!;
      h.load = 200;
      let seen = false;
      for (let i = 0; i < 300 && !seen; i++) {
        tick(g2);
        if (h.hv === Hv.Unload) {
          seen = true;
          expect(tileOf(h.y) * W + tileOf(h.x)).toBe(pad);
          expect(snapshot(g2, 0).units.find((u) => u.id === h.id)!.dock).toBe(g2.state.buildings[0]!.id);
        }
      }
      expect(seen).toBe(true);
      // Emptied in about a second (unchanged), then off the pad.
      let t = 0;
      while (h.load > 0 && t < 40) {
        tick(g2);
        t++;
      }
      expect(h.load).toBe(0);
      expect(t).toBeLessThanOrEqual(22);
      expect(snapshot(g2, 0).units.find((u) => u.id === h.id)!.dock).toBeUndefined();
      run(g2, 15);
      expect(tileOf(h.y) * W + tileOf(h.x)).not.toBe(pad); // gone back to the field
    }
  });

  it('ECO-8: a second hauler waits beside the taken pad, then takes its turn', () => {
    const g = scene('human', [[24, 23], [25, 24]]);
    const pad = padOf(g.state.buildings[0]!);
    const [a, b] = haulersOf(g) as [ReturnType<typeof haulersOf>[0] & object, ReturnType<typeof haulersOf>[0] & object];
    a.load = 200;
    b.load = 200;
    let both = false;
    let waited = false;
    const emptied = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const before = [a.load, b.load];
      const at = [a, b].map((u) => tileOf(u.y) * W + tileOf(u.x));
      tick(g);
      expect(a.hv === Hv.Unload && b.hv === Hv.Unload, 'never two on one pad').toBe(false);
      if ((a.hv === Hv.Unload && b.hv === Hv.Queue) || (b.hv === Hv.Unload && a.hv === Hv.Queue)) {
        waited = true;
        const waiter = a.hv === Hv.Queue ? a : b;
        // It waits close beside the pad.
        expect(Math.max(Math.abs(tileOf(waiter.x) - (pad % W)), Math.abs(tileOf(waiter.y) - Math.floor(pad / W)))).toBeLessThanOrEqual(5);
      }
      for (const [k, u] of [a, b].entries()) if (before[k]! > u.load) expect(at[k]).toBe(pad);
      if (a.load === 0) emptied.add(a.id);
      if (b.load === 0) emptied.add(b.id);
      if (emptied.size === 2) {
        both = true;
        break;
      }
    }
    expect(waited).toBe(true);
    expect(both).toBe(true);
    expect(g.state.players[0]!.credits).toBeGreaterThanOrEqual(400);
  });

  it('ECO-8: three haulers on one refinery earn within 10% of before beside their field, within 15% off any side, both factions alike', () => {
    // Beside the field: credits after three minutes from the same scene before the dock pad.
    const beside = { human: 16890, alien: 18010 };
    for (const faction of ['human', 'alien'] as const) {
      const make = (): Game => scene(faction, [[19, 23], [20, 23], [21, 23]]);
      const g = make();
      expect(runOnPad(g, 20 * 180), faction).toBeGreaterThanOrEqual(beside[faction] * 0.9);
      const again = make();
      run(again, 20 * 180);
      expect(hash(again)).toBe(hash(g));
    }
    // Off each side: credits after three minutes, summed over fields 2 to 11 tiles out (so the old haulers' ten-tick
    // rhythm, which favoured whichever unit's round trip happened to fit it, averages out), before the dock pad.
    const before = {
      human: { east: 108060, west: 114380, south: 116370, north: 115030 },
      alien: { east: 114560, west: 121380, south: 122710, north: 121570 },
    };
    const at: Record<keyof (typeof before)['human'], (gap: number) => [number, number]> = {
      east: (gap) => [35 + gap, 31],
      west: (gap) => [27 - gap, 30],
      south: (gap) => [31, 34 + gap],
      north: (gap) => [31, 27 - gap],
    };
    const N = 64;
    for (const side of Object.keys(at) as (keyof typeof at)[]) {
      const loss = { human: 0, alien: 0 };
      for (const faction of ['human', 'alien'] as const) {
        let sum = 0;
        for (let gap = 2; gap < 12; gap++) {
          const [fx, fy] = at[side](gap);
          const sh = new Array<number>(N * N).fill(0);
          for (let y = fy - 2; y <= fy + 2; y++) for (let x = fx - 2; x <= fx + 2; x++) sh[y * N + x] = 3000;
          const g = createGame({
            seed: 1,
            map: { width: N, height: N, heights: new Array<number>(N * N).fill(0), blocked: new Array<number>(N * N).fill(0), shards: sh },
            players: [
              { faction, credits: 0 },
              { faction: 'alien', credits: 0 },
            ],
            buildings: [{ owner: 0, kind: faction === 'human' ? 'hum_refinery' : 'ali_extractor', tx: 30, ty: 30 }, { owner: 1, kind: 'ali_hq', tx: 2, ty: 2 }],
            units: [29, 30, 31].map((tx) => ({ owner: 0, kind: faction === 'human' ? 'hum_hauler' : 'ali_gorger', tx, ty: 33 })),
          });
          run(g, 20 * 180);
          sum += g.state.players[0]!.credits;
        }
        expect(sum, `${faction} ${side}`).toBeGreaterThanOrEqual(before[faction][side] * 0.85);
        loss[faction] = 1 - sum / before[faction][side];
      }
      // The faster Gorger loses no bigger a share at the pad than the Shard Hauler.
      expect(loss.alien - loss.human, side).toBeLessThanOrEqual(0.02);
    }
  }, 300_000);

  it('ECO-8: both starting sides earn alike, within 3% of each other, on every map', () => {
    const maps: [MapId, number][] = [...MAPS.map(({ id }) => [id, 0] as [MapId, number]), ['generated', 3]];
    for (const [id, mapSeed] of maps)
      for (const faction of ['human', 'alien'] as const) {
        const g = createGame(skirmishConfig(1, { map: id, mapSeed, factions: [faction, faction], credits: 0 }));
        run(g, 20 * 300);
        const [a, b] = g.state.players.map((p) => p.credits) as [number, number];
        expect(a, `${id} ${faction}`).toBeGreaterThan(0);
        expect(Math.abs(a - b) / Math.max(a, b), `${id} ${faction}`).toBeLessThanOrEqual(0.03);
      }
  }, 120_000);

  it('ECO-9: a unit parked on the pad does not stop the haulers', () => {
    for (const parked of ['hum_rifleman', 'hum_tank']) {
      const g = scene('human', [[22, 24]]);
      const [px, py] = g.state.buildings[0]!.pad!;
      const guard = addUnitAt(g, 0, parked, px, py);
      submit(g, { type: 'stop', player: 0, units: [guard] });
      haulersOf(g)[0]!.load = 200;
      expect(runOnPad(g, 400), parked).toBeGreaterThanOrEqual(200);
    }
    // An enemy parked on the pad does not stop it either.
    const g = scene('human', [[22, 24]]);
    const [px, py] = g.state.buildings[0]!.pad!;
    const foe = addUnitAt(g, 1, 'ali_skitter', px, py);
    g.state.units.find((u) => u.id === foe)!.hp = 1e6;
    haulersOf(g)[0]!.load = 200;
    expect(runOnPad(g, 400)).toBeGreaterThanOrEqual(200);
  });

  it('ECO-9: if the refinery dies mid-queue the haulers go to another; with none left they wait, then resume', () => {
    const g = scene('human', [[24, 23], [25, 24], [23, 24]], { extra: [{ owner: 0, kind: 'hum_refinery', tx: 34, ty: 10 }] });
    for (const h of haulersOf(g)) h.load = 200;
    for (let i = 0; i < 200 && !haulersOf(g).some((u) => u.hv === Hv.Queue); i++) tick(g);
    expect(haulersOf(g).some((u) => u.hv === Hv.Queue)).toBe(true);
    const first = g.state.buildings[0]!;
    const second = g.state.buildings[2]!;
    first.hp = 0;
    tick(g);
    expect(g.state.buildings.includes(first)).toBe(false);
    const c0 = g.state.players[0]!.credits;
    runOnPad(g, 1200, [padOf(second)]);
    expect(g.state.players[0]!.credits - c0).toBeGreaterThanOrEqual(400);

    // No refinery at all: full haulers wait (ECO-3) and deliver once one stands again.
    const g2 = scene('human', [[24, 23], [25, 24]]);
    for (const h of haulersOf(g2)) h.load = 200;
    run(g2, 30);
    g2.state.buildings[0]!.hp = 0;
    run(g2, 300);
    expect(g2.state.players[0]!.credits).toBeLessThan(400);
    expect(haulersOf(g2).every((u) => u.dock === -1 && u.load > 0)).toBe(true);
    g2.state.players[0]!.credits = 0;
    addBuilding(g2.state, 0, 'hum_refinery', 34, 10);
    run(g2, 1200);
    expect(g2.state.players[0]!.credits).toBeGreaterThanOrEqual(200);
  });

  it('ECO-9: a walled-in pad falls back to unloading beside the refinery; a stopped hauler gives up its place', () => {
    const g = scene('human', [[24, 25]]);
    const b = g.state.buildings[0]!;
    const d = buildingDef(b.kind);
    // Rock all round the pad, outside the footprint.
    const [px, py] = b.pad!;
    for (let y = py - 1; y <= py + 1; y++)
      for (let x = px - 1; x <= px + 1; x++) {
        const inside = x >= b.tx && x < b.tx + d.w && y >= b.ty && y < b.ty + d.h;
        if (!inside && !(x === px && y === py)) g.state.cfg.map.blocked![y * W + x] = 1;
      }
    rebuildBlocked(g.state);
    haulersOf(g)[0]!.load = 200;
    run(g, 800);
    expect(g.state.players[0]!.credits).toBeGreaterThanOrEqual(200);

    const g2 = scene('human', [[24, 23], [25, 24]]);
    const [a, c] = haulersOf(g2) as [ReturnType<typeof haulersOf>[0] & object, ReturnType<typeof haulersOf>[0] & object];
    a.load = 200;
    c.load = 200;
    for (let i = 0; i < 300 && a.hv !== Hv.ToPad && a.hv !== Hv.Unload && c.hv !== Hv.ToPad; i++) tick(g2);
    const holder = a.hv === Hv.ToPad || a.hv === Hv.Unload ? a : c;
    const other = holder === a ? c : a;
    const kept = holder.load;
    submit(g2, { type: 'stop', player: 0, units: [holder.id] });
    for (let i = 0; i < 600 && other.load > 0; i++) tick(g2);
    expect(other.load).toBe(0);
    expect(holder.load).toBeGreaterThanOrEqual(kept - 20); // stopped where it stood
  });
});

/** Put a unit on a tile and return its id. */
function addUnitAt(g: Game, owner: number, kind: string, tx: number, ty: number): number {
  return addUnit(g.state, owner, kind, tx * FP + FP / 2, ty * FP + FP / 2).id;
}

describe('hauler field and refinery choice (#125)', () => {
  const two = (extra: NonNullable<GameConfig['buildings']>, fields: Record<string, number>, hx: number, hy: number): Game =>
    createGame({
      seed: 1,
      map: open(fields),
      players: [{ faction: 'human', credits: 0 }, { faction: 'alien', credits: 0 }],
      buildings: [{ owner: 0, kind: 'hum_refinery', tx: 20, ty: 20 }, { owner: 1, kind: 'ali_hq', tx: 42, ty: 42 }, ...extra],
      units: [{ owner: 0, kind: 'hum_hauler', tx: hx, ty: hy }],
    });

  it('ECO-8: a hauler returns to its own field on every trip although nearer shards lie elsewhere', () => {
    // Its field lies far south-west; a richer field sits right beside the refinery.
    const g = two([], { ...field(8, 34, 1, 3000), ...field(27, 22, 2, 3000) }, 21, 24);
    const h = haulersOf(g)[0]!;
    submit(g, { type: 'harvest', player: 0, units: [h.id], x: 8 * FP + FP / 2, y: 34 * FP + FP / 2 });
    let trips = 0;
    let was = h.hv;
    for (let i = 0; i < 20 * 400 && trips < 3; i++) {
      tick(g);
      if (h.hv === Hv.Gather) {
        const x = tileOf(h.x);
        const y = tileOf(h.y);
        expect(Math.max(Math.abs(x - 8), Math.abs(y - 34)), `gathers at ${x},${y} on tick ${g.state.tick}`).toBeLessThanOrEqual(3);
      }
      if (was === Hv.Unload && h.hv !== Hv.Unload) trips++;
      was = h.hv;
    }
    expect(trips).toBe(3);
  }, 60_000);

  it('ECO-8: a hauler delivers to the refinery whose pad is nearest its field, not the one nearest the hauler', () => {
    const g = two([{ owner: 0, kind: 'hum_refinery', tx: 36, ty: 34 }], field(40, 28, 1, 3000), 21, 24);
    const h = haulersOf(g)[0]!;
    submit(g, { type: 'harvest', player: 0, units: [h.id], x: 40 * FP + FP / 2, y: 28 * FP + FP / 2 });
    for (let i = 0; i < 20 * 120 && h.hv !== Hv.Unload; i++) tick(g);
    expect(h.hv).toBe(Hv.Unload);
    expect(h.dock).toBe(g.state.buildings[2]!.id);
  }, 60_000);

  it('ECO-9: a hauler that waits long in line at the refinery nearest its field moves to a less busy one', () => {
    const g = scene('human', [[19, 23], [20, 23], [21, 23], [22, 23]], { extra: [{ owner: 0, kind: 'hum_refinery', tx: 26, ty: 18 }] });
    const used = new Set<number>();
    for (let i = 0; i < 20 * 240; i++) {
      // Make every hauler in line one that has waited long (ECO-9).
      for (const u of haulersOf(g)) if (u.hv === Hv.Queue && g.state.tick - u.queuedAt <= LINE_PATIENCE) u.queuedAt = g.state.tick - LINE_PATIENCE - 1;
      tick(g);
      for (const u of haulersOf(g)) if (u.hv === Hv.Unload) used.add(u.dock);
    }
    expect(used.size).toBe(2);
  }, 60_000);

  it('AI-18: a hauler keeps its field after unloading; it changes only when the field is used up', () => {
    const g = two([], { ...field(8, 34, 1, 20), ...field(27, 22, 2, 3000) }, 21, 24);
    const h = haulersOf(g)[0]!;
    for (let y = 33; y <= 35; y++) for (let x = 7; x <= 9; x++) g.state.shardSeed[y * W + x] = 0; // no regrowth: it can run dry
    submit(g, { type: 'harvest', player: 0, units: [h.id], x: 8 * FP + FP / 2, y: 34 * FP + FP / 2 });
    let beside = -1;
    for (let i = 0; i < 20 * 600; i++) {
      tick(g);
      if (h.hv === Hv.Gather && tileOf(h.x) > 20 && beside < 0) beside = g.state.tick;
    }
    // Its own small field (9 tiles x 20 shards) runs dry first; only then does it move on to the richer one.
    expect(beside).toBeGreaterThan(0);
    const own = [...Array(9).keys()].map((k) => g.state.shards[(33 + Math.floor(k / 3)) * W + 7 + (k % 3)] as number);
    expect(Math.max(...own)).toBeLessThan(20);
  }, 60_000);
});
