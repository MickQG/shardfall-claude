import { describe, expect, it } from 'vitest';
import { buildingDef } from '../../src/data/defs';
import { DEFAULT_MAP, MAP_SIZE, MAPS, mapIdOf, skirmishConfig, skirmishMap, STARTS } from '../../src/data/maps';
import { createGame, snapshot } from '../../src/sim';
import { findPath } from '../../src/sim/path';

describe('skirmish map', () => {
  const m = skirmishMap();
  const W = MAP_SIZE;
  const grid = { width: W, height: W, blocked: Uint8Array.from(m.blocked!) };

  it('MAP-2: is point-symmetric, connects both starts, and every shard field is reachable from both', () => {
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const j = (W - 1 - y) * W + (W - 1 - x);
        expect(m.blocked![i]).toBe(m.blocked![j]);
        expect(m.shards![i]).toBe(m.shards![j]);
        expect(m.heights[i]).toBe(m.heights[j]);
      }
    }
    const reach = (from: [number, number], to: [number, number]): boolean => {
      const p = findPath(grid, from[0], from[1], to[0], to[1]);
      return p.length > 0 && p.at(-1) === to[1] * W + to[0];
    };
    const a: [number, number] = [STARTS[0].tx + 5, STARTS[0].ty + 5];
    const b: [number, number] = [STARTS[1].tx - 2, STARTS[1].ty - 2];
    expect(reach(a, b)).toBe(true);
    const fieldTiles: [number, number][] = [];
    m.shards!.forEach((v, i) => {
      if (v > 0 && (i % W) % 2 === 0 && Math.floor(i / W) % 2 === 0) fieldTiles.push([i % W, Math.floor(i / W)]);
    });
    expect(fieldTiles.length).toBeGreaterThan(10);
    for (const f of fieldTiles) {
      expect(m.blocked![f[1] * W + f[0]]).toBe(0);
      expect(reach(a, f)).toBe(true);
      expect(reach(b, f)).toBe(true);
    }
  });

  it('MAP-2: starting forces are on free tiles and each player starts with a working economy', () => {
    const cfg = skirmishConfig();
    const g = createGame(cfg);
    const s = snapshot(g);
    expect(s.buildings.filter((x) => x.owner === 0)).toHaveLength(3);
    expect(s.buildings.filter((x) => x.owner === 1)).toHaveLength(3);
    for (const bd of g.state.buildings) expect(m.blocked![bd.ty * W + bd.tx]).toBe(0);
    expect(s.players[0]!.powerOut).toBeGreaterThanOrEqual(s.players[0]!.powerIn);
    expect(s.players[1]!.powerOut).toBeGreaterThanOrEqual(s.players[1]!.powerIn);
  });
});

describe('skirmish water', () => {
  it('MAP-3: the map has mirrored ponds and lakes that keep clear of starts, starting buildings and shard fields', () => {
    const m = skirmishMap();
    const W = MAP_SIZE;
    const water = (i: number): boolean => !!m.blocked![i] && m.heights[i] === 0;
    let n = 0;
    for (let i = 0; i < W * W; i++) {
      if (!water(i)) continue;
      n++;
      expect(water((W - 1 - Math.floor(i / W)) * W + (W - 1 - (i % W)))).toBe(true); // mirrored
      expect(m.shards![i]).toBe(0);
    }
    expect(n).toBeGreaterThan(120);
    // Every lake body is separate and none is within reach of a base: no water within 8 tiles of either start.
    for (const s of STARTS) for (let y = s.ty - 8; y <= s.ty + 8; y++) for (let x = s.tx - 8; x <= s.tx + 8; x++) expect(water(y * W + x)).toBe(false);
    for (const b of skirmishConfig().buildings ?? []) expect(water(b.ty * W + b.tx)).toBe(false);
  });
});

describe('every skirmish map', () => {
  const W = MAP_SIZE;
  const reachOn = (blocked: ArrayLike<number>) => {
    const grid = { width: W, height: W, blocked: Uint8Array.from(blocked) };
    return (from: [number, number], to: [number, number]): boolean => {
      const p = findPath(grid, from[0], from[1], to[0], to[1]);
      return p.length > 0 && p.at(-1) === to[1] * W + to[0];
    };
  };
  const a: [number, number] = [STARTS[0].tx + 5, STARTS[0].ty + 5];
  const b: [number, number] = [STARTS[1].tx - 2, STARTS[1].ty - 2];

  it('MAP-4: the menu offers three maps, Crossroads first and by default; unknown ids fall back to it', () => {
    expect(MAPS.map((m) => m.id)).toEqual(['crossroads', 'riverbed', 'highlands']);
    expect(DEFAULT_MAP).toBe('crossroads');
    expect(mapIdOf('riverbed')).toBe('riverbed');
    for (const bad of [null, undefined, '', 'CROSSROADS', '../x', '<img>', 42]) expect(mapIdOf(bad)).toBe('crossroads');
    expect(skirmishMap()).toEqual(skirmishMap('crossroads'));
    expect(skirmishConfig(1, { map: 'highlands' }).map).toEqual(skirmishMap('highlands'));
  });

  for (const { id } of MAPS) {
    it(`MAP-4: ${id} is point-symmetric, connects both starts, and every shard field is reachable from both`, () => {
      const m = skirmishMap(id);
      for (let i = 0; i < W * W; i++) {
        const j = W * W - 1 - i;
        expect(m.blocked![i]).toBe(m.blocked![j]);
        expect(m.shards![i]).toBe(m.shards![j]);
        expect(m.heights[i]).toBe(m.heights[j]);
        if (m.heights[i]) expect(m.blocked![i]).toBe(1); // raised ground is rock
      }
      const reach = reachOn(m.blocked!);
      expect(reach(a, b)).toBe(true);
      let fields = 0;
      m.shards!.forEach((v, i) => {
        if (!v) return;
        fields++;
        expect(m.blocked![i]).toBe(0);
        if ((i % W) % 2 === 0 && Math.floor(i / W) % 2 === 0) {
          expect(reach(a, [i % W, Math.floor(i / W)])).toBe(true);
          expect(reach(b, [i % W, Math.floor(i / W)])).toBe(true);
        }
      });
      expect(fields).toBeGreaterThan(60);
    });

    it(`MAP-4: on ${id} the starting forces stand on open ground, with no water within 8 tiles of a start`, () => {
      const m = skirmishMap(id);
      const cfg = skirmishConfig(1, { map: id });
      const g = createGame(cfg);
      expect(g.state.buildings).toHaveLength(6);
      expect(g.state.units.length).toBe((cfg.units ?? []).length);
      for (const bd of cfg.buildings ?? []) {
        const d = buildingDef(bd.kind);
        for (let y = bd.ty; y < bd.ty + d.h; y++) for (let x = bd.tx; x < bd.tx + d.w; x++) expect(m.blocked![y * W + x]).toBe(0);
      }
      for (const u of cfg.units ?? []) expect(m.blocked![u.ty * W + u.tx]).toBe(0);
      for (const s of STARTS) for (let y = s.ty - 8; y <= s.ty + 8; y++) for (let x = s.tx - 8; x <= s.tx + 8; x++) expect(m.blocked![y * W + x] && !m.heights[y * W + x]).toBeFalsy();
    });
  }

  it('MAP-5: on Riverbed a river parts the bases, crossed only at the centre bridge and two fords', () => {
    const m = skirmishMap('riverbed');
    let water = 0;
    for (let i = 0; i < W * W; i++) if (m.blocked![i] && !m.heights[i]) water++;
    expect(water).toBeGreaterThan(300);
    // Close the three crossings (the bridge and both fords): the bases are cut off from each other.
    const closed = Array.from(m.blocked!);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const along = x - y;
        const across = x + y - (W - 1);
        if (Math.abs(across) <= 8 && (Math.abs(along) <= 7 || Math.abs(Math.abs(along) - 44) <= 5)) closed[y * W + x] = 1;
      }
    expect(reachOn(m.blocked!)(a, b)).toBe(true);
    expect(reachOn(closed)(a, b)).toBe(false);
    // The richest field is on the centre bridge.
    const c = 47 * W + 47;
    expect(m.shards![c]).toBe(Math.max(...m.shards!));
  });

  it('MAP-6: on Highlands a ridge ring walls in the basin, entered only by its four passes and two corner gaps, with the richest fields inside', () => {
    const m = skirmishMap('highlands');
    const inner: [number, number] = [40, 47];
    expect(reachOn(m.blocked!)(a, inner)).toBe(true);
    // Close the four passes (strips along the axes through the centre, out at the ring): the basin is sealed.
    // Openings: passes 0-3 on the axes through the centre (north, east, south, west), and gaps 4-5 at the north-west and
    // south-east corners, which face the bases. `half(k)` is how far either side of opening k's axis to close it.
    const close = (half: (k: number) => number): number[] => {
      const closed = Array.from(m.blocked!);
      for (let y = 0; y < W; y++)
        for (let x = 0; x < W; x++) {
          const dx = x - 47.5;
          const dy = y - 47.5;
          const r = Math.max(Math.abs(dx), Math.abs(dy)); // the ring is a square
          if (r <= 14 || r >= 26) continue;
          const corner = Math.min(Math.abs(dx), Math.abs(dy)) > 9;
          const k = corner ? (dx * dy > 0 ? (dx < 0 ? 4 : 5) : -1) : Math.abs(dx) < Math.abs(dy) ? (dy < 0 ? 0 : 2) : dx > 0 ? 1 : 3;
          if (k < 0) continue;
          const off = corner ? Math.abs(dx - dy) / Math.SQRT2 : Math.min(Math.abs(dx), Math.abs(dy));
          if (off <= half(k)) closed[y * W + x] = 1;
        }
      return closed;
    };
    expect(reachOn(close(() => 12))(a, inner)).toBe(false);
    // Each opening on its own lets armies through, and is at least three tiles wide: with the others sealed and a
    // two-tile strip closed down its own axis, the basin can still be reached.
    for (let k = 0; k < 6; k++) expect(reachOn(close((j) => (j === k ? 1 : 12)))(a, inner), `opening ${k}`).toBe(true);
    let best = 0;
    let bestAt = -1;
    m.shards!.forEach((v, i) => {
      if (v > best) [best, bestAt] = [v, i];
    });
    expect(Math.hypot((bestAt % W) - 47.5, Math.floor(bestAt / W) - 47.5)).toBeLessThan(16);
  });
});
